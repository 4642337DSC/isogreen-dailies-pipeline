import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, requireConfig } from '../src/config.js';
import { fetchNotionRows } from '../src/notion.js';
import { syncThumbnails } from '../src/thumbnails.js';
import { fetchDashboardRows, fetchDashboardMonthlyViews, fetchDashboardFollowerSnapshots } from '../src/dashboard.js';
import { buildReport, buildReportsIndex } from '../src/reports.js';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var DIST_DIR = path.join(__dirname, '..', 'dist', 'clients', 'isogreen');

var ym = process.argv[2] || process.env.REPORT_MONTH;
if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
  throw new Error('Usage: node scripts/generate-report.js YYYY-MM');
}

var cfg = getConfig();
requireConfig(cfg);

// Only this month's rows need thumbnails fetched - the regular daily sync
// already keeps every other month's thumbnails published, this just needs
// to make sure the requested month's are present too.
var allRows = await fetchNotionRows(cfg);
var monthRows = allRows.filter(function (r) { return r.postDate && r.postDate.slice(0, 7) === ym; });

var thumbMap = {};
try { thumbMap = await syncThumbnails(cfg, monthRows, path.join(DIST_DIR, 'thumbs')); } catch (e) { console.log('Thumbnail sync failed: ' + e); }

var dashboardRows = await fetchDashboardRows(cfg, thumbMap);
var monthly = await fetchDashboardMonthlyViews(cfg);
var followerSnapshots = await fetchDashboardFollowerSnapshots(cfg);

await buildReport(cfg, { rows: dashboardRows, monthly: monthly, followerSnapshots: followerSnapshots }, DIST_DIR, ym);

// Rebuilds the index from whatever report folders exist on disk - the
// workflow seeds dist/clients/isogreen/reports/ with the already-published
// months before this script runs, so the rebuilt index covers both those
// and the one just generated.
await buildReportsIndex(DIST_DIR);
