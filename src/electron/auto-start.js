const { app } = require('electron');

/**
 * Auto-start management for Windows
 */
function getAutoStartEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStartEnabled(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe')
  });
}

function toggleAutoStart() {
  const current = getAutoStartEnabled();
  setAutoStartEnabled(!current);
  return !current;
}

module.exports = {
  getAutoStartEnabled,
  setAutoStartEnabled,
  toggleAutoStart
};
