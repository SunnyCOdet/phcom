const os = require('os');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

let bonjourInstance = null;

/**
 * Load simple env file from workspace root if it exists.
 */
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
          }
          process.env[key] = value.trim();
        }
      });
    }
  } catch (err) {
    console.error('[network] Failed to load .env file:', err.message);
  }
}
let publishedService = null;
let ngrokUrl = null;

/**
 * Get the first non-internal IPv4 address from network interfaces.
 * @returns {string} Local IP address or '127.0.0.1' if none found
 */
function getLocalIP() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (err) {
    console.error('[network] Failed to get local IP:', err.message);
  }
  return '127.0.0.1';
}

/**
 * Generate a QR code as a data URL for the given URL.
 * @param {string} url - The URL to encode
 * @returns {Promise<string>} Data URL of the QR code
 */
async function generateQRCode(url) {
  try {
    const dataUrl = await qrcode.toDataURL(url, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
    return dataUrl;
  } catch (err) {
    console.error('[network] Failed to generate QR code:', err.message);
    throw err;
  }
}

/**
 * Start mDNS advertisement for the HTTP service.
 * @param {number} port - Port number to advertise
 */
function startMDNS(port) {
  try {
    const { Bonjour } = require('bonjour-service');
    bonjourInstance = new Bonjour();
    publishedService = bonjourInstance.publish({
      name: 'MagicalNewton Remote Desktop',
      type: 'http',
      port: port,
      txt: {
        path: '/',
        version: '1.0.0',
      },
    });
    console.log(`[network] mDNS service advertised on port ${port}`);
  } catch (err) {
    console.error('[network] Failed to start mDNS:', err.message);
  }
}

/**
 * Stop mDNS advertisement and cleanup.
 */
function stopMDNS() {
  try {
    if (publishedService) {
      publishedService.stop(() => {
        console.log('[network] mDNS service stopped');
      });
      publishedService = null;
    }
    if (bonjourInstance) {
      bonjourInstance.destroy();
      bonjourInstance = null;
    }
  } catch (err) {
    console.error('[network] Failed to stop mDNS:', err.message);
  }
}

/**
 * Start an ngrok tunnel to expose the local server.
 * @param {number} port - Port to tunnel
 * @returns {Promise<string|null>} Public ngrok URL or null if failed
 */
async function startNgrokTunnel(port) {
  try {
    loadEnv();
    const ngrok = require('@ngrok/ngrok');
    console.log('[network] Starting ngrok tunnel...');

    const listener = await ngrok.forward({
      addr: port,
      authtoken_from_env: true,
    });

    ngrokUrl = listener.url();
    console.log(`[network] ngrok tunnel established: ${ngrokUrl}`);
    return ngrokUrl;
  } catch (err) {
    console.error('[network] ngrok tunnel failed:', err.message);
    console.log('[network] Tip: Set NGROK_AUTHTOKEN env variable or run "ngrok config add-authtoken <token>"');
    return null;
  }
}

/**
 * Get the current ngrok URL if available.
 * @returns {string|null}
 */
function getNgrokUrl() {
  return ngrokUrl;
}

module.exports = {
  getLocalIP,
  generateQRCode,
  startMDNS,
  stopMDNS,
  startNgrokTunnel,
  getNgrokUrl,
};
