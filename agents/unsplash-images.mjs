// Adds related Unsplash photos to posts that don't have any yet: one hero photo
// (used behind the hero product shot) and up to two inline photos placed after
// H2 sections. Posts can set `photoQuery` to steer the search. Each photo is
// used on one post only (data/unsplash-used.json). Runs from
// .github/workflows/unsplash-images.yml with UNSPLASH_ACCESS_KEY.
import fs from 'node:fs';
import path from 'node:path';
import { log } from './lib/config.mjs';
import { listPosts, writePost } from './lib/store.mjs';
import { searchPhotos, toPhoto, trackDownload } from './lib/unsplash.mjs';

const AGENT = 'unsplash';
const USED = path.resolve('data/unsplash-used.json');
const STOP = new Set(('best top cheap budget for with without no to the a an in of on and or vs versus your my do does i need one what is are ' +
  'how why which should can renters renter rental rentals beginners beginner under over feet pounds lb inch inches 2024 2025 2026 friendly ' +
  'drill drilling damage free').split(' '));

export function photoQuery(post) {
  if (post.data.photoQuery) return post.data.photoQuery;
  const words = String(post.data.keyword || post.data.title).toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
  return words.slice(0, 4).join(' ');
}

export async function addPhotos({ force = false, limit = 50 } = {}) {
  const used = new Set(fs.existsSync(USED) ? JSON.parse(fs.readFileSync(USED, 'utf8')) : []);
  for (const p of listPosts()) for (const ph of p.data.photos ?? []) used.add(ph.id);
  let changed = 0;
  for (const post of listPosts()) {
    if (changed >= limit) break;
    if (!force && (post.data.photos ?? []).length) continue;
    const query = photoQuery(post);
    if (!query) continue;
    let results;
    try {
      results = await searchPhotos(query);
    } catch (e) {
      log(AGENT, `${post.slug}: ${e.message}`);
      if (/403|429|Rate Limit/i.test(e.message)) break;
      continue;
    }
    const fresh = results.filter((r) => !used.has(r.id) && (r.alt_description || r.description));
    if (!fresh.length) { log(AGENT, `${post.slug}: no unused photo for "${query}"`); continue; }
    const h2 = (post.content.match(/^## /gm) ?? []).length;
    const photos = [toPhoto(fresh[0], { placement: 'hero', w: 1200, h: 630 })];
    const spots = [2, 4].filter((n) => n <= h2);
    spots.forEach((n, i) => { if (fresh[i + 1]) photos.push(toPhoto(fresh[i + 1], { placement: 'inline', afterHeading: n })); });
    for (const ph of photos) { used.add(ph.id); await trackDownload(ph.downloadLocation); delete ph.downloadLocation; }
    writePost(post.slug, { ...post.data, photos }, post.content);
    log(AGENT, `${post.slug}: ${photos.length} photos for "${query}"`);
    changed++;
  }
  fs.writeFileSync(USED, JSON.stringify([...used].sort(), null, 1) + '\n');
  log(AGENT, `${changed} posts updated`);
  return changed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await addPhotos({ force: process.argv.includes('--force') });
}
