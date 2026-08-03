import { fetchJson } from './http.js';
import { GRAPH_API_VERSION } from './config.js';
import { matchContent, findById, buildPlatformReport } from './notion.js';
import { dateKeyInTz } from './util.js';

// Isogreen's Shorts are posted as Facebook Reels, which live under /video_reels
// (not the legacy /videos edge) and use the "blue_reels_play_count" metric
// instead of "total_video_views". Also requires a Page-scoped access token,
// not a User token, per Meta's "new Pages experience".
export async function fetchAllFacebookVideos(cfg) {
  var videos = [];
  var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + cfg.FB_PAGE_ID + '/video_reels' +
    '?fields=id,description,created_time,permalink_url,picture,video_insights.metric(blue_reels_play_count)' +
    '&limit=100&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
  while (url) {
    var data = await fetchJson(url);
    if (data.error) throw new Error('Facebook videos fetch failed: ' + JSON.stringify(data.error));
    (data.data || []).forEach(function (item) {
      var views = null;
      if (item.video_insights && item.video_insights.data && item.video_insights.data.length) {
        var metric = item.video_insights.data[0];
        if (metric.values && metric.values.length) views = metric.values[0].value;
      }
      var permalink = item.permalink_url
        ? (item.permalink_url.indexOf('http') === 0 ? item.permalink_url : 'https://www.facebook.com' + item.permalink_url)
        : null;
      videos.push({ id: item.id, text: item.description || '', publishedAt: item.created_time, permalink: permalink, views: views, picture: item.picture || null });
    });
    url = (data.paging && data.paging.next) ? data.paging.next : null;
  }
  return videos;
}

export async function syncFacebook(cfg, rows) {
  var videos = await fetchAllFacebookVideos(cfg); // views arrive inline via field expansion
  var results = [];
  rows.forEach(function (row) {
    var m = matchContent(row.postDate, row.text, videos);
    if (!m) return;
    var candidate = findById(videos, m.id);
    if (!candidate || candidate.views === null || candidate.views === undefined) return;
    results.push({ row: row, views: candidate.views, isNewMatch: true, method: m.method, score: m.score, url: candidate.permalink });
  });
  return buildPlatformReport(rows, results);
}

// --- Facebook: Page-level "page_video_views" time-series insight ---
// Covers all Page video content (Reels included, but not Reels-exclusive -
// Meta has no Reels-only equivalent at the Page level). Chunked into
// <=30-day windows since Meta caps since/until at that span; returns exact
// per-day values (shape { "YYYY-MM-DD": views }), used both to bucket into
// months (syncFacebookMonthly, for the Monthly Views database) and as-is by
// src/dailyViews.js (for the Daily Views database).
export async function fetchFacebookDailyViews(cfg, start, end) {
  var daily = {};
  var chunkEnd = new Date(end);

  while (chunkEnd > start) {
    var chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() - 30);
    if (chunkStart < start) chunkStart = new Date(start);

    var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + cfg.FB_PAGE_ID +
      '/insights/page_video_views?period=day' +
      '&since=' + Math.floor(chunkStart.getTime() / 1000) +
      '&until=' + Math.floor(chunkEnd.getTime() / 1000) +
      '&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
    var data = await fetchJson(url);
    if (data.error) throw new Error('Facebook daily insights fetch failed: ' + JSON.stringify(data.error));

    // Meta's end_time for a period=day point is the EXCLUSIVE end boundary
    // (i.e. midnight starting the *next* day), not a timestamp inside the
    // day the point describes - using it directly mislabels every day's
    // data as the following day (most visible for "today," which was
    // showing up as tomorrow with a still-partial view count, while every
    // other platform correctly had nothing for that not-yet-real date).
    // Stepping back 1 second lands safely inside the actual day.
    var series = (data.data && data.data.length) ? (data.data[0].values || []) : [];
    series.forEach(function (point) {
      if (typeof point.value !== 'number' || !point.end_time) return;
      var dateKey = dateKeyInTz(new Date(new Date(point.end_time).getTime() - 1000).toISOString());
      daily[dateKey] = (daily[dateKey] || 0) + point.value;
    });

    chunkEnd = new Date(chunkStart.getTime() - 1000);
  }

  return daily;
}

export async function syncFacebookMonthly(cfg, oldestDate) {
  var oldestNeeded = new Date(Date.UTC(oldestDate.getUTCFullYear(), oldestDate.getUTCMonth(), 1));
  var daily = await fetchFacebookDailyViews(cfg, oldestNeeded, new Date());

  var monthly = {};
  Object.keys(daily).forEach(function (dateKey) {
    var monthKey = dateKey.slice(0, 7);
    monthly[monthKey] = (monthly[monthKey] || 0) + daily[dateKey];
  });
  return monthly;
}
