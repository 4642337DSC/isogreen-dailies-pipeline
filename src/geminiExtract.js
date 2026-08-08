import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText } from './http.js';
import { loadSchema, toGeminiSchema, validate } from './videoAnalysisSchema.js';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
var CACHE_DIR = path.join(__dirname, '..', 'cache');

var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
// Kept on the same model used for the validated ρ=0.55 baseline - this
// migration changes the pipeline architecture, not the extraction model, so
// the two aren't conflated in the A/B validation (see videoAnalysisValidate.js).
var GEMINI_MODEL = 'gemini-2.5-flash';

var MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v'
};

function extractionPrompt() {
  return fs.readFileSync(path.join(PROMPTS_DIR, 'videoAnalysisGeminiExtraction.txt'), 'utf8');
}

function cachePath(videoId) {
  return path.join(CACHE_DIR, videoId + '_raw.json');
}

export function readCachedExtraction(videoId) {
  var p = cachePath(videoId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeCachedExtraction(videoId, extraction) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(videoId), JSON.stringify(extraction, null, 2));
}

function mimeTypeFor(filePath) {
  var ext = path.extname(filePath).toLowerCase();
  var mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error('Unsupported video file extension "' + ext + '" for ' + filePath + ' - add it to MIME_BY_EXT if Gemini supports it.');
  return mime;
}

// Gemini's Files API resumable upload protocol: an initial "start" request
// returns an upload URL (in the x-goog-upload-url response header), then the
// bytes are PUT to that URL with "upload, finalize" to complete it in one
// shot. Whole-file-in-memory is fine here - these are short-form videos, not
// long-form uploads.
async function uploadVideoFile(cfg, filePath, displayName) {
  var mimeType = mimeTypeFor(filePath);
  var bytes = fs.readFileSync(filePath);

  var start = await fetchText(GEMINI_API_BASE + '/upload/v1beta/files?key=' + cfg.GEMINI_API_KEY, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: displayName } })
  });
  var uploadUrl = start.headers ? start.headers.get('x-goog-upload-url') : null;
  if (!uploadUrl) throw new Error('Gemini upload start failed (no upload URL returned): ' + start.text);

  var upload = await fetchText(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: bytes
  });
  var uploaded = upload.json();
  if (!uploaded || !uploaded.file) throw new Error('Gemini upload finalize failed: ' + upload.text);
  return uploaded.file;
}

async function waitForFileActive(cfg, fileName, maxAttempts, delayMs) {
  maxAttempts = maxAttempts || 30;
  delayMs = delayMs || 2000;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    var res = await fetchText(GEMINI_API_BASE + '/v1beta/' + fileName + '?key=' + cfg.GEMINI_API_KEY, { method: 'GET' });
    var file = res.json();
    if (!file) throw new Error('Gemini file status check failed: ' + res.text);
    if (file.state === 'ACTIVE') return file;
    if (file.state === 'FAILED') throw new Error('Gemini failed to process uploaded video: ' + JSON.stringify(file.error || file));
    await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
  }
  throw new Error('Gemini file never became ACTIVE after ' + maxAttempts + ' polling attempts.');
}

async function callGenerateContent(cfg, fileUri, mimeType, videoId) {
  var schema = toGeminiSchema(loadSchema('videoAnalysisRawExtraction'));
  var body = {
    contents: [{
      parts: [
        { fileData: { fileUri: fileUri, mimeType: mimeType } },
        { text: extractionPrompt() + '\n\nvideo_id: ' + videoId }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };
  var res = await fetchText(
    GEMINI_API_BASE + '/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + cfg.GEMINI_API_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  var data = res.json();
  if (!data || !data.candidates || !data.candidates[0]) {
    throw new Error('Gemini generateContent returned no candidates: ' + res.text);
  }
  var text = data.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Gemini response was not valid JSON: ' + err.message + '\n' + text);
  }
  return parsed;
}

// Stage 1: video file -> raw_extraction.json, cached to disk per video_id so
// re-running the pipeline (or re-scoring in Stage 2 later) never re-pays for
// Gemini video tokens. Returns { extraction, fromCache }.
export async function extractVideo(cfg, options) {
  var videoId = options.videoId;
  var filePath = options.filePath;
  var force = !!options.force;

  if (!force) {
    var cached = readCachedExtraction(videoId);
    if (cached) return { extraction: cached, fromCache: true };
  }

  if (!cfg.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');

  var uploaded = await uploadVideoFile(cfg, filePath, videoId);
  var active = await waitForFileActive(cfg, uploaded.name);
  var extraction = await callGenerateContent(cfg, active.uri, active.mimeType, videoId);

  var errors = validate(loadSchema('videoAnalysisRawExtraction'), extraction);
  if (errors.length) {
    throw new Error('Gemini extraction for "' + videoId + '" failed schema validation:\n' + errors.join('\n'));
  }

  writeCachedExtraction(videoId, extraction);
  return { extraction: extraction, fromCache: false };
}
