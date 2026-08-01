import { writeMonthlyViews } from './notion.js';
import { syncYouTubeMonthly } from './youtube.js';
import { syncInstagramMonthly } from './instagram.js';
import { syncFacebookMonthly } from './facebook.js';
import { syncTikTokSnapshotAndMonthly } from './tiktok.js';

export { writeMonthlyViews };

// ===== Monthly views (real Analytics/Insights APIs, NOT summed shorts) =====
// Writes one row per platform per calendar month to the "Monthly Views"
// Notion database (MONTHLY_VIEWS_DATABASE_ID). Each platform is sourced
// from that platform's own historical Analytics/Insights endpoint - not by
// adding up the views of shorts posted in that month - so it reflects when
// views actually happened, including late/ongoing views on older posts.
//
// Per-platform status: YouTube needs the YouTube Analytics API wired up
// (see src/youtube.js - currently a stub); Instagram/Facebook are live off
// FB_PAGE_ACCESS_TOKEN; TikTok has no such API at all, so its numbers are
// derived from daily total-views snapshots (see src/tiktok.js).
export async function syncMonthlyViews(cfg, ctx) {
  if (!cfg.MONTHLY_VIEWS_DATABASE_ID) return;

  try {
    var ytMonthly = await syncYouTubeMonthly(cfg);
    if (ytMonthly) await writeMonthlyViews(cfg, 'YouTube', 'youtube-analytics-api', ytMonthly);
  } catch (e) { console.log('YouTube monthly sync failed: ' + e); }

  if (ctx.fbEnabled) {
    try {
      var igMonthly = await syncInstagramMonthly(cfg);
      if (igMonthly) await writeMonthlyViews(cfg, 'Instagram', 'instagram-insights-api', igMonthly);
    } catch (e) { console.log('Instagram monthly sync failed: ' + e); }

    try {
      var fbMonthly = await syncFacebookMonthly(cfg);
      if (fbMonthly) await writeMonthlyViews(cfg, 'Facebook', 'facebook-insights-api', fbMonthly);
    } catch (e) { console.log('Facebook monthly sync failed: ' + e); }
  }

  if (ctx.tiktokEnabled && cfg.TIKTOK_SNAPSHOT_DATABASE_ID && ctx.tt) {
    try {
      await syncTikTokSnapshotAndMonthly(cfg, ctx.tt);
    } catch (e) { console.log('TikTok snapshot/monthly sync failed: ' + e); }
  }
}
