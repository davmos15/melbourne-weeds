/**
 * Search island (SPEC §10).
 *
 * Two tiers, because the full text of 400 essays is far too much to load
 * eagerly on a phone:
 *
 *   light.json  slug, names, rank chain, habitats, summary, thumbnail
 *   full.json   body text, pre-folded, fetched on the first keystroke
 *
 * Matching is a plain scan. At 400 records that is well under a frame, and
 * it costs no dependency — MiniSearch would be the fallback if this ever
 * proves inadequate, not the starting point.
 */

/* Field order in a light record. Arrays rather than objects, so the index
   stays small over the wire. Kept in sync with scripts/search-index.ts. */
const enum F {
  slug = 0,
  common = 1,
  binomial = 2,
  genus = 3,
  family = 4,
  order = 5,
  klass = 6,
  habitats = 7,
  summary = 8,
  thumb = 9,
}

type LightRecord = [
  string, string, string, string, string, string, string, string[], string, string,
];

interface LightIndex {
  v: number;
  records: LightRecord[];
}

interface Prepared {
  r: LightRecord;
  /** Folded haystacks, in match-priority order. */
  f: string[];
}

/** Match priority, and the label shown against a hit (SPEC §10). */
const FIELDS = [
  { idx: F.common, label: 'common name' },
  { idx: F.binomial, label: 'species' },
  { idx: F.genus, label: 'genus' },
  { idx: F.family, label: 'family' },
  { idx: F.order, label: 'order' },
  { idx: F.klass, label: 'class' },
  { idx: F.habitats, label: 'habitat' },
  { idx: F.summary, label: 'summary' },
] as const;

const TEXT_FIELD = FIELDS.length; // full text sits after every light field

interface Hit {
  r: LightRecord;
  field: number;
  label: string;
  /** Lower is better. */
  rank: number;
}

const DEBOUNCE_MS = 160;
const PANEL_LIMIT = 8;

function fold(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/* ------------------------------------------------------------------ state */

const form = document.querySelector<HTMLFormElement>('[data-search]');
const input = form?.querySelector<HTMLInputElement>('input[name="q"]') ?? null;
const panel = form?.querySelector<HTMLElement>('.search-panel') ?? null;
const liveStatus = form?.querySelector<HTMLElement>('#search-status') ?? null;
const hint = form?.querySelector<HTMLElement>('[data-search-hint]') ?? null;

/** Present only on /search/ — the cold-loadable results page. */
const page = document.querySelector<HTMLElement>('[data-search-results]');
const pageCount = document.querySelector<HTMLElement>('[data-search-count]');
const pageQuery = document.querySelector<HTMLElement>('[data-search-query]');

const endpoint = form?.dataset.endpoint ?? '/search/';
const lightUrl = form?.dataset.light ?? '/search/light.json';
const fullUrl = form?.dataset.full ?? '/search/full.json';

let prepared: Prepared[] | null = null;
let lightPromise: Promise<Prepared[]> | null = null;
let fullText: Record<string, string> | null = null;
let fullPromise: Promise<Record<string, string>> | null = null;
let activeIndex = -1;
let lastRendered = '';

/* ------------------------------------------------------------------ data */

function loadLight(): Promise<Prepared[]> {
  if (prepared) return Promise.resolve(prepared);
  lightPromise ??= fetch(lightUrl)
    .then((r) => (r.ok ? (r.json() as Promise<LightIndex>) : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      prepared = data.records.map((r) => ({
        r,
        f: FIELDS.map(({ idx }) => {
          const value = r[idx];
          return fold(Array.isArray(value) ? value.join(' ') : String(value ?? ''));
        }),
      }));
      return prepared;
    })
    .catch(() => {
      prepared = [];
      return prepared;
    });
  return lightPromise;
}

function loadFull(): Promise<Record<string, string>> {
  if (fullText) return Promise.resolve(fullText);
  fullPromise ??= fetch(fullUrl)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      fullText = data;
      return data;
    })
    .catch(() => {
      fullText = {};
      return fullText;
    });
  return fullPromise;
}

/* ---------------------------------------------------------------- matching */

function search(query: string, records: Prepared[]): Hit[] {
  const q = fold(query).trim();
  if (!q) return [];

  const hits: Hit[] = [];
  for (const item of records) {
    let best: Hit | null = null;

    for (let i = 0; i < item.f.length; i += 1) {
      const at = item.f[i].indexOf(q);
      if (at === -1) continue;
      // Field priority dominates; a match at the start of the field wins
      // ties, then an earlier position does.
      const rank = i * 1000 + (at === 0 ? 0 : 100) + Math.min(at, 99);
      best = { r: item.r, field: i, label: FIELDS[i].label, rank };
      break;
    }

    if (!best && fullText) {
      const body = fullText[item.r[F.slug]];
      const at = body ? body.indexOf(q) : -1;
      if (at !== -1) {
        best = { r: item.r, field: TEXT_FIELD, label: 'text', rank: TEXT_FIELD * 1000 + 500 };
      }
    }

    if (best) hits.push(best);
  }

  hits.sort((a, b) => a.rank - b.rank || a.r[F.common].localeCompare(b.r[F.common], 'en'));
  return hits;
}

/* --------------------------------------------------------------- rendering */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function hitHref(hit: Hit): string {
  const base = endpoint.replace(/search\/$/, '');
  return `${base}${hit.r[F.slug]}/`;
}

function hitMarkup(hit: Hit, cls: string, id?: string): string {
  const thumb = hit.r[F.thumb];
  // alt="" — the name sits immediately beside the image, so describing it
  // again would just be repeated to a screen reader.
  const img = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="" width="64" height="64" loading="lazy" decoding="async" />`
    : '<span aria-hidden="true"></span>';
  return [
    `<a class="${cls}" href="${escapeHtml(hitHref(hit))}"`,
    id ? ` id="${id}" role="option" aria-selected="false"` : '',
    '>',
    img,
    '<span>',
    `<span class="name">${escapeHtml(hit.r[F.common])}</span> `,
    `<span class="bi">${escapeHtml(hit.r[F.binomial])}</span>`,
    `<span class="label why">matched ${escapeHtml(hit.label)}</span>`,
    '</span></a>',
  ].join('');
}

function renderPanel(hits: Hit[], query: string): void {
  if (!panel || !input) return;
  activeIndex = -1;

  if (!query.trim()) {
    panel.hidden = true;
    panel.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    return;
  }

  const shown = hits.slice(0, PANEL_LIMIT);
  const more =
    hits.length > shown.length
      ? `<a class="search-hit" href="${escapeHtml(endpoint)}?q=${encodeURIComponent(query)}">` +
        '<span aria-hidden="true"></span>' +
        `<span class="label">See all ${hits.length} results</span></a>`
      : '';

  panel.innerHTML = shown.length
    ? shown.map((h, i) => hitMarkup(h, 'search-hit', `search-opt-${i}`)).join('') + more
    : `<p class="search-empty">No plant matches <strong>${escapeHtml(query)}</strong>.</p>`;

  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.removeAttribute('aria-activedescendant');
  if (liveStatus) liveStatus.textContent = `${hits.length} result${hits.length === 1 ? '' : 's'}`;
}

function renderPage(hits: Hit[], query: string): void {
  if (!page) return;
  if (pageQuery) pageQuery.textContent = query;
  if (pageCount) {
    pageCount.textContent = query.trim()
      ? `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`
      : '';
  }
  page.innerHTML = !query.trim()
    ? '<p class="empty">Type in the search field above to look through every listing — common name, botanical name, genus, family, order, habitat and the body of each essay.</p>'
    : hits.length
      ? hits.map((h) => hitMarkup(h, 'results-item')).join('')
      : `<p class="empty">No plant matches <strong>${escapeHtml(query)}</strong>. Try a genus, a family, or a habitat.</p>`;
}

/* ------------------------------------------------------------------- wiring */

function closePanel(): void {
  if (!panel || !input) return;
  panel.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  activeIndex = -1;
}

function options(): HTMLAnchorElement[] {
  return panel ? [...panel.querySelectorAll<HTMLAnchorElement>('a[role="option"]')] : [];
}

function moveActive(delta: number): void {
  const opts = options();
  if (!opts.length || !input) return;
  opts.forEach((o) => o.setAttribute('aria-selected', 'false'));
  activeIndex = (activeIndex + delta + opts.length + 1) % (opts.length + 1);
  const current = activeIndex === opts.length ? null : opts[activeIndex];
  opts.forEach((o) => delete o.dataset.active);
  if (current) {
    current.dataset.active = 'true';
    current.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({ block: 'nearest' });
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

async function run(query: string, { pushUrl = false } = {}): Promise<void> {
  const records = await loadLight();
  // Full text only matters once someone is actually typing.
  if (query.trim()) await loadFull();
  const hits = search(query, records);

  if (page) {
    renderPage(hits, query);
    closePanel();
    if (pushUrl) {
      // replaceState, so Back does not step through every keystroke — but the
      // URL stays copyable and reloads correctly (SPEC §10).
      const url = query.trim() ? `${endpoint}?q=${encodeURIComponent(query)}` : endpoint;
      history.replaceState(null, '', url);
    }
  } else {
    renderPanel(hits, query);
  }
  lastRendered = query;
}

let timer: number | undefined;

function schedule(query: string): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (query !== lastRendered || !panel?.hidden) void run(query, { pushUrl: true });
  }, DEBOUNCE_MS);
}

if (input && form) {
  input.addEventListener('input', () => schedule(input.value));

  input.addEventListener('focus', () => {
    void loadLight();
    if (hint) hint.hidden = true;
    if (input.value.trim() && !page) void run(input.value);
  });

  input.addEventListener('blur', () => {
    if (hint) hint.hidden = false;
    // Let a click on a result land before the panel goes away.
    window.setTimeout(closePanel, 120);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePanel();
      input.blur();
      return;
    }
    if (page) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (panel?.hidden) return;
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      const opts = options();
      if (activeIndex >= 0 && activeIndex < opts.length) {
        event.preventDefault();
        opts[activeIndex].click();
      }
    }
  });

  // `/` focuses the field — desktop convenience, never the only way in.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target?.isContentEditable) return;
    if (window.matchMedia('(hover: none)').matches) return;
    event.preventDefault();
    input.focus();
    input.select();
  });

  document.addEventListener('click', (event) => {
    if (!form.contains(event.target as Node)) closePanel();
  });

  // Cold load of /search/?q=… must render (SPEC §10).
  const initial = new URLSearchParams(location.search).get('q') ?? '';
  if (page) {
    input.value = initial;
    void run(initial);
  } else if (typeof requestIdleCallback === 'function') {
    // Warm the light index when the browser is otherwise idle, so the first
    // keystroke is instant without competing with the page's own paint.
    requestIdleCallback(() => void loadLight(), { timeout: 4000 });
  }
}
