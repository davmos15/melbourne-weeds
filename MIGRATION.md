# Content migration — status and runbook

The front end is complete and builds. **No WordPress content has been imported
yet**, because the source site is not reachable from the build environment.
There are now two routes in, and the offline one needs no network access at
all.

---

## Blocker: weedsofmelbourne.org is unreachable from here

Outbound HTTPS in this environment goes through a policy-enforcing egress
proxy, and the source host is not on its allow-list:

```
$ curl https://weedsofmelbourne.org/wp-json/wp/v2/types
curl: (56) CONNECT tunnel failed, response 403
```

The proxy's own log records the reason:

```
kind:   connect_rejected
detail: gateway answered 403 to CONNECT (policy denial or upstream failure)
host:   weedsofmelbourne.org:443
```

This is an organisation egress policy, not a WordPress error and not something
to route around. npm, GitHub and Google Fonts all resolve from the same
environment, so it is specific to that destination.

---

## Route A — the export file (no network needed)

WordPress can hand over everything the importer needs as a single file. In
`wp-admin`, go to **Tools → Export → All content → Download Export File**. That
`.xml` (a WXR file) contains slugs, post ids, dates, the raw title HTML, every
body, every taxonomy term with its taxonomy name, and the attachment URLs.

For the photographs, zip `wp-content/uploads/` over FTP/SFTP or via the host's
file manager and unzip it locally.

```bash
npm run recon  -- --wxr=data/raw/weedsofmelbourne.xml
#   read the report, read data/raw/, then:
mv data/raw/taxonomy-map.suggested.json data/taxonomy-map.json

npm run import -- --wxr=data/raw/weedsofmelbourne.xml
#   fix anything the validation report names, in data/overrides.json

npm run images -- --media=/path/to/uploads
npm run build
```

`scripts/wxr.ts` parses the export into exactly the shape the REST API returns
with `?_embed`, so the importer, the validation report and the rank-chain
question are identical whichever route the content arrived by. It is an
alternative source, not a second importer.

This whole path is exercised on every fixture run — `npm run fixtures` emits a
synthetic `data/fixtures/export.xml` and a matching `data/fixtures/uploads/`
tree for exactly that purpose.

## Route B — the live REST API

Identical, minus the flags, once the host is reachable:

```bash
npm run recon
mv data/raw/taxonomy-map.suggested.json data/taxonomy-map.json
npm run import
npm run images
npm run build
```

---

## The open question — do not guess it

SPEC §4 Phase 0 is explicit: report what the source contains and stop for a
decision, because the taxonomic rank chain may not be in the data at all.

So the rank mapping is **configuration, not code**: `data/taxonomy-map.json`,
which does not exist until someone puts it there. With no map the import still
runs and produces complete listings — names, body, habitats, gallery, Instagram
link — with an empty `path`, and names every one of them in the validation
report. It does not invent a taxonomy.

`npm run recon` ends by telling you which of three cases you are in:

1. **Rank-named taxonomies exist.** Recon writes a *suggested* map to
   `data/raw/taxonomy-map.suggested.json` — exact rank names matched first, so
   `order` cannot claim the `superorder` taxonomy, and no taxonomy is assigned
   to two ranks. Nothing reads it until you move it to
   `data/taxonomy-map.json`. That deliberate step is the decision.
2. **One hierarchical taxonomy encodes the chain by nesting depth.** Set
   `fromNesting` in the map, and confirm the depth order by hand against
   `data/raw/terms.json` first. The stub throws rather than half-working.
3. **Neither.** The chain only exists as the hand-built HTML on
   `/classification`. That is a separate scrape-and-join job, joined on species
   name, and it is fragile. Plan it deliberately; do not bolt it onto the
   importer.

Recon also checks the nine expected habitat tag slugs (`paddockweeds`,
`crackplants`, …) against what the source actually has and prints a tick or a
cross for each. Correct `src/lib/habitats.ts` before importing if any are
missing — SPEC §4 says to confirm them rather than rely on them.

`data/taxonomy-map.json` is not gitignored: commit it once it is right, so the
import is reproducible.

---

## Image budget

`npm run images` prints total bytes and file count at the end. If it lands over
~700 MB, stop: the answer is to move `public/img/` to Cloudflare R2 or a similar
object store, not to shrink the photographs (SPEC §4). Do not put images in Git
LFS — GitHub Pages serves the pointer file, not the image.

Both `data/listings.json` and `public/img/` are committed once generated, so
builds never depend on the source site afterwards.

Useful flags:

| Flag | Effect |
|---|---|
| `--media=<dir>` | Resolve each image from a local `uploads/` tree instead of the network. Sees through WordPress's `-1024x768` resize suffix to the original. |
| `--only=<slug>` | Process a single listing. |
| `--force` | Re-encode derivatives that already exist. |

---

## Also waiting on a person

**GitHub Pages is not switched on yet.** The deploy workflow builds fine and
then fails at `configure-pages`. Fix it once, in **Settings → Pages → Build and
deployment → Source: GitHub Actions**. This cannot be done from the workflow:
creating a Pages site needs `administration: write`, which `GITHUB_TOKEN` never
has, so `enablement: true` fails with "Resource not accessible by integration".

---

## Also waiting on the source site

`/about/`, `/references/` and `/contact/` carry **placeholder copy**, marked
with a comment at the top of each file:

- `src/pages/about.astro`
- `src/pages/references.astro`
- `src/pages/contact.astro`

Replace them with Adi's own words before launch. The references page currently
lists the standing sources each listing already deep-links into (VicFlora, ALA,
APC), which is a reasonable floor but is not his bibliography.

---

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
fixture slug is prefixed `fixture-`, and both `data/fixtures/` and
`public/img/fixture-*/` are gitignored, so none of it can be mistaken for
content or committed alongside it.
