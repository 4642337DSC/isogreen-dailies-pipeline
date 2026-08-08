import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText } from './http.js';
import { loadSchema, validate } from './videoAnalysisSchema.js';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

var ANTHROPIC_API_BASE = 'https://api.anthropic.com';
var ANTHROPIC_VERSION = '2023-06-01';
// Cheap/fast relative to Gemini's video tokens - this call is plain
// structured text in/out, so it stays on Sonnet even at volume. Opus is
// worth testing separately for the weekly aggregation step, not per-video.
var CLAUDE_MODEL = 'claude-sonnet-5';
var MAX_TOKENS = 4096;

function scoringPromptTemplate() {
  return fs.readFileSync(path.join(PROMPTS_DIR, 'videoAnalysisClaudeScoring.txt'), 'utf8');
}

export function buildScoringPrompt(options) {
  return scoringPromptTemplate()
    .replace('{{brand_context}}', options.brandContext || '(none provided)')
    .replace('{{performance_context}}', JSON.stringify(options.performance || {}, null, 2))
    .replace('{{video_id}}', options.videoId)
    .replace('{{raw_extraction_json}}', JSON.stringify(options.rawExtraction, null, 2));
}

function stripCodeFence(text) {
  var trimmed = text.trim();
  var fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

async function callMessages(cfg, messages) {
  var res = await fetchText(ANTHROPIC_API_BASE + '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, messages: messages })
  });
  var data = res.json();
  if (!data || data.type === 'error') {
    throw new Error('Claude Messages API call failed: ' + (data ? JSON.stringify(data.error) : res.text));
  }
  if (!data.content || !data.content[0]) throw new Error('Claude response had no content: ' + res.text);
  return data.content.map(function (block) { return block.text || ''; }).join('');
}

function parseAndValidate(rawText) {
  var parsed;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch (err) {
    return { errors: ['Response was not valid JSON: ' + err.message] };
  }
  var errors = validate(loadSchema('videoAnalysisScoring'), parsed);
  return { parsed: parsed, errors: errors };
}

// Stage 2: raw_extraction.json + performance context -> analysis.json.
// Requests JSON matching schemas/videoAnalysisScoring.schema.json; on a
// validation failure, retries once with the schema errors fed back so
// Claude can self-correct rather than failing the whole pipeline run over
// one malformed field.
export async function scoreVideo(cfg, options) {
  if (!cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');

  var prompt = buildScoringPrompt(options);
  var firstText = await callMessages(cfg, [{ role: 'user', content: prompt }]);
  var first = parseAndValidate(firstText);
  if (!first.errors.length) return first.parsed;

  var retryText = await callMessages(cfg, [
    { role: 'user', content: prompt },
    { role: 'assistant', content: firstText },
    { role: 'user', content: 'Your previous output did not match the required schema. Errors:\n' + first.errors.join('\n') + '\n\nReturn corrected JSON matching the schema exactly. No prose outside the JSON.' }
  ]);
  var retry = parseAndValidate(retryText);
  if (retry.errors.length) {
    throw new Error('Claude scoring for "' + options.videoId + '" failed schema validation twice:\n' + retry.errors.join('\n'));
  }
  return retry.parsed;
}
