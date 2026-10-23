# Instructions for Claude (owner rules)

**Standing rule (owner, 2026-10-23):** whenever the owner gives a guideline, a decision or a preference in chat,
write the durable part into the file the matching agent reads, in the same session, before the work is reported done:
- writing, voice, titles, length, media → `.claude/agents/writer-agent.md` + ROUTINE.md
- fact checks and quality gates → `.claude/agents/qa-agent.md` (+ `agents/qa-agent.mjs` if it can be checked automatically)
- keywords and topics → `.claude/agents/keyword-agent.md` / `competitor-gap-agent.md` + ROUTINE.md
- products, ASINs → `.claude/agents/product-agent.md`
- briefs and SERP structure → `.claude/agents/brief-agent.md`
- old-post updates from Search Console → `.claude/agents/improve-agent.md`
- translations → `.claude/agents/translator-agent.md`
- schedules, posts per day, indexing, deploys → this file + the scheduled task prompt
- rules for every site → the same change in all three repos (rentersmarthome.us, best-tripod.com, best-safe.com)
Label it "owner rule YYYY-MM-DD", keep the owner's intent, never weaken an older rule silently (if a new rule
conflicts with an old one, ask the owner which wins and record the answer). Commit and push the change.

## Owner rules not covered by an agent file (kept here)

- Talk to the owner in Roman Urdu. Agent prompts and files stay in English.
- LIGHT MODE (2026-10-22, Claude usage limit): exactly 1 new English post per day per site, one agent per post;
  translations, trim backlog, pre-research and backfills are paused until the owner says otherwise.
- Deploy a post only after its pubDate; go-live check = 200 + product photos, then a phone notification "Live: <title> – <url>".
- Never change a live post's URL, slug, keyword or pubDate (rankings drop). Old URLs get 301s, never 404s.
- Old posts are improved daily from the last 24 hours of Search Console (2026-10-23): 1 post per site per day,
  `scripts/gsc-opportunities.mjs <repo> <site> 1 --last24h` in the rentersmarthome.us repo, then improve-agent.
- Google indexing (2026-10-23, owner chose the Indexing API knowing Google only allows it for job/livestream
  pages and may ignore it): every deploy sends the last 26 hours' new/updated blog URLs (`google-indexing.mjs
  --notify-recent`); `google-indexing.yml` action=notify sends named URLs or TARGETS="*" (all, 190/day).
  URL Inspection index checks run only for the keywords/URLs the owner names, never the whole site, unless asked.
- The service account gsc-reader@abiding-hull-512408-a7.iam.gserviceaccount.com is an Owner of all three
  Search Console properties (secret GSC_SERVICE_ACCOUNT_JSON in the rentersmarthome.us repo).
- www.<domain> 301s to the bare domain (functions/_middleware.js); /search/ stays noindex, follow.
- Products are written in first person (I, my, me, we, our, us), never with fake testing or ownership claims.
- Max 3 outside links in an article body; "best X for Y" keywords first; no fabricated prices, ratings or tests.
- Backlinks: white-hat only (no paid links, PBNs, exchanges); the off-page agent prompt is
  rentersmarthome.us/docs/offpage-agent-prompt.md.
- Dashboards are light-themed: Search Performance https://claude.ai/artifact/LgNhY4KAh6FfnSxKs7AfpF (daily refresh)
  and Site Agent Flow https://claude.ai/artifact/PZPgFBgSVi37DphrWH2nDJ.
- best-safe.com: keyword queue replaced 2026-10-22 with the owner's list: security safes only, long-tail preferred, no India/UK/Australia/Singapore keywords. Amazon tag trsese34-20, no Amazon API (hand-verified ASINs).
