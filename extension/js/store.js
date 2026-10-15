// App state persisted in chrome.storage.local and mirrored in memory.
// Photo keys look like "stock:001" or "custom:<uuid>".

export const DEFAULTS = {
  settings: {
    clockVisible: true,
    greetingVisible: true,
    hour12: false,
    includeName: true,
    name: '',
    feeds: ['stock'], // any of stock | custom | favorites, photos come from all of them
    frequency: 'random', // tab | hour | random (every 6-12h) | day
    fit: 'auto', // auto | fill | fit
    nightMode: true, // no photo at night, black behind the clock
    nightFrom: 20, // hour the photo goes off
    sleepGreeting: true, // "Go to sleep" instead of "Good evening"
    sleepFrom: 22, // hour the greeting flips
    wakeAt: 4, // hour both end, also where "Good morning" starts
    superLock: false, // Think twice sites don't open at all from lockFrom until lockUntil (js/lock.js)
    lockFrom: 18,
    lockUntil: 10,
  },
  current: null, // { key, slot } or { key, nextChangeAt } for 'random'
  favorites: [], // keys, newest first
  history: [], // keys, newest first, max 50
  queues: {}, // enabled feeds joined with "+" -> { order: [keys], i }
  blocked: [], // sites blocker.js blocks, e.g. "bbc.com" or "bbc.com/news" (see sites.js)
  ask: [], // sites that ask "Do you really need it?" first (Think twice)
  todos: {}, // Think twice entry -> [{ text, url?, later?, done? }], written by ask.js and todo.js (later: added on ask.html)
  passes: {}, // Think twice entry -> end time (ms) of its running pass, see startPass in blocker.js
};

export const state = structuredClone(DEFAULTS);
const listeners = new Set();
// Tells other open new tabs to reload state (a channel never delivers to its own sender).
const channel = new BroadcastChannel('doorway');

// Loads persisted state into `state`.
export async function loadState() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  for (const k of Object.keys(DEFAULTS)) {
    state[k] = k === 'settings' ? { ...DEFAULTS.settings, ...data.settings } : data[k] ?? structuredClone(DEFAULTS[k]);
  }
  // Before feeds could be combined, settings held a single `feed`.
  const { feed, ...settings } = state.settings;
  if (feed) state.settings = data.settings.feeds ? settings : { ...settings, feeds: [feed] };
}

// Updates memory, notifies listeners, persists, then tells other tabs.
export async function save(patch) {
  Object.assign(state, patch);
  emit();
  await chrome.storage.local.set(patch);
  broadcast();
}

export const broadcast = () => channel.postMessage('changed');

// Runs fn when another tab saved something.
export const onOtherTabChange = (fn) => channel.addEventListener('message', fn);

// Shorthand for changing one setting.
export function setSetting(key, value) {
  return save({ settings: { ...state.settings, [key]: value } });
}

// Registers a render callback fired on every state change.
export function subscribe(fn) {
  listeners.add(fn);
}

// Fires listeners; also used when IndexedDB-backed data changes.
export function emit() {
  listeners.forEach((fn) => fn());
}
