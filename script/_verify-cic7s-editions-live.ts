/**
 * Proves, against PRODUCTION, that the 2026 CIC 7's data is in ClubOS, is kept
 * apart from 2027, and is reachable by the mailer.
 *
 * Isaac asked (via Daniel, 2026-09-16) for last year's registrations of interest
 * so the mailer can reach them, separated from this year's, plus the 2026
 * registered teams as historical data.
 *
 * 🔴 Signed in as ORDINARY STAFF, never a super admin — a super admin bypasses
 * the membership checks, so proving it works for Daniel proves nothing about
 * Isaac. 🔴 Every count is asserted against the SOURCE CSVs, not against another
 * API call, so the check cannot agree with the code about a wrong number.
 *
 *   npx tsx --env-file=.env script/_verify-cic7s-editions-live.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-international-cup";
/**
 * 🔴 Walk up to find it. A relative "../../outputs" breaks the moment this runs
 * from a detached worktree — which is exactly what the deploy doctrine tells
 * everyone to use, so the path that looks right is the one that fails in the
 * situation it is needed.
 */
const SRC = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const c = path.join(dir, "outputs/cic7s/2026-import/source");
    if (fs.existsSync(c)) return c;
    // A worktree lives under apps/clubos/.worktrees/<x>; the repo it belongs to
    // is the one holding outputs/, so keep climbing past both.
    dir = path.dirname(dir);
  }
  throw new Error("could not find outputs/cic7s/2026-import/source from " + process.cwd());
})();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift()!.map((h) => h.trim());
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

let tempUserId: number | null = null;
let cookie = "";

async function signInAsStaff() {
  const email = `_cic7s_probe_${Date.now()}@usg.co.nz`;
  const pw = `C${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Cic7s','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  tempUserId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  if (!org.length) throw new Error(`no organisation with slug ${WORKSPACE}`);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`,
    [tempUserId, org[0].id]);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  return org[0].id as number;
}
const asStaff = (p: string, init: RequestInit = {}) =>
  fetch(`${BASE}${p}`, { ...init, headers: { cookie, "X-Workspace-Slug": WORKSPACE, "Content-Type": "application/json", ...(init.headers || {}) } });

async function main() {
  console.log(`\nCIC 7's — 2026 in ClubOS, apart from 2027 — ${BASE}\n`);
  const orgId = await signInAsStaff();

  // ── What the source actually says ─────────────────────────────────────────
  const interest = readCsv(path.join(SRC, "registrations-of-interest.csv"));
  const teams = [
    ...readCsv(path.join(SRC, "teams-mens.csv")),
    ...readCsv(path.join(SRC, "teams-social-masters.csv")),
  ].filter((r) => (r["Team Name"] || "").trim());
  console.log(`The source: ${interest.length} interest submissions · ${teams.length} teams\n`);

  // ── The column, and what it means ─────────────────────────────────────────
  console.log("The edition");
  const { rows: col } = await pool.query(
    `SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_name='cic7s_registrations' AND column_name='edition_year'`);
  ok("cic7s_registrations.edition_year exists", col.length === 1);
  ok("nullable — \"not recorded\" stays a real answer", col[0]?.is_nullable === "YES");
  ok("no default — nothing is filed under an edition by accident", col[0]?.column_default == null);
  const { rows: unfiled } = await pool.query(
    `SELECT count(*)::int n FROM cic7s_registrations WHERE organization_id=$1 AND edition_year IS NULL`, [orgId]);
  ok("every registration on file is placed in an edition", Number(unfiled[0].n) === 0, `${unfiled[0].n} unfiled`);

  // ── The counts, against the SOURCE ────────────────────────────────────────
  console.log("\nWhat landed");
  const { rows: c } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE edition_year=2026)::int AS y26,
       count(*) FILTER (WHERE edition_year=2027)::int AS y27,
       count(*) FILTER (WHERE edition_year=2026 AND team_name IS NOT NULL)::int AS teams26,
       count(*) FILTER (WHERE edition_year=2026 AND team_name IS NULL)::int AS interest26
     FROM cic7s_registrations WHERE organization_id=$1`, [orgId]);
  // 13 of the 25 team managers had already registered interest, so they carry a
  // team on their existing row rather than a second one: 124 + 25 − 13 = 136.
  ok("2026 holds every interest submission plus every team",
    Number(c[0].y26) === interest.length + teams.length - 13, `${c[0].y26} rows (expected ${interest.length + teams.length - 13})`);
  ok(`all ${teams.length} teams are on file`, Number(c[0].teams26) === teams.length, String(c[0].teams26));
  ok("2027 is untouched at 10", Number(c[0].y27) === 10, String(c[0].y27));

  // Every team name in the source is present, by name.
  const { rows: names } = await pool.query(
    `SELECT team_name FROM cic7s_registrations WHERE organization_id=$1 AND edition_year=2026 AND team_name IS NOT NULL`, [orgId]);
  const have = new Set(names.map((r: any) => r.team_name));
  const missing = teams.map((t) => t["Team Name"]).filter((n) => !have.has(n));
  ok("no team from the sheet is missing", missing.length === 0, missing.join(", "));

  // Payment states match the sheet's own booleans — never its money text.
  let wrong = 0;
  for (const t of teams) {
    const expect = /refund/i.test(t["Breakdown"] || "") ? "refunded"
      : t["Full Payment"]?.toUpperCase() === "TRUE" ? "paid"
      : (t["1st Deposit"]?.toUpperCase() === "TRUE" || t["2nd Deposit"]?.toUpperCase() === "TRUE") ? "part_paid" : "unpaid";
    const { rows: r } = await pool.query(
      `SELECT entry_payment FROM cic7s_registrations WHERE organization_id=$1 AND edition_year=2026 AND team_name=$2`, [orgId, t["Team Name"]]);
    if (r[0]?.entry_payment !== expect) { wrong++; console.log(`        ${t["Team Name"]}: ${r[0]?.entry_payment} ≠ ${expect}`); }
  }
  ok("every payment state matches the sheet's own booleans", wrong === 0, `${wrong} wrong`);

  const { rows: money } = await pool.query(
    `SELECT count(*)::int n FROM cic7s_registrations
      WHERE organization_id=$1 AND edition_year=2026 AND entry_payment IS NOT NULL AND team_name IS NULL`, [orgId]);
  ok("no payment state exists without a team (Postgres refuses it)", Number(money[0].n) === 0);

  // ── The tab ───────────────────────────────────────────────────────────────
  console.log("\nThe tab, as ordinary staff");
  const all = await asStaff("/api/admin/cic7s/registrations");
  ok("loads for ordinary staff", all.ok, `HTTP ${all.status}`);
  const allBody: any = all.ok ? await all.json() : {};
  ok("returns both editions in the picker",
    (allBody.editions ?? []).map((e: any) => e.year).sort().join(",") === "2026,2027",
    JSON.stringify((allBody.editions ?? []).map((e: any) => e.year)));

  for (const year of [2026, 2027]) {
    const res = await asStaff(`/api/admin/cic7s/registrations?year=${year}`);
    const body: any = res.ok ? await res.json() : {};
    const rows = body.registrations ?? [];
    ok(`?year=${year} returns only ${year}`,
      rows.length > 0 && rows.every((r: any) => r.editionYear === year), `${rows.length} rows`);
    // 🔴 The picker's count must equal the list it filters to, or the tile is decoration.
    const tile = (body.editions ?? []).find((e: any) => e.year === year)?.count;
    ok(`…and the picker's count agrees with the list (${year})`, tile === rows.length, `tile ${tile} vs list ${rows.length}`);
  }
  // 🔴 The 12 rows created from the registered-teams sheet must be identifiable,
  // because that sheet records no date — their created_at is when the import ran
  // and the page must say "not recorded" rather than print it as a sign-up date.
  const y26 = await asStaff("/api/admin/cic7s/registrations?year=2026");
  const rows26: any[] = y26.ok ? (await y26.json()).registrations ?? [] : [];
  const fromTeamSheet = rows26.filter((r) => r.sourceUrl === "google-sheet:registered-team-contacts-2026");
  ok("the team-sheet rows are identifiable by source", fromTeamSheet.length === 12, `${fromTeamSheet.length}`);
  ok("…and every one of them carries a team", fromTeamSheet.every((r) => r.teamName));
  ok("the interest rows kept their real submission dates",
    rows26.filter((r) => r.sourceUrl === "google-sheet:registrations-of-interest-2026")
          .every((r) => new Date(r.createdAt) < new Date("2026-06-01")),
    "some are dated after the 2026 tournament");

  const bad = await asStaff("/api/admin/cic7s/registrations?year=banana");
  ok("a nonsense year is refused, not ignored", bad.status === 400, `HTTP ${bad.status}`);

  // ── The mailer — the actual ask ───────────────────────────────────────────
  console.log("\nThe mailer");
  const audAll = await asStaff("/api/admin/cic/mailer/contacts?source=7s");
  const aAll: any = audAll.ok ? await audAll.json() : {};
  ok("the 7's audience loads", audAll.ok, `HTTP ${audAll.status}`);
  const a26 = await asStaff("/api/admin/cic/mailer/contacts?source=7s&edition=2026");
  const b26: any = a26.ok ? await a26.json() : {};
  const a27 = await asStaff("/api/admin/cic/mailer/contacts?source=7s&edition=2027");
  const b27: any = a27.ok ? await a27.json() : {};
  ok("2026 is mailable on its own", (b26.total ?? 0) > 100, `${b26.total} contacts`);
  ok("2027 is mailable on its own", (b27.total ?? 0) > 0 && (b27.total ?? 0) < 20, `${b27.total} contacts`);
  ok("the unfiltered audience is at least as big as either year",
    (aAll.total ?? 0) >= Math.max(b26.total ?? 0, b27.total ?? 0), `${aAll.total} total`);
  // 🔴 Deduped by address — twelve 2026 addresses are repeats, so the audience
  // must be SMALLER than the row count or somebody gets the same email twice.
  ok("the audience dedupes by address", (b26.total ?? 0) < Number(c[0].y26), `${b26.total} contacts from ${c[0].y26} rows`);
  const contacts26: any[] = b26.contacts ?? [];
  ok("each 2026 contact is labelled with its edition",
    contacts26.length > 0 && contacts26.every((x) => x.term === "CIC Summer 7's 2026"),
    contacts26[0]?.term);
  ok("a team name rides along where they entered one",
    contacts26.some((x) => x.team), contacts26.filter((x) => x.team).length + " with a team");

  // The preview must agree with the audience, or the number shown is not the number sent.
  const prev = await asStaff("/api/admin/cic/mailer/preview", {
    method: "POST", body: JSON.stringify({ source: "7s", audience: "all", edition: 2026 }) });
  const p: any = prev.ok ? await prev.json() : {};
  ok("the preview count honours the edition filter",
    p.count === (b26.contacts ?? []).filter((x: any) => !x.unsubscribed).length,
    `preview ${p.count} vs audience ${(b26.contacts ?? []).filter((x: any) => !x.unsubscribed).length}`);

  if (tempUserId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => {
  console.error(e);
  if (tempUserId) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
  }
  await pool.end().catch(() => {});
  process.exit(1);
});
