// Budget module — Drizzle queries.
// Kept out of `storage.ts` because that file is already 2200+ lines; the
// budget feature is self-contained enough to live on its own.

import { db } from "./db";
import { and, eq, asc, sql, inArray } from "drizzle-orm";
import {
  budgetCostCentres,
  budgetLines,
  budgetLineAttachments,
  budgetSyncRuns,
  users,
  type BudgetCostCentre,
  type BudgetLine,
  type BudgetLineAttachment,
  type BudgetSyncRun,
  type InsertBudgetCostCentre,
  type InsertBudgetLine,
  type InsertBudgetLineAttachment,
  type InsertBudgetSyncRun,
} from "@shared/schema";

export type CostCentreWithOwner = BudgetCostCentre & {
  ownerName: string | null;
  ownerEmail: string | null;
};

export type RollupRow = BudgetCostCentre & {
  totalIncomeCents: number;
  totalExpenseCents: number;
  netCents: number;
  ownerName: string | null;
};

export type RollupTotals = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

export type MonthlyRollupRow = BudgetCostCentre & {
  ownerName: string | null;
  incomeByMonth: number[];   // length 12, cents
  expenseByMonth: number[];  // length 12, cents
  totalIncomeCents: number;
  totalExpenseCents: number;
  netCents: number;
};

export type MonthlyRollupTotals = {
  incomeByMonth: number[];   // length 12
  expenseByMonth: number[];  // length 12
  netByMonth: number[];      // length 12
  cumulativeNetByMonth: number[]; // length 12
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

export const budgetStorage = {
  // ── Cost centres ────────────────────────────────────────────────────────

  async list(orgId: number, year: number): Promise<CostCentreWithOwner[]> {
    const rows = await db
      .select({ cc: budgetCostCentres, owner: users })
      .from(budgetCostCentres)
      .leftJoin(users, eq(users.id, budgetCostCentres.ownerId))
      .where(and(eq(budgetCostCentres.organizationId, orgId), eq(budgetCostCentres.year, year)))
      .orderBy(asc(budgetCostCentres.displayOrder), asc(budgetCostCentres.name));
    return rows.map(r => ({
      ...r.cc,
      ownerName: r.owner ? `${r.owner.firstName} ${r.owner.lastName}`.trim() : null,
      ownerEmail: r.owner?.email ?? null,
    }));
  },

  async getById(id: number): Promise<CostCentreWithOwner | undefined> {
    const [r] = await db
      .select({ cc: budgetCostCentres, owner: users })
      .from(budgetCostCentres)
      .leftJoin(users, eq(users.id, budgetCostCentres.ownerId))
      .where(eq(budgetCostCentres.id, id));
    if (!r) return undefined;
    return {
      ...r.cc,
      ownerName: r.owner ? `${r.owner.firstName} ${r.owner.lastName}`.trim() : null,
      ownerEmail: r.owner?.email ?? null,
    };
  },

  async getBySlug(orgId: number, slug: string, year: number): Promise<CostCentreWithOwner | undefined> {
    const [r] = await db
      .select({ cc: budgetCostCentres, owner: users })
      .from(budgetCostCentres)
      .leftJoin(users, eq(users.id, budgetCostCentres.ownerId))
      .where(and(
        eq(budgetCostCentres.organizationId, orgId),
        eq(budgetCostCentres.slug, slug),
        eq(budgetCostCentres.year, year),
      ));
    if (!r) return undefined;
    return {
      ...r.cc,
      ownerName: r.owner ? `${r.owner.firstName} ${r.owner.lastName}`.trim() : null,
      ownerEmail: r.owner?.email ?? null,
    };
  },

  async create(data: InsertBudgetCostCentre): Promise<BudgetCostCentre> {
    const [r] = await db.insert(budgetCostCentres).values(data as any).returning();
    return r;
  },

  async update(id: number, updates: Partial<InsertBudgetCostCentre>): Promise<BudgetCostCentre | undefined> {
    const [r] = await db
      .update(budgetCostCentres)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(budgetCostCentres.id, id))
      .returning();
    return r;
  },

  async delete(id: number): Promise<boolean> {
    const r = await db.delete(budgetCostCentres).where(eq(budgetCostCentres.id, id)).returning();
    return r.length > 0;
  },

  // ── Lines ────────────────────────────────────────────────────────────────

  async getLines(costCentreId: number): Promise<BudgetLine[]> {
    return db
      .select()
      .from(budgetLines)
      .where(eq(budgetLines.costCentreId, costCentreId))
      .orderBy(asc(budgetLines.section), asc(budgetLines.displayOrder), asc(budgetLines.id));
  },

  async getLine(id: number): Promise<BudgetLine | undefined> {
    const [r] = await db.select().from(budgetLines).where(eq(budgetLines.id, id));
    return r;
  },

  async createLine(data: InsertBudgetLine): Promise<BudgetLine> {
    const computed = recomputeIfComputed(data);
    const [r] = await db.insert(budgetLines).values(computed as any).returning();
    if (r.parentLineId) await this.recomputeParentTotal(r.parentLineId);
    return r;
  },

  async updateLine(id: number, updates: Partial<InsertBudgetLine>, userId: number): Promise<BudgetLine | undefined> {
    const existing = await this.getLine(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    const computed = recomputeIfComputed(merged);

    // If this line has children, its amount is auto-summed — ignore any
    // manual amountCents in the update payload.
    const kids = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(budgetLines)
      .where(eq(budgetLines.parentLineId, id));
    const hasChildren = (kids[0]?.c ?? 0) > 0;

    const [r] = await db
      .update(budgetLines)
      .set({
        ...updates,
        ...(hasChildren ? {} : { amountCents: computed.amountCents }),
        updatedAt: new Date(),
        updatedBy: userId,
        // Any in-app edit clears the sheet-sync stamp so the next sync treats
        // this row as user-edited (conflict-aware).
        sourceSyncId: null,
      })
      .where(eq(budgetLines.id, id))
      .returning();

    // If this line is itself a child and its amount changed, roll up to parent.
    if (r?.parentLineId && !hasChildren) {
      await this.recomputeParentTotal(r.parentLineId);
    }
    return r;
  },

  // Bulk re-write display_order on a set of lines. Used after drag-and-drop.
  // Caller sends [{id, displayOrder}, ...]; we apply in a single transaction.
  // If parentLineId is included on a row, we also reparent (used when a child
  // is dragged out of / into a different parent — Phase 2; for now we accept
  // it but don't expose cross-parent UX).
  async reorderLines(updates: Array<{ id: number; displayOrder: number; parentLineId?: number | null }>): Promise<void> {
    if (updates.length === 0) return;
    // Track every parent that gained or lost children so we can recompute
    // their totals after the move.
    const affectedParents = new Set<number>();
    await db.transaction(async (tx) => {
      for (const u of updates) {
        if (u.parentLineId !== undefined) {
          // Look up the previous parent so we can recompute it too.
          const [prev] = await tx
            .select({ parentLineId: budgetLines.parentLineId })
            .from(budgetLines)
            .where(eq(budgetLines.id, u.id));
          if (prev?.parentLineId != null) affectedParents.add(prev.parentLineId);
          if (u.parentLineId != null) affectedParents.add(u.parentLineId);
        }
        const patch: Record<string, unknown> = { displayOrder: u.displayOrder, updatedAt: new Date() };
        if (u.parentLineId !== undefined) patch.parentLineId = u.parentLineId;
        await tx.update(budgetLines).set(patch as any).where(eq(budgetLines.id, u.id));
      }
    });
    for (const parentId of Array.from(affectedParents)) {
      await this.recomputeParentTotal(parentId);
    }
  },

  async deleteLine(id: number): Promise<boolean> {
    const existing = await this.getLine(id);
    if (!existing) return false;
    const parentId = existing.parentLineId;
    const r = await db.delete(budgetLines).where(eq(budgetLines.id, id)).returning();
    if (parentId) await this.recomputeParentTotal(parentId);
    return r.length > 0;
  },

  // Recompute a parent line's amount_cents from the sum of its children, then
  // walk up the parent chain so multi-level totals roll up correctly.
  async recomputeParentTotal(parentId: number): Promise<void> {
    let current: number | null = parentId;
    const seen = new Set<number>(); // cycle guard
    while (current != null && !seen.has(current)) {
      seen.add(current);
      const [agg] = await db
        .select({ total: sql<number>`COALESCE(SUM(${budgetLines.amountCents}), 0)::int` })
        .from(budgetLines)
        .where(eq(budgetLines.parentLineId, current));
      const total = Number(agg?.total ?? 0);
      // Clear monthlyPhasing on parents: children's phasing is the source
      // of truth, parents derive from them (in the rollup) by summing leaves.
      const updated: Array<{ parentLineId: number | null }> = await db
        .update(budgetLines)
        .set({ amountCents: total, monthlyPhasing: null, updatedAt: new Date() })
        .where(eq(budgetLines.id, current))
        .returning({ parentLineId: budgetLines.parentLineId });
      current = updated[0]?.parentLineId ?? null;
    }
  },

  // ── Rollup ───────────────────────────────────────────────────────────────

  async rollup(orgId: number, year: number): Promise<{ centres: RollupRow[]; totals: RollupTotals }> {
    const centres = await this.list(orgId, year);
    if (centres.length === 0) return { centres: [], totals: { incomeCents: 0, expenseCents: 0, netCents: 0 } };

    const ids = centres.map(c => c.id);
    // Leaves only — parents auto-sum their children, so including every row
    // would double-count. A leaf is a line with no children.
    const agg = await db
      .select({
        ccId: budgetLines.costCentreId,
        kind: budgetLines.kind,
        total: sql<number>`COALESCE(SUM(${budgetLines.amountCents}), 0)::int`,
      })
      .from(budgetLines)
      .where(and(
        inArray(budgetLines.costCentreId, ids),
        sql`NOT EXISTS (SELECT 1 FROM ${budgetLines} AS child WHERE child.parent_line_id = ${budgetLines.id})`,
      ))
      .groupBy(budgetLines.costCentreId, budgetLines.kind);

    const byId = new Map<number, { income: number; expense: number }>();
    for (const c of centres) byId.set(c.id, { income: 0, expense: 0 });
    for (const row of agg) {
      const bucket = byId.get(row.ccId)!;
      if (row.kind === "income") bucket.income = Number(row.total);
      else bucket.expense = Number(row.total);
    }

    const rows: RollupRow[] = centres.map(c => {
      const b = byId.get(c.id) ?? { income: 0, expense: 0 };
      return {
        ...c,
        totalIncomeCents: b.income,
        totalExpenseCents: b.expense,
        netCents: b.income - b.expense,
      };
    });

    const totals: RollupTotals = rows.reduce(
      (acc, r) => ({
        incomeCents: acc.incomeCents + r.totalIncomeCents,
        expenseCents: acc.expenseCents + r.totalExpenseCents,
        netCents: acc.netCents + r.netCents,
      }),
      { incomeCents: 0, expenseCents: 0, netCents: 0 },
    );

    return { centres: rows, totals };
  },

  async rollupMonthly(orgId: number, year: number): Promise<{ centres: MonthlyRollupRow[]; totals: MonthlyRollupTotals }> {
    const centres = await this.list(orgId, year);
    const emptyTotals: MonthlyRollupTotals = {
      incomeByMonth: zeros12(), expenseByMonth: zeros12(), netByMonth: zeros12(), cumulativeNetByMonth: zeros12(),
      incomeCents: 0, expenseCents: 0, netCents: 0,
    };
    if (centres.length === 0) return { centres: [], totals: emptyTotals };

    const ids = centres.map(c => c.id);
    // Leaves only — parents are virtual aggregates; the real phasing lives on
    // the individual leaf lines.
    const lines = await db
      .select({
        ccId: budgetLines.costCentreId,
        kind: budgetLines.kind,
        amountCents: budgetLines.amountCents,
        monthlyPhasing: budgetLines.monthlyPhasing,
      })
      .from(budgetLines)
      .where(and(
        inArray(budgetLines.costCentreId, ids),
        sql`NOT EXISTS (SELECT 1 FROM ${budgetLines} AS child WHERE child.parent_line_id = ${budgetLines.id})`,
      ));

    const byCC = new Map<number, { income: number[]; expense: number[] }>();
    for (const c of centres) byCC.set(c.id, { income: zeros12(), expense: zeros12() });

    for (const l of lines) {
      const bucket = byCC.get(l.ccId)!;
      const target = l.kind === "income" ? bucket.income : bucket.expense;
      const phased = phaseLine(l.amountCents, l.monthlyPhasing as number[] | null);
      for (let m = 0; m < 12; m++) target[m] += phased[m];
    }

    const rows: MonthlyRollupRow[] = centres.map(c => {
      const b = byCC.get(c.id) ?? { income: zeros12(), expense: zeros12() };
      const totalIncomeCents = b.income.reduce((s, n) => s + n, 0);
      const totalExpenseCents = b.expense.reduce((s, n) => s + n, 0);
      return {
        ...c,
        incomeByMonth: b.income,
        expenseByMonth: b.expense,
        totalIncomeCents,
        totalExpenseCents,
        netCents: totalIncomeCents - totalExpenseCents,
      };
    });

    const totals: MonthlyRollupTotals = {
      incomeByMonth: zeros12(), expenseByMonth: zeros12(), netByMonth: zeros12(), cumulativeNetByMonth: zeros12(),
      incomeCents: 0, expenseCents: 0, netCents: 0,
    };
    for (const r of rows) {
      for (let m = 0; m < 12; m++) {
        totals.incomeByMonth[m] += r.incomeByMonth[m];
        totals.expenseByMonth[m] += r.expenseByMonth[m];
      }
    }
    let cum = 0;
    for (let m = 0; m < 12; m++) {
      totals.netByMonth[m] = totals.incomeByMonth[m] - totals.expenseByMonth[m];
      cum += totals.netByMonth[m];
      totals.cumulativeNetByMonth[m] = cum;
    }
    totals.incomeCents = totals.incomeByMonth.reduce((s, n) => s + n, 0);
    totals.expenseCents = totals.expenseByMonth.reduce((s, n) => s + n, 0);
    totals.netCents = totals.incomeCents - totals.expenseCents;

    return { centres: rows, totals };
  },

  // ── Attachments (Phase 3) ───────────────────────────────────────────────

  async getAttachments(lineId: number): Promise<BudgetLineAttachment[]> {
    return db
      .select()
      .from(budgetLineAttachments)
      .where(eq(budgetLineAttachments.lineId, lineId))
      .orderBy(asc(budgetLineAttachments.uploadedAt));
  },

  async createAttachment(data: InsertBudgetLineAttachment): Promise<BudgetLineAttachment> {
    const [r] = await db.insert(budgetLineAttachments).values(data as any).returning();
    return r;
  },

  async deleteAttachment(id: number): Promise<BudgetLineAttachment | undefined> {
    const [r] = await db.delete(budgetLineAttachments).where(eq(budgetLineAttachments.id, id)).returning();
    return r;
  },

  // ── Sync runs (Phase 4) ──────────────────────────────────────────────────

  async createSyncRun(data: InsertBudgetSyncRun): Promise<BudgetSyncRun> {
    const [r] = await db.insert(budgetSyncRuns).values(data as any).returning();
    return r;
  },

  async updateSyncRun(id: number, updates: Partial<InsertBudgetSyncRun>): Promise<BudgetSyncRun | undefined> {
    const [r] = await db.update(budgetSyncRuns).set(updates).where(eq(budgetSyncRuns.id, id)).returning();
    return r;
  },

  async listSyncRuns(orgId: number, limit = 20): Promise<BudgetSyncRun[]> {
    return db
      .select()
      .from(budgetSyncRuns)
      .where(eq(budgetSyncRuns.organizationId, orgId))
      .orderBy(sql`${budgetSyncRuns.startedAt} DESC`)
      .limit(limit);
  },
};

function zeros12(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

// Expand a line into a 12-month vector of cents. If monthlyPhasing is set,
// use it verbatim (server validation guarantees length 12 + sum == amount).
// Otherwise distribute amountCents evenly, pushing the remainder cents to the
// earliest months so the sum exactly equals amountCents.
export function phaseLine(amountCents: number, phasing: number[] | null): number[] {
  if (phasing && phasing.length === 12) return phasing.map(n => Number(n) || 0);
  const base = Math.floor(amountCents / 12);
  let remainder = amountCents - base * 12;
  const out = new Array(12).fill(base);
  // Distribute remainder one cent at a time from Jan onwards. Works for
  // negative amounts too — remainder will be negative in that case.
  const step = remainder >= 0 ? 1 : -1;
  remainder = Math.abs(remainder);
  for (let i = 0; i < remainder; i++) out[i] += step;
  return out;
}

// Computed-line amount = unitRateCents × unitsA × unitsB × unitsC (treating
// nullish dimensions as 1). Anything else is a simple line and uses the
// caller-supplied amountCents as-is.
function recomputeIfComputed(line: any): any {
  if (line.lineType !== "computed") return line;
  const rate = line.unitRateCents ?? 0;
  const a = line.unitsA != null ? Number(line.unitsA) : 1;
  const b = line.unitsB != null ? Number(line.unitsB) : 1;
  const c = line.unitsC != null ? Number(line.unitsC) : 1;
  const total = Math.round(rate * a * b * c);
  return { ...line, amountCents: total };
}
