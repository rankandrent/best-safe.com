// Typed entry point for the UI-string helpers (implementation in i18n.mjs).
import * as core from './i18n.mjs';

export type Lang = 'en' | 'de' | 'es' | 'nl';
export interface Locale { path: string; hreflang: string; ogLocale: string; flag: string; label: string }

export const LOCALES = core.LOCALES as Record<Lang, Locale>;
export const DEFAULT_LANG: Lang = 'en';
export const LANGS = core.LANGS as Lang[];
export const OTHER_LANGS = core.OTHER_LANGS as Lang[];
export const isLang = core.isLang as (l: unknown) => l is Lang;
export const normLang = core.normLang as (l: unknown) => Lang;
export const localeTag = core.localeTag as (lang?: string) => string;
export const t = core.t as (lang: string | undefined, key: string, vars?: Record<string, string | number>) => string;
export const tOr = core.tOr as (lang: string | undefined, key: string, fallback: string, vars?: Record<string, string | number>) => string;
export const langHome = core.langHome as (lang?: string) => string;
export const langPrefix = core.langPrefix as (lang?: string) => string;
export const formatDate = core.formatDate as (d: Date, lang?: string, opts?: Intl.DateTimeFormatOptions) => string;
export const formatNumber = core.formatNumber as (n: number, lang?: string) => string;
