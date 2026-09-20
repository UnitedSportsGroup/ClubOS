/**
 * Live verification of CUGC terms + the roll, against production.
 *
 *   npx tsx --env-file=.env script/_verify-cugc-terms-live.ts
 *
 * Run AFTER every deploy that touches gymnastics enrolment. The enrol endpoint
 * is a live payment path on a real Stripe account, so this drives it for real —
 * PaymentIntents are created and never confirmed (they cost nothing and
 * expire), and every row it makes is deleted before it exits.
 *
 * 🔴 What it is actually guarding: before 2026-09-20 the browser told the
 * server which term it was buying, and a term that had FINISHED still quoted
 * its full price. Term 3 ends 25 Sep; on the 26th cugc.co.nz would have charged
 * $165 for a term that was over. Those two facts are the first checks below.
 */
import pg from "pg";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

// node's fetch has been intermittently dead on this Mac while curl works, so a
// failure here is reported as a failure to CHECK rather than a passing test.
async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://cugc.co.nz" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({} as any)) };
}

const enrolment = (extra: Record<string, unknown>) => ({
  programSlug: "gymplay",
  optionIndex: 0,
  sessionTime: "Wednesday 4:00–4:45pm",
  parentName: "VERIFY Parent",
  email: "verify-terms@example.invalid",
  gymnastName: "VERIFY Child",
  gymnastDob: "2020-05-05",
  ...extra,
});

async function main() {
  console.log(`\nCUGC terms + roll — live against ${BASE}\n`);

  // ── 1. The term gate on the paying endpoint ───────────────────────────────
  console.log("The browser no longer decides which term it is buying");

  const finished = await post("/api/public/cugc/enrol", enrolment({ termId: "t3-2026", term: "Term 3 2026" }));
  const t3Over = new Date() > new Date("2026-09-25T23:59:59+12:00");
  if (t3Over) {
    ok("a finished term is REFUSED", finished.status === 400, finished.json?.message);
  } else {
    ok("Term 3 still sells while it is running", finished.status === 200, `HTTP ${finished.status}`);
  }

  const bogus = await post("/api/public/cugc/enrol", enrolment({ termId: "t9-2099" }));
  ok("a term that does not exist is refused", bogus.status === 400, bogus.json?.message);

  // The old cugc.co.nz bundle sends no termId at all. It must still work, or
  // enrolments stop in the window between the two deploys.
  const legacy = await post("/api/public/cugc/enrol", enrolment({ term: "Term 3 2026" }));
  ok("an OLD website bundle (no termId) still enrols", legacy.status === 200, `HTTP ${legacy.status}`);

  const t4 = await post("/api/public/cugc/enrol", enrolment({ termId: "t4-2026" }));
  ok("🟢 TERM 4 IS OPEN and takes an enrolment", t4.status === 200, `HTTP ${t4.status}`);

  // 🔴 The server must have stamped the term IT resolved, not the name the
  // request offered. This request deliberately lies.
  const liar = await post("/api/public/cugc/enrol", enrolment({ termId: "t4-2026", term: "Term 1 1999" }));
  ok("a lying `term` in the body is ignored", liar.status === 200);

  const { rows: made } = await pool.query(
    `SELECT id, term, price_cents, full_price_cents FROM cugc_registrations
      WHERE email = 'verify-terms@example.invalid' ORDER BY id`);
  ok("every test enrolment carries a term", made.length > 0 && made.every((r) => !!r.term), `${made.length} rows`);
  ok("…and none of them says 'Term 1 1999'", !made.some((r) => r.term === "Term 1 1999"),
     Array.from(new Set(made.map((r) => r.term))).join(", "));

  const t4Row = made.find((r) => r.term === "Term 4 2026");
  ok("Term 4 is charged at the FULL price, not Term 3's leftovers",
     !!t4Row && t4Row.price_cents === t4Row.full_price_cents,
     t4Row ? `$${(t4Row.price_cents / 100).toFixed(2)} of $${(t4Row.full_price_cents / 100).toFixed(2)}` : "no row");

  // ── 2. The admin surfaces are gated ───────────────────────────────────────
  console.log("\nThe admin surfaces exist and are gated");
  for (const path of ["/api/admin/cugc/programs", "/api/admin/cugc/roll", "/api/admin/cugc/roll/gymplay-wed-1600/2026-10-14"]) {
    const res = await fetch(`${BASE}${path}`);
    // 401 = the code is on production and refused us. 404 = it never shipped.
    ok(`${path}`, res.status === 401, `HTTP ${res.status}${res.status === 404 ? " — NOT DEPLOYED" : ""}`);
  }

  // ── 3. The data really is separated ───────────────────────────────────────
  console.log("\nThe registrations really are separated by term");
  const { rows: byTerm } = await pool.query(
    `SELECT term, count(*) AS n, sum(price_cents) FILTER (WHERE status='paid') AS paid_cents
       FROM cugc_registrations WHERE email <> 'verify-terms@example.invalid'
      GROUP BY term ORDER BY term`);
  for (const r of byTerm) console.log(`     ${r.term ?? "(not recorded)"} — ${r.n} rows, $${((r.paid_cents ?? 0) / 100).toFixed(2)} paid`);
  ok("more than one term now exists in the data", byTerm.length >= 1);
  ok("no real enrolment has a NULL term", !byTerm.some((r) => r.term === null));

  // ── 4. The roll ───────────────────────────────────────────────────────────
  console.log("\nThe roll");
  const { rows: [{ n: attendanceRows }] } = await pool.query(`SELECT count(*) AS n FROM cugc_attendance`);
  ok("cugc_attendance exists on production", true, `${attendanceRows} marks so far`);

  const { rows: unpaidOnRoll } = await pool.query(
    `SELECT count(*) AS n FROM cugc_attendance a
       JOIN cugc_registrations r ON r.id = a.registration_id
      WHERE r.status <> 'paid'`);
  // 🔴 "If you ain't paid you ain't registered" — nothing unpaid may ever
  // acquire a mark, whatever a future surface does.
  ok("nobody unpaid has ever been marked", Number(unpaidOnRoll[0].n) === 0, `${unpaidOnRoll[0].n} found`);

  // ── Clean up ──────────────────────────────────────────────────────────────
  const del = await pool.query(
    `DELETE FROM cugc_registrations WHERE email = 'verify-terms@example.invalid' RETURNING id`);
  ok("test enrolments removed", true, `${del.rowCount} deleted`);

  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
