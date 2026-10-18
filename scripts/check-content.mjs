// Fails the build if any post has broken internal links or malformed affiliate links.
// Covers English posts and translations (src/content/blog/<lang>/<slug>.md).
import { listPosts, listTranslations } from '../agents/lib/store.mjs';
import { SITE } from '../agents/lib/config.mjs';

const posts = listPosts();
const translations = listTranslations();
const slugs = new Set(posts.map((p) => p.slug));
const ids = new Set(translations.map((t) => t.id));
const errors = [];
for (const p of posts) {
  for (const m of p.content.matchAll(/\]\(\/blog\/([^)/]+)\/?\)/g)) {
    if (!slugs.has(m[1])) errors.push(`${p.slug}: internal link to missing post "${m[1]}"`);
  }
  for (const m of p.content.matchAll(/\]\(amzn:([^)]*)\)/g)) {
    if (!m[1].trim() || /\s/.test(m[1])) errors.push(`${p.slug}: malformed amzn link "${m[1]}"`);
  }
  for (const r of p.data.related || []) if (!slugs.has(r)) errors.push(`${p.slug}: related post "${r}" missing`);
}
for (const t of translations) {
  if (!SITE.locales?.[t.lang] || t.lang === SITE.defaultLocale) errors.push(`${t.id}: folder "${t.lang}" is not a translation locale in site.config.json`);
  if (t.data.lang !== t.lang) errors.push(`${t.id}: lang "${t.data.lang ?? ''}" doesn't match its folder`);
  if (!t.data.translationOf || !slugs.has(t.data.translationOf)) errors.push(`${t.id}: translationOf "${t.data.translationOf ?? ''}" is not an English post`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug)) errors.push(`${t.id}: slug must be lowercase ASCII with hyphens`);
  for (const m of t.content.matchAll(/\]\(\/(?:([a-z]{2})\/)?blog\/([^)/#]+)\/?[^)]*\)/g)) {
    const ok = m[1] ? ids.has(`${m[1]}/${m[2]}`) : slugs.has(m[2]);
    if (!ok) errors.push(`${t.id}: internal link to missing post "${m[1] ? `${m[1]}/` : ''}${m[2]}"`);
  }
  for (const m of t.content.matchAll(/\]\(amzn:([^)]*)\)/g)) {
    if (!m[1].trim() || /\s/.test(m[1])) errors.push(`${t.id}: malformed amzn link "${m[1]}"`);
  }
  for (const r of t.data.related || []) if (!ids.has(r)) errors.push(`${t.id}: related post "${r}" missing (use '${t.lang}/<slug>' ids)`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`content OK: ${posts.length} posts${translations.length ? `, ${translations.length} translations` : ''}`);
