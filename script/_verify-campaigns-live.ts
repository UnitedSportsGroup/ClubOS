/**
 * Campaigns — prove on PRODUCTION that the right people can use it, that a
 * campaign's numbers are ClubOS's own sales (checked against the database
 * directly), and that bad input is refused.
 *
 *   npx tsx --env-file=.env script/_verify-campaigns-live.ts
 *
 * Signs in as ORDINARY staff. Everything it makes is named "_probe …" and
 * removed at the end with the throwaway logins.
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const USG = "united-sports-group";
const MFL = "mini-football-leagues";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

const created: number[] = [];

async function account(tag: string, workspace: string, role: string, tabs: string[] | null): Promise<string> {
  const email = `_cmp_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `M${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1, 'Social', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  created.push(rows[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [workspace]);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, $3, $4)`,
    [rows[0].id, org[0].id, role, tabs == null ? null : JSON.stringify(tabs)],
  );
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login for ${tag} failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") || "").split(";")[0];
}

const call = (cookie: string | null, path: string, workspace: string | null, init: RequestInit = {}) =>
  fetch(`${BASE}/api/admin/${path}`, {
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(workspace ? { "X-Workspace-Slug": workspace } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const json = (b: unknown) => JSON.stringify(b);

async function main() {
  console.log(`\nCampaigns — on ${BASE}\n`);
  ok("signed out → 401", (await call(null, "campaigns", USG)).status === 401);
  const staff = await account("usg_staff", USG, "team_member", ["campaign-planner"]);
  const other = await account("usg_other", USG, "team_member", ["calendar"]);
  const mfl = await account("mfl_admin", MFL, "admin", null);

  console.log("Gates");
  ok("no workspace header → 400", (await call(staff, "campaigns", null)).status === 400);
  ok("staff without the tab → 403", (await call(other, "campaigns", USG)).status === 403);
  ok("…and cannot create one", (await call(other, "campaigns", USG, { method: "POST", body: json({ name: "_probe x" }) })).status === 403);
  ok("an admin of another workspace, from that workspace → 404", (await call(mfl, "campaigns", MFL)).status === 404);
  ok("ordinary staff with the tab → 200", (await call(staff, "campaigns", USG)).status === 200);
  const opts = await (await call(staff, "campaigns/options", USG)).json();
  ok("the things to link are offered", opts.programmes?.length > 5 && opts.metaCampaigns?.length > 5 && opts.emailCampaigns?.length > 5, `${opts.programmes?.length} programmes, ${opts.metaCampaigns?.length} ad campaigns, ${opts.emailCampaigns?.length} emails`);
  ok("no email address is offered as a person", !JSON.stringify(opts.people ?? []).includes("@"));

  console.log("\nA campaign's result is ClubOS's own sales");
  // The two programmes with the most paid bookings in the last 60 days.
  const { rows: top } = await pool.query(
    `SELECT program_id FROM registrations WHERE status IN ('confirmed','refunded','partially_refunded')
       AND registered_at > now() - interval '60 days' AND program_id IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 2`);
  const programIds = top.map((r) => r.program_id);
  const from = "2026-09-15";
  const made = await call(staff, "campaigns", USG, { method: "POST", body: json({ name: `_probe live ${Date.now()}`, brand: "cufc", status: "live", startsOn: from, goalSignups: 10, goalRevenueCents: 100000, programIds }) });
  const id = made.ok ? (await made.json()).id : null;
  ok("a campaign can be created", made.status === 201 && Number.isInteger(id), `HTTP ${made.status}`);
  if (!id) return;
  const { rows: [truth] } = await pool.query(
    `SELECT count(*)::int AS n, COALESCE(sum(COALESCE(total_cents,0) - COALESCE(refunded_amount_cents,0)),0)::bigint AS cents
     FROM registrations r WHERE status IN ('confirmed','refunded','partially_refunded') AND program_id = ANY($1::int[])
       AND (COALESCE(paid_at, registered_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Auckland')::date >= $2::date`, [programIds, from]);
  const { rows: [unpaid] } = await pool.query(`SELECT count(*)::int AS n FROM registrations WHERE status = 'pending' AND program_id = ANY($1::int[])`, [programIds]);
  let d = await (await call(staff, `campaigns/${id}`, USG)).json();
  ok("sign-ups equal the paid bookings in the database", d.result.live === true && d.result.signups === truth.n, `${d.result.signups} vs ${truth.n}`);
  ok("revenue equals what was paid less refunds, to the cent", d.result.revenueCents === Number(truth.cents), `${d.result.revenueCents} vs ${truth.cents}`);
  ok("unpaid checkouts are not counted", unpaid.n === 0 || d.result.signups === truth.n, `${unpaid.n} unpaid exist and are left out`);
  ok("the day-by-day figures add up to the total", d.result.daily.reduce((s: number, x: any) => s + x.signups, 0) === d.result.signups);
  ok("sign-ups by source add up to the total", d.sources.reduce((s: number, x: any) => s + x.signups, 0) === d.result.signups);
  ok("sign-ups by programme add up to the total", d.programmes.reduce((s: number, x: any) => s + x.signups, 0) === d.result.signups);
  ok("no name, email or phone is in the campaign", !/@(gmail|hotmail|outlook|xtra|yahoo|icloud)\.|\+64\d{8}/i.test(JSON.stringify(d)));

  console.log("\nChannels");
  const { rows: [m] } = await pool.query(
    `SELECT d.dim_key, sum(d.value) FILTER (WHERE d.metric = 'spend_cents')::bigint AS spend FROM marketing_daily d
     JOIN marketing_sources s ON s.id = d.source_id WHERE s.platform = 'meta_ads' AND d.dim_type = 'campaign' AND d.day >= $1::date
     GROUP BY 1 HAVING sum(d.value) FILTER (WHERE d.metric = 'spend_cents') > 0 ORDER BY 2 DESC LIMIT 1`, [from]);
  const ch = await call(staff, `campaigns/${id}/channels`, USG, { method: "POST", body: json({ kind: "meta_ads", name: "Ads", status: "live", metaCampaignIds: [m.dim_key] }) });
  ok("an ads channel can be linked to a real ad campaign", ch.status === 201);
  await call(staff, `campaigns/${id}/channels`, USG, { method: "POST", body: json({ kind: "print", name: "Flyers", manualSpendCents: 12345 }) });
  d = await (await call(staff, `campaigns/${id}`, USG)).json();
  const ads = d.channels.find((c: any) => c.kind === "meta_ads");
  ok("its spend is Meta's own figure for the selling window", ads?.stats.spendCents === Number(m.spend) && ads.stats.spendSource === "meta", `${ads?.stats.spendCents} vs ${m.spend}`);
  ok("typed-in spend is marked as typed in", d.channels.find((c: any) => c.kind === "print")?.stats.spendSource === "typed");
  ok("campaign spend is the channels added up", d.spendCents === Number(m.spend) + 12345, String(d.spendCents));
  ok("an unlinked number is blank, not zero", d.channels.find((c: any) => c.kind === "print")?.stats.signups === null);

  console.log("\nTimeline");
  ok("a plan needs a date to count back from", (await call(staff, `campaigns/${id}/suggest-timeline`, USG, { method: "POST" })).status === 400);
  await call(staff, `campaigns/${id}`, USG, { method: "PATCH", body: json({ eventStartsOn: "2027-06-01", eventEndsOn: "2027-06-03" }) });
  const s1 = await (await call(staff, `campaigns/${id}/suggest-timeline`, USG, { method: "POST" })).json();
  const s2 = await (await call(staff, `campaigns/${id}/suggest-timeline`, USG, { method: "POST" })).json();
  ok("a suggested plan is added once", s1.added > 5 && s2.added === 0, `${s1.added} then ${s2.added}`);
  d = await (await call(staff, `campaigns/${id}`, USG)).json();
  const task = d.tasks[0];
  await call(staff, `campaigns/${id}/tasks/${task.id}`, USG, { method: "PATCH", body: json({ done: true, doneBy: 1 }) });
  d = await (await call(staff, `campaigns/${id}`, USG)).json();
  ok("ticking a task records who did it from the login, not the request", d.tasks.find((t: any) => t.id === task.id)?.doneByName === "Marketing Probe" || d.tasks.find((t: any) => t.id === task.id)?.doneByName === "Social Probe", d.tasks.find((t: any) => t.id === task.id)?.doneByName);

  console.log("\nSplit tests");
  const t = await call(staff, `campaigns/${id}/tests`, USG, { method: "POST", body: json({ name: "Headline" }) });
  const testId = (await t.json()).id;
  d = await (await call(staff, `campaigns/${id}`, USG)).json();
  const test = d.tests.find((x: any) => x.id === testId);
  ok("a new test starts with versions A and B", test?.variants.length === 2 && test.variants[0].label === "A");
  ok("a version with no link shows no numbers, not zeros", test?.variants.every((v: any) => v.visitors === null && v.counted === "none"));
  ok("a test cannot drop below two versions", (await call(staff, `campaigns/${id}/tests/${testId}/variants/${test.variants[0].id}`, USG, { method: "DELETE" })).status === 400);
  ok("a second version called A is refused", (await call(staff, `campaigns/${id}/tests/${testId}/variants`, USG, { method: "POST", body: json({ label: "A" }) })).status === 400);
  ok("a winner from another test is refused", (await call(staff, `campaigns/${id}/tests/${testId}`, USG, { method: "PATCH", body: json({ winnerVariantId: 999999 }) })).status === 400);

  console.log("\nBad input");
  const bad = async (label: string, path: string, method: string, body: unknown, want = 400) =>
    ok(label, (await call(staff, path, USG, { method, body: json(body) })).status === want);
  await bad("a blank name → 400", "campaigns", "POST", { name: "  " });
  await bad("selling that ends before it starts → 400", `campaigns/${id}`, "PATCH", { endsOn: "2026-01-01" });
  await bad("a negative goal → 400", `campaigns/${id}`, "PATCH", { goalSignups: -1 });
  await bad("a programme that does not exist → 400", `campaigns/${id}`, "PATCH", { programIds: [99999999] });
  await bad("an unknown brand → 400", `campaigns/${id}`, "PATCH", { brand: "nope" });
  await bad("an unknown kind of channel → 400", `campaigns/${id}/channels`, "POST", { kind: "nope", name: "x" });
  await bad("a date that is not a date → 400", `campaigns/${id}/tasks`, "POST", { title: "x", dueOn: "tomorrow" });
  await bad("a task on another campaign → 404", `campaigns/999999/tasks/${task.id}`, "PATCH", { done: true }, 404);
  await bad("a campaign that does not exist → 404", "campaigns/999999", "PATCH", { name: "x" }, 404);

  console.log("\nArchive");
  await call(staff, `campaigns/${id}`, USG, { method: "PATCH", body: json({ archived: true }) });
  const list = await (await call(staff, "campaigns", USG)).json();
  const arch = await (await call(staff, "campaigns?archived=1", USG)).json();
  ok("archiving takes it off the list and keeps it in the archive", !list.campaigns.some((c: any) => c.id === id) && arch.campaigns.some((c: any) => c.id === id));

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.query(`DELETE FROM cmp_campaigns WHERE name LIKE '\\_probe %'`).catch(() => {});
    for (const id of created) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
