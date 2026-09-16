// ─────────────────────────────────────────────────────────────────────────────
// PRINT EXPENSES — every purchase the print shop makes, with its invoice.
//
//   GET    /api/admin/print-expenses                 — list + totals
//   POST   /api/admin/print-expenses
//   PATCH  /api/admin/print-expenses/:id
//   DELETE /api/admin/print-expenses/:id
//   GET    /api/admin/print-expenses/:id/invoice     — streams the stored file
//
// 🔴 GST is recorded, never inferred. See the migration for why.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";
import { organizations, users, printExpenses } from "@shared/schema";
import { TT_BRANDS, TT_BRAND_KEYS } from "@shared/task-tracker";

/**
 * Parse and check a brand split.
 *
 * 🔴 The amounts must sum to the expense total EXACTLY. A split that does not
 * add up makes every report built on it wrong, in a way nobody notices for a
 * year. 🔴 Brands are checked against TT_BRAND_KEYS — the list ClubOS already
 * uses everywhere else — rather than a second list that would drift.
 */
function parseAllocations(raw: any, totalCents: number):
  { ok: true; rows: { brand: string; amountCents: number }[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Brand split must be a list." };
  const rows: { brand: string; amountCents: number }[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const brand = String(r?.brand ?? "").trim();
    const amountCents = Math.round(Number(r?.amountCents));
    if (!TT_BRAND_KEYS.includes(brand)) return { ok: false, error: `"${brand}" isn't one of our brands.` };
    if (!Number.isFinite(amountCents) || amountCents <= 0) return { ok: false, error: "Every brand needs an amount above zero." };
    if (seen.has(brand)) return { ok: false, error: "That brand is in the split twice — make it one amount." };
    seen.add(brand);
    rows.push({ brand, amountCents });
  }
  if (rows.length === 0) return { ok: true, rows };   // cleared back to "not allocated"
  const sum = rows.reduce((a, b) => a + b.amountCents, 0);
  if (sum !== totalCents) {
    const d = (n: number) => `$${(n / 100).toFixed(2)}`;
    return { ok: false, error: `The split comes to ${d(sum)} but the invoice is ${d(totalCents)} — they have to match.` };
  }
  return { ok: true, rows };
}

const CATEGORIES = ["merchandise", "materials", "equipment", "services", "freight", "software", "other"] as const;
const TREATMENTS = ["inclusive", "plus_gst", "zero_rated", "overseas_no_gst"] as const;
// AliPay added 2026-09-16 — it is how the shop pays its Chinese suppliers.
const PAID_WITH = ["card", "eftpos", "bank_transfer", "alipay", "cash", "account", "other"] as const;

/** Currencies the shop actually buys in. NZD first because almost everything is. */
const CURRENCIES = ["NZD", "CNY", "USD", "AUD", "EUR", "GBP"] as const;

/**
 * Today's — or a given day's — rate, from the European Central Bank via
 * Frankfurter. Free, no key, and it answers for a specific DATE, which is the
 * whole point: an invoice from 10 September should be converted at the 10
 * September rate, not at whatever today's happens to be.
 *
 * 🔴 Returns null rather than a guess. If the rate cannot be fetched, the NZD
 * figure is whatever Dima typed from his own statement — the system never
 * invents a conversion and never presents one as fact.
 */
async function fxToNzd(currency: string, onDate: string): Promise<{ rate: number; source: string } | null> {
  if (currency === "NZD") return null;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${onDate}?base=${encodeURIComponent(currency)}&symbols=NZD`,
      { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const body: any = await res.json();
    const rate = Number(body?.rates?.NZD);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    // The date it ANSWERED for, not the one asked — ECB does not publish on a
    // weekend, so a Sunday invoice gets Friday's rate and should say so.
    return { rate, source: `ECB via Frankfurter, ${body?.date ?? onDate}` };
  } catch { return null; }
}

const NZ_GST_RATE = 0.15;

const s = (v: any, max = 500): string => String(v ?? "").trim().slice(0, max);
const cents = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};
/** YYYY-MM-DD only — a bare ISO date never goes through a JS Date here. */
const isoDate = (v: any): string | null => {
  const t = s(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

// The invoice file, inline. 8MB of base64 ≈ a 6MB PDF, which covers any real
// supplier invoice; the express json limit is 25mb so this fits inside it.
const MAX_INVOICE_CHARS = 8_000_000;
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

class ExpenseError extends Error {}

function cleanInvoice(body: any): { invoiceFileName: string | null; invoiceMime: string | null; invoiceData: string | null } | null {
  if (!("invoiceData" in (body ?? {}))) return null;           // field absent → leave alone
  if (body.invoiceData === null || body.invoiceData === "") {
    return { invoiceFileName: null, invoiceMime: null, invoiceData: null };  // explicit removal
  }
  const data = String(body.invoiceData);
  const m = /^data:([^;]+);base64,/.exec(data);
  if (!m) throw new ExpenseError("That file couldn't be read — attach a PDF or a photo of the invoice");
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) throw new ExpenseError("Attach a PDF, or a PNG/JPG photo of the invoice");
  if (data.length > MAX_INVOICE_CHARS) throw new ExpenseError("That file is too big — under about 6MB, please");
  return {
    invoiceFileName: s(body.invoiceFileName, 200) || "invoice",
    invoiceMime: mime,
    invoiceData: data,
  };
}

/**
 * What the GST field means, per treatment. Returns the gst in cents.
 *
 * 🔴 `plus_gst` is the only case we compute, and only because the arithmetic is
 * unambiguous: the supplier quoted a net figure and GST is 15% on top, so the
 * total is net × 1.15. Everything else is taken as stated:
 *   inclusive       — Dima types the total and the GST inside it (or leaves GST
 *                     blank and we derive total − total/1.15, the standard NZ
 *                     inclusive extraction)
 *   zero_rated      — 0, by definition
 *   overseas_no_gst — 0. Customs GST on an import arrives on a different
 *                     document and is claimed separately; inventing it here
 *                     would be a false claim.
 */
function resolveMoney(body: any): { totalCents: number; gstCents: number; gstTreatment: string } {
  const treatment = TREATMENTS.includes(body?.gstTreatment) ? body.gstTreatment : "inclusive";
  const rawTotal = cents(body?.totalCents);
  const rawGst = body?.gstCents === undefined || body?.gstCents === null || body?.gstCents === "" ? null : cents(body.gstCents);

  if (treatment === "zero_rated" || treatment === "overseas_no_gst") {
    return { totalCents: rawTotal, gstCents: 0, gstTreatment: treatment };
  }
  if (treatment === "plus_gst") {
    // rawTotal is the NET the supplier quoted.
    const gst = Math.round(rawTotal * NZ_GST_RATE);
    return { totalCents: rawTotal + gst, gstCents: gst, gstTreatment: treatment };
  }
  // inclusive
  const gst = rawGst !== null ? Math.min(rawGst, rawTotal) : Math.round(rawTotal - rawTotal / (1 + NZ_GST_RATE));
  return { totalCents: rawTotal, gstCents: gst, gstTreatment: "inclusive" };
}

/**
 * Work out what to store for a purchase made in another currency.
 *
 * 🔴 The FOREIGN amount is the fact; the NZD figure is an estimate. What the
 * club is really out is whatever ANZ settled the card at, margin included, and
 * only the bank and Xero know that. So the rate is fetched for the invoice's
 * OWN date and recorded with its source, and anything derived from it is shown
 * with a ~. A converted number stored as if it were the truth is how a ledger
 * quietly stops matching the bank.
 */
async function resolveCurrency(body: any, spentOn: string, fallbackNzdCents: number) {
  const currency = CURRENCIES.includes(body?.currency) ? body.currency : "NZD";
  if (currency === "NZD") {
    return { currency: "NZD", foreignCents: null, fxRate: null, fxRateOn: null, fxSource: null, nzdCents: fallbackNzdCents };
  }
  const foreignCents = cents(body?.foreignCents);
  if (foreignCents <= 0) throw new ExpenseError("Add the amount in that currency");

  const fx = await fxToNzd(currency, spentOn);
  if (!fx) {
    // No rate available — keep the NZD figure the human typed and say plainly
    // that nothing converted it. Never fabricate a rate to fill the column.
    return {
      currency, foreignCents, fxRate: null, fxRateOn: null,
      fxSource: "entered by hand — no rate available",
      nzdCents: fallbackNzdCents,
    };
  }
  return {
    currency, foreignCents,
    fxRate: fx.rate, fxRateOn: spentOn, fxSource: fx.source,
    nzdCents: Math.round(foreignCents * fx.rate),
  };
}

async function workspaceOrg(req: Request): Promise<{ id: number; slug: string } | null> {
  const slug = String(req.headers["x-workspace-slug"] || "").trim();
  if (!slug) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  return org ? { id: org.id, slug: org.slug } : null;
}

function handle(res: Response, e: any, what: string) {
  if (e instanceof ExpenseError) return res.status(400).json({ message: e.message });
  console.error(`[print-expenses] ${what} failed:`, e);
  res.status(500).json({ message: e?.message ?? "Something went wrong" });
}

export function registerPrintExpenseRoutes(app: Express) {
  const tab = requireTab("expenses");

  app.get("/api/admin/print-expenses", requireAuth, tab, async (req, res) => {
    try {
      const org = await workspaceOrg(req);
      if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });

      const from = isoDate(req.query.from);
      const to = isoDate(req.query.to);
      const category = typeof req.query.category === "string" && CATEGORIES.includes(req.query.category as any)
        ? req.query.category : null;

      const where = [eq(printExpenses.organizationId, org.id)];
      if (from) where.push(gte(printExpenses.spentOn, from));
      if (to) where.push(lte(printExpenses.spentOn, to));
      if (category) where.push(eq(printExpenses.category, category));

      const rows = await db.select({
        id: printExpenses.id,
        category: printExpenses.category,
        supplier: printExpenses.supplier,
        description: printExpenses.description,
        reference: printExpenses.reference,
        totalCents: printExpenses.totalCents,
        gstCents: printExpenses.gstCents,
        gstTreatment: printExpenses.gstTreatment,
        // 🔴 Cast to text so a bare date never becomes a JS Date on the way out.
        spentOn: sql<string>`${printExpenses.spentOn}::text`,
        paidWith: printExpenses.paidWith,
        invoiceFileName: printExpenses.invoiceFileName,
        invoiceMime: printExpenses.invoiceMime,
        // 🔴 NOT invoiceData — a list of 300 expenses would be hundreds of
        // megabytes of base64. The file is fetched one at a time by its own route.
        hasInvoice: sql<boolean>`${printExpenses.invoiceData} IS NOT NULL`,
        currency: printExpenses.currency,
        foreignCents: printExpenses.foreignCents,
        fxRate: printExpenses.fxRate,
        fxRateOn: sql<string | null>`${printExpenses.fxRateOn}::text`,
        fxSource: printExpenses.fxSource,
        notes: printExpenses.notes,
        createdByUserId: printExpenses.createdByUserId,
        createdAt: printExpenses.createdAt,
      }).from(printExpenses).where(and(...where)).orderBy(desc(printExpenses.spentOn), desc(printExpenses.id));

      const names = new Map<number, string>();
      const ids = Array.from(new Set(rows.map((r) => r.createdByUserId).filter(Boolean) as number[]));
      if (ids.length) {
        const people = await db.select({ id: users.id, f: users.firstName, l: users.lastName, e: users.email })
          .from(users).where(sql`${users.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
        people.forEach((p) => names.set(p.id, [p.f, p.l].filter(Boolean).join(" ") || p.e || "Unknown"));
      }

      // Totals over the filtered set — the whole point of the tab.
      const totalCents = rows.reduce((a, r) => a + r.totalCents, 0);
      const gstCents = rows.reduce((a, r) => a + r.gstCents, 0);
      const byCategory: Record<string, { totalCents: number; gstCents: number; count: number }> = {};
      rows.forEach((r) => {
        const b = byCategory[r.category] ?? { totalCents: 0, gstCents: 0, count: 0 };
        b.totalCents += r.totalCents; b.gstCents += r.gstCents; b.count += 1;
        byCategory[r.category] = b;
      });
      // Newest 12 months, for the trend strip.
      const byMonth: Record<string, number> = {};
      rows.forEach((r) => {
        const key = String(r.spentOn).slice(0, 7);
        byMonth[key] = (byMonth[key] ?? 0) + r.totalCents;
      });

      // The brand split, in one query rather than one per row.
      const allocByExpense = new Map<number, { brand: string; amountCents: number }[]>();
      if (rows.length) {
        const allocRows: any = await db.execute(sql`
          SELECT expense_id, brand, amount_cents FROM print_expense_allocations
          WHERE expense_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
          ORDER BY amount_cents DESC`);
        for (const a of (allocRows.rows ?? allocRows) as any[]) {
          const list = allocByExpense.get(a.expense_id) ?? [];
          list.push({ brand: a.brand, amountCents: Number(a.amount_cents) });
          allocByExpense.set(a.expense_id, list);
        }
      }

      res.json({
        expenses: rows.map((r) => ({
          ...r,
          createdByName: r.createdByUserId ? (names.get(r.createdByUserId) ?? null) : null,
          // net is derived, never stored
          netCents: r.totalCents - r.gstCents,
          // [] means NOT ALLOCATED — nobody has said what it was for. It is
          // never filled in with a guess.
          allocations: allocByExpense.get(r.id) ?? [],
        })),
        totals: { count: rows.length, totalCents, gstCents, netCents: totalCents - gstCents },
        byCategory,
        byMonth,
        vocab: { categories: CATEGORIES, treatments: TREATMENTS, paidWith: PAID_WITH, brands: TT_BRANDS, currencies: CURRENCIES },
      });
    } catch (e: any) { handle(res, e, "list"); }
  });

  app.post("/api/admin/print-expenses", requireAuth, tab, async (req, res) => {
    try {
      const org = await workspaceOrg(req);
      if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });

      const description = s(req.body?.description, 500);
      if (!description) throw new ExpenseError("Say what the purchase was for");
      const spentOn = isoDate(req.body?.spentOn);
      if (!spentOn) throw new ExpenseError("Add the invoice date");
      const category = CATEGORIES.includes(req.body?.category) ? req.body.category : "other";
      const money = resolveMoney(req.body);
      const fx = await resolveCurrency(req.body, spentOn, money.totalCents);
      // The NZD figure is what the books hold — converted where we had a rate,
      // typed by a human where we did not.
      money.totalCents = fx.nzdCents;
      if (money.totalCents <= 0) throw new ExpenseError("Add the amount");
      const invoice = cleanInvoice(req.body);

      const [row] = await db.insert(printExpenses).values({
        organizationId: org.id,
        category,
        supplier: s(req.body?.supplier, 200) || null,
        description,
        reference: s(req.body?.reference, 120) || null,
        ...money,
        currency: fx.currency,
        foreignCents: fx.foreignCents,
        fxRate: fx.fxRate != null ? String(fx.fxRate) : null,
        fxRateOn: fx.fxRateOn,
        fxSource: fx.fxSource,
        spentOn,
        paidWith: PAID_WITH.includes(req.body?.paidWith) ? req.body.paidWith : (s(req.body?.paidWith, 40) || null),
        notes: s(req.body?.notes, 2000) || null,
        createdByUserId: req.session.userId!,
        ...(invoice ?? {}),
      }).returning({ id: printExpenses.id });
      res.status(201).json({ id: row.id });
    } catch (e: any) { handle(res, e, "create"); }
  });

  app.patch("/api/admin/print-expenses/:id", requireAuth, tab, async (req, res) => {
    try {
      const org = await workspaceOrg(req);
      const id = parseInt(String(req.params.id), 10);
      if (!org || !Number.isFinite(id)) return res.status(400).json({ message: "Bad request" });
      const [existing] = await db.select({ id: printExpenses.id }).from(printExpenses)
        .where(and(eq(printExpenses.id, id), eq(printExpenses.organizationId, org.id)));
      if (!existing) return res.status(404).json({ message: "Not found" });

      const patch: Record<string, any> = { updatedAt: new Date() };
      if (req.body?.description !== undefined) {
        const d = s(req.body.description, 500);
        if (!d) throw new ExpenseError("Say what the purchase was for");
        patch.description = d;
      }
      if (req.body?.category !== undefined && CATEGORIES.includes(req.body.category)) patch.category = req.body.category;
      if (req.body?.supplier !== undefined) patch.supplier = s(req.body.supplier, 200) || null;
      if (req.body?.reference !== undefined) patch.reference = s(req.body.reference, 120) || null;
      if (req.body?.notes !== undefined) patch.notes = s(req.body.notes, 2000) || null;
      if (req.body?.paidWith !== undefined) patch.paidWith = s(req.body.paidWith, 40) || null;
      if (req.body?.spentOn !== undefined) {
        const d = isoDate(req.body.spentOn);
        if (!d) throw new ExpenseError("That invoice date isn't a date");
        patch.spentOn = d;
      }
      // Money moves together or not at all — a total without its treatment is
      // how you end up with GST that doesn't match the invoice.
      if (req.body?.totalCents !== undefined || req.body?.gstTreatment !== undefined
          || req.body?.gstCents !== undefined || req.body?.currency !== undefined) {
        const m = resolveMoney(req.body);
        const when = patch.spentOn ?? (await db.select({ d: sql<string>`${printExpenses.spentOn}::text` })
          .from(printExpenses).where(eq(printExpenses.id, id)))[0]?.d ?? isoDate(new Date().toISOString());
        const fx = await resolveCurrency(req.body, String(when), m.totalCents);
        Object.assign(patch, m, {
          totalCents: fx.nzdCents,
          currency: fx.currency,
          foreignCents: fx.foreignCents,
          fxRate: fx.fxRate != null ? String(fx.fxRate) : null,
          fxRateOn: fx.fxRateOn,
          fxSource: fx.fxSource,
        });
        if (patch.totalCents <= 0) throw new ExpenseError("Add the amount");
      }
      const invoice = cleanInvoice(req.body);
      if (invoice) Object.assign(patch, invoice);

      await db.update(printExpenses).set(patch)
        .where(and(eq(printExpenses.id, id), eq(printExpenses.organizationId, org.id)));

      // ── What the money was FOR ────────────────────────────────────────────
      // Daniel, 2026-09-16: "allow him to breakdown and select what it's for
      // like cic, cufc, siu, united prints, mfl etc... then we'll be able to
      // have a view how much was spent on what for reporting."
      //
      // 🔴 Replace-all inside the same request, and the amounts must sum to the
      // expense total EXACTLY. A split that does not add up makes every report
      // built on it wrong, and it is the kind of wrong nobody notices for a
      // year. An empty list clears the allocation back to "not allocated",
      // which is a real answer.
      if (req.body?.allocations !== undefined) {
        const total = patch.totalCents ?? (await db.select({ t: printExpenses.totalCents })
          .from(printExpenses).where(eq(printExpenses.id, id)))[0]?.t ?? 0;
        const parsed = parseAllocations(req.body.allocations, Number(total));
        if (!parsed.ok) throw new ExpenseError(parsed.error);
        await db.execute(sql`DELETE FROM print_expense_allocations WHERE expense_id = ${id}`);
        for (const a of parsed.rows) {
          await db.execute(sql`
            INSERT INTO print_expense_allocations (expense_id, brand, amount_cents)
            VALUES (${id}, ${a.brand}, ${a.amountCents})`);
        }
      }
      res.json({ ok: true });
    } catch (e: any) { handle(res, e, "update"); }
  });

  // Spend by brand — the report the allocation exists for.
  app.get("/api/admin/print-expenses/by-brand", requireAuth, tab, async (req, res) => {
    try {
      const org = await workspaceOrg(req);
      if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
      const from = isoDate(req.query.from);
      const to = isoDate(req.query.to);

      const rows: any = await db.execute(sql`
        SELECT a.brand, sum(a.amount_cents)::int AS cents, count(DISTINCT a.expense_id)::int AS purchases
        FROM print_expense_allocations a
        JOIN print_expenses e ON e.id = a.expense_id
        WHERE e.organization_id = ${org.id}
          ${from ? sql`AND e.spent_on >= ${from}` : sql``}
          ${to ? sql`AND e.spent_on <= ${to}` : sql``}
        GROUP BY a.brand ORDER BY 2 DESC`);

      // 🔴 Unallocated is REPORTED, never hidden and never spread across the
      // brands. "We don't know what $1,345 was for" is the useful answer; a
      // silent omission makes the brand totals look like the whole picture.
      const un: any = await db.execute(sql`
        SELECT coalesce(sum(e.total_cents), 0)::int AS cents, count(*)::int AS purchases
        FROM print_expenses e
        WHERE e.organization_id = ${org.id}
          AND NOT EXISTS (SELECT 1 FROM print_expense_allocations a WHERE a.expense_id = e.id)
          ${from ? sql`AND e.spent_on >= ${from}` : sql``}
          ${to ? sql`AND e.spent_on <= ${to}` : sql``}`);

      res.json({
        brands: (rows.rows ?? rows).map((r: any) => ({ brand: r.brand, cents: Number(r.cents), purchases: Number(r.purchases) })),
        unallocated: { cents: Number((un.rows ?? un)[0]?.cents ?? 0), purchases: Number((un.rows ?? un)[0]?.purchases ?? 0) },
      });
    } catch (e: any) { handle(res, e, "by-brand"); }
  });

  app.delete("/api/admin/print-expenses/:id", requireAuth, tab, async (req, res) => {
    try {
      const org = await workspaceOrg(req);
      const id = parseInt(String(req.params.id), 10);
      if (!org || !Number.isFinite(id)) return res.status(400).json({ message: "Bad request" });
      const [existing] = await db.select({ id: printExpenses.id }).from(printExpenses)
        .where(and(eq(printExpenses.id, id), eq(printExpenses.organizationId, org.id)));
      if (!existing) return res.status(404).json({ message: "Not found" });
      await db.delete(printExpenses).where(eq(printExpenses.id, id));
      res.status(204).end();
    } catch (e: any) { handle(res, e, "delete"); }
  });

  // The stored invoice, one at a time. Session-gated like everything else here —
  // a supplier invoice carries pricing nobody outside the shop should read.
  app.get("/api/admin/print-expenses/:id/invoice", requireAuth, tab, async (req, res) => {
    try {
      const org = await workspaceOrg(req);
      const id = parseInt(String(req.params.id), 10);
      if (!org || !Number.isFinite(id)) return res.status(400).json({ message: "Bad request" });
      const [row] = await db.select({
        data: printExpenses.invoiceData, mime: printExpenses.invoiceMime, name: printExpenses.invoiceFileName,
      }).from(printExpenses).where(and(eq(printExpenses.id, id), eq(printExpenses.organizationId, org.id)));
      if (!row?.data) return res.status(404).json({ message: "No invoice attached" });

      const b64 = row.data.slice(row.data.indexOf(",") + 1);
      const buf = Buffer.from(b64, "base64");
      res.setHeader("Content-Type", row.mime || "application/octet-stream");
      // inline so a PDF opens in the browser tab rather than forcing a download.
      res.setHeader("Content-Disposition", `inline; filename="${(row.name || "invoice").replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, max-age=0, no-store");
      res.send(buf);
    } catch (e: any) { handle(res, e, "invoice"); }
  });
}
