import fs from 'node:fs/promises';
import path from 'node:path';

// Notion's Thumbnail file property only exposes a signed S3 URL that expires
// ~1hr after this script reads it via the real Notion API - not fetchable by
// anything else later. So every run re-downloads each row's thumbnail
// straight into dist/thumbs/<cod>.<ext>, which then gets FTP-deployed
// alongside the dashboard HTML. No Drive relay, no incremental "skip if
// already uploaded" bookkeeping - re-downloading the current (small) set of
// thumbnails fresh every run is simpler and still cheap.
function extForContentType(contentType) {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  return '.jpg'; // covers image/jpeg and any unrecognized type
}

// Returns a map of Cod -> relative thumbnail path (e.g. "thumbs/AB12.jpg")
// for use in the dashboard rows, and writes the files into thumbsDir.
export async function syncThumbnails(rows, thumbsDir) {
  await fs.mkdir(thumbsDir, { recursive: true });
  var map = {};
  var downloaded = 0;
  var noThumbnailSet = [];

  for (var row of rows) {
    if (!row.cod) continue;
    if (!row.thumbnailUrl) { noThumbnailSet.push(row.cod); continue; }
    try {
      var res = await fetch(row.thumbnailUrl);
      if (!res.ok) { console.log('Thumbnail fetch failed for ' + row.cod + ': HTTP ' + res.status); continue; }
      var contentType = res.headers.get('content-type') || '';
      var ext = extForContentType(contentType);
      var fileName = row.cod + ext;
      var buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(thumbsDir, fileName), buffer);
      map[row.cod] = 'thumbs/' + fileName;
      downloaded++;
    } catch (e) { console.log('Thumbnail relay failed for ' + row.cod + ': ' + e); }
  }

  console.log('Thumbnails: downloaded ' + downloaded + ' file(s) into ' + thumbsDir + '.');
  if (noThumbnailSet.length) {
    console.log('Thumbnails: no "Thumbnail" file set in Notion for ' + noThumbnailSet.length + ' row(s): ' + noThumbnailSet.join(', '));
  }
  return map;
}
