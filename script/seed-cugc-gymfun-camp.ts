/**
 * United Gymnastics — GymFun Holiday Camp, Mon 21 – Wed 23 Dec 2026, ages 4–8 (U4–U8).
 *
 * Daniel, 25 Nov 2026: "GymFun Holiday Camp, 21, 22nd 23rd december half day
 * 9am-12pm or 12pm-3pm or full day 9am-3pm half day is $30 same as football
 * camps and full day is $50 U4-U8 is the age group we are targeting."
 *
 * The first gymnastics programme on the ClubOS camp engine. Owned by org 6, so
 * every payment banks with the GYM's Stripe account (shared/camp-money-account.ts)
 * and the page renders the cugc.co.nz look (client/src/pages/cugc-camp-page.tsx).
 * Live at https://join.cugc.co.nz/gymfun
 *
 * Capacity 30 per session per day is a SAFE STARTING POINT, not a decision anyone
 * made — the football camps' 100 is a house default and a gym of 4–8 year olds is
 * a supervision ratio. Natalia raises it at Gymnastics → Holiday Camps, no deploy.
 * The day plan in `schedule` is a DRAFT for the gym to edit (Edit page).
 *
 * Dry run by default, one transaction, idempotent on slug (re-running updates the
 * copy and prices, never deletes a date that already has bookings).
 *
 *   npx tsx --env-file=.env script/seed-cugc-gymfun-camp.ts [--edition=dec|jan]   # dry run (dec default)
 *   npx tsx --env-file=.env script/seed-cugc-gymfun-camp.ts --commit
 *   npx tsx --env-file=.env script/seed-cugc-gymfun-camp.ts --close --commit   # registration_open = false
 */
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const CLOSE = process.argv.includes("--close");
const CUGC_ORG = 6;
// Each school-holiday run is its OWN programme row (dates, bookings, page);
// the admin groups them into one GymFun series by name (shared/programme-series.ts).
// Daniel 25 Nov 2026: "now open up january same price same time … 11th-15th jan
// mon-fri and same for 18-22 jan following week".
const EDITIONS = {
  dec: {
    slug: "gymfun",
    name: "GymFun Holiday Camp",
    dates: ["2026-12-21", "2026-12-22", "2026-12-23"],
    when: "21–23 December 2026",
    infoDates: "Mon 21 – Wed 23 Dec",
    howMany: "on one day or all three",
    friends: "Three days with kids their own age, right before Christmas.",
    heroSub: "Three days of gymnastics, games and new skills for 4 to 8 year olds, right before Christmas. Join us for a morning, an afternoon or the full day.",
    finalEyebrow: "21–23 December",
    finalTitle: "Save their spot before Christmas",
  },
  jan: {
    slug: "gymfun-january",
    name: "GymFun Holiday Camp January 2027",
    dates: ["2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15",
            "2027-01-18", "2027-01-19", "2027-01-20", "2027-01-21", "2027-01-22"],
    when: "11–15 and 18–22 January 2027",
    infoDates: "11–15 & 18–22 Jan",
    howMany: "on any of the ten weekdays",
    friends: "Two summer-holiday weeks with kids their own age.",
    heroSub: "Two weeks of summer-holiday gymnastics for 4 to 8 year olds, Monday to Friday, 11–15 and 18–22 January. Join us for a morning, an afternoon or the full day.",
    finalEyebrow: "11–15 & 18–22 January",
    finalTitle: "Save their summer spot",
  },
} as const;
const EDITION_KEY = (process.argv.find((a) => a.startsWith("--edition="))?.split("=")[1] ?? "dec") as keyof typeof EDITIONS;
const E = EDITIONS[EDITION_KEY];
if (!E) throw new Error(`unknown --edition (dec | jan)`);
const SLUG = E.slug;
const DATES: readonly string[] = E.dates;
const CAPACITY = 30;
const PRICES: Record<string, number> = { MORNING: 3000, AFTERNOON: 3000, FULL_DAY: 5000 };

const faq = [
  { q: "Does my child need any gymnastics experience?", a: "Not at all. GymFun is made for 4 to 8 year olds of every level, from first-timers to children already in our classes. Our coaches group them by age and ability so everyone has fun and learns something new." },
  { q: "What should they bring?", a: "Comfortable, fitted clothing (a leotard, or fitted shorts and a top), hair tied back, a water bottle and a snack. Full-day campers also need a packed lunch. No special footwear needed — socks are fine. We provide all the equipment." },
  { q: "Can I book just one day?", a: `Yes. Book a morning (9am – 12pm), an afternoon (12pm – 3pm) or a full day (9am – 3pm), ${E.howMany}. Brothers and sisters can be booked together in one checkout.` },
  { q: "What's the difference between two half days and a full day?", a: "A full day runs 9am to 3pm with a supervised lunch break, for $50. Booking the morning and the afternoon separately would cost $60, so the full day is the better deal." },
  { q: "Where is it?", a: "At United Gymnastics, 466 Yaldhurst Road, Christchurch — the United Sports Centre, right beside the football club. There's easy parking on site." },
  { q: "Any other questions?", a: "Email info@cugc.co.nz or call 021 535 005 and we'll help." },
];

const pc = {
  sessions: {
    MORNING: { label: "Morning", time: "9am – 12pm" },
    AFTERNOON: { label: "Afternoon", time: "12pm – 3pm" },
    FULL_DAY: { label: "Full day", time: "9am – 3pm" },
  },
  heroEyebrow: "School holiday camp · Ages 4–8",
  heroBadge: "days of gymnastics fun",
  infoDates: E.infoDates,
  infoDatesNote: EDITION_KEY === "jan" ? "Weekdays, book any day" : "Book one day or all three",
  infoAge: "Ages 4–8",
  infoAgeNote: "No experience needed",
  infoTimes: "9am – 3pm",
  infoTimesNote: "Mornings, afternoons or full days",
  infoLocation: "United Gymnastics",
  infoLocationAddress: "466 Yaldhurst Road",
  pricingTitle: "Pick your session",
  pricingSub: `A morning, an afternoon or the full day, ${E.howMany}. Secure online payment and instant confirmation.`,
  pricingFootnote: "Book brothers and sisters together in one checkout.",
  experienceTitle: "What they'll do",
  experienceSub: "A gymnastics camp made for little ones: moving, learning and laughing all day.",
  experience: [
    { icon: "Star", title: "Gymnastics skills", desc: "Floor skills, balance, jumps and stretches, coached in small groups by age and ability." },
    { icon: "Sparkles", title: "Hoops, balls & ribbons", desc: "A go with the hand apparatus our rhythmic gymnasts use." },
    { icon: "Music", title: "Games & music", desc: "Active games and moving to music, so the day flies by." },
    { icon: "Smile", title: "New friends", desc: E.friends },
  ],
  scheduleTitle: "A day at camp",
  scheduleSub: "A typical full day. Half-day campers join the morning or the afternoon block; times may shift a little on the day.",
  schedule: [
    { time: "9:00am", label: "Drop off and warm-up" },
    { time: "9:30am", label: "Skill stations in small groups" },
    { time: "10:30am", label: "Morning tea" },
    { time: "10:45am", label: "Hoops, balls and ribbons" },
    { time: "11:30am", label: "Games" },
    { time: "12:00pm", label: "Morning pick-up · afternoon drop-off · lunch for full-day campers" },
    { time: "12:30pm", label: "Skill stations in small groups" },
    { time: "1:30pm", label: "Afternoon tea" },
    { time: "1:45pm", label: "Moving to music and games" },
    { time: "3:00pm", label: "Pick up" },
  ],
  trustTitle: "Why United Gymnastics",
  trust: [
    { title: "Since 2020", desc: "Coaching children at our Yaldhurst Road gym for over five years." },
    { title: "Part of Christchurch United", desc: "The same not-for-profit club as Christchurch United Football Club, founded in 1976." },
    { title: "All levels welcome", desc: "First-timers to children already in our classes, grouped by age and ability." },
    { title: "Safe and supervised", desc: "Proper check-in and pick-up with our coaching team." },
  ],
  finalCtaEyebrow: E.finalEyebrow,
  finalCtaTitle: E.finalTitle,
  finalCtaSub: "United Gymnastics · 9am – 3pm · from $30",
  finalCtaButton: "Book now",
  stickyCtaText: "Book now · from $30",
};

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    const desc = `GymFun Holiday Camp for 4–8 year olds at United Gymnastics, ${E.when}. Mornings 9am – 12pm or afternoons 12pm – 3pm for $30, full days 9am – 3pm for $50.`;
    const fields = {
      organization_id: CUGC_ORG,
      name: E.name,
      type: "holiday_camp",
      description: desc,
      description_short: desc,
      hero_image: "/mailer/cugc/hero.jpg",
      hero_headline: "GymFun Holiday Camp",
      hero_subheadline: E.heroSub,
      location: "United Gymnastics, 466 Yaldhurst Road, Christchurch",
      start_date: DATES[0],
      end_date: DATES[DATES.length - 1],
      age_min: 4,
      age_max: 8,
      capacity: CAPACITY,
      is_active: true,
      registration_open: !CLOSE,
      primary_cta: "Book a spot",
      include_weekends: false,
      faq_json: JSON.stringify(faq),
      page_content_json: JSON.stringify(pc),
    };
    const existing = await c.query("select id, organization_id from programs where slug = $1", [SLUG]);
    let id: number;
    if (existing.rows.length) {
      if (existing.rows[0].organization_id !== CUGC_ORG) throw new Error(`slug ${SLUG} belongs to org ${existing.rows[0].organization_id}`);
      id = existing.rows[0].id;
      const cols = Object.keys(fields);
      await c.query(`update programs set ${cols.map((col, i) => `${col} = $${i + 2}`).join(", ")} where id = $1`, [id, ...cols.map((col) => (fields as any)[col])]);
      console.log(`updated programme ${id} ${SLUG}`);
    } else {
      const cols = ["slug", ...Object.keys(fields)];
      const vals = [SLUG, ...Object.values(fields)];
      const r = await c.query(`insert into programs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
      id = r.rows[0].id;
      console.log(`created programme ${id} ${SLUG}`);
    }
    for (const [type, cents] of Object.entries(PRICES)) {
      const u = await c.query("update camp_pricing set price_cents = $3 where camp_id = $1 and product_type = $2", [id, type, cents]);
      if (!u.rowCount) await c.query("insert into camp_pricing (camp_id, product_type, price_cents, currency) values ($1,$2,$3,'NZD')", [id, type, cents]);
    }
    for (const d of DATES) {
      const ex = await c.query("select id from camp_dates where camp_id = $1 and date = $2 and start_time is null", [id, d]);
      if (ex.rows.length) {
        await c.query("update camp_dates set capacity_full_day = $2, capacity_morning = $2, capacity_afternoon = $2 where id = $1", [ex.rows[0].id, CAPACITY]);
      } else {
        await c.query("insert into camp_dates (camp_id, date, capacity_full_day, capacity_morning, capacity_afternoon) values ($1,$2,$3,$3,$3)", [id, d, CAPACITY]);
      }
    }
    const check = await c.query(
      `select p.id, p.slug, p.organization_id, p.registration_open, p.is_active,
              (select json_agg(json_build_object('t',product_type,'c',price_cents) order by product_type) from camp_pricing where camp_id=p.id) pricing,
              (select json_agg(to_char(date,'YYYY-MM-DD') order by date) from camp_dates where camp_id=p.id) dates
         from programs p where p.id = $1`, [id]);
    console.log(JSON.stringify(check.rows[0]));
    if (COMMIT) { await c.query("COMMIT"); console.log("COMMITTED"); }
    else { await c.query("ROLLBACK"); console.log("dry run — rolled back (pass --commit)"); }
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
