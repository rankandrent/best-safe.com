// Regression tests for the publishing agents' decision logic and the built pages.
// Run with `npm test` (node --test). Build-output checks skip when dist/ doesn't exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findCannibal, overlap, serpShared } from '../agents/lib/cannibal.mjs';
import { keywordGate, nextKeyword } from '../agents/orchestrator.mjs';
import { SITE, ROOT } from '../agents/lib/config.mjs';

const post = (slug, keyword, secondaryKeywords = []) => ({ slug, data: { keyword, secondaryKeywords } });
const serp = (...hosts) => ({ urls: hosts.map((h) => `https://${h}/page`) });

test('a topic already covered by an existing post is rejected', () => {
  const posts = [post('best-pistol-safe', 'best pistol safe')];
  const clash = findCannibal({ keyword: 'best pistol safe' }, posts, { serps: {} });
  assert.equal(clash?.slug, 'best-pistol-safe');
});

test('different wording with the same search intent (shared SERP) is rejected', () => {
  const posts = [post('bedside', 'best bedside gun safe')];
  const serps = {
    'best bedside gun safe': serp('a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'),
    'gun vault for the nightstand': serp('a.com', 'b.com', 'c.com', 'd.com', 'x.com', 'y.com'),
  };
  const clash = findCannibal({ keyword: 'gun vault for the nightstand' }, posts, { serps });
  assert.equal(clash?.slug, 'bedside');
  assert.match(clash.reason, /4 of the top-10/);
});

test('a genuinely distinct topic is allowed even when the words overlap', () => {
  const posts = [post('fireproof', 'best fireproof safe')];
  const serps = {
    'best fireproof safe': serp('a.com', 'b.com', 'c.com', 'd.com'),
    'best fireproof document safe': serp('a.com', 'q.com', 'r.com', 's.com'),
  };
  assert.equal(findCannibal({ keyword: 'best fireproof document safe' }, posts, { serps }), null);
});

test('a one-word core does not clash with a longer, different keyword', () => {
  assert.equal(overlap('best magnetic cabinet locks', 'best lock'), 0);
  assert.ok(overlap('smart lock', 'lock smart') >= 0.75);
});

test('serpShared returns null when a SERP is not recorded (unable to verify)', () => {
  assert.equal(serpShared('a', 'b', {}), null);
});

test('a keyword without Ahrefs volume/KD is held as needs-data, not guessed', { skip: SITE.keywordRules?.requireAhrefs === false && 'requireAhrefs is off in site.config.json' }, () => {
  const gate = keywordGate({ keyword: 'some new long tail keyword' }, []);
  assert.equal(gate?.status, 'needs-data');
});

test('a keyword over the volume cap is parked', () => {
  const cap = SITE.keywordRules?.maxVolume ?? 250;
  const gate = keywordGate({ keyword: 'best gun safe ever made', ahrefs: { volume: cap + 1, kd: 0 } }, []);
  assert.equal(gate?.status, 'parked');
});

test('a keyword over the KD cap is parked', () => {
  const max = SITE.keywordRules?.maxKd;
  if (typeof max !== 'number') return;
  const gate = keywordGate({ keyword: 'some low volume keyword here', ahrefs: { volume: 50, kd: max + 1 } }, []);
  assert.equal(gate?.status, 'parked');
});

test('a keyword with data inside the caps and no overlap passes', () => {
  assert.equal(keywordGate({ keyword: 'quiet zebra keyword phrase', ahrefs: { volume: 40, kd: 0 } }, []), null);
});

test('a long-tail keyword Ahrefs does not have passes only with a measurable proxy', { skip: SITE.keywordRules?.requireAhrefs === false && 'requireAhrefs is off in site.config.json' }, () => {
  assert.equal(keywordGate({ keyword: 'quiet zebra keyword phrase', ahrefs: { notInDatabase: true } }, [])?.status, 'needs-data');
  assert.equal(keywordGate({ keyword: 'quiet zebra keyword phrase', ahrefs: { notInDatabase: true, proxy: { keyword: 'zebra keyword', volume: 90, kd: 4 } } }, []), null);
});

test('keywords the owner supplied skip the gate unless Ahrefs measured no demand', () => {
  assert.equal(keywordGate({ keyword: 'anything', source: 'user' }, []), null);
  assert.equal(keywordGate({ keyword: 'anything', source: 'user', ahrefs: { volume: 2000, kd: 50 } }, []), null);
  assert.equal(keywordGate({ keyword: 'anything', source: 'user', ahrefs: { volume: 0, kd: 0 } }, [])?.status, 'parked');
});

test('keywords with proven demand are picked before unmeasured ones', () => {
  const queue = [
    { keyword: 'zz unmeasured owner keyword', status: 'pending', source: 'user', priority: 9, category: 'a' },
    { keyword: 'zz measured owner keyword', status: 'pending', source: 'user', priority: 1, category: 'b', ahrefs: { volume: 150, kd: 0 } },
  ];
  assert.equal(nextKeyword(queue, { published: [] }).keyword, 'zz measured owner keyword');
});

test('low KD, long-tail, high-volume keywords come first (owner rule)', () => {
  const queue = [
    { keyword: 'zz short head', status: 'pending', priority: 9, category: 'a', ahrefs: { volume: 900, kd: 9 } },
    { keyword: 'zz long tail easy keyword', status: 'pending', priority: 1, category: 'b', ahrefs: { volume: 400, kd: 1 } },
    { keyword: 'zz no data owner keyword', status: 'pending', source: 'user', priority: 9, category: 'c' },
  ];
  assert.equal(nextKeyword(queue, { published: [] }).keyword, 'zz long tail easy keyword');
});

test('the safe Score uses the five safe criteria, with fire optional', async () => {
  const { CRITERIA, REQUIRED_CRITERIA, productScore, criterionLabel } = await import('../src/lib/score.mjs');
  assert.deepEqual(CRITERIA.map((c) => c.key), ['security', 'fire', 'access', 'capacity', 'value']);
  assert.equal(Math.round(CRITERIA.reduce((n, c) => n + c.weight, 0) * 100), 100);
  assert.ok(!REQUIRED_CRITERIA.includes('fire'));
  assert.equal(productScore({ security: 10, fire: 10, access: 10, capacity: 10, value: 10 }), 5);
  // A car safe without a fire rating is not punished: the other weights are rescaled.
  assert.equal(productScore({ security: 8, access: 8, capacity: 8, value: 8 }), 4);
  for (const lang of ['en', 'de', 'es', 'nl']) for (const c of CRITERIA) assert.notEqual(criterionLabel(c.key, lang), c.key, `${lang}: no label for ${c.key}`);
});

test('every queued keyword carries Ahrefs data and the gate lets the launch queue through', () => {
  const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/keywords.json'), 'utf8'));
  assert.ok(queue.length > 0, 'empty keyword queue');
  const slugs = new Set();
  for (const k of queue) {
    assert.equal(typeof k.ahrefs?.volume, 'number', `${k.keyword}: no Ahrefs volume`);
    assert.equal(typeof k.ahrefs?.kd, 'number', `${k.keyword}: no Ahrefs KD`);
    assert.ok(SITE.categories.some((c) => c.slug === k.category), `${k.keyword}: unknown category ${k.category}`);
    assert.ok(!slugs.has(k.slug), `duplicate slug ${k.slug}`);
    slugs.add(k.slug);
    if (k.status === 'pending') assert.equal(keywordGate(k, []), null, `${k.keyword} would be held by the gate`);
  }
});

test('no tripod leftovers in the site config or the i18n strings', () => {
  const files = ['site.config.json', 'src/i18n/en.json', 'src/i18n/de.json', 'src/i18n/es.json', 'src/i18n/nl.json'];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /tripod|stativ|trípode|statief/i, f);
});

// Built pages: every published post has a self-referencing canonical and is indexable.
const DIST = path.join(ROOT, 'dist');
const built = fs.existsSync(DIST);
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');
const robotsOf = (html) => html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? '';
const blogPages = () => {
  const pages = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f === 'index.html' && /\/blog\/[a-z0-9-]+\/index\.html$/.test(p)) pages.push(p);
    }
  };
  walk(DIST);
  return pages;
};

test('built blog pages have a self canonical and index,follow', { skip: (!built && 'dist/ not built') || (!blogPages().length && 'no posts published yet') }, () => {
  const site = SITE.siteUrl ?? SITE.url ?? '';
  for (const p of blogPages()) {
    const html = fs.readFileSync(p, 'utf8');
    const rel = '/' + path.relative(DIST, path.dirname(p)).split(path.sep).join('/') + '/';
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    assert.ok(canonical, `${rel}: no canonical`);
    assert.ok(canonical.endsWith(rel), `${rel}: canonical points to ${canonical}`);
    if (site) assert.ok(canonical.startsWith(site.replace(/\/$/, '')), `${rel}: canonical host ${canonical}`);
    assert.ok(!/noindex/.test(robotsOf(html)), `${rel}: unexpected noindex`);
  }
});

test('the site builds its core pages: home, blog, categories, static pages, sitemap, robots.txt', { skip: !built && 'dist/ not built' }, () => {
  const pages = ['index.html', 'blog/index.html', 'about/index.html', 'how-we-research/index.html', 'how-we-score/index.html',
    'editorial-policy/index.html', 'affiliate-disclosure/index.html', 'privacy-policy/index.html', 'terms/index.html',
    'contact/index.html', 'safe-buying-checklist/index.html', 'brands/index.html', 'search/index.html', '404.html',
    'sitemap-index.xml', 'robots.txt', `${SITE.indexing.indexNowKey}.txt`];
  for (const c of SITE.categories) pages.push(`category/${c.slug}/index.html`);
  for (const p of pages) assert.ok(fs.existsSync(path.join(DIST, p)), `missing ${p}`);
  assert.match(read('robots.txt'), new RegExp(`Sitemap: ${SITE.url.replace(/\./g, '\\.')}/sitemap-index\\.xml`));
  assert.doesNotMatch(read('index.html'), /noindex/, 'home must be indexable');
  assert.match(read('index.html'), new RegExp(`<link rel="canonical" href="${SITE.url}/"`));
});

test('empty category, brand and blog pages are noindex and stay out of the sitemap', { skip: !built && 'dist/ not built' }, () => {
  const sitemap = fs.readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map(read).join('\n');
  const hasPosts = blogPages().some((p) => !/\/(de|es|nl)\/blog\//.test(p));
  for (const c of SITE.categories) {
    const html = read(`category/${c.slug}/index.html`);
    if (!html.includes('class="posts"')) {
      assert.match(robotsOf(html), /noindex/, `${c.slug}: empty category must be noindex`);
      assert.ok(!sitemap.includes(`/category/${c.slug}/`), `${c.slug}: empty category in sitemap`);
    }
  }
  if (!hasPosts) {
    assert.match(robotsOf(read('blog/index.html')), /noindex/, 'empty blog listing must be noindex');
    assert.ok(!sitemap.includes(`${SITE.url}/blog/<`) && !new RegExp(`<loc>${SITE.url}/blog/</loc>`).test(sitemap), 'empty blog listing in sitemap');
    assert.ok(!fs.existsSync(path.join(DIST, 'brand')) || fs.readdirSync(path.join(DIST, 'brand')).length === 0, 'brand pages rendered without any guide');
    assert.ok(new RegExp(`<loc>${SITE.url}/</loc>`).test(sitemap), 'home missing from sitemap');
  }
});

// Owner rule: no colon in any title or seoTitle, and both carry the exact keyword.
test('titles have no colon and contain the exact keyword', async () => {
  const { titleRules } = await import('../agents/qa-agent.mjs');
  assert.deepEqual(titleRules({ title: 'Best Smart Lock for Renters – 4 Picks', seoTitle: 'Best Smart Lock for Renters', keyword: 'best smart lock for renters' }), []);
  assert.equal(titleRules({ title: 'Best Smart Locks for Renters: 4 Picks', keyword: 'best smart lock for renters' }).length, 2);
  const dir = path.join(ROOT, 'src/content/blog');
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.md'));
  const bad = [];
  for (const f of files) {
    const fm = fs.readFileSync(path.join(dir, String(f)), 'utf8').split('\n---')[0];
    const get = (k) => (fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').replace(/''/g, "'");
    for (const p of titleRules({ title: get('title'), seoTitle: get('seoTitle'), keyword: get('keyword') })) bad.push(`${f}: ${p}`);
  }
  assert.deepEqual(bad, []);
});

test('no built page title has a colon', { skip: !fs.existsSync(path.join(ROOT, 'dist')) && 'dist/ not built' }, () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'dist'), { recursive: true })) {
    if (!String(f).endsWith('index.html')) continue;
    const t = fs.readFileSync(path.join(ROOT, 'dist', String(f)), 'utf8').match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    if (t.includes(':')) bad.push(`${f}: ${t}`);
  }
  assert.deepEqual(bad, []);
});

test('a broad keyword is not a duplicate of a longer post keyword with 2+ extra qualifiers', () => {
  assert.equal(overlap('best tripod for photography', 'monopod vs tripod for sports photography') < 0.75, true);
  assert.equal(overlap('smart lock for apartment', 'smart lock for apartment renters') >= 0.75, true);
});
