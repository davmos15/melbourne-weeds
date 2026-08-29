import type { APIRoute } from 'astro';

/** Generated so the sitemap URL always matches the configured site (SPEC §14). */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href ?? 'https://weedsofmelbourne.org/';
  return new Response(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /search/',
      '',
      `Sitemap: ${new URL('sitemap-index.xml', base).href}`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};
