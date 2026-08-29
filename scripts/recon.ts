/**
 * SPEC §4, Phase 0 — reconnaissance. Run this before writing or trusting a
 * single line of the importer.
 *
 *   npm run recon                       # against the live REST API
 *   npm run recon -- --wxr=export.xml   # against a WordPress export file
 *
 * It reports what the source actually contains and stops. In particular it
 * answers the one question the importer cannot guess: whether the taxonomic
 * rank chain (class → superorder → order → family → genus → species) is
 * stored as a hierarchical taxonomy, as flat categories, or only as the
 * hand-built HTML on /classification.
 *
 * Do not guess the taxonomy structure. Read this output, read data/raw/,
 * then decide.
 */
import type { Rank } from '../src/lib/types.ts';
import { api, dumpRaw, decodeEntities, SOURCE, API } from './wp.ts';
import { readWxr, wxrPathFromArgs, type WxrTerm } from './wxr.ts';

/* ------------------------------------------------------------ shared shape */

/** What recon needs to know, however the content was reached. */
interface Survey {
  origin: string;
  /** Post type -> number of items. */
  postTypes: Map<string, { count: number; label: string; taxonomies: string[] }>;
  /** Taxonomy slug -> its terms, most used first. */
  taxonomies: Map<string, { label: string; hierarchical: boolean; types: string[]; terms: WxrTerm[] }>;
  totalPosts: number;
  sample: SamplePost | null;
}

interface SamplePost {
  id: number;
  slug: string;
  titleHtml: string;
  date: string;
  keys: string[];
  terms: { taxonomy: string; slugs: string[] }[];
  imageCount: number;
  imageSample: string[];
  dumpPath: string;
}

interface WpType { slug: string; name: string; taxonomies?: string[]; rest_base?: string }
interface WpTaxonomy {
  slug: string;
  name: string;
  hierarchical: boolean;
  rest_base: string;
  types: string[];
}
interface WpTerm { id: number; name: string; slug: string; parent?: number; count: number }

function heading(text: string): void {
  console.log(`\n${text}\n${'─'.repeat(text.length)}`);
}

function imagesIn(html: string): string[] {
  return [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
}

/* ------------------------------------------------------------- API surveyor */

async function countOf(restBase: string): Promise<{ total: number; pages: number }> {
  const { headers } = await api<unknown[]>(`/${restBase}?per_page=1`);
  return {
    total: Number(headers.get('x-wp-total') ?? 0),
    pages: Number(headers.get('x-wp-totalpages') ?? 0),
  };
}

async function allTerms(restBase: string, cap = 2000): Promise<WpTerm[]> {
  const out: WpTerm[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await api<WpTerm[]>(`/${restBase}?per_page=100&page=${page}&orderby=count&order=desc`);
    out.push(...data);
    if (data.length < 100 || out.length >= cap) break;
  }
  return out;
}

async function surveyApi(): Promise<Survey> {
  const { data: types } = await api<Record<string, WpType>>('/types');
  await dumpRaw('types.json', types);
  const { data: taxonomies } = await api<Record<string, WpTaxonomy>>('/taxonomies');
  await dumpRaw('taxonomies.json', taxonomies);

  const postTypes: Survey['postTypes'] = new Map();
  for (const [key, type] of Object.entries(types)) {
    let count = 0;
    try {
      count = (await countOf(type.rest_base ?? key)).total;
    } catch { /* not every type is exposed */ }
    postTypes.set(key, { count, label: String(type.name), taxonomies: type.taxonomies ?? [] });
  }

  const surveyed: Survey['taxonomies'] = new Map();
  const termDump: Record<string, WpTerm[]> = {};
  for (const [key, tax] of Object.entries(taxonomies)) {
    let terms: WpTerm[] = [];
    try {
      terms = await allTerms(tax.rest_base);
    } catch {
      console.log(`  (terms for ${key} unavailable)`);
    }
    termDump[key] = terms;
    surveyed.set(key, {
      label: String(tax.name),
      hierarchical: tax.hierarchical,
      types: tax.types,
      terms: terms.map((t) => ({
        id: t.id,
        taxonomy: key,
        slug: t.slug,
        name: t.name,
        parent: t.parent ? String(t.parent) : '',
        count: t.count,
      })),
    });
  }
  await dumpRaw('terms.json', termDump);

  const { data: sampleList } = await api<Record<string, unknown>[]>('/posts?per_page=1&_embed');
  const post = sampleList[0];
  const dumpPath = await dumpRaw('sample-post.json', post ?? null);

  let sample: SamplePost | null = null;
  if (post) {
    const content = String((post.content as { rendered?: string })?.rendered ?? '');
    const embedded = post._embedded as Record<string, unknown> | undefined;
    const groups = (embedded?.['wp:term'] as { taxonomy: string; slug: string }[][] | undefined) ?? [];
    sample = {
      id: Number(post.id),
      slug: String(post.slug),
      titleHtml: String((post.title as { rendered?: string })?.rendered ?? ''),
      date: String(post.date),
      keys: Object.keys(post),
      terms: groups.map((g) => ({ taxonomy: g[0]?.taxonomy ?? '(empty)', slugs: g.map((t) => t.slug) })),
      imageCount: imagesIn(content).length,
      imageSample: imagesIn(content).slice(0, 3),
      dumpPath,
    };
  }

  return {
    origin: `${SOURCE}  (${API})`,
    postTypes,
    taxonomies: surveyed,
    totalPosts: (await countOf('posts')).total,
    sample,
  };
}

/* ------------------------------------------------------------- WXR surveyor */

async function surveyWxr(path: string): Promise<Survey> {
  const source = await readWxr(path);
  await dumpRaw('posts.json', source.posts);

  const postTypes: Survey['postTypes'] = new Map();
  for (const [type, count] of source.postTypes) {
    postTypes.set(type, { count, label: type, taxonomies: [] });
  }

  const taxonomies: Survey['taxonomies'] = new Map();
  for (const [taxonomy, terms] of source.byTaxonomy) {
    taxonomies.set(taxonomy, {
      label: taxonomy,
      // An export file does not declare hierarchy directly; a term carrying a
      // parent is the evidence that the taxonomy is hierarchical.
      hierarchical: terms.some((t) => t.parent),
      types: ['post'],
      terms,
    });
  }
  await dumpRaw('terms.json', Object.fromEntries(source.byTaxonomy));

  const post = source.posts[0];
  const dumpPath = await dumpRaw('sample-post.json', post ?? null);
  const sample: SamplePost | null = post
    ? {
        id: post.id,
        slug: post.slug,
        titleHtml: post.title.rendered,
        date: post.date,
        keys: Object.keys(post),
        terms: (post._embedded?.['wp:term'] ?? []).map((g) => ({
          taxonomy: g[0]?.taxonomy ?? '(empty)',
          slugs: g.map((t) => t.slug),
        })),
        imageCount: imagesIn(post.content.rendered).length,
        imageSample: imagesIn(post.content.rendered).slice(0, 3),
        dumpPath,
      }
    : null;

  return {
    origin: `${path}  (WordPress export${source.site ? ` of ${source.site}` : ''})`,
    postTypes,
    taxonomies,
    totalPosts: source.posts.length,
    sample,
  };
}

/* --------------------------------------------------------------- the report */

/**
 * Propose a taxonomy map for a human to check. It is written to data/raw/
 * — gitignored, and deliberately not where the importer looks — so putting it
 * into effect stays a decision someone makes, not something recon did.
 */
async function suggestMap(
  survey: Survey,
  rankTaxonomies: [string, { label: string }][],
): Promise<string> {
  const ranks: Partial<Record<Rank, string>> = {};
  const order: Rank[] = ['class', 'superorder', 'order', 'family', 'genus', 'species'];
  const claimed = new Set<string>();

  // Exact names first, so "order" cannot claim the "superorder" taxonomy, and
  // one taxonomy is never assigned to two ranks.
  const match = (rank: Rank, exact: boolean) =>
    rankTaxonomies.find(([key, tax]) => {
      if (claimed.has(key)) return false;
      const candidates = [key.toLowerCase(), tax.label.toLowerCase()];
      return exact
        ? candidates.includes(rank)
        : candidates.some((c) => new RegExp(`(^|[^a-z])${rank}([^a-z]|$)`).test(c));
    });

  for (const pass of [true, false]) {
    for (const rank of order) {
      if (ranks[rank]) continue;
      const hit = match(rank, pass);
      if (!hit) continue;
      ranks[rank] = hit[0];
      claimed.add(hit[0]);
    }
  }

  const habitatTaxonomy =
    [...survey.taxonomies].find(([, tax]) =>
      tax.terms.some((t) => t.slug === 'crackplants' || t.slug === 'paddockweeds'),
    )?.[0] ?? 'post_tag';

  return dumpRaw('taxonomy-map.suggested.json', {
    _readme:
      'Suggested by npm run recon. Check it against data/raw/terms.json, then move ' +
      'it to data/taxonomy-map.json to put it into effect. Delete this _readme key.',
    ranks,
    habitatTaxonomy,
    postType: 'posts',
  });
}

let pendingSuggestion: [string, { label: string }][] | null = null;

function report(survey: Survey): void {
  console.log(`Source: ${survey.origin}`);

  heading('Post types');
  for (const [key, type] of survey.postTypes) {
    console.log(
      `  ${key.padEnd(20)} ${type.label.padEnd(22)} ${String(type.count).padStart(6)} items` +
        (type.taxonomies.length ? `  taxonomies: ${type.taxonomies.join(', ')}` : ''),
    );
  }

  heading('Taxonomies');
  for (const [key, tax] of survey.taxonomies) {
    console.log(
      `  ${key.padEnd(20)} ${tax.label.padEnd(22)} ${String(tax.terms.length).padStart(4)} terms  ` +
        `${tax.hierarchical ? 'hierarchical' : 'flat'}  types: ${tax.types.join(', ')}`,
    );
    console.log(`      top terms: ${tax.terms.slice(0, 12).map((t) => `${t.slug}(${t.count})`).join(', ') || '—'}`);
    if (tax.hierarchical) {
      const roots = tax.terms.filter((t) => !t.parent).length;
      const nested = tax.terms.filter((t) => t.parent).length;
      console.log(`      ${roots} root terms, ${nested} with a parent`);
    }
  }

  heading('Sample post');
  if (!survey.sample) {
    console.log('  No posts returned — check the post type used for listings.');
  } else {
    const s = survey.sample;
    console.log(`  id ${s.id}  slug "${s.slug}"`);
    console.log(`  title (raw HTML): ${s.titleHtml}`);
    console.log(`  title (decoded):  ${decodeEntities(s.titleHtml.replace(/<[^>]+>/g, ''))}`);
    console.log(`  date: ${s.date}`);
    console.log(`  top-level keys: ${s.keys.join(', ')}`);
    s.terms.forEach((group, i) => {
      console.log(`  terms[${i}] ${group.taxonomy}: ${group.slugs.join(', ') || '—'}`);
    });
    console.log(`  images in content: ${s.imageCount}`);
    s.imageSample.forEach((src) => console.log(`    ${src}`));
    console.log(`  full dump: ${s.dumpPath}`);
  }

  heading('Totals');
  console.log(`  listings: ${survey.totalPosts}`);

  /* The question the importer cannot guess. */
  heading('Rank chain — where does it live?');
  const rankNames = ['class', 'superorder', 'order', 'family', 'genus', 'species'];
  const rankTaxonomies = [...survey.taxonomies].filter(
    ([key, tax]) =>
      rankNames.some((r) => key.toLowerCase().includes(r) || tax.label.toLowerCase().includes(r)),
  );

  if (rankTaxonomies.length) {
    console.log('  Found taxonomies that look like ranks:');
    for (const [key, tax] of rankTaxonomies) {
      console.log(`    ${key} — ${tax.label} (${tax.hierarchical ? 'hierarchical' : 'flat'}, ${tax.terms.length} terms)`);
    }
    pendingSuggestion = rankTaxonomies;
    console.log('\n  → The chain is in the data. A suggested map has been written for you to');
    console.log('    check; see the end of this report.');
  } else {
    const nested = [...survey.taxonomies].filter(([, t]) => t.terms.some((term) => term.parent));
    if (nested.length) {
      console.log('  No rank-named taxonomies, but these have nesting:');
      for (const [key, tax] of nested) {
        console.log(`    ${key}: ${tax.terms.filter((t) => t.parent).length} of ${tax.terms.length} terms have a parent`);
      }
      console.log('\n  → The chain may be encoded as nesting depth. Set RANK_FROM_NESTING, but');
      console.log('    confirm the depth order by hand against data/raw/terms.json first.');
    } else {
      console.log('  No rank taxonomy and no nesting found.');
      console.log('\n  → The chain is probably only in the hand-built HTML on /classification.');
      console.log('    That is a separate, more fragile scrape-and-join job (join on species');
      console.log('    name) and must be planned deliberately — do not guess it.');
    }
  }

  heading('Habitat tag check');
  const expected = [
    'paddockweeds', 'crackplants', 'infrastructureweeds', 'riparianweeds',
    'coastalweeds', 'environmentalweeds', 'residentialweeds', 'structureweeds',
    'nativeweeds',
  ];
  const allSlugs = new Set([...survey.taxonomies.values()].flatMap((t) => t.terms.map((term) => term.slug)));
  for (const slug of expected) console.log(`  ${allSlugs.has(slug) ? '✓' : '✗'} ${slug}`);
  const missing = expected.filter((s) => !allSlugs.has(s));
  if (missing.length) {
    console.log(`\n  ${missing.length} expected habitat slug(s) not found. Check data/raw/terms.json`);
    console.log('  and correct the mapping in src/lib/habitats.ts before importing.');
  }

  console.log('\nRaw dumps written to data/raw/. Read them before running the import.\n');
}

async function main(): Promise<void> {
  const wxr = wxrPathFromArgs();
  const survey = wxr ? await surveyWxr(wxr) : await surveyApi();
  report(survey);

  if (pendingSuggestion) {
    const path = await suggestMap(survey, pendingSuggestion);
    console.log('Suggested taxonomy map');
    console.log('──────────────────────');
    console.log(`  ${path}`);
    console.log('\n  Check it against data/raw/terms.json. If it is right:');
    console.log('\n    mv data/raw/taxonomy-map.suggested.json data/taxonomy-map.json');
    console.log('\n  Nothing reads it until you do — that step is the decision SPEC §4');
    console.log('  Phase 0 asks you to make.\n');
  }
}

main().catch((error) => {
  console.error('\nRecon failed:', error);
  console.error(
    '\nIf the API host is unreachable rather than broken, do not guess the taxonomy\n' +
      'structure (SPEC §4, Phase 0). Export the site from WordPress admin\n' +
      '(Tools → Export → All content) and run:\n' +
      '\n    npm run recon -- --wxr=path/to/export.xml\n',
  );
  process.exitCode = 1;
});
