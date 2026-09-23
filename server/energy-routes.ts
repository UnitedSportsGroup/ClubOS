// ─────────────────────────────────────────────────────────────────────────────
// ENERGY — /api/admin/energy
//
//   GET    /api/admin/energy                 sites, bills, payments, the Xero check
//   PATCH  /api/admin/energy/sites/:id       rename, area, who pays, notes, archive
//   POST   /api/admin/energy/sites           a site we don't have a bill feed for yet
//   POST   /api/admin/energy/bills           a bill typed in by hand (water, the centre …)
//   DELETE /api/admin/energy/bills/:id       hand-typed bills only — imported ones are the record
//
// Group-level data: the same sites show in the United Sports Centre and United
// Sports Group workspaces (tab "energy"), because one account pays for sites
// that belong to both. Imported bills come from script/seed-energy.ts, which
// only loads invoices that add up to the cent.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { asc, desc, eq, and } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";
import { energyBills, energyPayments, energySites } from "@shared/schema";
import { nzTodayIso } from "@shared/academy";
import { ENERGY_UNITS, ENERGY_XERO, isEnergyUtility } from "@shared/energy";

class BadRequest extends Error {}
const str = (v: unknown, max = 300) => { const s = typeof v === "string" ? v.trim() : ""; return s ? s.slice(0, max) : null; };
const isoDate = (v: unknown, f: string) => { const s = str(v); if (!s) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequest(`${f} must be a date`); return s; };

function handler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (err: any) {
      if (err instanceof BadRequest) return res.status(400).json({ message: err.message });
      if (err?.code === "23505") return res.status(409).json({ message: "That already exists." });
      if (err?.code === "23514") return res.status(400).json({ message: "That value isn't allowed." });
      console.error("[energy]", req.method, req.path, err);
      if (!res.headersSent) res.status(500).json({ message: "Something went wrong." });
    }
  };
}

export function registerEnergyRoutes(app: Express) {
  const tab = requireTab("energy");

  app.get("/api/admin/energy", requireAuth, tab, handler(async (_req, res) => {
    const [sites, bills, payments] = await Promise.all([
      db.select().from(energySites).orderBy(asc(energySites.utility), asc(energySites.name)),
      db.select({
        id: energyBills.id, siteId: energyBills.siteId, source: energyBills.source, invoiceNumber: energyBills.invoiceNumber, kind: energyBills.kind,
        periodStart: energyBills.periodStart, periodEnd: energyBills.periodEnd, billDate: energyBills.billDate, units: energyBills.units, unit: energyBills.unit,
        cents: energyBills.cents, fixedCents: energyBills.fixedCents, lines: energyBills.lines, readings: energyBills.readings,
      }).from(energyBills).orderBy(desc(energyBills.periodEnd), desc(energyBills.id)),
      db.select().from(energyPayments).orderBy(desc(energyPayments.paidOn)),
    ]);
    res.json({ sites, bills: bills.map((b) => ({ ...b, units: b.units == null ? null : Number(b.units) })), payments, xero: ENERGY_XERO, today: nzTodayIso() });
  }));

  app.patch("/api/admin/energy/sites/:id", requireAuth, tab, handler(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const set: Record<string, unknown> = {};
    if ("name" in b) { const n = str(b.name, 120); if (!n) throw new BadRequest("A site needs a name."); set.name = n; }
    for (const k of ["area", "paidBy", "notes", "address", "accountNumber", "meter", "supplier"] as const) if (k in b) set[k] = str(b[k], k === "notes" || k === "paidBy" ? 1000 : 200);
    if ("archived" in b) set.archivedAt = b.archived ? new Date() : null;
    if (!Object.keys(set).length) throw new BadRequest("Nothing to change.");
    const [row] = await db.update(energySites).set(set as any).where(eq(energySites.id, id)).returning();
    if (!row) return res.status(404).json({ message: "Site not found" });
    res.json({ site: row });
  }));

  app.post("/api/admin/energy/sites", requireAuth, tab, handler(async (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name, 120); if (!name) throw new BadRequest("A site needs a name.");
    if (!isEnergyUtility(b.utility)) throw new BadRequest("Pick electricity, gas or water.");
    const [row] = await db.insert(energySites).values({
      name, utility: b.utility, address: str(b.address), area: str(b.area), supplier: str(b.supplier), accountNumber: str(b.accountNumber),
      icp: str(b.icp, 40), meter: str(b.meter), paidBy: str(b.paidBy, 1000), notes: str(b.notes, 1000),
    }).returning();
    res.status(201).json({ site: row });
  }));

  app.post("/api/admin/energy/bills", requireAuth, tab, handler(async (req, res) => {
    const b = req.body ?? {};
    const [site] = await db.select().from(energySites).where(eq(energySites.id, Number(b.siteId)));
    if (!site) throw new BadRequest("Pick a site.");
    const cents = Number(b.cents);
    if (!Number.isInteger(cents) || cents === 0) throw new BadRequest("Enter the amount on the bill.");
    const units = b.units === null || b.units === undefined || b.units === "" ? null : Number(b.units);
    if (units !== null && (!Number.isFinite(units) || units < 0)) throw new BadRequest("Usage must be a number.");
    const start = isoDate(b.periodStart, "Period start"), end = isoDate(b.periodEnd, "Period end");
    if (!end) throw new BadRequest("When does the bill's period end?");
    const uid = req.session.userId ?? null;
    const [row] = await db.insert(energyBills).values({
      siteId: site.id, source: "manual", sourceKey: `manual:${site.id}:${Date.now()}:${uid ?? 0}`, invoiceNumber: str(b.invoiceNumber, 60),
      kind: cents < 0 ? "credit" : "bill", periodStart: start, periodEnd: end, billDate: isoDate(b.billDate, "Bill date") ?? end,
      units: units === null ? null : String(units), unit: ENERGY_UNITS[site.utility as keyof typeof ENERGY_UNITS] ?? null,
      cents, fixedCents: Number.isInteger(Number(b.fixedCents)) ? Number(b.fixedCents) : 0, createdBy: uid,
    }).returning();
    res.status(201).json({ bill: row });
  }));

  app.delete("/api/admin/energy/bills/:id", requireAuth, tab, handler(async (req, res) => {
    const [row] = await db.delete(energyBills).where(and(eq(energyBills.id, Number(req.params.id)), eq(energyBills.source, "manual"))).returning();
    if (!row) return res.status(404).json({ message: "Only a bill typed in by hand can be deleted — imported bills are the supplier's record." });
    res.json({ deleted: true });
  }));
}
