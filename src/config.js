export function getConfig() {
  return {
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || null,
    NOTION_TOKEN: process.env.NOTION_TOKEN || null,
    NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID || null,
    CHANNEL_HANDLE: process.env.CHANNEL_HANDLE || '@isogreenromania',
    FB_PAGE_ID: process.env.FB_PAGE_ID || null,
    FB_PAGE_ACCESS_TOKEN: process.env.FB_PAGE_ACCESS_TOKEN || null,
    ZERNIO_API_KEY: process.env.ZERNIO_API_KEY || null,
    ZERNIO_TIKTOK_ACCOUNT_ID: process.env.ZERNIO_TIKTOK_ACCOUNT_ID || null,
    CHANNEL_STATS_DATABASE_ID: process.env.CHANNEL_STATS_DATABASE_ID || null,
    MONTHLY_VIEWS_DATABASE_ID: process.env.MONTHLY_VIEWS_DATABASE_ID || null,
    DAILY_VIEWS_DATABASE_ID: process.env.DAILY_VIEWS_DATABASE_ID || null,
    YOUTUBE_OAUTH_CLIENT_ID: process.env.YOUTUBE_OAUTH_CLIENT_ID || null,
    YOUTUBE_OAUTH_CLIENT_SECRET: process.env.YOUTUBE_OAUTH_CLIENT_SECRET || null,
    YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN || null
  };
}

export function requireConfig(cfg) {
  if (!cfg.YOUTUBE_API_KEY || !cfg.NOTION_TOKEN || !cfg.NOTION_DATABASE_ID) {
    throw new Error('Missing required env vars. Set YOUTUBE_API_KEY, NOTION_TOKEN, NOTION_DATABASE_ID (see .env.example).');
  }
}

export var NOTION_VERSION = '2022-06-28';
export var GRAPH_API_VERSION = 'v25.0';
export var TEXT_MATCH_THRESHOLD = 0.32;
export var TEXT_MARGIN = 0.06;
export var UNMATCHED_SUMMARY_CAP = 20;
