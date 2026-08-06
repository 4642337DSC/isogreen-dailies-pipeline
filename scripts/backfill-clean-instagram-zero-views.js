import { getConfig } from '../src/config.js';
import { queryNotionDatabase, archiveNotionPage } from '../src/notion.js';

// Instagram's account-level "views" metric genuinely has no historical
// data before each account's own real-tracking start (confirmed per-client
// via a raw API dump/the dashboard's Daily Views payload - Meta returns an
// explicit, error-free 0, not a missing/null result, so it looks like real
// data unless you check). Every Daily/Monthly Views row this pipeline
// wrote for Instagram before that date is a false zero - per-video posts
// from that period have real, non-zero view counts that this account-level
// aggregate simply never reflects.
//
// Archiving (not just leaving them at 0) matters because of what happens
// downstream: the dashboard's "Daily/Cumulated Views" chart treats a
// MISSING day as a gap to leave blank, but an explicit stored 0 as a real
// measurement to plot - so these rows need to disappear entirely, not just
// change value, for the chart to stop showing Instagram flatlined at zero
// through this whole stretch.
//
// Cutoffs are per-client (confirmed empirically, not guessed) since each
// account's real-tracking start date differs. Monthly keeps the coarser
// first-fully-real-month cutoff since a partial month's aggregate (mostly
// real days) isn't misleading in aggregate form the way a flatlined daily
// chart is.
var CUTOFFS = {
  isogreen: { daily: '2025-08-24', monthly: '2025-08-01' }, // real, explicit 0 through 2025-08-23, genuine data from 2025-08-24
  miradex: { daily: '2025-08-22', monthly: '2025-08-01' } // 2024-08-06 through 2025-08-21 was a false-zero wall
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
          { property: 'Platform', select: { equals: 'Instagram' } },
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
  console.log('Archived ' + archived + ' Instagram row(s) from ' + label + ' (before ' + cutoff + ').');
}

await archiveMatching(cfg.DAILY_VIEWS_DATABASE_ID, 'Date', 'Daily Views', cutoff.daily);
await archiveMatching(cfg.MONTHLY_VIEWS_DATABASE_ID, 'Month', 'Monthly Views', cutoff.monthly);

console.log('Instagram false-zero cleanup complete.');
