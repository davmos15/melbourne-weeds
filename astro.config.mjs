// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Both of these are read from the environment so that moving between a project
// subpath (username.github.io/melbourne-weeds/) and the real domain root
// (weedsofmelbourne.org) is a deploy-time change, never a code change.
// SPEC §2: listing URLs must eventually be `/{slug}/` at a domain root.
const SITE_URL = process.env.SITE_URL ?? 'https://weedsofmelbourne.org';
const SITE_BASE = process.env.SITE_BASE ?? '/';

export default defineConfig({
  site: SITE_URL,
  base: SITE_BASE,
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  integrations: [sitemap()],
  devToolbar: { enabled: false },
  vite: {
    build: {
      // The two islands are tiny; keeping them unsplit avoids extra requests.
      assetsInlineLimit: 0,
    },
  },
});
