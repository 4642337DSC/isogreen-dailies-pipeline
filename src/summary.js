import fs from 'node:fs/promises';
import { UNMATCHED_SUMMARY_CAP } from './config.js';

// Writes the sync report to the GitHub Actions run summary (visible on the
// Actions tab for that run) instead of sending an email - no SMTP
// credentials needed. Falls back to a plain console.log when run locally
// (GITHUB_STEP_SUMMARY is only set inside Actions).
export async function writeSyncSummary(report) {
  var lines = ['## Views sync summary - ' + new Date().toDateString(), ''];

  [['YouTube', report.yt], ['Facebook', report.fb], ['Instagram', report.ig], ['TikTok', report.tt]].forEach(function (pair) {
    var label = pair[0], section = pair[1];
    if (!section) { lines.push('- **' + label + '**: not configured, skipped.'); return; }

    var newMatches = section.results.filter(function (r) { return r.isNewMatch; });
    lines.push('- **' + label + '**: updated ' + section.results.length + ' rows, ' +
      newMatches.length + ' newly matched, ' + section.unmatched.length + ' unmatched.');

    if (newMatches.length) {
      newMatches.forEach(function (r) {
        var scoreLabel = (r.score === null || r.score === undefined) ? 'unverified' : ('score ' + r.score.toFixed(2));
        lines.push('  - + "' + r.row.name + '" -> ' + (r.url || '(no link)') + ' (' + r.method + ', ' + scoreLabel + ')');
      });
    }
    if (section.unmatched.length) {
      var shown = section.unmatched.slice(0, UNMATCHED_SUMMARY_CAP);
      lines.push('  - Unmatched (' + section.unmatched.length +
        (section.unmatched.length > UNMATCHED_SUMMARY_CAP ? ', showing first ' + UNMATCHED_SUMMARY_CAP : '') + '):');
      shown.forEach(function (r) { lines.push('    - ' + r.name); });
    }
  });

  var text = lines.join('\n');
  console.log(text);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  }
}
