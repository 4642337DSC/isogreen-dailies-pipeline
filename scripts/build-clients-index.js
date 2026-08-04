import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientsIndex } from '../src/dashboard.js';

// Run once after every client's matrix job has synced (see the "publish" job
// in .github/workflows/sync.yml) - scans dist/clients/ for whichever client
// folders are actually present and (re)builds the picker page at
// dist/clients/index.html linking to all of them.
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var CLIENTS_DIR = path.join(__dirname, '..', 'dist', 'clients');

await buildClientsIndex(CLIENTS_DIR);
