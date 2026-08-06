import { getConfig } from '../src/config.js';
import { queryNotionDatabase, archiveNotionPage } from '../src/notion.js';

// Facebook's account-level "page_video_views" insights metric genuinely
// has no historical data before each account's own real-tracking start -
// confirmed per-client via the dashboard's own DAILY_VIEWS payload (a
// stretch of straight explicit 0s, then real non-zero values from one day
// on). Per-video Facebook posts from that period still have real, non-zero
// view counts - it's specifically this account-level aggregate that never
// reflects them.
//
// Archiving (not just leaving them at 0) matters because the dashboard's
// "Daily/Cumulated Views" chart treats a MISSING day as a gap to leave
// blank, but an explicit stored 0 as a real measurement to plot - so these
// rows need to disappear entirely for the chart to stop showing Facebook
// flatlined at zero through the whole pre-tracking stretch.
//
// Cutoffs are per-client (confirmed empirically, not guessed) since each
// account's real-tracking start date differs. Daily cutoff is the exact
// first real day; Monthly keeps the coarser first-fully-real-month cutoff
// since a partial month's aggregate (mostly real days) isn't misleading in
// aggregate form the way a flatlined daily chart is.
var CUTOFFS = {
  isogreen: { daily: '2025-01-28', monthly: '2025-02-01' }, // 2024-03-18 through 2025-01-27 was a false-zero wall
  miradex: { daily: '2025-01-30', monthly: '2025-02-01' } // 2024-01-06 through 2025-01-29 was a false-zero wall
};

var cfg = getConfig();
if (!cfg.NOTION_TOKEN) throw new Error('Set NOTION_TOKEN first.');
var cutoff = CUTOFFS[cfg.CLIENT_SLUG];
if (!cutoff) throw new Error('No confirmed false-zero cutoff for client "' + cfg.CLIENT_SLUG + '" - check its Daily Views history for a false-zero wall before adding one to CUTOFFS above.');

async function archiveMatching(databaseId, dateProperty, label, cutoff) {
  if (!databaseId) { console.log(label + ' database not configured - skipping.'); return; }
  var archived = 0;
  var cursor = null;
  do {
    var payload = {
      filter: {
        and: [
          { property: 'Platform', select: { equals: 'Facebook' } },
          { property: dateProperty, date: { before: cutoff } }
        ]
      },
      page_size: 100
    };
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, databaseId, payload);
    if (data.object === 'error') throw new Error(label + ' query failed: ' + data.message);
    for (var page of (data.results || [])) {
      await archiveNotionPage(cfg, page.id);
      archived++;
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  console.log('Archived ' + archived + ' Facebook row(s) from ' + label + ' (before ' + cutoff + ').');
}

await archiveMatching(cfg.DAILY_VIEWS_DATABASE_ID, 'Date', 'Daily Views', cutoff.daily);
await archiveMatching(cfg.MONTHLY_VIEWS_DATABASE_ID, 'Month', 'Monthly Views', cutoff.monthly);

console.log('Facebook false-zero cleanup complete.');
