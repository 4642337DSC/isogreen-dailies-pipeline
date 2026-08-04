import { getConfig } from '../src/config.js';
import { queryNotionDatabase, archiveNotionPage } from '../src/notion.js';

// Same false-zero situation as Instagram's "views" metric (see
// backfill-clean-instagram-zero-views.js), this time for Facebook's
// account-level "page_video_views" insights metric: it genuinely has no
// historical data before 2025-01-28 for this page (confirmed via the
// dashboard's own DAILY_VIEWS payload - 289 straight days at an explicit
// 0 from 2024-03-18 through 2025-01-27, then real non-zero values from
// 2025-01-28 on). Per-video Facebook posts from 2024 have real, non-zero
// view counts (~37K total across 26 videos) that this account-level
// aggregate simply never reflects.
//
// Archiving (not just leaving them at 0) matters because the dashboard's
// "Daily/Cumulated Views" chart treats a MISSING day as a gap to leave
// blank, but an explicit stored 0 as a real measurement to plot - so
// these rows need to disappear entirely for the chart to stop showing
// Facebook flatlined at zero for all of 2024 into late January 2025.
var cfg = getConfig();
if (!cfg.NOTION_TOKEN) throw new Error('Set NOTION_TOKEN first.');

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

// Daily cutoff is the exact first real day. Monthly keeps the coarser
// first-fully-real-month cutoff since January 2025's monthly aggregate
// (mostly real days 28-31) isn't misleading in aggregate form the way a
// flatlined daily chart is - same reasoning as the Instagram cleanup.
await archiveMatching(cfg.DAILY_VIEWS_DATABASE_ID, 'Date', 'Daily Views', '2025-01-28');
await archiveMatching(cfg.MONTHLY_VIEWS_DATABASE_ID, 'Month', 'Monthly Views', '2025-02-01');

console.log('Facebook false-zero cleanup complete.');
