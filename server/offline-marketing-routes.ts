/**
 * Marketing → Signage · Billboards · Traditional Media, and Branding.
 * See shared/offline-marketing.ts, shared/branding.ts and
 * migrations/2026-11-11_offline_marketing.sql.
 *
 * Every route: requireAuth → the tab that owns the list → United Sports Group
 * workspace only (the same 404-from-anywhere-else gate as the Marketing hub,
 * because canAccessTab passes any slug for an admin of any workspace).
 *
 * 🔴 Removing a row archives it. 🔴 A blank number is NULL, never zero.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { nzTodayIso } from "@shared/dashboard";
import { BRANDING_TAB, BRAND_HUBS, brandHub, parseBrandBoard, type BrandBoard, type BrandBoardsResponse } from "@shared/branding";
import { offlineChannel, parseOfflineInput, type OfflineItem, type OfflineListResponse } from "@shared/offline-marketing";
import { requireAuth, requireTab } from "./auth";
import { pool } from "./db";
import { requireHubWorkspace } from "./marketing-hub/common";

const BASE = "/api/admin/offline-marketing";

const day = (v: unknown): string | null => {
  if (v == null) return null;
  // pg hands a DATE back as a local-midnight Date; read its own y-m-d parts.
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};

const SELECT = `
  SELECT i.*, NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS updated_by_name
  FROM offline_marketing_items i LEFT JOIN users u ON u.id = COALESCE(i.updated_by, i.created_by)`;

function toItem(r: any): OfflineItem {
  return {
    id: r.id,
    channel: r.channel,
    brand: r.brand,
    title: r.title,
    kind: r.kind,
    supplier: r.supplier,
    location: r.location,
    size: r.size,
    quantity: r.quantity,
    status: r.status,
    startsOn: day(r.starts_on),
    endsOn: day(r.ends_on),
    costCents: r.cost_cents,
    audience: r.audience,
    linkUrl: r.link_url,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    notes: r.notes,
    updatedAt: new Date(r.updated_at).toISOString(),
    updatedByName: r.updated_by_name,
    archived: r.archived_at != null,
  };
}

/** The list named in the URL decides which tab is needed. An unknown list is a 404 before any tab is checked. */
function channelGate(req: Request, res: Response, next: NextFunction) {
  const def = offlineChannel(req.params.channel);
  if (!def) return res.status(404).json({ message: "Not found" });
  return requireTab(def.tab)(req, res, next);
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      console.error(`[OfflineMarketing] ${req.method} ${req.path} failed:`, e?.message ?? e);
      res.status(500).json({ message: "That could not be saved. Try again." });
    }
  };
}

export function registerOfflineMarketingRoutes(app: Express) {
  const gate = [requireAuth, channelGate, requireHubWorkspace] as const;

  app.get(`${BASE}/:channel`, ...gate, handle(async (req, res) => {
    const { rows } = await pool.query(
      `${SELECT} WHERE i.channel = $1 AND ($2::boolean OR i.archived_at IS NULL)
       ORDER BY i.archived_at IS NOT NULL, COALESCE(i.starts_on, i.created_at::date) DESC, i.id DESC`,
      [req.params.channel, req.query.removed === "1"],
    );
    const body: OfflineListResponse = { today: nzTodayIso(), items: rows.map(toItem) };
    res.json(body);
  }));

  app.post(`${BASE}/:channel`, ...gate, handle(async (req, res) => {
    const def = offlineChannel(req.params.channel)!;
    const parsed = parseOfflineInput(def, req.body);
    if ("error" in parsed) return res.status(400).json({ message: parsed.error });
    const v = parsed.value;
    const { rows } = await pool.query(
      `INSERT INTO offline_marketing_items (channel, brand, title, kind, supplier, location, size, quantity, status, starts_on, ends_on,
                                            cost_cents, audience, link_url, contact_name, contact_email, contact_phone, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING id`,
      [def.key, v.brand, v.title, v.kind, v.supplier, v.location, v.size, v.quantity, v.status, v.startsOn, v.endsOn,
       v.costCents, v.audience, v.linkUrl, v.contactName, v.contactEmail, v.contactPhone, v.notes, req.session.userId ?? null],
    );
    res.status(201).json({ id: rows[0].id });
  }));

  app.patch(`${BASE}/:channel/:id`, ...gate, handle(async (req, res) => {
    const def = offlineChannel(req.params.channel)!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Not found" });
    // Remove / put back is its own small change, so it can never blank the other fields.
    if (typeof req.body?.archived === "boolean") {
      const r = await pool.query(
        `UPDATE offline_marketing_items SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_by = $4, updated_at = now()
         WHERE id = $1 AND channel = $2`,
        [id, def.key, req.body.archived, req.session.userId ?? null],
      );
      return r.rowCount ? res.json({ ok: true }) : res.status(404).json({ message: "Not found" });
    }
    const parsed = parseOfflineInput(def, req.body);
    if ("error" in parsed) return res.status(400).json({ message: parsed.error });
    const v = parsed.value;
    const r = await pool.query(
      `UPDATE offline_marketing_items SET brand=$3, title=$4, kind=$5, supplier=$6, location=$7, size=$8, quantity=$9, status=$10,
              starts_on=$11, ends_on=$12, cost_cents=$13, audience=$14, link_url=$15, contact_name=$16, contact_email=$17,
              contact_phone=$18, notes=$19, updated_by=$20, updated_at=now()
       WHERE id = $1 AND channel = $2`,
      [id, def.key, v.brand, v.title, v.kind, v.supplier, v.location, v.size, v.quantity, v.status, v.startsOn, v.endsOn,
       v.costCents, v.audience, v.linkUrl, v.contactName, v.contactEmail, v.contactPhone, v.notes, req.session.userId ?? null],
    );
    return r.rowCount ? res.json({ ok: true }) : res.status(404).json({ message: "Not found" });
  }));

  // ── Branding ──────────────────────────────────────────────────────────────
  const brandGate = [requireAuth, requireTab(BRANDING_TAB), requireHubWorkspace] as const;

  app.get("/api/admin/branding/boards", ...brandGate, handle(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT b.*, NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS updated_by_name
       FROM brand_workboards b LEFT JOIN users u ON u.id = b.updated_by`,
    );
    const byBrand = new Map<string, any>(rows.map((r) => [r.brand, r]));
    const boards: BrandBoard[] = BRAND_HUBS.map((h) => {
      const r = byBrand.get(h.key);
      return {
        brand: h.key,
        notes: r?.notes ?? "",
        links: Array.isArray(r?.links) ? r.links : [],
        todos: Array.isArray(r?.todos) ? r.todos : [],
        updatedAt: r ? new Date(r.updated_at).toISOString() : null,
        updatedByName: r?.updated_by_name ?? null,
      };
    });
    const body: BrandBoardsResponse = { boards };
    res.json(body);
  }));

  app.put("/api/admin/branding/boards/:brand", ...brandGate, handle(async (req, res) => {
    const hub = brandHub(req.params.brand);
    if (!hub) return res.status(404).json({ message: "Not found" });
    const parsed = parseBrandBoard(req.body);
    if ("error" in parsed) return res.status(400).json({ message: parsed.error });
    await pool.query(
      `INSERT INTO brand_workboards (brand, notes, links, todos, updated_by) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
       ON CONFLICT (brand) DO UPDATE SET notes = EXCLUDED.notes, links = EXCLUDED.links, todos = EXCLUDED.todos,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [hub.key, parsed.notes, JSON.stringify(parsed.links), JSON.stringify(parsed.todos), req.session.userId ?? null],
    );
    res.json({ ok: true });
  }));
}
