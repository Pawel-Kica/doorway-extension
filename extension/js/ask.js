// Think twice page. blocker.js sends a listed site here as ask.html#<url>.
// Yes lets this tab open the site right away, until the tab closes. Save keeps the link on the site's list and goes to
// the new tab page, No goes there right away. Keys answer too: y Yes, s Save, n or Enter No.
// During super lock (js/lock.js) it only says until when the site is locked, OK (or Enter) goes to the new tab page.
// Both show the site's list (storage `todos`, which js/todo.js shows on the site after a Yes): + adds a note as the
// next row, Enter keeps it, Escape drops it, a click on a note checks it off.

import { condition, covers } from './sites.js';
import { isLocked, untilText } from './lock.js';

const target = URL.parse(location.hash.slice(1));
const $ = (sel) => document.querySelector(sel);

const toNewTab = () => chrome.tabs.update({ url: 'chrome://newtab' });

// "https://www.reddit.com/r/x/comments/1w6/gpt_6_astra/" -> "Gpt 6 astra", the way a saved link reads in the list.
function linkTitle({ hostname, pathname }) {
  const slug = pathname.split('/').filter((s) => /[a-z]{3}/i.test(s)).pop();
  if (!slug) return hostname.replace(/^www\./, '') + pathname.replace(/\/+$/, '');
  const words = decodeURIComponent(slug).replace(/[_-]+/g, ' ').replace(/\.\w+$/, '');
  return words[0].toUpperCase() + words.slice(1);
}

// The page is web accessible, so any site can link here with its own hash. Only web addresses get asked about.
if (!/^https?:$/.test(target?.protocol)) toNewTab();
else {
  const { ask = [], settings = {} } = await chrome.storage.local.get(['ask', 'settings']);
  // The list entry this URL falls under keeps the todos, so every page of the site shares one list.
  const entries = ask.filter((site) => covers(condition(site), target.href));
  const entry = entries[0] ?? target.hostname.replace(/^www\./, '');
  const locked = isLocked(settings);

  // Rewrites this site's todo list: [{ text, url?, later?, done? }], the first open item is the one on the pill.
  const updateList = async (fn) => {
    const { todos = {} } = await chrome.storage.local.get('todos');
    await chrome.storage.local.set({ todos: { ...todos, [entry]: fn(todos[entry] ?? []) } });
  };

  // Yes: last visit's done items go, then an allow rule for the entry in this tab (gone when Chrome quits),
  // so moving around the site does not ask again, and the site loads. A page left open until the lock started asks again.
  const open = async () => {
    if (isLocked((await chrome.storage.local.get('settings')).settings ?? {})) return location.reload();
    await updateList((list) => list.filter((t) => !t.done));
    const { id: tab } = await chrome.tabs.getCurrent();
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const addRules = entries.map((site, i) => (
      { id: Math.max(0, ...rules.map((r) => r.id)) + 1 + i, priority: 2, action: { type: 'allow' }, condition: { ...condition(site), tabIds: [tab] } }));
    await chrome.declarativeNetRequest.updateSessionRules({ addRules });
    location.replace(target.href);
  };

  // Save keeps this URL, titled from its path.
  const save = async () => {
    await updateList((list) => [...list, { text: linkTitle(target), later: true, url: target.href }]);
    toNewTab();
  };

  // The list. `adding`: the + row is open, its input keeps what was typed across renders.
  const input = Object.assign(document.createElement('input'), { spellcheck: false });
  const draft = Object.assign(document.createElement('label'), { className: 'note draft' });
  draft.append(input);
  let adding = false;
  async function renderList() {
    const { todos = {} } = await chrome.storage.local.get('todos');
    const list = todos[entry] ?? [];
    const notes = list.map((t, i) => {
      const note = Object.assign(document.createElement('button'), { className: `note${t.done ? ' done' : ''}`, tabIndex: -1, textContent: t.text });
      note.onclick = () => updateList((l) => l.map((x, j) => (j === i ? { ...x, done: !x.done } : x)));
      return note;
    });
    const empty = Object.assign(document.createElement('div'), { className: 'empty' });
    empty.innerHTML = 'Nothing, just checking out of habit <span class="emoji">🙃</span>';
    $('.items').replaceChildren(...notes, ...(adding ? [draft] : list.length ? [] : [empty]));
    if (adding) input.focus();
  }
  const setAdding = (on) => {
    adding = on;
    input.value = '';
    renderList();
  };
  $('.add').addEventListener('click', () => setAdding(!adding));
  input.addEventListener('keydown', async (e) => {
    const text = input.value.trim();
    if (e.key === 'Enter' && text) await updateList((list) => [...list, { text, later: true }]);
    if (['Enter', 'Escape'].includes(e.key)) setAdding(false);
  });
  chrome.storage.onChanged.addListener((changes) => changes.todos && renderList());

  for (const el of document.querySelectorAll('.site')) el.textContent = target.hostname.replace(/^www\./, '');
  $('#question').hidden = locked;
  $('#answers').hidden = locked;
  $('#locked').hidden = !locked;
  $('#lock-answers').hidden = !locked;
  $('#until').textContent = untilText(settings);
  renderList();
  $('#yes').addEventListener('click', open);
  $('#save').addEventListener('click', save);
  $('#no').addEventListener('click', toNewTab);
  $('#ok').addEventListener('click', toNewTab);

  const keys = locked ? { Enter: '#ok' } : { y: '#yes', s: '#save', n: '#no', Enter: '#no' };
  document.addEventListener('keydown', (e) => {
    const button = keys[e.key];
    if (!button || e.target === input || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    e.preventDefault();
    $(button).click();
  });
}
