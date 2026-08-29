import type { Listing, PathNode, Rank } from './types.ts';
import { RANKS } from './types.ts';

/**
 * SPEC §5 — the classification tree is derived from each listing's `path`
 * at build time and never hand-maintained. Adding a listing with a new
 * family makes that family appear, with a correct count, everywhere.
 *
 * Paths are variable length (ferns and conifers skip superorder), so nothing
 * here assumes six levels or a fixed parent rank.
 */

export interface TreeNode {
  rank: Rank;
  name: string;
  /** URL segment under /tree/. Unique across the whole tree. */
  slug: string;
  /** Ancestors, outermost first — used for the crumb on a node page. */
  ancestors: TreeNode[];
  children: TreeNode[];
  /** Listings at or below this node, sorted by common name. */
  listings: Listing[];
}

export interface Tree {
  roots: TreeNode[];
  /** Every node, keyed by its unique URL slug. */
  bySlug: Map<string, TreeNode>;
  /** Total node count, for the tree page's summary line. */
  size: number;
}

interface Building {
  rank: Rank;
  name: string;
  rawSlug: string;
  slug: string;
  parent: Building | null;
  children: Map<string, Building>;
  listings: Listing[];
}

const rankOrder = new Map<Rank, number>(RANKS.map((r, i) => [r, i]));

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'en');
}

export function buildTree(listings: Listing[]): Tree {
  const roots = new Map<string, Building>();
  /** rawSlug -> the node that claimed it, so collisions can be disambiguated. */
  const claimed = new Map<string, Building>();
  const bySlug = new Map<string, TreeNode>();

  const claim = (node: Building) => {
    const held = claimed.get(node.rawSlug);
    if (!held) {
      claimed.set(node.rawSlug, node);
      return node.rawSlug;
    }
    // Two different terms produced the same slug (e.g. a genus and a family
    // of the same name). Disambiguate by rank rather than dropping one.
    let candidate = `${node.rawSlug}-${node.rank}`;
    let n = 2;
    while (claimed.has(candidate)) candidate = `${node.rawSlug}-${node.rank}-${n++}`;
    claimed.set(candidate, node);
    return candidate;
  };

  for (const listing of listings) {
    let level = roots;
    let parent: Building | null = null;

    for (const step of listing.path) {
      let node = level.get(step.slug);
      if (!node) {
        node = {
          rank: step.rank,
          name: step.name,
          rawSlug: step.slug,
          slug: '',
          parent,
          children: new Map(),
          listings: [],
        };
        node.slug = claim(node);
        level.set(step.slug, node);
      }
      node.listings.push(listing);
      parent = node;
      level = node.children;
    }
  }

  let size = 0;

  const finish = (node: Building, ancestors: TreeNode[]): TreeNode => {
    size += 1;
    const out: TreeNode = {
      rank: node.rank,
      name: node.name,
      slug: node.slug,
      ancestors,
      children: [],
      listings: node.listings.slice().sort((a, b) => a.common.localeCompare(b.common, 'en')),
    };
    const nextAncestors = [...ancestors, out];
    out.children = [...node.children.values()]
      .sort((a, b) => {
        const ra = rankOrder.get(a.rank) ?? 99;
        const rb = rankOrder.get(b.rank) ?? 99;
        return ra !== rb ? ra - rb : byName(a, b);
      })
      .map((child) => finish(child, nextAncestors));
    bySlug.set(out.slug, out);
    return out;
  };

  const rootNodes = [...roots.values()].sort(byName).map((r) => finish(r, []));
  return { roots: rootNodes, bySlug, size };
}

/** Flatten to every node, for getStaticPaths on /tree/{node}/. */
export function allNodes(tree: Tree): TreeNode[] {
  return [...tree.bySlug.values()];
}

/** Human label for a rank, used as the small caption above a term. */
export function rankLabel(rank: Rank): string {
  return rank === 'superorder' ? 'Superorder' : rank[0].toUpperCase() + rank.slice(1);
}

/** The genus a listing sits in, if it has one — used by "Other {Genus}". */
export function genusOf(listing: Listing): PathNode | undefined {
  return listing.path.find((p) => p.rank === 'genus');
}

/**
 * Walk a listing's raw `path` through the built tree and return the real
 * nodes. Node slugs can be disambiguated when two ranks collide, so a crumb
 * must resolve through the tree rather than reuse the raw path slugs.
 */
export function resolvePath(tree: Tree, path: PathNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  let level = tree.roots;
  for (const step of path) {
    const node = level.find((n) => n.rank === step.rank && n.name === step.name);
    if (!node) break;
    out.push(node);
    level = node.children;
  }
  return out;
}

/** Memoised tree for the whole build — it is derived, so build it once. */
let cachedTree: Tree | null = null;
export function getTree(listings: Listing[]): Tree {
  cachedTree ??= buildTree(listings);
  return cachedTree;
}
