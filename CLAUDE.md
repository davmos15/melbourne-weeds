# Weeds of Melbourne

A visual glossary of the naturalised and weedy flora of Melbourne — roughly 400
plants, each with photographs, an essay, a taxonomic placement and habitat tags.
The content is Adi's; this repo is the front end and the migration of his
WordPress site into it.

**`SPEC.md` is the source of truth.** Read it before changing anything
structural. `MIGRATION.md` covers the WordPress import and its current state.

## The seven things that are not negotiable

1. Every listing has its own bookmarkable page at `/{slug}/` — a real URL, not
   a modal or a query param.
2. One always-visible search field, instant results.
3. The home page is the habitat index plus the classification tree. Not a feed.
4. **No "recently added" section.** Removed at Adi's request. Do not reintroduce it.
5. The taxonomic tree is collapsed to the top level on load.
6. The listing header image is a swipeable gallery that opens full-screen.
7. Mobile first: design at 360px, then enhance upward.

## Stack

Astro + TypeScript, static output, one real HTML file per listing. No CSS
framework, no UI component library, no React. Hand-written CSS with the custom
properties in `src/styles/tokens.css`.

Client JS is two islands only — `src/islands/search.ts` and
`src/islands/gallery.ts` (~4.5 KB gzipped together, against a 60 KB budget). A
third island is a signal to question the feature, not to add the island. The
tree's "expand all" button is a six-line enhancement inside `Tree.astro`; the
tree itself is native `<details>` and works with no JavaScript.

## Rules that bite

- **Slugs come verbatim from WordPress and are never regenerated.** Every
  existing weedsofmelbourne.org link and the Instagram bio link must keep
  working.
- **Never hardcode the base path.** All internal links go through `u()` in
  `src/lib/url.ts`, which reads `SITE_BASE`.
- **Never put images in Git LFS.** GitHub Pages serves the LFS pointer file,
  not the image. If the repo gets too big, move `public/img/` to a CDN.
- `data/listings.json` and `public/img/` are generated but **committed**, so a
  build never depends on the WordPress site being up.
- Hand corrections go in `data/overrides.json`, keyed by slug. They are merged
  over the import at build time so re-importing never loses them.
- **The rank chain mapping is configuration, not code**: `data/taxonomy-map.json`,
  absent until someone puts it there. `npm run recon` writes a *suggestion* to
  `data/raw/` for a human to check and move into place. Never guess it — with no
  map the import still runs and reports every listing it left without a `path`.
- The classification tree and every habitat count are **derived from the data**
  at build time. Never hand-maintain them.
- Every `<img>` carries `width`/`height`. CLS budget is 0.05.

## Commands

```
npm run recon          # Phase 0 — inspect the source, report, stop
npm run import         # Phase 1 — WordPress -> data/listings.json
npm run images         # Phase 2 — download and derive public/img/
npm run search-index   # rebuild public/search/ (runs before dev and build)
npm run fonts          # re-fetch the self-hosted woff2 subsets
npm run fixtures       # generate the development dataset (not content)
npm run check          # astro check — types and diagnostics
npm run dev            # local dev server
npm run build          # static build into dist/
```

Recon, import and images each work offline as well as against the live API:

```
npm run recon  -- --wxr=export.xml     # a WordPress Tools -> Export file
npm run import -- --wxr=export.xml
npm run images -- --media=/path/to/uploads
```

Until the import has been run, `data/listings.json` is empty and the site
builds to an empty shell. For a populated local build:

```
npm run fixtures && WEEDS_FIXTURES=1 npm run build
```

Fixtures are obviously synthetic, slug-prefixed `fixture-`, and gitignored.
They are never content.
