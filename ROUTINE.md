# Daily publishing routine (Claude Routine playbook)

A scheduled Claude Code session runs this playbook once a day. It does the work of
the four agents in `agents/` itself (no Anthropic API key needed), then pushes,
which triggers the Cloudflare deploy and the Amazon image refresh.

**Clicks and long visits (Google's click-validated quality):** titles must earn the click and the page must keep
the visit. seoTitle = the exact keyword in title case and nothing else (owner rule, 2026-10-19: no year, number, benefit or
site name; the page `<title>` is exactly that). The H1 `title` starts with the keyword; a year is not required; the description
answers the query; the first screen delivers the promise (short answer, top picks). Never buy links or ask for paid
links: links that searchers don't confirm with clicks are discounted, and spam-prone queries lean on clicks.

**Best Safe Score (every product):** give each product `scores` {security (lock, backup entry, steel, bolt work,
independent burglary ratings), fire (fire protection; leave out only for products that make no fire claim and aren't
meant to resist fire, e.g. car safes, plain lock boxes, accessories), access (speed and ease, incl. owner reports on
fingerprint readers and keypads), capacity, value}, each 1-10 using the rubric on `/how-we-score/`, and a
one-line `scoreNote` with the reasons. The site computes the 1-5 score and the Product + Review schema. Never use or
copy Amazon (or any store's) star ratings or review counts.

**Voice and personal story (every post):** first person throughout (I, my, me, we, our, us; at least 10 uses),
plus one `> **From our notes:**` story block (60-120 words). Use a real owner story from `data/stories.json` if one
fits, otherwise a true research story (how we compared the products, what stood out in the manuals and specs), or a
clearly framed scenario ("Picture someone who keeps a handgun by the bed and wakes to a noise at 3 a.m.…"). Never claim we bought, owned, installed or tested a product unless
`data/stories.json` says so (then set `ownerStory: true` in the frontmatter). The QA agent checks both.

**Safe-buyer angle (every post):** write for someone choosing a safe for what they actually store and protect
(a handgun by the bed, long guns, documents and passports, cash and jewelry, a pistol in the car). Information gain
over other pages: who certified the fire rating (UL 72 classes or Intertek/ETL vs the maker's own claim) and what it
covers (duration, temperature, paper vs digital media), lock type and the backup entry when batteries or biometrics
fail, steel gauge (lower number = thicker), bolt work and pry points, access speed in the dark, interior capacity vs
what is stored, and bolt-down/anchoring. Legal storage: point readers to official state and local firearm storage
rules (and listings like the California DOJ roster) without giving legal advice; never publish instructions for
opening or bypassing a safe that isn't the reader's own. Link the buying checklist (`/safe-buying-checklist/`) where
it helps.

**Old-URL recovery (generic mechanism):** if this domain ever has indexed URLs that need new homes, add them to
`data/redirects.json` (`from`, `to`, optional `pendingSlug`) and queue the replacement keyword with
`restoresOldUrl`. Keep its `slug` exactly as queued; the old URL 302s to `to` until the `pendingSlug` post is live
and passes QA, then 301s to `/blog/<slug>/`.

**Owner-supplied keywords:** queue items with `source: "user"` came from the site owner. Write them as given:
they skip the volume cap and the cannibalization check, and `next` serves them first. Items marked
`duplicateOf` share intent with a live post, so they're queued last; give them a distinct angle from that post.

**Agents and models (saves tokens):** don't do every step yourself. Hand each step to its subagent in
`.claude/agents/` with the Agent tool (`subagent_type` = the agent's name), passing the slug, keyword item,
productCount and slot time it needs, and act on what it returns:
| Step | Agent | Model |
|---|---|---|
| 1, 2b keywords | `keyword-agent` | sonnet |
| 1a competitor gap keywords | `competitor-gap-agent` | sonnet |
| 1p reader pain points | `pain-point-agent` | sonnet |
| 3 products | `product-agent` | sonnet |
| 4 brief + serpStructure | `brief-agent` | sonnet |
| 6-7 write + audit | `writer-agent` | opus |
| 7b fact check + QA, backlog re-check | `qa-agent` | sonnet |
| 8-9 finalize, build, push | `publisher-agent` | haiku |
| Translations (de, es, nl) | `translator-agent` | opus |
**Live dashboard (optional):** if the owner has set up a runs dashboard artifact, use the ArtifactData tool to keep collection `runs` (doc id = slug: site, slug, title, url, pubDate, status
running|scheduled|live|failed, updatedAt ms, steps.{keyword,product,brief,writer,qa,publisher} = {state
running|done|failed, model, ms, note}) and `sites/<domain>` (quotaToday, publishedToday, pendingKeywords,
nextRun) up to date as each agent starts and finishes. Skip silently if the tool isn't available.
Run products and brief in parallel. You (the main session) only check status, pick the keyword and slot,
pass results between agents and write the final summary. If an agent fails, retry it once, then skip the post.

**Rules that always apply**
- Keep it natural, with something genuinely new for crawlers every day: a new post on most days
  (random times, quota 4-5), plus the daily QA backlog re-check of one older post. When the re-check
  changes the post's content, set `updatedDate` to now and `reviewedDate` to today; if nothing changed,
  set only `reviewedDate`. Never bump dates, reorder text or make cosmetic edits just to look fresh.
- Concise and new (owner rule, from 2026-10-20): a post gives the reader exactly what they need. Length follows the
  top results (targetWords ≈ their average, +10% at most), never padded. The brief lists `commonPoints` (what every
  top result says; covered briefly) and `ourGain` (3-5 sourced things we add; covered in depth). The body opens with the
  direct answer, has no filler or repeated points, and ends with links to the reader's next question. QA enforces
  length, filler and repeats (errors for new posts, warnings for older ones; older posts get trimmed in the backlog).
- Posts go live at random times of day: always use the `slots` times as pubDate, never the current time.
- Never publish more than the day's quota (`remainingToday`, at most 5 posts per day). The site owner does not want
  batches of posts going live at once, so never publish 5 (or several) posts in one go, even if asked by a scheduled prompt.
- Volume and KD caps: target keywords inside `site.config.json → keywordRules` (≤ 2,500 searches/month and KD ≤ 10
  for this site: safe head terms like "best fireproof safe" are core topics here). Higher-competition pillars
  (e.g. "best home safe", "best gun safe") only enter the queue as owner keywords (`source: "user"`).
- No keyword cannibalization: before writing, run `node scripts/routine.mjs cannibal "<keyword>"`. If it reports
  a conflict, do not write a new post; add the keyword to that post's `secondaryKeywords` instead.
- Never invent product names, specs, prices, star ratings, review counts or testing
  claims. Only state what your web research supports. No prices at all.
- Never write secrets, API keys or tokens into any file.
- Never push a failing build. If something breaks and you can't fix it, stop and
  leave the repo unchanged (no commit).
- Work on the repository's default branch; push to it directly.

## 0. Setup
```bash
DEFAULT=$(git remote show origin | sed -n 's/.*HEAD branch: //p')
git fetch origin "$DEFAULT" && git checkout -B "$DEFAULT" "origin/$DEFAULT"
npm ci
node scripts/routine.mjs status
node scripts/qa.mjs --failing
```
If `--failing` lists posts, fix them first (they are blocked from going live). Then, as
QA backlog work, fact-check **one** older post whose QA report has a `LIVE POST, FIX` or
`facts not verified` warning: verify it against its sources, fix it, and run `factcheck` and `qa` for it.
Trim backlog (owner rule: concise and new): tighten **one** older post a day, AFTER today's English posts are pushed
(new posts always come first; do it before translation work):
1. `node scripts/routine.mjs trim-queue` and take the first entry (skip this if the queue is empty).
2. If `data/briefs/<slug>.json` has no `commonPoints`/`ourGain`, have `brief-agent` add just those two fields (and
   `serpStructure.avgWords` if missing) from the SERP, without rewriting the rest of the brief.
3. `writer-agent` in **tighten mode** on `<slug>`: keep the URL, slug, keyword, title, products, sources, pubDate and
   every fact a reader needs; open with the direct answer; shorten the brief's `commonPoints` to a sentence or two;
   add any missing `ourGain` points with their source; cut filler, repeated points and padding toward the QA word
   limit (never cut a product, a pain-point answer or a safety note just to hit the number).
4. `qa-agent <slug>` (it must still pass), then set `updatedDate` to now and `reviewedDate` to today,
   `node scripts/routine.mjs trimmed <slug> "<words before> -> <words after>"`, build, commit and push.
   Translations stay as they are; they are re-done only if a fact changed.
Tracking: rentersmarthome.us takes a daily Search Console snapshot of all three sites (gsc-snapshot.yml,
data/gsc/<domain>/ in that repo). `node /home/user/rentersmarthome.us/scripts/trim-report.mjs <this repo> <domain>`
compares each trimmed post 4+ weeks after the trim with the untrimmed posts. Every Monday run it and put the result
in the summary; if trimmed posts do worse than the control group, stop trimming and tell the owner.
If `remainingToday` is 0, stop here (no commit). Otherwise publish that many posts
(steps 2–8 per post).

## 1. Keyword research (only if `pendingKeywords` < 10)
Follow the rules in the `SYSTEM` prompt of `agents/keyword-agent.mjs`.
- Use **KGR-style long-tail** research (Keyword Golden Ratio). With the **Ahrefs**
  connector: `keywords-explorer-matching-terms` (country `us`, `terms: all`) with seeds
  from `data/seeds.json` (e.g. pistol safe, fireproof document safe, gun safe, wall safe, key lock box,
  gun safe dehumidifier) and a `where` filter of
  `word_count ≥ 3`, `volume 10–2500`, `difficulty ≤ 10`, `serp_domain_rating_top10_min ≤ 30`,
  excluding "near me", "for sale", "black friday", retailer names (Tractor Supply, Academy, Cabela's, Harbor
  Freight) and single-model searches. Ahrefs KD is often 0-10 for safe terms even when DR 60-95 sites rank,
  so the SERP check below decides. Read the Ahrefs `doc` tool first for the schema.
- For the best 3–5 candidates run `serp-overview` (top 10 organic): count how many
  titles contain the exact phrase and note the weakest DR. Prefer keywords where few
  or no titles match exactly and low-DR sites, forums or Reddit rank (KGR-style win).
  Skip keywords where every result is a DR 70+ publisher.
- Pick ~10 winnable keywords with a clear safe-buyer angle (bedside handgun access, long guns, documents, cash and jewelry, vehicle, fire protection, bolt-down), each tagged `funnel: tofu|mofu|bofu` (see the funnel rule in the keyword agent prompt), that do not duplicate existing posts
  or queued keywords (same intent = duplicate). Merge variants that share a parent
  topic into `secondaryKeywords`.
- Write them to a temp JSON file as an array of
  `{keyword, category, articleType, intent, funnel, secondaryKeywords, questions, workingTitle, cluster, priority, rationale, ahrefs:{volume, kd, trafficPotential}}`
  and run `node scripts/routine.mjs add-keywords <file>`.
- Ahrefs data is required: `routine.mjs next` holds any keyword without recorded Ahrefs volume + KD as `needs-data`, enforces `keywordRules.maxVolume` and `maxKd`, and treats ≥4 shared top-10 URLs (from `data/serps.json`, written by `routine.mjs save-serp`) as the same intent. If Ahrefs is unavailable, add no keywords and report it; never estimate volumes. Web search may only suggest ideas that then get Ahrefs data.

## 2. Pick the keyword
`node scripts/routine.mjs next` → use this item (it automatically parks keywords over the `keywordRules` volume and KD caps
and merges any keyword that would cannibalize an existing post). Its `slug` is the post slug. It already balances the
funnel (≈30% TOFU, 30% MOFU, 40% BOFU); follow the FUNNEL RULES in `WRITE_SYSTEM` for its `funnel` stage
and put `funnel: <stage>` in the frontmatter.

## 2b. Equivalent keywords from autocomplete
Search engines group "equivalent keywords" for a prefix and rank them by how often people search them
(the idea behind search-box autocomplete). Use that to make one post cover every way people phrase the
same need: run Ahrefs `keywords-explorer-search-suggestions` (or web search autocomplete) on the keyword
and on its first 2-3 words, keep suggestions with the SAME intent, and add the best 3-6 to
`secondaryKeywords` (they become H2/H3 wording, FAQ questions and meta keywords). Suggestions with a
different intent go to the queue as their own keywords instead, never into this post (no cannibalization).

## 3. Product research
**Pick products from the top 10 (required).** Search the post's primary keyword on Google (WebSearch;
also `best <product type>` if the keyword is a question). Take the top 10 organic pages, skipping Amazon,
shopping and video results, and list the products each page recommends (read the page with Firecrawl `firecrawl_scrape`, or WebFetch if that fails, when it
loads, otherwise search `"<site>" <keyword>` for its product list). Rank the products by how many of those
pages recommend them and choose from the top of that list: each product must be recommended by at least 2 of
the top-10 pages and be a popular, well-stocked Amazon US listing (searching its brand + model on Amazon
shows it at once, not a lone obscure listing). Never add a product that no top-10 page recommends; if too
few products qualify, lower `productCount` to the number that do (at least 3 for roundups). Record the
evidence in the brief as `serpProducts`: `[{"name": "...", "pages": ["url", ...]}]`. Then verify every spec
against the maker or retailer pages as usual.

Feature exactly `productCount` products (from `next`; a random number per post: roundups 3-18,
comparisons 2-6, guides 1-6), never the same count every day. Give every product its own
`### Product name: role` section (about 120-180 words each), so long lists make long, useful posts; set the
brief's `targetWords` to roughly 700 + 150 x productCount. Follow the `SYSTEM` prompt in `agents/product-agent.mjs`, using
web search. For each product: `name` (exact model), `brand`, `query` (what a
shopper types on Amazon), `badge`, `summary`, `renterNote` (shown as "Who it's for": the buyer and what they
store plus the key caveat), `pros`, `cons`, `specs` (lock type and backup entry, exterior and interior dimensions,
weight, capacity, steel gauge or wall thickness, locking bolts, fire rating with duration, temperature and certifying
body, water rating, bolt-down hardware, power, DOJ/state listing), and
the source URLs you used. Name each product the way its Amazon listing names the same model (brand + model words Amazon uses, no extra kit/bundle words), or add a short `matchName` with those words; the Amazon refresh only attaches a photo when every distinctive word of the name is in the listing title, so over-specific names leave the product without a photo. Never point it at a different model or variant. Leave `asin` out: the Amazon refresh workflow adds the
real ASIN and product photo after you push.

## 3b. Owner reviews (required for every product)
For each product, read what real owners say before writing about it. Search `<brand model> review`,
`<brand model> problems`, `<brand model> reddit`, `<brand model> after a year` and read the owner posts you find:
Reddit and forum threads, retailer review pages (Home Depot, Lowe's, Walmart, Best Buy, Sportsman's Warehouse), Trustpilot,
long-term owner write-ups. Count each distinct owner review or post you actually read; that count is
`owners.read`, and it must be honest (never estimate, never round up). Then add to the product:
`owners: { read, praise: [2-3 things owners repeatedly like], complaints: [1-3 things owners repeatedly
report going wrong], sources: [{ title, url }] }`. Summarize in your own words; no quotes from Amazon reviews,
no Amazon URLs, no star ratings or review counts from Amazon (Associates rules). A complaint that many owners
share should also appear in the product's cons and in the review text ("owners on Reddit report..."). The post
then shows a "How we picked these" box with the total reviews read and a "What owners say" block per product,
and lists every owner source at the end.

Also open each product's retailer review pages (Home Depot, Lowe's, Walmart, Best Buy, Target, Sportsman's
Warehouse, Bass Pro Shops) and review-summary sites (ShopSavvy and similar summaries of Amazon reviews): read the review themes and
give that source `reviews: <the number of reviews the page shows>`. Use that number only when you saw it on the
page or in its search result; never estimate it. Amazon reviews themselves may be read for research, but write
the findings in your own words and never quote them, show Amazon star ratings or Amazon review counts.

## 3c. Every product needs its own Amazon listing (ASIN)
A product that links to an Amazon search page instead of its own listing has no photo and is hard to buy, so it
must not ship. Only feature products you have seen on Amazon US as one clear listing. After a push the Amazon
refresh adds the ASIN and photo; if it can't match a product it writes the real Amazon candidates to
`data/amazon-unmatched.json` (`strictMatch: true` marks a certain match). Before writing each day's post, open that
file: for every product listed, either set `asin` to the candidate that is the SAME model (and add a short
`matchName` so the daily refresh keeps matching it), or replace the product with a similar, popular model Amazon does
sell (still recommended by the top-10 pages, step 3), and update the post's text to match. Never point a product at a
different model or variant just to get a photo.

## 4. Semantic brief
Follow `BRIEF_SYSTEM` in `agents/writer-agent.mjs` (search the live SERP for the
keyword). Save it as `data/briefs/<slug>.json` with exactly these fields:
`centralEntity, entityVariants[], entities[{name,type,relation}], attributes[],
ngrams[], skipgrams[] ("word1…word2"), nlpTerms[], questions[], contentGaps[],
outline[{h2,intent,h3[]}], targetWords, serpStructure`.

**Structure follows the top results.** Open the top 5-10 organic results for the keyword and fill
`serpStructure`: `analyzedUrls`, `productStyle` ("pros-cons", "paragraph" or "specs": how most of them
present each product) with `productStyleReason`, `avgWords`, `avgProducts`, `commonSections`,
`usesComparisonTable`, `usesFaq`, `usesBuyingGuide`. Then build the outline from the sections most of
them share, in a similar order, plus the content gaps; set `targetWords` 10-20% above `avgWords`; and set
`productStyle` in the post's frontmatter to the same value:
- `pros-cons`: each product shows What we like / What we don't like lists (fill `pros` and `cons`).
- `paragraph`: no lists are shown; write a 120-200 word review paragraph per product covering strengths
  and drawbacks (still fill `pros`/`cons` for the data, they just aren't displayed).
- `specs`: each product shows a spec table from `specs` (4-8 verified rows, e.g. "Fire rating": "UL Class 350, 1 hour").
  Only use numbers the manufacturer publishes.
The product count stays the random `productCount`.

## 5. Internal links
`node scripts/routine.mjs links <slug>` → choose the 3–5 that genuinely fit.

## 6. Write the post

**Titles come from the SERP (owner rule):** before writing any title, search the keyword (Firecrawl search, US) and record the top-10 titles in the brief as `serpTitles` plus `titlePattern` (how many start with the keyword, carry a year or a number, the shared modifiers, and one angle none of them offer). The seoTitle is always just the keyword (see above). Build the H1 `title` from that pattern: exact keyword first, plus at most one differentiator (no year needed); never copy a top title or borrow a claim we can't make ("Tested"). Meta titles are Google's main on-page relevance signal and the biggest lever on click-through, and Google rewrites titles that don't match the page, so keep the H1 (`title`) consistent with the seoTitle.

**Title rule (owner, permanent, every site and language):** `title` and `seoTitle` never contain a colon (":"); use " – " or parentheses instead. Both must contain the post's exact `keyword` as one unbroken phrase (no plural, no inserted words; case and punctuation don't matter). `routine.mjs qa` fails any post or translation that breaks this, and `npm test` checks every post.
Follow **every** rule in `WRITE_SYSTEM` in `agents/writer-agent.mjs` (semantic SEO,
layout-aware, E-E-A-T, factual, format). Save to `src/content/blog/<slug>.md`.
Frontmatter (copy the shape of an existing post once there is one; the fields are):

```yaml
title, seoTitle (≤60), description (140–160), pubDate (take the next unused time from `node scripts/routine.mjs slots`; posts go live at random times and the hourly Scheduled release workflow publishes each one when its time comes),
category, keyword, secondaryKeywords, entities, tags, articleType, readingTime,
tldr (2–4), productCount (from `next`), products [exactly productCount items: name, brand, query, badge, summary, renterNote, pros, cons, specs, scores {security, fire?, access, capacity, value}, scoreNote],
sources [{title, url}] (manufacturer/standards pages you used, no Amazon URLs),
reviewedDate (today), faqs [{q, a}] (4–6), author: editorial-team
```
Body: intro paragraph, `##` sections each opening with a **bold** direct answer,
`### <exact product name>: <role>` per product in roundups, at least one list,
a comparison table for roundups/comparisons (with a lead-in sentence), product
links as `[Name](amzn:Product+Query)`, internal links as `/blog/<slug>/`.
No H1 and no FAQ section in the body.

## 7. Audit and fix
`node scripts/routine.mjs audit <slug>` → fix every issue it lists and re-run until
`score` ≥ 85 (at most 3 rounds).

## 7b. QA agent (must pass before the post can go live)
The site only publishes posts with a passing QA report (`data/qa/<slug>.json`).
1. **Fact check (you do this):** open every source and the manufacturer pages and verify each
   product name, model, spec (dimensions, weight, capacity, steel gauge, bolts, lock type and backup entry),
   every fire, water and burglary rating with who certified it, every legal-storage or compliance statement
   and every safety statement in the post. Fix or
   remove anything you can't confirm. Then record it:
   `node scripts/routine.mjs factcheck <slug> "<what you verified, against which sources>"`
2. **Automatic checks:** `node scripts/routine.mjs qa <slug>` → it checks prices/star
   ratings/review counts/testing claims, required fields and lengths, FAQs, Amazon links for
   every product, product photo vs Amazon listing, internal links (must already be live),
   sources (https, not Amazon), SEO audit ≥ 85 and cannibalization.
   Fix every error (`✗`) and re-run until it says `"pass": true`. Warnings (`!`) are advisory.
   "No Amazon photo yet" is expected before the push; the Amazon refresh adds it and CI re-runs QA.
If QA can't pass after fixes, don't publish that post: leave it out of the commit.

## 8. Finalize
```bash
node scripts/routine.mjs finalize <slug>   # featured image, backlinks, queue/state, report
```

## 9. Validate and publish
```bash
npm run check:content && npm run build
git add -A src/content data public/images  # includes data/qa
git commit -m "content: <post title>"
git push origin HEAD:"$DEFAULT"
```
The push triggers **Deploy to Cloudflare Pages** (site + IndexNow) and
**Amazon product refresh** (real ASINs + product photos, then redeploy).

Finish with a short summary: posts published (title + URL
`https://best-safe.com/blog/<slug>/`), audit scores, translations published
(`https://best-safe.com/<lang>/blog/<slug>/`), anything skipped and why.

## Translations (de, es, nl)
**PAUSED (owner decision 2026-10-20): English only.** Write no de/es/nl versions (`translations.backlogPerDay: 0`,
`categories: []`). Later, once the posts are indexed and earning, only non-gun topics (fireproof document safes, key
lock boxes) get localized versions, with EU certifications (EN 1143-1, EN 14450, EN 15659, VdS) and EU-sold products.
Gun-safe and ammo topics stay English-only: EU weapons storage law differs by country.

Every English post also gets a localized version per locale in `site.config.json` (`locales`, minus `en`):
`src/content/blog/<lang>/<localized-slug>.md` with `lang` and `translationOf: <english-slug>`, live at
`/<lang>/blog/<localized-slug>/`. Translations go through the same gate: a translation only goes live with a
passing report in `data/qa/<lang>/<slug>.json`. All routine commands take `<lang>/<slug>` for them.

**Amazon (OneLink):** links stay `amazon.com/dp/<ASIN>?tag=...`; Amazon OneLink sends visitors to their
local store. So translations keep the English products and ASINs (no new products, no search links) and
never mention a local Amazon store, local prices, currencies or local availability.

**After each English post passes QA and is pushed** (step 9), for each locale (`de`, `es`, `nl`):
1. `node scripts/routine.mjs translate-slots <lang> --after <english-slug>` → use `pubDates[0]` as the
   translation's pubDate (random, a few hours after now and after the English post, ≥ 2 h from the
   language's other translations, max 5 per language per day). Never use the current time.
2. `translator-agent` with the English slug, the language and that pubDate → returns `<lang>/<slug>`.
3. `qa-agent` with `<lang>/<slug>`: it compares the translation with the English post, records
   `node scripts/routine.mjs factcheck <lang>/<slug> "<notes>"` and runs
   `node scripts/routine.mjs qa <lang>/<slug>` until `"pass": true`.
4. `publisher-agent` with `<lang>/<slug>`: `finalize <lang>/<slug>`, `npm run check:content && npm run build`,
   commit `content (<lang>): <title>`, push.
If a translation can't pass QA after fixes, leave it out of the commit (the English post is unaffected).

**Translation QA rules** (`qa <lang>/<slug>`, on top of the usual field/length/FAQ/voice checks):
`lang` matches the folder; ASCII slug; `translationOf` names an English post that passes QA and doesn't go live
later than the translation; same products in the same count with the same `asin`, `name`, `brand`, `query`,
`scores` and spec keys; every `amzn:` link resolves to one of those products; `sources` and `owners.sources`
are the English URLs; no `amazon.de/.es/.nl` links, prices or currency symbols; no testing/ownership claims
(also in the language: getestet / probado / getest unless negated or credited to UL, Intertek or ETL, gekauft / comprado / gekocht ...);
the translated story block (`> **Aus unseren Notizen:**`, `> **De nuestras notas:**`, `> **Uit onze notities:**`);
at least 10 first-person words; body at least 60% of the English word count. The SEO audit runs only when a
language brief exists (`data/briefs/<lang>/<slug>.json`); otherwise `audit <lang>/<slug>` reports `skipped`.

**Daily backlog (older posts):** `node scripts/routine.mjs translate-queue [lang]` lists English posts that are
live and pass QA but have no version in a language yet, oldest first. Translate up to
`translations.backlogPerDay` (site.config.json, default 2) per language per day, each through steps 1-4 above
(`translate-slots <lang> --count <n>` gives n spaced pubDates). Stop when the queue is empty. New English
posts come first; the 5-per-language-per-day cap of `translate-slots` covers both.

## Page reading (Firecrawl)
Agents read web pages with the Firecrawl connector (`mcp__Firecrawl__firecrawl_scrape`, markdown, main
content only) and run SERP-style searches with `mcp__Firecrawl__firecrawl_search`. Firecrawl renders
JavaScript and passes most bot walls, so SERP pages, maker spec pages and retailer pages are read in full
instead of guessed from snippets. WebFetch/WebSearch are the fallback. The connector needs no key in the
repo or GitHub secrets; never write an API key into any file.

## Story-led posts (owner rule)
Every post reads as one true story: an opening scene the reader recognizes (from the brief's questions and owner complaints), attributed owner moments in each product section, and a verdict that closes the opening scene. The narrator voice is "we/our/us". "I/my/me" appears only inside a quoted, named story from `data/stories.json` told by the person who lived it (the owner, a reviewer such as Damian, or a real owner who agreed to be quoted). Never invent a first-hand experience: fake "I tested / I bought" claims break Google's reviews guidance, the FTC rule on fake reviews and testimonials, and Amazon Associates policy. To add a real story, the owner sends it (voice note or text) and it goes into `data/stories.json` with who, what product, and when.

## Keyword order (owner rule, permanent)

Low KD, long-tail and high search volume come first. `nextKeyword` (agents/orchestrator.mjs) ranks the queue in tiers:
keywords with a measured Ahrefs volume first, then keywords with a measured proxy, then keywords with no data.
Inside a tier, more monthly searches rank higher, every KD point ranks lower, and a 3+ word phrase gets a bonus.
Category and funnel balance and the queue `priority` only break near-ties; owner keywords no longer jump ahead.
Keep at least 25 pending keywords with measured Ahrefs data (volume + KD, US) in the queue: when fewer remain,
run keyword-agent first (Ahrefs keywords-explorer-overview, live SERP check, cannibalization check) and add them
with `routine.mjs add-keywords` before writing the day's posts.

## Competitor gap keywords (owner rule)

Before keyword-agent, when fewer than 25 pending keywords have measured Ahrefs data, run `competitor-gap-agent`:
it searches the seed keyword variations (data/seeds.json) on Google, checks the ranking domains' Domain Rating
(free Ahrefs call), takes weak sites (DR ≤ 30) that rank in the top 10, pulls the keywords they rank for in the
top 10 (Ahrefs site-explorer-organic-keywords, US, KD ≤ maxKd, 3+ words, volume ≥ 50) and adds the ones in our
niche to the queue with `source: "competitor-gap"`. Budget: at most 3,000 Ahrefs units per run, and nothing when
fewer than 10,000 API units remain. Findings are kept in data/competitors.json so a domain or seed is not
re-checked within 30 days. Only keywords are taken from competitors, never their text.

## Pain points (owner rule)

Google and Bing reward pages that solve the problems readers describe in their own words. `pain-point-agent` reads
Reddit, Quora and niche forums, stores repeated problems per category in `data/pain-points.json` (with source URLs and
verbatim quotes), marks which posts already answer them, and queues new topics for uncovered pain points that have a
measured Ahrefs volume (`source: "pain-point"`, `painPoints: [ids]`). Run it at the start of each daily run (2-4
categories: today's keywords first), and before a brief whenever the post's category has fewer than 5 stored pain points.
Linked agents: brief-agent puts 3-6 matching pain points into the brief (`painPoints`) with an outline section for them;
writer-agent answers each one with a real fix and links the thread once (exact quotes only); qa-agent checks every pain
point is answered and every quote is verbatim at its URL; keyword-agent and competitor-gap-agent tag matching queue
entries with `painPoints`.

## URL changes and redirects (owner rule, permanent)

A URL that has gone live must never 404. `data/published-urls.json` records every blog URL (English and
translations) that has been live; `scripts/redirects.mjs` (runs before every build) adds new ones and stops the
build when a recorded URL has no post file and no redirect.
- Merging two published posts: keep the stronger URL (more traffic/links, the higher-volume keyword), move the
  other post's useful sections and its keyword into secondaryKeywords, delete the weaker file, and add
  `{ "from": "/blog/<old-slug>/", "to": "/blog/<kept-slug>/" }` to data/redirects.json (301). Do the same for each
  translation (`/<lang>/blog/<old>/` → `/<lang>/blog/<kept>/`, or the English post if that language has no kept post).
- Renaming a slug or deleting a post: same rule; point it to the closest live post or category, never the home page
  unless nothing fits.
- Update internal links that pointed to the old URL (grep src/content for `/blog/<old-slug>/`), so no internal link
  goes through a redirect, and set `updatedDate` on the kept post.
- Merging queued keywords (no post yet) needs no redirect: mark the entry `merged` with `mergedInto`.
- The script collapses redirect chains (A → B → C becomes A → C) and warns about redirects to a missing post.

## Media and numbers (owner rule, permanent, every site and language)

No text-only posts. Every post that has no product photos (how-tos, guides, comparisons without picks) carries 2-3 AI illustrations, and every post backs its key numbers with a link on the number itself.
- **Brief (step 4):** `stats` (3-6 numbers with the source URL and a verbatim quote) and `videos` (0-2 YouTube ids) from Firecrawl.
- **Writer (step 6):** stats in the text as `[number and claim](source-url)` (2+ in a post without products, 1+ in roundups); `illustrations: [{prompt, alt, afterHeading}]` for posts without products (realistic scene, no brands, no text, no product models, no recognisable people); `videos: [{id, afterHeading}]` when the brief found a good one.
- **AI images at deploy time** (this repo has no Cloudflare secret and no ai-images workflow): the RentersmartHome repo's `.github/workflows/launch-site.yml` runs `node agents/ai-images.mjs` in this site's checkout before every deploy. It generates each illustration with Cloudflare Workers AI (FLUX.1 schnell) into `public/images/ai/` (file names carry a prompt hash; the folder is kept in that workflow's Actions cache and is not committed here), fills `src` in the deployed copy, checks every video with YouTube oEmbed (fills title and channel, drops removed or non-embeddable videos). Illustrations are captioned "AI-generated illustration". Videos load as a thumbnail and play from youtube-nocookie.com only on click (no page-speed cost).
- **Safe-site limits:** numbers come from the maker's spec page or the source that publishes them (FBI, NFPA, USFA, UL/ETL/Intertek for fire tests, always naming the certifier); illustrations never show breaking into, drilling or forcing open a safe (lockout scenes show an owner with their own safe: batteries, override key); videos show owner-side tasks only (the maker's channel, a professional mover or locksmith), never opening someone else's safe or bypassing a lock.
- **QA (step 7b):** errors before go-live on a post without products with fewer than 2 illustrations or 2 sourced numbers (1 for roundups); warns on live posts so the backlog gets fixed. The qa-agent opens every number link and checks the number is on that page.
- **Translations:** same illustrations (alt translated), same videos, same number links.

**Owner rule 2026-10-21:** keywords that start with "best" (best X for Y) are always picked first (`bestFirst` in agents/orchestrator.mjs, ahead of Ahrefs demand and funnel balance); how-tos and other informational keywords are written only when no "best" keyword is left.
- **External links (owner rule 2026-10-21, permanent):** at most 3 outside links in the article text (usually 2), the link on the key statistic's number; quotes, forum threads and other sources are plain text. `routine.mjs qa` errors above 3 before go-live (warning once live). The `sources` frontmatter list is separate.
