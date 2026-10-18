// CUFC Shopify -> ClubOS: the final pass before the store is cancelled (18 Oct 2026).
//
// Reads the full archive taken that day (outputs/shopify-cufc-archive/2026-10-18/raw) and brings
// across the three things ClubOS did not yet hold:
//   1. every Shopify customer with an email -> `contacts` (ADOPTED by email when a live contact
//      already has it; created as a guardian only when nobody does). Tagged `shopify-cufc`.
//   2. their marketing consent: subscribed -> mailer_list_contacts list 'shopify-subscribers'
//      (org 1); unsubscribed -> email_unsubscribes (org 1). A ClubOS unsubscribe always wins.
//   3. every order line not already in fm_payment_history ('shopify:<line_id>') or
//      mfl_customer_history (the league lines) -> fm_payment_history, source 'shopify'.
//      Kit, uniforms, books — 197 lines. The "Test" line is skipped.
//
// Amounts are the line's GROSS (price x qty), the same basis the July import used; refunded or
// partly refunded orders say so in note_reference. Discount codes are NOT imported — all 36
// expired by 24 Mar 2026 (they stay in the archive).
//
// Dry-run by default (one transaction, rolled back). --commit writes. Idempotent: contacts are
// found again by email, payments by external_key, list rows by (org, list, email).
//   cd apps/clubos && node --env-file=.env script/import-shopify-cufc-final.cjs [--commit]

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ARCHIVE = path.resolve(__dirname, "../../../outputs/shopify-cufc-archive/2026-10-18/raw");
const commit = process.argv.includes("--commit");
const CUFC = 1, CIC = 5;
const LIST_KEY = "shopify-subscribers";
const SOURCE = "shopify-cufc-final-2026-10-18";

const load = (f) => { const j = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")); return Array.isArray(j) ? j : Object.values(j)[0]; };
const lc = (s) => (s || "").trim().toLowerCase();
const nz = (s) => { const t = (s || "").trim(); return t ? t : null; };
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const nzDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date(iso));

const customers = load("customers.json");
const orders = load("orders.json");

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const s = { customers: customers.length, noEmail: 0, adopted: 0, created: 0, subscribed: 0, subsInserted: 0,
    unsubscribed: 0, unsubInserted: 0, blockedByClubosUnsub: 0, lines: 0, alreadyFm: 0, alreadyMfl: 0, test: 0,
    paysInserted: 0, paysCents: 0, paysExpectedCents: 0 };
  try {
    await c.query("BEGIN");

    // ---- 1. contacts ----
    const byEmail = new Map(); // email -> contact id (oldest live contact wins)
    for (const r of (await c.query(
      `SELECT id, lower(trim(email)) e FROM contacts
       WHERE email IS NOT NULL AND trim(email) <> '' AND merged_into_contact_id IS NULL ORDER BY id`)).rows) {
      if (!byEmail.has(r.e)) byEmail.set(r.e, r.id);
    }
    const contactForCustomer = new Map(); // shopify customer id -> contact id
    for (const cu of customers) {
      const e = lc(cu.email);
      if (!validEmail(e)) { s.noEmail++; continue; }
      const note = `Shopify (cufcshop.com) customer since ${nzDate(cu.created_at)} — ${cu.orders_count || 0} order(s), $${cu.total_spent || "0.00"} spent.`;
      let id = byEmail.get(e);
      if (id) {
        await c.query(
          `UPDATE contacts SET
             phone = COALESCE(NULLIF(phone,''), $2),
             tags = CASE WHEN COALESCE(tags,'') = '' THEN 'shopify-cufc'
                         WHEN tags LIKE '%shopify-cufc%' THEN tags ELSE tags || ',shopify-cufc' END
           WHERE id = $1`, [id, nz(cu.phone)]);
        s.adopted++;
      } else {
        id = (await c.query(
          `INSERT INTO contacts (type, first_name, last_name, email, phone, tags, notes)
           VALUES ('guardian', $1, $2, $3, $4, 'shopify-cufc', $5) RETURNING id`,
          [nz(cu.first_name) || "", nz(cu.last_name) || "", e, nz(cu.phone), note])).rows[0].id;
        byEmail.set(e, id);
        s.created++;
      }
      contactForCustomer.set(String(cu.id), id);
    }

    // ---- 2. consent ----
    const clubosUnsub = new Set((await c.query(
      "SELECT lower(email) e FROM email_unsubscribes WHERE organization_id = $1 OR organization_id IS NULL", [CUFC])).rows.map((r) => r.e));
    for (const cu of customers) {
      const e = lc(cu.email);
      if (!validEmail(e)) continue;
      const state = cu.email_marketing_consent?.state;
      if (state === "unsubscribed") {
        s.unsubscribed++;
        s.unsubInserted += (await c.query(
          "INSERT INTO email_unsubscribes (organization_id, email, source) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [CUFC, e, SOURCE])).rowCount;
      } else if (state === "subscribed") {
        s.subscribed++;
        if (clubosUnsub.has(e)) s.blockedByClubosUnsub++; // stays excluded by every mailer audience
        const name = [cu.first_name, cu.last_name].filter(Boolean).join(" ").trim() || null;
        s.subsInserted += (await c.query(
          `INSERT INTO mailer_list_contacts (organization_id, list_key, email, name, phone, source)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [CUFC, LIST_KEY, e, name, nz(cu.phone), SOURCE])).rowCount;
      }
    }

    // ---- 3. order lines ----
    const haveFm = new Set();
    for (const r of (await c.query("SELECT external_key k FROM fm_payment_history WHERE source = 'shopify'")).rows) {
      const m = /^shopify:(\d+)/.exec(r.k); if (m) haveFm.add(m[1]);
    }
    const haveMfl = new Set((await c.query(
      "SELECT external_line_id::text k FROM mfl_customer_history WHERE external_line_id IS NOT NULL")).rows.map((r) => r.k));
    for (const od of orders) {
      const buyerEmail = lc(od.customer?.email || od.email);
      const contactId = (od.customer && contactForCustomer.get(String(od.customer.id))) || byEmail.get(buyerEmail) || null;
      const first = od.customer?.first_name || od.billing_address?.first_name || "";
      const last = od.customer?.last_name || od.billing_address?.last_name || "";
      const refundNote = od.financial_status === "paid" ? null : `Shopify status: ${od.financial_status}`;
      for (const li of od.line_items) {
        s.lines++;
        const id = String(li.id);
        if (haveFm.has(id)) { s.alreadyFm++; continue; }
        if (haveMfl.has(id)) { s.alreadyMfl++; continue; }
        if (/^test$/i.test(li.title.trim())) { s.test++; continue; }
        const cents = Math.round(parseFloat(li.price) * 100) * li.quantity;
        s.paysExpectedCents += cents;
        const org = /\bcic\b/i.test(li.title) ? CIC : CUFC;
        const desc = li.variant_title ? `${li.title} — ${li.variant_title}` + (li.quantity > 1 ? ` × ${li.quantity}` : "")
                                      : li.title + (li.quantity > 1 ? ` × ${li.quantity}` : "");
        const r = await c.query(
          `INSERT INTO fm_payment_history
             (organization_id, contact_id, first_name, last_name, fee_number, fee_description,
              term_name, season_year, programme, method, method_raw, paid_on, amount_cents,
              note_reference, source, external_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'card','Shopify',$10,$11,$12,'shopify',$13)
           ON CONFLICT (external_key) DO NOTHING RETURNING amount_cents`,
          [org, contactId, first, last, `SHOP-${od.name.replace(/^#/, "")}`, desc,
           "Club shop", parseInt(nzDate(od.created_at).slice(0, 4), 10), li.title,
           nzDate(od.created_at), cents, refundNote, `shopify:${id}`]);
        if (r.rowCount) { s.paysInserted++; s.paysCents += r.rows[0].amount_cents; }
      }
    }

    // ---- verify ----
    const allLineIds = orders.flatMap((o) => o.line_items.filter((l) => !/^test$/i.test(l.title.trim())).map((l) => String(l.id)));
    const fmNow = new Set();
    for (const r of (await c.query("SELECT external_key k FROM fm_payment_history WHERE source = 'shopify'")).rows) {
      const m = /^shopify:(\d+)/.exec(r.k); if (m) fmNow.add(m[1]);
    }
    const stillMissing = allLineIds.filter((id) => !fmNow.has(id) && !haveMfl.has(id));
    const emails = customers.map((x) => lc(x.email)).filter(validEmail);
    const contactEmails = new Set((await c.query(
      "SELECT lower(trim(email)) e FROM contacts WHERE merged_into_contact_id IS NULL AND email IS NOT NULL")).rows.map((r) => r.e));
    const custMissing = emails.filter((e) => !contactEmails.has(e));

    console.log(JSON.stringify(s, null, 2));
    console.log(`order lines: ${s.lines} · in ClubOS before ${s.alreadyFm + s.alreadyMfl} · added ${s.paysInserted} ($${(s.paysCents / 100).toFixed(2)} of $${(s.paysExpectedCents / 100).toFixed(2)})`);
    console.log(`VERIFY: order lines still not in ClubOS: ${stillMissing.length} · customers with an email not in Contacts: ${custMissing.length}`);
    if (stillMissing.length || custMissing.length) throw new Error("verification failed");
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    console.log(commit ? "COMMITTED" : "DRY RUN — rolled back (pass --commit to write)");
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("ROLLED BACK:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
