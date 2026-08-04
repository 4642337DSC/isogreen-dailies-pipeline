import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from './config.js';

test('getConfig defaults client identity to Isogreen when env is unset', () => {
  delete process.env.CLIENT_SLUG;
  delete process.env.CLIENT_NAME;
  delete process.env.NOTION_FILTER_TIP;
  delete process.env.YT_FIELD_NAME;
  delete process.env.FB_FIELD_NAME;
  delete process.env.IG_FIELD_NAME;
  delete process.env.TT_FIELD_NAME;

  var cfg = getConfig();

  assert.equal(cfg.CLIENT_SLUG, 'isogreen');
  assert.equal(cfg.CLIENT_NAME, 'ISOGREEN');
  assert.equal(cfg.NOTION_FILTER_TIP, true);
  assert.equal(cfg.YT_FIELD_NAME, 'YouTube');
  assert.equal(cfg.FB_FIELD_NAME, 'Facebook');
  assert.equal(cfg.IG_FIELD_NAME, 'Instagram');
  assert.equal(cfg.TT_FIELD_NAME, 'TikTok');
});

test('getConfig picks up client overrides from env', () => {
  process.env.CLIENT_SLUG = 'miradex';
  process.env.CLIENT_NAME = 'MIRADEX';
  process.env.NOTION_FILTER_TIP = 'false';
  process.env.YT_FIELD_NAME = 'V7Z - Yt Shorts';

  var cfg = getConfig();

  assert.equal(cfg.CLIENT_SLUG, 'miradex');
  assert.equal(cfg.CLIENT_NAME, 'MIRADEX');
  assert.equal(cfg.NOTION_FILTER_TIP, false);
  assert.equal(cfg.YT_FIELD_NAME, 'V7Z - Yt Shorts');

  delete process.env.CLIENT_SLUG;
  delete process.env.CLIENT_NAME;
  delete process.env.NOTION_FILTER_TIP;
  delete process.env.YT_FIELD_NAME;
});
