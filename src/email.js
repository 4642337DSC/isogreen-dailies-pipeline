import nodemailer from 'nodemailer';
import { UNMATCHED_EMAIL_CAP } from './config.js';

export async function sendSummaryEmail(cfg, report) {
  var to = cfg.NOTIFY_EMAIL || cfg.GMAIL_USER;
  if (!to) return;
  if (!cfg.GMAIL_USER || !cfg.GMAIL_APP_PASSWORD) {
    console.log('GMAIL_USER/GMAIL_APP_PASSWORD not set - skipping summary email.');
    return;
  }

  var lines = [];
  var anythingToReport = false;

  [['YouTube', report.yt], ['Facebook', report.fb], ['Instagram', report.ig], ['TikTok', report.tt]].forEach(function (pair) {
    var label = pair[0], section = pair[1];
    if (!section) { lines.push(label + ': not configured, skipped.'); lines.push(''); return; }

    var newMatches = section.results.filter(function (r) { return r.isNewMatch; });
    lines.push(label + ' - updated ' + section.results.length + ' rows, ' +
      newMatches.length + ' newly matched, ' + section.unmatched.length + ' unmatched.');

    if (newMatches.length) {
      anythingToReport = true;
      newMatches.forEach(function (r) {
        var scoreLabel = (r.score === null || r.score === undefined) ? 'unverified' : ('score ' + r.score.toFixed(2));
        lines.push('  + "' + r.row.name + '" -> ' + (r.url || '(no link)') + ' (' + r.method + ', ' + scoreLabel + ')');
      });
    }
    if (section.unmatched.length) {
      anythingToReport = true;
      var shown = section.unmatched.slice(0, UNMATCHED_EMAIL_CAP);
      lines.push('  Unmatched (' + section.unmatched.length +
        (section.unmatched.length > UNMATCHED_EMAIL_CAP ? ', showing first ' + UNMATCHED_EMAIL_CAP : '') + '):');
      shown.forEach(function (r) { lines.push('    - ' + r.name); });
    }
    lines.push('');
  });

  if (!anythingToReport) return; // routine refresh only, nothing new to flag

  var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.GMAIL_USER, pass: cfg.GMAIL_APP_PASSWORD }
  });
  await transporter.sendMail({
    from: cfg.GMAIL_USER,
    to: to,
    subject: 'Views sync summary - ' + new Date().toDateString(),
    text: lines.join('\n')
  });
}
