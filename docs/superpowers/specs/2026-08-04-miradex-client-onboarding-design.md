# Miradex client onboarding — design

## Goal

Extend the Isogreen-only `isogreen-dailies-pipeline` (YouTube/Facebook/Instagram/TikTok
Short view-sync + Notion dashboard) so it also syncs and publishes a dashboard for a
second client, Miradex, from the same repo, workflow, and output site — without
duplicating the codebase.

## Scope

Full feature parity with Isogreen: core per-Short view sync, thumbnails, audience
(follower) snapshots, monthly views, daily views, and the reports app. Rollout is
staged by platform (see "Rollout order" below), but the code/schema work covers all
four platforms up front so enabling a platform later is just adding secrets.

## Notion schema changes (Miradex "Short Form" database)

Miradex's existing "Short Form" database
(`https://app.notion.com/p/0f35d908eb97407192ea4c5906406187`) differs from Isogreen's
video database:

- No `Tip` multi-select field — not needed, since this database is Shorts-only
  already. The sync filters on `Postat?` alone (no `Tip contains 'Short'` clause).
- No per-platform URL columns. Add four: `YouTube URL`, `Facebook URL`,
  `Instagram URL`, `TikTok URL` — same role as Isogreen's: auto-matching cache for
  YouTube/Facebook/Instagram, manual paste-in cache for TikTok.
- View counts write into the *existing* number fields `V7Z - Yt Shorts`, `V7Z - Fb`,
  `V7Z - Insta`, `V7Z - TikTok` — these are currently empty/unused. The code adapts to
  these names via a config-driven field-name mapping (see below), not by renaming
  Notion columns.

For full feature parity, four more databases need to be created fresh under Miradex in
Notion, the same way they were for Isogreen (via the existing
`npm run backfill:create-daily-views-db` / `backfill:create-follower-snapshots-db`
scripts): Channel Stats, Monthly Views, Daily Views, Follower Snapshots.

## Code changes

- **`sync.js`**: `DIST_DIR` is derived from a `CLIENT_SLUG` env var
  (`dist/clients/${CLIENT_SLUG}`) instead of the hardcoded `'isogreen'`, defaulting to
  `'isogreen'` for backward compatibility.
- **`buildClientsIndex()`** moves out of `sync.js`'s per-client run into a standalone
  step, since it needs to see every client's output directory to build the landing
  page, not just the client that just synced. It runs once, after all clients have
  synced (see workflow section).
- **`config.js`**: stays a flat env-var reader — no client-awareness added here. New
  optional field-name-mapping vars are added with Isogreen-compatible defaults so
  Isogreen needs zero config changes:
  - `YT_FIELD_NAME` (default `'YouTube'`), `FB_FIELD_NAME` (default `'Facebook'`),
    `IG_FIELD_NAME` (default `'Instagram'`), `TT_FIELD_NAME` (default `'TikTok'`).
  - Miradex's workflow env sets these to `V7Z - Yt Shorts` / `V7Z - Fb` /
    `V7Z - Insta` / `V7Z - TikTok`.
- **`notion.js`** (`writeUpdates`) and **`dashboard.js`** (`fetchDashboardRows`): read
  the number-field names from `cfg` (the new `*_FIELD_NAME` vars) instead of the
  hardcoded `'YouTube'`/`'Facebook'`/`'Instagram'`/`'TikTok'` literals.
- **`dashboard.js`/`reports.js`**: otherwise unchanged — both already take `cfg` +
  `DIST_DIR` as parameters.

## GitHub Actions workflow

- The single `sync` job becomes a **matrix job**: `client: [isogreen, miradex]`, each
  running the same steps with `CLIENT_SLUG: ${{ matrix.client }}`.
- **Shared secrets** (reused across both clients, unprefixed): `YOUTUBE_API_KEY`,
  `NOTION_TOKEN`, `ZERNIO_API_KEY`, `DASHBOARD_REPO_PAT`.
- **Per-client secrets** (must differ, looked up dynamically via
  `secrets[format('%s_NOTION_DATABASE_ID', matrix.client)]`): `NOTION_DATABASE_ID`,
  `CHANNEL_HANDLE`, `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, `ZERNIO_TIKTOK_ACCOUNT_ID`,
  `CHANNEL_STATS_DATABASE_ID`, `MONTHLY_VIEWS_DATABASE_ID`, `DAILY_VIEWS_DATABASE_ID`,
  `FOLLOWER_SNAPSHOTS_DATABASE_ID`. Stored as e.g. `ISOGREEN_NOTION_DATABASE_ID` /
  `MIRADEX_NOTION_DATABASE_ID`.
- Each matrix job uploads its `dist/clients/<slug>/` as a build artifact.
- A final `publish` job (`needs: sync`) downloads both artifacts, merges them into one
  `dist/clients/` tree, runs `buildClientsIndex()` once over the combined tree, then
  does the existing clone/commit/push to the public dashboard output repo.
- A client missing credentials for a given platform (e.g. Miradex without
  Facebook/Instagram/TikTok set up yet) just skips that platform — same
  optional-env-var behavior as today. One client's job never blocks the other's.

## Rollout order

Start with YouTube only for Miradex — the only platform with account access already
sorted, and the only one `requireConfig` treats as mandatory. Facebook, Instagram, and
TikTok get wired in later as access to those accounts comes through, each just an
addition of secrets and Notion URL-column values — no further code changes needed.

## Testing

Before touching the shared production workflow/secrets: run
`CLIENT_SLUG=miradex npm run sync` locally against a `.env` pointed at Miradex's
YouTube credentials and Notion database, confirm `dist/clients/miradex/` builds and
the dashboard renders correctly, then wire the matrix job into `sync.yml`.
