/**
 * Shared helpers for the WordPress scripts (SPEC §4).
 *
 * The source is a WordPress 6.0 install, so /wp-json/wp/v2/ should be open.
 * Everything here is read-only and cached to data/raw/, which is gitignored:
 * the committed artefacts are data/listings.json and public/img/, so a site
 * build never depends on the source being up.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const SOURCE = process.env.WP_SOURCE ?? 'https://weedsofmelbourne.org';
export const API = `${SOURCE.replace(/\/$/, '')}/wp-json/wp/v2`;

export const ROOT = new URL('../', import.meta.url);
export const RAW_DIR = fileURLToPath(new URL('data/raw/', ROOT));
export const DATA_DIR = fileURLToPath(new URL('data/', ROOT));

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export interface FetchResult<T> {
  data: T;
  headers: Headers;
}

const RETRY_DELAYS = [1000, 2000, 4000, 8000];

export async function api<T>(path: string, init?: RequestInit): Promise<FetchResult<T>> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        throw Object.assign(new Error(`${url} -> ${res.status} ${res.statusText}`), {
          fatal: true,
          status: res.status,
        });
      }
      return { data: (await res.json()) as T, headers: res.headers };
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal) throw error;
      lastError = error;
      const delay = RETRY_DELAYS[attempt];
      if (delay === undefined) break;
      console.warn(`  retrying ${url} in ${delay}ms (${String(error)})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export async function dumpRaw(name: string, value: unknown): Promise<string> {
  await ensureDir(RAW_DIR);
  const path = `${RAW_DIR}${name}`;
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

export async function readRaw<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(`${RAW_DIR}${name}`, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Decode the HTML entities WordPress puts in rendered titles. */
export function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
    ldquo: '“', rdquo: '”', times: '×', deg: '°',
  };
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return named[entity.toLowerCase()] ?? whole;
  });
}

/**
 * Turn a WordPress rendered body into plain-text paragraphs.
 * Curly quotes and en/em dashes are preserved — the prose is carefully
 * written and the punctuation is part of it (SPEC §4).
 */
export function toParagraphs(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, '')
    .split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>|<\/h[1-6]>|<\/li>/i)
    .map((chunk) =>
      decodeEntities(
        chunk
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    )
    .filter((p) => p.length > 1);
}

/** First sentence of the body — the lede (SPEC §5). */
export function firstSentence(paragraphs: string[]): string {
  const first = paragraphs[0] ?? '';
  // Don't split on the full stop in "L." or "subsp." or a decimal.
  const match = /^[\s\S]*?[.!?](?=\s+[“"'(\[]?[A-Z0-9])/.exec(first);
  const candidate = (match ? match[0] : first).trim();
  return candidate.length > 20 || !first ? candidate : first;
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
