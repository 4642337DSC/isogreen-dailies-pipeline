import fs from 'node:fs/promises';
import path from 'node:path';
import { queryNotionDatabase, richTextToString, buildShortsFilter } from './notion.js';
import { isoDate } from './util.js';

// "YouTube"/"Facebook"/"Instagram"/"TikTok" (as stored in the Channel Stats
// and Monthly Views databases) -> the short keys the dashboard template uses.
export function platformKey(platformName) {
  switch (platformName) {
    case 'YouTube': return 'yt';
    case 'Facebook': return 'fb';
    case 'Instagram': return 'ig';
    case 'TikTok': return 'tt';
    default: return null;
  }
}

export function buildDashboardRow(cfg, page, thumbMap) {
  var props = page.properties;
  var postDate = props['Data Postare'] && props['Data Postare'].date ? props['Data Postare'].date.start : null;
  if (!postDate) return null; // dashboard places every short in time - skip anything without a post date
  var name = (props['Name'].title || []).map(function (t) { return t.plain_text; }).join('').trim();
  var cod = richTextToString(props['Cod']);
  var igLink = props['Instagram URL'] ? props['Instagram URL'].url : null;
  var ytLink = props['YouTube URL'] ? props['YouTube URL'].url : null;
  var fbLink = props['Facebook URL'] ? props['Facebook URL'].url : null;
  var ttLink = props['TikTok URL'] ? props['TikTok URL'].url : null;
  var link = igLink || ytLink || fbLink || ttLink || null;
  return [
    name,
    cod,
    props[cfg.YT_FIELD_NAME].number,
    props[cfg.FB_FIELD_NAME].number,
    props[cfg.IG_FIELD_NAME].number,
    props[cfg.TT_FIELD_NAME].number,
    postDate,
    link,
    richTextToString(props['Transcript']) || null,
    thumbMap[cod] || null
  ];
}

// Reads the fields the dashboard needs (view counts, per-platform URLs,
// transcript) that the sync path's parseNotionRow doesn't - kept separate
// so the sync path isn't carrying fields it never uses.
export async function fetchDashboardRows(cfg, thumbMap) {
  var out = [];
  var cursor = null;
  do {
    var payload = {
      page_size: 100,
      filter: buildShortsFilter(cfg)
    };
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, cfg.NOTION_DATABASE_ID, payload);
    if (data.object === 'error') throw new Error('Notion query failed: ' + data.message);
    (data.results || []).forEach(function (page) {
      var row = buildDashboardRow(cfg, page, thumbMap);
      if (row) out.push(row);
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  out.sort(function (a, b) { return a[6] < b[6] ? -1 : a[6] > b[6] ? 1 : 0; }); // ascending by post date
  return out;
}

export async function fetchDashboardAudience(cfg) {
  var audience = {};
  if (!cfg.CHANNEL_STATS_DATABASE_ID) return audience;
  var data = await queryNotionDatabase(cfg, cfg.CHANNEL_STATS_DATABASE_ID, { page_size: 20 });
  if (data.object === 'error') return audience;
  (data.results || []).forEach(function (page) {
    var platform = (page.properties['Platform'].title || []).map(function (t) { return t.plain_text; }).join('');
    var key = platformKey(platform);
    if (!key) return;
    audience[key] = { followers: page.properties['Followers'] ? page.properties['Followers'].number : null };
  });
  return audience;
}

export async function fetchDashboardMonthlyViews(cfg) {
  var monthly = { yt: {}, fb: {}, ig: {}, tt: {} };
  if (!cfg.MONTHLY_VIEWS_DATABASE_ID) return monthly;
  var cursor = null;
  do {
    var payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, cfg.MONTHLY_VIEWS_DATABASE_ID, payload);
    if (data.object === 'error') throw new Error('Monthly Views query failed: ' + data.message);
    (data.results || []).forEach(function (page) {
      var props = page.properties;
      var key = platformKey(props['Platform'] && props['Platform'].select ? props['Platform'].select.name : null);
      var monthStart = props['Month'] && props['Month'].date ? props['Month'].date.start : null;
      var views = props['Views'] ? props['Views'].number : null;
      if (!key || !monthStart || typeof views !== 'number') return;
      monthly[key][monthStart.slice(0, 7)] = views;
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return monthly;
}

export async function fetchDashboardDailyViews(cfg) {
  var daily = { yt: {}, fb: {}, ig: {} };
  if (!cfg.DAILY_VIEWS_DATABASE_ID) return daily;
  var cursor = null;
  do {
    var payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, cfg.DAILY_VIEWS_DATABASE_ID, payload);
    if (data.object === 'error') throw new Error('Daily Views query failed: ' + data.message);
    (data.results || []).forEach(function (page) {
      var props = page.properties;
      var key = platformKey(props['Platform'] && props['Platform'].select ? props['Platform'].select.name : null);
      var dateStart = props['Date'] && props['Date'].date ? props['Date'].date.start : null;
      var views = props['Views'] ? props['Views'].number : null;
      if (!key || !daily[key] || !dateStart || typeof views !== 'number') return;
      daily[key][dateStart.slice(0, 10)] = views;
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return daily;
}

export async function fetchDashboardFollowerSnapshots(cfg) {
  var daily = { yt: {}, fb: {}, ig: {}, tt: {} };
  if (!cfg.FOLLOWER_SNAPSHOTS_DATABASE_ID) return daily;
  var cursor = null;
  do {
    var payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, cfg.FOLLOWER_SNAPSHOTS_DATABASE_ID, payload);
    if (data.object === 'error') throw new Error('Follower Snapshots query failed: ' + data.message);
    (data.results || []).forEach(function (page) {
      var props = page.properties;
      var key = platformKey(props['Platform'] && props['Platform'].select ? props['Platform'].select.name : null);
      var dateStart = props['Date'] && props['Date'].date ? props['Date'].date.start : null;
      var followers = props['Followers'] ? props['Followers'].number : null;
      if (!key || !dateStart || typeof followers !== 'number') return;
      daily[key][dateStart.slice(0, 10)] = followers;
    });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return daily;
}

// Builds the dashboard from templates/DashboardTemplate.html (a
// self-contained page - CSS + markup + client-side JS - with a handful of
// token placeholders) and writes the merged result straight to
// dist/clients/isogreen/index.html as a plain static file. Unlike posting
// through WordPress's content field, a static file never passes through
// wpautop/kses, so the embedded <script> block and its JSON payload survive
// intact.
export async function buildDashboard(cfg, thumbMap, outDir) {
  var rows = await fetchDashboardRows(cfg, thumbMap);
  var audience = await fetchDashboardAudience(cfg);
  var monthly = await fetchDashboardMonthlyViews(cfg);
  var daily = await fetchDashboardDailyViews(cfg);
  var followerSnapshots = await fetchDashboardFollowerSnapshots(cfg);

  var templatePath = new URL('../templates/DashboardTemplate.html', import.meta.url);
  var html = await fs.readFile(templatePath, 'utf8');
  html = html
    .replace('/*__RAW_DATA__*/', JSON.stringify(rows))
    .replace('/*__AUDIENCE_DATA__*/', JSON.stringify(audience))
    .replace('/*__MONTHLY_VIEWS_DATA__*/', JSON.stringify(monthly))
    .replace('/*__DAILY_VIEWS_DATA__*/', JSON.stringify(daily))
    .replace('/*__FOLLOWER_SNAPSHOTS_DATA__*/', JSON.stringify(followerSnapshots))
    .replace('__LAST_SYNCED__', isoDate(new Date()))
    .split('__CLIENT_NAME__').join(cfg.CLIENT_NAME);

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  console.log('Dashboard written to ' + path.join(outDir, 'index.html'));

  // Returned so callers (src/reports.js, via sync.js) can reuse this same
  // fetched data instead of re-querying Notion for the same rows/stats.
  return { rows: rows, audience: audience, monthly: monthly, daily: daily, followerSnapshots: followerSnapshots };
}

// Static picker page at /clients/ listing every client dashboard - no
// per-client data, just a plain copy since it barely ever changes (adding a
// client is a code change anyway, given each one needs its own Notion
// databases and platform credentials wired up).
export async function buildClientsIndex(clientsDir) {
  var templatePath = new URL('../templates/ClientsIndex.html', import.meta.url);
  var html = await fs.readFile(templatePath, 'utf8');
  await fs.mkdir(clientsDir, { recursive: true });
  await fs.writeFile(path.join(clientsDir, 'index.html'), html, 'utf8');
  console.log('Clients index written to ' + path.join(clientsDir, 'index.html'));
}
