const { keyboard, Key } = require('@nut-tree-fork/nut-js');
const { exec } = require('child_process');

// Media action to nut-js Key mapping
const MEDIA_KEY_MAP = {
  volumeup: Key.AudioVolUp,
  volumedown: Key.AudioVolDown,
  mute: Key.AudioVolMute,
  playpause: Key.AudioPlay,
  nexttrack: Key.AudioNext,
  prevtrack: Key.AudioPrev,
};

// Fallback PowerShell commands for media actions
const POWERSHELL_FALLBACKS = {
  volumeup: `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.SendKeys]::SendWait([char]0xAF)
  `,
  volumedown: `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.SendKeys]::SendWait([char]0xAE)
  `,
  mute: `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.SendKeys]::SendWait([char]0xAD)
  `,
  playpause: `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.SendKeys]::SendWait([char]0xB3)
  `,
  nexttrack: `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.SendKeys]::SendWait([char]0xB0)
  `,
  prevtrack: `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.SendKeys]::SendWait([char]0xB1)
  `,
};

// Nircmd fallback commands
const NIRCMD_FALLBACKS = {
  volumeup: 'nircmd changesysvolume 5000',
  volumedown: 'nircmd changesysvolume -5000',
  mute: 'nircmd mutesysvolume 2',
  playpause: 'nircmd sendkeypress 0xB3',
  nexttrack: 'nircmd sendkeypress 0xB0',
  prevtrack: 'nircmd sendkeypress 0xB1',
};

/**
 * Execute a PowerShell fallback command for media control.
 * @param {string} action - Normalized action name
 * @returns {Promise<boolean>} Whether the fallback succeeded
 */
function tryPowerShellFallback(action) {
  return new Promise((resolve) => {
    const psCommand = POWERSHELL_FALLBACKS[action];
    if (!psCommand) {
      resolve(false);
      return;
    }

    const command = `powershell -NoProfile -NonInteractive -Command "${psCommand.replace(/\n/g, ' ').trim()}"`;
    exec(command, { timeout: 5000 }, (err) => {
      if (err) {
        console.warn(`[media-keys] PowerShell fallback failed for ${action}:`, err.message);
        resolve(false);
      } else {
        console.log(`[media-keys] PowerShell fallback succeeded for ${action}`);
        resolve(true);
      }
    });
  });
}

/**
 * Execute a nircmd fallback command for media control.
 * @param {string} action - Normalized action name
 * @returns {Promise<boolean>} Whether the fallback succeeded
 */
function tryNircmdFallback(action) {
  return new Promise((resolve) => {
    const nircmdCommand = NIRCMD_FALLBACKS[action];
    if (!nircmdCommand) {
      resolve(false);
      return;
    }

    exec(nircmdCommand, { timeout: 5000 }, (err) => {
      if (err) {
        console.warn(`[media-keys] nircmd fallback failed for ${action}:`, err.message);
        resolve(false);
      } else {
        console.log(`[media-keys] nircmd fallback succeeded for ${action}`);
        resolve(true);
      }
    });
  });
}

/**
 * Perform a media key action.
 * Tries nut-js first, then falls back to PowerShell SendKeys, then nircmd.
 * @param {string} action - One of: volumeUp, volumeDown, mute, playPause, nextTrack, prevTrack
 * @returns {Promise<{success: boolean, action: string, method: string}>}
 */
async function mediaAction(action) {
  if (!action || typeof action !== 'string') {
    return { success: false, action, method: 'none', message: 'Invalid action' };
  }

  // Normalize action name: remove separators and lowercase
  const normalized = action.toLowerCase().replace(/[_\-\s]/g, '');

  const mediaKey = MEDIA_KEY_MAP[normalized];
  if (!mediaKey) {
    return {
      success: false,
      action,
      method: 'none',
      message: `Unknown media action: ${action}`,
    };
  }

  // Try nut-js first
  try {
    await keyboard.pressKey(mediaKey);
    await keyboard.releaseKey(mediaKey);
    console.log(`[media-keys] nut-js succeeded for ${normalized}`);
    return { success: true, action: normalized, method: 'nut-js' };
  } catch (nutErr) {
    console.warn(`[media-keys] nut-js failed for ${normalized}:`, nutErr.message);
  }

  // Fallback to PowerShell
  const psSuccess = await tryPowerShellFallback(normalized);
  if (psSuccess) {
    return { success: true, action: normalized, method: 'powershell' };
  }

  // Fallback to nircmd
  const nircmdSuccess = await tryNircmdFallback(normalized);
  if (nircmdSuccess) {
    return { success: true, action: normalized, method: 'nircmd' };
  }

  return {
    success: false,
    action: normalized,
    method: 'all-failed',
    message: 'All media key methods failed',
  };
}

module.exports = {
  mediaAction,
};
