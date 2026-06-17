// Capture state
let isCapturing = false;
let broadcastCallback = null;
let connectedClientCount = 0;

// Stats tracking
let frameCount = 0;
let fps = 0;
let fpsInterval = null;

const DEFAULT_SETTINGS = {
  quality: 90,
  maxFps: 60,
  maxWidth: 3840,
  maxHeight: 2160,
};

let streamSettings = { ...DEFAULT_SETTINGS };

/**
 * Update the connected client count.
 * @param {number} count
 */
function setClientCount(count) {
  connectedClientCount = count;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function updateSettings(nextSettings = {}) {
  if (Number.isFinite(nextSettings.quality)) {
    streamSettings.quality = clamp(Math.round(nextSettings.quality), 30, 95);
  }

  if (Number.isFinite(nextSettings.maxFps)) {
    streamSettings.maxFps = clamp(Math.round(nextSettings.maxFps), 5, 60);
  }

  if (Number.isFinite(nextSettings.maxWidth)) {
    streamSettings.maxWidth = clamp(Math.round(nextSettings.maxWidth), 640, 3840);
  }

  if (Number.isFinite(nextSettings.maxHeight)) {
    streamSettings.maxHeight = clamp(Math.round(nextSettings.maxHeight), 360, 2160);
  }

  return getSettings();
}

function getSettings() {
  return { ...streamSettings };
}

/**
 * Handle a pre-compressed frame received from the Electron renderer process.
 * @param {Buffer} buffer - Compressed JPEG frame buffer
 */
function handleRendererFrame(buffer) {
  if (!isCapturing) return;
  
  frameCount++;
  
  // Broadcast the frame buffer directly to all WebSocket clients
  if (broadcastCallback) {
    try {
      broadcastCallback(buffer);
    } catch (err) {
      console.error('[screen-capture] Broadcast frame error:', err.message);
    }
  }
}

/**
 * Start the screen capture monitoring.
 * @param {Function} broadcastFn - Function that receives frame buffers to send to clients
 */
function start(broadcastFn) {
  if (isCapturing) {
    console.warn('[screen-capture] Already capturing');
    return;
  }

  console.log('[screen-capture] Starting capture listener (Renderer-driven)');
  broadcastCallback = broadcastFn;
  isCapturing = true;
  frameCount = 0;
  fps = 0;

  // FPS counter: calculate every second
  fpsInterval = setInterval(() => {
    fps = frameCount;
    frameCount = 0;
  }, 1000);
}

/**
 * Stop the screen capture monitoring.
 */
function stop() {
  console.log('[screen-capture] Stopping capture listener');
  isCapturing = false;
  broadcastCallback = null;

  if (fpsInterval) {
    clearInterval(fpsInterval);
    fpsInterval = null;
  }
}

/**
 * Get current capture statistics.
 * @returns {{ fps: number, isCapturing: boolean }}
 */
function getStats() {
  return {
    fps,
    avgCaptureMs: 0,
    avgEncodeMs: 0,
    totalFrameMs: 0,
    isCapturing,
    settings: getSettings(),
  };
}

module.exports = {
  start,
  stop,
  getStats,
  getSettings,
  updateSettings,
  setClientCount,
  handleRendererFrame,
};
