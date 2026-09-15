/**
 * Form submissions, read live from the seventeen tables public forms write to.
 * Nothing is copied: a row in cufc_open_trainings IS the submission.
 */
import { eachDay } from "@shared/dashboard";
import { FORM_SOURCES, type FormSource, type FormsResponse } from "@shared/marketing-hub";
import { dateExprFor, dateKind, ident } from "../dashboard-routes";
import { hubSlugForOrg, nzBounds, periodOf, q, type HubScope } from "./common";

type CountRow = { org: number; day: string; n: number };

async function countsFor(form: FormSource, scope: HubScope): Promise<CountRow[]> {
  const kind = await dateKind(form.table, "created_at");
  const params: unknown[] = [scope.previous.from, scope.range.to, scope.orgIds];
  const conds = [nzBounds("t.created_at", kind, "$1", "$2"), "t.organization_id = ANY($3::int[])"];
  if (form.where) conds.push(`(${form.where})`);
  if (scope.programme) {
    if (form.programIdColumn) {
      params.push(scope.programme.id);
      conds.push(`t.${ident(form.programIdColumn)} = $${params.length}`);
    } else if (form.programSlugColumn) {
      params.push(scope.programme.slug);
      conds.push(`t.${ident(form.programSlugColumn)} = $${params.length}`);
    } else {
      // This form never records a programme, so it cannot be counted against one.
      return [];
    }
  }
  return q<CountRow>(
    `SELECT t.organization_id AS org, ${dateExprFor("created_at", kind)}::text AS day, count(*)::int AS n
     FROM ${ident(form.table)} t
     WHERE ${conds.join(" AND ")}
     GROUP BY 1, 2`,
    params,
  );
}

export type FormsSummary = {
  total: { current: number; previous: number };
  byOrg: Map<number, number>;
  series: Map<string, number>;
  perForm: { form: FormSource; org: number; current: number; previous: number }[];
};

export async function formsSummary(scope: HubScope): Promise<FormsSummary> {
  const results = await Promise.all(FORM_SOURCES.map(async (form) => ({ form, rows: await countsFor(form, scope) })));
  const out: FormsSummary = { total: { current: 0, previous: 0 }, byOrg: new Map(), series: new Map(), perForm: [] };
  for (const { form, rows } of results) {
    const byOrg = new Map<number, { current: number; previous: number }>();
    for (const r of rows) {
      const half = periodOf(r.day, scope);
      if (!half) continue;
      const cell = byOrg.get(r.org) ?? { current: 0, previous: 0 };
      cell[half] += r.n;
      byOrg.set(r.org, cell);
      out.total[half] += r.n;
      if (half === "current") {
        out.byOrg.set(r.org, (out.byOrg.get(r.org) ?? 0) + r.n);
        out.series.set(r.day, (out.series.get(r.day) ?? 0) + r.n);
      }
    }
    for (const [org, cell] of Array.from(byOrg.entries())) out.perForm.push({ form, org, ...cell });
  }
  return out;
}

async function byProgramme(scope: HubScope): Promise<FormsResponse["byProgramme"]> {
  if (scope.workspaceOrgId == null || scope.programme) return [];
  const aware = FORM_SOURCES.filter((f) => f.programIdColumn || f.programSlugColumn);
  const merged = new Map<number, { name: string; org: number; current: number; previous: number }>();
  await Promise.all(
    aware.map(async (form) => {
      const kind = await dateKind(form.table, "created_at");
      const join = form.programIdColumn
        ? `p.id = t.${ident(form.programIdColumn)}`
        : `p.slug = t.${ident(form.programSlugColumn!)} AND p.organization_id = t.organization_id`;
      const conds = [nzBounds("t.created_at", kind, "$1", "$2"), "t.organization_id = $3"];
      if (form.where) conds.push(`(${form.where})`);
      const rows = await q<{ id: number; name: string; org: number; day: string; n: number }>(
        `SELECT p.id, p.name, p.organization_id AS org, ${dateExprFor("created_at", kind)}::text AS day, count(*)::int AS n
         FROM ${ident(form.table)} t
         JOIN programs p ON ${join}
         WHERE ${conds.join(" AND ")}
         GROUP BY 1, 2, 3, 4`,
        [scope.previous.from, scope.range.to, scope.workspaceOrgId],
      );
      for (const r of rows) {
        const half = periodOf(r.day, scope);
        if (!half) continue;
        const cell = merged.get(r.id) ?? { name: r.name, org: r.org, current: 0, previous: 0 };
        cell[half] += r.n;
        merged.set(r.id, cell);
      }
    }),
  );
  const out: FormsResponse["byProgramme"] = [];
  for (const [programId, cell] of Array.from(merged.entries())) {
    out.push({
      programId,
      name: cell.name,
      workspace: await hubSlugForOrg(cell.org),
      current: cell.current,
      previous: cell.previous,
    });
  }
  return out.sort((a, b) => b.current - a.current);
}

async function guardVerdicts(scope: HubScope): Promise<FormsResponse["guard"]> {
  // The guard log has no workspace column, so it is only shown for the whole
  // organisation rather than guessed onto one workspace.
  if (scope.filter.workspace) return [];
  const rows = await q<{ form: string; outcome: string; n: number }>(
    `SELECT t.form, t.outcome, count(*)::int AS n
     FROM public_form_submissions t
     WHERE ${nzBounds("t.created_at", "timestamptz", "$1", "$2")}
     GROUP BY 1, 2`,
    [scope.range.from, scope.range.to],
  );
  const byForm = new Map<string, { accepted: number; held: number }>();
  for (const r of rows) {
    const cell = byForm.get(r.form) ?? { accepted: 0, held: 0 };
    if (r.outcome === "held") cell.held += r.n;
    else cell.accepted += r.n;
    byForm.set(r.form, cell);
  }
  return Array.from(byForm.entries()).map(([form, cell]) => ({
    form,
    label: FORM_SOURCES.find((f) => f.guardForm === form)?.label ?? form,
    ...cell,
  }));
}

export async function formsDetail(scope: HubScope): Promise<Omit<FormsResponse, "range" | "previousRange" | "filter">> {
  const [summary, programmes, guard] = await Promise.all([formsSummary(scope), byProgramme(scope), guardVerdicts(scope)]);

  const forms: FormsResponse["forms"] = [];
  for (const row of summary.perForm) {
    forms.push({
      key: row.form.key,
      label: row.form.label,
      workspace: await hubSlugForOrg(row.org),
      current: row.current,
      previous: row.previous,
      programmeAware: Boolean(row.form.programIdColumn || row.form.programSlugColumn),
    });
  }
  forms.sort((a, b) => b.current - a.current || b.previous - a.previous);

  const notes: string[] = [];
  if (scope.programme) {
    const unaware = FORM_SOURCES.filter((f) => !f.programIdColumn && !f.programSlugColumn).length;
    notes.push(
      `${unaware} of the ${FORM_SOURCES.length} forms don't record which programme a submission is for, so they aren't counted while a programme is selected.`,
    );
  }
  notes.push(
    "Every stored submission is counted. Only four forms run the spam guard, and it flags rather than deletes, so a held entry is still in these numbers.",
  );

  return {
    total: summary.total,
    forms,
    series: eachDay(scope.range).map((date) => ({ date, submissions: summary.series.get(date) ?? 0 })),
    byProgramme: programmes,
    guard,
    notes,
  };
}
