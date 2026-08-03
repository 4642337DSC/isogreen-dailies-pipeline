import { getConfig, requireConfig } from '../src/config.js';
import { fetchNotionRows } from '../src/notion.js';
import { syncMonthlyViews } from '../src/monthlyViews.js';

// Standalone monthly-views backfill (Instagram + Facebook only - see
// src/monthlyViews.js for why YouTube/TikTok are excluded). Safe to re-run -
// every write is an upsert (find-or-create by platform+month), so
// re-running just refreshes the same rows rather than duplicating them.
var cfg = getConfig();
requireConfig(cfg);
if (!cfg.MONTHLY_VIEWS_DATABASE_ID) {
  throw new Error('Set MONTHLY_VIEWS_DATABASE_ID first (see .env.example).');
}
var fbEnabled = !!(cfg.FB_PAGE_ID && cfg.FB_PAGE_ACCESS_TOKEN);

var rows = await fetchNotionRows(cfg);
var oldestDate = rows.reduce(function (oldest, r) {
  if (!r.postDate) return oldest;
  var d = new Date(r.postDate + 'T00:00:00Z');
  return (!oldest || d < oldest) ? d : oldest;
}, null) || new Date();

await syncMonthlyViews(cfg, { fbEnabled: fbEnabled, oldestDate: oldestDate });
