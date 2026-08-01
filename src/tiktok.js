import { fetchJson } from './http.js';
import { buildPlatformReport, queryNotionDatabase, updateNotionPage, createNotionPage, writeMonthlyViews } from './notion.js';
import { isoDate } from './util.js';

// TikTok has no listing API for pre-existing posts (Zernio's /posts edge only
// tracks content posted through Zernio itself), so there's no date+text
// auto-matching here - each row needs its "TikTok URL" pasted in manually
// once, and the script just re-fetches that video's view count every run.
export function extractTikTokId(url) {
  var m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

export async function fetchTikTokViewCount(cfg, videoId) {
  var url = 'https://zernio.com/api/v1/analytics?postId=' + videoId + '&accountId=' + cfg.ZERNIO_TIKTOK_ACCOUNT_ID;
  var data = await fetchJson(url, { headers: { Authorization: 'Bearer ' + cfg.ZERNIO_API_KEY } });
  if (!data.analytics || typeof data.analytics.views !== 'number') return null;
  return data.analytics.views;
}

export async function syncTikTok(cfg, rows) {
  var results = [];
  for (var row of rows) {
    if (!row.tiktokUrl) continue;
    var videoId = extractTikTokId(row.tiktokUrl);
    if (!videoId) continue;
    var views = await fetchTikTokViewCount(cfg, videoId);
    if (views === null) continue;
    results.push({ row: row, views: views, isNewMatch: false, method: 'manual-url', score: null, url: null });
  }
  return buildPlatformReport(rows, results);
}

// --- TikTok: no historical views API exists, so we snapshot today's total
// and derive monthly deltas from accumulated snapshots instead of asking
// any endpoint for "views in April". ---
export async function syncTikTokSnapshotAndMonthly(cfg, ttResult) {
  var totalViews = ttResult.results.reduce(function (sum, r) { return sum + (r.views || 0); }, 0);
  var todayKey = isoDate(new Date());
  await upsertTikTokSnapshot(cfg, todayKey, totalViews, ttResult.results.length);

  var snapshots = await fetchTikTokSnapshots(cfg);
  var monthly = deriveMonthlyDeltasFromSnapshots(snapshots);
  if (Object.keys(monthly).length) await writeMonthlyViews(cfg, 'TikTok', 'tiktok-zernio', monthly);
}

export async function upsertTikTokSnapshot(cfg, dateKey, totalViews, videoCount) {
  var data = await queryNotionDatabase(cfg, cfg.TIKTOK_SNAPSHOT_DATABASE_ID, {
    filter: { property: 'Date', date: { equals: dateKey } },
    page_size: 1
  });
  var existingId = (data.object !== 'error' && data.results && data.results.length) ? data.results[0].id : null;

  var props = {
    'Label': { title: [{ text: { content: 'TikTok · ' + dateKey } }] },
    'Date': { date: { start: dateKey } },
    'Total Views': { number: totalViews },
    'Video Count': { number: videoCount },
    'Synced At': { date: { start: new Date().toISOString() } }
  };
  if (existingId) {
    await updateNotionPage(cfg, existingId, props);
  } else {
    await createNotionPage(cfg, cfg.TIKTOK_SNAPSHOT_DATABASE_ID, props);
  }
}

export async function fetchTikTokSnapshots(cfg) {
  var snapshots = [];
  var cursor = null;
  do {
    var payload = { page_size: 100, sorts: [{ property: 'Date', direction: 'ascending' }] };
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, cfg.TIKTOK_SNAPSHOT_DATABASE_ID, payload);
    if (data.object === 'error') throw new Error('TikTok snapshot query failed: ' + data.message);
    (data.results || []).forEach(function (page) {
      var props = page.properties;
      var d = props['Date'] && props['Date'].date ? props['Date'].date.start : null;
      var v = props['Total Views'] ? props['Total Views'].number : null;
      if (d && typeof v === 'number') snapshots.push({ date: d, views: v });
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return snapshots;
}

// Monthly TikTok views = (last known total that month) - (last known total
// the month before). Only emits months that have a prior month's baseline
// to diff against, so the very first snapshot month is always skipped.
export function deriveMonthlyDeltasFromSnapshots(snapshots) {
  if (snapshots.length < 2) return {};
  var lastByMonth = {};
  snapshots.forEach(function (s) { lastByMonth[s.date.slice(0, 7)] = s.views; });
  var months = Object.keys(lastByMonth).sort();
  var monthly = {};
  for (var i = 1; i < months.length; i++) {
    monthly[months[i]] = Math.max(0, lastByMonth[months[i]] - lastByMonth[months[i - 1]]);
  }
  return monthly;
}
