// Match day — one fixture, the facts, a ticket button, how to get there.
// The Auckland FC ticket push, in the club newsletter's language.
import { brand, mjmlDoc, type Brand } from "./sections";
import { brandKit, type BrandKit } from "./brand-kit";
import { section, header, label, photo, hero, headline, para, links, bullets, button, muted, facts, eyebrow, footer, PAGE, CARD } from "./pieces";
import type { StarterTemplate } from "./types";

type Copy = {
  preheader: string;
  headA: string; headB: string;
  body: string;
  more: { label: string; href: string }[];
  rows: [string, string][];
  cta: { label: string; href: string };
  note: string;
  before: string[];
  watch: string;
};

function copyFor(k: BrandKit, b: Brand): Copy {
  const site = k.site;
  const act = k.action ?? { label: "Find out more", href: site };
  switch (k.key) {
    case "siu":
      return {
        preheader: "South Island United v Bula FC — Tuesday, 7:30pm. Tickets inside.",
        headA: "South Island United", headB: " vs Bula FC",
        body: "The second match of the OFC Pro League season, and the first in front of our own crowd. Rob Sherman's side meet familiar faces in Bula FC on Tuesday night.",
        more: [{ label: "Match preview", href: site }, { label: "Team news & availability", href: site }],
        rows: [["Date", "Tuesday 18 May"], ["Kick-off", "7:30pm"], ["Venue", "Christchurch"], ["Tickets", "From $15 · kids free with an adult"]],
        cta: { label: "Get tickets", href: act.href },
        note: "Tickets via Ticketmaster",
        before: ["Gates open 90 minutes before kick-off", "Free parking at the ground; buses run every 15 minutes from the city", "The fan zone opens at 6pm with food trucks and the kids' skills challenge"],
        watch: "Every South Island United match streams live on TVNZ+. Follow the club for the link on the day.",
      };
    case "cufc":
      return {
        preheader: "Christchurch United v Nelson Suburbs — Saturday, 2pm at United Sports Centre.",
        headA: "Christchurch United", headB: " vs Nelson Suburbs",
        body: "The first team are back at United Sports Centre on Saturday. Bring the family, back the boys, and stay for the academy showcase at half time.",
        more: [{ label: "Match preview", href: `${site}/news` }, { label: "Fixtures & results", href: site }],
        rows: [["Date", "Saturday 1 November"], ["Kick-off", "2:00pm"], ["Venue", "United Sports Centre, 466 Yaldhurst Road"], ["Entry", "Free for members · $5 on the gate"]],
        cta: { label: "Match details", href: site },
        note: "Members show their card at the gate",
        before: ["Gates open at 1pm; the café is open all afternoon", "Parking is on site, with overflow on Yaldhurst Road", "Academy players in club kit get in free with a parent"],
        watch: "Highlights and the full-time report land on Instagram and the club website the same evening.",
      };
    case "cic":
      return {
        preheader: "Finals day at United Sports Centre — the schedule, the pitches and where to park.",
        headA: "Finals day", headB: " at United Sports Centre",
        body: "Five days of football come down to one afternoon. Every age group's final, the closing ceremony and the trophy presentations, all on one site.",
        more: [{ label: "Finals schedule", href: site }, { label: "Pitch map", href: site }],
        rows: [["Date", "Friday 10 July"], ["First final", "10:00am"], ["Venue", "United Sports Centre, 466 Yaldhurst Road"], ["Entry", "Free for all spectators"]],
        cta: { label: "See the schedule", href: act.href },
        note: "Closing ceremony at 4:30pm on Pitch S1",
        before: ["Gates open at 9am; parking fills by 10, so share a ride", "Food trucks and the merchandise tent are beside Pitch S1", "Team photographs are taken straight after each final"],
        watch: "Every final streams live on our platform, with highlights on the website that night.",
      };
    case "mfl":
      return {
        preheader: "Grand final night — the fixtures, the times and the after-match.",
        headA: "Grand final night", headB: " at United Sports Centre",
        body: "Ten weeks come down to one night. Every division's final under lights, then the prize-giving and a drink at the bar.",
        more: [{ label: "Grand final fixtures", href: site }, { label: "The ladder", href: site }],
        rows: [["Date", "Thursday 9 April"], ["First kick-off", "6:00pm"], ["Venue", "United Sports Centre, 466 Yaldhurst Road"], ["Entry", "Free · bring your supporters"]],
        cta: { label: "See the fixtures", href: site },
        note: "Prize-giving at 9:15pm by the bar",
        before: ["Teams check in at the desk 15 minutes before kick-off", "Parking is on site; the gate opens at 5:30pm", "Goal of the season is announced at the prize-giving"],
        watch: "Goal of the week and the finals highlights go up on Instagram on Friday.",
      };
    default:
      return {
        preheader: `${b.name} — the next match, the facts and tickets.`,
        headA: b.name, headB: " vs the opposition",
        body: "A sentence on why this one matters, who's in form and what's at stake.",
        more: [{ label: "Match preview", href: site }, { label: "Team news", href: site }],
        rows: [["Date", "Saturday"], ["Kick-off", "2:00pm"], ["Venue", "United Sports Centre"], ["Tickets", "From $"]],
        cta: { label: act.label, href: act.href },
        note: "A short note about tickets",
        before: ["When the gates open", "How to get there and where to park", "What's on before kick-off"],
        watch: "Where to watch if you can't be there.",
      };
  }
}

function build(brandKey: string): string {
  const b = brand(brandKey);
  const k = brandKit(brandKey);
  const c = copyFor(k, b);
  const sections = [
    header(b, k),
    section([label(b, k, "Match day")], { padding: "26px 28px 0" }),
    hero(b, k, k.photos.length ? 0 : null, `${c.headA}${c.headB}`, c.cta.href),
    section([headline(b, k, c.headA, c.headB), para(b, k, c.body), links(b, k, c.more)], { padding: "0 28px 10px" }),
    section(
      [eyebrow(b, "The details"), facts(b, k, c.rows), button(b, k, c.cta, { align: "center", top: 22, bottom: 12 }), muted(b, c.note, 12, 0, "center")],
      { column: `background-color="${CARD}" border-radius="6px" padding="24px 24px 22px"`, padding: "14px 28px 6px" },
    ),
    section([label(b, k, "Before you go"), bullets(b, k, c.before)], { padding: "18px 28px 10px", rule: true }),
    section([label(b, k, "Can't make it"), para(b, k, c.watch, undefined, 0)], { padding: "18px 28px 30px", rule: true }),
    footer(b, k),
  ].join("\n");
  return mjmlDoc({ ...b, bg: PAGE }, sections, c.preheader);
}

export const matchdayTemplate: StarterTemplate = {
  id: "matchday-fixture",
  name: "Match day",
  description: "One fixture: the photo, the facts, a ticket button, how to get there and where to watch.",
  category: "matchday",
  brandKeys: ["siu", "cufc", "cic", "mfl"],
  build,
};
