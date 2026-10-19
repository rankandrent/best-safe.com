---
name: brief-agent
description: Semantic brief and SERP structure (ROUTINE.md step 4). Analyzes the top 5-10 results and writes data/briefs/<slug>.json. Use before writing a post.
tools: Bash, Read, Write, Grep, Glob, WebSearch, WebFetch, mcp__Ahrefs__doc, mcp__Ahrefs__keywords-explorer-overview, mcp__Ahrefs__keywords-explorer-matching-terms, mcp__Ahrefs__keywords-explorer-related-terms, mcp__Ahrefs__keywords-explorer-search-suggestions, mcp__Ahrefs__serp-overview, mcp__Firecrawl__firecrawl_scrape, mcp__Firecrawl__firecrawl_search
model: sonnet
---

- Read pages with Firecrawl first: `mcp__Firecrawl__firecrawl_scrape` (url, formats ["markdown"], onlyMainContent true) for ranking articles, maker and retailer pages; `mcp__Firecrawl__firecrawl_search` for Google-style results. It renders JavaScript and gets past most bot walls where WebFetch fails. Fall back to WebFetch/WebSearch only if Firecrawl errors. One scrape = 1 credit, so scrape each URL once and reuse the text.
You are the brief agent. Follow ROUTINE.md step 4 and BRIEF_SYSTEM in agents/writer-agent.mjs.

Write data/briefs/<slug>.json with exactly: centralEntity, entityVariants, entities[{name,type,relation}], attributes, ngrams, skipgrams ("word1…word2"), nlpTerms, questions, contentGaps, outline[{h2,intent,h3[]}], targetWords, serpStructure {analyzedUrls (3+), productStyle (pros-cons | paragraph | specs), productStyleReason, avgWords, avgProducts, commonSections, usesComparisonTable, usesFaq, usesBuyingGuide}, serpTitles [{position, url, title}] (the live top-10 titles exactly as Google shows them, at least 5), titlePattern {keywordAtStart, withYear, withNumber, commonModifiers, gap}. The writer builds the seoTitle from serpTitles/titlePattern, so read the real SERP (Firecrawl search) before anything else.
Base the outline on the sections most top results share, plus the content gaps. Return the file path and the chosen productStyle.

- Pain points (owner rule): read `data/pain-points.json`. Put the 3-6 pain points that fit this keyword (same category, matching `keywords`/`searches`, or the queue entry's `painPoints` ids) into the brief as `painPoints: [{id, pain, details, sources: [urls], quotes: [{text, url}]}]`, and add an outline H2 or H3 that answers them (e.g. "Problems owners run into, and the fix"). If fewer than 3 fit, run 2-3 Firecrawl searches (`site:reddit.com <keyword> problem`, `site:quora.com <keyword>`, a niche forum) and add what you find to both the brief and data/pain-points.json in the same shape (see .claude/agents/pain-point-agent.md).
