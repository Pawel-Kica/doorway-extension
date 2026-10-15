// Catches what the rules in blocker.js miss. A site with a service worker (Gmail, YouTube) serves its pages
// from cache, so the page load never reaches the network and no declarativeNetRequest rule sees it.
// Whenever a tab's URL changes, a listed site that got through is sent to blocked.html or ask.html from here, with its URL in the hash.

import { condition, covers } from './sites.js';
import { isLocked, nextStart } from './lock.js';

const askPage = (url) => `${chrome.runtime.getURL('ask.html')}#${url}`;

// Sends a tab to another URL. The tab may close while the lists are read, then there is nothing to send
// ("No tab with id" would land in the extension's Errors list).
const send = (tabId, url) => chrome.tabs.update(tabId, { url }).catch(() => {});

chrome.tabs.onUpdated.addListener(async (tabId, { url }) => {
  if (!url?.startsWith('http')) return;
  const { blocked = [], ask = [] } = await chrome.storage.local.get(['blocked', 'ask']);
  const listed = (list) => list.some((site) => covers(condition(site), url));
  if (listed(blocked)) return send(tabId, `${chrome.runtime.getURL('blocked.html')}#${url}`);
  if (!listed(ask)) return;
  // Yes on ask.html left an allow rule for this tab (js/ask.js), a pass one for every tab (js/blocker.js), then the site is fine here.
  const allowed = await chrome.declarativeNetRequest.getSessionRules();
  if (allowed.some((r) => (!r.condition.tabIds || r.condition.tabIds.includes(tabId)) && covers(r.condition, url))) return;
  send(tabId, askPage(url));
});

// The session allow rule startPass (js/blocker.js) adds for an entry's condition: the one with no tab ids.
const passRule = (r, pass) => !r.condition.tabIds && r.condition.requestDomains?.[0] === pass.requestDomains[0]
  && r.condition.regexFilter === pass.regexFilter;

// Ends a pass (startPass in js/blocker.js): on its alarm, End on the site's pill (js/todo.js), End in Settings, or checkPasses.
// Tabs on the site keep it like after a Yes, the next tab asks again.
// One end at a time: an alarm that wakes the worker also runs checkPasses, both would end the same pass.
let ending = Promise.resolve();
const endPass = (site) => (ending = ending.catch(() => {}).then(() => endNow(site)));
async function endNow(site) {
  const { passes = {} } = await chrome.storage.local.get('passes');
  if (!(site in passes)) return;
  const { [site]: _, ...rest } = passes;
  const pass = condition(site);
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const tabs = (await chrome.tabs.query({})).filter((t) => t.url?.startsWith('http') && covers(pass, t.url));
  const id = Math.max(0, ...rules.map((r) => r.id));
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: rules.filter((r) => passRule(r, pass)).map((r) => r.id),
    addRules: tabs.map((t, i) => ({ id: id + 1 + i, priority: 2, action: { type: 'allow' }, condition: { ...pass, tabIds: [t.id] } })),
  });
  await chrome.storage.local.set({ passes: rest });
  chrome.alarms?.clear(`pass:${site}`);
  // Open new tabs reload their state on this channel (js/store.js), so the row in Settings drops the pass
  new BroadcastChannel('doorway').postMessage('changed');
}

// Alarms and onStartup can't be trusted: a Chrome restart drops the alarm and skips onStartup, so a pass stayed
// "free until 18:03" for days. Every time the worker starts, a pass past its end or without its rule
// (session rules die when Chrome quits) ends, and a running one gets its alarm back.
async function checkPasses() {
  const { passes = {} } = await chrome.storage.local.get('passes');
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  for (const [site, endsAt] of Object.entries(passes)) {
    if (endsAt > Date.now() && rules.some((r) => passRule(r, condition(site)))) chrome.alarms?.create(`pass:${site}`, { when: endsAt });
    else endPass(site);
  }
}
// Super lock starting (js/lock.js): passes end and every Yes is taken back, so tabs on a Think twice site go back to
// ask.html, which then only has the list and OK. Runs on the lock's alarm, whenever the worker starts (a Chrome restart
// drops alarms) and when the lock's settings change. While it's on there is nothing left to take back, so running
// again does nothing. Session rules are only ever allow rules (Yes in js/ask.js, passes), so all of them go.
async function checkLock() {
  const { settings = {}, ask = [], passes = {} } = await chrome.storage.local.get(['settings', 'ask', 'passes']);
  if (settings.superLock) chrome.alarms?.create('lock', { when: nextStart(settings) });
  else chrome.alarms?.clear('lock');
  if (!isLocked(settings)) return;
  if (Object.keys(passes).length) {
    for (const site of Object.keys(passes)) chrome.alarms?.clear(`pass:${site}`);
    await chrome.storage.local.set({ passes: {} });
    new BroadcastChannel('doorway').postMessage('changed');
  }
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
  for (const tab of await chrome.tabs.query({})) {
    if (tab.url?.startsWith('http') && ask.some((site) => covers(condition(site), tab.url))) send(tab.id, askPage(tab.url));
  }
}
// The lock first, else checkPasses could end a pass the lock is about to drop and hand its tabs an allow rule
checkLock().then(checkPasses);

chrome.storage.onChanged.addListener(({ settings }) => {
  const lock = (s = {}) => [s.superLock, s.lockFrom, s.lockUntil].join();
  if (settings && lock(settings.oldValue) !== lock(settings.newValue)) checkLock();
});

// Without the alarms permission (manifest not reloaded yet) chrome.alarms is missing, the worker must still start
chrome.alarms?.onAlarm.addListener(({ name }) => (name === 'lock' ? checkLock() : name.startsWith('pass:') && endPass(name.slice(5))));

// js/todo.js asks from every page of a Think twice site whether to show the site's todo list there.
// The answer is the list entry the page falls under, or null. No check for the Yes pass: a page a service worker
// serves can open without asking (a tab reloaded on Reddit or Gmail), the list should show there too.
// "done" (I'm done!, everything on the list checked) does what No does: the tab loses its pass and goes to the new tab page.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.endPass) return void endPass(msg.endPass);
  const tab = sender.tab?.id;
  if (msg === 'done') {
    chrome.declarativeNetRequest.getSessionRules()
      .then((rules) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.filter((r) => r.condition.tabIds?.includes(tab)).map((r) => r.id) }))
      .then(() => send(tab, 'chrome://newtab'));
    return;
  }
  if (msg !== 'todos') return;
  (async () => {
    const { ask = [] } = await chrome.storage.local.get('ask');
    const site = ask.find((s) => covers(condition(s), sender.url));
    reply(site ? { site } : null);
  })();
  return true;
});
