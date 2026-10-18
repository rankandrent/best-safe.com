import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import { SITE } from '../lib/site';

// Weighted suggestion phrases for the search box autocomplete (/search/).
// Weights follow how central a phrase is to a guide: its target keyword first,
// then its secondary keywords, the products it reviews, tags and categories;
// guides published or updated in the last 30 days get a small boost.
export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const best = new Map<string, { text: string; weight: number; url: string }>();
  const add = (text: string, weight: number, url: string) => {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length < 3) return;
    const key = t.toLowerCase();
    const prev = best.get(key);
    if (!prev || prev.weight < weight) best.set(key, { text: key, weight, url });
  };
  const month = Date.now() - 30 * 86400000;
  for (const p of posts) {
    const d = p.data;
    const url = `/blog/${p.id}/`;
    const fresh = (d.updatedDate ?? d.pubDate).getTime() > month ? 1 : 0;
    add(d.keyword, 10 + fresh, url);
    for (const k of d.secondaryKeywords ?? []) add(k, 7 + fresh, url);
    for (const x of d.products ?? []) add(x.name, 6 + fresh, url);
    for (const t of d.tags ?? []) add(t, 3, url);
  }
  for (const c of SITE.categories) {
    if (posts.some((p) => p.data.category === c.slug)) add(c.name.replace('&', 'and'), 4, `/category/${c.slug}/`);
  }
  return new Response(JSON.stringify([...best.values()]), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
