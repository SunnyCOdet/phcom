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

// Per-platform shell fallbacks, used only if nut-js fails. Each value is a
// shell command string (or null if that action has no fallback on the OS).
const SHELL_FALLBACKS = {
  win32: {
    volumeup: 'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]0xAF)"',
    volumedown: 'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]0xAE)"',
    mute: 'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]0xAD)"',
    playpause: 'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]0xB3)"',
    nexttrack: 'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]0xB0)"',
    prevtrack: 'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([char]0xB1)"',
  },
  darwin: {
    // macOS: volume via AppleScript; transport keys have no reliable CLI, rely on nut-js.
    volumeup: `osascript -e "set volume output volume (output volume of (get volume settings) + 10)"`,
    volumedown: `osascript -e "set volume output volume (output volume of (get volume settings) - 10)"`,
    mute: `osascript -e "set volume output muted (not (output muted of (get volume settings)))"`,
    playpause: null,
    nexttrack: null,
    prevtrack: null,
  },
  linux: {
    // Linux: PulseAudio/PipeWire for volume, playerctl (MPRIS) for transport.
    volumeup: 'pactl set-sink-volume @DEFAULT_SINK@ +5%',
    volumedown: 'pactl set-sink-volume @DEFAULT_SINK@ -5%',
    mute: 'pactl set-sink-mute @DEFAULT_SINK@ toggle',
    playpause: 'playerctl play-pause',
    nexttrack: 'playerctl next',
    prevtrack: 'playerctl previous',
  },
};

const PLATFORM_FALLBACKS = SHELL_FALLBACKS[process.platform] || SHELL_FALLBACKS.linux;

/**
 * Run the OS-native shell fallback for a media action, if one exists.
 * @param {string} action - Normalized action name
 * @returns {Promise<boolean>} Whether the fallback ran successfully
 */
function tryShellFallback(action) {
  return new Promise((resolve) => {
    const command = PLATFORM_FALLBACKS[action];
    if (!command) {
      resolve(false);
      return;
    }

    exec(command, { timeout: 5000 }, (err) => {
      if (err) {
        console.warn(`[media-keys] Shell fallback failed for ${action}:`, err.message);
        resolve(false);
      } else {
        console.log(`[media-keys] Shell fallback succeeded for ${action}`);
        resolve(true);
      }
    });
  });
}

/**
 * Perform a media key action.
 * Tries nut-js first, then falls back to the OS-native shell command.
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

  // Fallback to the OS-native shell command
  const shellSuccess = await tryShellFallback(normalized);
  if (shellSuccess) {
    return { success: true, action: normalized, method: 'shell' };
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
