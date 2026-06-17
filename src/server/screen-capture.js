// Capture state
let isCapturing = false;
let broadcastCallback = null;
let connectedClientCount = 0;

// Stats tracking
let frameCount = 0;
let fps = 0;
let fpsInterval = null;
let totalBytesThisPeriod = 0;
let droppedFrames = 0;
let statsLogInterval = null;

const DEFAULT_SETTINGS = {
  quality: 95,
  maxFps: 60,
  maxWidth: 3840,
  maxHeight: 2160,
};

let streamSettings = { ...DEFAULT_SETTINGS };

console.log('[screen-capture] Module loaded, default settings:', JSON.stringify(DEFAULT_SETTINGS));

/**
 * Update the connected client count.
 * @param {number} count
 */
function setClientCount(count) {
  const oldCount = connectedClientCount;
  connectedClientCount = count;
  if (oldCount !== count) {
    console.log(`[screen-capture] Client count changed: ${oldCount} -> ${count}`);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function updateSettings(nextSettings = {}) {
  const oldSettings = { ...streamSettings };

  if (Number.isFinite(nextSettings.quality)) {
    streamSettings.quality = clamp(Math.round(nextSettings.quality), 30, 100);
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

  console.log('[screen-capture] Settings updated:', JSON.stringify(oldSettings), '->', JSON.stringify(streamSettings));

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
  if (!isCapturing) {
    droppedFrames++;
    return;
  }
  
  frameCount++;
  totalBytesThisPeriod += buffer.length;
  
  // Broadcast the frame buffer directly to all WebSocket clients
  if (broadcastCallback) {
    try {
      broadcastCallback(buffer);
    } catch (err) {
      console.error('[screen-capture] Broadcast frame error:', err.message);
      console.error('[screen-capture] Broadcast error stack:', err.stack);
    }
  }
}

/**
 * Start the screen capture monitoring.
 * @param {Function} broadcastFn - Function that receives frame buffers to send to clients
 */
function start(broadcastFn) {
  if (isCapturing) {
    console.warn('[screen-capture] Already capturing, ignoring start()');
    return;
  }

  console.log('[screen-capture] ========================================');
  console.log('[screen-capture] Starting capture listener (Renderer-driven)');
  console.log('[screen-capture] Current settings:', JSON.stringify(streamSettings));
  console.log('[screen-capture] ========================================');
  
  broadcastCallback = broadcastFn;
  isCapturing = true;
  frameCount = 0;
  fps = 0;
  totalBytesThisPeriod = 0;
  droppedFrames = 0;

  // FPS counter: calculate every second
  fpsInterval = setInterval(() => {
    fps = frameCount;
    frameCount = 0;
  }, 1000);

  // Detailed stats log every 5 seconds
  statsLogInterval = setInterval(() => {
    const avgFrameSize = fps > 0 ? Math.round(totalBytesThisPeriod / Math.max(1, fps * 5)) : 0;
    console.log(`[screen-capture] Stats: ${fps} FPS | Avg frame: ${(avgFrameSize / 1024).toFixed(1)} KB | Clients: ${connectedClientCount} | Dropped: ${droppedFrames} | Quality: ${streamSettings.quality}`);
    totalBytesThisPeriod = 0;
    droppedFrames = 0;
  }, 5000);
}

/**
 * Stop the screen capture monitoring.
 */
function stop() {
  console.log('[screen-capture] Stopping capture listener');
  console.log('[screen-capture] Final stats: FPS was', fps, '| Settings:', JSON.stringify(streamSettings));
  
  isCapturing = false;
  broadcastCallback = null;

  if (fpsInterval) {
    clearInterval(fpsInterval);
    fpsInterval = null;
  }

  if (statsLogInterval) {
    clearInterval(statsLogInterval);
    statsLogInterval = null;
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
