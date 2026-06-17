const { app, BrowserWindow, ipcMain, clipboard, Tray, Menu, nativeImage, dialog, desktopCapturer, screen, systemPreferences } = require('electron');
const path = require('path');
const { startServer, stopServer, getStatus, sendRTCToClient, setCaptureSignalHandler } = require('./src/server/index');
const { getLocalIP, generateQRCode, startMDNS, stopMDNS } = require('./src/server/network');
const inputController = require('./src/server/input-controller');
const supabaseConfig = require('./src/server/supabase-config');

const PORT = 7898;
let mainWindow = null;
let tray = null;
let serverInstance = null;
let localIP = '';
let connectionURL = '';
let remoteURL = '';   // public Supabase relay URL (from the register-session edge function)
let isQuitting = false;

// ─── Create QR Code Window ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 620,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'electron', 'qr-window.html'));

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── System Tray ────────────────────────────────────────────────────────────
function createTray() {
  // Create a simple tray icon (16x16 blue square)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVQ4T2NkYPj/n4EBFTAiC6ALoIthk0NWg9UL2NTgdAI2NTi9gKyGkBdQxHC5AJ8ahi1btrxnZGS8AHMrvlBCDwcAZwojEZfkZRQAAAAASUVORK5CYII='
  );

  tray = new Tray(icon);
  const displayURL = remoteURL || connectionURL;
  tray.setToolTip(`pcphone - ${displayURL}`);

  const updateContextMenu = () => {
    const status = getStatus();
    const activeURL = remoteURL || connectionURL;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `🖥️  pcphone`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: `📡  ${activeURL}`,
        click: () => {
          clipboard.writeText(activeURL);
        }
      },
      ...(remoteURL ? [{
        label: `🌐  Supabase relay: Active`,
        enabled: false
      }] : [{
        label: `⚠️  Sign in on the QR window to enable remote access`,
        enabled: false
      }]),
      {
        label: `👥  ${status.clients} client(s) connected`,
        enabled: false
      },
      {
        label: `📊  ${status.fps} FPS`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: '📷  Show QR Code',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: '🚀  Auto Start',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked,
            path: app.getPath('exe')
          });
        }
      },
      { type: 'separator' },
      {
        label: '❌  Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateContextMenu();
  // Update tray menu every 5 seconds for live stats
  setInterval(updateContextMenu, 5000);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────
function setupIPC() {
  let captureInterval = null;
  let frameIpcCount = 0;
  let lastFrameIpcLog = Date.now();

  console.log('[main] Setting up IPC handlers...');

  // Forward renderer logs to main process console
  ipcMain.on('renderer-log', (event, msg) => {
    console.log(msg);
  });

  ipcMain.on('start-capture-timer', (event, fps) => {
    if (captureInterval) clearInterval(captureInterval);
    const safeFps = Math.max(5, Math.min(Number(fps) || 60, 60));
    console.log(`[main] Starting capture timer at ${safeFps} FPS (interval: ${(1000 / safeFps).toFixed(1)}ms)`);
    captureInterval = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-tick');
      }
    }, 1000 / safeFps);
  });

  ipcMain.on('stop-capture-timer', () => {
    console.log('[main] Stopping capture timer');
    if (captureInterval) clearInterval(captureInterval);
    captureInterval = null;
  });

  ipcMain.handle('get-primary-source-id', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      console.log(`[main] Found ${sources.length} screen source(s):`, sources.map(s => s.id + ' (' + s.name + ')').join(', '));
      return sources.length > 0 ? sources[0].id : null;
    } catch (err) {
      console.error('[main] Failed to get desktop sources:', err.message);
      console.error('[main] Stack:', err.stack);
      return null;
    }
  });

  ipcMain.on('new-frame', (event, arrayBuffer) => {
    const buffer = Buffer.from(arrayBuffer);
    frameIpcCount++;
    // Log frame IPC stats every 5 seconds
    const now = Date.now();
    if (now - lastFrameIpcLog >= 5000) {
      console.log(`[main] Frame IPC: ${frameIpcCount} frames in 5s | Last frame size: ${(buffer.length / 1024).toFixed(1)} KB`);
      frameIpcCount = 0;
      lastFrameIpcLog = now;
    }
    const screenCapture = require('./src/server/screen-capture');
    screenCapture.handleRendererFrame(buffer);
  });

  ipcMain.on('rtc-to-client', (event, message) => {
    if (!message || !message.clientId) {
      console.warn('[main] rtc-to-client: missing clientId in message');
      return;
    }
    console.log(`[main] RTC signal to client ${message.clientId}: ${message.type}`);
    sendRTCToClient(message.clientId, message);
  });

  ipcMain.handle('get-cursor-position', () => {
    return screen.getCursorScreenPoint();
  });

  ipcMain.handle('get-screen-info', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor || 1;
    const logicalWidth = primaryDisplay.size.width;
    const logicalHeight = primaryDisplay.size.height;

    const info = {
      ...primaryDisplay.bounds,
      logicalWidth,
      logicalHeight,
      width: Math.round(logicalWidth * scaleFactor),
      height: Math.round(logicalHeight * scaleFactor),
      scaleFactor
    };
    console.log('[main] Screen info:', JSON.stringify(info));
    return info;
  });

  ipcMain.handle('get-connection-info', async () => {
    // The remote Supabase relay URL is the shareable one; fall back to LAN.
    const primaryURL = remoteURL || connectionURL;
    const qrCode = await generateQRCode(primaryURL);
    return {
      ip: localIP,
      port: PORT,
      url: connectionURL,
      remoteUrl: remoteURL,
      primaryUrl: primaryURL,
      qrCode: qrCode,
      mdnsUrl: `http://my-pc.local:${PORT}`
    };
  });

  // Renderer hands us the public relay URL after registering with Supabase.
  // We regenerate the QR for it and refresh the tray.
  ipcMain.handle('set-remote-url', async (event, info) => {
    remoteURL = (info && info.url) || '';
    console.log(`[main] Remote relay URL set: ${remoteURL || '(none)'}`);
    const qrCode = remoteURL ? await generateQRCode(remoteURL) : null;
    return { qrCode };
  });

  // Expose Supabase config (project URL + publishable key) to the renderer.
  ipcMain.handle('get-supabase-config', () => ({
    url: supabaseConfig.SUPABASE_URL,
    anonKey: supabaseConfig.SUPABASE_ANON_KEY,
    functionsUrl: supabaseConfig.functionsUrl,
    registerSessionUrl: supabaseConfig.registerSessionUrl,
    appUrl: supabaseConfig.appUrl,
    webAppUrl: supabaseConfig.webAppUrl
  }));

  // Input from a remote phone, relayed over the WebRTC data channel. Coordinates
  // are normalized (0..1); moveMouseAbsolute already expects normalized values.
  ipcMain.on('remote-input', async (event, msg) => {
    if (!msg || typeof msg.t !== 'string') return;
    try {
      switch (msg.t) {
        case 'move': await inputController.moveMouseAbsolute(msg.nx || 0, msg.ny || 0); break;
        case 'click': await inputController.leftClick(); break;
        case 'dblclick': await inputController.doubleClick(); break;
        case 'rightclick': await inputController.rightClick(); break;
        case 'scroll': await inputController.scroll(msg.dx || 0, msg.dy || 0); break;
        case 'text': await inputController.typeText(msg.text || ''); break;
        case 'key': await inputController.pressKey(msg.key || ''); break;
        case 'hotkey': await inputController.hotkey(msg.modifiers || [], msg.key || ''); break;
        default: break;
      }
    } catch (err) {
      console.error('[main] remote-input error:', err.message);
    }
  });

  ipcMain.handle('get-status', () => {
    return getStatus();
  });

  ipcMain.handle('get-clipboard', () => {
    return clipboard.readText();
  });

  ipcMain.handle('set-clipboard', (event, text) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('close-window', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.handle('minimize-window', () => {
    if (mainWindow) mainWindow.hide();
  });
}

// ─── macOS Screen Recording Permission ──────────────────────────────────────
// On macOS 10.15+, desktopCapturer/getUserMedia for the screen requires the
// "Screen Recording" permission. Once granted it only takes effect after a
// restart, so we warn the user up front rather than failing silently.
function checkScreenCapturePermission() {
  if (process.platform !== 'darwin') return;
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    console.log(`[pcphone] macOS screen recording permission: ${status}`);
    if (status !== 'granted') {
      dialog.showMessageBox({
        type: 'info',
        title: 'Screen Recording Permission Needed',
        message: 'pcphone needs Screen Recording permission to stream your screen.',
        detail: 'Open System Settings → Privacy & Security → Screen Recording, enable pcphone, then quit and reopen the app.',
        buttons: ['OK'],
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[pcphone] Could not query screen recording permission:', err.message);
  }
}

// ─── Startup Sequence ───────────────────────────────────────────────────────
async function startup() {
  try {
    console.log('[pcphone] ========================================');
    console.log('[pcphone] Starting pcphone Remote Desktop');
    console.log(`[pcphone] Platform: ${process.platform} (${process.arch})`);
    console.log('[pcphone] ========================================');

    // This is a tray/menu-bar app — hide the macOS Dock icon.
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }

    // Warn early if macOS screen recording permission is missing.
    checkScreenCapturePermission();

    // Setup IPC FIRST (before window creation)
    setupIPC();
    console.log('[pcphone] IPC handlers registered');

    // Detect local IP
    localIP = getLocalIP();
    connectionURL = `http://${localIP}:${PORT}`;
    console.log(`[pcphone] Local IP: ${localIP}`);
    console.log(`[pcphone] Connection URL: ${connectionURL}`);

    // Start web server
    console.log(`[pcphone] Starting HTTP/WS server on port ${PORT}...`);
    serverInstance = await startServer(PORT);
    setCaptureSignalHandler((message) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(`[main] RTC signal from server to capture: ${message.type} for ${message.clientId || 'unknown'}`);
        mainWindow.webContents.send('rtc-to-capture', message);
      } else {
        console.warn('[main] Cannot forward RTC signal - mainWindow not available');
      }
    });
    console.log(`[pcphone] ✅ Server started on port ${PORT}`);

    // Start mDNS advertisement
    startMDNS(PORT);
    console.log(`[pcphone] ✅ mDNS advertised as my-pc.local:${PORT}`);

    // Remote access is now provided by the Supabase relay instead of localtunnel.
    // The QR window signs the host into Supabase, calls the register-session edge
    // function, and reports the public URL back via the 'set-remote-url' IPC.
    console.log('[pcphone] Remote access via Supabase relay — sign in on the QR window.');

    // Create window and tray
    console.log('[pcphone] Creating window and tray...');
    createWindow();
    createTray();
    console.log('[pcphone] ✅ Window and tray created');

    // Start periodic status updates to renderer
    setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', getStatus());
      }
    }, 1000);

    console.log('[pcphone] ========================================');
    console.log('[pcphone] ✅ Ready! Scan the QR code with any phone.');
    console.log('[pcphone] ========================================');
  } catch (err) {
    console.error('[pcphone] ❌ Startup error:', err.message);
    console.error('[pcphone] Stack:', err.stack);
    dialog.showErrorBox('Startup Error', err.message);
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(startup);

app.on('window-all-closed', (e) => {
  console.log('[pcphone] All windows closed - staying in tray');
});

app.on('before-quit', () => {
  console.log('[pcphone] Application quitting...');
  isQuitting = true;
  stopMDNS();
  stopServer();
  console.log('[pcphone] Cleanup complete');
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
