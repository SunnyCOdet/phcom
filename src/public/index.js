/* ============================================================
   Remote Desktop – Client Controller
   ============================================================ */

(function () {
  'use strict';

  // ─── DOM References ────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    statusBar:      $('#status-bar'),
    connDot:        $('#connection-dot'),
    connText:       $('#connection-text'),
    fpsValue:       $('#fps-value'),
    latencyValue:   $('#latency-value'),
    screenContainer:$('#screen-container'),
    canvas:         $('#screen-canvas'),
    noSignal:       $('#no-signal'),
    keyboardInput:  $('#keyboard-input'),
    specialKeysBar: $('#special-keys-bar'),
    toolbar:        $('#toolbar'),
    panelOverlay:   $('#panel-overlay'),
    toastContainer: $('#toast-container'),
    // Toolbar buttons
    btnKeyboard:    $('#btn-keyboard'),
    btnMouse:       $('#btn-mouse'),
    btnApps:        $('#btn-apps'),
    btnClipboard:   $('#btn-clipboard'),
    btnFiles:       $('#btn-files'),
    btnMedia:       $('#btn-media'),
    btnSettings:    $('#btn-settings'),
    // Panels
    appsPanel:      $('#apps-panel'),
    clipboardPanel: $('#clipboard-panel'),
    filesPanel:     $('#files-panel'),
    mediaPanel:     $('#media-panel'),
    settingsPanel:  $('#settings-panel'),
    // Clipboard
    clipboardText:  $('#clipboard-text'),
    clipboardFetch: $('#clipboard-fetch'),
    clipboardSend:  $('#clipboard-send'),
    // Files
    fileInput:      $('#file-input'),
    fileSelected:   $('#file-selected'),
    fileName:       $('#file-name'),
    fileUploadBtn:  $('#file-upload-btn'),
    uploadProgressContainer: $('#upload-progress-container'),
    uploadProgressFill: $('#upload-progress-fill'),
    uploadProgressText: $('#upload-progress-text'),
    uploadStatus:   $('#upload-status'),
    // Apps
    appsGrid:       $('#apps-grid'),
    // Settings
    qualitySlider:      $('#quality-slider'),
    qualityValue:       $('#quality-value'),
    fpsSlider:          $('#fps-slider'),
    fpsSettingValue:    $('#fps-setting-value'),
    sensitivitySlider:  $('#sensitivity-slider'),
    sensitivityValue:   $('#sensitivity-value'),
    // Control Mode settings
    btnModeTouch:       $('#btn-mode-touch'),
    btnModeTrackpad:    $('#btn-mode-trackpad'),
    controlModeValue:   $('#control-mode-value'),
  };

  const ctx = dom.canvas.getContext('2d', { alpha: false, desynchronized: true });

  // ─── State ─────────────────────────────────────────────

  let ws = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let isConnected = false;

  // FPS tracking
  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let currentFps = 0;

  // Latency
  let latency = 0;

  // Touch state
  const activeTouches = new Map();
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let tapTimeout = null;
  let longPressTimer = null;
  let dragMode = false;
  let keyboardVisible = false;
  let specialKeysVisible = true;
  let wasMultiTouch = false;

  // Modifier keys state
  const modifiers = { ctrl: false, alt: false, shift: false, win: false };

  // Settings (load from localStorage)
  let sensitivity = parseFloat(localStorage.getItem('rd_sensitivity') || '1.5');
  let quality = parseInt(localStorage.getItem('rd_quality') || '90', 10);
  let maxFps = parseInt(localStorage.getItem('rd_maxFps') || '60', 10);
  let controlMode = localStorage.getItem('rd_controlMode') || 'touch'; // 'touch' (Direct Touch) or 'trackpad'

  if (localStorage.getItem('rd_stream_defaults_v2') !== '1') {
    quality = Math.max(quality, 90);
    maxFps = Math.max(maxFps, 60);
    localStorage.setItem('rd_quality', quality);
    localStorage.setItem('rd_maxFps', maxFps);
    localStorage.setItem('rd_stream_defaults_v2', '1');
  }

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const PINCH_ZOOM_THRESHOLD = 8;
  const screenZoom = {
    scale: 1,
    translateX: 0,
    translateY: 0,
  };

  // Panels
  let activePanel = null;
  const panelMap = {
    apps:      dom.appsPanel,
    clipboard: dom.clipboardPanel,
    files:     dom.filesPanel,
    media:     dom.mediaPanel,
    settings:  dom.settingsPanel,
  };
  const panelBtnMap = {
    apps:      dom.btnApps,
    clipboard: dom.btnClipboard,
    files:     dom.btnFiles,
    media:     dom.btnMedia,
    settings:  dom.btnSettings,
  };

  // Throttle state
  let lastMouseMoveSend = 0;
  const MOUSE_MOVE_INTERVAL = 1000 / 60; // ~16ms, cap at 60/s

  // Pending frame
  let pendingFrame = null;
  let rafScheduled = false;
  let incomingFrameId = 0;
  let latestQueuedFrameId = 0;
  let rtcPeer = null;
  let rtcVideo = null;
  let rtcRenderActive = false;

  // ─── WebSocket ─────────────────────────────────────────

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      isConnected = true;
      reconnectDelay = 1000;
      updateConnectionUI(true);
      startHeartbeat();
      sendStreamSettings();
      send({ type: 'rtc-ready' });
      showToast('Connected', 'success');
    };

    ws.onclose = () => {
      isConnected = false;
      updateConnectionUI(false);
      stopHeartbeat();
      closeRTC();
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error('[WS] Error:', e);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        handleFrame(event.data);
      } else {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (err) {
          console.warn('[WS] Failed to parse message:', err);
        }
      }
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendStreamSettings() {
    send({ type: 'settings', quality, maxFps });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 16000);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        send({ type: 'ping', timestamp: Date.now() });
      }
    }, 5000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function updateConnectionUI(connected) {
    dom.connDot.classList.toggle('connected', connected);
    dom.connText.textContent = connected ? 'Connected' : 'Disconnected';
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'status':
        if (msg.fps != null) {
          // Server-reported FPS (optional, we also track client-side)
        }
        break;
      case 'clipboard':
        if (msg.text != null) {
          dom.clipboardText.value = msg.text;
          showToast('Clipboard updated from PC', 'info');
        }
        break;
      case 'pong':
        if (msg.timestamp) {
          latency = Date.now() - msg.timestamp;
          dom.latencyValue.textContent = latency;
        }
        break;
      case 'rtc-offer':
        console.log('[Stream] Received WebRTC offer');
        handleRTCOffer(msg).catch((err) => {
          console.error('[RTC] Offer error:', err);
        });
        break;
      case 'rtc-ice':
        handleRTCICE(msg).catch((err) => {
          console.error('[RTC] ICE error:', err);
        });
        break;
      case 'system-notification':
        showToast(`🔔 ${msg.title}${msg.body ? ' - ' + msg.body : ''}`, 'info');
        
        // Attempt vibration
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
        
        // Visual flash
        document.body.classList.add('flash-notification');
        setTimeout(() => document.body.classList.remove('flash-notification'), 500);

        // Audio Beep
        try {
          if (globalAudioCtx && globalAudioCtx.state === 'running') {
            const oscillator = globalAudioCtx.createOscillator();
            const gainNode = globalAudioCtx.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, globalAudioCtx.currentTime); // A5
            
            gainNode.gain.setValueAtTime(0.1, globalAudioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, globalAudioCtx.currentTime + 0.5);
            
            oscillator.connect(gainNode);
            gainNode.connect(globalAudioCtx.destination);
            
            oscillator.start();
            oscillator.stop(globalAudioCtx.currentTime + 0.5);
          }
        } catch (e) {
          console.error('Audio beep failed', e);
        }
        break;
      default:
        break;
    }
  }

  // ─── Screen Rendering ─────────────────────────────────

  function createRTCVideo() {
    if (rtcVideo) return rtcVideo;

    rtcVideo = document.createElement('video');
    rtcVideo.autoplay = true;
    rtcVideo.muted = true;
    rtcVideo.playsInline = true;
    rtcVideo.setAttribute('playsinline', '');
    rtcVideo.style.position = 'absolute';
    rtcVideo.style.inset = '0';
    rtcVideo.style.width = '100%';
    rtcVideo.style.height = '100%';
    rtcVideo.style.objectFit = 'contain';
    rtcVideo.style.opacity = '0';
    rtcVideo.style.pointerEvents = 'none';
    dom.screenContainer.appendChild(rtcVideo);

    return rtcVideo;
  }

  function closeRTC() {
    rtcRenderActive = false;

    if (rtcPeer) {
      rtcPeer.close();
      rtcPeer = null;
    }

    if (rtcVideo) {
      rtcVideo.pause();
      rtcVideo.srcObject = null;
      rtcVideo.style.opacity = '0';
    }

    dom.canvas.style.opacity = '';
  }

  function serializeRTCDescription(description) {
    return description ? { type: description.type, sdp: description.sdp } : null;
  }

  function serializeRTCIceCandidate(candidate) {
    if (!candidate) return null;
    if (typeof candidate.toJSON === 'function') return candidate.toJSON();

    return {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment
    };
  }

  function ensureRTCPeer() {
    if (rtcPeer) return rtcPeer;

    rtcPeer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    const peer = rtcPeer;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        send({ type: 'rtc-ice', candidate: serializeRTCIceCandidate(event.candidate) });
      }
    };

    peer.ontrack = (event) => {
      const video = createRTCVideo();
      video.srcObject = event.streams[0];
      video.play().catch((err) => {
        console.warn('[RTC] Video play blocked:', err.message);
      });
      startRTCRenderLoop();
    };

    peer.onconnectionstatechange = () => {
      if (rtcPeer !== peer) return;

      if (peer.connectionState === 'connected') {
        console.log('[Stream] Using WebRTC stream');
        send({ type: 'rtc-active' });
      } else if (['failed', 'closed'].includes(peer.connectionState)) {
        closeRTC();
      }
    };

    return peer;
  }

  async function handleRTCOffer(msg) {
    if (!msg.offer || !msg.offer.type || !msg.offer.sdp) {
      throw new Error('Invalid RTC offer');
    }

    const peer = ensureRTCPeer();
    await peer.setRemoteDescription(new RTCSessionDescription(msg.offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    send({ type: 'rtc-answer', answer: serializeRTCDescription(peer.localDescription) });
  }

  async function handleRTCICE(msg) {
    if (!rtcPeer || !msg.candidate || !msg.candidate.candidate) return;
    await rtcPeer.addIceCandidate(new RTCIceCandidate(msg.candidate));
  }

  function startRTCRenderLoop() {
    if (rtcRenderActive) return;
    rtcRenderActive = true;

    const renderVideoFrame = () => {
      if (!rtcRenderActive || !rtcVideo || rtcVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleRTCFrame(renderVideoFrame);
        return;
      }

      const width = rtcVideo.videoWidth;
      const height = rtcVideo.videoHeight;
      if (width > 0 && height > 0) {
        if (!dom.noSignal.classList.contains('hidden')) {
          dom.noSignal.classList.add('hidden');
        }

        if (dom.canvas.width !== width || dom.canvas.height !== height) {
          dom.canvas.width = width;
          dom.canvas.height = height;
        }

        rtcVideo.style.opacity = '1';
        dom.canvas.style.opacity = '0';
        updateClientFps();
      }

      scheduleRTCFrame(renderVideoFrame);
    };

    scheduleRTCFrame(renderVideoFrame);
  }

  function scheduleRTCFrame(callback) {
    if (!rtcRenderActive) return;

    if (rtcVideo && typeof rtcVideo.requestVideoFrameCallback === 'function') {
      rtcVideo.requestVideoFrameCallback(callback);
    } else {
      requestAnimationFrame(callback);
    }
  }

  function updateClientFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsUpdate >= 1000) {
      currentFps = frameCount;
      frameCount = 0;
      lastFpsUpdate = now;
      dom.fpsValue.textContent = currentFps;
    }
  }

  function handleFrame(buffer) {
    if (!handleFrame.hasLoggedFallback) {
      console.log('[Stream] Using JPEG fallback stream');
      handleFrame.hasLoggedFallback = true;
    }

    dom.canvas.style.opacity = '';
    if (rtcVideo) rtcVideo.style.opacity = '0';

    const frameId = ++incomingFrameId;
    const blob = new Blob([buffer], { type: 'image/jpeg' });

    createImageBitmap(blob).then((bitmap) => {
      if (frameId < latestQueuedFrameId) {
        bitmap.close();
        return;
      }

      if (pendingFrame) {
        pendingFrame.close();
      }

      latestQueuedFrameId = frameId;
      pendingFrame = bitmap;
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(renderFrame);
      }
    }).catch(() => {
      // Silently skip corrupted frames
    });
  }

  function renderFrame() {
    rafScheduled = false;

    if (!pendingFrame) return;

    const bitmap = pendingFrame;
    pendingFrame = null;

    // Hide no-signal overlay on first frame
    if (!dom.noSignal.classList.contains('hidden')) {
      dom.noSignal.classList.add('hidden');
    }

    // Set canvas internal dimensions to match the bitmap
    if (dom.canvas.width !== bitmap.width || dom.canvas.height !== bitmap.height) {
      dom.canvas.width = bitmap.width;
      dom.canvas.height = bitmap.height;
    }

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    updateClientFps();
  }

  function resizeCanvas() {
    // Canvas CSS sizing handles display; internal resolution set by frame
    // Nothing needed here since we set canvas.width/height from bitmap dims
    clampScreenZoom();
    applyScreenZoom();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function clampScreenZoom() {
    screenZoom.scale = clamp(screenZoom.scale, ZOOM_MIN, ZOOM_MAX);

    if (screenZoom.scale <= ZOOM_MIN + 0.001) {
      screenZoom.scale = ZOOM_MIN;
      screenZoom.translateX = 0;
      screenZoom.translateY = 0;
      return;
    }

    const containerWidth = dom.screenContainer.clientWidth;
    const containerHeight = dom.screenContainer.clientHeight;
    const scaledWidth = dom.canvas.offsetWidth * screenZoom.scale;
    const scaledHeight = dom.canvas.offsetHeight * screenZoom.scale;
    const maxX = Math.max(0, (scaledWidth - containerWidth) / 2);
    const maxY = Math.max(0, (scaledHeight - containerHeight) / 2);

    screenZoom.translateX = clamp(screenZoom.translateX, -maxX, maxX);
    screenZoom.translateY = clamp(screenZoom.translateY, -maxY, maxY);
  }

  function applyScreenZoom() {
    dom.canvas.style.transformOrigin = 'center center';
    dom.canvas.style.transform = `translate(${screenZoom.translateX}px, ${screenZoom.translateY}px) scale(${screenZoom.scale})`;
  }

  function getTouchDistance(t0, t1) {
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }

  function getTouchMidpoint(t0, t1) {
    return {
      x: (t0.clientX + t1.clientX) / 2,
      y: (t0.clientY + t1.clientY) / 2,
    };
  }

  function getCanvasPointPct(clientX, clientY) {
    const rect = dom.canvas.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;

    return {
      x: clamp(canvasX / rect.width, 0, 1),
      y: clamp(canvasY / rect.height, 0, 1),
    };
  }

  // ─── Touch Input ───────────────────────────────────────

  function initTouchHandlers() {
    const canvas = dom.canvas;

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
  }

  function onTouchStart(e) {
    e.preventDefault();

    for (const touch of e.changedTouches) {
      activeTouches.set(touch.identifier, {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        startTime: performance.now(),
        totalMovement: 0,
      });
    }

    // Long press detection (single finger only)
    if (e.touches.length === 1) {
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        const touch = activeTouches.get(e.touches[0].identifier);
        if (touch && touch.totalMovement < 10) {
          dragMode = true;
          send({ type: 'mousedown' });
          // Haptic feedback
          if (navigator.vibrate) {
            navigator.vibrate(30);
          }
        }
      }, 500);
    } else {
      clearTimeout(longPressTimer);
    }
  }

  function onTouchMove(e) {
    e.preventDefault();

    const touchCount = e.touches.length;

    if (touchCount === 1) {
      // Single finger: relative mouse move
      const touch = e.touches[0];
      const tracked = activeTouches.get(touch.identifier);
      if (!tracked) return;

      const dx = (touch.clientX - tracked.lastX) * sensitivity;
      const dy = (touch.clientY - tracked.lastY) * sensitivity;

      tracked.totalMovement += Math.abs(touch.clientX - tracked.lastX) + Math.abs(touch.clientY - tracked.lastY);
      tracked.lastX = touch.clientX;
      tracked.lastY = touch.clientY;

      // Cancel long press if movement exceeded threshold
      if (tracked.totalMovement > 10) {
        clearTimeout(longPressTimer);
      }

      // Throttle mouse move sends
      const now = performance.now();
      if (now - lastMouseMoveSend >= MOUSE_MOVE_INTERVAL) {
        send({ type: 'mousemove', dx, dy });
        lastMouseMoveSend = now;
      }
    } else if (touchCount === 2) {
      // Two finger: scroll
      clearTimeout(longPressTimer);

      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const tr0 = activeTouches.get(t0.identifier);
      const tr1 = activeTouches.get(t1.identifier);

      if (!tr0 || !tr1) return;

      const avgDx = ((t0.clientX - tr0.lastX) + (t1.clientX - tr1.lastX)) / 2;
      const avgDy = ((t0.clientY - tr0.lastY) + (t1.clientY - tr1.lastY)) / 2;

      tr0.totalMovement += Math.abs(t0.clientX - tr0.lastX) + Math.abs(t0.clientY - tr0.lastY);
      tr1.totalMovement += Math.abs(t1.clientX - tr1.lastX) + Math.abs(t1.clientY - tr1.lastY);

      tr0.lastX = t0.clientX;
      tr0.lastY = t0.clientY;
      tr1.lastX = t1.clientX;
      tr1.lastY = t1.clientY;

      if (Math.abs(avgDx) > 0.5 || Math.abs(avgDy) > 0.5) {
        send({ type: 'scroll', deltaX: avgDx, deltaY: avgDy });
      }
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    clearTimeout(longPressTimer);

    for (const touch of e.changedTouches) {
      const tracked = activeTouches.get(touch.identifier);
      if (!tracked) continue;

      const duration = performance.now() - tracked.startTime;
      const isTap = tracked.totalMovement < 10 && duration < 200;

      activeTouches.delete(touch.identifier);

      // Handle drag mode release
      if (dragMode && e.touches.length === 0) {
        dragMode = false;
        send({ type: 'mouseup' });
        return;
      }

      // Single finger tap
      if (isTap && e.touches.length === 0) {
        const now = performance.now();

        if (now - lastTapTime < 400 && tapTimeout) {
          // Double tap
          clearTimeout(tapTimeout);
          tapTimeout = null;
          lastTapTime = 0;
          send({ type: 'dblclick' });
        } else {
          // Possible single tap — wait to see if double tap follows
          lastTapTime = now;
          tapTimeout = setTimeout(() => {
            tapTimeout = null;
            sendWithModifiers({ type: 'click' });
          }, 200);
        }
      }
    }

    // Two finger tap (right click) — check when going from 2 to 0 touches
    if (e.touches.length === 0 && e.changedTouches.length === 2) {
      const t0 = e.changedTouches[0];
      const t1 = e.changedTouches[1];
      // We already deleted them, so we can't check totalMovement from map
      // Use a simpler heuristic: if both fingers were released nearly simultaneously
      // and we haven't already sent a scroll, treat as right click
      // Actually, let's track it differently:
      // Re-check: the tracked objects were just deleted but we had them
      // Let's just send right click if duration was short for both
      const dur0 = performance.now() - (activeTouches.get(t0.identifier)?.startTime || performance.now());
      const dur1 = performance.now() - (activeTouches.get(t1.identifier)?.startTime || performance.now());
      // Since already deleted, fall back: the two-finger tap detection
      // needs to be done before deletion. Let's handle this properly:
    }
  }

  // Better implementation — replace the handlers
  function initTouchHandlersV2() {
    const canvas = dom.canvas;

    let twoFingerTapData = null;
    let pinchGesture = null;

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();

      const touchCount = e.touches.length;
      if (touchCount > 1) {
        wasMultiTouch = true;
        clearTimeout(longPressTimer);
      } else {
        wasMultiTouch = false;
      }

      for (const touch of e.changedTouches) {
        activeTouches.set(touch.identifier, {
          startX: touch.clientX,
          startY: touch.clientY,
          lastX: touch.clientX,
          lastY: touch.clientY,
          startTime: performance.now(),
          totalMovement: 0,
        });
      }

      if (touchCount === 2) {
        twoFingerTapData = {
          startTime: performance.now(),
          ids: [e.touches[0].identifier, e.touches[1].identifier],
        };
        const midpoint = getTouchMidpoint(e.touches[0], e.touches[1]);
        pinchGesture = {
          startDistance: getTouchDistance(e.touches[0], e.touches[1]),
          startScale: screenZoom.scale,
          startTranslateX: screenZoom.translateX,
          startTranslateY: screenZoom.translateY,
          startMidX: midpoint.x,
          startMidY: midpoint.y,
          isLocalZoom: false,
        };
      }

      // Check for Double-Tap-and-Drag start (single finger only)
      if (touchCount === 1) {
        const touch = e.touches[0];
        const now = performance.now();
        const timeSinceLastTap = now - lastTapTime;
        
        // Calculate distance from previous tap to make sure it's nearby
        const dist = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);
        
        if (timeSinceLastTap < 350 && dist < 30) {
          // Double-tap-and-drag detected!
          if (tapTimeout) {
            clearTimeout(tapTimeout);
            tapTimeout = null;
          }
          dragMode = true;
          
          // Move mouse to this position first if in Direct Touch mode
          if (controlMode === 'touch') {
            const point = getCanvasPointPct(touch.clientX, touch.clientY);
            send({ type: 'mousemove_abs', x: point.x, y: point.y });
          }
          
          send({ type: 'mousedown' });
          if (navigator.vibrate) navigator.vibrate(30);
        } else {
          // Long press (alternative drag mode trigger)
          clearTimeout(longPressTimer);
          const id = touch.identifier;
          longPressTimer = setTimeout(() => {
            const t = activeTouches.get(id);
            if (t && t.totalMovement < 15) {
              dragMode = true;
              if (controlMode === 'touch') {
                const point = getCanvasPointPct(t.startX, t.startY);
                send({ type: 'mousemove_abs', x: point.x, y: point.y });
              }
              send({ type: 'mousedown' });
              if (navigator.vibrate) navigator.vibrate(30);
            }
          }, 500);
        }
      } else {
        clearTimeout(longPressTimer);
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touchCount = e.touches.length;
      if (touchCount > 1) {
        wasMultiTouch = true;
        clearTimeout(longPressTimer);
      }

      if (touchCount === 1) {
        const touch = e.touches[0];
        const tracked = activeTouches.get(touch.identifier);
        if (!tracked) return;

        const rawDx = touch.clientX - tracked.lastX;
        const rawDy = touch.clientY - tracked.lastY;
        
        tracked.totalMovement += Math.abs(rawDx) + Math.abs(rawDy);
        tracked.lastX = touch.clientX;
        tracked.lastY = touch.clientY;

        if (tracked.totalMovement > 15) {
          clearTimeout(longPressTimer);
        }

        const now = performance.now();
        if (now - lastMouseMoveSend >= MOUSE_MOVE_INTERVAL) {
          if (controlMode === 'touch') {
            // Absolute positioning
            const point = getCanvasPointPct(touch.clientX, touch.clientY);
            send({ type: 'mousemove_abs', x: point.x, y: point.y });
          } else {
            // Trackpad relative positioning
            tracked.pendingDx = (tracked.pendingDx || 0) + (rawDx * sensitivity);
            tracked.pendingDy = (tracked.pendingDy || 0) + (rawDy * sensitivity);
            send({ type: 'mousemove', dx: tracked.pendingDx, dy: tracked.pendingDy });
            tracked.pendingDx = 0;
            tracked.pendingDy = 0;
          }
          lastMouseMoveSend = now;
        }
      } else if (touchCount === 2) {
        clearTimeout(longPressTimer);

        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const tr0 = activeTouches.get(t0.identifier);
        const tr1 = activeTouches.get(t1.identifier);
        if (!tr0 || !tr1) return;

        if (!pinchGesture) {
          const midpoint = getTouchMidpoint(t0, t1);
          pinchGesture = {
            startDistance: getTouchDistance(t0, t1),
            startScale: screenZoom.scale,
            startTranslateX: screenZoom.translateX,
            startTranslateY: screenZoom.translateY,
            startMidX: midpoint.x,
            startMidY: midpoint.y,
            isLocalZoom: false,
          };
        }

        const avgDx = ((t0.clientX - tr0.lastX) + (t1.clientX - tr1.lastX)) / 2;
        const avgDy = ((t0.clientY - tr0.lastY) + (t1.clientY - tr1.lastY)) / 2;
        const distance = getTouchDistance(t0, t1);
        const distanceDelta = Math.abs(distance - pinchGesture.startDistance);
        const shouldZoomLocally = pinchGesture.isLocalZoom || distanceDelta > PINCH_ZOOM_THRESHOLD || screenZoom.scale > ZOOM_MIN;

        tr0.totalMovement += Math.abs(t0.clientX - tr0.lastX) + Math.abs(t0.clientY - tr0.lastY);
        tr1.totalMovement += Math.abs(t1.clientX - tr1.lastX) + Math.abs(t1.clientY - tr1.lastY);

        tr0.lastX = t0.clientX;
        tr0.lastY = t0.clientY;
        tr1.lastX = t1.clientX;
        tr1.lastY = t1.clientY;

        if (shouldZoomLocally) {
          const midpoint = getTouchMidpoint(t0, t1);
          const nextScale = pinchGesture.startScale * (distance / pinchGesture.startDistance);

          pinchGesture.isLocalZoom = true;
          screenZoom.scale = clamp(nextScale, ZOOM_MIN, ZOOM_MAX);
          screenZoom.translateX = pinchGesture.startTranslateX + (midpoint.x - pinchGesture.startMidX);
          screenZoom.translateY = pinchGesture.startTranslateY + (midpoint.y - pinchGesture.startMidY);
          clampScreenZoom();
          applyScreenZoom();
          return;
        }

        if (Math.abs(avgDx) > 0.5 || Math.abs(avgDy) > 0.5) {
          send({ type: 'scroll', deltaX: avgDx, deltaY: avgDy });
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      clearTimeout(longPressTimer);

      // Collect info before deleting
      const ended = [];
      for (const touch of e.changedTouches) {
        const tracked = activeTouches.get(touch.identifier);
        if (tracked) {
          ended.push({
            id: touch.identifier,
            startX: tracked.startX,
            startY: tracked.startY,
            lastX: touch.clientX,
            lastY: touch.clientY,
            totalMovement: tracked.totalMovement,
            duration: performance.now() - tracked.startTime,
          });
        }
        activeTouches.delete(touch.identifier);
      }

      // Drag mode release
      if (dragMode && e.touches.length === 0) {
        dragMode = false;
        send({ type: 'mouseup' });
        // Set lastTapTime to 0 so the next tap doesn't instantly start another drag
        lastTapTime = 0;
        return;
      }

      // Two finger tap → right click
      if (twoFingerTapData && e.touches.length === 0 && ended.length >= 1) {
        const duration = performance.now() - twoFingerTapData.startTime;
        const allSmallMovement = ended.every(t => t.totalMovement < 15);
        const wasLocalZoom = pinchGesture?.isLocalZoom;
        if (duration < 400 && allSmallMovement && !wasLocalZoom) {
          twoFingerTapData = null;
          pinchGesture = null;
          send({ type: 'rightclick' });
          return;
        }
        twoFingerTapData = null;
      }

      // Single finger tap detection (only if it wasn't multi-touch during the gesture)
      if (ended.length === 1 && e.touches.length === 0 && !wasMultiTouch) {
        const t = ended[0];
        if (t.totalMovement < 15 && t.duration < 250) {
          const now = performance.now();
          
          // Perform click immediately to feel snappy
          if (controlMode === 'touch') {
            const point = getCanvasPointPct(t.lastX, t.lastY);
            send({ type: 'mousemove_abs', x: point.x, y: point.y });
          }
          
          sendWithModifiers({ type: 'click' });
          
          lastTapTime = now;
          lastTapX = t.lastX;
          lastTapY = t.lastY;
        }
      }
      
      if (e.touches.length === 0) {
        wasMultiTouch = false;
        pinchGesture = null;
      } else if (e.touches.length < 2) {
        pinchGesture = null;
      }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      clearTimeout(longPressTimer);
      for (const touch of e.changedTouches) {
        activeTouches.delete(touch.identifier);
      }
      if (dragMode) {
        dragMode = false;
        send({ type: 'mouseup' });
      }
      if (e.touches.length < 2) {
        pinchGesture = null;
      }
      wasMultiTouch = false;
    }, { passive: false });
  }

  /** Send a message, wrapping with active modifiers if any are set */
  function sendWithModifiers(msg) {
    const activeModifiers = Object.entries(modifiers)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (activeModifiers.length > 0 && msg.type === 'click') {
      // Send as a modified click — server can interpret
      send({ ...msg, modifiers: activeModifiers });
      clearModifiers();
    } else {
      send(msg);
    }
  }

  // ─── Keyboard Handler ─────────────────────────────────

  function initKeyboardHandler() {
    const input = dom.keyboardInput;

    input.addEventListener('input', (e) => {
      const text = input.value;
      if (text.length > 0) {
        const activeModifiers = getActiveModifiers();
        if (activeModifiers.length > 0) {
          // Send as hotkey
          for (const char of text) {
            send({ type: 'hotkey', modifiers: activeModifiers, key: char });
          }
          clearModifiers();
        } else {
          send({ type: 'keytype', text });
        }
        input.value = '';
      }
    });

    input.addEventListener('keydown', (e) => {
      const specialKeys = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete'];

      if (specialKeys.includes(e.key)) {
        e.preventDefault();
        const activeModifiers = getActiveModifiers();
        if (activeModifiers.length > 0) {
          send({ type: 'hotkey', modifiers: activeModifiers, key: e.key });
          clearModifiers();
        } else {
          send({ type: 'keypress', key: e.key });
        }
      }
    });
  }

  function toggleKeyboard() {
    const input = dom.keyboardInput;
    if (keyboardVisible) {
      input.blur();
      keyboardVisible = false;
      dom.btnKeyboard.classList.remove('active');
    } else {
      input.focus();
      keyboardVisible = true;
      dom.btnKeyboard.classList.add('active');
    }
  }

  // Also track blur (user dismissed keyboard via iPhone X bar)
  dom.keyboardInput.addEventListener('blur', () => {
    keyboardVisible = false;
    dom.btnKeyboard.classList.remove('active');
  });

  // ─── Modifier / Special Keys ──────────────────────────

  function initSpecialKeys() {
    // Modifier keys toggle on/off
    $$('.modifier-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        modifiers[key] = !modifiers[key];
        btn.classList.toggle('active', modifiers[key]);
      });
    });

    // Action keys send immediately
    $$('.action-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const activeModifiers = getActiveModifiers();

        if (activeModifiers.length > 0) {
          send({ type: 'hotkey', modifiers: activeModifiers, key });
          clearModifiers();
        } else {
          send({ type: 'keypress', key });
        }
      });
    });
  }

  function getActiveModifiers() {
    return Object.entries(modifiers)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }

  function clearModifiers() {
    for (const key in modifiers) {
      modifiers[key] = false;
    }
    $$('.modifier-key').forEach((btn) => btn.classList.remove('active'));
  }

  // ─── Mouse Mode Toggle ────────────────────────────────

  function toggleSpecialKeys() {
    specialKeysVisible = !specialKeysVisible;
    dom.specialKeysBar.classList.toggle('visible', specialKeysVisible);
    dom.btnMouse.classList.toggle('active', specialKeysVisible);
    recalcLayout();
  }

  // ─── Panel Management ─────────────────────────────────

  function openPanel(name) {
    if (activePanel === name) {
      closePanel();
      return;
    }
    closePanel(); // close any existing

    const panel = panelMap[name];
    const btn = panelBtnMap[name];
    if (!panel) return;

    panel.classList.add('active');
    dom.panelOverlay.classList.add('active');
    if (btn) btn.classList.add('active');
    activePanel = name;

    // Panel-specific open actions
    if (name === 'apps') loadApps();
  }

  function closePanel() {
    if (!activePanel) return;
    const panel = panelMap[activePanel];
    const btn = panelBtnMap[activePanel];
    if (panel) panel.classList.remove('active');
    if (btn) btn.classList.remove('active');
    dom.panelOverlay.classList.remove('active');
    activePanel = null;
  }

  dom.panelOverlay.addEventListener('click', closePanel);

  // ─── Toolbar Actions ───────────────────────────────────

  function initToolbar() {
    dom.btnKeyboard.addEventListener('click', toggleKeyboard);
    dom.btnMouse.addEventListener('click', toggleSpecialKeys);
    dom.btnApps.addEventListener('click', () => openPanel('apps'));
    dom.btnClipboard.addEventListener('click', () => openPanel('clipboard'));
    dom.btnFiles.addEventListener('click', () => openPanel('files'));
    dom.btnMedia.addEventListener('click', () => openPanel('media'));
    dom.btnSettings.addEventListener('click', () => openPanel('settings'));
  }

  // ─── Apps Panel ────────────────────────────────────────

  async function loadApps() {
    dom.appsGrid.innerHTML = '<div class="apps-loading">Loading apps…</div>';

    try {
      const res = await fetch('/api/apps');
      if (!res.ok) throw new Error('Failed to fetch apps');
      const data = await res.json();
      const apps = data.apps || data;

      if (!apps || apps.length === 0) {
        dom.appsGrid.innerHTML = '<div class="apps-loading">No apps configured</div>';
        return;
      }

      dom.appsGrid.innerHTML = '';
      apps.forEach((app) => {
        const btn = document.createElement('button');
        btn.className = 'app-item';
        btn.innerHTML = `
          <span class="app-icon">${app.icon || '🖥️'}</span>
          <span class="app-name">${escapeHtml(app.name)}</span>
        `;
        btn.addEventListener('click', () => launchApp(app.name));
        dom.appsGrid.appendChild(btn);
      });
    } catch (err) {
      dom.appsGrid.innerHTML = '<div class="apps-loading">Could not load apps</div>';
      console.error('[Apps]', err);
    }
  }

  async function launchApp(name) {
    try {
      const res = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        showToast(`Launched ${name}`, 'success');
        closePanel();
      } else {
        showToast(`Failed to launch ${name}`, 'error');
      }
    } catch (err) {
      showToast('Launch failed', 'error');
    }
  }

  // ─── Clipboard Panel ──────────────────────────────────

  function initClipboard() {
    dom.clipboardFetch.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/clipboard');
        if (!res.ok) throw new Error();
        const data = await res.json();
        dom.clipboardText.value = data.text || '';
        showToast('Clipboard copied from PC', 'success');
      } catch {
        showToast('Failed to get clipboard', 'error');
      }
    });

    dom.clipboardSend.addEventListener('click', async () => {
      const text = dom.clipboardText.value;
      if (!text) {
        showToast('Nothing to send', 'info');
        return;
      }
      try {
        const res = await fetch('/api/clipboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          showToast('Clipboard sent to PC', 'success');
        } else {
          throw new Error();
        }
      } catch {
        showToast('Failed to send clipboard', 'error');
      }
    });
  }

  // ─── File Upload ───────────────────────────────────────

  function initFileUpload() {
    dom.fileInput.addEventListener('change', () => {
      const files = dom.fileInput.files;
      if (files.length > 0) {
        dom.fileSelected.hidden = false;
        dom.fileName.textContent = files.length === 1
          ? files[0].name
          : `${files.length} files selected`;
        dom.uploadStatus.textContent = '';
        dom.uploadStatus.className = 'upload-status';
        dom.uploadProgressContainer.hidden = true;
      }
    });

    dom.fileUploadBtn.addEventListener('click', () => {
      const files = dom.fileInput.files;
      if (!files || files.length === 0) return;
      uploadFiles(files);
    });
  }

  function uploadFiles(files) {
    const formData = new FormData();
    // Multer is configured for single file upload
    formData.append('file', files[0]);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    dom.uploadProgressContainer.hidden = false;
    dom.uploadProgressFill.style.width = '0%';
    dom.uploadProgressText.textContent = '0%';
    dom.uploadStatus.textContent = 'Uploading…';
    dom.uploadStatus.className = 'upload-status';

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        dom.uploadProgressFill.style.width = pct + '%';
        dom.uploadProgressText.textContent = pct + '%';
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        dom.uploadStatus.textContent = 'Upload complete!';
        dom.uploadStatus.className = 'upload-status success';
        showToast('File uploaded', 'success');
      } else {
        dom.uploadStatus.textContent = 'Upload failed';
        dom.uploadStatus.className = 'upload-status error';
        showToast('Upload failed', 'error');
      }
    });

    xhr.addEventListener('error', () => {
      dom.uploadStatus.textContent = 'Upload error';
      dom.uploadStatus.className = 'upload-status error';
      showToast('Upload error', 'error');
    });

    xhr.send(formData);
  }

  // ─── Media Controls ───────────────────────────────────

  function initMediaControls() {
    $$('.media-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.media;
        if (action) {
          send({ type: 'media', action });
        }
      });
    });
  }

  // ─── Settings ──────────────────────────────────────────

  function initSettings() {
    // Restore saved values
    dom.qualitySlider.value = quality;
    dom.qualityValue.textContent = quality;
    dom.fpsSlider.value = maxFps;
    dom.fpsSettingValue.textContent = maxFps;
    // Sensitivity: slider is 5-30, representing 0.5-3.0
    dom.sensitivitySlider.value = Math.round(sensitivity * 10);
    dom.sensitivityValue.textContent = sensitivity.toFixed(1);

    // Control Mode: touch (Direct Touch) or trackpad (Trackpad)
    function updateControlModeUI() {
      if (controlMode === 'touch') {
        dom.btnModeTouch.classList.add('active');
        dom.btnModeTrackpad.classList.remove('active');
        dom.controlModeValue.textContent = 'Direct Touch';
      } else {
        dom.btnModeTouch.classList.remove('active');
        dom.btnModeTrackpad.classList.add('active');
        dom.controlModeValue.textContent = 'Trackpad';
      }
    }

    updateControlModeUI();

    dom.btnModeTouch.addEventListener('click', () => {
      controlMode = 'touch';
      localStorage.setItem('rd_controlMode', controlMode);
      updateControlModeUI();
      showToast('Switched to Direct Touch', 'info');
    });

    dom.btnModeTrackpad.addEventListener('click', () => {
      controlMode = 'trackpad';
      localStorage.setItem('rd_controlMode', controlMode);
      updateControlModeUI();
      showToast('Switched to Trackpad Mode', 'info');
    });

    dom.qualitySlider.addEventListener('input', () => {
      quality = parseInt(dom.qualitySlider.value, 10);
      dom.qualityValue.textContent = quality;
      localStorage.setItem('rd_quality', quality);
      sendStreamSettings();
    });

    dom.fpsSlider.addEventListener('input', () => {
      maxFps = parseInt(dom.fpsSlider.value, 10);
      dom.fpsSettingValue.textContent = maxFps;
      localStorage.setItem('rd_maxFps', maxFps);
      sendStreamSettings();
    });

    dom.sensitivitySlider.addEventListener('input', () => {
      sensitivity = parseInt(dom.sensitivitySlider.value, 10) / 10;
      dom.sensitivityValue.textContent = sensitivity.toFixed(1);
      localStorage.setItem('rd_sensitivity', sensitivity);
    });
  }

  // ─── Toast ─────────────────────────────────────────────

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 2000);
  }

  // ─── Layout ────────────────────────────────────────────

  function recalcLayout() {
    const keysH = specialKeysVisible ? 'var(--keys-height)' : '0px';
    dom.screenContainer.style.bottom = `calc(var(--toolbar-height) + ${keysH} + var(--safe-bottom))`;
  }

  // ─── Utilities ─────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Window Events ─────────────────────────────────────

  window.addEventListener('resize', resizeCanvas);

  // Prevent pinch zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());

  // Prevent double-tap zoom on non-canvas areas
  let lastTouchEndTime = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEndTime < 300) {
      e.preventDefault();
    }
    lastTouchEndTime = now;
  }, { passive: false });

  let reconnectTimeout;

  // ─── Audio Context Unlocking ──────────────────────────
  let globalAudioCtx = null;

  function initAudio() {
    if (!globalAudioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        globalAudioCtx = new AudioContext();
        // Play a silent sound to unlock the context
        const osc = globalAudioCtx.createOscillator();
        const gain = globalAudioCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(globalAudioCtx.destination);
        osc.start();
        osc.stop(globalAudioCtx.currentTime + 0.01);
      }
    } else if (globalAudioCtx.state === 'suspended') {
      globalAudioCtx.resume();
    }
  }

  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('mousedown', initAudio, { once: true });

  // ─── Initialization ────────────────────────────────────

  function init() {
    initTouchHandlersV2();
    initKeyboardHandler();
    initSpecialKeys();
    initToolbar();
    initClipboard();
    initFileUpload();
    initMediaControls();
    initSettings();
    recalcLayout();

    // Initial special keys bar visibility
    dom.specialKeysBar.classList.add('visible');
    dom.btnMouse.classList.add('active');

    // Connect
    connect();
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
