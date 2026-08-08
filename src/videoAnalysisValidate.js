import { getConfig } from './config.js';
import { queryNotionDatabase } from './notion.js';
import { fetchAllVideoRows } from './videoAnalysisNotion.js';

// Standard Spearman rank correlation with average ranks for ties. Returns
// null if there isn't enough variance/data to compute a meaningful number
// (fewer than 3 points, or one series is constant).
export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  var rx = rank(xs);
  var ry = rank(ys);
  var n = xs.length;
  var sumSqDiff = 0;
  for (var i = 0; i < n; i++) sumSqDiff += Math.pow(rx[i] - ry[i], 2);
  if (new Set(rx).size === 1 || new Set(ry).size === 1) return null;
  return 1 - (6 * sumSqDiff) / (n * (n * n - 1));
}

function rank(values) {
  var indexed = values.map(function (v, i) { return { v: v, i: i }; });
  indexed.sort(function (a, b) { return a.v - b.v; });
  var ranks = new Array(values.length);
  var i = 0;
  while (i < indexed.length) {
    var j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    var avgRank = (i + j) / 2 + 1; // 1-indexed, averaged across the tied block
    for (var k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

async function queryAll(cfg, databaseId, filter) {
  var results = [];
  var cursor = null;
  do {
    var payload = { page_size: 100 };
    if (filter) payload.filter = filter;
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, databaseId, payload);
    if (data.object === 'error') throw new Error('Notion query failed: ' + data.message);
    results.push.apply(results, data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

function numberProp(page, name) {
  var prop = page.properties[name];
  return prop && typeof prop.number === 'number' ? prop.number : null;
}

async function fetchScoresForVersion(cfg, pipelineVersion) {
  var pages = await queryAll(cfg, cfg.VIDEO_ANALYSIS_DATABASE_ID, {
    property: 'Pipeline Version',
    select: { equals: pipelineVersion }
  });
  return pages.map(function (page) {
    var relation = page.properties['Video'] && page.properties['Video'].relation;
    var videoPageId = relation && relation[0] ? relation[0].id : null;
    var hook = numberProp(page, 'Hook Score');
    var structure = numberProp(page, 'Structure Score');
    var format = numberProp(page, 'Format Score');
    var pacing = numberProp(page, 'Pacing Score');
    var cta = numberProp(page, 'CTA Score');
    var parts = [hook, structure, format, pacing, cta].filter(function (v) { return typeof v === 'number'; });
    var overall = parts.length ? parts.reduce(function (a, b) { return a + b; }, 0) / parts.length : null;
    return { videoPageId: videoPageId, hook: hook, overall: overall };
  }).filter(function (row) { return row.videoPageId; });
}

// Section 6 of the build plan: run both pipeline versions on the same set
// of videos, then compare Spearman ρ against views and retention (proxy for
// YT Hook Rate) for each. ρ(v2) >= ρ(v1) => ship v2; otherwise iterate on
// the extraction schema before abandoning the architecture.
export async function runValidation(options) {
  var cfg = getConfig();
  if (!cfg.NOTION_TOKEN || !cfg.NOTION_DATABASE_ID || !cfg.VIDEO_ANALYSIS_DATABASE_ID) {
    throw new Error('Set NOTION_TOKEN, NOTION_DATABASE_ID, VIDEO_ANALYSIS_DATABASE_ID first.');
  }
  var versionA = options.versionA || 'v1-gemini-only';
  var versionB = options.versionB || 'v2-gemini-claude';

  var videoRows = await fetchAllVideoRows(cfg);
  var performanceByPageId = {};
  videoRows.forEach(function (row) { performanceByPageId[row.pageId] = row; });

  var scoresA = await fetchScoresForVersion(cfg, versionA);
  var scoresB = await fetchScoresForVersion(cfg, versionB);

  var results = {};
  [[versionA, scoresA], [versionB, scoresB]].forEach(function (entry) {
    var version = entry[0];
    var scores = entry[1];
    var joined = scores
      .map(function (s) { return { score: s, perf: performanceByPageId[s.videoPageId] }; })
      .filter(function (j) { return j.perf; });

    var overallVsViews = spearman(
      joined.filter(function (j) { return typeof j.score.overall === 'number' && typeof j.perf.views === 'number'; }).map(function (j) { return j.score.overall; }),
      joined.filter(function (j) { return typeof j.score.overall === 'number' && typeof j.perf.views === 'number'; }).map(function (j) { return j.perf.views; })
    );
    var hookVsRetention = spearman(
      joined.filter(function (j) { return typeof j.score.hook === 'number' && typeof j.perf.retention === 'number'; }).map(function (j) { return j.score.hook; }),
      joined.filter(function (j) { return typeof j.score.hook === 'number' && typeof j.perf.retention === 'number'; }).map(function (j) { return j.perf.retention; })
    );

    results[version] = { sampleSize: joined.length, overallVsViews: overallVsViews, hookVsRetention: hookVsRetention };
  });

  console.log('Video analysis A/B validation (' + versionA + ' vs ' + versionB + '):');
  Object.keys(results).forEach(function (version) {
    var r = results[version];
    console.log('  ' + version + ' (n=' + r.sampleSize + '): overall-vs-views ρ=' + fmt(r.overallVsViews) + ', hook-vs-retention ρ=' + fmt(r.hookVsRetention));
  });

  return results;
}

function fmt(rho) {
  return rho === null ? 'n/a (not enough data)' : rho.toFixed(3);
}

if (import.meta.url === 'file://' + process.argv[1]) {
  runValidation({}).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
