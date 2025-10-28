import { LS_KEYS, DEFAULT_CAMERAS, UI_DEFAULTS } from './config.js';

/* ============== Minimalny odtwarzacz WHEP (MediaMTX) ============== */
class WhepPlayer {
  constructor(container, url, { muted = true } = {}) {
    this.container = container;
    this.url = url;
    this.muted = muted;
    this.pc = null;
    this.video = null;
  }
  async start() {
    this.stop();

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = this.muted; // domyślnie wyciszone
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');

    this.container.querySelector('video')?.remove();
    this.container.prepend(video);
    this.video = video;

    const pc = new RTCPeerConnection();
    this.pc = pc;

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (ev) => {
      const ms = this.video.srcObject || new MediaStream();
      ms.addTrack(ev.track);
      this.video.srcObject = ms;
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp
    });
    if (!resp.ok) throw new Error(`WHEP failed: ${resp.status}`);
    const answerSdp = await resp.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }
  pause(){ this.video?.pause(); }
  resume(){ this.video?.play().catch(()=>{}); }
  setMuted(m){ this.muted = m; if (this.video) this.video.muted = m; }
  stop(){
    try { this.pc?.getSenders().forEach(s => s.track?.stop()); } catch(_) {}
    try { this.pc?.getReceivers().forEach(r => r.track?.stop()); } catch(_) {}
    try { this.pc?.close(); } catch(_) {}
    this.pc = null;
    if (this.video){
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
  }
}

/* ============== Helpers & stan ============== */
function resolveWebrtcUrl(cam){
  const u = cam?.webrtc || cam?.url;
  return (typeof u === 'string' && u.startsWith('http')) ? u : null;
}

function loadCameras() {
  try {
    const raw = localStorage.getItem(LS_KEYS.cameras);
    if (!raw) return [...DEFAULT_CAMERAS];
    const arr = JSON.parse(raw);
    // akceptuj wpisy z webrtc lub url, ważne żeby JAKIŚ URL istniał
    if (Array.isArray(arr) && arr.every(x => x && x.id && (x.webrtc || x.url))) return arr;
  } catch(_) {}
  return [...DEFAULT_CAMERAS];
}

let CAMERAS = loadCameras();
let mainId  = localStorage.getItem(LS_KEYS.mainId) || CAMERAS[0]?.id || null;
let thumbH  = parseInt(localStorage.getItem(LS_KEYS.thumbH) || String(UI_DEFAULTS.thumbH), 10);
let layout  = localStorage.getItem(LS_KEYS.layout) || UI_DEFAULTS.layout;  // 'sidebar' | 'grid2' | 'grid3'
let page    = parseInt(localStorage.getItem(LS_KEYS.page) || '1', 10);
const gridPageSize = UI_DEFAULTS.gridPageSize;

function saveState(){
  localStorage.setItem(LS_KEYS.cameras, JSON.stringify(CAMERAS));
  localStorage.setItem(LS_KEYS.mainId, mainId || '');
  localStorage.setItem(LS_KEYS.thumbH, String(thumbH));
  localStorage.setItem(LS_KEYS.layout, layout);
  localStorage.setItem(LS_KEYS.page, String(page));
}
function camsMap(){ return new Map(CAMERAS.map(c => [c.id, c])); }

/* ============== DOM ============== */
const mainTitle    = document.getElementById('mainTitle');
const mainView     = document.getElementById('mainView');
const mainMuteBtn  = document.getElementById('mainMuteBtn');
const mainPauseBtn = document.getElementById('mainPauseBtn');

const thumbsEl     = document.getElementById('thumbs');
const statsEl      = document.getElementById('stats');
const thumbRange   = document.getElementById('thumbRange');
const layoutSelect = document.getElementById('layoutSelect');
const gridArea     = document.getElementById('gridArea');
const cfgBtn       = document.getElementById('cfgBtn');
const resetBtn     = document.getElementById('resetBtn');
const prevPageBtn  = document.getElementById('prevPageBtn');
const nextPageBtn  = document.getElementById('nextPageBtn');
const pageInfo     = document.getElementById('pageInfo');

const cfgModal = document.getElementById('cfgModal');
const cfgText  = document.getElementById('cfgText');
const cfgClose = document.getElementById('cfgClose');
const cfgSave  = document.getElementById('cfgSave');
const cfgCancel= document.getElementById('cfgCancel');

/* ============== Instancje odtwarzaczy ============== */
let mainPlayer = null;
const thumbPlayers = new Map(); // id -> WhepPlayer
const gridPlayers  = new Map();

/* ============== Render ============== */
function setThumbHeight(px){
  document.documentElement.style.setProperty('--thumb-h', px + 'px');
  thumbRange.value = px;
}
setThumbHeight(thumbH);

function render(){
  document.body.classList.toggle('layout-grid', layout !== 'sidebar');
  mainView.style.display = (layout === 'sidebar') ? '' : 'none';
  gridArea.style.display = (layout === 'sidebar') ? 'none' : 'grid';
  gridArea.classList.toggle('cols-2', layout === 'grid2');
  gridArea.classList.toggle('cols-3', layout === 'grid3');

  const cmap = camsMap();
  if (!cmap.has(mainId)) mainId = CAMERAS[0]?.id || null;
  const mainCam = cmap.get(mainId) || CAMERAS[0];

  if (layout === 'sidebar') attachMain(mainCam);
  else detachMain();

  // thumbs (wszystkie poza główną)
  thumbsEl.innerHTML = '';
  if (layout === 'sidebar') {
    CAMERAS.filter(c => c.id !== mainId).forEach(cam => {
      const tile = makeTile(cam, { isThumb:true });
      thumbsEl.appendChild(tile);
    });
    pageInfo.textContent = `1/1`;
  } else {
    // GRID + paginacja
    gridArea.innerHTML = '';
    const total = CAMERAS.length;
    const totalPages = Math.max(1, Math.ceil(total / gridPageSize));
    if (page > totalPages) page = totalPages;
    const startIdx = (page - 1) * gridPageSize;
    const pageItems = CAMERAS.slice(startIdx, startIdx + gridPageSize);
    pageInfo.textContent = `${page}/${totalPages}`;
    pageItems.forEach(cam => {
      const tile = makeTile(cam, { isGrid:true });
      gridArea.appendChild(tile);
    });
  }

  statsEl.textContent = `${CAMERAS.length} kamer`;
  saveState();
}

/* ============== Kafelek ============== */
function makeTile(cam, { isThumb = false, isGrid = false } = {}) {
  const container = document.createElement('div');
  container.className = isGrid ? 'gridTile' : 'tile';
  container.dataset.camId = cam.id;

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = cam.name || cam.id;

  const ctrls = document.createElement('div');
  ctrls.className = 'controls';

  const muteBtn = document.createElement('button');
  muteBtn.className = 'btn';
  muteBtn.title = 'Wycisz';
  muteBtn.textContent = '🔇'; // start: wyciszone

  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'btn';
  pauseBtn.title = 'Pauza';
  pauseBtn.textContent = '⏸';

  ctrls.appendChild(muteBtn);
  ctrls.appendChild(pauseBtn);

  container.appendChild(badge);
  container.appendChild(ctrls);

  // Bezpiecznie rozwiąż URL
  const url = resolveWebrtcUrl(cam);
  let player = null;

  if (!url) {
    // Placeholder zamiast POST /undefined
    const msg = document.createElement('div');
    msg.style.position = 'absolute';
    msg.style.inset = '0';
    msg.style.display = 'grid';
    msg.style.placeItems = 'center';
    msg.style.color = '#fecaca';
    msg.style.background = 'rgba(0,0,0,.5)';
    msg.style.fontWeight = '600';
    msg.textContent = 'Brak URL (webrtc)';
    container.appendChild(msg);
  } else {
    player = new WhepPlayer(container, url, { muted: true });
    player.start().catch(err => console.error('WHEP error', cam.id, err));
  }

  // Dblclick: miniatura → zamiana; grid → fullscreen
  container.addEventListener('dblclick', (e)=>{
    e.preventDefault();
    if (isThumb) swapToMain(cam.id);
    else if (isGrid) toggleFullscreen(container);
  });

  // Drag&Drop tylko w thumbach
  if (isThumb) {
    container.draggable = true;
    container.addEventListener('dragstart', (e)=>{
      container.classList.add('dragging');
      e.dataTransfer.setData('text/plain', cam.id);
    });
    container.addEventListener('dragend', ()=> container.classList.remove('dragging'));
  }

  // MUTE/UNMUTE z ikoną
  muteBtn.addEventListener('click', ()=>{
    const nowMuted = !(container.querySelector('video')?.muted ?? true);
    player?.setMuted(nowMuted);
    if (nowMuted) { muteBtn.textContent = '🔇'; muteBtn.title = 'Wycisz'; }
    else          { muteBtn.textContent = '🔊'; muteBtn.title = 'Wyciszenie OFF'; }
  });

  // PAUSE/RESUME z ikoną
  let paused = false;
  pauseBtn.addEventListener('click', ()=>{
    paused = !paused;
    if (paused) { player?.pause();  pauseBtn.textContent='▶️'; pauseBtn.title='Wznów'; }
    else        { player?.resume(); pauseBtn.textContent='⏸';  pauseBtn.title='Pauza'; }
  });

  // zapisz playera
  if (player) {
    if (isThumb) thumbPlayers.set(cam.id, player);
    if (isGrid)  gridPlayers.set(cam.id, player);
  }

  return container;
}

/* ============== Main attach/detach ============== */
function attachMain(cam){
  detachMain();
  mainTitle.textContent = cam?.name || cam?.id || '—';

  const url = resolveWebrtcUrl(cam);
  if (!url) {
    mainView.querySelector('video')?.remove();
    // brak URL — nic nie uruchamiamy
    return;
  }

  mainPlayer = new WhepPlayer(mainView, url, { muted: true });
  mainPlayer.start().catch(err => console.error('WHEP main error', err));

  // MUTE ikona sync
  function refreshMainMuteIcon(){
    const muted = !!mainView.querySelector('video')?.muted;
    if (muted) { mainMuteBtn.textContent='🔇'; mainMuteBtn.title='Wycisz'; }
    else       { mainMuteBtn.textContent='🔊'; mainMuteBtn.title='Wyciszenie OFF'; }
  }
  mainMuteBtn.onclick = ()=>{
    const nowMuted = !(mainView.querySelector('video')?.muted ?? true);
    mainPlayer.setMuted(nowMuted);
    refreshMainMuteIcon();
  };

  // PAUSE
  let mainPaused = false;
  mainPauseBtn.onclick = ()=>{
    mainPaused = !mainPaused;
    if (mainPaused) { mainPlayer.pause();  mainPauseBtn.textContent='▶️'; mainPauseBtn.title='Wznów'; }
    else            { mainPlayer.resume(); mainPauseBtn.textContent='⏸';  mainPauseBtn.title='Pauza'; }
  };

  // Fullscreen
  const onMainDbl = ()=> toggleFullscreen(mainView);
  mainView.addEventListener('dblclick', onMainDbl);

  // odśwież ikonę po chwili (gdy <video> już żyje)
  setTimeout(refreshMainMuteIcon, 200);
}
function detachMain(){
  try { mainPlayer?.stop(); } catch(_){}
  mainPlayer = null;
}

/* ============== Zamiana miniatury na główne ============== */
function swapToMain(newMainId){
  if (!newMainId || newMainId === mainId) return;
  const cmap = camsMap();
  const newMain = cmap.get(newMainId);
  const rest = CAMERAS.filter(c => c.id !== newMainId);
  CAMERAS = [newMain, ...rest];
  mainId = newMainId;

  // Zatrzymaj player miniatury, która idzie na main
  try { thumbPlayers.get(newMainId)?.stop(); } catch(_){}
  thumbPlayers.delete(newMainId);

  render();
}

/* ============== Drag&Drop w pasku ============== */
thumbsEl.addEventListener('dragover', (e)=>{
  e.preventDefault();
  const dragging = thumbsEl.querySelector('.dragging');
  const after = getDragAfterElement(thumbsEl, e.clientY);
  if (!after) thumbsEl.appendChild(dragging);
  else thumbsEl.insertBefore(dragging, after);
});
thumbsEl.addEventListener('drop', ()=>{
  const ids = Array.from(thumbsEl.querySelectorAll('.tile')).map(t => t.dataset.camId);
  const cmap = camsMap();
  const mainCam = cmap.get(mainId);
  const others = ids.map(id => cmap.get(id)).filter(Boolean);
  CAMERAS = [mainCam, ...others];
  stopThumbPlayers();
  render();
});
function getDragAfterElement(container, y){
  const els = [...container.querySelectorAll('.tile:not(.dragging)')];
  return els.reduce((closest, child)=>{
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height/2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    else return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/* ============== Kontrolki topbar ============== */
thumbRange.addEventListener('input', (e)=>{
  thumbH = parseInt(e.target.value, 10);
  setThumbHeight(thumbH);
  saveState();
});
layoutSelect.addEventListener('change', (e)=>{
  layout = (e.target.value === 'grid2') ? 'grid2' : (e.target.value === 'grid3' ? 'grid3' : 'sidebar');
  stopAllPlayers();
  render();
});
prevPageBtn.addEventListener('click', ()=>{
  if (layout === 'sidebar') return;
  const totalPages = Math.max(1, Math.ceil(CAMERAS.length / gridPageSize));
  page = Math.max(1, page - 1);
  stopAllPlayers();
  render();
});
nextPageBtn.addEventListener('click', ()=>{
  if (layout === 'sidebar') return;
  const totalPages = Math.max(1, Math.ceil(CAMERAS.length / gridPageSize));
  page = Math.min(totalPages, page + 1);
  stopAllPlayers();
  render();
});

/* ============== Konfigurator JSON ============== */
function openCfg(){
  // eksportujemy w formacie { id, name, webrtc }
  const exportable = CAMERAS.map(c => ({ id: c.id, name: c.name || c.id, webrtc: c.webrtc || c.url || '' }));
  cfgText.value = JSON.stringify(exportable, null, 2);
  cfgModal.classList.add('active');
  cfgModal.setAttribute('aria-hidden','false');
}
function closeCfg(){
  cfgModal.classList.remove('active');
  cfgModal.setAttribute('aria-hidden','true');
}
cfgBtn.addEventListener('click', openCfg);
cfgClose.addEventListener('click', closeCfg);
cfgCancel.addEventListener('click', closeCfg);
cfgSave.addEventListener('click', ()=>{
  try{
    const arr = JSON.parse(cfgText.value);
    if (!Array.isArray(arr) || !arr.every(x => x && x.id && (x.webrtc || x.url))) {
      alert('Błąd: oczekiwano tablicy obiektów { id, name, webrtc/url }');
      return;
    }
    stopAllPlayers();
    // normalizacja do { id, name, webrtc }
    CAMERAS = arr.map(x => ({ id: x.id, name: x.name || x.id, webrtc: x.webrtc || x.url }));
    if (!CAMERAS.some(c => c.id === mainId)) mainId = CAMERAS[0]?.id || null;
    page = 1;
    saveState();
    closeCfg();
    render();
  }catch(err){
    alert('Nieprawidłowy JSON: ' + err.message);
  }
});

/* ============== Reset do domyślnych ============== */
resetBtn.addEventListener('click', ()=>{
  if (!confirm('Przywrócić domyślną konfigurację?')) return;
  stopAllPlayers();
  // normalizacja defaultów do { webrtc }
  CAMERAS = DEFAULT_CAMERAS.map(c => ({ id: c.id, name: c.name || c.id, webrtc: c.webrtc || c.url }));
  mainId  = CAMERAS[0]?.id || null;
  thumbH  = UI_DEFAULTS.thumbH;
  layout  = UI_DEFAULTS.layout;
  page    = 1;
  Object.values(LS_KEYS).forEach(k => localStorage.removeItem(k));
  setThumbHeight(thumbH);
  document.getElementById('layoutSelect').value = 'sidebar';
  render();
});

/* ============== Helpers ============== */
function stopThumbPlayers(){ for (const p of thumbPlayers.values()) { try{ p.stop(); }catch(_){}} thumbPlayers.clear(); }
function stopGridPlayers(){  for (const p of gridPlayers.values())  { try{ p.stop(); }catch(_){}} gridPlayers.clear(); }
function stopAllPlayers(){ try{ mainPlayer?.stop(); }catch(_){ } mainPlayer = null; stopThumbPlayers(); stopGridPlayers(); }

function toggleFullscreen(el){
  const doc = document;
  if (!doc.fullscreenElement) el.requestFullscreen?.();
  else doc.exitFullscreen?.();
}

/* ============== Start ============== */
(function init(){
  document.getElementById('thumbRange').value = thumbH;
  document.getElementById('layoutSelect').value = (layout === 'grid2') ? 'grid2' : (layout === 'grid3' ? 'grid3' : 'sidebar');
  render();
})();
