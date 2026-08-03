import { getConfig, requireConfig } from '../src/config.js';
import { fetchNotionRows, writeDailyViews } from '../src/notion.js';
import { fetchFacebookDailyViews } from '../src/facebook.js';

// One-time remediation: fetchFacebookDailyViews used to derive each day's
// key from Meta's end_time field directly, which is the EXCLUSIVE end
// boundary of that day (midnight starting the *next* day) - every Facebook
// daily row in the Daily Views database is currently stored one day later
// than it should be. Re-running just Facebook's fetch with the fix applied
// self-heals almost the entire history for free: writeDailyViews upserts by
// exact (platform, date), so a date that was wrongly holding the PREVIOUS
// day's value just gets overwritten with its own correct value. Only two
// harmless leftovers remain after this: the very first tracked day (gets a
// new row, since nothing was ever shifted into that slot) and one stray
// future-dated row at the tail end (the fake "tomorrow" the bug produced) -
// low-impact enough not to bother cleaning up manually.
//
// Deliberately skips YouTube/Instagram - neither was affected by this bug
// (YouTube uses the API's own pre-labeled dates; Instagram computes its own
// day boundaries rather than deriving them from a Meta end_time field), and
// Instagram's fetch is expensive (~1 API call per day) - no reason to pay
// that again for a Facebook-only bug.
var cfg = getConfig();
requireConfig(cfg);
if (!cfg.DAILY_VIEWS_DATABASE_ID) throw new Error('Set DAILY_VIEWS_DATABASE_ID first.');
if (!cfg.FB_PAGE_ID || !cfg.FB_PAGE_ACCESS_TOKEN) throw new Error('FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN not configured.');

var rows = await fetchNotionRows(cfg);
var oldestDate = rows.reduce(function (oldest, r) {
  if (!r.postDate) return oldest;
  var d = new Date(r.postDate + 'T00:00:00Z');
  return (!oldest || d < oldest) ? d : oldest;
}, null) || new Date();
var start = new Date(Date.UTC(oldestDate.getUTCFullYear(), oldestDate.getUTCMonth(), oldestDate.getUTCDate()));

console.log('Re-fetching Facebook daily views with the corrected date-key logic...');
var fbDaily = await fetchFacebookDailyViews(cfg, start, new Date());
console.log('Writing ' + Object.keys(fbDaily).length + ' Facebook day(s)...');
await writeDailyViews(cfg, 'Facebook', 'facebook-insights-api', fbDaily);
console.log('Facebook daily views fix complete.');
