import { fetchJson } from './http.js';
import { GRAPH_API_VERSION } from './config.js';
import { queryNotionDatabase, updateNotionPage } from './notion.js';
import { resolveInstagramUserId } from './instagram.js';

// Account-level follower/subscriber counts (not per-video) - written to a
// separate small "Channel Stats" database, since the main Video database is
// keyed per-Short. Reuses the same platform credentials already configured
// elsewhere; skips silently per-platform if that platform isn't configured.
export async function syncAudience(cfg) {
  if (!cfg.CHANNEL_STATS_DATABASE_ID) return;
  var stats = {};

  try {
    var chData = await fetchJson(
      'https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=' +
      encodeURIComponent(cfg.CHANNEL_HANDLE) + '&key=' + cfg.YOUTUBE_API_KEY);
    if (chData.items && chData.items.length) {
      stats.YouTube = {
        followers: parseInt(chData.items[0].statistics.subscriberCount, 10),
        totalViews: parseInt(chData.items[0].statistics.viewCount, 10)
      };
    }
  } catch (e) { console.log('YouTube audience fetch failed: ' + e); }

  if (cfg.FB_PAGE_ID && cfg.FB_PAGE_ACCESS_TOKEN) {
    try {
      var fbData = await fetchJson(
        'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + cfg.FB_PAGE_ID +
        '?fields=followers_count&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN);
      if (fbData.followers_count !== undefined) stats.Facebook = { followers: fbData.followers_count };
    } catch (e) { console.log('Facebook audience fetch failed: ' + e); }

    try {
      var igUserId = await resolveInstagramUserId(cfg);
      var igData = await fetchJson(
        'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + igUserId +
        '?fields=followers_count&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN);
      if (igData.followers_count !== undefined) stats.Instagram = { followers: igData.followers_count };
    } catch (e) { console.log('Instagram audience fetch failed: ' + e); }
  }

  if (cfg.ZERNIO_API_KEY && cfg.ZERNIO_TIKTOK_ACCOUNT_ID) {
    try {
      var ttData = await fetchJson('https://zernio.com/api/v1/accounts', {
        headers: { Authorization: 'Bearer ' + cfg.ZERNIO_API_KEY }
      });
      var acct = (ttData.accounts || []).filter(function (a) { return a._id === cfg.ZERNIO_TIKTOK_ACCOUNT_ID; })[0];
      if (acct && acct.followersCount !== undefined) stats.TikTok = { followers: acct.followersCount };
    } catch (e) { console.log('TikTok audience fetch failed: ' + e); }
  }

  await writeAudienceStats(cfg, stats);
}

export async function writeAudienceStats(cfg, stats) {
  var data = await queryNotionDatabase(cfg, cfg.CHANNEL_STATS_DATABASE_ID, { page_size: 20 });
  if (data.object === 'error') { console.log('Channel Stats query failed: ' + data.message); return; }

  for (var page of (data.results || [])) {
    var platform = (page.properties['Platform'].title || []).map(function (t) { return t.plain_text; }).join('');
    var s = stats[platform];
    if (!s) continue;
    var props = {
      'Followers': { number: s.followers },
      'Updated At': { date: { start: new Date().toISOString() } }
    };
    if (s.totalViews !== undefined) props['Total Channel Views'] = { number: s.totalViews };
    await updateNotionPage(cfg, page.id, props);
  }
}
