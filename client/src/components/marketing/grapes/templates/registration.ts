// Registrations open — the programme, the facts, what's included, register.
// The money email: one programme, one button, nothing in the way.
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
  questions: string;
  photo: number | null;
};

function copyFor(k: BrandKit, b: Brand): Copy {
  const site = k.site;
  const act = k.action ?? { label: "Register", href: site };
  switch (k.key) {
    case "cufc":
      return {
        preheader: "Pre-Academy U9 to U12 is open for Term 1 2027. Places go in order of payment.",
        lbl: "Registrations open", headA: "Pre-Academy U9 to U12", headB: " is open for Term 1",
        body: "Two sessions a week with the academy coaches, a Saturday game, and a pathway that runs all the way to the first team. Term 1 2027 registrations are open now.",
        more: [{ label: "Programme details", href: `${site}/register` }, { label: "Fees & term dates", href: `${site}/register` }],
        rows: [["Who", "Players born 2015 to 2018 (U9 to U12)"], ["When", "Tuesday & Thursday 5:45pm, Saturday game"], ["Where", "United Sports Centre, 466 Yaldhurst Road"], ["Cost", "$405 a term (U9 & U10) · $540 (U11 & U12)"]],
        cta: { label: "Register now", href: `${site}/lp/juniors` },
        note: "A place is confirmed when it's paid",
        included: ["Two coached sessions a week, ten weeks", "A Saturday game every weekend of the term", "The club training shirt, yours to keep"],
        questions: "Reply to this email or call the office, and we'll help you pick the right group.",
        photo: 1,
      };
    case "cugc":
      return {
        preheader: "Term 1 2027 enrolments are open at United Gymnastics. Try a free session first.",
        lbl: "Enrolments open", headA: "Term 1 2027", headB: " is open",
        body: "GymBasics for beginners, recreational classes by age, and the competitive squads, all with our own coaches on our own floor. Enrol now and your spot is held for the term.",
        more: [{ label: "Class timetable", href: `${site}/programs` }, { label: "Book a free session", href: `${site}/free-session` }],
        rows: [["Who", "Ages 2 to teens, every level"], ["When", "Weekday afternoons and Saturday mornings"], ["Where", "The gym"], ["Cost", "Fees by class on the timetable"]],
        cta: { label: "Enrol for Term 1", href: `${site}/enrol` },
        note: "New to the gym? Your first session is free",
        included: ["Coached classes every week of the term", "Progress badges as skills are passed", "Priority booking for the holiday programme"],
        questions: "Not sure which class? Reply with your child's age and we'll point you to the right one.",
        photo: 1,
      };
    case "mfl":
      return {
        preheader: "Term 1 2027 entries are open: 5-a-side and 7-a-side under lights. Three ways to pay.",
        lbl: "Entries open", headA: "Term 1 2027", headB: " entries are open",
        body: "Ten weeks of 5-a-side and 7-a-side under lights at United Sports Centre. Pick your night, enter your team, and pay upfront, by the week or split it between the squad.",
        more: [{ label: "Nights & divisions", href: site }, { label: "Three ways to pay", href: site }],
        rows: [["Who", "Social and competitive, men's, women's and mixed"], ["When", "Monday to Thursday nights, from Monday 2 February"], ["Where", "United Sports Centre, 466 Yaldhurst Road"], ["Cost", "Team fees by division on the entry page"]],
        cta: { label: "Enter a team", href: act.href },
        note: "A night closes when it fills",
        included: ["Ten league nights plus finals", "Referees, balls and bibs provided", "The captain's dashboard: squad, fixtures and the ladder"],
        questions: "Short a player or two? The fill-in pool is open, and we'll help you find a night that suits.",
        photo: 0,
      };
    case "cic":
      return {
        preheader: "Entries for the 2027 Christchurch International Cup are open.",
        lbl: "Entries open", headA: "CIC 2027", headB: " entries are open",
        body: "Five days of football in Christchurch next July. Clubs that registered interest are first in line; everyone else is welcome while places last.",
        more: [{ label: "Age groups & format", href: site }, { label: "Accommodation & travel", href: site }],
        rows: [["Who", "Boys' and girls' teams, U10 to U16"], ["When", "July 2027, five days"], ["Where", "United Sports Centre, Christchurch"], ["Cost", "Entry fees by age group on the website"]],
        cta: { label: "Enter a team", href: act.href },
        note: "A deposit holds the place; the balance is due in May",
        included: ["Guaranteed games every day of the tournament", "Opening and closing ceremonies", "A travel desk for flights, beds and buses"],
        questions: "Bringing more than one team? Reply and we'll set the club up in one go.",
        photo: 2,
      };
    case "siu":
      return {
        preheader: "2027 memberships are open. Pick your tier and lock in your seat.",
        lbl: "Memberships open", headA: "2027 membership", headB: " is open",
        body: "Every home match, your seat, your scarf, and first call on away travel. Memberships for the 2027 OFC Pro League season are open now.",
        more: [{ label: "Membership tiers", href: site }, { label: "Home fixtures", href: site }],
        rows: [["Who", "Adults, juniors and families"], ["When", "The whole 2027 season"], ["Where", "Every home match in Christchurch"], ["Cost", "Tiers and prices on the website"]],
        cta: { label: "Become a member", href: act.href },
        note: "Members renew at last year's price until 31 January",
        included: ["Your seat at every home match", "The members' scarf and pin", "First call on away travel and finals tickets"],
        questions: "Renewing from 2026? Your tier and seat are held; reply if anything has changed.",
        photo: 1,
      };
    default:
      return {
        preheader: `Registrations are open at ${b.name}.`,
        lbl: "Registrations open", headA: "The programme", headB: " is open",
        body: "Two sentences on what it is, who it's for and why now.",
        more: [{ label: "Programme details", href: site }, { label: "Fees & dates", href: site }],
        rows: [["Who", "Who it's for"], ["When", "Days and times"], ["Where", "The venue"], ["Cost", "The price"]],
        cta: { label: act.label, href: act.href },
        note: "A short note about places",
        included: ["What's included, one", "What's included, two", "What's included, three"],
        questions: "Reply to this email and we'll help.",
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
      [eyebrow(b, "At a glance"), facts(b, k, c.rows), button(b, k, c.cta, { align: "center", top: 22, bottom: 12 }), muted(b, c.note, 12, 0, "center")],
      { column: `background-color="${CARD}" border-radius="6px" padding="24px 24px 22px"`, padding: "14px 28px 6px" },
    ),
    section([label(b, k, "What's included"), bullets(b, k, c.included)], { padding: "18px 28px 10px", rule: true }),
    section([label(b, k, "Questions"), para(b, k, c.questions, undefined, 0)], { padding: "18px 28px 30px", rule: true }),
    footer(b, k),
  ].join("\n");
  return mjmlDoc({ ...b, bg: PAGE }, sections, c.preheader);
}

export const registrationTemplate: StarterTemplate = {
  id: "registration-open",
  name: "Registrations open",
  description: "One programme: who, when, where, cost, what's included and a register button.",
  category: "registration",
  brandKeys: "all",
  build,
};
