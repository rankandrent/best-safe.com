// Shared by the Astro site and the content agents.
import siteConfig from '../../site.config.json' with { type: 'json' };

const ASIN_RE = /^B0[A-Z0-9]{8}$/;

export function amazonTag() {
  return process.env.AMAZON_TAG || siteConfig.affiliate.amazonTag;
}

/**
 * Build an Amazon affiliate URL.
 * - A verified ASIN links straight to the product page.
 * - Otherwise we link to an Amazon search for the exact product name, which
 *   never 404s when listings change and still carries the affiliate tag.
 */
export function amazonUrl({ asin, query }) {
  const tag = encodeURIComponent(amazonTag());
  const domain = siteConfig.affiliate.amazonDomain;
  if (asin && ASIN_RE.test(asin)) {
    return `https://${domain}/dp/${asin}?tag=${tag}`;
  }
  const k = encodeURIComponent(String(query || '').trim()).replace(/%20/g, '+');
  return `https://${domain}/s?k=${k}&tag=${tag}`;
}

/** Resolve the `amzn:` pseudo-URL used inside markdown bodies. */
export function resolveAmznHref(href) {
  const value = decodeURIComponent(href.slice('amzn:'.length)).replace(/\+/g, ' ').trim();
  return ASIN_RE.test(value) ? amazonUrl({ asin: value }) : amazonUrl({ query: value });
}

export const AFFILIATE_REL = 'sponsored nofollow noopener';
