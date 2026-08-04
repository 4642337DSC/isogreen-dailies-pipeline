# Miradex Client Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `isogreen-dailies-pipeline` sync and publish a dashboard for a second
client, Miradex, from the same repo/workflow/output site as Isogreen, writing into
Miradex's existing (but differently-shaped) Notion database.

**Architecture:** Introduce a small set of client-identity config values
(`CLIENT_SLUG`, `CLIENT_NAME`, `NOTION_FILTER_TIP`, `*_FIELD_NAME`) read from env vars
with Isogreen-compatible defaults, thread them through the two places that currently
hardcode Isogreen's shape (the Notion query filter and the view-count field names),
and convert the GitHub Actions workflow from a single job into a matrix over clients
feeding one shared "publish" step.

**Tech Stack:** Node.js (ESM, `"type": "module"`), Node's built-in `node:test` runner
(no new dependency — none currently exists in this repo), GitHub Actions.

## Global Constraints

- Node >=20 (per `package.json` `engines`).
- No new npm dependencies — this repo has exactly one (`sharp`), and none of this
  work needs another.
- Isogreen's existing behavior must not change with zero config: every new env var
  defaults to Isogreen's current hardcoded value.
- Follow the existing code style: `var`, `function` expressions (not arrow functions),
  no semicolon-free style — match `src/notion.js` / `src/dashboard.js` as written.

---

## Task 1: Client-identity config values

**Files:**
- Modify: `src/config.js`
- Test: `src/config.test.js` (new)

**Interfaces:**
- Produces: `getConfig()` now also returns `CLIENT_SLUG` (string, default `'isogreen'`),
  `CLIENT_NAME` (string, default `'ISOGREEN'`), `NOTION_FILTER_TIP` (boolean, default
  `true`), `YT_FIELD_NAME`/`FB_FIELD_NAME`/`IG_FIELD_NAME`/`TT_FIELD_NAME` (strings,
  defaulting to `'YouTube'`/`'Facebook'`/`'Instagram'`/`'TikTok'`).

- [ ] **Step 1: Write the failing test**

Create `src/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from './config.js';

test('getConfig defaults client identity to Isogreen when env is unset', () => {
  delete process.env.CLIENT_SLUG;
  delete process.env.CLIENT_NAME;
  delete process.env.NOTION_FILTER_TIP;
  delete process.env.YT_FIELD_NAME;
  delete process.env.FB_FIELD_NAME;
  delete process.env.IG_FIELD_NAME;
  delete process.env.TT_FIELD_NAME;

  var cfg = getConfig();

  assert.equal(cfg.CLIENT_SLUG, 'isogreen');
  assert.equal(cfg.CLIENT_NAME, 'ISOGREEN');
  assert.equal(cfg.NOTION_FILTER_TIP, true);
  assert.equal(cfg.YT_FIELD_NAME, 'YouTube');
  assert.equal(cfg.FB_FIELD_NAME, 'Facebook');
  assert.equal(cfg.IG_FIELD_NAME, 'Instagram');
  assert.equal(cfg.TT_FIELD_NAME, 'TikTok');
});

test('getConfig picks up client overrides from env', () => {
  process.env.CLIENT_SLUG = 'miradex';
  process.env.CLIENT_NAME = 'MIRADEX';
  process.env.NOTION_FILTER_TIP = 'false';
  process.env.YT_FIELD_NAME = 'V7Z - Yt Shorts';

  var cfg = getConfig();

  assert.equal(cfg.CLIENT_SLUG, 'miradex');
  assert.equal(cfg.CLIENT_NAME, 'MIRADEX');
  assert.equal(cfg.NOTION_FILTER_TIP, false);
  assert.equal(cfg.YT_FIELD_NAME, 'V7Z - Yt Shorts');

  delete process.env.CLIENT_SLUG;
  delete process.env.CLIENT_NAME;
  delete process.env.NOTION_FILTER_TIP;
  delete process.env.YT_FIELD_NAME;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/config.test.js`
Expected: FAIL — `cfg.CLIENT_SLUG` is `undefined`, not `'isogreen'`.

- [ ] **Step 3: Add the new config fields**

In `src/config.js`, inside `getConfig()`'s returned object (after the existing
`YOUTUBE_REFRESH_TOKEN` line), add:

```js
    CLIENT_SLUG: process.env.CLIENT_SLUG || 'isogreen',
    CLIENT_NAME: process.env.CLIENT_NAME || 'ISOGREEN',
    NOTION_FILTER_TIP: process.env.NOTION_FILTER_TIP !== 'false',
    YT_FIELD_NAME: process.env.YT_FIELD_NAME || 'YouTube',
    FB_FIELD_NAME: process.env.FB_FIELD_NAME || 'Facebook',
    IG_FIELD_NAME: process.env.IG_FIELD_NAME || 'Instagram',
    TT_FIELD_NAME: process.env.TT_FIELD_NAME || 'TikTok'
```

(Remember to add a trailing comma after the previous last line,
`YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN || null`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/config.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/config.test.js
git commit -m "feat: add client-identity config values with Isogreen-compatible defaults"
```

---

## Task 2: Configurable Shorts filter + write-back field names in `notion.js`

**Files:**
- Modify: `src/notion.js`
- Test: `src/notion.test.js` (new)

**Interfaces:**
- Consumes: `cfg.NOTION_FILTER_TIP`, `cfg.YT_FIELD_NAME`, `cfg.FB_FIELD_NAME`,
  `cfg.IG_FIELD_NAME`, `cfg.TT_FIELD_NAME` (from Task 1's `getConfig()`).
- Produces: `buildShortsFilter(cfg)` — pure function returning a Notion filter object.
  `buildUpdatePayloads(cfg, rows, yt, fb, ig, tt)` — pure function returning the
  `{ [pageId]: { <field>: {...} } }` map that `writeUpdates` sends to Notion. Both are
  new named exports from `src/notion.js`. `dashboard.js` (Task 3) imports
  `buildShortsFilter` from here.

Miradex's "Short Form" database has no `Tip` property at all, so the sync's Notion
query must be able to omit that filter clause entirely — filtering on a
nonexistent property would error. This task extracts the filter into a pure,
testable function and wires `cfg.NOTION_FILTER_TIP` through it.

- [ ] **Step 1: Write the failing tests**

Create `src/notion.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShortsFilter, buildUpdatePayloads } from './notion.js';

test('buildShortsFilter includes the Tip clause when NOTION_FILTER_TIP is true', () => {
  var filter = buildShortsFilter({ NOTION_FILTER_TIP: true });
  assert.deepEqual(filter, {
    and: [
      { property: 'Tip', multi_select: { contains: 'Short' } },
      { property: 'Postat?', checkbox: { equals: true } }
    ]
  });
});

test('buildShortsFilter omits the Tip clause when NOTION_FILTER_TIP is false', () => {
  var filter = buildShortsFilter({ NOTION_FILTER_TIP: false });
  assert.deepEqual(filter, {
    and: [{ property: 'Postat?', checkbox: { equals: true } }]
  });
});

test('buildUpdatePayloads writes counts into the cfg-configured field names', () => {
  var cfg = {
    YT_FIELD_NAME: 'V7Z - Yt Shorts',
    FB_FIELD_NAME: 'V7Z - Fb',
    IG_FIELD_NAME: 'V7Z - Insta',
    TT_FIELD_NAME: 'V7Z - TikTok'
  };
  var row = { pageId: 'page-1' };
  var yt = { results: [{ row: row, views: 100, url: 'https://youtu.be/x' }] };
  var fb = { results: [{ row: row, views: 50 }] };

  var payloads = buildUpdatePayloads(cfg, [row], yt, fb, null, null);

  assert.deepEqual(payloads, {
    'page-1': {
      'V7Z - Yt Shorts': { number: 100 },
      'YouTube URL': { url: 'https://youtu.be/x' },
      'V7Z - Fb': { number: 50 }
    }
  });
});

test('buildUpdatePayloads skips platforms passed as null', () => {
  var cfg = { YT_FIELD_NAME: 'YouTube', FB_FIELD_NAME: 'Facebook', IG_FIELD_NAME: 'Instagram', TT_FIELD_NAME: 'TikTok' };
  var row = { pageId: 'page-1' };
  var yt = { results: [{ row: row, views: 5 }] };

  var payloads = buildUpdatePayloads(cfg, [row], yt, null, null, null);

  assert.deepEqual(payloads, { 'page-1': { YouTube: { number: 5 } } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/notion.test.js`
Expected: FAIL — `buildShortsFilter` and `buildUpdatePayloads` are not exported.

- [ ] **Step 3: Implement `buildShortsFilter` and use it in `fetchNotionRows`**

In `src/notion.js`, replace the inline filter literal inside `fetchNotionRows`
(currently lines 19–24):

```js
    var payload = {
      page_size: 100,
      filter: {
        and: [
          { property: 'Tip', multi_select: { contains: 'Short' } },
          { property: 'Postat?', checkbox: { equals: true } }
        ]
      }
    };
```

with:

```js
    var payload = {
      page_size: 100,
      filter: buildShortsFilter(cfg)
    };
```

Then add the new exported function (near the bottom of the file, in the
"Cross-platform report/write helpers" section is fine):

```js
export function buildShortsFilter(cfg) {
  var and = [{ property: 'Postat?', checkbox: { equals: true } }];
  if (cfg.NOTION_FILTER_TIP) and.unshift({ property: 'Tip', multi_select: { contains: 'Short' } });
  return { and: and };
}
```

- [ ] **Step 4: Implement `buildUpdatePayloads` and use it in `writeUpdates`**

Replace the current `writeUpdates` function (lines 306–342) with:

```js
export function buildUpdatePayloads(cfg, rows, yt, fb, ig, tt) {
  var byPage = {};
  function entryFor(row) {
    if (!byPage[row.pageId]) byPage[row.pageId] = {};
    return byPage[row.pageId];
  }

  yt.results.forEach(function (r) {
    var props = entryFor(r.row);
    props[cfg.YT_FIELD_NAME] = { number: r.views };
    if (r.url) props['YouTube URL'] = { url: r.url };
  });
  if (fb) {
    fb.results.forEach(function (r) {
      var props = entryFor(r.row);
      props[cfg.FB_FIELD_NAME] = { number: r.views };
      if (r.url) props['Facebook URL'] = { url: r.url };
    });
  }
  if (ig) {
    ig.results.forEach(function (r) {
      var props = entryFor(r.row);
      props[cfg.IG_FIELD_NAME] = { number: r.views };
      if (r.url) props['Instagram URL'] = { url: r.url };
    });
  }
  if (tt) {
    tt.results.forEach(function (r) {
      var props = entryFor(r.row);
      props[cfg.TT_FIELD_NAME] = { number: r.views };
    });
  }

  return byPage;
}

export async function writeUpdates(cfg, rows, yt, fb, ig, tt) {
  var byPage = buildUpdatePayloads(cfg, rows, yt, fb, ig, tt);
  for (var pageId of Object.keys(byPage)) {
    await updateNotionPage(cfg, pageId, byPage[pageId]);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test src/notion.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/notion.js src/notion.test.js
git commit -m "feat: make Shorts filter and view-count field names configurable per client"
```

---

## Task 3: Configurable filter + field names + client name in `dashboard.js`

**Files:**
- Modify: `src/dashboard.js`
- Test: `src/dashboard.test.js` (new)

**Interfaces:**
- Consumes: `buildShortsFilter(cfg)` from Task 2 (`src/notion.js`). `cfg.YT_FIELD_NAME`
  / `FB_FIELD_NAME` / `IG_FIELD_NAME` / `TT_FIELD_NAME` / `CLIENT_NAME` from Task 1.
- Produces: `buildDashboardRow(cfg, page, thumbMap)` — pure function, new named export,
  returns one dashboard row array (or `null` if the page has no post date) from a
  single raw Notion page object. `fetchDashboardRows` now calls this per page instead
  of inlining the same logic.

- [ ] **Step 1: Write the failing tests**

Create `src/dashboard.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardRow } from './dashboard.js';

function page(props) {
  return { properties: props };
}

test('buildDashboardRow reads view counts from cfg-configured field names', () => {
  var cfg = {
    YT_FIELD_NAME: 'V7Z - Yt Shorts',
    FB_FIELD_NAME: 'V7Z - Fb',
    IG_FIELD_NAME: 'V7Z - Insta',
    TT_FIELD_NAME: 'V7Z - TikTok'
  };
  var p = page({
    'Data Postare': { date: { start: '2026-08-01' } },
    'Name': { title: [{ plain_text: 'Test Short' }] },
    'Cod': { rich_text: [{ plain_text: 'M001' }] },
    'Instagram URL': { url: 'https://instagram.com/p/x' },
    'YouTube URL': null,
    'Facebook URL': null,
    'TikTok URL': null,
    'V7Z - Yt Shorts': { number: 10 },
    'V7Z - Fb': { number: 20 },
    'V7Z - Insta': { number: 30 },
    'V7Z - TikTok': { number: 40 },
    'Transcript': { rich_text: [{ plain_text: 'hello' }] }
  });

  var row = buildDashboardRow(cfg, p, { M001: 'thumb.jpg' });

  assert.deepEqual(row, [
    'Test Short', 'M001', 10, 20, 30, 40,
    '2026-08-01', 'https://instagram.com/p/x', 'hello', 'thumb.jpg'
  ]);
});

test('buildDashboardRow returns null when there is no post date', () => {
  var cfg = { YT_FIELD_NAME: 'YouTube', FB_FIELD_NAME: 'Facebook', IG_FIELD_NAME: 'Instagram', TT_FIELD_NAME: 'TikTok' };
  var p = page({
    'Data Postare': { date: null },
    'Name': { title: [] },
    'Cod': { rich_text: [] }
  });

  assert.equal(buildDashboardRow(cfg, p, {}), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/dashboard.test.js`
Expected: FAIL — `buildDashboardRow` is not exported.

- [ ] **Step 3: Extract `buildDashboardRow` and use `buildShortsFilter`**

In `src/dashboard.js`, change the import line (currently line 3) from:

```js
import { queryNotionDatabase, richTextToString } from './notion.js';
```

to:

```js
import { queryNotionDatabase, richTextToString, buildShortsFilter } from './notion.js';
```

Replace the inline filter literal inside `fetchDashboardRows` (currently lines 27–33)
the same way as Task 2 — swap the hardcoded `filter: { and: [...] }` for
`filter: buildShortsFilter(cfg)`.

Replace the `forEach` body inside `fetchDashboardRows` (currently lines 37–64) — the
block that builds and pushes one row per page — with:

```js
    (data.results || []).forEach(function (page) {
      var row = buildDashboardRow(cfg, page, thumbMap);
      if (row) out.push(row);
    });
```

Then add the extracted function above `fetchDashboardRows` (or directly below it):

```js
export function buildDashboardRow(cfg, page, thumbMap) {
  var props = page.properties;
  var postDate = props['Data Postare'] && props['Data Postare'].date ? props['Data Postare'].date.start : null;
  if (!postDate) return null; // dashboard places every short in time - skip anything without a post date
  var name = (props['Name'].title || []).map(function (t) { return t.plain_text; }).join('').trim();
  var cod = richTextToString(props['Cod']);
  var igLink = props['Instagram URL'] ? props['Instagram URL'].url : null;
  var ytLink = props['YouTube URL'] ? props['YouTube URL'].url : null;
  var fbLink = props['Facebook URL'] ? props['Facebook URL'].url : null;
  var ttLink = props['TikTok URL'] ? props['TikTok URL'].url : null;
  var link = igLink || ytLink || fbLink || ttLink || null;
  return [
    name,
    cod,
    props[cfg.YT_FIELD_NAME].number,
    props[cfg.FB_FIELD_NAME].number,
    props[cfg.IG_FIELD_NAME].number,
    props[cfg.TT_FIELD_NAME].number,
    postDate,
    link,
    richTextToString(props['Transcript']) || null,
    thumbMap[cod] || null
  ];
}
```

- [ ] **Step 4: Replace the hardcoded `__CLIENT_NAME__` substitution**

In `buildDashboard`, change:

```js
    .split('__CLIENT_NAME__').join('ISOGREEN');
```

to:

```js
    .split('__CLIENT_NAME__').join(cfg.CLIENT_NAME);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test src/dashboard.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.js src/dashboard.test.js
git commit -m "feat: read dashboard rows and client name from cfg instead of hardcoding Isogreen"
```

---

## Task 4: Dynamic clients index (picker page lists whichever clients exist)

**Files:**
- Modify: `src/dashboard.js`
- Modify: `templates/ClientsIndex.html`
- Test: `src/dashboard.test.js` (append to the file created in Task 3)

**Interfaces:**
- Produces: `renderClientLinks(slugs)` — pure function, new named export, returns the
  `<li>` HTML block for a list of client slugs (sorted, one link per slug, label is
  the slug uppercased). `buildClientsIndex(clientsDir)` (existing export, signature
  unchanged) now scans `clientsDir` for subdirectories instead of copying a static
  template verbatim.

Today `templates/ClientsIndex.html` is copied byte-for-byte, with a single hardcoded
`<li><a href="/clients/isogreen/">ISOGREEN</a></li>`. Once the merge/publish job
(Task 9) has both `dist/clients/isogreen/` and `dist/clients/miradex/` on disk,
`buildClientsIndex` needs to list both.

- [ ] **Step 1: Write the failing test**

Append to `src/dashboard.test.js`:

```js
import { renderClientLinks } from './dashboard.js';

test('renderClientLinks renders one link per slug, sorted, label uppercased', () => {
  var html = renderClientLinks(['miradex', 'isogreen']);

  assert.equal(
    html,
    '      <li><a href="/clients/isogreen/">ISOGREEN</a></li>\n' +
    '      <li><a href="/clients/miradex/">MIRADEX</a></li>'
  );
});
```

(Add `renderClientLinks` to the existing `import { buildDashboardRow } from './dashboard.js';`
line at the top of the file instead of a second import statement.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/dashboard.test.js`
Expected: FAIL — `renderClientLinks` is not exported.

- [ ] **Step 3: Add the token to the template**

In `templates/ClientsIndex.html`, replace:

```html
    <ul>
      <li><a href="/clients/isogreen/">ISOGREEN</a></li>
    </ul>
```

with:

```html
    <ul>
<!--__CLIENT_LINKS__-->
    </ul>
```

- [ ] **Step 4: Implement `renderClientLinks` and rewrite `buildClientsIndex`**

Replace the current `buildClientsIndex` function (lines 189–195) with:

```js
export function renderClientLinks(slugs) {
  return slugs.slice().sort().map(function (slug) {
    return '      <li><a href="/clients/' + slug + '/">' + slug.toUpperCase() + '</a></li>';
  }).join('\n');
}

// Static picker page at /clients/ - regenerated from whichever client
// subdirectories are actually present under clientsDir at publish time (see
// scripts/build-clients-index.js), so adding a client is a schema/secrets
// change, not a template edit.
export async function buildClientsIndex(clientsDir) {
  var entries = await fs.readdir(clientsDir, { withFileTypes: true }).catch(function () { return []; });
  var slugs = entries.filter(function (e) { return e.isDirectory(); }).map(function (e) { return e.name; });

  var templatePath = new URL('../templates/ClientsIndex.html', import.meta.url);
  var html = await fs.readFile(templatePath, 'utf8');
  html = html.replace('<!--__CLIENT_LINKS__-->', renderClientLinks(slugs));

  await fs.mkdir(clientsDir, { recursive: true });
  await fs.writeFile(path.join(clientsDir, 'index.html'), html, 'utf8');
  console.log('Clients index written to ' + path.join(clientsDir, 'index.html') + ' (' + slugs.length + ' client(s): ' + slugs.slice().sort().join(', ') + ')');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/dashboard.test.js`
Expected: PASS (3 tests total for this file).

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.js templates/ClientsIndex.html src/dashboard.test.js
git commit -m "feat: generate the clients picker page from whichever client folders exist"
```

---

## Task 5: Parameterize `sync.js`'s output folder by client, drop its clients-index call

**Files:**
- Modify: `src/sync.js`

**Interfaces:**
- Consumes: `cfg.CLIENT_SLUG` (Task 1).
- Produces: no change to `syncAllViews()`'s external behavior for Isogreen (still
  writes to `dist/clients/isogreen/`); `buildClientsIndex` is no longer called from
  here (moved to Task 6's standalone script).

- [ ] **Step 1: Move `DIST_DIR` inside `syncAllViews` and key it off `cfg.CLIENT_SLUG`**

In `src/sync.js`, remove the module-level line (currently line 19):

```js
var DIST_DIR = path.join(CLIENTS_DIR, 'isogreen');
```

Inside `syncAllViews()`, immediately after the existing `requireConfig(cfg);` line,
add:

```js
  var DIST_DIR = path.join(CLIENTS_DIR, cfg.CLIENT_SLUG);
```

- [ ] **Step 2: Remove the `buildClientsIndex` call and its import**

Change the import line (currently):

```js
import { buildDashboard, buildClientsIndex } from './dashboard.js';
```

to:

```js
import { buildDashboard } from './dashboard.js';
```

Remove this block entirely (currently near the end of `syncAllViews`, right before
`await writeSyncSummary(...)`):

```js
  try {
    await buildClientsIndex(CLIENTS_DIR);
  } catch (e) { console.log('Clients index build failed: ' + e); }

```

- [ ] **Step 3: Manually verify Isogreen's behavior is unchanged**

Run: `node -e "import('./src/sync.js')"` is not a real test here (it would hit live
APIs) — instead just re-read the edited file and confirm `DIST_DIR` is still
`dist/clients/isogreen` when `CLIENT_SLUG` is unset (relies on Task 1's default), and
that no other line in the file still references the removed `buildClientsIndex`
import. `node --check src/sync.js` confirms the file at least parses.

Run: `node --check src/sync.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add src/sync.js
git commit -m "refactor: derive sync.js output folder from CLIENT_SLUG, drop clients-index call"
```

---

## Task 6: Standalone clients-index build step

**Files:**
- Create: `scripts/build-clients-index.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildClientsIndex(clientsDir)` from Task 4 (`src/dashboard.js`).
- Produces: `npm run build:clients-index` — runs after every client has synced (used
  by the `publish` job in Task 9), rebuilds `dist/clients/index.html` from whatever
  client folders are present on disk at that point.

- [ ] **Step 1: Create the script**

Create `scripts/build-clients-index.js`:

```js
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
```

- [ ] **Step 2: Add the npm scripts**

In `package.json`, inside `"scripts"`, add (alongside the existing `"sync"` entry):

```json
    "build:clients-index": "node scripts/build-clients-index.js",
    "test": "node --test src",
```

- [ ] **Step 3: Verify locally**

```bash
mkdir -p dist/clients/isogreen dist/clients/miradex
echo '<html></html>' > dist/clients/isogreen/index.html
echo '<html></html>' > dist/clients/miradex/index.html
npm run build:clients-index
```

Expected: prints `Clients index written to .../dist/clients/index.html (2 client(s): isogreen, miradex)`.
Open `dist/clients/index.html` and confirm it has two `<li>` links, `ISOGREEN` and
`MIRADEX`, each pointing at `/clients/<slug>/`.

Clean up the scratch folders afterward: `rm -rf dist`.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1–4 (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-clients-index.js package.json
git commit -m "feat: add standalone clients-index build step and npm test script"
```

---

## Task 7: Manual Notion database setup for Miradex

This task is operational, not code — it prepares the Notion schema the previous
tasks' code now expects, so Task 8's local dry run has something real to sync
against. Nothing here is testable in the automated sense; each step's "done"
condition is stated inline. GitHub secrets are handled later, in Task 9 — this task
covers Notion only.

- [ ] **Step 1: Add the 4 URL columns to Miradex's "Short Form" database**

Open `https://app.notion.com/p/0f35d908eb97407192ea4c5906406187` in Notion. For each
of `YouTube URL`, `Facebook URL`, `Instagram URL`, `TikTok URL`: click the `+` at the
right edge of the table's column headers > choose property type **URL** > name it
exactly as listed (case-sensitive, matches what `src/notion.js`'s `parseNotionRow`
and `writeUpdates` read/write).

Done when: all 4 columns exist and show type "URL" in the database's property list.

- [ ] **Step 2: Confirm the Notion integration has access to this database**

In the same database, `...` menu (top right) > **Connections** > confirm the
integration whose token is used for `NOTION_TOKEN` is listed. If not, add it — without
this, every API call against this database 404s/403s regardless of code correctness.

Done when: the integration appears under Connections.

- [ ] **Step 3: Create the "Channel Stats" and "Monthly Views" databases for Miradex**

There's no backfill script for these two (Isogreen's were created manually) — create
them by hand under the Miradex Notion workspace, matching the schema the code expects:

**Channel Stats** (read by `fetchDashboardAudience` in `src/dashboard.js`):
- `Platform` — **Title** property (not Select — the code reads `props['Platform'].title`).
- `Followers` — Number property.

**Monthly Views** (read/written by `fetchDashboardMonthlyViews` in `src/dashboard.js`
and `writeMonthlyViews` in `src/notion.js`):
- `Label` — Title property.
- `Platform` — Select property, with options `YouTube`, `Facebook`, `Instagram`, `TikTok`.
- `Month` — Date property.
- `Views` — Number property.
- `Source` — Select property.
- `Synced At` — Date property.

Share both with the same Notion integration as Step 2. Note each database's ID (the
32-character segment of its URL) — these become `MIRADEX_CHANNEL_STATS_DATABASE_ID`
and `MIRADEX_MONTHLY_VIEWS_DATABASE_ID` in Task 9.

Done when: both databases exist, are shared with the integration, and their property
names/types match exactly what's listed above.

- [ ] **Step 4: Create the "Daily Views" and "Follower Snapshots" databases via the existing scripts**

These nest alongside "Monthly Views" and are created via the repo's existing backfill
scripts, which need `MONTHLY_VIEWS_DATABASE_ID` set to Miradex's Monthly Views
database ID (from Step 3) first:

```bash
NOTION_TOKEN=<token> MONTHLY_VIEWS_DATABASE_ID=<miradex monthly views id> npm run backfill:create-daily-views-db
NOTION_TOKEN=<token> MONTHLY_VIEWS_DATABASE_ID=<miradex monthly views id> npm run backfill:create-follower-snapshots-db
```

Each prints a `..._DATABASE_ID=` line on success — save those for Task 9 as
`MIRADEX_DAILY_VIEWS_DATABASE_ID` and `MIRADEX_FOLLOWER_SNAPSHOTS_DATABASE_ID`.

Done when: both commands print a created database ID with no error.

- [ ] **Step 5: Gather Miradex's YouTube channel handle**

`YOUTUBE_API_KEY` is shared (same Google Cloud project as Isogreen) — no new key
needed. Only `CHANNEL_HANDLE` is Miradex-specific: Miradex's YouTube handle (e.g.
`@miradex...` — confirm the exact handle from their channel URL).

Done when: you have Miradex's YouTube channel handle written down.

---

## Task 8: Local dry-run verification

**Files:** none (verification only)

Per the approved design, this happens *before* the shared production workflow or its
secrets are touched — confirms Tasks 1–7 actually work against Miradex's real Notion
database, and that Isogreen is unaffected, while everything is still just local
`.env` files.

- [ ] **Step 1: Local dry run against Miradex's Notion database**

Create a local `.env` (never commit it) with:

```
YOUTUBE_API_KEY=<shared key>
NOTION_TOKEN=<shared token>
NOTION_DATABASE_ID=<miradex short form id>
CLIENT_SLUG=miradex
CLIENT_NAME=MIRADEX
NOTION_FILTER_TIP=false
YT_FIELD_NAME=V7Z - Yt Shorts
FB_FIELD_NAME=V7Z - Fb
IG_FIELD_NAME=V7Z - Insta
TT_FIELD_NAME=V7Z - TikTok
CHANNEL_HANDLE=<miradex youtube handle>
CHANNEL_STATS_DATABASE_ID=<from Task 7>
MONTHLY_VIEWS_DATABASE_ID=<from Task 7>
DAILY_VIEWS_DATABASE_ID=<from Task 7>
FOLLOWER_SNAPSHOTS_DATABASE_ID=<from Task 7>
```

Run: `node --env-file=.env src/sync.js`

Expected: no errors about a missing `Tip` property; `dist/clients/miradex/index.html`
is written; in Notion, at least one Short's `V7Z - Yt Shorts` number and `YouTube URL`
get filled in (spot-check a row that's `Postat?` = true and matches a real posted
video).

- [ ] **Step 2: Confirm Isogreen is unaffected**

Run: `node --env-file=.env.isogreen src/sync.js` (Isogreen's existing `.env`, with no
`CLIENT_SLUG`/`CLIENT_NAME`/`NOTION_FILTER_TIP`/`*_FIELD_NAME` set).

Expected: behaves exactly as before — writes to `dist/clients/isogreen/`, still
filters on `Tip` + `Postat?`, still writes to the `YouTube`/`Facebook`/`Instagram`/
`TikTok` fields, dashboard still shows "ISOGREEN".

---

## Task 9: Multi-client GitHub Actions workflow + secrets

**Files:**
- Modify: `.github/workflows/sync.yml`

**Interfaces:**
- Consumes: `CLIENT_SLUG`, `CLIENT_NAME`, `NOTION_FILTER_TIP`, `YT_FIELD_NAME`,
  `FB_FIELD_NAME`, `IG_FIELD_NAME`, `TT_FIELD_NAME` (Task 1's `getConfig()` env vars),
  `npm run build:clients-index` (Task 6), Miradex's database IDs from Task 7.
- Produces: two jobs, `sync` (matrix over `client: [isogreen, miradex]`) and
  `publish` (`needs: sync`), replacing the single `sync` job.

The workflow YAML change has no automated test (this repo has no YAML-linting
tooling) — verification is a syntax read-through here, plus an actual
`workflow_dispatch` run on a branch before merging to `main`, in Task 10.

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `.github/workflows/sync.yml` with:

```yaml
name: Daily sync + dashboard deploy

on:
  schedule:
    # 04:00 UTC ~= 6am Europe/Bucharest (EET, UTC+2) in winter / 7am (EEST,
    # UTC+3) in summer. GitHub Actions cron doesn't follow DST, so this
    # drifts by an hour for half the year - not worth extra complexity for
    # a once-a-day analytics sync.
    - cron: '0 4 * * *'
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        client: [isogreen, miradex]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install

      - name: Run sync
        env:
          CLIENT_SLUG: ${{ matrix.client }}
          CLIENT_NAME: ${{ matrix.client == 'isogreen' && 'ISOGREEN' || 'MIRADEX' }}
          NOTION_FILTER_TIP: ${{ matrix.client == 'isogreen' && 'true' || 'false' }}
          YT_FIELD_NAME: ${{ matrix.client == 'miradex' && 'V7Z - Yt Shorts' || 'YouTube' }}
          FB_FIELD_NAME: ${{ matrix.client == 'miradex' && 'V7Z - Fb' || 'Facebook' }}
          IG_FIELD_NAME: ${{ matrix.client == 'miradex' && 'V7Z - Insta' || 'Instagram' }}
          TT_FIELD_NAME: ${{ matrix.client == 'miradex' && 'V7Z - TikTok' || 'TikTok' }}
          # Shared across clients - same Google Cloud project / Notion integration / Zernio account.
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          ZERNIO_API_KEY: ${{ secrets.ZERNIO_API_KEY }}
          # Per-client - looked up as <CLIENT>_<NAME> from repo secrets.
          NOTION_DATABASE_ID: ${{ secrets[format('{0}_NOTION_DATABASE_ID', matrix.client)] }}
          CHANNEL_HANDLE: ${{ secrets[format('{0}_CHANNEL_HANDLE', matrix.client)] }}
          FB_PAGE_ID: ${{ secrets[format('{0}_FB_PAGE_ID', matrix.client)] }}
          FB_PAGE_ACCESS_TOKEN: ${{ secrets[format('{0}_FB_PAGE_ACCESS_TOKEN', matrix.client)] }}
          ZERNIO_TIKTOK_ACCOUNT_ID: ${{ secrets[format('{0}_ZERNIO_TIKTOK_ACCOUNT_ID', matrix.client)] }}
          CHANNEL_STATS_DATABASE_ID: ${{ secrets[format('{0}_CHANNEL_STATS_DATABASE_ID', matrix.client)] }}
          MONTHLY_VIEWS_DATABASE_ID: ${{ secrets[format('{0}_MONTHLY_VIEWS_DATABASE_ID', matrix.client)] }}
          DAILY_VIEWS_DATABASE_ID: ${{ secrets[format('{0}_DAILY_VIEWS_DATABASE_ID', matrix.client)] }}
          FOLLOWER_SNAPSHOTS_DATABASE_ID: ${{ secrets[format('{0}_FOLLOWER_SNAPSHOTS_DATABASE_ID', matrix.client)] }}
          YOUTUBE_OAUTH_CLIENT_ID: ${{ secrets[format('{0}_YOUTUBE_OAUTH_CLIENT_ID', matrix.client)] }}
          YOUTUBE_OAUTH_CLIENT_SECRET: ${{ secrets[format('{0}_YOUTUBE_OAUTH_CLIENT_SECRET', matrix.client)] }}
          YOUTUBE_REFRESH_TOKEN: ${{ secrets[format('{0}_YOUTUBE_REFRESH_TOKEN', matrix.client)] }}
        run: npm run sync

      - name: Upload dashboard build
        uses: actions/upload-artifact@v4
        with:
          name: dashboard-${{ matrix.client }}
          path: dist/clients/${{ matrix.client }}

  publish:
    needs: sync
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install

      - name: Download all client builds
        uses: actions/download-artifact@v4
        with:
          path: dist/clients
          pattern: dashboard-*

      # download-artifact writes each artifact into its own dashboard-<client>
      # folder under the given path - rename those to dist/clients/<client>/
      # to match what buildClientsIndex (and the deploy step below) expect.
      - name: Flatten downloaded artifacts into dist/clients/<client>/
        run: |
          for d in dist/clients/dashboard-*; do
            client="${d#dist/clients/dashboard-}"
            mv "$d" "dist/clients/$client"
          done

      - name: Build clients index
        run: npm run build:clients-index

      # SiteBunker's firewall blocks inbound connections from GitHub Actions'
      # IP ranges (confirmed: both a fresh FTP account and SSH port 22 timed
      # out at the raw TCP level, not an auth rejection). So instead of
      # pushing files onto the server, publish the built output to a small
      # public repo that a cPanel cron job on the server pulls from - that
      # direction (server -> github.com) isn't blocked.
      #
      # Clones the existing repo and overlays this run's dist/clients/ on
      # top rather than wiping and replacing it wholesale - a thumbnails-
      # only backfill run doesn't rebuild index.html, and force-pushing a
      # fresh tree each time would delete it from the public repo.
      - name: Publish built dashboard to public output repo
        run: |
          git clone -q "https://x-access-token:${DASHBOARD_REPO_PAT}@github.com/4642337DSC/isogreen-dailies-dashboard.git" /tmp/dashboard-repo
          cp -r dist/clients/. /tmp/dashboard-repo/
          cd /tmp/dashboard-repo
          git config user.email "actions@github.com"
          git config user.name "github-actions"
          git add -A
          git diff --cached --quiet || git commit -q -m "Deploy dashboard $(date -u +%Y-%m-%dT%H:%M:%SZ)"
          git push -q origin main
        env:
          DASHBOARD_REPO_PAT: ${{ secrets.DASHBOARD_REPO_PAT }}
```

- [ ] **Step 2: Read the file back and check indentation/structure**

Open `.github/workflows/sync.yml` and confirm: consistent 2-space indentation
throughout, no tabs, the `sync` job's `strategy.matrix.client` list has exactly
`[isogreen, miradex]`, and the `publish` job's `needs: sync` line is present.

- [ ] **Step 3: Add GitHub repo secrets**

In the repo's Settings > Secrets and variables > Actions, add:

Per-client, prefixed `ISOGREEN_` — copy today's existing unprefixed secret values
(this workflow no longer reads the unprefixed names for these):
`ISOGREEN_NOTION_DATABASE_ID`, `ISOGREEN_CHANNEL_HANDLE`, `ISOGREEN_FB_PAGE_ID`,
`ISOGREEN_FB_PAGE_ACCESS_TOKEN`, `ISOGREEN_ZERNIO_TIKTOK_ACCOUNT_ID`,
`ISOGREEN_CHANNEL_STATS_DATABASE_ID`, `ISOGREEN_MONTHLY_VIEWS_DATABASE_ID`,
`ISOGREEN_DAILY_VIEWS_DATABASE_ID`, `ISOGREEN_FOLLOWER_SNAPSHOTS_DATABASE_ID`,
`ISOGREEN_YOUTUBE_OAUTH_CLIENT_ID`, `ISOGREEN_YOUTUBE_OAUTH_CLIENT_SECRET`,
`ISOGREEN_YOUTUBE_REFRESH_TOKEN`.

Per-client, prefixed `MIRADEX_` — from Task 7 and Task 8's `.env`:
`MIRADEX_NOTION_DATABASE_ID` (the Short Form database ID),
`MIRADEX_CHANNEL_HANDLE`, `MIRADEX_CHANNEL_STATS_DATABASE_ID`,
`MIRADEX_MONTHLY_VIEWS_DATABASE_ID`, `MIRADEX_DAILY_VIEWS_DATABASE_ID`,
`MIRADEX_FOLLOWER_SNAPSHOTS_DATABASE_ID`. Leave `MIRADEX_FB_PAGE_ID`,
`MIRADEX_FB_PAGE_ACCESS_TOKEN`, `MIRADEX_ZERNIO_TIKTOK_ACCOUNT_ID`,
`MIRADEX_YOUTUBE_OAUTH_*` unset for now — YouTube-only rollout, the pipeline skips
platforms with unset credentials.

Shared, unchanged: `YOUTUBE_API_KEY`, `NOTION_TOKEN`, `ZERNIO_API_KEY`,
`DASHBOARD_REPO_PAT`.

Done when: every secret listed above exists (Miradex's optional ones intentionally
excepted) and the `ISOGREEN_*` values match what the old unprefixed secrets held.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sync.yml
git commit -m "ci: split sync workflow into a per-client matrix plus a shared publish job"
```

- [ ] **Step 5: Delete the now-unused unprefixed per-client secrets**

Once Task 10's verification confirms the new workflow runs clean, delete the old
unprefixed `NOTION_DATABASE_ID`, `CHANNEL_HANDLE`, `FB_PAGE_ID`,
`FB_PAGE_ACCESS_TOKEN`, `ZERNIO_TIKTOK_ACCOUNT_ID`, `CHANNEL_STATS_DATABASE_ID`,
`MONTHLY_VIEWS_DATABASE_ID`, `DAILY_VIEWS_DATABASE_ID`,
`FOLLOWER_SNAPSHOTS_DATABASE_ID`, `YOUTUBE_OAUTH_CLIENT_ID`,
`YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` secrets — the new workflow
doesn't reference them.

Done when: only the `ISOGREEN_*`/`MIRADEX_*`/shared secrets remain.

---

## Task 10: Push, trigger the workflow, and verify the live site

**Files:** none (verification only)

- [ ] **Step 1: Push the branch and trigger the workflow manually**

Push the branch with all of Tasks 1–9's commits, open the Actions tab, run
"Daily sync + dashboard deploy" via `workflow_dispatch`. Watch both matrix jobs
(`sync (isogreen)`, `sync (miradex)`) and the `publish` job complete successfully.

Expected: `publish` job's log shows `Clients index written to .../dist/clients/index.html (2 client(s): isogreen, miradex)`.

- [ ] **Step 2: Verify the live site**

Once the publish job has pushed to the output repo and SiteBunker's cron has pulled
(may take up to the cron's interval), check:
- `https://upfilm.ro/clients/miradex/` loads Miradex's dashboard.
- `https://upfilm.ro/clients/` lists both `ISOGREEN` and `MIRADEX`, and both links work.

If `upfilm.ro/clients/miradex/` 404s despite the output repo showing a `miradex/`
folder (check via the output repo's GitHub page directly), the SiteBunker cPanel cron
job is likely pulling a fixed/whitelisted folder list rather than the whole repo —
that needs a one-line fix in the cron job config on the server, outside this repo.

Done when: both URLs above work as expected.
