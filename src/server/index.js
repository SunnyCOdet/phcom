const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const screenCapture = require('./screen-capture');
const inputController = require('./input-controller');
const clipboard = require('./clipboard');
const appLauncher = require('./app-launcher');
const fileUpload = require('./file-upload');
const mediaKeys = require('./media-keys');

// Server state
let server = null;
let wss = null;
let heartbeatInterval = null;
const clients = new Set();

/**
 * Create and configure the Express app.
 */
function createApp() {
  const app = express();

  // Parse JSON request bodies
  app.use(express.json());

  // Serve static files from src/public
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // --- REST API Endpoints ---

  // GET /api/status — server status + metrics
  app.get('/api/status', (req, res) => {
    try {
      const stats = screenCapture.getStats();
      res.json({
        status: 'ok',
        clients: clients.size,
        fps: stats.fps,
        capture: stats,
      });
    } catch (err) {
      console.error('[server] /api/status error:', err.message);
      res.status(500).json({ status: 'error', message: err.message });
    }
  });

  // GET /api/apps — list available apps
  app.get('/api/apps', (req, res) => {
    try {
      const apps = appLauncher.getApps();
      res.json({ success: true, apps });
    } catch (err) {
      console.error('[server] /api/apps error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/launch — launch an application
  app.post('/api/launch', async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name) {
        return res.status(400).json({ success: false, message: 'Missing app name' });
      }
      const result = await appLauncher.launchApp(name);
      res.json(result);
    } catch (err) {
      console.error('[server] /api/launch error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/clipboard — get clipboard text
  app.get('/api/clipboard', async (req, res) => {
    try {
      const text = await clipboard.getClipboard();
      res.json({ success: true, text });
    } catch (err) {
      console.error('[server] /api/clipboard GET error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/clipboard — set clipboard text
  app.post('/api/clipboard', async (req, res) => {
    try {
      const { text } = req.body || {};
      if (typeof text !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing text field' });
      }
      await clipboard.setClipboard(text);
      res.json({ success: true });
    } catch (err) {
      console.error('[server] /api/clipboard POST error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/upload — file upload
  app.post('/api/upload', fileUpload.upload.single('file'), fileUpload.handleUpload);

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error('[server] Express error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  return app;
}

/**
 * Broadcast a binary WebP frame to all connected WebSocket clients.
 * @param {Buffer} buffer - WebP image buffer
 */
function broadcastFrame(buffer) {
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(buffer, { binary: true }, (err) => {
          if (err) {
            console.error('[server] Send frame error:', err.message);
          }
        });
      } catch (err) {
        console.error('[server] Broadcast error:', err.message);
      }
    }
  }
}

/**
 * Handle incoming WebSocket JSON message and route to appropriate handler.
 * @param {object} msg - Parsed JSON message
 * @param {import('ws').WebSocket} ws - WebSocket client
 */
async function handleWSMessage(msg, ws) {
  try {
    switch (msg.type) {
      case 'mousemove':
        await inputController.moveMouse(msg.dx || 0, msg.dy || 0);
        break;

      case 'mousemove_abs':
        await inputController.moveMouseAbsolute(msg.x || 0, msg.y || 0);
        break;

      case 'click':
        await inputController.leftClick();
        break;

      case 'dblclick':
        await inputController.doubleClick();
        break;

      case 'rightclick':
        await inputController.rightClick();
        break;

      case 'scroll':
        await inputController.scroll(msg.deltaX || 0, msg.deltaY || 0);
        break;

      case 'mousedown':
        await inputController.mouseDown();
        break;

      case 'mouseup':
        await inputController.mouseUp();
        break;

      case 'keytype':
        await inputController.typeText(msg.text || '');
        break;

      case 'keypress':
        await inputController.pressKey(msg.key || '');
        break;

      case 'hotkey':
        await inputController.hotkey(msg.modifiers || [], msg.key || '');
        break;

      case 'media':
        const mediaResult = await mediaKeys.mediaAction(msg.action || '');
        sendJSON(ws, { type: 'media-result', ...mediaResult });
        break;

      case 'getclipboard': {
        try {
          const text = await clipboard.getClipboard();
          sendJSON(ws, { type: 'clipboard', text });
        } catch (err) {
          sendJSON(ws, { type: 'clipboard-error', message: err.message });
        }
        break;
      }

      case 'setclipboard': {
        try {
          await clipboard.setClipboard(msg.text || '');
          sendJSON(ws, { type: 'clipboard-set', success: true });
        } catch (err) {
          sendJSON(ws, { type: 'clipboard-error', message: err.message });
        }
        break;
      }

      default:
        console.warn(`[server] Unknown message type: ${msg.type}`);
        break;
    }
  } catch (err) {
    console.error(`[server] Error handling message type "${msg.type}":`, err.message);
  }
}

/**
 * Send a JSON message to a WebSocket client.
 * @param {import('ws').WebSocket} ws
 * @param {object} data
 */
function sendJSON(ws, data) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  } catch (err) {
    console.error('[server] sendJSON error:', err.message);
  }
}

/**
 * Set up WebSocket server event handlers.
 */
function setupWebSocket() {
  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`[server] WebSocket client connected: ${clientIP}`);

    // Add to clients set
    clients.add(ws);
    screenCapture.setClientCount(clients.size);

    // Mark as alive for heartbeat
    ws.isAlive = true;

    // Send welcome message
    sendJSON(ws, {
      type: 'welcome',
      message: 'Connected to Magical Newton Remote Desktop',
      clients: clients.size,
    });

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        // Only handle text messages (JSON), binary messages are ignored
        if (typeof data === 'string' || (Buffer.isBuffer(data) && !isBinaryFrame(data))) {
          const msg = JSON.parse(data.toString());
          handleWSMessage(msg, ws);
        }
      } catch (err) {
        // Not JSON or parse error — ignore silently
        if (err instanceof SyntaxError) {
          console.warn('[server] Invalid JSON from client');
        } else {
          console.error('[server] WebSocket message error:', err.message);
        }
      }
    });

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle disconnect
    ws.on('close', (code, reason) => {
      console.log(`[server] WebSocket client disconnected: ${clientIP} (code: ${code})`);
      clients.delete(ws);
      screenCapture.setClientCount(clients.size);
    });

    // Handle errors
    ws.on('error', (err) => {
      console.error(`[server] WebSocket client error: ${err.message}`);
      clients.delete(ws);
      screenCapture.setClientCount(clients.size);
    });
  });

  wss.on('error', (err) => {
    console.error('[server] WebSocket server error:', err.message);
  });
}

/**
 * Check if a buffer looks like a binary frame (not JSON text).
 * @param {Buffer} data
 * @returns {boolean}
 */
function isBinaryFrame(data) {
  if (data.length === 0) return false;
  // JSON starts with '{' or '[' (0x7B or 0x5B)
  const firstByte = data[0];
  return firstByte !== 0x7B && firstByte !== 0x5B;
}

/**
 * Start heartbeat to detect dead connections.
 */
function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    if (!wss) return;

    for (const ws of clients) {
      if (ws.isAlive === false) {
        console.log('[server] Terminating unresponsive client');
        clients.delete(ws);
        screenCapture.setClientCount(clients.size);
        ws.terminate();
        continue;
      }

      ws.isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        // Client already gone
        clients.delete(ws);
        screenCapture.setClientCount(clients.size);
      }
    }
  }, 10000); // Every 10 seconds
}

/**
 * Get current server status.
 * @returns {object}
 */
function getStatus() {
  const stats = screenCapture.getStats();
  return {
    status: 'ok',
    clients: clients.size,
    fps: stats.fps,
    capture: stats,
  };
}

/**
 * Start the server on the given port.
 * @param {number} [port=7898] - Port to listen on
 * @returns {Promise<http.Server>}
 */
function startServer(port = 7898) {
  return new Promise((resolve, reject) => {
    try {
      const app = createApp();

      // Create HTTP server
      server = http.createServer(app);

      // Create WebSocket server attached to HTTP server
      wss = new WebSocketServer({ server });
      setupWebSocket();

      // Start heartbeat
      startHeartbeat();

      // Start screen capture with broadcast function
      screenCapture.start(broadcastFrame);

      // Listen on port
      server.listen(port, '0.0.0.0', () => {
        console.log(`[server] HTTP server listening on 0.0.0.0:${port}`);
        console.log(`[server] WebSocket server ready`);
        console.log(`[server] Screen capture started`);
        resolve(server);
      });

      server.on('error', (err) => {
        console.error('[server] HTTP server error:', err.message);
        if (err.code === 'EADDRINUSE') {
          console.error(`[server] Port ${port} is already in use`);
        }
        reject(err);
      });
    } catch (err) {
      console.error('[server] Failed to start server:', err.message);
      reject(err);
    }
  });
}

/**
 * Stop the server and cleanup all resources.
 * @returns {Promise<void>}
 */
function stopServer() {
  return new Promise((resolve) => {
    console.log('[server] Shutting down...');

    // Stop screen capture
    try {
      screenCapture.stop();
    } catch (err) {
      console.error('[server] Error stopping screen capture:', err.message);
    }

    // Stop heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // Close all WebSocket clients
    for (const client of clients) {
      try {
        client.terminate();
      } catch (err) {
        // Ignore
      }
    }
    clients.clear();

    // Close WebSocket server
    if (wss) {
      try {
        wss.close();
      } catch (err) {
        console.error('[server] Error closing WebSocket server:', err.message);
      }
      wss = null;
    }

    // Close HTTP server
    if (server) {
      server.close((err) => {
        if (err) {
          console.error('[server] Error closing HTTP server:', err.message);
        }
        server = null;
        console.log('[server] Server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  startServer,
  stopServer,
  getStatus,
};
