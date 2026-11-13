/**
 * SIU Performance Hub — live checks against production, as ORDINARY people.
 *
 *   npx tsx --env-file=.env script/_verify-performance-live.ts
 *   VERIFY_BASE=https://app.usg.co.nz (default)
 *
 * Throwaway staff accounts: SIU staff holding the Performance grant, SIU staff
 * holding it AND the medical grant, an SIU ADMIN without the grant (must see
 * nothing — the tab is locked), and a CUFC admin. A probe player in a throwaway
 * squad goes through: staff wellness entry, an injury (with and without clinical
 * notes), an athlete account + phone check-in + RPE, the sign-in rate limiter,
 * a GPS CSV import (preview, save, duplicate). Every row the probe makes is
 * deleted at the end; the real squad is never written to.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const SIU = "south-island-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TS = Date.now();

let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); good ? pass++ : fail++; };
const users: number[] = [];
let squadId: number | null = null, contactId: number | null = null;
const probeEmail = `delivered+perf${TS}@resend.dev`;

async function account(tag: string, workspace: string, role: string, tabs: string[] | null, unlocked: string[] | null): Promise<string> {
  const email = `_perf_${tag}_${TS}@usg.co.nz`;
  const pw = `P${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Perf','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  const { rows: [org] } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [workspace]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs, unlocked_tabs) VALUES ($1,$2,$3,$4,$5)`,
    [rows[0].id, org.id, role, tabs == null ? null : JSON.stringify(tabs), unlocked == null ? null : JSON.stringify(unlocked)]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login for ${tag} failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") || "").split(";")[0];
}
const api = (cookie: string | null, method: string, path: string, workspace: string | null, body?: any) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(workspace ? { "X-Workspace-Slug": workspace } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const json = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
const nzToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function main() {
  console.log(`\nSIU Performance Hub — live checks on ${BASE}\n`);
  const today = nzToday();

  ok("signed out, staff API → 401", (await api(null, "GET", "/api/admin/performance/catalogue", SIU)).status === 401);
  ok("signed out, player API → 401", (await api(null, "GET", "/api/public/athlete/me", null)).status === 401);

  const staff = await account("staff", SIU, "team_member", [], ["performance"]);
  const medic = await account("medic", SIU, "team_member", [], ["performance", "performance-medical"]);
  const siuAdmin = await account("siuadmin", SIU, "admin", null, null);
  const cufcAdmin = await account("cufc", "christchurch-united", "admin", null, null);

  const cat = await api(staff, "GET", "/api/admin/performance/catalogue", SIU);
  const catJ: any = await json(cat);
  ok("granted SIU staff → catalogue 200", cat.status === 200, `HTTP ${cat.status}`);
  ok("…and is NOT medical", catJ.medical === false);
  ok("catalogue lists every data source (wellness, GPS, WHOOP, Wyscout, StatsBomb, video …)",
    ["wellness", "rpe", "catapult_one", "whoop", "wyscout", "statsbomb", "video", "vald"].every((k) => catJ.sources?.some((s: any) => s.key === k)));
  ok("medic → medical true", (await json(await api(medic, "GET", "/api/admin/performance/catalogue", SIU))).medical === true);
  ok("SIU ADMIN without the grant → 404 (locked tab, not leadership-open)", (await api(siuAdmin, "GET", "/api/admin/performance/overview", SIU)).status === 404);
  ok("CUFC admin asking for SIU → 404", (await api(cufcAdmin, "GET", "/api/admin/performance/overview", SIU)).status === 404);
  ok("granted staff with the CUFC header → 404", (await api(staff, "GET", "/api/admin/performance/overview", "christchurch-united")).status === 404);

  const ov = await api(staff, "GET", "/api/admin/performance/overview", SIU);
  const ovJ: any = await json(ov);
  ok("board → 200 with the real squad (21)", ov.status === 200 && ovJ.players?.length >= 21, `${ovJ.players?.length} players`);

  // ── probe player in a throwaway squad ──
  const { rows: [sq] } = await pool.query(`insert into club_squads (organization_id, name, slug, season_year, is_active, notes) values (2,$1,$2,2026,true,'verify probe') returning id`, [`_Verify ${TS}`, `_verify-${TS}`]);
  squadId = sq.id;
  const { rows: [ct] } = await pool.query(`insert into contacts (type, first_name, last_name, email) values ('player','Probe',$1,$2) returning id`, [`Player${TS}`, probeEmail]);
  contactId = ct.id;
  await pool.query(`insert into club_squad_members (squad_id, contact_id, role, position) values ($1,$2,'player','Striker')`, [squadId, contactId]);
  const fullName = `Probe Player${TS}`;

  const w = await api(staff, "POST", "/api/admin/performance/wellness", SIU, { contactId, sleep: 2, fatigue: 4, soreness: 4, stress: 4, mood: 4, sleepHours: 7.5, soreAreas: ["Hamstring", "Not a real area"], note: "tight hammy", medicalFlag: true });
  ok("staff enters a check-in → 200", w.status === 200, `HTTP ${w.status}`);
  ok("an answer of 6 → 400", (await api(staff, "POST", "/api/admin/performance/wellness", SIU, { contactId, mood: 6 })).status === 400);
  ok("a player not on the squad → 404", (await api(staff, "POST", "/api/admin/performance/wellness", SIU, { contactId: 1, mood: 3 })).status === 404);
  const ov2: any = await json(await api(staff, "GET", "/api/admin/performance/overview", SIU));
  const me = ov2.players?.find((p: any) => p.contactId === contactId);
  ok("board shows the check-in, scored, amber for sleep 2", me?.wellness?.score === 18 && me?.wellness?.flag === "amber", JSON.stringify(me?.wellness?.score) + " " + me?.wellness?.flag);
  ok("an unknown sore area is dropped", JSON.stringify(me?.wellness?.soreAreas) === '["Hamstring"]');
  ok("non-medical staff do NOT receive the physio note or flag", me?.wellness && !("note" in me.wellness && me.wellness.note) && me.wellness.medicalFlag === undefined);
  const ovM: any = await json(await api(medic, "GET", "/api/admin/performance/overview", SIU));
  const meM = ovM.players?.find((p: any) => p.contactId === contactId);
  ok("medical staff DO receive it", meM?.wellness?.note === "tight hammy" && meM?.wellness?.medicalFlag === true);
  ok("readiness names what it used and what is missing", me?.readiness?.used?.includes("wellness") && me?.readiness?.missing?.includes("3 weeks of load"), JSON.stringify(me?.readiness));

  // availability
  ok("non-medical staff cannot write clinical notes → 403",
    (await api(staff, "POST", "/api/admin/performance/availability", SIU, { contactId, status: "injured", startedOn: today, notes: "grade 1" })).status === 403);
  const inj = await api(medic, "POST", "/api/admin/performance/availability", SIU, { contactId, status: "injured", startedOn: today, bodyArea: "Hamstring", expectedReturn: today, notes: "Grade 1 strain, L" });
  ok("medic logs an injury with notes → 200", inj.status === 200, `HTTP ${inj.status}`);
  const overlap = await api(staff, "POST", "/api/admin/performance/availability", SIU, { contactId, status: "ill", startedOn: today });
  ok("a second overlapping spell → 409 with a reason", overlap.status === 409 && /already/i.test((await json(overlap)).message ?? ""), `HTTP ${overlap.status}`);
  const avS: any = await json(await api(staff, "GET", "/api/admin/performance/availability", SIU));
  const spS = avS.spells?.find((s: any) => s.contactId === contactId);
  ok("coaches see the injury but NOT the notes (hasNotes only)", spS && spS.notes === undefined && spS.hasNotes === true);
  const avM: any = await json(await api(medic, "GET", "/api/admin/performance/availability", SIU));
  ok("medic sees the notes", avM.spells?.find((s: any) => s.contactId === contactId)?.notes === "Grade 1 strain, L");
  const ov3: any = await json(await api(staff, "GET", "/api/admin/performance/overview", SIU));
  ok("the board reads the probe as Injured / red", ov3.players?.find((p: any) => p.contactId === contactId)?.readiness?.level === "red");

  // ── the player's phone ──
  const inv = await api(staff, "POST", `/api/admin/performance/players/${contactId}/invite`, SIU, {});
  ok("staff invite the player → 200 (email to a Resend test inbox)", inv.status === 200, `HTTP ${inv.status}`);
  const { rows: [acct] } = await pool.query(`select id from perf_athlete_accounts where contact_id = $1`, [contactId]);
  // The emailed link is a hashed token we cannot read — mint our own for the test.
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(`insert into perf_athlete_tokens (account_id, token_hash, kind, expires_at) values ($1,$2,'set',now() + interval '1 hour')`, [acct.id, crypto.createHash("sha256").update(token).digest("hex")]);
  ok("a short password → 400", (await api(null, "POST", "/api/public/athlete/set-password", null, { token, password: "short" })).status === 400);
  const setPw = await api(null, "POST", "/api/public/athlete/set-password", null, { token, password: "probe-password-123" });
  const athleteCookie = (setPw.headers.get("set-cookie") || "").split(";")[0];
  ok("set password → 200 and a __Host- cookie", setPw.status === 200 && athleteCookie.startsWith("__Host-siu_athlete="), `HTTP ${setPw.status}`);
  ok("the same link twice → 400", (await api(null, "POST", "/api/public/athlete/set-password", null, { token, password: "probe-password-456" })).status === 400);
  const meR = await api(athleteCookie, "GET", "/api/public/athlete/me", null);
  const meJ: any = await json(meR);
  ok("player /me → 200, their own name, availability injured", meR.status === 200 && meJ.firstName === "Probe" && meJ.availability === "injured", `HTTP ${meR.status}`);
  ok("player cannot reach the staff API with their cookie", (await api(athleteCookie, "GET", "/api/admin/performance/overview", SIU)).status === 401);
  const pw = await api(athleteCookie, "POST", "/api/public/athlete/wellness", null, { sleep: 5, fatigue: 5, soreness: 3, stress: 4, mood: 5, sleepHours: 8 });
  ok("player submits today's check-in → 200", pw.status === 200);
  const { rows: [wr] } = await pool.query(`select date::text d, entered_by, entered_by_athlete, sleep from perf_wellness where contact_id = $1`, [contactId]);
  ok("…it replaced today's row, dated by the server (NZ), marked as the player's own", wr?.d === today && wr.entered_by === null && wr.entered_by_athlete === true && wr.sleep === 5, JSON.stringify(wr));
  ok("player RPE 11 → 400", (await api(athleteCookie, "POST", "/api/public/athlete/rpe", null, { rpe: 11, kind: "training", minutes: 60 })).status === 400);
  ok("player RPE 7 × 80 min → 200", (await api(athleteCookie, "POST", "/api/public/athlete/rpe", null, { rpe: 7, kind: "training", minutes: 80 })).status === 200);
  ok("a date three days ago is filed as today, never back-dated", (await api(athleteCookie, "POST", "/api/public/athlete/rpe", null, { rpe: 3, kind: "gym", minutes: 30, date: "2020-01-01" })).status === 200
    && (await pool.query(`select count(*)::int n from perf_rpe where contact_id = $1 and date < (now() at time zone 'Pacific/Auckland')::date - 1`, [contactId])).rows[0].n === 0);
  await api(athleteCookie, "POST", "/api/public/athlete/sign-out", null);
  ok("after sign-out the cookie is dead", (await api(athleteCookie, "GET", "/api/public/athlete/me", null)).status === 401);

  // rate limiter must actually bite
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await api(null, "POST", "/api/public/athlete/sign-in", null, { email: probeEmail, password: "wrong-password-x" })).status;
  ok("ten wrong passwords → 429 (the limiter bites)", last === 429, `last HTTP ${last}`);

  // ── import a GPS file ──
  const csv = `Player Name,Date,Total Distance (m),Top Speed (km/h),Sprint Distance (m),Bananas\n${fullName},${today.split("-").reverse().join("/")},"7,612",31.4,,9\nZZ Unknown${TS},${today.split("-").reverse().join("/")},5000,28,120,1\n`;
  const prev = await api(staff, "POST", "/api/admin/performance/imports/preview", SIU, { source: "catapult_one", csv, filename: "verify.csv" });
  const pj: any = await json(prev);
  ok("preview → 200, three metrics mapped, 'Bananas' ignored, no problems",
    prev.status === 200 && pj.plan?.mapped?.length === 3 && pj.plan?.ignored?.includes("Bananas") && pj.plan?.problems?.length === 0, JSON.stringify(pj.plan?.problems ?? pj));
  ok("the probe's full name is offered as a link; an unknown name is not guessed",
    pj.links?.find((l: any) => l.player === fullName)?.contactId === contactId && pj.links?.find((l: any) => l.player.startsWith("ZZ"))?.contactId === null);
  const save = await api(staff, "POST", "/api/admin/performance/imports", SIU, { source: "catapult_one", csv, filename: "verify.csv", links: { [fullName]: contactId } });
  const sj: any = await json(save);
  ok("save → 200; blank sprint cell is NO reading (5 values, not 6)", save.status === 200 && sj.written === 5, JSON.stringify(sj));
  const again: any = await json(await api(staff, "POST", "/api/admin/performance/imports", SIU, { source: "catapult_one", csv, filename: "verify.csv", links: {} }));
  ok("the same file again is a no-op", again.duplicate === true && again.written === 0);
  const pl: any = await json(await api(staff, "GET", `/api/admin/performance/players/${contactId}`, SIU));
  ok("player page shows the GPS distance 7612 from catapult_one", pl.metrics?.total_distance_m?.[0]?.value === 7612 && pl.metrics.total_distance_m[0].source === "catapult_one");
  ok("player page has no sprint reading (blank stayed blank)", !pl.metrics?.sprint_distance_m);
  ok("player page load summary says it needs 3 weeks", /3 weeks/.test(pl.load?.summary?.acwrNote ?? ""), pl.load?.summary?.acwrNote);
  ok("the unknown name waits under 'Data to fix'",
    (await json(await api(staff, "GET", "/api/admin/performance/overview", SIU))).unlinked?.some((u: any) => u.source_athlete_key === `ZZ Unknown${TS}`));
}

async function cleanup() {
  try {
    if (contactId) {
      await pool.query(`delete from perf_metric_values where contact_id = $1 or athlete_id in (select id from perf_athletes where source_athlete_key in ($2,$3))`, [contactId, `Probe Player${TS}`, `ZZ Unknown${TS}`]);
      await pool.query(`delete from perf_athletes where source_athlete_key in ($1,$2)`, [`Probe Player${TS}`, `ZZ Unknown${TS}`]);
      await pool.query(`delete from perf_sessions where organization_id = 2 and not exists (select 1 from perf_metric_values m where m.session_id = perf_sessions.id) and first_synced_at > now() - interval '1 hour'`);
      await pool.query(`delete from perf_imports where filename = 'verify.csv'`);
      await pool.query(`delete from perf_rpe where contact_id = $1`, [contactId]);
      await pool.query(`delete from perf_wellness where contact_id = $1`, [contactId]);
      await pool.query(`delete from perf_availability where contact_id = $1`, [contactId]);
      await pool.query(`delete from perf_athlete_auth_events where lower(email) = $1 or account_id in (select id from perf_athlete_accounts where contact_id = $2)`, [probeEmail, contactId]);
      await pool.query(`delete from perf_athlete_accounts where contact_id = $1`, [contactId]);
      await pool.query(`delete from club_squad_members where contact_id = $1`, [contactId]);
      await pool.query(`delete from contacts where id = $1`, [contactId]);
    }
    if (squadId) await pool.query(`delete from club_squads where id = $1`, [squadId]);
    if (users.length) {
      await pool.query(`delete from user_organizations where user_id = any($1::int[])`, [users]);
      await pool.query(`delete from users where id = any($1::int[])`, [users]).catch(async () => {
        await pool.query(`update users set active = false where id = any($1::int[])`, [users]);
      });
    }
    console.log("  (probe data removed)");
  } catch (e: any) { console.error("  ✗ cleanup:", e.message); fail++; }
}

main().catch((e) => { console.error("\n  ✗", e.message); fail++; }).finally(async () => {
  await cleanup();
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail ? 1 : 0);
});
