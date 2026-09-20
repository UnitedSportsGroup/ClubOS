// Proves, against PRODUCTION, that the "New Player" mark on the Registrations
// list means what it says: this person had never registered at this club
// before, in ANY record.
//
// Daniel, 2026-09-20: "make so new players who have never been registered at
// our club ever before in all records get a special mark or tag... so we can
// quickly see how our client acquisition is working and if we getting new sign
// ups or old ones."
//
// 🔴 The two traps this exists to hold shut.
//
// 1. "ALL RECORDS" IS NOT `registrations`. Friendly Manager holds 14,115
//    registrations over 3,623 contacts back to 2017. Reading only the live
//    table would stamp NEW on families who have been here a decade.
//
// 2. THE PERSON IS NOT THE CONTACT ROW. 2,767 email addresses sit on more than
//    one contact row (6,237 rows) because the abandoned-checkout path and the
//    Shopify import each mint a fresh one. Keying on contact_id alone called 44
//    extra registrations "new" in the July-onward window — a 17% over-count on
//    the exact number this feature exists to report.
//
//   npx tsx --env-file=.env script/_verify-new-player-live.ts
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WORKSPACE = "christchurch-united";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

let tempUserId: number | null = null;
let cookie = "";

async function signInAsStaff() {
  const email = `_newplayer_probe_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'NewPlayer','Probe',$2,'team_member',true) RETURNING id`,
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

const asStaff = (path: string) =>
  fetch(`${BASE}${path}`, { headers: { cookie, "X-Workspace-Slug": WORKSPACE } });

/** The identity key the server uses: normalised email, else the contact id. */
const IDENT = `coalesce(nullif(lower(btrim(c.email)),''), 'contact:'||c.id)`;

async function main() {
  console.log(`\nNew players are genuinely new — ${BASE}\n`);
  await signInAsStaff();

  const res = await asStaff(`/api/admin/registrations`);
  ok("the registrations list loads for ordinary staff", res.ok, `HTTP ${res.status}`);
  if (!res.ok) return;
  const rows: any[] = await res.json();
  ok("it returns registrations", rows.length > 0, `${rows.length} rows`);

  // 🔴 The guard against a vacuous pass. If the field were missing entirely,
  // every "no false positive" check below would pass by saying nothing.
  const carries = rows.filter((r) => typeof r.isNewPlayer === "boolean");
  ok("every row carries a decided isNewPlayer", carries.length === rows.length,
    `${carries.length}/${rows.length}`);

  const flagged = rows.filter((r) => r.isNewPlayer);
  const notFlagged = rows.filter((r) => r.isNewPlayer === false);
  ok("some rows are marked new", flagged.length > 0, `${flagged.length} of ${rows.length}`);
  ok("and some are not — it is not marking everybody", notFlagged.length > 0,
    `${notFlagged.length} returning`);
  console.log(`        ${flagged.length} new / ${rows.length} on this list`);

  // ── No false positives ────────────────────────────────────────────────────
  // For every row marked NEW, prove against the database that the person has
  // no earlier registration under ANY contact row sharing their identity, and
  // no Friendly Manager history at all.
  let badEarlier = 0, badFm = 0;
  for (const r of flagged) {
    const { rows: bad } = await pool.query(`
      with me as (select ${IDENT} as key from contacts c where c.id = $1),
      sib as (select c.id from contacts c where ${IDENT} = (select key from me))
      select
        (select count(*)::int from registrations r
           where r.contact_id in (select id from sib)
             and r.status in ('confirmed','refunded','partially_refunded')
             and r.registered_at is not null
             and (r.registered_at < $2::timestamptz
                  or (r.registered_at = $2::timestamptz and r.id < $3))) as earlier,
        (select count(*)::int from fm_registration_history f
           where f.contact_id in (select id from sib)) as fm`,
      [r.contactId, r.registeredAt, r.id]);
    if (Number(bad[0].earlier) > 0) badEarlier++;
    if (Number(bad[0].fm) > 0) badFm++;
  }
  ok("no row marked new has an earlier registration under any of their contact rows",
    badEarlier === 0, `${badEarlier} wrong`);
  ok("no row marked new appears anywhere in Friendly Manager", badFm === 0, `${badFm} wrong`);

  // ── The email identity is doing real work ─────────────────────────────────
  // At least one row must be NOT marked new despite being the first
  // registration for its own contact id — otherwise the sibling-email lookup is
  // inert and this is just the naive rule wearing a better comment.
  let rescuedByEmail = 0;
  for (const r of notFlagged) {
    const { rows: q } = await pool.query(`
      select
        (select count(*)::int from registrations x
           where x.contact_id = $1
             and x.status in ('confirmed','refunded','partially_refunded')
             and x.registered_at is not null
             and (x.registered_at < $2::timestamptz
                  or (x.registered_at = $2::timestamptz and x.id < $3))) as own_earlier,
        (select count(*)::int from fm_registration_history f where f.contact_id = $1) as own_fm`,
      [r.contactId, r.registeredAt, r.id]);
    if (Number(q[0].own_earlier) === 0 && Number(q[0].own_fm) === 0) rescuedByEmail++;
  }
  ok("at least one returning person was caught only by their email, not their contact id",
    rescuedByEmail > 0, `${rescuedByEmail} such rows`);

  // ── It is a fact about the registration, not about today ──────────────────
  // A person's FIRST registration stays their first however many they add
  // later, so at most one row per identity on this list may be marked.
  const keyById = new Map<number, string>();
  const ids = Array.from(new Set(rows.map((r) => r.contactId).filter(Boolean)));
  if (ids.length) {
    const { rows: keys } = await pool.query(
      `select c.id, ${IDENT} as key from contacts c where c.id = any($1::int[])`, [ids]);
    for (const k of keys) keyById.set(Number(k.id), String(k.key));
  }
  const seen = new Map<string, number>();
  for (const r of flagged) {
    const k = keyById.get(r.contactId);
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const doubled = Array.from(seen.values()).filter((n) => n > 1).length;
  ok("nobody is marked new twice", doubled === 0, `${doubled} identities marked more than once`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    if (tempUserId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [tempUserId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [tempUserId]).catch(() => {});
    }
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
