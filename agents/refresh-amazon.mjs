// Daily Amazon catalog refresh (Creators API).
// - Products with an ASIN: refresh image URL/size (Amazon requires product
//   content shown on the site to be refreshed at least every 24 hours).
// - Products without an ASIN: look up the listing to add ASIN + image.
// Runs from .github/workflows/amazon-refresh.yml.
import { fileURLToPath } from 'node:url';
import { log } from './lib/config.mjs';
import { listPosts, writePost, listTranslations } from './lib/store.mjs';
import { hasAmazonApi, getItems, matchProduct } from './lib/amazon.mjs';
import { amazonCandidates } from './amazon-candidates.mjs';

const AGENT = 'amazon-refresh';

/** Copy the English post's Amazon fields into its translations; returns the number of files changed. */
export function syncTranslations() {
  let changed = 0;
  // Translations carry the same products as their English post: copy the refreshed Amazon
  // fields so they stay identical (translation QA requires it; otherwise the build hides them).
  const english = new Map(listPosts().map((p) => [p.slug, p]));
  for (const t of listTranslations()) {
    const en = english.get(t.data.translationOf);
    if (!en || !(t.data.products || []).length) continue;
    let dirty = false;
    for (const p of t.data.products) {
      const ep = (en.data.products || []).find((x) => x.name === p.name) ?? (en.data.products || []).find((x) => x.asin && x.asin === p.asin);
      if (!ep) continue;
      for (const k of ['asin', 'amazonTitle', 'image', 'gallery']) {
        if (JSON.stringify(p[k] ?? null) !== JSON.stringify(ep[k] ?? null)) {
          if (ep[k] === undefined) delete p[k]; else p[k] = ep[k];
          dirty = true;
        }
      }
    }
    if (dirty) {
      writePost(t.id, t.data, t.content);
      changed++;
    }
  }
  return changed;
}

export async function refreshAmazon() {
  if (!hasAmazonApi()) {
    log(AGENT, 'Creators API credentials or Amazon tag missing; skipping');
    return syncTranslations();
  }
  const posts = listPosts().filter((p) => (p.data.products || []).length);
  const asins = [...new Set(posts.flatMap((p) => p.data.products.map((x) => x.asin).filter(Boolean)))];
  const live = new Map((asins.length ? await getItems(asins) : []).map((i) => [i.asin, i]));
  log(AGENT, `refreshed ${live.size}/${asins.length} ASINs`);

  let changed = 0;
  for (const post of posts) {
    let dirty = false;
    for (const p of post.data.products) {
      try {
        if (p.asin && live.has(p.asin)) {
          const { image, gallery, title } = live.get(p.asin);
          if (JSON.stringify(image) !== JSON.stringify(p.image) || JSON.stringify(gallery ?? []) !== JSON.stringify(p.gallery ?? []) || (title && title !== p.amazonTitle)) {
            p.image = image;
            if (title) p.amazonTitle = title;
            p.gallery = gallery ?? [];
            dirty = true;
          }
        } else if (!p.asin) {
          const hit = await matchProduct(p.matchName ?? p.name, p.query, p.brand);
          if (hit) {
            p.asin = hit.asin;
            p.image = hit.image;
            if (hit.title) p.amazonTitle = hit.title;
            p.gallery = hit.gallery ?? [];
            dirty = true;
          }
        } else if (p.image) {
          // ASIN no longer returned (unavailable): stop showing a stale image.
          delete p.image;
          delete p.gallery;
          dirty = true;
        }
      } catch (e) {
        log(AGENT, `${post.slug} / ${p.name}: ${e.message}`);
      }
    }
    if (dirty) {
      writePost(post.slug, post.data, post.content);
      changed++;
    }
  }
  changed += syncTranslations();
  // Products still without an ASIN link to an Amazon search and have no photo: list the real
  // listings so the next session can pick the right ASIN or swap the product (ROUTINE.md step 3c).
  const left = await amazonCandidates();
  log(AGENT, `${left.length} products still without an ASIN (see data/amazon-unmatched.json)`);
  log(AGENT, `${changed} posts updated`);
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  refreshAmazon().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
