/**
 * SPEC §4, Phase 0 — reconnaissance. Run this before writing or trusting a
 * single line of the importer.
 *
 *   npm run recon
 *
 * It reports what the WordPress API actually contains and stops. In
 * particular it answers the one question the importer cannot guess: whether
 * the taxonomic rank chain (class → superorder → order → family → genus →
 * species) is stored as a hierarchical taxonomy, as flat categories, or only
 * as the hand-built HTML on /classification.
 */
import { api, dumpRaw, decodeEntities, SOURCE, API } from './wp.ts';

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

async function countOf(restBase: string): Promise<{ total: number; pages: number }> {
  const { headers } = await api<unknown[]>(`/${restBase}?per_page=1`);
  return {
    total: Number(headers.get('x-wp-total') ?? 0),
    pages: Number(headers.get('x-wp-totalpages') ?? 0),
  };
}

async function allTerms(restBase: string, cap = 400): Promise<WpTerm[]> {
  const out: WpTerm[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await api<WpTerm[]>(`/${restBase}?per_page=100&page=${page}&orderby=count&order=desc`);
    out.push(...data);
    if (data.length < 100 || out.length >= cap) break;
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`Source: ${SOURCE}`);
  console.log(`API:    ${API}`);

  /* 1. What post types and taxonomies exist. */
  const { data: types } = await api<Record<string, WpType>>('/types');
  await dumpRaw('types.json', types);

  const { data: taxonomies } = await api<Record<string, WpTaxonomy>>('/taxonomies');
  await dumpRaw('taxonomies.json', taxonomies);

  heading('Post types');
  for (const [key, type] of Object.entries(types)) {
    const restBase = type.rest_base ?? key;
    let count = '—';
    try {
      count = String((await countOf(restBase)).total);
    } catch { /* some types are not exposed */ }
    console.log(`  ${key.padEnd(20)} ${String(type.name).padEnd(22)} ${count.padStart(6)} items  taxonomies: ${(type.taxonomies ?? []).join(', ') || '—'}`);
  }

  heading('Taxonomies');
  const termDump: Record<string, WpTerm[]> = {};
  for (const [key, tax] of Object.entries(taxonomies)) {
    let terms: WpTerm[] = [];
    try {
      terms = await allTerms(tax.rest_base);
    } catch (error) {
      console.log(`  ${key.padEnd(20)} (terms unavailable: ${String(error)})`);
      continue;
    }
    termDump[key] = terms;
    const hier = tax.hierarchical ? 'hierarchical' : 'flat';
    console.log(`  ${key.padEnd(20)} ${String(tax.name).padEnd(22)} ${String(terms.length).padStart(4)} terms  ${hier}  types: ${tax.types.join(', ')}`);
    console.log(`      top terms: ${terms.slice(0, 12).map((t) => `${t.slug}(${t.count})`).join(', ')}`);
    if (tax.hierarchical) {
      const roots = terms.filter((t) => !t.parent).length;
      const depthNote = terms.some((t) => t.parent) ? 'has nesting' : 'no nesting present';
      console.log(`      ${roots} root terms, ${depthNote}`);
    }
  }
  await dumpRaw('terms.json', termDump);

  /* 2. One full post, embedded, to read by hand. */
  const { data: sample } = await api<unknown[]>('/posts?per_page=1&_embed');
  const post = sample[0] as Record<string, unknown> | undefined;
  const samplePath = await dumpRaw('sample-post.json', post ?? null);

  heading('Sample post');
  if (!post) {
    console.log('  No posts returned — check the post type used for listings.');
  } else {
    const title = decodeEntities(String((post.title as { rendered?: string })?.rendered ?? ''));
    console.log(`  id ${String(post.id)}  slug "${String(post.slug)}"`);
    console.log(`  title (raw HTML): ${(post.title as { rendered?: string })?.rendered}`);
    console.log(`  title (decoded):  ${title}`);
    console.log(`  date: ${String(post.date)}`);
    console.log(`  top-level keys: ${Object.keys(post).join(', ')}`);
    const embedded = post._embedded as Record<string, unknown> | undefined;
    console.log(`  _embedded keys: ${embedded ? Object.keys(embedded).join(', ') : '—'}`);
    const terms = (embedded?.['wp:term'] as { taxonomy: string; slug: string; name: string }[][] | undefined) ?? [];
    terms.forEach((group, i) => {
      console.log(`  wp:term[${i}] ${group[0]?.taxonomy ?? '(empty)'}: ${group.map((t) => t.slug).join(', ') || '—'}`);
    });
    const content = String((post.content as { rendered?: string })?.rendered ?? '');
    const imgs = [...content.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    console.log(`  images in content: ${imgs.length}`);
    imgs.slice(0, 3).forEach((src) => console.log(`    ${src}`));
    console.log(`  full dump: ${samplePath}`);
  }

  /* 3. Total listing count. */
  heading('Totals');
  const posts = await countOf('posts');
  console.log(`  posts: ${posts.total} across ${posts.pages} pages of 100`);

  /* 4. The question the importer cannot guess. */
  heading('Rank chain — where does it live?');
  const rankNames = ['class', 'superorder', 'order', 'family', 'genus', 'species'];
  const rankTaxonomies = Object.entries(taxonomies).filter(([key, tax]) =>
    rankNames.some((r) => key.toLowerCase().includes(r) || tax.name.toLowerCase().includes(r)),
  );

  if (rankTaxonomies.length) {
    console.log('  Found taxonomies that look like ranks:');
    for (const [key, tax] of rankTaxonomies) {
      console.log(`    ${key} — ${tax.name} (${tax.hierarchical ? 'hierarchical' : 'flat'}, ${termDump[key]?.length ?? '?'} terms)`);
    }
    console.log('\n  → The chain is in the API. Configure scripts/import.ts RANK_TAXONOMIES with these.');
  } else {
    const hierarchical = Object.entries(taxonomies).filter(([, t]) => t.hierarchical);
    if (hierarchical.some(([key]) => (termDump[key] ?? []).some((t) => t.parent))) {
      console.log('  No rank-named taxonomies, but a hierarchical taxonomy has nesting:');
      hierarchical.forEach(([key]) => {
        const nested = (termDump[key] ?? []).filter((t) => t.parent).length;
        console.log(`    ${key}: ${nested} terms have a parent`);
      });
      console.log('\n  → The chain may be encoded as nesting depth. Confirm the depth order by hand before mapping it to ranks.');
    } else {
      console.log('  No rank taxonomy and no nesting found in the API.');
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
  const allSlugs = new Set(Object.values(termDump).flat().map((t) => t.slug));
  for (const slug of expected) {
    console.log(`  ${allSlugs.has(slug) ? '✓' : '✗'} ${slug}`);
  }
  const missing = expected.filter((s) => !allSlugs.has(s));
  if (missing.length) {
    console.log(`\n  ${missing.length} expected habitat slug(s) not found. Check data/raw/terms.json`);
    console.log('  and correct the mapping in src/lib/habitats.ts before importing.');
  }

  console.log('\nRaw dumps written to data/raw/. Read them before running the import.\n');
}

main().catch((error) => {
  console.error('\nRecon failed:', error);
  console.error(
    '\nIf this is a network or policy denial rather than a WordPress error, the API\n' +
      'host is unreachable from here — report the blocked host rather than guessing\n' +
      'the taxonomy structure (SPEC §4, Phase 0).',
  );
  process.exitCode = 1;
});
