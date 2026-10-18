// Lightweight, dependency-free NLP helpers used by the SEO agent:
// tokenization, n-grams, skip-grams, term coverage, similarity and a
// salience proxy for the central entity.

export const STOPWORDS = new Set(`a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves also get got one two may might must would can't don't won't it's you're we're they're i'm`.split(/\s+/));

export function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|~]/g, ' ')
    .replace(/-{3,}/g, ' ');
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ') // hyphens split words: "carbon-fiber" matches "carbon fiber"
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);
}

export function contentTokens(text) {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

export function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

/** Skip-grams: ordered word pairs within `window` tokens of each other (k-skip-bigrams). */
export function skipgrams(tokens, window = 4) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 2; j <= Math.min(i + window, tokens.length - 1); j++) out.push(`${tokens[i]}…${tokens[j]}`);
  }
  return out;
}

export function countMap(items) {
  const m = new Map();
  for (const it of items) m.set(it, (m.get(it) || 0) + 1);
  return m;
}

/** Normalized text for phrase presence checks (keeps word boundaries). */
function norm(text) {
  return ` ${tokenize(text).join(' ')} `;
}

export function containsPhrase(text, phrase) {
  return norm(text).includes(` ${tokenize(phrase).join(' ')} `);
}

/** Does `a … b` (a skip-gram, written "a b" or "a…b") occur with ≤ window tokens between? */
export function containsSkipgram(tokens, skipgram, window = 5) {
  const [a, b] = skipgram.split(/…|\.\.\.|\s+/).filter(Boolean).map((w) => w.toLowerCase());
  if (!a || !b) return false;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== a) continue;
    for (let j = i + 1; j <= Math.min(i + window, tokens.length - 1); j++) if (tokens[j] === b) return true;
  }
  return false;
}

export function coverage(text, terms) {
  const present = [];
  const missing = [];
  for (const t of terms) (containsPhrase(text, t) ? present : missing).push(t);
  return { present, missing, ratio: terms.length ? present.length / terms.length : 1 };
}

/** Top recurring bigrams/trigrams of a document, useful for reports. */
export function topNgrams(text, n, limit = 15) {
  const toks = contentTokens(stripMarkdown(text));
  return [...countMap(ngrams(toks, n)).entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

export function sentences(text) {
  return stripMarkdown(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length > 3);
}

/**
 * Salience proxy for the central entity. Real salience (e.g. Google NLP) rewards
 * an entity that is mentioned often, early, in headings, and as a grammatical
 * subject. We approximate each signal and blend them into a 0–1 score.
 */
export function salienceProxy(markdown, entity, variants = []) {
  const names = [entity, ...variants].filter(Boolean);
  const body = stripMarkdown(markdown);
  const sents = sentences(markdown);
  const hit = (s) => names.some((n) => containsPhrase(s, n));
  const headings = [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1]);

  const mentionSents = sents.filter(hit).length;
  const freq = Math.min(1, mentionSents / Math.max(8, sents.length * 0.25));
  const firstPara = body.split(/\n\s*\n/).find((p) => p.trim().length > 40) || '';
  const early = hit(firstPara) ? 1 : 0;
  const subject = sents.filter((s) => hit(s.split(/\s+/).slice(0, 7).join(' '))).length;
  const subjectScore = Math.min(1, subject / Math.max(4, sents.length * 0.08));
  const headingScore = headings.length ? Math.min(1, headings.filter(hit).length / Math.max(2, headings.length * 0.35)) : 0;

  const score = 0.3 * freq + 0.2 * early + 0.3 * subjectScore + 0.2 * headingScore;
  return { score: Number(score.toFixed(3)), mentionSentences: mentionSents, subjectPosition: subject, headingsWithEntity: headings.filter(hit).length, early: !!early };
}

/** Cosine similarity of term-frequency vectors (unigrams + bigrams). */
export function similarity(a, b) {
  const vec = (t) => {
    const toks = contentTokens(stripMarkdown(t));
    return countMap([...toks, ...ngrams(toks, 2)]);
  };
  const va = vec(a);
  const vb = vec(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of va) {
    na += v * v;
    if (vb.has(k)) dot += v * vb.get(k);
  }
  for (const v of vb.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function wordCount(markdown) {
  return tokenize(stripMarkdown(markdown)).length;
}

export function readingTime(markdown) {
  return Math.max(1, Math.round(wordCount(markdown) / 230));
}

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
