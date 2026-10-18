// Best Safe Score: our editorial 1-5 rating for a product, from five
// criteria scored 1-10 (see /how-we-score/). Criteria that don't apply
// (e.g. fire protection for a car safe, a dehumidifier or a plain lock box
// with no fire rating claim) are left out and the remaining weights are
// rescaled so they still add up to 100%.
// Criterion labels live in src/i18n/<lang>.json as "score.criterion.<key>".
import en from '../i18n/en.json' with { type: 'json' };
import de from '../i18n/de.json' with { type: 'json' };
import es from '../i18n/es.json' with { type: 'json' };
import nl from '../i18n/nl.json' with { type: 'json' };

const DICTS = { en, de, es, nl };

export const CRITERIA = [
  { key: 'security', weight: 0.3 },
  { key: 'fire', weight: 0.2 },
  { key: 'access', weight: 0.2 },
  { key: 'capacity', weight: 0.15 },
  { key: 'value', weight: 0.15 },
].map((c) => ({ ...c, label: en[`score.criterion.${c.key}`] ?? c.key }));

/** Criteria every product must be scored on; `fire` is optional (left out where it doesn't apply). */
export const REQUIRED_CRITERIA = ['security', 'access', 'capacity', 'value'];

/** Criterion labels per language, from the i18n dictionaries. */
export const CRITERIA_LABELS = Object.fromEntries(
  Object.entries(DICTS).map(([lang, d]) => [lang, Object.fromEntries(CRITERIA.map((c) => [c.key, d[`score.criterion.${c.key}`]]).filter(([, v]) => v))]),
);

/** Label of a criterion in a language, falling back to English. */
export function criterionLabel(key, lang = 'en') {
  return CRITERIA_LABELS[lang]?.[key] ?? CRITERIA.find((c) => c.key === key)?.label ?? key;
}

/** Score = sum(criterion x weight) / sum(weights used) / 2, rounded to 0.1 (out of 5). */
export function productScore(scores) {
  if (!scores) return null;
  let total = 0;
  let weights = 0;
  for (const c of CRITERIA) {
    const v = scores[c.key];
    if (typeof v !== 'number') continue;
    total += v * c.weight;
    weights += c.weight;
  }
  if (!weights) return null;
  return Math.round((total / weights / 2) * 10) / 10;
}

/** @deprecated Backward-compatible alias from the template; use productScore. */
export const renterScore = productScore;
