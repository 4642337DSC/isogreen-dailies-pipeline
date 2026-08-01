import { getConfig, requireConfig } from '../src/config.js';
import { fetchNotionRows } from '../src/notion.js';
import { syncTikTok } from '../src/tiktok.js';
import { syncMonthlyViews } from '../src/monthlyViews.js';

// Standalone monthly-views backfill - skips the YouTube/Facebook/Instagram/
// TikTok per-video sync, thumbnails, and audience steps entirely. Safe to
// re-run - every write is an upsert (find-or-create by platform+month), so
// re-running just refreshes the same rows rather than duplicating them.
var cfg = getConfig();
requireConfig(cfg);
if (!cfg.MONTHLY_VIEWS_DATABASE_ID) {
  throw new Error('Set MONTHLY_VIEWS_DATABASE_ID first (see .env.example).');
}
var fbEnabled = !!(cfg.FB_PAGE_ID && cfg.FB_PAGE_ACCESS_TOKEN);
var tiktokEnabled = !!(cfg.ZERNIO_API_KEY && cfg.ZERNIO_TIKTOK_ACCOUNT_ID);

var tt = null;
if (tiktokEnabled) {
  var rows = await fetchNotionRows(cfg);
  tt = await syncTikTok(cfg, rows);
}

await syncMonthlyViews(cfg, { fbEnabled: fbEnabled, tiktokEnabled: tiktokEnabled, tt: tt });
