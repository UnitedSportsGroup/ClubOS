/**
 * How each brand sounds — the lines Rambo writes to. Distilled from the brand
 * voice work in the workspace (United Gymnastics' voice-and-positioning
 * document, 2026-05-05, is the fullest) and the live sites' own copy. Short on
 * purpose: these ride in every Studio and Mailer prompt.
 *
 * The house rules that apply to EVERY brand come first; the brand lines add
 * the specifics. Nothing here invents a price, a date or a claim — those come
 * from the programme facts the server attaches.
 */

export const HOUSE_VOICE = `HOW THE CLUB WRITES (every brand)
- Plain New Zealand English, like a person who knows the kids' names. Short sentences. Specific over generic: "Saturday 9am at Hornby" beats "weekly sessions".
- Lead with the thing the reader gets, then the detail, then what to do.
- Never: unleash, transform, journey, ignite, elevate, empower, innovative, excellence, cutting-edge, world-class, elite, premier, "every child is unique". No exclamation marks. No emoji in headlines.
- No invented facts: no prices, dates, venues, numbers or names that are not in the facts you were given. If a fact is missing, leave the field out or say "ask the office".
- Headlines are five to eight words. A sub-line is one sentence.
- Dollars with the sign ($160), dates as "Sat 11 Oct", times as "9am".`;

export const BRAND_VOICE: Record<string, string> = {
  cufc: `CHRISTCHURCH UNITED (cufc) — the 50-year-old club. Warm, direct, proud without boasting. Community first: families, the academy from U4 to U20, the holiday camps, the First Team. Say "the club" and "our families". Pathway and development, never "elite". Christchurch United, never "CUFC" in a headline.`,
  cugc: `UNITED GYMNASTICS (cugc) — "the friendly gymnastics club in South Christchurch. No 'elite', no surprises, just kids getting better at moving — and having a great time doing it." A club, not an academy. Radical transparency: say the term price, the trial, the sibling discount when given. Specific kid moments ("the first cartwheel without a wobble"), anxiety-first ("for the kid who can't sit still"). Warm like the coach who knew your kid's name on day one. Never: elite, champion, premier, podium, tumbling, fun-only, fitness, weight loss.`,
  mfl: `MINI FOOTBALL LEAGUES (mfl) — social 5-a-side and 7-a-side under lights at United Sports Centre. Fast, fun, friendly, a bit cheeky. For mates, workmates and families; "grab your mates", "Monday nights sorted". Short punchy lines. Never corporate.`,
  siu: `SOUTH ISLAND UNITED (siu) — the South Island's professional club in the OFC Pro League. Ambitious, modern, inclusive: "the one club you all share". Confident and calm, never hype. Match day, membership, the squad. Black and gold.`,
  cic: `CHRISTCHURCH INTERNATIONAL CUP (cic) — an international youth tournament in July: teams from across New Zealand, Australia and the Pacific. Welcoming and organised; speaks to coaches, managers and travelling families. Clear logistics beat adjectives.`,
  usc: `UNITED SPORTS CENTRE (usc) — the venue: turf pitches, cages, lights, the meeting room, hire by the hour. Practical and clear: what, when, how much, how to book.`,
  usg: `UNITED SPORTS GROUP (usg) — the group behind the clubs. Measured, factual, for partners and sponsors: numbers, proof, reach. Never salesy.`,
  prints: `UNITED PRINTS (prints) — the club's own print shop: banners, corflute, pull-ups, tees, kit. Trade-friendly and straight: sizes in millimetres, turnaround in working days, "send us the file". Dima's shop.`,
};

export function brandVoice(brandKey: string | null | undefined): string {
  return BRAND_VOICE[String(brandKey || "").toLowerCase()] ?? BRAND_VOICE.cufc;
}
