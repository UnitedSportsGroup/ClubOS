// Brand design packs for Content Studio's AI designer (landing pages and social graphics
// drawn from scratch in HTML/CSS). Every hex and rule is lifted from the brand hubs
// (apps/*-brand/src/data/brand.ts + components + tailwind.config), the live sites' tailwind
// tokens and the brand memory notes. Fonts are GOOGLE FONTS names only (they load from
// fonts.googleapis.com); where the real brand face is not on Google Fonts the note says so.
// Pure data, no imports: usable on the server and in the browser.

export interface BrandPack {
  key: string;
  name: string;
  palette: { token: string; hex: string; use: string }[];
  fonts: { display: string; displayWeights: string; body: string; bodyWeights: string; note: string };
  rules: string;
  source: string;
}

const lines = (l: string[]) => l.map((s) => "- " + s).join("\n");

export const BRAND_PACKS: Record<string, BrandPack> = {
  cufc: {
    key: "cufc",
    name: "Christchurch United FC",
    palette: [
      { token: "--brand-navy", hex: "#0C1640", use: "Midnight Navy: default dark ground, covers, backgrounds" },
      { token: "--brand-royal", hex: "#263996", use: "United Royal: the club colour; leads panels, buttons, big colour fields" },
      { token: "--brand-gold", hex: "#D4AF37", use: "Chatham Gold: accent only (eyebrows, rules, one key word); never a flood" },
      { token: "--brand-sky", hex: "#17A6E0", use: "Touchline Sky: links and data on screens, sparingly" },
      { token: "--brand-ink", hex: "#13182F", use: "Card and panel surface on navy" },
      { token: "--brand-mist", hex: "#F3F6FC", use: "Light section background" },
      { token: "--brand-white", hex: "#FFFFFF", use: "Type on dark, away-shirt white, clean light grounds" },
    ],
    fonts: {
      display: "Oswald",
      displayWeights: "500;600;700",
      body: "Inter",
      bodyWeights: "400;500;600;700",
      note: "Both are the real brand faces. The brand hub names Oswald as the signature display face; Oswald for headlines and numbers only, Inter for everything else. No third typeface.",
    },
    rules: lines([
      "Royal blue leads. Dominant ground is Midnight Navy or United Royal; white is the breathing space. Gold is a trim, never a flood (aim for under 10% of the area).",
      "Headlines: Oswald, always UPPERCASE, condensed, letter-spacing about 0.015em, line-height about 1.0. Big numbers and scorelines also Oswald.",
      "Eyebrow labels: Inter SemiBold, uppercase, tracking about 0.34em (small, 11-12px), in gold.",
      "Body copy: Inter Regular, plain English, short sentences. Muted text on navy is about white at 60-70%.",
      "Signature line: \"From first kicks to the first team\" set in Oswald caps.",
      "Thin gold hairline rules and a thin gold hairline frame suit matchday graphics. A working matchday ground is a navy to royal gradient (e.g. 122deg, #0C1640 to #263996) with a faint gold radial.",
      "Cards on navy: very light white tint (about 3-5%) with a 1px white 10-15% border, rounded corners.",
      "Photography: real moments over posed, faces over formations, from first kicks (age 4) to first team, United Sports Centre pitches, generations and heritage. Black-and-white archive is legitimate. Never stock.",
      "Crest: current crest only, on its own, never stretched, rotated, recoloured, shadowed, faded or cropped. Clear space equal to the height of its gold stars. Minimum 24px on screen.",
      "Voice: we and our, never \"the club\". Plain, specific, warm, quiet (let facts brag). Avoid elevate, transform, unleash, journey, and naming values outright.",
      "DON'T: use Inter as the headline face, add a third font, put SIU or OFC language on CUFC pieces, or use sky blue in place of royal.",
    ]),
    source: "apps/cufc-brand (src/data/brand.ts, SectionsB.tsx type rules, index.css), apps/cufc-website/tailwind.config.js, memory reference_cufc_brand_assets + feedback_cufc_brand_voice",
  },

  siu: {
    key: "siu",
    name: "South Island United",
    palette: [
      { token: "--brand-black", hex: "#000000", use: "Unity Black: foundation ground and type (site uses #050505 / #0A0A0A panels)" },
      { token: "--brand-white", hex: "#FFFFFF", use: "Innovation White: clarity, space, home-kit pieces" },
      { token: "--brand-green", hex: "#1B3D24", use: "Leader Green: the South Island itself; secondary anchor for depth (deep: #122A19)" },
      { token: "--brand-gold", hex: "#C59949", use: "Ambition Gold: the accent that lifts; restraint, never a flood (light: #DDB877)" },
      { token: "--brand-bone", hex: "#F4F1EA", use: "Warm light ground on the site (hub paper #FAF8F3)" },
      { token: "--brand-panel", hex: "#101010", use: "Raised panels on black" },
    ],
    fonts: {
      display: "Oswald",
      displayWeights: "500;700",
      body: "Inter",
      bodyWeights: "400;500;600;700",
      note: "Real faces: Rough Cut (display, greenstone-hook letterforms) and Arpona (body, angular geometric); neither is on Google Fonts. Substitute Oswald uppercase for Rough Cut and Inter for Arpona.",
    },
    rules: lines([
      "Black-led. Dominant ground is black; white and Leader Green are the supporting fields; gold is the single accent (a rule, a key word, a number).",
      "Headlines: display face in UPPERCASE only, titles and subtitles only. Never mix in a third typeface.",
      "Layout character: sharp, confident, lots of black space; centred hero with a short gold rule under the headline is the house move.",
      "Gold used with restraint. Green is depth and belonging (landscape, greenstone), not a decoration colour.",
      "Motifs: Southern Alps, Aoraki / Mount Cook, the Southern Cross, a topographic contour pattern (green and gold on the third kit). Mountains are the pattern language; keep them subtle and tonal.",
      "Kits: Home = white with black and gold; Away = black and gold with mountain pattern; Third = green and gold with topographic pattern.",
      "Photography: a human club (real individuals, effort, pride), supporters as a living force, game-on intensity, and the South Island landscape and local detail. Authenticity over perfection.",
      "Crest: the circular crest leads (Alps, Southern Cross). Never stretch, rotate, recolour off-palette, add shadows or effects, lower opacity, or crop and crowd it. Clear space and 24px minimum.",
      "Voice: bold not arrogant, playful not corporate, rooted in the South, growth focused, community first.",
      "DON'T: use CUFC blue, add a third typeface, or flood a layout with gold.",
    ]),
    source: "apps/siu-brand (brand.ts, SectionsB.tsx, tailwind.config.js), apps/siu-website/tailwind.config.js, memory project_siu_brand_site",
  },

  mfl: {
    key: "mfl",
    name: "Mini Football Leagues",
    palette: [
      { token: "--brand-ink", hex: "#0A0A0A", use: "Ink Black: the base; football under lights" },
      { token: "--brand-gold", hex: "#D1B96E", use: "League Gold: signature accent; buttons, highlights, key words; never a flood" },
      { token: "--brand-softgold", hex: "#E6D5A0", use: "Soft Gold: hover and secondary highlight, always with League Gold" },
      { token: "--brand-white", hex: "#FFFFFF", use: "Space and readable copy" },
      { token: "--brand-coal", hex: "#121212", use: "Raised cards and panels on black" },
      { token: "--brand-line", hex: "#262626", use: "Borders and dividers on black" },
      { token: "--brand-paper", hex: "#FAF8F0", use: "Light sections (hub neutral)" },
    ],
    fonts: {
      display: "Anton",
      displayWeights: "400",
      body: "Inter",
      bodyWeights: "400;500;600;700;800",
      note: "Real faces (both on Google Fonts). Anton is the shout: headlines, always uppercase. Inter does everything else.",
    },
    rules: lines([
      "Dark and gold. Black ground, white copy, gold accents. Night-game feel: floodlights, green turf, dark sky.",
      "Headlines: Anton, UPPERCASE, big, scoreboard energy, line-height about 0.95-1.0. One gold word or line per headline.",
      "Gold goes on buttons, key words, rules and small highlights; keep it under about 15% of the area. Soft Gold only alongside League Gold.",
      "Body and UI: Inter. Cards are Coal #121212 with 1px #262626 borders. Keep layouts clean, never cluttered or shouty.",
      "Eyebrows: Inter, uppercase, wide tracking (about 0.3em), small, gold or white at 60%.",
      "Motifs: the gold ball inside the roundel; flowing ball panels; trophy gold for finals-night moments.",
      "Photography: real people (mates, workmates, all ages), under the lights, the ball in play, and the real cages and turf at United Sports Centre. Real over posed.",
      "Logo: the primary roundel leads; the gold ball icon (or one-colour white/black) for small and watermark uses. On photography use the white or full-colour roundel with contrast. No stretching, rotating, recolouring, shadows, fading or crowding.",
      "Voice: like a mate organising the game, not a federation. Welcoming, straight-up, playful, local to Christchurch.",
      "DON'T: use orange (that was a discarded rebrand), use gold as a background flood, or set headlines in lower case.",
    ]),
    source: "apps/mfl-brand (brand.ts, SectionsB.tsx, tailwind.config.js), apps/mfl-website/tailwind.config.js, memory project_mfl_brand_site",
  },

  cic: {
    key: "cic",
    name: "Christchurch International Cup",
    palette: [
      { token: "--brand-ink", hex: "#141511", use: "Pitch Black: warm near-black, the default background" },
      { token: "--brand-gold", hex: "#C9A43E", use: "CIC Gold: identity colour; headlines, buttons, key accents" },
      { token: "--brand-softgold", hex: "#DDBB5E", use: "Lighter gold for hover" },
      { token: "--brand-white", hex: "#FFFFFF", use: "Clarity: body copy, fixtures, information" },
      { token: "--brand-coal", hex: "#1B1C15", use: "Cards and panels on black" },
      { token: "--brand-line", hex: "#2C2D23", use: "Hairline borders" },
      { token: "--brand-mute", hex: "#CFD7DA", use: "Muted body text on dark" },
    ],
    fonts: {
      display: "Kanit",
      displayWeights: "600;800;900",
      body: "Inter",
      bodyWeights: "400;500;600;700",
      note: "Real faces (both on Google Fonts). Kanit headlines only, extrabold, uppercase, tight; Inter for everything else.",
    },
    rules: lines([
      "Gold on black and white, single accent. Warm near-black stage, white information, gold carrying headlines, buttons and key accents.",
      "Headlines: Kanit ExtraBold, always UPPERCASE, set tight (letter-spacing about -0.02em, leading tight). Short, direct.",
      "Numbers that matter (scores, countdowns, dates) are in Kanit and made huge.",
      "Body, fixtures, forms, labels: Inter. Lead with what families need: dates, times, where to be.",
      "Cards: Coal #1B1C15 with Line #2C2D23 hairlines. Hairlines not boxes.",
      "Motif: the trophy silhouette (gold first) is a sanctioned secondary icon.",
      "Photography: broadcaster treatment for kids: low angles, tight frames, hero moments; real celebration (goal mobs, medals), never posed or everyone looking at camera; real football action; the occasion (finals day, tents, flags, crowds at United Sports Centre).",
      "Crest: main logo is the black badge on light surfaces; on dark surfaces place the white artwork straight on. NEVER put white circles, boxes or chips behind the badge, and no inverted white-disc version.",
      "Voice: big-stage but never big-headed; confident, warm, clear. Celebrate players and clubs by name.",
      "DON'T: use lime/volt #CFFD5A (that is CIC 7's navy-and-lime, not CIC Youth), hype with no information, use jargon, or talk down to kids.",
    ]),
    source: "apps/cic-brand (brand.ts, SectionsB.tsx, tailwind.config), apps/cicyouth-website/tailwind.config, memory reference_cic_brand + project_cic_brand_site",
  },

  cugc: {
    key: "cugc",
    name: "Christchurch United Gymnastics Club",
    palette: [
      { token: "--brand-cream", hex: "#FFF8F0", use: "Cream: the background; warm, calm, most pieces sit on it" },
      { token: "--brand-navy", hex: "#013590", use: "United Navy: crest, headings, buttons, club colour surfaces (deep #01296E)" },
      { token: "--brand-sky", hex: "#0099FF", use: "Sky Blue: links, highlights, small moments of energy; sparingly" },
      { token: "--brand-gold", hex: "#D9B10F", use: "Gold: ring-around-the-crest accent, rules, medals, the motto; a touch only" },
      { token: "--brand-sand", hex: "#F4ECDF", use: "Alternating section background" },
      { token: "--brand-beige", hex: "#E8DBC9", use: "Borders and card edges" },
      { token: "--brand-ink", hex: "#191919", use: "Headings (body text slate #3D3D3D)" },
    ],
    fonts: {
      display: "Instrument Serif",
      displayWeights: "400 (regular and italic)",
      body: "Inter",
      bodyWeights: "400;500;600;700;800",
      note: "Instrument Serif and Inter are the real faces. The hero voice is Satoshi Bold Italic (Fontshare, not Google); substitute Inter 800 italic, one big hero statement per piece.",
    },
    rules: lines([
      "Warm and light, unlike the other brands: cream ground (gym hall in morning light), navy for weight, gold as a sliver. Not a cold white screen.",
      "Hero statement (one per page, big): bold italic sans (Satoshi; Inter 800 italic as substitute). Section and card headings: Instrument Serif italic. Everything else Inter.",
      "SENTENCE CASE everywhere. We don't shout in all caps.",
      "Alternate cream and sand sections; borders in beige; headings ink, body slate.",
      "Navy for crest, buttons, club-colour panels; sky only for links and small highlights; gold for rules, medals, the motto.",
      "Motto: \"Be Bright. Be Beautiful. Be You.\" Use it exactly as written, all three beats, full stops included. Never shorten, reorder or rewrite.",
      "Motifs: roundel with gymnast and silver fern; gold ring; ribbons and movement implied by the italic serif.",
      "Photography: real CUGC gymnasts in the real gym, never stock. A wobble, a grin, training and the coach's eye, competition focus without podium worship. Warm natural light, true colour, warm skin tones, no heavy filters or moody desaturation.",
      "Voice: a club, not an academy. Specific (Hornby, Saturday 9am, a first cartwheel), serious about the work, casual about the hype. Cut anything that reads like a brochure.",
      "DON'T: use all caps, use a fourth typeface, use stock imagery, or put the club on a dark ground by default.",
    ]),
    source: "apps/cugc-brand (brand.ts, SectionsB.tsx, index.css, tailwind.config), apps/cugc-website/tailwind.config, memory project_cugc_brand_site",
  },

  usc: {
    key: "usc",
    name: "United Sports Centre",
    palette: [
      { token: "--brand-midnight", hex: "#050810", use: "Midnight: the base; every USC surface starts here" },
      { token: "--brand-court", hex: "#0A0E1A", use: "Court Navy: cards and raised layers on Midnight (the booking site's navy)" },
      { token: "--brand-white", hex: "#FFFFFF", use: "All type on dark surfaces" },
      { token: "--brand-indigo", hex: "#6366F1", use: "Signal Indigo: the accent; buttons, links, live states, wayfinding" },
      { token: "--brand-indigo-bright", hex: "#818CF8", use: "Bright indigo for hover and fine detail" },
      { token: "--brand-amber", hex: "#FBBF24", use: "Floodlight Amber: sold-out flashes, member moments; a sliver only" },
      { token: "--brand-paper", hex: "#F7F7F9", use: "Light ground when needed (hub neutral)" },
    ],
    fonts: {
      display: "Archivo Black",
      displayWeights: "400",
      body: "Inter Tight",
      bodyWeights: "400;500;600;700",
      note: "Real faces (both on Google Fonts). Archivo Black headlines only, uppercase, big; if it cannot be big use Inter Tight Bold instead.",
    },
    rules: lines([
      "Night-game navy. Two navies (Midnight and Court) give depth; all type is white; indigo is the single lead accent.",
      "Headlines: Archivo Black, UPPERCASE, kept big. Never a small Archivo Black line.",
      "Body, labels, buttons, data: Inter Tight. Numbers and data in Inter Tight, tabular where they line up.",
      "Indigo is for anything that wants attention: book here, this way, now open. Amber is a sliver (a flash, a tag), never competing with indigo.",
      "Should read instantly from a moving car or a phone screen: high contrast, big type, little copy.",
      "Photography: drone aerials as the signature frame (twenty hectares in one image), floodlit turf against a deep navy sky, every code of sport; honest before polished.",
      "Venue facts to draw on: two artificial pitches, two cage courts, grass fields, gymnastics hall, United Print studio; home of the United group brands.",
      "Logo: the USC mark (ram) on Midnight; the group brand logos appear as a row of partners, not mixed into the headline.",
      "DON'T: introduce a third typeface, use amber as a ground, or use light grounds by default.",
    ]),
    source: "apps/usc-brand (brand.ts, SectionsB.tsx, tailwind.config), memory project_usc_brand_site",
  },

  usg: {
    key: "usg",
    name: "United Sports Group",
    palette: [
      { token: "--brand-midnight", hex: "#05070B", use: "Midnight: base for every group document, deck and screen" },
      { token: "--brand-navy", hex: "#121A2B", use: "Deep Navy: panels and cards on Midnight" },
      { token: "--brand-royal", hex: "#222A57", use: "Royal: group-layer royal blue; weight, heritage, occasion" },
      { token: "--brand-gold", hex: "#D2B048", use: "Gold: the thread; rules, numbers, one italic line; never a flood" },
      { token: "--brand-gold-bright", hex: "#E9D284", use: "Bright Gold for fine type on the darkest grounds" },
      { token: "--brand-paper", hex: "#F2EEE3", use: "Paper: warm light ground for documents" },
    ],
    fonts: {
      display: "Fraunces",
      displayWeights: "500;600 (plus italic)",
      body: "Archivo",
      bodyWeights: "400;500;600",
      note: "Real faces (both on Google Fonts). Thin source: the brand hub only; keep this pack short.",
    },
    rules: lines([
      "Group layer, not a club: dark, calm, premium. Midnight ground, navy panels, gold as the thread.",
      "Headlines: Fraunces weight 500-600, title case, tight leading. Never all caps.",
      "Fraunces Italic is the accent: one gold kick line per page, not a paragraph style.",
      "Everything else Archivo. Eyebrow labels: Archivo SemiBold, uppercase, wide tracking, usually gold.",
      "Warm Paper (#F2EEE3), never stark white, for light sections.",
      "Never introduce a third typeface at the group layer.",
    ]),
    source: "apps/usg-brand (brand.ts, SectionsB.tsx type rules, tailwind.config). Thin source: no photography or voice section read; kept short",
  },

  prints: {
    key: "prints",
    name: "United Prints",
    palette: [
      { token: "--brand-royal", hex: "#043BCB", use: "Print Royal: lead colour; hero surfaces, buttons, links" },
      { token: "--brand-navy", hex: "#012583", use: "Deep Navy: headings on light, dark surfaces, footers" },
      { token: "--brand-grass", hex: "#33CC00", use: "Grass Green: signature accent; the PRINTS green, ticks, calls to action" },
      { token: "--brand-volt", hex: "#ADFF00", use: "Volt: highlighter box behind ONE word per headline; never body text" },
      { token: "--brand-mist", hex: "#F7FAFF", use: "Page background" },
      { token: "--brand-white", hex: "#FFFFFF", use: "Cards and panels" },
      { token: "--brand-slate", hex: "#4A5265", use: "Body copy" },
      { token: "--brand-cloud", hex: "#CBD1DE", use: "Borders and dividers" },
    ],
    fonts: {
      display: "Poppins",
      displayWeights: "800;900",
      body: "Poppins",
      bodyWeights: "400;500;600",
      note: "Real face (Google Fonts). One family only: weight is the signature, ExtraBold uppercase headlines, Regular body.",
    },
    rules: lines([
      "Light, bright and fast. Mist page, white cards, royal blue hero surfaces, green and volt as high-vis accents.",
      "Headlines: Poppins ExtraBold, UPPERCASE, tight leading. Headings on light backgrounds are Deep Navy.",
      "Highlight exactly ONE word per headline with a volt box (dark text on #ADFF00). Not two.",
      "Body copy: Poppins Regular in Slate, relaxed leading. Never a second typeface.",
      "Green is the link to the football club (the green in PRINTS); volt is energy for one word at a time, never a flood.",
      "The full-colour logo sits only on white (Paper White) surfaces; the wordmark blue #0000CC is for logo files only.",
      "Voice: plain-spoken, fast, direct, local to Christchurch; the community story is never a footnote (every order funds youth football). Real promises with real numbers (e.g. quote within three hours).",
      "Product truths for imagery: large format up to 1.6m wide, white ink, eco latex inks.",
      "DON'T: use a second font, use volt for body text, or put the full-colour logo on a busy or dark ground.",
    ]),
    source: "apps/united-prints-brand (brand.ts, SectionsB.tsx, tailwind.config). Thin source on photography; no layout system beyond these rules",
  },
};

export function brandPack(key: string | null | undefined): BrandPack {
  return (key && BRAND_PACKS[key]) || BRAND_PACKS.cufc;
}
