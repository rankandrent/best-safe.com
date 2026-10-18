// Generates a branded 1200×630 featured image for every post that lacks one,
// and records it in the post's frontmatter (`heroImage`, `heroAlt`).
// Used as the article hero, the card thumbnail, og:image and schema image.
//
//   node scripts/featured-images.mjs            # only missing images
//   node scripts/featured-images.mjs --force    # regenerate all
//   node scripts/featured-images.mjs --pages    # also share images for home, blog, categories, brands, checklist
//   node scripts/featured-images.mjs --brand    # also logo-512.png and og-default.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ROOT, SITE } from '../agents/lib/config.mjs';
import { listPosts, writePost } from '../agents/lib/store.mjs';

const OUT_DIR = path.join(ROOT, 'public/images/featured');
const font = (pkg, file) => fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource', pkg, 'files', file));
const FONTS = [
  { name: 'Bricolage', data: font('bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff'), weight: 800, style: 'normal' },
  { name: 'Bricolage', data: font('bricolage-grotesque', 'bricolage-grotesque-latin-700-normal.woff'), weight: 700, style: 'normal' },
  { name: 'Serif', data: font('source-serif-4', 'source-serif-4-latin-400-normal.woff'), weight: 400, style: 'normal' },
];

const C = { drywall: '#f5f2ec', paper: '#ffffff', ink: '#1f1c1a', slate: '#5e5853', rule: '#ddd6cc', tape: '#c2410c', tapeInk: '#9a3412' };

// Same line icons as src/components/Icon.astro.
const ICONS = {
  safe: '<rect x="3.5" y="3" width="17" height="15.5" rx="1.5"/><circle cx="11" cy="10.75" r="3.2"/><path d="M11 7.55v1.2M11 12.75v1.2M7.8 10.75H9M13 10.75h1.2M17.2 8.75v4M6.5 18.5v2.5M17.5 18.5v2.5"/>',
  pistol: '<path d="M2.5 6.5h17.5v4.5h-8.5l-1.2 2.5H7.5L6.4 20H2.9l1.4-9H2.5z"/><path d="M20 7.75h1.5M8.2 13.5c0 1.3.9 2.1 2.1 2.1"/>',
  gunsafe: '<rect x="5.5" y="2.5" width="13" height="18" rx="1.5"/><path d="M8.5 5.5h7v12h-7z"/><circle cx="12" cy="10" r="1.6"/><path d="M12 12.5v2M7.5 20.5v1.5M16.5 20.5v1.5"/>',
  flame: '<path d="M12 2.5c.8 3.2 5.5 5.3 5.5 10.3a5.5 5.5 0 0 1-11 0c0-2.6 1.4-4.3 2.6-5.4.2 1.9 1 3 2.1 3.5-.6-3.2-.2-5.9.8-8.4z"/><path d="M12 21.3c-1.6 0-2.8-1.1-2.8-2.7 0-1.4 1.2-2.4 1.9-3.1.3 1 .9 1.5 1.5 1.7.9-.7 1.5-1.6 1.6-2.6.4.7.6 1.6.6 2.6 0 2.4-1.2 4.1-2.8 4.1z"/>',
  house: '<path d="M3 11l9-7.5 9 7.5"/><path d="M5 9.5v11h14v-11"/><rect x="9" y="12" width="6" height="5.5" rx=".8"/><circle cx="12" cy="14.75" r="1"/>',
  car: '<path d="M3 16.5v-3.5l2.2-5.5h13.6l2.2 5.5v3.5z"/><path d="M3 16.5v2.5h3v-2.5M18 16.5v2.5h3v-2.5M5.5 12.5h13"/><circle cx="7.5" cy="14.5" r=".9"/><circle cx="16.5" cy="14.5" r=".9"/>',
  wall: '<path d="M2.5 3.5h19v17h-19z"/><path d="M2.5 8h4M17.5 8h4M2.5 16h4M17.5 16h4M12 3.5V6M12 18v2.5"/><rect x="6.5" y="6" width="11" height="12" rx="1"/><circle cx="11" cy="12" r="2"/><path d="M15 10.5v3"/>',
  padlock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/><circle cx="12" cy="15" r="1.3"/><path d="M12 16.3v2"/>',
  ammo: '<rect x="2.5" y="8.5" width="19" height="11.5" rx="1.5"/><path d="M2.5 12h19M9 8.5V5.5h6v3M6 15.5h3M15 15.5h3"/>',
  book: '<path d="M3.5 4.5H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H3.5z"/><path d="M20.5 4.5H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6.5z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const CATEGORY_ICON = {
  'handgun-safes': 'pistol', 'gun-safes': 'gunsafe', 'fireproof-safes': 'flame', 'home-safes': 'house', 'vehicle-safes': 'car',
  'wall-floor-safes': 'wall', 'lock-boxes': 'padlock', 'safe-accessories': 'ammo', 'safe-guides': 'book',
};
const TYPE_LABEL = { roundup: 'Buying guide', review: 'Review', comparison: 'Comparison', 'how-to': 'How-to', guide: 'Guide' };

const svgUri = (inner, color, stroke = 1.6) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" color="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
  ).toString('base64')}`;
export const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#1f1c1a"/><rect x="7.5" y="6.5" width="25" height="24" rx="2.6" fill="#f5f2ec"/><rect x="10.5" y="9.5" width="19" height="18" rx="1.4" fill="none" stroke="#1f1c1a" stroke-width="1.4"/><circle cx="18" cy="18.5" r="4.6" fill="none" stroke="#1f1c1a" stroke-width="2"/><circle cx="18" cy="18.5" r="1.3" fill="#1f1c1a"/><path d="M18 12.4v1.6M18 23v1.6M11.9 18.5h1.6M22.5 18.5h1.6" stroke="#1f1c1a" stroke-width="1.4"/><path d="M26.2 15.5v6" stroke="#f97316" stroke-width="2.8" stroke-linecap="round"/><rect x="10" y="30.5" width="5" height="3" rx=".6" fill="#f5f2ec"/><rect x="25" y="30.5" width="5" height="3" rx=".6" fill="#f5f2ec"/></svg>';
const LOGO = `data:image/svg+xml;base64,${Buffer.from(
  LOGO_SVG,
).toString('base64')}`;

const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const img = (src, w, ht, style = {}) => ({ type: 'img', props: { src, width: w, height: ht, style } });

function hash(s) {
  let x = 0;
  for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x;
}

function layout({ title, category, articleType, slug, kicker, label, iconName, blankCard = false }) {
  const catName = kicker ?? SITE.categories.find((c) => c.slug === category)?.name ?? 'Safe guides';
  const icon = ICONS[iconName ?? CATEGORY_ICON[category]] ?? ICONS.safe;
  const tilt = (hash(slug) % 2 ? 1 : -1) * (2 + (hash(slug) % 3));
  const size = title.length > 64 ? 52 : title.length > 46 ? 58 : 66;
  const text = (t, style = {}) => h('div', style, t);

  return h('div', { width: 1200, height: 630, background: C.drywall, fontFamily: 'Bricolage', position: 'relative' }, [
    // Left: text column
    h('div', { position: 'absolute', left: 72, top: 60, width: blankCard ? 640 : 660, height: 510, flexDirection: 'column', justifyContent: 'space-between' }, [
      h('div', { alignItems: 'center', color: C.tapeInk, fontSize: 26, fontWeight: 700 }, [img(svgUri(icon, C.tapeInk, 2), 34, 34, { marginRight: 12 }), text(catName)]),
      text(title, { fontSize: size, fontWeight: 800, color: C.ink, lineHeight: 1.06, letterSpacing: '-0.03em' }),
      h('div', { alignItems: 'center', fontSize: 26, fontWeight: 700, color: C.ink }, [
        img(LOGO, 44, 44, { marginRight: 14 }),
        text(SITE.name),
        text(SITE.domain, { fontFamily: 'Serif', fontWeight: 400, color: C.slate, fontSize: 24, marginLeft: 16 }),
      ]),
    ]),
    // Right: spec-sheet card with the category drawing and a gaffer-tape strip.
    // blankCard: an upright, empty card; the article page places the real
    // Amazon product photo (served from Amazon) over it at HERO_PHOTO_BOX.
    blankCard
      ? h('div', { position: 'absolute', left: 1200, top: 0, width: 1, height: 1 }, [])
      : h('div', { position: 'absolute', left: 820, top: 110, width: 300, height: 400, background: C.paper, border: `2px solid ${C.rule}`, transform: `rotate(${tilt}deg)`, flexDirection: 'column', padding: '58px 26px 26px' }, [
          h('div', { justifyContent: 'space-between', fontFamily: 'Serif', fontSize: 17, color: C.slate, borderBottom: `2px solid ${C.rule}`, paddingBottom: 10, width: 248 }, [text('Spec-checked'), text('No hype')]),
          h('div', { flexGrow: 1, alignItems: 'center', justifyContent: 'center' }, [img(svgUri(icon, C.ink, 1.3), 190, 190)]),
        ]),
    text(label ?? TYPE_LABEL[articleType] ?? 'Guide', { position: 'absolute', left: blankCard ? 860 : 860, top: blankCard ? 70 : 86, background: C.tape, color: '#fff', fontSize: 26, fontWeight: 700, padding: '12px 26px', transform: `rotate(${blankCard ? -2 : -tilt - 1}deg)` }),
  ]);
}

export async function renderFeatured(post, { dir = OUT_DIR, urlBase = '/images/featured' } = {}) {
  const svg = await satori(layout(post), { width: 1200, height: 630, fonts: FONTS });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${post.slug}.png`), png);
  return `${urlBase}/${post.slug}.png`;
}

/** Share images for the brand index and each brand page (/brands/, /brand/<slug>/). */
export function brandPages() {
  return [
    { slug: 'brands', title: 'Safe brands: picks and buying guides by brand', kicker: 'Safe brands', label: 'Brands', iconName: 'safe' },
    ...(SITE.brands ?? []).map((b) => ({ slug: `brand-${b.slug}`, title: `${b.name} safes: picks and buying guides`, kicker: 'Safe brands', label: 'Brand', iconName: 'safe' })),
  ];
}

/** Share images for non-article pages (home, categories, tools). */
export async function renderPageImages() {
  const dir = path.join(ROOT, 'public/images/og');
  const pages = [
    { slug: 'home', title: 'The right safe for what you need to protect', kicker: 'Honest safe buying guides', label: 'Spec-checked', iconName: 'safe' },
    { slug: 'safe-buying-checklist', title: `The ${SITE.name} Buying Checklist: 20 things to check`, kicker: "Free buyer's tool", label: 'Checklist', iconName: 'check' },
    { slug: 'blog', title: 'Every home safe, gun safe and fireproof safe guide', kicker: 'All guides', label: 'Guides', iconName: 'safe' },
    ...SITE.categories.map((c) => ({ slug: `category-${c.slug}`, title: `${c.name}: buying guides and picks`, kicker: c.name, category: c.slug, label: 'Category' })),
    ...brandPages(),
  ];
  for (const p of pages) await renderFeatured(p, { dir, urlBase: '/images/og' });
  return pages.length;
}

/** Brand assets: public/logo-512.png (schema.org logo) and public/og-default.png. */
export async function renderBrandImages() {
  const logo = new Resvg(LOGO_SVG, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
  fs.writeFileSync(path.join(ROOT, 'public/logo-512.png'), logo);
  await renderFeatured(
    { slug: 'og-default', title: 'Honest home safe, gun safe and fireproof safe buying guides', kicker: SITE.domain, label: 'Spec-checked', iconName: 'safe' },
    { dir: path.join(ROOT, 'public'), urlBase: '' },
  );
  return 2;
}

const HERO_DIR = path.join(ROOT, 'public/images/hero');

/** Generate (if missing) and attach the featured image to a post's frontmatter.
 *  Also renders the article-header base (same design, blank product card). */
export async function ensureFeatured({ slug, file, data, content }, { force = false } = {}) {
  const target = path.join(OUT_DIR, `${slug}.png`);
  const base = { slug, title: data.title, category: data.category, articleType: data.articleType, blankCard: true };
  if (force || !fs.existsSync(path.join(HERO_DIR, `${slug}.png`))) await renderFeatured(base, { dir: HERO_DIR, urlBase: '/images/hero' });
  if (!force && fs.existsSync(target) && data.heroImage) return false;
  const url = await renderFeatured({ slug, title: data.title, category: data.category, articleType: data.articleType });
  writePost(slug, { ...data, heroImage: url, heroAlt: `${data.title}: ${SITE.name} ${TYPE_LABEL[data.articleType]?.toLowerCase() ?? 'guide'}` }, content);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');
  let n = 0;
  for (const post of listPosts()) if (await ensureFeatured(post, { force })) n++;
  console.log(`featured images: ${n} generated`);
  if (process.argv.includes('--pages')) console.log(`page share images: ${await renderPageImages()}`);
  if (process.argv.includes('--brand')) console.log(`brand images: ${await renderBrandImages()}`);
}
