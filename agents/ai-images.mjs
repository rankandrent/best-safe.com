// Media for posts without product photos (owner rule: no text-only posts).
// 1. AI illustrations: every `illustrations` entry without a `src` gets an
//    image from Cloudflare Workers AI (FLUX.1 schnell), saved as
//    public/images/ai/<english-slug>-<n>-<prompt hash>.webp. An existing file
//    with that name is reused (a changed prompt gets a new image), so sites
//    that generate at deploy time and cache the folder never pay twice.
//    Translations reuse the English post's images (same index) and only
//    translate the alt text.
// 2. YouTube videos: every `videos` entry not checked in the last 7 days is
//    looked up with YouTube oEmbed; title/channel are filled in, removed or
//    non-embeddable videos are dropped.
// Runs from .github/workflows/ai-images.yml with CLOUDFLARE_API_TOKEN (needs
// the "Workers AI" permission) and CLOUDFLARE_ACCOUNT_ID. Without them the
// image step is skipped and only the videos are checked.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { ROOT, log } from './lib/config.mjs';
import { listPosts, listTranslations } from './lib/store.mjs';

const AGENT = 'ai-images';
const OUT_DIR = path.join(ROOT, 'public/images/ai');
const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const STYLE = 'realistic editorial photograph, natural light, shallow depth of field, no text, no letters, no logos, no brand names, no watermark';
const W = 1200;
const H = 800;
const RECHECK_MS = 7 * 86400000;

function save(post, data) {
  const plain = JSON.parse(JSON.stringify(data));
  fs.writeFileSync(post.file, matter.stringify(`\n${post.content.trim()}\n`, plain));
}

async function generate(prompt) {
  const token = String(process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${prompt}. ${STYLE}`, steps: 8 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.result?.image) throw new Error(`Workers AI ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  return Buffer.from(body.result.image, 'base64');
}

export async function addIllustrations({ limit = 40 } = {}) {
  let canGenerate = Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
  if (!canGenerate) log(AGENT, 'CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set; only reusing existing images');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let made = 0;
  for (const post of listPosts()) {
    const list = post.data.illustrations ?? [];
    let changed = false;
    for (const [i, x] of list.entries()) {
      const rel = `/images/ai/${post.slug}-${i + 1}-${crypto.createHash('sha1').update(x.prompt).digest('hex').slice(0, 8)}.webp`;
      const file = path.join(ROOT, 'public', rel);
      if (x.src === rel && fs.existsSync(file)) continue;
      if (!fs.existsSync(file)) {
        if (!canGenerate || made >= limit) continue;
        try {
          const raw = await generate(x.prompt);
          await sharp(raw).resize(W, H, { fit: 'cover' }).webp({ quality: 80 }).toFile(file);
        } catch (e) {
          log(AGENT, `${post.slug} #${i + 1}: ${e.message}`);
          if (/\b(401|403)\b/.test(e.message)) canGenerate = false; // token lacks the Workers AI permission
          continue;
        }
        made++;
        log(AGENT, `${post.slug} #${i + 1}: ${rel}`);
      }
      Object.assign(x, { src: rel, width: W, height: H });
      changed = true;
    }
    if (changed) save(post, post.data);
  }
  // Translations: same images as the English post, by index.
  const en = new Map(listPosts().map((p) => [p.slug, p.data.illustrations ?? []]));
  for (const tr of listTranslations()) {
    const list = tr.data.illustrations ?? [];
    const src = en.get(tr.data.translationOf) ?? [];
    let changed = false;
    for (const [i, x] of list.entries()) {
      if (src[i]?.src && x.src !== src[i].src) { Object.assign(x, { src: src[i].src, width: src[i].width, height: src[i].height }); changed = true; }
    }
    if (changed) { save(tr, tr.data); log(AGENT, `${tr.id}: reused English illustrations`); }
  }
  log(AGENT, `${made} images generated`);
  return made;
}

export async function checkVideos() {
  let changed = 0;
  for (const post of [...listPosts(), ...listTranslations()]) {
    const list = post.data.videos ?? [];
    if (!list.length) continue;
    const keep = [];
    let dirty = false;
    for (const v of list) {
      if (v.checked && Date.now() - Date.parse(v.checked) < RECHECK_MS) { keep.push(v); continue; }
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.id}`)}`;
      let res;
      try { res = await fetch(url); } catch (e) { log(AGENT, `${post.id ?? post.slug}: oEmbed ${v.id} failed (${e.message}); kept`); keep.push(v); continue; }
      if (res.ok) {
        const o = await res.json();
        keep.push({ ...v, title: o.title, channel: o.author_name, checked: new Date().toISOString().slice(0, 10) });
      } else if ([400, 401, 403, 404].includes(res.status)) {
        log(AGENT, `${post.id ?? post.slug}: video ${v.id} dropped (oEmbed ${res.status}: removed, private or not embeddable)`);
      } else { keep.push(v); continue; }
      dirty = true;
    }
    if (dirty) { post.data.videos = keep; save(post, post.data); changed++; }
  }
  log(AGENT, `${changed} posts with updated videos`);
  return changed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await checkVideos();
  await addIllustrations();
}
