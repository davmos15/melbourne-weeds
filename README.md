# Weeds of Melbourne

A visual glossary of the naturalised and weedy flora of Melbourne. Roughly 400
plants, each with photographs, an essay, a taxonomic placement and habitat tags.

Astro + TypeScript, static output, one real HTML file per listing. Hand-written
CSS. Two small client-side islands — search and the gallery/lightbox — totalling
about 4.5 KB gzipped.

- **`SPEC.md`** — the build spec. The source of truth.
- **`CLAUDE.md`** — short standing context for anyone (or anything) working here.
- **`MIGRATION.md`** — the WordPress import: how to run it, and what is
  currently blocking it.

## Getting started

```bash
npm install
npm run fixtures                 # generate the development dataset
WEEDS_FIXTURES=1 npm run dev     # http://localhost:4321
```

Without fixtures the site builds correctly but empty, because
`data/listings.json` has not been populated from WordPress yet. See
`MIGRATION.md`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Static build into `dist/` |
| `npm run recon` | Phase 0 — inspect the WordPress API and report |
| `npm run import` | Phase 1 — WordPress → `data/listings.json` |
| `npm run images` | Phase 2 — download and derive `public/img/` |
| `npm run search-index` | Rebuild `public/search/` (runs before dev and build) |
| `npm run fonts` | Re-fetch the self-hosted woff2 subsets |
| `npm run fixtures` | Generate the synthetic development dataset |

## Deploying

`.github/workflows/deploy.yml` builds on push to `main` and publishes to GitHub
Pages. Two repository variables control the published URL:

| Variable | Default | Notes |
|---|---|---|
| `SITE_URL` | `https://weedsofmelbourne.org` | Canonical URLs, sitemap, Open Graph |
| `SITE_BASE` | `/` | Set to `/<repo>/` **only** if serving from a project subpath |

Listing URLs are `/{slug}/` using the exact WordPress slug, so the site needs to
be served from a **domain root** for existing links to keep working. Every
internal link goes through `u()` in `src/lib/url.ts`, so switching between a
subpath and the root is a variable change, not a code change.
