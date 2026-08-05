import fs from 'node:fs/promises';
import path from 'node:path';

async function loadFontFace() {
  var templatePath = new URL('../templates/DashboardTemplate.html', import.meta.url);
  var dashboardHtml = await fs.readFile(templatePath, 'utf8');
  var match = dashboardHtml.match(/@font-face\s*\{[\s\S]*?\}/);
  return match ? match[0] : '';
}

// Copies the shared brand assets (assets/report/*) into
// dist/clients/<client>/reports/assets/ - a plain file copy, not embedded
// as base64, since these are static images shared by the one report page
// rather than something that needs to travel inside a portable HTML file
// (unlike the font, which is spliced in from DashboardTemplate.html).
// Upfilm's own logo is shared by every client; the left badge is each
// client's own logo, expected at assets/report/<slug>-logo.(svg|png) - not
// every client has supplied one yet, so this returns the HTML for that
// badge (an <img> tag, or '' to leave it empty) rather than assuming the
// file exists. Both extensions are tried since clients supply logos in
// whatever format they have on hand (Isogreen: svg, Miradex: a
// background-removed png).
var CLIENT_LOGO_EXTENSIONS = ['svg', 'png'];

async function copyReportAssets(cfg, outDir) {
  var assetsDir = path.join(outDir, 'reports', 'assets');
  await fs.mkdir(assetsDir, { recursive: true });
  var srcDir = new URL('../assets/report/', import.meta.url);
  await fs.copyFile(new URL('upfilm-logo-transparent.png', srcDir), path.join(assetsDir, 'upfilm-logo-transparent.png'));

  for (var ext of CLIENT_LOGO_EXTENSIONS) {
    var clientLogoFile = cfg.CLIENT_SLUG + '-logo.' + ext;
    try {
      await fs.copyFile(new URL(clientLogoFile, srcDir), path.join(assetsDir, clientLogoFile));
      return '<img src="assets/' + clientLogoFile + '" alt="' + cfg.CLIENT_NAME + '">';
    } catch (e) { /* try the next extension */ }
  }
  console.log('No report logo for client "' + cfg.CLIENT_SLUG + '" (expected assets/report/' + cfg.CLIENT_SLUG + '-logo.{svg,png}) - left badge left empty.');
  return '';
}

// Builds the single Reports app page
// (dist/clients/<client>/reports/index.html) - a self-contained page that
// embeds every month's data (same rows/monthly/followerSnapshots
// buildDashboard already fetched) plus a year/month picker, and renders
// the report entirely client-side when a month is selected. Rebuilt on
// every sync, same as the dashboard itself - it's just one lightweight
// data-embedding page, not a per-month pre-render, so there's nothing to
// overwrite or go stale between syncs.
export async function buildReportsApp(cfg, data, outDir) {
  var clientLogoBadge = await copyReportAssets(cfg, outDir);
  var fontFace = await loadFontFace();
  var templatePath = new URL('../templates/ReportTemplate.html', import.meta.url);
  var template = await fs.readFile(templatePath, 'utf8');

  var html = template
    .replace('/*__FONT_FACE__*/', fontFace)
    .replace('/*__RAW_DATA__*/', JSON.stringify(data.rows))
    .replace('/*__MONTHLY_VIEWS_DATA__*/', JSON.stringify(data.monthly))
    .replace('/*__FOLLOWER_SNAPSHOTS_DATA__*/', JSON.stringify(data.followerSnapshots))
    .replace('/*__CLIENT_LOGO_BADGE__*/', clientLogoBadge)
    .split('__CLIENT_NAME__').join(cfg.CLIENT_NAME);

  var reportsDir = path.join(outDir, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'index.html'), html, 'utf8');
  console.log('Reports app written to ' + path.join(reportsDir, 'index.html'));
}
