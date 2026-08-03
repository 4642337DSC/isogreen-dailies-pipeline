import { getConfig, NOTION_VERSION } from '../src/config.js';
import { fetchJson } from '../src/http.js';

// One-time setup: creates the "Daily Views" Notion database (channel-level
// per-day view totals, feeding the dashboard's custom date-range "Total
// views" KPI with real numbers instead of post-date-filtered lifetime
// totals - see src/dailyViews.js). Nests it alongside the existing
// "Monthly Views" database (same parent page), so it inherits the same
// integration access without needing a new page to be shared manually.
//
// Run once via the "Manual backfill" GitHub Action
// (script=create-daily-views-db), then save the printed ID as
// DAILY_VIEWS_DATABASE_ID (repo secret + local .env). Safe to re-run - it
// just creates another database each time, so don't run it twice.
var cfg = getConfig();
if (!cfg.NOTION_TOKEN) throw new Error('Set NOTION_TOKEN first.');
if (!cfg.MONTHLY_VIEWS_DATABASE_ID) throw new Error('Set MONTHLY_VIEWS_DATABASE_ID first - the new database is nested alongside it.');

var headers = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer ' + cfg.NOTION_TOKEN,
  'Notion-Version': NOTION_VERSION
};

var existing = await fetchJson('https://api.notion.com/v1/databases/' + cfg.MONTHLY_VIEWS_DATABASE_ID, { headers: headers });
if (existing.object === 'error') throw new Error('Could not read the Monthly Views database: ' + existing.message);
console.log('Monthly Views parent: ' + JSON.stringify(existing.parent));

var body = {
  parent: existing.parent,
  icon: { type: 'emoji', emoji: '📆' },
  title: [{ type: 'text', text: { content: 'Daily Views' } }],
  properties: {
    Label: { title: {} },
    Date: { date: {} },
    Platform: {
      select: {
        options: [
          { name: 'YouTube', color: 'red' },
          { name: 'Facebook', color: 'blue' },
          { name: 'Instagram', color: 'pink' }
        ]
      }
    },
    Source: { select: {} },
    Views: { number: {} },
    'Synced At': { date: {} }
  }
};

var created = await fetchJson('https://api.notion.com/v1/databases', {
  method: 'POST',
  headers: headers,
  body: JSON.stringify(body)
});

if (created.object === 'error') {
  console.error('Database creation failed: ' + created.message);
  console.error('If this is a permissions error, share the parent page with the Notion integration used for NOTION_TOKEN (Notion: "..." -> Connections on that page), then re-run.');
  process.exitCode = 1;
} else {
  console.log('Created "Daily Views" database.');
  console.log('DAILY_VIEWS_DATABASE_ID=' + created.id);
}
