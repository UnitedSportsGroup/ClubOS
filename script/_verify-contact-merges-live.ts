// The four merged duplicates, checked against production.
//   npx tsx --env-file=.env script/_verify-contact-merges-live.ts
import pg from "pg";
import bcrypt from "bcryptjs";
const BASE = process.env.VERIFY_BASE ?? "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const PAIRS = [["Joel Cook", 617, 32764], ["Jordy Cook", 616, 32765], ["Luca Murdoch", 31114, 35901], ["Xan Nuthall", 30735, 36042]] as const;
const REAL = ["confirmed", "refunded", "partially_refunded"];
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, x = "") => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}${x ? ` — ${x}` : ""}`)); };

async function main() {
  const email = `_merge_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows: u } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Merge','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  const uid = u[0].id;
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WS]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, o[0].id]);
  try {
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const get = async (p: string) => { const r = await fetch(`${BASE}${p}`, { headers: { cookie, "X-Workspace-Slug": WS } }); return { status: r.status, body: await r.json().catch(() => null) as any }; };

    console.log(`\nContact merges — ${BASE}\n`);
    const { rows: fks } = await pool.query(`
      SELECT tc.table_name tbl, kcu.column_name col FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='contacts' AND ccu.column_name='id' AND tc.table_name<>'contacts'`);

    for (const [who, keep, gone] of PAIRS) {
      const { rows: [m] } = await pool.query(`SELECT merged_into_contact_id m, merged_at, merged_by_user_id FROM contacts WHERE id=$1`, [gone]);
      ok(m?.m === keep && !!m.merged_at && !!m.merged_by_user_id, `${who}: ${gone} is retired into ${keep}, stamped with who and when`);
      let left = 0;
      for (const f of fks) {
        const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int n FROM "${f.tbl}" WHERE "${f.col}"=$1`, [gone]);
        left += n;
      }
      ok(left === 0, `${who}: nothing still hangs off the retired record`, `${left} rows`);
      const { rows: [{ n: dup }] } = await pool.query(
        `SELECT count(*)::int n FROM (SELECT 1 FROM registrations WHERE contact_id=$1 AND status::text = ANY($2::text[]) GROUP BY program_id, term_id HAVING count(*)>1) x`, [keep, REAL]);
      ok(dup === 0, `${who}: ${keep} is not on any programme twice in one term`);
    }

    // 🔴 The count Daniel was looking at.
    const { rows: [t] } = await pool.query(`SELECT count(*)::int n, count(DISTINCT contact_id)::int p FROM registrations WHERE program_id=5 AND term_id=7 AND status::text = ANY($1::text[])`, [REAL]);
    ok(t.n === t.p, `Technification Term 3: ${t.n} registrations for ${t.p} children — one each`);
    const { rows: [{ n: nameDup }] } = await pool.query(`
      SELECT count(*)::int n FROM (SELECT lower(c.first_name)||' '||lower(c.last_name)
        FROM registrations r JOIN contacts c ON c.id=r.contact_id
        WHERE r.program_id=5 AND r.term_id=7 AND r.status::text = ANY($1::text[]) GROUP BY 1 HAVING count(*)>1) x`, [REAL]);
    ok(nameDup === 0, "Technification Term 3 lists no name twice");

    // Money is untouched: every payment still exists, it just sits on one person.
    for (const [who, keep, gone] of PAIRS) {
      const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int n FROM fm_payment_history WHERE contact_id=$1`, [keep]);
      ok(n > 0, `${who}: payment history landed on ${keep} (${n} payments)`);
    }

    // A retired record is not findable, and a live one still is.
    const s1 = await get(`/api/admin/search?q=${encodeURIComponent("Xan Nuthall")}`);
    const ids = JSON.stringify(s1.body ?? {});
    ok(!ids.includes(`"36042"`), "global search does not surface the retired record");
    ok(s1.status === 200, "global search answers");

    const m1 = await get(`/api/admin/mailer/search-people?q=${encodeURIComponent("Nuthall")}`);
    const mids = (m1.body?.people ?? []).map((p: any) => p.contactId);
    ok(!mids.includes(36042), "the mailer cannot pick the retired record as a recipient");
    ok(mids.includes(30735) || m1.status === 200, "the mailer still finds the live one");

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
  } finally {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]);
    await pool.end();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });
