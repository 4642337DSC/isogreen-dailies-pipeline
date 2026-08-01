export const SYNC_TIMEZONE = 'Europe/Bucharest';

// Equivalent of Apps Script's Utilities.formatDate(d, SYNC_TIMEZONE, 'yyyy-MM-dd').
export function isoDate(d) {
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYNC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  var map = {};
  parts.forEach(function (p) { map[p.type] = p.value; });
  return map.year + '-' + map.month + '-' + map.day;
}

export function dateKeyInTz(isoString) {
  return isoDate(new Date(isoString));
}

// Calendar months, oldest-to-newest, covering the last n months up through
// the current (partial, still in progress) one. Each entry's start/end are
// UTC-midnight boundaries suitable for since/until unix timestamps.
export function monthRangeBack(n) {
  var months = [];
  var cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  for (var i = 0; i < n; i++) {
    var start = new Date(cursor);
    var end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    var key = start.getUTCFullYear() + '-' + ('0' + (start.getUTCMonth() + 1)).slice(-2);
    months.unshift({ start: start, end: end, key: key });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return months;
}
