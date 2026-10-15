// Website lists (Settings > Distractions), kept as declarativeNetRequest rules that Chrome applies across restarts,
// one rule per entry (see sites.js for what an entry covers).
// state.blocked: page loads go to blocked.html, which names the site (js/blocked.js).
// state.ask (Think twice): page loads go to ask.html, which asks "Do you really need it?" and on Yes
// lets that tab through (js/ask.js). A pass lets every tab through for a while (startPass). A site on both lists is blocked.

import { state, save } from './store.js';
import { condition } from './sites.js';

// False while Chrome still runs the extension without the declarativeNetRequest permission:
// an unpacked extension gets new JS from disk at once, but a new manifest only after Reload on chrome://extensions.
export const canBlock = () => Boolean(chrome.declarativeNetRequest);

// Replaces all rules with the saved lists. Also runs on every new tab, so the rules always follow the lists.
export async function syncBlocked() {
  if (!canBlock()) return;
  // Redirecting needs access to the site. Without it Chrome would skip the rule and load the site,
  // so a block rule falls back to a plain block, which shows Chrome's own error page.
  const redirect = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  // \0 is the whole URL, so blocked.html can name the site and ask.html knows where to go on Yes.
  const page = (name) => ({ type: 'redirect', redirect: { regexSubstitution: `${chrome.runtime.getURL(name)}#\\0` } });
  const block = redirect ? page('blocked.html') : { type: 'block' };
  const ask = page('ask.html');
  // Priorities: block (3) beats the allow rule ask.js adds on Yes (2), which beats ask (1).
  const rules = [...state.blocked.map((site) => [site, block, 3]), ...state.ask.map((site) => [site, ask, 1])]
    .map(([site, action, priority], i) => ({ id: i + 1, priority, action, condition: condition(site) }));
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  return chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: rules });
}

// Pass on a Think twice entry (Pass on its row in Settings > Distractions): every tab opens it without asking for `minutes`.
// A session allow rule with no tab ids (priority 2, like Yes in ask.js) plus the end time in state.passes, which js/todo.js
// counts down on the site. Its alarm ends it in js/background.js (endPass).
export async function startPass(site, minutes) {
  const endsAt = Date.now() + minutes * 60000;
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const id = Math.max(0, ...rules.map((r) => r.id)) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{ id, priority: 2, action: { type: 'allow' }, condition: condition(site) }] });
  await chrome.alarms.create(`pass:${site}`, { when: endsAt });
  await save({ passes: { ...state.passes, [site]: endsAt } });
}

// Saves one list ("blocked" or "ask"), then applies it.
export async function setSites(key, sites) {
  await save({ [key]: sites });
  await syncBlocked();
}
