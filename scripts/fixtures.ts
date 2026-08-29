/**
 * Development fixtures — NOT content.
 *
 *   npm run fixtures        then   WEEDS_FIXTURES=1 npm run build
 *
 * The real data comes from `npm run recon` → `npm run import` → `npm run
 * images`. That could not be run here because the WordPress host is
 * unreachable from this environment (see MIGRATION.md), so this script
 * generates a small, obviously-synthetic dataset instead: enough listings to
 * exercise the tree, the habitat index, the gallery, pagination and search,
 * with procedurally generated images rather than photographs.
 *
 * Every fixture slug is prefixed `fixture-`, and public/img/fixture-* is
 * gitignored, so none of this can be mistaken for — or committed alongside —
 * the real thing.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Listing, Rank } from '../src/lib/types.ts';
import { HABITATS } from '../src/lib/habitats.ts';

const OUT = fileURLToPath(new URL('../data/fixtures/', import.meta.url));
const IMG = fileURLToPath(new URL('../public/img/', import.meta.url));

const NOTE = 'Fixture text — not Adi’s writing, and not a real description of this plant.';

interface Seed {
  common: string;
  binomial: string;
  chain: [Rank, string][];
  habitats: string[];
  images: number;
  hue: number;
}

/* Real names and real placements — the taxonomy is factual, the prose is not. */
const SEEDS: Seed[] = [
  { common: 'Caltrop', binomial: 'Tribulus terrestris', chain: [['class', 'Magnoliopsida'], ['superorder', 'Rosanae'], ['order', 'Zygophyllales'], ['family', 'Zygophyllaceae'], ['genus', 'Tribulus'], ['species', 'Tribulus terrestris']], habitats: ['paddocks', 'infrastructure', 'pavements'], images: 6, hue: 44 },
  { common: 'Onion Weed', binomial: 'Romulea rosea', chain: [['class', 'Liliopsida'], ['superorder', 'Lilianae'], ['order', 'Asparagales'], ['family', 'Iridaceae'], ['genus', 'Romulea'], ['species', 'Romulea rosea']], habitats: ['paddocks', 'environmental', 'residential'], images: 5, hue: 330 },
  { common: 'Soursob', binomial: 'Oxalis pes-caprae', chain: [['class', 'Magnoliopsida'], ['superorder', 'Rosanae'], ['order', 'Oxalidales'], ['family', 'Oxalidaceae'], ['genus', 'Oxalis'], ['species', 'Oxalis pes-caprae']], habitats: ['residential', 'environmental'], images: 8, hue: 50 },
  { common: 'Creeping Woodsorrel', binomial: 'Oxalis corniculata', chain: [['class', 'Magnoliopsida'], ['superorder', 'Rosanae'], ['order', 'Oxalidales'], ['family', 'Oxalidaceae'], ['genus', 'Oxalis'], ['species', 'Oxalis corniculata']], habitats: ['pavements', 'residential'], images: 4, hue: 96 },
  { common: 'Fleabane', binomial: 'Conyza sumatrensis', chain: [['class', 'Magnoliopsida'], ['superorder', 'Asteranae'], ['order', 'Asterales'], ['family', 'Asteraceae'], ['genus', 'Conyza'], ['species', 'Conyza sumatrensis']], habitats: ['infrastructure', 'pavements', 'paddocks'], images: 5, hue: 88 },
  { common: 'Cape Weed', binomial: 'Arctotheca calendula', chain: [['class', 'Magnoliopsida'], ['superorder', 'Asteranae'], ['order', 'Asterales'], ['family', 'Asteraceae'], ['genus', 'Arctotheca'], ['species', 'Arctotheca calendula']], habitats: ['paddocks', 'coastal'], images: 7, hue: 48 },
  { common: 'Angled Onion', binomial: 'Allium triquetrum', chain: [['class', 'Liliopsida'], ['superorder', 'Lilianae'], ['order', 'Asparagales'], ['family', 'Amaryllidaceae'], ['genus', 'Allium'], ['species', 'Allium triquetrum']], habitats: ['riparians', 'environmental', 'residential'], images: 6, hue: 120 },
  { common: 'Kikuyu', binomial: 'Cenchrus clandestinus', chain: [['class', 'Liliopsida'], ['superorder', 'Lilianae'], ['order', 'Poales'], ['family', 'Poaceae'], ['genus', 'Cenchrus'], ['species', 'Cenchrus clandestinus']], habitats: ['residential', 'riparians', 'infrastructure'], images: 3, hue: 110 },
  { common: 'Panic Veldtgrass', binomial: 'Ehrharta erecta', chain: [['class', 'Liliopsida'], ['superorder', 'Lilianae'], ['order', 'Poales'], ['family', 'Poaceae'], ['genus', 'Ehrharta'], ['species', 'Ehrharta erecta']], habitats: ['environmental', 'residential'], images: 4, hue: 100 },
  { common: 'Boxthorn', binomial: 'Lycium ferocissimum', chain: [['class', 'Magnoliopsida'], ['superorder', 'Asteranae'], ['order', 'Solanales'], ['family', 'Solanaceae'], ['genus', 'Lycium'], ['species', 'Lycium ferocissimum']], habitats: ['coastal', 'paddocks', 'environmental'], images: 5, hue: 12 },
  { common: 'Blackberry Nightshade', binomial: 'Solanum nigrum', chain: [['class', 'Magnoliopsida'], ['superorder', 'Asteranae'], ['order', 'Solanales'], ['family', 'Solanaceae'], ['genus', 'Solanum'], ['species', 'Solanum nigrum']], habitats: ['residential', 'riparians'], images: 6, hue: 280 },
  { common: 'Wall Rocket', binomial: 'Diplotaxis tenuifolia', chain: [['class', 'Magnoliopsida'], ['superorder', 'Rosanae'], ['order', 'Brassicales'], ['family', 'Brassicaceae'], ['genus', 'Diplotaxis'], ['species', 'Diplotaxis tenuifolia']], habitats: ['infrastructure', 'pavements', 'structure'], images: 4, hue: 56 },
  { common: 'Pellitory', binomial: 'Parietaria judaica', chain: [['class', 'Magnoliopsida'], ['superorder', 'Rosanae'], ['order', 'Rosales'], ['family', 'Urticaceae'], ['genus', 'Parietaria'], ['species', 'Parietaria judaica']], habitats: ['structure', 'pavements', 'residential'], images: 5, hue: 130 },
  { common: 'Sea Wheat-grass', binomial: 'Thinopyrum junceiforme', chain: [['class', 'Liliopsida'], ['superorder', 'Lilianae'], ['order', 'Poales'], ['family', 'Poaceae'], ['genus', 'Thinopyrum'], ['species', 'Thinopyrum junceiforme']], habitats: ['coastal'], images: 3, hue: 70 },
  { common: 'Coast Wattle', binomial: 'Acacia longifolia subsp. sophorae', chain: [['class', 'Magnoliopsida'], ['superorder', 'Rosanae'], ['order', 'Fabales'], ['family', 'Fabaceae'], ['genus', 'Acacia'], ['species', 'Acacia longifolia subsp. sophorae']], habitats: ['coastal', 'native', 'environmental'], images: 4, hue: 46 },
  { common: 'Rough Tree-fern', binomial: 'Cyathea australis', chain: [['class', 'Polypodiopsida'], ['order', 'Cyatheales'], ['family', 'Cyatheaceae'], ['genus', 'Cyathea'], ['species', 'Cyathea australis']], habitats: ['riparians', 'native'], images: 3, hue: 150 },
  { common: 'Radiata Pine', binomial: 'Pinus radiata', chain: [['class', 'Pinopsida'], ['order', 'Pinales'], ['family', 'Pinaceae'], ['genus', 'Pinus'], ['species', 'Pinus radiata']], habitats: ['environmental', 'infrastructure'], images: 3, hue: 158 },
];

function slugFor(seed: Seed): string {
  const stem = `${seed.common} ${seed.binomial}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `fixture-${stem}`;
}

/** A flat wash plus a few soft blobs — recognisably not a photograph. */
async function makeImage(hue: number, index: number, w: number, h: number): Promise<Buffer> {
  const light = 30 + ((index * 11) % 30);
  const blobs = Array.from({ length: 5 }, (_, i) => {
    const cx = ((i * 37 + index * 19) % 100);
    const cy = ((i * 53 + index * 29) % 100);
    const r = 12 + ((i * 7 + index * 5) % 22);
    return `<circle cx="${cx}%" cy="${cy}%" r="${r}%" fill="hsl(${(hue + i * 14) % 360} 38% ${light + 14}%)" opacity="0.55"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="hsl(${hue} 26% ${light}%)"/>${blobs}
    <rect width="100%" height="100%" fill="none" stroke="hsl(${hue} 20% ${light + 26}%)" stroke-width="8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const listings: Listing[] = [];
  let n = 0;

  for (const [s, seed] of SEEDS.entries()) {
    const slug = slugFor(seed);
    const dir = `${IMG}${slug}/`;
    await mkdir(dir, { recursive: true });

    const gallery = [];
    for (let i = 0; i < seed.images; i += 1) {
      // Vary the aspect ratio so the layout is tested against tall and wide.
      const [w, h] = i % 3 === 0 ? [2000, 1500] : i % 3 === 1 ? [1500, 2000] : [1800, 1800];
      const source = await makeImage(seed.hue, i, w, h);
      const stem = `${dir}${i + 1}`;

      const sizes: [number, 'avif' | 'webp'][] =
        i === 0
          ? [[400, 'avif'], [400, 'webp'], [900, 'avif'], [900, 'webp'], [1600, 'avif']]
          : [[1600, 'avif']];

      for (const [size, format] of sizes) {
        const pipe = sharp(source).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
        await (format === 'avif' ? pipe.avif({ quality: 55, effort: 1 }) : pipe.webp({ quality: 74 }))
          .toFile(`${stem}-${size}.${format}`);
      }

      const blur = await sharp(source).resize({ width: 20, height: 20, fit: 'inside' }).webp({ quality: 40 }).toBuffer();
      gallery.push({
        src: `/img/${slug}/${i + 1}`,
        w,
        h,
        blur: `data:image/webp;base64,${blur.toString('base64')}`,
        alt: `${seed.common} (${seed.binomial}) — fixture image ${i + 1}`,
      });
      n += 1;
    }

    const body = [
      `${NOTE} ${seed.common} is placed here in ${seed.chain.find(([r]) => r === 'family')?.[1]}, and this paragraph stands in for the essay that belongs on this page.`,
      `A second fixture paragraph, long enough to give the measure something to do and to give the two-tier search index some body text to match against. It mentions ${seed.binomial} once more so that a full-text query has something to find.`,
      'A third fixture paragraph, so pages have a plausible length and the previous/next controls sit below a real scroll.',
    ];

    listings.push({
      slug,
      wpId: 9000 + s,
      common: seed.common,
      binomial: seed.binomial,
      date: `2023-${String((s % 12) + 1).padStart(2, '0')}-${String((s % 27) + 1).padStart(2, '0')}`,
      summary: body[0],
      body,
      habitats: HABITATS.filter((h) => seed.habitats.includes(h.slug)).map((h) => h.slug),
      path: seed.chain.map(([rank, name]) => ({
        rank,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      })),
      gallery,
      instagram: s % 3 === 0 ? 'https://www.instagram.com/p/FIXTURE00000/' : undefined,
    } as Listing);
  }

  await writeFile(`${OUT}listings.json`, `${JSON.stringify(listings, null, 2)}\n`);
  console.log(`${listings.length} fixture listings, ${n} generated images -> data/fixtures/listings.json`);
  console.log('Build with:  WEEDS_FIXTURES=1 npm run build');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
