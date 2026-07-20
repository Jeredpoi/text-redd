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

// Символы нулевой ширины (U+200B) — служебные якоря для «шрифта нового
// текста» (см. insertTypingStyleSpan); в сохранённый файл попадать не должны.
function stripZeroWidth(html) {
  return (html || '').replace(/\u200B/g, '');
}

function combinedContent() {
  return stripZeroWidth(editor.innerHTML);
}

function combinedContentOf(tab) {
  if (tab.id === activeTabId) captureActiveTabFromDOM();
  return stripZeroWidth(tab.bodyHtml || '');
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
  updateStartScreenVisibility();
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
  // Размеры считаем в пунктах, как в Word: 12 пт = 16 px
  editor.style.fontSize = `${settings.defaultFontSize || 12}pt`;
  setFontNameEverywhere(settings.defaultFontName);
  document.getElementById('fontSize').value = settings.defaultFontSize || 12;
  document.getElementById('bubbleFontSize').value = settings.defaultFontSize || 12;
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

// ---- История версий документа ----

const historyModal = document.getElementById('historyModal');
const historyListEl = document.getElementById('historyList');
const historyEmptyMsgEl = document.getElementById('historyEmptyMsg');

async function openHistoryModal() {
  const tab = getActiveTab();
  historyListEl.innerHTML = '';
  const versions = tab && tab.filePath ? await window.api.listVersions(tab.filePath) : [];
  historyEmptyMsgEl.classList.toggle('hidden', versions.length > 0);
  versions.forEach((ts) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const when = new Date(ts).toLocaleString('ru-RU', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    item.innerHTML = `<span>${when}</span><button class="btn-secondary" type="button">Восстановить</button>`;
    item.querySelector('button').addEventListener('click', async () => {
      const html = await window.api.readVersion(tab.filePath, ts);
      if (html === null) {
        showToast('Не удалось прочитать эту версию.');
        return;
      }
      editor.innerHTML = html;
      tab.bodyHtml = html;
      markActiveDirty();
      updateStats();
      computeOutline();
      historyModal.classList.add('hidden');
      showToast('Версия восстановлена — не забудьте сохранить (Ctrl+S).');
    });
    historyListEl.appendChild(item);
  });
  historyModal.classList.remove('hidden');
}

document.getElementById('btnHistory').addEventListener('click', openHistoryModal);
document.getElementById('historyCloseBtn').addEventListener('click', () => historyModal.classList.add('hidden'));
historyModal.addEventListener('mousedown', (e) => {
  if (e.target === historyModal) historyModal.classList.add('hidden');
});

// ---- Приветственная презентация (только при самом первом запуске) ----

const ONBOARDING_SLIDES = [
  {
    icon: '👋',
    title: 'Добро пожаловать в Литеру!',
    text: 'Красивый и быстрый текстовый редактор. Покажем, что здесь есть — это займёт полминуты.',
  },
  {
    icon: '🗂',
    title: 'Вкладки и стартовый экран',
    text: 'Работайте с несколькими документами во вкладках, как в браузере: перетаскивание, средний клик, Ctrl+Tab. Новая вкладка (Ctrl+N) открывает стартовый экран с шаблонами и недавними файлами.',
  },
  {
    icon: '✍️',
    title: 'Форматирование как в Word',
    text: 'Лента с пятью вкладками: шрифты, цвета с палитрой и пипеткой, чек-листы, таблицы (правый клик по ячейке — редактирование). Выделите текст — появится мини-панель форматирования.',
  },
  {
    icon: '💾',
    title: 'Сохранение и автосохранение',
    text: 'Заголовок документа — это имя файла. Сохраняйте в Word (.docx), TXT или HTML, экспортируйте в PDF. Автосохранение бережёт работу, а после сбоя Литера предложит всё восстановить.',
  },
  {
    icon: '🌙',
    title: 'Мелочи, которые приятно',
    text: 'Тёмная и светлая тема, режим фокуса (F9), масштаб в статус-баре, проверка орфографии на русском и английском, поиск и замена (Ctrl+F).',
  },
  {
    icon: '🚀',
    title: 'Всегда свежая версия',
    text: 'Литера сама проверяет обновления и предлагает установить их в один клик. Готово — приятной работы!',
  },
];

const onboardingModal = document.getElementById('onboardingModal');
const onboardingHeroEl = document.getElementById('onboardingHero');
const onboardingTitleEl = document.getElementById('onboardingTitle');
const onboardingTextEl = document.getElementById('onboardingText');
const onboardingDotsEl = document.getElementById('onboardingDots');
const onboardingPrevBtn = document.getElementById('onboardingPrevBtn');
const onboardingNextBtn = document.getElementById('onboardingNextBtn');
const onboardingSkipBtn = document.getElementById('onboardingSkipBtn');

let onboardingIdx = 0;

function renderOnboardingSlide() {
  const slide = ONBOARDING_SLIDES[onboardingIdx];
  onboardingHeroEl.textContent = slide.icon;
  onboardingTitleEl.textContent = slide.title;
  onboardingTextEl.textContent = slide.text;
  onboardingDotsEl.innerHTML = '';
  ONBOARDING_SLIDES.forEach((s, i) => {
    const dot = document.createElement('span');
    dot.className = 'onboarding-dot' + (i === onboardingIdx ? ' active' : '');
    dot.addEventListener('click', () => { onboardingIdx = i; renderOnboardingSlide(); });
    onboardingDotsEl.appendChild(dot);
  });
  onboardingPrevBtn.style.visibility = onboardingIdx === 0 ? 'hidden' : 'visible';
  onboardingNextBtn.textContent = onboardingIdx === ONBOARDING_SLIDES.length - 1 ? 'Начать работу' : 'Далее';
}

async function closeOnboarding() {
  onboardingModal.classList.add('hidden');
  if (!settings.onboardingShown) {
    settings = await window.api.saveSettings({ onboardingShown: true });
  }
}

function showOnboarding() {
  onboardingIdx = 0;
  renderOnboardingSlide();
  onboardingModal.classList.remove('hidden');
}

onboardingNextBtn.addEventListener('click', () => {
  if (onboardingIdx === ONBOARDING_SLIDES.length - 1) {
    closeOnboarding();
  } else {
    onboardingIdx += 1;
    renderOnboardingSlide();
  }
});

onboardingPrevBtn.addEventListener('click', () => {
  if (onboardingIdx > 0) {
    onboardingIdx -= 1;
    renderOnboardingSlide();
  }
});

onboardingSkipBtn.addEventListener('click', closeOnboarding);

document.getElementById('settingsOnboardingBtn').addEventListener('click', () => {
  closeSettingsModal();
  showOnboarding();
});

// ---- Автообновление ----

const updateModal = document.getElementById('updateModal');
const updateModalMessageEl = document.getElementById('updateModalMessage');
const updateProgressWrapEl = document.getElementById('updateProgressWrap');
const updateProgressFillEl = document.getElementById('updateProgressFill');
const updateProgressLabelEl = document.getElementById('updateProgressLabel');
const updateLaterBtn = document.getElementById('updateLaterBtn');
const updateActionBtn = document.getElementById('updateActionBtn');
const updateReleaseNotesEl = document.getElementById('updateReleaseNotes');
const settingsVersionTextEl = document.getElementById('settingsVersionText');

let updateState = 'idle';

function showUpdateAvailable(info) {
  updateState = 'available';
  updateModalMessageEl.textContent = `Вышла новая версия ${info.version}. Скачать и установить сейчас?`;
  // Описание релиза с GitHub приходит как HTML — показываем только текст,
  // превращая границы блоков в переносы строк.
  const notesDiv = document.createElement('div');
  notesDiv.innerHTML = (info.releaseNotes || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, '\n');
  const notesText = (notesDiv.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  updateReleaseNotesEl.textContent = notesText;
  updateReleaseNotesEl.classList.toggle('hidden', !notesText);
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
  updateReleaseNotesEl.classList.add('hidden');
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
    const html = stripZeroWidth(t.id === activeTabId ? editor.innerHTML : t.bodyHtml);
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
  const minutes = Math.max(1, Math.round(words / 200));
  statsEl.textContent = words > 0
    ? `Слов: ${words} · Символов: ${chars} · ≈ ${minutes} мин чтения`
    : `Слов: ${words} · Символов: ${chars}`;
  toolsWordCountEl.textContent = words;
  toolsCharCountEl.textContent = chars;
  toolsReadingMinutesEl.textContent = minutes;
}

editor.addEventListener('input', () => {
  markActiveDirty();
  updateStats();
  computeOutline();
  scheduleAutosave();
  updateStartScreenVisibility();
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
  updateStartScreenVisibility();
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
  updateStartScreenVisibility();
}

recentSearchEl.addEventListener('input', renderRecentList);
window.api.onRecentFilesChanged(refreshRecentFiles);
window.api.onOpenRecentPath((p) => openPath(p));

// ---- Стартовый экран (шаблоны + недавние), как в Google Docs ----

const startScreenEl = document.getElementById('startScreen');
const startGreetingEl = document.getElementById('startGreeting');
const startTemplatesEl = document.getElementById('startTemplates');
const startRecentsEl = document.getElementById('startRecents');
const startRecentTitleEl = document.getElementById('startRecentTitle');
const pageEl = document.getElementById('page');

const TEMPLATES = [
  {
    id: 'blank', name: 'Пустой документ', icon: '＋', title: '', html: '',
  },
  {
    id: 'note', name: 'Заметка', icon: '📝', title: 'Заметка',
    html: '<p><i>' + new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + '</i></p><p><br></p><p>Запишите мысли здесь…</p>',
  },
  {
    id: 'letter', name: 'Письмо', icon: '✉️', title: 'Письмо',
    html: '<p>Здравствуйте, ____!</p><p><br></p><p>Пишу вам, чтобы…</p><p><br></p><p>С уважением,<br>____</p>',
  },
  {
    id: 'todo', name: 'Список дел', icon: '✅', title: 'Список дел',
    html: '<ul class="checklist"><li><input type="checkbox" contenteditable="false"> Первое дело</li><li><input type="checkbox" contenteditable="false"> Второе дело</li><li><input type="checkbox" contenteditable="false"> Третье дело</li></ul>',
  },
  {
    id: 'report', name: 'Отчёт', icon: '📊', title: 'Отчёт',
    html: '<h2>Итоги</h2><p>Кратко опишите главное…</p><h2>Подробности</h2><table><tbody><tr><td><b>Показатель</b></td><td><b>Значение</b></td></tr><tr><td></td><td></td></tr><tr><td></td><td></td></tr></tbody></table><h2>Выводы</h2><p><br></p>',
  },
];

function startGreetingText() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

function applyTemplate(tpl) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.startDismissed = true;
  docTitle.textContent = tpl.title;
  editor.innerHTML = tpl.html;
  tab.titleText = tpl.title;
  tab.bodyHtml = tpl.html;
  if (tpl.id !== 'blank') markActiveDirty();
  updateDisplayName(tab);
  updateActiveTabPillName();
  updateWindowTitle();
  updateStats();
  computeOutline();
  updateStartScreenVisibility(true);
  editor.focus();
}

function renderStartTemplates() {
  startTemplatesEl.innerHTML = '';
  TEMPLATES.forEach((tpl) => {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    card.innerHTML = `<div class="tpl-card-icon">${tpl.icon}</div><div class="tpl-card-name">${tpl.name}</div>`;
    card.addEventListener('click', () => applyTemplate(tpl));
    startTemplatesEl.appendChild(card);
  });
}

function renderStartRecents() {
  startRecentsEl.innerHTML = '';
  const list = recentFilesCache.slice(0, 8);
  startRecentTitleEl.classList.toggle('hidden', list.length === 0);
  list.forEach((p) => {
    const name = basename(p);
    const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase();
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.title = p;
    card.innerHTML = `<div class="recent-card-preview"><span class="recent-card-ext">${ext}</span></div><div class="recent-card-name">${name.replace(/\.[^.]+$/, '')}</div>`;
    card.addEventListener('click', () => openPath(p));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.api.showRecentItemMenu(p);
    });
    startRecentsEl.appendChild(card);
  });
}

function tabIsPristine(tab) {
  if (settings && settings.showStartScreen === false) return false;
  if (!tab || tab.filePath || tab.isDirty || tab.startDismissed) return false;
  if ((docTitle.textContent || '').trim() !== '') return false;
  if ((editor.textContent || '').trim() !== '') return false;
  if (editor.querySelector('img, table, hr, ul, ol')) return false;
  return true;
}

// Показывает стартовый экран на «чистой» вкладке, прячет при работе.
function updateStartScreenVisibility(forceHide) {
  const show = !forceHide && tabIsPristine(getActiveTab());
  if (show) {
    startGreetingEl.textContent = startGreetingText();
    renderStartRecents();
  }
  startScreenEl.classList.toggle('hidden', !show);
  pageEl.classList.toggle('hidden', show);
}

renderStartTemplates();

// ---- Масштаб (слайдер в статус-баре) ----

const zoomSliderEl = document.getElementById('zoomSlider');
const zoomLabelEl = document.getElementById('zoomLabel');
let currentZoomPct = 100;

function setZoomPct(pct) {
  currentZoomPct = Math.min(200, Math.max(50, Math.round(pct / 10) * 10));
  zoomSliderEl.value = currentZoomPct;
  zoomLabelEl.textContent = `${currentZoomPct}%`;
  window.api.setZoomFactor(currentZoomPct / 100);
}

zoomSliderEl.addEventListener('input', () => setZoomPct(parseInt(zoomSliderEl.value, 10)));
document.getElementById('zoomInBtn').addEventListener('click', () => setZoomPct(currentZoomPct + 10));
document.getElementById('zoomOutBtn').addEventListener('click', () => setZoomPct(currentZoomPct - 10));
zoomLabelEl.addEventListener('click', () => setZoomPct(100));

// ---- Режим фокуса ----

const focusExitBtn = document.getElementById('focusExitBtn');

function setFocusMode(on) {
  document.body.classList.toggle('focus-mode', on);
  focusExitBtn.classList.toggle('hidden', !on);
  if (on) editor.focus();
}

document.getElementById('btnFocusMode').addEventListener('click', () => setFocusMode(true));
focusExitBtn.addEventListener('click', () => setFocusMode(false));

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

// Native <select>/<input> controls steal focus, and Chromium's execCommand
// silently no-ops afterwards even once the selection is programmatically
// restored (verified empirically — restoring focus/selection is not enough).
// So for these controls we bypass execCommand and apply the style directly
// to the saved range by walking its text nodes and wrapping each in a span.
function applyInlineStyleToRange(range, applyStyle, tagName) {
  if (!range || range.collapsed) return false;
  const root = range.commonAncestorContainer.nodeType === 3
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  let applied = false;
  let firstSpan = null;
  let lastSpan = null;
  const spans = [];
  nodes.forEach((textNode) => {
    let start = 0;
    let end = textNode.length;
    if (textNode === range.startContainer) start = range.startOffset;
    if (textNode === range.endContainer) end = range.endOffset;
    if (start >= end) return;
    const full = textNode.textContent;
    const before = full.slice(0, start);
    const middle = full.slice(start, end);
    const after = full.slice(end);
    if (!middle) return;
    const span = document.createElement(tagName || 'span');
    applyStyle(span);
    span.textContent = middle;
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(span);
    if (after) frag.appendChild(document.createTextNode(after));
    textNode.parentNode.replaceChild(frag, textNode);
    applied = true;
    if (!firstSpan) firstSpan = span;
    lastSpan = span;
    spans.push(span);
  });
  // Раньше выделение после применения стиля пропадало (Range указывал на
  // уже удалённые текстовые узлы) — теперь явно переставляем его на новые
  // span'ы, чтобы выделение оставалось видимым, как в Word.
  if (applied) {
    const sel = window.getSelection();
    const newRange = document.createRange();
    newRange.setStart(firstSpan.firstChild, 0);
    newRange.setEnd(lastSpan.firstChild, lastSpan.firstChild.length);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
  return applied ? { firstSpan, lastSpan, spans } : false;
}

// Пока фокус живёт в поле поиска/размера комбобокса (иначе он бы «крал»
// фокус у выпадающего списка), нативное выделение браузера сворачивается —
// поэтому во время предпросмотра подсвечиваем сами span'ы вручную классом,
// имитируя вид выделения независимо от того, где сейчас фокус.
function markPreviewHighlight(spans) {
  clearPreviewHighlight();
  if (spans) spans.forEach((s) => s.classList.add('preview-highlight'));
}

function clearPreviewHighlight() {
  editor.querySelectorAll('.preview-highlight').forEach((el) => el.classList.remove('preview-highlight'));
}

// Когда выделения нет (просто мигает курсор), выделять нечего — вместо этого
// вставляем в позицию курсора пустой стилизованный span с символом нулевой
// ширины и ставим курсор внутрь: всё, что пользователь напечатает дальше,
// унаследует выбранный стиль (как «шрифт для нового текста» в Word).
function insertTypingStyleSpan(applyStyle) {
  editor.focus();
  const sel = window.getSelection();
  let range = null;
  if (savedRange) {
    range = savedRange.cloneRange();
  } else if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0).cloneRange();
  } else {
    range = document.createRange();
    range.selectNodeContents(editor);
  }
  range.collapse(false);
  const span = document.createElement('span');
  applyStyle(span);
  span.textContent = '\u200B';
  range.insertNode(span);
  const caret = document.createRange();
  caret.setStart(span.firstChild, 1);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
}

function applyTextStyle(applyStyle) {
  const applied = applyInlineStyleToRange(savedRange, applyStyle);
  if (!applied) {
    insertTypingStyleSpan(applyStyle);
  } else {
    editor.focus();
  }
  markActiveDirty();
  scheduleAutosave();
}

// ---- Предпросмотр при наведении (как в Word): наводишь на шрифт/размер в
// выпадающем списке — применяется сразу же к выделению, не наведёшь — при
// закрытии списка без выбора возвращается исходный текст. Реализовано через
// снимок editor.innerHTML на момент открытия списка + плоские текстовые
// смещения выделения (устойчивы к повторным откатам, в отличие от Range,
// который «умирает» при первой же замене узлов).

let previewBaselineHtml = null;
let previewOffsets = null;

function rangeToOffsets(range) {
  if (!range || range.collapsed) return null;
  const pre = document.createRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return end > start ? { start, end } : null;
}

function offsetsToRange(offsets) {
  if (!offsets) return null;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  let pos = 0;
  let startNode;
  let startOffset;
  let endNode;
  let endOffset;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (startNode === undefined && pos + len >= offsets.start) {
      startNode = node;
      startOffset = offsets.start - pos;
    }
    if (pos + len >= offsets.end) {
      endNode = node;
      endOffset = offsets.end - pos;
      break;
    }
    pos += len;
  }
  if (startNode === undefined || endNode === undefined) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function beginPreviewSession() {
  previewOffsets = rangeToOffsets(savedRange);
  previewBaselineHtml = previewOffsets ? editor.innerHTML : null;
}

// Chromium сам переносит фокус DOM на contenteditable, как только в него
// программно ставится Selection (побочный эффект applyInlineStyleToRange
// внутри showPreview) — из-за этого поле поиска шрифта теряло фокус после
// первого же наведения, и Escape/стрелки переставали до него доходить.
// Комбобокс, который сейчас открыт, регистрирует сюда, куда возвращать
// фокус после каждого предпросмотра.
let activeComboRefocusEl = null;
// И функцию закрытия — чтобы Escape работал даже если фокус улетел в
// редактор и обработчик keydown на самом поле поиска не сработает.
let openComboCloseFn = null;

function showPreview(applyStyle) {
  if (previewBaselineHtml === null || !previewOffsets) return;
  editor.innerHTML = previewBaselineHtml;
  const range = offsetsToRange(previewOffsets);
  let result = false;
  if (range) result = applyInlineStyleToRange(range, applyStyle);
  if (activeComboRefocusEl) activeComboRefocusEl.focus();
  markPreviewHighlight(result ? result.spans : null);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openComboCloseFn) {
    e.preventDefault();
    e.stopPropagation();
    const fn = openComboCloseFn;
    openComboCloseFn = null;
    fn();
    editor.focus();
  }
}, true);

function endPreviewSession(commitApplyStyle) {
  clearPreviewHighlight();
  if (previewBaselineHtml === null) {
    // Предпросмотра не было (курсор без выделения) — обычное применение
    // «стиль для нового текста».
    if (commitApplyStyle) applyTextStyle(commitApplyStyle);
    return;
  }
  editor.innerHTML = previewBaselineHtml;
  const range = offsetsToRange(previewOffsets);
  if (commitApplyStyle && range) {
    savedRange = range;
    applyTextStyle(commitApplyStyle);
  } else if (range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  previewBaselineHtml = null;
  previewOffsets = null;
}

// ---- Список шрифтов: сортировка по популярности + недавние ----

const RECENT_FONTS_KEY = 'litera-recent-fonts';
// Самые узнаваемые/часто используемые шрифты — сверху, как в Word.
const FONT_POPULARITY = [
  'Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Comic Sans MS',
  'Courier New', 'Trebuchet MS', 'Impact', 'Roboto', 'Open Sans', 'Montserrat',
  'Lora', 'Merriweather', 'PT Sans', 'PT Serif',
];

function loadRecentFonts() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_FONTS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function addRecentFont(name) {
  const list = [name, ...loadRecentFonts().filter((f) => f !== name)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(list));
  } catch (e) {}
}

function sortedFontNames(allNames) {
  const rank = new Map(FONT_POPULARITY.map((f, i) => [f, i]));
  return [...allNames].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : FONT_POPULARITY.length + allNames.indexOf(a);
    const rb = rank.has(b) ? rank.get(b) : FONT_POPULARITY.length + allNames.indexOf(b);
    return ra - rb;
  });
}

// ---- Универсальный кастомный выпадающий список для шрифта ----

function setupFontCombo({ selectId, triggerId, labelId, dropdownId, searchId, listId }) {
  const selectEl = document.getElementById(selectId);
  const triggerEl = document.getElementById(triggerId);
  const labelEl = document.getElementById(labelId);
  const dropdownEl = document.getElementById(dropdownId);
  const searchEl = document.getElementById(searchId);
  const listEl = document.getElementById(listId);
  const allNames = Array.from(selectEl.options).map((o) => o.value);
  const sortedAll = sortedFontNames(allNames);
  let highlightedIdx = -1;
  let visibleOptions = [];

  function setValue(value, { commit }) {
    selectEl.value = value;
    labelEl.textContent = value;
    labelEl.style.fontFamily = `'${value}'`;
    if (commit) addRecentFont(value);
  }

  function renderList(filterText) {
    listEl.innerHTML = '';
    visibleOptions = [];
    highlightedIdx = -1;
    const q = (filterText || '').trim().toLowerCase();

    function addOption(name) {
      const opt = document.createElement('div');
      opt.className = 'combo-option' + (name === selectEl.value ? ' active' : '');
      opt.textContent = name;
      opt.style.fontFamily = `'${name}'`;
      opt.dataset.value = name;
      opt.addEventListener('mouseenter', () => {
        highlightedIdx = visibleOptions.indexOf(name);
        showPreview((span) => { span.style.fontFamily = name; });
      });
      opt.addEventListener('mousedown', (e) => e.preventDefault());
      opt.addEventListener('click', () => {
        setValue(name, { commit: true });
        endPreviewSession((span) => { span.style.fontFamily = name; });
        closeDropdown();
      });
      listEl.appendChild(opt);
      visibleOptions.push(name);
    }

    if (q) {
      const filtered = sortedAll.filter((n) => n.toLowerCase().includes(q));
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'combo-empty';
        empty.textContent = 'Ничего не найдено';
        listEl.appendChild(empty);
      } else {
        filtered.forEach(addOption);
      }
      return;
    }

    const recent = loadRecentFonts().filter((f) => allNames.includes(f));
    if (recent.length > 0) {
      const title = document.createElement('div');
      title.className = 'combo-list-section-title';
      title.textContent = 'Недавние';
      listEl.appendChild(title);
      recent.forEach(addOption);
      const allTitle = document.createElement('div');
      allTitle.className = 'combo-list-section-title';
      allTitle.textContent = 'Все шрифты';
      listEl.appendChild(allTitle);
    }
    sortedAll.forEach(addOption);
  }

  function openDropdown() {
    saveSelection();
    beginPreviewSession();
    searchEl.value = '';
    renderList('');
    dropdownEl.classList.remove('hidden');
    searchEl.focus();
    activeComboRefocusEl = searchEl;
    openComboCloseFn = () => closeDropdown(true);
    const active = listEl.querySelector('.combo-option.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function closeDropdown(cancel) {
    if (cancel) endPreviewSession(null);
    dropdownEl.classList.add('hidden');
    if (activeComboRefocusEl === searchEl) activeComboRefocusEl = null;
    if (openComboCloseFn) openComboCloseFn = null;
  }

  triggerEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdownEl.classList.contains('hidden');
    if (!dropdownEl.classList.contains('hidden')) closeDropdown(true);
    if (willOpen) openDropdown();
  });

  searchEl.addEventListener('input', () => renderList(searchEl.value));

  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown(true);
      editor.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const opts = listEl.querySelectorAll('.combo-option');
      if (opts.length === 0) return;
      highlightedIdx = (highlightedIdx + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o) => o.classList.remove('highlighted'));
      const el = opts[highlightedIdx];
      el.classList.add('highlighted');
      el.scrollIntoView({ block: 'nearest' });
      showPreview((span) => { span.style.fontFamily = el.dataset.value; });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opts = listEl.querySelectorAll('.combo-option');
      const el = opts[highlightedIdx] || opts[0];
      if (el) {
        setValue(el.dataset.value, { commit: true });
        endPreviewSession((span) => { span.style.fontFamily = el.dataset.value; });
        closeDropdown();
      }
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!dropdownEl.classList.contains('hidden') && !e.target.closest(`#${dropdownId}`) && !e.target.closest(`#${triggerId}`)) {
      closeDropdown(true);
    }
  });

  return { setValue };
}

const fontNameSelectEl = document.getElementById('fontName');
const bubbleFontNameEl = document.getElementById('bubbleFontName');
// Список шрифтов во всплывающей панели — копия основного из ленты.
Array.from(fontNameSelectEl.options).forEach((o) => {
  bubbleFontNameEl.appendChild(new Option(o.text, o.value));
});

const fontNameCombo = setupFontCombo({
  selectId: 'fontName', triggerId: 'fontNameTrigger', labelId: 'fontNameLabel',
  dropdownId: 'fontNameDropdown', searchId: 'fontNameSearch', listId: 'fontNameList',
});
const bubbleFontNameCombo = setupFontCombo({
  selectId: 'bubbleFontName', triggerId: 'bubbleFontNameTrigger', labelId: 'bubbleFontNameLabel',
  dropdownId: 'bubbleFontNameDropdown', searchId: 'bubbleFontNameSearch', listId: 'bubbleFontNameList',
});

function setFontNameEverywhere(value) {
  fontNameCombo.setValue(value, { commit: false });
  bubbleFontNameCombo.setValue(value, { commit: false });
}

// ---- Универсальный кастомный выпадающий список для размера ----

const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

function setupSizeCombo({ inputId, caretId, dropdownId, listId }) {
  const inputEl = document.getElementById(inputId);
  const caretEl = document.getElementById(caretId);
  const dropdownEl = document.getElementById(dropdownId);
  const listEl = document.getElementById(listId);

  function renderList() {
    listEl.innerHTML = '';
    const current = parseInt(inputEl.value, 10);
    FONT_SIZE_PRESETS.forEach((pt) => {
      const opt = document.createElement('div');
      opt.className = 'combo-option' + (pt === current ? ' active' : '');
      opt.textContent = String(pt);
      opt.addEventListener('mouseenter', () => {
        showPreview((span) => { span.style.fontSize = `${pt}pt`; });
      });
      opt.addEventListener('mousedown', (e) => e.preventDefault());
      opt.addEventListener('click', () => {
        inputEl.value = pt;
        endPreviewSession((span) => { span.style.fontSize = `${pt}pt`; });
        updateStats();
        closeDropdown();
      });
      listEl.appendChild(opt);
    });
  }

  function openDropdown() {
    saveSelection();
    beginPreviewSession();
    renderList();
    dropdownEl.classList.remove('hidden');
    activeComboRefocusEl = inputEl;
    openComboCloseFn = () => closeDropdown(true);
  }

  function closeDropdown(cancel) {
    if (cancel) endPreviewSession(null);
    dropdownEl.classList.add('hidden');
    if (activeComboRefocusEl === inputEl) activeComboRefocusEl = null;
    if (openComboCloseFn) openComboCloseFn = null;
  }

  caretEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdownEl.classList.contains('hidden');
    if (!dropdownEl.classList.contains('hidden')) closeDropdown(true);
    if (willOpen) openDropdown();
  });

  document.addEventListener('mousedown', (e) => {
    if (!dropdownEl.classList.contains('hidden') && !e.target.closest(`#${dropdownId}`) && !e.target.closest(`#${caretId}`)) {
      closeDropdown(true);
    }
  });
}

function setFontSizePt(pt) {
  applyTextStyle((span) => { span.style.fontSize = `${pt}pt`; });
  updateStats();
}

const fontSizeInputEl = document.getElementById('fontSize');
fontSizeInputEl.addEventListener('focus', saveSelection);
fontSizeInputEl.addEventListener('change', (e) => {
  const px = Math.max(1, Math.min(400, parseInt(e.target.value, 10) || 12));
  e.target.value = px;
  setFontSizePt(px);
});

setupSizeCombo({ inputId: 'fontSize', caretId: 'fontSizeCaretBtn', dropdownId: 'fontSizeDropdown', listId: 'fontSizeList' });
setupSizeCombo({ inputId: 'bubbleFontSize', caretId: 'bubbleFontSizeCaretBtn', dropdownId: 'bubbleFontSizeDropdown', listId: 'bubbleFontSizeList' });

const blockFormatEl = document.getElementById('blockFormat');
blockFormatEl.addEventListener('mousedown', saveSelection);
blockFormatEl.addEventListener('focus', saveSelection);
blockFormatEl.addEventListener('change', (e) => {
  restoreSelection();
  document.execCommand('formatBlock', false, e.target.value);
  markActiveDirty();
  scheduleAutosave();
});

// ---- Межстрочный интервал (как в Google Docs) ----

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE']);

function blocksInRange(range) {
  const blocks = new Set();
  const addBlockOf = (node) => {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== editor) {
      if (BLOCK_TAGS.has(el.tagName)) {
        blocks.add(el);
        return;
      }
      el = el.parentElement;
    }
    // Текст лежит прямо в редакторе, вне блочных элементов
    if (el === editor && node.nodeType === 3) blocks.add(editor);
  };
  if (!range) return [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let n;
  while ((n = walker.nextNode())) addBlockOf(n);
  if (blocks.size === 0) addBlockOf(range.startContainer);
  return [...blocks];
}

function applyLineSpacing(value) {
  let range = savedRange;
  if (!range) {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) range = sel.getRangeAt(0);
  }
  const targets = blocksInRange(range);
  if (targets.length > 0) {
    targets.forEach((el) => { el.style.lineHeight = value; });
  } else {
    editor.style.lineHeight = value;
  }
  editor.focus();
  markActiveDirty();
  scheduleAutosave();
}

const lineSpacingEl = document.getElementById('lineSpacing');
const lineSpacingModal = document.getElementById('lineSpacingModal');
const lineSpacingCustomInput = document.getElementById('lineSpacingCustomInput');
const lineSpacingOkBtn = document.getElementById('lineSpacingOkBtn');
const lineSpacingCancelBtn = document.getElementById('lineSpacingCancelBtn');

lineSpacingEl.addEventListener('mousedown', saveSelection);
lineSpacingEl.addEventListener('focus', saveSelection);
lineSpacingEl.addEventListener('change', (e) => {
  const value = e.target.value;
  if (!value) return;
  if (value === 'custom') {
    // savedRange уже держит правильное выделение (захвачено на mousedown/
    // focus самого select до того, как он увёл фокус) — openModal() внутри
    // тоже вызывает saveSelection(), но в этот момент живое выделение уже
    // может быть недостоверным, поэтому сохраняем и восстанавливаем сами.
    const captured = savedRange;
    lineSpacingCustomInput.value = '1.75';
    openModal(lineSpacingModal);
    savedRange = captured;
    lineSpacingCustomInput.focus();
    lineSpacingCustomInput.select();
  } else {
    applyLineSpacing(value);
  }
  e.target.selectedIndex = 0;
});

lineSpacingCancelBtn.addEventListener('click', () => closeModal(lineSpacingModal));
lineSpacingOkBtn.addEventListener('click', () => {
  const value = Math.max(0.5, Math.min(5, parseFloat(lineSpacingCustomInput.value) || 1));
  closeModal(lineSpacingModal);
  restoreSelection();
  applyLineSpacing(String(value));
});
wireModalKeys(lineSpacingModal, lineSpacingOkBtn, lineSpacingCancelBtn);

// ---- Чек-лист (как в Google Docs) ----

document.getElementById('btnChecklist').addEventListener('click', () => {
  editor.focus();
  document.execCommand(
    'insertHTML',
    false,
    '<ul class="checklist"><li><input type="checkbox" contenteditable="false"> </li></ul>'
  );
  markActiveDirty();
  scheduleAutosave();
});

// Клик по чекбоксу отмечает пункт (сам чекбокс не редактируется).
editor.addEventListener('click', (e) => {
  if (e.target.matches('ul.checklist input[type="checkbox"]')) {
    e.target.toggleAttribute('checked', e.target.checked);
    const li = e.target.closest('li');
    if (li) li.classList.toggle('done', e.target.checked);
    markActiveDirty();
    scheduleAutosave();
  }
});

// ---- Изменение размера картинок перетаскиванием ----

const imgResizeOverlay = document.getElementById('imgResizeOverlay');
const imgResizeHandle = document.getElementById('imgResizeHandle');
let resizingImg = null;

function positionImgOverlay() {
  if (!resizingImg || !editor.contains(resizingImg)) {
    hideImgOverlay();
    return;
  }
  const r = resizingImg.getBoundingClientRect();
  imgResizeOverlay.style.top = `${r.top}px`;
  imgResizeOverlay.style.left = `${r.left}px`;
  imgResizeOverlay.style.width = `${r.width}px`;
  imgResizeOverlay.style.height = `${r.height}px`;
  imgResizeOverlay.classList.remove('hidden');
}

function hideImgOverlay() {
  imgResizeOverlay.classList.add('hidden');
  resizingImg = null;
}

editor.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG') {
    resizingImg = e.target;
    positionImgOverlay();
  } else if (!e.target.closest('#imgResizeOverlay')) {
    hideImgOverlay();
  }
});

imgResizeHandle.addEventListener('mousedown', (e) => {
  if (!resizingImg) return;
  e.preventDefault();
  e.stopPropagation();
  const img = resizingImg;
  const startX = e.clientX;
  const startWidth = img.getBoundingClientRect().width;

  function onMove(ev) {
    const w = Math.max(24, Math.round(startWidth + (ev.clientX - startX)));
    img.style.width = `${w}px`;
    img.style.height = 'auto';
    positionImgOverlay();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    markActiveDirty();
    scheduleAutosave();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

editor.addEventListener('input', hideImgOverlay);
pageScrollEl.addEventListener('scroll', hideImgOverlay);
window.addEventListener('resize', hideImgOverlay);

// ---- Редактирование таблиц через правый клик по ячейке ----

let ctxTableCell = null;

editor.addEventListener('contextmenu', (e) => {
  const cell = e.target.closest && e.target.closest('td, th');
  ctxTableCell = cell && editor.contains(cell) ? cell : null;
  // Флаг для главного процесса: он строит нативное меню и добавляет
  // пункты работы с таблицей, только если клик был в ячейке.
  window.__literaTableCtx = !!ctxTableCell;
});

function emptyCellLike(refCell) {
  const td = document.createElement(refCell ? refCell.tagName.toLowerCase() : 'td');
  td.innerHTML = '<br>';
  return td;
}

function tableOp(op) {
  const cell = ctxTableCell;
  if (!cell || !editor.contains(cell)) return;
  const row = cell.parentElement;
  const table = cell.closest('table');
  if (!row || !table) return;
  const colIdx = [...row.children].indexOf(cell);

  if (op === 'row-above' || op === 'row-below') {
    const newRow = document.createElement('tr');
    for (let i = 0; i < row.children.length; i++) newRow.appendChild(emptyCellLike(row.children[i]));
    row.parentElement.insertBefore(newRow, op === 'row-above' ? row : row.nextSibling);
  } else if (op === 'col-left' || op === 'col-right') {
    table.querySelectorAll('tr').forEach((tr) => {
      const ref = tr.children[colIdx];
      const td = emptyCellLike(ref);
      if (ref) tr.insertBefore(td, op === 'col-left' ? ref : ref.nextSibling);
      else tr.appendChild(td);
    });
  } else if (op === 'del-row') {
    row.remove();
    if (!table.querySelector('tr')) table.remove();
  } else if (op === 'del-col') {
    table.querySelectorAll('tr').forEach((tr) => {
      if (tr.children[colIdx]) tr.children[colIdx].remove();
    });
    if (!table.querySelector('td, th')) table.remove();
  } else if (op === 'del-table') {
    table.remove();
  }

  ctxTableCell = null;
  editor.focus();
  markActiveDirty();
  updateStats();
  scheduleAutosave();
}

window.api.onTableOp(tableOp);

// Enter внутри чек-листа: новый пункт должен сразу получить свой чекбокс.
editor.addEventListener('keyup', (e) => {
  if (e.key !== 'Enter') return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.anchorNode;
  if (node && node.nodeType === 3) node = node.parentElement;
  const li = node && node.closest ? node.closest('ul.checklist li') : null;
  if (li && !li.querySelector('input[type="checkbox"]')) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('contenteditable', 'false');
    li.classList.remove('done');
    li.insertBefore(box, li.firstChild);
    const space = document.createTextNode(' ');
    li.insertBefore(space, box.nextSibling);
    // Курсор — после чекбокса, чтобы текст печатался за ним, а не перед
    const caret = document.createRange();
    caret.setStart(space, 1);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
  }
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

const bubbleForeDropdown = document.getElementById('bubbleForeDropdown');
const bubbleHiliteDropdown = document.getElementById('bubbleHiliteDropdown');

function closeColorDropdowns() {
  foreColorDropdown.classList.add('hidden');
  hiliteColorDropdown.classList.add('hidden');
  bubbleForeDropdown.classList.add('hidden');
  bubbleHiliteDropdown.classList.add('hidden');
}

// «Недавние цвета» — общий список для текста и выделения, как в макете.
const RECENT_COLORS_KEY = 'litera-recent-colors';

function loadRecentColors() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY));
    return Array.isArray(list) ? list.filter((c) => /^#[0-9a-f]{6}$/i.test(c)) : [];
  } catch (e) {
    return [];
  }
}

function renderRecentColors() {
  const colors = loadRecentColors();
  [
    { row: 'foreColorRecentRow', box: 'foreColorRecent', apply: (c) => applyForeColor(c) },
    { row: 'hiliteColorRecentRow', box: 'hiliteColorRecent', apply: (c) => applyHiliteColor(c) },
  ].forEach(({ row, box, apply }) => {
    const rowEl = document.getElementById(row);
    const boxEl = document.getElementById(box);
    boxEl.innerHTML = '';
    rowEl.classList.toggle('hidden', colors.length === 0);
    colors.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch';
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener('click', () => apply(c));
      boxEl.appendChild(sw);
    });
  });
}

function addRecentColor(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return;
  const list = [c.toLowerCase(), ...loadRecentColors().filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 8);
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list));
  } catch (e) {}
  renderRecentColors();
}

function applyForeColor(c) {
  restoreSelection();
  document.execCommand('foreColor', false, c);
  document.getElementById('foreColorBar').style.background = c;
  addRecentColor(c);
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
  restoreSelection();
  const current = currentHiliteColor().replace(/\s+/g, '');
  const target = current && current === hexToRgb(c).replace(/\s+/g, '') ? 'transparent' : c;
  document.execCommand('hiliteColor', false, target);
  if (target !== 'transparent') {
    lastHiliteColor = c;
    document.getElementById('hiliteColorBar').style.background = c;
    addRecentColor(c);
  }
  markActiveDirty();
  scheduleAutosave();
}

buildColorGrid(document.getElementById('foreColorGrid'), applyForeColor);
buildColorGrid(document.getElementById('hiliteColorGrid'), applyHiliteColor);
buildColorGrid(document.getElementById('bubbleForeGrid'), applyForeColor);
buildColorGrid(document.getElementById('bubbleHiliteGrid'), applyHiliteColor);
renderRecentColors();

function wireColorTrigger(triggerId, dropdown) {
  document.getElementById(triggerId).addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.classList.contains('hidden');
    closeColorDropdowns();
    if (willOpen) {
      saveSelection();
      dropdown.classList.remove('hidden');
    }
  });
}

wireColorTrigger('bubbleForeTrigger', bubbleForeDropdown);
wireColorTrigger('bubbleHiliteBtn', bubbleHiliteDropdown);

document.getElementById('foreColorTrigger').addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = foreColorDropdown.classList.contains('hidden');
  closeColorDropdowns();
  if (willOpen) {
    saveSelection();
    foreColorDropdown.classList.remove('hidden');
  }
});

document.getElementById('hiliteColorTrigger').addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = hiliteColorDropdown.classList.contains('hidden');
  closeColorDropdowns();
  if (willOpen) {
    saveSelection();
    hiliteColorDropdown.classList.remove('hidden');
  }
});

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('[data-color-wrap]')) closeColorDropdowns();
});

// The native color-picker dialog opened by <input type="color"> steals focus
// even more thoroughly than a <select>, so applyForeColor/applyHiliteColor's
// execCommand call never has anything to act on here — apply directly instead.
const foreColorCustomInputEl = document.getElementById('foreColorCustomInput');
foreColorCustomInputEl.addEventListener('mousedown', saveSelection);
foreColorCustomInputEl.addEventListener('input', (e) => {
  const c = e.target.value;
  const applied = applyInlineStyleToRange(savedRange, (span) => { span.style.color = c; });
  editor.focus();
  if (!applied) document.execCommand('foreColor', false, c);
  document.getElementById('foreColorBar').style.background = c;
  addRecentColor(c);
  markActiveDirty();
  scheduleAutosave();
  closeColorDropdowns();
});

const hiliteColorCustomInputEl = document.getElementById('hiliteColorCustomInput');
hiliteColorCustomInputEl.addEventListener('mousedown', saveSelection);
hiliteColorCustomInputEl.addEventListener('input', (e) => {
  const c = e.target.value;
  const applied = applyInlineStyleToRange(savedRange, (span) => { span.style.backgroundColor = c; });
  editor.focus();
  if (!applied) document.execCommand('hiliteColor', false, c);
  lastHiliteColor = c;
  document.getElementById('hiliteColorBar').style.background = c;
  addRecentColor(c);
  markActiveDirty();
  scheduleAutosave();
  closeColorDropdowns();
});

// Пипетка (EyeDropper API есть в Chromium/Electron; кнопки видимы, только
// если API доступен). Выделение уже сохранено при открытии дропдауна.
if (window.EyeDropper) {
  const foreEyedropperBtn = document.getElementById('foreEyedropperBtn');
  const hiliteEyedropperBtn = document.getElementById('hiliteEyedropperBtn');
  foreEyedropperBtn.classList.remove('hidden');
  hiliteEyedropperBtn.classList.remove('hidden');

  async function pickWithEyedropper(applyStyleProp, afterPick) {
    closeColorDropdowns();
    try {
      const result = await new window.EyeDropper().open();
      const c = result.sRGBHex;
      const applied = applyInlineStyleToRange(savedRange, (span) => { span.style[applyStyleProp] = c; });
      editor.focus();
      afterPick(c, applied);
      addRecentColor(c);
      markActiveDirty();
      scheduleAutosave();
    } catch (e) {} // пользователь отменил выбор — это не ошибка
  }

  foreEyedropperBtn.addEventListener('click', () => {
    pickWithEyedropper('color', (c, applied) => {
      if (!applied) document.execCommand('foreColor', false, c);
      document.getElementById('foreColorBar').style.background = c;
    });
  });

  hiliteEyedropperBtn.addEventListener('click', () => {
    pickWithEyedropper('backgroundColor', (c, applied) => {
      if (!applied) document.execCommand('hiliteColor', false, c);
      lastHiliteColor = c;
      document.getElementById('hiliteColorBar').style.background = c;
    });
  });
}

const bubbleFontSizeEl = document.getElementById('bubbleFontSize');
bubbleFontSizeEl.addEventListener('focus', saveSelection);
bubbleFontSizeEl.addEventListener('change', (e) => {
  const px = Math.max(1, Math.min(400, parseInt(e.target.value, 10) || 12));
  e.target.value = px;
  fontSizeInputEl.value = px;
  setFontSizePt(px);
});

document.getElementById('bubbleLinkBtn').addEventListener('click', () => {
  document.getElementById('btnLink').click();
});

document.getElementById('bubbleClearBtn').addEventListener('click', () => {
  editor.focus();
  document.execCommand('removeFormat');
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
  const matchedOption = clean && [...fontNameSelect.options].find((o) => o.value.toLowerCase() === clean.toLowerCase());
  if (matchedOption) {
    setFontNameEverywhere(matchedOption.value);
  }

  const sizePt = Math.round(parseFloat(computed.fontSize) * 0.75);
  if (sizePt) {
    fontSizeInput.value = sizePt;
    document.getElementById('bubbleFontSize').value = sizePt;
  }
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
  // Пока пользователь работает с самой панелью (поле размера, выбор шрифта,
  // палитра) — не прятать её, даже если выделение в документе «погасло».
  if (bubbleToolbar.contains(document.activeElement)) return;
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

// Список шрифтов в настройках — тот же, что на ленте.
Array.from(document.getElementById('fontName').options).forEach((o) => {
  settingsFontNameEl.appendChild(new Option(o.text, o.value));
});

// Ширина страницы и межстрочный интервал применяются сразу при запуске
// и после сохранения настроек.
function applyAppearanceSettings() {
  document.body.dataset.pageWidth = settings.pageWidth || 'normal';
  editor.style.lineHeight = settings.defaultLineSpacing || '';
}

function openSettingsModal() {
  settingsThemeEl.value = settings.theme;
  settingsFontNameEl.value = settings.defaultFontName;
  settingsFontSizeEl.value = settings.defaultFontSize;
  document.getElementById('settingsPageWidth').value = settings.pageWidth || 'normal';
  document.getElementById('settingsLineSpacing').value = settings.defaultLineSpacing || '';
  document.getElementById('settingsShowStartScreen').checked = settings.showStartScreen !== false;
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
document.getElementById('tabSettingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('settingsCancelBtn').addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('mousedown', (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
  const next = {
    theme: settingsThemeEl.value,
    defaultFontName: settingsFontNameEl.value,
    defaultFontSize: Math.max(1, Math.min(400, parseInt(settingsFontSizeEl.value, 10) || 12)),
    pageWidth: document.getElementById('settingsPageWidth').value,
    defaultLineSpacing: document.getElementById('settingsLineSpacing').value,
    showStartScreen: document.getElementById('settingsShowStartScreen').checked,
    autosaveEnabled: settingsAutosaveEnabledEl.checked,
    autosaveIntervalSec: Math.max(5, Math.min(600, parseInt(settingsAutosaveIntervalEl.value, 10) || 20)),
    spellcheckRu: settingsSpellRuEl.checked,
    spellcheckEn: settingsSpellEnEl.checked,
    defaultSaveFormat: settingsSaveFormatEl.value,
    defaultSaveFolder: pendingDefaultFolder,
  };
  settings = await window.api.saveSettings(next);
  applyTheme(settings.theme === 'dark');
  applyAppearanceSettings();
  updateStartScreenVisibility();
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

let editingLinkEl = null;

linkCancelBtn.addEventListener('click', () => {
  closeModal(linkModal);
  editingLinkEl = null;
});

linkOkBtn.addEventListener('click', () => {
  const url = linkUrlInput.value.trim();
  closeModal(linkModal);
  if (!url) { editingLinkEl = null; return; }
  if (editingLinkEl) {
    editingLinkEl.setAttribute('href', url);
    editingLinkEl = null;
    editor.focus();
    markActiveDirty();
    scheduleAutosave();
    return;
  }
  // Модальное окно — это нативный <input>, а фокус на нём ломает
  // execCommand так же, как и у ленты (см. applyInlineStyleToRange) —
  // поэтому создаём <a> вручную, а не через createLink.
  const applied = applyInlineStyleToRange(savedRange, (a) => { a.href = url; }, 'a');
  editor.focus();
  if (!applied) document.execCommand('createLink', false, url);
  markActiveDirty();
  scheduleAutosave();
});

// ---- Наведение на ссылку: карточка «Открыть / Изменить / Удалить» ----

const linkChip = document.getElementById('linkChip');
const linkChipUrlEl = document.getElementById('linkChipUrl');
const linkChipOpenBtn = document.getElementById('linkChipOpenBtn');
const linkChipEditBtn = document.getElementById('linkChipEditBtn');
const linkChipRemoveBtn = document.getElementById('linkChipRemoveBtn');
let hoveredLink = null;
let linkChipHideTimer = null;

function showLinkChip(a) {
  clearTimeout(linkChipHideTimer);
  hoveredLink = a;
  linkChipUrlEl.textContent = a.getAttribute('href') || '';
  const r = a.getBoundingClientRect();
  linkChip.classList.remove('hidden');
  const chipRect = linkChip.getBoundingClientRect();
  linkChip.style.top = `${r.bottom + 6}px`;
  linkChip.style.left = `${Math.min(r.left, window.innerWidth - chipRect.width - 12)}px`;
}

function scheduleHideLinkChip() {
  clearTimeout(linkChipHideTimer);
  linkChipHideTimer = setTimeout(() => {
    linkChip.classList.add('hidden');
    hoveredLink = null;
  }, 220);
}

editor.addEventListener('mouseover', (e) => {
  const a = e.target.closest && e.target.closest('a');
  if (a && editor.contains(a)) showLinkChip(a);
});
editor.addEventListener('mouseout', (e) => {
  const a = e.target.closest && e.target.closest('a');
  if (a && !e.relatedTarget?.closest?.('.link-chip')) scheduleHideLinkChip();
});
linkChip.addEventListener('mouseenter', () => clearTimeout(linkChipHideTimer));
linkChip.addEventListener('mouseleave', scheduleHideLinkChip);

// Ctrl+клик по ссылке открывает её сразу, без наведения на карточку.
editor.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a');
  if (a && editor.contains(a) && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    window.api.openExternal(a.getAttribute('href'));
  }
});

linkChipOpenBtn.addEventListener('click', () => {
  if (hoveredLink) window.api.openExternal(hoveredLink.getAttribute('href'));
});

linkChipEditBtn.addEventListener('click', () => {
  if (!hoveredLink) return;
  const a = hoveredLink;
  editingLinkEl = a;
  linkUrlInput.value = a.getAttribute('href') || 'https://';
  linkChip.classList.add('hidden');
  openModal(linkModal);
  linkUrlInput.focus();
  linkUrlInput.select();
});

linkChipRemoveBtn.addEventListener('click', () => {
  if (!hoveredLink) return;
  const a = hoveredLink;
  const parent = a.parentNode;
  while (a.firstChild) parent.insertBefore(a.firstChild, a);
  parent.removeChild(a);
  parent.normalize();
  linkChip.classList.add('hidden');
  hoveredLink = null;
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
  const res = await window.api.saveFile(tab.filePath, stripZeroWidth(tab.bodyHtml), suggestedName);
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
  const res = await window.api.saveAsDialog(stripZeroWidth(tab.bodyHtml), suggestedName);
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
  if (mod && e.shiftKey && key === 'v') {
    e.preventDefault();
    editor.focus();
    navigator.clipboard.readText().then((text) => {
      if (text) {
        document.execCommand('insertText', false, text);
        markActiveDirty();
        scheduleAutosave();
      }
    }).catch(() => {});
    return;
  }
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
  if (e.key === 'F9') { e.preventDefault(); setFocusMode(!document.body.classList.contains('focus-mode')); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoomPct(currentZoomPct + 10); return; }
  if (mod && e.key === '-') { e.preventDefault(); setZoomPct(currentZoomPct - 10); return; }
  if (mod && e.key === '0') { e.preventDefault(); setZoomPct(100); return; }
  if (e.key === 'Escape') {
    if (document.body.classList.contains('focus-mode')) { setFocusMode(false); return; }
    closeFindBar();
    return;
  }
});

// ---- Инициализация ----

async function init() {
  settings = await window.api.getSettings();
  applyTheme(settings.theme === 'dark');
  applyAppearanceSettings();
  initAppVersion();
  if (!settings.onboardingShown) showOnboarding();

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
