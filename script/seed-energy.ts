/**
 * Energy — load the parsed supplier invoices into ClubOS.
 *
 *   npx tsx --env-file=.env script/seed-energy.ts <outputs/energy dir>            # dry run
 *   npx tsx --env-file=.env script/seed-energy.ts <outputs/energy dir> --commit
 *
 * Reads meridian_invoices.json + kiwigas_invoices.json (made by the parsers in
 * outputs/energy/, which refuse any invoice that doesn't add up to the cent).
 * One energy_bills row per supplier DOCUMENT per SITE — a credit note that
 * reverses an old bill is its own negative row, so a period nets to what was
 * really charged. Payments, fees and bounced direct debits come from the
 * Meridian statements. Idempotent on source_key: re-running adds only what is new.
 * Sites are matched on ICP (electricity) and never renamed once they exist —
 * a human may have renamed them in the tab.
 */
import { readFileSync } from "fs";
import { join, resolve } from "path";
import pg from "pg";

const dir = resolve(process.argv[2] ?? "../../outputs/energy");
const COMMIT = process.argv.includes("--commit");
const mer = JSON.parse(readFileSync(join(dir, "meridian_invoices.json"), "utf8"));
const gas = JSON.parse(readFileSync(join(dir, "kiwigas_invoices.json"), "utf8"));

// What the club's own books say each site is. Only facts we hold: the Xero
// account the payments are coded to, and the address on the bill.
const CLUB_PAYS = "Christchurch United FC — the club's own bank account (Xero)";
const SITES: Record<string, { name: string; area: string | null; paidBy: string; notes: string | null }> = {
  "0006573800RNAE3": { name: "482 Yaldhurst Road", area: "Residency", paidBy: `${CLUB_PAYS}, coded Residency – Power & Heating (221/04)`, notes: null },
  "0007174015RN66A": { name: "482A Yaldhurst Road", area: "Residency", paidBy: `${CLUB_PAYS}, coded Residency – Power & Heating (221/04)`,
    notes: "Billed on its own Meridian account (603057345) for its first month, Jan 2024, then moved onto 40593350." },
  "0007101304RNE18": { name: "29B Domain Terrace, Spreydon", area: null, paidBy: `${CLUB_PAYS}, coded Light, Power, Heating`,
    notes: "Small, steady load plus an unmetered-load charge. What this connection supplies is not recorded here — name it." },
};

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let sitesNew = 0, billsNew = 0, paysNew = 0;
try {
  await c.query("BEGIN");

  const siteId = new Map<string, number>();
  const ensureSite = async (key: string, v: { name: string; address: string | null; utility: string; area: string | null; supplier: string; account: string | null; icp: string | null; meter: string | null; paidBy: string; notes: string | null }) => {
    const found = v.icp
      ? await c.query(`SELECT id FROM energy_sites WHERE icp = $1`, [v.icp])
      : await c.query(`SELECT id FROM energy_sites WHERE utility = $1 AND supplier = $2 AND coalesce(account_number,'') = coalesce($3,'')`, [v.utility, v.supplier, v.account]);
    if (found.rows[0]) { siteId.set(key, found.rows[0].id); return; }
    const r = await c.query(
      `INSERT INTO energy_sites (name, address, utility, area, supplier, account_number, icp, meter, paid_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [v.name, v.address, v.utility, v.area, v.supplier, v.account, v.icp, v.meter, v.paidBy, v.notes]);
    siteId.set(key, r.rows[0].id); sitesNew++;
  };

  // ── Meridian electricity ────────────────────────────────────────────────
  for (const inv of mer.invoices) {
    for (let k = 0; k < inv.documents.length; k++) {
      const doc = inv.documents[k];
      for (const p of doc.properties) {
        const meta = SITES[p.icp] ?? { name: p.address, area: null, paidBy: CLUB_PAYS, notes: null };
        const meter = p.lines.find((l: any) => l.meter)?.meter ?? null;
        if (!siteId.has(p.icp)) {
          await ensureSite(p.icp, { name: meta.name, address: p.address.replace(/\s+/g, " "), utility: "electricity", area: meta.area, supplier: "Meridian Energy",
            account: "40593350", icp: p.icp, meter, paidBy: meta.paidBy, notes: meta.notes });
        }
        const readings = k === inv.documents.findIndex((d: any) => d.kind === "bill" && d.properties.some((q: any) => q.icp === p.icp))
          ? inv.readings.filter((r: any) => r.icp === p.icp) : [];
        const fixed = p.lines.filter((l: any) => l.kind === "daily").reduce((s: number, l: any) => s + l.cents, 0);
        const r = await c.query(
          `INSERT INTO energy_bills (site_id, source, source_key, invoice_number, kind, period_start, period_end, bill_date, units, unit, cents, fixed_cents, lines, readings, file)
           VALUES ($1,'meridian',$2,$3,$4,$5,$6,$7,$8,'kWh',$9,$10,$11,$12,$13) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
          [siteId.get(p.icp), `meridian:${inv.invoiceNumber}:${k}:${p.icp}`, inv.invoiceNumber, p.cents < 0 ? "credit" : "bill",
           doc.periodStart ?? null, doc.periodEnd ?? null, inv.billDate ?? null, p.kwh ?? null, p.cents, fixed,
           JSON.stringify(p.lines), JSON.stringify(readings), inv.file]);
        if (r.rowCount) billsNew++;
      }
    }
    // Statement lines: payments, fees, bounced direct debits (deduped across invoices).
    for (const s of inv.statement) {
      const kind = /dishonour/i.test(s.desc) ? "dishonour" : /^fee/i.test(s.desc) ? "fee" : s.cents < 0 ? "payment" : null;
      if (!kind) continue;
      const r = await c.query(
        `INSERT INTO energy_payments (supplier, account_number, paid_on, cents, method, kind, source_key) VALUES ('Meridian Energy',$1,$2,$3,$4,$5,$6)
         ON CONFLICT (source_key) DO NOTHING RETURNING id`,
        [inv.account ?? "40593350", s.date, Math.abs(s.cents), kind === "payment" ? (s.how || null) : s.desc, kind,
         `meridian:${inv.account ?? "40593350"}:${s.date}:${s.cents}:${s.desc}`]);
      if (r.rowCount) paysNew++;
    }
  }

  // ── KiwiGas LPG ─────────────────────────────────────────────────────────
  await ensureSite("kiwigas", { name: "LPG gas bottles — 482A Yaldhurst Road", address: "482A Yaldhurst Road, Yaldhurst, Christchurch 7676", utility: "gas",
    area: "Residency", supplier: "KiwiGas", account: "31151", icp: null, meter: null, paidBy: `${CLUB_PAYS}, coded Residency – Power & Heating (221/04)`,
    notes: "45 kg LPG cylinders, delivered. Only the invoices that reached the accounts inbox are here." });
  for (const g of gas.invoices) {
    const rental = g.lines.filter((l: any) => !l.kg).reduce((s: number, l: any) => s + l.cents, 0);
    const r = await c.query(
      `INSERT INTO energy_bills (site_id, source, source_key, invoice_number, kind, period_start, period_end, bill_date, units, unit, cents, fixed_cents, lines, file)
       VALUES ($1,'kiwigas',$2,$3,'bill',$4,$4,$4,$5,'kg',$6,$7,$8,$9) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
      [siteId.get("kiwigas"), `kiwigas:${g.invoiceNumber}`, g.invoiceNumber, g.date, g.kg, g.totalCents, rental, JSON.stringify(g.lines), g.file]);
    if (r.rowCount) billsNew++;
  }

  const t = await c.query(`SELECT (SELECT count(*) FROM energy_sites) s, (SELECT count(*) FROM energy_bills) b, (SELECT sum(cents) FROM energy_bills WHERE source='meridian') m,
                                  (SELECT count(*) FROM energy_payments) p`);
  console.log(`new: ${sitesNew} sites · ${billsNew} bills · ${paysNew} payment lines`);
  console.log(`now: ${t.rows[0].s} sites · ${t.rows[0].b} bills · Meridian billed $${(Number(t.rows[0].m) / 100).toFixed(2)} · ${t.rows[0].p} payment lines`);
  if (COMMIT) { await c.query("COMMIT"); console.log("COMMITTED"); } else { await c.query("ROLLBACK"); console.log("Dry run — rolled back"); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
finally { await c.end(); }
