import { createNotionPage, queryNotionDatabase, richTextToString, updateNotionPage } from './notion.js';

// Rich text objects are capped at 2000 chars each by the Notion API - the
// raw extraction JSON (audit trail for re-scoring, see analysis.schema.json
// section 4) routinely runs longer than that, so it's split across multiple
// text objects in the same property rather than truncated.
var RICH_TEXT_CHUNK_SIZE = 1900;

function chunkRichText(text) {
  var chunks = [];
  for (var i = 0; i < text.length; i += RICH_TEXT_CHUNK_SIZE) {
    chunks.push({ type: 'text', text: { content: text.slice(i, i + RICH_TEXT_CHUNK_SIZE) } });
  }
  return chunks.length ? chunks : [{ type: 'text', text: { content: '' } }];
}

async function queryAll(cfg, databaseId, filter) {
  var results = [];
  var cursor = null;
  do {
    var payload = { page_size: 100 };
    if (filter) payload.filter = filter;
    if (cursor) payload.start_cursor = cursor;
    var data = await queryNotionDatabase(cfg, databaseId, payload);
    if (data.object === 'error') throw new Error('Notion query failed: ' + data.message);
    results.push.apply(results, data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

function numberProp(props, name) {
  var prop = props[name];
  return prop && typeof prop.number === 'number' ? prop.number : null;
}

// Video DB rows that don't yet have a page in the Video Analysis DB for the
// given pipeline version - source list for the pipeline orchestrator.
// VIDEO_FILE_FIELD_NAME points at whatever property on the Video DB holds a
// downloadable link to the actual video file (a Notion "Files & media"
// property, or a URL property if videos are hosted elsewhere) - required
// since Gemini needs the raw file, not just metadata.
export async function fetchAllVideoRows(cfg) {
  var videoRows = await queryAll(cfg, cfg.NOTION_DATABASE_ID);
  return videoRows.map(function (page) { return parseVideoRow(cfg, page); });
}

export async function fetchVideosNeedingAnalysis(cfg, pipelineVersion, allRows) {
  var rows = allRows || await fetchAllVideoRows(cfg);
  var analysisRows = await queryAll(cfg, cfg.VIDEO_ANALYSIS_DATABASE_ID, {
    property: 'Pipeline Version',
    select: { equals: pipelineVersion }
  });
  var alreadyAnalyzed = new Set();
  analysisRows.forEach(function (page) {
    var relation = page.properties['Video'] && page.properties['Video'].relation;
    (relation || []).forEach(function (r) { alreadyAnalyzed.add(r.id); });
  });

  return rows
    .filter(function (row) { return !alreadyAnalyzed.has(row.pageId); })
    .filter(function (row) { return !!row.videoFileUrl; });
}

function parseVideoRow(cfg, page) {
  var props = page.properties;
  var name = (props['Name'] && props['Name'].title || []).map(function (t) { return t.plain_text; }).join('');
  var fileProp = props[cfg.VIDEO_FILE_FIELD_NAME];
  var videoFileUrl = null;
  if (fileProp) {
    if (fileProp.files && fileProp.files.length) {
      var f = fileProp.files[0];
      videoFileUrl = f.type === 'external' ? f.external.url : (f.file ? f.file.url : null);
    } else if (fileProp.url) {
      videoFileUrl = fileProp.url;
    }
  }
  return {
    pageId: page.id,
    name: name,
    videoFileUrl: videoFileUrl,
    postDate: props['Data Postare'] && props['Data Postare'].date ? props['Data Postare'].date.start : null,
    views: numberProp(props, cfg.VIEWS_FIELD_NAME),
    retention: numberProp(props, cfg.RETENTION_FIELD_NAME),
    comments: numberProp(props, cfg.COMMENTS_FIELD_NAME)
  };
}

// Channel baseline (avg views across every row that has a views number) so
// Claude can judge a video relative to its own channel's typical
// performance rather than an absolute number - see prompts/videoAnalysisClaudeScoring.txt.
export function computeChannelBaseline(rows) {
  var withViews = rows.map(function (r) { return r.views; }).filter(function (v) { return typeof v === 'number'; });
  if (!withViews.length) return null;
  var avg = withViews.reduce(function (a, b) { return a + b; }, 0) / withViews.length;
  return { avg_views: Math.round(avg), sample_size: withViews.length };
}

export function buildPerformanceContext(row, channelBaseline) {
  return {
    views: row.views,
    retention: row.retention,
    comments: row.comments,
    channel_baseline: channelBaseline
  };
}

async function findAnalysisRow(cfg, videoPageId, pipelineVersion) {
  var data = await queryNotionDatabase(cfg, cfg.VIDEO_ANALYSIS_DATABASE_ID, {
    filter: {
      and: [
        { property: 'Video', relation: { contains: videoPageId } },
        { property: 'Pipeline Version', select: { equals: pipelineVersion } }
      ]
    },
    page_size: 1
  });
  if (data.object === 'error' || !data.results || !data.results.length) return null;
  return data.results[0].id;
}

// Creates (or updates, if a row for this video+pipeline version already
// exists - keeps re-runs idempotent) the Video Analysis row. rawExtraction
// is stored alongside the scores so a later prompt tweak can re-score
// without re-paying for Gemini video tokens (see src/videoAnalysisPipeline.js).
export async function writeAnalysisResult(cfg, options) {
  var scores = options.analysis.scores;
  var props = {
    'Name': { title: [{ text: { content: options.videoName || options.analysis.video_id || options.videoPageId } }] },
    'Video': { relation: [{ id: options.videoPageId }] },
    'Hook Score': { number: scores.hook.score },
    'Structure Score': { number: scores.structure.score },
    'Format Score': { number: scores.format.score },
    'Pacing Score': { number: scores.pacing.score },
    'CTA Score': { number: scores.cta.score },
    'Overall Notes': { rich_text: chunkRichText(options.analysis.overall_notes || '') },
    'Reusable Pattern': { rich_text: chunkRichText(options.analysis.reusable_pattern || '') },
    'Raw Extraction': { rich_text: chunkRichText(JSON.stringify(options.rawExtraction)) },
    'Analyzed Date': { date: { start: new Date().toISOString() } },
    'Pipeline Version': { select: { name: options.pipelineVersion } }
  };

  var existingId = await findAnalysisRow(cfg, options.videoPageId, options.pipelineVersion);
  if (existingId) {
    return updateNotionPage(cfg, existingId, props);
  }
  return createNotionPage(cfg, cfg.VIDEO_ANALYSIS_DATABASE_ID, props);
}

export function richTextFromAnalysisPage(page, propertyName) {
  return richTextToString(page.properties[propertyName]);
}
