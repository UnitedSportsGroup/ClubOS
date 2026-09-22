/**
 * Financial Insight — the club's cash P&L with what-if levers, inside the United Sports Group workspace.
 *
 * 🔴 Two gates, both server-side, re-checked on every call: the tab (requireAuth + requireTab — a USG member who holds the
 * "finance-insight" tab) AND a password held in the SESSION for eight hours. The password is the random 32-character one
 * Daniel holds (scrypt "salt:hash" in FINANCE_INSIGHT_PASSWORD_HASH). Anyone who can see the tab sees the password screen;
 * nobody sees a figure without the password. Wrong guesses are rate-limited per user and per IP.
 *
 * 🔴 The model is never computed here. It is built on Daniel's Mac from Xero + Xero Payroll + ClubOS (the same events as
 * the P&L tabs) and pushed by the nightly refresh with FINANCE_INSIGHT_UPLOAD_TOKEN; this file stores and serves it.
 *
 * "Ask the analyst" sends the AGGREGATED scenario the browser built (totals by month, group and stream, the levers) to
 * Claude — never a person's name.
 */
import type { Express, Request, Response } from "express";
import { scryptSync, timingSafeEqual, randomBytes } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";

const TAB = "finance-insight";
const UNLOCK_MS = 8 * 60 * 60 * 1000;

declare module "express-session" {
  interface SessionData {
    financeInsightUntil?: number;
  }
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

// 5 wrong guesses per 10 minutes per user AND per IP. In-memory per machine — the ClubOS login already stands in front.
const attempts = new Map<string, { n: number; until: number }>();
function limited(key: string): boolean {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) return false;
  return a.n >= 5;
}
function strike(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 10 * 60 * 1000 });
  else a.n++;
}
function unlocked(req: Request): boolean {
  return !!req.session.financeInsightUntil && req.session.financeInsightUntil > Date.now();
}
function ipOf(req: Request): string {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

async function latest(): Promise<{ generated_at: string; model: any; node_count: number } | null> {
  // 🔴 id breaks the tie: two pushes of the same model carry the same generated_at, and picking either one served a STALE
  // snapshot on 23 Sep (the new forecast was in the newer row and the page showed the older).
  const r = await db.execute(sql`SELECT generated_at, model, node_count FROM finance_insight_snapshots ORDER BY generated_at DESC, id DESC LIMIT 1`);
  const row = (r.rows as any[])[0];
  return row ? { generated_at: new Date(row.generated_at).toISOString(), model: row.model, node_count: row.node_count } : null;
}

export function registerFinanceInsightRoutes(app: Express) {
  // Is it configured, is there a snapshot, is this session unlocked? (No figures.)
  app.get("/api/admin/finance-insight/status", requireAuth, requireTab(TAB), async (req, res) => {
    try {
      const r = await db.execute(sql`SELECT generated_at, node_count FROM finance_insight_snapshots ORDER BY generated_at DESC, id DESC LIMIT 1`);
      const row = (r.rows as any[])[0];
      res.json({ configured: !!process.env.FINANCE_INSIGHT_PASSWORD_HASH, unlocked: unlocked(req),
                 snapshot: row ? { generatedAt: new Date(row.generated_at).toISOString(), nodes: row.node_count } : null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/finance-insight/unlock", requireAuth, requireTab(TAB), async (req, res) => {
    const stored = process.env.FINANCE_INSIGHT_PASSWORD_HASH || "";
    if (!stored) return res.status(503).json({ message: "Financial Insight has no password configured on this server." });
    const uk = `u:${req.session.userId}`, ik = `ip:${ipOf(req)}`;
    if (limited(uk) || limited(ik)) return res.status(429).json({ message: "Too many attempts. Try again in ten minutes." });
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || !verifyPassword(password, stored)) {
      strike(uk); strike(ik);
      return res.status(401).json({ message: "That password is not right." });
    }
    req.session.financeInsightUntil = Date.now() + UNLOCK_MS;
    res.json({ ok: true, until: req.session.financeInsightUntil });
  });

  app.post("/api/admin/finance-insight/lock", requireAuth, requireTab(TAB), (req, res) => {
    req.session.financeInsightUntil = undefined;
    res.json({ ok: true });
  });

  app.get("/api/admin/finance-insight/model", requireAuth, requireTab(TAB), async (req, res) => {
    if (!unlocked(req)) return res.status(403).json({ message: "locked" });
    try {
      const snap = await latest();
      if (!snap) return res.status(404).json({ message: "No snapshot yet — the nightly refresh has not pushed one." });
      res.setHeader("Cache-Control", "no-store");
      res.json({ generatedAt: snap.generated_at, model: snap.model });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/finance-insight/ask", requireAuth, requireTab(TAB), async (req, res) => {
    if (!unlocked(req)) return res.status(403).json({ message: "locked" });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ message: "AI analysis is not configured on this server." });
    const question = String(req.body?.question ?? "").slice(0, 2000);
    const summary = String(req.body?.summary ?? "").slice(0, 24000);
    if (!question.trim()) return res.status(400).json({ message: "Ask a question." });
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const out = await client.messages.create({
        model: "claude-sonnet-5", max_tokens: 1200,
        system: "You are the finance analyst for Christchurch United Football Club Inc (a NZ incorporated society running Christchurch United FC, South Island United in the OFC Pro League, an academy, Mini Football Leagues, the Christchurch International Cup and United Print). The club's goal is to break even without owner donations, then build a reserve. You are given the club's cash P&L for Dec 2025 – Sep 2026 as a SCENARIO (levers the reader applied are listed) with totals by month, income group, expense group and stream. Answer in plain English for a board member: lead with the answer, give the numbers that matter (NZD, rounded), name what the scenario changes versus the baseline, and say what you cannot tell from the figures. Be direct and brief. Never invent a figure that is not in the summary.",
        messages: [{ role: "user", content: `SCENARIO SUMMARY\n${summary}\n\nQUESTION\n${question}` }],
      });
      const text = out.content.map((c: any) => (c.type === "text" ? c.text : "")).join("\n").trim();
      res.json({ answer: text });
    } catch (e: any) { res.status(502).json({ message: e.message }); }
  });

  // The nightly refresh on Daniel's Mac pushes the model here. Bearer token, never a session.
  app.post("/api/internal/finance-insight/snapshot", async (req, res) => {
    const token = process.env.FINANCE_INSIGHT_UPLOAD_TOKEN || "";
    const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return res.status(401).json({ message: "unauthorized" });
    const model = req.body?.model;
    if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.months)) return res.status(400).json({ message: "model must carry nodes[] and months[]" });
    try {
      const r = await db.execute(sql`INSERT INTO finance_insight_snapshots (generated_at, source, model) VALUES (${model.generatedAt ? new Date(model.generatedAt) : new Date()}, ${String(req.body?.source || "export_model.py")}, ${JSON.stringify(model)}::jsonb) RETURNING id, node_count`);
      const row = (r.rows as any[])[0];
      res.json({ ok: true, id: row.id, nodes: row.node_count });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
export const _internal = { verifyPassword, randomBytes };
