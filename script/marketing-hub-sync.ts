/**
 * Run the Marketing hub pull once, from a terminal — the SAME code the server's
 * six-hourly schedule runs (server/marketing-hub/sync.ts), so a verification
 * here is a verification of production's puller rather than of a copy.
 *
 *   MARKETING_GA4_SA_JSON_B64=… META_MARKETING_TOKEN=… META_SOCIAL_ACCESS_TOKEN=… \
 *     npx tsx --env-file=.env script/marketing-hub-sync.ts [--platform ga4] [--source 7]
 *
 * It writes to whatever DATABASE_URL points at, and records each account's pull
 * in marketing_sync_runs with trigger 'script'. Exit code 1 if any account failed.
 */
import { isPlatformKey } from "@shared/marketing-hub";
import { runMarketingSync } from "../server/marketing-hub/sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const platformArg = arg("platform");
  const sourceArg = arg("source");
  if (platformArg && !isPlatformKey(platformArg)) throw new Error(`Unknown platform "${platformArg}"`);
  const started = Date.now();
  const r = await runMarketingSync("script", {
    platform: platformArg && isPlatformKey(platformArg) ? platformArg : undefined,
    sourceId: sourceArg ? Number(sourceArg) : undefined,
  });
  if (!r.ran) {
    console.log(`\n  Not run: ${r.reason}\n`);
    process.exit(2);
  }
  console.log("");
  for (const x of r.results) {
    const mark = x.status === "ok" ? "✓" : x.status === "skipped" ? "–" : "✗";
    console.log(`  ${mark} #${x.sourceId} ${x.label.padEnd(36)} ${String(x.rows).padStart(6)} values  ${x.error ?? ""}`);
  }
  const failed = r.results.filter((x) => x.status === "error").length;
  console.log(`\n  ${r.results.length} accounts in ${Math.round((Date.now() - started) / 1000)}s, ${failed} failed.\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
