/**
 * Canterbury Sport — United Sports Group Limited (formerly Canterbury Sport Ltd), the company that owns the land, the
 * fields and the buildings. Its running costs, its loans, what it needs to break even, its cash in the weeks ahead, and
 * whether the club pays it on time.
 *
 * 🔴 Three gates, re-checked on every call: signed in, the tab (requireTab — USG workspace, and the tab is in
 * SUPER_ADMIN_ONLY_TABS), and the named-person list in shared/canterbury-sport.ts. A refusal is a 404, never a 403:
 * the tab's existence is not news for anyone outside the list.
 * 🔴 Nothing is computed here. The model is built from the company's Xero on Daniel's Mac and pushed with the same
 * bearer token as Financial Insight; this file stores it and serves the newest copy.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";
import { CANTERBURY_SPORT_TAB, canSeeCanterburySport } from "@shared/canterbury-sport";

function onlyNamed(req: Request, res: Response, next: NextFunction) {
  if (!canSeeCanterburySport(req.session.userId)) return res.status(404).json({ message: "Not found" });
  next();
}

export function registerCanterburySportRoutes(app: Express) {
  app.get("/api/admin/canterbury-sport", requireAuth, requireTab(CANTERBURY_SPORT_TAB), onlyNamed, async (_req, res) => {
    try {
      const r = await db.execute(sql`SELECT generated_at, as_of, model FROM usg_ltd_snapshots ORDER BY generated_at DESC LIMIT 1`);
      const row = (r.rows as any[])[0];
      if (!row) return res.json({ snapshot: null });
      res.json({ snapshot: { generatedAt: row.generated_at, asOf: row.as_of, model: row.model } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Daniel's Mac pushes the model here. Bearer token, never a session.
  app.post("/api/internal/canterbury-sport/snapshot", async (req, res) => {
    const token = process.env.FINANCE_INSIGHT_UPLOAD_TOKEN || "";
    const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return res.status(401).json({ message: "unauthorized" });
    const model = req.body?.model;
    if (!model || !Array.isArray(model.months) || !Array.isArray(model.recurring) || !Array.isArray(model.loans) || !model.asOf)
      return res.status(400).json({ message: "model must carry months[], recurring[], loans[] and asOf" });
    try {
      const r = await db.execute(sql`INSERT INTO usg_ltd_snapshots (generated_at, as_of, source, model) VALUES (${new Date(model.generatedAt || Date.now())}, ${model.asOf}, ${String(req.body?.source || "build_model.py")}, ${JSON.stringify(model)}::jsonb) RETURNING id`);
      res.json({ ok: true, id: (r.rows as any[])[0].id });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
