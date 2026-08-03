import { getConfig, requireConfig } from '../src/config.js';
import { fetchNotionRows, writeDailyViews, writeFollowerSnapshots } from '../src/notion.js';
import { fetchFacebookDailyViews, fetchFacebookDailyFollowers } from '../src/facebook.js';
import { fetchInstagramDailyFollowers, fetchInstagramCurrentFollowers } from '../src/instagram.js';

// One-time remediation, rounds 2+3 combined:
//
// Round 2: the first fix (deriving each day's key from Meta's end_time
// minus 1 second) turned out to still be wrong - Meta's actual day-boundary
// convention for this Page isn't reliably UTC midnight, so a fixed small
// offset wasn't enough to reliably land back in the correct day (confirmed
// live: a "2026-08-04" row existed in Facebook's daily views while real
// time was still Aug 3). fetchFacebookDailyViews, fetchFacebookDailyFollowers,
// and fetchInstagramDailyFollowers all now derive each point's day from its
// POSITION in the series instead (see fetchFacebookDayMetric's comment in
// facebook.js).
//
// Round 3: Instagram's follower_count metric is NOT an absolute snapshot
// despite the name - it's the day's net follower delta. Treating it as a
// snapshot (directly overwriting each day with that day's tiny delta
// value) produced a history that read as ~0 almost everywhere. Now
// reconstructed backwards from today's real follower count, same approach
// as YouTube's subscribersGained/subscribersLost.
//
// Re-running all three here self-heals the existing history via
// upsert-by-date, same as round 1. Deliberately skips YouTube and
// Instagram's *views* fetch - neither was ever end_time-derived or a
// mislabeled delta (YouTube uses the API's own pre-labeled dates;
// Instagram's views fetch computes its own day boundaries directly and
// uses a real total_value aggregate, not a delta).
var cfg = getConfig();
requireConfig(cfg);
if (!cfg.FB_PAGE_ID || !cfg.FB_PAGE_ACCESS_TOKEN) throw new Error('FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN not configured.');

var rows = await fetchNotionRows(cfg);
var oldestDate = rows.reduce(function (oldest, r) {
  if (!r.postDate) return oldest;
  var d = new Date(r.postDate + 'T00:00:00Z');
  return (!oldest || d < oldest) ? d : oldest;
}, null) || new Date();
var start = new Date(Date.UTC(oldestDate.getUTCFullYear(), oldestDate.getUTCMonth(), oldestDate.getUTCDate()));
var end = new Date();

if (cfg.DAILY_VIEWS_DATABASE_ID) {
  console.log('Re-fetching Facebook daily views with the corrected (position-based) date-key logic...');
  var fbDaily = await fetchFacebookDailyViews(cfg, start, end);
  console.log('Writing ' + Object.keys(fbDaily).length + ' Facebook day(s) into Daily Views...');
  await writeDailyViews(cfg, 'Facebook', 'facebook-insights-api', fbDaily);
} else {
  console.log('DAILY_VIEWS_DATABASE_ID not set - skipping Facebook daily views fix.');
}

if (cfg.FOLLOWER_SNAPSHOTS_DATABASE_ID) {
  console.log('Re-fetching Facebook daily followers with the corrected date-key logic...');
  var fbFollowers = await fetchFacebookDailyFollowers(cfg, start, end);
  console.log('Writing ' + Object.keys(fbFollowers).length + ' Facebook day(s) into Follower Snapshots...');
  await writeFollowerSnapshots(cfg, 'Facebook', fbFollowers);

  // Instagram's follower_count only ever covers the trailing ~30 days
  // (Meta's own hard limit) - cheap to just always re-fetch the full
  // available window.
  console.log('Fetching current Instagram follower count...');
  var currentIgFollowers = await fetchInstagramCurrentFollowers(cfg);
  console.log('Reconstructing Instagram daily follower history from ' + currentIgFollowers + ' current followers...');
  var igFollowers = await fetchInstagramDailyFollowers(cfg, start, end, currentIgFollowers);
  console.log('Writing ' + Object.keys(igFollowers).length + ' Instagram day(s) into Follower Snapshots...');
  await writeFollowerSnapshots(cfg, 'Instagram', igFollowers);
} else {
  console.log('FOLLOWER_SNAPSHOTS_DATABASE_ID not set - skipping follower fixes.');
}

console.log('Meta day-boundary + Instagram follower-delta fix complete.');
