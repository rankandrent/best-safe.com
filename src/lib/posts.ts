import { getCollection, type CollectionEntry } from 'astro:content';
import { DEFAULT_LANG, LANGS, langPrefix, type Lang } from './i18n';

// QA agent reports (data/qa/<slug>.json, data/qa/<lang>/<slug>.json for translations).
// A post only goes live once it passes QA.
const qa = import.meta.glob<{ pass: boolean }>('../../data/qa/**/*.json', { eager: true, import: 'default' });
const qaPassed = (id: string) => qa[`../../data/qa/${id}.json`]?.pass === true;

type Post = CollectionEntry<'blog'>;

/** Language of a post: English posts sit at the top of src/content/blog, translations in <lang>/. */
export const postLang = (post: Post): Lang => (post.id.includes('/') ? (post.data.lang as Lang) : DEFAULT_LANG);

/** Slug without the language folder. */
export const postSlug = (post: Post): string => post.id.slice(post.id.lastIndexOf('/') + 1);

async function allPublished(): Promise<Post[]> {
  const now = Date.now();
  const posts = await getCollection('blog', ({ id, data }) => {
    if (data.draft || data.pubDate.getTime() > now || !qaPassed(id)) return false;
    // A translation must sit in the folder of its own language.
    const folder = id.includes('/') ? id.split('/')[0] : DEFAULT_LANG;
    return folder === data.lang;
  });
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** Published posts of one language (English by default), newest first. */
export async function getPublishedPosts(lang: Lang = DEFAULT_LANG): Promise<Post[]> {
  return (await allPublished()).filter((p) => postLang(p) === lang);
}

/** Every published language version of an English post, keyed by language (English included). */
export async function translationsOf(englishId: string): Promise<Partial<Record<Lang, Post>>> {
  const out: Partial<Record<Lang, Post>> = {};
  for (const p of await allPublished()) {
    const l = postLang(p);
    if (l === DEFAULT_LANG ? p.id === englishId : p.data.translationOf === englishId) out[l] ??= p;
  }
  // Keep a stable language order (en, de, es, nl).
  return Object.fromEntries(LANGS.filter((l) => out[l]).map((l) => [l, out[l]])) as Partial<Record<Lang, Post>>;
}

/** Site path of a post: /blog/<id>/ for English, /<lang>/blog/<slug>/ otherwise. */
export function postUrl(post: Post): string {
  const l = postLang(post);
  return l === DEFAULT_LANG ? `/blog/${post.id}/` : `${langPrefix(l)}/blog/${postSlug(post)}/`;
}
