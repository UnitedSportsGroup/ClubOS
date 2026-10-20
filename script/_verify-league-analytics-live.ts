/**
 * MFL Analytics — Lifetime + Acquisition endpoints, against a DEPLOYED ClubOS,
 * as ORDINARY staff (never the super admin).
 *
 *   npx tsx --env-file=.env script/_verify-league-analytics-live.ts
 *   VERIFY_BASE=https://app.usg.co.nz (default)
 *
 * Four throwaway accounts, deleted at the end:
 *   mfl-staff   MFL team_member holding ONLY the analytics tab — the realistic grant
 *   mfl-other   MFL team_member with a different tab and not this one
 *   mfl-admin   MFL admin (sees every MFL tab)
 *   cufc-admin  admin of Christchurch United only
 *
 * Proves: the gates (401 / 400 / 403 / 404), that staff and admin see the
 * same numbers, that the closed-term figures still match the 20 Oct 2026
 * build (369+ teams, 18 terms), and that blanks are null, never 0.
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const MFL = "mini-football-leagues";
const CUFC = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const created: number[] = [];

async function account(tag: string, workspace: string, role: string, tabs: string[] | null): Promise<string> {
  const email = `_mflltv_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `M${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1, 'Analytics', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  created.push(rows[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [workspace]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, $3, $4)`,
    [rows[0].id, org[0].id, role, tabs == null ? null : JSON.stringify(tabs)]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login for ${tag} failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") || "").split(";")[0];
}

const call = (cookie: string | null, path: string, workspace: string | null) =>
  fetch(`${BASE}/api/admin/league/analytics/${path}`, {
    headers: { ...(cookie ? { cookie } : {}), ...(workspace ? { "X-Workspace-Slug": workspace } : {}) },
  });

async function main() {
  console.log(`\nMFL Analytics Lifetime / Acquisition — who can open it, on ${BASE}\n`);
  const anon = await call(null, "lifetime", MFL);
  ok("signed out → 401", anon.status === 401, `HTTP ${anon.status}`);

  const staff = await account("staff", MFL, "team_member", ["analytics"]);
  const other = await account("other", MFL, "team_member", ["teams"]);
  const admin = await account("admin", MFL, "admin", null);
  const cufc = await account("cufc", CUFC, "admin", null);

  console.log("\nGates");
  for (const p of ["lifetime", "acquisition"]) {
    const noHeader = await call(staff, p, null);
    ok(`${p}: no workspace header → 400`, noHeader.status === 400, `HTTP ${noHeader.status}`);
    const o = await call(other, p, MFL);
    ok(`${p}: MFL staff without the Analytics tab → 403`, o.status === 403, `HTTP ${o.status}`);
    const fromCufc = await call(cufc, p, CUFC);
    ok(`${p}: an admin of another workspace, from that workspace → 404`, fromCufc.status === 404, `HTTP ${fromCufc.status}`);
    const cufcIntoMfl = await call(cufc, p, MFL);
    ok(`${p}: an admin of another workspace, claiming MFL → 403`, cufcIntoMfl.status === 403, `HTTP ${cufcIntoMfl.status}`);
  }
  const badTerm = await call(staff, "lifetime?term=2099-T9", MFL);
  ok("an unknown term → 400", badTerm.status === 400, `HTTP ${badTerm.status}`);

  console.log("\nOrdinary staff with the tab get the data (first build may take ~20s)");
  const t0 = Date.now();
  const lr = await call(staff, "lifetime?scenario=all&term=all", MFL);
  ok("lifetime → 200 for ordinary staff", lr.status === 200, `HTTP ${lr.status}, ${Date.now() - t0}ms`);
  const L: any = lr.ok ? await lr.json() : null;
  const t1 = Date.now();
  const ar = await call(staff, "acquisition?term=all", MFL);
  ok("acquisition → 200 for ordinary staff", ar.status === 200, `HTTP ${ar.status}, ${Date.now() - t1}ms`);
  const A: any = ar.ok ? await ar.json() : null;
  const bb = await call(staff, "lifetime?scenario=backbone&term=2026-T4", MFL);
  ok("lifetime backbone for one term → 200", bb.status === 200, `HTTP ${bb.status}`);

  console.log("\nThe same numbers for everyone who can see them");
  const La: any = await (await call(admin, "lifetime?scenario=all&term=all", MFL)).json();
  ok("admin and ordinary staff see identical lifetime figures",
    JSON.stringify({ ...La, generatedAt: 0 }) === JSON.stringify({ ...L, generatedAt: 0 }));

  console.log("\nThe numbers themselves");
  if (L) {
    ok("18+ terms with data, 369+ team identities", L.totals.dataTerms >= 18 && L.totals.identities >= 369, `${L.totals.dataTerms} terms · ${L.totals.identities} teams · ${L.totals.teamTerms} team-terms`);
    const t23 = L.retention.find((r: any) => r.term === "2023-T3");
    ok("a closed term is unchanged (Term 3 2023: 33 teams, 6 of 30 came back)", t23?.teams === 33 && t23?.cameBack === 6 && t23?.prevTeams === 30);
    ok("an empty term reads null, not 0 (Term 2 2022)", L.retention.find((r: any) => r.term === "2022-T2")?.rate === null);
    const f5 = L.formats.find((f: any) => f.format === "5s"), f7 = L.formats.find((f: any) => f.format === "7s");
    ok("5s and 7s each carry list, contracted and paid", [f5, f7].every((f: any) => f?.avgListCents > 0 && f?.avgContractedCents > 0 && f?.avgPaidClubosCents > 0));
    ok("a format with no ClubOS entries has no list price (null, not 0)", L.formats.filter((f: any) => f.clubosEntries === 0).every((f: any) => f.avgListCents === null));
    console.log(`        stay ${L.stay.all.mean} (median ${L.stay.all.median}) · LTV $${(L.ltv.meanRevenueCents / 100).toFixed(0)} · LTGP $${(L.ltv.meanLtgpCents / 100).toFixed(0)} · forward $${(L.ltv.forwardLtgpCents / 100).toFixed(0)}`);
  }
  if (A) {
    const early = A.rows.find((r: any) => r.term === "2024-T4");
    ok("a term before the hub's data reads null spend, not $0 (Term 4 2024)", early && early.spendCents === null && early.cacCents === null);
    ok("Ballers spend is kept out of team CAC", A.rows.every((r: any) => r.campaigns.every((c: any) => !/ballers/i.test(c.name))));
    ok("first-touch mix is read from visitor history", A.firstTouch.registrationsWithHistory > 0, `${A.firstTouch.registrationsWithHistory} of ${A.firstTouch.registrationsTotal}`);
    console.log(`        ${A.rows.filter((r: any) => r.cacCents != null).map((r: any) => `${r.term} CAC $${(r.cacCents / 100).toFixed(2)}`).join(" · ")}`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const id of created) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
