// Unsplash API (https://unsplash.com/documentation). Needs UNSPLASH_ACCESS_KEY.
// Guidelines we follow: hotlink images.unsplash.com URLs, credit the
// photographer and Unsplash with utm_source/utm_medium referral links, and hit
// the photo's download_location when we use it.
const API = 'https://api.unsplash.com';
const APP = process.env.UNSPLASH_APP_NAME || 'best-safe';
const ref = (u) => `${u}${u.includes('?') ? '&' : '?'}utm_source=${encodeURIComponent(APP)}&utm_medium=referral`;

async function call(path) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not set');
  const res = await fetch(API + path, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
  if (!res.ok) throw new Error(`Unsplash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function searchPhotos(query, { perPage = 15, orientation = 'landscape' } = {}) {
  const q = new URLSearchParams({ query, per_page: String(perPage), orientation, content_filter: 'high' });
  const data = await call(`/search/photos?${q}`);
  return data.results ?? [];
}

/** Frontmatter shape for one photo. */
export function toPhoto(r, { placement, afterHeading, w = 1200, h = 800 } = {}) {
  return {
    id: r.id,
    url: `${r.urls.raw}&w=${w}&h=${h}&fit=crop&crop=entropy&auto=format&q=75`,
    width: w,
    height: h,
    alt: (r.alt_description || r.description || '').trim().replace(/^\w/, (c) => c.toUpperCase()),
    credit: r.user.name,
    creditUrl: ref(r.user.links.html),
    unsplashUrl: ref('https://unsplash.com/'),
    placement,
    ...(afterHeading ? { afterHeading } : {}),
    downloadLocation: r.links.download_location,
  };
}

/** Unsplash asks apps to call this endpoint when a photo is used. */
export async function trackDownload(downloadLocation) {
  const u = new URL(downloadLocation);
  await call(u.pathname + u.search).catch(() => {});
}
