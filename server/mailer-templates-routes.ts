// ─────────────────────────────────────────────────────────────────────────────
// Mailer templates — save an email, start the next one from it.
//
//   GET    /api/admin/mailer/templates          — this workspace's templates
//   GET    /api/admin/mailer/templates/:id      — one, with its design
//   POST   /api/admin/mailer/templates          — save (same name → updates it)
//   DELETE /api/admin/mailer/templates/:id      — retire (never deleted)
//
// Gated on the Mailer TAB in the workspace named by X-Workspace-Slug, and every
// read and write is scoped to that workspace's organisation — a template id from
// another workspace is 404, never 403.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireTab } from "./auth";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

/** The organisation behind the workspace header. requireTab has already proved
 *  the caller may use the Mailer there. */
async function orgIdFor(req: Request): Promise<number | null> {
  const slug = String(req.headers["x-workspace-slug"] || "");
  if (!slug) return null;
  const r = rowsOf(await db.execute(sql`SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1`));
  return r[0] ? Number(r[0].id) : null;
}

const shape = (r: any, withBody = false) => ({
  id: Number(r.id),
  name: r.name,
  subject: r.subject ?? null,
  updatedAt: r.updated_at,
  createdAt: r.created_at,
  createdBy: r.created_by_name ?? null,
  ...(withBody ? { bodyDoc: r.body_doc, bodyHtml: r.body_html } : {}),
});

export function registerMailerTemplateRoutes(app: Express) {
  const BASE = "/api/admin/mailer/templates";
  const gate = requireTab("mailer");

  app.get(BASE, gate, async (req: Request, res: Response) => {
    try {
      const org = await orgIdFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const r = rowsOf(await db.execute(sql`
        SELECT t.id, t.name, t.subject, t.created_at, t.updated_at,
               NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS created_by_name
        FROM mailer_templates t LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.organization_id = ${org} AND t.archived_at IS NULL
        ORDER BY t.updated_at DESC`));
      res.json({ templates: r.map((x) => shape(x)) });
    } catch (e: any) {
      console.error("[mailer-templates] list", e);
      res.status(500).json({ message: "Couldn't load templates." });
    }
  });

  app.get(`${BASE}/:id`, gate, async (req: Request, res: Response) => {
    try {
      const org = await orgIdFor(req);
      const id = Number(req.params.id);
      if (!org || !Number.isInteger(id)) return res.status(404).json({ message: "Not found" });
      const r = rowsOf(await db.execute(sql`
        SELECT * FROM mailer_templates
        WHERE id = ${id} AND organization_id = ${org} AND archived_at IS NULL`));
      if (!r[0]) return res.status(404).json({ message: "Not found" });
      res.json(shape(r[0], true));
    } catch (e: any) {
      console.error("[mailer-templates] get", e);
      res.status(500).json({ message: "Couldn't load that template." });
    }
  });

  // Saving under a name that already exists UPDATES that template — "save again"
  // is the common case, and two "Term letter"s would be a trap.
  app.post(BASE, gate, async (req: Request, res: Response) => {
    try {
      const org = await orgIdFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const name = String(req.body?.name ?? "").trim().slice(0, 120);
      const subject = String(req.body?.subject ?? "").trim().slice(0, 500) || null;
      const bodyHtml = String(req.body?.bodyHtml ?? "");
      const bodyDoc = req.body?.bodyDoc;
      if (!name) return res.status(400).json({ message: "Give the template a name." });
      if (!bodyHtml.trim() || !bodyDoc || typeof bodyDoc !== "object") {
        return res.status(400).json({ message: "There's no design to save yet." });
      }
      if (bodyHtml.length > 400_000) return res.status(400).json({ message: "That email is too large to save." });
      const userId = (req.session as any)?.userId ?? null;
      const docJson = JSON.stringify(bodyDoc);

      const existing = rowsOf(await db.execute(sql`
        SELECT id FROM mailer_templates
        WHERE organization_id = ${org} AND archived_at IS NULL AND lower(btrim(name)) = lower(${name})`))[0];
      let id: number;
      if (existing) {
        id = Number(existing.id);
        await db.execute(sql`
          UPDATE mailer_templates SET subject = ${subject}, body_doc = ${docJson}::jsonb, body_html = ${bodyHtml},
                 updated_by_user_id = ${userId}, updated_at = now()
          WHERE id = ${id}`);
      } else {
        const ins = rowsOf(await db.execute(sql`
          INSERT INTO mailer_templates (organization_id, name, subject, body_doc, body_html, created_by_user_id, updated_by_user_id)
          VALUES (${org}, ${name}, ${subject}, ${docJson}::jsonb, ${bodyHtml}, ${userId}, ${userId})
          RETURNING id`));
        id = Number(ins[0].id);
      }
      res.json({ ok: true, id, updated: !!existing });
    } catch (e: any) {
      console.error("[mailer-templates] save", e);
      res.status(500).json({ message: "Couldn't save the template." });
    }
  });

  app.delete(`${BASE}/:id`, gate, async (req: Request, res: Response) => {
    try {
      const org = await orgIdFor(req);
      const id = Number(req.params.id);
      if (!org || !Number.isInteger(id)) return res.status(404).json({ message: "Not found" });
      const r = rowsOf(await db.execute(sql`
        UPDATE mailer_templates SET archived_at = now()
        WHERE id = ${id} AND organization_id = ${org} AND archived_at IS NULL RETURNING id`));
      if (!r[0]) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[mailer-templates] delete", e);
      res.status(500).json({ message: "Couldn't remove the template." });
    }
  });
}
