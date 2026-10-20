// Helper for the daily Claude Routine (see ROUTINE.md). The routine session
// does the research and writing itself; this script handles the bookkeeping
// that the API-driven agents would otherwise do.
//
//   node scripts/routine.mjs status                 today's quota, queue size
//   node scripts/routine.mjs slots                  random go-live times (pubDate) for today's remaining posts
//   node scripts/routine.mjs next                   next keyword to write (skips over-cap / cannibalizing ones)
//   node scripts/routine.mjs cannibal "<keyword>"   check a keyword against existing posts
//   node scripts/routine.mjs links <slug>           internal-link candidates
//   node scripts/routine.mjs add-keywords <file>    merge researched keywords into the queue
//   node scripts/routine.mjs audit <slug>           SEO audit (needs data/briefs/<slug>.json)
//   node scripts/routine.mjs qa <slug>              QA agent review (must PASS before the post can go live)
//   node scripts/routine.mjs factcheck <slug> "notes"  record that every claim was verified against sources
//   node scripts/routine.mjs finalize <slug>        featured image, backlinks, queue/state, report
//   node scripts/routine.mjs trim-queue             live posts longer than their SERP limit, most padded first
//   node scripts/routine.mjs trimmed <slug> [note]  record that a post was tightened (skipped by trim-queue for 90 days)
//
// Translations (src/content/blog/<lang>/<slug>.md): audit, qa, factcheck and finalize also take
// '<lang>/<slug>' (e.g. `qa de/bester-pistolentresor` writes data/qa/de/<slug>.json).
//   node scripts/routine.mjs translate-queue [lang]  English posts (live + QA passed) without a translation, oldest first
//   node scripts/routine.mjs translate-slots <lang> [--count N] [--after <english-slug>]
//                                                   random pubDates a few hours from now, >= 2h apart, max 5/language/day
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, SITE } from '../agents/lib/config.mjs';
import { loadQueue, saveQueue, loadState, saveState, listPosts, saveReport, listTranslations, parseRef, readPost } from '../agents/lib/store.mjs';
import { localNow, quotaFor, releaseTimes } from '../agents/lib/schedule.mjs';
import { slugify } from '../agents/lib/nlp.mjs';
import { audit, pickLinkTargets, addBacklinks } from '../agents/seo-agent.mjs';
import { nextKeyword, collectSources } from '../agents/orchestrator.mjs';
import { ensureFeatured } from './featured-images.mjs';
import { funnelOf } from '../agents/lib/funnel.mjs';
import { findCannibal } from '../agents/lib/cannibal.mjs';
import { qaPost, qaTranslation, recordFactCheck, readQa, lengthLimit, bodyHash } from '../agents/qa-agent.mjs';
import { productCountFor } from '../agents/lib/product-count.mjs';

const BRIEFS = path.join(DATA_DIR, 'briefs');
const TRIMMED = path.join(DATA_DIR, 'trimmed.json');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const [cmd, arg] = process.argv.slice(2);
const out = (o) => console.log(JSON.stringify(o, null, 2));
const ref = parseRef(arg);
const isTranslation = ref.lang !== 'en';
const TRANSLATION_LANGS = Object.keys(SITE.locales ?? {}).filter((l) => l !== (SITE.defaultLocale ?? 'en'));
/** The translation named by '<lang>/<slug>', or an error that says where it should be. */
function translationFor(r) {
  if (!TRANSLATION_LANGS.includes(r.lang)) throw new Error(`"${r.lang}" is not a translation locale (site.config.json locales: ${TRANSLATION_LANGS.join(', ')})`);
  const post = readPost(r.lang, r.slug);
  if (!post) throw new Error(`No translation src/content/blog/${r.lang}/${r.slug}.md`);
  return post;
}
const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function itemFor(slug) {
  const queue = loadQueue();
  const post = listPosts().find((p) => p.slug === slug);
  const item = queue.find((q) => q.slug === slug) ?? (post && queue.find((q) => q.keyword === post.data.keyword));
  return { queue, post, item };
}

if (cmd === 'status') {
  const state = loadState();
  const now = localNow();
  const start = state.startDate ?? now.date;
  const q = quotaFor(now.date, start);
  const today = state.published.filter((p) => p.date === now.date).length;
  out({
    today: now.date,
    scheduleStart: start,
    week: q.week,
    phase: q.phase,
    quotaToday: q.quota,
    publishedToday: today,
    remainingToday: Math.max(0, q.quota - today),
    pendingKeywords: loadQueue().filter((k) => k.status === 'pending').length,
  });
} else if (cmd === 'slots') {
  // Today's posts go live at random times; use these as pubDate. The hourly
  // "Scheduled release" workflow rebuilds the site when each one comes due.
  const state = loadState();
  const now = localNow();
  const q = quotaFor(now.date, state.startDate ?? now.date);
  const done = state.published.filter((p) => p.date === now.date).length;
  // Drop the slot nearest each post already scheduled today, so no two posts share a time.
  const times = releaseTimes(now.date, q.quota);
  const taken = listPosts()
    .filter((p) => state.published.some((x) => x.slug === p.slug && x.date === now.date))
    .map((p) => Date.parse(p.data.pubDate));
  for (const t of taken) {
    if (!times.length) break;
    let best = 0;
    times.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(times[best] - t)) best = i; });
    times.splice(best, 1);
  }
  times.splice(Math.max(0, q.quota - done));
  // A slot that has already passed moves to the first free time from a few minutes from now,
  // still at least minGapMinutes from every other post today, so two posts never share a time.
  const soon = Date.now() + 10 * 60000;
  const gap = (SITE.schedule.releaseWindowLocal?.minGapMinutes ?? 90) * 60000;
  const picked = times.filter((t) => t.getTime() >= soon).map((t) => t.getTime());
  for (const t of times.filter((t) => t.getTime() < soon)) {
    let c = soon;
    while ([...picked, ...taken].some((x) => Math.abs(x - c) < gap)) c += 5 * 60000;
    picked.push(c);
  }
  picked.sort((a, b) => a - b);
  out({ quotaToday: q.quota, publishedToday: done, pubDates: picked.map((t) => new Date(t).toISOString()) });
} else if (cmd === 'set-ahrefs') {
  // Records real Ahrefs metrics on queued keywords: file = [{keyword, volume, kd, trafficPotential?, parentTopic?, date?}]
  // or [{keyword, notInDatabase: true, proxy?: {keyword, volume, kd}}] for phrases Ahrefs doesn't have.
  // A keyword waiting as needs-data goes back to pending (routine.mjs next re-applies the gate).
  const rows = JSON.parse(fs.readFileSync(arg, 'utf8'));
  const queue = loadQueue();
  const byKw = new Map(queue.map((q) => [q.keyword.toLowerCase(), q]));
  const updated = [];
  for (const r of rows) {
    const q = byKw.get(String(r.keyword).toLowerCase());
    if (!q) continue;
    const date = r.date ?? new Date().toISOString().slice(0, 10);
    const source = 'ahrefs keywords-explorer-overview us';
    if (typeof r.volume === 'number') {
      q.ahrefs = { volume: r.volume, kd: typeof r.kd === 'number' ? r.kd : undefined, trafficPotential: r.trafficPotential, parentTopic: r.parentTopic, source, date };
    } else if (r.notInDatabase === true) {
      // Not in Ahrefs' database: keep a proxy (closest broader keyword with real data) if there is one.
      q.ahrefs = { notInDatabase: true, proxy: typeof r.proxy?.volume === 'number' ? r.proxy : undefined, source, date };
    } else continue;
    if (q.status === 'needs-data') {
      q.status = 'pending';
      delete q.lastError;
    }
    updated.push(q.keyword);
  }
  saveQueue(queue);
  out({ updated: updated.length, keywords: updated });
} else if (cmd === 'save-serp') {
  // Saves a US top-10 to data/serps.json (used by the cannibalization guard to compare intent).
  // `save-serp "<keyword>" <urls.json>` (array of URLs) or `save-serp <bulk.json>` ({keyword: {urls, date}}).
  const file = path.join(DATA_DIR, 'serps.json');
  const serps = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const third = process.argv[4];
  const entries = third ? { [arg]: { urls: JSON.parse(fs.readFileSync(third, 'utf8')) } } : JSON.parse(fs.readFileSync(arg, 'utf8'));
  for (const [kw, v] of Object.entries(entries)) {
    const urls = (Array.isArray(v) ? v : v.urls ?? []).slice(0, 10);
    if (urls.length) serps[kw.toLowerCase()] = { date: v.date ?? new Date().toISOString().slice(0, 10), country: v.country ?? 'us', urls };
  }
  fs.writeFileSync(file, JSON.stringify(serps, null, 2) + '\n');
  out({ saved: Object.keys(entries).length, total: Object.keys(serps).length });
} else if (cmd === 'next') {
  // nextKeyword applies keywordGate (Ahrefs data required, volume/KD caps, cannibalization) to the queue.
  const queue = loadQueue();
  const item = nextKeyword(queue, loadState());
  if (item) item.productCount ??= productCountFor(item);
  saveQueue(queue);
  out(item ?? { error: 'queue empty: research keywords first (see ROUTINE.md step 1)' });
} else if (cmd === 'cannibal') {
  out(findCannibal({ keyword: arg }, listPosts()) ?? { ok: true, message: `no existing post targets "${arg}"` });
} else if (cmd === 'links') {
  const { item, post } = itemFor(arg);
  const probe = item ?? { keyword: arg.replace(/-/g, ' '), secondaryKeywords: [], workingTitle: '', cluster: '', category: post?.data.category };
  out(pickLinkTargets(probe, listPosts().filter((p) => p.slug !== arg)));
} else if (cmd === 'add-keywords') {
  const incoming = JSON.parse(fs.readFileSync(arg, 'utf8'));
  const queue = loadQueue();
  const taken = new Set([...queue.map((q) => q.keyword.toLowerCase()), ...listPosts().map((p) => String(p.data.keyword).toLowerCase())]);
  let added = 0;
  for (const k of incoming) {
    const kw = k.keyword.toLowerCase().trim();
    if (taken.has(kw)) continue;
    taken.add(kw);
    queue.push({ status: 'pending', attempts: 0, addedAt: new Date().toISOString(), secondaryKeywords: [], questions: [], priority: 5, ...k, keyword: kw, slug: slugify(kw) });
    added++;
  }
  saveQueue(queue);
  out({ added, pending: queue.filter((q) => q.status === 'pending').length });
} else if (cmd === 'audit' && isTranslation) {
  // The SEO audit scores English entity/n-gram coverage from an English brief, so it only
  // runs on a translation that has its own brief in data/briefs/<lang>/<slug>.json.
  const post = translationFor(ref);
  const briefFile = path.join(BRIEFS, ref.lang, `${ref.slug}.json`);
  if (!fs.existsSync(briefFile)) out({ skipped: true, reason: `no brief for this language (${path.relative(process.cwd(), briefFile)}); the English brief doesn't apply to ${ref.lang} text. QA covers the translation rules.` });
  else {
    const brief = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
    const report = audit({ item: { keyword: post.data.keyword, secondaryKeywords: post.data.secondaryKeywords ?? [], articleType: post.data.articleType }, brief, meta: { title: post.data.title, seoTitle: post.data.seoTitle ?? post.data.title, description: post.data.description }, body: post.content, products: post.data.products ?? [] });
    out({ score: report.score, pass: report.score >= 85, issues: report.issues, metrics: report.metrics });
  }
} else if (cmd === 'audit') {
  const { item, post } = itemFor(arg);
  if (!post) throw new Error(`No post src/content/blog/${arg}.md`);
  const brief = JSON.parse(fs.readFileSync(path.join(BRIEFS, `${arg}.json`), 'utf8'));
  const report = audit({
    item: item ?? { keyword: post.data.keyword, secondaryKeywords: post.data.secondaryKeywords ?? [], articleType: post.data.articleType },
    brief,
    meta: { title: post.data.title, seoTitle: post.data.seoTitle ?? post.data.title, description: post.data.description },
    body: post.content,
    products: post.data.products ?? [],
  });
  out({ score: report.score, pass: report.score >= 85, issues: report.issues, metrics: report.metrics });
} else if (cmd === 'qa' && isTranslation) {
  out(await qaTranslation(translationFor(ref)));
} else if (cmd === 'qa') {
  const post = listPosts().find((p) => p.slug === arg);
  if (!post) throw new Error(`No post src/content/blog/${arg}.md`);
  out(await qaPost(post));
} else if (cmd === 'factcheck') {
  const notes = process.argv.slice(4).join(' ').trim();
  if (notes.length < 20) throw new Error('Describe what you verified (which specs, against which sources).');
  const target = isTranslation ? translationFor(ref) : listPosts().find((p) => p.slug === arg);
  if (!target) throw new Error(`No post src/content/blog/${arg}.md`);
  out(recordFactCheck(ref.id, notes, bodyHash(target.content)));
} else if (cmd === 'finalize' && isTranslation) {
  // Translations reuse the English header graphic and add no backlinks to English posts;
  // finalize records them in data/state.json (translated) and writes data/reports/<lang>/<slug>.json.
  const post = translationFor(ref);
  const qa = readQa(ref.id);
  if (!qa?.pass) throw new Error(`${ref.id} doesn't pass QA yet: run \`node scripts/routine.mjs qa ${ref.id}\``);
  const state = loadState();
  const now = localNow();
  state.translated ??= [];
  if (!state.translated.some((p) => p.id === ref.id)) state.translated.push({ date: now.date, id: ref.id, lang: ref.lang, translationOf: post.data.translationOf, pubDate: new Date(post.data.pubDate).toISOString() });
  saveState(state);
  saveReport(ref.id, { lang: ref.lang, translationOf: post.data.translationOf, keyword: post.data.keyword, createdAt: new Date().toISOString(), via: 'claude-routine', sources: (post.data.sources ?? []).map((x) => x.url) });
  out({ finalized: ref.id, translationOf: post.data.translationOf, pubDate: post.data.pubDate });
} else if (cmd === 'trim-queue') {
  // Owner rule (concise and new): older posts the QA flags as longer than the top results, most padded first.
  const done = readJson(TRIMMED, {});
  const now = Date.now();
  const queue = listPosts()
    .filter((p) => !p.data.draft && Date.parse(p.data.pubDate) <= now && readQa(p.slug)?.pass)
    .filter((p) => !(done[p.slug] && now - Date.parse(done[p.slug].at) < 90 * 86400000))
    .map((p) => ({ slug: p.slug, ...lengthLimit(p), brief: undefined }))
    .filter((x) => x.words > x.limit)
    .map(({ slug, words, limit }) => ({ slug, words, limit, over: Math.round((words / limit - 1) * 100) + '%' }))
    .sort((a, b) => b.words / b.limit - a.words / a.limit);
  out({ perDay: 1, pending: queue.length, queue });
} else if (cmd === 'trimmed') {
  if (!listPosts().some((p) => p.slug === arg)) throw new Error(`no such post: ${arg}`);
  const done = readJson(TRIMMED, {});
  done[arg] = { at: new Date().toISOString(), note: process.argv.slice(4).join(' ') };
  fs.writeFileSync(TRIMMED, JSON.stringify(done, null, 2) + '\n');
  out({ trimmed: arg });
} else if (cmd === 'translate-queue') {
  // English posts that are live and pass QA but have no version (any status) in a language yet.
  const langs = arg ? [arg] : TRANSLATION_LANGS;
  if (arg && !TRANSLATION_LANGS.includes(arg)) throw new Error(`"${arg}" is not a translation locale (${TRANSLATION_LANGS.join(', ')})`);
  const now = Date.now();
  const ready = listPosts()
    .filter((p) => !p.data.draft && Date.parse(p.data.pubDate) <= now && readQa(p.slug)?.pass && (SITE.translations?.categories ?? []).includes(p.data.category))
    .sort((a, b) => Date.parse(a.data.pubDate) - Date.parse(b.data.pubDate));
  const translations = listTranslations();
  const queue = {};
  for (const l of langs) {
    const done = new Set(translations.filter((t) => t.lang === l).map((t) => t.data.translationOf));
    queue[l] = ready.filter((p) => !done.has(p.slug)).map((p) => ({ slug: p.slug, pubDate: new Date(p.data.pubDate).toISOString(), title: p.data.title }));
  }
  out({ backlogPerDay: SITE.translations?.backlogPerDay ?? 2, pending: Object.fromEntries(langs.map((l) => [l, queue[l].length])), queue });
} else if (cmd === 'translate-slots') {
  // Random go-live times for translations of one language: the first a few hours from now
  // (or after the English post's pubDate with --after), each at least 2h after the language's
  // other translations, at most 5 per language per local day (site timezone).
  const lang = arg;
  if (!TRANSLATION_LANGS.includes(lang)) throw new Error(`usage: translate-slots <lang> [--count N] [--after <english-slug>] (lang: ${TRANSLATION_LANGS.join(', ')})`);
  const MAX_PER_DAY = 5;
  const GAP = 2 * 3600000;
  const count = Math.max(1, Number(flag('count') ?? 1));
  const after = flag('after');
  let start = Date.now();
  if (after) {
    const en = listPosts().find((p) => p.slug === after);
    if (!en) throw new Error(`No post src/content/blog/${after}.md`);
    start = Math.max(start, Date.parse(en.data.pubDate));
  }
  const rand = (a, b) => a + Math.random() * (b - a);
  const taken = listTranslations(lang).map((t) => Date.parse(t.data.pubDate)).filter((t) => !Number.isNaN(t));
  const perDay = (t, list) => list.filter((x) => localNow(new Date(x)).date === localNow(new Date(t)).date).length;
  const picked = [];
  let c = start + rand(2, 4) * 3600000;
  for (let guard = 0; picked.length < count && guard < 500; guard++) {
    c = Math.round(c / 300000) * 300000; // whole 5 minutes
    const all = [...taken, ...picked];
    if (all.some((x) => Math.abs(x - c) < GAP) || perDay(c, all) >= MAX_PER_DAY) {
      c += rand(0.5, 1.5) * 3600000;
      continue;
    }
    picked.push(c);
    c += GAP + rand(0, 1.5) * 3600000;
  }
  out({ lang, maxPerDay: MAX_PER_DAY, minGapHours: 2, scheduledToday: perDay(Date.now(), taken), pubDates: picked.map((t) => new Date(t).toISOString()) });
} else if (cmd === 'finalize') {
  const { queue, post, item } = itemFor(arg);
  if (!post) throw new Error(`No post src/content/blog/${arg}.md`);
  await ensureFeatured(post);
  const fresh = listPosts();
  const others = fresh.filter((p) => p.slug !== arg);
  const it = item ?? { keyword: post.data.keyword, secondaryKeywords: post.data.secondaryKeywords ?? [], workingTitle: post.data.title, cluster: '', category: post.data.category };
  const backlinks = addBacklinks({ newSlug: arg, item: it, meta: { entities: post.data.entities ?? [] }, posts: others, isLive: Date.parse(post.data.pubDate) <= Date.now() });

  const state = loadState();
  const now = localNow();
  state.startDate ??= now.date;
  if (!state.published.some((p) => p.slug === arg)) state.published.push({ date: now.date, slug: arg, keyword: it.keyword, category: post.data.category, funnel: post.data.funnel ?? funnelOf({ ...it, articleType: post.data.articleType }) });
  saveState(state);
  if (item) {
    item.status = 'published';
    item.slug = arg;
    item.publishedAt = new Date().toISOString();
    saveQueue(queue);
  }
  const briefFile = path.join(BRIEFS, `${arg}.json`);
  const brief = fs.existsSync(briefFile) ? JSON.parse(fs.readFileSync(briefFile, 'utf8')) : null;
  saveReport(arg, { keyword: it.keyword, createdAt: new Date().toISOString(), via: 'claude-routine', brief, sources: collectSources(post.data.products ?? []), backlinks });
  out({ finalized: arg, backlinks });
} else {
  console.log('usage: node scripts/routine.mjs status|slots|next|cannibal "<kw>"|links <slug>|add-keywords <file>|audit <ref>|qa <ref>|factcheck <ref> "<notes>"|finalize <ref>|translate-queue [lang]|translate-slots <lang> [--count N] [--after <slug>]   (<ref> = <slug> or <lang>/<slug>)');
  process.exitCode = 1;
}
