// Content script: the todo list of a Think twice site (filled on ask.html, see js/ask.js), shown on every page of the
// site itself. A pill in the top right corner reads "Todos (n)" with n still open, the list under it is open on every
// page load, a click on the pill folds or unfolds it. During a pass (js/blocker.js) the pill reads "End 12:34", counting down,
// and a click ends the pass.
// Runs on every page, but only asks the background worker (js/background.js) on a host from the Think twice list.
// After a Reload on chrome://extensions this copy keeps running on pages that were open, cut off from the extension:
// every chrome.* call then throws "Extension context invalidated", so clicks check chrome.runtime?.id first and do nothing.

(async () => {
  // XML pages (an RSS feed, an SVG) can't parse the list's HTML
  if (!(document instanceof HTMLDocument)) return;
  const { ask = [] } = await chrome.storage.local.get('ask');
  const here = location.hostname;
  if (!ask.some((s) => { const h = s.split('/')[0]; return here === h || here.endsWith(`.${h}`); })) return;
  const answer = await chrome.runtime.sendMessage('todos');
  if (!answer) return;
  const { site } = answer;

  // A plain div, not a custom element: Reddit hides every undefined custom element (:not(:defined) { visibility: hidden })
  const el = document.createElement('div');
  el.id = 'doorway-todos';
  const root = el.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      /* Pill and list are one dark green shape: the pill is a tab on the list's top right corner, a pill again when folded */
      .dw { position: fixed; top: 9px; right: 117px; z-index: 2147483647; visibility: visible; display: flex; flex-direction: column; align-items: flex-end;
        color: #fff; filter: drop-shadow(0 4px 16px #0009);
        font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; }
      .dw[hidden] { display: none; }
      button { font: inherit; color: inherit; border: 0; outline: none; cursor: pointer; }
      .pill { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 34px 4px 26px; border-radius: 18px 18px 0 0;
        background: hsl(151 47% 24%); }
      /* bare: a pass with nothing on the list, the pill alone */
      :is(.folded, .bare) .pill { height: 40px; padding-bottom: 0; border-radius: 1000rem; }
      :is(.folded, .bare) .pill:hover { background: hsl(151 47% 28%); }
      .pill img { width: 24px; height: 24px; }
      .count, h3 em, .later, a { color: #fde9b5; font-style: normal; }
      .card { width: 340px; padding: 18px; box-sizing: border-box; border-radius: 10px 0 10px 10px; background: hsl(151 47% 24%); }
      :is(.folded, .bare) .card { display: none; }
      header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
      /* px, not rem: rem follows the site's <html> font-size, YouTube's 10px shrank this to 10.5px */
      h3 { margin: 0; font: inherit; font-size: 15px; }
      .add { width: 24px; height: 24px; margin: -2px -4px 0 0; padding: 0; flex-shrink: 0; border-radius: 50%; background: none;
        font-size: 20px; line-height: 24px; color: hsl(0 0% 100% / 0.7); }
      .add:hover { background: hsl(0 0% 100% / 0.1); color: #fff; }
      .item { display: flex; align-items: flex-start; gap: 10px; margin: 0 -8px; padding: 7px 8px; border-radius: 7px; }
      .item:hover { background: hsl(0 0% 100% / 0.07); }
      .box { width: 16px; height: 16px; margin-top: 1px; padding: 0; flex-shrink: 0; border-radius: 50%; background: none;
        box-shadow: inset 0 0 0 1.5px hsl(0 0% 100% / 0.5); font-size: 11px; font-weight: 700; color: #000; }
      .box:hover { box-shadow: inset 0 0 0 1.5px #fff; }
      .done .box { background: hsl(0 0% 100% / 0.85); box-shadow: none; }
      .item span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .done span, .done a { color: hsl(0 0% 100% / 0.5); text-decoration: line-through; }
      a { text-decoration: none; }
      a:hover { text-decoration: underline; }
      input[hidden] { display: none; }
      input { width: 100%; box-sizing: border-box; margin-top: 10px; padding: 8px 10px; border: 0; border-radius: 7px; outline: none;
        background: hsl(0 0% 100% / 0.07); color: #fff; font: 400 14px -apple-system, BlinkMacSystemFont, sans-serif; }
      .finish { width: 100%; margin-top: 14px; padding: 9px 14px; border-radius: 1000rem; background: hsl(150 55% 34%); }
      .finish:hover { background: hsl(150 55% 40%); }
      .finish[hidden] { display: none; }
    </style>
    <div class="dw" hidden>
      <button class="pill"><img src="${chrome.runtime.getURL('icons/icon128.png')}" alt=""><span class="label"></span> <span class="count"></span></button>
      <div class="card">
        <header><h3>You came to <em>${here.replace(/^www\./, '')}</em> to:</h3><button class="add" title="Add">+</button></header>
        <div class="items"></div>
        <input spellcheck="false" hidden>
        <button class="finish" hidden>I'm done!</button>
      </div>
    </div>`;
  document.documentElement.append(el);
  const $ = (sel) => root.querySelector(sel);

  // Rewrites the site's list in storage, render() follows through storage.onChanged. Does nothing after a Reload (see top).
  const update = async (fn) => {
    if (!chrome.runtime?.id) return;
    const { todos = {} } = await chrome.storage.local.get('todos');
    await chrome.storage.local.set({ todos: { ...todos, [site]: fn(todos[site] ?? []) } });
  };

  // End time of the site's pass, 0 without one. "12:34" left, "1:02:03" from an hour up.
  let endsAt = 0;
  const left = () => {
    const s = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const mmss = `${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return s >= 3600 ? `${Math.floor(s / 3600)}:${mmss}` : mmss;
  };

  async function render() {
    const { todos = {}, passes = {} } = await chrome.storage.local.get(['todos', 'passes']);
    const list = todos[site] ?? [];
    const open = list.filter((t) => !t.done);
    endsAt = passes[site] ?? 0;
    $('.dw').hidden = !list.length && !endsAt;
    $('.dw').classList.toggle('bare', !list.length);
    $('.label').textContent = endsAt ? 'End' : 'Todos';
    $('.count').textContent = endsAt ? left() : `(${open.length})`;
    $('.finish').hidden = Boolean(open.length);
    $('.items').replaceChildren(...list.map((t, i) => {
      const row = document.createElement('div');
      row.className = `item${t.done ? ' done' : ''}`;
      const box = document.createElement('button');
      box.className = 'box';
      box.textContent = t.done ? '✓' : '';
      box.onclick = () => update((l) => l.map((x, j) => (j === i ? { ...x, done: !x.done } : x)));
      const text = document.createElement(t.url ? 'a' : 'span');
      text.textContent = t.text;
      if (t.url) text.href = t.url;
      if (t.later) text.className = 'later';
      row.append(box, text);
      return row;
    }));
  }

  $('.pill').onclick = () => {
    if (!endsAt) return $('.dw').classList.toggle('folded');
    if (chrome.runtime?.id) chrome.runtime.sendMessage({ endPass: site });
  };
  setInterval(() => endsAt && ($('.count').textContent = left()), 1000);
  // + shows the input, Enter adds the item and hides it again, Escape just hides it
  $('.add').onclick = () => { $('input').hidden = !$('input').hidden; $('input').focus(); };
  // Keys typed here stay here, so the site's own shortcuts (Gmail's "c" for compose) do not fire
  for (const type of ['keydown', 'keypress', 'keyup']) $('input').addEventListener(type, (e) => e.stopPropagation());
  $('input').addEventListener('keydown', (e) => {
    const text = e.target.value.trim();
    if (e.key === 'Escape' || (e.key === 'Enter' && !text)) e.target.hidden = true;
    if (e.key !== 'Enter' || !text) return;
    e.target.value = '';
    e.target.hidden = true;
    update((l) => [...l, { text }]);
  });
  $('.finish').onclick = async () => {
    if (!chrome.runtime?.id) return;
    await update((l) => l.filter((t) => !t.done));
    chrome.runtime.sendMessage('done');
  };
  chrome.storage.onChanged.addListener((changes) => { if (changes.todos || changes.passes) render(); });

  render();
})();
