import { getConfig } from '../src/config.js';
import { GRAPH_API_VERSION } from '../src/config.js';
import { fetchJson } from '../src/http.js';

// Temporary diagnostic (delete after use): probe a batch of Facebook Page
// insights metrics - current, older/paid-vs-organic breakdowns, and some
// that may be deprecated in this Graph API version - against a fixed 2024
// window, to see empirically whether ANY of them actually have historical
// data for this Page, before assuming page_video_views' lack of 2024 data
// is unrecoverable.
var cfg = getConfig();
if (!cfg.FB_PAGE_ID || !cfg.FB_PAGE_ACCESS_TOKEN) throw new Error('Set FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN first.');

var since = Math.floor(new Date('2024-06-01T00:00:00Z').getTime() / 1000);
var until = Math.floor(new Date('2024-06-30T00:00:00Z').getTime() / 1000);

var candidates = [
  'page_video_views',
  'page_video_views_organic',
  'page_video_views_paid',
  'page_video_views_autoplayed',
  'page_video_views_click_to_play',
  'page_video_views_by_paid_non_paid',
  'page_video_complete_views_30s',
  'page_video_complete_views_30s_organic',
  'page_video_complete_views_30s_paid',
  'page_video_complete_views_30s_autoplayed',
  'page_video_view_time',
  'page_impressions',
  'page_impressions_organic',
  'page_posts_impressions',
  'page_posts_impressions_organic'
];

for (var metric of candidates) {
  var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + cfg.FB_PAGE_ID +
    '/insights/' + metric + '?period=day&since=' + since + '&until=' + until +
    '&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;
  try {
    var data = await fetchJson(url);
    if (data.error) {
      console.log(metric + ': ERROR - ' + data.error.message);
      continue;
    }
    var series = (data.data && data.data.length) ? (data.data[0].values || []) : [];
    var sum = series.reduce(function (s, p) { return s + (typeof p.value === 'number' ? p.value : 0); }, 0);
    var nonZeroDays = series.filter(function (p) { return typeof p.value === 'number' && p.value > 0; }).length;
    console.log(metric + ': ' + series.length + ' day(s), sum=' + sum + ', non-zero days=' + nonZeroDays);
  } catch (e) {
    console.log(metric + ': EXCEPTION - ' + e);
  }
}
