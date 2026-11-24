/**
 * SIU Performance app — what the 25 Nov 2026 meeting (Michael Peterson, Adria Casals)
 * added on top of the daily check-in:
 *
 *   player   POST /api/public/athlete/measure   weights before/after training, knee to wall L/R
 *   staff    GET  /api/public/athlete/squad      the squad board (same object ClubOS draws)
 *   staff    POST /api/public/athlete/staff/notify   "tell me when a player reports something"
 *   ClubOS   /api/admin/performance/app-staff    who has a staff login to the app
 *
 *  🔴 A staff login is `perf_athlete_accounts.staff_role`, written ONLY by the
 *     performance-gated ClubOS routes below. A player's login answers 404 on every
 *     staff route; a staff login is refused on every player write.
 *  🔴 A measure is one row in the one store (perf_metric_values, source `player_app`,
 *     external_key `app:<contact>:<day>`): typing it again the same day corrects it,
 *     clearing it deletes it. Today only, by the server's NZ clock. Blank is not zero.
 *  🔴 The staff board carries no email address and no clinical note (medical: false).
 */
import type { Express, Request, Response } from "express";
import { PLAYER_MEASURES, parseMeasure, type Measures } from "@shared/perf-squad";
import { nzToday } from "@shared/performance";
import { pool } from "./db";

type Row = Record<string, any>;
const q = async <T = Row>(text: string, params: unknown[] = []): Promise<T[]> => (await pool.query(text, params)).rows as T[];
const one = async <T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> => (await q<T>(text, params))[0];

const BASE = "/api/admin/performance";
const PUB = "/api/public/athlete";
export const STAFF_ROLES = ["coach", "physio", "performance"] as const;

export interface AppDeps {
  gate: readonly any[];
  viewer: (req: Request) => { userId: number; medical: boolean; org: number };
  requireAthlete: any; requirePlayer: any; requireStaff: any;
  athleteOf: (req: Request) => { accountId: number; contactId: number; org: number; firstName: string | null; lastName: string | null; staffRole: string | null };
  buildBoard: (v: { org: number; medical: boolean }, today: string) => Promise<any>;
  todaysMeasures: (org: number, contactId: number, today: string) => Promise<Measures>;
  sendLink: (accountId: number, email: string, firstName: string | null, kind: "set" | "reset", staff?: boolean) => Promise<boolean>;
  handle: (fn: (req: Request, res: Response) => Promise<unknown>) => any;
}

export function registerPerformanceAppRoutes(app: Express, d: AppDeps) {
  const { gate, viewer, requirePlayer, requireStaff, athleteOf, handle } = d;

  // ── the player's daily list ────────────────────────────────────────────────
  app.post(`${PUB}/measure`, requirePlayer, async (req, res) => {
    try {
      const a = athleteOf(req);
      const today = nzToday();
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      const writes: { key: string; value: number | null }[] = [];
      for (const m of PLAYER_MEASURES) {
        if (!(m.field in body)) continue;                 // not sent = left alone
        const r = parseMeasure(m.field, body[m.field]);
        if ("error" in r) return res.status(400).json({ message: r.error, field: m.field });
        writes.push({ key: m.key, value: r.value });
      }
      if (!writes.length) return res.status(400).json({ message: "Nothing to save." });
      const ext = `app:${a.contactId}:${today}`;
      for (const w of writes) {
        if (w.value == null) {
          await pool.query(`delete from perf_metric_values where organization_id = $1 and source = 'player_app' and external_key = $2 and metric_key = $3`, [a.org, ext, w.key]);
        } else {
          await pool.query(`
            insert into perf_metric_values (organization_id, contact_id, observed_on, metric_key, value, source, external_key)
            values ($1,$2,$3,$4,$5,'player_app',$6)
            on conflict (organization_id, source, external_key, metric_key) do update set value = excluded.value, updated_at = now()`,
            [a.org, a.contactId, today, w.key, w.value, ext]);
        }
      }
      res.json({ ok: true, measures: await d.todaysMeasures(a.org, a.contactId, today) });
    } catch (e) { console.error("[athlete] measure", e); res.status(500).json({ message: "Could not save. Try again." }); }
  });

  // ── staff: the squad ───────────────────────────────────────────────────────
  app.get(`${PUB}/squad`, requireStaff, async (req, res) => {
    try {
      const a = athleteOf(req);
      const board = await d.buildBoard({ org: a.org, medical: false }, nzToday());
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...board, unlinked: [], players: board.players.map((p: Row) => ({ ...p, email: null, dob: undefined })) });
    } catch (e) { console.error("[athlete] squad", e); res.status(500).json({ message: "Could not load the squad." }); }
  });

  app.post(`${PUB}/staff/notify`, requireStaff, async (req, res) => {
    try {
      const a = athleteOf(req);
      const on = req.body?.on === true;
      await pool.query(`update perf_athlete_accounts set notify_reports = $1, updated_at = now() where id = $2`, [on, a.accountId]);
      res.json({ ok: true, notifyReports: on });
    } catch (e) { console.error("[athlete] notify", e); res.status(500).json({ message: "Could not change that. Try again." }); }
  });

  // ── ClubOS: who has a staff login to the app ───────────────────────────────
  const list = async (org: number) => (await q(`
    select a.id, a.email, a.staff_role, a.notify_reports, a.password_hash is not null active, a.disabled_at, a.invited_at, a.last_sign_in_at, c.first_name, c.last_name,
      (select count(*)::int from perf_athlete_push_tokens t where t.account_id = a.id and t.disabled_at is null) phones
    from perf_athlete_accounts a join contacts c on c.id = a.contact_id
    where a.organization_id = $1 and a.staff_role is not null order by c.first_name, c.last_name`, [org])).map((r) => ({
      id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email, email: r.email, role: r.staff_role, notify: r.notify_reports,
      state: r.disabled_at ? "disabled" : r.active ? "active" : "invited", invitedAt: r.invited_at, lastSignIn: r.last_sign_in_at, phones: r.phones,
    }));

  app.get(`${BASE}/app-staff`, ...gate, handle(async (req, res) => { res.json({ staff: await list(viewer(req).org), roles: STAFF_ROLES }); }));

  app.post(`${BASE}/app-staff`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const first = String(req.body?.firstName ?? "").trim().slice(0, 60), last = String(req.body?.lastName ?? "").trim().slice(0, 60);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const role = STAFF_ROLES.includes(req.body?.role) ? req.body.role : "coach";
    const notify = req.body?.notify === true;
    if (!first) return res.status(400).json({ message: "Add their first name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Add their email address." });
    const existing = await one(`select id, staff_role, contact_id from perf_athlete_accounts where lower(email) = $1`, [email]);
    if (existing && !existing.staff_role) return res.status(409).json({ message: "That email is already a player's login. Staff need their own email." });
    let acctId: number, hadPassword = false;
    if (existing) {
      const r = await one(`update perf_athlete_accounts set staff_role = $1, notify_reports = $2, disabled_at = null, invited_at = now(), updated_at = now() where id = $3 returning id, password_hash`, [role, notify, existing.id]);
      acctId = r!.id; hadPassword = !!r!.password_hash;
    } else {
      // 🔴 Never reuse a PLAYER's contact for a staff login: one contact, one login, and a player's stays a player's.
      let c = await one(`select c.id from contacts c where lower(c.email) = $1 and c.type = 'staff'
        and not exists (select 1 from perf_athlete_accounts a where a.contact_id = c.id) order by c.id limit 1`, [email]);
      if (!c) c = await one(`insert into contacts (type, first_name, last_name, email, notes) values ('staff',$1,$2,$3,'SIU Performance app staff login') returning id`, [first, last || null, email]);
      const r = await one(`insert into perf_athlete_accounts (organization_id, contact_id, email, invited_by, staff_role, notify_reports) values ($1,$2,$3,$4,$5,$6) returning id`,
        [v.org, c!.id, email, v.userId, role, notify]);
      acctId = r!.id;
    }
    const emailed = await d.sendLink(acctId, email, first, hadPassword ? "reset" : "set", true);
    res.json({ ok: true, emailed, staff: await list(v.org) });
  }));

  app.patch(`${BASE}/app-staff/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const cur = await one(`select id from perf_athlete_accounts where id = $1 and organization_id = $2 and staff_role is not null`, [Number(req.params.id), v.org]);
    if (!cur) return res.status(404).json({ message: "Not found" });
    if (typeof req.body?.notify === "boolean") await pool.query(`update perf_athlete_accounts set notify_reports = $1, updated_at = now() where id = $2`, [req.body.notify, cur.id]);
    if (STAFF_ROLES.includes(req.body?.role)) await pool.query(`update perf_athlete_accounts set staff_role = $1, updated_at = now() where id = $2`, [req.body.role, cur.id]);
    if (req.body?.disabled === true) {
      // Disabled, never deleted: the login stops on the next request and "tell me" goes off with it.
      await pool.query(`update perf_athlete_accounts set disabled_at = now(), notify_reports = false, updated_at = now() where id = $1`, [cur.id]);
      await pool.query(`update perf_athlete_sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [cur.id]);
    } else if (req.body?.disabled === false) {
      await pool.query(`update perf_athlete_accounts set disabled_at = null, updated_at = now() where id = $1`, [cur.id]);
    }
    res.json({ ok: true, staff: await list(v.org) });
  }));

  app.post(`${BASE}/app-staff/:id/invite`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const a = await one(`select a.id, a.email, a.password_hash, c.first_name from perf_athlete_accounts a join contacts c on c.id = a.contact_id
      where a.id = $1 and a.organization_id = $2 and a.staff_role is not null and a.disabled_at is null`, [Number(req.params.id), v.org]);
    if (!a) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true, emailed: await d.sendLink(a.id, a.email, a.first_name, a.password_hash ? "reset" : "set", true) });
  }));
}
