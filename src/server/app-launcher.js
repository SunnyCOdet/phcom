const { exec } = require('child_process');

// Predefined list of launchable applications
const APPS = [
  { name: 'Chrome', icon: '🌐', command: 'start chrome' },
  { name: 'VS Code', icon: '💻', command: 'code' },
  { name: 'Notepad', icon: '📝', command: 'notepad' },
  { name: 'Explorer', icon: '📁', command: 'explorer' },
  { name: 'Task Manager', icon: '📊', command: 'taskmgr' },
  { name: 'Terminal', icon: '⬛', command: 'wt' },
  { name: 'Calculator', icon: '🔢', command: 'calc' },
  { name: 'Settings', icon: '⚙️', command: 'start ms-settings:' },
  { name: 'Paint', icon: '🎨', command: 'mspaint' },
  { name: 'Snipping Tool', icon: '✂️', command: 'snippingtool' },
  { name: 'CMD', icon: '▶️', command: 'cmd' },
  { name: 'PowerShell', icon: '🔵', command: 'powershell' },
];

/**
 * Get the list of available applications.
 * @returns {Array<{name: string, icon: string, command: string}>}
 */
function getApps() {
  // Return a copy without the command field for security
  return APPS.map(({ name, icon }) => ({ name, icon }));
}

/**
 * Launch an application by name.
 * @param {string} appName - Name of the app to launch (case-insensitive)
 * @returns {Promise<{success: boolean, name: string, message: string}>}
 */
function launchApp(appName) {
  return new Promise((resolve) => {
    try {
      if (!appName || typeof appName !== 'string') {
        resolve({ success: false, name: appName, message: 'Invalid app name' });
        return;
      }

      const app = APPS.find(
        (a) => a.name.toLowerCase() === appName.toLowerCase()
      );

      if (!app) {
        resolve({
          success: false,
          name: appName,
          message: `App "${appName}" not found`,
        });
        return;
      }

      exec(app.command, {
        shell: true,
        detached: true,
        windowsHide: false,
        timeout: 10000,
      }, (err) => {
        if (err) {
          // Some apps (like 'start' commands) may return non-zero but still launch
          console.warn(`[app-launcher] Exec warning for "${app.name}":`, err.message);
        }
      });

      // Resolve immediately — don't wait for the app to close
      console.log(`[app-launcher] Launched: ${app.name} (${app.command})`);
      resolve({
        success: true,
        name: app.name,
        message: `${app.name} launched successfully`,
      });
    } catch (err) {
      console.error('[app-launcher] launchApp error:', err.message);
      resolve({
        success: false,
        name: appName,
        message: err.message,
      });
    }
  });
}

module.exports = {
  getApps,
  launchApp,
};
