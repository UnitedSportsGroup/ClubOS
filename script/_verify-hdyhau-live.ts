/**
 * _verify-hdyhau-live.ts — "How did you hear about us?" is REQUIRED of a new
 * buyer on every sale path, optional for a returning one, and refused BEFORE
 * anything is written. Daniel, 2026-10-20.
 *
 *   npx tsx --env-file=.env script/_verify-hdyhau-live.ts                 # pure + refusals (writes nothing to sales tables)
 *   npx tsx --env-file=.env script/_verify-hdyhau-live.ts --write         # + the accept paths (creates probe rows, cancels + deletes them)
 *   BASE=https://app.usg.co.nz CAMP_SLUG=worldcup ACADEMY_SLUG=technification CLASS_SLUG=u4-u8 MFL_SLUG=term-1 …
 *
 * 🔴 Run it AFTER the deploy. Before it, /api/public/hdyhau/required answers
 * 404 and the script stops after the pure checks, saying so — a route that
 * does not exist yet must not read as a pass.
 *
 * 🔴 There is no local ClubOS: booting the server against the production .env
 * starts eight schedulers, two of which send real email inside 60 s
 * (memory reference_clubos_local_server_sends_email). So this targets BASE.
 *
 * Default mode proves each refusal created NOTHING by asking the database for
 * the probe's unique email afterwards. The office check signs in as a
 * throwaway ORDINARY staff account (never a super admin — "it works for me"
 * proves nothing about Olga) and removes it at the end.
 *
 * --write mode, per public route: a valid answer reaches the PaymentIntent;
 * then the probe's registration is marked confirmed so the SAME buyer is now
 * "returning", and a second call WITHOUT an answer is accepted. Every
 * PaymentIntent is cancelled at Stripe and every probe row deleted.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import { parseHdyhau, HDYHAU_OPTIONS, hdyhauLabel, HDYHAU_REQUIRED_MESSAGE, HDYHAU_INVALID_MESSAGE, HDYHAU_DETAIL_MESSAGE } from "../shared/hdyhau";
import { mapHdyhauToChannel } from "../shared/attribution";

const BASE = process.env.BASE || "https://app.usg.co.nz";
const WRITE = process.argv.includes("--write");
const CAMP_SLUG = process.env.CAMP_SLUG || "worldcup";
const ACADEMY_SLUG = process.env.ACADEMY_SLUG || "technification";
const ACADEMY_DOB = process.env.ACADEMY_DOB || "2017-03-03";
const CLASS_SLUG = process.env.CLASS_SLUG || "u4-u8";
const MFL_SLUG = process.env.MFL_SLUG || "term-1";
const WORKSPACE = "christchurch-united";
const STAMP = Date.now();
const MARK = `zzhdyhau${STAMP}`;
const probeEmail = (k: string) => `${MARK}.${k}@example.com`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0, skip = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const skipped = (label: string, why: string) => { console.log(`  SKIP ${label} — ${why}`); skip++; };
const json = { "Content-Type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });

// ── 0. Pure: the one list and the one parser ──────────────────────────────────
console.log("\nThe decider (no network)");
ok("12 options, every value unique", HDYHAU_OPTIONS.length === 12 && new Set(HDYHAU_OPTIONS.map((o) => o.value)).size === 12);
ok("nothing sent → no answer, not an error", JSON.stringify(parseHdyhau(undefined, undefined)) === JSON.stringify({ ok: true, source: null, detail: null }));
ok("a listed value is accepted", (parseHdyhau("instagram", "") as any).source === "instagram");
ok("an unlisted value is refused", !parseHdyhau("myspace", "").ok);
ok("a legacy survey key is refused on a NEW sale (never stored again)", !parseHdyhau("word_of_mouth", "").ok);
ok("'other' without detail is refused", !parseHdyhau("other", "   ").ok);
ok("'other' with detail keeps the detail", (parseHdyhau("other", " the van ") as any).detail === "the van");
ok("detail is dropped for anything but 'other'", (parseHdyhau("google", "ignored") as any).detail === null);
ok("legacy keys still read as words", hdyhauLabel("word_of_mouth") === "Word of mouth" && hdyhauLabel("email_newsletter") === "Email or newsletter");
ok("legacy 'Other: …' rows still read", hdyhauLabel("Other: Been before") === "Other: Been before");
ok("'other' + detail reads as 'Other: …'", hdyhauLabel("other", "school fair") === "Other: school fair");
ok("'website' is the club's site, not Google search", mapHdyhauToChannel("website") === "organic");
ok("'flyer_poster' reports as the QR/print channel", mapHdyhauToChannel("flyer_poster") === "qr");
ok("'friend_teammate' reports as referral", mapHdyhauToChannel("friend_teammate") === "referral");

// ── Probe bodies, one per route ───────────────────────────────────────────────
async function campBody(email: string, extra: Record<string, unknown> = {}) {
  const camp = await (await fetch(`${BASE}/api/public/camps/${CAMP_SLUG}`)).json();
  const date = camp?.dates?.[camp.dates.length - 1];
  return {
    campSlug: CAMP_SLUG,
    parent: { firstName: "ZZHDYHAU", lastName: "PROBE", email, phone: "0200000001" },
    children: [{ firstName: "ZZHDYHAU", lastName: "PROBE", dateOfBirth: "2016-03-18" }],
    items: date ? [{ childIndex: 0, campDateId: date.id, productType: "FULL_DAY" }] : [],
    ...extra,
  };
}
async function academyBody(email: string, extra: Record<string, unknown> = {}) {
  const opts = await (await fetch(`${BASE}/api/public/programs/${ACADEMY_SLUG}/options`)).json().catch(() => ({}));
  const option = (opts?.options ?? [])[0];
  return {
    programSlug: ACADEMY_SLUG, programOptionId: option?.id, paymentPlan: "term",
    child: { firstName: "ZZHDYHAU", lastName: "PROBE", dateOfBirth: ACADEMY_DOB, gender: "male",
      countryOfBirthCode: "NZL", nationalityCode: "NZL", ethnicityGroupId: 1, ethnicitySelectionIds: [] },
    guardian: { firstName: "ZZHDYHAU", lastName: "PROBE", email, phone: "0200000001", relationship: "Parent",
      addressParts: { street: "1 Probe Street", suburb: "Riccarton", city: "Christchurch", region: "Canterbury", postcode: "8041", country: "NZL" } },
    emergency: { name: "ZZHDYHAU PROBE", phone: "0200000001" },
    consents: { policy: true, medical: true, photo: false, newsletter: false },
    source: "verify-hdyhau",
    ...extra,
  };
}
async function classBody(email: string, extra: Record<string, unknown> = {}) {
  const opts = await (await fetch(`${BASE}/api/public/programs/${CLASS_SLUG}/options`)).json().catch(() => ({}));
  const option = (opts?.options ?? [])[0];
  return {
    programSlug: CLASS_SLUG, programOptionId: option?.id, paymentMode: "upfront",
    parent: { firstName: "ZZHDYHAU", lastName: "PROBE", email, phone: "0200000001" },
    child: { firstName: "ZZHDYHAU", lastName: "PROBE", dateOfBirth: "2021-05-05" },
    notes: "AUTOMATED VERIFICATION — removed immediately",
    ...extra,
  };
}
async function mflBody(email: string, extra: Record<string, unknown> = {}) {
  const cfg = await (await fetch(`${BASE}/api/public/league/register/${MFL_SLUG}`)).json().catch(() => ({}));
  const night = (cfg?.divisions ?? []).filter((d: any) => d.spotsLeft == null || d.spotsLeft > 0)[0];
  return {
    slug: MFL_SLUG,
    teams: [{ teamName: `ZZ HDYHAU Probe ${STAMP}`, divisionId: night?.id, upsells: [] }],
    captain: { firstName: "ZZHDYHAU", lastName: "PROBE", email, phone: "0200000001" },
    ...extra,
  };
}

const ROUTES = [
  { name: "camps", path: "/api/public/book", body: campBody },
  { name: "academy", path: "/api/public/academy/register", body: academyBody },
  { name: "class-book", path: "/api/public/class-registrations/intent", body: classBody },
  { name: "MFL league", path: "/api/public/league/register", body: mflBody },
] as const;

async function nothingWritten(email: string): Promise<{ contacts: number; regs: number }> {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM contacts WHERE lower(email)=lower($1)) AS contacts,
            (SELECT count(*)::int FROM registrations r JOIN contacts c ON c.id IN (r.contact_id, r.guardian_id)
              WHERE lower(c.email)=lower($1)) AS regs`, [email]);
  return rows[0];
}

/** A refusal is only proven if it's OUR refusal — anything earlier in the route is a skip, not a pass. */
async function expectRefusal(route: (typeof ROUTES)[number], label: string, extra: Record<string, unknown>, message: string, key: string, headers: Record<string, string> = {}) {
  const email = probeEmail(`${route.name.replace(/\W/g, "")}-${key}`);
  const res = await post(route.path, await route.body(email, extra), headers);
  const body: any = await res.json().catch(() => ({}));
  if (res.status !== 400 || body?.code !== "hdyhau_required") {
    // Something earlier in the route answered first (closed programme, bad
    // option, a shape check). That proves nothing about the question either way.
    skipped(`${route.name}: ${label}`, `route answered HTTP ${res.status} "${body?.message ?? ""}" before reaching the question — fix the probe body/slug`);
    // …but if it WROTE something on the way, that is still worth knowing.
    const w = await nothingWritten(email);
    if (w.contacts || w.regs) ok(`${route.name}: the earlier refusal wrote nothing`, false, `contacts ${w.contacts}, registrations ${w.regs}`);
    return;
  }
  ok(`${route.name}: ${label} → 400 "${body.message}"`, body.message === message);
  const w = await nothingWritten(email);
  ok(`${route.name}: …and NOTHING was written (contacts ${w.contacts}, registrations ${w.regs})`, w.contacts === 0 && w.regs === 0);
}

let tempUserId: number | null = null;
let cookie = "";
const madeIntents: string[] = [];

async function signInAsStaff() {
  const email = `_hdyhau_probe_${STAMP}@usg.co.nz`;
  const pw = `P${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Hdyhau','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  tempUserId = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WORKSPACE]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'admin',NULL)`, [tempUserId, org[0].id]);
  const res = await post("/api/auth/login", { email, password: pw });
  if (!res.ok) throw new Error(`staff login HTTP ${res.status}`);
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
}

async function cleanup() {
  const { rows: regs } = await pool.query(
    `SELECT DISTINCT r.id, r.status::text AS status, r.stripe_payment_intent_id AS pi FROM registrations r
       JOIN contacts c ON c.id IN (r.contact_id, r.guardian_id) WHERE c.email LIKE $1`, [`${MARK}.%`]);
  for (const pi of [...madeIntents, ...regs.map((r: any) => r.pi).filter(Boolean)]) {
    if (!process.env.STRIPE_SECRET_KEY) break;
    await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/cancel`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    }).catch(() => {});
  }
  const ids = regs.map((r: any) => r.id);
  if (ids.length) {
    await pool.query(`DELETE FROM registration_items WHERE registration_id = ANY($1::int[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM league_teams WHERE registration_id = ANY($1::int[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM registrations WHERE id = ANY($1::int[])`, [ids]).catch((e) => console.log("  note registration cleanup:", e.message));
  }
  const { rows: cs } = await pool.query(`SELECT id FROM contacts WHERE email LIKE $1`, [`${MARK}.%`]);
  const cids = cs.map((r: any) => r.id);
  if (cids.length) {
    await pool.query(`DELETE FROM attendance WHERE child_id IN (SELECT id FROM children WHERE parent_id = ANY($1::int[]))`, [cids]).catch(() => {});
    await pool.query(`DELETE FROM child_medical WHERE child_id IN (SELECT id FROM children WHERE parent_id = ANY($1::int[]))`, [cids]).catch(() => {});
    await pool.query(`DELETE FROM children WHERE parent_id = ANY($1::int[])`, [cids]).catch(() => {});
    const { rows: kids } = await pool.query(`SELECT player_id FROM contact_relationships WHERE guardian_id = ANY($1::int[])`, [cids]);
    const kidIds = kids.map((r: any) => r.player_id);
    await pool.query(`DELETE FROM contact_relationships WHERE guardian_id = ANY($1::int[])`, [cids]).catch(() => {});
    if (kidIds.length) await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[]) AND last_name='PROBE'`, [kidIds]).catch(() => {});
    await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [cids]).catch((e) => console.log("  note contact cleanup:", e.message));
  }
  if (tempUserId) {
    await pool.query(`DELETE FROM audit_logs WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
  }
  const left = await pool.query(`SELECT count(*)::int n FROM contacts WHERE email LIKE $1`, [`${MARK}.%`]);
  ok("cleanup left no probe contacts behind", left.rows[0].n === 0, `${left.rows[0].n} left`);
}

try {
  // ── 1. Is it deployed? ──────────────────────────────────────────────────────
  console.log(`\nTarget ${BASE}`);
  const probe = await post("/api/public/hdyhau/required", { slug: CAMP_SLUG, email: probeEmail("ping") });
  if (probe.status === 404) {
    console.log("  /api/public/hdyhau/required → 404: NOT DEPLOYED to this target. Stopping after the pure checks.");
    console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped — LIVE CHECKS NOT RUN\n`);
    await pool.end(); process.exit(fail ? 1 : 2);
  }

  // ── 2. The lookup answers a boolean and nothing else ────────────────────────
  console.log("\nPOST /api/public/hdyhau/required");
  const a: any = await probe.json();
  ok("an unknown buyer → { required: true }", a?.required === true && Object.keys(a).join() === "required", JSON.stringify(a));
  const { rows: known } = await pool.query(
    `SELECT lower(trim(c.email)) AS email FROM registrations r JOIN programs p ON p.id=r.program_id
       JOIN contacts c ON c.id = r.guardian_id
      WHERE COALESCE(p.organization_id,1)=1 AND r.status IN ('confirmed','refunded','partially_refunded') AND c.email LIKE '%@%'
      ORDER BY r.id DESC LIMIT 1`);
  if (known[0]) {
    const b: any = await (await post("/api/public/hdyhau/required", { slug: CAMP_SLUG, email: known[0].email })).json();
    ok("a CUFC family with a paid registration → { required: false }, same single key", b?.required === false && Object.keys(b).join() === "required", JSON.stringify(b));
    const m: any = await (await post("/api/public/hdyhau/required", { slug: MFL_SLUG, email: known[0].email })).json();
    console.log(`  info the same address asked about Mini Football → ${JSON.stringify(m)} (true unless they have also played MFL)`);
  } else skipped("returning buyer lookup", "no paid CUFC registration found to test with");
  const c: any = await (await post("/api/public/hdyhau/required", { slug: "no-such-programme-zz", email: probeEmail("x") })).json();
  ok("an unknown programme → { required: true } (fail closed)", c?.required === true);
  const d: any = await (await post("/api/public/hdyhau/required", { slug: CAMP_SLUG })).json();
  ok("no email and no phone → { required: true }", d?.required === true);

  // ── 3. Every public sale route refuses BEFORE writing ───────────────────────
  for (const route of ROUTES) {
    console.log(`\n${route.name} — ${route.path}`);
    await expectRefusal(route, "a new buyer with no answer", {}, HDYHAU_REQUIRED_MESSAGE, "none");
    await expectRefusal(route, "an answer that isn't on the list", { referralSource: "myspace" }, HDYHAU_INVALID_MESSAGE, "bad");
    await expectRefusal(route, "'other' with no detail", { referralSource: "other", referralDetail: "  " }, HDYHAU_DETAIL_MESSAGE, "nodetail");
  }

  // ── 4. The office walk-up, as ORDINARY staff ────────────────────────────────
  console.log("\noffice walk-up — /api/admin/registrations/manual");
  await signInAsStaff();
  const staffHeaders = { cookie, "X-Workspace-Slug": WORKSPACE };
  const { rows: camp } = await pool.query(`SELECT id FROM programs WHERE slug=$1`, [CAMP_SLUG]);
  const office = {
    name: "office", path: "/api/admin/registrations/manual",
    body: async (email: string, extra: Record<string, unknown> = {}) => ({
      programId: camp[0]?.id,
      parent: { firstName: "ZZHDYHAU", lastName: "PROBE", email, phone: "0200000001" },
      children: [{ firstName: "ZZHDYHAU", lastName: "PROBE", dateOfBirth: "2016-03-18" }],
      items: [],
      payment: { isPaid: false },
      ...extra,
    }),
  } as any;
  await expectRefusal(office, "a new family with no answer", {}, HDYHAU_REQUIRED_MESSAGE, "none", staffHeaders);
  await expectRefusal(office, "'other' with no detail", { referralSource: "other" }, HDYHAU_DETAIL_MESSAGE, "nodetail", staffHeaders);

  // ── 5. --write: the accept paths ────────────────────────────────────────────
  if (!WRITE) {
    console.log("\n  (accept paths not run — pass --write to create probe registrations, then cancel and delete them)");
  } else {
    for (const route of ROUTES) {
      console.log(`\n${route.name} — accept paths (--write)`);
      const email = probeEmail(`${route.name.replace(/\W/g, "")}-accept`);
      const res = await post(route.path, await route.body(email, { referralSource: "other", referralDetail: "verify probe" }));
      const body: any = await res.json().catch(() => ({}));
      ok(`${route.name}: a new buyer WITH an answer proceeds`, res.ok, `HTTP ${res.status} ${body?.message ?? ""}`);
      if (!res.ok) continue;
      const { rows } = await pool.query(
        `SELECT r.id, r.referral_source, r.stripe_payment_intent_id AS pi,
                (SELECT referral_detail FROM registrations x WHERE x.id = r.id) AS detail
           FROM registrations r JOIN contacts c ON c.id = r.guardian_id WHERE c.email=$1 ORDER BY r.id`, [email])
        .catch(async () => (await pool.query(
          `SELECT r.id, r.referral_source, r.stripe_payment_intent_id AS pi, NULL AS detail
             FROM registrations r JOIN contacts c ON c.id = r.guardian_id WHERE c.email=$1 ORDER BY r.id`, [email])));
      const r0 = rows[0];
      ok(`${route.name}: the answer is stored`, r0?.referral_source === "other" || r0?.referral_source === "Other: verify probe",
        `${r0?.referral_source} / ${r0?.detail ?? "(no detail column)"}`);
      if (r0?.pi) madeIntents.push(r0.pi);
      // Make the same buyer "returning", then buy again with no answer.
      await pool.query(`UPDATE registrations SET status='confirmed' WHERE id=$1`, [r0.id]);
      const again = await post(route.path, await route.body(email, { teams: undefined, ...(route.name === "MFL league" ? { teams: [{ teamName: `ZZ HDYHAU Probe 2 ${STAMP}`, divisionId: (await mflBody(email)).teams[0].divisionId, upsells: [] }] } : {}) }));
      const againBody: any = await again.json().catch(() => ({}));
      ok(`${route.name}: the same buyer, now returning, is accepted WITHOUT an answer`, again.ok, `HTTP ${again.status} ${againBody?.message ?? ""}`);
      await pool.query(`UPDATE registrations SET status='pending' WHERE id=$1`, [r0.id]);
    }
  }
} catch (e: any) {
  ok("run completed", false, e?.message);
} finally {
  await cleanup().catch((e) => ok("cleanup", false, e?.message));
  await pool.end();
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped\n`);
process.exit(fail ? 1 : 0);
