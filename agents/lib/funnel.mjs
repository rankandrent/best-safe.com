// Content funnel: TOFU (awareness/how-to), MOFU (comparisons, "X vs Y",
// evaluation guides), BOFU (buying intent: "best X", single-product reviews).
import { SITE } from './config.mjs';

export const STAGES = ['tofu', 'mofu', 'bofu'];

/** Infer a stage when a keyword doesn't carry one. */
export function funnelOf(k) {
  if (STAGES.includes(k.funnel)) return k.funnel;
  if (k.articleType === 'comparison' || /\bvs\b|versus|\bor\b/.test(k.keyword ?? '')) return 'mofu';
  if (k.articleType === 'roundup' || k.articleType === 'review' || k.intent === 'transactional') return 'bofu';
  return 'tofu';
}

/** Stage that is furthest below its target share among recent posts. */
export function neededStage(recentStages) {
  const mix = SITE.funnel?.targetMix ?? { tofu: 0.3, mofu: 0.3, bofu: 0.4 };
  const n = Math.max(1, recentStages.length);
  return STAGES.map((s) => ({ s, gap: mix[s] - recentStages.filter((x) => x === s).length / n }))
    .sort((a, b) => b.gap - a.gap)[0].s;
}
