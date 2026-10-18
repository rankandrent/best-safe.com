// Publishing schedule:
//   weeklyPostsPerDay (optional ramp), then a random randomPhase.min-max posts/day
//   (site.config.json: currently 3-4 posts every day).
// The random count is seeded by the date, so every run on the same day agrees.
// Posts are spread over the day: each daily quota is mapped onto
// `publishHoursLocal` slots, and a run only publishes posts whose slot has passed.
import { fileURLToPath } from 'node:url';
import { SITE } from './config.mjs';

const S = SITE.schedule;

/** Local date (YYYY-MM-DD) and hour in the site timezone. */
export function localNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: S.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function quotaFor(date, startDate) {
  const day = daysBetween(startDate, date);
  if (day < 0) return { day, week: 0, quota: 0, phase: 'not-started' };
  const week = Math.floor(day / 7);
  if (week < S.weeklyPostsPerDay.length) return { day, week: week + 1, quota: S.weeklyPostsPerDay[week], phase: 'ramp' };
  const { min, max, weights } = S.randomPhase;
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = seededRandom(`${date}:${SITE.domain}`) * total;
  for (let i = 0; i < values.length; i++) {
    r -= weights[i];
    if (r < 0) return { day, week: week + 1, quota: values[i], phase: 'random' };
  }
  return { day, week: week + 1, quota: values.at(-1), phase: 'random' };
}

/** Hours (local) at which each of today's posts becomes due. */
export function slotsFor(quota) {
  const hours = S.publishHoursLocal;
  if (quota <= 0) return [];
  if (quota >= hours.length) return Array.from({ length: quota }, (_, i) => hours[Math.min(i, hours.length - 1)]);
  return Array.from({ length: quota }, (_, i) => hours[Math.floor((i * hours.length) / quota)]);
}

/** UTC instant for a wall-clock time in the site timezone. */
function zonedToUtc(date, hour, minute) {
  const guess = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: S.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(guess))
      .map((x) => [x.type, x.value]),
  );
  const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return new Date(guess - (shown - guess));
}

/**
 * Random publish times for a day's posts, so posts don't go live at the same
 * clock time every day. Seeded by the date (every run on that day agrees),
 * inside `releaseWindowLocal` and at least `minGapMinutes` apart.
 */
export function releaseTimes(date, count) {
  const { startHour = 9.5, endHour = 21.5, minGapMinutes = 90 } = S.releaseWindowLocal ?? {};
  const span = (endHour - startHour) * 60;
  const out = [];
  for (let n = 0, tries = 0; out.length < count && tries < 500; tries++, n++) {
    const m = Math.floor(seededRandom(`${date}:${SITE.domain}:release:${n}`) * span);
    if (out.every((x) => Math.abs(x - m) >= minGapMinutes)) out.push(m);
  }
  return out
    .sort((a, b) => a - b)
    .map((m) => {
      const total = startHour * 60 + m;
      return zonedToUtc(date, Math.floor(total / 60), Math.floor(total % 60));
    });
}

export function dueNow({ date, hour }, startDate) {
  const q = quotaFor(date, startDate);
  const due = slotsFor(q.quota).filter((h) => h <= hour).length;
  return { ...q, due };
}

// CLI preview: `npm run agents:schedule` prints the next 70 days.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const start = process.argv[2] || localNow().date;
  let total = 0;
  for (let i = 0; i < 70; i++) {
    const d = new Date(Date.parse(`${start}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    const q = quotaFor(d, start);
    total += q.quota;
    console.log(`${d}  week ${String(q.week).padStart(2)}  ${q.phase.padEnd(6)}  posts=${q.quota}  slots=${slotsFor(q.quota).join(',')}`);
  }
  console.log(`Total over 70 days: ${total}`);
}
