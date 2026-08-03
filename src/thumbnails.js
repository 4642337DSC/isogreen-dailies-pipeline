import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchAllFacebookVideos } from './facebook.js';
import { fetchAllInstagramMedia } from './instagram.js';
import { matchContent, findById } from './notion.js';

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
export async function syncThumbnails(cfg, rows, thumbsDir) {
  await fs.mkdir(thumbsDir, { recursive: true });
  var map = {};
  var downloaded = 0;
  var noThumbnailSet = [];
  var metaFallback = 0;

  // Fallback for rows with no Notion Thumbnail at all: pull the matching
  // Facebook Reel's or Instagram post's own thumbnail image straight from
  // Meta and download it directly into dist/thumbs - this never touches
  // Notion, it's purely a build-time gap-filler. Only fetched if at least
  // one row actually needs it, and reuses the same date+text matching
  // (matchContent) already used to sync view counts.
  var needsFallback = rows.some(function (r) { return r.cod && !r.thumbnailUrl; });
  var fbVideos = null, igMedia = null;
  if (needsFallback && cfg.FB_PAGE_ID && cfg.FB_PAGE_ACCESS_TOKEN) {
    try { fbVideos = await fetchAllFacebookVideos(cfg); } catch (e) { console.log('Thumbnail fallback: Facebook fetch failed: ' + e); }
    try { igMedia = await fetchAllInstagramMedia(cfg); } catch (e) { console.log('Thumbnail fallback: Instagram fetch failed: ' + e); }
  }

  for (var row of rows) {
    if (!row.cod) continue;
    var sourceUrl = row.thumbnailUrl;
    var fromMeta = false;

    if (!sourceUrl && fbVideos) {
      var fbMatch = matchContent(row.postDate, row.text, fbVideos);
      var fbCandidate = fbMatch && findById(fbVideos, fbMatch.id);
      if (fbCandidate && fbCandidate.picture) { sourceUrl = fbCandidate.picture; fromMeta = true; }
    }
    if (!sourceUrl && igMedia) {
      var igMatch = matchContent(row.postDate, row.text, igMedia);
      var igCandidate = igMatch && findById(igMedia, igMatch.id);
      if (igCandidate && igCandidate.thumbnailUrl) { sourceUrl = igCandidate.thumbnailUrl; fromMeta = true; }
    }

    if (!sourceUrl) { noThumbnailSet.push(row.cod); continue; }
    try {
      var res = await fetch(sourceUrl);
      if (!res.ok) { console.log('Thumbnail fetch failed for ' + row.cod + ': HTTP ' + res.status); continue; }
      var contentType = res.headers.get('content-type') || '';
      var ext = extForContentType(contentType);
      var fileName = row.cod + ext;
      var buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(thumbsDir, fileName), buffer);
      map[row.cod] = 'thumbs/' + fileName;
      downloaded++;
      if (fromMeta) metaFallback++;
    } catch (e) { console.log('Thumbnail relay failed for ' + row.cod + ': ' + e); }
  }

  console.log('Thumbnails: downloaded ' + downloaded + ' file(s) into ' + thumbsDir + '.' +
    (metaFallback ? ' (' + metaFallback + ' via Facebook/Instagram fallback)' : ''));
  if (noThumbnailSet.length) {
    console.log('Thumbnails: no Notion Thumbnail and no Facebook/Instagram match for ' + noThumbnailSet.length + ' row(s): ' + noThumbnailSet.join(', '));
  }
  return map;
}
