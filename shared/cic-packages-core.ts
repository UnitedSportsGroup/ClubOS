// CIC 2027 packages — THE pricing engine.
//
// 🔴 This file is BYTE-IDENTICAL in two apps:
//   apps/cicyouth-website/src/packages-core.ts   (the page shows the price)
//   apps/clubos/shared/cic-packages-core.ts      (ClubOS charges the price)
// so what a club sees is what it is charged. Edit the website copy, then run
//   cp apps/cicyouth-website/src/packages-core.ts apps/clubos/shared/cic-packages-core.ts
// and `node apps/cicyouth-website/scripts/check-core.cjs` proves they match.
// No imports, on purpose: both apps must be able to read it.
//
// Source of the model: CIC meeting, Thu 22 Oct 2026 (Daniel, Isaac, Ryan) —
// outputs/cic-packages/2026-10-22-meeting/transcript.md. Booking rules (10%
// deposit, 14-day hold, player registration) from Ryan Edwards, 5 Nov 2026.
//
// basis:
//   "2026"    — the 2026 fee as invoiced in Xero (GST incl.), until 2027 is set
//   "quoted"  — a partner gave us this figure
//   "meeting" — agreed in the room on 22 Oct
//   "est"     — placeholder until the partner quotes; shown as "est." on the page
//   "checked" — a real public price we checked (Booking.com / Google Flights)
// A null price means "on request": shown, never added to the total.

export type Basis = "2026" | "quoted" | "meeting" | "est" | "checked";
export type Money = { amount: number | null; basis: Basis; note?: string };

export type Origin = "chch" | "south" | "north" | "overseas";
export type PackageId = "entry" | "base" | "legacy";

export const ORIGINS: { id: Origin; label: string; hint: string }[] = [
  { id: "chch", label: "Christchurch", hint: "You're local: entry plus anything you'd like to add" },
  { id: "south", label: "South Island", hint: "Driving up from elsewhere in the South Island" },
  { id: "north", label: "North Island", hint: "Flying or ferrying down" },
  { id: "overseas", label: "Overseas", hint: "Australia, the Pacific and further" },
];

// Which packages each origin can pick. Christchurch clubs get entry + add-ons.
// ⏳ Ryan: Local / SI / NI / International preferences are decided Thu 12 Nov.
export const PACKAGES_FOR: Record<Origin, PackageId[]> = {
  chch: ["entry"],
  south: ["entry", "base", "legacy"],
  north: ["entry", "base", "legacy"],
  overseas: ["entry", "base", "legacy"],
};
// The one we lead with (never forced — the meeting was clear on that).
export const RECOMMENDED: Record<Origin, PackageId> = {
  chch: "entry",
  south: "base",
  north: "base",
  overseas: "legacy",
};

export const PACKAGES: Record<PackageId, {
  name: string; promise: string; summary: string; includes: string[]; notIncluded?: string[];
}> = {
  entry: {
    name: "Entry",
    promise: "Do it yourself",
    summary: "Just the football. You book your own trip, and add anything you'd like from our partners.",
    includes: [
      "Tournament entry: 6 games over 3 days",
      "Professional referees on every game",
      "Medals, trophies and individual awards",
      "Every game streamed on watch.cicyouth.com",
    ],
  },
  base: {
    name: "Base",
    promise: "Done with you",
    summary: "Entry plus the three things every travelling team needs, from our partners at partner prices. You choose, we line it up.",
    includes: [
      "Everything in Entry",
      "3 nights' accommodation with a partner hotel or holiday park",
      "Meals from Victoria Foods: lunch at the ground, breakfast and dinner where you stay",
      "Team van(s) for the whole stay",
      "Your own marquee in the tournament village",
    ],
    notIncluded: ["Flights or ferry"],
  },
  legacy: {
    name: "Legacy",
    promise: "Done for you",
    summary: "The whole trip booked for you by our travel partner, flights included, with one person looking after your team from arrival to departure.",
    includes: [
      "Everything in Base",
      "Flights booked for you",
      "One dedicated person who handles every booking",
      "Experiences and a team dinner built into your itinerary",
      "Longer stays: overseas teams default to 5 days / 4 nights",
    ],
  },
};

// Age groups → 2026 entry fee per team (Xero sales invoices, GST incl.) and a
// default squad size from the format (5v5 / 7v7 / 9v9 / 11v11).
export const AGE_GROUPS: { id: string; label: string; entry: Money; squad: number; dates: string }[] = [
  { id: "U9", label: "U9", entry: { amount: 1000, basis: "2026" }, squad: 8, dates: "10–12 July" },
  { id: "U10", label: "U10", entry: { amount: 1400, basis: "2026" }, squad: 11, dates: "10–12 July" },
  { id: "U11", label: "U11", entry: { amount: 1400, basis: "2026" }, squad: 11, dates: "10–12 July" },
  { id: "U12", label: "U12", entry: { amount: 1700, basis: "2026" }, squad: 13, dates: "13–15 July" },
  { id: "U13", label: "U13", entry: { amount: 1700, basis: "2026" }, squad: 13, dates: "13–15 July" },
  { id: "U14", label: "U14", entry: { amount: 2000, basis: "2026" }, squad: 16, dates: "4–6 July" },
  { id: "U15", label: "U15", entry: { amount: 2000, basis: "2026" }, squad: 16, dates: "7–9 July" },
];

export const TOURNAMENT_DAYS = 3;
export const BASE_NIGHTS = 3;          // meeting: 4 days / 3 nights
export const LEGACY_OVERSEAS_NIGHTS = 4; // meeting: 5 days / 4 nights for overseas
export const VAN_SEATS = 12;

// Booking rules — Ryan Edwards, 5 Nov 2026.
export const DEPOSIT_RATE = 0.1;       // 10% of the CIC invoice (flights excluded), non-refundable
export const QUOTE_HOLD_DAYS = 14;     // pay the deposit inside 14 days or the hold lapses
// The 90% balance keeps the meeting's three instalments.
export const INSTALMENTS = ["January 2027", "March 2027", "April 2027"];

// Base components. Accommodation and meals are per person; vans per van per
// day; the marquee per tournament day.
export const RATES = {
  accommodation: {
    amount: 75, basis: "est",
    note: "Per person per night. Based on $160–250 a room in July, two to three to a room. Partner rates not yet agreed.",
  } as Money,
  breakfast: { amount: 18, basis: "est", note: "Per person. Victoria Foods to quote. Skipped if your accommodation includes breakfast." } as Money,
  lunch: { amount: 18, basis: "est", note: "Per person, delivered to the ground on game days. Victoria Foods to quote." } as Money,
  dinner: { amount: 28, basis: "est", note: "Per person. Victoria Foods to quote." } as Money,
  van: { amount: 160, basis: "est", note: "Per 12-seat van per day. Rental partner to quote." } as Money,
  marquee: { amount: 100, basis: "meeting", note: "Per day in the tournament village (Happy Hire)." } as Money,
};

// Add-ons. `child` is a player's price, `adult` is staff and other adults.
// null = price on request (shown, not totalled).
export type AddOn = {
  id: string; name: string; partner: string; blurb: string;
  child: Money; adult: Money; perTeam?: Money; origins?: Origin[];
};

export const ADD_ONS: AddOn[] = [
  {
    id: "lonestar", name: "Team dinner night", partner: "Lone Star",
    blurb: "One evening out together at Lone Star. Fits easily around games.",
    child: { amount: null, basis: "est" }, adult: { amount: null, basis: "est" },
  },
  {
    id: "stadium", name: "Stadium tour", partner: "Te Kaha — One New Zealand Stadium",
    blurb: "Behind the scenes at Christchurch's new stadium. Booked on your group-stage day, between games.",
    child: { amount: null, basis: "est" }, adult: { amount: null, basis: "est" },
  },
  {
    id: "orana", name: "Orana Wildlife Park", partner: "Orana Wildlife Park",
    blurb: "New Zealand's open-range zoo, ten minutes from the ground. One adult per ten children.",
    child: { amount: 10, basis: "quoted", note: "Group price quoted to Isaac (usual $12.50)." },
    adult: { amount: 40, basis: "est", note: "Usual adult price; group adult price to confirm." },
  },
  {
    id: "willowbank", name: "Willowbank Wildlife Reserve", partner: "Willowbank",
    blurb: "Kiwi, native birds and a Māori cultural experience in Northwood. 20% group discount offered.",
    child: { amount: null, basis: "quoted", note: "20% group discount offered; prices to confirm." },
    adult: { amount: null, basis: "quoted" },
  },
  {
    id: "antarctic", name: "International Antarctic Centre", partner: "International Antarctic Centre",
    blurb: "Snow storm room, Hägglund ride and the blue penguins, by the airport.",
    child: { amount: 50, basis: "meeting", note: "Published child price (5–15). Group rate to ask for." },
    adult: { amount: 74, basis: "meeting", note: "Published adult price (16+). Group rate to ask for." },
  },
  {
    id: "adventure", name: "Christchurch Adventure Park", partner: "Christchurch Adventure Park",
    blurb: "Chairlift up the Port Hills, a walk, and the zipline for the brave.",
    child: { amount: null, basis: "est" }, adult: { amount: null, basis: "est" },
  },
];

// Proposed partners by category. None signed yet — the page says so while in draft.
export const PARTNERS: { category: string; names: string[] }[] = [
  { category: "Accommodation", names: ["Drifter Hotel", "Commodore Hotel", "Airport Gateway", "Bealey Quarter", "North South Holiday Park"] },
  { category: "Meals", names: ["Victoria Foods"] },
  { category: "Vans & cars", names: ["Touchdown Rentals", "Bargain Rentals"] },
  { category: "Tournament village", names: ["Happy Hire marquees"] },
  { category: "Experiences", names: ["Lone Star", "Te Kaha stadium tour", "Orana Wildlife Park", "Willowbank", "Antarctic Centre", "Adventure Park"] },
  { category: "Full travel", names: ["Our travel partner"] },
];

export function estimateCount(): number {
  const all: Money[] = [...Object.values(RATES), ...ADD_ONS.flatMap((a) => [a.child, a.adult])];
  return all.filter((m) => m.basis === "est" && m.amount !== null).length;
}

// ---------------------------------------------------------------------------
// Real prices checked for each age group's dates (fly in the day before the
// first game, home on the last day). Produced by scripts/fetch-trip-prices.cjs,
// and passed IN — the page bundles them, ClubOS fetches the same file.
// ---------------------------------------------------------------------------
export type Fare = { cheapest: number; cheapestAirline: string; airNz: number | null; nonstop: boolean } | null;
export type PriceWindow = {
  ages: string[]; arrive: string; depart: string; nights: number;
  drifter: { roomPerNight: number; perPersonPerNight: number; breakfastPerPerson: number | null; checkin: string; checkout: string; fullOnDates: boolean } | null;
  flights: Record<string, Fare>;
};
export type TripPrices = { checkedAt: string | null; windows: Record<string, PriceWindow> };

export const CITIES: { code: string; name: string; island: "north" | "south" }[] = [
  { code: "AKL", name: "Auckland", island: "north" }, { code: "HLZ", name: "Hamilton", island: "north" },
  { code: "TRG", name: "Tauranga", island: "north" }, { code: "ROT", name: "Rotorua", island: "north" },
  { code: "NPL", name: "New Plymouth", island: "north" }, { code: "NPE", name: "Napier", island: "north" },
  { code: "PMR", name: "Palmerston North", island: "north" }, { code: "WLG", name: "Wellington", island: "north" },
  { code: "NSN", name: "Nelson", island: "south" }, { code: "DUD", name: "Dunedin", island: "south" },
  { code: "ZQN", name: "Queenstown", island: "south" }, { code: "IVC", name: "Invercargill", island: "south" },
];

export function priceWindowIn(tp: TripPrices, age: string): PriceWindow | null {
  return Object.values(tp.windows || {}).find((w) => w.ages.includes(age)) ?? null;
}

// Accommodation and breakfast for an age group: the checked Drifter price when we have one.
export function accommodationIn(tp: TripPrices, age: string): Money {
  const d = priceWindowIn(tp, age)?.drifter;
  if (!d) return RATES.accommodation;
  return {
    amount: d.perPersonPerNight, basis: "checked",
    note: `Drifter Christchurch, 4-bunk ensuite room ($${d.roomPerNight}/night), flexible rate on Booking.com` +
      (d.fullOnDates ? ` for ${d.checkin} – ${d.checkout}: the Drifter showed no rooms on your exact dates.` : "."),
  };
}
export function breakfastIn(tp: TripPrices, age: string): Money {
  const b = priceWindowIn(tp, age)?.drifter?.breakfastPerPerson;
  if (b == null) return RATES.breakfast;
  return { amount: b, basis: "checked", note: "Drifter breakfast, from the with-breakfast rate on Booking.com." };
}
export function fareIn(tp: TripPrices, age: string, city: string): Fare {
  return priceWindowIn(tp, age)?.flights[city] ?? null;
}

// ---------------------------------------------------------------------------
// The quote. One function, used by the page AND by ClubOS — so what is shown
// is what is summed, and what is summed is what is charged.
// Staff costs are carried by the players; other adults get their own price.
// ---------------------------------------------------------------------------
export type QuoteInput = {
  origin: Origin; pkg: PackageId; age: string;
  players: number; staff: number; adults: number;
  nights: number; vans: number;
  breakfast: boolean;     // false when the accommodation includes it
  entryMarquee: boolean;  // Entry package: hire a village marquee
  entryLunch: boolean;    // Entry package: lunch at the ground on game days
  addOns: string[];
  city?: string;          // flying from (North/South Island)
  flights?: boolean;      // add return flights to the estimate
};

export type QuoteLine = { label: string; detail: string; amount: number | null; basis: Basis };

export type Quote = {
  lines: QuoteLine[];
  total: number;
  flightsTotal: number;  // part of total the club books itself; not on the CIC invoice
  invoiceTotal: number;  // what CIC invoices = total − flights
  deposit: number;       // DEPOSIT_RATE of the invoice, non-refundable
  instalment: number;    // each of the three balance instalments
  perPlayer: number;
  perPlayerInvoice: number; // a player's share of the CIC invoice (no flights)
  perAdult: number;
  onRequest: string[];   // add-ons ticked whose price we don't have yet
  hasEstimates: boolean;
};

const n = (m: Money) => m.amount ?? 0;
const cents = (v: number) => Math.round(v * 100);

export function quote(q: QuoteInput, tp: TripPrices): Quote {
  const age = AGE_GROUPS.find((a) => a.id === q.age) ?? AGE_GROUPS[0];
  const players = Math.max(1, q.players);
  const staff = Math.max(0, q.staff);
  const adults = Math.max(0, q.adults);
  const grownUps = staff + adults;
  const people = players + grownUps;
  const travel = q.pkg !== "entry";
  const nights = travel ? q.nights : 0;
  const lines: QuoteLine[] = [];
  let estimates = false;
  let flightsTotal = 0;
  let farePerHead = 0;
  const mark = (m: Money) => { if (m.basis === "est" && m.amount !== null) estimates = true; };

  // Per-head costs, split into a player's and a grown-up's.
  let perChild = 0;
  let perGrown = 0;
  // Team costs, carried by the players.
  let team = n(age.entry);
  lines.push({ label: "Tournament entry", detail: `${age.label} team · 2026 fee, 2027 to confirm`, amount: n(age.entry), basis: age.entry.basis });

  if (travel) {
    const accRate = accommodationIn(tp, age.id);
    const bfRate = breakfastIn(tp, age.id);
    const accom = n(accRate) * nights;
    mark(accRate);
    perChild += accom; perGrown += accom;
    const dr = priceWindowIn(tp, age.id)?.drifter;
    const accDetail = accRate.basis === "checked"
      ? `Drifter, 4 to a room · ${people} people × ${nights} nights${dr?.fullOnDates ? ` · priced on ${shortDate(dr.checkin)}–${shortDate(dr.checkout)}, nearest dates with rooms` : ""}`
      : `${people} people × ${nights} nights`;
    lines.push({ label: "Accommodation", detail: accDetail, amount: accom * people, basis: accRate.basis });

    const meals = (q.breakfast ? n(bfRate) * nights : 0) + n(RATES.lunch) * TOURNAMENT_DAYS + n(RATES.dinner) * nights;
    mark(RATES.lunch);
    perChild += meals; perGrown += meals;
    const mealDetail = `Victoria Foods · ${q.breakfast ? `${nights} breakfasts, ` : ""}${TOURNAMENT_DAYS} lunches, ${nights} dinners each`;
    lines.push({ label: "Meals", detail: mealDetail, amount: meals * people, basis: RATES.lunch.basis });

    if (q.vans > 0) {
      const days = nights + 1;
      const vans = n(RATES.van) * q.vans * days;
      mark(RATES.van);
      team += vans;
      lines.push({ label: "Team vans", detail: `${q.vans} van${q.vans > 1 ? "s" : ""} × ${days} days`, amount: vans, basis: RATES.van.basis });
    }

    const marquee = n(RATES.marquee) * TOURNAMENT_DAYS;
    team += marquee;
    lines.push({ label: "Village marquee", detail: `${TOURNAMENT_DAYS} days`, amount: marquee, basis: RATES.marquee.basis });

    // Return flights: the cheapest fare we found for these dates. The club books them.
    const fare = q.flights && q.city && q.pkg === "base" ? fareIn(tp, age.id, q.city) : null;
    if (fare) {
      farePerHead = fare.cheapest;
      perChild += fare.cheapest; perGrown += fare.cheapest;
      flightsTotal = fare.cheapest * people;
      const city = CITIES.find((c) => c.code === q.city)?.name ?? q.city;
      const w = priceWindowIn(tp, age.id)!;
      lines.push({
        label: "Return flights",
        detail: `${city} ⇄ Christchurch · ${people} × ${nzd(fare.cheapest)} (${fare.cheapestAirline}${fare.airNz && fare.airNz !== fare.cheapest ? `; Air NZ ${nzd(fare.airNz)}` : ""}) · ${shortDate(w.arrive)}–${shortDate(w.depart)} · you book`,
        amount: fare.cheapest * people, basis: "checked",
      });
    }

    // CIC's own fee for organising the trip. Amount not decided yet, so it is shown and not totalled.
    if (q.pkg === "base") {
      lines.push({ label: "CIC service fee", detail: "Booking and on-the-ground support · to be confirmed", amount: null, basis: "meeting" });
    }
  } else {
    if (q.entryMarquee) {
      const marquee = n(RATES.marquee) * TOURNAMENT_DAYS;
      team += marquee;
      lines.push({ label: "Village marquee", detail: `${TOURNAMENT_DAYS} days`, amount: marquee, basis: RATES.marquee.basis });
    }
    if (q.entryLunch) {
      const lunch = n(RATES.lunch) * TOURNAMENT_DAYS;
      mark(RATES.lunch);
      perChild += lunch; perGrown += lunch;
      lines.push({ label: "Lunch at the ground", detail: `Victoria Foods · ${people} people × ${TOURNAMENT_DAYS} game days`, amount: lunch * people, basis: RATES.lunch.basis });
    }
  }

  const onRequest: string[] = [];
  for (const a of ADD_ONS.filter((x) => q.addOns.includes(x.id))) {
    if (a.child.amount === null || a.adult.amount === null) { onRequest.push(a.name); continue; }
    mark(a.child); mark(a.adult);
    perChild += a.child.amount; perGrown += a.adult.amount;
    const basis: Basis = a.child.basis === "est" || a.adult.basis === "est" ? "est" : a.child.basis;
    lines.push({
      label: a.name,
      detail: `${players} × $${a.child.amount} + ${grownUps} × $${a.adult.amount}`,
      amount: a.child.amount * players + a.adult.amount * grownUps, basis,
    });
  }

  team += perGrown * staff;
  const perPlayer = perChild + team / players;
  const perAdult = perGrown;
  const total = perPlayer * players + perAdult * adults;
  // Staff flights ride inside `team`, so a player's invoice share drops their own
  // fare AND their part of the staff fares.
  const perPlayerInvoice = perPlayer - farePerHead - (farePerHead * staff) / players;
  const invoiceTotal = cents(total - flightsTotal) / 100;
  const deposit = Math.round(cents(invoiceTotal) * DEPOSIT_RATE) / 100;
  const instalment = (invoiceTotal - deposit) / INSTALMENTS.length;
  return {
    lines, total, flightsTotal, invoiceTotal, deposit, instalment,
    perPlayer, perPlayerInvoice, perAdult, onRequest, hasEstimates: estimates,
  };
}

export function defaultVans(players: number, staff: number): number {
  return Math.max(1, Math.ceil((players + staff) / VAN_SEATS));
}

/** Rebuild a QuoteInput from anything (a URL, a request body), clamped to what
 *  the page itself allows. ClubOS prices ONLY what comes out of this. */
export function cleanInput(raw: any): QuoteInput | null {
  if (!raw || typeof raw !== "object") return null;
  const origin = ORIGINS.some((o) => o.id === raw.origin) ? (raw.origin as Origin) : null;
  if (!origin) return null;
  const pkg = PACKAGES_FOR[origin].includes(raw.pkg) ? (raw.pkg as PackageId) : null;
  if (!pkg) return null;
  const ageRow = AGE_GROUPS.find((a) => a.id === raw.age);
  if (!ageRow) return null;
  const int = (v: any, lo: number, hi: number, d: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  const travel = pkg !== "entry";
  const city = typeof raw.city === "string" && CITIES.some((c) => c.code === raw.city) ? raw.city : undefined;
  return {
    origin, pkg, age: ageRow.id,
    players: int(raw.players, 5, 25, ageRow.squad),
    staff: int(raw.staff, 0, 6, 2),
    adults: int(raw.adults, 0, 40, 0),
    nights: travel ? int(raw.nights, BASE_NIGHTS, 8, BASE_NIGHTS) : 0,
    vans: travel ? int(raw.vans, 0, 6, 1) : 0,
    breakfast: raw.breakfast !== false,
    entryMarquee: !travel && raw.entryMarquee === true,
    entryLunch: !travel && raw.entryLunch === true,
    addOns: Array.isArray(raw.addOns) ? ADD_ONS.filter((a) => raw.addOns.includes(a.id)).map((a) => a.id) : [],
    city,
    flights: raw.flights === true && !!city,
  };
}

export const shortDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" });

export const nzd = (v: number, cents = false) =>
  "$" + v.toLocaleString("en-NZ", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
