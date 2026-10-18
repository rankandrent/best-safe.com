// AGENT 4 — On-page SEO, Semantic QA & Internal Linking
// 1. Audits the draft deterministically: title/meta lengths, keyword placement,
//    heading structure, length, entity/n-gram/skip-gram/NLP-term coverage
//    against the brief, central-entity salience, affiliate + internal links.
// 2. If the score is below the bar, sends Claude a precise fix list and gets a
//    revised article (one optimization pass, then re-audit).
// 3. Internal linking both ways: picks related existing posts for the new one,
//    and inserts a contextual link to the new post inside older related posts.
import { ask } from './lib/claude.mjs';
import { SITE, log } from './lib/config.mjs';
import { parseDraft } from './writer-agent.mjs';
import { writePost } from './lib/store.mjs';
import {
  coverage, containsPhrase, containsSkipgram, tokenize, stripMarkdown,
  salienceProxy, similarity, wordCount, topNgrams,
} from './lib/nlp.mjs';

const AGENT = 'seo-agent';
const PASS_SCORE = 85;

export function audit({ item, brief, meta, body, products }) {
  const issues = [];
  let score = 100;
  const penalize = (pts, msg) => {
    score -= pts;
    issues.push(msg);
  };
  const kw = item.keyword;
  const plain = stripMarkdown(body);
  const first100 = tokenize(plain).slice(0, 100).join(' ');
  const h2s = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  const words = wordCount(body);

  if (meta.seoTitle.length > 60) penalize(3, `seoTitle is ${meta.seoTitle.length} chars; keep ≤ 60.`);
  if (!containsPhrase(meta.title, kw) && !containsPhrase(meta.seoTitle, kw)) penalize(6, `Title/seoTitle should contain the keyword "${kw}" (or its exact phrase).`);
  if (meta.description.length < 130 || meta.description.length > 162) penalize(3, `Meta description is ${meta.description.length} chars; aim for 140-160.`);
  if (!containsPhrase(first100, kw) && !brief.entityVariants.some((v) => containsPhrase(first100, v))) penalize(6, `Use "${kw}" (or a close variant) within the first 100 words.`);
  if (h2s.length < 4) penalize(5, `Only ${h2s.length} H2 sections; cover the outline's sub-intents.`);
  if (/^#\s/m.test(body)) penalize(4, 'Remove H1 headings from the body (the template renders the H1).');
  if (/^##\s+(faq|frequently asked)/im.test(body)) penalize(3, 'Remove the FAQ section from the body; FAQs live in metadata.');
  if (words < brief.targetWords * 0.8) penalize(8, `Body is ${words} words; target is ~${brief.targetWords}. Expand thin sections and content gaps.`);

  const entityCov = coverage(plain, brief.entities.map((e) => e.name));
  const ngramCov = coverage(plain, brief.ngrams);
  const nlpCov = coverage(plain, brief.nlpTerms);
  const toks = tokenize(plain);
  const skipPresent = brief.skipgrams.filter((s) => containsSkipgram(toks, s));
  const skipRatio = brief.skipgrams.length ? skipPresent.length / brief.skipgrams.length : 1;
  const salience = salienceProxy(body, brief.centralEntity, brief.entityVariants);

  if (entityCov.ratio < 0.75) penalize(Math.round((0.75 - entityCov.ratio) * 30), `Entity coverage ${(entityCov.ratio * 100) | 0}%. Missing entities: ${entityCov.missing.join(', ')}`);
  if (ngramCov.ratio < 0.6) penalize(Math.round((0.6 - ngramCov.ratio) * 25), `N-gram coverage ${(ngramCov.ratio * 100) | 0}%. Missing phrases: ${ngramCov.missing.join(' | ')}`);
  if (nlpCov.ratio < 0.7) penalize(Math.round((0.7 - nlpCov.ratio) * 20), `NLP term coverage ${(nlpCov.ratio * 100) | 0}%. Missing terms: ${nlpCov.missing.join(', ')}`);
  if (skipRatio < 0.5) penalize(4, `Skip-gram coverage ${(skipRatio * 100) | 0}%. Bring these word pairs close together naturally: ${brief.skipgrams.filter((s) => !skipPresent.includes(s)).join(', ')}`);
  if (salience.score < 0.6) penalize(Math.round((0.6 - salience.score) * 30), `Central entity "${brief.centralEntity}" salience proxy is ${salience.score} (<0.6). Make it the grammatical subject of more topic sentences (${salience.subjectPosition} now), and include it in more H2s (${salience.headingsWithEntity}/${h2s.length}).`);

  // Layout-aware block checks.
  const lines = body.split('\n');
  const tableStarts = lines.map((l, i) => (/^\s*\|.*\|\s*$/.test(l) && !/^\s*\|.*\|\s*$/.test(lines[i - 1] ?? '') ? i : -1)).filter((i) => i >= 0);
  const hasList = /^\s*(?:[-*]|\d+\.)\s+\S/m.test(body);
  if (!hasList) penalize(3, 'Add at least one bulleted or numbered list (mixed block types help page understanding).');
  if (['roundup', 'comparison'].includes(item.articleType) && tableStarts.length === 0) penalize(4, 'Add a comparison table for this roundup/comparison.');
  for (const i of tableStarts) {
    const prev = lines.slice(0, i).reverse().find((l) => l.trim());
    if (!prev || /^#/.test(prev.trim())) {
      penalize(2, 'Introduce every table with a sentence directly above it that says what it compares.');
      break;
    }
  }
  const sections = body.split(/^##\s+.+$/m).slice(1);
  const boldLead = sections.filter((sec) => {
    const firstPara = sec.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#'));
    return firstPara && /\*\*[^*]+\*\*/.test(firstPara);
  }).length;
  if (sections.length && boldLead / sections.length < 0.6) penalize(3, `Only ${boldLead}/${sections.length} H2 sections open with a bold direct answer; bold the key answer sentence of each section.`);

  const amzn = (body.match(/\]\(amzn:/g) || []).length;
  if (products.length && amzn < Math.min(products.length, 3)) penalize(4, `Only ${amzn} product links in the body; link each recommended product once with amzn: links.`);
  const internal = (body.match(/\]\(\/blog\/[a-z0-9-]+\/\)/g) || []).length;
  const avgSentence = words / Math.max(1, plain.split(/[.!?]+\s/).length);
  if (avgSentence > 24) penalize(3, `Average sentence length ${avgSentence.toFixed(1)} words; tighten to ≤ 20 for readability.`);

  // Keyword stuffing guard: exact-match density above 2.5% reads as spam.
  const kwHits = (` ${toks.join(' ')} `.match(new RegExp(` ${tokenize(kw).join(' ')} `, 'g')) || []).length;
  const density = (kwHits * tokenize(kw).length) / Math.max(1, toks.length);
  if (density > 0.025) penalize(5, `Exact keyword density ${(density * 100).toFixed(1)}% is too high; use variants and entities instead.`);

  return {
    score: Math.max(0, score),
    issues,
    metrics: {
      words, h2: h2s.length, tables: tableStarts.length, hasList, boldLeadSections: boldLead, amazonLinks: amzn, internalLinks: internal, keywordDensity: Number((density * 100).toFixed(2)),
      entityCoverage: Number(entityCov.ratio.toFixed(2)), ngramCoverage: Number(ngramCov.ratio.toFixed(2)),
      nlpCoverage: Number(nlpCov.ratio.toFixed(2)), skipgramCoverage: Number(skipRatio.toFixed(2)), salience,
      topBigrams: topNgrams(body, 2, 10), topTrigrams: topNgrams(body, 3, 8),
    },
  };
}

export async function optimize({ item, brief, meta, body, products, linkTargets, report }) {
  const text = await ask({
    agent: AGENT,
    effort: 'high',
    maxTokens: 48000,
    system: `You are the on-page SEO editor for ${SITE.domain}. You revise articles to fix specific SEO and semantic issues while keeping facts, voice and structure. Keep every existing amzn: and /blog/ link format. Do not add facts that are not in the product data. Output exactly:\n<metadata>{json with the same fields}</metadata>\n<article>full revised markdown body</article>`,
    prompt: `Fix ALL of these audit issues (score ${report.score}/100):
${report.issues.map((i, n) => `${n + 1}. ${i}`).join('\n')}

Target keyword: ${item.keyword}
Central entity: ${brief.centralEntity} (variants: ${brief.entityVariants.join(', ')})
Internal link candidates (use 3-5 total, real URLs only):
${linkTargets.map((t) => `- /blog/${t.slug}/ : ${t.title}`).join('\n') || '(none)'}
Product data: ${JSON.stringify(products.map((p) => ({ name: p.name, query: p.query, facts: p.facts })))}

CURRENT METADATA:
${JSON.stringify(meta)}

CURRENT ARTICLE:
${body}`,
  });
  return parseDraft(text);
}

/** Choose the most related existing posts as internal link targets. */
export function pickLinkTargets(item, posts, limit = 8) {
  const probe = [item.keyword, ...item.secondaryKeywords, item.workingTitle, item.cluster].join(' ');
  return posts
    .map((p) => ({
      slug: p.slug,
      title: p.data.title,
      keyword: p.data.keyword,
      score: similarity(probe, `${p.data.title} ${p.data.keyword} ${(p.data.secondaryKeywords || []).join(' ')} ${p.data.description}`) +
        (p.data.category === item.category ? 0.15 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Insert `[phrase](/blog/slug/)` at the first natural mention inside a paragraph. */
function insertLink(content, phrases, href) {
  const lines = content.split('\n');
  for (const phrase of phrases) {
    const re = new RegExp(`\\b(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || /^\s*(#|\||>|```|- \[|\d+\.\s*\[)/.test(line) || line.includes(href)) continue;
      // Only match outside existing markdown links.
      const parts = line.split(/(\[[^\]]*\]\([^)]*\))/);
      for (let j = 0; j < parts.length; j += 2) {
        if (re.test(parts[j])) {
          parts[j] = parts[j].replace(re, `[$1](${href})`);
          lines[i] = parts.join('');
          return lines.join('\n');
        }
      }
    }
  }
  return null;
}

/**
 * Add contextual links from older related posts to the new post. A post that isn't live yet only
 * goes into the related box (which shows live posts only): a body link to it would be a dead link
 * on a live page until it publishes, and QA hides pages with such links.
 */
export function addBacklinks({ newSlug, item, meta, posts, max = 3, isLive = true }) {
  const href = `/blog/${newSlug}/`;
  const phrases = [item.keyword, ...item.secondaryKeywords, meta.entities?.[0]].filter((p) => p && p.split(' ').length >= 2);
  const targets = pickLinkTargets(item, posts, max + 3).filter((t) => t.score > 0.05);
  const changed = [];
  for (const t of targets) {
    if (changed.length >= max) break;
    const post = posts.find((p) => p.slug === t.slug);
    if (!post || post.content.includes(href)) continue;
    const updated = isLive ? insertLink(post.content, phrases, href) : null;
    if (updated) {
      writePost(post.slug, post.data, updated);
      changed.push({ slug: post.slug, mode: 'contextual' });
    } else {
      const related = [newSlug, ...(post.data.related || []).filter((s) => s !== newSlug)].slice(0, 4);
      writePost(post.slug, { ...post.data, related }, post.content);
      changed.push({ slug: post.slug, mode: 'related-box' });
    }
  }
  log(AGENT, `backlinks: ${changed.map((c) => `${c.slug}(${c.mode})`).join(', ') || 'none'}`);
  return changed;
}

export async function runSeoAgent({ item, brief, draft, products, linkTargets }) {
  let { meta, body } = draft;
  let report = audit({ item, brief, meta, body, products });
  log(AGENT, `initial score ${report.score}`, report.issues.length ? `issues=${report.issues.length}` : '');
  const history = [{ pass: 0, score: report.score, issues: report.issues }];

  if (report.score < PASS_SCORE) {
    try {
      const revised = await optimize({ item, brief, meta, body, products, linkTargets, report });
      const revisedReport = audit({ item, brief, ...revised, products });
      log(AGENT, `optimized score ${revisedReport.score}`);
      history.push({ pass: 1, score: revisedReport.score, issues: revisedReport.issues });
      if (revisedReport.score >= report.score) {
        ({ meta, body } = revised);
        report = revisedReport;
      }
    } catch (e) {
      log(AGENT, `optimization pass failed, keeping draft: ${e.message}`);
    }
  }
  // Strip internal links that point to posts that don't exist.
  const valid = new Set(linkTargets.map((t) => t.slug));
  body = body.replace(/\[([^\]]+)\]\(\/blog\/([a-z0-9-]+)\/\)/g, (m, text, slug) => (valid.has(slug) ? m : text));
  return { meta, body, report: { ...report, history } };
}

