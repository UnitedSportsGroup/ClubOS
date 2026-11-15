/**
 * One importer for every source's CSV — Catapult One, a WHOOP export, a VALD
 * export, Wyscout's match sheet, a testing spreadsheet. Pure, so the browser
 * preview and the server save read the file exactly the same way.
 *
 * 🔴 A header becomes a metric only on an EXACT alias match (shared/performance
 *    METRICS). Anything else is listed as ignored, where staff can map it by
 *    hand — never guessed.
 * 🔴 A blank cell is NO reading. "0" is a reading of zero.
 * 🔴 Dates are read NZ-style (day/month/year). A date that can only be
 *    month/day (13+ in the second place) is read that way and flagged.
 */
import { isIsoDate, metricForHeader, metricByKey, normaliseHeader } from "./performance";

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF, a BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const out: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  return out;
}

const PLAYER_HEADERS = ["player", "player name", "name", "athlete", "athlete name", "full name", "email", "player email"];
const DATE_HEADERS = ["date", "session date", "start date", "match date", "test date", "day", "cycle start date"];
const SESSION_HEADERS = ["session", "session name", "activity", "activity name", "match", "title"];
const SPLIT_HEADERS = ["drill", "drill name", "period", "period name", "split"];

/** A number as a person typed it: "7,612" → 7612, "31.2 km/h" → 31.2, "" → null. */
export function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t || t === "-" || t === "—" || /^n\/?a$/i.test(t)) return null;
  const n = Number(t.replace(/,(?=\d{3}\b)/g, "").replace(/[^\d.\-eE]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** yyyy-mm-dd from "2026-10-13", "13/10/2026", "13-10-26", "2026/10/13 18:00". */
export function parseDate(raw: string): { iso: string | null; monthFirst: boolean } {
  const t = raw.trim().split(/[ T]/)[0];
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return { iso: isIsoDate(iso) ? iso : null, monthFirst: false };
  }
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let [a, b, y] = [Number(m[1]), Number(m[2]), m[3]];
    if (y.length === 2) y = `20${y}`;
    let monthFirst = false;
    if (b > 12 && a <= 12) { [a, b] = [b, a]; monthFirst = true; }
    const iso = `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    return { iso: isIsoDate(iso) ? iso : null, monthFirst };
  }
  return { iso: null, monthFirst: false };
}

export interface ImportPlanRow {
  line: number;
  player: string;
  date: string | null;
  session: string | null;
  values: Record<string, number>;
  /** Cells that were not blank but did not read as a number. */
  unreadable: string[];
}

export interface ImportPlan {
  headers: string[];
  playerColumn: number | null;
  dateColumn: number | null;
  sessionColumn: number | null;
  mapped: { column: number; header: string; metric: string }[];
  ignored: string[];
  rows: ImportPlanRow[];
  problems: string[];
  warnings: string[];
}

/**
 * Work out what a file means before anything is saved.
 * `mapping` lets staff map an ignored header to a metric by hand (header → key, or "" to ignore).
 */
export function planImport(
  table: string[][],
  opts: { source: string; fallbackDate: string | null; mapping?: Record<string, string> },
): ImportPlan {
  const plan: ImportPlan = {
    headers: [], playerColumn: null, dateColumn: null, sessionColumn: null,
    mapped: [], ignored: [], rows: [], problems: [], warnings: [],
  };
  if (table.length < 2) { plan.problems.push("The file has no rows under its header."); return plan; }
  const headers = table[0].map((h) => h.trim());
  plan.headers = headers;
  const find = (names: string[]) => {
    const i = headers.findIndex((h) => names.includes(normaliseHeader(h)));
    return i < 0 ? null : i;
  };
  plan.playerColumn = find(PLAYER_HEADERS);
  plan.dateColumn = find(DATE_HEADERS);
  plan.sessionColumn = find(SESSION_HEADERS);
  const splitColumn = find(SPLIT_HEADERS);

  headers.forEach((h, i) => {
    if (i === plan.playerColumn || i === plan.dateColumn || i === plan.sessionColumn || i === splitColumn) return;
    const manual = opts.mapping?.[h];
    const metric = manual !== undefined ? (manual ? metricByKey(manual) : null) : metricForHeader(h);
    if (metric) plan.mapped.push({ column: i, header: h, metric: metric.key });
    else if (h) plan.ignored.push(h);
  });
  // Two columns mapped to one metric would write one over the other.
  const seen = new Map<string, string>();
  for (const m of plan.mapped) {
    const prev = seen.get(m.metric);
    if (prev) plan.problems.push(`"${prev}" and "${m.header}" both mean ${metricByKey(m.metric)?.label}. Ignore one of them.`);
    seen.set(m.metric, m.header);
  }

  if (plan.playerColumn == null) plan.problems.push(`No player column. Expected one called "Player", "Name" or "Athlete". Found: ${headers.join(", ")}.`);
  if (!plan.mapped.length) plan.problems.push(`No column matched a known measure. Found: ${headers.join(", ")}. Map one by hand or check this is the session summary export.`);
  if (plan.dateColumn == null && !opts.fallbackDate) plan.problems.push("The file carries no date. Choose the session date before saving.");
  if (splitColumn != null) {
    const kinds = new Set(table.slice(1).map((r) => (r[splitColumn] ?? "").trim()).filter(Boolean));
    if (kinds.size > 1) plan.problems.push(`This file has one row per ${headers[splitColumn].toLowerCase()} (${kinds.size} of them). Export the session totals instead, or every drill counts as extra load.`);
  }

  let monthFirst = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const player = plan.playerColumn != null ? (cells[plan.playerColumn] ?? "").trim() : "";
    if (!player) continue;
    let date: string | null = opts.fallbackDate;
    if (plan.dateColumn != null) {
      const d = parseDate(cells[plan.dateColumn] ?? "");
      date = d.iso ?? opts.fallbackDate;
      if (d.monthFirst) monthFirst++;
      if (!d.iso && (cells[plan.dateColumn] ?? "").trim()) plan.warnings.push(`Line ${r + 1}: "${cells[plan.dateColumn]}" is not a date.`);
    }
    const values: Record<string, number> = {};
    const unreadable: string[] = [];
    for (const m of plan.mapped) {
      const raw = cells[m.column] ?? "";
      const n = parseNumber(raw);
      if (n != null) values[m.metric] = n;
      else if (raw.trim()) unreadable.push(m.header);
    }
    if (unreadable.length) plan.warnings.push(`Line ${r + 1} (${player}): ${unreadable.join(", ")} could not be read — left blank.`);
    plan.rows.push({
      line: r + 1, player, date,
      session: plan.sessionColumn != null ? ((cells[plan.sessionColumn] ?? "").trim() || null) : null,
      values, unreadable,
    });
  }
  if (monthFirst) plan.warnings.push(`${monthFirst} date${monthFirst === 1 ? "" : "s"} could only be month/day — read that way. Check them.`);
  if (!plan.rows.length && !plan.problems.length) plan.problems.push("No rows with a player name.");
  void opts.source;
  return plan;
}
