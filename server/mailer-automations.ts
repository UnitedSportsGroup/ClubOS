// ─────────────────────────────────────────────────────────────────────────────
// Mailer Automations — the API and the runner.
//
//   GET    /api/admin/mailer/automations                 list (+ 30-day stats)
//   POST   /api/admin/mailer/automations                 create { starter? , trigger?, programIds? }
//   GET    /api/admin/mailer/automations/programmes      programmes for the picker
//   GET    /api/admin/mailer/automations/:id             one, with its emails
//   PATCH  /api/admin/mailer/automations/:id             settings
//   PUT    /api/admin/mailer/automations/:id/steps       the emails, in full
//   POST   /api/admin/mailer/automations/:id/status      off | test | on
//   GET    /api/admin/mailer/automations/:id/eligible    who would enter from now
//   GET    /api/admin/mailer/automations/:id/activity    families + every email, with reasons
//   POST   /api/admin/mailer/automations/:id/steps/:stepId/test   send me this email
//   DELETE /api/admin/mailer/automations/:id             retire (only when off)
//
// Gated on the Mailer TAB in the workspace named by X-Workspace-Slug, and every
// read and write is scoped to that workspace's organisation — an id from
// another workspace is 404, never 403.
//
// THE RUNNER (every minute, ONE machine at a time via an advisory lock — Fly
// runs two): (1) finds families who have just met a trigger and enrols them
// once (UNIQUE dedupe key), scheduling one send per email; (2) sends what is
// due, re-checking at the last moment: switched off? paid already? unsubscribed?
// quiet hours? Every send ends sent / skipped / failed / cancelled WITH a reason.
//
// 🔴 "Registered" means PAID (@shared/registrations). An unfinished checkout
// only ever appears here as the trigger for the unfinished-registration flow —
// and that flow stops itself the moment the same family pays for the same
// programme, whichever registration row the payment lands on.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireTab } from "./auth";
import { sendEmailDetailed } from "./email";
import { lookupMailerRecipient } from "./mailer-audience";
import { renderForRecipient, applyMergeTagsText, visibleTextLength } from "./mailer-render";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import {
  TRIGGERS, STARTER_FLOWS, isTriggerType, isTimingUnit, isStatus, isValidSendTime,
  dueAt, nzParts, nzMidnight, starterFlow, offsetMinutes,
  type TriggerType, type StepTiming,
} from "@shared/mailer-automations";

type Deps = {
  /** The signed one-click unsubscribe link for an address (routes.ts owns the secret). */
  unsubUrl: (orgId: number, email: string) => string;
  /** Every address that has opted out of this organisation's email. */
  unsubscribed: (orgId: number) => Promise<Set<string>>;
};

const q = async (text: string, params: any[] = []) => (await pool.query(text, params)).rows as any[];

// The address a registration reaches. A term enrolment's registrant IS the
// player and the parent sits on guardian_id; a camp booking's registrant is the
// parent. The newest families carry the address on the guardian row only.
const REG_EMAIL = `lower(btrim(CASE WHEN c.type = 'player'
    THEN COALESCE(NULLIF(btrim(g.email), ''), NULLIF(btrim(c.email), ''))
    ELSE COALESCE(NULLIF(btrim(c.email), ''), NULLIF(btrim(g.email), '')) END))`;
const REG_FROM = `registrations r
  JOIN programs p ON p.id = r.program_id
  LEFT JOIN contacts c ON c.id = r.contact_id
  LEFT JOIN contacts g ON g.id = r.guardian_id`;

/** Where a family registers for a programme — the {{programme_link}} tag. */
const JOIN_HOST: Record<string, string> = {
  "christchurch-united": "https://join.cufc.co.nz",
  "mini-football-leagues": "https://join.minifootball.co.nz",
  "south-island-united": "https://join.southislandunited.com",
};
function programmeLink(orgSlug: string, type: string, slug: string): string {
  const host = JOIN_HOST[orgSlug] ?? "https://app.usg.co.nz";
  return type === "academy" ? `${host}/academy/${slug}` : `${host}/${slug}`;
}

const DEFAULT_FROM: Record<string, string> = {
  "christchurch-united": "Christchurch United FC <noreply@cufc.co.nz>",
};
const DEFAULT_REPLY: Record<string, string> = {
  "christchurch-united": "info@cufc.co.nz",
};

async function orgFor(req: Request): Promise<{ id: number; slug: string } | null> {
  const slug = String(req.headers["x-workspace-slug"] || "");
  if (!slug) return null;
  const r = await q(`SELECT id, slug FROM organizations WHERE slug = $1 LIMIT 1`, [slug]);
  return r[0] ? { id: Number(r[0].id), slug: String(r[0].slug) } : null;
}

const userId = (req: Request) => ((req.session as any)?.userId as number | undefined) ?? null;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  // Noon UTC is the same calendar day in NZ, so the weekday cannot slip.
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-NZ", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

function shapeStep(s: any) {
  return {
    id: Number(s.id),
    timingUnit: s.timing_unit,
    timingAmount: Number(s.timing_amount),
    timingDirection: s.timing_direction,
    sendTime: s.send_time ?? null,
    subject: s.subject ?? "",
    preheader: s.preheader ?? null,
    bodyHtml: s.body_html ?? "",
    bodyDoc: s.body_doc ?? null,
    enabled: !!s.enabled,
  };
}

function shapeAutomation(a: any, steps: any[] = [], stats?: any) {
  return {
    id: Number(a.id),
    name: a.name,
    description: a.description ?? null,
    trigger: a.trigger_type as TriggerType,
    programIds: a.program_ids ? (a.program_ids as any[]).map(Number) : null,
    triggerConfig: a.trigger_config ?? {},
    stopOnPayment: !!a.stop_on_payment,
    emailKind: a.email_kind,
    status: a.status,
    testEmails: a.test_emails ?? [],
    quietHours: !!a.quiet_hours,
    fromEmail: a.from_email ?? null,
    replyTo: a.reply_to ?? null,
    activatedAt: a.activated_at ?? null,
    updatedAt: a.updated_at,
    createdAt: a.created_at,
    updatedBy: a.updated_by_name ?? null,
    steps: steps.map(shapeStep),
    stats: stats ?? null,
  };
}

async function loadAutomation(orgId: number, id: number) {
  const a = (await q(
    `SELECT a.*, NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS updated_by_name
       FROM mailer_automations a LEFT JOIN users u ON u.id = a.updated_by_user_id
      WHERE a.id = $1 AND a.organization_id = $2 AND a.archived_at IS NULL`, [id, orgId]))[0];
  if (!a) return null;
  const steps = await q(
    `SELECT * FROM mailer_automation_steps WHERE automation_id = $1 AND deleted_at IS NULL ORDER BY id`, [id]);
  return { a, steps: sortSteps(steps, a.trigger_type) };
}

/** Steps in time order — the order the page draws them. */
function sortSteps(steps: any[], trigger: TriggerType) {
  const anchor = new Date(Date.UTC(2026, 0, 15, 0, 0));
  return [...steps].sort((x, y) =>
    dueAt(anchor, timingOf(x), trigger, false).getTime() - dueAt(anchor, timingOf(y), trigger, false).getTime()
    || Number(x.id) - Number(y.id));
}
const timingOf = (s: any): StepTiming => ({
  timingUnit: s.timing_unit ?? s.timingUnit,
  timingAmount: Number(s.timing_amount ?? s.timingAmount ?? 0),
  timingDirection: (s.timing_direction ?? s.timingDirection) === "before" ? "before" : "after",
  sendTime: s.send_time ?? s.sendTime ?? null,
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export function registerMailerAutomationRoutes(app: Express, deps: Deps) {
  const BASE = "/api/admin/mailer/automations";
  const gate = requireTab("mailer");

  const fail = (res: Response, where: string, e: any) => {
    console.error(`[mailer-automations] ${where}`, e);
    res.status(500).json({ message: "Something went wrong — please try again." });
  };

  // ── list ───────────────────────────────────────────────────────────────────
  app.get(BASE, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const rows = await q(
        `SELECT a.*, NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS updated_by_name
           FROM mailer_automations a LEFT JOIN users u ON u.id = a.updated_by_user_id
          WHERE a.organization_id = $1 AND a.archived_at IS NULL ORDER BY a.updated_at DESC`, [org.id]);
      const ids = rows.map((r) => Number(r.id));
      const steps = ids.length
        ? await q(`SELECT * FROM mailer_automation_steps WHERE automation_id = ANY($1::int[]) AND deleted_at IS NULL`, [ids])
        : [];
      const stats = ids.length
        ? await q(
          `SELECT e.automation_id,
                  count(*) FILTER (WHERE e.status = 'active')                                             AS active,
                  count(*) FILTER (WHERE e.entered_at > now() - interval '30 days')                       AS entered_30d,
                  count(*) FILTER (WHERE e.stop_reason = 'paid' AND e.finished_at > now() - interval '30 days') AS paid_30d,
                  (SELECT count(*) FROM mailer_automation_sends s JOIN mailer_automation_enrollments e2 ON e2.id = s.enrollment_id
                    WHERE e2.automation_id = e.automation_id AND e2.dedupe_key NOT LIKE 'sim:%' AND s.status = 'sent' AND s.sent_at > now() - interval '30 days') AS sent_30d
             FROM mailer_automation_enrollments e
            WHERE e.automation_id = ANY($1::int[])
              -- A "test family" from the button is not a family: keep it out of the numbers.
              AND e.dedupe_key NOT LIKE 'sim:%'
            GROUP BY e.automation_id`, [ids])
        : [];
      const statBy = new Map(stats.map((s) => [Number(s.automation_id), {
        active: Number(s.active), entered30d: Number(s.entered_30d), paid30d: Number(s.paid_30d), sent30d: Number(s.sent_30d),
      }]));
      res.json({
        automations: rows.map((a) => shapeAutomation(
          a,
          sortSteps(steps.filter((s) => Number(s.automation_id) === Number(a.id)), a.trigger_type),
          statBy.get(Number(a.id)) ?? { active: 0, entered30d: 0, paid30d: 0, sent30d: 0 },
        )),
      });
    } catch (e) { fail(res, "list", e); }
  });

  // ── programmes for the picker ─────────────────────────────────────────────
  app.get(`${BASE}/programmes`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const rows = await q(
        `SELECT p.id, p.name, p.slug, p.type, p.is_active, p.registration_open,
                COALESCE(t.start_date, p.start_date) AS start_date
           FROM programs p LEFT JOIN terms t ON t.id = p.term_id
          WHERE p.organization_id = $1
          ORDER BY p.is_active DESC, p.name`, [org.id]);
      res.json({
        programmes: rows.map((p) => ({
          id: Number(p.id), name: p.name, slug: p.slug, type: p.type,
          active: !!p.is_active, open: !!p.registration_open,
          startDate: iso(p.start_date),
        })),
      });
    } catch (e) { fail(res, "programmes", e); }
  });

  // ── create ─────────────────────────────────────────────────────────────────
  app.post(BASE, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const starter = req.body?.starter ? starterFlow(String(req.body.starter)) : undefined;
      const trigger: TriggerType = starter?.trigger ?? (isTriggerType(req.body?.trigger) ? req.body.trigger : "registration_paid");
      const programIds = cleanProgramIds(req.body?.programIds);
      if (programIds && !(await programmesBelong(org.id, programIds))) return res.status(400).json({ message: "Pick programmes from this workspace." });
      const name = String(req.body?.name || starter?.name || TRIGGERS[trigger].label).slice(0, 120);
      const me = userId(req);
      const meEmail = me ? (await q(`SELECT email FROM users WHERE id = $1`, [me]))[0]?.email : null;
      const [a] = await q(
        `INSERT INTO mailer_automations
           (organization_id, name, description, trigger_type, program_ids, stop_on_payment, email_kind,
            status, test_emails, from_email, reply_to, created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'off',$8,$9,$10,$11,$11) RETURNING id`,
        [org.id, name, starter?.description ?? null, trigger, programIds,
         starter?.stopOnPayment ?? TRIGGERS[trigger].canStopOnPayment, starter?.emailKind ?? "operational",
         meEmail ? [String(meEmail).toLowerCase()] : [],
         DEFAULT_FROM[org.slug] ?? null, DEFAULT_REPLY[org.slug] ?? null, me]);
      const steps = starter?.steps ?? [{
        timingUnit: "immediately", timingAmount: 0, timingDirection: "after", sendTime: null, subject: "", bodyHtml: "",
      } as any];
      for (const s of steps) {
        await q(
          `INSERT INTO mailer_automation_steps (automation_id, timing_unit, timing_amount, timing_direction, send_time, subject, preheader, body_html)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [a.id, s.timingUnit, s.timingAmount, s.timingDirection, s.sendTime, s.subject, (s as any).preheader ?? null, s.bodyHtml]);
      }
      res.json({ id: Number(a.id) });
    } catch (e) { fail(res, "create", e); }
  });

  // ── one ────────────────────────────────────────────────────────────────────
  app.get(`${BASE}/:id`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const got = await loadAutomation(org.id, Number(req.params.id));
      if (!got) return res.status(404).json({ message: "Not found" });
      res.json({ automation: shapeAutomation(got.a, got.steps) });
    } catch (e) { fail(res, "get", e); }
  });

  // ── settings ───────────────────────────────────────────────────────────────
  app.patch(`${BASE}/:id`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const id = Number(req.params.id);
      const got = await loadAutomation(org.id, id);
      if (!got) return res.status(404).json({ message: "Not found" });
      const b = req.body ?? {};
      const sets: string[] = [];
      const vals: any[] = [];
      const set = (col: string, v: any) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

      if (typeof b.name === "string") {
        const n = b.name.trim();
        if (!n || n.length > 120) return res.status(400).json({ message: "Give it a name (up to 120 characters)." });
        set("name", n);
      }
      if (b.description !== undefined) set("description", b.description ? String(b.description).slice(0, 500) : null);
      if (b.trigger !== undefined) {
        if (!isTriggerType(b.trigger)) return res.status(400).json({ message: "Unknown trigger." });
        if (got.a.status !== "off" && b.trigger !== got.a.trigger_type) {
          return res.status(409).json({ message: "Switch it off before changing what starts it." });
        }
        set("trigger_type", b.trigger);
      }
      if (b.programIds !== undefined) {
        const ids = cleanProgramIds(b.programIds);
        if (ids && !(await programmesBelong(org.id, ids))) return res.status(400).json({ message: "Pick programmes from this workspace." });
        set("program_ids", ids);
      }
      if (b.stopOnPayment !== undefined) set("stop_on_payment", !!b.stopOnPayment);
      if (b.emailKind !== undefined) {
        if (b.emailKind !== "operational" && b.emailKind !== "marketing") return res.status(400).json({ message: "Unknown email kind." });
        set("email_kind", b.emailKind);
      }
      if (b.quietHours !== undefined) set("quiet_hours", !!b.quietHours);
      if (b.testEmails !== undefined) {
        const list = Array.isArray(b.testEmails) ? b.testEmails : [];
        const clean = Array.from(new Set(list.map((x: any) => String(x).trim().toLowerCase()).filter((x: string) => /.+@.+\..+/.test(x)))).slice(0, 20);
        set("test_emails", clean);
      }
      if (b.fromEmail !== undefined) set("from_email", b.fromEmail ? String(b.fromEmail).slice(0, 200) : null);
      if (b.replyTo !== undefined) set("reply_to", b.replyTo ? String(b.replyTo).slice(0, 200) : null);
      if (!sets.length) return res.json({ ok: true });
      set("updated_by_user_id", userId(req));
      sets.push("updated_at = now()");
      vals.push(id, org.id);
      await q(`UPDATE mailer_automations SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND organization_id = $${vals.length}`, vals);
      const after = await loadAutomation(org.id, id);
      res.json({ automation: shapeAutomation(after!.a, after!.steps) });
    } catch (e) { fail(res, "patch", e); }
  });

  // ── the emails, saved as a whole ─────────────────────────────────────────
  // The page sends every email it shows. Ones with an id are updated, ones
  // without are new, missing ones are removed. Families already waiting get the
  // new timings for emails not yet sent; a removed email is cancelled for them,
  // and a new one is scheduled for them if its time is still ahead.
  app.put(`${BASE}/:id/steps`, gate, async (req, res) => {
    const client = await pool.connect();
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const id = Number(req.params.id);
      const got = await loadAutomation(org.id, id);
      if (!got) return res.status(404).json({ message: "Not found" });
      const trigger = got.a.trigger_type as TriggerType;
      const incoming: any[] = Array.isArray(req.body?.steps) ? req.body.steps : [];
      if (incoming.length === 0) return res.status(400).json({ message: "An automation needs at least one email." });
      if (incoming.length > 12) return res.status(400).json({ message: "Up to 12 emails per automation." });
      for (const s of incoming) {
        if (!isTimingUnit(s.timingUnit)) return res.status(400).json({ message: "Unknown timing." });
        if (s.timingDirection === "before" && !TRIGGERS[trigger].dateBased) {
          return res.status(400).json({ message: "'Before' only works with a date — a start date, an end date or a birthday." });
        }
        if (s.sendTime != null && s.sendTime !== "" && !isValidSendTime(s.sendTime)) return res.status(400).json({ message: "Times look like 09:00." });
        if (typeof s.subject === "string" && s.subject.length > 300) return res.status(400).json({ message: "Subject lines are up to 300 characters." });
      }
      const existing = new Map(got.steps.map((s) => [Number(s.id), s]));
      await client.query("BEGIN");
      const keep = new Set<number>();
      for (const s of incoming) {
        const vals = [
          s.timingUnit, s.timingUnit === "immediately" ? 0 : Math.max(0, Math.min(100000, Math.round(Number(s.timingAmount) || 0))),
          s.timingDirection === "before" ? "before" : "after",
          s.sendTime ? String(s.sendTime) : null,
          String(s.subject ?? ""), s.preheader ? String(s.preheader).slice(0, 200) : null,
          String(s.bodyHtml ?? ""), s.bodyDoc ?? null, s.enabled !== false,
        ];
        const sid = Number(s.id);
        if (sid && existing.has(sid)) {
          keep.add(sid);
          await client.query(
            `UPDATE mailer_automation_steps SET timing_unit=$1, timing_amount=$2, timing_direction=$3, send_time=$4,
                    subject=$5, preheader=$6, body_html=$7, body_doc=$8, enabled=$9, updated_at=now()
              WHERE id=$10 AND automation_id=$11`, [...vals, sid, id]);
        } else {
          const r = await client.query(
            `INSERT INTO mailer_automation_steps (timing_unit, timing_amount, timing_direction, send_time, subject, preheader, body_html, body_doc, enabled, automation_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [...vals, id]);
          keep.add(Number(r.rows[0].id));
        }
      }
      const removed = Array.from(existing.keys()).filter((k) => !keep.has(k));
      if (removed.length) {
        await client.query(`UPDATE mailer_automation_steps SET deleted_at = now() WHERE id = ANY($1::int[])`, [removed]);
        await client.query(
          `UPDATE mailer_automation_sends SET status='cancelled', reason='This email was removed from the automation', updated_at=now()
            WHERE step_id = ANY($1::int[]) AND status = 'scheduled'`, [removed]);
      }
      await client.query(`UPDATE mailer_automations SET updated_at=now(), updated_by_user_id=$2 WHERE id=$1`, [id, userId(req)]);
      await client.query("COMMIT");
      // Families already part-way through pick up the new timings.
      await rescheduleActive(id);
      const after = await loadAutomation(org.id, id);
      res.json({ automation: shapeAutomation(after!.a, after!.steps) });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, "steps", e);
    } finally {
      client.release();
    }
  });

  // ── switch ────────────────────────────────────────────────────────────────
  app.post(`${BASE}/:id/status`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const id = Number(req.params.id);
      const got = await loadAutomation(org.id, id);
      if (!got) return res.status(404).json({ message: "Not found" });
      const to = req.body?.status;
      if (!isStatus(to)) return res.status(400).json({ message: "Off, Test or On." });
      const from = got.a.status;
      if (to !== "off") {
        const live = got.steps.filter((s) => s.enabled);
        if (live.length === 0) return res.status(400).json({ message: "Switch at least one email on first." });
        const empty = live.find((s) => !String(s.subject).trim() || visibleTextLength(String(s.body_html)) < 3);
        if (empty) return res.status(400).json({ message: "Every email that's switched on needs a subject and some words." });
        if (to === "test" && !(got.a.test_emails ?? []).length) {
          return res.status(400).json({ message: "Add at least one test address so the test emails have somewhere to go." });
        }
      }
      // Leaving OFF starts the clock: families enter from this moment (or the
      // last N days, when someone explicitly asks for them).
      const backfillDays = Math.max(0, Math.min(14, Number(req.body?.includeLastDays) || 0));
      // Moving between Test and On is a fresh start: test families are closed so
      // they never cross over and get the real emails.
      if (from !== to) {
        const why = to === "off" ? "Automation switched off" : from === "test" ? "Test finished — automation switched on" : "Automation switched to test";
        await q(
          `UPDATE mailer_automation_sends s SET status='cancelled', reason=$2, updated_at=now()
             FROM mailer_automation_enrollments e
            WHERE e.id = s.enrollment_id AND e.automation_id = $1 AND s.status = 'scheduled'`, [id, why]);
        await q(
          `UPDATE mailer_automation_enrollments SET status='stopped', stop_reason=$2, finished_at=now()
            WHERE automation_id = $1 AND status = 'active'`, [id, to === "off" ? "switched_off" : "mode_changed"]);
      }
      await q(
        `UPDATE mailer_automations
            SET status = $2,
                activated_at = CASE WHEN $2 = 'off' THEN activated_at
                                    WHEN status <> $2 THEN now() - make_interval(days => $3::int)
                                    ELSE activated_at END,
                updated_at = now(), updated_by_user_id = $4
          WHERE id = $1`, [id, to, backfillDays, userId(req)]);
      const after = await loadAutomation(org.id, id);
      res.json({ automation: shapeAutomation(after!.a, after!.steps) });
      if (to !== "off") void runAutomationsOnce(deps).catch(() => {});
    } catch (e) { fail(res, "status", e); }
  });

  // ── who would enter ─────────────────────────────────────────────────────────
  app.get(`${BASE}/:id/eligible`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const got = await loadAutomation(org.id, Number(req.params.id));
      if (!got) return res.status(404).json({ message: "Not found" });
      const days = Math.max(0, Math.min(14, Number(req.query.days) || 7));
      const since = new Date(Date.now() - days * 86400_000);
      const cands = await candidatesFor(got.a, org.slug, since, true);
      res.json({ days, count: cands.length, sample: cands.slice(0, 8).map((c) => ({ email: c.email, programme: c.context.programmeName ?? null })) });
    } catch (e) { fail(res, "eligible", e); }
  });

  // ── activity ───────────────────────────────────────────────────────────────
  app.get(`${BASE}/:id/activity`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const id = Number(req.params.id);
      const got = await loadAutomation(org.id, id);
      if (!got) return res.status(404).json({ message: "Not found" });
      const enr = await q(
        `SELECT e.id, e.email, e.status, e.stop_reason, e.test, e.entered_at, e.finished_at, e.anchor_at, e.context,
                p.name AS programme
           FROM mailer_automation_enrollments e LEFT JOIN programs p ON p.id = e.program_id
          WHERE e.automation_id = $1 ORDER BY e.entered_at DESC LIMIT 200`, [id]);
      const sends = enr.length
        ? await q(
          `SELECT s.enrollment_id, s.step_id, s.due_at, s.status, s.reason, s.sent_to, s.sent_at
             FROM mailer_automation_sends s WHERE s.enrollment_id = ANY($1::bigint[]) ORDER BY s.due_at`,
          [enr.map((e) => e.id)])
        : [];
      const totals = (await q(
        `SELECT count(*) AS entered,
                count(*) FILTER (WHERE status='active') AS active,
                count(*) FILTER (WHERE status='completed') AS completed,
                count(*) FILTER (WHERE stop_reason='paid') AS paid,
                (SELECT count(*) FROM mailer_automation_sends s JOIN mailer_automation_enrollments e2 ON e2.id=s.enrollment_id WHERE e2.automation_id=$1 AND s.status='sent') AS sent,
                (SELECT count(*) FROM mailer_automation_sends s JOIN mailer_automation_enrollments e2 ON e2.id=s.enrollment_id WHERE e2.automation_id=$1 AND s.status='skipped') AS skipped,
                (SELECT count(*) FROM mailer_automation_sends s JOIN mailer_automation_enrollments e2 ON e2.id=s.enrollment_id WHERE e2.automation_id=$1 AND s.status='failed') AS failed
           FROM mailer_automation_enrollments WHERE automation_id=$1`, [id]))[0];
      res.json({
        totals: Object.fromEntries(Object.entries(totals ?? {}).map(([k, v]) => [k, Number(v)])),
        families: enr.map((e) => ({
          id: Number(e.id), email: e.email, status: e.status, stopReason: e.stop_reason, test: !!e.test,
          enteredAt: e.entered_at, finishedAt: e.finished_at, programme: e.programme ?? e.context?.programmeName ?? null,
          players: e.context?.players ?? [],
          sends: sends.filter((s) => Number(s.enrollment_id) === Number(e.id)).map((s) => ({
            stepId: Number(s.step_id), dueAt: s.due_at, status: s.status, reason: s.reason, sentTo: s.sent_to, sentAt: s.sent_at,
          })),
        })),
      });
    } catch (e) { fail(res, "activity", e); }
  });

  // ── send me this email ─────────────────────────────────────────────────────
  app.post(`${BASE}/:id/steps/:stepId/test`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const got = await loadAutomation(org.id, Number(req.params.id));
      if (!got) return res.status(404).json({ message: "Not found" });
      // The page sends the email as it is on screen, saved or not.
      const subject = String(req.body?.subject ?? "");
      const body = String(req.body?.bodyHtml ?? "");
      if (!subject.trim() || visibleTextLength(body) < 3) return res.status(400).json({ message: "Add a subject and some words first." });
      const me = userId(req);
      const to = String(req.body?.to || (me ? (await q(`SELECT email FROM users WHERE id=$1`, [me]))[0]?.email : "") || "").trim().toLowerCase();
      if (!to.includes("@")) return res.status(400).json({ message: "No address to send the test to." });
      const ctx = await sampleContext(got.a, org.slug);
      const who = await lookupMailerRecipient(to);
      const sent = await deliver({
        orgId: org.id, deps, a: got.a, to,
        subject, bodyHtml: body,
        ctx: { ...ctx, parentFirstName: who.firstName ?? ctx.parentFirstName },
        test: true,
      });
      if (!sent.ok) return res.status(502).json({ message: "The email service didn't accept it — try again in a minute." });
      res.json({ ok: true, to });
    } catch (e) { fail(res, "test", e); }
  });

  // ── run a test family through it ─────────────────────────────────────────
  // Plays the whole flow to the person pressing the button, with sample names.
  // `fast` squeezes the timings so a three-day flow lands in a few minutes:
  // email 1 in a minute, then one a minute apart, in the same order.
  app.post(`${BASE}/:id/simulate`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const got = await loadAutomation(org.id, Number(req.params.id));
      if (!got) return res.status(404).json({ message: "Not found" });
      const me = userId(req);
      const to = String(req.body?.to || (me ? (await q(`SELECT email FROM users WHERE id=$1`, [me]))[0]?.email : "") || "").trim().toLowerCase();
      if (!to.includes("@")) return res.status(400).json({ message: "No address to send the test to." });
      const steps = got.steps.filter((s) => s.enabled);
      if (!steps.length) return res.status(400).json({ message: "Switch at least one email on first." });
      const fast = req.body?.fast !== false;
      const ctx = await sampleContext(got.a, org.slug);
      const who = await lookupMailerRecipient(to);
      ctx.parentFirstName = who.firstName;
      const trigger = got.a.trigger_type as TriggerType;
      // A date flow's anchor is the date itself; pretend it is far enough ahead
      // that every "before" email is still to come.
      const maxBefore = Math.max(0, ...steps.map((s) => (timingOf(s).timingDirection === "before" ? -offsetMinutes(timingOf(s)) : 0)));
      const anchor = new Date(Date.now() + (maxBefore + 5) * 60_000);
      const [e] = await q(
        `INSERT INTO mailer_automation_enrollments
           (automation_id, organization_id, dedupe_key, email, anchor_at, context, test)
         VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
        [got.a.id, org.id, `sim:${Date.now()}:${me ?? 0}`, to, anchor, ctx]);
      const plan = steps.map((s, i) => ({
        s,
        at: fast ? new Date(Date.now() + (i + 1) * 60_000) : dueAt(anchor, timingOf(s), trigger, false),
      }));
      for (const { s, at } of plan) {
        await q(`INSERT INTO mailer_automation_sends (enrollment_id, step_id, due_at) VALUES ($1,$2,$3)`, [e.id, s.id, at]);
      }
      res.json({ ok: true, to, fast, schedule: plan.map((x) => ({ stepId: Number(x.s.id), at: x.at })) });
    } catch (e) { fail(res, "simulate", e); }
  });

  // ── retire ─────────────────────────────────────────────────────────────────
  app.delete(`${BASE}/:id`, gate, async (req, res) => {
    try {
      const org = await orgFor(req);
      if (!org) return res.status(400).json({ message: "Unknown workspace" });
      const got = await loadAutomation(org.id, Number(req.params.id));
      if (!got) return res.status(404).json({ message: "Not found" });
      if (got.a.status !== "off") return res.status(409).json({ message: "Switch it off before deleting it." });
      await q(`UPDATE mailer_automations SET archived_at = now(), updated_by_user_id=$2 WHERE id = $1`, [got.a.id, userId(req)]);
      res.json({ ok: true });
    } catch (e) { fail(res, "delete", e); }
  });
}

function cleanProgramIds(v: any): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const ids = Array.from(new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  return ids.length ? ids : null;
}
async function programmesBelong(orgId: number, ids: number[]): Promise<boolean> {
  const r = await q(`SELECT count(*) AS n FROM programs WHERE id = ANY($1::int[]) AND organization_id = $2`, [ids, orgId]);
  return Number(r[0]?.n) === ids.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Who meets a trigger
// ─────────────────────────────────────────────────────────────────────────────

type Candidate = {
  dedupeKey: string;
  email: string;
  registrationId: number | null;
  programId: number | null;
  anchor: Date;
  context: {
    programmeName?: string;
    programmeStart?: string | null;
    programmeLink?: string;
    parentFirstName?: string | null;
    players?: string[];
  };
};

// 🔴 pg hands a DATE back as a Date at LOCAL midnight. toISOString() turns NZ
// midnight on the 12th into "…-11T11:00Z", printing the day before — so read
// the parts the driver set, never the UTC instant.
const iso = (d: any): string | null => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return String(d).slice(0, 10);
};

/** Registration rows with everything an email needs. */
async function regRows(where: string, params: any[]) {
  return q(
    `SELECT r.id, r.program_id, r.status, r.registered_at, r.paid_at,
            ${REG_EMAIL} AS email,
            CASE WHEN c.type = 'player' THEN g.first_name ELSE c.first_name END AS parent_first,
            CASE WHEN c.type = 'player' THEN c.first_name END AS player_first,
            p.name AS programme, p.slug, p.type AS ptype,
            COALESCE(rt.start_date, pt.start_date, p.start_date) AS start_date,
            COALESCE(rt.end_date, pt.end_date, p.end_date) AS end_date,
            (SELECT array_agg(DISTINCT ch.first_name) FROM registration_items ri JOIN children ch ON ch.id = ri.child_id
              WHERE ri.registration_id = r.id AND ch.first_name IS NOT NULL) AS child_firsts
       FROM ${REG_FROM}
       LEFT JOIN terms rt ON rt.id = r.term_id
       LEFT JOIN terms pt ON pt.id = p.term_id
      WHERE ${where}`, params);
}

function contextOf(r: any, orgSlug: string): Candidate["context"] {
  const players = [r.player_first, ...((r.child_firsts as string[] | null) ?? [])].filter(Boolean) as string[];
  return {
    programmeName: r.programme,
    programmeStart: iso(r.start_date),
    programmeLink: programmeLink(orgSlug, r.ptype, r.slug),
    parentFirstName: r.parent_first ?? null,
    players: Array.from(new Set(players)),
  };
}

/**
 * Everyone who has met this automation's trigger since `since`.
 * `preview` = counting for the page, so it never writes and ignores dedupe.
 */
async function candidatesFor(a: any, orgSlug: string, since: Date, preview = false): Promise<Candidate[]> {
  const orgId = Number(a.organization_id);
  const ids: number[] | null = a.program_ids ? (a.program_ids as any[]).map(Number) : null;
  const scope = `p.organization_id = $1 AND ($2::int[] IS NULL OR r.program_id = ANY($2::int[]))`;
  const trigger = a.trigger_type as TriggerType;
  const now = new Date();

  if (trigger === "registration_paid") {
    const rows = await regRows(
      `${scope} AND r.status IN ${REAL_REGISTRATION_STATUS_SQL}
       AND (r.registered_at >= $3 OR r.paid_at >= $3)`, [orgId, ids, since]);
    return rows.filter((r) => r.email).map((r) => ({
      dedupeKey: `reg:${r.id}`, email: r.email, registrationId: Number(r.id), programId: Number(r.program_id),
      // paid_at is only stamped by some paths; the runner sees a payment within a
      // minute of it landing, so "now" is the honest clock for the rest.
      anchor: r.paid_at ? new Date(r.paid_at) : preview ? new Date(r.registered_at) : now,
      context: contextOf(r, orgSlug),
    }));
  }

  if (trigger === "registration_started") {
    // A checkout started and not paid. One reminder run per family per
    // programme, however many times they retry the checkout.
    const rows = await regRows(
      `${scope} AND r.status = 'pending' AND r.registered_at >= $3 ORDER BY r.registered_at`, [orgId, ids, since]);
    const seen = new Set<string>();
    const out: Candidate[] = [];
    for (const r of rows) {
      if (!r.email) continue;
      const key = `start:${r.program_id}:${r.email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Already paid for this programme (a sibling's checkout, or a retry that
      // went through)? Then there is nothing unfinished to remind them about.
      if (await hasPaid(Number(r.program_id), r.email)) continue;
      out.push({ dedupeKey: key, email: r.email, registrationId: Number(r.id), programId: Number(r.program_id), anchor: new Date(r.registered_at), context: contextOf(r, orgSlug) });
    }
    return out;
  }

  if (trigger === "first_registration") {
    const rows = await regRows(
      `${scope} AND r.status IN ${REAL_REGISTRATION_STATUS_SQL} AND (r.registered_at >= $3 OR r.paid_at >= $3)
       AND r.legacy_source IS NULL`, [orgId, ids, since]);
    const out: Candidate[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.email || seen.has(r.email)) continue;
      // First EVER real registration with this organisation, on any programme.
      const earlier = await q(
        `SELECT 1 FROM ${REG_FROM}
          WHERE p.organization_id = $1 AND r.status IN ${REAL_REGISTRATION_STATUS_SQL}
            AND r.id <> $2 AND r.registered_at < $3 AND ${REG_EMAIL} = $4 LIMIT 1`,
        [orgId, r.id, r.registered_at, r.email]);
      // Friendly Manager history counts as a past registration too.
      const fm = earlier.length ? earlier : await q(
        `SELECT 1 FROM fm_registration_history h JOIN contacts c ON c.id = h.contact_id
          WHERE h.organization_id = $2 AND lower(btrim(c.email)) = $1 LIMIT 1`, [r.email, orgId]).catch(() => []);
      if (fm.length) continue;
      seen.add(r.email);
      out.push({
        dedupeKey: `first:${r.email}`, email: r.email, registrationId: Number(r.id), programId: Number(r.program_id),
        anchor: r.paid_at ? new Date(r.paid_at) : preview ? new Date(r.registered_at) : now, context: contextOf(r, orgSlug),
      });
    }
    return out;
  }

  if (trigger === "birthday") {
    // Players registered (and paid) in scope in the last 12 months whose
    // birthday is TODAY in New Zealand. 29 Feb birthdays are celebrated on
    // 28 Feb in a non-leap year.
    const t = nzParts(now);
    const todayIso = `${t.y}-${String(t.mo).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    const leap = (t.y % 4 === 0 && t.y % 100 !== 0) || t.y % 400 === 0;
    const feb28 = !leap && t.mo === 2 && t.d === 28;
    const rows = await q(
      `SELECT DISTINCT ON (who) * FROM (
         SELECT 'c' || c.id AS who, c.first_name AS player_first, c.date_of_birth AS dob, r.id, r.program_id,
                ${REG_EMAIL} AS email, g.first_name AS parent_first, p.name AS programme, p.slug, p.type AS ptype
           FROM ${REG_FROM}
          WHERE ${scope} AND r.status IN ${REAL_REGISTRATION_STATUS_SQL} AND c.type = 'player'
            AND r.registered_at > now() - interval '12 months' AND c.date_of_birth IS NOT NULL
         UNION ALL
         SELECT 'k' || ch.id, ch.first_name, ch.date_of_birth, r.id, r.program_id,
                ${REG_EMAIL}, c.first_name, p.name, p.slug, p.type
           FROM ${REG_FROM}
           JOIN registration_items ri ON ri.registration_id = r.id
           JOIN children ch ON ch.id = ri.child_id
          WHERE ${scope} AND r.status IN ${REAL_REGISTRATION_STATUS_SQL}
            AND r.registered_at > now() - interval '12 months' AND ch.date_of_birth IS NOT NULL
       ) x
       WHERE (extract(month FROM dob) = $3 AND extract(day FROM dob) = $4)
          OR ($5 AND extract(month FROM dob) = 2 AND extract(day FROM dob) = 29)
       ORDER BY who, id DESC`, [orgId, ids, t.mo, t.d, feb28]);
    return rows.filter((r) => r.email).map((r) => ({
      dedupeKey: `bday:${r.who}:${t.y}`, email: r.email, registrationId: Number(r.id), programId: Number(r.program_id),
      anchor: nzMidnight(todayIso),
      context: {
        programmeName: r.programme, programmeLink: programmeLink(orgSlug, r.ptype, r.slug),
        parentFirstName: r.parent_first ?? null, players: r.player_first ? [r.player_first] : [],
      },
    }));
  }

  // programme_start / programme_end: every paid registration whose programme
  // (or term) date is within 60 days either side. The runner only schedules the
  // emails whose time is still ahead.
  const col = trigger === "programme_start" ? "start_date" : "end_date";
  const rows = await regRows(
    `${scope} AND r.status IN ${REAL_REGISTRATION_STATUS_SQL}
     AND COALESCE(${col === "start_date" ? "rt.start_date, pt.start_date, p.start_date" : "rt.end_date, pt.end_date, p.end_date"})
         BETWEEN (now() AT TIME ZONE 'Pacific/Auckland')::date - 60 AND (now() AT TIME ZONE 'Pacific/Auckland')::date + 60`,
    [orgId, ids]);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    const date = iso(r[col]);
    if (!r.email || !date) continue;
    // One email per family per programme date, even with two children on two rows.
    const key = `${trigger === "programme_start" ? "pstart" : "pend"}:${r.program_id}:${date}:${r.email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dedupeKey: key, email: r.email, registrationId: Number(r.id), programId: Number(r.program_id), anchor: nzMidnight(date), context: contextOf(r, orgSlug) });
  }
  return out;
}

/** Real-looking values for a test send: the first programme in scope. */
async function sampleContext(a: any, orgSlug: string) {
  const ids: number[] | null = a.program_ids ? (a.program_ids as any[]).map(Number) : null;
  const p = (await q(
    `SELECT p.name, p.slug, p.type, COALESCE(t.start_date, p.start_date) AS start_date
       FROM programs p LEFT JOIN terms t ON t.id = p.term_id
      WHERE p.organization_id = $1 AND ($2::int[] IS NULL OR p.id = ANY($2::int[]))
      ORDER BY p.is_active DESC, p.id LIMIT 1`, [a.organization_id, ids]))[0];
  return {
    programmeName: p?.name ?? "your programme",
    programmeStart: iso(p?.start_date),
    programmeLink: p ? programmeLink(orgSlug, p.type, p.slug) : "",
    parentFirstName: null as string | null,
    players: ["Alex"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sending one email
// ─────────────────────────────────────────────────────────────────────────────

async function deliver(o: {
  orgId: number; deps: Deps; a: any; to: string; subject: string; bodyHtml: string;
  ctx: Candidate["context"] & { programmeStart?: string | null }; test: boolean;
}): Promise<{ ok: boolean; id: string | null }> {
  const extra: Record<string, string> = {
    programme_name: o.ctx.programmeName ?? "",
    programme_start_date: fmtDate(o.ctx.programmeStart ?? null),
    programme_link: o.ctx.programmeLink ?? "",
  };
  const fill = (s: string, html: boolean) => s.replace(/\{\{\s*(programme_name|programme_start_date|programme_link)\s*\}\}/g, (_, k) =>
    html && k !== "programme_link" ? escapeHtml(extra[k]) : extra[k]);
  const recipientCtx = {
    email: o.to,
    unsubscribeUrl: o.deps.unsubUrl(o.orgId, o.to),
    firstName: o.ctx.parentFirstName ?? null,
    lastName: null,
    players: (o.ctx.players ?? []).map((f) => ({ firstName: f })),
  };
  const subject = applyMergeTagsText(fill(o.subject, false), recipientCtx);
  const html = renderForRecipient(fill(o.bodyHtml, true), recipientCtx);
  return sendEmailDetailed({
    to: o.to,
    from: o.a.from_email || "Christchurch United FC <noreply@cufc.co.nz>",
    replyTo: o.a.reply_to || undefined,
    subject: o.test ? `[TEST] ${subject}` : subject,
    html,
  } as any);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// The runner
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_KEY = 702551025; // arbitrary, unique to this runner
const STALE_MS = 15 * 60_000; // an email more than 15 minutes late when scheduled is skipped, not sprung on someone

async function enrol(a: any, orgSlug: string) {
  const since = a.activated_at ? new Date(a.activated_at) : new Date();
  const cands = await candidatesFor(a, orgSlug, since);
  if (!cands.length) return 0;
  const steps = sortSteps(await q(
    `SELECT * FROM mailer_automation_steps WHERE automation_id = $1 AND deleted_at IS NULL AND enabled`, [a.id]), a.trigger_type);
  if (!steps.length) return 0;
  const trigger = a.trigger_type as TriggerType;
  const now = Date.now();
  let entered = 0;
  for (const c of cands) {
    // Fill in the parent's name the way the Mailer does, once, on entry.
    if (!c.context.parentFirstName) {
      try { c.context.parentFirstName = (await lookupMailerRecipient(c.email)).firstName; } catch { /* "Hi there" */ }
    }
    const plan = steps.map((s) => ({ s, at: dueAt(c.anchor, timingOf(s), trigger, !!a.quiet_hours) }));
    // A date flow joined late (registered two days before the start) skips the
    // emails whose moment has gone — and if every one has, it does not enrol.
    if (TRIGGERS[trigger].dateBased && plan.every((x) => x.at.getTime() < now - STALE_MS)) continue;
    const ins = await q(
      `INSERT INTO mailer_automation_enrollments
         (automation_id, organization_id, dedupe_key, email, registration_id, program_id, anchor_at, context, test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (automation_id, dedupe_key) DO NOTHING RETURNING id`,
      [a.id, a.organization_id, c.dedupeKey, c.email, c.registrationId, c.programId, c.anchor, c.context, a.status === "test"]);
    if (!ins.length) continue;
    entered++;
    for (const { s, at } of plan) {
      const late = at.getTime() < now - STALE_MS;
      await q(
        `INSERT INTO mailer_automation_sends (enrollment_id, step_id, due_at, status, reason)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (enrollment_id, step_id) DO NOTHING`,
        [ins[0].id, s.id, at, late ? "skipped" : "scheduled", late ? "Too late — this email's time had already passed when they joined" : null]);
    }
  }
  return entered;
}

/** After the emails change: waiting families get new times, and a newly added
 *  email is scheduled for them if its time is still ahead. */
async function rescheduleActive(automationId: number) {
  const a = (await q(`SELECT * FROM mailer_automations WHERE id = $1`, [automationId]))[0];
  if (!a) return;
  const steps = await q(`SELECT * FROM mailer_automation_steps WHERE automation_id=$1 AND deleted_at IS NULL`, [automationId]);
  const enr = await q(`SELECT id, anchor_at FROM mailer_automation_enrollments WHERE automation_id=$1 AND status='active'`, [automationId]);
  const now = Date.now();
  for (const e of enr) {
    for (const s of steps) {
      const at = dueAt(new Date(e.anchor_at), timingOf(s), a.trigger_type, !!a.quiet_hours);
      if (!s.enabled) {
        await q(`UPDATE mailer_automation_sends SET status='cancelled', reason='This email was switched off', updated_at=now()
                  WHERE enrollment_id=$1 AND step_id=$2 AND status='scheduled'`, [e.id, s.id]);
        continue;
      }
      if (at.getTime() < now - STALE_MS) continue;
      await q(
        `INSERT INTO mailer_automation_sends (enrollment_id, step_id, due_at) VALUES ($1,$2,$3)
         ON CONFLICT (enrollment_id, step_id) DO UPDATE SET due_at = EXCLUDED.due_at, updated_at = now()
           WHERE mailer_automation_sends.status = 'scheduled'`, [e.id, s.id, at]);
    }
  }
}

/** Has this family paid for this programme (on any registration row)? */
async function hasPaid(programId: number | null, email: string): Promise<boolean> {
  if (!programId) return false;
  const r = await q(
    `SELECT 1 FROM ${REG_FROM}
      WHERE r.program_id = $1 AND r.status IN ${REAL_REGISTRATION_STATUS_SQL}
        AND (${REG_EMAIL} = $2 OR lower(btrim(c.email)) = $2 OR lower(btrim(g.email)) = $2) LIMIT 1`, [programId, email]);
  return r.length > 0;
}

async function processDue(deps: Deps) {
  // Claim up to 40 due emails. 'sending' is the claim; SKIP LOCKED means a
  // second machine that somehow got here takes different rows.
  const due = await q(
    `UPDATE mailer_automation_sends s SET status='sending', attempts = attempts + 1, updated_at = now()
      WHERE s.id IN (SELECT id FROM mailer_automation_sends WHERE status='scheduled' AND due_at <= now()
                      ORDER BY due_at LIMIT 40 FOR UPDATE SKIP LOCKED)
      RETURNING s.*`);
  const unsubCache = new Map<number, Set<string>>();
  // 🔴 In time order, and ONE email per family per minute. After a restart two
  // emails can both be due; the claim's RETURNING order is not the subquery's
  // ORDER BY, and the test on 2026-10-25 sent email 2 a second BEFORE email 1.
  due.sort((x, y) => new Date(x.due_at).getTime() - new Date(y.due_at).getTime() || Number(x.id) - Number(y.id));
  const sentThisTick = new Set<string>();
  for (const s of due) {
    if (sentThisTick.has(String(s.enrollment_id))) {
      await q(`UPDATE mailer_automation_sends SET status='scheduled', attempts = attempts - 1, due_at = now() + interval '1 minute', updated_at=now() WHERE id=$1`, [s.id]);
      continue;
    }
    sentThisTick.add(String(s.enrollment_id));
    const done = async (status: string, reason: string | null, extra: { to?: string; id?: string | null } = {}) => {
      await q(`UPDATE mailer_automation_sends SET status=$2, reason=$3, sent_to=$4, provider_id=$5,
                 sent_at = CASE WHEN $2='sent' THEN now() ELSE sent_at END, updated_at=now() WHERE id=$1`,
        [s.id, status, reason, extra.to ?? null, extra.id ?? null]);
    };
    try {
      const e = (await q(`SELECT * FROM mailer_automation_enrollments WHERE id=$1`, [s.enrollment_id]))[0];
      const a = e && (await q(`SELECT * FROM mailer_automations WHERE id=$1`, [e.automation_id]))[0];
      const step = (await q(`SELECT * FROM mailer_automation_steps WHERE id=$1`, [s.step_id]))[0];
      if (!e || !a || !step) { await done("cancelled", "The automation was removed"); continue; }
      // A "test family" run from the page follows the real timings to staff
      // inboxes whatever the switch says — that is how a flow is tried out
      // before any family is in it.
      const simulated = String(e.dedupe_key).startsWith("sim:");
      if (e.status !== "active") { await done("cancelled", "No longer in this automation"); continue; }
      if (a.archived_at) { await done("cancelled", "The automation was deleted"); continue; }
      if (!simulated && a.status === "off") { await done("cancelled", "Automation switched off"); continue; }
      if (step.deleted_at || !step.enabled) { await done("cancelled", "This email was switched off"); continue; }
      if (!simulated && (a.status === "test") !== !!e.test) { await done("cancelled", "Automation changed between Test and On"); continue; }

      // 🔴 Stop when they pay — checked at the last moment, every time.
      if (a.stop_on_payment && a.trigger_type === "registration_started" && await hasPaid(e.program_id, e.email)) {
        await done("cancelled", "They paid — the reminders stopped automatically");
        await q(`UPDATE mailer_automation_sends SET status='cancelled', reason='They paid — the reminders stopped automatically', updated_at=now()
                  WHERE enrollment_id=$1 AND status='scheduled'`, [e.id]);
        await q(`UPDATE mailer_automation_enrollments SET status='stopped', stop_reason='paid', finished_at=now() WHERE id=$1`, [e.id]);
        continue;
      }
      // A refunded registration does not get "how's it going?" emails.
      if (a.trigger_type !== "registration_started" && e.registration_id) {
        const reg = (await q(`SELECT status FROM registrations WHERE id=$1`, [e.registration_id]))[0];
        if (reg && (reg.status === "refunded" || reg.status === "cancelled")) {
          await done("skipped", "Their registration was refunded or cancelled");
          continue;
        }
      }
      if (a.email_kind === "marketing" && !e.test) {
        if (!unsubCache.has(a.organization_id)) unsubCache.set(a.organization_id, await deps.unsubscribed(a.organization_id));
        if (unsubCache.get(a.organization_id)!.has(String(e.email).toLowerCase())) { await done("skipped", "They've unsubscribed from club emails"); continue; }
      }
      // Quiet hours, re-checked at send time (a queue that backed up overnight
      // must not fire at 11pm).
      if (a.quiet_hours && !simulated) {
        const h = nzParts(new Date()).h;
        if (h >= 20 || h < 8) {
          const next = dueAt(new Date(), { timingUnit: "immediately", timingAmount: 0, timingDirection: "after", sendTime: null }, "registration_paid", true);
          await q(`UPDATE mailer_automation_sends SET status='scheduled', due_at=$2, updated_at=now() WHERE id=$1`, [s.id, next]);
          continue;
        }
      }
      if (!String(step.subject).trim() || visibleTextLength(String(step.body_html)) < 3) { await done("skipped", "This email has no subject or no words"); continue; }

      const recipients: string[] = simulated
        ? [String(e.email)]
        : e.test ? (a.test_emails ?? []) : [e.email];
      if (!recipients.length) { await done("skipped", "Test mode, but no test address is set"); continue; }
      let ok = false; let pid: string | null = null;
      for (const to of recipients) {
        const r = await deliver({ orgId: a.organization_id, deps, a, to, subject: step.subject, bodyHtml: step.body_html, ctx: e.context ?? {}, test: !!e.test });
        ok = ok || r.ok; pid = pid ?? r.id;
        await new Promise((r2) => setTimeout(r2, 150)); // Resend allows 10/s
      }
      if (ok) await done("sent", simulated ? "Test family — sent to you" : e.test ? `Test — sent to ${recipients.join(", ")} instead of ${e.email}` : null, { to: recipients.join(", "), id: pid });
      else if (s.attempts >= 3) await done("failed", "The email service refused it three times");
      else await q(`UPDATE mailer_automation_sends SET status='scheduled', due_at = now() + interval '10 minutes', reason='Retrying — the email service didn''t accept it', updated_at=now() WHERE id=$1`, [s.id]);
    } catch (err) {
      console.error("[mailer-automations] send", s.id, err);
      await q(`UPDATE mailer_automation_sends SET status='scheduled', due_at = now() + interval '10 minutes', updated_at=now() WHERE id=$1 AND attempts < 3`, [s.id]).catch(() => {});
      await q(`UPDATE mailer_automation_sends SET status='failed', reason='Something went wrong sending this', updated_at=now() WHERE id=$1 AND status='sending'`, [s.id]).catch(() => {});
    }
  }
  // Families with nothing left to send are finished.
  await q(
    `UPDATE mailer_automation_enrollments e SET status='completed', finished_at=now()
      WHERE e.status='active' AND NOT EXISTS (
        SELECT 1 FROM mailer_automation_sends s WHERE s.enrollment_id = e.id AND s.status IN ('scheduled','sending'))`);
}

let running = false;
export async function runAutomationsOnce(deps: Deps) {
  if (running) return;
  running = true;
  const client = await pool.connect();
  try {
    const got = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
    if (!got.rows[0]?.ok) return; // the other machine has it this minute
    try {
      // A send stuck in 'sending' for 10 minutes means a machine died mid-send:
      // put it back, and let the attempts counter decide.
      await q(`UPDATE mailer_automation_sends SET status='scheduled', updated_at=now()
                WHERE status='sending' AND updated_at < now() - interval '10 minutes' AND attempts < 3`);
      const autos = await q(
        `SELECT a.*, o.slug AS org_slug FROM mailer_automations a JOIN organizations o ON o.id = a.organization_id
          WHERE a.status IN ('test','on') AND a.archived_at IS NULL`);
      for (const a of autos) {
        try { await enrol(a, a.org_slug); } catch (e) { console.error("[mailer-automations] enrol", a.id, e); }
      }
      await processDue(deps);
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => {});
    }
  } catch (e) {
    console.error("[mailer-automations] tick", e);
  } finally {
    client.release();
    running = false;
  }
}

export function startMailerAutomations(deps: Deps) {
  if (process.env.MAILER_AUTOMATIONS === "0") {
    console.log("[mailer-automations] disabled by MAILER_AUTOMATIONS=0");
    return;
  }
  setTimeout(() => void runAutomationsOnce(deps), 45_000);
  setInterval(() => void runAutomationsOnce(deps), 60_000);
}

export { STARTER_FLOWS };
export { candidatesFor as _candidatesForVerify };
