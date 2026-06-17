const { app, BrowserWindow, ipcMain, clipboard, Tray, Menu, nativeImage, dialog, desktopCapturer, screen } = require('electron');
const path = require('path');
const { startServer, stopServer, getStatus, sendRTCToClient, setCaptureSignalHandler } = require('./src/server/index');
const { getLocalIP, generateQRCode, startMDNS, stopMDNS, startTunnel, getTunnelUrl } = require('./src/server/network');

const PORT = 7898;
let mainWindow = null;
let tray = null;
let serverInstance = null;
let localIP = '';
let connectionURL = '';
let tunnelURL = '';
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
  const displayURL = tunnelURL || connectionURL;
  tray.setToolTip(`Magical Newton - ${displayURL}`);

  const updateContextMenu = () => {
    const status = getStatus();
    const activeURL = tunnelURL || connectionURL;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `🖥️  Magical Newton`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: `📡  ${activeURL}`,
        click: () => {
          clipboard.writeText(activeURL);
        }
      },
      ...(tunnelURL ? [{
        label: `🌐  Tunnel: Active`,
        enabled: false
      }] : [{
        label: `⚠️  Local only: ${connectionURL}`,
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
    // Prioritize the fast local Wi-Fi link over the tunnel for the QR code
    const primaryURL = connectionURL || tunnelURL;
    const qrCode = await generateQRCode(primaryURL);
    return {
      ip: localIP,
      port: PORT,
      url: connectionURL,
      tunnelUrl: tunnelURL,
      primaryUrl: primaryURL,
      qrCode: qrCode,
      mdnsUrl: `http://my-pc.local:${PORT}`
    };
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

// ─── Startup Sequence ───────────────────────────────────────────────────────
async function startup() {
  try {
    console.log('[Magical Newton] ========================================');
    console.log('[Magical Newton] Starting Magical Newton Remote Desktop');
    console.log('[Magical Newton] ========================================');

    // Setup IPC FIRST (before window creation)
    setupIPC();
    console.log('[Magical Newton] IPC handlers registered');

    // Detect local IP
    localIP = getLocalIP();
    connectionURL = `http://${localIP}:${PORT}`;
    console.log(`[Magical Newton] Local IP: ${localIP}`);
    console.log(`[Magical Newton] Connection URL: ${connectionURL}`);

    // Start web server
    console.log(`[Magical Newton] Starting HTTP/WS server on port ${PORT}...`);
    serverInstance = await startServer(PORT);
    setCaptureSignalHandler((message) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(`[main] RTC signal from server to capture: ${message.type} for ${message.clientId || 'unknown'}`);
        mainWindow.webContents.send('rtc-to-capture', message);
      } else {
        console.warn('[main] Cannot forward RTC signal - mainWindow not available');
      }
    });
    console.log(`[Magical Newton] ✅ Server started on port ${PORT}`);

    // Start mDNS advertisement
    startMDNS(PORT);
    console.log(`[Magical Newton] ✅ mDNS advertised as my-pc.local:${PORT}`);

    // Start localtunnel
    console.log('[Magical Newton] Starting tunnel...');
    tunnelURL = await startTunnel(PORT);
    if (tunnelURL) {
      console.log(`[Magical Newton] ✅ Tunnel URL: ${tunnelURL}`);
    } else {
      console.log('[Magical Newton] ⚠️  Tunnel failed - using local network only');
    }

    // Create window and tray
    console.log('[Magical Newton] Creating window and tray...');
    createWindow();
    createTray();
    console.log('[Magical Newton] ✅ Window and tray created');

    // Start periodic status updates to renderer
    setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', getStatus());
      }
    }, 1000);

    console.log('[Magical Newton] ========================================');
    console.log('[Magical Newton] ✅ Ready! Scan the QR code with your iPhone.');
    console.log('[Magical Newton] ========================================');
  } catch (err) {
    console.error('[Magical Newton] ❌ Startup error:', err.message);
    console.error('[Magical Newton] Stack:', err.stack);
    dialog.showErrorBox('Startup Error', err.message);
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(startup);

app.on('window-all-closed', (e) => {
  console.log('[Magical Newton] All windows closed - staying in tray');
});

app.on('before-quit', () => {
  console.log('[Magical Newton] Application quitting...');
  isQuitting = true;
  stopMDNS();
  stopServer();
  console.log('[Magical Newton] Cleanup complete');
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
