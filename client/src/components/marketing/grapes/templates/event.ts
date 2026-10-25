// Event & camp — dates, times, where, cost, what's included, book.
import { brand, mjmlDoc, type Brand } from "./sections";
import { brandKit, type BrandKit } from "./brand-kit";
import { section, header, label, hero, headline, para, links, bullets, button, muted, facts, eyebrow, footer, PAGE, CARD } from "./pieces";
import type { StarterTemplate } from "./types";

type Copy = {
  preheader: string;
  lbl: string;
  headA: string; headB: string;
  body: string;
  more: { label: string; href: string }[];
  rows: [string, string][];
  cta: { label: string; href: string };
  note: string;
  included: string[];
  know: string;
  photo: number | null;
};

function copyFor(k: BrandKit, b: Brand): Copy {
  const site = k.site;
  const act = k.action ?? { label: "Book now", href: site };
  switch (k.key) {
    case "cufc":
      return {
        preheader: "Summer holiday camps are open: FUNdamentals U4 to U8 and the World Cup camp U9 to U13.",
        lbl: "Holiday camps", headA: "Summer camps", headB: " are open",
        body: "Two camps, one home: FUNdamentals for U4 to U8 and the World Cup camp for U9 to U13, run by the academy coaches at United Sports Centre. Half days or full days, any days you like.",
        more: [{ label: "FUNdamentals U4 to U8", href: `${site}/programmes/holiday` }, { label: "World Cup camp U9 to U13", href: `${site}/programmes/holiday` }],
        rows: [["Dates", "Summer holidays, January 2027"], ["Times", "Half day 9am to 12pm · full day 9am to 3pm"], ["Where", "United Sports Centre, 466 Yaldhurst Road"], ["Cost", "$30 a half day · $50 a full day"]],
        cta: { label: "Book a camp", href: `${site}/programmes/holiday` },
        note: "Pick the days that suit; siblings can book together",
        included: ["Coached sessions, small-sided games and a tournament on the last day", "A camp shirt and a certificate", "Morning tea on us; bring lunch for a full day"],
        know: "Drop-off is from 8:45am. Every child is signed in and out to a named adult, and allergies noted at booking are on the roll.",
        photo: 2,
      };
    case "cugc":
      return {
        preheader: "The holiday programme is open: full days of gymnastics, games and fun at the gym.",
        lbl: "Holiday programme", headA: "Holiday programme", headB: " is open",
        body: "Full days of gymnastics, games and craft across the school holidays, run by our own coaches at the gym. New faces welcome, no experience needed.",
        more: [{ label: "Dates & how to book", href: site }, { label: "What to bring", href: site }],
        rows: [["Dates", "Every weekday of the holidays"], ["Times", "9am to 3pm, drop-off from 8:30"], ["Where", "The gym"], ["Cost", "Day rates on the booking page"]],
        cta: { label: "Book the holiday programme", href: act.href },
        note: "Book single days or the whole week",
        included: ["Coached gymnastics morning and afternoon", "Games, craft and a quiet hour after lunch", "A badge for every new skill"],
        know: "Bring lunch, a water bottle and clothes to move in. Long hair tied back, no jewellery on the floor.",
        photo: 3,
      };
    case "mfl":
      return {
        preheader: "The summer social league is open: six weeks of 5-a-side under lights.",
        lbl: "Summer league", headA: "Summer social league", headB: " is open",
        body: "Six weeks of 5-a-side under lights while the evenings are long. Mixed, men's and women's nights, all social, all at United Sports Centre.",
        more: [{ label: "Nights & dates", href: site }, { label: "Enter a team", href: act.href }],
        rows: [["Dates", "Six weeks from Monday 1 December"], ["Times", "Kick-offs from 6:00pm to 9:00pm"], ["Where", "United Sports Centre, 466 Yaldhurst Road"], ["Cost", "Team fee on the entry page · pay once or split it"]],
        cta: { label: "Enter a team", href: act.href },
        note: "Nights close when they fill",
        included: ["Six league nights plus a finals night", "Referees, balls and bibs", "The captain's dashboard for squad and fixtures"],
        know: "Short a player? List your team's gap in the fill-in pool and we'll find you someone for the night.",
        photo: 2,
      };
    case "siu":
      return {
        preheader: "Open training and fan day at United Sports Centre. Free, bring the kids.",
        lbl: "Fan day", headA: "Open training", headB: " & fan day",
        body: "Watch the squad train up close, meet the players, get the shirt signed and take the kids onto the turf for a skills session with the coaches. Free, no booking needed.",
        more: [{ label: "The afternoon's timetable", href: site }, { label: "Getting there", href: site }],
        rows: [["Date", "Tuesday 13 January"], ["Times", "9:15am training · 11am meet the squad"], ["Where", "United Sports Centre, 466 Yaldhurst Road"], ["Cost", "Free"]],
        cta: { label: "Plan your visit", href: site },
        note: "The club shop is open all morning",
        included: ["Open training, 9:15 to 10:30", "Signing session with the squad", "A kids' skills session with the coaches"],
        know: "Parking is on site and the café is open from 8:30am. Bring a shirt to sign and a ball for the kids.",
        photo: 2,
      };
    case "cic":
      return {
        preheader: "The opening ceremony: every team, every flag, one night in Christchurch.",
        lbl: "Opening ceremony", headA: "Opening ceremony", headB: " 2027",
        body: "Every team walks in behind its flag, the anthems, the welcome, and the first whistle of the tournament the next morning. Families and supporters are welcome.",
        more: [{ label: "The order of ceremony", href: site }, { label: "Getting there", href: site }],
        rows: [["Date", "Sunday 5 July"], ["Times", "Teams assemble 5pm · ceremony 6pm"], ["Where", "United Sports Centre, 466 Yaldhurst Road"], ["Cost", "Free"]],
        cta: { label: "See the programme", href: site },
        note: "Teams wear match kit; managers collect packs from 4pm",
        included: ["The parade of teams", "The welcome and the anthems", "Food trucks and the merchandise tent"],
        know: "Parking fills early; buses from the accommodation partners leave at 4:30pm.",
        photo: 1,
      };
    default:
      return {
        preheader: `An event at ${b.name}.`,
        lbl: "Event", headA: "The event", headB: " is on",
        body: "Two sentences on what it is, who it's for and why it's worth the trip.",
        more: [{ label: "Details", href: site }, { label: "Getting there", href: site }],
        rows: [["Dates", "The dates"], ["Times", "The times"], ["Where", "The venue"], ["Cost", "The cost"]],
        cta: { label: act.label, href: act.href },
        note: "A short note about booking",
        included: ["What's included, one", "What's included, two", "What's included, three"],
        know: "Anything people should know before they come.",
        photo: k.photos.length ? 0 : null,
      };
  }
}

function build(brandKey: string): string {
  const b = brand(brandKey);
  const k = brandKit(brandKey);
  const c = copyFor(k, b);
  const sections = [
    header(b, k),
    section([label(b, k, c.lbl)], { padding: "26px 28px 0" }),
    hero(b, k, c.photo, `${c.headA}${c.headB}`, c.cta.href),
    section([headline(b, k, c.headA, c.headB), para(b, k, c.body), links(b, k, c.more)], { padding: "0 28px 10px" }),
    section(
      [eyebrow(b, "The details"), facts(b, k, c.rows), button(b, k, c.cta, { align: "center", top: 22, bottom: 12 }), muted(b, c.note, 12, 0, "center")],
      { column: `background-color="${CARD}" border-radius="6px" padding="24px 24px 22px"`, padding: "14px 28px 6px" },
    ),
    section([label(b, k, "What's included"), bullets(b, k, c.included)], { padding: "18px 28px 10px", rule: true }),
    section([label(b, k, "Good to know"), para(b, k, c.know, undefined, 0)], { padding: "18px 28px 30px", rule: true }),
    footer(b, k),
  ].join("\n");
  return mjmlDoc({ ...b, bg: PAGE }, sections, c.preheader);
}

export const eventTemplate: StarterTemplate = {
  id: "event-camp",
  name: "Event & camp",
  description: "A camp or an event: the photo, dates, times, where, cost, what's included and a booking button.",
  category: "event",
  brandKeys: "all",
  build,
};
