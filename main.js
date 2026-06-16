const { app, BrowserWindow, ipcMain, clipboard, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { startServer, stopServer, getStatus } = require('./src/server/index');
const { getLocalIP, generateQRCode, startMDNS, stopMDNS, startNgrokTunnel, getNgrokUrl } = require('./src/server/network');

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
      sandbox: false
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
  ipcMain.handle('get-connection-info', async () => {
    const primaryURL = tunnelURL || connectionURL;
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
    if (mainWindow) mainWindow.minimize();
  });
}

// ─── Startup Sequence ───────────────────────────────────────────────────────
async function startup() {
  try {
    // Setup IPC FIRST (before window creation)
    setupIPC();

    // Detect local IP
    localIP = getLocalIP();
    connectionURL = `http://${localIP}:${PORT}`;
    console.log(`[Magical Newton] Local IP: ${localIP}`);
    console.log(`[Magical Newton] Connection URL: ${connectionURL}`);

    // Start web server
    serverInstance = await startServer(PORT);
    console.log(`[Magical Newton] Server started on port ${PORT}`);

    // Start mDNS advertisement
    startMDNS(PORT);
    console.log(`[Magical Newton] mDNS advertised as my-pc.local:${PORT}`);

    // Start ngrok tunnel
    console.log('[Magical Newton] Starting ngrok tunnel...');
    tunnelURL = await startNgrokTunnel(PORT);
    if (tunnelURL) {
      console.log(`[Magical Newton] 🌐 Tunnel URL: ${tunnelURL}`);
    } else {
      console.log('[Magical Newton] ⚠️  Ngrok tunnel failed - using local network only');
      console.log('[Magical Newton] Set NGROK_AUTHTOKEN environment variable to enable tunneling');
    }

    // Create window and tray
    createWindow();
    createTray();

    console.log('[Magical Newton] Ready! Scan the QR code with your iPhone.');
  } catch (err) {
    console.error('[Magical Newton] Startup error:', err);
    dialog.showErrorBox('Startup Error', err.message);
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(startup);

app.on('window-all-closed', (e) => {
  // Don't quit on window close - keep running in tray
});

app.on('before-quit', () => {
  isQuitting = true;
  stopMDNS();
  stopServer();
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
