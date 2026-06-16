const { exec } = require('child_process');

/**
 * Escape text for use inside a PowerShell single-quoted string.
 * Single quotes are escaped by doubling them: ' → ''
 * @param {string} text
 * @returns {string}
 */
function escapePowerShellString(text) {
  return text.replace(/'/g, "''");
}

/**
 * Get the current clipboard text content.
 * @returns {Promise<string>} Clipboard text
 */
function getClipboard() {
  return new Promise((resolve, reject) => {
    exec(
      'powershell -NoProfile -NonInteractive -Command "Get-Clipboard"',
      { timeout: 5000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          console.error('[clipboard] Get clipboard error:', err.message);
          reject(err);
          return;
        }
        if (stderr) {
          console.warn('[clipboard] Get clipboard stderr:', stderr.trim());
        }
        // Trim trailing newline that PowerShell adds
        resolve(stdout.trimEnd());
      }
    );
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

    const escaped = escapePowerShellString(text);
    const command = `powershell -NoProfile -NonInteractive -Command "Set-Clipboard -Value '${escaped}'"`;

    exec(command, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[clipboard] Set clipboard error:', err.message);
        reject(err);
        return;
      }
      if (stderr) {
        console.warn('[clipboard] Set clipboard stderr:', stderr.trim());
      }
      resolve();
    });
  });
}

module.exports = {
  getClipboard,
  setClipboard,
};
