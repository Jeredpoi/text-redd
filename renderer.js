const editor = document.getElementById('editor');
const fileNameEl = document.getElementById('fileName');
const statsEl = document.getElementById('stats');
const savedStateEl = document.getElementById('savedState');

let isDirty = false;
let currentFileLabel = 'Без имени';

function setDirty(v) {
  isDirty = v;
  savedStateEl.textContent = v ? 'Есть несохранённые изменения' : 'Сохранено';
  window.api.setDirty(v);
}

function updateStats() {
  const text = editor.innerText || '';
  const words = text.trim().length ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  statsEl.textContent = `Слов: ${words} · Символов: ${chars}`;
}

editor.addEventListener('input', () => {
  setDirty(true);
  updateStats();
});

// ---- Вкладки ленты ----

document.querySelectorAll('.ribbon-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ribbon-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.ribbon-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.target).classList.add('active');
  });
});

// ---- Панель форматирования ----

document.querySelectorAll('[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    editor.focus();
    document.execCommand(btn.dataset.cmd, false, null);
    updateToolbarState();
  });
});

document.getElementById('fontName').addEventListener('change', (e) => {
  editor.focus();
  document.execCommand('fontName', false, e.target.value);
});

document.getElementById('fontSize').addEventListener('change', (e) => {
  editor.focus();
  document.execCommand('fontSize', false, e.target.value);
});

document.getElementById('blockFormat').addEventListener('change', (e) => {
  editor.focus();
  document.execCommand('formatBlock', false, e.target.value);
});

document.getElementById('foreColor').addEventListener('input', (e) => {
  editor.focus();
  document.execCommand('foreColor', false, e.target.value);
  document.getElementById('foreColorBar').style.background = e.target.value;
});

document.getElementById('hiliteColor').addEventListener('input', (e) => {
  editor.focus();
  document.execCommand('hiliteColor', false, e.target.value);
  document.getElementById('hiliteColorBar').style.background = e.target.value;
});

function updateToolbarState() {
  document.querySelectorAll('[data-cmd]').forEach((btn) => {
    try {
      const active = document.queryCommandState(btn.dataset.cmd);
      btn.classList.toggle('active', active);
    } catch (e) {}
  });
}

editor.addEventListener('keyup', updateToolbarState);
editor.addEventListener('mouseup', updateToolbarState);

// ---- Тема ----

const themeToggle = document.getElementById('themeToggle');

function setTheme(dark) {
  document.body.classList.toggle('dark', dark);
  themeToggle.checked = dark;
  window.api.setTheme(dark ? 'dark' : 'light');
}

themeToggle.addEventListener('change', () => setTheme(themeToggle.checked));
window.api.onMenuToggleTheme(() => setTheme(!document.body.classList.contains('dark')));
window.api.onApplyTheme((theme) => setTheme(theme === 'dark'));

// ---- Уведомления (тост) ----

const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.classList.add('hidden'), 200);
  }, 2000);
}

// ---- Сохранение и восстановление выделения при открытии диалогов ----

let savedRange = null;

function saveSelection() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  } else {
    savedRange = null;
  }
}

function restoreSelection() {
  editor.focus();
  if (savedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
}

function openModal(modal) {
  saveSelection();
  modal.classList.remove('hidden');
}

function closeModal(modal) {
  modal.classList.add('hidden');
}

function wireModalKeys(modal, okBtn, cancelBtn) {
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      okBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelBtn.click();
    }
  });
  modal.addEventListener('mousedown', (e) => {
    if (e.target === modal) cancelBtn.click();
  });
}

// ---- Вставка: таблица ----

const tableModal = document.getElementById('tableModal');
const tableRowsInput = document.getElementById('tableRows');
const tableColsInput = document.getElementById('tableCols');
const tableOkBtn = document.getElementById('tableOkBtn');
const tableCancelBtn = document.getElementById('tableCancelBtn');

wireModalKeys(tableModal, tableOkBtn, tableCancelBtn);

document.getElementById('btnTable').addEventListener('click', () => {
  tableRowsInput.value = 3;
  tableColsInput.value = 3;
  openModal(tableModal);
  tableRowsInput.focus();
  tableRowsInput.select();
});

tableCancelBtn.addEventListener('click', () => closeModal(tableModal));

tableOkBtn.addEventListener('click', () => {
  const rows = Math.max(1, Math.min(50, parseInt(tableRowsInput.value, 10) || 0));
  const cols = Math.max(1, Math.min(20, parseInt(tableColsInput.value, 10) || 0));
  closeModal(tableModal);
  let html = '<table>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
    html += '</tr>';
  }
  html += '</table><p></p>';
  restoreSelection();
  document.execCommand('insertHTML', false, html);
  setDirty(true);
});

// ---- Вставка: ссылка ----

const linkModal = document.getElementById('linkModal');
const linkUrlInput = document.getElementById('linkUrl');
const linkOkBtn = document.getElementById('linkOkBtn');
const linkCancelBtn = document.getElementById('linkCancelBtn');

wireModalKeys(linkModal, linkOkBtn, linkCancelBtn);

document.getElementById('btnLink').addEventListener('click', () => {
  linkUrlInput.value = 'https://';
  openModal(linkModal);
  linkUrlInput.focus();
  linkUrlInput.select();
});

linkCancelBtn.addEventListener('click', () => closeModal(linkModal));

linkOkBtn.addEventListener('click', () => {
  const url = linkUrlInput.value.trim();
  closeModal(linkModal);
  if (!url) return;
  restoreSelection();
  document.execCommand('createLink', false, url);
  setDirty(true);
});

// ---- Вставка: изображение, линия ----

document.getElementById('btnImage').addEventListener('click', async () => {
  saveSelection();
  const dataUrl = await window.api.insertImageDialog();
  if (!dataUrl) return;
  restoreSelection();
  document.execCommand('insertHTML', false, `<img src="${dataUrl}" />`);
  setDirty(true);
});

document.getElementById('btnHr').addEventListener('click', () => {
  editor.focus();
  document.execCommand('insertHorizontalRule', false, null);
  setDirty(true);
});

// ---- Файловые операции ----

function newDoc() {
  editor.innerHTML = '<p><br></p>';
  currentFileLabel = 'Без имени';
  fileNameEl.textContent = currentFileLabel;
  setDirty(false);
  updateStats();
}

async function openFile() {
  const res = await window.api.openFile();
  if (!res) return;
  editor.innerHTML = res.html;
  currentFileLabel = res.name;
  fileNameEl.textContent = currentFileLabel;
  setDirty(false);
  updateStats();
}

async function openPath(p) {
  const res = await window.api.openPath(p);
  if (!res) return;
  editor.innerHTML = res.html;
  currentFileLabel = res.name;
  fileNameEl.textContent = currentFileLabel;
  setDirty(false);
  updateStats();
}

async function saveDoc() {
  const res = await window.api.save(editor.innerHTML);
  if (!res) return;
  currentFileLabel = res.name;
  fileNameEl.textContent = currentFileLabel;
  setDirty(false);
}

async function saveDocAs() {
  const res = await window.api.saveAs(editor.innerHTML);
  if (!res) return;
  currentFileLabel = res.name;
  fileNameEl.textContent = currentFileLabel;
  setDirty(false);
}

async function exportPdf() {
  await window.api.exportPdf(editor.innerHTML);
}

async function exportDocx() {
  await window.api.exportDocx(editor.innerHTML);
}

window.api.onMenuNew(newDoc);
window.api.onMenuOpen(openFile);
window.api.onMenuOpenPath(openPath);
window.api.onMenuSave(saveDoc);
window.api.onMenuSaveAs(saveDocAs);
window.api.onMenuExportPdf(exportPdf);
window.api.onMenuExportDocx(exportDocx);

window.api.onMenuInsertTable(() => document.getElementById('btnTable').click());
window.api.onMenuInsertLink(() => document.getElementById('btnLink').click());
window.api.onMenuInsertImage(() => document.getElementById('btnImage').click());
window.api.onMenuInsertHr(() => document.getElementById('btnHr').click());

// ---- Поиск и замена ----

const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const replaceInput = document.getElementById('replaceInput');

function openFindBar() {
  findBar.classList.remove('hidden');
  findInput.focus();
}

function closeFindBar() {
  findBar.classList.add('hidden');
}

document.getElementById('closeFindBtn').addEventListener('click', closeFindBar);

document.getElementById('findNextBtn').addEventListener('click', () => {
  const term = findInput.value;
  if (!term) return;
  const found = window.find(term);
  if (!found) showToast('Совпадений больше нет.');
});

document.getElementById('replaceBtn').addEventListener('click', () => {
  const sel = window.getSelection();
  if (sel.rangeCount > 0 && sel.toString().toLowerCase() === findInput.value.toLowerCase()) {
    document.execCommand('insertText', false, replaceInput.value);
    setDirty(true);
  }
  document.getElementById('findNextBtn').click();
});

document.getElementById('replaceAllBtn').addEventListener('click', () => {
  const term = findInput.value;
  const repl = replaceInput.value;
  if (!term) return;
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  editor.innerHTML = editor.innerHTML.replace(regex, repl);
  setDirty(true);
  updateStats();
});

window.api.onMenuFind(openFindBar);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openFindBar();
  }
  if (e.key === 'Escape') closeFindBar();
});

// ---- Инициализация ----

newDoc();
editor.focus();
