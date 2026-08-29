/** SPEC §5 — the data model. One entry per plant in data/listings.json. */

export type Rank = 'class' | 'superorder' | 'order' | 'family' | 'genus' | 'species';

/** Ferns and conifers skip superorder, so a path is variable length. */
export const RANKS: Rank[] = ['class', 'superorder', 'order', 'family', 'genus', 'species'];

export interface PathNode {
  rank: Rank;
  name: string;
  slug: string;
}

export interface GalleryImage {
  /** Site-relative stem, e.g. /img/caltrop-tribulus-terrestris/1 (no extension). */
  src: string;
  /** The WordPress URL this was derived from — lets scripts/images.ts re-run
   *  idempotently and lets a missing derivative be traced back to its source. */
  origin?: string;
  w: number;
  h: number;
  /** 20px inline base64 placeholder. */
  blur: string;
  alt?: string;
}

export interface Listing {
  slug: string;
  wpId: number;
  common: string;
  binomial: string;
  date: string;
  summary: string;
  body: string[];
  habitats: string[];
  path: PathNode[];
  gallery: GalleryImage[];
  instagram?: string;
}

export interface Habitat {
  slug: string;
  label: string;
  /** WordPress tag slug this maps from — SPEC §4 Phase 1. */
  wp: string;
  description: string;
}
