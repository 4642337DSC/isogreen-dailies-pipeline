import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardRow, renderClientLinks } from './dashboard.js';

function page(props) {
  return { properties: props };
}

test('buildDashboardRow reads view counts from cfg-configured field names', () => {
  var cfg = {
    YT_FIELD_NAME: 'V7Z - Yt Shorts',
    FB_FIELD_NAME: 'V7Z - Fb',
    IG_FIELD_NAME: 'V7Z - Insta',
    TT_FIELD_NAME: 'V7Z - TikTok'
  };
  var p = page({
    'Data Postare': { date: { start: '2026-08-01' } },
    'Name': { title: [{ plain_text: 'Test Short' }] },
    'Cod': { rich_text: [{ plain_text: 'M001' }] },
    'Instagram URL': { url: 'https://instagram.com/p/x' },
    'YouTube URL': null,
    'Facebook URL': null,
    'TikTok URL': null,
    'V7Z - Yt Shorts': { number: 10 },
    'V7Z - Fb': { number: 20 },
    'V7Z - Insta': { number: 30 },
    'V7Z - TikTok': { number: 40 },
    'Transcript': { rich_text: [{ plain_text: 'hello' }] }
  });

  var row = buildDashboardRow(cfg, p, { M001: 'thumb.jpg' });

  assert.deepEqual(row, [
    'Test Short', 'M001', 10, 20, 30, 40,
    '2026-08-01', 'https://instagram.com/p/x', 'hello', 'thumb.jpg'
  ]);
});

test('buildDashboardRow returns null when there is no post date', () => {
  var cfg = { YT_FIELD_NAME: 'YouTube', FB_FIELD_NAME: 'Facebook', IG_FIELD_NAME: 'Instagram', TT_FIELD_NAME: 'TikTok' };
  var p = page({
    'Data Postare': { date: null },
    'Name': { title: [] },
    'Cod': { rich_text: [] }
  });

  assert.equal(buildDashboardRow(cfg, p, {}), null);
});

test('renderClientLinks renders one link per slug, sorted, label uppercased', () => {
  var html = renderClientLinks(['miradex', 'isogreen']);

  assert.equal(
    html,
    '      <li><a href="/clients/isogreen/">ISOGREEN</a></li>\n' +
    '      <li><a href="/clients/miradex/">MIRADEX</a></li>'
  );
});
