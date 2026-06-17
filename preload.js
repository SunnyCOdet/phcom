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
  sendRTCToClient: (message) => ipcRenderer.send('rtc-to-client', message),
  onRTCSignal: (callback) => {
    ipcRenderer.on('rtc-to-capture', (_, data) => callback(data));
  },
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_, data) => callback(data));
  },
  startCaptureTimer: (fps) => ipcRenderer.send('start-capture-timer', fps),
  stopCaptureTimer: () => ipcRenderer.send('stop-capture-timer'),
  sendLog: (msg) => ipcRenderer.send('renderer-log', msg),
  onCaptureTick: (callback) => {
    ipcRenderer.on('capture-tick', () => callback());
  },

  // --- Supabase remote relay ---
  // Config (project URL + publishable key + edge function URLs) for the renderer.
  getSupabaseConfig: () => ipcRenderer.invoke('get-supabase-config'),
  // Renderer reports the public remote URL (from register-session) for the tray/QR.
  setRemoteUrl: (info) => ipcRenderer.invoke('set-remote-url', info),
  // Input/control received from a remote phone over the WebRTC data channel.
  sendRemoteInput: (msg) => ipcRenderer.send('remote-input', msg),
  // A reassembled file from a remote phone, to be written to disk.
  sendRemoteUpload: (data) => ipcRenderer.send('remote-upload', data),
  // Replies the main process wants delivered back to a specific phone's channel.
  onRemoteReply: (callback) => ipcRenderer.on('remote-send', (_, data) => callback(data)),
  // Stream quality/fps changes requested by a remote phone.
  onRemoteSettings: (callback) => ipcRenderer.on('remote-settings', (_, data) => callback(data))
});
