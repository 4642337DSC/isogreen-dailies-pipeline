import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig, requireVideoAnalysisConfig } from './config.js';
import { extractVideo } from './geminiExtract.js';
import { scoreVideo } from './claudeScore.js';
import {
  buildPerformanceContext,
  computeChannelBaseline,
  fetchAllVideoRows,
  fetchVideosNeedingAnalysis,
  writeAnalysisResult
} from './videoAnalysisNotion.js';

function extFromUrl(url) {
  var ext = path.extname(new URL(url).pathname).toLowerCase();
  return ext || '.mp4';
}

async function downloadToTemp(url, videoId) {
  var res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download video file (' + res.status + '): ' + url);
  var buffer = Buffer.from(await res.arrayBuffer());
  var tmpPath = path.join(os.tmpdir(), 'video-analysis-' + videoId + extFromUrl(url));
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

// Thin orchestrator: for each video needing analysis, extract (Stage 1,
// cache-aware) -> score (Stage 2) -> write to Notion. Safe to re-run - a
// partial failure on one video is logged and skipped, not thrown, so a
// crash mid-run doesn't require manual cleanup; the next run picks up
// wherever fetchVideosNeedingAnalysis says work remains.
export async function runPipeline(options) {
  options = options || {};
  var cfg = getConfig();
  requireVideoAnalysisConfig(cfg);

  var allRows = await fetchAllVideoRows(cfg);
  var channelBaseline = computeChannelBaseline(allRows);
  var pending = await fetchVideosNeedingAnalysis(cfg, cfg.PIPELINE_VERSION, allRows);
  if (options.limit) pending = pending.slice(0, options.limit);

  console.log('Video analysis pipeline (' + cfg.PIPELINE_VERSION + '): ' + pending.length + ' video(s) to process.');

  var succeeded = 0;
  var failed = [];

  for (var row of pending) {
    var videoId = row.pageId;
    try {
      console.log('[' + videoId + '] ' + (row.name || '(untitled)') + ': downloading...');
      var tmpPath = await downloadToTemp(row.videoFileUrl, videoId);

      console.log('[' + videoId + '] extracting (Gemini)...');
      var extracted = await extractVideo(cfg, { videoId: videoId, filePath: tmpPath });
      fs.rmSync(tmpPath, { force: true });
      if (extracted.fromCache) console.log('[' + videoId + '] using cached extraction.');

      console.log('[' + videoId + '] scoring (Claude)...');
      var performance = buildPerformanceContext(row, channelBaseline);
      var analysis = await scoreVideo(cfg, {
        videoId: videoId,
        rawExtraction: extracted.extraction,
        performance: performance,
        brandContext: cfg.BRAND_CONTEXT
      });

      console.log('[' + videoId + '] writing to Notion...');
      await writeAnalysisResult(cfg, {
        videoPageId: row.pageId,
        videoName: row.name,
        analysis: analysis,
        rawExtraction: extracted.extraction,
        pipelineVersion: cfg.PIPELINE_VERSION
      });

      succeeded++;
      console.log('[' + videoId + '] done.');
    } catch (err) {
      console.log('[' + videoId + '] FAILED: ' + (err && err.message ? err.message : err));
      failed.push({ videoId: videoId, name: row.name, error: err && err.message ? err.message : String(err) });
    }
  }

  console.log('Video analysis pipeline finished: ' + succeeded + ' succeeded, ' + failed.length + ' failed.');
  if (failed.length) {
    failed.forEach(function (f) { console.log('  - [' + f.videoId + '] ' + f.name + ': ' + f.error); });
  }
  return { succeeded: succeeded, failed: failed };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  var limitArg = process.argv.find(function (a) { return a.startsWith('--limit='); });
  var limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  runPipeline({ limit: limit }).then(function (result) {
    if (result.failed.length) process.exitCode = 1;
  });
}
