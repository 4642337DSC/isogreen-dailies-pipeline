import fs from 'node:fs/promises';
import path from 'node:path';

var MONTH_NAMES_RO = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'
];

var PLATFORM_META = {
  fb: { label: 'Facebook', color: 'var(--p-fb)' },
  ig: { label: 'Instagram', color: 'var(--p-ig)' },
  tt: { label: 'TikTok', color: 'var(--p-tt)' },
  yt: { label: 'YouTube', color: 'var(--p-yt)' }
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtFull(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '—';
}

// Latest snapshot value at or before dateKey ("YYYY-MM-DD"), or null if the
// series has nothing that far back - used to compute follower deltas
// across a month boundary from FOLLOWER_SNAPSHOTS' sparse daily data.
function snapshotOnOrBefore(series, dateKey) {
  var best = null, bestKey = null;
  Object.keys(series || {}).forEach(function (d) {
    if (d <= dateKey && (!bestKey || d > bestKey)) { bestKey = d; best = series[d]; }
  });
  return best;
}

function lastDayOfMonth(ym) {
  var year = parseInt(ym.slice(0, 4), 10);
  var month = parseInt(ym.slice(5, 7), 10);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function firstDayOfMonth(ym) {
  return ym + '-01';
}

function dayBefore(dateKey) {
  var d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Groups the dashboard's positional RAW rows ([name, cod, yt, fb, ig, tt,
// postDate, link, transcript, thumb]) by "Data Postare" month.
function groupRowsByMonth(rows) {
  var byMonth = {};
  rows.forEach(function (r) {
    var ym = r[6] ? r[6].slice(0, 7) : null;
    if (!ym) return;
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(r);
  });
  return byMonth;
}

function buildVideoRowsHtml(monthRows) {
  var sorted = monthRows.slice().sort(function (a, b) { return a[6] < b[6] ? -1 : a[6] > b[6] ? 1 : 0; });
  return sorted.map(function (r) {
    var yt = r[2], fb = r[3], ig = r[4], tt = r[5];
    var total = (yt || 0) + (fb || 0) + (ig || 0) + (tt || 0);
    return '<tr>' +
      '<td>' + escapeHtml(r[1]) + '</td>' +
      '<td class="name-cell">' + escapeHtml(r[0]) + '</td>' +
      '<td>' + escapeHtml(r[6]) + '</td>' +
      '<td>' + fmtFull(fb) + '</td>' +
      '<td>' + fmtFull(ig) + '</td>' +
      '<td>' + fmtFull(tt) + '</td>' +
      '<td>' + fmtFull(yt) + '</td>' +
      '<td class="total-cell">' + fmtFull(total) + '</td>' +
      '</tr>';
  }).join('\n');
}

// Real monthly totals for YouTube/Facebook/Instagram (from each platform's
// own Analytics/Insights API, same source as the dashboard's Monthly
// Breakdown); TikTok has no monthly-capable API at all, so it's estimated
// by summing that month's posted videos' current view counts instead -
// same convention already used elsewhere in this pipeline for TikTok gaps.
function buildNetworkViewsHtml(ym, monthRows, monthly) {
  var ttEstimate = monthRows.reduce(function (sum, r) { return sum + (r[5] || 0); }, 0);
  var values = {
    fb: monthly.fb && typeof monthly.fb[ym] === 'number' ? monthly.fb[ym] : null,
    ig: monthly.ig && typeof monthly.ig[ym] === 'number' ? monthly.ig[ym] : null,
    tt: ttEstimate,
    yt: monthly.yt && typeof monthly.yt[ym] === 'number' ? monthly.yt[ym] : null
  };
  return ['tt', 'yt', 'fb', 'ig'].map(function (key) {
    var meta = PLATFORM_META[key];
    // TikTok has no monthly-capable API at all - shown as an editable
    // number (pre-filled with the estimate) so it can be corrected with a
    // real figure before generating the PDF, per-report, without needing
    // a backend to persist it. Browsers print an <input>'s current value
    // by default, so no separate print-only element is needed.
    var valueHtml = key === 'tt'
      ? '<input class="stat-input" type="number" value="' + (values.tt == null ? '' : values.tt) + '" aria-label="TikTok views (editable)">'
      : '<div class="stat-value">' + fmtFull(values[key]) + '</div>';
    return '<div class="stat-item">' +
      '<div class="stat-badge" style="background:' + meta.color + '">' + meta.label.slice(0, 2).toUpperCase() + '</div>' +
      '<div>' + valueHtml + '</div>' +
      '</div>';
  }).join('\n');
}

// End-of-month follower count per platform, with the change vs. the end of
// the previous month where both endpoints have real snapshot data.
function buildFollowerStatsHtml(ym, followerSnapshots) {
  var monthEnd = lastDayOfMonth(ym);
  var prevMonthEnd = dayBefore(firstDayOfMonth(ym));
  return ['tt', 'yt', 'fb', 'ig'].map(function (key) {
    var meta = PLATFORM_META[key];
    var series = followerSnapshots[key] || {};
    var endVal = snapshotOnOrBefore(series, monthEnd);
    var startVal = snapshotOnOrBefore(series, prevMonthEnd);
    var deltaHtml = '';
    if (typeof endVal === 'number' && typeof startVal === 'number') {
      var delta = endVal - startVal;
      deltaHtml = '<span class="stat-delta">(' + (delta >= 0 ? '+' : '') + delta.toLocaleString('en-US') + ')</span>';
    }
    return '<div class="stat-item">' +
      '<div class="stat-badge" style="background:' + meta.color + '">' + meta.label.slice(0, 2).toUpperCase() + '</div>' +
      '<div><div class="stat-value">' + fmtFull(endVal) + deltaHtml + '</div></div>' +
      '</div>';
  }).join('\n');
}

async function loadFontFace() {
  var templatePath = new URL('../templates/DashboardTemplate.html', import.meta.url);
  var dashboardHtml = await fs.readFile(templatePath, 'utf8');
  var match = dashboardHtml.match(/@font-face\s*\{[\s\S]*?\}/);
  return match ? match[0] : '';
}

// Builds one static report page per calendar month that has posted
// content (dist/clients/isogreen/reports/<YYYY-MM>/index.html), plus an
// index page listing all of them - reuses the same data buildDashboard
// already fetched (see its return value) rather than re-querying Notion.
export async function buildReports(cfg, data, outDir) {
  var fontFace = await loadFontFace();
  var reportTemplatePath = new URL('../templates/ReportTemplate.html', import.meta.url);
  var reportTemplate = await fs.readFile(reportTemplatePath, 'utf8');
  var indexTemplatePath = new URL('../templates/ReportsIndexTemplate.html', import.meta.url);
  var indexTemplate = await fs.readFile(indexTemplatePath, 'utf8');

  var byMonth = groupRowsByMonth(data.rows);
  var months = Object.keys(byMonth).sort().reverse();
  var reportsDir = path.join(outDir, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });

  for (var ym of months) {
    var monthRows = byMonth[ym];
    var year = ym.slice(0, 4);
    var monthIdx = parseInt(ym.slice(5, 7), 10) - 1;
    var cod = ym.slice(2, 4) + '-' + ym.slice(5, 7);

    var html = reportTemplate
      .replace('/*__FONT_FACE__*/', fontFace)
      .split('__COD__').join(cod)
      .split('__CLIENT_NAME__').join('ISOGREEN')
      .split('__MONTH_LABEL__').join(MONTH_NAMES_RO[monthIdx] + ' ' + year)
      .split('__MONTH_NAME_RO__').join(MONTH_NAMES_RO[monthIdx])
      .replace('/*__VIDEO_ROWS_HTML__*/', buildVideoRowsHtml(monthRows))
      .replace('/*__NETWORK_VIEWS_HTML__*/', buildNetworkViewsHtml(ym, monthRows, data.monthly))
      .replace('/*__FOLLOWER_STATS_HTML__*/', buildFollowerStatsHtml(ym, data.followerSnapshots))
      .split('__DASHBOARD_LINK__').join('/clients/isogreen/');

    var monthDir = path.join(reportsDir, ym);
    await fs.mkdir(monthDir, { recursive: true });
    await fs.writeFile(path.join(monthDir, 'index.html'), html, 'utf8');
  }

  var linksHtml = months.map(function (ym) {
    var year = ym.slice(0, 4);
    var monthIdx = parseInt(ym.slice(5, 7), 10) - 1;
    return '<li><a href="./' + ym + '/"><span>' + MONTH_NAMES_RO[monthIdx] + ' ' + year + '</span><span class="arrow">→</span></a></li>';
  }).join('\n');

  var indexHtml = indexTemplate
    .replace('/*__FONT_FACE__*/', fontFace)
    .split('__CLIENT_NAME__').join('ISOGREEN')
    .replace('/*__REPORT_LINKS_HTML__*/', linksHtml);
  await fs.writeFile(path.join(reportsDir, 'index.html'), indexHtml, 'utf8');

  console.log('Reports written for ' + months.length + ' month(s) into ' + reportsDir);
}
