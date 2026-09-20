// The what-if engine. Pure functions over the model's tagged nodes — the same events as the P&L tabs, so a scenario is
// always "the real numbers with these levers applied", never a second model.
export interface FiNode {
  id: string; side: "income" | "expense"; account: string; accountName: string; label: string; group: string; brand: string;
  vals: Record<string, number>; funding?: boolean; outside?: boolean; sub?: string; programme?: string; person?: string; kind?: string;
}
export interface Model {
  generatedAt: string; months: string[]; sources: string; brands: string[]; incomeGroups: string[]; expenseGroups: string[]; ageOrder: string[];
  receivables: Record<string, number>; receivablesTotal: number; nodes: FiNode[]; dataThrough?: string;
}
/** A node's total over the months in view (the model handed to every view carries only the selected months). */
export const nodeTotal = (n: FiNode, months: string[]) => months.reduce((x, m) => x + (n.vals[m] ?? 0), 0);
export type Period = "all" | "ytd" | "q1" | "q2" | "q3" | "q4" | "h1" | "h2" | "custom";
export const PERIODS: [Period, string][] = [["all", "Full period"], ["ytd", "Year to date"], ["q1", "Q1"], ["q2", "Q2"], ["q3", "Q3"], ["q4", "Q4"], ["h1", "H1"], ["h2", "H2"], ["custom", "Custom"]];
/** The months a period covers, from the model's full month list (quarters/halves are calendar 2026; "all" includes Dec 2025). */
export function monthsFor(model: Model, p: Period, from?: string, to?: string): string[] {
  const M = model.months; const yr = M.filter((m) => m.startsWith("2026"));
  const q = (a: number, b: number) => yr.filter((m) => { const k = Number(m.slice(5)); return k >= a && k <= b; });
  if (p === "ytd") return M.filter((m) => m <= (model.dataThrough ?? M[M.length - 1]));
  if (p === "q1") return q(1, 3); if (p === "q2") return q(4, 6); if (p === "q3") return q(7, 9); if (p === "q4") return q(10, 12);
  if (p === "h1") return q(1, 6); if (p === "h2") return q(7, 12);
  if (p === "custom" && from && to) return M.filter((m) => m >= from && m <= to);
  return M;
}
/** The same model, narrowed to a window of months — every view computes from this. */
export const narrow = (model: Model, months: string[]): Model => ({ ...model, months });
export interface Scenario {
  offBrands: string[]; offPeople: string[]; offProgrammes: string[]; offGroups: string[]; offNodes: string[];
  pctGroup: Record<string, number>;       // % change applied to every node in a group (income or expense)
  pctProgramme: Record<string, number>;   // % price change on a programme / age group's fee income
  pctPerson: Record<string, number>;      // % change to one person's cost
  includeOutside: boolean;                // count the costs Slava paid outside the club in the gap
}
export const EMPTY: Scenario = { offBrands: [], offPeople: [], offProgrammes: [], offGroups: [], offNodes: [], pctGroup: {}, pctProgramme: {}, pctPerson: {}, includeOutside: true };

export function factor(n: FiNode, s: Scenario): number {
  if (s.offNodes.includes(n.id)) return 0;
  if (s.offBrands.includes(n.brand)) return 0;
  if (n.person && s.offPeople.includes(n.person)) return 0;
  if (n.programme && s.offProgrammes.includes(n.programme)) return 0;
  if (s.offGroups.includes(n.group)) return 0;
  if (n.outside && !s.includeOutside) return 0;
  let f = 1;
  if (s.pctGroup[n.group]) f *= 1 + s.pctGroup[n.group] / 100;
  if (n.programme && s.pctProgramme[n.programme]) f *= 1 + s.pctProgramme[n.programme] / 100;
  if (n.person && s.pctPerson[n.person]) f *= 1 + s.pctPerson[n.person] / 100;
  return f;
}
export interface Totals { own: number[]; funding: number[]; expenses: number[]; outside: number[]; gapThrough: number[]; gapOutside: number[]; gap: number[]; net: number[]; }
const zero = (m: string[]) => m.map(() => 0);
export function totals(model: Model, s: Scenario): Totals {
  const M = model.months; const t: Totals = { own: zero(M), funding: zero(M), expenses: zero(M), outside: zero(M), gapThrough: zero(M), gapOutside: zero(M), gap: zero(M), net: zero(M) };
  for (const n of model.nodes) {
    const f = factor(n, s); if (!f) continue;
    M.forEach((m, i) => {
      const v = (n.vals[m] ?? 0) * f;
      if (n.side === "income") { if (n.funding) t.funding[i] += v; else t.own[i] += v; }
      else if (n.outside) t.outside[i] += v; else t.expenses[i] += v;
    });
  }
  // net = the gap, plus the donations through the club, plus what Slava paid outside (those costs were his money) — the P&L's NET
  M.forEach((_, i) => { t.gapThrough[i] = t.own[i] - t.expenses[i]; t.gapOutside[i] = -t.outside[i]; t.gap[i] = t.gapThrough[i] + t.gapOutside[i]; t.net[i] = t.gap[i] + t.funding[i] + t.outside[i]; });
  return t;
}
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export function byKey(model: Model, s: Scenario, key: (n: FiNode) => string, filter: (n: FiNode) => boolean): { key: string; base: number; scen: number; nodes: FiNode[] }[] {
  const acc = new Map<string, { base: number; scen: number; nodes: FiNode[] }>();
  for (const n of model.nodes) {
    if (!filter(n)) continue;
    const k = key(n); const e = acc.get(k) ?? { base: 0, scen: 0, nodes: [] };
    const b = nodeTotal(n, model.months); e.base += b; e.scen += b * factor(n, s); e.nodes.push(n); acc.set(k, e);
  }
  return Array.from(acc.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => Math.abs(b.base) - Math.abs(a.base));
}
export function describe(model: Model, s: Scenario): string[] {
  const out: string[] = [];
  for (const b of s.offBrands) out.push(`${b} removed (its income and its costs)`);
  for (const p of s.offProgrammes) out.push(`${p} removed`);
  for (const p of s.offPeople) out.push(`${p} removed`);
  for (const g of s.offGroups) out.push(`${g} removed`);
  for (const [g, v] of Object.entries(s.pctGroup)) if (v) out.push(`${g} ${v > 0 ? "+" : ""}${v}%`);
  for (const [p, v] of Object.entries(s.pctProgramme)) if (v) out.push(`${p} fees ${v > 0 ? "+" : ""}${v}%`);
  for (const [p, v] of Object.entries(s.pctPerson)) if (v) out.push(`${p} ${v > 0 ? "+" : ""}${v}%`);
  if (!s.includeOutside) out.push("costs paid outside the club excluded");
  for (const id of s.offNodes) { const n = model.nodes.find((x) => x.id === id); if (n) out.push(`${n.label} removed`); }
  return out;
}
export const fmt = (v: number, dp = 0) => (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-NZ", { maximumFractionDigits: dp, minimumFractionDigits: dp });
export const MON: Record<string, string> = { "2025-12": "Dec", "2026-01": "Jan", "2026-02": "Feb", "2026-03": "Mar", "2026-04": "Apr", "2026-05": "May", "2026-06": "Jun", "2026-07": "Jul", "2026-08": "Aug", "2026-09": "Sep", "2026-10": "Oct", "2026-11": "Nov", "2026-12": "Dec" };
export function summaryForAI(model: Model, s: Scenario): string {
  const t = totals(model, s); const b = totals(model, EMPTY); const M = model.months;
  const line = (lab: string, a: number[]) => `${lab}: total ${fmt(sum(a))} · by month ${M.map((m, i) => `${MON[m]} ${fmt(a[i])}`).join(", ")}`;
  const levers = describe(model, s); const groups = (side: "income" | "expense") => byKey(model, s, (n) => n.group, (n) => n.side === side).map((g) => `  ${g.key}: baseline ${fmt(g.base)} → scenario ${fmt(g.scen)}`).join("\n");
  const brands = byKey(model, s, (n) => n.brand, () => true).map((g) => { const inc = g.nodes.filter((n) => n.side === "income").reduce((x, n) => x + nodeTotal(n, model.months) * factor(n, s), 0); const exp = g.nodes.filter((n) => n.side === "expense").reduce((x, n) => x + nodeTotal(n, model.months) * factor(n, s), 0); return `  ${g.key}: income ${fmt(inc)} · costs ${fmt(exp)} · net ${fmt(inc - exp)}`; }).join("\n");
  return [`Period ${MON[M[0]] ?? M[0]} ${M[0].slice(0, 4)} – ${MON[M[M.length - 1]] ?? M[M.length - 1]} ${M[M.length - 1].slice(0, 4)} (${M.length} months; data through ${model.dataThrough ?? "?"}). Cash basis. Currency NZD.`, `LEVERS APPLIED: ${levers.length ? levers.join("; ") : "none (baseline)"}`,
    `BASELINE — own income ${fmt(sum(b.own))} · donations & owner funding ${fmt(sum(b.funding))} · expenses through the club ${fmt(sum(b.expenses))} · paid outside ${fmt(sum(b.outside))} · GAP through ${fmt(sum(b.gapThrough))} · GAP outside ${fmt(sum(b.gapOutside))} · TOTAL GAP ${fmt(sum(b.gap))} · net after donations and outside cover ${fmt(sum(b.net))}`,
    `SCENARIO`, line("own income", t.own), line("donations & owner funding", t.funding), line("expenses through the club", t.expenses), line("paid outside the club", t.outside), line("GAP through the club", t.gapThrough), line("GAP outside", t.gapOutside), line("TOTAL GAP", t.gap), line("net after donations and what Slava paid outside", t.net),
    `INCOME BY GROUP\n${groups("income")}`, `EXPENSES BY GROUP\n${groups("expense")}`, `BY STREAM / BRAND (scenario)\n${brands}`, `RECEIVABLES (invoiced, unpaid): ${fmt(model.receivablesTotal)}`].join("\n");
}
