/**
 * Rambo's label search, run from a laptop against a handful of posts, printing
 * what it suggested beside each caption — for judging accuracy before a real run.
 *
 *   npx tsx --env-file=<root .env with ANTHROPIC_API_KEY> --env-file=.env script/_probe-social-labels.ts cufc 2026 12 instagram
 *
 * It writes real suggestions (unconfirmed, so nothing is counted).
 */
import { labelFindState, startLabelRun } from "../server/social/label-finder";
import { pool } from "../server/db";

const [brand = "cufc", year = "2026", n = "12", platforms = "instagram"] = process.argv.slice(2);
(async () => {
  const scope = { brand, year, platforms: platforms.split(",") };
  const started = await startLabelRun(scope, null, Number(n));
  if ("error" in started) throw new Error(started.error);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await labelFindState(scope);
    console.log(`  ${s.run?.status} ${s.run?.done}/${s.run?.total} · ${s.run?.suggested} suggestions · US$${((s.run?.cents ?? 0) / 100).toFixed(3)}${s.run?.error ? ` · ${s.run.error}` : ""}`);
    if (s.run?.status !== "running") break;
  }
  const { rows } = await pool.query(
    `SELECT p.id, left(replace(coalesce(p.caption,''), E'\\n', ' '), 70) AS caption, p.kind, p.permalink,
            (SELECT string_agg(l.name || ' — ' || coalesce(pl.reason,''), E'\\n      ') FROM social_post_labels pl JOIN social_labels l ON l.id = pl.label_id WHERE pl.post_id = p.id) AS labels
     FROM social_posts p WHERE p.label_checked_at > now() - interval '15 minutes' ORDER BY p.posted_at DESC LIMIT $1`,
    [Number(n)],
  );
  for (const r of rows) console.log(`\n#${r.id} [${r.kind}] ${r.caption}\n   ${r.permalink}\n   → ${r.labels ?? "(nothing)"}`);
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
