// UI strings per language (src/i18n/<lang>.json). Plain JS so the remark
// plugins (loaded by astro.config.mjs in Node) can use it too; src/lib/i18n.ts
// re-exports it with types for the Astro pages.
import siteConfig from '../../site.config.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import de from '../i18n/de.json' with { type: 'json' };
import es from '../i18n/es.json' with { type: 'json' };
import nl from '../i18n/nl.json' with { type: 'json' };

const STRINGS = { en, de, es, nl };
export const LOCALES = siteConfig.locales;
export const DEFAULT_LANG = 'en';
export const LANGS = Object.keys(LOCALES);
/** Languages other than English, each served under /<path>/. */
export const OTHER_LANGS = LANGS.filter((l) => l !== DEFAULT_LANG);

export const isLang = (l) => typeof l === 'string' && Object.prototype.hasOwnProperty.call(LOCALES, l);
export const normLang = (l) => (isLang(l) ? l : DEFAULT_LANG);
/** BCP 47 tag for <html lang>, hreflang and Intl (e.g. de-DE). */
export const localeTag = (lang) => LOCALES[normLang(lang)].hreflang;

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

/** Translated UI string with {var} placeholders; falls back to English, then the key. */
export function t(lang, key, vars) {
  const s = STRINGS[normLang(lang)]?.[key] ?? STRINGS.en[key] ?? key;
  return fill(s, { site: siteConfig.name, ...vars });
}

/** Translated string when that language has one, otherwise `fallback` (e.g. a value from site.config.json). */
export function tOr(lang, key, fallback, vars) {
  const s = normLang(lang) === DEFAULT_LANG ? undefined : STRINGS[normLang(lang)]?.[key];
  return s == null ? fallback : fill(s, { site: siteConfig.name, ...vars });
}

/** Home page path of a language: '/' for English, '/de/' etc. */
export const langHome = (lang) => (LOCALES[normLang(lang)].path ? `/${LOCALES[normLang(lang)].path}/` : '/');

/** Path prefix of a language: '' for English, '/de' etc. */
export const langPrefix = (lang) => (LOCALES[normLang(lang)].path ? `/${LOCALES[normLang(lang)].path}` : '');

export function formatDate(d, lang = DEFAULT_LANG, opts = { year: 'numeric', month: 'long', day: 'numeric' }) {
  return new Intl.DateTimeFormat(localeTag(lang), { ...opts, timeZone: 'UTC' }).format(d);
}

export const formatNumber = (n, lang = DEFAULT_LANG) => Number(n).toLocaleString(localeTag(lang));
