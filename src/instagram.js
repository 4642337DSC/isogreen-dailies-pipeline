import { fetchJson } from './http.js';
import { GRAPH_API_VERSION } from './config.js';
import { matchContent, findById, buildPlatformReport } from './notion.js';
import { monthRangeSince, isoDate, dateKeyInTz } from './util.js';

export async function resolveInstagramUserId(cfg) {
  var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + cfg.FB_PAGE_ID +
    '?fields=instagram_business_account&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
  var data = await fetchJson(url);
  if (data.error) throw new Error('Could not resolve Instagram account: ' + JSON.stringify(data.error));
  if (!data.instagram_business_account) throw new Error('No Instagram Business/Creator account linked to this Facebook Page.');
  return data.instagram_business_account.id;
}

export async function fetchAllInstagramMedia(cfg) {
  var igUserId = await resolveInstagramUserId(cfg);
  var media = [];
  var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + igUserId + '/media' +
    '?fields=id,caption,timestamp,permalink,media_product_type,thumbnail_url,media_url' +
    '&limit=100&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
  while (url) {
    var data = await fetchJson(url);
    if (data.error) throw new Error('Instagram media fetch failed: ' + JSON.stringify(data.error));
    (data.data || []).forEach(function (item) {
      if (item.media_product_type !== 'REELS' && item.media_product_type !== 'VIDEO') return;
      // thumbnail_url is the video's cover frame; media_url is a fallback
      // for media types where Meta doesn't expose a separate thumbnail.
      media.push({
        id: item.id, text: item.caption || '', publishedAt: item.timestamp, permalink: item.permalink || null,
        thumbnailUrl: item.thumbnail_url || item.media_url || null
      });
    });
    url = (data.paging && data.paging.next) ? data.paging.next : null;
  }
  return media;
}

export async function fetchInstagramInsight(cfg, mediaId, metric) {
  var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + mediaId +
    '/insights?metric=' + metric + '&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
  var data = await fetchJson(url);
  return data.error ? null : data;
}

export async function fetchInstagramViewCounts(cfg, mediaIds) {
  var unique = mediaIds.filter(function (id, i) { return mediaIds.indexOf(id) === i; });
  var views = {};
  for (var id of unique) {
    var data = await fetchInstagramInsight(cfg, id, 'views');
    if (!data) data = await fetchInstagramInsight(cfg, id, 'plays'); // older API versions used "plays" for Reels
    if (data && data.data && data.data.length && data.data[0].values && data.data[0].values.length) {
      views[id] = data.data[0].values[0].value;
    }
  }
  return views;
}

export async function syncInstagram(cfg, rows) {
  var media = await fetchAllInstagramMedia(cfg);
  var matched = [];
  rows.forEach(function (row) {
    var m = matchContent(row.postDate, row.text, media);
    if (m) matched.push({ row: row, id: m.id, method: m.method, score: m.score });
  });

  var ids = matched.map(function (p) { return p.id; });
  var stats = await fetchInstagramViewCounts(cfg, ids);

  var results = [];
  matched.forEach(function (p) {
    var views = stats[p.id];
    if (views === undefined) return;
    var candidate = findById(media, p.id);
    results.push({ row: p.row, views: views, isNewMatch: true, method: p.method, score: p.score, url: candidate ? candidate.permalink : null });
  });
  return buildPlatformReport(rows, results);
}

// --- Instagram: account-level "views" metric - total_value only, capped at 30-day windows ---
// Reuses FB_PAGE_ACCESS_TOKEN (already used for the daily per-video sync and
// for follower counts). Meta's Graph API insists this metric use
// metric_type=total_value - it rejects a plain daily time series outright -
// AND caps since/until at 30 days apart even in total_value mode, which a
// 31-day calendar month exceeds by one day. So each calendar month is split
// into <=30-day sub-windows, each fetched as its own total_value aggregate,
// and the sub-window totals are summed to get the true month total
// (non-overlapping total_value windows can just be added).
export async function syncInstagramMonthly(cfg, oldestDate) {
  var igUserId = await resolveInstagramUserId(cfg);
  var monthly = {};
  var months = monthRangeSince(oldestDate);
  var now = new Date();

  for (var m of months) {
    var effectiveEnd = m.end > now ? now : m.end; // the current in-progress month's boundary is in the future - Meta rejects since/until beyond "now"
    if (effectiveEnd <= m.start) continue;
    var total = await fetchInstagramViewsTotalForRange(cfg, igUserId, m.start, effectiveEnd);
    if (total !== null) monthly[m.key] = total;
  }

  return monthly;
}

// Real per-day Instagram views, shape { "YYYY-MM-DD": views } - for
// src/dailyViews.js's Daily Views database. Unlike Facebook/YouTube,
// Instagram's "views" metric has no day-level time series mode at all (see
// the comment on syncInstagramMonthly above) - the only way to get a real
// number for a single day is to request that exact 1-day window in
// total_value mode. So this costs one API call per day requested, not one
// per month like the other platforms; callers should bound the range
// accordingly for anything run on a daily schedule (see dailyViews.js).
export async function fetchInstagramDailyViews(cfg, start, end) {
  var igUserId = await resolveInstagramUserId(cfg);
  var daily = {};
  var now = new Date();
  var effectiveEnd = end > now ? now : end;
  var dayStart = new Date(start);

  while (dayStart < effectiveEnd) {
    var dayEnd = new Date(Math.min(dayStart.getTime() + 24 * 60 * 60 * 1000, effectiveEnd.getTime()));
    var total = await fetchInstagramViewsTotalForRange(cfg, igUserId, dayStart, dayEnd);
    if (total !== null) daily[dayStart.toISOString().slice(0, 10)] = total;
    dayStart = dayEnd;
  }

  return daily;
}

// --- Instagram: account-level "follower_count" time-series insight ---
// Unlike "views", follower_count supports a real plain period=day time
// series (no total_value workaround needed) - one call per <=30-day chunk,
// same end_time-boundary handling as Facebook's page_fans (see
// fetchFacebookDayMetric's comment: end_time is the exclusive end of the
// day, step back 1 second to land inside the actual day). Used by
// scripts/backfill-follower-history.js. Errors are logged and skipped per
// chunk rather than thrown, in case some part of the history falls outside
// whatever retention window this metric turns out to have.
export async function fetchInstagramDailyFollowers(cfg, start, end) {
  var igUserId = await resolveInstagramUserId(cfg);
  var daily = {};
  var MAX_CHUNK_MS = 30 * 24 * 60 * 60 * 1000;
  var chunkStart = new Date(start);

  while (chunkStart < end) {
    var chunkEnd = new Date(Math.min(chunkStart.getTime() + MAX_CHUNK_MS, end.getTime()));
    var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + igUserId +
      '/insights?metric=follower_count&period=day' +
      '&since=' + Math.floor(chunkStart.getTime() / 1000) +
      '&until=' + Math.floor(chunkEnd.getTime() / 1000) +
      '&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
    var data = await fetchJson(url);
    if (data.error) {
      console.log('Instagram follower_count fetch failed for ' + isoDate(chunkStart) + '..' + isoDate(chunkEnd) + ': ' + JSON.stringify(data.error));
    } else {
      var series = (data.data && data.data.length) ? (data.data[0].values || []) : [];
      series.forEach(function (point) {
        if (typeof point.value !== 'number' || !point.end_time) return;
        var dateKey = dateKeyInTz(new Date(new Date(point.end_time).getTime() - 1000).toISOString());
        daily[dateKey] = point.value;
      });
    }
    chunkStart = chunkEnd;
  }

  return daily;
}

// Sums metric_type=total_value "views" over [start, end) by splitting into
// <=30-day sub-windows - Meta's hard cap for this metric+mode.
export async function fetchInstagramViewsTotalForRange(cfg, igUserId, start, end) {
  var MAX_CHUNK_MS = 30 * 24 * 60 * 60 * 1000;
  var total = 0;
  var gotAny = false;
  var chunkStart = new Date(start);

  while (chunkStart < end) {
    var chunkEnd = new Date(Math.min(chunkStart.getTime() + MAX_CHUNK_MS, end.getTime()));
    var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + igUserId +
      '/insights?metric=views&metric_type=total_value&period=day' +
      '&since=' + Math.floor(chunkStart.getTime() / 1000) +
      '&until=' + Math.floor(chunkEnd.getTime() / 1000) +
      '&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
    var data = await fetchJson(url);
    if (data.error) {
      console.log('Instagram views fetch failed for ' + isoDate(chunkStart) + '..' + isoDate(chunkEnd) + ': ' + JSON.stringify(data.error));
    } else {
      var totalValue = (data.data && data.data.length && data.data[0].total_value) ? data.data[0].total_value.value : null;
      if (typeof totalValue === 'number') { total += totalValue; gotAny = true; }
    }
    chunkStart = chunkEnd;
  }

  return gotAny ? total : null;
}
