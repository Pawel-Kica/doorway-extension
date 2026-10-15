// Night mode hours, all user settings (Settings > Night mode). Defaults: photo off 20:00-04:00, "Go to sleep" from 22:00.
// Both windows end at wakeAt, the same boundary the morning greeting uses.
// The page reads the time through now(), so a preview (click a thumbnail in Settings > Night mode) can pin it for a few seconds.

import { state } from './store.js';

let pinned = null;
export const now = () => pinned ?? new Date();
// Pins the page time to `date`, null goes back to the real clock.
export const pinTime = (date) => { pinned = date; };

// Is `hour` inside [from, to), where the window may cross midnight. Super lock (js/lock.js) uses it too.
export const within = (hour, from, to) => (from > to ? hour >= from || hour < to : hour >= from && hour < to);

export const isDark = (hour) => state.settings.nightMode && within(hour, state.settings.nightFrom, state.settings.wakeAt);
export const isSleep = (hour) => state.settings.sleepGreeting && within(hour, state.settings.sleepFrom, state.settings.wakeAt);
