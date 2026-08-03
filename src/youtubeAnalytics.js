import { fetchJson } from './http.js';
import { isoDate, monthRangeSince } from './util.js';

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
export async function syncYouTubeMonthly(cfg, oldestDate) {
  var accessToken = await getYouTubeAccessToken(cfg);
  var months = monthRangeSince(oldestDate);
  if (!months.length) return {};

  var url = 'https://youtubeanalytics.googleapis.com/v2/reports?' + new URLSearchParams({
    ids: 'channel==MINE',
    metrics: 'views',
    dimensions: 'month',
    sort: 'month',
    startDate: isoDate(months[0].start),
    endDate: isoDate(new Date())
  }).toString();

  var data = await fetchJson(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (data.error) throw new Error('YouTube Analytics fetch failed: ' + JSON.stringify(data.error));

  var monthly = {};
  (data.rows || []).forEach(function (row) {
    var monthKey = String(row[0]).slice(0, 7); // API returns "YYYY-MM" (sometimes "YYYY-MM-01") for the month dimension
    monthly[monthKey] = row[1];
  });
  return monthly;
}
