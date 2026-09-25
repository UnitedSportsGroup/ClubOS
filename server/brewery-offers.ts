/**
 * Brewery partner offers — USG → Sponsorship → Breweries (2026-09-25).
 *
 * Daniel: "put this on usg workspace sponsorship new tab up top here breweries
 * and have full breakdown with all details and submissions here and have
 * different comparison tables and views available".
 *
 * One beer partner across CUFC, SIU and the Emerald Lounge. Ryan sent the form
 * (partner.usg.co.nz/beer-partnership) on 27 Jul; on 14 Sep he wrote "We now
 * have all four offers tabled". Everything here was read from the inboxes on
 * 25 Sep 2026 — nothing is invented. Where a figure is absent it says so.
 *
 * 🔴 SERVER-ONLY. Marshall Moir asked that the Cassels bar volume he shared be
 *    treated as confidential, and each brewery's pricing is commercially
 *    sensitive to the others. The client bundle is public; this file is not.
 * 🔴 Gated on the sponsorship tab AND the United Sports Group workspace —
 *    canAccessTab() passes every slug for an admin/manager of ANY workspace,
 *    so without the workspace check a CUFC or MFL admin could read it by
 *    sending a different X-Workspace-Slug. Answered 404 elsewhere.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { requireTab } from "./auth";
import { BREWERY_SUBMISSIONS } from "./brewery-submissions";
import type { BreweryBoard, BreweryOffer } from "@shared/brewery-offers";

const USG_SLUG = "united-sports-group";

const OFFERS: BreweryOffer[] = [
  {
    key: "moa",
    brewery: "Southern Alps / Moa Brewing Co",
    parent: "Kiwi-owned, South Island",
    colour: "#f59e0b",
    contact: { name: "Stephen Smith", role: "Owner / Managing Director", email: "stephen@moabeer.com", phone: "021 191 8965" },
    channel: "Partner form (partner.usg.co.nz/beer-partnership)",
    receivedOn: "2026-07-28",
    hasWrittenOffer: true,
    status: "Offer in — no reply from us since",
    nextAction: "Reply to Stephen. He was told on 12 Jul he'd see our proposal and answered within a day of the form going out.",
    sponsorship: { lowCents: 500_000, highCents: 500_000, basis: "\"Other: $5000\" — whether per year or for the term is not stated" },
    rebate: { tiers: [{ fromHl: 0, toHl: null, perHlCents: 8_000 }], note: "80c a litre ($80/hl) on bar volume. He notes the industry quotes $ per litre, not the percentage tiers our form asked for." },
    stadiumRebatePerHlCents: 1_500,
    pctOfPurchases: null,
    promoFundPerHlCents: null,
    oneOffs: [],
    productInKind: [
      "2 × 24 cans for each home game (team and visiting team, post-match), as contra",
      "Beer heavily discounted for the awards evening",
    ],
    stockPricing: ["50L kegs — all products $375 + GST", "24-can pack $53.50 + GST", "Stadium beer is bought by Venues Ōtautahi at prices agreed with them"],
    loan: { answer: "no", detail: "Build loan: No." },
    termYears: 2,
    termLabel: "2 years",
    exclusivity: "Wants only four styles in the bar — lager (premium + low carb), Hazy IPA, APA, Pilsner — and suggests Cassels' milk stout alongside for a local offering.",
    range: "Southern Alps + Moa: lagers, Hazy IPA, APA, Pilsner",
    delivery: "Christchurch warehouse, 48-hour turnaround",
    paymentTerms: "20th of the month following invoice",
    service: "\"You will deal with me, the owner.\" Attends and hosts customers at every home game; 30+ years in the alcohol trade.",
    strengths: [
      "Owner deals with us directly; already supplied the June Business Hub",
      "Leaves room for a second local tap (Cassels stout)",
      "Clear keg and pack prices",
      "Already inside the stadium through Venues Ōtautahi — offers a rebate on stadium volume",
    ],
    watchOuts: [
      "Smallest cash figure, and its period is not stated",
      "Stadium: his VO contract makes a second alcohol partner at the stadium \"challenging\"",
      "Says For Bar (Dunedin) may be tied to Lion",
    ],
    openQuestions: [
      "Is the $5,000 per year or once?",
      "Is 80c/L paid on everything the Lounge buys from him, or only tap?",
      "Stadium rebate of 15c/L — on which games, reported how?",
    ],
  },
  {
    key: "renaissance",
    brewery: "Renaissance Brewing (Brandhouse)",
    parent: "Brandhouse — Christchurch distributor (beer, wine, spirits, non-alc)",
    colour: "#06b6d4",
    contact: { name: "Jason Dellaca", role: "Brandhouse", email: "jason@brandhouse.co.nz", phone: "027 289 9575" },
    channel: "Partner form (partner.usg.co.nz/beer-partnership)",
    receivedOn: "2026-08-03",
    hasWrittenOffer: true,
    status: "Offer in — no follow-up yet",
    nextAction: "Pin down the sponsorship band: cash or value, per year or per term, and what it buys.",
    sponsorship: { lowCents: 3_000_000, highCents: 5_000_000, basis: "Ticked the $30,000–$50,000 band — cash vs value and per-year vs per-term not stated" },
    rebate: {
      tiers: [
        { fromHl: 0, toHl: 300, perHlCents: 4_000 },
        { fromHl: 300, toHl: 500, perHlCents: 6_000 },
        { fromHl: 500, toHl: null, perHlCents: 7_000 },
      ],
      note: "Pouring volume rebate on litres sold (keg + bottle), paid quarterly — $40/hl to 300 hl, $60/hl 300–500, $70/hl 500+. \"Volumes can be discussed.\" Assumed here to pay the band the year reaches on all of it.",
    },
    stadiumRebatePerHlCents: null,
    pctOfPurchases: 4,
    promoFundPerHlCents: null,
    oneOffs: [],
    productInKind: ["Promotional activity, tastings and member offers", "Point-of-sale material and branded promotional assets"],
    stockPricing: [
      "\"Preferential wholesale pricing\" across the portfolio — no figures given",
      "Club-specific pricing, reviewed periodically",
      "No minimum order for standard replenishment",
      "Promotional and seasonal pricing; exclusive pricing on launches",
    ],
    loan: { answer: "discuss", detail: "Willing to discuss — max \"for discussion\" — but tied to having the exclusive contract." },
    termYears: null,
    termLabel: "Ongoing / rolling",
    exclusivity: "Exclusive contract expected if a loan is involved.",
    range: "Renaissance plus the Brandhouse portfolio: beer, wine, spirits, non-alcoholic (incl. Ecology)",
    delivery: "Christchurch warehouse — overnight, same-day if urgent",
    paymentTerms: "Not stated",
    service: "Dedicated account manager with face-to-face reviews; bar-staff product training; menu and range help; replaces faulty stock immediately.",
    strengths: [
      "Largest cash number on the table",
      "Only brewer open to a build loan",
      "Covers wine, spirits and non-alc too — one supplier for the whole bar",
      "4% on ALL purchases on top of the volume rebate",
    ],
    watchOuts: [
      "No actual prices — \"preferential\" can't be compared",
      "The $30–50k band is a tick-box range, not a commitment",
      "Loan comes with exclusivity",
      "Addressed to \"the South Island Football Club\" — generic",
    ],
    openQuestions: [
      "Sponsorship: cash or value? Per year or over the term? What does it buy?",
      "Wholesale price list for kegs and packs",
      "Loan: size, terms, security required",
      "Is the tier rate paid on all volume once a band is reached, or only the volume inside it?",
    ],
  },
  {
    key: "db",
    brewery: "DB Breweries",
    parent: "HEINEKEN Asia Pacific (Tui, Export, Heineken, Monteith's, Tuatara, Tiger, Sol)",
    colour: "#22c55e",
    contact: { name: "Rosie O'Sullivan", role: "South Island On Premise Business Manager", email: "rosie.osullivan@db.co.nz", phone: "027 492 4269" },
    channel: "Emailed PDF — \"The Emerald Lounge Proposal September 2026\" (12 pages)",
    receivedOn: "2026-09-14",
    hasWrittenOffer: true,
    status: "Offer in — Rosie and her manager (Sam) met Slava at USC on 8 Sep",
    nextAction: "Write up the 8 Sep meeting; decide whether to push their 60 hl volume assumption.",
    sponsorship: { lowCents: 0, highCents: 0, basis: "No cash sponsorship" },
    rebate: { tiers: [{ fromHl: 0, toHl: null, perHlCents: 8_000 }], note: "Tap rebate $80/hl, uncapped. Their own table applies it to 50 hl of tap a year ($4,000); the text says \"across all products\"." },
    stadiumRebatePerHlCents: null,
    pctOfPurchases: null,
    promoFundPerHlCents: 2_000,
    oneOffs: [
      { label: "Promotional fund kick-start (on signing)", cents: 300_000, kind: "promo" },
      { label: "Beer system fund — install font taps", cents: 1_000_000, kind: "fitout" },
      { label: "Signage — Heineken roundel installation", cents: 500_000, kind: "fitout" },
    ],
    productInKind: ["Tuatara rotational tap programme (6 brews a year)", "Brand activations (Heineken F1 / SailGP, Export × One NZ Warriors)"],
    stockPricing: ["Pack on DB's Managed Price List (MPL) — no figures in the proposal"],
    loan: { answer: "no", detail: "\"Unable to offer a loan facility, as there is no confirmed or forecast volume.\" On 17 Aug Rosie set out what lending would need: directors' assets and liabilities, the lease, a 12–24 month business plan, credit checks, a first-ranking GSA and personal guarantees." },
    termYears: 5,
    termLabel: "5 years",
    exclusivity: "100% DB on tap (beer, cider, zero, low-carb) · pack beer 80% DB / 20% local craft (no Lion, Asahi, Coke or Hancocks) · pack cider 100% · RTD 10% if ranged · 100% of beer/cider/RTD signage and promotions.",
    range: "Tui, Export, Heineken, Monteith's, Tuatara, Tiger, Sol, ciders, RTDs",
    delivery: "National network (breweries in Ōtāhuhu, Upper Hutt, Timaru; cidery in Nelson)",
    paymentTerms: "Not stated",
    service: "Brand activation programmes; will \"monitor performance and review\" if volumes significantly exceed expectations.",
    strengths: [
      "$15,000 of fit-out paid for (taps + signage) if we still need it",
      "Biggest brands; activation budget behind them",
      "Rebate uncapped",
    ],
    watchOuts: [
      "Assumes only 60 hl a year — far below our own model",
      "5-year lock-in with 100% of the taps",
      "No loan; no cash sponsorship",
      "Their volume table doesn't add up (250 hl tap + 500 hl pack shown as \"total 300\")",
      "$20/hl promo fund is spent on promotions, not paid to the club",
    ],
    openQuestions: [
      "Will they re-price at our volume estimate rather than 60 hl?",
      "Does the $80/hl apply to pack as well as tap?",
      "What came out of the 8 Sep site visit?",
    ],
  },
  {
    key: "cassels",
    brewery: "Cassels & Sons",
    parent: "Woolston, Christchurch — independent",
    colour: "#a855f7",
    contact: { name: "Marshall Moir", role: "CEO", email: "marshall@casselsbrewery.co.nz", phone: "021 581 979" },
    channel: "CEO meeting 29 Jul + pourage calculator back-and-forth with Ryan",
    receivedOn: null,
    hasWrittenOffer: false,
    status: "Ryan counts it as tabled — no written offer in any inbox ClubOS reads",
    nextAction: "Ask Ryan to forward Cassels' offer (likely in ryan@southislandunited.com). Marshall chased for feedback on 27 Aug, 28 Aug and 7 Sep.",
    sponsorship: { lowCents: null, highCents: null, basis: "Not seen" },
    rebate: { tiers: [], note: "Not seen." },
    stadiumRebatePerHlCents: null,
    pctOfPurchases: null,
    promoFundPerHlCents: null,
    oneOffs: [],
    productInKind: [],
    stockPricing: [],
    loan: { answer: "unknown", detail: "Not seen." },
    termYears: null,
    termLabel: "Not seen",
    exclusivity: "Not seen. Moa suggested a Cassels milk stout could pour alongside it.",
    range: "Cassels & Sons craft range",
    delivery: "Local (Woolston brewery)",
    paymentTerms: "Not seen",
    service: "The CEO is engaged personally and has worked through our volume model with Ryan.",
    strengths: [
      "The most engaged on the numbers — reviewed the calculator line by line",
      "Local brewery with its own busy bar to benchmark against",
      "Football whitespace: Moa has the Crusaders and the city stadiums",
    ],
    watchOuts: [
      "Nothing in writing we can see",
      "Has been waiting on our feedback since late August",
    ],
    openQuestions: ["What exactly has Cassels offered?", "Would they take a shared-tap arrangement next to Moa or Renaissance?"],
  },
];

const BOARD: Omit<BreweryBoard, "submissions"> = {
  updatedOn: "2026-09-25",
  summary: "One beer partner across CUFC, SIU and the Emerald Lounge. Four breweries approached through partner.usg.co.nz/beer-partnership on 27 Jul; Ryan: \"We now have all four offers tabled\" (14 Sep).",
  // Moa's $375 + GST per 50L keg — the only real keg price on the table. Used ONLY to size a
  // percentage-of-purchases rebate; change it in the calculator.
  assumedPurchaseCentsPerHl: 75_000,
  offers: OFFERS,
  volumes: [
    { key: "db", label: "DB's assumption", hlPerYear: 60, source: "DB proposal, 14 Sep", note: "60 hl a year, 300 hl over 5 years." },
    { key: "club-y1", label: "Our model — Year 1", hlPerYear: 219, source: "Ryan's pourage model, 28 Jul", note: "160k visitors · 50% use the Lounge · 47% of those buy · 1.3 pours of 425 mL · 5% line loss = 21,859 L." },
    { key: "club-y3", label: "Our model — Year 3", hlPerYear: 332, source: "Ryan's pourage model, 28 Jul", note: "208k visitors · 55% · 50% · 1.3 pours = 33,188 L." },
    { key: "cassels-flat", label: "Marshall — pours held flat", hlPerYear: 550, source: "Marshall Moir, 28 Aug", note: "The 21 Aug calculator's Year 3 with pours per person held constant." },
    { key: "cassels-y3", label: "Calculator Year 3 (Marshall's read)", hlPerYear: 690, source: "Marshall Moir, 28 Aug", note: "The 21 Aug calculator reaches 69,000 L in Year 3: +25% attendance in Year 2 plus rising pours per person." },
    { key: "cassels-bar", label: "Cassels' own bar (benchmark)", hlPerYear: 650, source: "Marshall Moir, 28 Aug", note: "Their Woolston bar pours about 65,000 L a year.", confidential: true },
  ],
  issues: [
    { title: "How much will the Lounge pour?", detail: "Estimates run from 60 hl (DB) to 690 hl (the latest calculator, per Marshall). Every rebate swings on this. Agree one number we'll defend before negotiating." },
    { title: "Nobody offers a straight loan", detail: "DB and Moa said no; Brandhouse will discuss only with exclusivity. A brewery loan means director disclosures, a first-ranking GSA and personal guarantees (DB, 17 Aug)." },
    { title: "Exclusive, or a local mix?", detail: "DB wants 100% of taps for 5 years. Moa wants four styles and suggests Cassels alongside. Brandhouse wants exclusivity with a loan." },
    { title: "The stadium belongs to someone else", detail: "Moa says its Venues Ōtautahi contract makes a second alcohol partner at the stadium challenging; Nga Puna Wai pours little. Check any SIU venue deal against this." },
    { title: "Term", detail: "2 years (Moa), rolling (Brandhouse), 5 years (DB). A new venue with unknown volume argues for short and reviewable." },
  ],
  looseEnds: [
    { brewery: "Cassels", detail: "Marshall chased on 27 Aug, 28 Aug and 7 Sep for calculator feedback; 9 Sep \"All good from my end\". Get Ryan to forward the written offer." },
    { brewery: "DB", detail: "Rosie and Sam met Slava at USC, Tue 8 Sep 8:30am. What was said isn't written down anywhere." },
    { brewery: "Moa", detail: "Stephen was promised a proposal on 12 Jul and submitted within a day. No reply since." },
    { brewery: "Renaissance", detail: "No follow-up yet — questions are the sponsorship band and the price list." },
  ],
  timeline: [
    { date: "2026-03-13", brewery: "DB", who: "Rosie O'Sullivan", what: "First contact with Ryan (\"DB Contact\")." },
    { date: "2026-06-15", brewery: "Moa", who: "Stephen Smith", what: "Moa supplies the beer for the Business Hub at the Commodore (paid 9 Jul)." },
    { date: "2026-06-24", brewery: "Moa", who: "Stephen Smith", what: "\"Let me know if you had any updates on the other opportunities we spoke about. How is the bar going?\"" },
    { date: "2026-06-26", brewery: "All", who: "Slava", what: "Emerald Lounge working drawings sent to Ryan." },
    { date: "2026-07-04", brewery: "Cassels", who: "Daniel", what: "Cassels partner page built (partner.usg.co.nz/cassels)." },
    { date: "2026-07-09", brewery: "Moa", who: "Ryan", what: "Pays the Business Hub order and updates Stephen on the bar build." },
    { date: "2026-07-13", brewery: "Moa", who: "Stephen Smith", what: "\"Look forward to seeing the proposal.\"" },
    { date: "2026-07-13", brewery: "All", who: "Daniel", what: "Beer page reworked into the supplier-offer form (sponsorship · volume rebate · supply terms · build loan)." },
    { date: "2026-07-27", brewery: "All", who: "Ryan", what: "Emails each brewery the form link: \"We are now in a position to find a Brewery partner for both the club and the Emerald Lounge.\"" },
    { date: "2026-07-28", brewery: "Moa", who: "Stephen Smith", what: "Submits through the form." },
    { date: "2026-07-28", brewery: "Cassels", who: "Ryan", what: "Shares the pourage model spreadsheet ahead of the Cassels meeting." },
    { date: "2026-07-29", brewery: "Cassels", who: "Ryan, Daniel", what: "Meeting with CEO Marshall Moir, 10–11am." },
    { date: "2026-08-03", brewery: "Renaissance", who: "Jason Dellaca", what: "Submits through the form." },
    { date: "2026-08-05", brewery: "DB", who: "Rosie O'Sullivan", what: "Found the invite in junk mail. Ryan: by end of August at the latest — \"we have heard back from all other providers already\"." },
    { date: "2026-08-17", brewery: "DB", who: "Rosie O'Sullivan", what: "Asks to submit via DB's own process ($/hl not %), asks beer-system stage, brands, volume, loan size, and lists lending requirements." },
    { date: "2026-08-19", brewery: "DB", who: "Ryan", what: "Sends the Emerald Lounge drawings (resent 20 Aug). Rosie: DB's investment meeting is 21 Aug." },
    { date: "2026-08-21", brewery: "Cassels", who: "Ryan", what: "Sends the new Pourage Volume Calculator." },
    { date: "2026-08-28", brewery: "Cassels", who: "Marshall Moir", what: "After a call: the calculator's Year 3 reaches 69,000 L against Cassels' own bar at ~65,000 L (confidential); growth assumptions questioned." },
    { date: "2026-09-03", brewery: "DB", who: "Rosie O'Sullivan", what: "Asks to show her Auckland manager (Sam) the site on Tue 8 Sep." },
    { date: "2026-09-07", brewery: "Cassels", who: "Marshall Moir", what: "\"Just following up … I've not done anything with this yet as awaiting your feedback.\"" },
    { date: "2026-09-08", brewery: "DB", who: "Slava", what: "Meets Rosie and Sam at United Sports Centre, 8:30am (Ryan off with flu)." },
    { date: "2026-09-09", brewery: "Cassels", who: "Marshall Moir", what: "\"All good from my end.\"" },
    { date: "2026-09-14", brewery: "DB", who: "Rosie O'Sullivan", what: "Sends the 12-page proposal. No loan; conservative 5-year structure." },
    { date: "2026-09-14", brewery: "All", who: "Ryan", what: "\"We now have all four offers tabled. I suggest we go through these and look to start next steps in the coming weeks.\"" },
  ],
  dbOfferPage: [
    { label: "Anticipated volume", value: "60 hl per annum · 300 hl over 5 years" },
    { label: "Term", value: "5 years" },
    { label: "Tap rebate (uncapped)", value: "$80 per hl" },
    { label: "Promotional rebate", value: "$20 per hl (accrued to support beer/cider activity and footfall)" },
    { label: "Promotional fund kick-start", value: "$3,000 on signing" },
    { label: "Beer system fund (install font taps)", value: "$10,000" },
    { label: "Signage (Heineken roundel installation)", value: "$5,000" },
    { label: "DB's total investment", value: "$23,200 in year 1 · $44,000 over the term (at their volume)" },
  ],
  dbObligations: [
    { label: "Tap beer & cider", value: "100% DB beer / cider / zero / low carb" },
    { label: "Pack beer", value: "80% DB · 20% local craft (excludes Lion / Asahi / Coke / Hancocks)" },
    { label: "Pack cider", value: "100%" },
    { label: "RTD", value: "10% (if ranged)" },
    { label: "Signage", value: "100% beer / cider / RTD" },
    { label: "Promotions", value: "100% beer / cider / RTD" },
  ],
};

function requireUsgWorkspace(req: Request, res: Response, next: NextFunction) {
  if (String(req.headers["x-workspace-slug"] || "") !== USG_SLUG) return res.status(404).json({ message: "Not found" });
  next();
}

export function registerBreweryOfferRoutes(app: Express) {
  app.get("/api/admin/sponsorship/breweries", requireTab("sponsorship"), requireUsgWorkspace, (_req, res) => {
    const board: BreweryBoard = { ...BOARD, submissions: BREWERY_SUBMISSIONS };
    res.setHeader("Cache-Control", "private, no-store");
    res.json(board);
  });
}
