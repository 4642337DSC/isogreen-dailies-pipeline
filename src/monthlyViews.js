import { writeMonthlyViews } from './notion.js';
import { syncInstagramMonthly } from './instagram.js';
import { syncFacebookMonthly } from './facebook.js';
import { syncYouTubeMonthly } from './youtubeAnalytics.js';

export { writeMonthlyViews };

// ===== Monthly views (real Analytics/Insights APIs, NOT summed shorts) =====
// Writes one row per platform per calendar month to the "Monthly Views"
// Notion database (MONTHLY_VIEWS_DATABASE_ID), covering the full history
// since the earliest tracked post (ctx.oldestDate) rather than a fixed
// lookback window. Each platform is sourced from that platform's own
// historical Analytics/Insights endpoint - not by adding up the views of
// shorts posted in that month - so it reflects when views actually
// happened, including late/ongoing views on older posts.
//
// TikTok is intentionally excluded: it has no monthly-capable API at all -
// its old snapshot-derived estimate was removed as unreliable. It waits
// until a real monthly source exists (see scripts/backfill-tiktok-monthly.js
// for the manual-paste stopgap in the meantime).
export async function syncMonthlyViews(cfg, ctx) {
  if (!cfg.MONTHLY_VIEWS_DATABASE_ID) return;

  if (ctx.ytEnabled) {
    try {
      var ytMonthly = await syncYouTubeMonthly(cfg, ctx.oldestDate);
      if (ytMonthly) await writeMonthlyViews(cfg, 'YouTube', 'youtube-analytics-api', ytMonthly);
    } catch (e) { console.log('YouTube monthly sync failed: ' + e); }
  }

  if (ctx.fbEnabled) {
    try {
      var igMonthly = await syncInstagramMonthly(cfg, ctx.oldestDate);
      if (igMonthly) await writeMonthlyViews(cfg, 'Instagram', 'instagram-insights-api', igMonthly);
    } catch (e) { console.log('Instagram monthly sync failed: ' + e); }

    try {
      var fbMonthly = await syncFacebookMonthly(cfg, ctx.oldestDate);
      if (fbMonthly) await writeMonthlyViews(cfg, 'Facebook', 'facebook-insights-api', fbMonthly);
    } catch (e) { console.log('Facebook monthly sync failed: ' + e); }
  }
}
