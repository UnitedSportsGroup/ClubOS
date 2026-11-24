// SIU Performance Hub — the SQUAD BOARD: one shape for every screen a coach reads.
//
// Daniel, 25 Nov 2026 (after meeting Michael Peterson and Adria Casals): "when the
// coaches login they get the team dashboard view … easily see what everyone has put
// down to monitor the squad … a button for demo player or demo coach … dummy data for
// coach side … if VALD, GPS, daily monitoring, weight, knee to wall etc. was all done
// … phone and laptop and tablet."
//
//  🔴 ONE shape. ClubOS (laptop), the SIU Performance app (phone, tablet) and the demo
//     all draw a `SquadBoard`. The server builds it from the one store; `demoSquad()`
//     builds it from made-up players. A screen never knows which it was handed.
//  🔴 The demo's players are INVENTED and live only in this file — nothing here is
//     ever written to a real player.
//  🔴 Blank is not zero: a reading nobody took is null and is drawn "—".
//  🔴 The two highlight thresholds below are DRAFTS for the performance staff to set.
//
// Pure — no imports — so ClubOS and the app share it byte for byte
// (apps/siu-performance-app/src/shared/perf-squad.ts, `npm run check:shared`).

export type Level = "green" | "amber" | "red" | null;
export interface Reading { value: number; date: string }
export interface SquadLoad { acute7: number | null; chronic28: number | null; acwr: number | null; acwrNote: string | null; monotony: number | null; strain: number | null; band: "low" | "sweet" | "high" | "danger" | null }

export interface SquadCheckIn {
  id: number; flag: "red" | "amber" | null; reasons: string[]; byAthlete: boolean;
  /** A few answers for a table cell. */
  summary: { label: string; text: string }[];
  /** Every answer, in the form's order, for the player's own page. */
  full: { label: string; text: string }[];
  ready: number | null; sleep: string | null; areas: string[];
  /** What staff were told about ("Not well", "Areas: Right Knee"). */
  report: string[];
}
export interface SquadBody {
  weightPre: Reading | null; weightPost: Reading | null;
  /** Post against pre on the SAME day, in percent. Null unless both were taken that day. */
  changePct: number | null;
  ktwLeft: Reading | null; ktwRight: Reading | null;
  /** Left minus right, cm, same day. */
  ktwDiff: number | null;
  history: { date: string; weightPre: number | null; weightPost: number | null; ktwLeft: number | null; ktwRight: number | null }[];
}
export interface SquadTest { name: string; unit: string | null; value: number; date: string; prev: number | null; higherIsBetter: boolean }

export interface SquadPlayer {
  contactId: number; name: string; firstName?: string | null; position: string | null; squadNumber: number | null; squad: string; email: string | null;
  availability: { state: string; since: string | null; expectedReturn: string | null; bodyArea: string | null };
  wellness: null | { score: number | null; flag: "red" | "amber" | null; reasons: string[]; items: Record<string, number | null>; sleepHours: number | null; soreAreas: string[]; byAthlete: boolean; medicalFlag?: boolean | null; note?: string | null };
  checkIn: SquadCheckIn | null;
  rpe: { date: string; kind: string; rpe: number; minutes: number | null }[];
  load: SquadLoad;
  readiness: { level: Level; used: string[]; missing: string[]; reasons: string[] };
  gps: Record<string, { value: number; date: string; source: string }>;
  body: SquadBody;
  tests: SquadTest[];
  /** "How ready am I" for the 7 days ending today, oldest first; null = no check-in that day. */
  readyTrend: (number | null)[];
  account: "none" | "invited" | "active" | "disabled"; lastSignIn: string | null;
}
export interface SquadBoard {
  today: string; medical: boolean; demo?: boolean; players: SquadPlayer[];
  counts: { squad: number; available: number; modified: number; out: number; checkedIn: number; flagged: number; accounts: number };
  unlinked: { id: number; source: string; source_athlete_key: string; source_name: string; readings: number }[];
}

// ── the player's own daily list ──────────────────────────────────────────────
/** What the player types besides the check-in. Keys are metric keys in the one store. */
export const PLAYER_MEASURES = [
  { key: "body_mass_pre_kg", field: "weightPre", label: "Pre-training weight", unit: "kg", min: 40, max: 150, step: 0.1 },
  { key: "body_mass_post_kg", field: "weightPost", label: "Post-training weight", unit: "kg", min: 40, max: 150, step: 0.1 },
  { key: "knee_to_wall_left_cm", field: "ktwLeft", label: "Knee to wall, left", unit: "cm", min: 0, max: 30, step: 0.5 },
  { key: "knee_to_wall_right_cm", field: "ktwRight", label: "Knee to wall, right", unit: "cm", min: 0, max: 30, step: 0.5 },
] as const;
export type MeasureField = (typeof PLAYER_MEASURES)[number]["field"];
export type Measures = Record<MeasureField, number | null>;
export const NO_MEASURES: Measures = { weightPre: null, weightPost: null, ktwLeft: null, ktwRight: null };

/** A typed number for one measure, or a sentence saying why not. Blank → null (cleared). */
export function parseMeasure(field: MeasureField, raw: unknown): { value: number | null } | { error: string } {
  const m = PLAYER_MEASURES.find((x) => x.field === field)!;
  if (raw == null || raw === "") return { value: null };
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < m.min || n > m.max) return { error: `${m.label} is ${m.min} to ${m.max} ${m.unit}.` };
  return { value: Math.round(n * 10) / 10 };
}

// ── small sums, said once ────────────────────────────────────────────────────
export const MASS_LOSS_AMBER_PCT = -2;   // DRAFT: body mass down 2% or more across a session
export const KTW_DIFF_AMBER_CM = 2;      // DRAFT: left and right 2 cm or more apart
const r1 = (n: number) => Math.round(n * 10) / 10;
export function massChangePct(pre: Reading | null, post: Reading | null): number | null {
  if (!pre || !post || pre.date !== post.date || pre.value <= 0) return null;
  return r1(((post.value - pre.value) / pre.value) * 100);
}
export function ktwDifference(l: Reading | null, r: Reading | null): number | null {
  if (!l || !r || l.date !== r.date) return null;
  return r1(l.value - r.value);
}
export const massTone = (pct: number | null): Level => (pct == null ? null : pct <= MASS_LOSS_AMBER_PCT ? "amber" : "green");
export const ktwTone = (diff: number | null): Level => (diff == null ? null : Math.abs(diff) >= KTW_DIFF_AMBER_CM ? "amber" : "green");
export const signed = (n: number | null, unit = ""): string => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}${unit}`);

/** Players a coach should look at first: red, then amber, then anyone who reported something. */
export function needsAttention(b: SquadBoard): SquadPlayer[] {
  const rank = (p: SquadPlayer) => (p.readiness.level === "red" ? 0 : p.readiness.level === "amber" ? 1 : p.checkIn?.report.length ? 2 : 9);
  return b.players.filter((p) => rank(p) < 9).sort((a, c) => rank(a) - rank(c) || a.name.localeCompare(c.name));
}
export const notCheckedIn = (b: SquadBoard): SquadPlayer[] => b.players.filter((p) => !p.checkIn && !p.wellness);

// ─────────────────────────────────────────────────────────────────────────────
// The demo squad — invented players, every source filled in.
// ─────────────────────────────────────────────────────────────────────────────

const isoAdd = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
function rng(seed: number) {
  // Scramble the seed first: neighbouring seeds must not give neighbouring first numbers.
  let s = Math.imul((seed ^ 0x9e3779b9) >>> 0, 2654435761) >>> 0;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  next(); next();
  return next;
}

const DEMO: [string, string, string, number][] = [
  ["Tane", "Rewiti", "Goalkeeper", 1], ["Callum", "Ashby", "Defender", 2], ["Mateo", "Varga", "Defender", 3], ["Jonah", "Pellow", "Defender", 4],
  ["Arlo", "Finch", "Defender", 5], ["Kieran", "Molloy", "Midfielder", 6], ["Sione", "Latu", "Midfielder", 8], ["Felix", "Hartnell", "Midfielder", 10],
  ["Oskar", "Lindqvist", "Midfielder", 14], ["Rafael", "Okoro", "Midfielder", 16], ["Hemi", "Parata", "Forward", 7], ["Luca", "Brennan", "Forward", 9],
  ["Noah", "Tavita", "Forward", 11], ["Elias", "Whitcombe", "Forward", 17], ["Jude", "Ferreira", "Defender", 20], ["Marlon", "Scully", "Goalkeeper", 23],
  ["Theo", "Arkwright", "Midfielder", 24], ["Isaia", "Fonoti", "Forward", 27],
];
const SLEEP = ["Well below normal", "Below normal", "Normal", "Above normal", "Well above normal"];

export function demoSquad(today: string): SquadBoard {
  const players: SquadPlayer[] = DEMO.map(([first, surname, position, no], i) => {
    const r = rng(1000 + i * 77);
    const gk = position === "Goalkeeper";
    const id = 900001 + i;
    // A few written-in stories so every state is on show.
    const story = i === 3 ? "injured" : i === 9 ? "modified" : i === 6 ? "ill" : i === 11 ? "spike" : i === 13 ? "niggle" : i === 1 ? "dehydrated" : i === 16 || i === 5 ? "missing" : "fine";
    const out = story === "injured";
    const state = out ? "injured" : story === "modified" ? "modified" : "available";

    // check-in
    const ready = story === "ill" ? 3 : story === "niggle" ? 5 : story === "modified" ? 6 : 6 + Math.floor(r() * 4);
    const sleepIx = story === "ill" ? 0 : story === "niggle" ? 1 : 2 + Math.floor(r() * 2.4);
    const areas = story === "niggle" ? ["Right Posterior Upper Leg"] : story === "modified" ? ["Left Knee"] : story === "injured" ? ["Right Posterior Upper Leg", "Right Posterior Pelvis"] : i === 12 ? ["Left Lower Leg / Foot"] : [];
    const reasons: string[] = [];
    if (story === "ill") reasons.push("Not well", "Ready 3/10", "Sleep well below normal");
    if (story === "niggle") reasons.push("Ready 5/10", "Sleep below normal");
    const flag: "red" | "amber" | null = story === "ill" ? "red" : reasons.length ? "amber" : null;
    const report = [...(story === "ill" ? ["Not well"] : []), ...(areas.length ? [`Areas: ${areas.join(", ")}`] : [])];
    const did = out ? "Rehab/Prehab" : i % 7 === 4 ? "Rest/Recovery" : "Football";
    const sessionRpe = did === "Football" ? (story === "spike" ? 9 : 5 + Math.floor(r() * 3)) : null;
    const full = [
      { label: "Am I well?", text: story === "ill" ? "No, something to report" : "Yes" },
      ...(story === "ill" ? [{ label: "Illness symptoms", text: "Sore throat and a headache since last night" }] : []),
      { label: "Ready", text: String(ready) }, { label: "Sleep", text: SLEEP[sleepIx] },
      ...(areas.length ? [{ label: "Areas", text: areas.join(", ") }] : []),
      ...(story === "niggle" ? [{ label: "Areas note", text: "Tight in the last 20 minutes yesterday, fine walking" }] : []),
      { label: "Yesterday", text: did },
      ...(sessionRpe != null ? [{ label: "Session RPE", text: String(sessionRpe) }] : []),
      ...(did === "Rehab/Prehab" ? [{ label: "Rehab/Prehab", text: "Bike 20 min, Nordics 3×5, band work" }] : []),
      ...(did === "Rest/Recovery" ? [{ label: "Rest/Recovery", text: "Pool session and a long walk" }] : []),
      { label: "Help the team", text: i % 5 === 0 ? "More recovery" : i % 6 === 0 ? "Tactical clarity" : "We're all set" },
    ];
    const checkIn: SquadCheckIn | null = story === "missing" ? null : {
      id: id, flag, reasons, byAthlete: true, full, summary: full.filter((x) => !["Illness symptoms", "Areas note", "Rehab/Prehab", "Rest/Recovery"].includes(x.label)).slice(0, 8),
      ready, sleep: SLEEP[sleepIx], areas, report,
    };

    // load
    const chronic = Math.round(1700 + r() * 500);
    const ratio = out ? 0.42 : story === "spike" ? 1.58 : story === "modified" ? 0.74 : 0.88 + r() * 0.38;
    const acwr = Math.round(ratio * 100) / 100;
    const band: SquadLoad["band"] = acwr > 1.5 ? "danger" : acwr > 1.3 ? "high" : acwr < 0.8 ? "low" : "sweet";
    const load: SquadLoad = { acute7: Math.round(chronic * ratio), chronic28: chronic, acwr, acwrNote: null, monotony: r1(1.1 + r() * 0.9), strain: Math.round(chronic * ratio * (1.1 + r() * 0.9)), band };

    // GPS — yesterday's session
    const gpsDay = isoAdd(today, -1);
    const dist = gk ? 4300 + r() * 600 : 8600 + r() * 2600;
    const g = (value: number) => ({ value: Math.round(value * 100) / 100, date: gpsDay, source: "catapult_one" });
    const gps: SquadPlayer["gps"] = out ? {} : {
      total_distance_m: g(Math.round(dist)), hsr_distance_m: g(Math.round(dist * (gk ? 0.02 : 0.07 + r() * 0.04))), sprint_distance_m: g(Math.round(gk ? 20 + r() * 40 : 180 + r() * 420)),
      top_speed_kmh: g(r1(gk ? 24 + r() * 3 : 28.5 + r() * 5)), distance_per_min: g(r1(dist / 92)), player_load: g(Math.round(dist / 10.4)),
      power_plays: g(Math.round(gk ? 8 + r() * 8 : 34 + r() * 30)), max_acceleration: g(4.6 + r() * 2.1), max_deceleration: g(5.2 + r() * 2.4),
    };

    // weight and knee to wall
    const base = r1(gk ? 84 + r() * 6 : 68 + r() * 14);
    const drop = story === "dehydrated" ? 0.026 : 0.004 + r() * 0.011;
    const ktwL = r1(Math.round((9 + r() * 5) * 2) / 2);
    const ktwGap = story === "niggle" || i === 7 ? 2.5 : Math.round(r() * 2) / 2;
    const history: SquadBody["history"] = [];
    for (let d = 6; d >= 0; d--) {
      const rr = rng(id * 31 + d);
      const pre = r1(base + (rr() - 0.5) * 0.9);
      const took = !(out || (d === 0 && story === "missing")) && rr() > 0.12;
      history.push({
        date: isoAdd(today, -d), weightPre: took ? pre : null, weightPost: took ? r1(pre * (1 - (d === 0 ? drop : 0.004 + rr() * 0.01))) : null,
        ktwLeft: took ? r1(ktwL + Math.round((rr() - 0.5) * 2) / 2) : null, ktwRight: took ? r1(ktwL - ktwGap + Math.round((rr() - 0.5) * 2) / 2) : null,
      });
    }
    const last = [...history].reverse().find((h) => h.weightPre != null) ?? null;
    if (last && last.date === today) { last.ktwLeft = ktwL; last.ktwRight = r1(ktwL - ktwGap); }
    const rd = (v: number | null | undefined, date: string | undefined): Reading | null => (v == null || !date ? null : { value: v, date });
    const wp = rd(last?.weightPre, last?.date), wq = rd(last?.weightPost, last?.date), kl = rd(last?.ktwLeft, last?.date), kr = rd(last?.ktwRight, last?.date);
    const body: SquadBody = { weightPre: wp, weightPost: wq, changePct: massChangePct(wp, wq), ktwLeft: kl, ktwRight: kr, ktwDiff: ktwDifference(kl, kr), history };

    // testing (VALD and field tests), last Tuesday against the one before
    const tDay = isoAdd(today, -1);
    const t = (name: string, unit: string, value: number, change: number, hib: boolean): SquadTest => ({ name, unit, value: Math.round(value * 100) / 100, date: tDay, prev: Math.round(value * (1 - change) * 100) / 100, higherIsBetter: hib });
    const fatigue = story === "spike" ? -0.09 : story === "niggle" ? -0.06 : (r() - 0.45) * 0.06;
    const hamL = 360 + r() * 90, hamGap = story === "niggle" ? 0.14 : (r() - 0.5) * 0.08;
    const tests: SquadTest[] = [
      t("ForceDecks CMJ · Jump height", "cm", 34 + r() * 9, fatigue, true),
      t("ForceDecks CMJ · RSI-modified", "m/s", 0.42 + r() * 0.18, fatigue * 1.3, true),
      t("NordBord · Hamstring left", "N", hamL, (r() - 0.5) * 0.05, true),
      t("NordBord · Hamstring right", "N", hamL * (1 - hamGap), (r() - 0.5) * 0.05, true),
      t("NordBord · Imbalance", "%", Math.abs(hamGap) * 100, 0, false),
      t("ForceFrame · Groin squeeze", "N", 420 + r() * 90, (r() - 0.5) * 0.06, true),
      t("10m sprint", "s", 1.68 + r() * 0.14, (r() - 0.5) * 0.02, false),
      t("30m sprint", "s", 4.0 + r() * 0.3, (r() - 0.5) * 0.02, false),
      t("Yo-Yo IR1", "m", 1900 + Math.round(r() * 12) * 40, -0.03, true),
    ];

    const level: Level = out || story === "ill" ? "red" : story === "spike" ? "red" : state === "modified" || flag === "amber" ? "amber" : checkIn ? "green" : "green";
    const rReasons = [...(out ? ["Injured"] : []), ...(state === "modified" ? ["Modified training"] : []), ...reasons, ...(band === "danger" ? [`Load spike (ACWR ${acwr})`] : band === "high" ? [`Load rising (ACWR ${acwr})`] : [])];
    const readyTrend = Array.from({ length: 7 }, (_, d) => (d === 6 ? (checkIn ? ready : null) : rng(id + d)() < 0.1 ? null : Math.max(2, Math.min(10, ready + Math.round((rng(id * 3 + d)() - 0.4) * 3)))));
    return {
      contactId: id, name: `${first} ${surname}`, firstName: first, position, squadNumber: no, squad: "Demo squad", email: null,
      availability: { state, since: out ? isoAdd(today, -9) : story === "modified" ? isoAdd(today, -2) : null, expectedReturn: out ? isoAdd(today, 12) : null, bodyArea: out ? "Hamstring" : story === "modified" ? "Knee" : null },
      wellness: null, checkIn,
      rpe: sessionRpe != null ? [{ date: gpsDay, kind: "training", rpe: sessionRpe, minutes: 90 }] : [],
      load, readiness: { level, used: ["availability", ...(checkIn ? ["wellness"] : []), "load"], missing: checkIn ? [] : ["today's check-in"], reasons: rReasons },
      gps, body, tests, readyTrend, account: "active", lastSignIn: null,
    };
  });
  return {
    today, medical: false, demo: true, players,
    counts: {
      squad: players.length, available: players.filter((p) => p.availability.state === "available").length,
      modified: players.filter((p) => p.availability.state === "modified").length, out: players.filter((p) => p.availability.state === "injured").length,
      checkedIn: players.filter((p) => p.checkIn).length, flagged: players.filter((p) => p.checkIn?.flag).length, accounts: players.length,
    },
    unlinked: [],
  };
}
