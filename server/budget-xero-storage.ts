// Storage layer for the Xero → Budget bridge (Phase 5a).
// Reuses the existing `org_integrations` row (provider='xero') for credentials.
// This module owns the new cache tables: xero_actuals + budget_account_mappings
// + xero_sync_runs.

import { db } from "./db";
import { and, eq, sql, inArray, asc, desc } from "drizzle-orm";
import {
  xeroActuals,
  budgetAccountMappings,
  xeroSyncRuns,
  budgetCostCentres,
  type XeroActual,
  type BudgetAccountMapping,
  type XeroSyncRun,
  type InsertBudgetAccountMapping,
} from "@shared/schema";
import type { PnlRow } from "./xero";

export const budgetXeroStorage = {
  // ── Sync runs ────────────────────────────────────────────────────────────

  async createSyncRun(orgId: number, triggeredBy: number | null, fromPeriod: string, toPeriod: string): Promise<XeroSyncRun> {
    const [r] = await db.insert(xeroSyncRuns).values({
      organizationId: orgId,
      triggeredBy,
      status: "running",
      fromPeriod,
      toPeriod,
    } as any).returning();
    return r;
  },

  async finishSyncRun(id: number, patch: Partial<{ status: string; rowsAdded: number; rowsUpdated: number; rowsSkipped: number; errorMessage: string }>): Promise<void> {
    await db.update(xeroSyncRuns).set({
      ...patch,
      finishedAt: new Date(),
    } as any).where(eq(xeroSyncRuns.id, id));
  },

  async lastSyncRun(orgId: number): Promise<XeroSyncRun | null> {
    const [r] = await db.select().from(xeroSyncRuns)
      .where(eq(xeroSyncRuns.organizationId, orgId))
      .orderBy(desc(xeroSyncRuns.startedAt))
      .limit(1);
    return r ?? null;
  },

  // ── Actuals ──────────────────────────────────────────────────────────────

  // Upsert one P&L row. Returns 'added' if new, 'updated' if amount changed,
  // 'skipped' if amount matched existing. Skips empty account strings.
  async upsertActual(orgId: number, syncRunId: number, row: PnlRow): Promise<"added" | "updated" | "skipped"> {
    if (!row.account) return "skipped";
    const [existing] = await db.select().from(xeroActuals)
      .where(and(
        eq(xeroActuals.organizationId, orgId),
        eq(xeroActuals.period, row.period),
        eq(xeroActuals.account, row.account),
      ));

    if (!existing) {
      await db.insert(xeroActuals).values({
        organizationId: orgId,
        period: row.period,
        section: row.section,
        account: row.account,
        amountCents: row.amountCents,
        lastSyncId: syncRunId,
      } as any);
      return "added";
    }
    if (existing.amountCents === row.amountCents && existing.section === row.section) {
      // Refresh the last_sync_id so we know this row was confirmed by latest run
      await db.update(xeroActuals).set({ lastSyncId: syncRunId } as any).where(eq(xeroActuals.id, existing.id));
      return "skipped";
    }
    await db.update(xeroActuals).set({
      amountCents: row.amountCents,
      section: row.section,
      lastSyncId: syncRunId,
      collectedAt: new Date(),
    } as any).where(eq(xeroActuals.id, existing.id));
    return "updated";
  },

  async listActuals(orgId: number, year: number): Promise<XeroActual[]> {
    const from = `${year}-01`;
    const to = `${year}-12`;
    return db.select().from(xeroActuals)
      .where(and(
        eq(xeroActuals.organizationId, orgId),
        sql`${xeroActuals.period} >= ${from}`,
        sql`${xeroActuals.period} <= ${to}`,
      ))
      .orderBy(asc(xeroActuals.period), asc(xeroActuals.account));
  },

  // Distinct accounts that have appeared in actuals for the given year.
  // Used to drive the mapping UI.
  async accountsForYear(orgId: number, year: number): Promise<Array<{ account: string; section: string | null; totalCents: number }>> {
    const from = `${year}-01`;
    const to = `${year}-12`;
    const rows = await db
      .select({
        account: xeroActuals.account,
        section: xeroActuals.section,
        totalCents: sql<number>`COALESCE(SUM(${xeroActuals.amountCents}), 0)::int`,
      })
      .from(xeroActuals)
      .where(and(
        eq(xeroActuals.organizationId, orgId),
        sql`${xeroActuals.period} >= ${from}`,
        sql`${xeroActuals.period} <= ${to}`,
      ))
      .groupBy(xeroActuals.account, xeroActuals.section)
      .orderBy(asc(xeroActuals.account));
    return rows.map(r => ({ account: r.account, section: r.section, totalCents: Number(r.totalCents) }));
  },

  // ── Mappings ─────────────────────────────────────────────────────────────

  async listMappings(orgId: number, year: number): Promise<BudgetAccountMapping[]> {
    return db.select().from(budgetAccountMappings)
      .where(and(eq(budgetAccountMappings.organizationId, orgId), eq(budgetAccountMappings.year, year)))
      .orderBy(asc(budgetAccountMappings.xeroAccount));
  },

  async upsertMapping(data: InsertBudgetAccountMapping): Promise<BudgetAccountMapping> {
    // Postgres upsert on (organization_id, year, xero_account) unique index
    const [r] = await db.insert(budgetAccountMappings)
      .values(data as any)
      .onConflictDoUpdate({
        target: [budgetAccountMappings.organizationId, budgetAccountMappings.year, budgetAccountMappings.xeroAccount],
        set: {
          costCentreId: (data as any).costCentreId ?? null,
          kind: (data as any).kind ?? "expense",
          notes: (data as any).notes ?? null,
          updatedBy: (data as any).updatedBy ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return r;
  },

  async deleteMapping(id: number): Promise<boolean> {
    const r = await db.delete(budgetAccountMappings).where(eq(budgetAccountMappings.id, id)).returning();
    return r.length > 0;
  },
};
