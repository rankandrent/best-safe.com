// How many products a post features. A random number per post (seeded by the
// slug, so every run agrees) instead of the same count every time:
//   roundups 3-18, comparisons 2-6 (the compared products plus alternatives),
//   reviews 1-4, guides and how-tos 1-6.
import { SITE } from './config.mjs';

const RANGES = { roundup: [3, 18], comparison: [2, 6], review: [1, 4], guide: [1, 6], 'how-to': [1, 6] };

function seeded(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function productCountFor({ slug, articleType }) {
  const [min, max] = SITE.productCounts?.[articleType] ?? RANGES[articleType] ?? [3, 8];
  return min + Math.floor(seeded(`${SITE.domain}:products:${slug}`) * (max - min + 1));
}
