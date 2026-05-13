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

  async deleteLine(id: number): Promise<boolean> {
    const existing = await this.getLine(id);
    if (!existing) return false;
    const parentId = existing.parentLineId;
    const r = await db.delete(budgetLines).where(eq(budgetLines.id, id)).returning();
    if (parentId) await this.recomputeParentTotal(parentId);
    return r.length > 0;
  },

  // Recompute a parent line's amount_cents from the sum of its children.
  // Called after any child insert / update / delete.
  async recomputeParentTotal(parentId: number): Promise<void> {
    const [row] = await db
      .select({ total: sql<number>`COALESCE(SUM(${budgetLines.amountCents}), 0)::int` })
      .from(budgetLines)
      .where(eq(budgetLines.parentLineId, parentId));
    const total = Number(row?.total ?? 0);
    await db
      .update(budgetLines)
      .set({ amountCents: total, updatedAt: new Date() })
      .where(eq(budgetLines.id, parentId));
  },

  // ── Rollup ───────────────────────────────────────────────────────────────

  async rollup(orgId: number, year: number): Promise<{ centres: RollupRow[]; totals: RollupTotals }> {
    const centres = await this.list(orgId, year);
    if (centres.length === 0) return { centres: [], totals: { incomeCents: 0, expenseCents: 0, netCents: 0 } };

    const ids = centres.map(c => c.id);
    const agg = await db
      .select({
        ccId: budgetLines.costCentreId,
        kind: budgetLines.kind,
        total: sql<number>`COALESCE(SUM(${budgetLines.amountCents}), 0)::int`,
      })
      .from(budgetLines)
      .where(inArray(budgetLines.costCentreId, ids))
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
