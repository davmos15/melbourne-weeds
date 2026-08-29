/** Small formatting helpers shared across pages. Pure, no DOM. */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2023-05-31" -> "31 May 2023". Parsed by hand so there is no timezone slip. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

/** Strip diacritics and case so "Alsophila" matches "alsóphila". SPEC §10. */
export function fold(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function slugify(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Alt text default from SPEC §12: "{common} ({binomial})". */
export function altFor(common: string, binomial: string, given?: string): string {
  if (given && given.trim()) return given.trim();
  return binomial ? `${common} (${binomial})` : common;
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** Join a base path and a route without doubling or dropping slashes. */
export function joinPath(base: string, route: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${b}${r}` || '/';
}
