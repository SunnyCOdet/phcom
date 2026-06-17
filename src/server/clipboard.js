// This module runs inside the Electron main process, so we can use Electron's
// built-in clipboard, which is cross-platform (Windows, macOS, Linux).
const { clipboard } = require('electron');

/**
 * Get the current clipboard text content.
 * @returns {Promise<string>} Clipboard text
 */
function getClipboard() {
  return new Promise((resolve, reject) => {
    try {
      resolve(clipboard.readText());
    } catch (err) {
      console.error('[clipboard] Get clipboard error:', err.message);
      reject(err);
    }
  });
}

/**
 * Set the clipboard text content.
 * @param {string} text - Text to set on the clipboard
 * @returns {Promise<void>}
 */
function setClipboard(text) {
  return new Promise((resolve, reject) => {
    if (typeof text !== 'string') {
      reject(new Error('Clipboard text must be a string'));
      return;
    }
    try {
      clipboard.writeText(text);
      resolve();
    } catch (err) {
      console.error('[clipboard] Set clipboard error:', err.message);
      reject(err);
    }
  });
}

module.exports = {
  getClipboard,
  setClipboard,
};
