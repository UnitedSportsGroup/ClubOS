/**
 * Marketing hub — shared server plumbing: the workspace gate, the query-string
 * filter, NZ day boundaries and a short cache.
 */
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import {
  DASHBOARD_PERIODS,
  eachDay,
  previousRange,
  resolvePeriod,
  type DashboardPeriod,
  type DateRange,
} from "@shared/dashboard";
import {
  HUB_WORKSPACES,
  MARKETING_HUB_WORKSPACE,
  hubWorkspace,
  type HubFilter,
} from "@shared/marketing-hub";

/** Parameterised query. Identifiers are never parameters — see ident(). */
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as any[]);
  return r.rows as T[];
}

/** Thrown when something a platform needs has not been set up on this server. */
export class NotConfiguredError extends Error {}

/** A bad filter from the browser — answered 400, never 500. */
export class HubInputError extends Error {}

/**
 * 🔴 requireTab() is not a workspace boundary on its own. canAccessTab returns
 * true for EVERY slug once a membership role is admin or manager, so an admin
 * of Mini Football sending their own workspace header passes
 * requireTab("marketing-hub") for a tab that does not exist there. The hub
 * reads every workspace's numbers, so it answers only from the group workspace
 * — and 404, not 403, from anywhere else.
 */
export function requireHubWorkspace(req: Request, res: Response, next: NextFunction) {
  if (req.headers["x-workspace-slug"] !== MARKETING_HUB_WORKSPACE) {
    return res.status(404).json({ message: "Not found" });
  }
  next();
}

type OrgRow = { id: number; slug: string; name: string };
let orgCache: { at: number; bySlug: Map<string, OrgRow>; byId: Map<number, OrgRow> } | null = null;

export async function orgs() {
  if (orgCache && Date.now() - orgCache.at < 10 * 60_000) return orgCache;
  const rows = await q<OrgRow>(`SELECT id, slug, name FROM organizations`);
  orgCache = {
    at: Date.now(),
    bySlug: new Map(rows.map((r) => [r.slug, r])),
    byId: new Map(rows.map((r) => [r.id, r])),
  };
  return orgCache;
}

/** A workspace slug for an organisation id — only if the hub measures it. */
export async function hubSlugForOrg(orgId: number | null | undefined): Promise<string | null> {
  if (orgId == null) return null;
  const slug = (await orgs()).byId.get(orgId)?.slug ?? null;
  return hubWorkspace(slug) ? slug : null;
}

export type HubScope = {
  range: DateRange;
  previous: DateRange;
  filter: HubFilter;
  /** Organisation ids in scope: the chosen workspace, or every measured one. */
  orgIds: number[];
  workspaceOrgId: number | null;
  programme: { id: number; slug: string; name: string } | null;
};

export function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v) && typeof v[0] === "string") return v[0].trim();
  return "";
}

/** Reads period / from / to / workspace / program. Unknown values are refused, not ignored. */
export async function parseScope(req: Request): Promise<HubScope> {
  const qs = req.query as Record<string, unknown>;
  const raw = str(qs.period) || "30d";
  const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(raw)
    ? (raw as DashboardPeriod)
    : "30d";
  const range = resolvePeriod(period, { from: str(qs.from) || undefined, to: str(qs.to) || undefined });
  const previous = previousRange(range);
  const { bySlug } = await orgs();

  const wsSlug = str(qs.workspace) || null;
  let workspaceOrgId: number | null = null;
  if (wsSlug) {
    if (!hubWorkspace(wsSlug)) throw new HubInputError(`Unknown workspace "${wsSlug}".`);
    const org = bySlug.get(wsSlug);
    if (!org) throw new HubInputError(`Workspace "${wsSlug}" does not exist.`);
    workspaceOrgId = org.id;
  }
  const orgIds =
    workspaceOrgId != null
      ? [workspaceOrgId]
      : HUB_WORKSPACES.map((w) => bySlug.get(w.slug)?.id).filter((x): x is number => typeof x === "number");

  let programme: HubScope["programme"] = null;
  const progRaw = str(qs.program);
  if (progRaw) {
    if (workspaceOrgId == null) throw new HubInputError("Choose a workspace before a programme.");
    const id = Number(progRaw);
    if (!Number.isInteger(id) || id <= 0) throw new HubInputError("Invalid programme.");
    const [p] = await q<{ id: number; slug: string; name: string }>(
      `SELECT id, slug, name FROM programs WHERE id = $1 AND organization_id = $2`,
      [id, workspaceOrgId],
    );
    if (!p) throw new HubInputError("That programme is not in this workspace.");
    programme = p;
  }

  return {
    range,
    previous,
    filter: { workspace: wsSlug, programId: programme?.id ?? null },
    orgIds,
    workspaceOrgId,
    programme,
  };
}

export type ColumnKind = "date" | "timestamptz" | "timestamp";

/**
 * A range condition on a date/timestamp column for inclusive NZ calendar days.
 *
 * 🔴 Written as bounds on the raw column, never as `(col AT TIME ZONE …)::date
 * BETWEEN …`, because wrapping the column stops Postgres using its index — on
 * analytics_events that is the difference between milliseconds and seconds.
 * A naive `timestamp` holds UTC in this database (see dateExprFor in
 * dashboard-routes.ts), so its NZ midnight bound is converted back to naive UTC.
 */
export function nzBounds(column: string, kind: ColumnKind, fromParam: string, toParam: string): string {
  if (kind === "date") return `${column} BETWEEN ${fromParam}::date AND ${toParam}::date`;
  const lo = `(${fromParam}::date::timestamp AT TIME ZONE 'Pacific/Auckland')`;
  const hi = `((${toParam}::date + 1)::timestamp AT TIME ZONE 'Pacific/Auckland')`;
  if (kind === "timestamptz") return `${column} >= ${lo} AND ${column} < ${hi}`;
  return `${column} >= (${lo} AT TIME ZONE 'UTC') AND ${column} < (${hi} AT TIME ZONE 'UTC')`;
}

/** Which half of the comparison a calendar day falls in. */
export function periodOf(day: string, scope: HubScope): "current" | "previous" | null {
  if (day >= scope.range.from && day <= scope.range.to) return "current";
  if (day >= scope.previous.from && day <= scope.previous.to) return "previous";
  return null;
}

/** Every day of the range at zero, so a chart shows quiet days as real zeros. */
export function zeroDays(range: DateRange): Map<string, number> {
  return new Map(eachDay(range).map((d) => [d, 0]));
}

// ── A short cache ───────────────────────────────────────────────────────────
// Distinct visitors over a year is a real scan, and the page asks for the same
// slice on every tab switch. Two minutes is short enough that "today" still
// moves while somebody watches it. Per machine; a miss simply recomputes.
const cache = new Map<string, { at: number; p: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), p });
  if (cache.size > 400) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return p;
}

export function scopeKey(name: string, s: HubScope): string {
  return [name, s.range.from, s.range.to, s.filter.workspace ?? "", s.filter.programId ?? ""].join("|");
}

/** Forget cached answers — after a sync writes new numbers. */
export function clearHubCache() {
  cache.clear();
}
