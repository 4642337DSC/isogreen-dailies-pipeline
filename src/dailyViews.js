import { writeDailyViews } from './notion.js';
import { fetchYouTubeDailyViews } from './youtubeAnalytics.js';
import { fetchFacebookDailyViews } from './facebook.js';
import { fetchInstagramDailyViews } from './instagram.js';

// How many trailing days the regular (daily-schedule) sync re-fetches and
// upserts, rather than the whole history every run - once a day is old
// enough to be fully processed by a platform, its view count is stable and
// doesn't need re-fetching. 35 days covers the dashboard's "Last 30 days"
// preset plus a buffer for reporting lag (YouTube's is ~2-3 days) and any
// transient API hiccups. Full history is a one-time cost handled by
// scripts/backfill-daily-views.js instead - re-fetching it here every day
// would be especially wasteful for Instagram, which costs ~1 API call per
// day requested (see fetchInstagramDailyViews).
var DAILY_SYNC_WINDOW_DAYS = 35;

// Channel-level per-day view totals -> the "Daily Views" Notion database
// (DAILY_VIEWS_DATABASE_ID). Powers the dashboard's custom date-range
// "Total views" KPI with real numbers for any user-picked window, instead
// of a post-date-filtered lifetime-total estimate. TikTok has no API that
// can answer this at all, so it's excluded here same as in monthlyViews.js.
export async function syncDailyViews(cfg, ctx) {
  if (!cfg.DAILY_VIEWS_DATABASE_ID) return;

  var end = new Date();
  var start = new Date(end.getTime() - DAILY_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (ctx.ytEnabled) {
    try {
      var ytDaily = await fetchYouTubeDailyViews(cfg, start, end);
      if (ytDaily) await writeDailyViews(cfg, 'YouTube', 'youtube-analytics-api', ytDaily);
    } catch (e) { console.log('YouTube daily views sync failed: ' + e); }
  }

  if (ctx.fbEnabled) {
    try {
      var fbDaily = await fetchFacebookDailyViews(cfg, start, end);
      if (fbDaily) await writeDailyViews(cfg, 'Facebook', 'facebook-insights-api', fbDaily);
    } catch (e) { console.log('Facebook daily views sync failed: ' + e); }

    try {
      var igDaily = await fetchInstagramDailyViews(cfg, start, end);
      if (igDaily) await writeDailyViews(cfg, 'Instagram', 'instagram-insights-api', igDaily);
    } catch (e) { console.log('Instagram daily views sync failed: ' + e); }
  }
}
