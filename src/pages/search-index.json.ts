import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import { categoryName } from '../lib/site';

// Small index for the on-site search page (/search/).
export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const items = posts.map((p) => ({
    url: `/blog/${p.id}/`,
    title: p.data.title,
    description: p.data.description,
    category: categoryName(p.data.category),
    terms: [p.data.keyword, ...(p.data.secondaryKeywords ?? []), ...(p.data.tags ?? []), ...(p.data.products ?? []).map((x) => x.name)].join(' | '),
  }));
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
