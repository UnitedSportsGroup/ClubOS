/**
 * Marketing hub schedule: pull Google Analytics and Meta every six hours.
 *
 * Off unless MARKETING_HUB_SYNC=1, so a deploy never starts calling outside
 * platforms unprompted (the Xero autopost / Sporty doctrine). Both Fly
 * machines run this; the lease in sync.ts lets one of them pull.
 */
import { runMarketingSync } from "./sync";

const INTERVAL_MS = 6 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 4 * 60 * 1000;

let started = false;

async function tick() {
  try {
    const r = await runMarketingSync("schedule");
    if (!r.ran) return;
    const failed = r.results.filter((x) => x.status === "error").length;
    const rows = r.results.reduce((s, x) => s + x.rows, 0);
    console.log(`[MarketingHub] Pulled ${r.results.length} sources, ${rows} values, ${failed} failed.`);
  } catch (e: any) {
    console.error("[MarketingHub] Sync crashed:", e?.message ?? e);
  }
}

export function startMarketingHubCron(): void {
  if (started) return;
  started = true;
  if (process.env.MARKETING_HUB_SYNC !== "1") {
    console.log("[MarketingHub] Not scheduled — set MARKETING_HUB_SYNC=1 to pull Google Analytics and Meta.");
    return;
  }
  setTimeout(() => void tick(), BOOT_DELAY_MS);
  setInterval(() => void tick(), INTERVAL_MS);
  console.log("[MarketingHub] Marketing data pull scheduled (every 6h).");
}
