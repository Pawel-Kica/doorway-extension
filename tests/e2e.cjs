// Headless end-to-end test of the extension. Run: NODE_PATH=$(npm root -g) node tests/e2e.cjs
// Uses Playwright Chromium with a temp profile; never touches the real Chrome.
// Screenshots go to /tmp/doorway-shots/.

const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const SHOTS = '/tmp/doorway-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
}

// Uses extension/ as-is when stock.json exists, else a /tmp copy with a fixture stock.json.
function prepareExtension() {
  if (fs.existsSync(path.join(SRC, 'photos/stock.json'))) return SRC;
  const dir = '/tmp/doorway-ext';
  execSync(`rm -rf ${dir} && cp -R "${SRC}" ${dir}`);
  const ids = fs.readdirSync(path.join(dir, 'photos/stock/thumbs')).map((f) => f.replace('.jpg', ''))
    .filter((id) => fs.existsSync(path.join(dir, `photos/stock/${id}.jpg`))).slice(0, 12);
  const json = ids.map((id) => ({ id, file: `photos/stock/${id}.jpg`, thumb: `photos/stock/thumbs/${id}.jpg`,
    location: `Fixture Place ${id}, Canada`, photographer: `Photographer ${id}`, photographerUrl: 'https://example.com/p',
    sourceUrl: `https://example.com/photo/${id}`, license: 'CC BY-SA 4.0' }));
  fs.writeFileSync(path.join(dir, 'photos/stock.json'), JSON.stringify(json));
  console.log(`fixture stock.json with ${ids.length} photos in ${dir}`);
  return dir;
}

// Fresh temp profile with the extension; `opts` overrides viewport / deviceScaleFactor.
async function launch(ext, opts = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-profile-'));
  return chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', viewport: { width: 1707, height: 890 }, deviceScaleFactor: 1.5,
    // --hide-scrollbars mimics Mac overlay scrollbars
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--hide-scrollbars'],
    ...opts,
  });
}

// Turns on what the Errors button on chrome://extensions shows (Load unpacked has it on, --load-extension does not).
// Returns a function that reads the list: uncaught errors, rejected promises and console.error / warn from every part of the extension.
async function errorList(ctx) {
  const id = 'ejgofcoojgcbiimfkbidbiimnhpnfkol';
  const page = await ctx.newPage();
  await page.goto('chrome://extensions');
  await page.evaluate(async (id) => {
    await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
    await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, errorCollection: true });
  }, id);
  return async () => (await page.evaluate((id) => chrome.developerPrivate.getExtensionInfo(id), id)).runtimeErrors
    .map((e) => `${e.message} (${e.source.split('/').pop()})`);
}

// Local site whose service worker serves its pages from cache, like Gmail does. Resolves to the running server.
function cachedSite() {
  const sw = `self.addEventListener('install', (e) => e.waitUntil(caches.open('c').then((c) => c.add('/mail/u/0/')).then(() => self.skipWaiting())));
    self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
    self.addEventListener('fetch', (e) => e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request))));`;
  const server = http.createServer((req, res) => {
    const js = req.url === '/sw.js';
    res.writeHead(200, { 'content-type': js ? 'text/javascript' : 'text/html' });
    res.end(js ? sw : '<h1>cached site</h1><script>navigator.serviceWorker.register("/sw.js")</script>');
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const HOUR = 3600e3;
const inWindow = (next, now) => next >= now + 6 * HOUR && next <= now + 12 * HOUR;

// Newest background layer: whether it is in Fit mode and how its photo / blur layers render.
const bgLayer = (page) => page.evaluate(() => {
  const layer = [...document.querySelectorAll('.background-item')].pop();
  const photo = getComputedStyle(layer.querySelector('.background-photo'));
  const blur = getComputedStyle(layer.querySelector('.background-blur'));
  const r = layer.querySelector('.background-photo').getBoundingClientRect();
  return { fit: layer.classList.contains('fit'), size: photo.backgroundSize, blur: blur.display !== 'none' && blur.filter.includes('blur'),
    fullScreen: r.width === innerWidth && r.height === innerHeight, ratio: Number(layer.dataset.ratio) };
});

const state = (page) => page.evaluate(() => chrome.storage.local.get(null));
const text = (page, sel) => page.locator(sel).innerText();

// Opens a new tab at a fixed time. The clock is always fixed: night hours (20:00-04:00) change
// what renders, so a tab on the real wall clock would make the suite pass or fail by time of day.
// `sel` waits for something other than a photo layer, which night tabs never get.
async function newTab(ctx, time = '2026-09-15T10:35:00', sel = '.background-item') {
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && check('no console error', false, m.text()));
  page.on('pageerror', (e) => check('no page error', false, e.message));
  await page.clock.setFixedTime(new Date(time));
  await page.goto('chrome://newtab');
  await page.waitForSelector(sel);
  await page.waitForTimeout(400);
  return page;
}

(async () => {
  const ext = prepareExtension();
  const ctx = await launch(ext);
  const errors = await errorList(ctx);
  const photoJpgs = fs.readdirSync(path.join(ext, 'photos/stock')).filter((f) => f.endsWith('.jpg')).slice(0, 2)
    .map((f) => path.join(ext, 'photos/stock', f));

  // 1-2. Background, clock, title
  let page = await newTab(ctx, '2026-09-15T10:35:00');
  check('title is New Tab', (await page.title()) === 'New Tab');
  check('clock 24h', (await text(page, '.clock .time')) === '10:35', await text(page, '.clock .time'));
  check('greeting without name', (await text(page, '.greeting .content')) === 'Good morning.', await text(page, '.greeting .content'));
  const bgColor = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  check('dark loading background', bgColor === 'rgb(33, 33, 33)', bgColor);
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  check('manifest icons exist', Object.values(manifest.icons).every((f) => fs.existsSync(path.join(ext, f))));
  const fresh = await page.evaluate(async () => (await import('/js/store.js')).state);
  check('fresh install: frequency random, fit auto', fresh.settings.frequency === 'random' && fresh.settings.fit === 'auto', JSON.stringify(fresh.settings));
  check('fresh install: nextChangeAt 6-12h ahead', inWindow(fresh.current.nextChangeAt, new Date('2026-09-15T10:35:00').getTime()), fresh.current.nextChangeAt);
  // Text scaling: 152/54px, then 144/40px under 820px height
  const sizes = () => page.evaluate(() => [
    getComputedStyle(document.querySelector('.clock .time')).fontSize, getComputedStyle(document.querySelector('.greeting-line')).fontSize].join(' '));
  check('clock/greeting size at 890px', (await sizes()) === '152px 54px', await sizes());
  await page.setViewportSize({ width: 1280, height: 720 });
  check('clock/greeting size at 720px', (await sizes()) === '144px 40px', await sizes());
  await page.setViewportSize({ width: 1707, height: 890 });
  await page.screenshot({ path: `${SHOTS}/01-home-noname.png` });

  // 3. Name in Settings > General, then inline name editing
  check('greeting has no menu', !(await page.locator('#greeting button').count()));
  await page.click('#settings-toggle');
  await page.waitForTimeout(300);
  // Typing, then clicking straight on a toggle: both stick
  await page.fill('.name-input', 'Sam');
  await page.click('[data-setting="includeName"]');
  const named = (await state(page)).settings;
  check('name saved while typing, include name off', named.name === 'Sam' && !named.includeName, JSON.stringify(named));
  check('include name off', (await text(page, '.greeting .content')) === 'Good morning.');
  check('Your name hidden while Include name is off', !(await page.locator('.name-input').count()));
  await page.click('[data-setting="greetingVisible"]');
  check('Include name hidden while Greeting is off', !(await page.locator('[data-setting="includeName"]').count()));
  await page.click('[data-setting="greetingVisible"]');
  await page.click('[data-setting="includeName"]');
  await page.fill('.name-input', 'Alex');
  await page.press('.name-input', 'Enter');
  check('name saved', (await text(page, '.greeting .content')) === 'Good morning Alex.', await text(page, '.greeting .content'));
  check('name persisted', (await state(page)).settings.name === 'Alex');
  await page.screenshot({ path: `${SHOTS}/02-general-name.png` });
  await page.keyboard.press('Escape');
  await page.dblclick('.greeting .name');
  await page.keyboard.type('Nope');
  await page.keyboard.press('Escape');
  check('Esc reverts name', (await text(page, '.greeting .content')) === 'Good morning Alex.');
  await page.dblclick('.greeting .name');
  await page.keyboard.type('   ');
  await page.keyboard.press('Enter');
  check('blank name keeps old', (await text(page, '.greeting .content')) === 'Good morning Alex.');
  await page.dblclick('.greeting .name');
  await page.keyboard.type('x'.repeat(80));
  const inputW = await page.locator('input.name').evaluate((el) => el.offsetWidth / parseFloat(getComputedStyle(el).fontSize));
  check('long name input capped at 12em', inputW <= 12.1, inputW);
  await page.keyboard.press('Escape');

  // 4. Photo popup
  const before = (await state(page)).current.key;
  await page.click('#location');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/03-photo-popup.png` });
  const loc = await text(page, '#location');
  check('popup shows location', (await text(page, '.photo-meta-title')) === loc);
  const href = await page.locator('.source-text').getAttribute('href');
  check('photographer links out in new tab', !!href && (await page.locator('.source-text').getAttribute('target')) === '_blank', href);
  await page.click('[data-act="fav"]');
  check('favorite saved', (await state(page)).favorites.includes(before));
  check('favorited reads Unfavorite', (await text(page, '[data-act="fav"]')) === 'Unfavorite');
  // Another open tab must pick up the change, so its own saves don't drop it
  const other = await newTab(ctx);
  await other.click('#location');
  await other.click('[data-act="skip"]');
  await other.click('[data-act="fav"]');
  await page.waitForTimeout(300);
  check('favorites synced across tabs', (await state(page)).favorites.length === 2 && (await text(page, '#location')) === (await text(other, '#location')));
  await other.close();
  await page.click('[data-act="skip"]');
  await page.waitForTimeout(100);
  const afterSkip = (await state(page)).current.key;
  check('skip changes photo', afterSkip !== before, afterSkip);
  check('no PLUS badge', !(await page.locator('.photo-popup').innerText()).includes('PLUS'));
  await page.keyboard.press('Escape');
  check('Esc closes popup', !(await page.locator('.photo-popup').evaluate((el) => el.classList.contains('open'))));

  // Admire mode
  await page.hover('#location');
  await page.waitForTimeout(3300);
  check('admire mode after 3s hover', await page.evaluate(() => document.body.classList.contains('admire')));
  await page.mouse.move(800, 400);
  check('admire mode ends on leave', !(await page.evaluate(() => document.body.classList.contains('admire'))));

  // 5. Settings: Manage photos and Settings both open the Photos tab
  await page.click('#location');
  await page.click('[data-act="settings"]');
  await page.waitForTimeout(300); // innerText is empty while the panel fades in from visibility:hidden
  check('popup Settings opens Photos', (await text(page, '.nav .item.active')) === 'Photos');
  await page.click('[data-tab="general"]');
  await page.keyboard.press('Escape');
  await page.click('#location');
  await page.click('[data-act="manage"]');
  await page.waitForTimeout(300);
  check('settings opens on Photos', (await text(page, '.nav .item.active')) === 'Photos');
  await page.screenshot({ path: `${SHOTS}/04-photos-empty.png` });

  // 6. Upload custom photos (a non-image file is ignored)
  const txtFile = path.join(os.tmpdir(), 'mc-notes.txt');
  fs.writeFileSync(txtFile, 'not an image');
  await page.setInputFiles('.list-add-button input', [...photoJpgs, txtFile]);
  await page.waitForFunction(() => document.querySelectorAll('.tile-list-item').length === 2, null, { timeout: 15000 });
  let s = await state(page);
  check('uploaded photo becomes current', s.current.key.startsWith('custom:'), s.current.key);
  check('default location is file name', (await text(page, '#location')) === path.basename(photoJpgs[0], '.jpg'), await text(page, '#location'));
  const rec = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('doorway'); q.onsuccess = () => r(q.result); });
    const all = await new Promise((r) => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => r(q.result); });
    const b = await createImageBitmap(all[0].blob);
    const t = await createImageBitmap(all[0].thumb);
    return { n: all.length, full: Math.max(b.width, b.height), thumb: Math.max(t.width, t.height), type: all[0].blob.type };
  });
  check('blobs downscaled to <=2560 / 480 jpeg', rec.n === 2 && rec.full <= 2560 && rec.thumb <= 480 && rec.type === 'image/jpeg', JSON.stringify(rec));
  check('current tile outlined', (await page.locator('.tile-list-item.active').count()) === 1);

  // Empty location hides the bottom-left text
  const currentTile = page.locator(`.tile-list-item[data-key="${s.current.key}"]`);
  await currentTile.hover();
  await currentTile.locator('[data-act="edit"]').click();
  await page.fill('.edit-photo [data-field="location"]', '');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check('empty location hidden', await page.locator('#location').isHidden(), await text(page, '#location'));

  // Edit location
  await currentTile.hover();
  await currentTile.locator('[data-act="edit"]').click();
  await page.fill('.edit-photo [data-field="location"]', 'Kraków, Poland');
  await page.fill('.edit-photo [data-field="photographer"]', 'Alex');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check('edited location shown bottom-left', (await text(page, '#location')) === 'Kraków, Poland', await text(page, '#location'));
  await page.locator('.tile-list-item').nth(1).hover();
  const addRight = await page.locator('.list-add-button').evaluate((el) => el.getBoundingClientRect().right <= el.closest('.content').getBoundingClientRect().right);
  check('Add Photo fits inside the panel', addRight);
  await page.screenshot({ path: `${SHOTS}/05-my-photos.png` });

  // Favorite a custom photo, then delete it: references must go
  await page.click(`.tile-list-item[data-key="${s.current.key}"]`);
  await page.mouse.click(1500, 300); // close settings
  await page.click('#location');
  await page.click('[data-act="fav"]');
  await page.keyboard.press('Escape');
  const delKey = (await state(page)).current.key;
  await page.click('#settings-toggle');
  await page.click('[data-tab="photos"]');
  const tileDel = page.locator(`.tile-list-item[data-key="${delKey}"]`);
  await tileDel.hover();
  await tileDel.locator('[data-act="delete"]').click();
  await page.waitForTimeout(200);
  s = await state(page);
  check('delete removes from favorites/history/current', !s.favorites.includes(delKey) && !s.history.includes(delKey) && s.current.key !== delKey);
  check('one custom tile left', (await page.locator('.tile-list-item').count()) === 1);

  // Nature, Favorites + History tabs
  await page.click('[data-photos-tab="stock"]');
  check('nature tab lists all 100 stock photos', (await page.locator('.tile-list-item').count()) === 100);
  await page.screenshot({ path: `${SHOTS}/06-nature.png` });
  await page.click('[data-photos-tab="favorites"]');
  check('favorites tab lists stock favorites', (await page.locator('.tile-list-item').count()) === s.favorites.length && s.favorites.length === 2);
  await page.click('[data-photos-tab="history"]');
  check('history newest first', (await page.locator('.tile-list-item').first().getAttribute('data-key')) === s.history[0]);
  await page.screenshot({ path: `${SHOTS}/06-history.png` });

  // Photos > Settings: choose My photos, frequency every tab
  await page.click('[data-photos-tab="settings"]');
  check('settings sub-tab hides Add Photo', (await page.locator('.list-add-button').count()) === 0);
  const squeezed = await page.locator('.option-description').evaluateAll((els) => els.filter((el) => el.offsetWidth < 200).map((el) => el.textContent));
  check('settings descriptions not squeezed', squeezed.length === 0, JSON.stringify(squeezed));
  await page.screenshot({ path: `${SHOTS}/07-photo-settings.png` });
  await page.click('[data-feed="custom"]');
  await page.click('[data-feed="favorites"]');
  check('three feeds on at once', (await page.locator('[data-feed] .toggle-switch.on').count()) === 3 && (await state(page)).settings.feeds.length === 3, JSON.stringify((await state(page)).settings.feeds));
  await page.click('[data-feed="favorites"]');
  await page.click('[data-feed="stock"]');
  s = await state(page);
  check('feed custom shows custom photo', s.settings.feeds.join() === 'custom' && s.current.key.startsWith('custom:'), s.current.key);
  await page.click('[data-feed="custom"]');
  check('last feed stays on', (await state(page)).settings.feeds.join() === 'custom');
  await page.click('[data-frequency="tab"]');
  check('frequency saved', (await state(page)).settings.frequency === 'tab');

  // General settings
  await page.click('[data-tab="general"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/08-general.png` });
  await page.click('[data-setting="clockVisible"]');
  check('clock hidden', await page.locator('#clock').isHidden());
  await page.click('[data-setting="clockVisible"]');
  await page.click('[data-setting="hour12"]');
  check('12h clock saved', (await state(page)).settings.hour12 === true);
  await page.keyboard.press('Escape');
  check('Esc closes settings', !(await page.locator('#settings').evaluate((el) => el.classList.contains('open'))));
  await page.close();

  // Rotation: 12h afternoon, stock feed without repeats, day persistence and 4:00 rollover
  page = await newTab(ctx, '2026-09-15T14:05:00');
  check('afternoon + 12h', (await text(page, '.clock .time')) === '2:05' && (await text(page, '.greeting .content')) === 'Good afternoon Alex.');
  check('12h shows P.M.', (await text(page, '.clock .ampm')) === 'P.M.');
  await page.screenshot({ path: `${SHOTS}/08b-clock-12h.png` });
  const rot = await page.evaluate(async () => {
    const photos = await import('/js/photos.js');
    const { state, save } = await import('/js/store.js');
    await save({ queues: {}, settings: { ...state.settings, feeds: ['stock'], frequency: 'day' } });
    const n = photos.stockKeys().length;
    const seen = [];
    for (let i = 0; i < n; i++) { await photos.showNext(); seen.push(state.current.key); }
    await photos.showNext();
    return { n, unique: new Set(seen).size, wrapNoRepeat: state.current.key !== seen[n - 1] };
  });
  check('stock feed cycles without repeats', rot.unique === rot.n && rot.wrapNoRepeat, JSON.stringify(rot));
  check('history capped at 50', (await state(page)).history.length === 50);
  const dayKey = (await state(page)).current.key;
  await page.close();
  page = await newTab(ctx, '2026-09-16T03:30:00', '.clock .time'); // night: no photo layer to wait for
  check('same photo before 4:00 rollover', (await state(page)).current.key === dayKey);
  check('sleep greeting at 3:30', (await text(page, '.greeting .content')) === 'Go to sleep Alex.', await text(page, '.greeting .content'));
  await page.close();
  page = await newTab(ctx, '2026-09-16T04:10:00');
  check('new photo after 4:00', (await state(page)).current.key !== dayKey);

  // Favorites feed falls back to stock when empty; custom feed falls back when no custom photos
  await page.evaluate(async () => {
    const { state, save } = await import('/js/store.js');
    await save({ favorites: [], settings: { ...state.settings, feeds: ['favorites'] } });
    await (await import('/js/photos.js')).showNext();
  });
  check('empty favorites falls back to stock', (await state(page)).current.key.startsWith('stock:'));

  // Settings saved before feeds could be combined hold a single `feed`
  const migrated = await page.evaluate(async () => {
    const { state, save, loadState } = await import('/js/store.js');
    const { feeds, ...old } = state.settings;
    await chrome.storage.local.set({ settings: { ...old, feed: 'custom' } });
    await loadState();
    const got = { feeds: state.settings.feeds, feed: state.settings.feed };
    await save({ settings: { ...state.settings, feeds } });
    return got;
  });
  check('old single feed becomes feeds', migrated.feeds.join() === 'custom' && migrated.feed === undefined, JSON.stringify(migrated));

  // Drag and drop upload
  await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'Dropped Place.jpg', { type: 'image/jpeg' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, 'photos/stock/' + path.basename(photoJpgs[1]));
  await page.waitForFunction(() => document.getElementById('location').textContent === 'Dropped Place', null, { timeout: 15000 });
  await page.waitForSelector('#settings.open');
  check('drop adds photo and opens Photos', (await text(page, '.nav .item.active')) === 'Photos');
  await page.close();

  // Night mode: photo off 20:00-04:00, "Go to sleep" from 22:00, flips live in a tab left open
  const night = (p) => p.evaluate(() => ({
    dark: document.documentElement.classList.contains('night'),
    bg: getComputedStyle(document.documentElement).backgroundColor,
    photos: getComputedStyle(document.getElementById('backgrounds')).opacity,
    layers: document.querySelectorAll('.background-item').length,
    hidden: document.getElementById('location').hidden,
    locText: document.getElementById('location').textContent,
    greeting: document.querySelector('.greeting .content').textContent,
  }));
  page = await newTab(ctx, '2026-09-17T19:30:00');
  let n = await night(page);
  check('19:30 photo on, good evening', !n.dark && n.photos === '1' && n.layers > 0 && n.hidden === !n.locText && n.greeting === 'Good evening Alex.', JSON.stringify(n));
  await page.close();
  page = await newTab(ctx, '2026-09-17T20:30:00', '.clock .time');
  n = await night(page);
  check('20:30 black screen, no photo title', n.dark && n.layers === 0 && n.bg === 'rgb(0, 0, 0)' && n.hidden, JSON.stringify(n));
  check('20:30 still good evening', n.greeting === 'Good evening Alex.', n.greeting);
  await page.screenshot({ path: `${SHOTS}/13-night-2030.png` });
  await page.close();
  page = await newTab(ctx, '2026-09-17T22:30:00', '.clock .time');
  n = await night(page);
  check('22:30 go to sleep on black', n.dark && n.layers === 0 && n.greeting === 'Go to sleep Alex.', JSON.stringify(n));
  await page.screenshot({ path: `${SHOTS}/13-night-2230.png` });
  await page.close();
  page = await newTab(ctx, '2026-09-18T04:10:00');
  n = await night(page);
  check('04:10 photo back, good morning', !n.dark && n.photos === '1' && n.greeting === 'Good morning Alex.', JSON.stringify(n));
  await page.close();

  // Same tab left open across both boundaries
  page = await newTab(ctx, '2026-09-18T19:59:30');
  check('19:59 photo on', (await night(page)).photos === '1');
  await page.clock.setFixedTime(new Date('2026-09-18T20:00:30'));
  await page.waitForTimeout(1300);
  n = await night(page);
  check('open tab goes dark at 20:00', n.dark && n.hidden, JSON.stringify(n));
  await page.waitForTimeout(2200);
  await page.waitForTimeout(1000);
  check('open tab photo gone', (await night(page)).layers === 0, JSON.stringify(await night(page)));
  await page.clock.setFixedTime(new Date('2026-09-18T22:00:30'));
  await page.waitForTimeout(1300);
  check('open tab greets go to sleep at 22:00', (await night(page)).greeting === 'Go to sleep Alex.', (await night(page)).greeting);
  await page.close();

  // Night mode settings: toggles and hours are live, defaults restored at the end
  page = await newTab(ctx, '2026-09-18T22:30:00', '.clock .time');
  await page.click('#settings-toggle');
  await page.click('[data-tab="night"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/14-night-settings.png` });
  const previews = (p) => p.$$eval('.night-preview', (els) => els.map((e) => ({
    text: [...e.querySelectorAll('.night-preview-time, .night-preview-greeting')].map((t) => t.innerText).join(' '),
    photo: e.style.backgroundImage !== '', off: e.classList.contains('off') })));
  let pv = await previews(page);
  check('night previews on black', JSON.stringify(pv) === JSON.stringify([
    { text: '8:00 Good evening Alex.', photo: false, off: false }, { text: '10:00 Go to sleep Alex.', photo: false, off: false }]), JSON.stringify(pv));
  await page.click('[data-setting="nightMode"]');
  await page.waitForSelector('.background-item');
  await page.waitForTimeout(300);
  pv = await previews(page);
  check('night mode off: preview dimmed, sleep preview on photo', pv[0].off && pv[1].photo && !pv[1].off, JSON.stringify(pv));
  await page.screenshot({ path: `${SHOTS}/14-night-settings-off.png` });
  check('night mode off: photo back at 22:30', !(await night(page)).dark && (await night(page)).layers > 0, JSON.stringify(await night(page)));
  await page.click('[data-setting="sleepGreeting"]');
  check('sleep greeting off: good evening', (await night(page)).greeting === 'Good evening Alex.', (await night(page)).greeting);
  await page.click('[data-setting="nightMode"]');
  await page.selectOption('[data-hour="nightFrom"]', '23');
  await page.waitForTimeout(300);
  check('photo off from 23: still on at 22:30', !(await night(page)).dark, JSON.stringify(await night(page)));
  await page.selectOption('[data-hour="nightFrom"]', '20');
  await page.click('[data-setting="sleepGreeting"]');
  await page.waitForTimeout(2300);
  check('defaults back: dark, go to sleep', (await night(page)).dark && (await night(page)).greeting === 'Go to sleep Alex.', JSON.stringify(await night(page)));
  check('night settings saved', JSON.stringify([(await state(page)).settings.nightMode, (await state(page)).settings.nightFrom]) === '[true,20]');

  // Clicking a preview plays it on the page: settings close, a minute to the hour, the hour, then back to now
  const settingsOpen = (p) => p.locator('#settings').evaluate((e) => e.classList.contains('open'));
  await page.click('.night-preview >> nth=0');
  await page.waitForTimeout(300);
  n = await night(page);
  check('preview at 7:59: settings closed, photo on', !(await settingsOpen(page)) && (await text(page, '.clock .time')) === '7:59' && !n.dark,
    JSON.stringify({ ...n, time: await text(page, '.clock .time') }));
  await page.screenshot({ path: `${SHOTS}/14-night-preview-1959.png` });
  await page.waitForTimeout(1500);
  n = await night(page);
  check('preview at 8:00: black, good evening', (await text(page, '.clock .time')) === '8:00' && n.dark && n.greeting === 'Good evening Alex.',
    JSON.stringify({ ...n, time: await text(page, '.clock .time') }));
  await page.waitForTimeout(4000);
  n = await night(page);
  check('preview over: settings back at 10:30', (await settingsOpen(page)) && (await text(page, '.clock .time')) === '10:30' && n.dark && n.greeting === 'Go to sleep Alex.',
    JSON.stringify({ ...n, time: await text(page, '.clock .time') }));
  await page.click('.night-preview >> nth=1');
  await page.waitForTimeout(300);
  check('sleep preview at 9:59', (await text(page, '.clock .time')) === '9:59', await text(page, '.clock .time'));
  await page.mouse.click(1500, 150);
  await page.waitForTimeout(300);
  check('click ends preview early, settings stay open', (await settingsOpen(page)) && (await text(page, '.clock .time')) === '10:30', await text(page, '.clock .time'));
  await page.keyboard.press('Escape');
  await page.close();

  // Distractions tab: a typed URL blocks its domain (subdomains too), x unblocks it
  page = await newTab(ctx);
  // Domains of the block rules, or of the Think twice rules with `ask`
  const rules = (p, ask = false) => p.evaluate(async (ask) => (await chrome.declarativeNetRequest.getDynamicRules())
    .filter((r) => Boolean(r.action.redirect?.regexSubstitution.includes('ask.html')) === ask).flatMap((r) => r.condition.requestDomains), ask);
  const blockList = '[data-list="blocked"]';
  const askList = '[data-list="ask"]';
  // Loads the URL in its own tab and returns where it ended up; a blocked load lands on blocked.html#<url>
  // before any request leaves the browser. `shot` saves a screenshot of the result.
  const landsOn = async (url, shot) => {
    const site = await ctx.newPage();
    await site.goto(url, { timeout: 15000 }).catch(() => {});
    if (shot) await site.screenshot({ path: `${SHOTS}/${shot}` });
    const end = site.url();
    await site.close();
    return end;
  };
  const blockedPage = await page.evaluate(() => chrome.runtime.getURL('blocked.html'));
  await page.click('#settings-toggle');
  await page.click('[data-tab="distractions"]');
  // Each list shows a mini copy of the page its sites open, with example.com as the site. Think twice also shows the todo pill.
  const sitePreviews = () => page.$$eval('.site-preview', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('distractions previews', JSON.stringify(await sitePreviews()) === '["You blocked example.com for a reason, so back to what matters.","Do you really need example.com? Yes Save No","Todos (2) Reply to Anna Check the voucher","example.com is super locked until 10 AM. OK"]', JSON.stringify(await sitePreviews()));
  await page.fill(`${blockList} input`, 'not a site');
  await page.keyboard.press('Enter');
  check('junk input blocks nothing', (await page.locator('.blocked-site').count()) === 0);
  await page.fill(`${blockList} input`, 'https://www.bbc.com/#top');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.blocked-site');
  await page.keyboard.type('youtube.com');
  await page.click(`${blockList} [data-act="add-site"]`);
  await page.waitForTimeout(300);
  check('blocked sites listed', JSON.stringify(await page.$$eval('.blocked-site span', (els) => els.map((e) => e.textContent))) === '["bbc.com","youtube.com"]');
  check('blocked sites saved as a rule', JSON.stringify([(await state(page)).blocked, await rules(page)]) === '[["bbc.com","youtube.com"],["bbc.com","youtube.com"]]', JSON.stringify(await rules(page)));
  await page.screenshot({ path: `${SHOTS}/15-distractions-blocked.png` });
  const bbc = await landsOn('https://www.bbc.com/', '16-blocked-page.png');
  check('bbc.com lands on the blocked page', bbc === `${blockedPage}#https://www.bbc.com/`, bbc);
  check('subdomain is blocked', (await landsOn('https://m.youtube.com/watch')) === `${blockedPage}#https://m.youtube.com/watch`);
  // A link on another site is a different kind of navigation, it only reaches blocked.html because the page is web accessible
  const linking = await ctx.newPage();
  await linking.route('http://links.test/', (r) => r.fulfill({ contentType: 'text/html', body: '<a href="https://www.bbc.com/">bbc</a>' }));
  await linking.goto('http://links.test/');
  await linking.click('a');
  await linking.waitForURL(`${blockedPage}#https://www.bbc.com/`, { timeout: 5000 }).catch(() => {});
  check('link to a blocked site lands on the blocked page', linking.url() === `${blockedPage}#https://www.bbc.com/`, linking.url());
  check('blocked page names the site', (await text(linking, 'p')) === 'You blocked bbc.com for a reason, so back to what matters.', await text(linking, 'p'));
  await linking.close();
  // A saved list with no rule behind it (the extension ran without the permission) heals on the next new tab
  await page.evaluate(() => chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] }));
  const healed = await newTab(ctx);
  check('new tab rebuilds the rule from the saved list', (await rules(healed)).length === 2, JSON.stringify(await rules(healed)));
  await healed.close();
  await page.click('[data-site="bbc.com"] [data-act="remove-site"]');
  await page.click('[data-site="youtube.com"] [data-act="remove-site"]');
  await page.waitForTimeout(300);
  check('unblock removes the rule', (await page.locator('.blocked-site').count()) === 0 && (await rules(page)).length === 0, JSON.stringify(await rules(page)));
  check('unblocked site is not blocked', !(await landsOn('https://www.bbc.com/')).startsWith(blockedPage));

  // Think twice: a listed site asks first. Yes opens it right away for that tab,
  // the list under the question takes notes, Save keeps the link for next time, No goes to the new tab page.
  // ask.test is a made-up site served by the route below, so nothing here needs the network.
  await ctx.route(/^http:\/\/(m\.)?ask\.test\//, (r) => r.fulfill(r.request().url().endsWith('.xml')
    ? { contentType: 'application/xml', body: '<?xml version="1.0"?><rss><channel><title>feed</title></channel></rss>' }
    // Reddit hides undefined custom elements like this, the todo list must still show
    : { contentType: 'text/html', body: '<style>:not(:defined) { visibility: hidden }</style><h1>the site</h1>' }));
  const askPage = await page.evaluate(() => chrome.runtime.getURL('ask.html'));
  await page.fill(`${askList} input`, 'http://www.ask.test/');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${askList} .blocked-site`);
  check('think twice site saved as a rule', JSON.stringify([(await state(page)).ask, await rules(page, true)]) === '[["ask.test"],["ask.test"]]', JSON.stringify(await rules(page, true)));
  await page.screenshot({ path: `${SHOTS}/17-distractions-think-twice.png` });
  const post = 'http://ask.test/r/singularity/comments/1w6f9xo/gpt_6_astra_benchmarks/';
  const saving = await ctx.newPage();
  await saving.goto(post).catch(() => {});
  // Keys answer the question, s is Save
  await saving.keyboard.press('s');
  await saving.waitForSelector('#clock', { timeout: 5000 }).catch(() => {});
  const saved = JSON.stringify((await state(page)).todos);
  check('save keeps the URL for later', saved === JSON.stringify({ 'ask.test': [{ later: true, text: 'Gpt 6 astra benchmarks', url: post }] }), saved);
  await saving.close();
  const asking = await ctx.newPage();
  await asking.goto('http://m.ask.test/watch?v=1&t=2').catch(() => {});
  check('listed site lands on the ask page with its URL', asking.url() === `${askPage}#http://m.ask.test/watch?v=1&t=2`, asking.url());
  check('ask page names the site', (await text(asking, '#question')) === 'Do you really need m.ask.test?', await text(asking, '#question'));
  await asking.screenshot({ path: `${SHOTS}/18-ask-page.png` });
  await asking.keyboard.press('y');
  await asking.waitForURL('http://m.ask.test/watch?v=1&t=2', { timeout: 5000 }).catch(() => {});
  check('y is Yes, it opens the site', asking.url() === 'http://m.ask.test/watch?v=1&t=2' && (await text(asking, 'h1')) === 'the site', asking.url());
  // js/todo.js: the pill counts what is still open, the list under it is always open, the saved link on it
  const todo = (sel) => asking.locator(`#doorway-todos ${sel}`);
  await todo('.pill').waitFor({ timeout: 5000 }).catch(() => {});
  const pill = await todo('.pill').innerText().catch(() => '');
  check('the site shows its list with the saved link', pill.replace(/\s+/g, ' ').trim() === 'Todos (1)', pill);
  check('the list is open', await todo('.card').isVisible());
  check('the list shows on a site that hides undefined elements', (await todo('.dw').evaluate((e) => getComputedStyle(e).visibility)) === 'visible');
  check('the saved link is on the list', (await todo('a').getAttribute('href')) === post);
  check('the input hides behind +', !(await todo('input').isVisible()) && (await todo('h3').innerText()) === 'You came to m.ask.test to:');
  await todo('.add').click();
  await todo('input').fill('Answer Ben');
  await todo('input').press('Enter');
  await asking.waitForTimeout(300);
  await todo('.pill').click();
  check('a click on the pill folds the list', !(await todo('.card').isVisible()));
  await todo('.pill').click();
  check('+ adds an item', (await todo('.count').innerText()) === '(2)' && !(await todo('input').isVisible()), await todo('.count').innerText());
  await asking.screenshot({ path: `${SHOTS}/19-todo-on-site.png` });
  await todo('.box').nth(0).click();
  await todo('.box').nth(1).click();
  check('all done shows I\'m done!', (await todo('.finish').isVisible()) && (await todo('.finish').innerText()) === "I'm done!");
  // An RSS feed on the site is an XML page, the list's HTML can't go in there
  await asking.goto('http://ask.test/feed.xml').catch(() => {});
  await asking.waitForTimeout(500);
  check('no list on an XML page', (await asking.locator('#doorway-todos').count()) === 0);
  await asking.goto('http://ask.test/other').catch(() => {});
  check('same tab is not asked again', asking.url() === 'http://ask.test/other', asking.url());
  await todo('.pill').waitFor({ timeout: 5000 }).catch(() => {});
  check('another page keeps the list open', !(await todo('.card').getAttribute('class')).includes('closed') && (await todo('.count').innerText()) === '(0)');
  await todo('.finish').click();
  await asking.waitForSelector('#clock', { timeout: 5000 }).catch(() => {});
  check("I'm done! goes to the new tab page and clears the done items", (await asking.locator('#clock').count()) === 1 && JSON.stringify((await state(page)).todos) === '{"ask.test":[]}', JSON.stringify((await state(page)).todos));
  await asking.goto('http://ask.test/other').catch(() => {});
  check('after I\'m done! the tab asks again', asking.url() === `${askPage}#http://ask.test/other`, asking.url());
  if (!asking.isClosed()) await asking.close();
  const refusing = await ctx.newPage();
  await refusing.goto('http://ask.test/').catch(() => {});
  check('a new tab asks again', refusing.url() === `${askPage}#http://ask.test/`, refusing.url());
  await refusing.keyboard.press('Enter');
  await refusing.waitForSelector('#clock', { timeout: 5000 }).catch(() => {});
  check('Enter is No, it goes to the new tab page', (await refusing.locator('#clock').count()) === 1, refusing.url());
  // The list sits under the question, empty it says so. + opens a row in place, keys typed there stay text,
  // Enter keeps the note right where it was typed and the list keeps its size.
  await refusing.goto('http://ask.test/').catch(() => {});
  await refusing.waitForSelector('.empty');
  const oneLine = async (p, sel) => (await text(p, sel)).replace(/\s+/g, ' ').trim();
  check('an empty list says so', (await oneLine(refusing, '.items')) === 'Nothing, just checking out of habit 🙃', await oneLine(refusing, '.items'));
  const listBox = async () => JSON.stringify(await refusing.locator('.notes').boundingBox());
  const emptyBox = await listBox();
  await refusing.click('.add');
  const draftBox = await refusing.locator('.draft').boundingBox();
  check('+ opens a focused row, the list keeps its size', (await refusing.locator('.draft input').evaluate((e) => e === document.activeElement)) && (await listBox()) === emptyBox, await listBox());
  await refusing.keyboard.type('Watch the talk, yes now');
  check('keys typed in the row stay text', refusing.url() === `${askPage}#http://ask.test/` && (await refusing.inputValue('.draft input')) === 'Watch the talk, yes now');
  await refusing.keyboard.press('Enter');
  await refusing.waitForSelector('.note:not(.draft)');
  const noteBox = await refusing.locator('.note').first().boundingBox();
  check('Enter keeps the note where it was typed', noteBox.y === draftBox.y && noteBox.height === draftBox.height && (await listBox()) === emptyBox, JSON.stringify([draftBox, noteBox]));
  const noted = JSON.stringify((await state(page)).todos);
  check('the note is on the site\'s list', noted === JSON.stringify({ 'ask.test': [{ later: true, text: 'Watch the talk, yes now' }] }), noted);
  await refusing.screenshot({ path: `${SHOTS}/18-ask-list.png` });
  await refusing.click('.note');
  await refusing.waitForSelector('.note.done');
  check('a click checks a note off', JSON.stringify((await state(page)).todos['ask.test']) === '[{"done":true,"later":true,"text":"Watch the talk, yes now"}]', JSON.stringify((await state(page)).todos));
  await refusing.click('.note');
  await refusing.keyboard.press('Enter');
  await refusing.waitForSelector('#clock', { timeout: 5000 }).catch(() => {});
  check('after the note Enter is No again', (await refusing.locator('#clock').count()) === 1, refusing.url());
  // Like blocked.html, a clicked link only reaches ask.html because the page is web accessible
  await refusing.route('http://links.test/', (r) => r.fulfill({ contentType: 'text/html', body: '<a href="http://ask.test/from-link">ask</a>' }));
  await refusing.goto('http://links.test/');
  await refusing.click('a');
  await refusing.waitForURL(`${askPage}#http://ask.test/from-link`, { timeout: 5000 }).catch(() => {});
  check('link to a listed site lands on the ask page', refusing.url() === `${askPage}#http://ask.test/from-link`, refusing.url());
  await refusing.close();
  // Any site can link to ask.html with its own hash, only web addresses get a question
  const bad = await ctx.newPage();
  await bad.goto(`${askPage}#javascript:alert(1)`).catch(() => {});
  await bad.waitForSelector('#clock', { timeout: 5000 }).catch(() => {});
  check('ask page without a web address goes to the new tab page', (await bad.locator('#clock').count()) === 1, bad.url());
  await bad.close();

  // Pass (Pass on the Think twice row): every tab opens the site without asking until the pass ends,
  // then tabs on the site keep it and the next tab asks again. The pill on the site counts down "End 14:59".
  const passRow = `${askList} .blocked-site`;
  const passes = async () => (await state(page)).passes;
  const tabless = () => page.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => !r.condition.tabIds).length);
  // The pass ends on real time (alarm, pill), the settings tab's clock is frozen in the past
  await page.clock.setFixedTime(new Date());
  await page.click(`${passRow} [data-act="pass-site"]`);
  check('pass opens the length picker', (await page.locator(`${passRow} .pass-picker`).isVisible()) && (await text(page, `${passRow} .pass-picker`)).replace(/\s+/g, ' ').trim() === '15 min 30 min 1 hour');
  await page.click(`${passRow} [data-minutes="15"]`);
  await page.waitForTimeout(300);
  check('15 min starts a pass', Math.abs((await passes())['ask.test'] - Date.now() - 15 * 60000) < 5000 && (await tabless()) === 1, JSON.stringify(await passes()));
  check('the row names the end of the pass', /^ask\.test is free until \d/.test(await text(page, `${passRow} > span`)) && (await text(page, `${passRow} .pass-button`)) === 'End', await text(page, `${passRow} > span`));
  await page.screenshot({ path: `${SHOTS}/18-pass-settings.png` });
  const passing = await ctx.newPage();
  await passing.goto('http://ask.test/pass').catch(() => {});
  check('a pass opens the site without asking', passing.url() === 'http://ask.test/pass', passing.url());
  check('every tab opens during the pass', (await landsOn('http://m.ask.test/other')) === 'http://m.ask.test/other');
  const passPill = passing.locator('#doorway-todos .pill');
  const pillText = async () => (await passPill.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await passPill.waitFor({ timeout: 5000 }).catch(() => {});
  check('the pill counts the pass down', /^End (14:5\d|15:00)$/.test(await pillText()), await pillText());
  await passing.screenshot({ path: `${SHOTS}/19-pass-pill.png` });
  // The alarm, moved up to now (unpacked extensions have no 30s alarm minimum)
  await page.evaluate(() => chrome.alarms.create('pass:ask.test', { when: Date.now() + 200 }));
  await passing.waitForTimeout(1500);
  check('the pass ends on its alarm', JSON.stringify(await passes()) === '{}' && (await tabless()) === 0 && (await pillText()) === 'Todos (1)', await pillText());
  await passing.goto('http://ask.test/still').catch(() => {});
  check('a tab open when the pass ends keeps the site', passing.url() === 'http://ask.test/still', passing.url());
  check('the next tab asks again', (await landsOn('http://ask.test/')) === `${askPage}#http://ask.test/`);
  check('the row drops the pass', (await text(page, `${passRow} .pass-button`)) === 'Pass' && (await text(page, `${passRow} > span`)) === 'ask.test');
  await page.click(`${passRow} [data-act="pass-site"]`);
  await page.click(`${passRow} [data-minutes="15"]`);
  await passing.waitForFunction(() => document.querySelector('#doorway-todos').shadowRoot.querySelector('.label').textContent === 'End', null, { timeout: 5000 }).catch(() => {});
  await passPill.click();
  await passing.waitForTimeout(500);
  check('a click on the pill ends the pass', JSON.stringify(await passes()) === '{}' && (await tabless()) === 0 && (await pillText()) === 'Todos (1)', await pillText());
  await passing.close();
  // A Chrome restart drops the alarm and skips onStartup, so the worker checks passes whenever it starts.
  // Stops the worker, then a tab wakes it.
  const restartWorker = async () => {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    await landsOn('http://ask.test/wake');
    await page.waitForTimeout(500);
  };
  await page.click(`${passRow} [data-act="pass-site"]`);
  await page.click(`${passRow} [data-minutes="15"]`);
  await page.waitForTimeout(300);
  await restartWorker();
  const alarm = () => page.evaluate(() => chrome.alarms.get('pass:ask.test'));
  check('a running pass outlives a worker restart', 'ask.test' in (await passes()) && (await tabless()) === 1 && Boolean(await alarm()), JSON.stringify(await passes()));
  await page.evaluate(() => chrome.storage.local.set({ passes: { 'ask.test': Date.now() - 1000, 'gone.test': Date.now() + 3600e3 } }));
  await restartWorker();
  check('a pass past its end or without its rule ends when the worker starts', JSON.stringify(await passes()) === '{}' && (await tabless()) === 0 && !(await alarm()), JSON.stringify(await passes()));
  check('the row drops the ended pass', (await text(page, `${passRow} .pass-button`)) === 'Pass');

  // Super lock: in its hours a Think twice site doesn't open at all, its page says until when, with the list and OK.
  // Turning it on mid-window takes back passes and every Yes. Hours around now, on real time like the worker's.
  // The suite has the 12-hour clock on by now, the lock's times follow it
  const hh = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
  check('the suite is on the 12-hour clock here', (await state(page)).settings.hour12 === true);
  const hour = new Date().getHours();
  const lockEnd = (hour + 2) % 24;
  const sessionRules = () => page.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length);
  const yesTab = await ctx.newPage();
  await yesTab.goto('http://ask.test/yes').catch(() => {});
  await yesTab.keyboard.press('y');
  await yesTab.waitForURL('http://ask.test/yes', { timeout: 5000 }).catch(() => {});
  await page.click(`${passRow} [data-act="pass-site"]`);
  await page.click(`${passRow} [data-minutes="15"]`);
  await page.waitForTimeout(300);
  check('before the lock: a Yes tab and a pass', yesTab.url() === 'http://ask.test/yes' && 'ask.test' in (await passes()) && (await sessionRules()) >= 2, yesTab.url());
  await page.locator('#super-lock').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/17-super-lock-off.png` });
  await page.selectOption('[data-hour="lockFrom"]', String(hour));
  await page.selectOption('[data-hour="lockUntil"]', String(lockEnd));
  await page.click('[data-setting="superLock"]');
  await yesTab.waitForURL(`${askPage}#http://ask.test/yes`, { timeout: 5000 }).catch(() => {});
  check('turning super lock on sends an open tab back to its page', yesTab.url() === `${askPage}#http://ask.test/yes`, yesTab.url());
  check('super lock ends the pass and takes back every Yes', JSON.stringify(await passes()) === '{}' && (await sessionRules()) === 0, JSON.stringify(await passes()));
  const lockAlarm = await page.evaluate(() => chrome.alarms.get('lock'));
  check('an alarm waits for the next start of the lock', Boolean(lockAlarm) && new Date(lockAlarm.scheduledTime).getHours() === hour && lockAlarm.scheduledTime > Date.now(), JSON.stringify(lockAlarm));
  await yesTab.waitForSelector('#locked:not([hidden])');
  check('the locked page says until when, with only OK', (await text(yesTab, '#locked')) === `ask.test is super locked until ${hh(lockEnd)}.`
    && (await yesTab.locator('#question').isHidden()) && (await yesTab.locator('#yes').isHidden()) && (await yesTab.locator('#ok').isVisible()), await text(yesTab, '#locked'));
  await yesTab.keyboard.press('y');
  check('y does nothing while locked', yesTab.url() === `${askPage}#http://ask.test/yes`, yesTab.url());
  await yesTab.click('.add');
  await yesTab.keyboard.type('Text Matthew about the flat');
  await yesTab.keyboard.press('Enter');
  await yesTab.waitForSelector('.note:not(.draft)');
  check('the list still takes a note while locked', JSON.stringify((await state(page)).todos['ask.test']).includes('{"later":true,"text":"Text Matthew about the flat"}'), JSON.stringify((await state(page)).todos));
  await yesTab.screenshot({ path: `${SHOTS}/18-super-locked.png` });
  await yesTab.keyboard.press('Enter');
  await yesTab.waitForSelector('#clock', { timeout: 5000 }).catch(() => {});
  check('Enter is OK, it goes to the new tab page', (await yesTab.locator('#clock').count()) === 1, yesTab.url());
  await yesTab.close();
  check('a new tab on the site lands on the locked page', (await landsOn('http://ask.test/')) === `${askPage}#http://ask.test/`);
  check('settings: the header says until when', (await text(page, '#super-lock .lock-label')) === `Locked until ${hh(lockEnd)}`, await text(page, '#super-lock .lock-label'));
  check('settings: the switch and hours give no way', (await page.locator('[data-setting="superLock"]').count()) === 0
    && (await page.locator('[data-hour="lockFrom"]').isDisabled()) && (await page.locator('[data-hour="lockUntil"]').isDisabled()));
  check('settings: think twice rows have no Pass and no x', (await page.locator(`${passRow} .pass-button`).count()) === 0
    && (await page.locator(`${askList} [data-act="remove-site"]`).count()) === 0);
  await page.locator('#super-lock').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/17-super-lock-on.png` });
  const lockedTab = await newTab(ctx, Date.now(), '#lock-item:not([hidden])');
  check('the new tab says super locked until, bottom left', (await oneLine(lockedTab, '#lock-button')) === `Super locked until ${hh(lockEnd)}`, await oneLine(lockedTab, '#lock-button'));
  await lockedTab.screenshot({ path: `${SHOTS}/17-super-lock-new-tab.png` });
  await lockedTab.click('#lock-button');
  await lockedTab.waitForTimeout(400);
  check('a click on it opens Settings at Super lock', (await lockedTab.locator('.nav .item.active').innerText()) === 'Distractions' && (await lockedTab.locator('#super-lock').isVisible()));
  await lockedTab.close();
  // A leftover allow rule (a Yes the worker never saw end) goes when the lock's alarm fires, and when the worker starts
  const leftover = () => page.evaluate(() => chrome.declarativeNetRequest.updateSessionRules({ addRules: [{ id: 900, priority: 2, action: { type: 'allow' },
    condition: { requestDomains: ['ask.test'], resourceTypes: ['main_frame'] } }] }));
  await leftover();
  const stray = await ctx.newPage();
  await stray.goto('http://ask.test/stray').catch(() => {});
  await page.evaluate(() => chrome.alarms.create('lock', { when: Date.now() + 200 }));
  await stray.waitForURL(`${askPage}#http://ask.test/stray`, { timeout: 5000 }).catch(() => {});
  check('the lock\'s alarm takes back what got through', stray.url() === `${askPage}#http://ask.test/stray` && (await sessionRules()) === 0, stray.url());
  await stray.close();
  await leftover();
  await restartWorker();
  check('a worker start takes it back too', (await sessionRules()) === 0);
  await page.evaluate(async () => (await import('/js/store.js')).setSetting('superLock', false));
  await page.waitForTimeout(300);
  check('lock off: the site asks again and the alarm is gone', (await landsOn('http://ask.test/')) === `${askPage}#http://ask.test/` && !(await page.evaluate(() => chrome.alarms.get('lock'))));
  const asksAgain = await ctx.newPage();
  await asksAgain.goto('http://ask.test/').catch(() => {});
  check('lock off: the page asks with Yes again', (await asksAgain.locator('#yes').isVisible()) && (await asksAgain.locator('#locked').isHidden()));
  await asksAgain.close();
  await page.clock.setFixedTime(new Date('2026-09-15T10:35:00'));

  await page.fill(`${blockList} input`, 'ask.test');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${blockList} .blocked-site`);
  await page.waitForTimeout(300);
  check('a site on both lists is blocked', (await landsOn('http://ask.test/')) === `${blockedPage}#http://ask.test/`);
  await page.click(`${blockList} [data-act="remove-site"]`);
  await page.click(`${askList} [data-act="remove-site"]`);
  await page.waitForTimeout(300);
  check('removing the site removes the rule', (await rules(page, true)).length === 0 && (await landsOn('http://ask.test/')) === 'http://ask.test/');

  // A typed URL keeps its path and covers only that part of the site
  await page.fill(`${askList} input`, 'http://ask.test/mail/u/0/#inbox');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${askList} .blocked-site`);
  await page.waitForTimeout(300);
  check('typed URL is saved with its path', JSON.stringify((await state(page)).ask) === '["ask.test/mail/u/0"]', JSON.stringify((await state(page)).ask));
  check('the path asks', (await landsOn('http://ask.test/mail/u/0/')) === `${askPage}#http://ask.test/mail/u/0/`);
  check('a page under the path asks', (await landsOn('http://m.ask.test/mail/u/0/x?y=1')) === `${askPage}#http://m.ask.test/mail/u/0/x?y=1`);
  check('another path does not ask', (await landsOn('http://ask.test/mail/u/1/')) === 'http://ask.test/mail/u/1/');
  check('a longer name does not ask', (await landsOn('http://ask.test/mail/u/01')) === 'http://ask.test/mail/u/01');
  await page.click(`${askList} [data-act="remove-site"]`);
  await page.waitForTimeout(300);

  // A page served by a service worker never reaches the rules, js/background.js catches it instead.
  // Only a secure origin can have a service worker, *.localhost counts as one.
  const server = await cachedSite();
  const cachedUrl = `http://sw.localhost:${server.address().port}/mail/u/0/`;
  const cached = await ctx.newPage();
  await cached.goto(cachedUrl);
  await cached.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 5000 }).catch(() => {});
  await cached.close();
  await page.fill(`${askList} input`, cachedUrl);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${askList} .blocked-site`);
  const gmail = await ctx.newPage();
  await gmail.goto(`${cachedUrl}#inbox`).catch(() => {});
  await gmail.waitForURL(`${askPage}#${cachedUrl}#inbox`, { timeout: 5000 }).catch(() => {});
  check('cached site lands on the ask page', gmail.url() === `${askPage}#${cachedUrl}#inbox`, gmail.url());
  await gmail.click('#yes');
  await gmail.waitForURL(`${cachedUrl}#inbox`, { timeout: 5000 }).catch(() => {});
  await gmail.waitForTimeout(500);
  check('yes opens the cached site and it stays open', gmail.url() === `${cachedUrl}#inbox`, gmail.url());
  await gmail.goto(cachedUrl.replace('/u/0/', '/u/1/')).catch(() => {});
  await gmail.waitForTimeout(500);
  check('another path of the cached site does not ask', gmail.url() === cachedUrl.replace('/u/0/', '/u/1/'), gmail.url());
  await gmail.close();
  await page.fill(`${blockList} input`, cachedUrl);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${blockList} .blocked-site`);
  const youtube = await ctx.newPage();
  await youtube.goto(cachedUrl).catch(() => {});
  await youtube.waitForURL(`${blockedPage}#${cachedUrl}`, { timeout: 5000 }).catch(() => {});
  check('cached site on the blocked list lands on the blocked page', youtube.url() === `${blockedPage}#${cachedUrl}`, youtube.url());
  await youtube.close();
  server.close();
  await page.click(`${blockList} [data-act="remove-site"]`);
  await page.click(`${askList} [data-act="remove-site"]`);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.close();

  // Random 6-12h rotation: keep the photo until nextChangeAt, then advance and re-roll.
  // Starts at 5:00 so every tab below opens before 20:00, when night mode takes the photo away.
  const t0 = new Date('2026-09-17T05:00:00').getTime();
  page = await newTab(ctx, t0);
  await page.click('#settings-toggle');
  await page.click('[data-tab="photos"]');
  await page.click('[data-photos-tab="settings"]');
  await page.click('[data-feed="stock"]');
  await page.click('[data-frequency="random"]');
  let r = (await state(page)).current;
  check('random: frequency saved, nextChangeAt 6-12h ahead', (await state(page)).settings.frequency === 'random' && inWindow(r.nextChangeAt, t0), JSON.stringify(r));
  await page.close();
  page = await newTab(ctx, r.nextChangeAt - 60e3);
  let r2 = (await state(page)).current;
  check('random: same photo before nextChangeAt', r2.key === r.key && r2.nextChangeAt === r.nextChangeAt, JSON.stringify(r2));
  await page.close();
  const t1 = r.nextChangeAt + 60e3;
  page = await newTab(ctx, t1);
  r2 = (await state(page)).current;
  check('random: new photo after nextChangeAt, re-rolled', r2.key !== r.key && inWindow(r2.nextChangeAt, t1), JSON.stringify(r2));
  await page.click('#location');
  await page.click('[data-act="skip"]');
  await page.waitForTimeout(100);
  r = (await state(page)).current;
  check('random: skip re-rolls', r.key !== r2.key && r.nextChangeAt !== r2.nextChangeAt && inWindow(r.nextChangeAt, t1), JSON.stringify(r));
  await page.close();
  check('chrome://extensions shows no errors', !(await errors()).length, JSON.stringify(await errors()));
  await ctx.close();

  // Photo fit, in a DPR 1 profile at 2560x1370 (full screen) and 1280x1370 (half screen)
  const fctx = await launch(ext, { viewport: { width: 2560, height: 1370 }, deviceScaleFactor: 1 });
  page = await newTab(fctx);
  let bg = await bgLayer(page);
  check('auto: landscape stock fills a landscape screen', !bg.fit && bg.size === 'cover' && bg.ratio > 1.3, JSON.stringify(bg));
  await page.setViewportSize({ width: 1280, height: 1370 });
  await page.waitForTimeout(100);
  bg = await bgLayer(page);
  check('auto: half screen flips landscape photo to fit', bg.fit && bg.size === 'contain' && bg.blur, JSON.stringify(bg));
  await page.setViewportSize({ width: 2560, height: 1370 });
  await page.waitForTimeout(100);
  check('auto: back to fill on full screen', !(await bgLayer(page)).fit);

  // Portrait phone photo: a centered crop of a stock photo at 1170x2532
  const portrait = path.join(os.tmpdir(), 'portrait.jpg');
  execSync(`sips -c 1452 671 "${photoJpgs[0]}" --out "${portrait}" >/dev/null && sips -z 2532 1170 "${portrait}" >/dev/null`);
  await page.click('#settings-toggle');
  await page.click('[data-tab="photos"]');
  await page.setInputFiles('.list-add-button input', portrait);
  await page.waitForFunction(() => document.getElementById('location').textContent === 'portrait', null, { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2300); // 2s fade
  bg = await bgLayer(page);
  check('auto: portrait photo fits a landscape screen', bg.fit && bg.size === 'contain' && bg.blur && bg.fullScreen && Math.abs(bg.ratio - 1170 / 2532) < 0.01, JSON.stringify(bg));
  check('fit: old layers removed after fade', (await page.locator('.background-item').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/09-fit-portrait-2560.png` });
  await page.setViewportSize({ width: 1280, height: 1370 });
  await page.waitForTimeout(200);
  check('auto: portrait still fits at half screen', (await bgLayer(page)).fit);
  await page.screenshot({ path: `${SHOTS}/10-fit-portrait-1280.png` });

  // Fit setting: Fill screen crops the portrait, persists across tabs; Fit to screen forces fit
  await page.click('#settings-toggle');
  await page.click('[data-photos-tab="settings"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/11-photo-settings-1280.png` });
  await page.click('[data-fit="fill"]');
  check('fill screen: cover, no blur', (await state(page)).settings.fit === 'fill' && (await bgLayer(page)).size === 'cover' && !(await bgLayer(page)).blur);
  await page.setViewportSize({ width: 2560, height: 1370 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/12-photo-settings-2560.png` });
  await page.close();
  page = await newTab(fctx);
  check('fit setting persists in a new tab', !(await bgLayer(page)).fit && (await page.evaluate(async () => (await import('/js/store.js')).state.settings.fit)) === 'fill');
  await page.evaluate(async () => (await import('/js/store.js')).setSetting('fit', 'fit'));
  await page.evaluate(async () => (await import('/js/photos.js')).showNext());
  await page.waitForTimeout(2300);
  bg = await bgLayer(page);
  check('fit to screen: landscape stock fits too', bg.fit && bg.ratio > 1.3 && bg.size === 'contain', JSON.stringify(bg));
  await page.hover('#location');
  await page.evaluate(() => document.body.classList.add('dragging'));
  await page.waitForTimeout(400);
  const scale = await page.evaluate(() => getComputedStyle(document.getElementById('backgrounds')).scale);
  check('drag-over scale still applies', scale === '1.1', scale);
  await page.close();
  await fctx.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
