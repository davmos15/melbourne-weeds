import type { Habitat } from './types.ts';

/**
 * SPEC §4 — the nine habitat tags, and the WordPress slugs they map from.
 * These are the site's spine: they are the home page index (requirement 3)
 * and the /where/ routes. A habitat with no listings still gets a tile.
 */
export const HABITATS: Habitat[] = [
  {
    slug: 'paddocks',
    wp: 'paddockweeds',
    label: 'Paddocks',
    description: 'Grazed and fallow ground on the city fringe.',
  },
  {
    slug: 'pavements',
    wp: 'crackplants',
    label: 'Pavements',
    description: 'Footpath cracks, kerbs and the seams of the street.',
  },
  {
    slug: 'infrastructure',
    wp: 'infrastructureweeds',
    label: 'Infrastructure',
    description: 'Rail corridors, drains, roadsides and service land.',
  },
  {
    slug: 'riparians',
    wp: 'riparianweeds',
    label: 'Riparians',
    description: 'Creek banks, river flats and damp margins.',
  },
  {
    slug: 'coastal',
    wp: 'coastalweeds',
    label: 'Coastal',
    description: 'Dunes, cliff tops and the salt-blown edge of the bay.',
  },
  {
    slug: 'environmental',
    wp: 'environmentalweeds',
    label: 'Environmental',
    description: 'Species pushing into remnant bush and grassland.',
  },
  {
    slug: 'residential',
    wp: 'residentialweeds',
    label: 'Residential',
    description: 'Gardens, nature strips, lanes and back fences.',
  },
  {
    slug: 'structure',
    wp: 'structureweeds',
    label: 'On structure',
    description: 'Growing on walls, roofs, gutters and brickwork.',
  },
  {
    slug: 'native',
    wp: 'nativeweeds',
    label: 'Native weeds?',
    description: 'Indigenous plants behaving like colonisers.',
  },
];

export const HABITAT_BY_SLUG = new Map(HABITATS.map((h) => [h.slug, h]));
export const HABITAT_BY_WP = new Map(HABITATS.map((h) => [h.wp, h]));

export function habitatLabel(slug: string): string {
  return HABITAT_BY_SLUG.get(slug)?.label ?? slug;
}
