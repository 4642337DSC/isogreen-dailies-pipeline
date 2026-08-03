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

// Channel-level "views" by calendar month, since oldestDate's month through
// the current (partial) one - same shape as syncInstagramMonthly/
// syncFacebookMonthly so it drops straight into writeMonthlyViews.
//
// dimensions=month turned out to be unusable: the Analytics API insists both
// startDate/endDate "align" to a month boundary, but a month's last day AND
// a bare first-of-month endDate both got rejected or silently truncated the
// range - the latter meant the current in-progress month never got queried
// at all, so it always came back with no row for "this month" even once new
// views existed. Pulling day-level data and bucketing it into months
// ourselves (same approach as syncFacebookMonthly's period=day) sidesteps
// the whole alignment quirk and naturally includes today's partial month.
export async function syncYouTubeMonthly(cfg, oldestDate) {
  var accessToken = await getYouTubeAccessToken(cfg);
  var start = new Date(Date.UTC(oldestDate.getUTCFullYear(), oldestDate.getUTCMonth(), 1));
  var end = new Date();

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

  var monthly = {};
  (data.rows || []).forEach(function (row) {
    var monthKey = String(row[0]).slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
    monthly[monthKey] = (monthly[monthKey] || 0) + row[1];
  });

  console.log('YouTube monthly debug: requested ' + isoDate(start) + '..' + isoDate(end) +
    ', got ' + (data.rows ? data.rows.length : 0) + ' day-rows, last 5: ' +
    JSON.stringify((data.rows || []).slice(-5)) + ', monthly map: ' + JSON.stringify(monthly));

  return monthly;
}
