import siteConfig from '../../site.config.json' with { type: 'json' };
import { resolveAmznHref, amazonUrl, AFFILIATE_REL } from './affiliate.mjs';

function walk(node, fn) {
  fn(node);
  if (node.children) for (const child of node.children) walk(child, fn);
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/wi-fi/g, 'wifi').replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((w) => w.length > 1);

/** The post's product a `[text](amzn:Name)` link is about, so it can use that product's own ASIN
 *  instead of an Amazon search page. Exact name/query/matchName first, then the one product whose
 *  words contain every word of the link's name; ambiguous links stay on search. */
export function productFor(value, text, products) {
  const asinned = products.filter((p) => p.asin);
  const key = norm(value);
  const exact = asinned.find((p) => [p.query, p.name, p.matchName].some((x) => x && norm(x) === key));
  if (exact) return exact;
  for (const words of [toks(value), toks(text)]) {
    if (words.length < 2) continue;
    const hits = asinned.filter((p) => {
      const have = new Set(toks(`${p.name} ${p.query} ${p.matchName ?? ''}`));
      return words.every((w) => have.has(w));
    });
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/**
 * Turns `[text](amzn:Product+Name)` / `[text](amzn:B0XXXXXXXX)` into tagged
 * Amazon links with rel="sponsored", and marks other outbound links noopener.
 */
export function remarkAffiliateLinks() {
  return (tree, file) => {
    const products = file?.data?.astro?.frontmatter?.products ?? [];
    walk(tree, (node) => {
      if (node.type !== 'link' || typeof node.url !== 'string') return;
      if (node.url.startsWith('amzn:')) {
        const value = decodeURIComponent(node.url.slice('amzn:'.length)).replace(/\+/g, ' ').trim();
        const text = (node.children ?? []).map((c) => c.value ?? '').join('');
        const product = /^B0[A-Z0-9]{8}$/.test(value) ? null : productFor(value, text, products);
        node.url = product ? amazonUrl({ asin: product.asin }) : resolveAmznHref(node.url);
        node.data = node.data || {};
        node.data.hProperties = { rel: AFFILIATE_REL, target: '_blank', class: 'aff-link' };
      } else if (/^https?:\/\//.test(node.url) && !node.url.includes(siteConfig.domain)) {
        node.data = node.data || {};
        node.data.hProperties = { rel: 'noopener', target: '_blank' };
      }
    });
  };
}
