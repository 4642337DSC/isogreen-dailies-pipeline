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

// Same hand-authored icon markup as templates/DashboardTemplate.html's
// PLATFORM_ICON_SVG - duplicated here because this file renders HTML
// strings server-side at build time rather than through the dashboard's
// client-side JS. The Instagram icon's gradient fill (id="igGrad") is
// defined once in ReportTemplate.html's body, same as the dashboard.
var PLATFORM_ICON_SVG = {
  yt: '<svg viewBox="0 0 24 24"><rect x="1" y="5" width="22" height="14" rx="4" fill="var(--p-yt)"/><path d="M10 9.2l6.2 2.8-6.2 2.8z" fill="#fff"/></svg>',
  fb: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="var(--p-fb)"/><path d="M13.8 8.6h-1.2c-.4 0-.7.3-.7.8v1.4h1.9l-.3 1.9h-1.6V19h-2V12.7H8.3v-1.9h1.6V9.2c0-1.5.9-2.5 2.4-2.5h1.5v1.9z" fill="#fff"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="6" fill="url(#igGrad)"/><rect x="6" y="6" width="12" height="12" rx="4" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="16.3" cy="7.7" r="1.1" fill="#fff"/></svg>',
  tt: '<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="6" fill="var(--p-tt)"/><path d="M14.6 5v9.3a3.4 3.4 0 1 1-2.4-3.2V8.5a5.4 5.4 0 1 0 4.3 5.3v-4.1c.9.6 2 1 3.1 1V8.1a3.2 3.2 0 0 1-3.1-3.1h-1.9z" fill="#fff"/></svg>'
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtFull(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '—';
}

// Latest snapshot date+value at or before dateKey ("YYYY-MM-DD"), or nulls
// if the series has nothing that far back - used to compute follower
// deltas across a month boundary from FOLLOWER_SNAPSHOTS' sparse daily
// data.
function snapshotOnOrBefore(series, dateKey) {
  var best = null, bestKey = null;
  Object.keys(series || {}).forEach(function (d) {
    if (d <= dateKey && (!bestKey || d > bestKey)) { bestKey = d; best = series[d]; }
  });
  return { date: bestKey, value: best };
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
    // r[9] is "thumbs/<cod>.<ext>" relative to dist/clients/isogreen/ - the
    // report page lives two levels below that (reports/<ym>/index.html),
    // so it needs an extra "../.." to reach the shared thumbs folder.
    var thumbHtml = r[9]
      ? '<img class="thumb" src="../../' + r[9] + '" alt="" loading="lazy">'
      : '<div class="thumb thumb-empty"></div>';
    return '<tr>' +
      '<td class="thumb-cell">' + thumbHtml + '</td>' +
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
      '<div class="stat-badge" style="background:' + meta.color + '">' + PLATFORM_ICON_SVG[key] + '</div>' +
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
    var end = snapshotOnOrBefore(series, monthEnd);
    var start = snapshotOnOrBefore(series, prevMonthEnd);
    // Platforms with limited snapshot history (Instagram's ~30-day API
    // window, or any platform whose tracking simply started partway
    // through the dataset) often have nothing at or before the previous
    // month's end - fall back to the EARLIEST snapshot available at all so
    // a delta still shows ("growth since tracking began") instead of
    // silently showing nothing, as long as that's a genuinely different
    // data point than the end-of-month value.
    if (start.value === null) {
      var dates = Object.keys(series).sort();
      if (dates.length) start = { date: dates[0], value: series[dates[0]] };
    }
    var deltaHtml = '';
    if (typeof end.value === 'number' && typeof start.value === 'number' && start.date !== end.date) {
      var delta = end.value - start.value;
      deltaHtml = '<span class="stat-delta">(' + (delta >= 0 ? '+' : '') + delta.toLocaleString('en-US') + ')</span>';
    }
    return '<div class="stat-item">' +
      '<div class="stat-badge" style="background:' + meta.color + '">' + PLATFORM_ICON_SVG[key] + '</div>' +
      '<div><div class="stat-value">' + fmtFull(end.value) + deltaHtml + '</div></div>' +
      '</div>';
  }).join('\n');
}

async function loadFontFace() {
  var templatePath = new URL('../templates/DashboardTemplate.html', import.meta.url);
  var dashboardHtml = await fs.readFile(templatePath, 'utf8');
  var match = dashboardHtml.match(/@font-face\s*\{[\s\S]*?\}/);
  return match ? match[0] : '';
}

// Copies the shared logo/background assets (assets/report/*) into
// dist/clients/isogreen/reports/assets/ - a plain file copy, not embedded
// as base64, since these are static brand assets shared by every report
// page rather than something that needs to travel inside a single portable
// HTML file (unlike the font, which is spliced in from DashboardTemplate.html).
async function copyReportAssets(outDir) {
  var assetsDir = path.join(outDir, 'reports', 'assets');
  await fs.mkdir(assetsDir, { recursive: true });
  var srcDir = new URL('../assets/report/', import.meta.url);
  await fs.copyFile(new URL('logo.png', srcDir), path.join(assetsDir, 'logo.png'));
  await fs.copyFile(new URL('background.jpg', srcDir), path.join(assetsDir, 'background.jpg'));
}

// Builds a single month's static report page
// (dist/clients/isogreen/reports/<YYYY-MM>/index.html). Called on demand
// from scripts/generate-report.js via the "Generate report" GitHub Actions
// workflow - NOT automatically on every daily sync, since reports are
// reviewed/edited (TikTok figure, comments) by hand before being printed,
// so regenerating all of them every day has no value and would overwrite
// any edits made directly on a previously-generated page.
export async function buildReport(cfg, data, outDir, ym) {
  await copyReportAssets(outDir);
  var fontFace = await loadFontFace();
  var reportTemplatePath = new URL('../templates/ReportTemplate.html', import.meta.url);
  var reportTemplate = await fs.readFile(reportTemplatePath, 'utf8');

  var byMonth = groupRowsByMonth(data.rows);
  var monthRows = byMonth[ym] || [];
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

  var monthDir = path.join(outDir, 'reports', ym);
  await fs.mkdir(monthDir, { recursive: true });
  await fs.writeFile(path.join(monthDir, 'index.html'), html, 'utf8');
  console.log('Report written for ' + ym + ' into ' + monthDir);
}

// Rebuilds the reports index page by listing whatever <YYYY-MM> report
// folders currently exist on disk under outDir/reports, rather than from
// the full dataset - since reports are now generated one at a time, "which
// months have a report" is a filesystem fact, not something derivable from
// Notion. The generate-report workflow seeds outDir/reports/ with the
// already-published months before calling this, so the rebuilt index
// covers both old and newly-generated reports.
export async function buildReportsIndex(outDir) {
  var reportsDir = path.join(outDir, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  var entries = await fs.readdir(reportsDir, { withFileTypes: true });
  var months = entries
    .filter(function (e) { return e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name); })
    .map(function (e) { return e.name; })
    .sort()
    .reverse();

  var fontFace = await loadFontFace();
  var indexTemplatePath = new URL('../templates/ReportsIndexTemplate.html', import.meta.url);
  var indexTemplate = await fs.readFile(indexTemplatePath, 'utf8');

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
  console.log('Reports index written for ' + months.length + ' month(s).');
}
