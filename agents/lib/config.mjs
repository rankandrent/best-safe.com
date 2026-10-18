import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BLOG_DIR = path.join(ROOT, 'src/content/blog');
export const DATA_DIR = path.join(ROOT, 'data');
export const REPORT_DIR = path.join(DATA_DIR, 'reports');

export const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

export function log(agent, ...msg) {
  console.log(`[${new Date().toISOString()}] [${agent}]`, ...msg);
}
