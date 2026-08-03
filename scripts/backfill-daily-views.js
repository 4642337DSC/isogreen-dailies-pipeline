import { getConfig, requireConfig } from '../src/config.js';
import { fetchNotionRows, writeDailyViews } from '../src/notion.js';
import { fetchYouTubeDailyViews } from '../src/youtubeAnalytics.js';
import { fetchFacebookDailyViews } from '../src/facebook.js';
import { fetchInstagramDailyViews } from '../src/instagram.js';

// One-time full-history backfill for the Daily Views database - the
// regular daily sync (src/dailyViews.js) only touches a bounded recent
// window going forward, so this fills in everything before that once.
// Instagram costs ~1 API call per day requested (no day-level time series
// mode exists for its "views" metric - see fetchInstagramDailyViews), so a
// ~2.5 year history means several hundred sequential calls - expect this
// to take a few minutes. Safe to re-run - every write is an upsert.
var cfg = getConfig();
requireConfig(cfg);
if (!cfg.DAILY_VIEWS_DATABASE_ID) {
  throw new Error('Set DAILY_VIEWS_DATABASE_ID first - run the create-daily-views-db backfill script, or create it manually (see .env.example).');
}
var fbEnabled = !!(cfg.FB_PAGE_ID && cfg.FB_PAGE_ACCESS_TOKEN);
var ytEnabled = !!(cfg.YOUTUBE_OAUTH_CLIENT_ID && cfg.YOUTUBE_OAUTH_CLIENT_SECRET && cfg.YOUTUBE_REFRESH_TOKEN);

var rows = await fetchNotionRows(cfg);
var oldestDate = rows.reduce(function (oldest, r) {
  if (!r.postDate) return oldest;
  var d = new Date(r.postDate + 'T00:00:00Z');
  return (!oldest || d < oldest) ? d : oldest;
}, null) || new Date();
var start = new Date(Date.UTC(oldestDate.getUTCFullYear(), oldestDate.getUTCMonth(), oldestDate.getUTCDate()));
var end = new Date();

if (ytEnabled) {
  console.log('Fetching YouTube daily views...');
  var ytDaily = await fetchYouTubeDailyViews(cfg, start, end);
  console.log('Writing ' + Object.keys(ytDaily).length + ' YouTube day(s)...');
  await writeDailyViews(cfg, 'YouTube', 'youtube-analytics-api', ytDaily);
} else {
  console.log('YouTube OAuth not configured - skipping.');
}

if (fbEnabled) {
  console.log('Fetching Facebook daily views...');
  var fbDaily = await fetchFacebookDailyViews(cfg, start, end);
  console.log('Writing ' + Object.keys(fbDaily).length + ' Facebook day(s)...');
  await writeDailyViews(cfg, 'Facebook', 'facebook-insights-api', fbDaily);

  console.log('Fetching Instagram daily views (slow - ~1 API call per day)...');
  var igDaily = await fetchInstagramDailyViews(cfg, start, end);
  console.log('Writing ' + Object.keys(igDaily).length + ' Instagram day(s)...');
  await writeDailyViews(cfg, 'Instagram', 'instagram-insights-api', igDaily);
} else {
  console.log('FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN not configured - skipping Facebook + Instagram.');
}

console.log('Daily Views backfill complete.');
