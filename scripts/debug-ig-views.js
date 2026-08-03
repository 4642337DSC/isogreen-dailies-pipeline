import { getConfig, GRAPH_API_VERSION } from '../src/config.js';
import { fetchJson } from '../src/http.js';
import { resolveInstagramUserId } from '../src/instagram.js';

// Temporary diagnostic: dump the raw Instagram "views" total_value response
// for January 2025, to see whether Meta genuinely returns 0 or something
// else is going on (the per-video sync shows real, non-zero January 2025
// views on individual posts, so the account-level aggregate reading 0 for
// that month is suspicious).
var cfg = getConfig();
var igUserId = await resolveInstagramUserId(cfg);

var since = Math.floor(Date.UTC(2025, 0, 1) / 1000);
var until = Math.floor(Date.UTC(2025, 0, 31) / 1000);
var url = 'https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + igUserId +
  '/insights?metric=views&metric_type=total_value&period=day' +
  '&since=' + since + '&until=' + until +
  '&access_token=' + cfg.FB_PAGE_ACCESS_TOKEN;

console.log('URL (token redacted): ' + url.replace(cfg.FB_PAGE_ACCESS_TOKEN, 'REDACTED'));
var data = await fetchJson(url);
console.log('Raw response: ' + JSON.stringify(data, null, 2));
