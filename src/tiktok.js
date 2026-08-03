import { fetchJson } from './http.js';
import { buildPlatformReport } from './notion.js';

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
