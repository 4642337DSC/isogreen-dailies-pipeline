import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, requireConfig } from '../src/config.js';
import { fetchNotionRows } from '../src/notion.js';
import { syncThumbnails } from '../src/thumbnails.js';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var THUMBS_DIR = path.join(__dirname, '..', 'dist', 'clients', 'isogreen', 'thumbs');

var cfg = getConfig();
requireConfig(cfg);
var rows = await fetchNotionRows(cfg);
await syncThumbnails(cfg, rows, THUMBS_DIR);
