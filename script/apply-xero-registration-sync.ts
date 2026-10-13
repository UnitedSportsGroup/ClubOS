// Applies migrations/2026-10-14_xero_registration_sync.sql. Dry-run by default
// (everything inside a transaction that is rolled back); --commit to keep it.
import { readFileSync } from "fs";
import pg from "pg";
const commit = process.argv.includes("--commit");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let fail = 0; const ok = (l: string, g: boolean) => { console.log(`  ${g ? "ok  " : "FAIL"} ${l}`); if (!g) fail++; };
const refused = async (label: string, q: string, params: any[] = []) => {
  await c.query("SAVEPOINT t");
  try { await c.query(q, params); ok(`${label} — refused`, false); } catch { ok(`${label} — refused`, true); }
  await c.query("ROLLBACK TO SAVEPOINT t");
};
try {
  await c.query("BEGIN");
  await c.query(readFileSync("migrations/2026-10-14_xero_registration_sync.sql", "utf8"));
  const t = (await c.query(`select relname, relrowsecurity from pg_class where relname in ('xero_contact_links','xero_invoice_registrations','xero_registration_sync_state')`)).rows;
  ok("three tables exist", t.length === 3);
  ok("RLS on all three", t.every((r: any) => r.relrowsecurity));
  const kid = (await c.query(`select id from contacts where type='player' limit 1`)).rows[0].id;
  await refused("staff link without a person", `insert into xero_contact_links (organization_id,xero_contact_id,contact_id,source) values (1,'t1',$1,'staff')`, [kid]);
  await refused("auto link claiming a person", `insert into xero_contact_links (organization_id,xero_contact_id,contact_id,source,decided_by_user_id) values (1,'t2',$1,'auto',1)`, [kid]);
  await c.query(`insert into xero_contact_links (organization_id,xero_contact_id,contact_id,source) values (1,'t3',$1,'auto')`, [kid]);
  await refused("one Xero contact → two children", `insert into xero_contact_links (organization_id,xero_contact_id,contact_id,source) values (1,'t3',$1,'auto')`, [kid]);
  await refused("deleting a linked child", `delete from contacts where id=$1`, [kid]);
  await refused("unknown link source", `insert into xero_contact_links (organization_id,xero_contact_id,contact_id,source) values (1,'t4',$1,'guess')`, [kid]);
  await c.query(`insert into xero_invoice_registrations (organization_id,invoice_id,xero_contact_id,xero_status,payment_state,total_cents,amount_paid_cents,amount_due_cents,decision) values (1,'i1','t3','PAID','paid',100,100,0,'void')`);
  await refused("same invoice twice", `insert into xero_invoice_registrations (organization_id,invoice_id,xero_contact_id,xero_status,payment_state,total_cents,amount_paid_cents,amount_due_cents,decision) values (1,'i1','t3','PAID','paid',100,100,0,'void')`);
  await c.query(`delete from xero_invoice_registrations where invoice_id='i1'`);
  await c.query(`delete from xero_contact_links where xero_contact_id='t3'`);
  if (commit && !fail) { await c.query("COMMIT"); console.log("COMMITTED"); }
  else { await c.query("ROLLBACK"); console.log(fail ? "ROLLED BACK (failures)" : "dry run — rolled back"); }
} catch (e: any) { await c.query("ROLLBACK").catch(() => {}); console.error(e.message); fail++; }
await c.end(); process.exit(fail ? 1 : 0);
