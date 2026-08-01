import { getConfig } from '../src/config.js';
import { writeMonthlyViews } from '../src/notion.js';

// TikTok has no API that can answer "how many views did I have in a past
// month" - the daily-snapshot delta (src/tiktok.js) only starts producing
// real months once two consecutive months of snapshots exist. This fills
// the gap for months before that: paste in whatever historical totals you
// have (e.g. from TikTok Studio's own analytics screen), then run
// `npm run backfill:tiktok-monthly`.
//
// Safe to re-run - it just overwrites the same Platform=TikTok, Month rows.
// Rows written this way get Source = "tiktok-manual" in Notion, so they
// stay visually distinguishable from the derived "tiktok-zernio" rows.
//
// Only backfill months that predate your snapshot history - once the daily
// sync has real data for a given month, it overwrites whatever is here.

// EDIT ME - 'YYYY-MM': total TikTok views for that calendar month.
var BACKFILL = {
  // '2025-01': 12000,
  // '2025-02': 15400,
  // '2025-03': 9800
};

var cfg = getConfig();
if (!cfg.MONTHLY_VIEWS_DATABASE_ID) {
  throw new Error('Set MONTHLY_VIEWS_DATABASE_ID first (see .env.example).');
}

var months = Object.keys(BACKFILL);
if (!months.length) {
  console.log('BACKFILL is empty - edit the object at the top of this script with real numbers first, then run again.');
} else {
  await writeMonthlyViews(cfg, 'TikTok', 'tiktok-manual', BACKFILL);
  console.log('Backfilled ' + months.length + ' TikTok month(s): ' + months.join(', '));
}
