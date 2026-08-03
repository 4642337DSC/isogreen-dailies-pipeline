import { fetchJson } from './http.js';
import { isoDate } from './util.js';

// YouTube Analytics needs an OAuth *user* token scoped to the channel owner -
// the plain API key used elsewhere in youtube.js can't reach it. The token is
// minted once locally via scripts/youtube-oauth-setup.js; only the resulting
// refresh token is stored (as a GitHub secret), exchanged here for a
// short-lived access token on every run.
export async function getYouTubeAccessToken(cfg) {
  var data = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.YOUTUBE_OAUTH_CLIENT_ID,
      client_secret: cfg.YOUTUBE_OAUTH_CLIENT_SECRET,
      refresh_token: cfg.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString()
  });
  if (!data.access_token) throw new Error('YouTube OAuth token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}

// Channel-level "views" by exact calendar day, [start, end] inclusive -
// shape { "YYYY-MM-DD": views }. Used by both syncYouTubeMonthly (buckets
// this into months for the Monthly Views database, full history every run)
// and src/dailyViews.js (writes it as-is to the Daily Views database, a
// bounded recent window every run) - each calls this with its own range,
// which is fine since the API call itself is cheap regardless of span.
//
// Note: YouTube Analytics has its own ~2-3 day processing lag (confirmed by
// requesting through "today" and getting no rows for the last few days) -
// unlike Meta's Graph API, which is close to real-time. So the last couple
// of days may legitimately be missing; they appear once YouTube catches up.
export async function fetchYouTubeDailyViews(cfg, start, end) {
  var accessToken = await getYouTubeAccessToken(cfg);

  var url = 'https://youtubeanalytics.googleapis.com/v2/reports?' + new URLSearchParams({
    ids: 'channel==MINE',
    metrics: 'views',
    dimensions: 'day',
    sort: 'day',
    startDate: isoDate(start),
    endDate: isoDate(end)
  }).toString();

  var data = await fetchJson(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (data.error) throw new Error('YouTube Analytics fetch failed: ' + JSON.stringify(data.error));

  var daily = {};
  (data.rows || []).forEach(function (row) { daily[String(row[0])] = row[1]; });
  return daily;
}

// Buckets fetchYouTubeDailyViews into calendar months, since oldestDate's
// month through the current (partial) one - same shape as
// syncInstagramMonthly/syncFacebookMonthly so it drops straight into
// writeMonthlyViews.
//
// dimensions=month itself turned out to be unusable: the Analytics API
// insists both startDate/endDate "align" to a month boundary, but a month's
// last day AND a bare first-of-month endDate both got rejected or silently
// truncated the range - the latter meant the current in-progress month
// never got queried at all. Bucketing day-level data ourselves sidesteps
// the whole alignment quirk and naturally includes today's partial month.
export async function syncYouTubeMonthly(cfg, oldestDate) {
  var start = new Date(Date.UTC(oldestDate.getUTCFullYear(), oldestDate.getUTCMonth(), 1));
  var daily = await fetchYouTubeDailyViews(cfg, start, new Date());

  var monthly = {};
  Object.keys(daily).forEach(function (dateKey) {
    var monthKey = dateKey.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
    monthly[monthKey] = (monthly[monthKey] || 0) + daily[dateKey];
  });
  return monthly;
}
