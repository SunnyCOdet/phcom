const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConnectionInfo: () => ipcRenderer.invoke('get-connection-info'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getClipboard: () => ipcRenderer.invoke('get-clipboard'),
  setClipboard: (text) => ipcRenderer.invoke('set-clipboard', text),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  getPrimarySourceId: () => ipcRenderer.invoke('get-primary-source-id'),
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),
  getScreenInfo: () => ipcRenderer.invoke('get-screen-info'),
  sendFrame: (arrayBuffer) => ipcRenderer.send('new-frame', arrayBuffer),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_, data) => callback(data));
  },
  startCaptureTimer: (fps) => ipcRenderer.send('start-capture-timer', fps),
  stopCaptureTimer: () => ipcRenderer.send('stop-capture-timer'),
  onCaptureTick: (callback) => {
    ipcRenderer.on('capture-tick', () => callback());
  }
});
