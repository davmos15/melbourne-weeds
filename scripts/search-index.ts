/**
 * SPEC §10 — build the two search indexes into public/search/.
 *
 *   npm run search-index   (runs automatically before dev and build)
 *
 * Two tiers, because the full text of 400 essays is far too much to load
 * eagerly on a phone:
 *
 *   light.json  names, rank chain, habitats, summary, thumbnail   target <150 KB gz
 *   full.json   body text only, fetched on the first keystroke     ~800 KB
 *
 * Records are arrays rather than objects: at 400 records the repeated keys
 * would be a meaningful share of the payload.
 */
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getListings } from '../src/lib/listings.ts';
import { fold } from '../src/lib/format.ts';
import { HABITAT_BY_SLUG } from '../src/lib/habitats.ts';
import type { Rank } from '../src/lib/types.ts';

const OUT = fileURLToPath(new URL('../public/search/', import.meta.url));

/** Same base handling as the site itself (SPEC §2) — one env var, no hardcoding. */
const BASE = (process.env.SITE_BASE ?? '/').replace(/\/$/, '');

function rank(path: { rank: Rank; name: string }[], want: Rank): string {
  return path.find((p) => p.rank === want)?.name ?? '';
}

async function main(): Promise<void> {
  const listings = getListings();
  await mkdir(OUT, { recursive: true });

  const light = {
    v: 1,
    records: listings.map((l) => [
      l.slug,
      l.common,
      l.binomial,
      rank(l.path, 'genus'),
      rank(l.path, 'family'),
      rank(l.path, 'order'),
      rank(l.path, 'class'),
      l.habitats.map((h) => HABITAT_BY_SLUG.get(h)?.label ?? h),
      l.summary,
      l.gallery[0] ? `${BASE}${l.gallery[0].src}-400.webp` : '',
    ]),
  };

  // Pre-folded: diacritics and case are stripped here, once, rather than over
  // 800 KB of prose on every keystroke.
  const full: Record<string, string> = {};
  for (const listing of listings) {
    full[listing.slug] = fold(listing.body.join(' '));
  }

  const lightJson = JSON.stringify(light);
  const fullJson = JSON.stringify(full);

  await writeFile(`${OUT}light.json`, lightJson);
  await writeFile(`${OUT}full.json`, fullJson);

  const kb = (s: string) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
  const gz = (s: string) => `${(gzipSync(Buffer.from(s)).byteLength / 1024).toFixed(0)} KB gz`;

  console.log(`search index: ${listings.length} records`);
  console.log(`  light.json  ${kb(lightJson).padStart(8)}  ${gz(lightJson)}`);
  console.log(`  full.json   ${kb(fullJson).padStart(8)}  ${gz(fullJson)}`);

  const lightGz = gzipSync(Buffer.from(lightJson)).byteLength;
  if (lightGz > 150 * 1024) {
    console.warn(
      `\n  ⚠ light.json is ${(lightGz / 1024).toFixed(0)} KB gzipped, over the 150 KB target (SPEC §10).\n` +
        '    Trim the summary field before reaching for a search library.',
    );
  }
}

main().catch((error) => {
  console.error('search index failed:', error);
  process.exitCode = 1;
});
