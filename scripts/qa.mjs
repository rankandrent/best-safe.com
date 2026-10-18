// QA agent CLI.
//   node scripts/qa.mjs <slug>            check one English post
//   node scripts/qa.mjs <lang>/<slug>     check one translation (report: data/qa/<lang>/<slug>.json)
//   node scripts/qa.mjs --all [--online]  check every post and translation (CI adds --online)
//   node scripts/qa.mjs --failing         list posts that are blocked
import { listPosts, listTranslations } from '../agents/lib/store.mjs';
import { qaPost, qaTranslation, readQa } from '../agents/qa-agent.mjs';
import { hasAmazonApi, getItems } from '../agents/lib/amazon.mjs';

const args = process.argv.slice(2);
const online = args.includes('--online');
const posts = listPosts();
const translations = listTranslations();

if (args.includes('--failing')) {
  const all = [...posts.map((p) => p.slug), ...translations.map((t) => t.id)];
  const failing = all.map((id) => readQa(id) ?? { slug: id, pass: false, errors: ['no QA report'] }).filter((r) => !r.pass);
  console.log(JSON.stringify(failing.map((r) => ({ slug: r.slug, errors: r.errors })), null, 2));
  process.exit(0);
}

let live = null;
if (online && hasAmazonApi()) {
  const asins = [...new Set([...posts, ...translations].flatMap((p) => (p.data.products ?? []).map((x) => x.asin).filter(Boolean)))];
  live = new Map((await getItems(asins)).map((i) => [i.asin, i]));
}

const all = args.includes('--all');
const targets = all ? posts : posts.filter((p) => args.includes(p.slug));
const tTargets = all ? translations : translations.filter((t) => args.includes(t.id));
const unknown = args.filter((a) => !a.startsWith('--') && !targets.some((p) => p.slug === a) && !tTargets.some((t) => t.id === a));
if (unknown.length) console.error(`no such post: ${unknown.join(', ')}`);
if (!targets.length && !tTargets.length) {
  console.error('usage: node scripts/qa.mjs <slug> | <lang>/<slug> | --all [--online] | --failing');
  process.exit(1);
}
let blocked = 0;
const print = (id, r) => {
  if (!r.pass) blocked++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${id}`);
  for (const e of r.errors) console.log(`   ✗ ${e}`);
  for (const w of r.warnings) console.log(`   ! ${w}`);
};
for (const post of targets) print(post.slug, await qaPost(post, { posts, online, live }));
// Translations after English, so they see today's English QA results.
for (const tr of tTargets) print(tr.id, await qaTranslation(tr, { posts, translations, online, live }));
const n = targets.length + tTargets.length;
console.log(`${n - blocked}/${n} posts pass QA${tTargets.length ? ` (${tTargets.length} translations)` : ''}`);
