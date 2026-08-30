import type { APIRoute } from 'astro';
import { DEMO } from '../lib/site.ts';

/** Generated so the sitemap URL always matches the configured site (SPEC §14). */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href ?? 'https://weedsofmelbourne.org/';
  // In demo mode nothing is indexable — see src/lib/site.ts.
  const lines = DEMO
    ? ['User-agent: *', 'Disallow: /', '']
    : [
        'User-agent: *',
        'Allow: /',
        'Disallow: /search/',
        '',
        `Sitemap: ${new URL('sitemap-index.xml', base).href}`,
        '',
      ];
  return new Response(
    lines.join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};
