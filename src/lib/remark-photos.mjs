// Unsplash photos chosen for a post (frontmatter `photos`, written by
// agents/unsplash-images.mjs). Inline photos are placed right after the H2
// whose position matches `afterHeading` (1 = first H2), each with the
// photographer credit Unsplash requires.
import { t } from './i18n.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Photo by <name> on Unsplash", both linked with the referral params Unsplash asks for. */
export function unsplashCredit(p, lang = 'en') {
  return t(lang, 'photo.credit', {
    name: `<a href="${esc(p.creditUrl)}" rel="noopener" target="_blank">${esc(p.credit)}</a>`,
    site: `<a href="${esc(p.unsplashUrl)}" rel="noopener" target="_blank">Unsplash</a>`,
  });
}

export function photoFigureHtml(p, lang = 'en') {
  return (
    `<figure class="post-photo"><img src="${esc(p.url)}" alt="${esc(p.alt)}" width="${p.width ?? 1200}" height="${p.height ?? 800}" loading="lazy" decoding="async" />` +
    `<figcaption class="credit">${unsplashCredit(p, lang)}</figcaption></figure>`
  );
}

export function remarkPhotos() {
  return (tree, file) => {
    const fm = file.data?.astro?.frontmatter;
    const lang = fm?.lang ?? 'en';
    const photos = (fm?.photos ?? []).filter((p) => p.placement === 'inline' && p.afterHeading);
    if (!photos.length) return;
    let h2 = 0;
    for (let i = 0; i < tree.children.length; i++) {
      const n = tree.children[i];
      if (n.type !== 'heading' || n.depth !== 2) continue;
      h2++;
      const here = photos.filter((p) => p.afterHeading === h2);
      if (!here.length) continue;
      // after the heading's first paragraph, so the bold answer stays on top
      let at = i + 1;
      if (tree.children[at]?.type === 'paragraph') at++;
      tree.children.splice(at, 0, ...here.map((p) => ({ type: 'html', value: photoFigureHtml(p, lang) })));
      i = at + here.length - 1;
    }
  };
}
