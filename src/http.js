// Thin fetch wrapper mirroring the UrlFetchApp({ muteHttpExceptions: true })
// pattern used throughout the original Apps Script code: never throws on a
// non-2xx response, always returns { status, text, json() }.
export async function fetchText(url, options) {
  var res = await fetch(url, options);
  var text = await res.text();
  return {
    status: res.status,
    text: text,
    headers: res.headers,
    json: function () { return text ? JSON.parse(text) : null; }
  };
}

export async function fetchJson(url, options) {
  var res = await fetchText(url, options);
  return res.json();
}

// Meta's Graph API (facebook.js/instagram.js) occasionally returns a
// generic transient error - code 1 "An unknown error occurred" and code 2
// "Service temporarily unavailable" are Meta's own documented catch-alls
// for exactly this - not a real problem with the request, just a flaky
// response. Every call site that throws on data.error used to take that
// down as an unhandled crash of the *entire* client's sync (confirmed
// live: 28 minutes of otherwise-successful work lost to one flaky
// response mid-pagination). This retries those specific codes with a
// short backoff before giving up; every other error (bad token, missing
// permission, etc.) still returns immediately since retrying won't fix it.
var TRANSIENT_META_ERROR_CODES = [1, 2];

export async function fetchGraphJson(url, options, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    var data = await fetchJson(url, options);
    var transient = data && data.error && TRANSIENT_META_ERROR_CODES.indexOf(data.error.code) !== -1;
    if (!transient || attempt === maxAttempts) return data;
    await new Promise(function (resolve) { setTimeout(resolve, attempt * 1500); });
  }
}
