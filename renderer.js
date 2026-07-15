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

// ---- Панель инструментов ----

document.querySelectorAll('#toolbar button[data-cmd]').forEach((btn) => {
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
});

document.getElementById('hiliteColor').addEventListener('input', (e) => {
  editor.focus();
  document.execCommand('hiliteColor', false, e.target.value);
});

function updateToolbarState() {
  document.querySelectorAll('#toolbar button[data-cmd]').forEach((btn) => {
    try {
      const active = document.queryCommandState(btn.dataset.cmd);
      btn.classList.toggle('active', active);
    } catch (e) {}
  });
}

editor.addEventListener('keyup', updateToolbarState);
editor.addEventListener('mouseup', updateToolbarState);

// ---- Вставка: таблица, ссылка, изображение, линия ----

document.getElementById('btnTable').addEventListener('click', () => {
  const rows = parseInt(prompt('Количество строк:', '3'), 10);
  const cols = parseInt(prompt('Количество столбцов:', '3'), 10);
  if (!rows || !cols) return;
  let html = '<table>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
    html += '</tr>';
  }
  html += '</table><p></p>';
  editor.focus();
  document.execCommand('insertHTML', false, html);
  setDirty(true);
});

document.getElementById('btnLink').addEventListener('click', () => {
  const url = prompt('Введите URL ссылки:', 'https://');
  if (!url) return;
  editor.focus();
  document.execCommand('createLink', false, url);
  setDirty(true);
});

document.getElementById('btnImage').addEventListener('click', async () => {
  const dataUrl = await window.api.insertImageDialog();
  if (!dataUrl) return;
  editor.focus();
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

window.api.onMenuToggleTheme(() => {
  document.body.classList.toggle('dark');
});

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
  if (!found) alert('Совпадений больше нет.');
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
