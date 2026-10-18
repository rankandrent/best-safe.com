// Keyword cannibalization guard: a new keyword must not target the same search
// intent as an existing post (or another queued keyword).
// 1. SERP overlap (strongest evidence): if both keywords have a recorded US top-10 in
//    data/serps.json, >= SERP_SAME shared URLs means the same intent and <= SERP_DISTINCT
//    means a distinct intent even when the wording overlaps.
// 2. Same Ahrefs parent topic means the same intent.
// 3. Otherwise compare core words of the keyword with each post's primary + secondary
//    keywords; a single-word core only matches an identical single-word core, so
//    "magnetic cabinet locks" no longer clashes with "smart lock".
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';
import { tokenize, STOPWORDS } from './nlp.mjs';

const GENERIC = new Set(['best', 'for', 'top', '2026', 'vs', 'versus', 'guide', 'review', 'buying']);
const core = (s) => new Set(tokenize(String(s)).filter((t) => !STOPWORDS.has(t) && !GENERIC.has(t)).map((t) => t.replace(/s$/, '')));
export const SERP_SAME = 4;
export const SERP_DISTINCT = 2;

export function overlap(a, b) {
  const A = core(a);
  const B = core(b);
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).length;
  if (Math.min(A.size, B.size) === 1 && A.size !== B.size) return 0;
  return inter / Math.min(A.size, B.size);
}

/** Recorded SERPs: { "<keyword lowercased>": { date, country, urls: [top-10 URLs] } }. */
export function loadSerps(file = path.join(DATA_DIR, 'serps.json')) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const norm = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
/** Shared top-10 URLs between two keywords, or null when either SERP is not recorded. */
export function serpShared(a, b, serps) {
  const A = serps[String(a).toLowerCase()]?.urls;
  const B = serps[String(b).toLowerCase()]?.urls;
  if (!A?.length || !B?.length) return null;
  const set = new Set(B.map(norm));
  return A.map(norm).filter((u) => set.has(u)).length;
}

/** Returns the conflicting post/keyword or null. */
export function findCannibal(candidate, posts, { threshold = 0.75, serps = loadSerps() } = {}) {
  const kw = candidate.keyword;
  const parent = candidate.ahrefs?.parentTopic ?? candidate.parentTopic;
  for (const p of posts) {
    const d = p.data;
    const targets = [d.keyword, ...(d.secondaryKeywords ?? [])].filter(Boolean);
    const shared = d.keyword ? serpShared(kw, d.keyword, serps) : null;
    if (shared !== null && shared >= SERP_SAME) return { slug: p.slug, reason: `${shared} of the top-10 Google results are shared with "${d.keyword}" (same intent)` };
    if (shared !== null && shared <= SERP_DISTINCT) continue;
    if (parent && d.parentTopic && parent === d.parentTopic) return { slug: p.slug, reason: `same Ahrefs parent topic "${parent}"` };
    for (const t of targets) {
      const o = overlap(kw, t);
      if (o >= threshold) return { slug: p.slug, reason: `"${kw}" overlaps "${t}" (${Math.round(o * 100)}%)` };
    }
  }
  return null;
}
