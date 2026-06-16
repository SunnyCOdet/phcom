const { screen, mouse } = require('@nut-tree-fork/nut-js');
const sharp = require('sharp');

// Capture state
let isCapturing = false;
let broadcastCallback = null;
let connectedClientCount = 0;

// Stats tracking
let frameCount = 0;
let fps = 0;
let fpsInterval = null;
let lastCaptureTime = 0;
let avgCaptureMs = 0;
let avgEncodeMs = 0;

// Configuration
const MAX_WIDTH = 1280;
const WEBP_QUALITY = 60;
const WEBP_EFFORT = 0; // 0 = fastest encoding

// White mouse cursor SVG with black outline for high contrast
const cursorSvg = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 0 V17.2 L4.4 12.8 L10 18.4 L11.9 16.5 L6.3 10.9 L11.7 10.9 Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>
</svg>
`;
const cursorBuffer = Buffer.from(cursorSvg);

/**
 * Update the connected client count (used to skip frames when no clients).
 * @param {number} count
 */
function setClientCount(count) {
  connectedClientCount = count;
}

/**
 * Capture a single frame, resize, encode as WebP, and broadcast.
 */
async function captureFrame() {
  if (!isCapturing) return;

  // Skip frame if no clients are connected
  if (connectedClientCount <= 0) {
    setTimeout(captureFrame, 100); // Check again in 100ms
    return;
  }

  try {
    const captureStart = Date.now();

    // Use nut-js for extremely fast raw RGB/BGR frame capture
    const img = await screen.grab();
    
    // Get mouse cursor position
    let mousePos = null;
    try {
      mousePos = await mouse.getPosition();
    } catch (err) {
      // Ignore errors when querying mouse position
    }

    const captureEnd = Date.now();
    const captureMs = captureEnd - captureStart;

    const encodeStart = Date.now();
    
    // nut-js on Windows returns BGRA. We must swap Blue (0) and Red (2) channels.
    const buf = img.data;
    for (let i = 0; i < buf.length; i += 4) {
      const b = buf[i];
      buf[i] = buf[i + 2];
      buf[i + 2] = b;
    }

    // Prepare Sharp pipeline
    let imagePipeline = sharp(buf, {
      raw: {
        width: img.width,
        height: img.height,
        channels: img.channels,
      }
    })
      .resize({
        width: MAX_WIDTH,
        withoutEnlargement: true,
        fit: 'inside',
      });

    // Composite the cursor if mouse position is valid
    if (mousePos) {
      let scale = 1;
      if (img.width > MAX_WIDTH) {
        scale = MAX_WIDTH / img.width;
      }
      const scaledX = Math.round(mousePos.x * scale);
      const scaledY = Math.round(mousePos.y * scale);
      
      const widthScaled = Math.round(img.width * scale);
      const heightScaled = Math.round(img.height * scale);
      
      const clampedX = Math.max(0, Math.min(scaledX, widthScaled - 1));
      const clampedY = Math.max(0, Math.min(scaledY, heightScaled - 1));

      imagePipeline = imagePipeline.composite([{
        input: cursorBuffer,
        left: clampedX,
        top: clampedY
      }]);
    }

    // Resize and encode as WebP for maximum compression + speed
    const webpBuffer = await imagePipeline
      .webp({
        quality: WEBP_QUALITY,
        effort: WEBP_EFFORT,
        smartSubsample: false,
        nearLossless: false,
      })
      .toBuffer();

    const encodeEnd = Date.now();
    const encodeMs = encodeEnd - encodeStart;

    // Update stats with exponential moving average
    avgCaptureMs = avgCaptureMs === 0 ? captureMs : avgCaptureMs * 0.8 + captureMs * 0.2;
    avgEncodeMs = avgEncodeMs === 0 ? encodeMs : avgEncodeMs * 0.8 + encodeMs * 0.2;

    frameCount++;
    lastCaptureTime = Date.now();

    // Broadcast the WebP buffer to all clients
    if (broadcastCallback) {
      broadcastCallback(webpBuffer);
    }
  } catch (err) {
    console.error('[screen-capture] Frame capture error:', err.message);
  }

  // Schedule next frame IMMEDIATELY after current frame completes
  // Using setImmediate for lowest possible latency
  if (isCapturing) {
    setImmediate(captureFrame);
  }
}

/**
 * Start the screen capture loop.
 * @param {Function} broadcastFn - Function that receives WebP buffer to send to clients
 */
function start(broadcastFn) {
  if (isCapturing) {
    console.warn('[screen-capture] Already capturing');
    return;
  }

  console.log('[screen-capture] Starting capture loop (nut-js)');
  broadcastCallback = broadcastFn;
  isCapturing = true;
  frameCount = 0;
  fps = 0;
  avgCaptureMs = 0;
  avgEncodeMs = 0;

  // FPS counter: calculate every second
  fpsInterval = setInterval(() => {
    fps = frameCount;
    frameCount = 0;
  }, 1000);

  // Start the adaptive capture loop
  setImmediate(captureFrame);
}

/**
 * Stop the screen capture loop.
 */
function stop() {
  console.log('[screen-capture] Stopping capture loop');
  isCapturing = false;
  broadcastCallback = null;

  if (fpsInterval) {
    clearInterval(fpsInterval);
    fpsInterval = null;
  }
}

/**
 * Get current capture statistics.
 * @returns {{ fps: number, avgCaptureMs: number, avgEncodeMs: number, isCapturing: boolean }}
 */
function getStats() {
  return {
    fps,
    avgCaptureMs: Math.round(avgCaptureMs),
    avgEncodeMs: Math.round(avgEncodeMs),
    totalFrameMs: Math.round(avgCaptureMs + avgEncodeMs),
    isCapturing,
  };
}

module.exports = {
  start,
  stop,
  getStats,
  setClientCount,
};
