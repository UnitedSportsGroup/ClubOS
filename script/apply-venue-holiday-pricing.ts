/**
 * School-holiday pricing for United Sports Centre.
 *
 *   npx tsx --env-file=.env script/apply-venue-holiday-pricing.ts --dry-run   (default)
 *   npx tsx --env-file=.env script/apply-venue-holiday-pricing.ts --commit
 *
 * Runs the migration, declares the school-holiday date ranges, writes the
 * holiday pricing rules, and then PROVES the result by pricing real slots
 * through the same decider the checkout uses. Dry-run does all of it inside one
 * transaction and rolls back, so the rehearsal exercises the real constraints.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * A weekday morning in the school holidays is the venue's busiest time and was
 * being sold at the quiet-time rate, because `facility_pricing_rules` had no
 * concept of a date. Daniel, 2026-09-11: "during school holidays the peak time
 * becomes like 9am-9pm".
 *
 * ── THE TWO JUDGEMENT CALLS, BOTH DELIBERATE ─────────────────────────────────
 *
 * 🔴 1. WEEKDAYS ONLY. Holiday rules are written for Mon-Fri. A Saturday is a
 * Saturday whether or not school is in, and the weekend rules already price
 * 07:00-17:00 at peak. Writing the holiday window across all seven days would
 * have DROPPED Saturday 07:00-09:00 from peak to off-peak — a price cut nobody
 * asked for. Widening to weekends later is a one-line change to WEEKDAYS below.
 *
 * 🔴 2. WHERE THE SUMMER BREAK ENDS. The Ministry gazettes Term 1 as a WINDOW,
 * not a date — Term 1 2027 starts "between Thursday 28 January and Wednesday
 * 3 February" and each school picks inside it. A venue needs one date. We use
 * the LATEST possible start, so the summer break runs to Tue 2 Feb 2027.
 * That is the revenue-favourable end of the window and it is a choice, not a
 * fact: a school that goes back on 28 January is in term time on a day we are
 * charging holiday rates. It is defensible because in practice almost no NZ
 * school starts on the Thursday of that week, but it IS the club's call and it
 * is written here rather than buried.
 */
import "dotenv/config";
import pg from "pg";
import { readFileSync } from "fs";
import { resolveRate, perHourCentsForSize, type HolidayPeriod, type PricingRuleLike } from "../shared/venue-pricing";

const COMMIT = process.argv.includes("--commit");
/**
 * 🔴 ORDER MATTERS AND THE MIDDLE STATE IS THE DANGEROUS ONE.
 *
 * The code running on production TODAY does not know about `applies_to`: it
 * takes the first rule whose day and time window match. Seed the holiday rules
 * before that code is replaced and it will happily apply a holiday rule in TERM
 * TIME — repricing the live booking page for every customer.
 *
 * So: `--migrate-only` first (an empty table and a defaulted column change
 * nothing for anybody), THEN deploy, THEN `--commit` to write the data. The new
 * code with no periods declared prices exactly as the old code did, so every
 * step is safe on its own.
 */
const MIGRATE_ONLY = process.argv.includes("--migrate-only");
const VENUE_SLUG = "united-sports-centre";

/** Mon-Fri. See judgement call 1. */
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * The holiday window. 09:00-21:00 peak, tails either side off-peak — Daniel's
 * choice of the three options put to him on 2026-09-11.
 *
 * Rates are the venue's existing peak/off-peak pair, read from the rules that
 * are already live rather than retyped: peak $170.20 / $97.75 / $42.55 and
 * off-peak $109.25 / $74.75 / $27.31.
 */
const PEAK = { full: "170.20", half: "97.75", quarter: "42.55" };
const OFFPEAK = { full: "109.25", half: "74.75", quarter: "27.31" };

const HOLIDAY_WINDOWS = [
  { name: "Holiday early morning", startTime: "07:00", endTime: "09:00", rates: OFFPEAK },
  { name: "Holiday peak", startTime: "09:00", endTime: "21:00", rates: PEAK },
  { name: "Holiday late evening", startTime: "21:00", endTime: "22:00", rates: OFFPEAK },
];

/**
 * NZ school holidays, from the Ministry of Education's published term dates
 * (education.govt.nz/school-terms-and-holidays-dates, read 2026-09-11) and the
 * gazette notice behind them, 2025-sl2489 for 2027/2028.
 *
 * A holiday period is the day after a term ends to the day before the next term
 * starts, both inclusive. Term 4 end dates are published as "no later than", so
 * the break is taken from the day after that latest date — the conservative end
 * for a rate that RAISES a price.
 */
const HOLIDAY_PERIODS = [
  // Term 3 2026 ends Fri 25 Sep -> Term 4 starts Mon 12 Oct
  { name: "Term 3 holidays 2026", startsOn: "2026-09-26", endsOn: "2026-10-11" },
  // Term 4 2026 ends no later than Fri 18 Dec -> Term 1 2027 starts by Wed 3 Feb
  { name: "Summer holidays 2026/27", startsOn: "2026-12-19", endsOn: "2027-02-02" },
  // Term 1 2027 ends Fri 9 Apr -> Term 2 starts Tue 27 Apr
  { name: "Term 1 holidays 2027", startsOn: "2027-04-10", endsOn: "2027-04-26" },
  // Term 2 2027 ends Fri 2 Jul -> Term 3 starts Mon 19 Jul
  { name: "Term 2 holidays 2027", startsOn: "2027-07-03", endsOn: "2027-07-18" },
  // Term 3 2027 ends Fri 24 Sep -> Term 4 starts Mon 11 Oct
  { name: "Term 3 holidays 2027", startsOn: "2027-09-25", endsOn: "2027-10-10" },
  // Term 4 2027 ends no later than Fri 17 Dec -> Term 1 2028 starts by Tue 8 Feb
  { name: "Summer holidays 2027/28", startsOn: "2027-12-18", endsOn: "2028-02-07" },
  // Term 1 2028 ends Thu 13 Apr -> Term 2 starts Mon 1 May
  { name: "Term 1 holidays 2028", startsOn: "2028-04-14", endsOn: "2028-04-30" },
  // Term 2 2028 ends Fri 7 Jul -> Term 3 starts Mon 24 Jul
  { name: "Term 2 holidays 2028", startsOn: "2028-07-08", endsOn: "2028-07-23" },
  // Term 3 2028 ends Fri 29 Sep -> Term 4 starts Mon 16 Oct
  { name: "Term 3 holidays 2028", startsOn: "2028-09-30", endsOn: "2028-10-15" },
];

const SOURCE_NOTE =
  "NZ Ministry of Education published term dates (education.govt.nz), read 2026-09-11. " +
  "Summer breaks run to the day before the LATEST gazetted Term 1 start — a deliberate choice, see apply-venue-holiday-pricing.ts.";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ""}`); }
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    const { rows: orgs } = await c.query(`select id, name from organizations where slug = $1`, [VENUE_SLUG]);
    if (orgs.length !== 1) throw new Error(`Expected one org for slug ${VENUE_SLUG}, got ${orgs.length}`);
    const orgId = orgs[0].id as number;
    console.log(`\nVenue: ${orgs[0].name} (org ${orgId})\n`);

    // ── 1. Migration ─────────────────────────────────────────────────────────
    console.log("Migration");
    const sql = readFileSync(new URL("../migrations/2026-09-11_venue_holiday_pricing.sql", import.meta.url), "utf8");
    if (/^\s*(BEGIN|COMMIT)\b/im.test(sql)) throw new Error("Migration contains its own BEGIN/COMMIT — that defeats --dry-run");
    await c.query(sql);
    check("venue_holiday_periods exists", (await c.query(`select to_regclass('venue_holiday_periods') r`)).rows[0].r !== null);
    check("facility_pricing_rules.applies_to exists",
      (await c.query(`select 1 from information_schema.columns where table_name='facility_pricing_rules' and column_name='applies_to'`)).rowCount === 1);
    check("every pre-existing rule defaulted to 'always'",
      (await c.query(`select count(*)::int n from facility_pricing_rules where applies_to <> 'always'`)).rows[0].n === 0);

    // ── 2. The invariants are real, proven by writes that must be REFUSED ─────
    console.log("\nInvariants (each proven by a refused insert)");
    const refused = async (label: string, q: string, params: any[]) => {
      await c.query("SAVEPOINT sp");
      try { await c.query(q, params); await c.query("ROLLBACK TO sp"); check(label, false, "the insert was ACCEPTED"); }
      catch { await c.query("ROLLBACK TO sp"); check(label, true); }
    };
    await c.query(
      `insert into venue_holiday_periods (organization_id,name,starts_on,ends_on) values ($1,'probe','2030-01-10','2030-01-20')`, [orgId]);
    await refused("a period ending before it starts is refused",
      `insert into venue_holiday_periods (organization_id,name,starts_on,ends_on) values ($1,'bad','2030-03-10','2030-03-01')`, [orgId]);
    await refused("an OVERLAPPING period for the same venue is refused",
      `insert into venue_holiday_periods (organization_id,name,starts_on,ends_on) values ($1,'overlap','2030-01-15','2030-01-25')`, [orgId]);
    await c.query(`delete from venue_holiday_periods where name = 'probe'`);

    if (MIGRATE_ONLY) {
      console.log("\n--migrate-only: schema is in place, NO data written.");
      console.log("Next: deploy the code, then re-run with --commit.\n");
      if (COMMIT) { await c.query("COMMIT"); console.log("✅ SCHEMA COMMITTED\n"); }
      else { await c.query("ROLLBACK"); console.log("↩️  DRY RUN — rolled back.\n"); }
      await c.end();
      return;
    }

    // ── 3. Declare the holidays ──────────────────────────────────────────────
    console.log("\nSchool holiday periods");
    await c.query(`delete from venue_holiday_periods where organization_id = $1`, [orgId]);
    for (const p of HOLIDAY_PERIODS) {
      await c.query(
        `insert into venue_holiday_periods (organization_id,name,starts_on,ends_on,source_note) values ($1,$2,$3,$4,$5)`,
        [orgId, p.name, p.startsOn, p.endsOn, SOURCE_NOTE]);
    }
    const { rows: periodRows } = await c.query(
      `select name, to_char(starts_on,'YYYY-MM-DD') s, to_char(ends_on,'YYYY-MM-DD') e
         from venue_holiday_periods where organization_id=$1 order by starts_on`, [orgId]);
    for (const p of periodRows) console.log(`  · ${p.s} → ${p.e}  ${p.name}`);
    check(`${HOLIDAY_PERIODS.length} periods written`, periodRows.length === HOLIDAY_PERIODS.length);

    // ── 4. Holiday pricing rules, on the pitches that HAVE a peak rate ───────
    // Mini pitches and the meeting room are a single flat rate with no peak /
    // off-peak split at all, so there is nothing for a holiday window to change.
    // They are deliberately left alone rather than given an invented peak rate.
    console.log("\nHoliday pricing rules");
    const { rows: pitches } = await c.query(
      `select distinct f.id, f.name from facilities f
         join facility_pricing_rules r on r.facility_id = f.id
        where f.organization_id = $1 and f.active order by f.id`, [orgId]);
    if (pitches.length === 0) throw new Error("No facilities with pricing rules — refusing to seed holiday rules blind");

    await c.query(
      `delete from facility_pricing_rules where applies_to='school_holidays'
         and facility_id in (select id from facilities where organization_id=$1)`, [orgId]);
    let written = 0;
    for (const f of pitches) {
      for (const dow of WEEKDAYS) {
        for (const w of HOLIDAY_WINDOWS) {
          await c.query(
            `insert into facility_pricing_rules
               (facility_id,name,day_of_week,start_time,end_time,price_per_hour,
                half_field_price_per_hour,quarter_field_price_per_hour,is_default,applies_to)
             values ($1,$2,$3,$4,$5,$6,$7,$8,false,'school_holidays')`,
            [f.id, w.name, dow, w.startTime, w.endTime, w.rates.full, w.rates.half, w.rates.quarter]);
          written++;
        }
      }
    }
    console.log(`  · ${pitches.map((p: any) => p.name).join(", ")}`);
    check(`${written} holiday rules written (${pitches.length} pitches × ${WEEKDAYS.length} weekdays × ${HOLIDAY_WINDOWS.length} windows)`,
      written === pitches.length * WEEKDAYS.length * HOLIDAY_WINDOWS.length);

    // ── 5. PROVE IT — price real slots through the real decider ──────────────
    console.log("\nPricing, through the same decider the checkout uses");
    const { rows: facRows } = await c.query(
      `select id,name,price_per_hour_cents,half_field_price_per_hour_cents,quarter_field_price_per_hour_cents
         from facilities where id = $1`, [pitches[0].id]);
    const fac = {
      pricePerHourCents: facRows[0].price_per_hour_cents,
      halfFieldPricePerHourCents: facRows[0].half_field_price_per_hour_cents,
      quarterFieldPricePerHourCents: facRows[0].quarter_field_price_per_hour_cents,
    };
    const { rows: ruleRows } = await c.query(
      `select day_of_week "dayOfWeek", start_time "startTime", end_time "endTime",
              price_per_hour "pricePerHour", half_field_price_per_hour "halfFieldPricePerHour",
              quarter_field_price_per_hour "quarterFieldPricePerHour", is_default "isDefault", applies_to "appliesTo"
         from facility_pricing_rules where facility_id = $1`, [pitches[0].id]);
    const rules = ruleRows as PricingRuleLike[];
    const periods: HolidayPeriod[] = periodRows.map((p: any) => ({ startsOn: p.s, endsOn: p.e, name: p.name }));

    const rate = (date: string, startTime: string, endTime: string) =>
      perHourCentsForSize(resolveRate({ date, startTime, endTime }, fac, rules, periods), fac, null);

    // The Barça camp — Mon 25 to Fri 29 Jan 2027, 09:00-15:00. The whole reason.
    for (const d of ["2027-01-25", "2027-01-26", "2027-01-27", "2027-01-28", "2027-01-29"]) {
      check(`${d} 09:00 is PEAK $170.20`, rate(d, "09:00", "09:30") === 17020, `got $${(rate(d, "09:00", "09:30") / 100).toFixed(2)}`);
    }
    const campHourly = rate("2027-01-25", "09:00", "10:00");
    const campTotal = campHourly * 2 /* pitches */ * 5 /* days */ * 6 /* hours */;
    check(`60 pitch-hours at the holiday rate = $10,212.00 (matches quote CUFC-2026-013)`, campTotal === 1021200,
      `got $${(campTotal / 100).toFixed(2)}`);

    check("holiday weekday 08:00 is still OFF-PEAK $109.25", rate("2027-01-25", "08:00", "08:30") === 10925);
    check("holiday weekday 20:30 is PEAK $170.20", rate("2027-01-25", "20:30", "21:00") === 17020);
    check("holiday weekday 21:00 is OFF-PEAK $109.25", rate("2027-01-25", "21:00", "21:30") === 10925);

    // 🔴 The regression that matters most: TERM TIME MUST NOT MOVE.
    // Mon 24 Aug 2026 and Mon 2 Nov 2026 are both term-time Mondays.
    check("TERM-TIME weekday 09:00 unchanged at $109.25", rate("2026-11-02", "09:00", "09:30") === 10925,
      `got $${(rate("2026-11-02", "09:00", "09:30") / 100).toFixed(2)}`);
    check("TERM-TIME weekday 15:00 unchanged at $170.20", rate("2026-11-02", "15:00", "15:30") === 17020);
    check("TERM-TIME weekday 21:00 unchanged at $170.20", rate("2026-11-02", "21:00", "21:30") === 17020);

    // Weekends untouched, in and out of the holidays. Sat 2027-01-30, Sun 2027-01-31.
    check("holiday SATURDAY 08:00 unchanged at peak $170.20", rate("2027-01-30", "08:00", "08:30") === 17020);
    check("holiday SUNDAY 18:00 unchanged at off-peak $109.25", rate("2027-01-31", "18:00", "18:30") === 10925);

    // Boundaries of the summer period itself.
    check("Fri 18 Dec 2026 (last day of term) 09:00 is off-peak", rate("2026-12-18", "09:00", "09:30") === 10925);
    check("Mon 21 Dec 2026 (first weekday of the break) 09:00 is PEAK", rate("2026-12-21", "09:00", "09:30") === 17020);
    check("Tue 2 Feb 2027 (last day of the break) 09:00 is PEAK", rate("2027-02-02", "09:00", "09:30") === 17020);
    check("Wed 3 Feb 2027 (Term 1 back) 09:00 is off-peak again", rate("2027-02-03", "09:00", "09:30") === 10925);

    // Half and quarter pitches follow the same window.
    const half = (date: string, s: string, e: string) =>
      perHourCentsForSize(resolveRate({ date, startTime: s, endTime: e }, fac, rules, periods), fac, "half");
    check("holiday 09:00 HALF pitch is $97.75", half("2027-01-25", "09:00", "09:30") === 9775);
    check("term-time 09:00 HALF pitch unchanged at $74.75", half("2026-11-02", "09:00", "09:30") === 7475);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) throw new Error(`${fail} checks failed — nothing written`);

    if (COMMIT) { await c.query("COMMIT"); console.log("\n✅ COMMITTED\n"); }
    else { await c.query("ROLLBACK"); console.log("\n↩️  DRY RUN — rolled back. Re-run with --commit to apply.\n"); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n❌", (e as Error).message, "\n");
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
