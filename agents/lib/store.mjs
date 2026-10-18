import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { BLOG_DIR, DATA_DIR, REPORT_DIR } from './config.mjs';

const QUEUE = path.join(DATA_DIR, 'keywords.json');
const STATE = path.join(DATA_DIR, 'state.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const loadQueue = () => readJson(QUEUE, []);
export const saveQueue = (q) => writeJson(QUEUE, q);
export const loadState = () => readJson(STATE, { startDate: null, published: [] });
export const saveState = (s) => writeJson(STATE, s);
export const saveReport = (slug, report) => writeJson(path.join(REPORT_DIR, `${slug}.json`), report);

export function listPosts() {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = path.join(BLOG_DIR, f);
      const { data, content } = matter(fs.readFileSync(file, 'utf8'));
      return { slug: f.replace(/\.md$/, ''), file, data, content };
    });
}

export function postExists(slug) {
  return fs.existsSync(path.join(BLOG_DIR, `${slug}.md`));
}

/** Write a post. Removes undefined/empty optional keys so YAML stays clean. */
export function writePost(slug, data, content) {
  // JSON round-trip drops nested `undefined` values that YAML cannot serialize.
  const plain = JSON.parse(JSON.stringify(data));
  const clean = Object.fromEntries(
    Object.entries(plain).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)),
  );
  const file = path.join(BLOG_DIR, `${slug}.md`);
  fs.writeFileSync(file, matter.stringify(`\n${content.trim()}\n`, clean));
  return file;
}

// --- Translations: src/content/blog/<lang>/<slug>.md (id '<lang>/<slug>').
// The English helpers above (listPosts, postExists, writePost) only see the top folder.

/** Language folders that exist next to the English posts (de, es, nl, ...). */
export function translationLangs() {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs.readdirSync(BLOG_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Translated posts of one language, or of every language when `lang` is omitted. */
export function listTranslations(lang) {
  const langs = lang ? [lang] : translationLangs();
  return langs.flatMap((l) => {
    const dir = path.join(BLOG_DIR, l);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const file = path.join(dir, f);
        const { data, content } = matter(fs.readFileSync(file, 'utf8'));
        const slug = f.replace(/\.md$/, '');
        return { slug, lang: l, id: `${l}/${slug}`, file, data, content };
      });
  });
}

/** Split a post reference: 'de/<slug>' is a translation, a bare '<slug>' is English. */
export function parseRef(ref) {
  const s = String(ref ?? '').replace(/^\/+|\/+$/g, '').replace(/\.md$/, '');
  const i = s.indexOf('/');
  return i < 0 ? { lang: 'en', slug: s, id: s } : { lang: s.slice(0, i), slug: s.slice(i + 1), id: s };
}

/** One post by language and slug ('en' reads src/content/blog/<slug>.md), or null. */
export function readPost(lang, slug) {
  if (!lang || lang === 'en') {
    const file = path.join(BLOG_DIR, `${slug}.md`);
    if (!fs.existsSync(file)) return null;
    const { data, content } = matter(fs.readFileSync(file, 'utf8'));
    return { slug, file, data, content };
  }
  const file = path.join(BLOG_DIR, lang, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  return { slug, lang, id: `${lang}/${slug}`, file, data, content };
}
