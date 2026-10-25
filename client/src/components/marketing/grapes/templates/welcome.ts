// Welcome — a warm first email with what happens next and one button.
import { brand, mjmlDoc, type Brand } from "./sections";
import { brandKit, type BrandKit } from "./brand-kit";
import { section, header, label, hero, headline, para, bullets, button, footer, PAGE } from "./pieces";
import type { StarterTemplate } from "./types";

type Copy = { preheader: string; body: string; next: string[]; cta: { label: string; href: string }; close: string; photo: number | null };

function copyFor(k: BrandKit, b: Brand): Copy {
  const site = k.site;
  const act = k.action ?? { label: "Find out more", href: site };
  switch (k.key) {
    case "cufc":
      return {
        preheader: "Welcome to Christchurch United. Here's what happens next.",
        body: "You're registered, and we're glad to have you. Here's what happens between now and the first session, and where to find anything you need along the way.",
        next: ["Your coach will be in touch the week before term with times and what to bring", "Sessions are at United Sports Centre, 466 Yaldhurst Road, with parking on site", "The academy hub has the timetable, the term dates and the kit list"],
        cta: { label: "Open the academy hub", href: `${site}/register` },
        close: "Questions? Reply to this email and a real person at the club will answer.",
        photo: 1,
      };
    case "cugc":
      return {
        preheader: "Welcome to United Gymnastics. Here's what happens next.",
        body: "You're enrolled, and we can't wait to see you on the floor. Here's what happens before the first class and what to bring on the day.",
        next: ["Your class, day and time are confirmed in your enrolment email", "Arrive ten minutes early for the first class so the coach can say hello", "Clothes to move in, hair tied back, a water bottle, and no jewellery on the floor"],
        cta: { label: "See the class timetable", href: `${site}/programs` },
        close: "Questions? Reply to this email and one of the team will help.",
        photo: 0,
      };
    case "mfl":
      return {
        preheader: "Your team is in. Here's what happens next.",
        body: "Your team's in, and the night's set. Here's what happens before the first game and where everything you need lives.",
        next: ["Fixtures are published the week before the season and land in your captain's dashboard", "Each player can pay their own share from the link in the dashboard", "Short a player on the night? The fill-in pool is one tap away"],
        cta: { label: "Open the captain's dashboard", href: "https://join.minifootball.co.nz/captain" },
        close: "Questions? Reply to this email and we'll sort it before the first whistle.",
        photo: 0,
      };
    case "siu":
      return {
        preheader: "Welcome to South Island United. Here's what comes next.",
        body: "You're part of the club now. Here's what happens between now and the first home match, and where to find your seat, your scarf and everything else.",
        next: ["Your membership card arrives before the first home match", "Home fixtures, kick-off times and the ticket link are on the website", "Members' events are announced here first, with early access to away travel"],
        cta: { label: "See the home fixtures", href: site },
        close: "Questions? Reply to this email and one of the club team will answer.",
        photo: 0,
      };
    case "cic":
      return {
        preheader: "Welcome to the Christchurch International Cup. Here's what comes next.",
        body: "Your club's interest is registered. Here's what happens between now and tournament week, and who to talk to about travel and beds.",
        next: ["Entries open in January; clubs that registered interest are first in line", "The travel desk can book flights, accommodation and ground transport for the squad", "The draw and the full schedule are published in June"],
        cta: { label: "Talk to the travel desk", href: site },
        close: "Questions? Reply to this email and the tournament team will answer.",
        photo: 1,
      };
    default:
      return {
        preheader: `Welcome to ${b.name}.`,
        body: "A warm sentence or two about being glad they're here, and what the next few weeks look like.",
        next: ["What happens first", "What happens next", "Where to find what they need"],
        cta: { label: act.label, href: act.href },
        close: "Questions? Reply to this email and a real person will answer.",
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
    section([label(b, k, "Welcome")], { padding: "26px 28px 0" }),
    hero(b, k, c.photo, `Welcome to ${b.name}`, k.site),
    section([headline(b, k, `Welcome to ${b.name},`, " {{first_name}}"), para(b, k, c.body)], { padding: "0 28px 10px" }),
    section([label(b, k, "What happens next"), bullets(b, k, c.next, 10), button(b, k, c.cta)], { padding: "18px 28px 10px", rule: true }),
    section([para(b, k, c.close, undefined, 0)], { padding: "18px 28px 30px", rule: true }),
    footer(b, k),
  ].join("\n");
  return mjmlDoc({ ...b, bg: PAGE }, sections, c.preheader);
}

export const welcomeTemplate: StarterTemplate = {
  id: "welcome-intro",
  name: "Welcome",
  description: "A warm first email: what happens next, one button, a real person to reply to.",
  category: "welcome",
  brandKeys: "all",
  build,
};
