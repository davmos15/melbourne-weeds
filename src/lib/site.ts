/**
 * Demo mode.
 *
 * The content is weedsofmelbourne.org's, and their owner has not yet agreed to
 * this rebuild — it exists to be shown to them. While that is true the site
 * carries attribution and asks not to be indexed, so it cannot turn up in
 * search results against the site it is a copy of.
 *
 * Set WEEDS_DEMO=0 once there is an agreement.
 */
export const DEMO = process.env.WEEDS_DEMO !== '0';

export const SOURCE_SITE = 'weedsofmelbourne.org';
export const SOURCE_URL = 'https://weedsofmelbourne.org';
