// Amazon Creators API client (the successor to PA-API 5).
// Credentials come only from environment variables / GitHub secrets:
//   AMAZON_CREATORS_CREDENTIAL_ID      (amzn1.application-oa2-client....)
//   AMAZON_CREATORS_CREDENTIAL_SECRET  (amzn1.oa2-cs.v1....)
//   AMAZON_CREATORS_VERSION            (default 3.1 = Login with Amazon, North America)
// Partner tag = your Associates tracking ID (AMAZON_TAG / site.config.json).
import { log } from './config.mjs';
import { amazonTag } from '../../src/lib/affiliate.mjs';
import { productMatches } from './product-match.mjs';

const API = 'https://creatorsapi.amazon/catalog/v1';
const MARKETPLACE = 'www.amazon.com';
const TOKEN_ENDPOINTS = {
  '2.1': 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token',
  '2.2': 'https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token',
  '2.3': 'https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token',
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};
const RESOURCES = ['itemInfo.title', 'itemInfo.byLineInfo', 'images.primary.large', 'images.primary.medium', 'images.variants.large'];
const GALLERY_MAX = 4;

const version = () => process.env.AMAZON_CREATORS_VERSION || '3.1';
export const hasAmazonApi = () =>
  Boolean(process.env.AMAZON_CREATORS_CREDENTIAL_ID && process.env.AMAZON_CREATORS_CREDENTIAL_SECRET) && !/REPLACE/.test(amazonTag());

let cached = { token: null, expiresAt: 0 };

async function token() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const v = version();
  const lwa = v.startsWith('3.');
  const body = {
    grant_type: 'client_credentials',
    client_id: process.env.AMAZON_CREATORS_CREDENTIAL_ID,
    client_secret: process.env.AMAZON_CREATORS_CREDENTIAL_SECRET,
    scope: lwa ? 'creatorsapi::default' : 'creatorsapi/default',
  };
  const res = await fetch(TOKEN_ENDPOINTS[v], {
    method: 'POST',
    headers: { 'Content-Type': lwa ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: lwa ? JSON.stringify(body) : new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Amazon token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 };
  return cached.token;
}

async function call(operation, payload) {
  const t = await token();
  const v = version();
  const res = await fetch(`${API}/${operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-marketplace': MARKETPLACE,
      Authorization: v.startsWith('3.') ? `Bearer ${t}` : `Bearer ${t}, Version ${v}`,
    },
    body: JSON.stringify({ partnerTag: amazonTag(), marketplace: MARKETPLACE, resources: RESOURCES, ...payload }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return call(operation, payload);
  }
  if (!res.ok) throw new Error(`Amazon ${operation} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function mapItem(it) {
  const im = it.images?.primary?.large ?? it.images?.primary?.medium;
  return {
    asin: it.asin,
    title: it.itemInfo?.title?.displayValue ?? '',
    brand: it.itemInfo?.byLineInfo?.brand?.displayValue ?? '',
    url: it.detailPageURL,
    image: im?.url ? { url: im.url, width: im.width, height: im.height } : undefined,
    gallery: (it.images?.variants ?? [])
      .map((v) => v.large)
      .filter((v) => v?.url && v.url !== im?.url)
      .slice(0, GALLERY_MAX)
      .map((v) => ({ url: v.url, width: v.width, height: v.height })),
  };
}

export async function searchItems(keywords, { itemCount = 5, searchIndex = 'All' } = {}) {
  const data = await call('searchItems', { keywords, searchIndex, itemCount });
  return (data.searchResult?.items ?? []).map(mapItem);
}

export async function getItems(asins) {
  const out = [];
  for (let i = 0; i < asins.length; i += 10) {
    const data = await call('getItems', { itemIds: asins.slice(i, i + 10) });
    out.push(...(data.itemsResult?.items ?? []).map(mapItem));
  }
  return out;
}

const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1));

/** Find the listing for a researched product: the most relevant search result
 *  whose title passes the strict product match (brand, model, no accessories). */
export async function matchProduct(name, query, brand = '') {
  const items = await searchItems(query, { itemCount: 10 });
  const hit = items.find((it) => productMatches(name, it.title, brand).ok);
  if (hit) return hit;
  log('amazon', `no exact listing for "${name}" (top result: "${items[0]?.title?.slice(0, 80) ?? 'none'}")`);
  return null;
}
