// Brand taxonomy helpers, shared by the Astro pages and astro.config.mjs.
// Product `brand` values in frontmatter are free text ("K&F Concept",
// "3 Legged Thing", "Kasa (TP-Link)"), so matching ignores case and
// punctuation, treats "&" as "and", and also tries each part of a
// parenthetical variant.
import siteConfig from '../../site.config.json' with { type: 'json' };

export const BRANDS = siteConfig.brands ?? [];

export const normBrand = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');

const keys = new Map();
for (const b of BRANDS) {
  keys.set(normBrand(b.name), b);
  keys.set(normBrand(b.slug.replace(/-/g, ' ')), b);
}

/** The configured brand for a product (by its `brand` field; when that is missing, by a name that starts with a brand), or undefined. */
export function brandOf(product) {
  const raw = product?.brand;
  if (raw) {
    const parts = [raw, raw.replace(/\(.*?\)/g, ''), ...[...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])];
    for (const p of parts) {
      const b = keys.get(normBrand(p));
      if (b) return b;
    }
    return undefined;
  }
  const name = normBrand(product?.name);
  return BRANDS.find((b) => name.startsWith(normBrand(b.name)));
}

/** Unique configured brands present in a list of products, in first-seen order. */
export function brandsIn(products = []) {
  const seen = new Map();
  for (const p of products) {
    const b = brandOf(p);
    if (b && !seen.has(b.slug)) seen.set(b.slug, b);
  }
  return [...seen.values()];
}

/** Same anchor id remark-product-figures gives a product heading. */
export const pickId = (name) => `pick-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
