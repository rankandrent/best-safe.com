// Ahrefs API v3 client for the keyword agent (needs AHREFS_API_KEY).
// Docs: https://docs.ahrefs.com/docs/api/reference/introduction
import { log } from './config.mjs';

const BASE = 'https://api.ahrefs.com/v3';
const SELECT = 'keyword,volume,difficulty,traffic_potential,parent_topic';

export const hasAhrefs = () => Boolean(process.env.AHREFS_API_KEY);

async function get(endpoint, params) {
  const url = `${BASE}/${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AHREFS_API_KEY}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Ahrefs ${endpoint} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const normalize = (rows = []) =>
  rows.map((r) => ({
    keyword: r.keyword,
    volume: r.volume ?? 0,
    kd: r.difficulty ?? null,
    trafficPotential: r.traffic_potential ?? null,
    parentTopic: r.parent_topic ?? null,
  }));

/**
 * Low-competition keyword ideas containing the seed terms, filtered to
 * winnable keywords (KD ≤ maxKd, volume ≥ minVolume), highest volume first.
 */
/**
 * KGR-style long-tail filter (Keyword Golden Ratio): 4+ word queries with
 * 10–250 searches/month, KD ≤ maxKd, and at least one weak site (DR ≤ maxWeakDr)
 * already ranking in the top 10, i.e. big sites haven't locked the SERP.
 */
export async function matchingTerms(seeds, { limit = 100, minVolume = 10, maxVolume = 250, maxKd = 10, minWords = 4, maxWeakDr = 30, country = 'us' } = {}) {
  const where = {
    and: [
      { field: 'word_count', is: ['gte', minWords] },
      { field: 'volume', is: ['gte', minVolume] },
      { field: 'volume', is: ['lte', maxVolume] },
      { field: 'difficulty', is: ['lte', maxKd] },
      { field: 'serp_domain_rating_top10_min', is: ['lte', maxWeakDr] },
      { not: { field: 'keyword', is: ['isubstring', 'near me'] } },
      { not: { field: 'keyword', is: ['isubstring', 'rental'] } },
      { not: { field: 'keyword', is: ['isubstring', 'black friday'] } },
      { not: { field: 'keyword', is: ['isubstring', 'for sale'] } },
    ],
  };
  const data = await get('keywords-explorer/matching-terms', {
    country,
    keywords: seeds.join(','),
    terms: 'all',
    select: SELECT,
    where: JSON.stringify(where),
    order_by: 'volume:desc',
    limit: String(limit),
  });
  const rows = normalize(data.keywords);
  log('ahrefs', `matching-terms: ${rows.length} keywords for ${seeds.length} seeds`);
  return rows;
}

/** Top-10 organic results for a keyword (titles + DR) for the KGR title check. */
export async function serpTop10(keyword, { country = 'us' } = {}) {
  const data = await get('serp-overview/serp-overview', { country, keyword, select: 'position,title,url,domain_rating', top_positions: '10', type: 'organic' });
  return data.positions ?? [];
}

/** Volume / KD / traffic potential for an explicit keyword list. */
export async function overview(keywords, { country = 'us' } = {}) {
  if (!keywords.length) return [];
  const data = await get('keywords-explorer/overview', { country, keywords: keywords.join(','), select: SELECT });
  return normalize(data.keywords);
}
