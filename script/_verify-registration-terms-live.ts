// Proves, against PRODUCTION, that a registration knows which term it is for —
// and that the office can sell either term at its own price.
//
// Daniel, 2026-09-10, looking at 151 people on the FUNiño Players tab:
//   "make sure you got a term selector here for term 1, term 2, term 3 and term
//    4 2026, make sure it shows year and term for us to track and only show
//    corresponding registrations... I feel like you putting the term 4 ones all
//    in here now which is wrong imo."
// and, of the counter:
//   "make sure here in register at office manual rego in clubos it shows the
//    term 4 full price or the term 3 pro rata what's remaining price so that
//    the guys in the office can still track those too. do it same for
//    technification as well."
//
// 🔴 The trap this closes. `programs.term_id` is the term a programme is
// selling RIGHT NOW and is flipped the day the next term opens. Reading it at
// display time therefore REWRITES HISTORY at every flip — every past
// registration silently re-files itself under the new term. So the term is
// stamped on the registration at the moment it is sold, and read back from
// there. That is why `registrations.term_id` had to exist at all.
//
// 🔴 It signs in as an ORDINARY STAFF MEMBER, not as a super admin. A super
// admin short-circuits the membership checks, so proving it works for Daniel
// proves nothing about Olga at the counter — the exact failure he called out
// this morning on Grant Funding.
//
//   npx tsx --env-file=.env script/_verify-registration-terms-live.ts
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";
const FUNINO = 4;           // FUNiño — First Kicks
const TECHNIFICATION = 5;   // Daniel asked for this one by name
const CAMP_FUNDAMENTALS = 30;  // holiday camps — no term, and none missing
const CAMP_WORLDCUP = 39;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);

let tempUserId: number | null = null;
let cookie = "";

/** A real staff account in the CUFC workspace — the person actually at the counter. */
async function signInAsStaff() {
  const email = `_terms_probe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Terms','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  tempUserId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`,
    [tempUserId, org[0].id],
  );
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
}

const asStaff = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie, "X-Workspace-Slug": WORKSPACE, "Content-Type": "application/json", ...(init.headers || {}) },
  });

async function main() {
  console.log(`\nRegistrations know their term — ${BASE}\n`);
  await signInAsStaff();

  // ── 1. The column, and what a blank one means ─────────────────────────────
  console.log("The column");
  const { rows: col } = await pool.query(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_name='registrations' AND column_name='term_id'`);
  ok("registrations.term_id exists", col.length === 1);
  ok("nullable — \"we don't know\" stays a real answer", col[0]?.is_nullable === "YES");
  ok("no default — nothing is filed under a term by accident", col[0]?.column_default == null);

  const { rows: fk } = await pool.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name='registrations_term_id_fkey' AND table_name='registrations'`);
  ok("foreign key to terms — a term id always names a real term", fk.length === 1);

  const { rows: idx } = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE tablename='registrations' AND indexname='registrations_program_term_idx'`);
  ok("indexed on (program_id, term_id) — the filter the tab runs constantly", idx.length === 1);

  // ── 2. Nothing points across a workspace boundary ─────────────────────────
  const { rows: cross } = await pool.query(
    `SELECT count(*)::int n FROM registrations r
     JOIN programs p ON p.id = r.program_id
     JOIN terms t ON t.id = r.term_id
     WHERE t.organization_id <> p.organization_id`);
  ok("no registration is filed under another workspace's term", Number(cross[0].n) === 0, `${cross[0].n} crossing`);

  // ── 3. The split Daniel spotted ───────────────────────────────────────────
  console.log("\nWhat the Players tab now shows");
  for (const [label, id] of [["FUNiño", FUNINO], ["Technification", TECHNIFICATION]] as const) {
    const res = await asStaff(`/api/admin/camps/${id}/term-counts`);
    ok(`${label}: term counts load for staff`, res.ok, `HTTP ${res.status}`);
    if (!res.ok) continue;
    const body: any = await res.json();
    const terms: any[] = body.terms ?? [];
    for (const t of terms) console.log(`        ${String(t.count).padStart(4)}  ${money(t.totalCents).padStart(11)}  ${t.label}${t.isProgrammeTerm ? "  ← now selling" : ""}`);
    // NOT "more than one term" — Technification genuinely has no Term 4
    // sign-ups yet, and asserting a count that depends on who has walked in
    // this week is a test that fails on a fact about the club, not about the
    // code. What must hold is that every registration is FILED under a term.
    ok(`${label}: every registration is filed under a named term`,
      terms.length > 0 && terms.every((t) => t.id != null),
      terms.map((t) => `${t.label}:${t.count}`).join(", "));
    ok(`${label}: every term carries a year, not just a number`,
      terms.filter((t) => t.id != null).every((t) => /\b20\d\d$/.test(t.label)),
      terms.map((t) => t.label).join(", "));

    // The counts must be the SAME number the filtered list returns, or the chip
    // is decoration. Check each term against the real players endpoint.
    for (const t of terms) {
      const key = t.id == null ? "none" : String(t.id);
      const p = await asStaff(`/api/admin/camps/${id}/players?termId=${key}`);
      const list: any[] = p.ok ? await p.json() : [];
      ok(`${label}: "${t.label}" chip says ${t.count} and the list returns ${list.length}`,
        p.ok && list.length === t.count);
    }

    // ⚠️ NOT "all terms = the sum of the chips". That was the assertion here
    // until 2026-09-20 and it was wrong: a child enrolled in Term 3 and again
    // in Term 4 is two registrations and ONE row in the list. FUNiño's chips
    // summed to 453 over a list of 302 — 107 children span terms. The chip now
    // reports people, from the same function the list uses, so the number on
    // it is the number of rows you get when you click it.
    const all = await asStaff(`/api/admin/camps/${id}/players`);
    const allList: any[] = all.ok ? await all.json() : [];
    const sum = terms.reduce((a, t) => a + t.count, 0);
    ok(`${label}: "All terms" says what the list shows`,
      all.ok && typeof body.totalPeople === "number" && body.totalPeople === allList.length,
      `chip ${body.totalPeople} vs list ${allList.length}`);
    // And the registration total must be at least the headcount — if it were
    // ever lower, a term's registrations would be going missing.
    ok(`${label}: ${sum} registrations across ${allList.length} children`,
      sum >= allList.length, `${sum} < ${allList.length}`);
  }

  // ── 3b. A HOLIDAY CAMP HAS NO TERM, and must not pretend it is missing one ─
  // Daniel, 2026-09-20: the FUNdamentals Players tab read
  // "Term not recorded · 102 · $11,260.00" and looked like the FUNiño bug
  // again. It was not — every figure was right. A camp runs BETWEEN terms, so
  // its registrations carry a null term_id and always will, and one chip
  // spanning every row on the page filters nothing while reading as a fault.
  console.log("\nA camp has no term to choose between");
  for (const [label, id] of [["FUNdamentals", CAMP_FUNDAMENTALS], ["World Cup", CAMP_WORLDCUP]] as const) {
    const res = await asStaff(`/api/admin/camps/${id}/term-counts`);
    ok(`${label}: term counts load for staff`, res.ok, `HTTP ${res.status}`);
    if (!res.ok) continue;
    const body: any = await res.json();
    const terms: any[] = body.terms ?? [];

    // 🔴 The guard against a vacuous pass. An empty `terms` array proves
    // nothing if the camp simply has no registrations — the check would go
    // green on an empty programme forever. So read the real rows first and
    // require that there ARE some, and that every one of them is null-term.
    // If a camp ever does acquire a real term, this fails and the strip must
    // come back.
    const { rows: real } = await pool.query(
      `select count(*)::int n, sum(case when term_id is null then 1 else 0 end)::int nulls
         from registrations
        where program_id = $1 and status in ('confirmed','refunded','partially_refunded')`, [id]);
    const n = Number(real[0]?.n ?? 0), nulls = Number(real[0]?.nulls ?? 0);
    ok(`${label}: has registrations at all, so an empty strip means something`, n > 0, `${n} on file`);
    ok(`${label}: every one of them genuinely carries no term`, n > 0 && nulls === n, `${nulls}/${n} null`);

    ok(`${label}: the tab offers no term to choose between`, terms.length === 0,
      terms.map((t) => `${t.label}:${t.count}`).join(", ") || "none");

    // And nobody was hidden by hiding the strip. ⚠️ NOT against the
    // registration count — a camp booking can carry siblings, so 102
    // registrations are 114 children and that assertion was wrong before the
    // code was. The honest comparison is people to people: what the page used
    // to show for a camp (`?termId=none`, the only bucket it had) against what
    // it shows now (no filter at all). Every row is null-term, so the two must
    // name exactly the same children.
    const allRes = await asStaff(`/api/admin/camps/${id}/players`);
    const allList: any[] = allRes.ok ? await allRes.json() : [];
    const noneRes = await asStaff(`/api/admin/camps/${id}/players?termId=none`);
    const noneList: any[] = noneRes.ok ? await noneRes.json() : [];
    ok(`${label}: the unfiltered list is not empty`, allRes.ok && allList.length > 0,
      `${allList.length} children`);
    ok(`${label}: dropping the term filter hides nobody`,
      allRes.ok && noneRes.ok && allList.length === noneList.length && allList.length > 0,
      `no filter ${allList.length} vs termId=none ${noneList.length}`);
  }

  // ── 4. The counter can sell EITHER term, each at its own price ────────────
  console.log("\nThe office walk-up form");
  for (const [label, id] of [["FUNiño", FUNINO], ["Technification", TECHNIFICATION]] as const) {
    // 🔴 Pick an age group first, the way the counter does. Technification
    // sells TWO (U9–U10 and U11–U12), so with none chosen nothing can be
    // priced — and until this was fixed the form read all four terms as
    // "finished", including a Term 4 that had not started.
    const first = await asStaff(`/api/admin/registrations/manual/quote?programId=${id}`);
    ok(`${label}: quote loads for staff`, first.ok, `HTTP ${first.status}`);
    if (!first.ok) continue;
    const unpriced: any = await first.json();
    const option = unpriced.options?.[0];
    ok(`${label}: with no age group chosen, a term that hasn't ended is not called finished`,
      (unpriced.terms ?? []).some((t: any) => !t.ended),
      (unpriced.terms ?? []).map((t: any) => `${t.name}:${t.ended ? "ended" : "open"}`).join(" "));

    const q = await asStaff(`/api/admin/registrations/manual/quote?programId=${id}${option ? `&programOptionId=${option.id}` : ""}`);
    if (!q.ok) { ok(`${label}: quote loads with an age group chosen`, false, `HTTP ${q.status}`); continue; }
    const body: any = await q.json();
    const terms: any[] = body.terms ?? [];
    for (const t of terms) {
      console.log(`        ${t.name} ${t.year}  ${money(t.totalCents).padStart(10)}  ${
        t.sessionsRemaining != null ? `${t.sessionsRemaining}/${t.sessionsTotal} sessions` : "—"}${
        t.isProgrammeTerm ? "  ← now selling" : ""}`);
    }
    ok(`${label}: the form offers every term, not just the open one`, terms.length >= 2, `${terms.length}`);
    ok(`${label}: a full fee is on file to price against`, !!option && option.fullPriceCents > 0,
      option ? money(option.fullPriceCents) : "no option");

    const sellable = terms.filter((t) => t.totalCents != null);
    ok(`${label}: at least one term is still sellable once an age group is chosen`, sellable.length > 0);
    ok(`${label}: an ended term is never priced, and a live one always is`,
      terms.every((t) => (t.ended ? t.totalCents == null : t.totalCents != null)),
      terms.map((t) => `${t.name}:${t.ended ? "ended" : "open"}/${t.totalCents ?? "—"}`).join(" "));
    // 🔴 The bug this line exists for: the route read `q.sessionsTotal` where
    // the pricing engine returns `totalSessions`, so EVERY term came back with
    // a null session count and the counter would have read "3 of  sessions left".
    ok(`${label}: every sellable term reports its session count`,
      sellable.every((t) => typeof t.sessionsTotal === "number" && t.sessionsTotal > 0),
      sellable.map((t) => `${t.name}:${t.sessionsTotal}`).join(" "));

    // A term that has not started costs the FULL fee; one running past its
    // full-price weeks costs less. That contrast is the whole ask.
    const future = sellable.find((t) => !t.isProgrammeTerm && t.sessionsRemaining === t.sessionsTotal);
    const running = sellable.find((t) => t.sessionsRemaining != null && t.sessionsRemaining < t.sessionsTotal);
    if (future && option) {
      ok(`${label}: a term that hasn't started is the full ${money(option.fullPriceCents)}`,
        future.totalCents === option.fullPriceCents, `${future.name} ${money(future.totalCents)}`);
    }
    if (running && option) {
      ok(`${label}: a term already running costs less than the full fee (pro rata)`,
        running.totalCents! < option.fullPriceCents,
        `${running.name} ${money(running.totalCents)} vs ${money(option.fullPriceCents)}`);
    } else {
      console.log(`        (no part-way term to pro-rate today — nothing to assert)`);
    }

    // A term id belonging to another club must be refused, not quietly ignored.
    const { rows: foreign } = await pool.query(
      `SELECT t.id FROM terms t JOIN programs p ON p.id = $1
       WHERE t.organization_id <> p.organization_id LIMIT 1`, [id]);
    if (foreign.length) {
      const bad = await asStaff(`/api/admin/registrations/manual/quote?programId=${id}&termId=${foreign[0].id}`);
      ok(`${label}: a term from another workspace is refused`, bad.status === 400, `HTTP ${bad.status}`);
    }
  }

  // ── 5. The gate ───────────────────────────────────────────────────────────
  console.log("\nThe gate");
  const anon = await fetch(`${BASE}/api/admin/camps/${FUNINO}/term-counts`);
  ok("term counts refuse a stranger", anon.status === 401, `HTTP ${anon.status}`);
  const noHeader = await fetch(`${BASE}/api/admin/camps/${FUNINO}/term-counts`, { headers: { cookie } });
  ok("term counts still answer without a workspace header (not tab-gated)",
    noHeader.status === 200 || noHeader.status === 400, `HTTP ${noHeader.status}`);
  const quoteAnon = await fetch(`${BASE}/api/admin/registrations/manual/quote?programId=${FUNINO}`);
  ok("the office quote refuses a stranger", quoteAnon.status === 401, `HTTP ${quoteAnon.status}`);
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (tempUserId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
