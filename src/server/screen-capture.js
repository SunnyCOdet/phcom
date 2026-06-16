// Capture state
let isCapturing = false;
let broadcastCallback = null;
let connectedClientCount = 0;

// Stats tracking
let frameCount = 0;
let fps = 0;
let fpsInterval = null;

/**
 * Update the connected client count.
 * @param {number} count
 */
function setClientCount(count) {
  connectedClientCount = count;
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
  };
}

module.exports = {
  start,
  stop,
  getStats,
  setClientCount,
  handleRendererFrame,
};
