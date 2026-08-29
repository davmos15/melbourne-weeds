/**
 * Base-aware URL building (SPEC §2/§14).
 *
 * Astro does not rewrite hrefs in markup, so every internal link goes through
 * `u()`. That keeps the base path in exactly one place — the SITE_BASE env var
 * — so moving from username.github.io/repo/ to the domain root is a config
 * change, never a find-and-replace through the templates.
 */

const BASE = import.meta.env.BASE_URL || '/';

/** `u('/tree/')` -> `/tree/` at a domain root, `/repo/tree/` on a subpath. */
export function u(route: string): string {
  const b = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${b}${r}`;
}

/** Site-relative asset path (images, fonts) — same rule, named for intent. */
export const asset = u;

export function listingUrl(slug: string): string {
  return u(`/${slug}/`);
}

export function habitatUrl(slug: string): string {
  return u(`/where/${slug}/`);
}

export function treeUrl(slug: string): string {
  return u(`/tree/${slug}/`);
}
