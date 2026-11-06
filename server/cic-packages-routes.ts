/**
 * CIC 2027 packages — HTTP. Public routes are addressed by a 128-bit token and
 * nothing else; a miss is always 404. Staff routes are the CIC workspace's
 * "Packages" tab and answer 404 to any other workspace.
 */
import type { Express, Request, Response } from "express";
import { requireAuth, requireTab } from "./auth";
import * as pk from "./cic-packages";

const TAB = "cic-packages";
const CIC_SLUG = "christchurch-international-cup";

const SITE_ORIGINS = [
  "https://packages.cicyouth.com", "https://cicyouth.com", "https://www.cicyouth.com",
];
function setCors(req: Request, res: Response) {
  const origin = String(req.headers.origin || "");
  if (SITE_ORIGINS.includes(origin) || /^https:\/\/cic-packages[a-z0-9-]*\.vercel\.app$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
}
const ip = (req: Request) => (String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.ip || "?").trim();
const notFound = (res: Response) => res.status(404).json({ message: "We couldn't find that." });
const fail = (res: Response, where: string, e: any) => {
  console.error(`[cic-packages ${where}]`, e?.message || e);
  res.status(500).json({ message: "Something went wrong on our side. Please try again." });
};
function answer(res: Response, r: any) {
  if (r?.error === "not_found") return notFound(res);
  if (r?.error) return res.status(400).json({ message: r.error });
  return res.json(r);
}

export function registerCicPackagesRoutes(app: Express) {
  app.use("/api/public/cic/packages", (req, res, next) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // The page books; ClubOS prices it again.
  app.post("/api/public/cic/packages/book", async (req, res) => {
    if (pk.rateLimited(`book:${ip(req)}`, 12)) {
      return res.status(429).json({ message: "That's a few bookings in a short time. Try again shortly, or email info@cicyouth.com." });
    }
    try { answer(res, await pk.createBooking(req.body)); } catch (e) { fail(res, "book", e); }
  });

  // Staff and the page can preview the server's price for a set of choices.
  app.post("/api/public/cic/packages/quote", async (req, res) => {
    try {
      const { cleanInput } = await import("@shared/cic-packages-core");
      const input = cleanInput(req.body?.input);
      if (!input) return res.status(400).json({ message: "Bad input." });
      const m = pk.priceBooking(input, await pk.tripPrices());
      res.json({ totalCents: m.totalCents, invoiceCents: m.invoiceCents, depositCents: m.depositCents, playerShareCents: m.playerShareCents });
    } catch (e) { fail(res, "quote", e); }
  });

  // ── the manager ──
  app.get("/api/public/cic/packages/booking/:token", async (req, res) => {
    try { const b = await pk.getBooking(String(req.params.token)); b ? res.json(b) : notFound(res); } catch (e) { fail(res, "booking", e); }
  });
  app.post("/api/public/cic/packages/booking/:token/pay", async (req, res) => {
    const kind = ["deposit", "instalment", "balance"].includes(req.body?.kind) ? req.body.kind : null;
    if (!kind) return res.status(400).json({ message: "Bad payment." });
    try { answer(res, await pk.startManagerPayment(String(req.params.token), kind)); } catch (e) { fail(res, "pay", e); }
  });
  app.post("/api/public/cic/packages/booking/:token/confirm", async (req, res) => {
    try { answer(res, await pk.confirmManagerPayment(String(req.params.token), Number(req.body?.paymentId))); } catch (e) { fail(res, "confirm", e); }
  });

  // ── players ──
  app.get("/api/public/cic/packages/join/:token", async (req, res) => {
    try { const j = await pk.getJoin(String(req.params.token)); j ? res.json(j) : notFound(res); } catch (e) { fail(res, "join", e); }
  });
  app.post("/api/public/cic/packages/join/:token", async (req, res) => {
    if (pk.rateLimited(`join:${ip(req)}`, 40)) return res.status(429).json({ message: "Too many sign-ups from here just now. Try again shortly." });
    try { answer(res, await pk.registerPlayer(String(req.params.token), req.body)); } catch (e) { fail(res, "register", e); }
  });
  app.get("/api/public/cic/packages/player/:token", async (req, res) => {
    try { const p = await pk.getPlayer(String(req.params.token)); p ? res.json(p) : notFound(res); } catch (e) { fail(res, "player", e); }
  });
  app.post("/api/public/cic/packages/player/:token/pay", async (req, res) => {
    try { answer(res, await pk.startPlayerPayment(String(req.params.token), req.body)); } catch (e) { fail(res, "player pay", e); }
  });
  app.post("/api/public/cic/packages/player/:token/confirm", async (req, res) => {
    try { answer(res, await pk.confirmPlayerPayment(String(req.params.token), Number(req.body?.paymentId))); } catch (e) { fail(res, "player confirm", e); }
  });

  // ── staff (CIC workspace → Packages) ──
  const cicOnly = (req: Request, res: Response, next: () => void) => {
    // requireTab lets an admin of ANY workspace through; this board is CIC's.
    if (String(req.headers["x-workspace-slug"] || "") !== CIC_SLUG) return notFound(res);
    next();
  };
  app.get("/api/admin/cic-packages", requireAuth, requireTab(TAB), cicOnly, async (_req, res) => {
    try {
      res.json({
        bookings: await pk.adminList(pk.CIC_ORG_ID),
        extrasOrders: await pk.adminExtrasOrders(pk.CIC_ORG_ID),
        extras: await pk.adminExtras(pk.CIC_ORG_ID),
      });
    } catch (e) { fail(res, "admin list", e); }
  });
  app.get("/api/admin/cic-packages/bookings/:id", requireAuth, requireTab(TAB), cicOnly, async (req, res) => {
    try { const d = await pk.adminDetail(pk.CIC_ORG_ID, Number(req.params.id)); d ? res.json(d) : notFound(res); } catch (e) { fail(res, "admin detail", e); }
  });
  app.post("/api/admin/cic-packages/bookings/:id", requireAuth, requireTab(TAB), cicOnly, async (req, res) => {
    try { answer(res, await pk.adminUpdateBooking(pk.CIC_ORG_ID, Number(req.params.id), req.body)); } catch (e) { fail(res, "admin update", e); }
  });
  app.post("/api/admin/cic-packages/extras", requireAuth, requireTab(TAB), cicOnly, async (req, res) => {
    try { answer(res, await pk.adminSaveExtra(pk.CIC_ORG_ID, req.body)); } catch (e) { fail(res, "extra new", e); }
  });
  app.post("/api/admin/cic-packages/extras/:id", requireAuth, requireTab(TAB), cicOnly, async (req, res) => {
    try { answer(res, await pk.adminSaveExtra(pk.CIC_ORG_ID, req.body, Number(req.params.id))); } catch (e) { fail(res, "extra save", e); }
  });
}
