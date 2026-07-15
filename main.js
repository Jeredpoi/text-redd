const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---- Настройки ----

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  theme: 'dark',
  defaultFontName: 'Calibri',
  defaultFontSize: 12,
  autosaveEnabled: true,
  autosaveIntervalSec: 20,
  spellcheckRu: true,
  spellcheckEn: true,
  defaultSaveFormat: 'docx',
  defaultSaveFolder: '',
};

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) };
  } catch (e) {
    return { ...defaultSettings };
  }
}

function persistSettings(s) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
  } catch (e) {}
}

let settings = loadSettings();

function spellcheckLanguages() {
  const langs = [];
  if (settings.spellcheckRu) langs.push('ru');
  if (settings.spellcheckEn) langs.push('en-US');
  return langs;
}

function applySpellcheck(win) {
  const ses = win.webContents.session;
  const langs = spellcheckLanguages();
  try {
    if (langs.length > 0) {
      ses.setSpellCheckerEnabled(true);
      ses.setSpellCheckerLanguages(langs);
    } else {
      ses.setSpellCheckerEnabled(false);
    }
  } catch (e) {
    console.error('Не удалось настроить проверку орфографии:', e);
  }
}

// ---- Недавние файлы ----

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

function broadcastRecentFilesChanged() {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('recent-files-changed'));
}

function addRecentFile(filePath) {
  let list = loadRecentFiles().filter((f) => f !== filePath);
  list.unshift(filePath);
  saveRecentFiles(list);
  broadcastRecentFilesChanged();
}

function removeRecentFile(filePath) {
  const list = loadRecentFiles().filter((f) => f !== filePath);
  saveRecentFiles(list);
  broadcastRecentFilesChanged();
}

// ---- Автосохранение / восстановление после сбоя ----

const recoveryDir = () => {
  const dir = path.join(app.getPath('userData'), 'recovery');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
  return dir;
};

function recoveryFilePath(recoveryId) {
  return path.join(recoveryDir(), `${recoveryId}.json`);
}

// ---- Вспомогательное для файловых имён ----

function sanitizeFileName(name) {
  const cleaned = (name || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned || 'Без имени';
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}${ext}`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

// ---- Окно ----

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: settings.theme === 'dark' ? '#1e1f24' : '#f4f4f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  win.loadFile('index.html');
  applySpellcheck(win);

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('apply-theme', settings.theme);
  });

  win.webContents.on('context-menu', (event, params) => {
    const menuItems = [];
    const ses = win.webContents.session;

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
      { label: 'Вставить', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Вставить без форматирования', role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste }
    );

    if (params.isEditable) {
      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Вставить ссылку',
        accelerator: 'CmdOrCtrl+K',
        click: () => win.webContents.send('trigger-insert-link'),
      });
    }

    Menu.buildFromTemplate(menuItems).popup();
  });

  // Закрытие окна всегда сначала спрашивает рендерер — там могут быть
  // несохранённые вкладки, состояние которых знает только он сам.
  win.on('close', (e) => {
    if (win.allowClose) return;
    e.preventDefault();
    win.webContents.send('app-close-requested');
  });

  return win;
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: закрытие окна ----

ipcMain.handle('confirm-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.allowClose = true;
  win.close();
});

// ---- IPC: заголовок окна, печать, масштаб, полноэкранный режим ----

ipcMain.handle('set-window-title', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setTitle(title);
});

ipcMain.handle('print', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.webContents.print();
});

ipcMain.handle('zoom-in', (event) => {
  const wc = event.sender;
  wc.setZoomLevel(wc.getZoomLevel() + 0.5);
});

ipcMain.handle('zoom-out', (event) => {
  const wc = event.sender;
  wc.setZoomLevel(wc.getZoomLevel() - 0.5);
});

ipcMain.handle('zoom-reset', (event) => {
  event.sender.setZoomLevel(0);
});

ipcMain.handle('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

ipcMain.handle('toggle-devtools', (event) => {
  event.sender.toggleDevTools();
});

// ---- IPC: контекстные меню сайдбара и вкладок ----

ipcMain.handle('show-recent-item-menu', (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const template = [
    { label: 'Открыть', click: () => win.webContents.send('open-recent-path', filePath) },
    { label: 'Показать в проводнике', click: () => shell.showItemInFolder(filePath) },
    { type: 'separator' },
    { label: 'Удалить из списка', click: () => removeRecentFile(filePath) },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
});

ipcMain.handle('show-tab-context-menu', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const template = [{ label: 'Новая вкладка', click: () => win.webContents.send('tab-menu-new') }];
  if (tabId !== null && tabId !== undefined) {
    template.push(
      { type: 'separator' },
      { label: 'Закрыть вкладку', click: () => win.webContents.send('tab-menu-close', tabId) },
      { label: 'Закрыть остальные', click: () => win.webContents.send('tab-menu-close-others', tabId) }
    );
  }
  Menu.buildFromTemplate(template).popup({ window: win });
});

// ---- IPC: настройки ----

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (event, next) => {
  settings = { ...settings, ...next };
  persistSettings(settings);
  BrowserWindow.getAllWindows().forEach((w) => applySpellcheck(w));
  return settings;
});

ipcMain.handle('choose-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---- IPC: недавние файлы ----

ipcMain.handle('get-recent-files', () => loadRecentFiles());

// ---- IPC: автосохранение / восстановление ----

ipcMain.handle('autosave-tab', (event, { recoveryId, filePath, fileName, titleText, html }) => {
  try {
    fs.writeFileSync(
      recoveryFilePath(recoveryId),
      JSON.stringify({ filePath, fileName, titleText, html, savedAt: Date.now() })
    );
  } catch (e) {}
});

ipcMain.handle('clear-recovery', (event, recoveryId) => {
  try {
    fs.unlinkSync(recoveryFilePath(recoveryId));
  } catch (e) {}
});

ipcMain.handle('list-recoveries', () => {
  try {
    return fs
      .readdirSync(recoveryDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(recoveryDir(), f), 'utf-8'));
          return { recoveryId: f.replace(/\.json$/, ''), ...data };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
});

// ---- IPC: файловые операции ----

ipcMain.handle('dialog-open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Все поддерживаемые', extensions: ['docx', 'txt', 'html', 'htm'] },
      { name: 'Word документ', extensions: ['docx'] },
      { name: 'Текстовый файл', extensions: ['txt'] },
      { name: 'HTML документ', extensions: ['html', 'htm'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readFileForEditor(result.filePaths[0]);
});

ipcMain.handle('open-path', async (event, filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return readFileForEditor(filePath);
});

async function readFileForEditor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let html;
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ path: filePath });
    html = result.value;
  } else if (ext === '.txt') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const esc = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = '<p>' + esc.split(/\r?\n/).join('</p><p>') + '</p>';
  } else {
    html = fs.readFileSync(filePath, 'utf-8');
  }
  addRecentFile(filePath);
  return { path: filePath, html, name: path.basename(filePath) };
}

async function writeFile(filePath, html) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const HTMLtoDOCX = require('html-to-docx');
    const buffer = await HTMLtoDOCX(html, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    });
    fs.writeFileSync(filePath, buffer);
  } else if (ext === '.txt') {
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

function formatFilters() {
  const all = {
    docx: { name: 'Word документ', extensions: ['docx'] },
    txt: { name: 'Текстовый файл', extensions: ['txt'] },
    html: { name: 'HTML документ', extensions: ['html'] },
  };
  const fmt = all[settings.defaultSaveFormat] ? settings.defaultSaveFormat : 'docx';
  const order = [fmt, ...Object.keys(all).filter((k) => k !== fmt)];
  return { fmt, filters: order.map((k) => all[k]) };
}

async function saveAsFlow(win, html, suggestedName) {
  const { fmt, filters } = formatFilters();
  const base = sanitizeFileName((suggestedName || '').replace(/\.(docx|txt|html?)$/i, ''));
  const defaultPath = settings.defaultSaveFolder
    ? path.join(settings.defaultSaveFolder, `${base}.${fmt}`)
    : `${base}.${fmt}`;
  const result = await dialog.showSaveDialog(win, { filters, defaultPath });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, html);
  addRecentFile(result.filePath);
  return { path: result.filePath, name: path.basename(result.filePath) };
}

ipcMain.handle('save-as-dialog', async (event, html, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return saveAsFlow(win, html, suggestedName);
});

ipcMain.handle('save-file', async (event, filePath, html, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  // Новый документ: если настроена папка по умолчанию — сохраняем в неё
  // без диалога, иначе как раньше спрашиваем через "Сохранить как".
  if (!filePath) {
    if (settings.defaultSaveFolder) {
      const { fmt } = formatFilters();
      const base = sanitizeFileName(suggestedName);
      try {
        fs.mkdirSync(settings.defaultSaveFolder, { recursive: true });
        const target = uniquePath(settings.defaultSaveFolder, base, `.${fmt}`);
        await writeFile(target, html);
        addRecentFile(target);
        return { path: target, name: path.basename(target) };
      } catch (e) {
        return saveAsFlow(win, html, suggestedName);
      }
    }
    return saveAsFlow(win, html, suggestedName);
  }

  // Существующий файл: если заголовок документа изменился, переименовываем
  // сам файл на диске вслед за ним (в той же папке, с тем же расширением).
  let targetPath = filePath;
  if (suggestedName) {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const currentBase = path.basename(filePath, ext);
    const desiredBase = sanitizeFileName(suggestedName);
    if (desiredBase && desiredBase !== currentBase) {
      const newPath = path.join(dir, `${desiredBase}${ext}`);
      if (newPath !== filePath && !fs.existsSync(newPath)) {
        try {
          fs.renameSync(filePath, newPath);
          targetPath = newPath;
          removeRecentFile(filePath);
        } catch (e) {}
      }
    }
  }

  await writeFile(targetPath, html);
  if (targetPath !== filePath) addRecentFile(targetPath);
  return { path: targetPath, name: path.basename(targetPath) };
});

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
