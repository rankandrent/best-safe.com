// Media placed after an H2 (`afterHeading`, 1 = first H2): Unsplash photos
// (frontmatter `photos`, agents/unsplash-images.mjs) with the photographer
// credit Unsplash requires, AI illustrations (`illustrations`,
// agents/ai-images.mjs) labelled as AI-generated, and YouTube videos
// (`videos`) as a click-to-play thumbnail that loads the player only on click.
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

export function illustrationFigureHtml(p, lang = 'en') {
  return (
    `<figure class="post-photo post-ai"><img src="${esc(p.src)}" alt="${esc(p.alt)}" width="${p.width ?? 1200}" height="${p.height ?? 800}" loading="lazy" decoding="async" />` +
    `<figcaption class="credit">${esc(t(lang, 'photo.ai'))}</figcaption></figure>`
  );
}

export function videoFigureHtml(v, lang = 'en') {
  const watch = `https://www.youtube.com/watch?v=${v.id}`;
  const title = v.title ?? t(lang, 'video.play');
  return (
    `<figure class="post-video"><a class="yt-lite" href="${watch}" data-id="${esc(v.id)}" target="_blank" rel="noopener" aria-label="${esc(t(lang, 'video.play'))}: ${esc(title)}">` +
    `<img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="${esc(title)}" width="480" height="360" loading="lazy" decoding="async" /><span class="yt-play" aria-hidden="true"></span></a>` +
    `<figcaption class="credit">${esc(t(lang, 'video.caption', { title, channel: v.channel ?? 'YouTube' }))}</figcaption></figure>`
  );
}

export function remarkPhotos() {
  return (tree, file) => {
    const fm = file.data?.astro?.frontmatter;
    const lang = fm?.lang ?? 'en';
    const media = [
      ...(fm?.photos ?? []).filter((p) => p.placement === 'inline' && p.afterHeading).map((p) => ({ at: p.afterHeading, html: photoFigureHtml(p, lang) })),
      ...(fm?.illustrations ?? []).filter((p) => p.src && p.afterHeading).map((p) => ({ at: p.afterHeading, html: illustrationFigureHtml(p, lang) })),
      ...(fm?.videos ?? []).filter((v) => v.id && v.afterHeading).map((v) => ({ at: v.afterHeading, html: videoFigureHtml(v, lang) })),
    ];
    if (!media.length) return;
    let h2 = 0;
    for (let i = 0; i < tree.children.length; i++) {
      const n = tree.children[i];
      if (n.type !== 'heading' || n.depth !== 2 || n.data?.pick) continue; // product headings (promoted to h2) don't count
      h2++;
      const here = media.filter((m) => m.at === h2);
      if (!here.length) continue;
      // after the heading's first paragraph, so the bold answer stays on top
      let at = i + 1;
      if (tree.children[at]?.type === 'paragraph') at++;
      tree.children.splice(at, 0, ...here.map((m) => ({ type: 'html', value: m.html })));
      i = at + here.length - 1;
    }
  };
}
