// One-shot bulk import of USG calendar events sourced from staff documents
// shared 2026-05-23.
//
// Idempotent: skips rows where (organization_id, title, start_time) already
// exists. Wrapped in a single transaction.
//
// Sources (in order of inclusion below):
//   1. Christchurch_United_2026_Fixtures.xlsx     — 18 First Team fixtures
//   2. South Island Tournaments (Mainland Football) — 9 age groups
//   3. Canterbury Regional Tournaments              — 7 age groups
//   4. Western Springs U17                          — 10-13 Dec 2026 (refresh)
//   5. Holiday Programme — Term 3 + Summer          — 13 days
//   6. Holiday Programme Marketing milestones       — 14 dates across 2 camps
//   7. U4-U8 Football Programme                     — 3 term-block events
//
// Usage: npx tsx --env-file=.env script/usg-calendar-import.ts [--dry-run]

import { Pool } from "pg";

const ORG_ID = 7; // United Sports Group
const DRY_RUN = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// NZ timezone — DST runs from last Sunday of Sept to first Sunday of April.
// Returns the UTC offset for a given NZ-local date.
function nzOffset(dateStr: string): "+12:00" | "+13:00" {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (m < 4) return "+13:00";
  if (m === 4 && d < 5) return "+13:00";
  if (m === 9 && d >= 27) return "+13:00";
  if (m > 9) return "+13:00";
  return "+12:00";
}

function nz(dateStr: string, timeStr: string = "00:00"): Date {
  return new Date(`${dateStr}T${timeStr}:00${nzOffset(dateStr)}`);
}

// All-day end is 23:59:59 NZ local on the last day (matches public-holiday
// rows already in the calendar).
function nzEndOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59${nzOffset(dateStr)}`);
}

interface EventRow {
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  allDay?: boolean;
  calendarType?: string;
  color?: string;
}

const events: EventRow[] = [];

// ── 1. First Team fixtures ───────────────────────────────────────────────
// Color: green (CUFC brand).
const FIXTURES: Array<[string, string, "H" | "A", string, string]> = [
  // [date, time, H/A, venue, opponent]
  ["2026-03-21", "12:00", "H", "United Sports Centre", "Dunedin City Royals"],
  ["2026-03-28", "15:00", "A", "Foster Park", "Selwyn United FC"],
  ["2026-04-03", "17:00", "H", "United Sports Centre", "Nomads United"],
  ["2026-04-10", "19:15", "A", "Ferrymead Park", "Ferrymead Bays FC"],
  ["2026-04-18", "17:00", "H", "United Sports Centre", "Central Otago Senior Mens"],
  ["2026-04-27", "12:00", "H", "United Sports Centre", "Northern AFC"],
  ["2026-05-03", "14:00", "A", "Garrick Memorial Park", "Cashmere Technical"],
  ["2026-05-16", "12:00", "H", "United Sports Centre", "Nelson Suburbs FC"],
  ["2026-05-23", "17:00", "H", "United Sports Centre", "Coastal Spirit"],
  ["2026-06-06", "12:45", "A", "Dunedin Artificial Turf", "Dunedin City Royals"],
  ["2026-06-20", "17:00", "H", "United Sports Centre", "Selwyn United FC"],
  ["2026-06-27", "14:45", "A", "Tulett Park", "Nomads United"],
  ["2026-07-11", "17:00", "H", "United Sports Centre", "Ferrymead Bays FC"],
  ["2026-07-18", "14:00", "A", "Recreation Centre", "Central Otago Senior Mens"],
  ["2026-08-01", "17:00", "H", "United Sports Centre", "Cashmere Technical"],
  ["2026-08-09", "12:00", "A", "Saxton Fields", "Nelson Suburbs FC"],
  ["2026-08-22", "14:45", "A", "Linfield Park", "Coastal Spirit"],
  ["2026-08-30", "13:00", "A", "Caledonian Ground", "Northern AFC"],
];

FIXTURES.forEach(([date, time, ha, venue, opponent], idx) => {
  const [hh, mm] = time.split(":").map(Number);
  const start = nz(date, time);
  const end = nz(date, `${String(hh + 2).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  const haLabel = ha === "H" ? "Home" : "Away";
  events.push({
    title: `CUFC vs ${opponent}${ha === "A" ? " (Away)" : ""}`,
    description: `Round ${idx + 1} · ${haLabel} · 2026 Season fixture`,
    location: venue,
    startTime: start,
    endTime: end,
    calendarType: "united",
    color: "#22c55e",
  });
});

// ── 2. South Island Tournaments (Mainland Football) ──────────────────────
const SI_TOURNAMENTS: Array<[string, string, string, string]> = [
  // [age, dates-NZ-local-start..end, location, ...]
  ["10th Mixed Festival",  "2026-10-02", "2026-10-04", "Rolleston, Selwyn"],
  ["11th Girls Festival",  "2026-10-02", "2026-10-04", "Rolleston, Selwyn"],
  ["11th Mixed Jack McKnight Cup", "2026-10-02", "2026-10-04", "Nelson"],
  ["12th Mixed Gavin Roberts Festival", "2026-10-02", "2026-10-04", "Blenheim"],
  ["13th Girls Festival",  "2026-10-02", "2026-10-04", "Blenheim"],
  ["13th Mixed",           "2026-10-01", "2026-10-03", "Dunedin"],
  ["14th Mixed",           "2026-10-01", "2026-10-03", "Kaiapoi, Waimakariri"],
  ["15th Girls",           "2026-10-01", "2026-10-03", "Kaiapoi, Waimakariri"],
  ["15th Mixed",           "2026-09-27", "2026-09-29", "Timaru"],
];
for (const [age, from, to, loc] of SI_TOURNAMENTS) {
  events.push({
    title: `South Island ${age}`,
    description: "Mainland Football South Island Tournament",
    location: loc,
    startTime: nz(from),
    endTime: nzEndOfDay(to),
    allDay: true,
    calendarType: "south-island",
    color: "#3b82f6",
  });
}

// ── 3. Canterbury Regional Tournaments ───────────────────────────────────
const CR_TOURNAMENTS: Array<[string, string, string, string, string]> = [
  // [age, host, from, to, venue]
  ["10th Mixed",  "Selwyn Utd",     "2026-10-02", "2026-10-04", "Foster Park, Rolleston"],
  ["11th Mixed",  "Ferrymead Bays", "2026-09-30", "2026-10-02", "Ferrymead Park"],
  ["12th Mixed",  "FC Twenty 11",   "2026-09-30", "2026-10-02", "Avonhead Park"],
  ["13th Boys",   "FC Twenty 11",   "2026-10-03", "2026-10-05", "Avonhead Park"],
  ["14th Boys",   "Halswell United","2026-09-30", "2026-10-02", "Halswell Domain"],
  ["15th Boys",   "Selwyn Utd",     "2026-09-28", "2026-09-30", "Halswell Domain"],
  ["17th Boys",   "Halswell United","2026-09-30", "2026-10-02", "Halswell Domain"],
];
for (const [age, host, from, to, venue] of CR_TOURNAMENTS) {
  events.push({
    title: `Canterbury Regional ${age}`,
    description: `Hosted by ${host}`,
    location: venue,
    startTime: nz(from),
    endTime: nzEndOfDay(to),
    allDay: true,
    calendarType: "tournaments",
    color: "#3b82f6",
  });
}

// ── 4. Western Springs U17 ──────────────────────────────────────────────
// The existing entry stored Dec 9-13 with non-midnight bounds; rather than
// duplicate, the import skips it via the dedupe guard, but we attempt to
// upsert the correct dates. If the title matches an existing event we'll
// update its times — see refreshWesternSprings() below.
events.push({
  title: "Western Springs U17",
  description: "Auckland tournament",
  location: "Western Springs",
  startTime: nz("2026-12-10"),
  endTime: nzEndOfDay("2026-12-13"),
  allDay: true,
  calendarType: "tournaments",
  color: "#3b82f6",
});

// ── 5. Holiday Programme (Term 3 + Summer) ───────────────────────────────
const TERM3_DAYS = [
  "2026-09-28", "2026-09-29", "2026-09-30",
  "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06",
  "2026-10-07", "2026-10-08", "2026-10-09",
];
const SUMMER_DAYS = ["2026-12-21", "2026-12-22", "2026-12-23"];

for (const d of TERM3_DAYS) {
  events.push({
    title: "Holiday Programme",
    description: "Christchurch · Term 3 Holidays",
    location: "Christchurch",
    startTime: nz(d, "08:30"),
    endTime: nz(d, "15:30"),
    calendarType: "united",
    color: "#f59e0b",
  });
}
for (const d of SUMMER_DAYS) {
  events.push({
    title: "Holiday Programme",
    description: "Christchurch · Summer Holidays",
    location: "Christchurch",
    startTime: nz(d, "08:30"),
    endTime: nz(d, "15:30"),
    calendarType: "united",
    color: "#f59e0b",
  });
}

// ── 6. Holiday Programme Marketing milestones ────────────────────────────
interface Milestone { title: string; description: string; date: string; }
const TERM3_MARKETING: Milestone[] = [
  { date: "2026-07-20", title: "Marketing: Open Registrations (Term 3 Camp)",     description: "~10 wks out · open registrations for Term 3 holiday camp" },
  { date: "2026-07-27", title: "Marketing: Start Promotion (Term 3 Camp)",        description: "~9 wks out · emails, signage, social, promo video, community groups" },
  { date: "2026-08-31", title: "Marketing: Launch Paid Ads (Term 3 Camp)",        description: "~4 wks out · Meta + Google · low spend" },
  { date: "2026-09-14", title: "Marketing: Ramp Paid Ads — Medium (Term 3 Camp)", description: "~2 wks out · Meta + Google · medium spend" },
  { date: "2026-09-21", title: "Marketing: Ramp Paid Ads — High (Term 3 Camp)",   description: "~1 wk out · Meta + Google · high spend + monitor" },
  { date: "2026-09-25", title: "Marketing: What to Expect Email (Term 3 Camp)",   description: "~3 days out · templated email + info pack" },
];
const SUMMER_MARKETING: Milestone[] = [
  { date: "2026-10-12", title: "Marketing: Open Registrations (Summer Camp)",     description: "~10 wks out · open registrations for End of Year holiday camp" },
  { date: "2026-10-19", title: "Marketing: Start Promotion (Summer Camp)",        description: "~9 wks out · emails, signage, social, promo video, community groups" },
  { date: "2026-11-23", title: "Marketing: Launch Paid Ads (Summer Camp)",        description: "~4 wks out · Meta + Google · low spend" },
  { date: "2026-12-07", title: "Marketing: Ramp Paid Ads — Medium (Summer Camp)", description: "~2 wks out · Meta + Google · medium spend" },
  { date: "2026-12-14", title: "Marketing: Ramp Paid Ads — High (Summer Camp)",   description: "~1 wk out · Meta + Google · high spend + monitor" },
  { date: "2026-12-17", title: "Marketing: What to Expect Email (Summer Camp)",   description: "~3 days out · templated email + info pack" },
];
for (const m of [...TERM3_MARKETING, ...SUMMER_MARKETING]) {
  events.push({
    title: m.title,
    description: m.description,
    startTime: nz(m.date),
    endTime: nzEndOfDay(m.date),
    allDay: true,
    calendarType: "general",
    color: "#a855f7",
  });
}

// ── 7. U4-U8 Football Programme term blocks ──────────────────────────────
const U4U8_DESCRIPTION =
  "U4-U8 Football Programme · Weekdays 4:30pm – 5:15pm (all age groups) · " +
  "Saturdays U4-6 9:30am – 10:15am, U7-8 10:30am – 11:15am · public holidays excluded.";

events.push({
  title: "U4-U8 Football Programme — Term 2",
  description: U4U8_DESCRIPTION + " First session Fri 8 May 2026.",
  location: "United Sports Centre",
  startTime: nz("2026-05-08"),
  endTime: nzEndOfDay("2026-07-03"),
  allDay: true,
  calendarType: "united",
  color: "#10b981",
});
events.push({
  title: "U4-U8 Football Programme — Term 3",
  description: U4U8_DESCRIPTION,
  location: "United Sports Centre",
  startTime: nz("2026-07-20"),
  endTime: nzEndOfDay("2026-09-25"),
  allDay: true,
  calendarType: "united",
  color: "#10b981",
});
events.push({
  title: "U4-U8 Football Programme — Term 4",
  description: U4U8_DESCRIPTION,
  location: "United Sports Centre",
  startTime: nz("2026-10-12"),
  endTime: nzEndOfDay("2026-12-11"),
  allDay: true,
  calendarType: "united",
  color: "#10b981",
});

// ── Insert ───────────────────────────────────────────────────────────────

async function main() {
  const c = await pool.connect();
  let inserted = 0, skipped = 0, updatedWestern = 0;
  try {
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would attempt to insert ${events.length} events.`);
      for (const e of events) {
        console.log(`  ${e.startTime.toISOString()} · ${e.title} · ${e.location ?? ""}`);
      }
      return;
    }

    await c.query("BEGIN");

    // Refresh Western Springs U17 if an existing entry has wrong dates.
    const existingWS = await c.query<{ id: number; start_time: Date }>(
      `SELECT id, start_time FROM calendar_events WHERE organization_id = $1 AND title = 'Western Springs U17'`,
      [ORG_ID],
    );
    if (existingWS.rows.length === 1) {
      const target = nz("2026-12-10").toISOString();
      const current = existingWS.rows[0].start_time.toISOString();
      if (current !== target) {
        await c.query(
          `UPDATE calendar_events
             SET start_time = $1, end_time = $2, location = $3, updated_at = now()
           WHERE id = $4`,
          [nz("2026-12-10"), nzEndOfDay("2026-12-13"), "Western Springs", existingWS.rows[0].id],
        );
        updatedWestern = 1;
      }
    }

    for (const e of events) {
      const dup = await c.query(
        `SELECT id FROM calendar_events
         WHERE organization_id = $1 AND title = $2 AND start_time = $3`,
        [ORG_ID, e.title, e.startTime],
      );
      if (dup.rows.length > 0) { skipped++; continue; }

      await c.query(
        `INSERT INTO calendar_events
           (organization_id, title, description, location, start_time, end_time, all_day, calendar_type, color, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
        [
          ORG_ID,
          e.title,
          e.description ?? null,
          e.location ?? null,
          e.startTime,
          e.endTime,
          e.allDay ?? false,
          e.calendarType ?? "general",
          e.color ?? "#3b82f6",
        ],
      );
      inserted++;
    }

    await c.query("COMMIT");
    console.log(`✅ Inserted ${inserted}, skipped ${skipped} (duplicates), refreshed Western Springs: ${updatedWestern}`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error("❌", e); process.exit(1); });
