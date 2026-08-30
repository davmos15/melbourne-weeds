/**
 * Offline source: a WordPress export file (WXR).
 *
 * The REST API route in scripts/wp.ts needs network access to the live site.
 * When that is not available — an egress policy, a site behind auth, a site
 * that has since gone down — the owner can produce the same content from
 * WordPress admin under **Tools → Export → All content**, which downloads a
 * single `.xml` file. That file carries everything the importer needs:
 * slugs, post ids, dates, the raw title HTML, the body, every taxonomy term
 * with its taxonomy name, and the attachment URLs.
 *
 *   npm run recon  -- --wxr=data/raw/weedsofmelbourne.xml
 *   npm run import -- --wxr=data/raw/weedsofmelbourne.xml
 *
 * This parses that file into exactly the shape the REST route produces, so
 * the importer, the validation report and the rank-chain question are
 * identical either way. It is an alternative route to the same content, not
 * a different importer.
 */
import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import type { WpPost, WpTermRef } from './wp.ts';

/** A term as the export file declares it, before it is attached to a post. */
export interface WxrTerm {
  id: number;
  taxonomy: string;
  slug: string;
  name: string;
  parent: string;
  /** How many published posts carry it — counted, not declared. */
  count: number;
}

export interface WxrSource {
  posts: WpPost[];
  terms: WxrTerm[];
  /** Taxonomy slug -> its terms, for the recon report. */
  byTaxonomy: Map<string, WxrTerm[]>;
  site: string;
  /** Post types seen in the file, with counts, published or not. */
  postTypes: Map<string, number>;
}

type Node = Record<string, unknown>;

/** WXR omits a repeated element entirely when there is one, or none. */
function list(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Node[];
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    const node = value as Node;
    // WordPress wraps most human-readable values in CDATA, so that has to be
    // checked before #text or every term name comes back empty.
    const cdata = node.__cdata;
    if (cdata !== undefined) return String(cdata);
    const plain = node['#text'];
    return plain === undefined ? '' : String(plain);
  }
  return String(value);
}

function num(value: unknown): number {
  const n = Number(text(value));
  return Number.isFinite(n) ? n : 0;
}

/** "2023-05-31 10:00:00" -> "2023-05-31T10:00:00Z"; blanks stay blank. */
function wpDate(value: unknown): string {
  const raw = text(value).trim();
  if (!raw || raw.startsWith('0000')) return '';
  return `${raw.replace(' ', 'T')}Z`;
}

export async function readWxr(path: string, postType = 'post'): Promise<WxrSource> {
  const xml = await readFile(path, 'utf8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Slugs like "2023" and "0426" must stay strings, so nothing is coerced.
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // Titles arrive entity-encoded (`&lt;em&gt;`), and decoding them is what
    // gives splitTitle() the <em> it uses as the split signal.
    processEntities: true,
    cdataPropName: '__cdata',
  });

  const doc = parser.parse(xml) as Node;
  const channel = ((doc.rss as Node)?.channel ?? {}) as Node;
  const site = text(channel['wp:base_site_url']) || text(channel.link);

  /* ------------------------------------------------------------- terms */

  const terms: WxrTerm[] = [];
  const termBySlug = new Map<string, WxrTerm>();

  const addTerm = (taxonomy: string, slug: string, name: string, parent: string, id: number) => {
    if (!slug) return;
    const key = `${taxonomy}::${slug}`;
    if (termBySlug.has(key)) return;
    const term: WxrTerm = { id, taxonomy, slug, name, parent, count: 0 };
    terms.push(term);
    termBySlug.set(key, term);
  };

  for (const t of list(channel['wp:term'])) {
    addTerm(
      text(t['wp:term_taxonomy']),
      text(t['wp:term_slug']),
      text(t['wp:term_name']),
      text(t['wp:term_parent']),
      num(t['wp:term_id']),
    );
  }
  // Older exports declare categories and tags in their own elements.
  for (const c of list(channel['wp:category'])) {
    addTerm('category', text(c['wp:category_nicename']), text(c['wp:cat_name']), text(c['wp:category_parent']), num(c['wp:term_id']));
  }
  for (const t of list(channel['wp:tag'])) {
    addTerm('post_tag', text(t['wp:tag_slug']), text(t['wp:tag_name']), '', num(t['wp:term_id']));
  }

  /* ------------------------------------------------- items, in two passes */

  const items = list(channel.item);
  const postTypes = new Map<string, number>();

  const cdataOr = (node: unknown): string => {
    if (node && typeof node === 'object' && '__cdata' in (node as Node)) {
      return String((node as Node).__cdata ?? '');
    }
    return text(node);
  };

  const metaOf = (item: Node): Map<string, string> => {
    const out = new Map<string, string>();
    for (const meta of list(item['wp:postmeta'])) {
      out.set(cdataOr(meta['wp:meta_key']), cdataOr(meta['wp:meta_value']));
    }
    return out;
  };

  // Pass 1: attachments, so a post's featured image can be resolved by id.
  const attachments = new Map<number, { url: string; alt: string }>();
  for (const item of items) {
    const type = text(item['wp:post_type']);
    postTypes.set(type, (postTypes.get(type) ?? 0) + 1);
    if (type !== 'attachment') continue;
    const url = text(item['wp:attachment_url']);
    if (!url) continue;
    attachments.set(num(item['wp:post_id']), {
      url,
      alt: metaOf(item).get('_wp_attachment_image_alt') ?? '',
    });
  }

  // Pass 2: the listings themselves.
  const posts: WpPost[] = [];
  for (const item of items) {
    if (text(item['wp:post_type']) !== postType) continue;
    if (text(item['wp:status']) !== 'publish') continue;

    const termRefs: WpTermRef[] = [];
    for (const category of list(item.category)) {
      const taxonomy = text(category['@_domain']);
      const slug = text(category['@_nicename']);
      if (!taxonomy || !slug) continue;
      const known = termBySlug.get(`${taxonomy}::${slug}`);
      if (known) known.count += 1;
      else addTerm(taxonomy, slug, cdataOr(category), '', 0);
      termRefs.push({
        id: known?.id ?? 0,
        name: cdataOr(category) || known?.name || slug,
        slug,
        taxonomy,
      });
    }

    const thumbnailId = Number(metaOf(item).get('_thumbnail_id') ?? '');
    const featured = Number.isFinite(thumbnailId) ? attachments.get(thumbnailId) : undefined;

    posts.push({
      id: num(item['wp:post_id']),
      slug: text(item['wp:post_name']),
      date: wpDate(item['wp:post_date']),
      date_gmt: wpDate(item['wp:post_date_gmt']) || wpDate(item['wp:post_date']),
      link: text(item.link),
      title: { rendered: cdataOr(item.title) },
      content: { rendered: cdataOr(item['content:encoded']) },
      excerpt: { rendered: cdataOr(item['excerpt:encoded']) },
      _embedded: {
        // One group per taxonomy, mirroring how ?_embed nests them.
        'wp:term': groupByTaxonomy(termRefs),
        ...(featured
          ? {
              'wp:featuredmedia': [
                { id: thumbnailId, source_url: featured.url, alt_text: featured.alt },
              ],
            }
          : {}),
      },
    });
  }

  const byTaxonomy = new Map<string, WxrTerm[]>();
  for (const term of terms) {
    const group = byTaxonomy.get(term.taxonomy) ?? [];
    group.push(term);
    byTaxonomy.set(term.taxonomy, group);
  }
  for (const group of byTaxonomy.values()) group.sort((a, b) => b.count - a.count);

  return { posts, terms, byTaxonomy, site, postTypes };
}

function groupByTaxonomy(refs: WpTermRef[]): WpTermRef[][] {
  const groups = new Map<string, WpTermRef[]>();
  for (const ref of refs) {
    const group = groups.get(ref.taxonomy) ?? [];
    group.push(ref);
    groups.set(ref.taxonomy, group);
  }
  return [...groups.values()];
}

/** `--wxr=path` on the command line, or the WP_WXR environment variable. */
export function wxrPathFromArgs(argv = process.argv): string | undefined {
  const flag = argv.find((a) => a.startsWith('--wxr='))?.slice(6);
  return flag || process.env.WP_WXR || undefined;
}
