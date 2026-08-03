import { fetchJson } from './http.js';
import { matchContent, buildPlatformReport } from './notion.js';

export async function resolveUploadsPlaylistId(cfg) {
  var url = 'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=' +
    encodeURIComponent(cfg.CHANNEL_HANDLE) + '&key=' + cfg.YOUTUBE_API_KEY;
  var data = await fetchJson(url);
  if (!data.items || !data.items.length) {
    throw new Error('Could not resolve channel "' + cfg.CHANNEL_HANDLE + '": ' + JSON.stringify(data));
  }
  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

export async function fetchAllYouTubeVideos(cfg) {
  var uploadsId = await resolveUploadsPlaylistId(cfg);
  var videos = [];
  var pageToken = '';
  do {
    var url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' +
      uploadsId + '&key=' + cfg.YOUTUBE_API_KEY + (pageToken ? '&pageToken=' + pageToken : '');
    var data = await fetchJson(url);
    (data.items || []).forEach(function (item) {
      var sn = item.snippet;
      if (!sn || !sn.resourceId) return;
      videos.push({
        id: sn.resourceId.videoId,
        text: sn.description || sn.title || '',
        publishedAt: sn.publishedAt
      });
    });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return videos;
}

export async function fetchYouTubeViewCounts(cfg, videoIds) {
  var unique = videoIds.filter(function (id, i) { return videoIds.indexOf(id) === i; });
  var stats = {};
  for (var i = 0; i < unique.length; i += 50) {
    var batch = unique.slice(i, i + 50);
    var url = 'https://www.googleapis.com/youtube/v3/videos?part=statistics&id=' +
      batch.join(',') + '&key=' + cfg.YOUTUBE_API_KEY;
    var data = await fetchJson(url);
    (data.items || []).forEach(function (item) {
      stats[item.id] = parseInt(item.statistics.viewCount, 10);
    });
  }
  return stats;
}

export function extractYouTubeId(url) {
  var m = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export async function syncYouTube(cfg, rows) {
  var videos = await fetchAllYouTubeVideos(cfg);
  var plan = [];
  var idsNeeded = [];

  rows.forEach(function (row) {
    if (row.youtubeUrl) {
      var cachedId = extractYouTubeId(row.youtubeUrl);
      if (cachedId) {
        plan.push({ row: row, id: cachedId, isNewMatch: false, method: 'cached', score: null });
        idsNeeded.push(cachedId);
        return;
      }
    }
    var m = matchContent(row.postDate, row.text, videos);
    if (m) {
      plan.push({ row: row, id: m.id, isNewMatch: true, method: m.method, score: m.score });
      idsNeeded.push(m.id);
    }
  });

  var stats = await fetchYouTubeViewCounts(cfg, idsNeeded);
  var results = [];
  plan.forEach(function (p) {
    var views = stats[p.id];
    if (views === undefined) return;
    results.push({
      row: p.row, views: views, isNewMatch: p.isNewMatch, method: p.method, score: p.score,
      url: p.isNewMatch ? ('https://www.youtube.com/watch?v=' + p.id) : null
    });
  });

  return buildPlatformReport(rows, results);
}
