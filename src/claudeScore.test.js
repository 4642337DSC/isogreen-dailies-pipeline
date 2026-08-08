import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoringPrompt } from './claudeScore.js';

test('buildScoringPrompt() substitutes all placeholders', () => {
  var prompt = buildScoringPrompt({
    brandContext: 'ISOGREEN sells heat pumps.',
    performance: { views: 1000, channel_baseline: { avg_views: 500 } },
    videoId: 'vid_1',
    rawExtraction: { video_id: 'vid_1', duration_seconds: 10 }
  });

  assert.ok(prompt.includes('ISOGREEN sells heat pumps.'));
  assert.ok(prompt.includes('"views": 1000'));
  assert.ok(prompt.includes('vid_1'));
  assert.ok(prompt.includes('"duration_seconds": 10'));
  assert.equal(prompt.includes('{{'), false);
});

test('buildScoringPrompt() falls back to a placeholder when brand context is empty', () => {
  var prompt = buildScoringPrompt({
    performance: {},
    videoId: 'vid_2',
    rawExtraction: { video_id: 'vid_2' }
  });
  assert.ok(prompt.includes('(none provided)'));
});
