import crypto from 'node:crypto';
// QA agent: reviews a post the way a human QA editor would, before it may go
// live. Every post needs a passing report in data/qa/<slug>.json; the site
// build hides posts without one (see src/lib/posts.ts).
//
// Automatic checks (errors block publishing, warnings don't):
//   facts & claims   no prices, star ratings, review counts or invented testing claims
//   amazon           affiliate tag set, every product linked, product photo matches the product
//   content          required fields, lengths, FAQs, no H1/placeholder text, product sections
//   links            internal links exist and are already live; sources are real https pages
//   seo              audit score >= 85 (data/briefs/<slug>.json), cannibalization warning
//   online (--online, run in CI)  source URLs respond; Amazon listing still returned
// Manual check (recorded with `routine.mjs factcheck`): every product spec and
// claim was verified against the sources; a post can't pass without it.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, SITE } from './lib/config.mjs';
import { listPosts, listTranslations } from './lib/store.mjs';
import { findCannibal } from './lib/cannibal.mjs';
import { audit } from './seo-agent.mjs';
import { matches } from '../src/lib/remark-product-figures.mjs';
import { productMatches } from './lib/product-match.mjs';
import { amazonTag } from '../src/lib/affiliate.mjs';
import { productFor } from '../src/lib/remark-affiliate.mjs';
import { REQUIRED_CRITERIA } from '../src/lib/score.mjs';

export const QA_DIR = path.join(DATA_DIR, 'qa');
const BRIEFS = path.join(DATA_DIR, 'briefs');
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1));
const overlap = (a, b) => {
  const A = words(a), B = words(b);
  return [...A].filter((w) => B.has(w)).length / Math.max(1, A.size);
};
/** Link text like "SentrySafe SFW123GDC" matches the query "SentrySafe SFW123GDC Fireproof Waterproof Safe". */
const linkMatches = (q, p) => Math.max(overlap(q, p.query), overlap(p.query, q), overlap(q, p.name), overlap(p.name, q)) >= 0.5;

// Filler that adds words but no information (owner rule: concise, to-the-point posts).
const FILLER = /\b(in this (article|guide|post|review),? (we|you)('ll| will)|without further ado|let's (dive|jump) (in|into)|in today's (world|fast-paced)|it goes without saying|at the end of the day|look no further|in conclusion|whether you're a (beginner|seasoned)|when it comes to choosing the (best|right))\b/i;
const STOP = new Set('the and for with that this from your you are was were have has its it\'s but not can will into than then they them their there what when which while also more most some such only just very each other about over under after before these those our out'.split(' '));
/** First pair of prose sentences (10+ words) that say almost the same thing, or null. */
export function repeatedSentence(md) {
  const prose = String(md).split('\n').filter((l) => l.trim() && !/^\s*(\||#|>|!\[|<)/.test(l)).join(' ').replace(/\]\([^)]*\)/g, ']');
  const sents = prose.split(/(?<=[.!?])\s+/).map((t) => {
    const w = new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((x) => x.length > 2 && !STOP.has(x)));
    return { t, w };
  }).filter((x) => x.t.split(/\s+/).length >= 10 && x.w.size >= 6);
  for (let i = 0; i < sents.length; i++)
    for (let j = i + 1; j < sents.length; j++) {
      const A = sents[i].w, B = sents[j].w;
      const inter = [...A].filter((x) => B.has(x)).length;
      if (inter / (A.size + B.size - inter) >= 0.7) return sents[j].t;
    }
  return null;
}

/** Body length against the top results: limit = 115% of their average (or of targetWords without one). */
export function lengthLimit(post) {
  let brief = null;
  try { brief = JSON.parse(fs.readFileSync(path.join(BRIEFS, `${post.slug}.json`), 'utf8')); } catch {}
  const avg = brief?.serpStructure?.avgWords;
  const limit = avg ? Math.round(avg * 1.15) : brief?.targetWords ? Math.round(brief.targetWords * 1.15) : post.data.articleType === 'roundup' ? 3000 : 2200;
  return { brief, words: wordCount(post.content ?? post.body ?? ''), avg, limit };
}

const BANNED = [
  // A budget band from the keyword ("under $1,000") is not a product price.
  [/(?<!\b(?:under|below|less than)\s)\$\s?\d/i, 'mentions a price (prices change; never state them)'],
  [/\b\d(\.\d)?\s*(out of 5|\/\s?5|-star|stars?\b)/i, 'mentions a star rating'],
  [/\b\d[\d,]*\s+(customer\s+)?(reviews|ratings)\b/i, 'mentions a review count'],
  [/\b(we|i)\s+(have\s+)?(tested|hands-on tested|bench-?tested|lab-tested)\b/i, 'claims hands-on testing'],
  [/\bin our (tests|testing|lab)\b/i, 'claims hands-on testing'],
  [/\b(after|during)\s+(weeks|months)\s+of\s+(use|testing)\b/i, 'claims long-term use'],
  [/\b(I|we)\s+(bought|purchased|ordered|have been using|installed (it|this|ours|mine) in (my|our))\b/i, 'claims personal ownership (only allowed for stories in data/stories.json)'],
  [/\b(TODO|TBD|lorem ipsum|REPLACE|PUBDATE)\b/, 'placeholder text left in'],
];

// Owner rule for every post and translation: no colon in title or seoTitle, and both carry the exact
// keyword as one phrase (case, punctuation and hyphens ignored; plurals or inserted words don't count).
const normTitle = (s) => String(s ?? '').toLowerCase().normalize('NFC').replace(/[-‐–—]/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export function titleRules(d) {
  const problems = [];
  for (const k of ['title', 'seoTitle']) {
    if (!d[k]) continue;
    if (d[k].includes(':')) problems.push(`${k} contains a colon; use " – " or parentheses instead`);
    if (d.keyword && !normTitle(d[k]).includes(normTitle(d.keyword))) problems.push(`${k} doesn't contain the exact keyword "${d.keyword}"`);
  }
  // Owner rule (best-safe.com): the meta title is the keyword and nothing else.
  if (d.seoTitle && d.keyword && normTitle(d.seoTitle) !== normTitle(d.keyword)) problems.push(`seoTitle must be exactly the keyword "${d.keyword}" (title case), nothing else`);
  return problems;
}

export function readQa(slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(QA_DIR, `${slug}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function writeQa(slug, report) {
  // Translations use their id '<lang>/<slug>', so the report lands in data/qa/<lang>/<slug>.json.
  fs.mkdirSync(path.dirname(path.join(QA_DIR, `${slug}.json`)), { recursive: true });
  const prev = readQa(slug);
  const same = prev && JSON.stringify([prev.pass, prev.errors, prev.warnings, prev.factCheck]) === JSON.stringify([report.pass, report.errors, report.warnings, report.factCheck]);
  // Keep the file byte-identical when nothing changed, so daily CI runs don't commit noise.
  if (same) return prev;
  fs.writeFileSync(path.join(QA_DIR, `${slug}.json`), JSON.stringify(report, null, 2) + '\n');
  return report;
}

async function urlOk(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (res.status === 405 || res.status === 403) res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return res.status;
  } catch {
    return 0;
  }
}

/** Run every check on one post. `online` adds network checks (CI only). */
/**
 * Owner rule (media and numbers): posts without product photos need at least 2
 * AI illustrations, and every post backs its numbers with a link on the number
 * itself to the page it came from. Errors before the post goes live, warnings
 * after (older posts get fixed in the backlog). A video is asked for, not required.
 */
export function mediaRules(d, body, { pub, err, warn, info = !(d.products ?? []).length }) {
  const strict = !(pub <= Date.now());
  const must = (m) => (strict ? err(m) : warn(m));
  const h2 = (body.match(/^## /gm) ?? []).length;
  const ill = d.illustrations ?? [];
  if (info && ill.length < 2) must(`${ill.length} AI illustrations; a post without product photos needs at least 2 (frontmatter illustrations: prompt, alt, afterHeading)`);
  for (const [i, x] of ill.entries()) {
    if (String(x.prompt ?? '').split(/\s+/).length < 8) err(`illustration ${i + 1}: prompt too short; describe the scene in at least 8 words`);
    if (!x.alt) err(`illustration ${i + 1}: missing alt text`);
    if (!(x.afterHeading >= 1 && x.afterHeading <= h2)) err(`illustration ${i + 1}: afterHeading ${x.afterHeading} is not one of the ${h2} H2 sections`);
    if (!x.src) warn(`illustration ${i + 1} not generated yet (launch-site.yml in the RentersmartHome repo generates it at deploy time)`);
  }
  if (new Set(ill.map((x) => x.afterHeading)).size < ill.length) err('two illustrations share one afterHeading; spread them over different sections');
  const videos = d.videos ?? [];
  for (const v of videos) if (!(v.afterHeading >= 1 && v.afterHeading <= h2)) err(`video ${v.id}: afterHeading ${v.afterHeading} is not one of the ${h2} H2 sections`);
  // External links (owner rule 2026-10-21): at most 3 outside links in the body, usually 2; more only rarely.
  const extAll = [...body.matchAll(/(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[2]).filter((u) => !/amazon\.|amzn\./i.test(u));
  const extDistinct = new Set(extAll);
  if (extDistinct.size > 3) must(`${extDistinct.size} different outside links in the text (owner rule: at most 3, usually 2; keep only the strongest stat sources and write the rest as plain text)`);
  if (info && !videos.length) warn('no YouTube video; embed one that shows the task when a good one exists (frontmatter videos: id, afterHeading)');
  const statLinks = [...body.matchAll(/\[([^\]]*\d[^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].filter((m) => !/amazon\.|amzn\./i.test(m[2]));
  const need = info ? 2 : 1;
  if (statLinks.length < need) must(`${statLinks.length} sourced numbers; put at least ${need} statistic${need > 1 ? 's' : ''} in the text with the number itself linked to the page it comes from, e.g. [about 1,000 lb](https://maker-spec-page)`);
}

export async function qaPost(post, { posts = listPosts(), online = false, live = null } = {}) {
  const d = post.data;
  const body = post.content;
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const now = Date.now();
  const pub = Date.parse(d.pubDate);

  // --- Content and required fields
  if (!d.title) err('missing title');
  if ((d.seoTitle ?? d.title ?? '').length > 65) err(`seoTitle is ${(d.seoTitle ?? d.title).length} characters (max 65)`);
  const desc = (d.description ?? '').trim();
  if (desc.length < 110 || desc.length > 170) err(`description is ${desc.length} characters (aim for 140-160)`);
  if (!d.keyword) err('missing keyword');
  for (const p of titleRules(d)) err(p);
  if (!SITE.categories.some((c) => c.slug === d.category)) err(`unknown category "${d.category}"`);
  const author = d.author ?? SITE.authors[0].slug;
  if (!SITE.authors.some((a) => a.slug === author)) err(`unknown author "${author}"`);
  if (Number.isNaN(pub)) err('pubDate is missing or invalid');
  if (!d.reviewedDate) err('missing reviewedDate');
  else if (now - Date.parse(d.reviewedDate) > 180 * 86400000) warn('reviewedDate is over 6 months old; re-check facts and products');
  const faqs = d.faqs ?? [];
  if (faqs.length < 3 || faqs.length > 8) err(`${faqs.length} FAQs (need 3-8)`);
  if (!(d.tldr ?? []).length) err('missing tldr (short answer)');
  if (/^# /m.test(body)) err('body has an H1; the title is the only H1');
  if (/^##\s+(faq|frequently asked)/im.test(body)) err('body has its own FAQ section; FAQs belong in frontmatter');

  // --- Voice: first person and a personal story block (posts written after the rule existed)
  if (pub >= Date.parse(SITE.qa?.voiceRequiredFrom ?? '2100-01-01')) {
    const firstPerson = (body.match(/\b(I|I'd|I'm|I've|my|me|we|we'd|we're|we've|our|us)\b/g) ?? []).length;
    if (firstPerson < 10) err(`only ${firstPerson} first-person words (I, my, me, we, our, us); use at least 10`);
    if (!/^>\s*\*\*From our notes:\*\*/m.test(body)) err('missing the "> **From our notes:**" personal story block');
    // Owner rule 2026-10-23: the whole post, product write-ups included, reads in first person (I, my, me, we, our, us).
    // Posts going live from 2026-10-24 must meet it; older posts get a warning until they are next improved.
    {
      const fpOf = (s) => (String(s ?? '').match(/\b(I|I'd|I'm|I've|I'll|my|me|we|we'd|we're|we've|our|us)\b/g) ?? []).length;
      const fpFlag = pub >= Date.parse('2026-10-24T00:00:00Z') ? err : warn;
      const need = Math.max(10, Math.round(body.split(/\s+/).filter(Boolean).length / 100));
      if (firstPerson < need) fpFlag(`only ${firstPerson} first-person words; owner rule wants at least ${need} (about 1 per 100 words: I, my, me, we, our, us)`);
      const thirdPerson = (d.products ?? []).filter((x) => !fpOf(`${x.summary ?? ''} ${x.scoreNote ?? ''}`)).map((x) => x.name);
      if (thirdPerson.length) fpFlag(`product write-ups not in first person (summary/scoreNote need I/my/we/our, e.g. "I picked it because…"): ${thirdPerson.join('; ')}`);
    }
  }

  // Patent rule 2026-10-23 (US11354342B2 + Google reviews guidance): picks are justified by our own analysis, not other publishers' picks.
  {
    const publisherNames = /\b(Wirecutter|Consumer Reports|RTINGS|CNET|Wired|Tom's Guide|PCMag|TechRadar|The Verge|Engadget|Good Housekeeping|The Strategist|TechGearLab|Business Insider|Popular Mechanics)\b/g;
    const first150 = body.replace(/\]\([^)]*\)/g, ']').split(/\s+/).slice(0, 150).join(' ');
    const early = first150.match(publisherNames) ?? [];
    const all = body.match(publisherNames) ?? [];
    if (early.length) warn(`review publisher named in the first 150 words (${[...new Set(early)].join(', ')}): lead with our own reason, mention others only in "How we picked"`);
    if (all.length > 3) warn(`review publishers named ${all.length} times: justify picks by specs and owner facts, name other publishers at most once`);
  }

  // Patent rules 2026-10-24: US7716225B1 (reasonable surfer: early, in-context links count most) and
  // US9767157B2 (site quality predicted from phrases repeated across the site's pages).
  {
    const words = body.split(/\s+/);
    const firstThird = words.slice(0, Math.ceil(words.length / 3)).join(' ');
    if (!/\]\(\/blog\//.test(firstThird)) warn('no internal /blog/ link in the first third of the body: put one in running text in the intro or first two H2 sections');
    const opener = (body.match(/^>\s*\*\*From our notes:\*\*\s*(.+)$/m)?.[1] ?? '').replace(/[^A-Za-z0-9 ]/g, '').toLowerCase().split(/\s+/).slice(0, 6).join(' ');
    if (/^when we lined up/.test(opener)) warn('"From our notes" opens with the repeated "When we lined up…": start with this post’s own product, number or situation');
    else if (opener.split(' ').length === 6) {
      const blogDir = path.join(DATA_DIR, '..', 'src/content/blog');
      const same = fs.readdirSync(blogDir).filter((f) => f.endsWith('.md') && f !== `${post.slug}.md`).some((f) => {
        const o = (fs.readFileSync(path.join(blogDir, f), 'utf8').match(/^>\s*\*\*From our notes:\*\*\s*(.+)$/m)?.[1] ?? '').replace(/[^A-Za-z0-9 ]/g, '').toLowerCase().split(/\s+/).slice(0, 6).join(' ');
        return o === opener;
      });
      if (same) warn('"From our notes" opens with the same 6 words as another post: make the first sentence specific to this post');
    }
  }

  // --- Style: locked "we" voice and no entity stuffing (errors from styleRequiredFrom, warnings before)
  {
    const strict = pub >= Date.parse(SITE.qa?.styleRequiredFrom ?? '2100-01-01');
    const flag = strict ? err : warn;
    // Link targets are URLs, not prose: a slug like /blog/...-for-my-height/ is not first-person voice.
    const voiceText = body.replace(/\]\([^)]*\)/g, ']');
    const quotedOut = voiceText.replace(/“[^”]*”|"[^"\n]*"/g, ' '); // a real person's quoted words may say I/my/me
    const singular = (quotedOut.match(/\b(I|I'd|I'm|I've|I'll|my|me)\b/g) ?? []).length;
    // Owner rule 2026-10-23: first person singular (I, my, me) is welcome too, so `singular` is no longer flagged.
    void singular;
    const words = body.split(/\s+/).filter(Boolean).length;
    const cap = Math.max(10, Math.round((words / 3000) * 10));
    for (const p of d.products ?? []) {
      const name = String(p.name ?? '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
      if (name.split(/\s+/).length < 2) continue;
      const n = body.split(name).length - 1;
      if (n > cap) flag(`"${name}" appears ${n} times (cap ${cap} for ${words} words): rotate pronouns, short and attribute forms`);
    }
  }

  // --- Structure follows the top search results (posts written after the rule existed)
  if (pub >= Date.parse(SITE.qa?.voiceRequiredFrom ?? '2100-01-01')) {
    let brief = null;
    try { brief = JSON.parse(fs.readFileSync(path.join(BRIEFS, `${post.slug}.json`), 'utf8')); } catch {}
    const serp = brief?.serpStructure;
    if (!serp || (serp.analyzedUrls ?? []).length < 3) err('brief has no serpStructure from at least 3 top results (see ROUTINE.md step 4)');
    else if (d.productStyle !== serp.productStyle) err(`productStyle "${d.productStyle ?? 'pros-cons'}" doesn't match the top results ("${serp.productStyle}")`);
    // Titles follow the live SERP: the brief records the top-10 titles and the seoTitle must not copy one.
    if (pub >= Date.parse(SITE.qa?.serpTitlesRequiredFrom ?? '2100-01-01')) {
      const titles = brief?.serpTitles ?? [];
      if (titles.length < 5 || !brief?.titlePattern) err('brief has no serpTitles (top-10 titles, at least 5) and titlePattern: check the keyword SERP before writing the title (ROUTINE.md step 4)');
      const mine = normTitle(d.seoTitle ?? d.title);
      // Owner rule 2026-10-19: seoTitle is exactly the keyword, so a top-10 page with the bare keyword as its title is not a copy.
      if (mine !== normTitle(d.keyword ?? '') && titles.some((t) => normTitle(t.title) === mine)) err('seoTitle copies a top-10 title word for word');
    }
    const sections = body.split(/^### /m).slice(1);
    for (const p of d.products ?? []) {
      const sec = sections.find((x) => matches(x.split('\n')[0], p.name));
      if (d.productStyle === 'paragraph' && sec && sec.split(/\s+/).length < 110) err(`paragraph style: the review of "${p.name}" is under ~100 words`);
      if (d.productStyle === 'specs' && Object.keys(p.specs ?? {}).length < 4) err(`specs style: "${p.name}" needs at least 4 spec rows`);
    }
  }

  // --- Concise and new (owner rule): no padding past the top results, no filler, no repeats; new posts
  // also need the brief's commonPoints/ourGain. Errors from conciseRequiredFrom, warnings for older posts.
  {
    const strict = pub >= Date.parse(SITE.qa?.conciseRequiredFrom ?? '2100-01-01');
    const flag = strict ? err : warn;
    const { brief, words: n, avg, limit } = lengthLimit(post);
    if (n > limit) flag(`body has ${n} words, over the ${limit} limit (${avg ? `top results average ${avg}` : 'no SERP average in the brief'}): cut repetition and filler`);
    if (strict && ((brief?.commonPoints ?? []).length < 3 || (brief?.ourGain ?? []).length < 3)) err('brief needs commonPoints (3+) and ourGain (3+): what the top results all say, and what this post adds (ROUTINE.md step 4)');
    const filler = body.match(FILLER);
    if (filler) flag(`filler phrase "${filler[0]}": say it directly or cut it`);
    const twice = repeatedSentence(body);
    if (twice) flag(`a sentence repeats an earlier one almost word for word: "${twice.slice(0, 90)}"`);
  }

  // --- Facts and claims
  const text = [d.title, d.description, ...(d.tldr ?? []), body, ...faqs.flatMap((f) => [f.q, f.a]),
    ...(d.products ?? []).flatMap((p) => [p.summary, p.renterNote, ...(p.pros ?? []), ...(p.cons ?? [])])].join('\n');
  for (const [re, why] of BANNED) {
    // Ownership wording is fine when the post tells a real owner story (data/stories.json).
    if (d.ownerStory && /personal ownership/.test(why)) continue;
    const m = text.match(re);
    if (m) err(`${why}: "${m[0]}"`);
  }

  // --- Sources
  const sources = d.sources ?? [];
  if (sources.length < 2) err(`${sources.length} sources (need at least 2)`);
  for (const s of sources) {
    if (!/^https:\/\//.test(s.url ?? '')) err(`source is not an https URL: ${s.url}`);
    if (/amazon\.|amzn\./i.test(s.url ?? '')) err(`source is an Amazon page: ${s.url}`);
  }

  // --- Amazon and products
  if (/REPLACE/.test(amazonTag())) err('Amazon affiliate tag is not configured');
  const products = d.products ?? [];
  if (d.articleType === 'roundup' && products.length < 2) err('roundup with fewer than 2 products');
  if (d.productCount && products.length !== d.productCount) warn(`features ${products.length} products; the plan for this post was ${d.productCount}`);
  const amznLinks = [...body.matchAll(/\]\(amzn:([^)]*)\)/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, ' ')));
  const h3s = [...body.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1]);
  for (const [i, p] of products.entries()) if (p.asin && products.findIndex((x) => x.asin === p.asin) !== i) err(`products "${products.find((x) => x.asin === p.asin).name}" and "${p.name}" share ASIN ${p.asin}: each product needs its own listing`);
  const ownersFrom = Date.parse(SITE.qa?.ownersRequiredFrom ?? '2100-01-01');
  for (const p of products) {
    if (p.owners) {
      const o = p.owners;
      if (!(o.read >= 1) && !(o.sources ?? []).some((s) => s.reviews > 0)) err(`"${p.name}": owners need reviews actually read (owners.read) or a retailer review count`);
      for (const s of o.sources ?? []) if (/amazon\.|amzn\./i.test(s.url ?? '')) err(`"${p.name}": owner source is an Amazon page (summarize owners from other sites): ${s.url}`);
      if (!(o.complaints ?? []).length) err(`"${p.name}": owners need at least one real complaint`);
    } else if (pub >= ownersFrom) err(`"${p.name}" has no owners research (what real owners praise and complain about; ROUTINE.md step 3b)`);
    const label = `product "${p.name}"`;
    if (!p.badge || !p.summary || !p.renterNote || !p.query) err(`${label} is missing badge, summary, renterNote ("Who it's for") or query`);
    if ((p.pros ?? []).length < 2) err(`${label} needs at least 2 pros ("What we like")`);
    if ((p.cons ?? []).length < 1) err(`${label} needs at least 1 con ("What we don't like")`);
    if (pub >= Date.parse(SITE.qa?.voiceRequiredFrom ?? '2100-01-01')) {
      const sc = p.scores ?? {};
      // fire is optional (car safes, lock boxes and accessories often have no fire rating to score).
      const missingScores = REQUIRED_CRITERIA.filter((k) => typeof sc[k] !== 'number');
      if (missingScores.length) err(`${label} needs ${SITE.name} scores (missing ${missingScores.join(', ')}; see /how-we-score/)`);
      if (!p.scoreNote) err(`${label} needs a scoreNote explaining its scores`);
    }
    if (!amznLinks.some((q) => linkMatches(q, p))) err(`${label} has no Amazon link in the body`);
    if (!h3s.some((h) => matches(h, p.name))) warn(`${label} has no "### ${p.name}: ..." section, so it gets a card instead`);
    if (!p.image?.url) warn(`${label} has no Amazon photo yet (the Amazon refresh adds it after push)`);
    if (p.asin && p.amazonTitle && !p.asinVerified) {
      const m = productMatches(p.matchName ?? p.name, p.amazonTitle, p.brand);
      if (!m.ok) err(`${label} is linked to a different Amazon listing ("${p.amazonTitle.slice(0, 80)}"${m.accessory ? `, an accessory` : `, missing ${m.missing.join(', ')}`}); clear its asin so the refresh re-matches it`);
    }
  }
  for (const q of amznLinks) {
    if (products.length && !products.some((p) => linkMatches(q, p))) {
      warn(`Amazon link "${q}" doesn't match any listed product`);
    }
  }

  // --- Internal links
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  for (const m of body.matchAll(/\]\(\/blog\/([^)/#]+)\/?[^)]*\)/g)) {
    const target = bySlug.get(m[1]);
    if (!target) err(`internal link to missing post /blog/${m[1]}/`);
    else if (Date.parse(target.data.pubDate) > Math.max(pub, now)) err(`internal link to /blog/${m[1]}/, which isn't live until ${target.data.pubDate}`);
  }
  const internal = [...body.matchAll(/\]\(\/(blog\/[^)]+|safe-buying-checklist\/)\)/g)].length;
  if (internal < 2) warn(`only ${internal} internal links (aim for 3-5)`);

  // --- Media and sourced numbers
  mediaRules(d, body, { pub, err, warn });

  // --- SEO
  const briefFile = path.join(BRIEFS, `${post.slug}.json`);
  const briefData = fs.existsSync(briefFile) ? JSON.parse(fs.readFileSync(briefFile, 'utf8')) : null;
  // Older posts may have a brief holding only serpTitles/titlePattern; the audit needs a full semantic brief.
  if (briefData?.entities) {
    const brief = briefData;
    const r = audit({
      item: { keyword: d.keyword, secondaryKeywords: d.secondaryKeywords ?? [], articleType: d.articleType },
      brief,
      meta: { title: d.title, seoTitle: d.seoTitle ?? d.title, description: d.description },
      body,
      products,
    });
    if (r.score < 85) err(`SEO audit score ${r.score} (< 85): ${r.issues.join(' | ')}`);
  } else warn('no semantic brief (data/briefs), SEO audit skipped');
  const clash = findCannibal({ keyword: d.keyword }, posts.filter((p) => p.slug !== post.slug));
  if (clash) warn(`keyword overlaps /blog/${clash.slug}/ (${clash.reason})`);

  // --- Online checks (CI)
  if (online) {
    for (const s of sources) {
      const status = await urlOk(s.url);
      // A dead source on a post that is already live is flagged for the daily fact-check instead of
      // hiding the post; before it goes live it still blocks publishing.
      if (status === 404 || status === 410) (pub <= now ? warn : err)(`${pub <= now ? 'LIVE POST, FIX: ' : ''}source returns ${status}: ${s.url}`);
      else if (status === 0 || status >= 400) warn(`source didn't respond normally (${status || 'no response'}): ${s.url}`);
    }
    if (live) {
      for (const p of products) if (p.asin && !live.has(p.asin)) warn(`product "${p.name}" (${p.asin}) is no longer returned by Amazon`);
    }
  }

  const prev = readQa(post.slug);
  const factCheck = prev?.factCheck ?? { verified: false };
  if (factCheck.verified && factCheck.hash && factCheck.hash !== bodyHash(body)) err('the text changed after the fact check: verify the new text and run `node scripts/routine.mjs factcheck <slug> "<notes>"` again');
  else if (!factCheck.verified) err('facts not verified yet: check every product spec and claim against the sources, then run `node scripts/routine.mjs factcheck <slug> "<notes>"`');

  // A post that is already live stays up when a later check finds a problem
  // (removing it would 404); the problem is reported as a warning to fix.
  // Posts published before the QA agent existed count as live too.
  const legacy = pub < Date.parse(SITE.qa?.requiredFrom ?? 0);
  const isLive = legacy || (pub <= now - 24 * 3600000 && prev?.pass);
  const blocking = isLive ? [] : errors;
  if (isLive) warnings.unshift(...errors.map((e) => `LIVE POST, FIX: ${e}`));
  const report = { slug: post.slug, pass: blocking.length === 0, checkedAt: new Date().toISOString(), errors: blocking, warnings, factCheck };
  return writeQa(post.slug, report);
}

/** Record the manual fact check (done by the routine's writer with web research). */
/** Hash of a post's body: a fact check covers exactly the text it read (frontmatter refreshes don't void it). */
export const bodyHash = (md) => crypto.createHash('sha256').update(String(md).trim()).digest('hex').slice(0, 16);

export function recordFactCheck(slug, notes, hash) {
  const prev = readQa(slug) ?? { slug, pass: false, errors: [], warnings: [] };
  prev.factCheck = { verified: true, notes, at: new Date().toISOString(), ...(hash ? { hash } : {}) };
  fs.mkdirSync(path.dirname(path.join(QA_DIR, `${slug}.json`)), { recursive: true });
  fs.writeFileSync(path.join(QA_DIR, `${slug}.json`), JSON.stringify(prev, null, 2) + '\n');
  return prev.factCheck;
}

// ---------------------------------------------------------------------------
// Translations (src/content/blog/<lang>/<slug>.md, report data/qa/<lang>/<slug>.json)
//
// A translation localizes an English post that already passes QA. It may not add
// facts, products or sources: products keep the English ASINs (OneLink sends
// readers to their local Amazon), sources and owner sources are the English URLs,
// and the text never names a local Amazon store, a price or a currency.

// Letters-only word boundaries (JS \b is ASCII-only, so it breaks on ä, ñ, ...).
const W = (src) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'iu');

/** Per-language rules: first-person words, story block label, negations and banned claims. */
export const LOCALE_QA = {
  de: {
    notes: 'Aus unseren Notizen',
    faqHeading: /^##\s+(faq|häufige fragen|häufig gestellte fragen)/im,
    firstPerson: W('ich|mich|mir|mein|meine|meinen|meinem|meiner|meines|wir|uns|unser|unsere|unseren|unserem|unserer|unseres'),
    negation: W('nicht|nie|niemals|kein|keine|keinen|keinem|keiner|nichts|ohne'),
    claims: [
      // A fire or burglary rating tested by an independent lab ("von UL getestet") is not our own testing claim.
      [W(`(?<!(?:UL|Intertek|ETL)[\\s-]+(?:\\p{L}+\\s+)?)getestet(?!\\s+(?:von|durch)\\s+(?:UL|Intertek|ETL))|ausprobiert|testsieger|in unseren tests|im praxistest|unser test`), 'claims hands-on testing'],
      [W('(ich|wir)\\s+(habe|haben)\\s+[^.!?\\n]{0,40}(gekauft|bestellt)'), 'claims personal ownership (only allowed for stories in data/stories.json)'],
      [W('nach\\s+(wochen|monaten)\\s+(der\\s+)?(nutzung|im einsatz|tests?)'), 'claims long-term use'],
      [/\d([.,]\d)?\s*(von 5|\/\s?5|sterne?n?\b)/iu, 'mentions a star rating'],
      [/\d[\d.,]*\s+(kundenbewertungen|bewertungen|rezensionen)/iu, 'mentions a review count'],
    ],
  },
  es: {
    notes: 'De nuestras notas',
    faqHeading: /^##\s+(faq|preguntas frecuentes)/im,
    firstPerson: W('yo|me|mi|mis|nosotros|nosotras|nos|nuestro|nuestra|nuestros|nuestras|he|hemos|creo|creemos|recomiendo|recomendamos'),
    negation: W('no|nunca|jamás|sin|ningún|ninguna|ninguno'),
    claims: [
      [W(`(?<!(?:UL|Intertek|ETL)[\\s-]+(?:\\p{L}+\\s+)?)(?:probad[oa]s?|testead[oa]s?)(?!\\s+(?:por|según)\\s+(?:UL|Intertek|ETL))|en nuestras pruebas|nuestra prueba`), 'claims hands-on testing'],
      [W('(he|hemos)\\s+(comprado|pedido|instalado\\s+(el|la|lo|los|las)\\s+en\\s+(mi|nuestro|nuestra))'), 'claims personal ownership (only allowed for stories in data/stories.json)'],
      [W('(tras|después de|durante)\\s+(semanas|meses)\\s+de\\s+(uso|pruebas)'), 'claims long-term use'],
      [/\d([.,]\d)?\s*(de 5|sobre 5|\/\s?5|estrellas?\b)/iu, 'mentions a star rating'],
      [/\d[\d.,]*\s+(reseñas|opiniones|valoraciones|calificaciones)/iu, 'mentions a review count'],
    ],
  },
  nl: {
    notes: 'Uit onze notities',
    faqHeading: /^##\s+(faq|veelgestelde vragen|veel gestelde vragen)/im,
    firstPerson: W('ik|mij|me|mijn|wij|we|ons|onze'),
    negation: W('niet|nooit|geen|zonder|niets'),
    claims: [
      [W(`(?<!(?:UL|Intertek|ETL)[\\s-]+(?:\\p{L}+\\s+)?)getest(?!\\s+(?:door|volgens)\\s+(?:UL|Intertek|ETL))|uitgeprobeerd|testwinnaar|in onze tests?`), 'claims hands-on testing'],
      [W('(ik|we|wij)\\s+(heb|hebben)\\s+[^.!?\\n]{0,40}(gekocht|besteld)'), 'claims personal ownership (only allowed for stories in data/stories.json)'],
      [W('na\\s+(weken|maanden)\\s+(gebruik|testen)'), 'claims long-term use'],
      [/\d([.,]\d)?\s*(van de 5|uit 5|op 5|\/\s?5|sterren?\b)/iu, 'mentions a star rating'],
      [/\d[\d.,]*\s+(beoordelingen|reviews|recensies)/iu, 'mentions a review count'],
    ],
  },
};

const TRANSLATION_BANNED = [
  [/[$€£]|(?<![A-Za-z])(EUR|USD|GBP)(?![A-Za-z])|\d\s*(euros?|dollars?|dólares?)(?![\p{L}])/iu, 'mentions a price or currency (prices differ per store; never state them)'],
  [/amazon\.(de|es|nl|fr|it|pl|se|co\.uk|com\.be)(?![a-z])/i, 'names a local Amazon store (links stay amazon.com; OneLink redirects readers)'],
  [/amazon\.[a-z.]+\/s\?|[?&]k=[^&\s)]+/i, 'links an Amazon search page'],
  [/\b(TODO|TBD|lorem ipsum|REPLACE|PUBDATE)\b/, 'placeholder text left in'],
  // English testing/ownership wording copied over untranslated is still a claim.
  ...BANNED.filter(([, why]) => /testing|long-term|ownership/.test(why)),
];

/** Count words of a markdown body (code, link targets and markup stripped). */
const wordCount = (md) =>
  String(md).replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[#>*_`|[\]-]+/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The sentence around a match, for negation checks ("nicht getestet" is fine). */
function sentenceAt(text, index, length) {
  const start = Math.max(...['.', '!', '?', '\n'].map((c) => text.lastIndexOf(c, index - 1))) + 1;
  const ends = ['.', '!', '?', '\n'].map((c) => text.indexOf(c, index + length)).filter((i) => i >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Run every check on one translated post (from listTranslations()). */
export async function qaTranslation(post, { posts = listPosts(), translations = listTranslations(), online = false, live = null } = {}) {
  const d = post.data;
  const body = post.content;
  const id = post.id ?? `${post.lang}/${post.slug}`;
  const lang = post.lang ?? id.split('/')[0];
  const rules = LOCALE_QA[lang];
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const now = Date.now();
  const pub = Date.parse(d.pubDate);

  // --- Language, slug and the English original
  if (!rules) err(`no QA rules for language "${lang}" (add it to LOCALE_QA in agents/qa-agent.mjs)`);
  if (d.lang !== lang) err(`frontmatter lang "${d.lang ?? ''}" doesn't match the folder "${lang}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) err(`slug "${post.slug}" must be lowercase ASCII words joined by hyphens (ue/oe/ae/ss instead of ü/ö/ä/ß, no accents)`);
  const en = posts.find((p) => p.slug === d.translationOf);
  if (!d.translationOf) err('missing translationOf (the English slug this post localizes)');
  else if (!en) err(`translationOf "${d.translationOf}" is not an English post`);
  else {
    const enQa = readQa(en.slug);
    if (!enQa?.pass) err(`English post "${en.slug}" doesn't pass QA, so it can't be translated yet`);
    if (Date.parse(en.data.pubDate) > pub) err(`goes live (${d.pubDate}) before the English post (${en.data.pubDate})`);
  }
  const dupe = translations.find((t) => t.lang === lang && t.slug !== post.slug && t.data.translationOf && t.data.translationOf === d.translationOf);
  if (dupe) err(`${dupe.id} already translates "${d.translationOf}" into ${lang}`);
  if (d.draft) warn('draft: true, the post stays hidden');

  // --- Content and required fields (same limits as English)
  if (!d.title) err('missing title');
  if ((d.seoTitle ?? d.title ?? '').length > 65) err(`seoTitle is ${(d.seoTitle ?? d.title).length} characters (max 65)`);
  const desc = (d.description ?? '').trim();
  if (desc.length < 110 || desc.length > 170) err(`description is ${desc.length} characters (aim for 140-160)`);
  if (!d.keyword) err('missing keyword');
  else if (![d.title, d.seoTitle, d.description].some((x) => String(x ?? '').toLowerCase().includes(String(d.keyword).toLowerCase()))) warn(`keyword "${d.keyword}" appears in neither title, seoTitle nor description`);
  for (const p of titleRules(d)) err(p);
  if (en && d.keyword && String(d.keyword).toLowerCase() === String(en.data.keyword).toLowerCase()) warn('keyword is the English keyword; use the phrase people search in this language');
  if (!SITE.categories.some((c) => c.slug === d.category)) err(`unknown category "${d.category}"`);
  if (en) {
    for (const k of ['category', 'articleType', 'productStyle', 'author', 'ownerStory']) {
      if ((d[k] ?? null) !== (en.data[k] ?? null)) err(`${k} "${d[k] ?? ''}" differs from the English post ("${en.data[k] ?? ''}")`);
    }
  }
  if (Number.isNaN(pub)) err('pubDate is missing or invalid');
  if (!d.reviewedDate) err('missing reviewedDate');
  const faqs = d.faqs ?? [];
  if (faqs.length < 3 || faqs.length > 8) err(`${faqs.length} FAQs (need 3-8)`);
  if (!(d.tldr ?? []).length) err('missing tldr (short answer)');
  if (/^# /m.test(body)) err('body has an H1; the title is the only H1');
  if (rules && rules.faqHeading.test(body)) err('body has its own FAQ section; FAQs belong in frontmatter');
  if (en) {
    const ratio = wordCount(body) / Math.max(1, wordCount(en.content));
    if (ratio < 0.6) err(`body has ${wordCount(body)} words, ${Math.round(ratio * 100)}% of the English post's ${wordCount(en.content)} (need at least 60%)`);
  }

  // --- Voice: first person and the translated "From our notes" block
  if (rules) {
    const firstPerson = (body.match(new RegExp(rules.firstPerson.source, 'giu')) ?? []).length;
    if (firstPerson < 10) err(`only ${firstPerson} first-person words; use at least 10`);
    if (!new RegExp(`^>\\s*\\*\\*${rules.notes}:\\*\\*`, 'm').test(body)) err(`missing the "> **${rules.notes}:**" personal story block (the translated "From our notes")`);
  }

  // --- Facts and claims
  const products = d.products ?? [];
  const text = [d.title, d.seoTitle, d.description, ...(d.tldr ?? []), body, ...faqs.flatMap((f) => [f.q, f.a]),
    ...products.flatMap((p) => [p.badge, p.summary, p.renterNote, p.scoreNote, ...(p.pros ?? []), ...(p.cons ?? []), ...(p.owners?.praise ?? []), ...(p.owners?.complaints ?? [])])].filter(Boolean).join('\n');
  const claimRules = [...(rules?.claims ?? []), ...TRANSLATION_BANNED];
  for (const [re, why] of claimRules) {
    if (d.ownerStory && /personal ownership/.test(why)) continue;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(g)) {
      // "nicht selbst getestet" / "no los hemos probado" / "niet zelf getest" state the opposite.
      if (rules && /testing|ownership|long-term/.test(why) && rules.negation.test(sentenceAt(text, m.index, m[0].length))) continue;
      err(`${why}: "${m[0]}"`);
      break;
    }
  }

  // --- Sources: the same pages as the English post
  const sources = d.sources ?? [];
  if (sources.length < 2) err(`${sources.length} sources (need at least 2)`);
  if (en) {
    const mine = new Set(sources.map((s) => s.url));
    const theirs = new Set((en.data.sources ?? []).map((s) => s.url));
    if (!sameSet(mine, theirs)) err(`sources must be the English post's URLs (added: ${[...mine].filter((u) => !theirs.has(u)).join(', ') || 'none'}; missing: ${[...theirs].filter((u) => !mine.has(u)).join(', ') || 'none'})`);
  }

  // --- Products: the English products with their ASINs, text translated
  if (/REPLACE/.test(amazonTag())) err('Amazon affiliate tag is not configured');
  const enProducts = en?.data.products ?? [];
  if (en && products.length !== enProducts.length) err(`${products.length} products; the English post has ${enProducts.length} (translations keep the same products)`);
  const amzn = [...body.matchAll(/\[([^\]]*)\]\(amzn:([^)]*)\)/g)].map((m) => ({ text: m[1], value: decodeURIComponent(m[2].replace(/\+/g, ' ')).trim() }));
  const ASIN = /^B0[A-Z0-9]{8}$/;
  for (const p of products) {
    const label = `product "${p.name}"`;
    if (!p.asin) { err(`${label} has no asin (translations never link an Amazon search page)`); continue; }
    const ep = enProducts.find((x) => x.asin === p.asin && x.name === p.name) ?? enProducts.find((x) => x.asin === p.asin);
    if (en && !ep) { err(`${label} (${p.asin}) is not in the English post (no new products)`); continue; }
    if (ep) {
      for (const k of ['name', 'brand', 'query', 'amazonTitle', 'matchName']) if ((p[k] ?? null) !== (ep[k] ?? null)) err(`${label}: ${k} must stay as in the English post ("${ep[k] ?? ''}")`);
      if (JSON.stringify(p.scores ?? null) !== JSON.stringify(ep.scores ?? null)) err(`${label}: scores must match the English post`);
      if (JSON.stringify(Object.keys(p.specs ?? {})) !== JSON.stringify(Object.keys(ep.specs ?? {}))) err(`${label}: specs keys must match the English post`);
      if (ep.owners) {
        if (!p.owners) err(`${label}: owners research missing (copy it from the English post and translate praise/complaints)`);
        else {
          if (p.owners.read !== ep.owners.read) err(`${label}: owners.read must stay ${ep.owners.read}`);
          if (!sameSet(new Set((p.owners.sources ?? []).map((s) => s.url)), new Set((ep.owners.sources ?? []).map((s) => s.url)))) err(`${label}: owners.sources must be the English post's URLs`);
          if ((p.owners.praise ?? []).length !== ep.owners.praise.length || (p.owners.complaints ?? []).length !== ep.owners.complaints.length) err(`${label}: translate every owners praise/complaint, no more, no fewer`);
        }
      }
    }
    if (!p.badge || !p.summary || !p.renterNote) err(`${label} is missing badge, summary or renterNote ("Who it's for")`);
    if ((p.pros ?? []).length < 2) err(`${label} needs at least 2 pros`);
    if ((p.cons ?? []).length < 1) err(`${label} needs at least 1 con`);
    if (ep?.scoreNote && !p.scoreNote) err(`${label} needs its scoreNote translated`);
    if (!amzn.some((l) => l.value === p.asin || productFor(l.value, l.text, [p]) === p)) err(`${label} has no Amazon link in the body (use [text](amzn:${p.asin}) or the exact product name)`);
  }
  for (const l of amzn) {
    if (ASIN.test(l.value) ? !products.some((p) => p.asin === l.value) : !productFor(l.value, l.text, products)) err(`Amazon link "${l.value}" doesn't resolve to one of the post's products, so it would become a search link`);
  }

  // --- Internal links: translated posts of this language, or English posts (warned)
  const byId = new Map(translations.map((t) => [t.id, t]));
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  for (const m of body.matchAll(/\]\(\/(?:([a-z]{2})\/)?blog\/([^)/#]+)\/?[^)]*\)/g)) {
    const target = m[1] ? byId.get(`${m[1]}/${m[2]}`) : bySlug.get(m[2]);
    const href = `${m[1] ? `/${m[1]}` : ''}/blog/${m[2]}/`;
    if (m[1] && m[1] !== lang) err(`internal link to another language: ${href}`);
    if (!target) err(`internal link to missing post ${href}`);
    else if (Date.parse(target.data.pubDate) > Math.max(pub, now)) err(`internal link to ${href}, which isn't live until ${target.data.pubDate}`);
    else if (!m[1]) warn(`internal link to the English post ${href}; link the ${lang} version once it exists`);
  }
  for (const r of d.related ?? []) if (!byId.has(r)) err(`related post "${r}" is not a ${lang} translation (use '${lang}/<slug>' ids or leave related empty)`);

  // --- Media and sourced numbers: the English post's illustrations (alt translated) and videos
  mediaRules(d, body, { pub, err, warn, info: !((en?.data.products ?? d.products ?? []).length) });
  if (en) {
    const enIll = en.data.illustrations ?? [];
    if ((d.illustrations ?? []).length !== enIll.length) err(`${(d.illustrations ?? []).length} illustrations; the English post has ${enIll.length} (copy them with translated alt text)`);
    const enVid = (en.data.videos ?? []).map((v) => v.id).sort().join();
    if ((d.videos ?? []).map((v) => v.id).sort().join() !== enVid) warn('videos differ from the English post');
  }

  // --- Online checks (CI): same URLs as English, checked the same way
  if (online) {
    for (const s of sources) {
      const status = await urlOk(s.url);
      if (status === 404 || status === 410) (pub <= now ? warn : err)(`${pub <= now ? 'LIVE POST, FIX: ' : ''}source returns ${status}: ${s.url}`);
      else if (status === 0 || status >= 400) warn(`source didn't respond normally (${status || 'no response'}): ${s.url}`);
    }
    if (live) for (const p of products) if (p.asin && !live.has(p.asin)) warn(`product "${p.name}" (${p.asin}) is no longer returned by Amazon`);
  }

  const prev = readQa(id);
  const factCheck = prev?.factCheck ?? { verified: false };
  if (factCheck.verified && factCheck.hash && factCheck.hash !== bodyHash(body)) err(`the text changed after the fact check: verify the new text and run \`node scripts/routine.mjs factcheck ${id} "<notes>"\` again`);
  else if (!factCheck.verified) err(`facts not verified yet: compare every claim with the English post and its sources, then run \`node scripts/routine.mjs factcheck ${id} "<notes>"\``);

  const isLive = pub <= now - 24 * 3600000 && prev?.pass;
  const blocking = isLive ? [] : errors;
  if (isLive) warnings.unshift(...errors.map((e) => `LIVE POST, FIX: ${e}`));
  const report = { slug: id, lang, translationOf: d.translationOf ?? null, pass: blocking.length === 0, checkedAt: new Date().toISOString(), errors: blocking, warnings, factCheck };
  return writeQa(id, report);
}
