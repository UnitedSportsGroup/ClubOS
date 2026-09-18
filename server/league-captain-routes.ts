// ─────────────────────────────────────────────────────────────────────────────
// The MFL captain's dashboard — routes.
//
// The SAME captain account as the Ethnic Cup (teampay_captains, its cookie,
// its rate limits, its audit trail). A person who runs a Wednesday 7's side
// and a person who runs an Ethnic Cup side are the same kind of person, so
// they get the same door; the only thing that differs is which teams the
// server finds under their email.
//
// 🔴 Every route below resolves the league team by VERIFIED EMAIL and then
// calls the engine. 404 for "not yours" and "does not exist" alike.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import type { TeampayCaptain } from "@shared/schema";
import { requireCaptain, currentCaptain } from "./teampay-captain-routes";
import * as lc from "./league-captain";

export function registerLeagueCaptainRoutes(app: Express) {
  const withTeam = (
    handler: (team: any, req: Request, res: Response) => Promise<any>,
  ) => async (req: Request, res: Response) => {
    const cap = (req as any).captain as TeampayCaptain;
    const team = await lc.ownedLeagueTeam(cap, Number(req.params.id));
    if (!team) return res.status(404).json({ message: "We couldn't find that." });
    try {
      await handler(team, req, res);
    } catch (e: any) {
      console.error("[league-captain]", req.path, e?.message || e);
      if (!res.headersSent) res.status(500).json({ message: "Something went wrong." });
    }
  };

  const send = (res: Response, r: any) => {
    if (r?.error === "not_found") return res.status(404).json({ message: "We couldn't find that." });
    if (r?.error) return res.status(400).json({ message: r.error });
    res.json(r);
  };

  /** The captain's league teams and any team still being paid for through Player Pay. */
  app.get("/api/public/teampay/captain/league/mine", async (req, res) => {
    const cap = await currentCaptain(req);
    if (!cap) return res.status(401).json({ message: "Please sign in." });
    try {
      const [teams, pending] = await Promise.all([
        lc.leagueTeamsForEmail(cap.email),
        lc.pendingSplitsForEmail(cap.email),
      ]);
      res.set("Cache-Control", "no-store");
      res.json({ teams, pending });
    } catch (e: any) {
      console.error("[league-captain] mine", e?.message || e);
      res.status(500).json({ message: "Something went wrong." });
    }
  });

  app.get("/api/public/teampay/captain/league/:id", requireCaptain, withTeam(async (team, req, res) => {
    const view = await lc.teamView(team, (req as any).captain);
    if (!view) return res.status(404).json({ message: "We couldn't find that." });
    res.set("Cache-Control", "no-store");
    res.json(view);
  }));

  // ── the squad list ─────────────────────────────────────────────────────────

  app.post("/api/public/teampay/captain/league/:id/squad", requireCaptain, withTeam(async (team, req, res) => {
    const rows = Array.isArray(req.body?.players) ? req.body.players : [req.body];
    if (rows.length > 40) return res.status(400).json({ message: "That's more players than a squad list." });
    res.json(await lc.addSquadMembers(team, (req as any).captain, rows));
  }));

  app.patch("/api/public/teampay/captain/league/:id/squad/:mid", requireCaptain, withTeam(async (team, req, res) => {
    send(res, await lc.updateSquadMember(team, Number(req.params.mid), req.body ?? {}));
  }));

  app.delete("/api/public/teampay/captain/league/:id/squad/:mid", requireCaptain, withTeam(async (team, req, res) => {
    send(res, await lc.removeSquadMember(team, Number(req.params.mid)));
  }));

  app.post("/api/public/teampay/captain/league/:id/squad/adopt/:smid", requireCaptain, withTeam(async (team, req, res) => {
    send(res, await lc.adoptSplitMember(team, (req as any).captain, Number(req.params.smid)));
  }));

  // ── fill-ins ───────────────────────────────────────────────────────────────

  app.get("/api/public/teampay/captain/league/:id/fill-ins", requireCaptain, withTeam(async (team, req, res) => {
    const r = await lc.browseLeagueFillins(team, { gameDate: req.query.gameDate ? String(req.query.gameDate) : null });
    res.set("Cache-Control", "no-store");
    send(res, r);
  }));

  app.post("/api/public/teampay/captain/league/:id/fill-ins/:fid/ask", requireCaptain, withTeam(async (team, req, res) => {
    send(res, await lc.requestLeagueFillin(team, (req as any).captain, Number(req.params.fid), req.body ?? {}));
  }));

  app.post("/api/public/teampay/captain/league/:id/asks/:aid/cancel", requireCaptain, withTeam(async (team, req, res) => {
    send(res, await lc.cancelLeagueAsk(team, Number(req.params.aid)));
  }));
}
