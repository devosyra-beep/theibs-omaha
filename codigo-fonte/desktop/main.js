'use strict';
const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('node:path');
const { ensureInitialHistory } = require('../src/data-bootstrap');
let mainWindow, localServer, localOrigin;

async function startLocalEngine() {
  // Keep the original package name / appId: changing userData silently would
  // orphan the user's existing history. Explicit environment paths still work.
  process.env.THEIBS_DATA_PATH ||= path.join(app.getPath('userData'), 'training-events.jsonl');
  process.env.THEIBS_WORKSPACE_PATH ||= path.join(path.dirname(process.env.THEIBS_DATA_PATH), 'workspace.json');
  ensureInitialHistory(process.env.THEIBS_DATA_PATH, path.join(__dirname, '..', 'data', 'training-events.jsonl'));
  const { server } = require('../server');
  localServer = server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  localOrigin = `http://127.0.0.1:${server.address().port}`;
}
function sameOrigin(url) {
  try { return new URL(url).origin === localOrigin; } catch { return false; }
}
async function showWindow() {
  if (!localServer) await startLocalEngine();
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); return; }
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1024, minHeight: 700,
    show: false, backgroundColor: '#09090b', autoHideMenuBar: true,
    title: 'THEIBS · Laboratório Omaha',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!sameOrigin(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-redirect', (event, url) => { if (!sameOrigin(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('will-prevent-unload', async () => {
    // Default is to cancel closing while the renderer still has an unsaved draft.
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'warning', buttons: ['Continuar no aplicativo', 'Fechar sem salvar'], defaultId: 0, cancelId: 0,
      title: 'Há alterações não salvas', message: 'O rascunho ainda não foi salvo.',
      detail: 'Aguarde a indicação “Salvo localmente”. O histórico já registrado não será removido.'
    });
    if (answer.response === 1) mainWindow?.destroy();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(localOrigin + '/');
  mainWindow.show(); mainWindow.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    // No microphone, camera, geolocation, clipboard reading or remote navigation.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(Boolean(contents && sameOrigin(contents.getURL()) && permission === 'clipboard-sanitized-write'));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) =>
      Boolean(contents && sameOrigin(origin) && permission === 'clipboard-sanitized-write'));
    session.defaultSession.on('will-download', (event, item, contents) => {
      const url = item.getURL();
      if (!contents || !sameOrigin(contents.getURL()) || !url.startsWith(`blob:${localOrigin}/`) || !/^THEIBS-PLO[456]-entrada\.json$/.test(item.getFilename())) {
        event.preventDefault(); return;
      }
      // Electron opens a native save dialog. No silent write outside app data.
      item.setSaveDialogOptions({ title: 'Salvar entrada de cartas', defaultPath: item.getFilename(), filters: [{ name: 'JSON', extensions: ['json'] }] });
    });
    await showWindow();
  }).catch((error) => { dialog.showErrorBox('THEIBS não iniciou', error.message); app.quit(); });
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('activate', () => { if (!mainWindow) showWindow().catch(error => dialog.showErrorBox('THEIBS', error.message)); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (!BrowserWindow.getAllWindows().length && localServer?.listening) localServer.close(); });
  app.on('will-quit', () => { if (localServer?.listening) localServer.close(); });
}
