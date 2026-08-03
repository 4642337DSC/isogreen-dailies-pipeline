import { getConfig } from '../src/config.js';
import { queryNotionDatabase, archiveNotionPage } from '../src/notion.js';

// One-time cleanup: Instagram's account-level "views" metric genuinely has
// no historical data before 2025-08 for this account (confirmed via a raw
// API dump - Meta returns an explicit, error-free total_value: 0, not a
// missing/null result). Every Daily/Monthly Views row this pipeline wrote
// for Instagram before that date is a false zero, not a real measurement -
// per-video posts from that period have real, non-zero view counts that
// this account-level aggregate simply never reflects.
//
// Archiving (not just leaving them at 0) matters because of what happens
// downstream: the dashboard's "Daily/Cumulated Views" chart treats a
// MISSING day as a gap to leave blank, but an explicit stored 0 as a real
// measurement to plot - so these rows need to disappear entirely, not just
// change value, for the chart to stop showing Instagram flatlined at zero
// through this whole stretch.
var CUTOFF = '2025-08-01'; // first month with real Instagram views data
var cfg = getConfig();
if (!cfg.NOTION_TOKEN) throw new Error('Set NOTION_TOKEN first.');

async function archiveMatching(databaseId, dateProperty, label) {
  if (!databaseId) { console.log(label + ' database not configured - skipping.'); return; }
  var archived = 0;
  var cursor = null;
  do {
    var payload = {
      filter: {
        and: [
          { property: 'Platform', select: { equals: 'Instagram' } },
          { property: dateProperty, date: { before: CUTOFF } }
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
  console.log('Archived ' + archived + ' Instagram row(s) from ' + label + ' (before ' + CUTOFF + ').');
}

await archiveMatching(cfg.DAILY_VIEWS_DATABASE_ID, 'Date', 'Daily Views');
await archiveMatching(cfg.MONTHLY_VIEWS_DATABASE_ID, 'Month', 'Monthly Views');

console.log('Instagram false-zero cleanup complete.');
