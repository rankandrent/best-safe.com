// Lists the Amazon listings found for every product that still has no ASIN, so the
// right one can be picked (or the product swapped for one Amazon actually sells).
// Runs where the Creators API credentials exist (GitHub Actions); see amazon-refresh.yml.
//   node agents/amazon-candidates.mjs            -> prints and writes data/amazon-unmatched.json
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, log } from './lib/config.mjs';
import { listPosts } from './lib/store.mjs';
import { hasAmazonApi, searchItems } from './lib/amazon.mjs';
import { productMatches } from './lib/product-match.mjs';

export async function amazonCandidates({ write = true } = {}) {
  if (!hasAmazonApi()) return [];
  const out = [];
  for (const post of listPosts()) {
    for (const p of post.data.products ?? []) {
      if (p.asin) continue;
      const queries = [...new Set([p.query, p.matchName, `${p.brand ?? ''} ${p.matchName ?? p.name}`.trim(), p.name].filter(Boolean))].slice(0, 3);
      const seen = new Map();
      for (const q of queries) {
        try {
          for (const it of await searchItems(q, { itemCount: 10 })) if (!seen.has(it.asin)) seen.set(it.asin, it);
        } catch (e) {
          log('amazon-candidates', `${p.name}: ${e.message}`);
        }
      }
      out.push({
        post: post.slug,
        name: p.name,
        brand: p.brand ?? '',
        query: p.query,
        candidates: [...seen.values()].slice(0, 12).map((it) => ({ asin: it.asin, title: it.title.slice(0, 110), strictMatch: productMatches(p.matchName ?? p.name, it.title, p.brand).ok, image: Boolean(it.image) })),
      });
    }
  }
  if (write) fs.writeFileSync(path.join(DATA_DIR, 'amazon-unmatched.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const out = await amazonCandidates();
  console.log(`UNMATCHED ${out.length}`);
  for (const o of out) {
    console.log(`\n## ${o.post} | ${o.name} (query: ${o.query})`);
    for (const c of o.candidates) console.log(`${c.strictMatch ? '*' : ' '} ${c.asin}  ${c.image ? 'img' : '---'}  ${c.title}`);
  }
}
