import { fetchJson } from './http.js';
import { GRAPH_API_VERSION } from './config.js';
import { matchContent, findById, buildPlatformReport } from './notion.js';

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

// Shared chunked period=day fetcher for any Facebook Page insight metric.
// Chunked into <=30-day windows since Meta caps since/until at that span.
// mode "sum": additive metrics (views) - multiple points for the same day
// (shouldn't normally happen given non-overlapping chunks, but just in
// case) get added together. mode "last": snapshot metrics (follower
// counts) - a later value overwrites rather than adds.
//
// Each point's calendar day is derived from its POSITION in the series
// (chunkStart + i days), not from Meta's own end_time field. A first
// attempt trusted end_time (treating it as the exclusive end-of-day
// boundary and stepping back 1 second) but that still mislabeled every
// day's data as the following day - Meta's actual day-boundary convention
// for this Page isn't reliably UTC midnight, so a fixed small offset
// wasn't enough to reliably land back in the correct day. since/until are
// UTC timestamps we chose ourselves, and period=day always returns one
// point per day in chronological order starting at chunkStart, so position
// is a source of truth end_time isn't.
async function fetchFacebookDayMetric(cfg, metric, start, end, mode) {
  var daily = {};
  var chunkEnd = new Date(end);

  while (chunkEnd > start) {
    var chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() - 30);
    if (chunkStart < start) chunkStart = new Date(start);

    var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + cfg.FB_PAGE_ID +
      '/insights/' + metric + '?period=day' +
      '&since=' + Math.floor(chunkStart.getTime() / 1000) +
      '&until=' + Math.floor(chunkEnd.getTime() / 1000) +
      '&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
    var data = await fetchJson(url);
    if (data.error) throw new Error('Facebook ' + metric + ' fetch failed: ' + JSON.stringify(data.error));

    var series = (data.data && data.data.length) ? (data.data[0].values || []) : [];
    series.forEach(function (point, i) {
      if (typeof point.value !== 'number') return;
      var dateKey = new Date(chunkStart.getTime() + i * 86400000).toISOString().slice(0, 10);
      daily[dateKey] = mode === 'sum' ? (daily[dateKey] || 0) + point.value : point.value;
    });

    chunkEnd = new Date(chunkStart.getTime() - 1000);
  }

  return daily;
}

// --- Facebook: Page-level "page_video_views" time-series insight ---
// Covers all Page video content (Reels included, but not Reels-exclusive -
// Meta has no Reels-only equivalent at the Page level). Returns exact
// per-day values (shape { "YYYY-MM-DD": views }), used both to bucket into
// months (syncFacebookMonthly, for the Monthly Views database) and as-is by
// src/dailyViews.js (for the Daily Views database).
export async function fetchFacebookDailyViews(cfg, start, end) {
  return fetchFacebookDayMetric(cfg, 'page_video_views', start, end, 'sum');
}

// --- Facebook: Page-level "page_follows" time-series insight ---
// Total Page follower count as of each day - a real day-by-day history,
// not just a snapshot from whenever tracking started. "page_fans" (the
// older "Page Likes" metric name) is rejected outright by the API for this
// Page - "(#100) The value must be a valid insights metric" - since Meta's
// "new Pages experience" (already required elsewhere in this file for the
// Page-scoped access token) replaced Likes with Followers and renamed the
// underlying metric to match. Used by scripts/backfill-follower-history.js.
export async function fetchFacebookDailyFollowers(cfg, start, end) {
  return fetchFacebookDayMetric(cfg, 'page_follows', start, end, 'last');
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
