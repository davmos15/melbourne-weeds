import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Listing } from './types.ts';
import { HABITAT_BY_SLUG } from './habitats.ts';

/**
 * Loads data/listings.json and merges data/overrides.json over the top,
 * keyed by slug (SPEC §4). Overrides are hand corrections, so re-running
 * the WordPress import can never quietly undo them.
 *
 * Runs at build time only — the site ships no data-loading JS.
 */

const root = new URL('../../', import.meta.url);

function readJson<T>(relative: string, fallback: T): T {
  const path = fileURLToPath(new URL(relative, root));
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

/** Shallow-merge per field, but treat arrays and objects as whole replacements. */
function applyOverride(base: Listing, override: Partial<Listing>): Listing {
  return { ...base, ...override, slug: base.slug };
}

let cache: Listing[] | null = null;

export function getListings(): Listing[] {
  if (cache) return cache;

  // WEEDS_FIXTURES swaps in the generated development dataset (scripts/
  // fixtures.ts) so the site can be reviewed before the WordPress import has
  // been run. It is opt-in, and never set by the deploy workflow.
  const source =
    process.env.WEEDS_FIXTURES === '1' ? 'data/fixtures/listings.json' : 'data/listings.json';
  const base = readJson<Listing[]>(source, []);
  const overrides = readJson<Record<string, Partial<Listing>>>('data/overrides.json', {});

  // Keys starting with `_` are documentation inside overrides.json itself.
  for (const key of Object.keys(overrides)) {
    if (key.startsWith('_')) delete overrides[key];
  }

  const merged = base.map((listing) => {
    const override = overrides[listing.slug];
    return override ? applyOverride(listing, override) : listing;
  });

  // An override may also introduce a listing that is not in WordPress at all.
  const known = new Set(merged.map((l) => l.slug));
  for (const [slug, value] of Object.entries(overrides)) {
    if (known.has(slug)) continue;
    if (!value.common) continue; // a partial patch for a slug that no longer exists
    merged.push({
      slug,
      wpId: value.wpId ?? -1,
      common: value.common,
      binomial: value.binomial ?? '',
      date: value.date ?? '',
      summary: value.summary ?? '',
      body: value.body ?? [],
      habitats: value.habitats ?? [],
      path: value.path ?? [],
      gallery: value.gallery ?? [],
      ...(value.instagram ? { instagram: value.instagram } : {}),
    });
  }

  for (const listing of merged) {
    listing.habitats = listing.habitats.filter((h) => HABITAT_BY_SLUG.has(h));
  }

  merged.sort((a, b) => a.common.localeCompare(b.common, 'en'));
  cache = merged;
  return merged;
}

export function getListing(slug: string): Listing | undefined {
  return getListings().find((l) => l.slug === slug);
}

/** Listings in a habitat, in the site's default (alphabetical) order. */
export function listingsInHabitat(habitat: string): Listing[] {
  return getListings().filter((l) => l.habitats.includes(habitat));
}

/** Newest first — the ordering behind previous/next on a listing page. */
export function byDateDescending(listings: Listing[] = getListings()): Listing[] {
  return listings.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}

/** The lead image, which is the WordPress featured image. */
export function leadImage(listing: Listing) {
  return listing.gallery[0];
}
