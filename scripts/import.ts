/**
 * SPEC §4, Phase 1 — import WordPress into data/listings.json.
 *
 *   npm run import
 *
 *   npm run import                      # from the live REST API
 *   npm run import -- --wxr=export.xml   # from a WordPress export file
 *
 * Run `npm run recon` first and read data/raw/. The RANK_TAXONOMIES block
 * below is the one thing this script cannot work out for itself: it must be
 * filled in from what recon actually reports, not guessed.
 *
 * Both routes produce identical listings — see scripts/wxr.ts for when the
 * export file is the only way in.
 *
 * The output is committed, so a site build never depends on the source
 * WordPress install being up. Hand corrections live in data/overrides.json
 * and are merged over this at build time, so re-running never loses them.
 */
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import type { GalleryImage, Listing, PathNode, Rank } from '../src/lib/types.ts';
import { HABITAT_BY_WP, HABITATS } from '../src/lib/habitats.ts';
import type { WpPost, WpTermRef } from './wp.ts';
import {
  api, decodeEntities, DATA_DIR, dumpRaw, firstSentence, slugify, toParagraphs, SOURCE,
} from './wp.ts';
import { readWxr, wxrPathFromArgs } from './wxr.ts';

/* ------------------------------------------------------------------ config */

/**
 * Which WordPress taxonomy holds each rank, and which holds the habitat tags.
 *
 * This is the one thing the importer cannot work out for itself, so it is
 * configuration rather than code: `data/taxonomy-map.json`, absent by default.
 *
 * `npm run recon` writes a *suggested* map to
 * `data/raw/taxonomy-map.suggested.json` when it finds taxonomies that look
 * like ranks. Read it, satisfy yourself it is right, then move it to
 * `data/taxonomy-map.json`. That deliberate step is the point: SPEC §4 Phase 0
 * says report and stop for a decision, not guess.
 *
 * Three outcomes recon distinguishes:
 *
 *   1. Rank-named taxonomies exist  → the suggested map is ready to use
 *   2. One hierarchical taxonomy encodes the chain by nesting depth
 *                                   → set `fromNesting` and confirm the depth
 *                                     order by hand against data/raw/terms.json
 *   3. Neither                      → the chain is only in the hand-built HTML
 *                                     on /classification. That is a separate,
 *                                     more fragile scrape-and-join job. Do not
 *                                     bolt it on here without planning it.
 *
 * With no map, the import still runs and produces complete listings with an
 * empty `path`; every one of them is then named in the validation report.
 */
interface TaxonomyMap {
  /** Rank -> the taxonomy slug that holds it. */
  ranks?: Partial<Record<Rank, string>>;
  /** Instead: one hierarchical taxonomy whose depth encodes the chain. */
  fromNesting?: { taxonomy: string; ranks: Rank[] };
  /** Which taxonomy carries the habitat tags. Defaults to post_tag. */
  habitatTaxonomy?: string;
  /** Which post type holds the listings. Defaults to posts. */
  postType?: string;
}

function loadTaxonomyMap(): TaxonomyMap {
  const path = `${DATA_DIR}taxonomy-map.json`;
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, 'utf8')) as TaxonomyMap & { _readme?: unknown };
  delete raw._readme;
  return raw;
}

const TAXONOMY_MAP = loadTaxonomyMap();

const RANK_TAXONOMIES: Partial<Record<Rank, string>> = TAXONOMY_MAP.ranks ?? {};
const RANK_FROM_NESTING = TAXONOMY_MAP.fromNesting ?? null;

/** Which taxonomy carries the habitat tags. Confirm against recon output. */
const HABITAT_TAXONOMY = process.env.WP_HABITAT_TAXONOMY ?? TAXONOMY_MAP.habitatTaxonomy ?? 'post_tag';

/** Which post type holds the listings. */
const POST_TYPE = process.env.WP_POST_TYPE ?? TAXONOMY_MAP.postType ?? 'posts';

/* ------------------------------------------------------- nested rank chain */

/** A term in the hierarchical taxonomy that carries the rank chain. */
interface TermNode {
  slug: string;
  name: string;
  /** Parent's slug, or '' at the root. Normalised: WXR gives slugs, the API ids. */
  parent: string;
}

/** slug -> term, for the taxonomy named by fromNesting. Empty when unused. */
let termTable = new Map<string, TermNode>();

interface WpTaxonomyInfo { rest_base: string }
interface WpTermRow { id: number; name: string; slug: string; parent?: number }

/** Pull every term of one taxonomy from the REST API, resolving parent ids to slugs. */
async function fetchTermTable(taxonomy: string): Promise<Map<string, TermNode>> {
  const { data: taxonomies } = await api<Record<string, WpTaxonomyInfo>>('/taxonomies');
  const restBase = taxonomies[taxonomy]?.rest_base ?? taxonomy;

  const rows: WpTermRow[] = [];
  for (let page = 1; page <= 60; page += 1) {
    const { data } = await api<WpTermRow[]>(`/${restBase}?per_page=100&page=${page}`);
    rows.push(...data);
    if (data.length < 100) break;
  }

  const slugById = new Map(rows.map((r) => [r.id, r.slug]));
  const table = new Map<string, TermNode>();
  for (const row of rows) {
    table.set(row.slug, {
      slug: row.slug,
      name: decodeEntities(row.name),
      parent: (row.parent && slugById.get(row.parent)) || '',
    });
  }
  console.log(`  ${table.size} terms in "${taxonomy}"`);
  return table;
}

/**
 * The chain for one listing, ordered root -> leaf.
 *
 * The order comes from the data, not from an assumption: every term the post
 * carries in the taxonomy is walked up its parent links, and the longest
 * resulting chain is the path. Ranks are then labelled from the *species end*
 * backwards, so a chain that skips a rank near the root — ferns and conifers
 * skip superorder — still lands its family, genus and species correctly.
 */
function nestedPath(post: WpPost, config: { taxonomy: string; ranks: Rank[] }): PathNode[] {
  const owned = termGroups(post)
    .filter((t) => t.taxonomy === config.taxonomy)
    .map((t) => t.slug);
  if (!owned.length) return [];

  const chainTo = (slug: string): TermNode[] => {
    const out: TermNode[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = slug;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = termTable.get(cursor);
      if (!node) break;
      out.unshift(node);
      cursor = node.parent || undefined;
    }
    return out;
  };

  let best: TermNode[] = [];
  for (const slug of owned) {
    const chain = chainTo(slug);
    if (chain.length > best.length) best = chain;
  }
  if (!best.length) return [];

  return label(best.map((n) => ({ name: n.name, slug: n.slug })));
}

/**
 * Label an ordered chain with ranks, anchored on botanical nomenclature.
 *
 * Aligning from either end is wrong against this source: chains vary at *both*
 * ends and in the middle — ferns skip superorder, five listings omit family
 * entirely, and infraspecific taxa add a level below species. Counting from
 * either end therefore shifts every rank past the gap.
 *
 * The endings are load-bearing instead, because ICN makes them reliable:
 * -ales is an order, -aceae a family, -anae a superorder, -opsida a class.
 * The order level is the anchor; everything else is placed relative to it, and
 * the family slot is only consumed if the name actually looks like a family.
 * Verified against all 232 listings: the -aceae level sits directly under the
 * -ales level in every chain that has both.
 */
function label(chain: { name: string; slug: string }[]): PathNode[] {
  const anchor = chain.findIndex((n) => /ales$/i.test(n.name));

  // No recognisable order: fall back to aligning from the species end, which
  // is right for a plain class-to-species chain.
  if (anchor === -1) {
    const ranks: Rank[] = ['class', 'superorder', 'order', 'family', 'genus', 'species'];
    return chain.map((node, i) => {
      const fromLeaf = chain.length - i;
      const rank = i === 0 ? ranks[0] : ranks[ranks.length - fromLeaf] ?? ranks[0];
      return { rank, name: node.name, slug: node.slug };
    });
  }

  const ranks: (Rank | undefined)[] = new Array(chain.length).fill(undefined);
  ranks[anchor] = 'order';
  // Above the order: the root is the class, anything between is superorder.
  for (let i = 0; i < anchor; i += 1) ranks[i] = i === 0 ? 'class' : 'superorder';

  let i = anchor + 1;
  // Only take the family slot if the name is actually a family — five listings
  // go straight from order to genus.
  if (i < chain.length && /aceae$/i.test(chain[i].name)) ranks[i++] = 'family';
  if (i < chain.length) ranks[i++] = 'genus';
  if (i < chain.length) ranks[i++] = 'species';
  while (i < chain.length) ranks[i++] = 'subspecies';

  return chain.map((node, n) => ({
    rank: ranks[n] ?? 'species',
    name: node.name,
    slug: node.slug,
  }));
}

/**
 * Botanical nomenclature has conventional endings. This does not decide
 * anything — the chain's order comes from the parent links — but it is a cheap
 * check that the rank *labels* landed where they should, and anything it
 * disagrees with is named in the validation report rather than swallowed.
 */
const RANK_SUFFIX: Partial<Record<Rank, RegExp>> = {
  class: /opsida$|phyta$|atae$/i,
  superorder: /anae$/i,
  order: /ales$/i,
  family: /aceae$/i,
};

function suffixMismatches(path: PathNode[]): string[] {
  const out: string[] = [];
  for (const node of path) {
    const pattern = RANK_SUFFIX[node.rank];
    if (pattern && !pattern.test(node.name)) {
      out.push(`${node.name} labelled ${node.rank}`);
    }
  }
  return out;
}

/** One row of the validation report. */
interface Problem {
  slug: string;
  common: string;
  issue: string;
}

/* --------------------------------------------------------------- extraction */

/**
 * "Caltrop (<em>Tribulus terrestris</em>)" → common + binomial.
 *
 * The <em> is the split signal, not a regex on brackets: several titles carry
 * brackets in the common name itself, and a bracket regex silently mangles
 * them. Anything that does not parse is logged rather than guessed at.
 */
export function splitTitle(renderedTitle: string): { common: string; binomial: string; ok: boolean } {
  const em = /<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(renderedTitle);
  const plain = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

  if (em) {
    const binomial = plain(em[2]);
    const common = plain(renderedTitle.replace(em[0], ''))
      .replace(/[(\[]\s*[)\]]/g, '')
      .replace(/\s*[(\[]\s*$/, '')
      .replace(/^\s*[)\]]\s*/, '')
      .replace(/[\s(\[]+$/, '')
      .trim();
    return { common: common || binomial, binomial, ok: Boolean(common && binomial) };
  }

  // No <em>: keep the whole thing as the common name and flag it.
  return { common: plain(renderedTitle), binomial: '', ok: false };
}

function termGroups(post: WpPost): WpTermRef[] {
  return (post._embedded?.['wp:term'] ?? []).flat();
}

function habitatsOf(post: WpPost): string[] {
  const out: string[] = [];
  for (const term of termGroups(post)) {
    if (term.taxonomy !== HABITAT_TAXONOMY) continue;
    const habitat = HABITAT_BY_WP.get(term.slug);
    if (habitat && !out.includes(habitat.slug)) out.push(habitat.slug);
  }
  // Keep the site's canonical habitat order rather than WordPress's.
  return HABITATS.filter((h) => out.includes(h.slug)).map((h) => h.slug);
}

function pathOf(post: WpPost): PathNode[] {
  if (RANK_FROM_NESTING) return nestedPath(post, RANK_FROM_NESTING);

  const terms = termGroups(post);
  const path: PathNode[] = [];
  for (const [rank, taxonomy] of Object.entries(RANK_TAXONOMIES) as [Rank, string][]) {
    const term = terms.find((t) => t.taxonomy === taxonomy);
    if (!term) continue; // ferns and conifers skip superorder — that is expected
    path.push({ rank, name: decodeEntities(term.name), slug: term.slug || slugify(term.name) });
  }
  return path;
}

function galleryOf(post: WpPost): GalleryImage[] {
  const seen = new Set<string>();
  const out: GalleryImage[] = [];

  const push = (url: string, alt?: string, w?: number, h?: number) => {
    // Strip WordPress's size suffix so -1024x768 and the original dedupe.
    const key = url.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    if (!url || seen.has(key)) return;
    seen.add(key);
    out.push({
      src: '',
      origin: url,
      w: w ?? 0,
      h: h ?? 0,
      blur: '',
      ...(alt && alt.trim() ? { alt: decodeEntities(alt).trim() } : {}),
    });
  };

  // The featured image is first (SPEC §4).
  const featured = post._embedded?.['wp:featuredmedia']?.[0];
  if (featured?.source_url) {
    push(featured.source_url, featured.alt_text, featured.media_details?.width, featured.media_details?.height);
  }

  // Then every image in the body, in post order.
  const html = post.content?.rendered ?? '';
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const full = /data-orig-file="([^"]+)"/.exec(tag)?.[1];
    const src = full ?? /\bsrc="([^"]+)"/.exec(tag)?.[1];
    if (!src || src.startsWith('data:')) continue;
    const alt = /\balt="([^"]*)"/.exec(tag)?.[1];
    const w = Number(/\bwidth="(\d+)"/.exec(tag)?.[1] ?? 0) || undefined;
    const h = Number(/\bheight="(\d+)"/.exec(tag)?.[1] ?? 0) || undefined;
    push(src, alt, w, h);
  }

  return out;
}

function instagramOf(post: WpPost): string | undefined {
  const html = post.content?.rendered ?? '';
  const link = /https?:\/\/(?:www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?/.exec(html)?.[0];
  return link ? link.replace(/\/?$/, '/') : undefined;
}

/* -------------------------------------------------------------------- main */

async function fetchAll(): Promise<WpPost[]> {
  const posts: WpPost[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, headers } = await api<WpPost[]>(`/${POST_TYPE}?per_page=100&page=${page}&_embed`);
    posts.push(...data);
    const totalPages = Number(headers.get('x-wp-totalpages') ?? 1);
    console.log(`  page ${page}/${totalPages} — ${data.length} posts (${posts.length} so far)`);
    if (page >= totalPages || data.length === 0) break;
  }
  return posts;
}

async function loadPosts(): Promise<WpPost[]> {
  const wxr = wxrPathFromArgs();

  if (wxr) {
    console.log(`Importing from the export file ${wxr}\n`);
    const source = await readWxr(wxr, POST_TYPE === 'posts' ? 'post' : POST_TYPE);
    console.log(`  ${source.posts.length} published ${POST_TYPE}, ${source.terms.length} terms`);
    if (RANK_FROM_NESTING) {
      // The export already declares every term's parent, by slug.
      for (const term of source.terms) {
        if (term.taxonomy !== RANK_FROM_NESTING.taxonomy) continue;
        termTable.set(term.slug, { slug: term.slug, name: term.name, parent: term.parent });
      }
      console.log(`  ${termTable.size} terms in "${RANK_FROM_NESTING.taxonomy}"`);
    }
    return source.posts;
  }

  console.log(`Importing from ${SOURCE}\n`);
  // The rank chain lives in the parent links, and ?_embed does not carry them,
  // so the taxonomy's terms are fetched once up front.
  if (RANK_FROM_NESTING) {
    termTable = await fetchTermTable(RANK_FROM_NESTING.taxonomy);
  }
  return fetchAll();
}

async function main(): Promise<void> {
  const posts = await loadPosts();
  await dumpRaw('posts.json', posts);

  const problems: Problem[] = [];
  const listings: Listing[] = posts.map((post) => {
    const { common, ok } = splitTitle(post.title?.rendered ?? '');
    let { binomial } = splitTitle(post.title?.rendered ?? '');
    const body = toParagraphs(post.content?.rendered ?? '');
    const summary = firstSentence(body);
    const habitats = habitatsOf(post);
    const path = pathOf(post);
    const gallery = galleryOf(post);

    // A title that will not split still has its accepted name in the rank
    // chain — taken from the data rather than guessed at from the title.
    if (!binomial) {
      binomial = path.find((p) => p.rank === 'subspecies')?.name
        ?? path.find((p) => p.rank === 'species')?.name
        ?? '';
    }

    if (!ok) problems.push({ slug: post.slug, common, issue: 'title did not split into common + binomial' });
    if (!path.length) problems.push({ slug: post.slug, common, issue: 'no rank chain' });
    for (const mismatch of suffixMismatches(path)) {
      problems.push({ slug: post.slug, common, issue: `rank label looks wrong: ${mismatch}` });
    }
    if (!habitats.length) problems.push({ slug: post.slug, common, issue: 'no habitat tags' });
    if (!gallery.length) problems.push({ slug: post.slug, common, issue: 'no images' });
    if (!body.length) problems.push({ slug: post.slug, common, issue: 'empty body' });

    const listing: Listing = {
      // Verbatim from WordPress — never regenerated (SPEC §2).
      slug: post.slug,
      wpId: post.id,
      common,
      binomial,
      date: (post.date_gmt ?? post.date ?? '').slice(0, 10),
      summary,
      body,
      habitats,
      path,
      gallery,
    };
    const instagram = instagramOf(post);
    if (instagram) listing.instagram = instagram;
    return listing;
  });

  listings.sort((a, b) => a.common.localeCompare(b.common, 'en'));

  const out = `${DATA_DIR}listings.json`;
  await writeFile(out, `${JSON.stringify(listings, null, 2)}\n`);

  /* ------------------------------------------------------ validation report */

  let overrides: Record<string, unknown> = {};
  try {
    overrides = JSON.parse(await readFile(`${DATA_DIR}overrides.json`, 'utf8')) as Record<string, unknown>;
  } catch { /* no overrides yet */ }

  const byIssue = new Map<string, Problem[]>();
  for (const problem of problems) {
    const list = byIssue.get(problem.issue) ?? [];
    list.push(problem);
    byIssue.set(problem.issue, list);
  }

  console.log(`\n${listings.length} listings written to ${out}\n`);

  if (RANK_FROM_NESTING) {
    const lengths = new Map<number, number>();
    for (const listing of listings) {
      lengths.set(listing.path.length, (lengths.get(listing.path.length) ?? 0) + 1);
    }
    console.log('Rank chain lengths');
    console.log('──────────────────');
    for (const [length, count] of [...lengths].sort((a, b) => a[0] - b[0])) {
      const example = listings.find((l) => l.path.length === length);
      const shape = example?.path.map((n) => n.rank).join(' > ') ?? '';
      console.log(`  ${String(count).padStart(4)} listings with ${length} levels   ${shape}`);
    }
    console.log('');
  }

  console.log('Validation report');
  console.log('─────────────────');

  if (!problems.length) {
    console.log('  Nothing to fix.');
  }
  for (const [issue, list] of byIssue) {
    const unfixed = list.filter((p) => !(p.slug in overrides));
    console.log(`\n  ${issue}: ${list.length} (${list.length - unfixed.length} already covered by overrides.json)`);
    for (const problem of unfixed.slice(0, 30)) {
      console.log(`    ${problem.slug.padEnd(46)} ${problem.common}`);
    }
    if (unfixed.length > 30) console.log(`    …and ${unfixed.length - 30} more`);
  }

  if (!Object.keys(RANK_TAXONOMIES).length && !RANK_FROM_NESTING) {
    console.log(
      '\n  NOTE: data/taxonomy-map.json is absent, so every listing has an empty\n' +
        '  `path` and the classification tree will be empty. Run `npm run recon`,\n' +
        '  read data/raw/taxonomy-map.suggested.json, and move it into place once\n' +
        '  you are satisfied it is right — do not guess the structure.',
    );
  }

  console.log('\n  Fix what is left in data/overrides.json, keyed by slug. It is merged');
  console.log('  over this file at build time, so re-running the import keeps it.\n');
  console.log('  Next: npm run images\n');
}

main().catch((error) => {
  console.error('\nImport failed:', error);
  process.exitCode = 1;
});
