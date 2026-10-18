import rss from '@astrojs/rss';
import { getPublishedPosts } from '../lib/posts';
import siteConfig from '../../site.config.json';

export async function GET(context) {
  const posts = await getPublishedPosts();
  return rss({
    title: siteConfig.name,
    description: siteConfig.description,
    site: context.site,
    items: posts.slice(0, 50).map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `/blog/${p.id}/`,
      categories: [p.data.category],
    })),
  });
}
