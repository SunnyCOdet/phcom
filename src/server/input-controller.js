const { mouse, keyboard, Button, Key, Point, straightTo } = require('@nut-tree-fork/nut-js');
const { screen } = require('@nut-tree-fork/nut-js');

// Set delays to 0 for instant response
mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

// Mouse sensitivity multiplier
const MOUSE_SENSITIVITY = 1.5;

// Key name to Key enum mapping
const KEY_MAP = {
  'enter': Key.Enter,
  'return': Key.Enter,
  'backspace': Key.Backspace,
  'tab': Key.Tab,
  'escape': Key.Escape,
  'esc': Key.Escape,
  'delete': Key.Delete,
  'del': Key.Delete,
  'space': Key.Space,
  'arrowup': Key.Up,
  'arrowdown': Key.Down,
  'arrowleft': Key.Left,
  'arrowright': Key.Right,
  'up': Key.Up,
  'down': Key.Down,
  'left': Key.Left,
  'right': Key.Right,
  'home': Key.Home,
  'end': Key.End,
  'pageup': Key.PageUp,
  'pagedown': Key.PageDown,
  'insert': Key.Insert,
  'f1': Key.F1,
  'f2': Key.F2,
  'f3': Key.F3,
  'f4': Key.F4,
  'f5': Key.F5,
  'f6': Key.F6,
  'f7': Key.F7,
  'f8': Key.F8,
  'f9': Key.F9,
  'f10': Key.F10,
  'f11': Key.F11,
  'f12': Key.F12,
  'capslock': Key.CapsLock,
  'numlock': Key.NumLock,
  'scrolllock': Key.ScrollLock,
  'printscreen': Key.Print,
  'pause': Key.Pause,
};

// Modifier key mapping
const MODIFIER_MAP = {
  'ctrl': Key.LeftControl,
  'control': Key.LeftControl,
  'alt': Key.LeftAlt,
  'shift': Key.LeftShift,
  'win': Key.LeftSuper,
  'meta': Key.LeftSuper,
  'cmd': Key.LeftSuper,
  'super': Key.LeftSuper,
};

// Media key mapping
const MEDIA_KEY_MAP = {
  'volumeup': Key.AudioVolUp,
  'volumedown': Key.AudioVolDown,
  'mute': Key.AudioVolMute,
  'playpause': Key.AudioPlay,
  'nexttrack': Key.AudioNext,
  'prevtrack': Key.AudioPrev,
};

/**
 * Get the current screen dimensions.
 * @returns {Promise<{width: number, height: number}>}
 */
async function getScreenSize() {
  try {
    const region = await screen.width();
    const height = await screen.height();
    return { width: region, height };
  } catch (err) {
    console.error('[input-controller] Failed to get screen size:', err.message);
    // Fallback to common resolution
    return { width: 1920, height: 1080 };
  }
}

/**
 * Move the mouse by relative delta values.
 * @param {number} dx - Horizontal delta
 * @param {number} dy - Vertical delta
 */
async function moveMouse(dx, dy) {
  try {
    const currentPos = await mouse.getPosition();
    const newX = Math.round(currentPos.x + dx * MOUSE_SENSITIVITY);
    const newY = Math.round(currentPos.y + dy * MOUSE_SENSITIVITY);

    // Clamp to screen bounds
    const screenSize = await getScreenSize();
    const clampedX = Math.max(0, Math.min(newX, screenSize.width - 1));
    const clampedY = Math.max(0, Math.min(newY, screenSize.height - 1));

    await mouse.setPosition(new Point(clampedX, clampedY));
  } catch (err) {
    console.error('[input-controller] moveMouse error:', err.message);
  }
}

/**
 * Perform a left mouse click.
 */
async function leftClick() {
  try {
    await mouse.click(Button.LEFT);
  } catch (err) {
    console.error('[input-controller] leftClick error:', err.message);
  }
}

/**
 * Perform a right mouse click.
 */
async function rightClick() {
  try {
    await mouse.click(Button.RIGHT);
  } catch (err) {
    console.error('[input-controller] rightClick error:', err.message);
  }
}

/**
 * Perform a double click.
 */
async function doubleClick() {
  try {
    await mouse.doubleClick(Button.LEFT);
  } catch (err) {
    console.error('[input-controller] doubleClick error:', err.message);
  }
}

/**
 * Scroll the mouse wheel.
 * @param {number} deltaX - Horizontal scroll amount
 * @param {number} deltaY - Vertical scroll amount
 */
async function scroll(deltaX, deltaY) {
  try {
    const scrollAmount = Math.abs(Math.round(deltaY));
    const scrollAmountX = Math.abs(Math.round(deltaX));

    if (deltaY > 0) {
      await mouse.scrollDown(scrollAmount || 1);
    } else if (deltaY < 0) {
      await mouse.scrollUp(scrollAmount || 1);
    }

    if (deltaX > 0) {
      await mouse.scrollRight(scrollAmountX || 1);
    } else if (deltaX < 0) {
      await mouse.scrollLeft(scrollAmountX || 1);
    }
  } catch (err) {
    console.error('[input-controller] scroll error:', err.message);
  }
}

/**
 * Press and hold the left mouse button (for drag start).
 */
async function mouseDown() {
  try {
    await mouse.pressButton(Button.LEFT);
  } catch (err) {
    console.error('[input-controller] mouseDown error:', err.message);
  }
}

/**
 * Release the left mouse button (for drag end).
 */
async function mouseUp() {
  try {
    await mouse.releaseButton(Button.LEFT);
  } catch (err) {
    console.error('[input-controller] mouseUp error:', err.message);
  }
}

/**
 * Type text using the keyboard.
 * @param {string} text - Text to type
 */
async function typeText(text) {
  try {
    if (typeof text === 'string' && text.length > 0) {
      await keyboard.type(text);
    }
  } catch (err) {
    console.error('[input-controller] typeText error:', err.message);
  }
}

/**
 * Press a single key by name.
 * @param {string} keyName - Name of the key (e.g., 'Enter', 'Backspace')
 */
async function pressKey(keyName) {
  try {
    const normalizedName = keyName.toLowerCase();
    const key = KEY_MAP[normalizedName];

    if (key !== undefined) {
      await keyboard.pressKey(key);
      await keyboard.releaseKey(key);
    } else if (keyName.length === 1) {
      // Single character - type it
      await keyboard.type(keyName);
    } else {
      console.warn(`[input-controller] Unknown key: ${keyName}`);
    }
  } catch (err) {
    console.error('[input-controller] pressKey error:', err.message);
  }
}

/**
 * Press a hotkey combination (modifiers + key).
 * @param {string[]} modifiers - Array of modifier names ('ctrl', 'alt', 'shift', 'win')
 * @param {string} key - The key to press with modifiers
 */
async function hotkey(modifiers, key) {
  const pressedModifiers = [];

  try {
    // Press all modifier keys
    for (const mod of modifiers) {
      const modKey = MODIFIER_MAP[mod.toLowerCase()];
      if (modKey !== undefined) {
        await keyboard.pressKey(modKey);
        pressedModifiers.push(modKey);
      } else {
        console.warn(`[input-controller] Unknown modifier: ${mod}`);
      }
    }

    // Press the main key
    const normalizedKey = key.toLowerCase();
    const mainKey = KEY_MAP[normalizedKey];

    if (mainKey !== undefined) {
      await keyboard.pressKey(mainKey);
      await keyboard.releaseKey(mainKey);
    } else if (key.length === 1) {
      // Single character key — look up the Key enum by letter
      const letterKey = Key[key.toUpperCase()];
      if (letterKey !== undefined) {
        await keyboard.pressKey(letterKey);
        await keyboard.releaseKey(letterKey);
      } else {
        await keyboard.type(key);
      }
    } else {
      console.warn(`[input-controller] Unknown hotkey target: ${key}`);
    }
  } catch (err) {
    console.error('[input-controller] hotkey error:', err.message);
  } finally {
    // ALWAYS release modifier keys, even if an error occurred
    for (const modKey of pressedModifiers) {
      try {
        await keyboard.releaseKey(modKey);
      } catch (releaseErr) {
        console.error('[input-controller] Failed to release modifier:', releaseErr.message);
      }
    }
  }
}

/**
 * Send a media key action.
 * @param {string} action - Media action name
 */
async function sendMediaKey(action) {
  try {
    const normalizedAction = action.toLowerCase().replace(/[_\-\s]/g, '');
    const mediaKey = MEDIA_KEY_MAP[normalizedAction];

    if (mediaKey !== undefined) {
      await keyboard.pressKey(mediaKey);
      await keyboard.releaseKey(mediaKey);
    } else {
      console.warn(`[input-controller] Unknown media action: ${action}`);
    }
  } catch (err) {
    console.error('[input-controller] sendMediaKey error:', err.message);
  }
}

/**
 * Move the mouse to an absolute position on the screen (normalized 0.0 to 1.0).
 * @param {number} pctX - Normalized horizontal position (0 to 1)
 * @param {number} pctY - Normalized vertical position (0 to 1)
 */
async function moveMouseAbsolute(pctX, pctY) {
  try {
    const screenSize = await getScreenSize();
    const targetX = Math.round(pctX * screenSize.width);
    const targetY = Math.round(pctY * screenSize.height);

    // Clamp to screen bounds
    const clampedX = Math.max(0, Math.min(targetX, screenSize.width - 1));
    const clampedY = Math.max(0, Math.min(targetY, screenSize.height - 1));

    await mouse.setPosition(new Point(clampedX, clampedY));
  } catch (err) {
    console.error('[input-controller] moveMouseAbsolute error:', err.message);
  }
}

module.exports = {
  getScreenSize,
  moveMouse,
  moveMouseAbsolute,
  leftClick,
  rightClick,
  doubleClick,
  scroll,
  mouseDown,
  mouseUp,
  typeText,
  pressKey,
  hotkey,
  sendMediaKey,
};
