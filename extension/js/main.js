// Entry point: loads state, renders background + clock, wires drag and drop and the other widgets.

import { state, loadState, subscribe, emit, onOtherTabChange } from './store.js';
import { loadPhotos, ensureCurrent, getPhoto, preloadNext, addFiles, setCurrent } from './photos.js';
import { renderGreeting, tickGreeting } from './greeting.js';
import { initPopup, renderPopup } from './popup.js';
import { initSettings, renderSettings, openSettings } from './settings.js';
import { isDark, now } from './night.js';
import { syncBlocked } from './blocker.js';
import { isLocked, untilText } from './lock.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
let shownKey = null;

// Swaps the background to the current photo: decode first, then fade (0.3s first load, 2s after).
// Nothing is rendered during night hours, so a tab opened then never flashes a photo.
async function renderBackground() {
  if (isDark(now().getHours())) return;
  const photo = getPhoto(state.current?.key);
  if (!photo || photo.key === shownKey) return;
  const first = shownKey === null;
  shownKey = photo.key;
  const img = new Image();
  img.src = photo.url;
  await img.decode().catch(() => {});
  if (shownKey !== photo.key) return; // a newer switch started meanwhile
  const layer = document.createElement('div');
  layer.className = `background-item ${first ? 'fade' : 'fade-slow'}`;
  layer.dataset.ratio = img.naturalWidth / img.naturalHeight;
  // .blur is the scaled-up, darkened copy that fills the empty space in Fit mode
  layer.innerHTML = '<div class="background-blur"></div><div class="background-photo"></div>';
  for (const el of layer.children) el.style.backgroundImage = `url("${photo.url}")`;
  applyFit(layer);
  $('backgrounds').append(layer);
  layer.addEventListener('animationend', () => {
    while ($('backgrounds').firstChild !== layer) $('backgrounds').firstChild.remove();
  });
  preloadNext();
}

// Sets Fit (whole photo over a blurred copy) or Fill (cover) on background layers.
// Auto fits when cover would crop more than 35% of the photo at this viewport.
function applyFit(...layers) {
  const { fit } = state.settings;
  const vp = innerWidth / innerHeight;
  for (const layer of layers.length ? layers : $('backgrounds').children) {
    const img = Number(layer.dataset.ratio);
    const crop = 1 - Math.min(img / vp, vp / img);
    layer.classList.toggle('fit', fit === 'fit' || (fit === 'auto' && crop > 0.35));
  }
}

// Big center clock; 24h shows hours without a leading zero.
// 12h adds a small A.M. / P.M. to the right.
function renderClock() {
  const time = now();
  const h = time.getHours();
  const { hour12 } = state.settings;
  const el = $('clock');
  el.hidden = !state.settings.clockVisible;
  el.querySelector('.hours').textContent = hour12 ? h % 12 || 12 : h;
  el.querySelector('.ampm').textContent = hour12 ? (h < 12 ? 'A.M.' : 'P.M.') : '';
  el.querySelector('.minutes').textContent = String(time.getMinutes()).padStart(2, '0');
}

// Bottom-left location text, hidden when the photo has none or when it is not on screen.
function renderLocation() {
  const el = $('location');
  el.textContent = getPhoto(state.current?.key)?.location || '';
  el.hidden = !el.textContent || isDark(now().getHours());
}

// Bottom-left "Super locked until 10:00" while super lock is on (js/lock.js). The lock starting or ending re-renders
// Settings, which locks or frees its rows.
let locked = null;
function renderLock() {
  const on = isLocked(state.settings, now());
  $('lock-item').hidden = !on;
  $('lock-button').innerHTML = `${icon('lock')}Super locked ${untilText(state.settings, (t) => `<em>${t}</em>`)}`;
  if (locked !== null && on !== locked) renderSettings();
  locked = on;
}

// During night hours (Settings > Night mode) the page is plain black behind the clock, no photo at all.
// A tab open across the boundary fades the photo out, then the layers are dropped;
// in the morning the photo comes back. Rotation underneath is untouched, this is only a display rule.
let dark = null;
function renderNight() {
  const on = isDark(now().getHours());
  if (on === dark) return;
  dark = on;
  document.documentElement.classList.toggle('night', on);
  if (!on) return renderBackground();
  setTimeout(() => {
    if (!dark) return; // back in daylight before the fade finished
    $('backgrounds').replaceChildren();
    shownKey = null;
  }, 2000); // the .backgrounds opacity transition
}
renderNight();

function renderAll() {
  renderNight();
  renderClock();
  renderGreeting();
  renderLocation();
  renderLock();
  renderPopup();
  renderSettings();
  renderBackground();
  applyFit();
}

// Drop image files anywhere: store them, show the first, open Settings > Photos.
function initDragAndDrop() {
  const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
  let depth = 0;
  const setVisible = (on) => {
    $('uploader').classList.toggle('visible', on);
    document.body.classList.toggle('dragging', on);
  };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth += 1;
    setVisible(true);
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) setVisible(false);
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = hasFiles(e) ? 'copy' : 'none';
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    setVisible(false);
    const keys = await addFiles([...(e.dataTransfer?.files || [])]);
    if (!keys.length) return;
    await setCurrent(keys[0]);
    openSettings('photos', 'custom');
  });
}

async function boot() {
  await loadState();
  syncBlocked();
  renderNight();
  renderClock();
  renderGreeting();
  await loadPhotos();
  await ensureCurrent();
  initPopup();
  initSettings();
  initDragAndDrop();
  // A click on the bottom-left lock opens Settings at Super lock
  $('lock-button').addEventListener('click', () => {
    openSettings('distractions');
    document.getElementById('super-lock')?.scrollIntoView({ block: 'center' });
  });
  subscribe(renderAll);
  renderAll();
  // Keep open tabs in sync so a stale tab never overwrites newer favorites/history.
  onOtherTabChange(async () => {
    await Promise.all([loadState(), loadPhotos()]);
    emit();
  });
  // Re-pick Auto fit live, e.g. when the window snaps to half screen.
  let frame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => applyFit());
  });
  setInterval(() => {
    renderNight();
    renderClock();
    tickGreeting();
    renderLocation();
    renderLock();
  }, 1000);
}

boot();
