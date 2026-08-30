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
| `npm run check` | `astro check` — types and diagnostics |
| `npm run recon` | Phase 0 — inspect the source and report |
| `npm run import` | Phase 1 — WordPress → `data/listings.json` |
| `npm run images` | Phase 2 — download and derive `public/img/` |

The easiest way to run these is **Actions → Migrate content → Run workflow** —
a GitHub runner can reach the source site and needs no local setup. See
`MIGRATION.md`.

They also accept a WordPress **Tools → Export** file and a local `uploads/`
directory, for whoever has `wp-admin` on the source:

```bash
npm run recon  -- --wxr=export.xml
npm run import -- --wxr=export.xml
npm run images -- --media=/path/to/uploads
```
| `npm run search-index` | Rebuild `public/search/` (runs before dev and build) |
| `npm run fonts` | Re-fetch the self-hosted woff2 subsets |
| `npm run fixtures` | Generate the synthetic development dataset |

## Deploying

`.github/workflows/deploy.yml` builds on push to `main` and publishes to GitHub
Pages.

**One-time setup:** in the repository's **Settings → Pages → Build and
deployment**, set **Source** to **GitHub Actions**. Until that is done the
build succeeds but the deploy step fails with "Get Pages site failed". It
cannot be automated — creating a Pages site needs a permission the workflow
token is not granted.

Two repository variables control the published URL:

| Variable | Default | Notes |
|---|---|---|
| `SITE_URL` | `https://davmos15.github.io` | Canonical URLs, sitemap, Open Graph |
| `SITE_BASE` | `/melbourne-weeds/` | Set to `/` when serving from a domain root |

The defaults publish to <https://davmos15.github.io/melbourne-weeds/>. Every
internal link goes through `u()` in `src/lib/url.ts`, so moving to a domain root
later is a variable change, not a code change.
