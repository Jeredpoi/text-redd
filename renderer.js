const editor = document.getElementById('editor');
const docTitle = document.getElementById('docTitle');
const fileNameEl = document.getElementById('fileName');
const statsEl = document.getElementById('stats');
const savedStateEl = document.getElementById('savedState');
const savedDotEl = document.getElementById('savedDot');
const pageScrollEl = document.getElementById('pageScroll');
const tabListEl = document.getElementById('tabList');

let settings = null;
let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let autosaveTimer = null;
let debounceAutosaveTimer = null;

function generateId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

// ---- Заголовок документа = имя файла ----

function titleFromFileName(name) {
  return (name || '').replace(/\.[^./\\]+$/, '');
}

function displayName(tab) {
  const t = (tab.titleText || '').trim();
  return t || tab.fileName || 'Без имени';
}

function updateDisplayName(tab) {
  fileNameEl.textContent = displayName(tab);
}

function combinedContent() {
  return editor.innerHTML;
}

function combinedContentOf(tab) {
  if (tab.id === activeTabId) captureActiveTabFromDOM();
  return tab.bodyHtml || '';
}

// ---- Вкладки ----

function createTab(opts) {
  const tab = {
    id: nextTabId++,
    recoveryId: (opts && opts.recoveryId) || generateId(),
    filePath: (opts && opts.filePath) || null,
    fileName: (opts && opts.fileName) || 'Без имени',
    titleText: (opts && opts.titleText) || '',
    bodyHtml: (opts && opts.bodyHtml) || '',
    isDirty: !!(opts && opts.isDirty),
  };
  tabs.push(tab);
  return tab;
}

function captureActiveTabFromDOM() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.titleText = docTitle.textContent;
  tab.bodyHtml = editor.innerHTML;
}

function setDirtyUI(dirty) {
  savedStateEl.textContent = dirty ? 'Есть несохранённые изменения' : 'Сохранено';
  savedDotEl.classList.toggle('dirty', dirty);
}

function loadTabIntoDOM(tab) {
  docTitle.textContent = tab.titleText || '';
  editor.innerHTML = tab.bodyHtml || '';
  updateDisplayName(tab);
  setDirtyUI(tab.isDirty);
  updateStats();
  computeOutline();
  applyFontControlsFromNode(editor.firstElementChild || editor, false);
}

function updateWindowTitle() {
  const tab = getActiveTab();
  if (!tab) return;
  window.api.setWindowTitle(`${tab.isDirty ? '* ' : ''}${displayName(tab)} — Литера`);
}

function updateActiveTabPillName() {
  const tab = getActiveTab();
  if (!tab) return;
  const pill = tabListEl.querySelector('.tab-pill.active .tab-pill-name');
  if (pill) pill.textContent = displayName(tab);
}

function markActiveDirty() {
  const tab = getActiveTab();
  if (!tab || tab.isDirty) return;
  tab.isDirty = true;
  setDirtyUI(true);
  renderTabBar();
  updateWindowTitle();
}

function applyDefaultFont() {
  if (!settings) return;
  editor.style.fontFamily = settings.defaultFontName;
  editor.style.fontSize = `${settings.defaultFontSize || 15}px`;
  document.getElementById('fontName').value = settings.defaultFontName;
  document.getElementById('fontSize').value = settings.defaultFontSize || 15;
}

let dragTabId = null;

function clearDropIndicators() {
  tabListEl.querySelectorAll('.tab-pill').forEach((p) => p.classList.remove('drop-before', 'drop-after'));
}

function renderTabBar() {
  tabListEl.innerHTML = '';
  tabs.forEach((tab) => {
    const pill = document.createElement('div');
    pill.className = 'tab-pill' + (tab.id === activeTabId ? ' active' : '') + (tab.isDirty ? ' dirty' : '');
    pill.title = tab.filePath || displayName(tab);
    pill.draggable = true;

    const name = document.createElement('span');
    name.className = 'tab-pill-name';
    name.textContent = displayName(tab);

    const dot = document.createElement('span');
    dot.className = 'tab-pill-dot';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-pill-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    pill.appendChild(name);
    pill.appendChild(dot);
    pill.appendChild(closeBtn);
    pill.addEventListener('click', () => switchToTab(tab.id));

    // Средний клик закрывает вкладку, как во всех браузерах
    pill.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(tab.id);
      }
    });

    // Правый клик — меню вкладки, как в браузере
    pill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.api.showTabContextMenu(tab.id);
    });

    // Перетаскивание для смены порядка вкладок
    pill.addEventListener('dragstart', (e) => {
      dragTabId = tab.id;
      pill.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(tab.id)); } catch (err) {}
    });
    pill.addEventListener('dragend', () => {
      pill.classList.remove('dragging');
      clearDropIndicators();
      dragTabId = null;
    });
    pill.addEventListener('dragover', (e) => {
      if (dragTabId === null || dragTabId === tab.id) return;
      e.preventDefault();
      const rect = pill.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      pill.classList.toggle('drop-before', before);
      pill.classList.toggle('drop-after', !before);
    });
    pill.addEventListener('dragleave', () => {
      pill.classList.remove('drop-before', 'drop-after');
    });
    pill.addEventListener('drop', (e) => {
      e.preventDefault();
      const before = e.clientX - pill.getBoundingClientRect().left < pill.getBoundingClientRect().width / 2;
      clearDropIndicators();
      if (dragTabId === null || dragTabId === tab.id) return;
      const fromIdx = tabs.findIndex((t) => t.id === dragTabId);
      if (fromIdx === -1) return;
      const [moved] = tabs.splice(fromIdx, 1);
      const toIdx = tabs.findIndex((t) => t.id === tab.id);
      tabs.splice(before ? toIdx : toIdx + 1, 0, moved);
      renderTabBar();
    });

    tabListEl.appendChild(pill);
  });
}

document.getElementById('tabBar').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.tab-pill')) return;
  e.preventDefault();
  window.api.showTabContextMenu(null);
});

function cycleTab(delta) {
  if (tabs.length === 0) return;
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const next = (idx + delta + tabs.length) % tabs.length;
  switchToTab(tabs[next].id);
}

function jumpToTab(n) {
  if (tabs.length === 0) return;
  if (n === 9) {
    switchToTab(tabs[tabs.length - 1].id);
    return;
  }
  if (tabs[n - 1]) switchToTab(tabs[n - 1].id);
}

function switchToTab(id) {
  if (id === activeTabId) return;
  captureActiveTabFromDOM();
  activeTabId = id;
  loadTabIntoDOM(getActiveTab());
  renderTabBar();
  renderRecentList();
  updateWindowTitle();
}

function newTab() {
  captureActiveTabFromDOM();
  const tab = createTab({ fileName: 'Без имени' });
  activeTabId = tab.id;
  loadTabIntoDOM(tab);
  applyDefaultFont();
  renderTabBar();
  renderRecentList();
  updateWindowTitle();
}

function removeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    const blank = createTab({ fileName: 'Без имени' });
    activeTabId = blank.id;
    loadTabIntoDOM(blank);
    applyDefaultFont();
  } else if (activeTabId === id) {
    const next = tabs[Math.max(0, idx - 1)];
    activeTabId = next.id;
    loadTabIntoDOM(next);
  }
  renderTabBar();
  renderRecentList();
  updateWindowTitle();
}

async function closeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (id !== activeTabId) switchToTab(id);
  captureActiveTabFromDOM();
  if (tab.isDirty) {
    const choice = await showCloseConfirmModal(displayName(tab));
    if (choice === 'cancel') return;
    if (choice === 'save') {
      const ok = await saveActiveTab();
      if (!ok) return;
    } else {
      window.api.clearRecovery(tab.recoveryId);
    }
  } else {
    window.api.clearRecovery(tab.recoveryId);
  }
  removeTab(id);
}

async function closeOtherTabs(keepId) {
  const others = tabs.filter((t) => t.id !== keepId).map((t) => t.id);
  for (const id of others) {
    await closeTab(id);
  }
}

const closeAppConfirmModal = document.getElementById('closeAppConfirmModal');
const closeAppConfirmMessageEl = document.getElementById('closeAppConfirmMessage');
const closeAppCancelBtn = document.getElementById('closeAppCancelBtn');
const closeAppConfirmBtn = document.getElementById('closeAppConfirmBtn');

function showCloseAppConfirmModal(names) {
  return new Promise((resolve) => {
    closeAppConfirmMessageEl.textContent = `Есть несохранённые изменения в: ${names}. Вы уверены, что хотите закрыть? Данные могут быть потеряны.`;
    closeAppConfirmModal.classList.remove('hidden');
    function cleanup(result) {
      closeAppConfirmModal.classList.add('hidden');
      closeAppCancelBtn.removeEventListener('click', onCancel);
      closeAppConfirmBtn.removeEventListener('click', onConfirm);
      resolve(result);
    }
    function onCancel() { cleanup(false); }
    function onConfirm() { cleanup(true); }
    closeAppCancelBtn.addEventListener('click', onCancel);
    closeAppConfirmBtn.addEventListener('click', onConfirm);
  });
}

async function confirmCloseAllTabs() {
  captureActiveTabFromDOM();
  const dirtyList = tabs.filter((t) => t.isDirty);
  if (dirtyList.length === 0) return true;
  const names = dirtyList.map((t) => displayName(t)).join(', ');
  const proceed = await showCloseAppConfirmModal(names);
  if (!proceed) return false;
  dirtyList.forEach((tab) => window.api.clearRecovery(tab.recoveryId));
  return true;
}

window.api.onCloseRequested(async () => {
  const ok = await confirmCloseAllTabs();
  if (ok) window.api.confirmClose();
});

window.api.onTabMenuNew(() => newTab());
window.api.onTabMenuClose((id) => closeTab(id));
window.api.onTabMenuCloseOthers((id) => closeOtherTabs(id));

document.getElementById('newTabBtn').addEventListener('click', newTab);

// ---- Диалог подтверждения закрытия вкладки ----

const closeConfirmModal = document.getElementById('closeConfirmModal');
const closeConfirmMessageEl = document.getElementById('closeConfirmMessage');
const closeConfirmSaveBtn = document.getElementById('closeConfirmSaveBtn');
const closeConfirmDiscardBtn = document.getElementById('closeConfirmDiscardBtn');
const closeConfirmCancelBtn = document.getElementById('closeConfirmCancelBtn');

function showCloseConfirmModal(name) {
  return new Promise((resolve) => {
    closeConfirmMessageEl.textContent = `Документ «${name}» содержит несохранённые изменения.`;
    closeConfirmModal.classList.remove('hidden');
    function cleanup(result) {
      closeConfirmModal.classList.add('hidden');
      closeConfirmSaveBtn.removeEventListener('click', onSave);
      closeConfirmDiscardBtn.removeEventListener('click', onDiscard);
      closeConfirmCancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onSave() { cleanup('save'); }
    function onDiscard() { cleanup('discard'); }
    function onCancel() { cleanup('cancel'); }
    closeConfirmSaveBtn.addEventListener('click', onSave);
    closeConfirmDiscardBtn.addEventListener('click', onDiscard);
    closeConfirmCancelBtn.addEventListener('click', onCancel);
  });
}

// ---- Восстановление после сбоя ----

const recoveryModal = document.getElementById('recoveryModal');
const recoveryMessageEl = document.getElementById('recoveryMessage');
const recoveryRestoreBtn = document.getElementById('recoveryRestoreBtn');
const recoveryDiscardBtn = document.getElementById('recoveryDiscardBtn');

function showRecoveryModal(count) {
  return new Promise((resolve) => {
    recoveryMessageEl.textContent = `Похоже, приложение закрылось некорректно. Найдено несохранённых документов: ${count}. Восстановить их?`;
    recoveryModal.classList.remove('hidden');
    function cleanup(result) {
      recoveryModal.classList.add('hidden');
      recoveryRestoreBtn.removeEventListener('click', onRestore);
      recoveryDiscardBtn.removeEventListener('click', onDiscard);
      resolve(result);
    }
    function onRestore() { cleanup(true); }
    function onDiscard() { cleanup(false); }
    recoveryRestoreBtn.addEventListener('click', onRestore);
    recoveryDiscardBtn.addEventListener('click', onDiscard);
  });
}

// ---- Автообновление ----

const updateModal = document.getElementById('updateModal');
const updateModalMessageEl = document.getElementById('updateModalMessage');
const updateProgressWrapEl = document.getElementById('updateProgressWrap');
const updateProgressFillEl = document.getElementById('updateProgressFill');
const updateProgressLabelEl = document.getElementById('updateProgressLabel');
const updateLaterBtn = document.getElementById('updateLaterBtn');
const updateActionBtn = document.getElementById('updateActionBtn');
const settingsVersionTextEl = document.getElementById('settingsVersionText');

let updateState = 'idle';

function showUpdateAvailable(info) {
  updateState = 'available';
  updateModalMessageEl.textContent = `Вышла новая версия ${info.version}. Скачать и установить сейчас?`;
  updateProgressWrapEl.classList.add('hidden');
  updateActionBtn.disabled = false;
  updateActionBtn.textContent = 'Скачать и установить';
  updateLaterBtn.classList.remove('hidden');
  updateLaterBtn.textContent = 'Позже';
  updateModal.classList.remove('hidden');
}

function showUpdateDownloading() {
  updateState = 'downloading';
  updateModalMessageEl.textContent = 'Загрузка обновления…';
  updateProgressWrapEl.classList.remove('hidden');
  updateProgressFillEl.style.width = '0%';
  updateProgressLabelEl.textContent = '0%';
  updateActionBtn.disabled = true;
  updateActionBtn.textContent = 'Загрузка…';
  updateLaterBtn.classList.add('hidden');
}

function showUpdateDownloaded(info) {
  updateState = 'downloaded';
  updateModalMessageEl.textContent = `Обновление ${info.version} загружено и готово к установке.`;
  updateProgressWrapEl.classList.add('hidden');
  updateActionBtn.disabled = false;
  updateActionBtn.textContent = 'Перезапустить и установить';
  updateLaterBtn.classList.remove('hidden');
  updateLaterBtn.textContent = 'Позже';
  updateModal.classList.remove('hidden');
}

updateActionBtn.addEventListener('click', () => {
  if (updateState === 'available') {
    window.api.startUpdateDownload();
    showUpdateDownloading();
  } else if (updateState === 'downloaded') {
    window.api.quitAndInstall();
  }
});

updateLaterBtn.addEventListener('click', () => {
  updateModal.classList.add('hidden');
});

window.api.onUpdateAvailable((info) => showUpdateAvailable(info));
window.api.onUpdateDownloadProgress((p) => {
  const pct = Math.round(p.percent || 0);
  updateProgressFillEl.style.width = `${pct}%`;
  updateProgressLabelEl.textContent = `${pct}%`;
});
window.api.onUpdateDownloaded((info) => showUpdateDownloaded(info));
window.api.onUpdateNotAvailable(() => showToast('У вас уже установлена последняя версия.'));
window.api.onUpdateError((err) => showToast(`Не удалось проверить обновления: ${(err && err.message) || 'ошибка сети'}`));

document.getElementById('btnCheckUpdate').addEventListener('click', () => {
  window.api.checkForUpdates(true);
  showToast('Проверка обновлений…');
});

document.getElementById('settingsCheckUpdateBtn').addEventListener('click', () => {
  closeSettingsModal();
  window.api.checkForUpdates(true);
  showToast('Проверка обновлений…');
});

async function initAppVersion() {
  try {
    const version = await window.api.getAppVersion();
    settingsVersionTextEl.textContent = `Литера · версия ${version}`;
  } catch (e) {}
}

// ---- Автосохранение ----

function restartAutosaveTimer() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  if (!settings.autosaveEnabled) return;
  const intervalMs = Math.max(5, settings.autosaveIntervalSec) * 1000;
  autosaveTimer = setInterval(runAutosave, intervalMs);
}

function scheduleAutosave() {
  if (!settings || !settings.autosaveEnabled) return;
  clearTimeout(debounceAutosaveTimer);
  debounceAutosaveTimer = setTimeout(runAutosave, 2000);
}

async function runAutosave() {
  captureActiveTabFromDOM();
  const dirtyTabs = tabs.filter((t) => t.isDirty);
  if (dirtyTabs.length === 0) return;
  let changed = false;
  for (const t of dirtyTabs) {
    const html = t.id === activeTabId ? editor.innerHTML : t.bodyHtml;
    if (settings.defaultSaveFolder) {
      const res = await window.api.saveFile(t.filePath, html, displayName(t));
      if (res) {
        t.filePath = res.path;
        t.fileName = res.name;
        t.isDirty = false;
        window.api.clearRecovery(t.recoveryId);
        if (t.id === activeTabId) {
          setDirtyUI(false);
          updateWindowTitle();
        }
        changed = true;
      }
    } else {
      window.api.autosaveTab({
        recoveryId: t.recoveryId,
        filePath: t.filePath,
        fileName: t.fileName,
        titleText: t.titleText,
        html,
      });
    }
  }
  if (changed) {
    renderTabBar();
    renderRecentList();
  }
}

// ---- Статистика ----

const toolsWordCountEl = document.getElementById('toolsWordCount');
const toolsCharCountEl = document.getElementById('toolsCharCount');
const toolsReadingMinutesEl = document.getElementById('toolsReadingMinutes');

function updateStats() {
  const text = editor.innerText || '';
  const words = text.trim().length ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  statsEl.textContent = `Слов: ${words} · Символов: ${chars}`;
  toolsWordCountEl.textContent = words;
  toolsCharCountEl.textContent = chars;
  toolsReadingMinutesEl.textContent = Math.max(1, Math.round(words / 200));
}

editor.addEventListener('input', () => {
  markActiveDirty();
  updateStats();
  computeOutline();
  scheduleAutosave();
});

docTitle.addEventListener('input', () => {
  markActiveDirty();
  const tab = getActiveTab();
  if (tab) {
    tab.titleText = docTitle.textContent;
    updateDisplayName(tab);
    updateActiveTabPillName();
    updateWindowTitle();
  }
  scheduleAutosave();
});

// ---- Оглавление ----

const outlineListEl = document.getElementById('outlineList');
const outlineEmptyEl = document.getElementById('outlineEmpty');

function computeOutline() {
  const heads = Array.from(editor.querySelectorAll('h1, h2, h3'));
  outlineListEl.innerHTML = '';
  outlineEmptyEl.classList.toggle('hidden', heads.length > 0);
  heads.forEach((h) => {
    const level = parseInt(h.tagName.slice(1), 10);
    const item = document.createElement('div');
    item.className = 'outline-item';
    item.dataset.level = String(level);
    item.textContent = h.textContent || '(без текста)';
    item.addEventListener('click', () => scrollToHeading(h));
    outlineListEl.appendChild(item);
  });
}

function scrollToHeading(el) {
  let top = 0;
  let node = el;
  while (node && node !== pageScrollEl) {
    top += node.offsetTop || 0;
    node = node.offsetParent;
  }
  pageScrollEl.scrollTo({ top: Math.max(0, top - 100), behavior: 'smooth' });
}

// ---- Боковая панель: сворачивание ----

const sidebarEl = document.getElementById('sidebar');
document.getElementById('sidebarCollapseBtn').addEventListener('click', () => sidebarEl.classList.add('collapsed'));
document.getElementById('sidebarExpandBtn').addEventListener('click', () => sidebarEl.classList.remove('collapsed'));

// ---- Боковая панель: недавние файлы ----

const recentListEl = document.getElementById('recentList');
const recentEmptyEl = document.getElementById('recentEmpty');
const recentSearchEl = document.getElementById('recentSearch');
let recentFilesCache = [];

function basename(p) {
  return p.split(/[\\/]/).pop();
}

function renderRecentList() {
  const q = recentSearchEl.value.trim().toLowerCase();
  const filtered = q ? recentFilesCache.filter((p) => basename(p).toLowerCase().includes(q)) : recentFilesCache;
  const activeTab = getActiveTab();
  recentListEl.innerHTML = '';
  recentEmptyEl.classList.toggle('hidden', filtered.length > 0);
  filtered.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.title = p;
    if (activeTab && p === activeTab.filePath) item.classList.add('active');
    const title = document.createElement('div');
    title.className = 'recent-item-title';
    title.textContent = basename(p);
    item.appendChild(title);
    item.addEventListener('click', () => openPath(p));
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.api.showRecentItemMenu(p);
    });
    recentListEl.appendChild(item);
  });
}

async function refreshRecentFiles() {
  recentFilesCache = await window.api.getRecentFiles();
  renderRecentList();
}

recentSearchEl.addEventListener('input', renderRecentList);
window.api.onRecentFilesChanged(refreshRecentFiles);
window.api.onOpenRecentPath((p) => openPath(p));

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
    markActiveDirty();
    scheduleAutosave();
  });
});

const fontNameSelectEl = document.getElementById('fontName');
// Native <select>/<input> controls steal focus and can drop the editor's
// selection before the "change" event fires, so we must capture the range
// on mousedown/focus and restore it explicitly — same pattern as modals.
fontNameSelectEl.addEventListener('mousedown', saveSelection);
fontNameSelectEl.addEventListener('change', (e) => {
  restoreSelection();
  document.execCommand('fontName', false, e.target.value);
  markActiveDirty();
  scheduleAutosave();
});

function setFontSizePx(px) {
  restoreSelection();
  document.execCommand('fontSize', false, '7');
  Array.from(editor.querySelectorAll('font[size="7"]')).forEach((el) => {
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;
    while (el.firstChild) span.appendChild(el.firstChild);
    el.replaceWith(span);
  });
  markActiveDirty();
  updateStats();
  scheduleAutosave();
}

const fontSizeInputEl = document.getElementById('fontSize');
fontSizeInputEl.addEventListener('focus', saveSelection);
fontSizeInputEl.addEventListener('change', (e) => {
  const px = Math.max(1, Math.min(400, parseInt(e.target.value, 10) || 12));
  e.target.value = px;
  setFontSizePx(px);
});

const blockFormatEl = document.getElementById('blockFormat');
blockFormatEl.addEventListener('mousedown', saveSelection);
blockFormatEl.addEventListener('change', (e) => {
  restoreSelection();
  document.execCommand('formatBlock', false, e.target.value);
  markActiveDirty();
  scheduleAutosave();
});

// ---- Палитра цветов (текст / выделение) ----

const PALETTE = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
];

let lastHiliteColor = document.getElementById('hiliteColorCustomInput').value;

function buildColorGrid(container, onPick) {
  PALETTE.forEach((row) => {
    row.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch';
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => onPick(c));
      container.appendChild(sw);
    });
  });
}

const foreColorDropdown = document.getElementById('foreColorDropdown');
const hiliteColorDropdown = document.getElementById('hiliteColorDropdown');

function closeColorDropdowns() {
  foreColorDropdown.classList.add('hidden');
  hiliteColorDropdown.classList.add('hidden');
}

function applyForeColor(c) {
  editor.focus();
  document.execCommand('foreColor', false, c);
  document.getElementById('foreColorBar').style.background = c;
  markActiveDirty();
  scheduleAutosave();
}

function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return '';
  return `rgb(${parseInt(m[0], 16)}, ${parseInt(m[1], 16)}, ${parseInt(m[2], 16)})`;
}

function currentHiliteColor() {
  try {
    const v = document.queryCommandValue('hiliteColor');
    if (v) return v;
  } catch (e) {}
  try {
    return document.queryCommandValue('backColor') || '';
  } catch (e) {
    return '';
  }
}

function applyHiliteColor(c) {
  editor.focus();
  const current = currentHiliteColor().replace(/\s+/g, '');
  const target = current && current === hexToRgb(c).replace(/\s+/g, '') ? 'transparent' : c;
  document.execCommand('hiliteColor', false, target);
  if (target !== 'transparent') {
    lastHiliteColor = c;
    document.getElementById('hiliteColorBar').style.background = c;
  }
  markActiveDirty();
  scheduleAutosave();
}

buildColorGrid(document.getElementById('foreColorGrid'), applyForeColor);
buildColorGrid(document.getElementById('hiliteColorGrid'), applyHiliteColor);

document.getElementById('foreColorTrigger').addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = foreColorDropdown.classList.contains('hidden');
  closeColorDropdowns();
  if (willOpen) foreColorDropdown.classList.remove('hidden');
});

document.getElementById('hiliteColorTrigger').addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = hiliteColorDropdown.classList.contains('hidden');
  closeColorDropdowns();
  if (willOpen) hiliteColorDropdown.classList.remove('hidden');
});

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('[data-color-wrap]')) closeColorDropdowns();
});

document.getElementById('foreColorCustomInput').addEventListener('input', (e) => {
  applyForeColor(e.target.value);
  closeColorDropdowns();
});
document.getElementById('hiliteColorCustomInput').addEventListener('input', (e) => {
  applyHiliteColor(e.target.value);
  closeColorDropdowns();
});

document.getElementById('bubbleHiliteBtn').addEventListener('click', () => {
  editor.focus();
  document.execCommand('hiliteColor', false, lastHiliteColor);
  markActiveDirty();
  scheduleAutosave();
});

// ---- Вкладка «Правка»: отменить/повторить/вырезать/копировать/вставить ----

document.getElementById('btnUndo').addEventListener('click', () => {
  editor.focus();
  document.execCommand('undo');
});

document.getElementById('btnRedo').addEventListener('click', () => {
  editor.focus();
  document.execCommand('redo');
});

document.getElementById('btnCut').addEventListener('click', () => {
  editor.focus();
  document.execCommand('cut');
  markActiveDirty();
  scheduleAutosave();
});

document.getElementById('btnCopy').addEventListener('click', () => {
  editor.focus();
  document.execCommand('copy');
});

document.getElementById('btnPasteEdit').addEventListener('click', async () => {
  editor.focus();
  try {
    const text = await navigator.clipboard.readText();
    if (text) document.execCommand('insertText', false, text);
  } catch (e) {
    try { document.execCommand('paste'); } catch (e2) {}
  }
  markActiveDirty();
  scheduleAutosave();
});

document.getElementById('btnClearFormatEdit').addEventListener('click', () => {
  editor.focus();
  document.execCommand('removeFormat');
  markActiveDirty();
  scheduleAutosave();
});

function applyFontControlsFromNode(node, useCommandValue) {
  if (!node) return;
  const fontNameSelect = document.getElementById('fontName');
  const fontSizeInput = document.getElementById('fontSize');
  const computed = window.getComputedStyle(node);

  let clean = '';
  if (useCommandValue) {
    try {
      const fn = document.queryCommandValue('fontName');
      clean = (fn || '').replace(/^["']|["']$/g, '').split(',')[0].trim();
    } catch (e) {}
  }
  // queryCommandValue возвращает пустую строку, если к тексту ни разу не
  // применяли execCommand('fontName') явно (свежий текст, загруженный файл) —
  // в этом случае берём реально отображаемый шрифт из вычисленного стиля.
  if (!clean) {
    clean = (computed.fontFamily || '').split(',')[0].replace(/^["']|["']$/g, '').trim();
  }
  if (clean && [...fontNameSelect.options].some((o) => o.value.toLowerCase() === clean.toLowerCase())) {
    fontNameSelect.value = clean;
  }

  const size = parseInt(computed.fontSize, 10);
  if (size) fontSizeInput.value = size;
}

function syncFontControls() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  let node = sel.anchorNode;
  if (!node || !editor.contains(node)) return;
  if (node.nodeType === 3) node = node.parentElement;
  if (!node) return;
  applyFontControlsFromNode(node, true);
}

function updateToolbarState() {
  document.querySelectorAll('[data-cmd]').forEach((btn) => {
    try {
      const active = document.queryCommandState(btn.dataset.cmd);
      btn.classList.toggle('active', active);
    } catch (e) {}
  });
  syncFontControls();
}

editor.addEventListener('keyup', updateToolbarState);
editor.addEventListener('mouseup', updateToolbarState);

// ---- Плавающая панель форматирования при выделении ----

const bubbleToolbar = document.getElementById('bubbleToolbar');

function updateBubbleToolbar() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    bubbleToolbar.classList.add('hidden');
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    bubbleToolbar.classList.add('hidden');
    return;
  }
  bubbleToolbar.style.top = `${rect.top - 10}px`;
  bubbleToolbar.style.left = `${rect.left + rect.width / 2}px`;
  bubbleToolbar.classList.remove('hidden');
  updateToolbarState();
}

document.addEventListener('selectionchange', updateBubbleToolbar);

// ---- Тема ----

const themeToggle = document.getElementById('themeToggle');

function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  themeToggle.checked = dark;
}

themeToggle.addEventListener('change', async () => {
  const dark = themeToggle.checked;
  applyTheme(dark);
  settings = await window.api.saveSettings({ theme: dark ? 'dark' : 'light' });
});

window.api.onApplyTheme((theme) => applyTheme(theme === 'dark'));

// ---- Настройки ----

const settingsModal = document.getElementById('settingsModal');
const settingsThemeEl = document.getElementById('settingsTheme');
const settingsFontNameEl = document.getElementById('settingsFontName');
const settingsFontSizeEl = document.getElementById('settingsFontSize');
const settingsAutosaveEnabledEl = document.getElementById('settingsAutosaveEnabled');
const settingsAutosaveIntervalEl = document.getElementById('settingsAutosaveInterval');
const settingsSpellRuEl = document.getElementById('settingsSpellRu');
const settingsSpellEnEl = document.getElementById('settingsSpellEn');
const settingsSaveFormatEl = document.getElementById('settingsSaveFormat');
const settingsFolderPathEl = document.getElementById('settingsFolderPath');
const settingsChooseFolderBtn = document.getElementById('settingsChooseFolderBtn');
let pendingDefaultFolder = '';

function updateFolderPathDisplay() {
  settingsFolderPathEl.textContent = pendingDefaultFolder || 'Не выбрана';
  settingsFolderPathEl.title = pendingDefaultFolder || '';
}

settingsChooseFolderBtn.addEventListener('click', async () => {
  const folder = await window.api.chooseFolder();
  if (folder) {
    pendingDefaultFolder = folder;
    updateFolderPathDisplay();
  }
});

function openSettingsModal() {
  settingsThemeEl.value = settings.theme;
  settingsFontNameEl.value = settings.defaultFontName;
  settingsFontSizeEl.value = settings.defaultFontSize;
  settingsAutosaveEnabledEl.checked = settings.autosaveEnabled;
  settingsAutosaveIntervalEl.value = settings.autosaveIntervalSec;
  settingsSpellRuEl.checked = settings.spellcheckRu;
  settingsSpellEnEl.checked = settings.spellcheckEn;
  settingsSaveFormatEl.value = settings.defaultSaveFormat;
  pendingDefaultFolder = settings.defaultSaveFolder || '';
  updateFolderPathDisplay();
  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
document.getElementById('settingsCancelBtn').addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('mousedown', (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
  const next = {
    theme: settingsThemeEl.value,
    defaultFontName: settingsFontNameEl.value,
    defaultFontSize: Math.max(1, Math.min(400, parseInt(settingsFontSizeEl.value, 10) || 12)),
    autosaveEnabled: settingsAutosaveEnabledEl.checked,
    autosaveIntervalSec: Math.max(5, Math.min(600, parseInt(settingsAutosaveIntervalEl.value, 10) || 20)),
    spellcheckRu: settingsSpellRuEl.checked,
    spellcheckEn: settingsSpellEnEl.checked,
    defaultSaveFormat: settingsSaveFormatEl.value,
    defaultSaveFolder: pendingDefaultFolder,
  };
  settings = await window.api.saveSettings(next);
  applyTheme(settings.theme === 'dark');
  restartAutosaveTimer();
  closeSettingsModal();
  showToast('Настройки сохранены.');
});

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
  markActiveDirty();
  scheduleAutosave();
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

window.api.onTriggerInsertLink(() => document.getElementById('btnLink').click());

linkCancelBtn.addEventListener('click', () => closeModal(linkModal));

linkOkBtn.addEventListener('click', () => {
  const url = linkUrlInput.value.trim();
  closeModal(linkModal);
  if (!url) return;
  restoreSelection();
  document.execCommand('createLink', false, url);
  markActiveDirty();
  scheduleAutosave();
});

// ---- Вставка: изображение, линия ----

document.getElementById('btnImage').addEventListener('click', async () => {
  saveSelection();
  const dataUrl = await window.api.insertImageDialog();
  if (!dataUrl) return;
  restoreSelection();
  document.execCommand('insertHTML', false, `<img src="${dataUrl}" />`);
  markActiveDirty();
  scheduleAutosave();
});

document.getElementById('btnHr').addEventListener('click', () => {
  editor.focus();
  document.execCommand('insertHorizontalRule', false, null);
  markActiveDirty();
  scheduleAutosave();
});

// ---- Файловые операции ----

function openLoadedFileAsTab(res) {
  captureActiveTabFromDOM();
  const tab = createTab({
    filePath: res.path,
    fileName: res.name,
    titleText: titleFromFileName(res.name),
    bodyHtml: res.html,
  });
  activeTabId = tab.id;
  loadTabIntoDOM(tab);
  renderTabBar();
  renderRecentList();
  updateWindowTitle();
}

async function openFile() {
  const res = await window.api.openFile();
  if (!res) return;
  const existing = tabs.find((t) => t.filePath === res.path);
  if (existing) {
    switchToTab(existing.id);
    return;
  }
  openLoadedFileAsTab(res);
}

async function openPath(p) {
  const existing = tabs.find((t) => t.filePath === p);
  if (existing) {
    switchToTab(existing.id);
    return;
  }
  const res = await window.api.openPath(p);
  if (!res) return;
  openLoadedFileAsTab(res);
}

const saveFolderPromptModal = document.getElementById('saveFolderPromptModal');
const saveFolderSkipBtn = document.getElementById('saveFolderSkipBtn');
const saveFolderChooseBtn = document.getElementById('saveFolderChooseBtn');

function showSaveFolderPromptModal() {
  return new Promise((resolve) => {
    saveFolderPromptModal.classList.remove('hidden');
    function cleanup(result) {
      saveFolderPromptModal.classList.add('hidden');
      saveFolderSkipBtn.removeEventListener('click', onSkip);
      saveFolderChooseBtn.removeEventListener('click', onChoose);
      resolve(result);
    }
    function onSkip() { cleanup(false); }
    function onChoose() { cleanup(true); }
    saveFolderSkipBtn.addEventListener('click', onSkip);
    saveFolderChooseBtn.addEventListener('click', onChoose);
  });
}

async function ensureDefaultSaveFolder() {
  if (settings.defaultSaveFolder || settings.askedSaveFolder) return;
  const wantsToChoose = await showSaveFolderPromptModal();
  if (wantsToChoose) {
    const folder = await window.api.chooseFolder();
    if (folder) {
      settings = await window.api.saveSettings({ defaultSaveFolder: folder, askedSaveFolder: true });
      showToast('Папка по умолчанию установлена.');
      return;
    }
  }
  settings = await window.api.saveSettings({ askedSaveFolder: true });
}

async function saveActiveTab() {
  const tab = getActiveTab();
  if (!tab) return false;
  if (!tab.filePath) await ensureDefaultSaveFolder();
  captureActiveTabFromDOM();
  const suggestedName = displayName(tab);
  const res = await window.api.saveFile(tab.filePath, tab.bodyHtml, suggestedName);
  if (!res) return false;
  tab.filePath = res.path;
  tab.fileName = res.name;
  tab.titleText = titleFromFileName(res.name);
  tab.isDirty = false;
  window.api.clearRecovery(tab.recoveryId);
  docTitle.textContent = tab.titleText;
  updateDisplayName(tab);
  setDirtyUI(false);
  renderTabBar();
  renderRecentList();
  updateWindowTitle();
  return true;
}

async function saveActiveTabAs() {
  const tab = getActiveTab();
  if (!tab) return false;
  captureActiveTabFromDOM();
  const suggestedName = displayName(tab);
  const res = await window.api.saveAsDialog(tab.bodyHtml, suggestedName);
  if (!res) return false;
  tab.filePath = res.path;
  tab.fileName = res.name;
  tab.titleText = titleFromFileName(res.name);
  tab.isDirty = false;
  window.api.clearRecovery(tab.recoveryId);
  docTitle.textContent = tab.titleText;
  updateDisplayName(tab);
  setDirtyUI(false);
  renderTabBar();
  renderRecentList();
  updateWindowTitle();
  return true;
}

async function exportPdf() {
  await window.api.exportPdf(combinedContent());
}

async function exportDocx() {
  await window.api.exportDocx(combinedContent());
}

document.getElementById('btnNewTab').addEventListener('click', newTab);
document.getElementById('btnOpen').addEventListener('click', openFile);
document.getElementById('btnSave').addEventListener('click', saveActiveTab);
document.getElementById('btnSaveAs').addEventListener('click', saveActiveTabAs);
document.getElementById('btnExportPdf').addEventListener('click', exportPdf);
document.getElementById('btnExportDocx').addEventListener('click', exportDocx);
document.getElementById('btnPrint').addEventListener('click', () => window.api.print());

// ---- Поиск и замена ----

const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const replaceInput = document.getElementById('replaceInput');
const matchLabelEl = document.getElementById('matchLabel');
const findToggleBtn = document.getElementById('findToggleBtn');
const findToggleBtn2 = document.getElementById('findToggleBtn2');
const findToggleBtn3 = document.getElementById('findToggleBtn3');
const findToggleBtnEdit = document.getElementById('findToggleBtnEdit');

function setFindActive(active) {
  findToggleBtn.classList.toggle('active', active);
  findToggleBtn2.classList.toggle('active', active);
  findToggleBtn3.classList.toggle('active', active);
  findToggleBtnEdit.classList.toggle('active', active);
}

function openFindBar() {
  findBar.classList.remove('hidden');
  setFindActive(true);
  findInput.focus();
}

function closeFindBar() {
  findBar.classList.add('hidden');
  setFindActive(false);
}

function toggleFindBar() {
  if (findBar.classList.contains('hidden')) openFindBar();
  else closeFindBar();
}

function countMatches() {
  const term = findInput.value;
  if (!term) return 0;
  const text = editor.textContent || '';
  return text.split(term).length - 1;
}

function updateMatchLabel() {
  matchLabelEl.textContent = findInput.value ? `${countMatches()} совпадений` : '';
}

findToggleBtn.addEventListener('click', toggleFindBar);
findToggleBtn2.addEventListener('click', toggleFindBar);
findToggleBtn3.addEventListener('click', toggleFindBar);
findToggleBtnEdit.addEventListener('click', toggleFindBar);
document.getElementById('closeFindBtn').addEventListener('click', closeFindBar);
findInput.addEventListener('input', updateMatchLabel);

document.getElementById('findNextBtn').addEventListener('click', () => {
  const term = findInput.value;
  if (!term) return;
  const found = window.find(term);
  updateMatchLabel();
  if (!found) showToast('Совпадений больше нет.');
});

document.getElementById('replaceBtn').addEventListener('click', () => {
  const sel = window.getSelection();
  if (sel.rangeCount > 0 && sel.toString().toLowerCase() === findInput.value.toLowerCase()) {
    document.execCommand('insertText', false, replaceInput.value);
    markActiveDirty();
  }
  document.getElementById('findNextBtn').click();
});

document.getElementById('replaceAllBtn').addEventListener('click', () => {
  const term = findInput.value;
  const repl = replaceInput.value;
  if (!term) return;
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  editor.innerHTML = editor.innerHTML.replace(regex, repl);
  markActiveDirty();
  updateStats();
  computeOutline();
  updateMatchLabel();
  scheduleAutosave();
});

// ---- Горячие клавиши (нативного меню больше нет) ----

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && !e.shiftKey && key === 'n') { e.preventDefault(); newTab(); return; }
  if (mod && key === 'o') { e.preventDefault(); openFile(); return; }
  if (mod && e.shiftKey && key === 's') { e.preventDefault(); saveActiveTabAs(); return; }
  if (mod && key === 's') { e.preventDefault(); saveActiveTab(); return; }
  if (mod && key === 'p') { e.preventDefault(); window.api.print(); return; }
  if (mod && key === 'w') { e.preventDefault(); closeTab(activeTabId); return; }
  if (mod && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); cycleTab(1); return; }
  if (mod && e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleTab(-1); return; }
  if (mod && /^[1-9]$/.test(e.key)) { e.preventDefault(); jumpToTab(parseInt(e.key, 10)); return; }
  if (mod && key === 'f') { e.preventDefault(); openFindBar(); return; }
  if (mod && key === 'k') { e.preventDefault(); document.getElementById('btnLink').click(); return; }
  if (mod && e.key === '\\') { e.preventDefault(); editor.focus(); document.execCommand('removeFormat'); markActiveDirty(); scheduleAutosave(); return; }
  if (mod && e.shiftKey && key === 'i') { e.preventDefault(); window.api.toggleDevTools(); return; }
  if (e.key === 'F12') { e.preventDefault(); window.api.toggleDevTools(); return; }
  if (e.key === 'F11') { e.preventDefault(); window.api.toggleFullscreen(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); window.api.zoomIn(); return; }
  if (mod && e.key === '-') { e.preventDefault(); window.api.zoomOut(); return; }
  if (mod && e.key === '0') { e.preventDefault(); window.api.zoomReset(); return; }
  if (e.key === 'Escape') { closeFindBar(); return; }
});

// ---- Инициализация ----

async function init() {
  settings = await window.api.getSettings();
  applyTheme(settings.theme === 'dark');
  initAppVersion();

  const recoveries = await window.api.listRecoveries();
  if (recoveries.length > 0) {
    const restore = await showRecoveryModal(recoveries.length);
    if (restore) {
      recoveries.forEach((r) => {
        createTab({
          filePath: r.filePath || null,
          fileName: r.fileName || 'Без имени',
          titleText: r.titleText || titleFromFileName(r.fileName || ''),
          bodyHtml: r.html || '',
          isDirty: true,
          recoveryId: r.recoveryId,
        });
      });
      activeTabId = tabs[0].id;
      loadTabIntoDOM(tabs[0]);
    } else {
      recoveries.forEach((r) => window.api.clearRecovery(r.recoveryId));
      newTab();
    }
  } else {
    newTab();
  }

  renderTabBar();
  refreshRecentFiles();
  updateWindowTitle();
  restartAutosaveTimer();
  editor.focus();
}

init();
