const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog-open'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  saveFile: (filePath, html, suggestedName) => ipcRenderer.invoke('save-file', filePath, html, suggestedName),
  saveAsDialog: (html, suggestedName) => ipcRenderer.invoke('save-as-dialog', html, suggestedName),
  exportPdf: (html) => ipcRenderer.invoke('export-pdf', html),
  exportDocx: (html) => ipcRenderer.invoke('export-docx', html),
  insertImageDialog: () => ipcRenderer.invoke('insert-image-dialog'),
  print: () => ipcRenderer.invoke('print'),
  setWindowTitle: (title) => ipcRenderer.invoke('set-window-title', title),
  confirmClose: () => ipcRenderer.invoke('confirm-close'),

  zoomIn: () => ipcRenderer.invoke('zoom-in'),
  zoomOut: () => ipcRenderer.invoke('zoom-out'),
  zoomReset: () => ipcRenderer.invoke('zoom-reset'),
  setZoomFactor: (f) => ipcRenderer.invoke('set-zoom-factor', f),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),

  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: (manual) => ipcRenderer.invoke('check-for-updates', manual),
  startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  showRecentItemMenu: (filePath) => ipcRenderer.invoke('show-recent-item-menu', filePath),
  showTabContextMenu: (tabId) => ipcRenderer.invoke('show-tab-context-menu', tabId),

  listVersions: (filePath) => ipcRenderer.invoke('list-versions', filePath),
  readVersion: (filePath, ts) => ipcRenderer.invoke('read-version', filePath, ts),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  autosaveTab: (data) => ipcRenderer.invoke('autosave-tab', data),
  clearRecovery: (id) => ipcRenderer.invoke('clear-recovery', id),
  listRecoveries: () => ipcRenderer.invoke('list-recoveries'),

  onApplyTheme: (cb) => ipcRenderer.on('apply-theme', (e, theme) => cb(theme)),
  onRecentFilesChanged: (cb) => ipcRenderer.on('recent-files-changed', cb),
  onCloseRequested: (cb) => ipcRenderer.on('app-close-requested', cb),
  onTriggerInsertLink: (cb) => ipcRenderer.on('trigger-insert-link', cb),
  onOpenRecentPath: (cb) => ipcRenderer.on('open-recent-path', (e, p) => cb(p)),
  onTabMenuNew: (cb) => ipcRenderer.on('tab-menu-new', cb),
  onTabMenuClose: (cb) => ipcRenderer.on('tab-menu-close', (e, id) => cb(id)),
  onTabMenuCloseOthers: (cb) => ipcRenderer.on('tab-menu-close-others', (e, id) => cb(id)),
  onTableOp: (cb) => ipcRenderer.on('table-op', (e, op) => cb(op)),

  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, info) => cb(info)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', cb),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (e, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (e, err) => cb(err)),
});
