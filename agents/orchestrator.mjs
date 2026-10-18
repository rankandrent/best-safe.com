// ORCHESTRATOR — the "agentic AI" coordinator.
// goal (today's publishing quota) → keyword agent (keeps the queue full)
//   → product agent → semantic writer → SEO/internal-linking agent → shipped.
//
// Usage:
//   node agents/orchestrator.mjs              publish whatever is due right now
//   node agents/orchestrator.mjs --dry-run    show the plan, call no agents
//   node agents/orchestrator.mjs --force 2    publish 2 posts now, ignoring the schedule
import { fileURLToPath } from 'node:url';
import { SITE, log } from './lib/config.mjs';
import { loadQueue, saveQueue, loadState, saveState, listPosts, postExists, writePost, saveReport } from './lib/store.mjs';
import { localNow, dueNow } from './lib/schedule.mjs';
import { readingTime } from './lib/nlp.mjs';
import { funnelOf, neededStage } from './lib/funnel.mjs';
import { findCannibal } from './lib/cannibal.mjs';
import { runKeywordAgent } from './keyword-agent.mjs';
import { runProductAgent } from './product-agent.mjs';
import { buildBrief, writeDraft } from './writer-agent.mjs';
import { runSeoAgent, pickLinkTargets, addBacklinks } from './seo-agent.mjs';
import { ensureFeatured } from '../scripts/featured-images.mjs';

const AGENT = 'orchestrator';
const MIN_QUEUE = 10;

function parseArgs(argv) {
  const args = { dryRun: argv.includes('--dry-run'), force: null };
  const i = argv.indexOf('--force');
  if (i !== -1) args.force = Number(argv[i + 1] || 1);
  return args;
}

/** Deduplicated citation list from the product agent's research (E-E-A-T). */
export function collectSources(products) {
  const seen = new Set();
  const out = [];
  for (const url of products.flatMap((p) => p.sources || [])) {
    let u;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || /amazon\./.test(u.hostname) || seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ title: u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : ''), url: u.href });
  }
  return out.slice(0, 8);
}

/**
 * Pick the next keyword: first the funnel stage (TOFU/MOFU/BOFU) that is most
 * under its target share in recent posts, then highest priority with category
 * rotation; Ahrefs volume/KD nudge the order.
 */
/**
 * Why a queued keyword may not be written yet, or null when it may. Keywords the site owner
 * supplied (source: 'user') skip these rules. Without recorded Ahrefs volume + KD there is no
 * evidence anyone searches for it, so it waits for data instead of being guessed at.
 */
export function keywordGate(q, posts = listPosts()) {
  const rules = SITE.keywordRules ?? {};
  // Owner keywords skip the caps, but one Ahrefs measured at (almost) no searches is paused.
  const minOwner = rules.minOwnerVolume ?? 10;
  if (q.source === 'user')
    return typeof q.ahrefs?.volume === 'number' && q.ahrefs.volume <= minOwner
      ? { status: 'parked', lastError: `owner keyword paused: Ahrefs volume ${q.ahrefs.volume} (≤ ${minOwner}/mo, no measurable demand)` }
      : null;
  const cap = rules.maxVolume ?? 250;
  const a = q.ahrefs ?? {};
  const measured = typeof a.volume === 'number';
  // Many long-tail phrases are not in Ahrefs' database (not the same as zero searches). Those
  // need a recorded proxy: the closest broader keyword with real Ahrefs volume, checked on its SERP.
  const proxied = a.notInDatabase === true && typeof a.proxy?.volume === 'number' && a.proxy.volume > 0;
  if (rules.requireAhrefs !== false && !measured && !proxied)
    return a.notInDatabase === true
      ? { status: 'needs-data', lastError: 'not in Ahrefs database: record a proxy (closest broader keyword with real volume and a matching SERP) via set-ahrefs, or drop it' }
      : { status: 'needs-data', lastError: 'no Ahrefs data recorded (run keywords-explorer-overview, US) — not selectable until checked' };
  if (measured && a.volume > cap) return { status: 'parked', lastError: `volume ${a.volume} > ${cap} cap` };
  if (measured && typeof rules.maxKd === 'number' && typeof a.kd === 'number' && a.kd > rules.maxKd) return { status: 'parked', lastError: `KD ${a.kd} > ${rules.maxKd} cap` };
  const clash = findCannibal(q, posts);
  if (clash) return { status: 'merged', mergedInto: clash.slug, lastError: `cannibalization: ${clash.reason}` };
  return null;
}

export function nextKeyword(queue, state) {
  const recent = state.published.slice(-6).map((p) => p.category);
  const window = SITE.funnel?.window ?? 10;
  const recentStages = state.published.slice(-window).map((p) => p.funnel ?? 'bofu');
  const posts = listPosts();
  for (const q of queue.filter((k) => k.status === 'pending')) {
    const blocked = keywordGate(q, posts);
    if (blocked) Object.assign(q, blocked);
  }
  const pending = queue.filter((q) => q.status === 'pending');
  const want = neededStage(recentStages);
  // Proven demand first: measured Ahrefs volume, then a measured proxy, then unmeasured keywords.
  const demand = (k) => {
    const a = k.ahrefs ?? {};
    if (typeof a.volume === 'number') return 300 + Math.log10(a.volume + 1) * 5 - (a.kd ?? 20) / 10;
    if (typeof a.proxy?.volume === 'number') return 200 + Math.log10(a.proxy.volume + 1) * 2;
    return 0;
  };
  const score = (k) =>
    demand(k) +
    k.priority -
    recent.filter((c) => c === k.category).length * 1.5 +
    (funnelOf(k) === want ? 4 : 0) +
    (k.source === 'user' ? 100 : 0);
  pending.sort((a, b) => score(b) - score(a));
  return pending[0];
}

async function publishOne(item) {
  const posts = listPosts();
  log(AGENT, `▶ "${item.keyword}" (${item.articleType}, ${item.category})`);

  const products = await runProductAgent(item);
  log(AGENT, `products: ${products.map((p) => p.name).join(' | ')}`);

  const brief = await buildBrief(item);
  log(AGENT, `brief: central entity "${brief.centralEntity}", ${brief.entities.length} entities, ${brief.ngrams.length} n-grams`);

  const linkTargets = pickLinkTargets(item, posts);
  const draft = await writeDraft({ item, brief, products, linkTargets, year: new Date().getFullYear() });
  const { meta, body, report } = await runSeoAgent({ item, brief, draft, products, linkTargets });

  let slug = item.slug;
  if (postExists(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  writePost(
    slug,
    {
      title: meta.title,
      seoTitle: meta.seoTitle,
      description: meta.description,
      pubDate: new Date().toISOString(),
      category: item.category,
      keyword: item.keyword,
      secondaryKeywords: item.secondaryKeywords,
      entities: meta.entities,
      tags: meta.tags,
      articleType: item.articleType,
      funnel: funnelOf(item),
      readingTime: readingTime(body),
      tldr: meta.tldr,
      products: products.map(({ facts, sources, ...p }) => p),
      faqs: meta.faqs,
      author: 'editorial-team',
      reviewedDate: new Date().toISOString().slice(0, 10),
      sources: collectSources(products),
    },
    body,
  );
  const written = listPosts().find((p) => p.slug === slug);
  await ensureFeatured(written);
  const backlinks = addBacklinks({ newSlug: slug, item, meta, posts });
  saveReport(slug, { keyword: item.keyword, createdAt: new Date().toISOString(), brief, products, seo: report, backlinks });
  log(AGENT, `✔ published /blog/${slug}/ (SEO score ${report.score})`);
  return slug;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const state = loadState();
  const now = localNow();
  if (!state.startDate) {
    state.startDate = now.date;
    log(AGENT, `schedule starts today: ${state.startDate}`);
    if (!args.dryRun && process.env.ANTHROPIC_API_KEY) saveState(state);
  }

  const plan = dueNow(now, state.startDate);
  const publishedToday = state.published.filter((p) => p.date === now.date).length;
  const maxPerRun = SITE.schedule.maxPostsPerRun;
  const toPublish = args.force ?? Math.max(0, Math.min(plan.due - publishedToday, maxPerRun));
  log(AGENT, `day ${plan.day + 1} (week ${plan.week}, ${plan.phase}): quota ${plan.quota}, due by ${now.hour}:00 → ${plan.due}, already ${publishedToday}, publishing ${toPublish}`);
  if (args.dryRun || toPublish <= 0) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    log(AGENT, 'ANTHROPIC_API_KEY is not set; add it as a GitHub secret to start publishing. Skipping.');
    return;
  }

  let queue = loadQueue();
  if (queue.filter((q) => q.status === 'pending').length < MIN_QUEUE) {
    try {
      await runKeywordAgent();
    } catch (e) {
      log(AGENT, `keyword agent failed: ${e.message}`);
    }
    queue = loadQueue();
  }

  let done = 0;
  let guard = 0;
  while (done < toPublish && guard++ < toPublish + 3) {
    const item = nextKeyword(queue, state);
    if (!item) {
      log(AGENT, 'queue empty');
      break;
    }
    try {
      const slug = await publishOne(item);
      item.status = 'published';
      item.slug = slug;
      item.publishedAt = new Date().toISOString();
      state.published.push({ date: now.date, slug, keyword: item.keyword, category: item.category, funnel: funnelOf(item) });
      done++;
    } catch (e) {
      item.attempts = (item.attempts || 0) + 1;
      item.lastError = String(e.message).slice(0, 300);
      if (item.attempts >= 2) item.status = 'failed';
      log(AGENT, `✖ "${item.keyword}" failed: ${e.message}`);
    }
    saveQueue(queue);
    saveState(state);
  }
  log(AGENT, `done: ${done}/${toPublish} published`);
  if (done === 0 && toPublish > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
