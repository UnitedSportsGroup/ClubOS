/**
 * SIU Queenstown Holiday Camp, 21–23 Dec 2026, Jack Reid Park, Arrowtown —
 * in partnership with Queenstown AFC. Two camps, one programme row each,
 * because they have different ages, times and prices:
 *
 *   queenstown-camp        9–13 yrs · 9am – 1pm · $75 a day      (MORNING row)
 *   queenstown-camp-14-17  14–17 yrs · 3pm – 5pm · $50 a day     (AFTERNOON row)
 *                          ($150 for all three days = 3 × $50, no extra discount)
 *
 * Every fact comes from Zach's confirmed flyer
 * (~/Downloads/Queenstown-Camp-Flyer-Concepts-ALL.pdf, 4 Nov 2026:
 * "Pricing, dates, and venue are confirmed. Player line-up TBA").
 * Capacity 100/day is the house default, NOT a decision anyone made.
 *
 * Dry run by default, one transaction, idempotent on slug (re-running updates
 * the copy and prices, never deletes a date that already has bookings).
 *
 *   npx tsx --env-file=.env script/seed-siu-queenstown-camp.ts            # dry run
 *   npx tsx --env-file=.env script/seed-siu-queenstown-camp.ts --commit
 *   npx tsx --env-file=.env script/seed-siu-queenstown-camp.ts --close --commit   # registration_open = false
 */
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const CLOSE = process.argv.includes("--close");
const SIU_ORG = 2;
const DATES = ["2026-12-21", "2026-12-22", "2026-12-23"];
const CAPACITY = 100;
const HERO = "/brand-siu/queenstown-camp-hero.jpg";

const sharedFaq = [
  { q: "Who is coaching?", a: "South Island United coaches run every session, with professional players from the OFC Pro League joining the camp. The player line-up will be announced in the coming weeks." },
  { q: "Does my child need to play for a club?", a: "No. The camp is open to every young player in the Queenstown Lakes area and beyond, whichever club they play for, or if they don't play for one at all." },
  { q: "What should they bring?", a: "Boots (and trainers in case the ground is hard), shin pads, a full water bottle, a snack, sunscreen and a hat. We provide all the footballs and equipment." },
  { q: "Is a shirt included?", a: "Yes. Every camper gets an official South Island United shirt." },
  { q: "What if it rains?", a: "The camp runs rain or shine. If the weather makes the park unsafe we will contact you before the session." },
  { q: "Who are we in partnership with?", a: "The camp is run with Queenstown AFC at their home ground, Jack Reid Park in Arrowtown." },
];

const camps = [
  {
    slug: "queenstown-camp",
    name: "SIU Queenstown Holiday Camp (9–13)",
    ageMin: 9,
    ageMax: 13,
    type: "MORNING",
    priceCents: 7500,
    heroHeadline: "Queenstown Holiday Camp",
    heroSubheadline: "Three mornings of coaching with South Island United. Meet OFC Pro League players and put your questions to them. 21–23 December at Jack Reid Park, Arrowtown.",
    descriptionShort: "South Island United holiday camp for 9–13 year olds, 21–23 Dec 2026, 9am – 1pm, Jack Reid Park, Arrowtown. $75 a day.",
    pc: {
      sessions: { MORNING: { label: "Camp day", time: "9am – 1pm" } },
      trustBadge: "In partnership with Queenstown AFC",
      infoAge: "9–13 years",
      infoDatesWeek1: "Mon 21 – Wed 23 Dec 2026",
      infoDatesNote: "Book one day or all three",
      infoLocation: "Jack Reid Park",
      infoLocationAddress: "Arrowtown",
      infoPriceMorning: "$75 per day",
      scheduleEyebrow: "9am — 1pm",
      scheduleTitle: "What a Camp Day Looks Like",
      scheduleSub: "Four hours of football each morning, 21–23 December",
      schedule: [
        { time: "9:00 AM", label: "Drop off & welcome", highlight: true },
        { time: "9:15 AM", label: "Small-group technical coaching", highlight: false },
        { time: "10:30 AM", label: "Snack break", highlight: false },
        { time: "10:45 AM", label: "Skill challenges & small-sided games", highlight: false },
        { time: "12:00 PM", label: "Q&A with OFC Pro League players", highlight: false },
        { time: "12:30 PM", label: "Match play", highlight: false },
        { time: "1:00 PM", label: "Pick up", highlight: true },
      ],
      experienceTitle: "What Your Child Gets",
      experienceSub: "Coaching from the South Island's professional club, at home in the Wakatipu",
      experience: [
        { title: "Small-Group Coaching", desc: "Technical sessions in small groups, run by South Island United coaches" },
        { title: "Meet the Pros", desc: "OFC Pro League players on site, and a chance to put your questions to them" },
        { title: "Official SIU Shirt", desc: "Every camper takes home an official South Island United shirt" },
        { title: "Friends & Fun", desc: "Three mornings of football with players from across the region" },
      ],
      trustTitle: "Why South Island United",
      trustSub: "The South Island's professional club, coaching in Queenstown",
      trust: [
        { title: "OFC Pro League Club", desc: "South Island United plays in the OFC Pro League, the professional league of Oceania" },
        { title: "With Queenstown AFC", desc: "Run in partnership with Queenstown AFC at Jack Reid Park" },
        { title: "Professional Players", desc: "OFC Pro League players join the camp. Line-up announced in the coming weeks" },
        { title: "Safe & Supervised", desc: "Proper check-in and pick-up with SIU coaching staff" },
      ],
      statOne: "OFC Pro League", statOneLabel: "Professional Football",
      statTwo: "Jack Reid Park", statTwoLabel: "Arrowtown",
      statThree: "9–13 Years", statThreeLabel: "All Levels Welcome",
      pricingTitle: "Book Your Days",
      pricingSub: "Pick one day or all three. Secure online payment and instant confirmation.",
      pricingFootnote: "Pro player line-up announced in the coming weeks",
      finalCtaEyebrow: "21–23 December",
      finalCtaTitle: "Give Them a Summer Camp With the Pros",
      finalCtaSub: "Jack Reid Park, Arrowtown · 9am – 1pm · $75 a day",
      stickyCtaText: "Book now — $75 a day",
      footerDisclaimer: "South Island United Holiday Camp in partnership with Queenstown AFC.",
    },
  },
  {
    slug: "queenstown-camp-14-17",
    name: "SIU Queenstown Holiday Camp (14–17)",
    ageMin: 14,
    ageMax: 17,
    type: "AFTERNOON",
    priceCents: 5000,
    heroHeadline: "Queenstown Holiday Camp — 14–17",
    heroSubheadline: "Afternoon sessions for older players, with small-group coaching from South Island United players and the SIU coach on the final day. 21–23 December at Jack Reid Park, Arrowtown.",
    descriptionShort: "South Island United holiday camp for 14–17 year olds, 21–23 Dec 2026, 3pm – 5pm, Jack Reid Park, Arrowtown. $50 a day or $150 for all three.",
    pc: {
      sessions: { AFTERNOON: { label: "Afternoon session", time: "3pm – 5pm" } },
      trustBadge: "In partnership with Queenstown AFC",
      infoAge: "14–17 years",
      infoDatesWeek1: "Mon 21 – Wed 23 Dec 2026",
      infoDatesNote: "Book one day or all three",
      infoLocation: "Jack Reid Park",
      infoLocationAddress: "Arrowtown",
      infoPriceAfternoon: "$50/day or $150 for 3 days",
      scheduleEyebrow: "3pm — 5pm",
      scheduleTitle: "What a Session Looks Like",
      scheduleSub: "Two hours each afternoon, 21–23 December",
      schedule: [
        { time: "3:00 PM", label: "Arrive & warm up", highlight: true },
        { time: "3:15 PM", label: "Small-group technical coaching", highlight: false },
        { time: "4:15 PM", label: "Game play", highlight: false },
        { time: "5:00 PM", label: "Finish", highlight: true },
      ],
      experienceTitle: "What You Get",
      experienceSub: "Coaching from the South Island's professional club",
      experience: [
        { title: "Small-Group Coaching", desc: "Technical work in small groups, pitched at older players" },
        { title: "Train With SIU Players", desc: "South Island United players and the SIU coach run the final-day session" },
        { title: "Official SIU Shirt", desc: "Every player takes home an official South Island United shirt" },
        { title: "Three Afternoons", desc: "21, 22 and 23 December, 3pm – 5pm" },
      ],
      trustTitle: "Why South Island United",
      trustSub: "The South Island's professional club, coaching in Queenstown",
      trust: [
        { title: "OFC Pro League Club", desc: "South Island United plays in the OFC Pro League, the professional league of Oceania" },
        { title: "With Queenstown AFC", desc: "Run in partnership with Queenstown AFC at Jack Reid Park" },
        { title: "Pro Player Line-Up", desc: "Announced in the coming weeks" },
        { title: "Safe & Supervised", desc: "Run by SIU coaching staff" },
      ],
      statOne: "OFC Pro League", statOneLabel: "Professional Football",
      statTwo: "Jack Reid Park", statTwoLabel: "Arrowtown",
      statThree: "14–17 Years", statThreeLabel: "Older Players",
      pricingTitle: "Book Your Afternoons",
      pricingSub: "$50 a day, or book all three for $150. Secure online payment and instant confirmation.",
      pricingFootnote: "Pro player line-up announced in the coming weeks",
      finalCtaEyebrow: "21–23 December",
      finalCtaTitle: "Three Afternoons With the Pros",
      finalCtaSub: "Jack Reid Park, Arrowtown · 3pm – 5pm · $50 a day",
      stickyCtaText: "Book now — $50 a day",
      footerDisclaimer: "South Island United Holiday Camp in partnership with Queenstown AFC.",
    },
  },
];

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    for (const k of camps) {
      const fields = {
        organization_id: SIU_ORG,
        name: k.name,
        type: "holiday_camp",
        description: k.descriptionShort,
        description_short: k.descriptionShort,
        hero_image: HERO,
        hero_headline: k.heroHeadline,
        hero_subheadline: k.heroSubheadline,
        location: "Jack Reid Park, Arrowtown",
        start_date: DATES[0],
        end_date: DATES[DATES.length - 1],
        age_min: k.ageMin,
        age_max: k.ageMax,
        capacity: CAPACITY,
        is_active: true,
        registration_open: !CLOSE,
        primary_cta: "Book Now",
        include_weekends: false,
        faq_json: JSON.stringify(sharedFaq),
        page_content_json: JSON.stringify(k.pc),
      };
      const existing = await c.query("select id, organization_id from programs where slug = $1", [k.slug]);
      let id: number;
      if (existing.rows.length) {
        if (existing.rows[0].organization_id !== SIU_ORG) throw new Error(`slug ${k.slug} belongs to org ${existing.rows[0].organization_id}`);
        id = existing.rows[0].id;
        const cols = Object.keys(fields);
        await c.query(`update programs set ${cols.map((col, i) => `${col} = $${i + 2}`).join(", ")} where id = $1`, [id, ...cols.map((col) => (fields as any)[col])]);
        console.log(`updated programme ${id} ${k.slug}`);
      } else {
        const cols = ["slug", ...Object.keys(fields)];
        const vals = [k.slug, ...Object.values(fields)];
        const r = await c.query(`insert into programs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
        id = r.rows[0].id;
        console.log(`created programme ${id} ${k.slug}`);
      }
      // Exactly one sellable session type, at the flyer's price.
      await c.query("delete from camp_pricing where camp_id = $1 and product_type <> $2", [id, k.type]);
      const pr = await c.query("update camp_pricing set price_cents = $3 where camp_id = $1 and product_type = $2", [id, k.type, k.priceCents]);
      if (!pr.rowCount) await c.query("insert into camp_pricing (camp_id, product_type, price_cents, currency) values ($1,$2,$3,'NZD')", [id, k.type, k.priceCents]);
      for (const d of DATES) {
        const ex = await c.query("select id from camp_dates where camp_id = $1 and date = $2 and start_time is null", [id, d]);
        const capM = k.type === "MORNING" ? CAPACITY : 0;
        const capA = k.type === "AFTERNOON" ? CAPACITY : 0;
        if (ex.rows.length) {
          await c.query("update camp_dates set capacity_full_day = 0, capacity_morning = $2, capacity_afternoon = $3 where id = $1", [ex.rows[0].id, capM, capA]);
        } else {
          await c.query("insert into camp_dates (camp_id, date, capacity_full_day, capacity_morning, capacity_afternoon) values ($1,$2,0,$3,$4)", [id, d, capM, capA]);
        }
      }
      const check = await c.query(
        `select p.slug, p.registration_open, p.is_active, (select json_agg(json_build_object('t',product_type,'c',price_cents)) from camp_pricing where camp_id=p.id) pricing,
                (select json_agg(to_char(date,'YYYY-MM-DD') order by date) from camp_dates where camp_id=p.id) dates
           from programs p where p.id = $1`, [id]);
      console.log(JSON.stringify(check.rows[0]));
    }
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
