/**
 * SIU Performance Hub — the ONE place that knows what a metric is, where data
 * comes from, and how every derived number is worked out. Pure: no imports from
 * server or client, so the API and the screen can never disagree.
 *
 * Daniel, 2026-11-14: "all data sources plugged into one dashboard like the
 * player monitoring responses, objective gps data, formulas etc… whoop …
 * wyscout, statsbomb, video clips … and any other data sources pro clubs would
 * use".
 *
 * 🔴 BLANK IS NOT ZERO. A metric a source did not give has no reading; it reads
 *    "—" and is left out of every average. Only a REST DAY (a day with no
 *    session at all) counts as zero load, and only inside the load formulas.
 * 🔴 EVERY FORMULA SAYS WHEN IT CANNOT ANSWER. ACWR needs 21 days, a wellness
 *    baseline needs 7 check-ins, monotony needs a week. Until then: null and a
 *    reason, never a number.
 * 🔴 A COMPOSITE NAMES ITS PARTS. Readiness lists which inputs it used; a
 *    missing input is never treated as a zero.
 * 🔴 Dates are bare ISO "yyyy-mm-dd" strings, stepped on their parts. Never a
 *    JS Date round-trip (it reads a day early in NZ).
 */

export const PERFORMANCE_TAB = "performance";
/** Clinical notes. Per person, explicit, and NO super-admin bypass. */
export const PERFORMANCE_MEDICAL_GRANT = "performance-medical";
export const SIU_ORG_SLUG = "south-island-united";

// ─────────────────────────────────────────────────────────────────────────────
// Data sources — what a professional club plugs in, and where each one stands.
// ─────────────────────────────────────────────────────────────────────────────

export type SourceState = "built" | "import" | "planned";
export type SourcePriority = "now" | "next" | "later";

export interface DataSource {
  key: string;
  name: string;
  category: "monitoring" | "gps" | "wearable" | "testing" | "match" | "video" | "medical";
  /** built = in the app now · import = CSV import works now · planned = slot ready, not connected. */
  state: SourceState;
  priority: SourcePriority;
  what: string;
  /** How it gets in (or would). */
  how: string;
  /** Why a club like SIU should (or should not yet) have it. */
  advice: string;
}

export const DATA_SOURCES: DataSource[] = [
  {
    key: "wellness", name: "Daily wellness check-in", category: "monitoring", state: "built", priority: "now",
    what: "Sleep, fatigue, soreness, stress and mood (1–5), sleep hours, sore areas, a private note to the physio.",
    how: "Players answer on their phones at join.southislandunited.com/athlete, before training.",
    advice: "The cheapest early-warning signal there is. Only works if it is answered every day — the board shows who has not.",
  },
  {
    key: "rpe", name: "Session RPE (effort × minutes)", category: "monitoring", state: "built", priority: "now",
    what: "How hard the session felt (0–10) and how long it was. Load = RPE × minutes (Foster).",
    how: "Players answer on their phones within 30 minutes of finishing.",
    advice: "The internal load that GPS cannot see — gym, recovery, a match without a vest. Pairs with GPS for the full picture.",
  },
  {
    key: "catapult_one", name: "Catapult One GPS", category: "gps", state: "import", priority: "now",
    what: "Distance, high-speed running, sprint distance, top speed, accelerations, decelerations, player load.",
    how: "Export the session CSV from Catapult One and drop it in Performance → Import. Catapult One has no public API; a live feed means Catapult's API, which came up in the Vector upgrade talks (10–11 Nov).",
    advice: "Already paid for (21 units to Jan 2029). Wear vests at every session and upload every day — 10 sessions so far is not a baseline.",
  },
  {
    key: "availability", name: "Injury & availability log", category: "medical", state: "built", priority: "now",
    what: "Out · Modified · Ill, body area, expected return; clinical notes for medical staff only.",
    how: "The physio logs it in Performance → Availability.",
    advice: "Replaces WhatsApp. Days lost per player is the number an OFC licensing audit and a board both ask for.",
  },
  {
    key: "testing", name: "Fitness testing", category: "testing", state: "built", priority: "now",
    what: "Any test with a unit — sprint 10/30 m, CMJ, Yo-Yo IR1, 30-15 IFT, body mass, skinfolds.",
    how: "Typed in after a testing day, or imported from a CSV.",
    advice: "Test at the start of pre-season, mid-season and end. Bands set by the coaching staff colour the results.",
  },
  {
    key: "video", name: "Video clips", category: "video", state: "built", priority: "now",
    what: "A link to a clip (Spiideo, Veo, Hudl, Wyscout, YouTube) tagged to players and a date.",
    how: "Paste the link in Performance → Video. The clip stays where it is hosted.",
    advice: "SIU already films with Spiideo — linking clips to the player is free and makes every review conversation concrete.",
  },
  {
    key: "ofc_comet", name: "OFC match data (COMET)", category: "match", state: "planned", priority: "now",
    what: "Official minutes played, goals, assists, cards for every OFC Pro League match.",
    how: "Read from OFC's public match centre — the same feed the OFC fantasy game already uses.",
    advice: "Free and official. Match minutes are what makes a load figure mean something; this is the next connector to wire.",
  },
  {
    key: "whoop", name: "WHOOP", category: "wearable", state: "planned", priority: "later",
    what: "Recovery %, HRV, resting heart rate, sleep performance and strain, every day.",
    how: "WHOOP's official developer API — each player connects their own band once (OAuth).",
    advice: "Strong 24/7 data, but a band and subscription per player. Worth it only once the free daily check-in is answered every day.",
  },
  {
    key: "oura_garmin", name: "Oura / Garmin / Polar", category: "wearable", state: "planned", priority: "later",
    what: "Sleep, HRV and resting heart rate from whatever a player already wears.",
    how: "Each vendor has an official API with per-player consent; the readings land in the same store as WHOOP.",
    advice: "Use what players already own before buying anything.",
  },
  {
    key: "vald", name: "VALD ForceDecks / NordBord", category: "testing", state: "planned", priority: "next",
    what: "Countermovement jump, asymmetry, and Nordic hamstring strength.",
    how: "VALD Hub's API, or its CSV export into Import.",
    advice: "The standard pro-club tool for hamstring risk and neuromuscular fatigue. Hamstrings are football's most common injury — the best next spend.",
  },
  {
    key: "heart_rate", name: "Heart-rate straps (Polar Team / Catapult HR)", category: "gps", state: "planned", priority: "next",
    what: "Time in heart-rate zones, TRIMP, HR recovery.",
    how: "CSV export into Import.",
    advice: "Adds internal load to GPS for conditioning sessions where distance undersells the work.",
  },
  {
    key: "wyscout", name: "Wyscout", category: "match", state: "planned", priority: "next",
    what: "Event data (passes, duels, shots, xG) per player per match, plus clips and scouting.",
    how: "Wyscout API (a paid licence) or its match CSV into Import.",
    advice: "The usual first event-data tool in Oceania/Asia; doubles as recruitment.",
  },
  {
    key: "statsbomb", name: "StatsBomb (Hudl)", category: "match", state: "planned", priority: "later",
    what: "Richer event data with freeze-frames and on-ball value models.",
    how: "StatsBomb API with a licence.",
    advice: "Best-in-class but priced for bigger leagues; check OFC Pro League coverage before paying.",
  },
  {
    key: "screening", name: "Medical screening & MSK", category: "medical", state: "planned", priority: "next",
    what: "Range of motion, adductor squeeze, hip and ankle screens — pre-season and on return to play.",
    how: "Typed in as tests by the physio.",
    advice: "Uses the Testing screen already built — it only needs the tests named.",
  },
];

export function sourceByKey(key: string): DataSource | undefined {
  return DATA_SOURCES.find((s) => s.key === key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics — every number in the store has a key from this list.
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricDef {
  key: string;
  label: string;
  unit: string | null;
  category: "gps" | "load" | "wellness" | "wearable" | "testing" | "match" | "body";
  higherIsBetter: boolean | null;
  /** Header words that mean this metric in a device's CSV export (lower-cased, punctuation stripped). */
  aliases?: string[];
  decimals?: number;
}

export const METRICS: MetricDef[] = [
  // GPS (Catapult One / any GPS export)
  { key: "duration_min", label: "Duration", unit: "min", category: "gps", higherIsBetter: null, aliases: ["duration", "duration min", "total duration", "session duration", "time min", "minutes"] },
  { key: "total_distance_m", label: "Distance", unit: "m", category: "gps", higherIsBetter: null, aliases: ["distance", "total distance", "distance m", "total distance m", "distance covered"] },
  { key: "hsr_distance_m", label: "High-speed running", unit: "m", category: "gps", higherIsBetter: null, aliases: ["hsr", "high speed running", "hsr distance", "high speed distance", "hsr m", "high intensity running"] },
  { key: "sprint_distance_m", label: "Sprint distance", unit: "m", category: "gps", higherIsBetter: null, aliases: ["sprint distance", "sprint distance m", "sprinting distance"] },
  { key: "top_speed_kmh", label: "Top speed", unit: "km/h", category: "gps", higherIsBetter: true, decimals: 1, aliases: ["top speed", "max speed", "top speed kmh", "top speed km h", "maximum velocity", "max velocity"] },
  { key: "sprints", label: "Sprints", unit: null, category: "gps", higherIsBetter: null, aliases: ["sprints", "sprint count", "number of sprints", "sprint efforts"] },
  { key: "accelerations", label: "Accelerations", unit: null, category: "gps", higherIsBetter: null, aliases: ["accelerations", "accels", "acceleration count", "high accelerations"] },
  { key: "decelerations", label: "Decelerations", unit: null, category: "gps", higherIsBetter: null, aliases: ["decelerations", "decels", "deceleration count", "high decelerations"] },
  { key: "player_load", label: "Player Load", unit: "au", category: "gps", higherIsBetter: null, decimals: 0, aliases: ["player load", "playerload", "total player load"] },
  { key: "distance_per_min", label: "Distance per minute", unit: "m/min", category: "gps", higherIsBetter: null, decimals: 1, aliases: ["distance per min", "distance per minute", "metres per minute", "m min", "work rate"] },
  { key: "power_plays", label: "Power plays", unit: null, category: "gps", higherIsBetter: null, aliases: ["power plays", "powerplays"] },
  { key: "impacts", label: "Impacts", unit: null, category: "gps", higherIsBetter: null, aliases: ["impacts"] },
  { key: "energy_kcal", label: "Energy", unit: "kcal", category: "gps", higherIsBetter: null, aliases: ["energy", "energy kcal", "calories"] },
  { key: "hr_max", label: "Max heart rate", unit: "bpm", category: "gps", higherIsBetter: null, aliases: ["hr max", "max heart rate", "heart rate max", "max hr"] },
  { key: "hr_load", label: "Heart-rate load", unit: "au", category: "gps", higherIsBetter: null, aliases: ["hr load", "heart rate load", "trimp"] },
  { key: "time_red_zone_min", label: "Time in red zone", unit: "min", category: "gps", higherIsBetter: null, decimals: 1, aliases: ["time in red zone", "red zone", "time in red zone min"] },
  // Wearables
  { key: "recovery_pct", label: "Recovery", unit: "%", category: "wearable", higherIsBetter: true, aliases: ["recovery", "recovery score", "recovery pct"] },
  { key: "hrv_ms", label: "HRV", unit: "ms", category: "wearable", higherIsBetter: true, aliases: ["hrv", "heart rate variability", "rmssd"] },
  { key: "resting_hr_bpm", label: "Resting heart rate", unit: "bpm", category: "wearable", higherIsBetter: false, aliases: ["resting heart rate", "rhr", "resting hr"] },
  { key: "sleep_performance_pct", label: "Sleep performance", unit: "%", category: "wearable", higherIsBetter: true, aliases: ["sleep performance", "sleep score"] },
  { key: "day_strain", label: "Day strain", unit: "au", category: "wearable", higherIsBetter: null, decimals: 1, aliases: ["strain", "day strain"] },
  // Match / event data
  { key: "minutes_played", label: "Minutes played", unit: "min", category: "match", higherIsBetter: null, aliases: ["minutes played", "mins played", "min played"] },
  { key: "goals", label: "Goals", unit: null, category: "match", higherIsBetter: true, aliases: ["goals"] },
  { key: "assists", label: "Assists", unit: null, category: "match", higherIsBetter: true, aliases: ["assists"] },
  { key: "xg", label: "xG", unit: null, category: "match", higherIsBetter: true, decimals: 2, aliases: ["xg", "expected goals"] },
  { key: "passes_accurate_pct", label: "Pass accuracy", unit: "%", category: "match", higherIsBetter: true, aliases: ["accurate passes pct", "pass accuracy", "passes accurate"] },
  { key: "duels_won_pct", label: "Duels won", unit: "%", category: "match", higherIsBetter: true, aliases: ["duels won pct", "duels won"] },
  // Body
  { key: "body_mass_kg", label: "Body mass", unit: "kg", category: "body", higherIsBetter: null, decimals: 1, aliases: ["body mass", "weight", "body weight", "weight kg"] },
  { key: "skinfolds_mm", label: "Skinfolds (sum)", unit: "mm", category: "body", higherIsBetter: false, decimals: 1, aliases: ["skinfolds", "sum of skinfolds"] },
];

export function metricByKey(key: string): MetricDef | undefined {
  return METRICS.find((m) => m.key === key);
}

/** Lower-case, strip units in brackets and punctuation, collapse spaces. */
export function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[()\[\]/%.,:_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The metric a CSV header means, or null. Exact alias match only — no guessing. */
export function metricForHeader(h: string): MetricDef | null {
  const n = normaliseHeader(h);
  for (const m of METRICS) {
    if (normaliseHeader(m.label) === n || m.key === n.replace(/ /g, "_")) return m;
    if (m.aliases?.some((a) => normaliseHeader(a) === n)) return m;
  }
  return null;
}

export function formatMetric(value: number | null | undefined, m?: MetricDef | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const d = m?.decimals ?? (Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0);
  const s = value.toLocaleString("en-NZ", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  return m?.unit && m.unit !== "au" ? `${s}${m.unit === "%" ? "%" : ` ${m.unit}`}` : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates on their parts.
// ─────────────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
/** Today in New Zealand as yyyy-mm-dd. */
export function nzToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ─────────────────────────────────────────────────────────────────────────────
// Wellness (Hooper/McLean-style, every item 1–5, 5 = good).
// ─────────────────────────────────────────────────────────────────────────────

export const WELLNESS_ITEMS = [
  { key: "sleep", label: "Sleep quality", low: "Terrible", high: "Great" },
  { key: "fatigue", label: "Energy", low: "Exhausted", high: "Fresh" },
  { key: "soreness", label: "Muscle soreness", low: "Very sore", high: "Not sore" },
  { key: "stress", label: "Stress", low: "Very stressed", high: "Relaxed" },
  { key: "mood", label: "Mood", low: "Low", high: "Great" },
] as const;
export type WellnessKey = (typeof WELLNESS_ITEMS)[number]["key"];

export const SORE_AREAS = [
  "Neck", "Back", "Groin / adductor", "Hip flexor", "Quad", "Hamstring", "Knee", "Calf", "Achilles", "Ankle", "Foot", "Shoulder",
] as const;

export interface WellnessRow { date: string; sleep: number | null; fatigue: number | null; soreness: number | null; stress: number | null; mood: number | null; sleepHours?: number | null }

/** Sum of the answered items scaled to /25. null when nothing was answered. */
export function wellnessScore(w: WellnessRow): { score: number | null; answered: number } {
  const vals = WELLNESS_ITEMS.map((i) => w[i.key]).filter((v): v is number => v != null);
  if (!vals.length) return { score: null, answered: 0 };
  return { score: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 5 * 10) / 10, answered: vals.length };
}

export interface WellnessFlag { level: "red" | "amber" | null; reasons: string[] }

/**
 * A check-in is flagged when an item is 1 (red) or 2 (amber), or the score sits
 * a standard deviation below the player's OWN 28-day baseline. The baseline
 * needs 7 earlier check-ins; before that only the absolute rule applies, and
 * the reason says so.
 */
export function wellnessFlag(today: WellnessRow, history: WellnessRow[]): WellnessFlag {
  const reasons: string[] = [];
  let level: "red" | "amber" | null = null;
  const bump = (l: "red" | "amber") => { if (l === "red" || level == null) level = l; };
  for (const i of WELLNESS_ITEMS) {
    const v = today[i.key];
    if (v === 1) { bump("red"); reasons.push(`${i.label}: ${i.low.toLowerCase()}`); }
    else if (v === 2) { bump("amber"); reasons.push(`${i.label} low`); }
  }
  if (today.sleepHours != null && today.sleepHours < 6) { bump("amber"); reasons.push(`${today.sleepHours} h sleep`); }
  const base = wellnessBaseline(today.date, history);
  const s = wellnessScore(today).score;
  if (s != null && base.mean != null && base.sd != null && base.sd > 0) {
    const z = (s - base.mean) / base.sd;
    if (z <= -1.5) { bump("red"); reasons.push("well below their normal"); }
    else if (z <= -1) { bump("amber"); reasons.push("below their normal"); }
  }
  return { level, reasons };
}

export function wellnessBaseline(onDate: string, history: WellnessRow[]): { mean: number | null; sd: number | null; n: number } {
  const from = addDays(onDate, -28);
  const scores = history
    .filter((h) => h.date < onDate && h.date >= from)
    .map((h) => wellnessScore(h).score)
    .filter((v): v is number => v != null);
  if (scores.length < 7) return { mean: null, sd: null, n: scores.length };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1));
  return { mean, sd, n: scores.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Load — session RPE (internal) and GPS (external).
// ─────────────────────────────────────────────────────────────────────────────

export interface RpeRow { date: string; rpe: number; minutes: number | null }

/** Foster session load. null when the minutes were not given — never RPE × 0. */
export function sessionLoad(r: RpeRow): number | null {
  return r.minutes == null ? null : r.rpe * r.minutes;
}

/**
 * Daily load series from `from` to `to` inclusive.
 * A day with no session is 0 (rest). A day whose only session has no minutes
 * is `null` (not measured) and is excluded downstream — the two must stay apart.
 */
export function dailyLoads(rows: { date: string; load: number | null }[], from: string, to: string): { date: string; load: number | null }[] {
  const byDay = new Map<string, { sum: number; measured: boolean; any: boolean }>();
  for (const r of rows) {
    const d = byDay.get(r.date) ?? { sum: 0, measured: false, any: false };
    d.any = true;
    if (r.load != null) { d.sum += r.load; d.measured = true; }
    byDay.set(r.date, d);
  }
  const out: { date: string; load: number | null }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = byDay.get(d);
    out.push({ date: d, load: !v ? 0 : v.measured ? v.sum : null });
  }
  return out;
}

export interface LoadSummary {
  acute7: number | null;
  chronic28: number | null;
  acwr: number | null;
  acwrNote: string | null;
  monotony: number | null;
  strain: number | null;
  band: "low" | "sweet" | "high" | "danger" | null;
}

/**
 * Rolling acute:chronic workload ratio (7-day load ÷ average 7-day load over 28
 * days), Foster monotony (mean ÷ SD of the 7 daily loads) and strain (weekly
 * load × monotony).
 *
 * 🔴 Needs 21 days since the player's FIRST recorded session, or it is a ratio
 * of a real week to an empty month and every new player reads as "danger".
 */
export function loadSummary(series: { date: string; load: number | null }[], firstSessionDate: string | null, today: string): LoadSummary {
  const empty: LoadSummary = { acute7: null, chronic28: null, acwr: null, acwrNote: null, monotony: null, strain: null, band: null };
  if (!firstSessionDate) return { ...empty, acwrNote: "No sessions recorded yet" };
  const lastN = (n: number) => series.filter((s) => s.date > addDays(today, -n) && s.date <= today);
  const sum = (xs: { load: number | null }[]) => xs.reduce((a, s) => a + (s.load ?? 0), 0);
  const week = lastN(7);
  const acute7 = Math.round(sum(week));
  const history = daysBetween(firstSessionDate, today) + 1;
  let chronic28: number | null = null, acwr: number | null = null, acwrNote: string | null = null;
  if (history < 21) {
    acwrNote = `Needs 3 weeks of data (${history} day${history === 1 ? "" : "s"} so far)`;
  } else {
    chronic28 = Math.round(sum(lastN(28)) / 4);
    acwr = chronic28 > 0 ? Math.round((acute7 / chronic28) * 100) / 100 : null;
    if (chronic28 === 0) acwrNote = "No load in the last 4 weeks";
  }
  const measured = week.filter((s) => s.load != null).map((s) => s.load as number);
  let monotony: number | null = null, strain: number | null = null;
  if (measured.length === 7 && measured.some((v) => v > 0)) {
    const mean = measured.reduce((a, b) => a + b, 0) / 7;
    const sd = Math.sqrt(measured.reduce((a, b) => a + (b - mean) ** 2, 0) / 7);
    monotony = sd > 0 ? Math.round((mean / sd) * 100) / 100 : null;
    strain = monotony != null ? Math.round(acute7 * monotony) : null;
  }
  return { acute7, chronic28, acwr, acwrNote, monotony, strain, band: acwrBand(acwr) };
}

/** Gabbett's bands: < 0.8 under-loaded · 0.8–1.3 sweet spot · 1.3–1.5 high · > 1.5 danger. */
export function acwrBand(acwr: number | null): LoadSummary["band"] {
  if (acwr == null) return null;
  if (acwr < 0.8) return "low";
  if (acwr <= 1.3) return "sweet";
  if (acwr <= 1.5) return "high";
  return "danger";
}

export const FORMULAS: { name: string; formula: string; reads: string }[] = [
  { name: "Session load", formula: "RPE (0–10) × minutes", reads: "Foster's session-RPE. Internal load; works for gym and matches without a GPS vest." },
  { name: "Acute load", formula: "Sum of daily load, last 7 days", reads: "This week." },
  { name: "Chronic load", formula: "Sum of daily load, last 28 days ÷ 4", reads: "An average week this month. Needs 3 weeks of data." },
  { name: "ACWR", formula: "Acute ÷ Chronic", reads: "0.8–1.3 is the sweet spot; above 1.5 is a spike worth a conversation. Shown only after 3 weeks." },
  { name: "Monotony", formula: "Mean daily load ÷ SD of daily load, last 7 days", reads: "Above 2 means every day looks the same — no easy days." },
  { name: "Strain", formula: "Weekly load × Monotony", reads: "High load with no variation." },
  { name: "Wellness", formula: "Average of the answered items × 5 (out of 25)", reads: "Flagged on any 1 or 2, under 6 h sleep, or 1 SD below the player's own 28-day normal (needs 7 check-ins)." },
  { name: "GPS vs normal", formula: "This session ÷ the player's average of their last 10 sessions of the same kind", reads: "Needs 3 earlier sessions." },
];

// ─────────────────────────────────────────────────────────────────────────────
// Availability.
// ─────────────────────────────────────────────────────────────────────────────

export type AvailabilityStatus = "injured" | "ill" | "modified" | "unavailable";
export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  injured: "Injured", ill: "Ill", modified: "Modified training", unavailable: "Unavailable",
};

export interface AvailabilitySpell { status: AvailabilityStatus; startedOn: string; endedOn: string | null }

/** Today's status: the spell covering today, else Available. */
export function availabilityOn(spells: AvailabilitySpell[], today: string): { state: "available" | AvailabilityStatus; since: string | null } {
  const s = spells.find((x) => x.startedOn <= today && (x.endedOn == null || x.endedOn >= today));
  return s ? { state: s.status, since: s.startedOn } : { state: "available", since: null };
}

/** Days out of full training (modified counts; ended spells inclusive; open spells to today). */
export function daysLost(spells: AvailabilitySpell[], today: string): number {
  return spells.reduce((acc, s) => {
    if (s.startedOn > today) return acc;
    const end = s.endedOn && s.endedOn < today ? s.endedOn : today;
    return acc + daysBetween(s.startedOn, end) + 1;
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Readiness — a traffic light that names the parts it used.
// ─────────────────────────────────────────────────────────────────────────────

export interface Readiness {
  level: "green" | "amber" | "red" | null;
  used: string[];
  missing: string[];
  reasons: string[];
}

export function readiness(p: {
  availability: "available" | AvailabilityStatus;
  wellness: WellnessFlag | null;   // null = no check-in today
  load: LoadSummary | null;
}): Readiness {
  const used: string[] = [], missing: string[] = [], reasons: string[] = [];
  let level: Readiness["level"] = null;
  const set = (l: "green" | "amber" | "red") => {
    const rank = { green: 0, amber: 1, red: 2 } as const;
    if (level == null || rank[l] > rank[level]) level = l;
  };
  used.push("availability");
  if (p.availability === "injured" || p.availability === "ill" || p.availability === "unavailable") { set("red"); reasons.push(AVAILABILITY_LABEL[p.availability]); }
  else if (p.availability === "modified") { set("amber"); reasons.push("Modified training"); }
  else set("green");

  if (p.wellness) {
    used.push("wellness");
    if (p.wellness.level) { set(p.wellness.level); reasons.push(...p.wellness.reasons); }
  } else missing.push("today's check-in");

  if (p.load?.acwr != null) {
    used.push("load");
    if (p.load.band === "danger") { set("red"); reasons.push(`Load spike (ACWR ${p.load.acwr})`); }
    else if (p.load.band === "high") { set("amber"); reasons.push(`Load rising (ACWR ${p.load.acwr})`); }
  } else missing.push("3 weeks of load");

  return { level, used, missing, reasons };
}
