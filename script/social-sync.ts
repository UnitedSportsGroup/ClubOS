/**
 * Run the social media pull once, from a terminal — the SAME code the server's
 * six-hourly schedule runs (server/social/sync.ts).
 *
 *   META_SOCIAL_ACCESS_TOKEN=… npx tsx --env-file=.env script/social-sync.ts
 *       [--account 7] [--insights 4000] [--full]
 *
 * --insights  how many posts per account may have their per-post insights read
 *             in this run (the server's schedule uses 150).
 * --full      re-list every post from the beginning, not just the newest.
 *
 * Writes to whatever DATABASE_URL points at; every account's pull is a row in
 * social_sync_runs with trigger 'script'. Exit code 1 if any account failed.
 */
import { runSocialSync } from "../server/social/sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const started = Date.now();
  const r = await runSocialSync("script", {
    accountId: arg("account") ? Number(arg("account")) : undefined,
    insightBudget: arg("insights") ? Number(arg("insights")) : undefined,
    fullHistory: process.argv.includes("--full"),
  });
  if (!r.ran) {
    console.log(`\n  Not run: ${r.reason}\n`);
    process.exit(1);
  }
  if (r.discovered) console.log(`\n  Found ${r.discovered.found} Meta accounts (${r.discovered.added} new).`);
  for (const x of r.results) {
    console.log(`  ${x.status === "ok" ? "✓" : x.status === "skipped" ? "–" : "✗"} ${x.label.padEnd(44)} ${String(x.posts).padStart(5)} posts${x.error ? `  ${x.error}` : ""}`);
  }
  console.log(`\n  ${Math.round((Date.now() - started) / 1000)}s\n`);
  process.exit(r.results.some((x) => x.status === "error") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
