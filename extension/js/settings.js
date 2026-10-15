// Settings panel: General (widget toggles, your name), Photos (My Photos / Nature / Favorites / History grids, Settings sub-tab),
// Night mode (photo off at night, "Go to sleep" greeting, hours) and Distractions (blocked websites, Think twice websites,
// super lock).

import { state, setSetting, save, emit } from './store.js';
import { icon } from './icons.js';
import { esc, toggle, dismissOnOutside } from './dom.js';
import { greeting, withName } from './greeting.js';
import { isDark, pinTime } from './night.js';
import { setSites, canBlock, startPass } from './blocker.js';
import { toSite } from './sites.js';
import { isLocked, hourLabel, untilText } from './lock.js';
import { getPhoto, exists, customKeys, stockKeys, addFiles, setCurrent, showNext, updateCustom, deleteCustom, toggleFavorite, periodFor } from './photos.js';

const panel = document.getElementById('settings');
const toggleBtn = document.getElementById('settings-toggle');
const ui = { open: false, tab: 'general', photosTab: 'custom', editingId: null, passing: null }; // passing: the Think twice row with its pass picker open

const FEEDS = [
  ['stock', 'Nature photos', 'See a new photo from the curated nature feed'],
  ['custom', 'My photos', 'Add your own photos and change the photo anytime'],
  ['favorites', 'Favorites', 'Rotate through the photos you marked with a heart'],
];
const FREQUENCIES = [['tab', 'Every new tab'], ['hour', 'Every hour'], ['random', 'Every 6-12 hours'], ['day', 'Every day']];
const FITS = [['auto', 'Auto'], ['fill', 'Fill screen'], ['fit', 'Fit to screen']];

// Opens the panel on a tab ("general" | "photos" | "night" | "distractions"), optionally on a photos sub-tab.
export function openSettings(tab, photosTab) {
  Object.assign(ui, { open: true, tab, editingId: null }, photosTab && { photosTab });
  renderSettings();
}

export function closeSettings() {
  ui.open = false;
  ui.editingId = null;
  renderSettings();
}

// One settings row with label, description and a right-side control.
const option = (act, label, desc, control, extra = '') =>
  `<div class="option" ${act}><div><div class="option-label">${label}</div><div class="option-description">${desc}</div></div>${control}</div>${extra}`;

// "A | B | C" choice list; each button carries data-<name>="value".
const optionsList = (name, choices, active) => `<div class="options-list-row">${choices.map(([v, label], i) =>
  `${i ? '<span class="options-list-divider"></span>' : ''}<button class="options-list-option${active === v ? ' active' : ''}" data-${name}="${v}">${label}</button>`).join('')}</div>`;

function generalPanel() {
  const s = state.settings;
  return `
    <div class="setting-panel">
      <div class="setting-panel-title">General</div>
      <div class="setting-panel-description">Customize your dashboard</div>
      <div class="section">
        <div class="section-header">Apps</div>
        ${option('data-setting="clockVisible"', 'Clock', 'Shows the time in the dashboard center', toggle(s.clockVisible))}
        ${option('data-setting="hour12"', '24-hour clock', 'Show 14:30 instead of 2:30', toggle(!s.hour12))}
        ${option('data-setting="greetingVisible"', 'Greeting', 'Personalized greeting in the center', toggle(s.greetingVisible))}
        ${s.greetingVisible ? option('data-setting="includeName"', 'Include name', 'Greet you by name', toggle(s.includeName)) : ''}
        ${s.greetingVisible && s.includeName ? option('', 'Your name', 'Shown in the greeting', `<input class="name-input" value="${esc(s.name)}" placeholder="Name" spellcheck="false">`) : ''}
      </div>
    </div>`;
}

// Hour dropdown; carries data-hour="<setting>" so the change handler knows what to save.
function hourSelect(setting, disabled = false) {
  const { hour12 } = state.settings;
  const opts = Array.from({ length: 24 }, (_, h) => `<option value="${h}"${state.settings[setting] === h ? ' selected' : ''}>${hourLabel(h, hour12)}</option>`);
  return `<select class="hour-select" data-hour="${setting}"${disabled ? ' disabled' : ''}>${opts.join('')}</select>`;
}

// Mini new tab at `hour`: black when `dark`, else the current photo. Dimmed while its toggle is off.
// Clicking it plays the switch on the page itself (playPreview).
function nightPreview(hour, text, dark, on) {
  const h = state.settings.hour12 ? hour % 12 || 12 : hour;
  const thumb = !dark && getPhoto(state.current?.key)?.thumb;
  return `<div class="night-preview${on ? '' : ' off'}" data-preview="${hour}"${thumb ? ` style="background-image:url('${esc(thumb)}')"` : ''}>
    <div class="night-preview-time">${h}:00</div><div class="night-preview-greeting">${esc(text)}</div>
    <span class="night-preview-chip">${icon('maximize')}Preview</span>
  </div>`;
}

// Closes the panel and shows the page at a minute to `hour`, then at `hour`:00, then reopens Night mode.
// Any click or key ends it early, and only ends it, so the click doesn't also land on the page.
function playPreview(hour) {
  const at = (h, m) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    pinTime(d);
    emit();
  };
  const end = (e) => {
    e?.stopPropagation();
    if (e?.type === 'mousedown') addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
    timers.forEach(clearTimeout);
    removeEventListener('mousedown', end, true);
    removeEventListener('keydown', end, true);
    pinTime(null);
    openSettings('night');
    emit();
  };
  closeSettings();
  at((hour + 23) % 24, 59);
  const timers = [setTimeout(() => at(hour, 0), 1500), setTimeout(end, 5500)];
  addEventListener('mousedown', end, true);
  addEventListener('keydown', end, true);
}

function nightPanel() {
  const s = state.settings;
  const photoOff = nightPreview(s.nightFrom, withName(greeting(s.nightFrom)), true, s.nightMode);
  const sleep = nightPreview(s.sleepFrom, withName('Go to sleep'), isDark(s.sleepFrom), s.sleepGreeting);
  return `
    <div class="setting-panel">
      <div class="setting-panel-title">Night mode</div>
      <div class="setting-panel-description">Wind down in the evening</div>
      <div class="section">
        <div class="section-header">Night mode</div>
        ${option('data-setting="nightMode"', 'Photo off at night', 'No photo, just the clock on black', toggle(s.nightMode), photoOff)}
        ${option('data-setting="sleepGreeting"', 'Go to sleep', 'The greeting says "Go to sleep" instead of "Good evening"', toggle(s.sleepGreeting), sleep)}
      </div>
      <div class="section">
        <div class="section-header">Hours</div>
        ${option('', 'Photo off from', 'When the screen goes black', hourSelect('nightFrom'))}
        ${option('', 'Go to sleep from', 'When the greeting changes', hourSelect('sleepFrom'))}
        ${option('', 'Morning at', 'Photo and greeting back to normal', hourSelect('wakeAt'))}
      </div>
    </div>`;
}

// One list of sites in the Distractions tab: type a site to add it, x to remove it. `key` is the state list, "blocked" or "ask".
// A typed URL keeps its path, so it covers only that part of the site (see sites.js).
// `preview` is the inside of a mini copy of the page a listed site opens, `extra` an optional second preview next to it.
function siteList(key, title, desc, button, preview, extra = '') {
  const sites = state[key].map((d) => siteRow(key, d));
  return `
      <div class="section" data-list="${key}">
        <div class="section-header">${title}</div>
        <div class="option-description">${desc}</div>
        <div class="site-previews"><div class="site-preview"><img src="icons/icon128.png" alt="">${preview}</div>${extra}</div>
        <div class="block-add">
          <input placeholder="https://example.com/" spellcheck="false">
          <button class="button button-primary" data-act="add-site">${button}</button>
        </div>
        ${sites.join('')}
      </div>`;
}

// Lengths a pass can have, plus typed minutes
const passPicker = `<div class="pass-picker">${[[15, '15 min'], [30, '30 min'], [60, '1 hour']]
  .map(([m, label]) => `<button class="button button-neutral" data-minutes="${m}">${label}</button>`).join('')}
  <label class="pass-custom"><input inputmode="numeric" maxlength="3" spellcheck="false">min</label></div>`;

// One site of a list. A Think twice row gets Pass, which opens the length picker under it, and during a pass
// reads "youtube.com is free until 23:40" with End. Passes need the alarms permission, so Pass waits for a Reload with it.
// During super lock a Think twice row has neither Pass nor x: no pass, and the site stays on the list.
function siteRow(key, site) {
  const locked = key === 'ask' && isLocked(state.settings);
  const until = key === 'ask' && state.passes[site];
  const time = until && new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: state.settings.hour12 });
  const pass = key !== 'ask' || !chrome.alarms || locked ? ''
    : `<button class="button button-neutral pass-button" data-act="${until ? 'end-pass' : 'pass-site'}">${until ? 'End' : 'Pass'}</button>`;
  const remove = locked ? '' : `<button data-act="remove-site" title="Remove">${icon('x')}</button>`;
  return `<div class="blocked-site" data-site="${esc(site)}">
      <span>${until ? `<em>${esc(site)}</em> is free until <em>${time}</em>` : esc(site)}</span>
      <div class="site-actions">${pass}${remove}</div>
      ${ui.passing === site ? passPicker : ''}
    </div>`;
}

// Starts a pass from the picker under a Think twice row.
function passSite(site, minutes) {
  if (!(minutes > 0)) return;
  ui.passing = null;
  return startPass(site, minutes);
}

// Super lock (js/lock.js): every day in these hours Think twice sites don't open at all. While it's on nothing here
// gives way: the switch and the hours are disabled, the header says until when.
function lockSection() {
  const s = state.settings;
  const on = isLocked(s);
  const locked = `<p><em>example.com</em> is super locked ${esc(untilText(s))}.</p><div class="site-preview-answers"><span>OK</span></div>`;
  return `
      <div class="section" id="super-lock">
        <div class="section-header">Super lock${on ? `<span class="lock-label">${icon('lock')}Locked ${esc(untilText(s))}</span>` : ''}</div>
        <div class="option-description">Think twice sites don't open in these hours</div>
        <div class="site-previews"><div class="site-preview"><img src="icons/icon128.png" alt="">${locked}</div></div>
        <div class="lock-options${on ? ' on' : ''}">
          ${option(on ? '' : 'data-setting="superLock"', 'Super lock', 'Every day, no Yes, Save or Pass', toggle(s.superLock))}
          ${option('', 'From', 'When the lock starts', hourSelect('lockFrom', on))}
          ${option('', 'Until', 'When the sites ask again', hourSelect('lockUntil', on))}
        </div>
      </div>`;
}

// Distractions tab: blocked websites, Think twice websites that ask before they open, and super lock.
// The previews copy blocked.html and ask.html, with example.com as the site, and the todo pill js/todo.js puts on a site after Yes.
function distractionsPanel() {
  const blocked = '<p>You blocked <em>example.com</em> for a reason, so back to what matters.</p>';
  const ask = `<p>Do you really need <em>example.com</em>?</p><div class="site-preview-answers"><span>Yes</span><span>Save</span><span>No</span></div>`;
  const todos = `<div class="site-preview site-preview-page">
          <div class="site-preview-pill"><img src="icons/icon128.png" alt="">Todos <em>(2)</em></div>
          <div class="site-preview-card"><span>Reply to Anna</span><em>Check the voucher</em></div>
        </div>`;
  return `
    <div class="setting-panel">
      <div class="setting-panel-title">Distractions</div>
      <div class="setting-panel-description">Stay away from websites that distract you</div>
      ${canBlock() ? '' : '<div class="block-note">Nothing is blocked yet. Reload this extension on chrome://extensions to turn blocking on.</div>'}
      ${siteList('blocked', 'Blocked websites', 'The site never opens, you see this instead', 'Block', blocked)}
      ${siteList('ask', 'Think twice', 'The site asks if you really need it and shows your list for it', 'Add', ask, todos)}
      ${lockSection()}
    </div>`;
}

// Adds the site typed into a Distractions list. Saving re-renders the panel right away with an empty input,
// so focus goes back to it for the next site.
function addSite(key) {
  const input = () => panel.querySelector(`[data-list="${key}"] input`);
  const site = toSite(input().value);
  if (!site || state[key].includes(site)) return;
  const saving = setSites(key, [...state[key], site]);
  input().focus();
  return saving;
}

// Thumbnail tile; `actions` are extra buttons shown on hover.
function tile(key, actions = '') {
  const p = getPhoto(key);
  const active = state.current?.key === key ? ' active' : '';
  return `<div class="tile-list-item${active}" data-key="${esc(key)}" title="${esc(p.location)}">
    <div class="tile-list-image" style="background-image:url('${esc(p.thumb)}')"></div>
    ${actions && `<div class="tile-list-actions">${actions}</div>`}
  </div>`;
}

function tileButton(act, name, title) {
  return `<button class="tile-action" data-act="${act}" title="${title}">${icon(name)}</button>`;
}

// Inline form for a custom photo's location and credit.
function editForm() {
  const p = getPhoto(`custom:${ui.editingId}`);
  if (!p) return '';
  return `
    <div class="section edit-photo">
      <div class="edit-thumb" style="background-image:url('${esc(p.thumb)}')"></div>
      <div class="edit-fields">
        <input data-field="location" placeholder="Location" value="${esc(p.location)}" spellcheck="false">
        <input data-field="photographer" placeholder="Photographer (optional)" value="${esc(p.photographer)}" spellcheck="false">
      </div>
      <div class="edit-actions">
        <button class="button button-neutral" data-act="cancel-edit">Cancel</button>
        <button class="button button-primary" data-act="save-edit">Save</button>
      </div>
    </div>`;
}

// Photos > Settings sub-tab: feeds (any mix, at least one), rotation frequency and photo fit.
function photoSettings() {
  const { feeds, frequency, fit } = state.settings;
  return `
    <div class="section">
      <div class="section-header">Feeds</div>
      ${FEEDS.map(([v, label, desc]) => option(`data-feed="${v}"`, label, desc, toggle(feeds.includes(v)))).join('')}
    </div>
    <div class="section">
      <div class="section-header">Display</div>
      ${option('', 'Change photo', 'How often a new photo appears', optionsList('frequency', FREQUENCIES, frequency))}
      ${option('', 'Photo fit', 'Auto shows the whole photo if filling crops too much', optionsList('fit', FITS, fit))}
    </div>`;
}

function photoGrid() {
  const t = ui.photosTab;
  if (t === 'settings') return photoSettings();
  const empty = (title, desc) =>
    `<div class="settings-empty"><p class="settings-empty-title">${title}</p><p class="settings-empty-description">${desc}</p></div>`;
  let keys;
  let actions;
  if (t === 'custom') {
    keys = customKeys();
    actions = tileButton('edit', 'pencil', 'Edit location') + tileButton('delete', 'x', 'Delete photo');
    if (!keys.length) return empty('Personalize your dashboard with your own photos', 'Drag and drop a photo or click + Add Photo');
  } else if (t === 'stock') {
    keys = stockKeys();
    actions = '';
  } else if (t === 'favorites') {
    keys = state.favorites.filter(exists);
    actions = tileButton('unfavorite', 'x', 'Remove from favorites');
    if (!keys.length) return empty('No favorite photos yet', 'Click the heart icon under a photo caption to start your collection');
  } else {
    keys = state.history.filter(exists);
    actions = '';
    if (!keys.length) return empty('No history yet', 'Photos you have seen will show up here');
  }
  return `${t === 'custom' && ui.editingId ? editForm() : ''}
    <div class="backgrounds-list"><div class="tile-list">${keys.map((k) => tile(k, actions)).join('')}</div></div>`;
}

function photosPanel() {
  const tabs = [['custom', 'My Photos'], ['stock', 'Nature'], ['favorites', 'Favorites'], ['history', 'History'], ['settings', 'Settings']];
  return `
    <div class="setting-panel">
      <div class="panel-header-row">
        <div>
          <div class="setting-panel-title">Photos</div>
          <div class="setting-panel-description">See a new inspiring photo every few hours</div>
        </div>
        ${ui.photosTab === 'settings' ? '' : '<label class="button button-primary list-add-button">+ Add Photo<input type="file" accept="image/*" multiple></label>'}
      </div>
      <div class="settings-subnav">
        <div class="subnav-tabs">${tabs.map(([v, label]) => `<h4 class="${ui.photosTab === v ? 'active' : ''}" data-photos-tab="${v}">${label}</h4>`).join('')}</div>
      </div>
      ${photoGrid()}
    </div>`;
}

// Renders the panel, keeping the content scroll position.
export function renderSettings() {
  panel.classList.toggle('open', ui.open);
  toggleBtn.classList.toggle('open', ui.open);
  toggleBtn.innerHTML = icon(ui.open ? 'appSettingsFill' : 'appSettings');
  if (!ui.open && panel.firstChild) return;
  if (panel.querySelector('.edit-photo input:focus, .name-input:focus, .pass-custom input:focus')) return; // don't clobber typing
  const scroll = panel.querySelector('.content')?.scrollTop || 0;
  const nav = [['general', 'General'], ['photos', 'Photos'], ['night', 'Night mode'], ['distractions', 'Distractions']]
    .map(([v, label]) => `<div class="item${ui.tab === v ? ' active' : ''}" data-tab="${v}">${label}</div>`).join('');
  const panels = { general: generalPanel, photos: photosPanel, night: nightPanel, distractions: distractionsPanel };
  panel.innerHTML = `<nav class="nav">${nav}</nav><div class="content">${panels[ui.tab]()}</div>`;
  panel.querySelector('.content').scrollTop = scroll;
}

// Reads the edit form and saves it.
function saveEdit() {
  const val = (f) => panel.querySelector(`.edit-photo [data-field="${f}"]`).value.trim();
  const id = ui.editingId;
  ui.editingId = null;
  document.activeElement?.blur();
  updateCustom(id, { location: val('location'), photographer: val('photographer') });
}

// Handles every click inside the panel via data attributes.
async function onClick(e) {
  const t = e.target;
  const d = (sel) => t.closest(sel);
  if (d('[data-tab]')) return openSettings(d('[data-tab]').dataset.tab);
  if (d('[data-photos-tab]')) return openSettings('photos', d('[data-photos-tab]').dataset.photosTab);
  if (d('[data-preview]')) return playPreview(Number(d('[data-preview]').dataset.preview));
  if (d('[data-setting]')) {
    const { setting } = d('[data-setting]').dataset;
    return setSetting(setting, !state.settings[setting]);
  }
  if (d('[data-feed]')) {
    // Toggles one feed; the last enabled feed stays on.
    const { feed } = d('[data-feed]').dataset;
    const on = state.settings.feeds;
    const feeds = on.includes(feed) ? on.filter((f) => f !== feed) : [...on, feed];
    if (!feeds.length) return;
    await save({ settings: { ...state.settings, feeds } });
    return showNext();
  }
  if (d('[data-frequency]')) {
    // Keep the current photo; its period restarts under the new frequency.
    const { frequency } = d('[data-frequency]').dataset;
    return save({ settings: { ...state.settings, frequency }, current: state.current && { key: state.current.key, ...periodFor(frequency) } });
  }
  if (d('[data-fit]')) return setSetting('fit', d('[data-fit]').dataset.fit);
  if (d('[data-minutes]')) return passSite(d('[data-site]').dataset.site, Number(d('[data-minutes]').dataset.minutes));
  const act = d('[data-act]')?.dataset.act;
  const list = d('[data-list]')?.dataset.list;
  const site = d('[data-site]')?.dataset.site;
  if (act === 'pass-site') {
    ui.passing = ui.passing === site ? null : site;
    renderSettings();
    return panel.querySelector('.pass-custom input')?.focus();
  }
  if (act === 'end-pass') return chrome.runtime.sendMessage({ endPass: site });
  if (act === 'add-site') return addSite(list);
  if (act === 'remove-site') return setSites(list, state[list].filter((s) => s !== d('[data-site]').dataset.site));
  const key = d('[data-key]')?.dataset.key;
  if (act === 'delete') return deleteCustom(key.slice(7));
  if (act === 'unfavorite') return toggleFavorite(key);
  if (act === 'edit') {
    ui.editingId = key.slice(7);
    renderSettings();
    return panel.querySelector('.edit-photo input')?.focus();
  }
  if (act === 'cancel-edit') {
    ui.editingId = null;
    return renderSettings();
  }
  if (act === 'save-edit') return saveEdit();
  if (key) return setCurrent(key);
}

export function initSettings() {
  toggleBtn.addEventListener('click', () => (ui.open ? closeSettings() : openSettings(ui.tab)));
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', async (e) => {
    if (e.target.dataset.hour) return setSetting(e.target.dataset.hour, Number(e.target.value));
    if (e.target.type !== 'file') return;
    const keys = await addFiles([...e.target.files]);
    if (keys.length) {
      ui.photosTab = 'custom';
      await setCurrent(keys[0]);
    }
  });
  // The name saves as you type, so the greeting follows along. renderSettings skips while the field has focus,
  // so nothing re-renders on blur and a click from the field straight onto a toggle still lands.
  panel.addEventListener('input', (e) => {
    if (e.target.matches('.name-input')) setSetting('name', e.target.value.trim());
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('.block-add')) return addSite(e.target.closest('[data-list]').dataset.list);
    if (e.key === 'Enter' && e.target.matches('.name-input')) return e.target.blur();
    // Typed minutes: Enter starts the pass, Escape closes the picker
    if (e.target.closest('.pass-custom') && ['Enter', 'Escape'].includes(e.key)) {
      e.stopPropagation();
      e.target.blur();
      if (e.key === 'Enter') return passSite(e.target.closest('[data-site]').dataset.site, Number.parseInt(e.target.value, 10));
      ui.passing = null;
      return renderSettings();
    }
    if (!e.target.closest('.edit-photo')) return;
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') {
      e.stopPropagation();
      ui.editingId = null;
      e.target.blur();
      renderSettings();
    }
  });
  dismissOnOutside(() => [panel, toggleBtn], () => ui.open, closeSettings);
}
