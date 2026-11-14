/**
 * SIU Performance Hub — check-in FORMS: the editable form, the player's daily
 * check-in, staff "enter for athlete", the Smartabase-style report and saved
 * reports. Every rule about a form lives in shared/perf-forms.ts.
 *
 *  🔴 Same gates as the rest of the hub (performance-routes.ts passes them in):
 *     staff routes are SIU-workspace + performance-tab only, 404 otherwise; the
 *     player routes need the player's own cookie.
 *  🔴 The server decides the date (NZ) and checks every answer against the form.
 *  🔴 A TEST response ("Try the player app") has no player, is never on the
 *     board and never feeds the load engine.
 *  🔴 A question that has answers is HIDDEN, never deleted — a save that drops
 *     one is refused with the reason.
 */
import type { Express, Request, Response } from "express";
import {
  AnswerError, FORM_TEMPLATES, allQuestions, formFlag, formLoad, formProblem, validateAnswers,
  type Answers, type FormDef,
} from "@shared/perf-forms";
import { addDays, isIsoDate, nzToday, sessionLoad } from "@shared/performance";
import { pool } from "./db";

type Row = Record<string, any>;
const q = async <T = Row>(text: string, params: unknown[] = []): Promise<T[]> => (await pool.query(text, params)).rows as T[];
const one = async <T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> => (await q<T>(text, params))[0];
const isoOf = (d: unknown): string | null => {
  if (d == null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const x = d as Date;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export interface FormDeps {
  gate: readonly any[];
  viewer: (req: Request) => { userId: number; medical: boolean; org: number };
  roster: (org: number) => Promise<{ contactId: number; name: string; firstName: string | null; position: string | null; squadNumber: number | null }[]>;
  onRoster: (org: number, contactId: number) => Promise<boolean>;
  requireAthlete: any;
  athleteOf: (req: Request) => { contactId: number; org: number; firstName: string | null; lastName: string | null };
  siuOrg: () => Promise<number>;
  handle: (fn: (req: Request, res: Response) => Promise<unknown>) => any;
}

const BASE = "/api/admin/performance";
const PUB = "/api/public/athlete";

// ── reading forms ────────────────────────────────────────────────────────────
interface FormRow { id: number; key: string; title: string; definition: FormDef; version: number; is_daily: boolean; template_key: string | null; updated_at: Date; updated_by: number | null }

export async function dailyForm(org: number): Promise<FormRow | undefined> {
  return one<FormRow>(`select * from perf_forms where organization_id = $1 and is_daily and archived_at is null`, [org]);
}
async function formById(org: number, id: number) {
  return one<FormRow>(`select * from perf_forms where organization_id = $1 and id = $2 and archived_at is null`, [org, id]);
}
/** The definition a response was answered on (old versions are kept). */
async function definitionAt(formId: number, version: number, fallback: FormDef): Promise<FormDef> {
  const r = await one(`select definition from perf_form_versions where form_id = $1 and version = $2`, [formId, version]);
  return (r?.definition as FormDef) ?? fallback;
}

/** Today's check-ins on the daily form, for the board's readiness light. */
export async function todaysCheckIns(org: number, ids: number[], date: string) {
  const form = await dailyForm(org);
  if (!form || !ids.length) return { form: form ?? null, byContact: new Map<number, Row>() };
  const rows = await q(`select * from perf_form_responses where form_id = $1 and not is_test and contact_id = any($2::int[]) and entry_date = $3`, [form.id, ids, date]);
  return { form, byContact: new Map(rows.map((r) => [r.contact_id as number, r])) };
}

// ── writing a response ───────────────────────────────────────────────────────
async function saveResponse(p: {
  org: number; form: FormRow; contactId: number | null; date: string; answers: Answers;
  enteredBy: number | null; byAthlete: boolean; isTest: boolean;
}): Promise<{ id: number; flag: ReturnType<typeof formFlag> }> {
  const flag = formFlag(p.form.definition, p.answers);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let id: number;
    if (p.isTest) {
      // A test is one per staff member per day: the newest replaces the last.
      await client.query(`delete from perf_form_responses where form_id = $1 and is_test and entered_by = $2 and entry_date = $3`, [p.form.id, p.enteredBy, p.date]);
      const r = await client.query(`
        insert into perf_form_responses (organization_id, form_id, form_version, contact_id, entry_date, answers, flag_level, flag_reasons, entered_by, entered_by_athlete, is_test)
        values ($1,$2,$3,null,$4,$5,$6,$7,$8,false,true) returning id`,
        [p.org, p.form.id, p.form.version, p.date, JSON.stringify(p.answers), flag.level, flag.reasons, p.enteredBy]);
      id = r.rows[0].id;
    } else {
      const r = await client.query(`
        insert into perf_form_responses (organization_id, form_id, form_version, contact_id, entry_date, answers, flag_level, flag_reasons, entered_by, entered_by_athlete, is_test)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)
        on conflict (form_id, contact_id, entry_date) where not is_test do update set
          form_version = excluded.form_version, answers = excluded.answers, flag_level = excluded.flag_level, flag_reasons = excluded.flag_reasons,
          entered_by = excluded.entered_by, entered_by_athlete = excluded.entered_by_athlete, updated_at = now()
        returning id`,
        [p.org, p.form.id, p.form.version, p.contactId, p.date, JSON.stringify(p.answers), flag.level, flag.reasons, p.enteredBy, p.byAthlete]);
      id = r.rows[0].id;
      // The session it reported feeds the load engine (ACWR); an edit takes the old one back out.
      await client.query(`delete from perf_rpe where form_response_id = $1`, [id]);
      const load = formLoad(p.form.definition, p.answers, p.date);
      if (load) {
        await client.query(`
          insert into perf_rpe (organization_id, contact_id, date, kind, rpe, minutes, note, entered_by, entered_by_athlete, form_response_id)
          values ($1,$2,$3,$4,$5,$6,'From the daily check-in',$7,$8,$9)
          on conflict (contact_id, date, kind) do update set rpe = excluded.rpe, minutes = excluded.minutes, note = excluded.note,
            entered_by = excluded.entered_by, entered_by_athlete = excluded.entered_by_athlete, form_response_id = excluded.form_response_id, entered_at = now()`,
          [p.org, p.contactId, load.date, load.kind, load.rpe, load.minutes, p.enteredBy, p.byAthlete, id]);
      }
    }
    await client.query("COMMIT");
    return { id, flag };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}

function parseAnswers(form: FormDef, raw: unknown, res: Response): Answers | null {
  try { return validateAnswers(form, raw); }
  catch (e) {
    if (e instanceof AnswerError) { res.status(400).json({ message: e.message, questionId: e.questionId }); return null; }
    throw e;
  }
}

/** Question ids that hold at least one answer — these can be hidden, never removed. */
async function answeredIds(formId: number): Promise<Set<string>> {
  const r = await q(`select distinct jsonb_object_keys(answers) k from perf_form_responses where form_id = $1 and not is_test`, [formId]);
  return new Set(r.map((x) => x.k as string));
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerPerformanceFormRoutes(app: Express, d: FormDeps) {
  const { gate, viewer, roster, onRoster, requireAthlete, athleteOf, handle } = d;

  // ── forms ──────────────────────────────────────────────────────────────────
  app.get(`${BASE}/forms`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const rows = await q(`
      select f.id, f.key, f.title, f.version, f.is_daily, f.template_key, f.updated_at, u.first_name, u.last_name,
        (select count(*)::int from perf_form_responses r where r.form_id = f.id and not r.is_test) responses
      from perf_forms f left join users u on u.id = f.updated_by
      where f.organization_id = $1 and f.archived_at is null order by f.is_daily desc, f.title`, [v.org]);
    res.json({
      forms: rows.map((r) => ({ id: r.id, key: r.key, title: r.title, version: r.version, isDaily: r.is_daily, templateKey: r.template_key,
        updatedAt: r.updated_at, updatedBy: [r.first_name, r.last_name].filter(Boolean).join(" ") || null, responses: r.responses })),
      templates: FORM_TEMPLATES.map((t) => ({ key: t.key, title: t.title })),
    });
  }));

  app.get(`${BASE}/forms/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const f = await formById(v.org, Number(req.params.id));
    if (!f) return res.status(404).json({ message: "Not found" });
    res.json({ id: f.id, key: f.key, title: f.title, version: f.version, isDaily: f.is_daily, templateKey: f.template_key,
      definition: f.definition, answered: Array.from(await answeredIds(f.id)) });
  }));

  app.patch(`${BASE}/forms/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const f = await formById(v.org, Number(req.params.id));
    if (!f) return res.status(404).json({ message: "Not found" });
    const next = req.body?.definition as FormDef;
    const bad = formProblem(next);
    if (bad) return res.status(400).json({ message: bad });
    if (Number(req.body?.version) !== f.version) return res.status(409).json({ message: "Someone else saved this form since you opened it. Reload to see their changes." });
    const kept = new Set(allQuestions(next).map((x) => x.id));
    const lost = Array.from(await answeredIds(f.id)).filter((id) => !kept.has(id) && allQuestions(f.definition).some((x) => x.id === id));
    if (lost.length) {
      const names = lost.map((id) => allQuestions(f.definition).find((x) => x.id === id)?.label ?? id);
      return res.status(409).json({ message: `Players have already answered ${names.map((n) => `"${n}"`).join(", ")}. Hide it instead of deleting it, so their answers stay.` });
    }
    const def: FormDef = { ...next, key: f.key };
    const version = f.version + 1;
    await pool.query(`update perf_forms set definition = $1, title = $2, version = $3, updated_by = $4, updated_at = now() where id = $5`,
      [JSON.stringify(def), def.title.trim(), version, v.userId, f.id]);
    await pool.query(`insert into perf_form_versions (form_id, version, definition, saved_by) values ($1,$2,$3,$4)`, [f.id, version, JSON.stringify(def), v.userId]);
    res.json({ ok: true, version });
  }));

  /** Back to Rowan's template. Questions staff added are kept, hidden, at the end — never lost. */
  app.post(`${BASE}/forms/:id/reset`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const f = await formById(v.org, Number(req.params.id));
    if (!f) return res.status(404).json({ message: "Not found" });
    const tpl = FORM_TEMPLATES.find((t) => t.key === (f.template_key ?? f.key));
    if (!tpl) return res.status(400).json({ message: "This form wasn't made from a template." });
    const tplIds = new Set(allQuestions(tpl).map((x) => x.id));
    const extras = allQuestions(f.definition).filter((x) => !tplIds.has(x.id)).map((x) => ({ ...x, hidden: true, showIf: undefined }));
    const def: FormDef = JSON.parse(JSON.stringify(tpl));
    if (extras.length) def.sections.push({ id: "kept", title: "Kept from earlier (hidden)", questions: extras });
    const version = f.version + 1;
    await pool.query(`update perf_forms set definition = $1, title = $2, version = $3, updated_by = $4, updated_at = now() where id = $5`,
      [JSON.stringify(def), def.title, version, v.userId, f.id]);
    await pool.query(`insert into perf_form_versions (form_id, version, definition, saved_by) values ($1,$2,$3,$4)`, [f.id, version, JSON.stringify(def), v.userId]);
    res.json({ ok: true, version });
  }));

  // ── the report (Rowan's Smartabase report, rebuilt) ────────────────────────
  app.get(`${BASE}/checkins`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const today = nzToday();
    const form = req.query.formId ? await formById(v.org, Number(req.query.formId)) : await dailyForm(v.org);
    if (!form) return res.json({ form: null, rows: [], missing: [], today });
    // A RELATIVE range ("today", "7d") is what a saved report keeps, so tomorrow's click shows tomorrow.
    const range = String(req.query.range ?? "");
    let to = isIsoDate(req.query.to) ? (req.query.to as string) : today;
    let from = isIsoDate(req.query.from) ? (req.query.from as string) : to;
    if (range === "today") { from = to = today; }
    else if (range === "yesterday") { from = to = addDays(today, -1); }
    else if (range === "7d") { to = today; from = addDays(today, -6); }
    else if (range === "28d") { to = today; from = addDays(today, -27); }
    if (from > to) return res.status(400).json({ message: "The start date is after the end date." });
    const mostRecent = req.query.mostRecent !== "0";
    const withTests = req.query.tests === "1";
    const players = await roster(v.org);
    const byId = new Map(players.map((p) => [p.contactId, p]));
    const rows = await q(`
      select r.*, u.first_name ufn, u.last_name uln from perf_form_responses r left join users u on u.id = r.entered_by
      where r.form_id = $1 and r.entry_date between $2 and $3 and ($4 or not r.is_test)
      order by r.entry_date desc, r.updated_at desc`, [form.id, from, to, withTests]);
    const ids = players.map((p) => p.contactId);
    // Week figures, Rowan's "Entries Per Week" and "Football Total Load": the 7 days ending on the row's date.
    const [week, loads] = await Promise.all([
      ids.length ? q(`select contact_id, entry_date from perf_form_responses where form_id = $1 and not is_test and contact_id = any($2::int[]) and entry_date between $3 and $4`, [form.id, ids, addDays(from, -6), to]) : [],
      ids.length ? q(`select contact_id, date, rpe, minutes from perf_rpe where organization_id = $1 and contact_id = any($2::int[]) and date between $3 and $4`, [v.org, ids, addDays(from, -7), to]) : [],
    ]);
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of rows) {
      const date = isoOf(r.entry_date)!;
      if (!r.is_test && !byId.has(r.contact_id)) continue;          // left the squad
      const k = r.is_test ? `t${r.id}` : `${r.contact_id}`;
      if (mostRecent) { if (seen.has(k)) continue; seen.add(k); }
      const p = r.contact_id ? byId.get(r.contact_id) : null;
      const wkFrom = addDays(date, -6);
      out.push({
        id: r.id, contactId: r.contact_id, name: r.is_test ? "Test entry" : p!.name, position: p?.position ?? null, squadNumber: p?.squadNumber ?? null,
        date, answers: r.answers, flag: r.flag_level, reasons: r.flag_reasons ?? [], isTest: r.is_test,
        enteredBy: r.entered_by_athlete ? "Player" : [r.ufn, r.uln].filter(Boolean).join(" ") || "Staff", updatedAt: r.updated_at,
        entriesThisWeek: r.is_test ? null : week.filter((w) => w.contact_id === r.contact_id && isoOf(w.entry_date)! >= wkFrom && isoOf(w.entry_date)! <= date).length,
        loadThisWeek: r.is_test ? null : loads.filter((l) => l.contact_id === r.contact_id && isoOf(l.date)! >= addDays(date, -7) && isoOf(l.date)! <= date)
          .reduce((s, l) => s + (sessionLoad({ date: "", rpe: l.rpe, minutes: l.minutes }) ?? 0), 0),
      });
    }
    const answered = new Set(out.filter((r) => !r.isTest).map((r) => r.contactId));
    res.json({
      today, from, to,
      form: { id: form.id, title: form.title, version: form.version, definition: form.definition },
      rows: out,
      missing: players.filter((p) => !answered.has(p.contactId)).map((p) => ({ contactId: p.contactId, name: p.name, position: p.position, squadNumber: p.squadNumber })),
    });
  }));

  app.get(`${BASE}/checkins/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const r = await one(`select r.*, f.definition fdef from perf_form_responses r join perf_forms f on f.id = r.form_id where r.organization_id = $1 and r.id = $2`, [v.org, Number(req.params.id)]);
    if (!r) return res.status(404).json({ message: "Not found" });
    if (r.contact_id && !(await onRoster(v.org, r.contact_id))) return res.status(404).json({ message: "Not found" });
    res.json({ id: r.id, contactId: r.contact_id, date: isoOf(r.entry_date), answers: r.answers, flag: r.flag_level, reasons: r.flag_reasons, isTest: r.is_test,
      definition: await definitionAt(r.form_id, r.form_version, r.fdef) });
  }));

  /** Staff enter a check-in for a player ("Enter data for athlete"), or a TEST one ("Try the player app"). */
  app.post(`${BASE}/checkins`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const form = req.body?.formId ? await formById(v.org, Number(req.body.formId)) : await dailyForm(v.org);
    if (!form) return res.status(404).json({ message: "There is no check-in form yet." });
    const today = nzToday();
    const date = isIsoDate(req.body?.date) ? req.body.date : today;
    if (date > today) return res.status(400).json({ message: "That date hasn't happened yet." });
    const isTest = req.body?.test === true;
    const contactId = isTest ? null : Number(req.body?.contactId);
    if (!isTest && !(Number.isInteger(contactId) && (await onRoster(v.org, contactId!)))) return res.status(404).json({ message: "That player is not on the squad." });
    const answers = parseAnswers(form.definition, req.body?.answers, res);
    if (!answers) return;
    const r = await saveResponse({ org: v.org, form, contactId, date: isTest ? today : date, answers, enteredBy: v.userId, byAthlete: false, isTest });
    res.json({ ok: true, id: r.id, flag: r.flag.level, reasons: r.flag.reasons });
  }));

  /** Only test entries can be deleted — a player's real answer is a record. */
  app.delete(`${BASE}/checkins/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const r = await pool.query(`delete from perf_form_responses where organization_id = $1 and id = $2 and is_test`, [v.org, Number(req.params.id)]);
    if (!r.rowCount) return res.status(404).json({ message: "Only test entries can be deleted." });
    res.json({ ok: true });
  }));

  // ── saved reports (per person) ─────────────────────────────────────────────
  app.get(`${BASE}/reports`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const rows = await q(`select id, name, config, updated_at from perf_saved_reports where organization_id = $1 and user_id = $2 order by name`, [v.org, v.userId]);
    res.json({ reports: rows });
  }));
  app.post(`${BASE}/reports`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    const name = String(req.body?.name ?? "").trim().slice(0, 80);
    const config = req.body?.config;
    if (!name) return res.status(400).json({ message: "Give the report a name." });
    if (!config || typeof config !== "object" || JSON.stringify(config).length > 20_000) return res.status(400).json({ message: "That report setup doesn't look right." });
    const r = await one(`
      insert into perf_saved_reports (organization_id, user_id, name, config) values ($1,$2,$3,$4)
      on conflict (user_id, name) do update set config = excluded.config, updated_at = now() returning id`, [v.org, v.userId, name, JSON.stringify(config)]);
    res.json({ ok: true, id: r!.id });
  }));
  app.delete(`${BASE}/reports/:id`, ...gate, handle(async (req, res) => {
    const v = viewer(req);
    await pool.query(`delete from perf_saved_reports where id = $1 and user_id = $2 and organization_id = $3`, [Number(req.params.id), v.userId, v.org]);
    res.json({ ok: true });
  }));

  // ── the player ─────────────────────────────────────────────────────────────
  app.get(`${PUB}/form`, requireAthlete, async (req, res) => {
    try {
      const a = athleteOf(req);
      const form = await dailyForm(a.org);
      if (!form) return res.json({ form: null });
      const today = nzToday();
      const rows = await q(`select entry_date, answers, flag_level from perf_form_responses where form_id = $1 and contact_id = $2 and not is_test and entry_date >= $3 order by entry_date desc`,
        [form.id, a.contactId, addDays(today, -27)]);
      res.json({
        today, form: { id: form.id, version: form.version, definition: form.definition },
        todays: rows.find((r) => isoOf(r.entry_date) === today)?.answers ?? null,
        history: rows.map((r) => ({ date: isoOf(r.entry_date), answers: r.answers })),
      });
    } catch (e) { console.error("[athlete] form", e); res.status(500).json({ message: "Could not load your check-in." }); }
  });

  app.post(`${PUB}/checkin`, requireAthlete, async (req, res) => {
    try {
      const a = athleteOf(req);
      const form = await dailyForm(a.org);
      if (!form) return res.status(404).json({ message: "There is no check-in today." });
      const answers = parseAnswers(form.definition, req.body?.answers, res);
      if (!answers) return;
      // 🔴 Today only, by the server's NZ clock.
      await saveResponse({ org: a.org, form, contactId: a.contactId, date: nzToday(), answers, enteredBy: null, byAthlete: true, isTest: false });
      res.json({ ok: true });
    } catch (e) { console.error("[athlete] checkin", e); res.status(500).json({ message: "Could not save. Try again." }); }
  });

  /**
   * The no-login DEMO (join.southislandunited.com/athlete?demo=1): the form's
   * wording only — no player, no answers, nothing saved. Question wording is
   * not private; everything a player has said is.
   */
  app.get(`${PUB}/demo-form`, async (_req, res) => {
    try {
      const form = await dailyForm(await d.siuOrg());
      res.setHeader("Cache-Control", "no-store");
      res.json({ today: nzToday(), form: form ? { id: form.id, version: form.version, definition: form.definition } : null });
    } catch (e) { console.error("[athlete] demo", e); res.status(500).json({ message: "Could not load the demo." }); }
  });
}
