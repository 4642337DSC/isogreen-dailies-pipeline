import { getConfig, NOTION_VERSION } from '../src/config.js';
import { fetchJson } from '../src/http.js';

// One-time setup: creates the "Follower Snapshots" Notion database (one
// immutable row per platform per day, capturing follower/subscriber counts
// over time - see src/audience.js). Unlike view counts, no platform exposes
// a historical follower-count API, so there's no backfill script for this -
// it can only start capturing from whenever this database first exists.
// Nests it alongside the existing "Monthly Views" database (same parent
// page), so it inherits the same integration access.
//
// Run once via the "Manual backfill" GitHub Action
// (script=create-follower-snapshots-db), then save the printed ID as
// FOLLOWER_SNAPSHOTS_DATABASE_ID (repo secret + local .env). Safe to
// re-run - it just creates another database each time, so don't run it twice.
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

// The create-database endpoint only accepts a page_id/database_id/workspace
// parent - not block_id. Walk up the block's own parent chain until we hit
// something the API will accept (same quirk hit by
// backfill-create-daily-views-db.js).
var parent = existing.parent;
while (parent.type === 'block_id') {
  var block = await fetchJson('https://api.notion.com/v1/blocks/' + parent.block_id, { headers: headers });
  if (block.object === 'error') throw new Error('Could not resolve parent block: ' + block.message);
  console.log('Resolved block parent: ' + JSON.stringify(block.parent));
  parent = block.parent;
}

var body = {
  parent: parent,
  icon: { type: 'emoji', emoji: '📈' },
  title: [{ type: 'text', text: { content: 'Follower Snapshots' } }],
  properties: {
    Label: { title: {} },
    Date: { date: {} },
    Platform: {
      select: {
        options: [
          { name: 'YouTube', color: 'red' },
          { name: 'Facebook', color: 'blue' },
          { name: 'Instagram', color: 'pink' },
          { name: 'TikTok', color: 'default' }
        ]
      }
    },
    Followers: { number: {} },
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
  console.log('Created "Follower Snapshots" database.');
  console.log('FOLLOWER_SNAPSHOTS_DATABASE_ID=' + created.id);
}
