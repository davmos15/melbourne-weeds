// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Both of these are read from the environment so that moving between a project
// subpath and a domain root is a deploy-time change, never a code change.
//
// The defaults are the GitHub Pages project site, because that is where this
// actually publishes. SPEC §2 assumed the build would eventually be served from
// weedsofmelbourne.org itself — that is not our domain, so slug-verbatim URLs
// buy portability rather than link compatibility. Point SITE_URL/SITE_BASE at a
// domain root if that ever changes.
const SITE_URL = process.env.SITE_URL ?? 'https://davmos15.github.io';
const SITE_BASE = process.env.SITE_BASE ?? '/melbourne-weeds/';

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
