// Patent rule 2026-10-24 (US7716225B1, reasonable surfer): when a post goes live, add 1 in-body link to it from
// 2 related live English posts. The post's agent prepares them in data/briefs/<slug>.json as
//   "pendingInlinks": [{ "slug": "<live post>", "find": "<exact sentence in its body>", "replace": "<same sentence with [anchor](/blog/<slug>/)>" }]
// Run at go-live, before the deploy:  node scripts/apply-inlinks.mjs <slug>
// Each edit applies only if `find` occurs exactly once in a live post's body and `replace` links to /blog/<slug>/;
// then factcheck + qa run for the edited post (it must still pass, or the edit is reverted).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BLOG_DIR, DATA_DIR } from '../agents/lib/config.mjs';

const slug = process.argv[2];
if (!slug) throw new Error('usage: node scripts/apply-inlinks.mjs <slug>');
const briefFile = path.join(DATA_DIR, 'briefs', `${slug}.json`);
const brief = fs.existsSync(briefFile) ? JSON.parse(fs.readFileSync(briefFile, 'utf8')) : {};
const items = (brief.pendingInlinks ?? []).filter((i) => !i.appliedAt);
if (!items.length) {
  console.log(JSON.stringify({ slug, applied: 0, note: 'no pendingInlinks in the brief' }));
  process.exit(0);
}
const routine = (...args) => execFileSync('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'routine.mjs'), ...args], { encoding: 'utf8' });
const results = [];
for (const item of items) {
  const file = path.join(BLOG_DIR, `${item.slug}.md`);
  const target = `](/blog/${slug}/)`;
  if (!fs.existsSync(file) || !item.find || !item.replace?.includes(target)) {
    results.push({ slug: item.slug, ok: false, why: 'missing post, find text or link' });
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  const pub = before.match(/^pubDate:\s*['"]?([^'"\n]+)/m)?.[1];
  if (!pub || Date.parse(pub) > Date.now()) {
    results.push({ slug: item.slug, ok: false, why: 'not live yet' });
    continue;
  }
  if (before.includes(target)) {
    results.push({ slug: item.slug, ok: false, why: 'already links to the post' });
    continue;
  }
  if (before.split(item.find).length !== 2) {
    results.push({ slug: item.slug, ok: false, why: 'find text not found exactly once' });
    continue;
  }
  fs.writeFileSync(file, before.replace(item.find, item.replace));
  try {
    routine('factcheck', item.slug, `added one internal link to ${slug}, no claim changed`);
    const pass = /"pass":\s*true/.test(routine('qa', item.slug));
    if (!pass) throw new Error('qa failed');
    item.appliedAt = new Date().toISOString();
    results.push({ slug: item.slug, ok: true });
  } catch (e) {
    fs.writeFileSync(file, before);
    results.push({ slug: item.slug, ok: false, why: `reverted: ${e.message.split('\n')[0]}` });
  }
}
fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2) + '\n');
console.log(JSON.stringify({ slug, applied: results.filter((r) => r.ok).length, results }, null, 2));
