import { writeMonthlyViews } from './notion.js';
import { syncInstagramMonthly } from './instagram.js';
import { syncFacebookMonthly } from './facebook.js';

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
// YouTube and TikTok are intentionally excluded: YouTube has no monthly API
// wired up yet (needs the YouTube Analytics API), and TikTok has no
// monthly-capable API at all - its old snapshot-derived estimate was
// removed as unreliable. Both wait until a real per-platform monthly
// source exists.
export async function syncMonthlyViews(cfg, ctx) {
  if (!cfg.MONTHLY_VIEWS_DATABASE_ID || !ctx.fbEnabled) return;

  try {
    var igMonthly = await syncInstagramMonthly(cfg, ctx.oldestDate);
    if (igMonthly) await writeMonthlyViews(cfg, 'Instagram', 'instagram-insights-api', igMonthly);
  } catch (e) { console.log('Instagram monthly sync failed: ' + e); }

  try {
    var fbMonthly = await syncFacebookMonthly(cfg, ctx.oldestDate);
    if (fbMonthly) await writeMonthlyViews(cfg, 'Facebook', 'facebook-insights-api', fbMonthly);
  } catch (e) { console.log('Facebook monthly sync failed: ' + e); }
}
