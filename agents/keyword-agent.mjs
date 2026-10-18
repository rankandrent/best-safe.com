// AGENT 1 — Keyword Research
// Pulls real keyword data from Ahrefs (volume, keyword difficulty, traffic
// potential, parent topic) for this round's seed topics, falling back to Google
// Autocomplete when AHREFS_API_KEY is not set. Claude (with web search for SERP
// checks) then picks low-competition, buyer-intent long-tail keywords, maps
// them to categories/article types, groups them into clusters, and avoids
// cannibalizing existing posts. Results are appended to data/keywords.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { askJson } from './lib/claude.mjs';
import { DATA_DIR, SITE, log } from './lib/config.mjs';
import { loadQueue, saveQueue, listPosts } from './lib/store.mjs';
import { slugify, containsPhrase } from './lib/nlp.mjs';
import { hasAhrefs, matchingTerms, overview } from './lib/ahrefs.mjs';

const AGENT = 'keyword-agent';
const SEEDS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'seeds.json'), 'utf8'));

async function autocomplete(q) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

async function expandSeeds(seeds, modifiers) {
  const out = new Set();
  for (const seed of seeds) {
    for (const m of ['', ...modifiers]) {
      for (const s of await autocomplete(`${seed} ${m}`.trim())) out.add(s.toLowerCase());
    }
  }
  return [...out];
}

const KeywordSchema = z.object({
  keyword: z.string().min(4),
  category: z.enum(SITE.categories.map((c) => c.slug)),
  articleType: z.enum(['roundup', 'review', 'comparison', 'how-to', 'guide']),
  funnel: z.enum(['tofu', 'mofu', 'bofu']),
  intent: z.enum(['commercial', 'transactional', 'informational']),
  secondaryKeywords: z.array(z.string()).max(10),
  questions: z.array(z.string()).max(8),
  workingTitle: z.string(),
  cluster: z.string(),
  priority: z.number().min(1).max(10),
  rationale: z.string(),
});

const MAX_VOL = SITE.keywordRules?.maxVolume ?? 250;
const MAX_KD = SITE.keywordRules?.maxKd ?? 10;

const SYSTEM = `You are the Keyword Research Agent for ${SITE.domain}, a US affiliate site with honest buying guides for safes: handgun and bedside safes, gun safes and gun cabinets, fireproof and document safes, home safes, car and vehicle safes, wall and floor safes, lock boxes, and safe accessories and ammo storage (dehumidifiers, lights, organizers, ammo cans), plus safe how-tos. You think like a senior SEO strategist building topical authority for a NEW site with zero backlinks.

Selection rules:
- Use the KGR mindset (Keyword Golden Ratio = allintitle results ÷ monthly volume; < 0.25 is golden): prefer specific keywords (3-8 words) where few pages target the exact phrase in their title and page one shows forums, Reddit, thin product pages, retailers or low-DR sites. Ahrefs KD is often 0-10 for safe terms even when DR 60-95 publishers rank, so check the SERP before committing. Avoid head terms that big publishers and manufacturers already own.
- Every keyword must have a clear safe-buyer angle: a use case (bedside handgun access, long guns, documents and passports, cash and jewelry, car or truck, apartment), a protection need (fireproof, waterproof, biometric, quick access, hidden, bolt-down), a constraint (small, under $500, under $1000, for apartment) or a real comparison (gun safe vs gun cabinet, biometric vs keypad). Skip retailer, store-location, Black Friday and single-model navigational searches.
- Mix: ~60% commercial (best X for Y, X vs Y, X review), ~40% informational how-to/guides that internally link to commercial pages. Build clusters: a pillar plus supporting posts.
- HARD RULES: monthly volume must be ≤ ${MAX_VOL} and KD ≤ ${MAX_KD} (owner-supplied keywords are the only exception), and never pick a keyword that cannibalizes an existing post or queued keyword. Same search intent or the same Ahrefs parent topic = cannibalization, even if worded differently; add it as a secondary keyword of the existing post instead.
- Use the web_search tool to sanity-check intent and competition for your strongest candidates.
- articleType: roundup = "best X"; comparison = "X vs Y"; review = single product; how-to = step-by-step task; guide = explainer.
- funnel: tofu = awareness/problem questions ("are gun safes fireproof", "how to move a gun safe", "how to bolt a safe to the floor"); mofu = evaluation ("X vs Y", "best safe brands", "is X worth it", "X alternatives"); bofu = ready to buy ("best pistol safe", "best fireproof document safe", "X review"). Keep a healthy mix of roughly 30% tofu, 30% mofu, 40% bofu across the queue, and make tofu/mofu topics that can link down to bofu roundups in the same cluster.`;

export async function runKeywordAgent({ target = 15 } = {}) {
  const queue = loadQueue();
  const posts = listPosts();
  const taken = [...posts.map((p) => p.data.keyword), ...queue.map((q) => q.keyword)].filter(Boolean);

  // Rotate seeds so each run explores different categories.
  const seedPool = Object.entries(SEEDS.categories).flatMap(([cat, seeds]) => seeds.map((s) => ({ cat, s })));
  const offset = (queue.length * 7) % seedPool.length;
  const picked = [...seedPool.slice(offset), ...seedPool.slice(0, offset)].slice(0, 10).map((x) => x.s);
  const isNew = (kw) => !taken.some((t) => containsPhrase(kw, t) || containsPhrase(t, kw));

  // Primary source: Ahrefs keyword database. Fallback: Google Autocomplete.
  let candidates = [];
  if (hasAhrefs()) {
    try {
      candidates = (await matchingTerms(picked, { limit: Number(process.env.AHREFS_ROW_LIMIT || 100), maxVolume: MAX_VOL, maxKd: MAX_KD, minWords: SITE.keywordRules?.minWords ?? 4 })).filter((k) => isNew(k.keyword));
    } catch (e) {
      log(AGENT, `Ahrefs failed, falling back to autocomplete: ${e.message}`);
    }
  }
  const source = candidates.length ? 'ahrefs' : 'autocomplete';
  if (!candidates.length) {
    log(AGENT, `expanding ${picked.length} seeds via autocomplete`);
    candidates = (await expandSeeds(picked, SEEDS.modifiers)).filter(isNew).map((keyword) => ({ keyword }));
  }
  log(AGENT, `${candidates.length} candidate keywords from ${source}`);
  const metrics = new Map(candidates.filter((c) => c.volume !== undefined).map((c) => [c.keyword.toLowerCase(), c]));
  const candidateLines = candidates
    .slice(0, 400)
    .map((c) => (c.volume !== undefined ? `- ${c.keyword} | vol ${c.volume} | KD ${c.kd ?? '?'} | TP ${c.trafficPotential ?? '?'} | parent: ${c.parentTopic ?? '-'}` : `- ${c.keyword}`))
    .join('\n');

  const result = await askJson({
    agent: AGENT,
    system: SYSTEM,
    effort: 'medium',
    webSearch: 6,
    schema: z.object({ keywords: z.array(KeywordSchema).min(1) }),
    prompt: `Pick the best ${target} NEW target keywords for our content calendar.

Candidate keywords collected today from ${source === 'ahrefs' ? 'Ahrefs (US: monthly volume, keyword difficulty 0-100, traffic potential, parent topic)' : 'Google Autocomplete (US)'}:
${candidateLines || '(no data source available; brainstorm from the seed topics)'}

${source === 'ahrefs' ? `How to use the Ahrefs data:
- Prefer KD ≤ 10 and solid traffic potential; a high-TP keyword can target its whole parent topic.
- When several candidates share a parent topic they are ONE article: pick the best one as "keyword" and put the rest in secondaryKeywords.
- Ignore navigational/local junk (store locations, retailer names such as Tractor Supply, Academy, Cabela's or Harbor Freight, Black Friday deals, locksmith services, single-model searches).
- You may choose a keyword not in the list only if it is clearly better; it will be re-checked in Ahrefs.` : ''}

Seed topics this round: ${picked.join('; ')}

Already published or queued (do NOT duplicate these intents):
${taken.map((t) => `- ${t}`).join('\n') || '(none yet)'}

Categories: ${SITE.categories.map((c) => `${c.slug} (${c.name})`).join(', ')}

Return ONLY a \`\`\`json block shaped as:
{"keywords":[{"keyword":"...","category":"<slug>","articleType":"roundup|review|comparison|how-to|guide","funnel":"tofu|mofu|bofu","intent":"commercial|transactional|informational","secondaryKeywords":["close variants and synonyms people search"],"questions":["real People-Also-Ask style questions"],"workingTitle":"...","cluster":"pillar topic name","priority":1-10,"rationale":"one sentence on why it is winnable"}]}`,
  });

  // Attach Ahrefs metrics (re-checking any keyword Claude proposed outside the list).
  if (hasAhrefs()) {
    const missing = result.keywords.map((k) => k.keyword.toLowerCase().trim()).filter((k) => !metrics.has(k));
    try {
      for (const m of await overview(missing)) metrics.set(m.keyword.toLowerCase(), m);
    } catch (e) {
      log(AGENT, `Ahrefs overview failed: ${e.message}`);
    }
  }

  const now = new Date().toISOString();
  let added = 0;
  for (const k of result.keywords) {
    const kw = k.keyword.toLowerCase().trim();
    if (taken.some((t) => t.toLowerCase() === kw)) continue;
    const m = metrics.get(kw);
    const ahrefs = m ? { volume: m.volume, kd: m.kd, trafficPotential: m.trafficPotential } : undefined;
    queue.push({ ...k, keyword: kw, slug: slugify(kw), status: 'pending', attempts: 0, addedAt: now, ...(ahrefs ? { ahrefs } : {}) });
    taken.push(kw);
    added++;
  }
  saveQueue(queue);
  log(AGENT, `added ${added} keywords; queue now ${queue.filter((q) => q.status === 'pending').length} pending`);
  return added;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runKeywordAgent().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
