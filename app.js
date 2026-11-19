'use strict';
/* SwingMirror 0.9
 * - Camera device: captures the camera and streams it over WebRTC (PeerJS).
 * - Viewer device: receives the stream, buffers it as JPEG frames and replays it with a delay.
 * Runs both as a web app and inside Capacitor (iOS / Android). */

// ───────────────────────── Environment & native helpers ─────────────────────────
const $ = id => document.getElementById(id);
const CFG = window.SWINGMIRROR_CONFIG || {};
const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const platform = (Cap && Cap.getPlatform && Cap.getPlatform()) || 'web';
// Native Capacitor plugins are exposed on Capacitor.Plugins; on the web they are simply undefined.
const plugin = name => (isNative && Cap.Plugins ? Cap.Plugins[name] : undefined);

let webWakeLock = null;
async function setAwake(on) {
  try {
    const KA = plugin('KeepAwake');
    if (KA) { on ? await KA.keepAwake() : await KA.allowSleep(); return; }
    if (on && navigator.wakeLock && !webWakeLock) {
      webWakeLock = await navigator.wakeLock.request('screen');
      webWakeLock.addEventListener('release', () => { webWakeLock = null; });
    } else if (!on && webWakeLock) { await webWakeLock.release(); webWakeLock = null; }
  } catch { /* keep-awake is a convenience, never fatal */ }
}
const refreshAwake = () => setAwake(!!localStream || remoteConnected);

// ───────────────────────── State ─────────────────────────
let tab = 'camera', peer = null, call = null, localStream = null;
let freeze = false, delayMs = 5000, remoteConnected = false;
let displayFit = 'fit', golfMode = false;

const MAX_DELAY_MS = 15000;           // slider maximum
const CLIP_EXTRA_MS = 10000;          // a saved recording covers: current delay + this many seconds
const RETAIN_MS = MAX_DELAY_MS + CLIP_EXTRA_MS + 2500; // frames older than this are dropped
const CAPTURE_FPS = 30;
// w/q: width and JPEG quality of buffered frames; bps: bitrate of a saved recording
const QUALITY = { low: { w: 480, q: 0.5, bps: 1500000 }, medium: { w: 640, q: 0.65, bps: 2500000 }, high: { w: 960, q: 0.8, bps: 4000000 } };

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join('');
// Same id scheme as v0.8, so this app can still pair with the old web version while testing.
const peerId = c => 'swingmirror-v03-' + c.toLowerCase();

function status(s, error = false) { $('status').textContent = s; $('status').className = 'status' + (error ? ' error' : ''); }
function stopTracks(stream) { stream?.getTracks().forEach(t => t.stop()); }

// ───────────────────────── Tabs ─────────────────────────
function selectTab(t) {
  if (golfMode) setGolfMode(false);
  tab = t;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  ['camera', 'viewer'].forEach(id => $(id).classList.toggle('hidden', id !== t));
  $('trainingTools').classList.toggle('hidden', t !== 'viewer');
  resetBuffer();
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => selectTab(b.dataset.tab));

// ───────────────────────── PeerJS helpers ─────────────────────────
function peerOptions() {
  const o = { debug: 0, ...(CFG.peer || {}) };
  if (CFG.iceServers && CFG.iceServers.length) o.config = { iceServers: CFG.iceServers };
  return o;
}
function errorMessage(e) {
  const type = e?.type || '';
  if (type === 'peer-unavailable') return 'Pairing code not found. Start the camera first and check the code.';
  if (type === 'network' || type === 'socket-error' || type === 'socket-closed') return 'Signaling failed. Check your internet connection and try again.';
  if (type === 'webrtc') return 'WebRTC failed. A mobile hotspot or cellular network may require a TURN relay (see config.js).';
  return e?.message || type || String(e);
}
function peerError(e) {
  status('Connection error: ' + errorMessage(e), true);
  $('cameraState').textContent = 'Connection error';
  $('viewerState').textContent = 'Connection error';
}
function watchIce(c, label) {
  const pc = c?.peerConnection;
  if (!pc) return;
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed') status(label + ': the network blocked the direct connection. A TURN relay (see config.js) is needed on this network.', true);
  });
}
function cleanupPeer() {
  if (call) { try { call.close(); } catch { /* ignore */ } call = null; }
  if (peer) { try { peer.destroy(); } catch { /* ignore */ } peer = null; }
  remoteConnected = false;
  $('remoteVideo').srcObject = null;
  $('viewerState').textContent = 'Waiting for connection';
  refreshAwake();
}

// ───────────────────────── Camera device ─────────────────────────
async function openCamera(target) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Error(isNative ? 'Camera API unavailable in this WebView.' : 'Camera requires HTTPS (or localhost) and a compatible browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false
  });
  target.srcObject = stream;
  await target.play();
  return stream;
}

$('startCamera').onclick = async () => {
  try {
    if (!window.Peer) throw Error('PeerJS failed to load.');
    cleanupPeer();
    stopTracks(localStream);
    localStream = await openCamera($('localVideo'));
    refreshAwake();
    $('startCamera').disabled = true;
    $('stopCamera').disabled = false;
    $('cameraState').textContent = 'Connecting…';
    const c = code();
    $('roomCode').textContent = 'Connecting…';
    peer = new Peer(peerId(c), peerOptions());
    peer.on('open', () => {
      $('roomCode').textContent = c;
      $('cameraState').textContent = 'Ready for viewer';
      status('Camera is ready. Enter code ' + c + ' on the viewer device.');
    });
    peer.on('call', incoming => {
      if (call) call.close();
      call = incoming;
      incoming.answer(localStream);
      watchIce(incoming, 'Camera');
      $('cameraState').textContent = 'Viewer connected';
      status('Viewer connected. Streaming video.');
      incoming.on('close', () => { $('cameraState').textContent = 'Viewer disconnected'; status('Viewer disconnected. The camera is still ready.'); });
      incoming.on('error', peerError);
    });
    peer.on('error', peerError);
    peer.on('disconnected', () => status('Signaling disconnected. Restart the camera.', true));
  } catch (e) {
    peerError(e);
    stopTracks(localStream);
    localStream = null;
    refreshAwake();
    $('startCamera').disabled = false;
    $('stopCamera').disabled = true;
  }
};

$('stopCamera').onclick = () => {
  cleanupPeer();
  stopTracks(localStream);
  localStream = null;
  $('localVideo').srcObject = null;
  $('roomCode').textContent = '—';
  $('cameraState').textContent = 'Stopped';
  $('startCamera').disabled = false;
  $('stopCamera').disabled = true;
  refreshAwake();
  status('Camera stopped.');
};

$('copyCode').onclick = async () => {
  const c = $('roomCode').textContent;
  if (c.length !== 6) return;
  try { await navigator.clipboard.writeText(c); status('Code copied.'); } catch { status('Copy unavailable. Enter the code manually.'); }
};

$('localVideo').addEventListener('loadedmetadata', () => {
  const v = $('localVideo');
  if (v.videoWidth && v.videoHeight) v.parentElement.style.aspectRatio = v.videoWidth + ' / ' + v.videoHeight;
});

// ───────────────────────── Viewer device: connection ─────────────────────────
$('connect').onclick = () => {
  const c = $('connectCode').value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) { status('Enter the 6-character code from the camera device.', true); return; }
  if (!window.Peer) { status('PeerJS failed to load.', true); return; }
  cleanupPeer();
  resetBuffer();
  $('viewerState').textContent = 'Connecting…';
  status('Contacting camera…');
  peer = new Peer(undefined, peerOptions());
  peer.on('open', () => {
    try {
      // PeerJS needs a local stream to start a call; a tiny dummy canvas stream is enough (viewer sends no real video).
      const dummy = document.createElement('canvas');
      dummy.width = 2; dummy.height = 2;
      call = peer.call(peerId(c), dummy.captureStream(1));
      if (!call) throw Error('Could not start WebRTC call.');
      watchIce(call, 'Viewer');
      call.on('stream', async s => {
        remoteConnected = true;
        refreshAwake();
        $('remoteVideo').srcObject = s;
        try {
          await $('remoteVideo').play();
          status('Connected! Wait ' + (delayMs / 1000) + ' seconds for the video buffer to fill.');
          resetBuffer();
          startCapture();
        } catch (e) { status('Could not start video playback: ' + e.message, true); }
      });
      call.on('close', () => { remoteConnected = false; refreshAwake(); $('viewerState').textContent = 'Connection closed'; status('Connection lost.', true); });
      call.on('error', peerError);
    } catch (e) { peerError(e); }
  });
  peer.on('error', peerError);
  peer.on('disconnected', () => status('Signaling disconnected.', true));
};
$('disconnect').onclick = () => { cleanupPeer(); resetBuffer(); status('Disconnected.'); };

// ───────────────────────── Viewer device: frame buffer ─────────────────────────
// Capture: the remote <video> is sampled up to 30 times per second and stored as small JPEG blobs
// (about 20–80 KB each → roughly 30–70 MB for 27 s). Display: the frame that is `delayMs` old is decoded and drawn.
// Fit/Fill and mirroring are applied when drawing, so changing them never empties the buffer.
let frames = [];                 // [{ at: performance.now(), blob }]  – sorted by time
const capCanvas = document.createElement('canvas');
const capCtx = capCanvas.getContext('2d');
let capBusy = false, capLast = 0, capturing = false;
let bitmap = null, shown = null, decoding = false, pendingFrame = null;
let canvasMsg = 'Not connected', lastChip = '';

let captureGen = 0; // each (re)start gets a new generation, so an old loop can never run next to a new one
function startCapture() {
  const gen = ++captureGen;
  capturing = true;
  const v = $('remoteVideo');
  if (v.requestVideoFrameCallback) {
    const loop = () => { if (gen !== captureGen) return; grab(v); v.requestVideoFrameCallback(loop); };
    v.requestVideoFrameCallback(loop);
  } else {
    const loop = () => { if (gen !== captureGen) return; grab(v); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

function syncVideoAspect(v) {
  if (!v.videoWidth || !v.videoHeight) return;
  const ar = v.videoWidth + ' / ' + v.videoHeight;
  if ($('viewerStage').style.aspectRatio !== ar) $('viewerStage').style.aspectRatio = ar;
}

function grab(v) {
  if (tab !== 'viewer' || capBusy || v.readyState < 2 || !v.videoWidth) return;
  const now = performance.now();
  if (now - capLast < 1000 / CAPTURE_FPS - 4) return;
  const { w, q } = QUALITY[$('quality').value] || QUALITY.medium;
  const h = Math.round(w * v.videoHeight / v.videoWidth);
  if (capCanvas.width !== w || capCanvas.height !== h) { capCanvas.width = w; capCanvas.height = h; }
  syncVideoAspect(v);
  capCtx.drawImage(v, 0, 0, w, h);
  capBusy = true; capLast = now;
  capCanvas.toBlob(blob => {
    capBusy = false;
    if (!blob) return;
    frames.push({ at: now, blob });
    const cutoff = performance.now() - RETAIN_MS;
    let drop = 0;
    while (drop < frames.length && frames[drop].at < cutoff) drop++;
    if (drop) frames.splice(0, drop);
  }, 'image/jpeg', q);
}

function findFrame(target) { // newest frame with at <= target (binary search)
  let lo = 0, hi = frames.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (frames[m].at <= target) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans < 0 ? null : frames[ans];
}

async function decodeFrame(f) {
  if (decoding) { pendingFrame = f; return; }
  decoding = true;
  try {
    const bmp = await createImageBitmap(f.blob);
    if (bitmap) bitmap.close();
    bitmap = bmp; shown = f;
    paint();
  } catch { /* skip a frame that fails to decode */ }
  decoding = false;
  const p = pendingFrame; pendingFrame = null;
  if (p && p !== shown && !freeze) decodeFrame(p);
}

function resetBuffer() {
  frames = []; shown = null; pendingFrame = null;
  if (bitmap) { bitmap.close(); bitmap = null; }
  canvasMsg = remoteConnected ? 'Buffering…' : 'Not connected';
  paint();
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (tab !== 'viewer') return;
  const now = performance.now();
  if (!freeze) {
    const f = findFrame(now - delayMs);
    if (f && f !== shown) decodeFrame(f);
  }
  updateViewerState(now);
}

function updateViewerState(now) {
  let chip, msg = '';
  if (!remoteConnected) { chip = $('viewerState').textContent; }
  else if (!frames.length || frames[0].at > now - delayMs) {
    const span = frames.length ? Math.max(0, (now - frames[0].at) / 1000) : 0;
    chip = 'Buffering ' + Math.floor(span) + ' / ' + (delayMs / 1000) + ' s';
    msg = chip;
  } else chip = freeze ? 'Frozen' : 'Replay · ' + (delayMs / 1000) + ' s delay';
  if (chip !== lastChip) { lastChip = chip; $('viewerState').textContent = chip; }
  if (remoteConnected && !bitmap && msg !== canvasMsg) { canvasMsg = msg; paint(); }
}

// ───────────────────────── Drawing ─────────────────────────
function sizeCanvases() {
  const r = $('viewerStage').getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = r.width * dpr, h = r.height * dpr;
  const m = Math.max(w, h);
  if (m > 1800) { w *= 1800 / m; h *= 1800 / m; }
  w = Math.round(w); h = Math.round(h);
  for (const id of ['viewerCanvas', 'viewerOverlay']) {
    const c = $(id);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  paint(); updateOverlay();
}
new ResizeObserver(sizeCanvases).observe($('viewerStage'));

function paint() {
  const c = $('viewerCanvas'), ctx = c.getContext('2d'), W = c.width, H = c.height;
  ctx.fillStyle = '#07120e'; ctx.fillRect(0, 0, W, H);
  if (!bitmap) {
    if (canvasMsg) {
      ctx.fillStyle = '#a9c1b3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.max(14, Math.round(W / 26)) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillText(canvasMsg, W / 2, H / 2);
    }
    return;
  }
  const s = (displayFit === 'fill' ? Math.max : Math.min)(W / bitmap.width, H / bitmap.height);
  const w = bitmap.width * s, h = bitmap.height * s;
  ctx.save();
  if ($('mirror').checked) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(bitmap, (W - w) / 2, (H - h) / 2, w, h);
  ctx.restore();
}

function drawGuides(ctx, W, H) { // shared by the live overlay and saved recordings
  const k = Math.max(1, W / 640);
  if ($('grid').checked) {
    ctx.strokeStyle = 'rgba(185,239,207,.28)'; ctx.lineWidth = k;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(W * i / 3, 0); ctx.lineTo(W * i / 3, H);
      ctx.moveTo(0, H * i / 3); ctx.lineTo(W, H * i / 3);
      ctx.stroke();
    }
  }
  if ($('guides').checked) {
    ctx.strokeStyle = 'rgba(135,233,178,.75)'; ctx.lineWidth = 1.5 * k; ctx.setLineDash([9 * k, 8 * k]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H * .75); ctx.lineTo(W, H * .75);
    ctx.stroke(); ctx.setLineDash([]);
  }
}
function updateOverlay() {
  const c = $('viewerOverlay'), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  drawGuides(ctx, c.width, c.height);
}

// ───────────────────────── Training tools ─────────────────────────
$('fitMode').onchange = e => { displayFit = e.target.value; paint(); };
$('delay').oninput = e => { delayMs = Number(e.target.value) * 1000; $('delayLabel').textContent = e.target.value + ' sec'; };
$('clear').onclick = () => { resetBuffer(); status('Buffer reset.'); };
$('mirror').onchange = paint;
['guides', 'grid'].forEach(id => $(id).addEventListener('input', updateOverlay));
$('freeze').onclick = () => {
  freeze = !freeze;
  $('freeze').textContent = freeze ? '▶ Resume' : '⏸ Freeze frame';
};

async function androidAlbumId(Media) {
  const find = async () => (await Media.getAlbums()).albums.find(a => a.name === 'SwingMirror');
  let a = await find();
  if (!a) { await Media.createAlbum({ name: 'SwingMirror' }); a = await find(); }
  return a && a.identifier;
}

// ── Save recording ──
// Nothing is stored during normal practice. When the user taps "Save recording", the newest part of the
// frame buffer (current delay + 10 s) is replayed into a hidden canvas and encoded to a video with MediaRecorder,
// then saved to Photos (iOS) / the SwingMirror album (Android) – or downloaded in a browser.
let saving = false;

function pickRecorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || null;
}
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
const blobToBase64 = b => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});

async function encodeClip(clip, mime, bps, onProgress) {
  const last = await createImageBitmap(clip[clip.length - 1].blob);
  const cw = last.width & ~1, ch = last.height & ~1; // even dimensions for H.264
  last.close();
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const rec = new MediaRecorder(canvas.captureStream(CAPTURE_FPS), { mimeType: mime, videoBitsPerSecond: bps });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res, rej) => { rec.onstop = res; rec.onerror = e => rej(e.error || new Error('Recorder error')); });
  const mirror = $('mirror').checked;
  let cur = null;
  const draw = () => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
    if (cur) {
      ctx.save();
      if (mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
      ctx.drawImage(cur, 0, 0, cw, ch);
      ctx.restore();
    }
    drawGuides(ctx, cw, ch); // guides/grid appear in the recording only if they are switched on
  };
  const start = clip[0].at, duration = clip[clip.length - 1].at - start;
  let i = 0, curIdx = -1;
  rec.start(1000);
  const t0 = performance.now();
  for (;;) {
    const elapsed = performance.now() - t0;
    if (elapsed >= duration) break;
    const target = start + elapsed;
    while (i + 1 < clip.length && clip[i + 1].at <= target) i++;
    if (i !== curIdx) { const b = await createImageBitmap(clip[i].blob); if (cur) cur.close(); cur = b; curIdx = i; }
    draw();
    onProgress(Math.min(1, elapsed / duration));
    await nextFrame();
  }
  if (cur) cur.close();
  cur = await createImageBitmap(clip[clip.length - 1].blob);
  draw();
  await new Promise(r => setTimeout(r, 200)); // let the final frame be encoded
  rec.stop();
  await stopped;
  cur.close();
  return new Blob(chunks, { type: mime.split(';')[0] });
}

async function saveToDevice(blob, ext) {
  const name = 'swingmirror-' + new Date().toISOString().replace(/[:.]/g, '-');
  const Media = plugin('Media'), FS = plugin('Filesystem');
  if (Media && FS) {
    // Write the video to a temporary file in small pieces (large strings over the native bridge are fragile),
    // then hand the file path to the media plugin.
    const file = name + '.' + ext, CHUNK = 3 * 256 * 1024; // multiple of 3 bytes → every base64 piece stands alone
    for (let off = 0; off < blob.size; off += CHUNK) {
      const data = await blobToBase64(blob.slice(off, off + CHUNK));
      if (off === 0) await FS.writeFile({ path: file, data, directory: 'CACHE' });
      else await FS.appendFile({ path: file, data, directory: 'CACHE' });
    }
    try {
      const { uri } = await FS.getUri({ path: file, directory: 'CACHE' });
      const opts = { path: uri };
      if (platform === 'android') { opts.albumIdentifier = await androidAlbumId(Media); opts.fileName = name; }
      await Media.saveVideo(opts);
    } finally {
      try { await FS.deleteFile({ path: file, directory: 'CACHE' }); } catch { /* temp file cleanup is best effort */ }
    }
    return platform === 'android' ? 'Recording saved to the SwingMirror album in your gallery.' : 'Recording saved to Photos.';
  }
  const a = document.createElement('a'); // browser fallback
  a.href = URL.createObjectURL(blob); a.download = name + '.' + ext; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'Recording downloaded.';
}

$('saveClip').onclick = async () => {
  if (tab !== 'viewer') { status('Switch to Viewer to save a recording.', true); return; }
  if (saving) return;
  if (frames.length < 10) { status('Nothing to save yet – wait until the video is playing.', true); return; }
  const mime = pickRecorderType();
  if (!mime) { status('Saving video is not supported on this device.', true); return; }
  const newest = frames[frames.length - 1].at;
  const clip = frames.filter(f => f.at >= newest - (delayMs + CLIP_EXTRA_MS)); // a copy: unaffected by later trimming
  if (clip.length < 2) { status('Nothing to save yet.', true); return; }
  const secs = Math.round((clip[clip.length - 1].at - clip[0].at) / 1000);
  const btn = $('saveClip');
  saving = true; btn.disabled = true;
  status('Saving the last ' + secs + ' seconds… keep the app open. You can keep practising.');
  try {
    const blob = await encodeClip(clip, mime, (QUALITY[$('quality').value] || QUALITY.medium).bps,
      p => { btn.textContent = '⏺ Saving ' + Math.round(p * 100) + '%'; });
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    status(await saveToDevice(blob, ext));
  } catch (e) {
    status('Could not save recording: ' + (e?.message || e?.code || JSON.stringify(e)), true);
  } finally {
    saving = false; btn.disabled = false; btn.textContent = '⏺ Save recording';
  }
};

// ───────────────────────── Golf Mode ─────────────────────────
function setGolfMode(on) {
  golfMode = on;
  document.body.classList.toggle('golf-active', on);
  $('golfExit').classList.toggle('hidden', !on);
  $('restore').classList.toggle('hidden', !on);
  $('fullscreen').classList.toggle('hidden', on);
  if (on) window.scrollTo(0, 0);
  requestAnimationFrame(sizeCanvases);
}
$('fullscreen').onclick = () => { if (tab === 'viewer') setGolfMode(true); };
$('restore').onclick = () => setGolfMode(false);
$('golfExit').onclick = () => setGolfMode(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && golfMode) setGolfMode(false); });

// ───────────────────────── Diagnostics ─────────────────────────
$('diagnose').onclick = () => {
  const ice = CFG.iceServers && CFG.iceServers.length ? CFG.iceServers.length + ' custom server(s)' : 'PeerJS defaults (shared, for testing)';
  const lines = [
    'Platform: ' + platform + (isNative ? ' (native app)' : ' (browser)'),
    'Secure context: ' + (window.isSecureContext ? 'OK' : 'NO'),
    'Camera API: ' + (navigator.mediaDevices?.getUserMedia ? 'OK' : 'Unavailable'),
    'PeerJS loaded: ' + (window.Peer ? 'YES' : 'NO'),
    'WebRTC: ' + (window.RTCPeerConnection ? 'OK' : 'Unavailable'),
    'Network: ' + (navigator.onLine ? 'online' : 'offline'),
    'Signaling server: ' + (CFG.peer && CFG.peer.host ? CFG.peer.host : 'PeerJS public cloud'),
    'ICE/TURN: ' + ice,
    'Signaling connection: ' + (peer?.open ? 'open' : 'none'),
    'Buffered frames: ' + frames.length
  ];
  $('diagnostic').textContent = lines.join('\n');
  status('Diagnostics ready. This cannot guarantee that WebRTC works on your current network.');
};
$('retry').onclick = () => {
  if (tab === 'viewer') $('connect').click();
  else { $('stopCamera').click(); $('startCamera').click(); }
};

// ───────────────────────── App lifecycle ─────────────────────────
const AppPlugin = plugin('App');
if (AppPlugin) {
  // Android back button: leave Golf Mode first, otherwise close the app.
  AppPlugin.addListener('backButton', () => { if (golfMode) setGolfMode(false); else AppPlugin.exitApp(); });
  // iOS/Android stop the camera when the app is in the background – tell the user instead of leaving a dead stream.
  AppPlugin.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return;
    if (localStream && localStream.getTracks().some(t => t.readyState === 'ended')) {
      $('stopCamera').click();
      status('The camera was interrupted while the app was in the background. Tap "Start camera" again.', true);
    }
    refreshAwake();
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAwake(); });
window.addEventListener('pagehide', () => { cleanupPeer(); stopTracks(localStream); captureGen++; });

updateOverlay();
renderLoop();
