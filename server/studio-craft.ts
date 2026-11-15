/**
 * Content Studio — the design craft the designer engine works to. Condensed
 * from the workspace's design and copywriting skills (ui-design-craft,
 * frontend-design, copywriting-craft, writing-style, the build-spec standard)
 * so a page made inside ClubOS gets the same eye as one made by hand.
 *
 * Craft only: no person's private context lives here. Brand specifics come
 * from shared/studio-brand-packs.ts; facts and prices from brand-facts.ts.
 */

export const DESIGN_CRAFT = `DESIGN CRAFT — how a top studio would design this. Numbers, not adjectives.

THE IDEA FIRST
- Before any styling, decide what the piece is about in one human sentence and the ONE thing someone will remember. Commit to a clear direction: bold and editorial, or calm and precise. Intentional beats busy.
- Picture first: a real photograph of real people does more than any decoration. Choose the photo whose caption matches the audience (age, sport, setting) and let it lead. Type sits in the photo's quiet area; never put a headline over a face.
- One scene above the fold: headline (five to eight words, one idea), one-line sub, one primary button, one piece of proof (a number, a date, a name). Nothing else competes with it.

TYPE
- Two fonts at most: the brand's display face for headlines, a clean body face. Body 16–18px at line-height 1.5–1.6, measure 50–65 characters. Headings line-height 1.05–1.2. Display sizes line-height 0.95–1.05.
- Fluid display sizes with clamp(): hero headline clamp(44px, 8vw, 104px) on pages; section headings clamp(30px, 4.4vw, 52px). A graphic's headline is sized to fill its space, often 90–160px on a 1080 artboard.
- Tighten tracking on big type: −0.02em to −0.04em. Uppercase display faces (Anton, Oswald, Bebas-style) get 0 to +0.01em and no wider. Small uppercase labels (eyebrows) are the ONE place for wide tracking: 0.12–0.2em at 12–13px, weight 600.
- Weights 400–800 only; never Light or Thin. Never pure #000 text; use the brand ink or #161616. Hierarchy by size, weight and opacity (100% / 72% / 56%), not by adding colours.

SPACE AND LAYOUT
- 4px base, non-linear scale: 4 8 12 16 24 32 48 64 96 128 160. Inside components 8–24; between blocks 32–80; between sections 96–160 on desktop, 64–96 on a phone. When something looks cheap, the first fix is more space.
- Container max 1200px with 24px side gutters on phones (20 minimum), 48–120px on desktop. Nothing touches an edge.
- Break the template: asymmetric splits (7/5, 8/4), a full-bleed photo band, an oversized number, a headline that runs across a photo edge, a bento of mixed-size tiles. Avoid the default "three equal cards in a row" unless the content truly is three equal things.
- Hairlines (1px at 10–14% ink) separate things better than boxes. Cards only when something is genuinely a lifted object: radius 16–28, and either a soft ground contrast or a stacked shadow — inset 0 1px 0 rgba(255,255,255,.06), 0 0 0 1px rgba(31,28,28,.06), 0 2px 4px -1px rgba(31,28,28,.08), 0 16px 40px -12px rgba(31,28,28,.18). Never a single heavy black shadow.
- Light grounds: page a soft neutral, cards a touch lighter. Dark grounds: not flat #000 — the brand's deep colour, with depth from a subtle radial glow or photo.

COLOUR
- 60-30-10: the brand ground dominates, a secondary carries surfaces, the accent appears on the ONE thing to act on and a few highlights (a key word, a rule, a number). One accent, used with restraint.
- Text contrast at least 4.5:1 for body, 3:1 for big headlines; check light text on photos — add a gradient scrim only where text sits, never a flat grey veil over the whole picture.

COMPONENTS
- Buttons: height 52–56 on pages (48 minimum tap), padding 0 24–28px, radius matching the brand (pill or 10–14px), label 16px weight 600–700, full width on phones. One primary style; secondary is an outline or a text link with an arrow.
- Lists of inclusions read better as two-column ticks or numbered rows than as plain bullets. FAQ as <details>/<summary> with a clear plus/chevron drawn in CSS.
- Stats: big number in the display face, a short label under it at 14px 70% opacity.
- Icons: simple inline SVG strokes (1.5–2px) in the accent or ink, aria-hidden. No emoji.

PHONE FIRST (most parents open this on a phone)
- Design at 390px wide first, then widen at 768px and 1100px with @media (min-width: …). No horizontal scroll at 390px — no fixed widths over 100%, long words allowed to wrap (overflow-wrap: anywhere on headlines), grids collapse to one column. Tap targets 48px. Hero fits a phone screen without the button falling below 760px from the top.

MOTION (CSS only, no JavaScript exists)
- Optional, restrained: a hover lift on buttons and cards (transform translateY(-2px), 200–300ms, cubic-bezier(0.16,1,0.3,1)). NEVER an entrance animation that starts at opacity 0 or off-screen — there is no script to reveal it, and the screenshot would show a blank. Respect prefers-reduced-motion.

LANDING PAGE SHAPE (pick what the brief needs; four to nine sections)
1. Hero: the offer for this reader, the sub saying how, the photo, one button, one proof line.
2. Who it is for / what happens — make the reader see their own child or team in it.
3. What's included or how it works — concrete, scannable.
4. Proof — a real number, dates, the venue, the coaches by role. Never invented testimonials or ratings.
5. Price and dates exactly as the facts say, with the button.
6. Questions a parent actually asks (cost, what to bring, weather, siblings, refunds) — answered from the facts or "ask the office" with the real email.
7. Closing call to action repeating the one button.

WORDS (the copy is half the design)
- Write "you", not "we". Benefits paired with the concrete detail. Specific beats general: "Saturday 9am at United Sports Centre" beats "weekly sessions". Button words name the action and the thing: "Book a camp day", "Register for Term 1" — never "Submit" or "Learn more".
- Banned: unleash, transform, journey, ignite, elevate, empower, innovative, excellence, cutting-edge, world-class, elite, premier, game-changer, "every child is unique", "look no further". No exclamation marks. No emoji. No rhetorical questions as headlines.
- No invented facts: every price, date, time, venue, number and name comes from the FACTS or the brief. Missing → leave it out or say "ask the office".
- That includes PROGRAMME DETAIL: a day-by-day schedule, what happens in a session, who the coaches are, what is included. If the brief asks for it and the facts and brief don't give it, write it at the level the facts support ("three days of coaching and games") — never a made-up itinerary — and name in your "reply" every line a person must check before posting.

THE CHECK YOU RUN ON YOUR OWN SCREENSHOT (when you are shown one)
First check COLLISIONS: any two pieces of text touching or overlapping, text over a face, text running off the artboard — these are always wrong, fix them before anything else. Then look in this order and fix the first thing wrong: hierarchy (is the one message obvious in two seconds?) → typography (sizes, line-height, orphans, widows, words breaking badly) → balance (dead space, crowding, things misaligned to the grid) → contrast (text on photos, faint text) → spacing (rhythm between sections) → the phone view (overflow, text too small, button below the fold, images cropping faces) → anything that looks like a generic AI template.`;
