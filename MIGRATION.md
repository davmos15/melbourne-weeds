# Content migration — status and runbook

The front end is complete and builds. **No WordPress content has been imported
yet**, because Phase 0 could not be run from the build environment.

## Blocker: weedsofmelbourne.org is unreachable from here

Outbound HTTPS in this environment goes through a policy-enforcing egress
proxy, and the source host is not on its allow-list:

```
$ curl https://weedsofmelbourne.org/wp-json/wp/v2/types
curl: (56) CONNECT tunnel failed, response 403

$ curl https://www.weedsofmelbourne.org/wp-json/wp/v2/types
(no route)
```

The proxy's own log records the reason:

```
kind:   connect_rejected
detail: gateway answered 403 to CONNECT (policy denial or upstream failure)
host:   weedsofmelbourne.org:443
```

This is an organisation egress policy, not a WordPress error and not something
to route around. Other hosts (npm, GitHub, Google Fonts) resolve fine from the
same environment, so it is specific to this destination.

**To unblock:** allow `weedsofmelbourne.org` for the session's environment, or
run `npm run recon` / `npm run import` / `npm run images` from a machine with
ordinary internet access and commit the results.

## The open question — do not guess it

SPEC §4 Phase 0 is explicit: report what the API contains and stop for a
decision, because the taxonomic rank chain may not be in the API at all.

`scripts/import.ts` therefore ships with `RANK_TAXONOMIES` **unconfigured**. In
that state the import still runs and produces complete listings — names, body,
habitats, gallery, Instagram link — with an empty `path`, and names every one of
them in the validation report. It does not invent a taxonomy.

`npm run recon` ends with a section that answers the question directly and tells
you which of three cases you are in:

1. **Rank-named taxonomies exist** → fill in `RANK_TAXONOMIES` in
   `scripts/import.ts` with the taxonomy slug for each rank. Done.
2. **One hierarchical taxonomy encodes the chain by nesting depth** → set
   `RANK_FROM_NESTING`, confirm the depth order by hand against
   `data/raw/terms.json`, and implement the depth resolution. The stub throws
   rather than half-working.
3. **Neither** → the chain only exists as the hand-built HTML on
   `/classification`. That is a separate scrape-and-join job, joined on species
   name, and it is fragile. Plan it deliberately; do not bolt it onto the
   importer.

Recon also checks the nine expected habitat tag slugs (`paddockweeds`,
`crackplants`, …) against what the site actually has, and prints a tick or a
cross for each. Correct `src/lib/habitats.ts` before importing if any are
missing — SPEC §4 says to confirm them rather than rely on them.

## Runbook, once the host is reachable

```bash
npm run recon     # Phase 0 — read the output, read data/raw/, then decide
                  #   → configure RANK_TAXONOMIES in scripts/import.ts
npm run import    # Phase 1 — writes data/listings.json + a validation report
                  #   → fix what it reports in data/overrides.json, keyed by slug
npm run images    # Phase 2 — downloads, derives, and prints the size budget
npm run build     # rebuilds the search indexes and the site
```

`npm run images` prints total bytes and file count at the end. If it lands over
~700 MB, stop: the answer is to move `public/img/` to Cloudflare R2 or a similar
object store, not to shrink the photographs (SPEC §4). Do not put images in Git
LFS — GitHub Pages serves the pointer file, not the image.

Both `data/listings.json` and `public/img/` are committed once generated, so
builds never depend on the WordPress site being up afterwards.

## Also waiting on the source site

`/about/`, `/references/` and `/contact/` carry **placeholder copy**, marked
with a comment at the top of each file:

- `src/pages/about.astro`
- `src/pages/references.astro`
- `src/pages/contact.astro`

Replace them with Adi's own words before launch. The references page currently
lists the standing sources each listing already deep-links into (VicFlora, ALA,
APC), which is a reasonable floor but is not his bibliography.

## Reviewing before the import

The site builds to an empty shell until `data/listings.json` is populated. For a
populated local build:

```bash
npm run fixtures
WEEDS_FIXTURES=1 npm run build
```

`scripts/fixtures.ts` generates 17 synthetic listings with procedurally drawn
images — enough to exercise the tree, habitat index, gallery, lightbox,
pagination and both search tiers. Real taxonomy, deliberately fake prose. Every
fixture slug is prefixed `fixture-` and `public/img/fixture-*/` is gitignored,
so none of it can be mistaken for content or committed alongside it.
