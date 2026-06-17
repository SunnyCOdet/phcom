# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pcphone` is a cross-platform Electron desktop app (Windows, macOS, Linux) that turns any phone with a browser into a remote control + screen viewer for the host PC. The PC runs a local web server; the phone connects over LAN (or a tunnel) by scanning a QR code, then sees the live screen and drives mouse/keyboard/media/clipboard.

### Cross-platform notes
The app runs on any OS Electron supports. Platform-specific behavior is isolated to a handful of server modules, each keyed on `process.platform` (`win32` / `darwin` / `linux`, defaulting to Linux):
- `app-launcher.js` — separate app catalogs per OS (Windows `start`/exe names, macOS `open -a`, Linux binary names).
- `media-keys.js` — nut-js is the primary path everywhere; shell fallbacks are PowerShell (Windows), `osascript` (macOS volume only), `pactl`/`playerctl` (Linux).
- `network.js` — Wi-Fi/LAN interface preference covers Windows, macOS (`en0`), and Linux (`wlan0`/`eth0`/`enp*`) naming.
- `clipboard.js` — uses Electron's built-in `clipboard` (cross-platform); no shelling out.
- `notifications.js` — Windows-only (reads the WPN SQLite DB); cleanly no-ops on other platforms.

**Permissions / runtime requirements per OS:**
- **macOS** — needs **Screen Recording** permission (for capture; `main.js` warns if missing, and it only takes effect after a restart) and **Accessibility** permission (for nut-js input control). The app hides its Dock icon and lives in the menu bar.
- **Linux** — nut-js input and `chromeMediaSource: 'desktop'` capture target **X11**; Wayland sessions are unreliable for both. Native deps (`nut-js`, `sqlite3`, `sharp`) need their per-platform prebuilds via `npm install`.
- **System audio capture** (the `chromeMediaSource: 'desktop'` audio track) only works on Windows; macOS/Linux automatically fall back to video-only in `qr-window.html`.

## Commands

```bash
npm start          # launch the Electron app (electron .)
npm run dev        # launch with --dev flag
```

There is no test runner or linter configured. `test-capture.js` and `test-db.js` are standalone diagnostic scripts run directly with `node test-capture.js`, not a test suite.

The app runs in the system tray (no main window on screen by default). The tray menu exposes the connection URL, live FPS/client stats, "Show QR Code", and Auto Start (login item). Closing the QR window only hides it; quit from the tray. It enforces a single instance.

## Architecture

The defining feature is that **screen capture happens in the Electron renderer, not the main process or Node server.** Understanding the frame path is essential before changing anything streaming-related.

### Processes
- **Main process** — `main.js`. Owns the tray, the hidden QR/capture window, IPC, and starts the server + network advertisement. Port is hardcoded to `7898`.
- **Capture renderer** — `src/electron/qr-window.html`. A single large HTML file (QR display UI + the entire capture/WebRTC pipeline in inline `<script>`). It calls `getUserMedia` with `chromeMediaSource: 'desktop'` (via a source id from `desktopCapturer` in main) to grab screen **and system audio** in one stream.
- **Node server** — `src/server/`. Express HTTP + `ws` WebSocket, both on `7898`. Serves the phone client and relays everything.
- **Phone client** — `src/public/` (`index.html` / `index.js` / `index.css`), served statically. This is what the phone browser loads.

### Two streaming paths (per client)
Each connected phone is on exactly one path, tracked by `ws.useJpegFallback`:
1. **WebRTC (preferred)** — the renderer holds one `RTCPeerConnection` per client (`createRTCPeer` in qr-window.html) and sends the captured media track directly. Low latency, hardware-encoded, includes audio.
2. **JPEG fallback** — the renderer draws each frame to a canvas, `toBlob('image/jpeg')`, and ships the ArrayBuffer over IPC. Only used while `jpegFallbackClientIds` is non-empty; JPEG encoding is skipped entirely when all clients are on WebRTC.

JPEG frame path: renderer `electronAPI.sendFrame` → IPC `new-frame` (main.js) → `screenCapture.handleRendererFrame` → `broadcastFrame` (server/index.js) → binary WebSocket send to fallback clients only. `src/server/screen-capture.js` does **not** capture anything itself — it is a stats/settings/broadcast hub for renderer-pushed frames.

### WebRTC signaling relay (three hops)
Signaling is relayed because the peers (phone ↔ capture renderer) cannot talk directly:

```
phone client  <--WebSocket-->  Node server  <--IPC-->  main.js  <--IPC-->  capture renderer
```

- Server → renderer: `sendRTCToCapture` → `setCaptureSignalHandler` callback (set in main.js) → `mainWindow.webContents.send('rtc-to-capture')`.
- Renderer → client: `electronAPI.sendRTCToClient` → IPC `rtc-to-client` → `sendRTCToClient(clientId, ...)` in server.
- WS message types `rtc-ready` / `rtc-answer` / `rtc-ice` are relayed; `rtc-active` / `rtc-fallback` flip the client's path.

### Input & control (WebSocket JSON messages)
`handleWSMessage` in `src/server/index.js` is the central router. JSON messages (mouse/keyboard/scroll/hotkey/media/clipboard/settings/ping) come from the phone; binary frames are ignored inbound (`isBinaryFrame` distinguishes by first byte — JSON starts with `{` or `[`). Actual OS input is performed by `src/server/input-controller.js` using `@nut-tree-fork/nut-js`, with name→`Key` maps for keys, modifiers, and media keys.

### Other server modules
- `app-launcher.js` — whitelisted apps only (`APPS` array); `getApps()` deliberately strips the `command` field before returning to clients.
- `file-upload.js` — multer; saves to `~/Downloads/PhoneUploads`, de-duplicates filenames with a timestamp.
- `clipboard.js`, `media-keys.js`, `notifications.js` — clipboard get/set, media key actions, OS notification → broadcast to clients.
- `network.js` — local IP detection (prefers Wi-Fi, skips virtual/WSL adapters), QR generation, mDNS advertisement (`my-pc.local` via bonjour), and `localtunnel` for remote access. Loads a root `.env` if present.

### REST API (Express)
`/api/status`, `/api/apps`, `/api/launch`, `/api/clipboard` (GET/POST), `/api/upload`. These duplicate some WebSocket capabilities for non-realtime use.

## Conventions & gotchas
- The IPC bridge is `src/electron/../preload.js` → `window.electronAPI`. Any new main↔renderer channel must be added in **both** `preload.js` and the corresponding `ipcMain` handler in `main.js`.
- Stream settings (`quality`, `maxFps`, `maxWidth`, `maxHeight`) are clamped in `screen-capture.js#updateSettings`; clients request changes via a `settings` WS message.
- Logging is verbose and channel-prefixed (`[server]`, `[main]`, `[screen-capture]`, `[Capture]`, `[RTC]`). Renderer logs are forwarded to the main console via the `renderer-log` IPC channel — match this style.
- Branding strings are inconsistent in the codebase ("pcphone", "Magical Newton", "MagicalNewton") — they refer to the same app.
