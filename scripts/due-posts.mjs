// Prints "due=true" (for $GITHUB_OUTPUT) when a post's pubDate passed within
// the last `windowMinutes`, i.e. it is scheduled to go live and the site needs
// a rebuild for it to appear. Used by .github/workflows/scheduled-release.yml.
import { listPosts } from '../agents/lib/store.mjs';
import { readQa } from '../agents/qa-agent.mjs';

const windowMinutes = Number(process.argv[2] || 90);
const now = Date.now();
const due = listPosts().filter((p) => {
  const t = Date.parse(p.data.pubDate);
  return !p.data.draft && t <= now && t > now - windowMinutes * 60000 && readQa(p.slug)?.pass;
});
for (const p of due) console.error(`due: ${p.slug} (${p.data.pubDate})`);
console.log(`due=${due.length > 0}`);
