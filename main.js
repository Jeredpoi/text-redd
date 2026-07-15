const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let currentFilePath = null;
let isDirty = false;

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
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadFile('index.html');

  // Включаем встроенную проверку орфографии Electron/Chromium для русского и английского
  const ses = mainWindow.webContents.session;
  try {
    ses.setSpellCheckerLanguages(['ru', 'en-US']);
  } catch (e) {
    console.error('Не удалось установить языки словаря:', e);
  }

  // Контекстное меню с вариантами исправления орфографии
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menuItems = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menuItems.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
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

  mainWindow.on('close', async (e) => {
    if (isDirty) {
      e.preventDefault();
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Сохранить', 'Не сохранять', 'Отмена'],
        defaultId: 0,
        cancelId: 2,
        message: 'Сохранить изменения перед закрытием?',
      });
      if (choice.response === 0) {
        mainWindow.webContents.send('menu-save');
      } else if (choice.response === 1) {
        isDirty = false;
        mainWindow.close();
      }
    }
  });
}

function buildMenu() {
  const recent = loadRecentFiles();

  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu-new') },
        { label: 'Открыть…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('menu-open') },
        {
          label: 'Открыть недавние',
          submenu:
            recent.length > 0
              ? recent.map((f) => ({
                  label: f,
                  click: () => mainWindow.webContents.send('menu-open-path', f),
                }))
              : [{ label: 'Пусто', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-save') },
        { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-save-as') },
        { type: 'separator' },
        { label: 'Экспорт в PDF…', click: () => mainWindow.webContents.send('menu-export-pdf') },
        { label: 'Экспорт в Word (.docx)…', click: () => mainWindow.webContents.send('menu-export-docx') },
        { type: 'separator' },
        { label: 'Печать…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.print() },
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
        { label: 'Найти и заменить…', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('menu-find') },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Тёмная тема', click: () => mainWindow.webContents.send('menu-toggle-theme') },
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
        { label: 'Таблица…', click: () => mainWindow.webContents.send('menu-insert-table') },
        { label: 'Ссылка…', click: () => mainWindow.webContents.send('menu-insert-link') },
        { label: 'Изображение…', click: () => mainWindow.webContents.send('menu-insert-image') },
        { label: 'Горизонтальная линия', click: () => mainWindow.webContents.send('menu-insert-hr') },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'О программе',
              message: 'Простой Редактор',
              detail: 'Версия 1.0.0\nТекстовый редактор с проверкой орфографии (RU/EN)\nСоздано для Максима',
            }),
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

// ---- IPC: файловые операции ----

ipcMain.handle('dirty-state', (event, dirty) => {
  isDirty = dirty;
});

ipcMain.handle('get-current-path', () => currentFilePath);

ipcMain.handle('dialog-open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Все поддерживаемые', extensions: ['html', 'htm', 'txt'] },
      { name: 'HTML документ', extensions: ['html', 'htm'] },
      { name: 'Текстовый файл', extensions: ['txt'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return readFileForEditor(filePath);
});

ipcMain.handle('open-path', async (event, filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return readFileForEditor(filePath);
});

function readFileForEditor(filePath) {
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
  currentFilePath = filePath;
  addRecentFile(filePath);
  return { path: filePath, html, name: path.basename(filePath) };
}

async function saveAsFlow(html) {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'HTML документ', extensions: ['html'] },
      { name: 'Текстовый файл', extensions: ['txt'] },
    ],
    defaultPath: 'Без имени.html',
  });
  if (result.canceled || !result.filePath) return null;
  writeFile(result.filePath, html);
  currentFilePath = result.filePath;
  addRecentFile(result.filePath);
  return { path: result.filePath, name: path.basename(result.filePath) };
}

ipcMain.handle('dialog-save-as', async (event, html) => saveAsFlow(html));

ipcMain.handle('save-current', async (event, html) => {
  if (!currentFilePath) {
    return saveAsFlow(html);
  }
  writeFile(currentFilePath, html);
  return { path: currentFilePath, name: path.basename(currentFilePath) };
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

ipcMain.handle('export-pdf', async (event, html) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'PDF документ', extensions: ['pdf'] }],
    defaultPath: 'Документ.pdf',
  });
  if (result.canceled || !result.filePath) return null;
  const pdfData = await mainWindow.webContents.printToPDF({});
  fs.writeFileSync(result.filePath, pdfData);
  return result.filePath;
});

ipcMain.handle('export-docx', async (event, html) => {
  const result = await dialog.showSaveDialog(mainWindow, {
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

ipcMain.handle('insert-image-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
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
