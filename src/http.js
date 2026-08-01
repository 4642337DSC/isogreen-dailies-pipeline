// Thin fetch wrapper mirroring the UrlFetchApp({ muteHttpExceptions: true })
// pattern used throughout the original Apps Script code: never throws on a
// non-2xx response, always returns { status, text, json() }.
export async function fetchText(url, options) {
  var res = await fetch(url, options);
  var text = await res.text();
  return {
    status: res.status,
    text: text,
    json: function () { return text ? JSON.parse(text) : null; }
  };
}

export async function fetchJson(url, options) {
  var res = await fetchText(url, options);
  return res.json();
}
