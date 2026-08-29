/**
 * SPEC §4, Phase 2 — download every gallery image once, derive the sizes the
 * site actually serves, and record the real dimensions back into
 * data/listings.json so every <img> can carry width/height and never shift
 * layout (SPEC §12, CLS under 0.05).
 *
 *   npm run images
 *
 * Downloads are cached by URL hash in .cache/images/, so re-runs are cheap
 * and a partial run can simply be repeated.
 *
 * Derivatives, written as public/img/{slug}/{n}-{size}.{ext}:
 *
 *   400   AVIF + WebP   lead image only    grid thumbnail
 *   900   AVIF + WebP   lead image only    card / listing header
 *   1600  AVIF          every image        gallery + lightbox
 *   20    inline WebP   every image        blur placeholder
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Listing } from '../src/lib/types.ts';
import { DATA_DIR, ROOT } from './wp.ts';

const IMG_DIR = fileURLToPath(new URL('public/img/', ROOT));
const CACHE_DIR = fileURLToPath(new URL('.cache/images/', ROOT));

/** Quality 55–65 is plenty for photographs at these sizes (SPEC §4). */
const AVIF = { quality: 58, effort: 5 } as const;
const WEBP = { quality: 74, effort: 5 } as const;

/** Above this, stop and move public/img/ to an object store — do not degrade
 *  the photographs, they are the point of the site (SPEC §4). */
const BUDGET_WARN_BYTES = 700 * 1024 * 1024;
const BUDGET_HARD_BYTES = 1024 * 1024 * 1024;

const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const FORCE = process.argv.includes('--force');

function hash(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function download(url: string): Promise<Buffer> {
  const cached = `${CACHE_DIR}${hash(url)}`;
  if (await exists(cached)) return readFile(cached);

  let lastError: unknown;
  for (const delay of [0, 1000, 3000, 7000]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cached, buf);
      return buf;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

interface Derivative { size: number; format: 'avif' | 'webp' }

function derivativesFor(isLead: boolean): Derivative[] {
  const all: Derivative[] = [{ size: 1600, format: 'avif' }];
  if (!isLead) return all;
  return [
    { size: 400, format: 'avif' },
    { size: 400, format: 'webp' },
    { size: 900, format: 'avif' },
    { size: 900, format: 'webp' },
    ...all,
  ];
}

async function derive(
  input: Buffer,
  outDir: string,
  stem: string,
  isLead: boolean,
): Promise<void> {
  for (const { size, format } of derivativesFor(isLead)) {
    const out = `${outDir}${stem}-${size}.${format}`;
    if (!FORCE && (await exists(out))) continue;
    const pipeline = sharp(input, { failOn: 'none' })
      .rotate() // honour EXIF orientation before measuring anything
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
    const encoded =
      format === 'avif' ? pipeline.avif(AVIF) : pipeline.webp(WEBP);
    await encoded.toFile(out);
  }
}

/** 20px inline WebP, base64 — small enough to sit in the HTML attribute. */
async function blurOf(input: Buffer): Promise<string> {
  const buf = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: 20, height: 20, fit: 'inside' })
    .webp({ quality: 40, effort: 6 })
    .toBuffer();
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

async function directorySize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const walk = async (path: string) => {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = `${path}${entry.name}${entry.isDirectory() ? '/' : ''}`;
      if (entry.isDirectory()) await walk(child);
      else { bytes += (await stat(child)).size; files += 1; }
    }
  };
  await walk(dir);
  return { bytes, files };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main(): Promise<void> {
  const listingsPath = `${DATA_DIR}listings.json`;
  const listings = JSON.parse(await readFile(listingsPath, 'utf8')) as Listing[];
  const targets = ONLY ? listings.filter((l) => l.slug === ONLY) : listings;

  if (!targets.length) {
    console.log(ONLY ? `No listing with slug "${ONLY}".` : 'No listings to process.');
    return;
  }

  let processed = 0;
  let failed = 0;
  const total = targets.reduce((n, l) => n + l.gallery.length, 0);

  for (const listing of targets) {
    const outDir = `${IMG_DIR}${listing.slug}/`;
    await mkdir(outDir, { recursive: true });

    for (const [i, image] of listing.gallery.entries()) {
      const n = i + 1;
      const origin = image.origin ?? image.src;
      if (!origin || origin.startsWith('/img/')) continue;

      try {
        const buf = await download(origin);
        const meta = await sharp(buf, { failOn: 'none' }).rotate().metadata();
        await derive(buf, outDir, String(n), i === 0);

        // The stem the templates build every derivative URL from.
        image.src = `/img/${listing.slug}/${n}`;
        image.origin = origin;
        // Real dimensions, so <img> carries width/height (SPEC §4, §12).
        image.w = meta.width ?? image.w;
        image.h = meta.height ?? image.h;
        image.blur = await blurOf(buf);
        processed += 1;
      } catch (error) {
        failed += 1;
        console.warn(`  ! ${listing.slug} #${n}: ${String(error)}`);
      }

      if (processed % 100 === 0 && processed) {
        console.log(`  ${processed}/${total} images`);
      }
    }
  }

  await writeFile(listingsPath, `${JSON.stringify(listings, null, 2)}\n`);

  /* --------------------------------------------------------- budget check */

  const { bytes, files } = await directorySize(IMG_DIR);
  console.log(`\n${processed} images processed${failed ? `, ${failed} failed` : ''}`);
  console.log(`public/img/ — ${files} files, ${mb(bytes)}`);
  console.log(`GitHub Pages limit is 1 GB published; this is ${((bytes / BUDGET_HARD_BYTES) * 100).toFixed(1)}% of it.`);

  if (bytes > BUDGET_WARN_BYTES) {
    console.log(
      '\n  ⚠ Over the ~700 MB comfort line (SPEC §4). Raise it rather than\n' +
        '    shrinking the photographs: the answer is to move public/img/ to\n' +
        '    Cloudflare R2 or a similar object store and keep only code and\n' +
        '    JSON in the repo. Do not drop below 1600px — the photographs are\n' +
        '    the point of the site.',
    );
  }
  if (failed) {
    console.log(`\n  ${failed} image(s) failed. Re-run to retry — downloads are cached, so it is cheap.`);
  }
}

main().catch((error) => {
  console.error('\nImage build failed:', error);
  process.exitCode = 1;
});
