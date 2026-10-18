# Best-Safe.com

Honest, research-based buying guides for safes: handgun and bedside safes, gun
safes, fireproof and document safes, home safes, car and vehicle safes, wall and
floor safes, lock boxes and safe accessories. A static Astro 5 site on
Cloudflare Pages with an agentic content pipeline: keyword research, product
research, semantic-SEO writing, a QA gate and internal linking, published on a
daily schedule (see `ROUTINE.md` for the Claude Routine playbook and
`.claude/agents/` for the subagents).

Every product gets a **Best Safe Score** (security, fire protection, access,
capacity, value; see `src/lib/score.mjs` and `/how-we-score/`). Criterion labels
for every language live in `src/i18n/<lang>.json` (`score.criterion.*`).

## GitHub secrets

Settings → Secrets and variables → Actions:

| Secret | Needed for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy (`.github/workflows/deploy.yml`). Permissions: Account › Cloudflare Pages › Edit, plus Zone › DNS › Edit and Zone › Read for best-safe.com. Without it the deploy is skipped. |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy. The workflow falls back to a built-in account ID if unset; set it if the site lives in a different Cloudflare account. |
| `AMAZON_CREATORS_CREDENTIAL_ID` | Amazon Creators API: real ASINs and product photos (`amazon-refresh.yml`, `publish.yml`). |
| `AMAZON_CREATORS_CREDENTIAL_SECRET` | Same as above. |
| `AHREFS_API_KEY` | Optional. Keyword data for the API-driven keyword agent (falls back to Google Autocomplete). |
| `ANTHROPIC_API_KEY` | Optional. Only for the hourly API-driven publisher (`publish.yml`); the daily Claude Routine does not need it. |
| `GSC_SERVICE_ACCOUNT_JSON` | Optional. Submits the sitemap to Google Search Console after deploys. |

Optional repository variables: `AMAZON_TAG` (overrides `affiliate.amazonTag` in
`site.config.json`), `AMAZON_CREATORS_VERSION`, `CLAUDE_MODEL`,
`CLOUDFLARE_ZONE_ID` (otherwise looked up from the domain).

Never commit secrets to the repository.

## Setup checklist

1. Check `site.config.json` → `affiliate.amazonTag` (currently `mikahtech-20`;
   change it when this site gets its own tracking ID).
2. Add the secrets above, push to the default branch (`main`) and point
   best-safe.com's nameservers to Cloudflare. The deploy creates the
   `best-safe` Pages project and attaches `best-safe.com` + `www`.
3. Replace the editorial-team author in `site.config.json → authors` with a
   real person when you have one (never invent credentials).
4. Submit `https://best-safe.com/sitemap-index.xml` to Google Search Console
   and Bing Webmaster Tools. The IndexNow key file is `public/<indexNowKey>.txt`.
5. The domain has a link history (expired domain): audit its referring domains
   and anchors before launch and disavow spam if needed.

## Commands

```bash
npm run dev                         # local site
npm run build                       # production build to dist/
npm run check:content               # validate internal + affiliate links
npm test                            # agent decision logic + built-page checks
node scripts/routine.mjs status     # today's quota and queue size
node scripts/routine.mjs next       # next keyword to write
npm run images -- --pages --brand   # share images, logo-512.png, og-default.png
npm run amazon:refresh              # refresh ASINs + product photos
```

## Files

- `site.config.json`: brand, categories, brands, authors, affiliate tag, schedule, keyword rules, QA dates
- `data/keywords.json`: keyword queue (Ahrefs US data); `data/state.json`: publish log;
  `data/seeds.json`: keyword research seeds; `data/stories.json`: true owner stories
- `src/content/blog/*.md`: articles (products, FAQs and sources in frontmatter)
- Affiliate links in markdown: `[Product](amzn:Product+Name)` or `[Product](amzn:B0XXXXXXXX)`
