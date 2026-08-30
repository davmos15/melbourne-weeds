# Content migration — status and runbook

The front end is complete and builds. **No WordPress content has been imported
yet**, because the source site is not reachable from the build environment.
There are now two routes in, and the offline one needs no network access at
all.

---

## Why there are three routes

The migration reads from weedsofmelbourne.org. That is straightforward from
most places and impossible from one: the sandbox this repo was built in.

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
environment, so it is specific to that destination. **A GitHub Actions runner
has no such restriction**, which is what Route A is for.

---

## Route A — the Migrate workflow (recommended)

**Actions → Migrate content → Run workflow.** A GitHub runner has ordinary
internet access, so it can reach the site even though the sandbox this repo was
built in cannot. No local setup, no `wp-admin` access, nothing to install.

Reading published posts through `/wp-json/wp/v2/` needs no credentials — it is
the same content the site serves to any visitor — so this route does not depend
on owning or administering the source site.

Run it in three passes:

1. **`recon`** — the report lands in the run's summary page, including a
   suggested taxonomy map. Raw dumps are attached as an artifact.
   Read it. If the suggested map is right, commit it as
   `data/taxonomy-map.json` (dropping the `_readme` key).
2. **`import`** — writes `data/listings.json` and pushes it to the
   `migration/content` branch. Read the validation report in the summary; fix
   what it names in `data/overrides.json`.
3. **`images`** — downloads and derives every photograph, prints the size
   budget, and pushes `public/img/` to the same branch.

Results go to a branch rather than straight to `main`: `listings.json` is worth
reading before it lands, and a few thousand new image files is not a reviewable
pull request. Merge when you are happy with it.

## Route B — from your own machine

Identical, if you have Node 20+ and can reach the site:

```bash
npm ci
npm run recon
mv data/raw/taxonomy-map.suggested.json data/taxonomy-map.json   # after reading it
npm run import
npm run images
npm run build
```

## Route C — a WordPress export file

Only available to someone with `wp-admin` on the source site (**Tools → Export →
All content**), plus a copy of `wp-content/uploads/`. **We do not have that
access**, so this route is for Adi or whoever administers the site, not for us.

```bash
npm run recon  -- --wxr=export.xml
npm run import -- --wxr=export.xml
npm run images -- --media=/path/to/uploads
```

`scripts/wxr.ts` parses the export into exactly the shape the REST API returns
with `?_embed`, so the importer, the validation report and the rank-chain
question are identical whichever route the content arrived by. It is an
alternative source, not a second importer.

This route is exercised on every fixture run — `npm run fixtures` emits a
synthetic `data/fixtures/export.xml` and a matching `data/fixtures/uploads/`
tree for exactly that purpose.

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
