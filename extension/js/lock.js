// Super lock (Settings > Distractions): every day from lockFrom until lockUntil (hours, may cross midnight, equal is
// all day), Think twice sites don't open at all. ask.html then only says until when, with the site's list and OK.
// js/background.js ends passes and takes every Yes back when it starts, and while it's on Settings won't let the lock
// or the Think twice list give way.

import { within } from './night.js';

// Whether the lock is on at `date`. `settings` is the saved settings object.
export const isLocked = (settings, date = new Date()) => Boolean(settings.superLock)
  && (settings.lockFrom === settings.lockUntil || within(date.getHours(), settings.lockFrom, settings.lockUntil));

// "10:00", or "10 AM" with the 12-hour clock.
export const hourLabel = (h, hour12) => (hour12 ? `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}` : `${String(h).padStart(2, '0')}:00`);

// "until 10:00" or "all day", for "youtube.com is super locked until 10:00." `mark` wraps the time, to highlight it.
export const untilText = (settings, mark = (t) => t) => (settings.lockFrom === settings.lockUntil
  ? mark('all day') : `until ${mark(hourLabel(settings.lockUntil, settings.hour12))}`);

// When the lock next starts (ms), for the alarm that takes back what is open then.
export function nextStart(settings, now = new Date()) {
  const d = new Date(now);
  d.setHours(settings.lockFrom, 0, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
