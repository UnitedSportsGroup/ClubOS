/**
 * Xero Invoices — every sales invoice raised in Xero, inside ClubOS, filterable, so staff can chase money without a
 * Xero login. United Sports Group workspace → Finance → Xero Invoices.
 *
 * 🔴 ClubOS does NOT pull these. The shared "CUFC AIOS" Xero app's 5,000 calls a day are already spent by the nightly
 * pull and the payout sync — they ran out at 11:52 on 23 Sep 2026, which is exactly why this is a push. The finance app
 * on Daniel's Mac holds the granular read scopes and its own quota; `outputs/club-finance-2026/push_invoices.py` sends
 * a snapshot nightly from refresh.sh. This file stores and serves it. **Xero stays the source of truth** — nothing here
 * is editable, so the tab can never disagree with Xero for longer than a day.
 *
 * 🔴 Overdue is DERIVED on read (`due < today AND still owing`), never stored: a stored flag is wrong by morning.
 * 🔴 The money comes back in CENTS and is formatted in the browser, so no rounding happens twice.
 */
import type { Express } from "express";
import { timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";

const TAB = "xero-invoices";

/** NZ today as y-m-d — never `toISOString()`, which is UTC and reads a day behind here. */
function nzToday(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function registerXeroInvoiceRoutes(app: Express) {
  // ── the tab ────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/admin/xero-invoices", requireAuth, requireTab(TAB), async (req, res) => {
    try {
      const today = nzToday();
      const q = req.query as Record<string, string | undefined>;
      const where: any[] = [sql`1 = 1`];
      if (q.category) where.push(sql`category = ${q.category}`);
      if (q.programme) where.push(sql`programme = ${q.programme}`);
      if (q.search) {
        const like = `%${q.search.toLowerCase()}%`;
        where.push(sql`(lower(contact) LIKE ${like} OR lower(person) LIKE ${like} OR lower(number) LIKE ${like}
                        OR lower(reference) LIKE ${like} OR lower(description) LIKE ${like})`);
      }
      // 🔴 "overdue" is not a stored status — it is unpaid-or-part-paid AND past its due date, worked out here.
      if (q.state === "overdue") where.push(sql`due_cents > 0 AND due IS NOT NULL AND due < ${today}::date`);
      else if (q.state === "unpaid") where.push(sql`status = 'unpaid'`);
      else if (q.state === "part") where.push(sql`status = 'part paid'`);
      else if (q.state === "paid") where.push(sql`status = 'paid'`);
      else if (q.state === "owing") where.push(sql`due_cents > 0`);
      if (q.from) where.push(sql`issued >= ${q.from}::date`);
      if (q.to) where.push(sql`issued <= ${q.to}::date`);
      const cond = where.reduce((a, b) => sql`${a} AND ${b}`);

      const rows = await db.execute(sql`
        SELECT invoice_id, number, contact, code, person, category, programme, status, issued, due,
               total_cents, paid_cents, due_cents, credited_cents, sent, reference, description, accounts,
               payments, last_paid, email, phone, contact_source,
               (due_cents > 0 AND due IS NOT NULL AND due < ${today}::date) AS overdue,
               CASE WHEN due IS NULL THEN NULL ELSE (${today}::date - due) END AS days_overdue
          FROM xero_invoices WHERE ${cond}
         ORDER BY (due_cents > 0) DESC, due NULLS LAST, total_cents DESC
         LIMIT 2000`);

      // the tiles always describe the FILTERED set, so the numbers on screen always match the list under them
      const t = await db.execute(sql`
        SELECT count(*)::int AS n,
               coalesce(sum(total_cents), 0)::int AS total,
               coalesce(sum(paid_cents), 0)::int  AS paid,
               coalesce(sum(due_cents), 0)::int   AS owing,
               coalesce(sum(CASE WHEN due_cents > 0 AND due IS NOT NULL AND due < ${today}::date
                                 THEN due_cents ELSE 0 END), 0)::int AS overdue,
               count(*) FILTER (WHERE NOT sent AND due_cents > 0)::int AS unsent
          FROM xero_invoices WHERE ${cond}`);

      // facets are built over EVERYTHING, not the filtered set — a filter that empties the picker cannot be undone
      const cats = await db.execute(sql`SELECT category AS k, count(*)::int AS n, coalesce(sum(due_cents),0)::int AS owing
                                          FROM xero_invoices GROUP BY category ORDER BY owing DESC, n DESC`);
      const progs = await db.execute(sql`SELECT programme AS k, count(*)::int AS n, coalesce(sum(due_cents),0)::int AS owing
                                           FROM xero_invoices WHERE programme <> '' GROUP BY programme ORDER BY k`);
      const last = await db.execute(sql`SELECT ran_at, rows, as_at FROM xero_invoice_syncs ORDER BY id DESC LIMIT 1`);

      res.json({
        today,
        rows: (rows.rows as any[]),
        totals: (t.rows as any[])[0],
        categories: (cats.rows as any[]),
        programmes: (progs.rows as any[]),
        lastSync: (last.rows as any[])[0] || null,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── the nightly push ───────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/internal/xero-invoices/snapshot", async (req, res) => {
    const token = process.env.FINANCE_INSIGHT_UPLOAD_TOKEN || "";
    const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token)))
      return res.status(401).json({ message: "unauthorized" });
    const list = req.body?.invoices;
    if (!Array.isArray(list) || list.length === 0)
      return res.status(400).json({ message: "invoices[] required" });
    // 🔴 A short push is a broken pull, not a smaller Xero. Refuse it rather than deleting the tab's contents:
    // the caller can pass replace:false to add without pruning, but it can never shrink the mirror by accident.
    const have = (await db.execute(sql`SELECT count(*)::int AS n FROM xero_invoices`)).rows as any[];
    const before = have[0]?.n || 0;
    if (before > 50 && list.length < before * 0.6)
      return res.status(409).json({ message: `refusing: ${list.length} rows would replace ${before} — that looks like a broken pull` });
    try {
      const ids: string[] = [];
      for (const r of list) {
        if (!r?.invoiceId || !r?.number) continue;
        ids.push(String(r.invoiceId));
        await db.execute(sql`
          INSERT INTO xero_invoices (invoice_id, number, contact_id, contact, code, person, category, programme, status,
            issued, due, total_cents, paid_cents, due_cents, credited_cents, sent, reference, description, accounts,
            payments, last_paid, email, phone, contact_source, synced_at)
          VALUES (${r.invoiceId}, ${r.number}, ${r.contactId || null}, ${r.contact || ""}, ${r.code || ""},
                  ${r.person || ""}, ${r.category || "Other"}, ${r.programme || ""}, ${r.status || "unpaid"},
                  ${r.issued}::date, ${r.due || null}, ${r.totalCents | 0}, ${r.paidCents | 0}, ${r.dueCents | 0},
                  ${r.creditedCents | 0}, ${!!r.sent}, ${r.reference || ""}, ${r.description || ""},
                  ${sql.raw(`ARRAY[${(r.accounts || []).map((a: string) => `'${String(a).replace(/'/g, "''")}'`).join(",") || ""}]::text[]`)},
                  ${JSON.stringify(r.payments || [])}::jsonb, ${r.lastPaid || null}, ${r.email || ""}, ${r.phone || ""},
                  ${r.contactSource || ""}, now())
          ON CONFLICT (invoice_id) DO UPDATE SET
            number = EXCLUDED.number, contact_id = EXCLUDED.contact_id, contact = EXCLUDED.contact,
            code = EXCLUDED.code, person = EXCLUDED.person, category = EXCLUDED.category,
            programme = EXCLUDED.programme, status = EXCLUDED.status, issued = EXCLUDED.issued, due = EXCLUDED.due,
            total_cents = EXCLUDED.total_cents, paid_cents = EXCLUDED.paid_cents, due_cents = EXCLUDED.due_cents,
            credited_cents = EXCLUDED.credited_cents, sent = EXCLUDED.sent, reference = EXCLUDED.reference,
            description = EXCLUDED.description, accounts = EXCLUDED.accounts, payments = EXCLUDED.payments,
            last_paid = EXCLUDED.last_paid, email = EXCLUDED.email, phone = EXCLUDED.phone,
            contact_source = EXCLUDED.contact_source, synced_at = now()`);
      }
      // an invoice VOIDED or DELETED in Xero stops being pushed, so it has to go from the mirror too
      if (req.body?.replace !== false && ids.length) {
        await db.execute(sql`DELETE FROM xero_invoices WHERE invoice_id <> ALL(${sql.raw(
          `ARRAY[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(",")}]::text[]`)})`);
      }
      await db.execute(sql`INSERT INTO xero_invoice_syncs (rows, as_at, source)
                           VALUES (${ids.length}, ${req.body?.asAt || null}, ${String(req.body?.source || "push_invoices.py")})`);
      res.json({ ok: true, rows: ids.length, replaced: before });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
