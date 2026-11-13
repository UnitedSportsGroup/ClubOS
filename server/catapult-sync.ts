// ─────────────────────────────────────────────────────────────────────────────
// Catapult One → SIU Performance Hub, automatically.
//
// Daniel, 2026-11-14: "make it sync with clubos in as close to real time as
// possible." Catapult One has NO public API (Catapult support, 10 Nov: API
// tokens come only with the Vector package, quoted at $9,000/yr). Its own web
// app (oneapp.catapultsports.com) reads the data from PlayerTek's backend
// (apiaus.playertek.com/webinterface/*.php) with an ordinary signed-in login.
// This module does exactly what that web page does, with a dedicated club
// login, every few minutes.
//
// 🔴 UNOFFICIAL. It can break without warning when Catapult changes their web
// app. So: it is OFF unless CATAPULT_SYNC=1, every attempt is a row in
// perf_sync_runs (the Data sources screen shows "last synced 4 min ago" or the
// exact error), and CSV import stays the fallback. Catapult were asked in
// writing on 10 Nov whether a club may read its own data this way; no answer
// was given in the thread. Daniel decided to run it.
//
// 🔴 READ ONLY. Only "get…" methods are ever called. Nothing in Catapult is
// written, edited or deleted.
//
// 🔴 BLANK IS NOT ZERO. Catapult reports 0 for anything a pod cannot measure
// (heart rate without a strap, impacts, energy). A 0 is therefore stored as
// NOTHING — no row — and the Hub shows "—". A player whose pod recorded 0 m is
// a pod that was not worn, not a rest day.
//
// 🔴 AN ATHLETE IS NOT A PERSON UNTIL A HUMAN SAYS SO. Catapult names players
// by initials. Athletes are keyed by Catapult's own numeric player id and stay
// unlinked until staff link them on the Import screen; linking later attaches
// all their history (performance-routes.ts /athletes/:id/link).
//
// Env:
//   CATAPULT_SYNC=1                 turn the schedule on (default off)
//   CATAPULT_USERNAME / _PASSWORD   the dedicated club login (Fly secrets only)
//   CATAPULT_SYNC_MINUTES=10        how often (min 5)
//   CATAPULT_API_BASE               default https://apiaus.playertek.com/
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response, NextFunction } from "express";
import { pool } from "./db";

export const CATAPULT_SOURCE = "catapult_one";
const APP_HEADERS = { AppID: "one-web", AppVersion: "1.1.11" } as const;
const LOCK_KEY = 74_200_311; // pg advisory lock: one sync at a time across both Fly machines
const RECENT_DAYS = 3;        // pods often sync to the cloud hours after training — re-read recent sessions

/** Catapult metric → Hub metric key. Units are read from each response. */
const METRIC_MAP: Record<string, { key: string; convert: (v: number, unit: string) => number }> = {
  distance:        { key: "total_distance_m",  convert: (v, u) => (u === "km" ? v * 1000 : v) },
  sprintDistance:  { key: "sprint_distance_m", convert: (v, u) => (u === "km" ? v * 1000 : v) },
  topSpeed:        { key: "top_speed_kmh",     convert: (v, u) => (u === "m/s" ? v * 3.6 : v) },
  distancePerMin:  { key: "distance_per_min",  convert: (v) => v },
  powerPlays:      { key: "power_plays",       convert: (v) => v },
  playerLoad:      { key: "player_load",       convert: (v) => v },
  energy:          { key: "energy_kcal",       convert: (v) => v },
  impacts:         { key: "impacts",           convert: (v) => v },
  hrLoad:          { key: "hr_load",           convert: (v) => v },
  hrMax:           { key: "hr_max",            convert: (v) => v },
  timeInRedZone:   { key: "time_red_zone_min", convert: (v) => v },
  maxAcceleration: { key: "max_acceleration",  convert: (v) => v },
  maxDeceleration: { key: "max_deceleration",  convert: (v) => v },
  powerScore:      { key: "power_score",       convert: (v) => v },
  workRatio:       { key: "work_ratio",        convert: (v) => v },
};

// ── the client ───────────────────────────────────────────────────────────────
class CatapultError extends Error {}

class CatapultClient {
  private cookies = new Map<string, string>();
  private xsrf: string | null = null;
  private base: string;
  constructor(private username: string, private password: string, base?: string) {
    this.base = (base || process.env.CATAPULT_API_BASE || "https://apiaus.playertek.com/").replace(/\/+$/, "/");
  }

  private keepCookies(res: globalThis.Response) {
    const list: string[] = (res.headers as any).getSetCookie?.() ?? [];
    for (const c of list) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const h = res.headers.get("x-xsrf-token");
    if (h) this.xsrf = h;
    const c = this.cookies.get("XSRF-TOKEN");
    if (!this.xsrf && c) this.xsrf = decodeURIComponent(c);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", ...APP_HEADERS };
    if (this.cookies.size) h.Cookie = Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; ");
    if (this.xsrf) h["X-XSRF-TOKEN"] = this.xsrf;
    return h;
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.base}webinterface/Login.php`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ userName: this.username, password: this.password }),
    });
    this.keepCookies(res);
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body || body.status !== 1) {
      // Never echo the response: it can carry account details.
      throw new CatapultError(`Catapult login refused (HTTP ${res.status}${body?.data && typeof body.data === "string" ? `, ${body.data}` : ""})`);
    }
    // The web app keeps the XSRF token it is handed at sign-in; find it wherever it sits.
    if (!this.xsrf) this.xsrf = findXsrf(body);
    // A user can live on another regional server ("userHomeServer").
    const home = body?.data?.userHomeServer;
    if (home?.domain && typeof home.domain === "string") {
      const host = home.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (/^[a-z0-9.-]+\.playertek\.com$/i.test(host)) {
        const folder = typeof home.apiFolder === "string" && home.apiFolder ? `${home.apiFolder.replace(/^\/+|\/+$/g, "")}/` : "";
        this.base = `https://${host}/${folder}`;
      }
    }
  }

  async call<T = any>(service: string, method: string, parameters: Record<string, unknown>, retried = false): Promise<T> {
    if (!/^get[A-Za-z]+$/.test(method)) throw new CatapultError(`refusing non-read method ${method}`);
    const res = await fetch(`${this.base}webinterface/${service}?method=${method}`, {
      method: "POST", headers: this.headers(), body: JSON.stringify({ method, parameters }),
    });
    this.keepCookies(res);
    const body: any = await res.json().catch(() => null);
    if (body?.status === 1) return body.data as T;
    const why = typeof body?.data === "string" ? body.data : `HTTP ${res.status}`;
    if (!retried && /access\.denied|session|login/i.test(why)) { await this.login(); return this.call(service, method, parameters, true); }
    throw new CatapultError(`${service} ${method}: ${why}`);
  }
}

function findXsrf(o: any, depth = 0): string | null {
  if (!o || typeof o !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(o)) {
    if (/xsrf|csrf/i.test(k) && typeof v === "string" && v.length > 8) return v;
    const inner = findXsrf(v, depth + 1);
    if (inner) return inner;
  }
  return null;
}

// ── the sync ─────────────────────────────────────────────────────────────────
type Card = { isSessionCard?: boolean; title?: string; timestamp?: number; tags?: string[]; sessionType?: number; playerCount?: number; sessionGroupID?: number };
export type SyncResult = { ok: boolean; sessionsSeen: number; sessionsWritten: number; valuesWritten: number; athletesNew: number; error?: string; skipped?: string };

const utcDate = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

export function catapultConfigured(): boolean {
  return !!(process.env.CATAPULT_USERNAME && process.env.CATAPULT_PASSWORD);
}

async function siuOrgId(): Promise<number> {
  const { rows } = await pool.query(`select id from organizations where slug = 'south-island-united'`);
  if (!rows[0]) throw new Error("South Island United organisation not found");
  return rows[0].id;
}

/**
 * One sync pass. Lists session cards (all history on the first run, the newest
 * page after that), then reads every session that is new, has a different
 * player count, or is from the last RECENT_DAYS days. Idempotent: every write
 * is an upsert on a natural key, so a second pass changes nothing.
 */
export async function runCatapultSync(trigger: "cron" | "manual"): Promise<SyncResult> {
  if (!catapultConfigured()) return { ok: false, sessionsSeen: 0, sessionsWritten: 0, valuesWritten: 0, athletesNew: 0, skipped: "not configured" };
  const db = await pool.connect();
  const org = await siuOrgId();
  let runId: number | null = null;
  try {
    const { rows: [lock] } = await db.query(`select pg_try_advisory_lock($1) as got`, [LOCK_KEY]);
    if (!lock.got) return { ok: true, sessionsSeen: 0, sessionsWritten: 0, valuesWritten: 0, athletesNew: 0, skipped: "another sync is running" };
    const { rows: [run] } = await db.query(
      `insert into perf_sync_runs (organization_id, source, trigger) values ($1,$2,$3) returning id`, [org, CATAPULT_SOURCE, trigger]);
    runId = run.id;

    const client = new CatapultClient(process.env.CATAPULT_USERNAME!, process.env.CATAPULT_PASSWORD!);
    await client.login();

    // Squad names per Catapult player id (for the "source_squads" label only).
    const squads: Array<{ squadID: number; squadName: string; playerIDs: number[] }> =
      (await client.call("SquadService.php", "getSquads", {})) ?? [];
    const squadsOf = new Map<number, string[]>();
    for (const s of squads) for (const p of s.playerIDs ?? []) squadsOf.set(p, [...(squadsOf.get(p) ?? []), String(s.squadName ?? "").trim()]);

    // Session cards. First ever run: page through everything; afterwards one page.
    const { rows: [prior] } = await db.query(
      `select count(*)::int n from perf_sessions where organization_id = $1 and source = $2 and external_key like 'sg:%'`, [org, CATAPULT_SOURCE]);
    const cards: Card[] = [];
    let last: number | null = null;
    for (let page = 0; page < (prior.n === 0 ? 40 : 1); page++) {
      const data: any = await client.call("SessionGroupsService.php", "getSquadSessionGroupCards", {
        squadID: squads[0]?.squadID ?? null, playerID: null, cardsPerPage: 50, lastReceivedSessionGroupID: last, tags: [],
      });
      const batch: Card[] = (data?.dayGroups ?? []).flatMap((d: any) => d.cards ?? []).filter((c: Card) => c.isSessionCard && c.sessionGroupID);
      cards.push(...batch);
      if (!data?.moreCardsAvailable || !batch.length) break;
      last = batch[batch.length - 1].sessionGroupID!;
    }
    const unique = Array.from(new Map(cards.map((c) => [c.sessionGroupID!, c])).values());

    const { rows: known } = await db.query(
      `select external_key, player_count from perf_sessions where organization_id = $1 and source = $2 and external_key = any($3::text[])`,
      [org, CATAPULT_SOURCE, unique.map((c) => `sg:${c.sessionGroupID}`)]);
    const knownBy = new Map(known.map((k: any) => [k.external_key, k.player_count]));
    const { rows: [{ today }] } = await db.query(`select (now() at time zone 'Pacific/Auckland')::date::text as today`);
    const recentCutoff = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);

    let sessionsWritten = 0, valuesWritten = 0, athletesNew = 0;
    for (const card of unique) {
      const key = `sg:${card.sessionGroupID}`;
      const date = card.timestamp ? utcDate(card.timestamp) : null;
      if (!date) continue;
      const seen = knownBy.has(key);
      if (seen && knownBy.get(key) === card.playerCount && date < recentCutoff) continue;

      const data: any = await client.call("SquadService.php", "getSquadSessionGroupData", {
        sessionGroupID: card.sessionGroupID, activityType: 1, splitName: "all",
      });
      const kvp = data?.metricsKVP ?? {};
      const units: Record<string, string> = data?.units ?? {};
      const ids: number[] = kvp.playerIDs ?? [];

      await db.query("begin");
      try {
        const { rows: [s] } = await db.query(`
          insert into perf_sessions (organization_id, source, external_key, session_date, name, source_kind, tags, player_count)
          values ($1,$2,$3,$4,$5,$6,$7,$8)
          on conflict (organization_id, source, external_key) do update set
            session_date = excluded.session_date, name = coalesce(perf_sessions.name, excluded.name),
            source_kind = excluded.source_kind, tags = excluded.tags, player_count = excluded.player_count, last_synced_at = now()
          returning id`,
          [org, CATAPULT_SOURCE, key, date, card.title ?? null, card.sessionType != null ? `type:${card.sessionType}` : null,
           (card.tags ?? []).filter(Boolean), ids.length]);

        for (let i = 0; i < ids.length; i++) {
          const pid = ids[i];
          const initials = Array.isArray(kvp.players) ? String(kvp.players[i] ?? "").trim() || null : null;
          const { rows: [a] } = await db.query(`
            insert into perf_athletes (organization_id, source, source_athlete_key, source_name, source_squads)
            values ($1,$2,$3,$4,$5)
            on conflict (organization_id, source, source_athlete_key) do update set
              source_name = coalesce(excluded.source_name, perf_athletes.source_name),
              source_squads = excluded.source_squads, last_seen_at = now()
            returning id, contact_id, (xmax = 0) as inserted`,
            [org, CATAPULT_SOURCE, `pid:${pid}`, initials, squadsOf.get(pid) ?? []]);
          if (a.inserted) athletesNew++;

          for (const [field, def] of Object.entries(METRIC_MAP)) {
            const raw = Array.isArray(kvp[field]) ? Number(kvp[field][i]) : NaN;
            const extKey = `${key}|pid:${pid}`;
            if (!Number.isFinite(raw) || raw === 0) {
              // Not measured: make sure no stale value lingers from an earlier read.
              await db.query(`delete from perf_metric_values where organization_id = $1 and source = $2 and external_key = $3 and metric_key = $4`,
                [org, CATAPULT_SOURCE, extKey, def.key]);
              continue;
            }
            const value = Math.round(def.convert(raw, units[field] ?? "") * 1000) / 1000;
            await db.query(`
              insert into perf_metric_values (organization_id, contact_id, athlete_id, observed_on, metric_key, value, source, external_key, session_id)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
              on conflict (organization_id, source, external_key, metric_key) do update set
                value = excluded.value, observed_on = excluded.observed_on, session_id = excluded.session_id,
                contact_id = coalesce(perf_metric_values.contact_id, excluded.contact_id), updated_at = now()`,
              [org, a.contact_id, a.id, date, def.key, value, CATAPULT_SOURCE, extKey, s.id]);
            valuesWritten++;
          }
        }
        await db.query("commit");
        sessionsWritten++;
      } catch (e) {
        await db.query("rollback").catch(() => {});
        throw e;
      }
    }

    await db.query(
      `update perf_sync_runs set finished_at = now(), ok = true, sessions_seen = $2, sessions_written = $3, stats_written = $4 where id = $1`,
      [runId, unique.length, sessionsWritten, valuesWritten]);
    return { ok: true, sessionsSeen: unique.length, sessionsWritten, valuesWritten, athletesNew };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 500);
    if (runId) await db.query(`update perf_sync_runs set finished_at = now(), ok = false, error = $2 where id = $1`, [runId, msg]).catch(() => {});
    console.error("[catapult-sync]", msg);
    return { ok: false, sessionsSeen: 0, sessionsWritten: 0, valuesWritten: 0, athletesNew: 0, error: msg };
  } finally {
    await db.query(`select pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    db.release();
  }
}

export function startCatapultSyncCron() {
  if (process.env.CATAPULT_SYNC !== "1") return;
  if (!catapultConfigured()) { console.warn("[catapult-sync] CATAPULT_SYNC=1 but no CATAPULT_USERNAME/PASSWORD — not running"); return; }
  const minutes = Math.max(5, Number(process.env.CATAPULT_SYNC_MINUTES) || 10);
  const run = () => runCatapultSync("cron").then((r) => {
    if (r.sessionsWritten || !r.ok) console.log(`[catapult-sync] ok=${r.ok} sessions=${r.sessionsWritten}/${r.sessionsSeen} values=${r.valuesWritten}${r.error ? ` error=${r.error}` : ""}`);
  });
  setTimeout(run, 90_000);
  setInterval(run, minutes * 60_000);
}

/** Status + "Sync now", behind the Performance tab's own gate. */
export function registerCatapultSyncRoutes(
  app: Express,
  gate: ReadonlyArray<(req: Request, res: Response, next: NextFunction) => unknown>,
) {
  app.get("/api/admin/performance/sync/catapult", ...(gate as any), async (_req: Request, res: Response) => {
    try {
      const org = await siuOrgId();
      const { rows } = await pool.query(
        `select started_at, finished_at, ok, trigger, sessions_seen, sessions_written, stats_written, error
           from perf_sync_runs where organization_id = $1 and source = $2 order by started_at desc limit 10`, [org, CATAPULT_SOURCE]);
      const { rows: [unlinked] } = await pool.query(
        `select count(*)::int n from perf_athletes where organization_id = $1 and source = $2 and contact_id is null`, [org, CATAPULT_SOURCE]);
      const lastOk = rows.find((r: any) => r.ok);
      res.json({
        configured: catapultConfigured(),
        scheduled: process.env.CATAPULT_SYNC === "1" && catapultConfigured(),
        everyMinutes: Math.max(5, Number(process.env.CATAPULT_SYNC_MINUTES) || 10),
        lastSuccessAt: lastOk?.finished_at ?? null,
        failing: rows.length > 0 && rows[0].ok === false,
        lastError: rows[0]?.ok === false ? rows[0].error : null,
        unlinkedAthletes: unlinked.n,
        runs: rows,
      });
    } catch (e: any) {
      console.error("[catapult-sync] status failed:", e?.message ?? e);
      res.status(500).json({ message: "Could not read the sync status." });
    }
  });

  app.post("/api/admin/performance/sync/catapult", ...(gate as any), async (_req: Request, res: Response) => {
    if (!catapultConfigured()) return res.status(409).json({ message: "The Catapult login has not been set up yet." });
    const r = await runCatapultSync("manual");
    res.status(r.ok ? 200 : 502).json(r);
  });
}
