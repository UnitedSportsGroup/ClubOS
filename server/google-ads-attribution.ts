// Google Ads attribution — which paid conversions came from a Google ad click, and
// the CSV Google Ads fetches to learn about them.
//
// ONE resolver (resolveGoogleClicks) behind three surfaces: the scheduled-upload
// CSV (`GET /api/integrations/google-ads/conversions.csv`), the admin check
// (`GET /api/admin/google-ads/attribution-check`), and resolveGoogleClick(id).
// The decision itself is pure and lives in shared/google-ads.ts.
//
// HARD RULES
//   - A conversion is REAL money only: registrations through the shared decider
//     (shared/registrations.ts), shop orders only once paid. Fully refunded rows
//     are excluded; partial refunds are netted off the value.
//   - No child data leaves ClubOS. The only person on an export is the PAYER, and
//     the only personal field ever written is a SHA-256 of their normalised email,
//     and only when explicitly asked for.
//   - Read-only. Nothing here writes to the database.
//
// Other paid tables, checked 2026-10-14 and deliberately NOT included (yet):
//   - cugc_registrations (status 'paid'): 39 paid rows, visitor_id NULL on every
//     one — nothing to join a click to. Include once the gym checkout stamps it.
//   - club_event_orders, teampay_players, split_members: no visitor_id / person_id
//     columns at all; a Google click cannot be tied to them without a migration.
//   - print_orders: has visitor_id but paid state is 'paid_cents' set by staff on
//     quotes; not a clean "this person paid online" decider. Left out on purpose.
//   - League team entries ARE registrations (programme type league_team) and are
//     already included through the shared decider.

import crypto from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth, requireTab } from "./auth";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { MARKETING_HUB_TAB } from "@shared/marketing-hub";
import { requireHubWorkspace } from "./marketing-hub/common";
import {
  GOOGLE_CLICK_WINDOW_DAYS,
  buildGoogleAdsCsv,
  netPaidCents,
  normalizeEmailForGoogle,
  pickGoogleClick,
  type GoogleClick,
  type GoogleClickTouch,
  type GoogleConversionRow,
} from "@shared/google-ads";

/** Shop statuses that mean the money landed and stayed. */
const SHOP_PAID_STATUSES = ["paid", "processing", "ready_for_pickup", "shipped", "completed"];

export interface PaidConversion {
  /** Stable, dedupe-safe id for Google: `reg-<id>` / `shop-<id>`. */
  orderId: string;
  kind: "registration" | "shop_order";
  id: number;
  label: string | null;
  ownGclid: string | null;
  visitorId: string | null;
  personId: number | null;
  convertedAtMs: number;
  valueCents: number;
  currency: string;
  /** The payer's email (parent / buyer — never a child). Used only for the hash. */
  payerEmail: string | null;
}

export interface ResolvedConversion extends PaidConversion {
  click: GoogleClick | null;
}

/** Paid conversions in the last `days` days (registrations + paid shop orders). */
export async function listPaidConversions(opts: { days?: number; registrationIds?: number[] } = {}): Promise<PaidConversion[]> {
  const days = opts.days ?? GOOGLE_CLICK_WINDOW_DAYS;
  const ids = opts.registrationIds ?? null;
  const regs = await pool.query(
    `SELECT r.id, r.gclid, r.visitor_id, r.person_id,
            EXTRACT(EPOCH FROM r.registered_at) * 1000 AS ts_ms,
            r.total_cents, r.refunded_amount_cents, COALESCE(r.currency, 'NZD') AS currency,
            p.name AS label, g.email AS payer_email
       FROM registrations r
       JOIN programs p ON p.id = r.program_id
       LEFT JOIN contacts g ON g.id = r.guardian_id
      WHERE r.status IN ${REAL_REGISTRATION_STATUS_SQL}
        AND r.status <> 'refunded'
        AND ($2::int[] IS NOT NULL OR r.registered_at > now() - make_interval(days => $1::int))
        AND ($2::int[] IS NULL OR r.id = ANY($2::int[]))`,
    [days, ids],
  );
  const out: PaidConversion[] = regs.rows.map((r: any) => ({
    orderId: `reg-${r.id}`,
    kind: "registration" as const,
    id: Number(r.id),
    label: r.label ?? null,
    ownGclid: r.gclid ?? null,
    visitorId: r.visitor_id ?? null,
    personId: r.person_id != null ? Number(r.person_id) : null,
    convertedAtMs: Number(r.ts_ms),
    valueCents: netPaidCents(r.total_cents, r.refunded_amount_cents),
    currency: String(r.currency || "NZD"),
    payerEmail: r.payer_email ?? null,
  }));
  if (ids) return out;

  const shop = await pool.query(
    `SELECT o.id, o.gclid, o.visitor_id, o.order_number, o.email, o.currency, o.total_cents,
            EXTRACT(EPOCH FROM COALESCE(o.paid_at, o.created_at)) * 1000 AS ts_ms,
            (SELECT pi.person_id FROM person_identities pi
              WHERE pi.kind = 'email' AND pi.value = lower(trim(o.email)) LIMIT 1) AS person_id
       FROM shop_orders o
      WHERE o.status = ANY($2::text[])
        AND o.paid_at IS NOT NULL
        AND o.paid_at > now() - make_interval(days => $1::int)`,
    [days, SHOP_PAID_STATUSES],
  );
  for (const o of shop.rows as any[]) {
    out.push({
      orderId: `shop-${o.id}`,
      kind: "shop_order",
      id: Number(o.id),
      label: o.order_number ? `Shop ${o.order_number}` : "Shop order",
      ownGclid: o.gclid ?? null,
      visitorId: o.visitor_id ?? null,
      personId: o.person_id != null ? Number(o.person_id) : null,
      convertedAtMs: Number(o.ts_ms),
      valueCents: netPaidCents(o.total_cents, 0),
      currency: String(o.currency || "NZD"),
      payerEmail: o.email ?? null,
    });
  }
  return out;
}

/**
 * Attach the Google click (if any) to each conversion. ONE query for every
 * conversion's touches, so an export of hundreds of rows is not N+1.
 */
export async function resolveGoogleClicks(conversions: readonly PaidConversion[]): Promise<ResolvedConversion[]> {
  if (conversions.length === 0) return [];
  const visitorIds = Array.from(new Set(conversions.map((c) => c.visitorId).filter((v): v is string => !!v)));
  const personIds = Array.from(new Set(conversions.map((c) => c.personId).filter((v): v is number => v != null)));
  const earliest = Math.min(...conversions.map((c) => c.convertedAtMs)) - GOOGLE_CLICK_WINDOW_DAYS * 86_400_000;

  // Every other visitor id bound to these payers (person_identities, unique index).
  const bound = personIds.length
    ? await pool.query(
        `SELECT person_id, value AS visitor_id FROM person_identities WHERE kind = 'visitor' AND person_id = ANY($1::int[])`,
        [personIds],
      )
    : { rows: [] as any[] };
  const personsOfVisitor = new Map<string, Set<number>>();
  for (const b of bound.rows as any[]) {
    const v = String(b.visitor_id);
    (personsOfVisitor.get(v) ?? personsOfVisitor.set(v, new Set()).get(v)!).add(Number(b.person_id));
  }
  const allVisitors = Array.from(new Set([...visitorIds, ...Array.from(personsOfVisitor.keys())]));

  // Two index-driven probes (analytics_events_visitor_ts_idx / _person_ts_idx),
  // OR'd as a bitmap — never a scan of the whole window. The Google-click filter
  // runs on the handful of rows those probes return.
  const r = await pool.query(
    `SELECT e.visitor_id, e.person_id, e.gclid,
            e.metadata->>'gbraid' AS gbraid, e.metadata->>'wbraid' AS wbraid, e.is_bot,
            EXTRACT(EPOCH FROM e."timestamp") * 1000 AS ts_ms
       FROM analytics_events e
      WHERE (e.visitor_id = ANY($1::text[]) OR e.person_id = ANY($2::int[]))
        AND e."timestamp" >= to_timestamp($3::double precision / 1000)
        AND NOT e.is_bot
        AND (e.gclid IS NOT NULL OR e.metadata ? 'gbraid' OR e.metadata ? 'wbraid')`,
    [allVisitors, personIds, earliest],
  );

  type Row = { visitorId: string; gclid: string | null; gbraid: string | null; wbraid: string | null; isBot: boolean; ts: number };
  const byVisitor = new Map<string, Row[]>();
  const byPerson = new Map<number, Row[]>();
  for (const x of r.rows as any[]) {
    const row: Row = {
      visitorId: String(x.visitor_id),
      gclid: x.gclid ?? null,
      gbraid: x.gbraid ?? null,
      wbraid: x.wbraid ?? null,
      isBot: x.is_bot === true,
      ts: Number(x.ts_ms),
    };
    (byVisitor.get(row.visitorId) ?? byVisitor.set(row.visitorId, []).get(row.visitorId)!).push(row);
    const owners = new Set<number>(personsOfVisitor.get(row.visitorId) ?? []);
    if (x.person_id != null) owners.add(Number(x.person_id));
    for (const p of Array.from(owners)) {
      (byPerson.get(p) ?? byPerson.set(p, []).get(p)!).push(row);
    }
  }

  return conversions.map((c) => {
    const touches: GoogleClickTouch[] = [];
    const seen = new Set<Row>();
    const add = (row: Row) => {
      if (seen.has(row)) return;
      seen.add(row);
      touches.push({
        visitorId: row.visitorId,
        sameVisitor: !!c.visitorId && row.visitorId === c.visitorId,
        gclid: row.gclid,
        gbraid: row.gbraid,
        wbraid: row.wbraid,
        isBot: row.isBot,
        timestampMs: row.ts,
      });
    };
    if (c.visitorId) for (const row of byVisitor.get(c.visitorId) ?? []) add(row);
    if (c.personId != null) for (const row of byPerson.get(c.personId) ?? []) add(row);
    return { ...c, click: pickGoogleClick({ ownGclid: c.ownGclid, convertedAtMs: c.convertedAtMs, touches }) };
  });
}

/** The Google click behind one real registration, or null. */
export async function resolveGoogleClick(registrationId: number): Promise<GoogleClick | null> {
  const [conv] = await listPaidConversions({ registrationIds: [registrationId] });
  if (!conv) return null;
  const [resolved] = await resolveGoogleClicks([conv]);
  return resolved?.click ?? null;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Basic auth against GOOGLE_ADS_EXPORT_USER/PASSWORD. Unset env answers 404
 *  (the route does not exist). Missing or wrong credentials answer 401 with a
 *  Basic challenge: Google Ads' HTTPS data connection first asks WITHOUT
 *  credentials and only sends them after a challenge, so a 404 there read as
 *  "Invalid credentials" (found 2026-10-14 connecting Data Manager). */
export function googleAdsExportAuth(req: Request, res: Response, next: NextFunction) {
  const user = process.env.GOOGLE_ADS_EXPORT_USER;
  const pass = process.env.GOOGLE_ADS_EXPORT_PASSWORD;
  const notFound = () => res.status(404).json({ message: "Not found" });
  if (!user || !pass) return notFound();
  const challenge = () => {
    res.setHeader("WWW-Authenticate", 'Basic realm="ClubOS Google Ads export", charset="UTF-8"');
    return res.status(401).json({ message: "Authentication required" });
  };
  const h = String(req.headers.authorization || "");
  if (!h.toLowerCase().startsWith("basic ")) return challenge();
  let decoded = "";
  try {
    decoded = Buffer.from(h.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return challenge();
  }
  const i = decoded.indexOf(":");
  if (i < 0) return challenge();
  const okUser = safeEqual(decoded.slice(0, i), user);
  const okPass = safeEqual(decoded.slice(i + 1), pass);
  if (!okUser || !okPass) return challenge();
  next();
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function registerGoogleAdsRoutes(app: Express) {
  app.get("/api/integrations/google-ads/conversions.csv", googleAdsExportAuth, async (req, res) => {
    try {
      const includeEmailHash = req.query.email_hash === "1";
      const resolved = await resolveGoogleClicks(await listPaidConversions());
      const rows: GoogleConversionRow[] = resolved
        .filter((c) => c.click?.type === "gclid")
        .map((c) => {
          const email = includeEmailHash ? normalizeEmailForGoogle(c.payerEmail) : null;
          return {
            orderId: c.orderId,
            gclid: c.click!.id,
            convertedAtMs: c.convertedAtMs,
            valueCents: c.valueCents,
            currency: c.currency,
            emailSha256: email ? sha256(email) : null,
          };
        });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      res.send(buildGoogleAdsCsv(rows, { includeEmailHash }));
    } catch (e) {
      console.error("[google-ads] export failed:", e);
      res.status(500).type("text/plain").send("export failed");
    }
  });

  // Read-only check for the Marketing hub: is Google attribution actually working?
  // Same gates as every hub route. No personal data in the answer.
  app.get(
    "/api/admin/google-ads/attribution-check",
    requireAuth,
    requireTab(MARKETING_HUB_TAB),
    requireHubWorkspace,
    async (_req, res) => {
      try {
        const clicks = await pool.query(
          `SELECT
              count(*) FILTER (WHERE gclid IS NOT NULL) AS gclid,
              count(*) FILTER (WHERE metadata ? 'gbraid') AS gbraid,
              count(*) FILTER (WHERE metadata ? 'wbraid') AS wbraid,
              count(DISTINCT visitor_id) AS visitors
             FROM analytics_events
            WHERE "timestamp" > now() - interval '30 days'
              AND NOT is_bot
              AND (gclid IS NOT NULL OR metadata ? 'gbraid' OR metadata ? 'wbraid')`,
        );
        const resolved = (await resolveGoogleClicks(await listPaidConversions())).filter((c) => c.click);
        resolved.sort((a, b) => b.convertedAtMs - a.convertedAtMs);
        const c = clicks.rows[0] ?? {};
        res.json({
          windowDays: GOOGLE_CLICK_WINDOW_DAYS,
          googleClicksLast30d: {
            gclid: Number(c.gclid ?? 0),
            gbraid: Number(c.gbraid ?? 0),
            wbraid: Number(c.wbraid ?? 0),
            visitors: Number(c.visitors ?? 0),
          },
          conversionsResolvedToGoogle: resolved.length,
          uploadableByFile: resolved.filter((x) => x.click?.type === "gclid").length,
          valueCents: resolved.reduce((s, x) => s + x.valueCents, 0),
          last10: resolved.slice(0, 10).map((x) => ({
            kind: x.kind,
            id: x.id,
            programme: x.label,
            valueCents: x.valueCents,
            clickType: x.click!.type,
            clickSource: x.click!.source,
            clickAt: x.click!.clickAtMs != null ? new Date(x.click!.clickAtMs).toISOString() : null,
            convertedAt: new Date(x.convertedAtMs).toISOString(),
          })),
        });
      } catch (e) {
        console.error("[google-ads] attribution-check failed:", e);
        res.status(500).json({ message: "Could not read Google attribution" });
      }
    },
  );
}
