// ─────────────────────────────────────────────────────────────────────────────
// grapes/templates/club-newsletter.ts — THE club newsletter.
//
// Daniel, 2026-10-25, with his South Island United Figma open (built by hand on
// an LAFC template): "if we were able to produce this level of quality, make it
// HTML, make the buttons work super nicely … have one for SIU, CUFC, CUGC, Mini
// Football Leagues with all the different brand identities."
//
// The shape is his Figma's, section for section: crest header · a section label
// ("Matchday.") · a photograph · a two-tone headline · a paragraph with an
// inline link · link bullets · "Featured." links · photo stories with a button
// · a partner offer · a NEXT MATCH card with a ticket button · where to watch ·
// small print · a dark footer with the socials, the address and the crest.
//
// But it is real HTML, not sliced pictures: every word is live text a person
// can click and retype in the builder, every button is a bulletproof MJML
// button, the photographs are ours (brand-kit.ts) and swap in one click, and
// the whole thing reads with images switched off. One template, one function
// of the brand — the copy, the crest, the colours and the footer all follow
// the workspace it opens in.
// ─────────────────────────────────────────────────────────────────────────────
import { brand, mjmlDoc, escText, escAttr, type Brand } from "./sections";
import { brandKit, SOCIAL_ICON, SOCIAL_ORDER, type BrandKit } from "./brand-kit";
import type { StarterTemplate } from "./types";

const WHITE = "#ffffff";
const INK = "#111111";
const BODY = "#2b2b2b";
const MUTED = "#6b6b6b";
const RULE = "#e6e6e6";
const CARD = "#f5f5f3";

type Link = { label: string; href: string };
type Story = { label: string; photo: number | null; body: string; cta: Link };
type Content = {
  preheader: string;
  lead: { label: string; photo: number | null; headA: string; headB: string; body: string; link: Link; bullets: Link[] };
  featured: Link[];
  stories: Story[];
  offer: { title: string; body: string; presenter: string };
  next: { label: string; headA: string; headB: string; when: string; cta: Link; note: string };
  watch: { label: string; body: string };
  smallPrint: string;
};

// ── the words, per brand ──────────────────────────────────────────────────────
function contentFor(k: BrandKit, b: Brand): Content {
  const site = k.site;
  const act = k.action ?? { label: "Find out more", href: site };
  const shop = k.shop ?? site;
  switch (k.key) {
    case "siu":
      return {
        preheader: "Matchday preview, watch parties, open training and the home jersey.",
        lead: {
          label: "Matchday", photo: 0, headA: "South Island United", headB: " vs Bula FC",
          body: "Coach Rob Sherman's side will come up against familiar faces when they take on Bula FC in their second match of the OFC Pro League season on Tuesday.",
          link: { label: "Match preview", href: site },
          bullets: [{ label: "Where to watch & listen", href: site }, { label: "Player availability", href: site }],
        },
        featured: [
          { label: "Christian Gray appointed inaugural captain of South Island United", href: site },
          { label: "Rob Sherman: Bula FC v South Island United, pre-match press conference", href: site },
          { label: "Auckland FC v South Island United highlights, OFC Pro League Round 1", href: site },
        ],
        stories: [
          { label: "Watch party", photo: 1, body: "Join us at O'Shea's Public House in Christchurch to watch South Island United take on Bula FC, with prizes drawn at half time. Can't make it? Catch the match at a watch-party partner in Nelson, Dunedin or Queenstown.", cta: { label: "Find your watch party", href: site } },
          { label: "Open training", photo: 2, body: "Open training is back at United Sports Centre on Tuesday 13 January from 9:15am. Bring the kids, meet the squad and watch the session up close.", cta: { label: "Plan your visit", href: site } },
          { label: "Shop", photo: 3, body: "The home jersey is here: black and gold, built for the South. Members get early access and free pick-up from the club shop.", cta: { label: "Shop the home jersey", href: shop } },
        ],
        offer: { title: "Big match, big savings", body: "As a South Island United fan you get $20 off your next order of $40 or more. Use the code BLACKANDGOLD at checkout.*", presenter: "Presented by our match-day partner" },
        next: { label: "Next home match", headA: "South Island United", headB: " vs Bula FC", when: "Tuesday 18 May · 7:30pm · Christchurch", cta: { label: "Get tickets", href: act.href }, note: "Tickets via Ticketmaster" },
        watch: { label: "Where to watch", body: "Every South Island United match streams live on TVNZ+ this season. Follow the club for kick-off times and the link on the day." },
        smallPrint: "*Terms apply. One order per customer, within 7 days of entering the code. Maximum value $20. Cannot be combined with other offers.",
      };
    case "cufc":
      return {
        preheader: "Academy news, registrations, the next match and the club shop.",
        lead: {
          label: "Club news", photo: 0, headA: "Christchurch United", headB: " this week",
          body: "Everything happening across the first team, the academy and the community, in one place every fortnight.",
          link: { label: "Read the full update", href: `${site}/news` },
          bullets: [{ label: "Fixtures & results", href: site }, { label: "Academy timetable", href: `${site}/register` }],
        },
        featured: [
          { label: "Term 4 training groups announced for U9 to U12", href: `${site}/news` },
          { label: "Pre-Academy places open for 2027", href: `${site}/register` },
          { label: "Match report: a statement win at United Sports Centre", href: `${site}/news` },
        ],
        stories: [
          { label: "Academy", photo: 1, body: "Term 4 is under way at United Sports Centre. Training groups, session times and what to bring are all in the academy hub.", cta: { label: "See the timetable", href: `${site}/register` } },
          { label: "Holiday camps", photo: 2, body: "Summer camps are open: FUNdamentals for U4 to U8 and the World Cup camp for U9 to U13, half or full days at United Sports Centre.", cta: { label: "Book a camp", href: `${site}/programmes/holiday` } },
          { label: "Shop", photo: 4, body: "The 2026 team photos are in the club shop: an instant download for $10, or a print delivered to your door.", cta: { label: "Visit the club shop", href: shop } },
        ],
        offer: { title: "Club partner offer", body: "Our partners back the club all season. Here's something back for you: show this email at the counter to claim it.", presenter: "Presented by a Christchurch United partner" },
        next: { label: "Next home match", headA: "Christchurch United", headB: " vs Nelson Suburbs", when: "Saturday 1 November · 2:00pm · United Sports Centre", cta: { label: "Match details", href: site }, note: "Free entry for members" },
        watch: { label: "Follow the club", body: "Team news, kick-off times and highlights land on Instagram and Facebook first. Follow along so you never miss a goal." },
        smallPrint: "Partner offers are subject to the partner's own terms.",
      };
    case "cugc":
      return {
        preheader: "This term at the gym, holiday programmes and a free first session.",
        lead: {
          label: "This term", photo: 0, headA: "United Gymnastics", headB: " this term",
          body: "Classes, holiday programmes and what's coming up at the gym: everything a United Gymnastics family needs this term.",
          link: { label: "See the term dates", href: site },
          bullets: [{ label: "Class timetable", href: `${site}/programs` }, { label: "Holiday programme", href: site }],
        },
        featured: [
          { label: "Term 1 2027 enrolments are open", href: `${site}/enrol` },
          { label: "Holiday programme: dates and how to book", href: site },
          { label: "Meet the coaches", href: site },
        ],
        stories: [
          { label: "Classes", photo: 1, body: "From GymBasics to competitive squads, every class builds strength, balance and confidence. New families can try a free session before enrolling.", cta: { label: "Book a free session", href: `${site}/free-session` } },
          { label: "Holiday programme", photo: 3, body: "Full days of gymnastics, games and fun across the school holidays, run by our own coaches at the gym.", cta: { label: "Book the holiday programme", href: site } },
          { label: "Parties", photo: 2, body: "The gym is open for birthday parties and private sessions, the perfect way to celebrate with a bit of bounce.", cta: { label: "Enquire about a party", href: `${site}/contact` } },
        ],
        offer: { title: "Bring a friend", body: "Know a family who'd love the gym? Their first session is free, and when they enrol you'll both get a credit on next term's fees.", presenter: "A thank-you from United Gymnastics" },
        next: { label: "Open day", headA: "United Gymnastics", headB: " open day", when: "Saturday 7 February · 10:00am to 1:00pm · the gym", cta: { label: "Register for open day", href: act.href }, note: "Free, and everyone's welcome" },
        watch: { label: "Follow the gym", body: "Routines, results and behind-the-scenes from the floor are on Instagram and Facebook every week." },
        smallPrint: "Credits are applied to the following term and cannot be exchanged for cash.",
      };
    case "mfl":
      return {
        preheader: "Term 1 registrations, Ballers youth league, fill-ins and the shop.",
        lead: {
          label: "Term 1", photo: 0, headA: "Mini Football Leagues", headB: " Term 1 2027",
          body: "Entries are open for 5-a-side and 7-a-side under lights at United Sports Centre. Enter a team, pay your way, and we'll see you on the turf.",
          link: { label: "Enter a team", href: act.href },
          bullets: [{ label: "Season dates & fees", href: site }, { label: "Three ways to pay", href: site }],
        },
        featured: [
          { label: "Ballers youth league returns on Wednesdays", href: `${site}/ballers` },
          { label: "Short a player? The fill-in pool is open", href: `${site}/players` },
          { label: "Captain's dashboard: squad, fixtures and the ladder in one place", href: site },
        ],
        stories: [
          { label: "Ballers", photo: 1, body: "Ballers is our first individual sign-up: a child joins alone and is drawn into a new team every week. Wednesdays, ten weeks, and the points follow the player.", cta: { label: "Sign up a player", href: `${site}/ballers` } },
          { label: "Field hire", photo: 2, body: "Need a pitch for training or a social kickaround? Floodlit turf is bookable by the hour at United Sports Centre.", cta: { label: "Book a pitch", href: "https://book.unitedsportscentre.com" } },
          { label: "Shop", photo: null, body: "Kits for your team, ready to ship: 113 KELME designs from $49.99, with names and numbers on request.", cta: { label: "Shop team kits", href: shop } },
        ],
        offer: { title: "Bring a team, bank a discount", body: "Refer a new team for Term 1 and both captains get $50 off the term fee once the new team has paid.", presenter: "A thank-you from Mini Football Leagues" },
        next: { label: "Season starts", headA: "Mini Football Leagues", headB: " Term 1", when: "Week 1 kicks off Monday 2 February · United Sports Centre", cta: { label: "Get your team in", href: act.href }, note: "Entries close when a night fills" },
        watch: { label: "Goal of the week", body: "Highlights and the goal of the week land on Instagram every Friday. Tag us in your clips and you might make the cut." },
        smallPrint: "Referral credit applies once the referred team's registration is paid in full.",
      };
    case "cic":
      return {
        preheader: "CIC 2027: registrations of interest, accommodation and travel.",
        lead: {
          label: "Tournament", photo: 0, headA: "Christchurch International Cup", headB: " 2027",
          body: "Teams from across New Zealand, Australia, Asia and the USA come to Christchurch every July. Registrations of interest for 2027 are open now.",
          link: { label: "Register your interest", href: act.href },
          bullets: [{ label: "Age groups & format", href: site }, { label: "Accommodation & travel", href: site }],
        },
        featured: [
          { label: "The 2026 film: a week in Christchurch", href: site },
          { label: "Accommodation partners for travelling teams", href: site },
          { label: "What a tournament week looks like", href: site },
        ],
        stories: [
          { label: "The experience", photo: 1, body: "Five days of football, an opening ceremony, a finals day and a city that turns out for it. Here's what the teams who came in 2026 said.", cta: { label: "Read their stories", href: site } },
          { label: "Travelling teams", photo: 2, body: "Our travel desk helps with flights, accommodation and ground transport, so a coach can bring a squad across the world with one point of contact.", cta: { label: "Talk to the travel desk", href: site } },
        ],
        offer: { title: "Early entry", body: "Register your interest before the end of the year and your club is first in line when entries open, with early-entry pricing locked in.", presenter: "Christchurch International Cup" },
        next: { label: "Key date", headA: "Entries open", headB: " for 2027", when: "January · places are confirmed in order of registration", cta: { label: "Register your interest", href: act.href }, note: "No payment until entries open" },
        watch: { label: "Watch", body: "Every CIC match was streamed live in 2026 on our own platform. Highlights and the tournament film are on the website." },
        smallPrint: "Early-entry pricing is confirmed when entries open and applies to clubs that registered interest before 31 December.",
      };
    default:
      return {
        preheader: `What's new at ${b.name}.`,
        lead: {
          label: "This month", photo: k.photos.length ? 0 : null, headA: b.name, headB: " this month",
          body: "A quick catch-up on what's been happening, what's coming up, and a few things worth your time.",
          link: { label: "Read more", href: site },
          bullets: [{ label: "What's on", href: site }, { label: "Get in touch", href: site }],
        },
        featured: [
          { label: "The headline from this month", href: site },
          { label: "Something coming up that's worth a diary note", href: site },
          { label: "A story from the team", href: site },
        ],
        stories: [
          { label: "Story one", photo: k.photos.length > 1 ? 1 : null, body: "Two or three sentences that tell the story and give a reason to click through.", cta: { label: act.label, href: act.href } },
          { label: "Story two", photo: k.photos.length > 2 ? 2 : null, body: "Two or three sentences that tell the story and give a reason to click through.", cta: { label: "Find out more", href: site } },
        ],
        offer: { title: "An offer for you", body: "A line about the offer, who it's for and how to claim it.", presenter: `Presented by ${b.name}` },
        next: { label: "Save the date", headA: b.name, headB: " event", when: "Date · time · place", cta: { label: act.label, href: act.href }, note: "A short note about entry" },
        watch: { label: "Follow along", body: "Where to find us between emails." },
        smallPrint: "Terms and conditions apply.",
      };
  }
}

// ── the pieces ────────────────────────────────────────────────────────────────
// Each piece is a COLUMN CHILD (mj-text / mj-image / mj-button / mj-divider);
// `section()` wraps a run of them in one mj-section. Every mj-section compiles
// to ~1.5KB of Outlook scaffolding, and a newsletter of thirty one-line
// sections ran to 90KB — Gmail clips at 102KB. Nine sections keeps it near
// 40KB with room for the words people add.
const a = (href: string, text: string, color: string, weight = 700) =>
  `<a href="${escAttr(href)}" style="color:${color};text-decoration:none;font-weight:${weight};">${escText(text)}</a>`;

function section(children: string[], opts: { bg?: string; padding?: string; column?: string } = {}): string {
  const bg = opts.bg ?? WHITE;
  const padding = opts.padding ?? "0 28px";
  return `    <mj-section background-color="${bg}" padding="${padding}">
      <mj-column${opts.column ? ` ${opts.column}` : ""}>
${children.filter(Boolean).join("\n")}
      </mj-column>
    </mj-section>`;
}

function header(b: Brand, k: BrandKit): string {
  const nav = k.nav.length
    ? `        <mj-column width="70%" vertical-align="middle">
          <mj-text align="right" color="${k.link}" font-family="${b.font}" font-size="11px" font-weight="700" letter-spacing="1.4px" text-transform="uppercase" padding="0">${k.nav
            .map((n) => a(n.href, n.label, k.link))
            .join("&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;")}</mj-text>
        </mj-column>`
    : "";
  return `    <mj-section background-color="${WHITE}" padding="22px 28px 16px" border-bottom="1px solid ${RULE}">
        <mj-column width="${nav ? "30%" : "100%"}" vertical-align="middle">
          <mj-image src="${escAttr(k.crest)}" alt="${escAttr(b.name)}" href="${escAttr(k.site)}" width="${k.crestWidth}px" align="left" padding="0" />
        </mj-column>
${nav}
    </mj-section>`;
}

/** The hairline that opens every section after the first. */
const rule = () => `        <mj-divider border-color="${RULE}" border-width="1px" padding="0 0 24px" />`;

/** "Matchday." — the bold section label with the brand's full stop. */
const label = (b: Brand, k: BrandKit, text: string) =>
  `        <mj-text color="${INK}" font-family="${b.font}" font-size="22px" font-weight="800" letter-spacing="-0.4px" line-height="1.2" padding="0 0 12px">${escText(text)}<span style="color:${k.link};">.</span></mj-text>`;

const photo = (k: BrandKit, i: number | null, href: string) => {
  if (i === null || !k.photos[i]) return "";
  const p = k.photos[i];
  return `        <mj-image src="${escAttr(p.src)}" alt="${escAttr(p.alt)}" href="${escAttr(href)}" border-radius="4px" padding="0 0 16px" />`;
};

/** A brand-coloured band in place of a photograph, for a brand with none yet. */
const band = (b: Brand, k: BrandKit, text: string) =>
  section(
    [`        <mj-text align="center" color="${k.onButton}" font-family="${k.headlineFont}" font-size="30px" font-weight="800" line-height="1.15" letter-spacing="-0.5px" padding="0">${escText(text)}</mj-text>`],
    { column: `background-color="${k.button}" border-radius="4px" padding="44px 28px"`, padding: "0 28px 16px" },
  );

const headline = (b: Brand, k: BrandKit, lead: string, rest: string) =>
  `        <mj-text color="${INK}" font-family="${k.headlineFont}" font-size="26px" font-weight="800" line-height="1.2" letter-spacing="-0.4px" padding="0 0 8px"><span style="color:${k.link};">${escText(lead)}</span>${escText(rest)}</mj-text>`;

const para = (b: Brand, k: BrandKit, text: string, link?: Link, bottom = 10) =>
  `        <mj-text color="${BODY}" font-family="${b.font}" font-size="15px" line-height="1.65" padding="0 0 ${bottom}px">${escText(text)}${link ? ` ${a(link.href, `${link.label} →`, k.link)}` : ""}</mj-text>`;

/** Link bullets — a brand-coloured dot and a bold link per line. */
const links = (b: Brand, k: BrandKit, items: Link[], bottom = 6) =>
  items
    .map(
      (l, i) =>
        `        <mj-text color="${k.link}" font-family="${b.font}" font-size="14px" line-height="1.5" padding="0 0 ${i === items.length - 1 ? bottom : 6}px"><span style="color:${k.link};">&#9679;</span>&nbsp;&nbsp;${a(l.href, l.label, k.link)}</mj-text>`,
    )
    .join("\n");

const button = (b: Brand, k: BrandKit, l: Link, opts: { align?: string; bottom?: number } = {}) =>
  `        <mj-button href="${escAttr(l.href)}" align="${opts.align ?? "left"}" background-color="${k.button}" color="${k.onButton}" font-family="${b.font}" font-size="14px" font-weight="700" letter-spacing="0.2px" border-radius="6px" inner-padding="13px 26px" padding="4px 0 ${opts.bottom ?? 8}px">${escText(l.label)}</mj-button>`;

const muted = (b: Brand, text: string, size = 12, bottom = 0) =>
  `        <mj-text color="${MUTED}" font-family="${b.font}" font-size="${size}px" line-height="1.6" padding="0 0 ${bottom}px">${escText(text)}</mj-text>`;

function story(b: Brand, k: BrandKit, s: Story): string {
  return section([rule(), label(b, k, s.label), photo(k, s.photo, s.cta.href), para(b, k, s.body, undefined, 8), button(b, k, s.cta)], { padding: "18px 28px 10px" });
}

function offer(b: Brand, k: BrandKit, o: Content["offer"]): string {
  return section(
    [
      rule(),
      label(b, k, "Partner offer"),
      `        <mj-text color="${INK}" font-family="${b.font}" font-size="19px" font-weight="800" line-height="1.3" padding="0 0 8px">${escText(o.title)}</mj-text>`,
      para(b, k, o.body, undefined, 6),
      muted(b, o.presenter),
    ],
    { padding: "18px 28px 10px" },
  );
}

/** The NEXT MATCH card: a soft grey panel, the fixture in two tones, when, a
 *  ticket button and a one-line note. */
function nextCard(b: Brand, k: BrandKit, n: Content["next"]): string {
  return section(
    [
      `        <mj-text align="center" color="${MUTED}" font-family="${b.font}" font-size="11px" font-weight="700" letter-spacing="1.6px" text-transform="uppercase" padding="0 0 10px">${escText(n.label)}</mj-text>`,
      `        <mj-text align="center" color="${INK}" font-family="${k.headlineFont}" font-size="24px" font-weight="800" line-height="1.2" letter-spacing="-0.3px" padding="0 0 8px"><span style="color:${k.link};">${escText(n.headA)}</span>${escText(n.headB)}</mj-text>`,
      `        <mj-text align="center" color="${BODY}" font-family="${b.font}" font-size="14px" line-height="1.5" padding="0 0 18px">${escText(n.when)}</mj-text>`,
      `        <mj-button href="${escAttr(n.cta.href)}" align="center" background-color="${k.button}" color="${k.onButton}" font-family="${b.font}" font-size="14px" font-weight="700" border-radius="6px" inner-padding="13px 30px" padding="0 0 12px">${escText(n.cta.label)}</mj-button>`,
      `        <mj-text align="center" color="${MUTED}" font-family="${b.font}" font-size="12px" line-height="1.5" padding="0">${escText(n.note)}</mj-text>`,
    ],
    { column: `background-color="${CARD}" border-radius="6px" padding="26px 24px 24px"`, padding: "22px 28px 6px" },
  );
}

/** The dark footer: socials, the club and its address, the links the law and
 *  good manners need, and the crest to sign off. `{{unsubscribe_url}}` here is
 *  what tells the server not to add its own plain footer. */
function footer(b: Brand, k: BrandKit): string {
  const socials = SOCIAL_ORDER.filter((s) => k.socials[s]);
  const social = socials.length
    ? `        <mj-social mode="horizontal" icon-size="22px" icon-padding="0" inner-padding="0 10px" align="center" padding="0 0 20px">
${socials
  .map(
    (s) =>
      `          <mj-social-element name="${s}" src="${escAttr(SOCIAL_ICON[s].src)}" href="${escAttr(k.socials[s]!)}" alt="${SOCIAL_ICON[s].label}" background-color="transparent" border-radius="0" padding="0" />`,
  )
  .join("\n")}
        </mj-social>`
    : "";
  return section(
    [
      social,
      `        <mj-text align="center" color="${k.footerText}" font-family="${b.font}" font-size="12px" line-height="1.7" padding="0"><strong style="color:${k.footerAccent};">${escText(b.name)}</strong><br />${escText(k.address)}</mj-text>`,
      `        <mj-text align="center" color="${k.footerText}" font-family="${b.font}" font-size="12px" line-height="1.7" padding="14px 0 0"><a href="${escAttr(k.site)}" style="color:${k.footerText};text-decoration:underline;">Website</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="{{unsubscribe_url}}" style="color:${k.footerText};text-decoration:underline;">Unsubscribe</a></mj-text>`,
      `        <mj-image src="${escAttr(k.crest)}" alt="${escAttr(b.name)}" width="40px" align="center" padding="24px 0 0" />`,
    ],
    { bg: k.footerBg, padding: "34px 28px 30px" },
  );
}

// ── the template ──────────────────────────────────────────────────────────────
function build(brandKey: string): string {
  const b = brand(brandKey);
  const k = brandKit(brandKey);
  const c = contentFor(k, b);
  const lead = c.lead;
  const hasLeadPhoto = lead.photo !== null && !!k.photos[lead.photo];

  const sections = [
    header(b, k),
    // The lead story. Without a photograph the brand band stands in, so the
    // label sits in its own section above it.
    ...(hasLeadPhoto
      ? [section([label(b, k, lead.label), photo(k, lead.photo, lead.link.href), headline(b, k, lead.headA, lead.headB), para(b, k, lead.body, lead.link), links(b, k, lead.bullets)], { padding: "26px 28px 10px" })]
      : [
          section([label(b, k, lead.label)], { padding: "26px 28px 0" }),
          band(b, k, `${lead.headA}${lead.headB}`),
          section([headline(b, k, lead.headA, lead.headB), para(b, k, lead.body, lead.link), links(b, k, lead.bullets)], { padding: "0 28px 10px" }),
        ]),
    section([rule(), label(b, k, "Featured"), links(b, k, c.featured, 10)], { padding: "18px 28px 10px" }),
    ...c.stories.map((s) => story(b, k, s)),
    offer(b, k, c.offer),
    nextCard(b, k, c.next),
    section([rule(), label(b, k, c.watch.label), para(b, k, c.watch.body, undefined, 18), muted(b, c.smallPrint, 11)], { padding: "18px 28px 30px" }),
    footer(b, k),
  ].join("\n");

  // The outer page is a soft grey so the white column reads as a page on a
  // laptop; on a phone the column fills the screen and the grey disappears.
  return mjmlDoc({ ...b, bg: "#efefed" }, sections, c.preheader);
}

export const clubNewsletterTemplate: StarterTemplate = {
  id: "club-newsletter",
  name: "Club newsletter",
  description: "The match-day newsletter: a lead story, featured links, photo stories, a partner offer, the next match and a dark footer with the socials.",
  category: "newsletter",
  brandKeys: "all",
  build,
};
