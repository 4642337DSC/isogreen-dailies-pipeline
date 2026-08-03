import { fetchJson } from './http.js';
import { NOTION_VERSION, TEXT_MATCH_THRESHOLD, TEXT_MARGIN } from './config.js';
import { dateKeyInTz } from './util.js';

function notionHeaders(cfg) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + cfg.NOTION_TOKEN,
    'Notion-Version': NOTION_VERSION
  };
}

export async function fetchNotionRows(cfg) {
  var rows = [];
  var cursor = null;
  do {
    var payload = {
      page_size: 100,
      filter: {
        and: [
          { property: 'Tip', multi_select: { contains: 'Short' } },
          { property: 'Postat?', checkbox: { equals: true } }
        ]
      }
    };
    if (cursor) payload.start_cursor = cursor;
    var data = await fetchJson('https://api.notion.com/v1/databases/' + cfg.NOTION_DATABASE_ID + '/query', {
      method: 'POST',
      headers: notionHeaders(cfg),
      body: JSON.stringify(payload)
    });
    if (data.object === 'error') throw new Error('Notion query failed: ' + data.message);
    (data.results || []).forEach(function (page) { rows.push(parseNotionRow(page)); });
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rows;
}

export function parseNotionRow(page) {
  var props = page.properties;
  var name = (props['Name'].title || []).map(function (t) { return t.plain_text; }).join('');
  var cod = richTextToString(props['Cod']); // "Cod" is a plain text (rich_text) property, same shape as "Text"
  var text = richTextToString(props['Text']);
  var dateStart = props['Data Postare'] && props['Data Postare'].date ? props['Data Postare'].date.start : null;
  var youtubeUrl = props['YouTube URL'] ? props['YouTube URL'].url : null;
  var tiktokUrl = props['TikTok URL'] ? props['TikTok URL'].url : null;
  var thumbnailUrl = extractThumbnailUrl(props['Thumbnail']);
  return { pageId: page.id, name: name, cod: cod, text: text, postDate: dateStart, youtubeUrl: youtubeUrl, tiktokUrl: tiktokUrl, thumbnailUrl: thumbnailUrl };
}

export function extractThumbnailUrl(prop) {
  if (!prop || !prop.files || !prop.files.length) return null;
  var f = prop.files[0];
  if (f.type === 'external' && f.external) return f.external.url;
  if (f.type === 'file' && f.file) return f.file.url;
  return null;
}

export function richTextToString(prop) {
  if (!prop || !prop.rich_text) return '';
  return prop.rich_text.map(function (t) { return t.plain_text; }).join('');
}

export async function updateNotionPage(cfg, pageId, properties) {
  await fetchJson('https://api.notion.com/v1/pages/' + pageId, {
    method: 'PATCH',
    headers: notionHeaders(cfg),
    body: JSON.stringify({ properties: properties })
  });
}

export async function createNotionPage(cfg, databaseId, properties) {
  await fetchJson('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(cfg),
    body: JSON.stringify({ parent: { database_id: databaseId }, properties: properties })
  });
}

export async function queryNotionDatabase(cfg, databaseId, payload) {
  return fetchJson('https://api.notion.com/v1/databases/' + databaseId + '/query', {
    method: 'POST',
    headers: notionHeaders(cfg),
    body: JSON.stringify(payload || { page_size: 100 })
  });
}

// Upserts one row per { "YYYY-MM": views } entry into MONTHLY_VIEWS_DATABASE_ID.
// Shared by every platform's monthly sync (youtube/facebook/instagram/tiktok).
export async function writeMonthlyViews(cfg, platform, source, monthlyMap) {
  for (var monthKey of Object.keys(monthlyMap)) {
    var views = monthlyMap[monthKey];
    var monthStart = monthKey + '-01';
    var existingId = await findMonthlyViewsRow(cfg, platform, monthStart);
    var props = {
      'Label': { title: [{ text: { content: platform + ' · ' + monthKey } }] },
      'Platform': { select: { name: platform } },
      'Month': { date: { start: monthStart } },
      'Views': { number: views },
      'Source': { select: { name: source } },
      'Synced At': { date: { start: new Date().toISOString() } }
    };
    if (existingId) {
      await updateNotionPage(cfg, existingId, props);
    } else {
      await createNotionPage(cfg, cfg.MONTHLY_VIEWS_DATABASE_ID, props);
    }
  }
}

export async function findMonthlyViewsRow(cfg, platform, monthStart) {
  var data = await queryNotionDatabase(cfg, cfg.MONTHLY_VIEWS_DATABASE_ID, {
    filter: {
      and: [
        { property: 'Platform', select: { equals: platform } },
        { property: 'Month', date: { equals: monthStart } }
      ]
    },
    page_size: 1
  });
  if (data.object === 'error' || !data.results || !data.results.length) return null;
  return data.results[0].id;
}

// Day-grained sibling of writeMonthlyViews/findMonthlyViewsRow, writing to
// DAILY_VIEWS_DATABASE_ID instead - powers the dashboard's custom date-range
// "Total views" KPI with real per-day numbers instead of a post-date-filtered
// lifetime-total estimate. See src/dailyViews.js.
export async function writeDailyViews(cfg, platform, source, dailyMap) {
  for (var dateKey of Object.keys(dailyMap)) {
    var views = dailyMap[dateKey];
    var existingId = await findDailyViewsRow(cfg, platform, dateKey);
    var props = {
      'Label': { title: [{ text: { content: platform + ' · ' + dateKey } }] },
      'Platform': { select: { name: platform } },
      'Date': { date: { start: dateKey } },
      'Views': { number: views },
      'Source': { select: { name: source } },
      'Synced At': { date: { start: new Date().toISOString() } }
    };
    if (existingId) {
      await updateNotionPage(cfg, existingId, props);
    } else {
      await createNotionPage(cfg, cfg.DAILY_VIEWS_DATABASE_ID, props);
    }
  }
}

export async function findDailyViewsRow(cfg, platform, dateKey) {
  var data = await queryNotionDatabase(cfg, cfg.DAILY_VIEWS_DATABASE_ID, {
    filter: {
      and: [
        { property: 'Platform', select: { equals: platform } },
        { property: 'Date', date: { equals: dateKey } }
      ]
    },
    page_size: 1
  });
  if (data.object === 'error' || !data.results || !data.results.length) return null;
  return data.results[0].id;
}

// ===== Matching (shared across platforms) =====
// Primary key: "Data Postare" vs the post's publish date (same calendar day
// in SYNC_TIMEZONE, with a +-1 day fallback). Among same-day candidates, the
// platform caption/description must roughly match the Notion "Text"
// property to confirm/disambiguate - a date match alone is only trusted
// when it's the sole candidate for that day.

export function matchContent(postDate, rowText, candidates) {
  if (!postDate) return null;

  var dated = candidatesForDate(postDate, candidates, 0);
  if (!dated.length) dated = candidatesForDate(postDate, candidates, 1);
  if (!dated.length) return null;

  var target = normalize(rowText);
  if (target) {
    var ranked = rankBySimilarity(target, dated, function (c) { return normalize(c.text); });
    if (ranked.length && ranked[0].score >= TEXT_MATCH_THRESHOLD &&
        (ranked.length === 1 || ranked[0].score - ranked[1].score >= TEXT_MARGIN)) {
      return { id: ranked[0].item.id, method: 'date+text', score: ranked[0].score };
    }
    return null; // candidates existed but none matched the Text property well enough
  }

  if (dated.length === 1) {
    return { id: dated[0].id, method: 'date-only (no Text to verify)', score: null };
  }
  return null;
}

function candidatesForDate(postDate, candidates, dayTolerance) {
  var targetMs = new Date(dateKeyInTz(postDate) + 'T00:00:00').getTime();
  return candidates.filter(function (c) {
    var ms = new Date(dateKeyInTz(c.publishedAt) + 'T00:00:00').getTime();
    var diffDays = Math.round(Math.abs(ms - targetMs) / 86400000);
    return diffDays <= dayTolerance;
  });
}

function rankBySimilarity(target, candidates, getText) {
  return candidates
    .map(function (item) { return { item: item, score: diceCoefficient(target, getText(item)) }; })
    .sort(function (a, b) { return b.score - a.score; });
}

export function findById(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function normalize(s) {
  if (!s) return '';
  var map = { 'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ş': 's', 'ț': 't', 'ţ': 't' };
  return s.toLowerCase().replace(/[ăâîșşțţ]/g, function (c) { return map[c]; })
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s) {
  var grams = [];
  for (var i = 0; i < s.length - 1; i++) grams.push(s.substring(i, i + 2));
  return grams;
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  var A = bigrams(a);
  var B = bigrams(b).slice();
  if (!A.length || !B.length) return 0;
  var totalLength = A.length + B.length; // capture before B gets mutated below
  var matches = 0;
  A.forEach(function (g) {
    var idx = B.indexOf(g);
    if (idx !== -1) { matches++; B.splice(idx, 1); }
  });
  return (2 * matches) / totalLength;
}

// ===== Cross-platform report/write helpers =====

export function buildPlatformReport(rows, results) {
  var matchedPageIds = {};
  results.forEach(function (r) { matchedPageIds[r.row.pageId] = true; });
  var unmatched = rows.filter(function (row) { return !matchedPageIds[row.pageId]; });
  return { results: results, unmatched: unmatched };
}

export async function writeUpdates(cfg, rows, yt, fb, ig, tt) {
  var byPage = {};
  function entryFor(row) {
    if (!byPage[row.pageId]) byPage[row.pageId] = {};
    return byPage[row.pageId];
  }

  yt.results.forEach(function (r) {
    var props = entryFor(r.row);
    props['YouTube'] = { number: r.views };
    if (r.url) props['YouTube URL'] = { url: r.url };
  });
  if (fb) {
    fb.results.forEach(function (r) {
      var props = entryFor(r.row);
      props['Facebook'] = { number: r.views };
      if (r.url) props['Facebook URL'] = { url: r.url };
    });
  }
  if (ig) {
    ig.results.forEach(function (r) {
      var props = entryFor(r.row);
      props['Instagram'] = { number: r.views };
      if (r.url) props['Instagram URL'] = { url: r.url };
    });
  }
  if (tt) {
    tt.results.forEach(function (r) {
      var props = entryFor(r.row);
      props['TikTok'] = { number: r.views };
    });
  }

  for (var pageId of Object.keys(byPage)) {
    await updateNotionPage(cfg, pageId, byPage[pageId]);
  }
}
