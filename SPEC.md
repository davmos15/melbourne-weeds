# Weeds of Melbourne — build spec

Rebuild of **weedsofmelbourne.org**, a visual glossary of the naturalised and weedy
flora of Melbourne. Roughly 400 listings, each a plant with photographs, an
essay on its history in Australia, a taxonomic placement, and one or more
habitat tags.

The content belongs to Adi (the site's author). We are rebuilding the front
end and migrating his existing WordPress content into it.

> **Correction, 30 August 2026.** The paragraph above is wrong.
> weedsofmelbourne.org belongs to a third party, not to Adi and not to us, and
> its essays and photographs are their copyright. The content migration is on
> hold pending the owner's agreement — see `MIGRATION.md`. Everything else in
> this spec stands.

There is a working single-file prototype (`prototype/weeds-of-melbourne-prototype.html`).
Treat it as a **design and interaction reference, not a codebase**. Do not port
its code. Do port its layout, routing model, design tokens and gallery
behaviour.

---

## 1. Non-negotiable requirements

These came directly from Adi. Everything else is negotiable.

| # | Requirement | What it means concretely |
|---|---|---|
| 1 | Every listing has its own bookmarkable page | A real URL per plant that can be pasted into a message and opened cold. Not a modal, not a query param. |
| 2 | Easily searched | One always-visible search field. Instant results. Matches common name, botanical name, genus, family, order, habitat, and body text. |
| 3 | Home page resembles the existing dropdown menu | The nine habitat tags and the classification tree *are* the home page. Not a blog roll. |
| 4 | No "recently added" section | Removed at Adi's request. Do not reintroduce it. |
| 5 | Taxonomic tree collapsed by default | Top level only on load, with an expand control. Same on the dedicated tree page. |
| 6 | Listing header image is a gallery | Swipe to cycle on touch; tap or click to open a full-screen enlarged view. |
| 7 | Mobile first | Design and build at ~360 px, then enhance upward. Desktop must also be excellent, but it is the second pass, not the first. |

---

## 2. Hosting constraints — read before choosing anything

Initial host is **GitHub Pages**. This is the single biggest constraint on the
architecture and it rules several things out.

- **Static only.** No server, no API, no server-side rendering at request time,
  no database. Everything is built ahead of time.
- **1 GB published site limit.** Hard. Measure the image payload before
  committing to a resolution strategy (§6).
- **100 GB/month soft bandwidth limit.** An image-heavy site can approach this.
- **Git LFS files are not served by Pages.** Pages serves the LFS *pointer file*,
  not the image. Do not put images in LFS. If the repo gets too big, move images
  off to a CDN (§6), do not reach for LFS.
- **10 builds per hour.**

### URL scheme is a migration decision, not a styling one

The live site uses top-level slugs: `weedsofmelbourne.org/caltrop-tribulus-terrestris`.
If we ever point the real domain at this build, **every existing link and every
Instagram bio link must keep working**. So:

- Listing URLs must be `/{slug}/` with the **exact slug from WordPress**, preserved verbatim.
- That means the site must eventually be served from a **domain root**, not from
  `username.github.io/repo-name/`.

Recommended: create the repo as **`weedsofmelbourne.github.io`** (an org/user
Pages site, served at the root) or attach a custom domain from day one. If you
must start at a project subpath for review, put the base path behind a single
`SITE_BASE` env var so switching later is a one-line change — never hardcode it
into links.

---

## 3. Stack

**Astro + TypeScript.** Static output, one real HTML file per listing.

Why this and not a React SPA:

- Requirement 1 is satisfied structurally. A real file at `/caltrop-tribulus-terrestris/index.html`
  is bookmarkable, shareable, crawlable and works with the back button, with no
  router, no hash URLs, and no `404.html` redirect hack.
- ~400 content pages of mostly text and images is exactly the case static
  generation is for. Time to first paint on a phone on 4G is the metric that
  matters here and a SPA loses it.
- Search and gallery are the only interactive parts. Ship them as islands.

Rules:

- **No CSS framework.** Hand-written CSS with custom properties. The design
  tokens in §9 are the whole system.
- **No UI component library.**
- **Minimal JS.** Two islands only: search, and the gallery/lightbox. Everything
  else is static HTML and CSS. If a feature needs a third island, question the feature.
- Vanilla TS for the islands is fine. Do not add React just for these two.

---

## 4. Content migration

### Phase 0 — reconnaissance (do this first, do not skip)

The source is WordPress 6.0, so `/wp-json/wp/v2/` should be open. Before writing
any importer:

```
scripts/recon.ts
```

1. `GET /wp-json/wp/v2/types` and `/wp-json/wp/v2/taxonomies` — find out what
   taxonomies actually exist.
2. `GET /wp-json/wp/v2/posts?per_page=1&_embed` — dump one full post to
   `data/raw/sample-post.json` and read it.
3. Report: total post count, taxonomy names, how many terms in each, and
   whether the taxonomic rank chain (class → superorder → order → family →
   genus → species) is stored as a hierarchical taxonomy, as flat categories,
   or only as the hand-built HTML on `/classification`.

**Do not guess the taxonomy structure.** Report what you find and stop for a
decision. If the rank chain is not in the API, we scrape `/classification` and
join on species name — that is a separate, more fragile job and needs to be
planned deliberately.

### Phase 1 — import

```
scripts/import.ts   → data/listings.json
```

Fetch all posts with `?per_page=100&_embed` and paginate. For each post extract:

- `slug` — verbatim from WordPress, never regenerated
- `wpId`
- `title` — the raw title contains both common and botanical name, e.g.
  `Caltrop (Tribulus terrestris)`. Split into `common` and `binomial`. The
  botanical name is wrapped in `<em>`; use that as the split signal, not a regex
  on brackets. Log anything that fails to parse rather than silently guessing.
- `date` (ISO)
- `body` — array of plain-text paragraphs. Strip WordPress markup. Preserve
  curly quotes and en/em dashes; the prose is carefully written.
- `summary` — first sentence of the body
- `habitats` — from the habitat tags. Map the WordPress slugs to ours:

  | WordPress tag | Ours | Label |
  |---|---|---|
  | `paddockweeds` | `paddocks` | Paddocks |
  | `crackplants` | `pavements` | Pavements |
  | `infrastructureweeds` | `infrastructure` | Infrastructure |
  | `riparianweeds` | `riparians` | Riparians |
  | `coastalweeds` | `coastal` | Coastal |
  | `environmentalweeds` | `environmental` | Environmental |
  | `residentialweeds` | `residential` | Residential |
  | `structureweeds` | `structure` | On structure |
  | `nativeweeds` | `native` | Native weeds? |

  Confirm these slugs against recon output before relying on them.
- `path` — the rank chain, as an ordered array (§5). Note that ferns and conifers
  skip the superorder rank, so the array is variable length. Handle that
  generically; do not assume six levels.
- `gallery` — every image in the post, in post order. The featured image is
  first.
- `instagram` — the "original post" permalink if present.

Write a **validation report** at the end: listings missing a binomial, missing a
rank chain, missing habitat tags, with zero images. Expect a handful. Fix them
in a small `data/overrides.json` keyed by slug that is merged over the import,
so re-running the import never loses manual corrections.

### Phase 2 — images

```
scripts/images.ts   → public/img/{slug}/{n}.avif
```

Download every gallery image once, cache by URL hash so re-runs are cheap, then
derive with `sharp`:

| Purpose | Longest edge | Format | Which images |
|---|---|---|---|
| Grid thumbnail | 400 px | AVIF + WebP | lead image only |
| Card / listing header | 900 px | AVIF + WebP | lead image only |
| Gallery + lightbox | 1600 px | AVIF | all images |
| Blur placeholder | 20 px | inline base64 | all images |

Quality 55–65 AVIF is plenty for photographs at these sizes.

**Budget check.** After the first full run, print total bytes and file count.
Rough expectation: ~400 listings × ~8 images ≈ 3,200 gallery images. At 120 KB
each that is ~380 MB, plus derivatives — inside the 1 GB limit but not
comfortably. If it lands over ~700 MB, stop and raise it: the answer is to move
`public/img/` to Cloudflare R2 or a similar object store and serve images from
there while the repo keeps only code and JSON. Do not solve it by degrading
image quality below 1600 px — the photographs are the point of the site.

Record the real dimensions of each image in `listings.json` so `<img>` can carry
`width`/`height` and never shift layout.

---

## 5. Data model

`data/listings.json`, one entry per plant:

```ts
type Rank = "class" | "superorder" | "order" | "family" | "genus" | "species";

interface Listing {
  slug: string;              // verbatim from WordPress — the URL
  wpId: number;
  common: string;            // "Caltrop"
  binomial: string;          // "Tribulus terrestris"
  date: string;              // "2023-05-31"
  summary: string;           // first sentence
  body: string[];            // paragraphs, plain text
  habitats: string[];        // ["paddocks", "infrastructure"]
  path: { rank: Rank; name: string; slug: string }[];   // ordered, variable length
  gallery: { src: string; w: number; h: number; blur: string }[];
  instagram?: string;
}
```

The classification tree is **derived from `path` at build time**, never
hand-maintained. Adding a listing with a new family makes the family appear.
Same for habitat counts.

---

## 6. Pages

| Route | Page | Notes |
|---|---|---|
| `/` | Home | Hero line, habitat index, collapsed classification tree. No listing feed. |
| `/{slug}/` | Listing | The main event. §7. |
| `/where/{habitat}/` | Habitat index | Grid of listings. Nine of these. |
| `/tree/` | Full classification | Collapsed to top level, with expand/collapse all. |
| `/tree/{rank-slug}/` | Everything under one rank | Genus, family, order, etc. One page per node in the tree — they are generated, so there will be a few hundred. |
| `/all/` | Every listing | Paginated or virtualised; 400 cards at once is too heavy for a phone. |
| `/search/` | Search results | Reads `?q=`. Must work as a cold-loaded bookmarkable URL. |
| `/about/`, `/references/`, `/contact/` | Static | Port content from the existing site. |
| `/404.html` | Not found | |

### Home page

Three blocks, in this order:

1. **Hero** — one sentence on what the site is, plus two links (all listings,
   full classification). Keep it short; the index below is the real content.
2. **"Where you found it"** — the nine habitats. Each row/tile shows the habitat
   name, a one-line description, a live count, and a small mosaic of lead images
   from listings in that habitat. On mobile these are full-width rows with a
   horizontal strip of four thumbnails; from 720 px they become a 3-column grid
   of tiles with a 2×2 mosaic. This is the "resembles the dropdown menu"
   requirement — it is the menu made visual.
3. **"Browse by classification"** — the tree, collapsed to classes only, with a
   single Expand all / Collapse all toggle.

A habitat with no listings still gets a tile, showing a count of zero and a
proper empty state on its page. Do not hide it.

---

## 7. Listing page

Order on the page:

1. **Gallery** (§8)
2. Habitat pills — tappable, link to `/where/{habitat}/`
3. Common name (h1), botanical name (h2, italic)
4. Byline row — date, the URL slug shown in mono, and a "Copy link" button
5. Lede paragraph (the summary), then the body paragraphs
6. **"Where it sits"** — the full rank chain as a breadcrumb, every level linked
   to its `/tree/{slug}/` page. Show the rank name as a small label above each
   term; that's real information, not decoration.
7. **"Elsewhere"** — VicFlora search link, Atlas of Living Australia link,
   original Instagram post, and "Other {Genus} on this site"
8. Previous / next by date

Set `<title>`, `<meta name="description">` from the summary, canonical URL, and
Open Graph tags including `og:image` pointing at the 900 px lead image. Adi
shares these on Instagram; the link preview needs to be right.

---

## 8. Gallery — behaviour spec

This is the one genuinely fiddly component. Build it with **native CSS scroll
snap**, not a JS drag implementation or a carousel library.

```css
.track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; }
.frame { flex: 0 0 100%; scroll-snap-align: center; }
```

Native scrolling gives correct momentum, rubber-banding and accessibility on
iOS and Android for free. A hand-rolled pointer-drag will feel wrong on a phone
and you will not win that fight.

**Inline gallery**

- Swipe horizontally to move between photographs.
- Dot indicators plus an `n / total` counter, both driven by a debounced
  `scroll` listener reading `scrollLeft / clientWidth`.
- Tapping the dots jumps to that frame.
- Prev/next arrow buttons appear from 720 px only. On touch they are clutter.
- Aspect ratio 1:1 on mobile, 16:10 from 720 px, with `max-height` so a tall
  photo cannot push the text off the first screen.

**Tap to enlarge**

- Distinguish tap from swipe: record position on `pointerdown`, set a `moved`
  flag if the pointer travels more than ~9 px, and also set it on
  `pointercancel` (which fires when a touch scroll takes over). Open the
  lightbox on `pointerup` only when `moved` is false.
- The lightbox is a full-viewport overlay using its own scroll-snap track, so
  swipe works there too.
- `object-fit: contain`, dark backdrop, close button, counter, arrow keys, Esc
  to close, click on the backdrop to close.
- Lock background scroll while open, and restore it on close.
- Use `100dvh` not `100vh` — iOS Safari's collapsing toolbar will otherwise clip
  the close button.
- Trap focus inside the overlay and restore focus to the trigger on close.

**Loading**

Only the first frame is eager. The rest are `loading="lazy"`. Every frame gets
its blur placeholder as a background so nothing renders as a grey hole and
nothing shifts.

---

## 9. Design

Carry these across from the prototype unchanged. They are the whole system.

```css
--mount:   #E6E7E1;  /* page ground — pale grey-green, herbarium mount card */
--mount-2: #DCDED5;  /* recessed panels, hover */
--mount-3: #CDD1C5;
--ink:     #1F241E;  /* body text */
--ink-2:   #5A6155;  /* secondary */
--rule:    #B9BEB0;  /* hairlines */
--bloom:   #A81E56;  /* accent — the magenta of Romulea and Oxalis */
--basalt:  #2B2F2B;  /* header chrome, lightbox backdrop */
```

Type:

- Body and headings: **Spectral** (300/400/600, with italics for binomials)
- Labels, nav, UI: **Barlow Condensed** (500/600), uppercase, `letter-spacing: .12em`
- Dates, counts, slugs: system monospace

Self-host the fonts as woff2 subsets in `public/fonts/` with
`font-display: swap`. Do not load them from Google Fonts — it is an extra
connection on a mobile network and a privacy issue.

Principles: the ground is quiet and cool so the photographs carry all the
colour. Hairline rules and uppercase condensed labels do the structural work.
The magenta is used sparingly — active states, counts, hover — never as a fill.

---

## 10. Search

Two-tier, because full text of 400 essays is too much to load eagerly on a
phone.

| Tier | Contents | Size | When loaded |
|---|---|---|---|
| Light | slug, common, binomial, genus, family, order, class, habitats, summary, thumbnail | target < 150 KB gzipped | with the search island |
| Full text | body of every listing | ~800 KB | fetched on first keystroke, cached |

Both generated at build time into `public/search/`.

Behaviour:

- Search field lives in the sticky header, present on every page.
- Match priority, and show which field matched: common name → species → genus →
  family → order → habitat → summary → full text.
- Results update as you type, debounced ~160 ms.
- The URL updates to `/search/?q=…` using `history.replaceState` so the Back
  button does not step through every keystroke — but the page must also render
  correctly when that URL is loaded cold.
- `/` focuses the field on desktop. Esc blurs it.
- Diacritic- and case-insensitive.
- Use MiniSearch if a library helps; a plain `indexOf` scan over 400 records is
  also perfectly fast and has no dependency. Prefer the simpler one until it
  proves inadequate.

---

## 11. Mobile first — the actual rules

Write the base stylesheet for a 360 px viewport. Breakpoints are
`min-width` only: 600, 720, 1000, 1200.

- Every tap target at least 44 × 44 px.
- Search input `font-size: 16px` minimum, or iOS zooms the page on focus.
- No hover-only affordances. Anything reachable by hover must also be reachable
  by tap or be purely decorative.
- Tree rows need generous vertical padding — the collapse toggles are the most
  fiddly targets on the page.
- Sticky header, and nothing else sticky. Two sticky elements on a short
  viewport eats the content.
- Use `dvh` for anything full-height.
- Respect `prefers-reduced-motion`: disable the smooth scrolling and the
  photo fade.
- Test on a real phone, not just a narrow browser window. Scroll snap,
  `pointercancel` and `dvh` all behave differently on device.

Desktop enhancements, once mobile is right:

- Habitat rows become the 3-column mosaic grid.
- Listing grids go to 4 columns; the listing page gets a wider measure and a
  16:10 header.
- Gallery arrow buttons appear.
- Keyboard: `/` to search, arrows to move through a gallery, Esc to close.
- Visible `:focus-visible` outlines in `--bloom` throughout.

---

## 12. Quality bars

**Performance** (listing page, mobile, throttled 4G):

- LCP under 2.5 s
- CLS under 0.05 — every image carries explicit `width`/`height`
- Under 60 KB of JS total, gzipped, across both islands
- No layout shift when fonts swap; set `size-adjust` on the fallback

**Accessibility:**

- Real landmarks, one `h1` per page, heading order intact
- Gallery is a labelled group; the lightbox is `role="dialog" aria-modal="true"`
  with focus trapped and returned
- Every image has alt text — `"{common} ({binomial})"` is an acceptable default,
  but if the WordPress alt text is meaningful, keep it
- Tree toggles are real `<button>`s with `aria-expanded`
- Colour contrast 4.5:1 minimum for body text against `--mount`

---

## 13. Repo layout

```
.
├── CLAUDE.md               # short standing context — see §15
├── SPEC.md                 # this file
├── astro.config.mjs
├── src/
│   ├── pages/              # index, [slug], where/[habitat], tree/[node], all, search
│   ├── components/         # Header, HabitatIndex, Tree, Card, Gallery, Lightbox, Crumb
│   ├── islands/            # search.ts, gallery.ts  ← the only client JS
│   ├── lib/                # tree.ts, habitats.ts, format.ts
│   └── styles/             # tokens.css, base.css
├── data/
│   ├── listings.json       # generated — committed
│   ├── overrides.json      # hand corrections, merged over the import
│   └── raw/                # API dumps, gitignored
├── scripts/
│   ├── recon.ts
│   ├── import.ts
│   ├── images.ts
│   └── search-index.ts
├── public/
│   ├── img/{slug}/         # generated, committed
│   ├── fonts/
│   └── .nojekyll
├── prototype/              # reference only, not built
└── .github/workflows/deploy.yml
```

`listings.json` and `public/img/` are generated but **committed**, so a build
never depends on the source WordPress site being up.

---

## 14. Deploy

`.github/workflows/deploy.yml` — build on push to `main`, publish with
`actions/upload-pages-artifact` and `actions/deploy-pages`. Node 20, `npm ci`,
`npm run build`, upload `dist/`.

Keep `public/.nojekyll` so nothing chokes on Astro's `_astro/` directory.

Set `site` in `astro.config.mjs` to the real published URL — canonical URLs,
sitemap and Open Graph tags all depend on it. Read the base path from an env
var, do not hardcode.

Add `@astrojs/sitemap` and generate `robots.txt`.

---

## 15. `CLAUDE.md`

A short standing-context file lives at the repo root and points back here. See
`CLAUDE.md`.

---

## Implementation notes — deviations and decisions

Recorded where the build had to make a call the spec did not settle. Everything
else follows the spec as written.

1. **Tree toggles are `<details>`/`<summary>`, not `<button aria-expanded>`**
   (§12). Native disclosures collapse by default, are keyboard operable, and are
   announced with their expanded state — and, unlike buttons, they need no
   JavaScript at all. Using buttons would have forced a third island for the
   thing the spec most wants to stay cheap. The single "Expand all / Collapse
   all" control *is* a `<button aria-expanded>`, enhanced in `Tree.astro`, and
   is hidden when scripting is unavailable.

2. **The light search index loads on idle or first focus, not with the island.**
   §10 says "with the search island". Fetching 150 KB during a listing page's
   own load would compete with the LCP image on 4G, which §12 cares about more.
   `requestIdleCallback` (or the first focus, whichever comes first) gets the
   same instant-feel without the contention. On `/search/` it loads immediately.

3. **The inline gallery serves 900 px for the lead frame** and 1600 px for the
   rest, rather than 1600 px throughout. The lead frame is the LCP element on a
   phone; the 900 px derivative already exists for the card and og:image, so
   using it here costs nothing and is the difference between hitting and missing
   the 2.5 s budget.

4. **Full text is stored pre-folded** in `full.json` — diacritics and case
   stripped at build time — so a keystroke does not normalise 800 KB of prose.
   The trade is that the match label says "text" rather than quoting a snippet.

5. **`/all/` is paginated at 48 per page**, not virtualised. Pagination is real
   URLs and no JavaScript; virtualisation would have been a third island.

6. **The prototype file referenced in the preamble was not present** in the
   repository, so §8's behaviour spec and §9's tokens were implemented from the
   spec text directly.

7. **Phase 0 recon has now been run**, from a GitHub Actions runner rather than
   the build sandbox. 232 listings; the rank chain is case 2 — one hierarchical
   taxonomy (`classification`) carrying the whole chain by nesting. The
   importer resolves it from the terms' parent links. See `MIGRATION.md`.

8. **The content copy is on hold.** The source site is not ours. `import` and
   `images` are complete and tested but must not be run against it until its
   owner agrees.

9. **Phase 0 recon could not be run from the build sandbox.** `weedsofmelbourne.org` is not reachable
   from the build environment. See `MIGRATION.md` — the rank-chain question is
   still open, and the importer is deliberately left unconfigured rather than
   guessing at it.

10. **The rank mapping is configuration, not a constant in the importer.**
   §4 says to report and stop for a decision. `data/taxonomy-map.json` does not
   exist until a human puts it there; recon writes a suggestion to `data/raw/`
   for them to check first. Exact rank names are matched before substrings, so
   `order` cannot claim the `superorder` taxonomy.

11. **Measured against §12's bars**, on the real 232 listings and their
    photographs (Lighthouse, mobile, simulated slow 4G). Run-to-run spread on
    the same page reaches 1.3 s, so these are medians of three runs — single
    runs are not decisive and were misleading earlier in this build.

    | Page | LCP | CLS | Verdict |
    |---|---|---|---|
    | Home | 2.33 s | 0.038 | pass |
    | Listing | **3.38 s** | 0.004 | **LCP misses 2.5 s** |
    | All listings | **4.07 s** | 0.007 | **LCP misses 2.5 s** |

    CLS passes everywhere, comfortably.

    Fixed along the way: the habitat mosaic was serving the 400 px grid
    thumbnail into cells that render at 85 CSS px, 36 of them, putting 970 KB
    on the home page. A 200 px derivative with a srcset took it to 636 KB and
    under the bar. The LCP image is preloaded, and the two speculative font
    preloads removed — they were queued ahead of it.

    Not fixed, and not fixable by tweaking: the eight webfont faces §9's type
    system needs are 185 KB of a 391 KB listing page. Dropping Spectral 300 and
    300-italic reaches only 3.15 s, so it does not earn the design change.
    Subsetting the faces to the glyphs used is no smaller than Google's stock
    latin subset, and `font-display: optional` made FCP worse without moving
    LCP — both measured.

    This is a real conflict between §9's type system and §12's LCP budget on a
    throttled connection, not an implementation defect. Closing it means fewer
    typefaces, or accepting the bar on this network profile. That is a design
    decision and has been left open. `scripts/fonts.ts` takes
    `WEEDS_FONT_DISPLAY` if the trade-off is revisited.

12. **Previous/next by date is gone** (§7, item 8). Removed at the site
    owner's request as superfluous — a listing already reaches its neighbours
    through its habitats, its genus and the classification tree.
    `byDateDescending()` went with it, since nothing else used it.

13. **The rank chain is a stepped vertical column, not a breadcrumb** (§7,
    item 6). A wrapped horizontal breadcrumb reads badly at 360 px once a
    chain runs to seven levels. It is now one rank per row, each stepped in
    from the one above with a hairline elbow, so it reads top-down like a
    taxonomic key. The rank name still sits above each term, as §7 asks, and
    every level is still a link to its `/tree/` page.

14. **Recon, import and images each accept an offline source** — a WordPress
   `Tools → Export` file (`--wxr=`) and a local `uploads/` tree (`--media=`) —
   because §4's three phases are otherwise unrunnable whenever the live site is
   unreachable, which is the situation this build was done in.
   `scripts/wxr.ts` parses the export into exactly the shape the REST API
   returns with `?_embed`, so there is one importer, not two.
