const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let lastTheme = 'light';

const recentFilesPath = () => path.join(app.getPath('userData'), 'recent-files.json');

function loadRecentFiles() {
  try {
    return JSON.parse(fs.readFileSync(recentFilesPath(), 'utf-8'));
  } catch (e) {
    return [];
  }
}

function saveRecentFiles(list) {
  try {
    fs.writeFileSync(recentFilesPath(), JSON.stringify(list.slice(0, 10), null, 2));
  } catch (e) {}
}

function addRecentFile(filePath) {
  let list = loadRecentFiles().filter((f) => f !== filePath);
  list.unshift(filePath);
  saveRecentFiles(list);
  buildMenu();
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('recent-files-changed'));
}

function focusedWindow() {
  return BrowserWindow.getFocusedWindow();
}

// Каждое окно хранит своё собственное состояние документа (путь к файлу,
// есть ли несохранённые изменения), чтобы окна не мешали друг другу.
function stateFor(win) {
  if (!win.docState) win.docState = { filePath: null, isDirty: false, pendingClose: false };
  return win.docState;
}

function updateTitle(win) {
  const state = stateFor(win);
  const name = state.filePath ? path.basename(state.filePath) : 'Без имени';
  win.setTitle(`${state.isDirty ? '* ' : ''}${name} — Простой Редактор`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: lastTheme === 'dark' ? '#1e1f24' : '#f4f4f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  stateFor(win);
  win.loadFile('index.html');
  updateTitle(win);

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('apply-theme', lastTheme);
  });

  // Включаем встроенную проверку орфографии Electron/Chromium для русского и английского
  const ses = win.webContents.session;
  try {
    ses.setSpellCheckerLanguages(['ru', 'en-US']);
  } catch (e) {
    console.error('Не удалось установить языки словаря:', e);
  }

  // Контекстное меню с вариантами исправления орфографии
  win.webContents.on('context-menu', (event, params) => {
    const menuItems = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menuItems.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        menuItems.push({ label: 'Нет вариантов', enabled: false });
      }
      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Добавить в словарь',
        click: () => ses.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      menuItems.push({ type: 'separator' });
    }

    menuItems.push(
      { label: 'Вырезать', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Копировать', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Вставить', role: 'paste', enabled: params.editFlags.canPaste }
    );

    Menu.buildFromTemplate(menuItems).popup();
  });

  win.on('close', async (e) => {
    const state = stateFor(win);
    if (state.isDirty) {
      e.preventDefault();
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Сохранить', 'Не сохранять', 'Отмена'],
        defaultId: 0,
        cancelId: 2,
        message: 'Сохранить изменения перед закрытием?',
      });
      if (choice.response === 0) {
        state.pendingClose = true;
        win.webContents.send('menu-save');
      } else if (choice.response === 1) {
        state.isDirty = false;
        win.close();
      }
    }
  });

  return win;
}

function buildMenu() {
  const recent = loadRecentFiles();

  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый', accelerator: 'CmdOrCtrl+N', click: () => focusedWindow()?.webContents.send('menu-new') },
        { label: 'Новое окно', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'Открыть…', accelerator: 'CmdOrCtrl+O', click: () => focusedWindow()?.webContents.send('menu-open') },
        {
          label: 'Открыть недавние',
          submenu:
            recent.length > 0
              ? recent.map((f) => ({
                  label: f,
                  click: () => focusedWindow()?.webContents.send('menu-open-path', f),
                }))
              : [{ label: 'Пусто', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: () => focusedWindow()?.webContents.send('menu-save') },
        { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+Shift+S', click: () => focusedWindow()?.webContents.send('menu-save-as') },
        { type: 'separator' },
        { label: 'Экспорт в PDF…', click: () => focusedWindow()?.webContents.send('menu-export-pdf') },
        { label: 'Экспорт в Word (.docx)…', click: () => focusedWindow()?.webContents.send('menu-export-docx') },
        { type: 'separator' },
        { label: 'Печать…', accelerator: 'CmdOrCtrl+P', click: () => focusedWindow()?.webContents.print() },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' },
        { type: 'separator' },
        { label: 'Найти и заменить…', accelerator: 'CmdOrCtrl+F', click: () => focusedWindow()?.webContents.send('menu-find') },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Тёмная тема', click: () => focusedWindow()?.webContents.send('menu-toggle-theme') },
        { type: 'separator' },
        { label: 'Увеличить масштаб', role: 'zoomIn' },
        { label: 'Уменьшить масштаб', role: 'zoomOut' },
        { label: 'Сбросить масштаб', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Полноэкранный режим', role: 'togglefullscreen' },
        { label: 'Инструменты разработчика', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Вставка',
      submenu: [
        { label: 'Таблица…', click: () => focusedWindow()?.webContents.send('menu-insert-table') },
        { label: 'Ссылка…', click: () => focusedWindow()?.webContents.send('menu-insert-link') },
        { label: 'Изображение…', click: () => focusedWindow()?.webContents.send('menu-insert-image') },
        { label: 'Горизонтальная линия', click: () => focusedWindow()?.webContents.send('menu-insert-hr') },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () => {
            const opts = {
              type: 'info',
              title: 'О программе',
              message: 'Простой Редактор',
              detail: 'Версия 1.0.0\nТекстовый редактор с проверкой орфографии (RU/EN)',
            };
            const win = focusedWindow();
            if (win) dialog.showMessageBox(win, opts);
            else dialog.showMessageBox(opts);
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createWindow();
  buildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: тема ----

ipcMain.handle('set-theme', (event, theme) => {
  lastTheme = theme;
});

// ---- IPC: файловые операции ----

ipcMain.handle('get-recent-files', () => loadRecentFiles());

ipcMain.handle('dirty-state', (event, dirty) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  stateFor(win).isDirty = dirty;
  updateTitle(win);
});

ipcMain.handle('dialog-open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Все поддерживаемые', extensions: ['txt', 'html', 'htm'] },
      { name: 'Текстовый файл', extensions: ['txt'] },
      { name: 'HTML документ', extensions: ['html', 'htm'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readFileForEditor(win, result.filePaths[0]);
});

ipcMain.handle('open-path', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!fs.existsSync(filePath)) return null;
  return readFileForEditor(win, filePath);
});

function readFileForEditor(win, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf-8');
  let html;
  if (ext === '.txt') {
    const esc = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = '<p>' + esc.split(/\r?\n/).join('</p><p>') + '</p>';
  } else {
    html = raw;
  }
  const state = stateFor(win);
  state.filePath = filePath;
  state.isDirty = false;
  updateTitle(win);
  addRecentFile(filePath);
  return { path: filePath, html, name: path.basename(filePath) };
}

async function saveAsFlow(win, html) {
  const result = await dialog.showSaveDialog(win, {
    filters: [
      { name: 'Текстовый файл', extensions: ['txt'] },
      { name: 'HTML документ', extensions: ['html'] },
    ],
    defaultPath: 'Без имени.txt',
  });
  if (result.canceled || !result.filePath) return null;
  writeFile(result.filePath, html);
  const state = stateFor(win);
  state.filePath = result.filePath;
  state.isDirty = false;
  updateTitle(win);
  addRecentFile(result.filePath);
  return { path: result.filePath, name: path.basename(result.filePath) };
}

ipcMain.handle('dialog-save-as', async (event, html) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return saveAsFlow(win, html);
});

ipcMain.handle('save-current', async (event, html) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = stateFor(win);
  let result;
  if (!state.filePath) {
    result = await saveAsFlow(win, html);
  } else {
    writeFile(state.filePath, html);
    state.isDirty = false;
    updateTitle(win);
    result = { path: state.filePath, name: path.basename(state.filePath) };
  }
  if (result && state.pendingClose) {
    state.pendingClose = false;
    win.close();
  } else if (!result) {
    state.pendingClose = false;
  }
  return result;
});

function writeFile(filePath, html) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt') {
    const text = html
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    fs.writeFileSync(filePath, text, 'utf-8');
  } else {
    const full = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    fs.writeFileSync(filePath, full, 'utf-8');
  }
}

ipcMain.handle('export-pdf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'PDF документ', extensions: ['pdf'] }],
    defaultPath: 'Документ.pdf',
  });
  if (result.canceled || !result.filePath) return null;
  const pdfData = await win.webContents.printToPDF({});
  fs.writeFileSync(result.filePath, pdfData);
  return result.filePath;
});

ipcMain.handle('export-docx', async (event, html) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Word документ', extensions: ['docx'] }],
    defaultPath: 'Документ.docx',
  });
  if (result.canceled || !result.filePath) return null;
  const HTMLtoDOCX = require('html-to-docx');
  const fileBuffer = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });
  fs.writeFileSync(result.filePath, fileBuffer);
  return result.filePath;
});

ipcMain.handle('insert-image-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1);
  const base64 = data.toString('base64');
  return `data:image/${ext};base64,${base64}`;
});
