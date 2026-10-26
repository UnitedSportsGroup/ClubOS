// ─────────────────────────────────────────────────────────────────────────────
// grapes/blocks.ts — the core email block palette (drag-onto-canvas tiles).
//
// Every block's `content` is MJML, so everything the user drops compiles to
// email-safe, Outlook-hardened HTML. Structure blocks (Section / 2-Column /
// 3-Column) are full <mj-section> rows; content blocks (Heading / Text / Button /
// Image / Logo / Divider / Spacer) are bare MJML elements that drop INTO a column
// (the email-safe nesting model — GrapesJS only highlights valid drop targets).
//
// ── EXTENSION POINT (for the club-blocks agent) ──────────────────────────────
// Add new blocks WITHOUT touching this file's core:
//
//   import { registerBlock, type EmailBlockDef } from "./blocks";
//   import { brandCanvasTheme } from "./brand";
//
//   export function registerClubBlocks(editor, brandKey) {
//     const b = brandCanvasTheme(brandKey);
//     const fixtureCard: EmailBlockDef = {
//       id: "club-fixture-card",
//       label: "Fixture card",
//       category: "Club blocks",
//       media: thumb(frame(...)),         // 56×36 wireframe of what it drops (helpers below)
//       content: `<mj-section ...>…</mj-section>`,  // MJML; use {{merge_tags}} freely
//     };
//     registerBlock(editor, fixtureCard);
//   }
//
// Then call registerClubBlocks(editor, brandKey) after createEmailEditor(...).
// Rules for a good club block:
//   • content MUST be valid MJML (section→column→content) so it compiles.
//   • pull brand colours from brandCanvasTheme(brandKey) — never hardcode hex.
//   • category "Club blocks" keeps them grouped under their own header.
//   • real data is baked at insert-time OR left as {{merge_tags}} the send engine fills.
//
// The "Highlight card" at the bottom is a working example of the pattern.
// ─────────────────────────────────────────────────────────────────────────────

import type { Editor } from "grapesjs";
import { brandCanvasTheme, type BrandCanvas } from "./brand";

/** A palette block. `content` is an MJML string; `media` is an inline SVG icon. */
export interface EmailBlockDef {
  /** unique block id, e.g. "email-heading" or "club-fixture-card" */
  id: string;
  /** palette label */
  label: string;
  /** category header the tile groups under (e.g. "Layout", "Club blocks") */
  category: string;
  /** inline SVG string for the tile: a 56×36 wireframe thumbnail of the block (see thumb()) */
  media: string;
  /** MJML content dropped onto the canvas */
  content: string;
  /** optional attributes applied to the dropped component */
  attributes?: Record<string, unknown>;
  /** select the dropped component at once (a picture, so the logo/upload picker is right there) */
  select?: boolean;
}

/** Context handed to block builders — the resolved brand canvas theme. */
export interface BlockContext {
  brand: BrandCanvas;
}

/**
 * Register ONE block. The public extension primitive — call this from a club-blocks
 * module to add a block without editing the core palette.
 */
export function registerBlock(editor: Editor, def: EmailBlockDef): void {
  editor.BlockManager.add(def.id, {
    label: def.label,
    category: def.category,
    media: def.media,
    content: def.content,
    attributes: { class: "ce-block-tile", ...(def.attributes ?? {}) },
    ...(def.select ? { select: true } : {}),
  });
}

/**
 * Register the full core palette. Called once by createEmailEditor. Pass a `ctx`
 * to override the resolved brand (otherwise derived from brandKey).
 */
export function registerBlocks(editor: Editor, brandKey: string, ctx?: Partial<BlockContext>): void {
  const brand = ctx?.brand ?? brandCanvasTheme(brandKey);
  const c: BlockContext = { brand };
  // Registration order drives category + tile order in the palette.
  for (const def of coreBlocks(c)) registerBlock(editor, def);
}

// ── the core palette ─────────────────────────────────────────────────────────

const CAT_LAYOUT = "Layout";
const CAT_CONTENT = "Content";
const CAT_BLOCKS = "Blocks";
const CAT_CLUB = "Club blocks";

const IMG_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='560'%20height='280'%3E%3Crect%20width='100%25'%20height='100%25'%20fill='%23e5e7eb'/%3E%3Cpath%20d='M0%20220l160-120%20120%2090%20120-70%20160%20120v40H0z'%20fill='%23cbd5e1'/%3E%3Ccircle%20cx='150'%20cy='90'%20r='34'%20fill='%23cbd5e1'/%3E%3C/svg%3E";

function coreBlocks(c: BlockContext): EmailBlockDef[] {
  const b = c.brand;
  return [
    // ── Layout ────────────────────────────────────────────────────────────
    {
      id: "email-section",
      label: "Section",
      category: CAT_LAYOUT,
      media: svgSection(),
      content: `<mj-section background-color="${b.surface}" padding="20px 28px">
  <mj-column>
    <mj-text color="${b.text}" font-size="15px" line-height="1.7">New section — double-click to edit this text, or drop blocks into it.</mj-text>
  </mj-column>
</mj-section>`,
    },
    {
      id: "email-2col",
      label: "2 columns",
      category: CAT_LAYOUT,
      media: svgCols(2),
      content: `<mj-section background-color="${b.surface}" padding="20px 28px">
  <mj-column width="50%"><mj-text color="${b.text}" font-size="15px" line-height="1.7">Left column.</mj-text></mj-column>
  <mj-column width="50%"><mj-text color="${b.text}" font-size="15px" line-height="1.7">Right column.</mj-text></mj-column>
</mj-section>`,
    },
    {
      id: "email-3col",
      label: "3 columns",
      category: CAT_LAYOUT,
      media: svgCols(3),
      content: `<mj-section background-color="${b.surface}" padding="20px 24px">
  <mj-column width="33.33%"><mj-text color="${b.text}" font-size="14px" line-height="1.6">One.</mj-text></mj-column>
  <mj-column width="33.33%"><mj-text color="${b.text}" font-size="14px" line-height="1.6">Two.</mj-text></mj-column>
  <mj-column width="33.33%"><mj-text color="${b.text}" font-size="14px" line-height="1.6">Three.</mj-text></mj-column>
</mj-section>`,
    },
    {
      id: "email-divider",
      label: "Divider",
      category: CAT_LAYOUT,
      media: svgDivider(),
      content: `<mj-divider border-color="${b.border}" border-width="1px" padding="10px 0" />`,
    },
    {
      id: "email-spacer",
      label: "Spacer",
      category: CAT_LAYOUT,
      media: svgSpacer(),
      content: `<mj-spacer height="24px" />`,
    },

    // ── Content ───────────────────────────────────────────────────────────
    {
      id: "email-heading",
      label: "Heading",
      category: CAT_CONTENT,
      media: svgHeading(),
      content: `<mj-text color="${b.heading}" font-family="${b.font}" font-size="26px" font-weight="800" line-height="1.25" letter-spacing="-0.4px">Section heading</mj-text>`,
    },
    {
      id: "email-text",
      label: "Text",
      category: CAT_CONTENT,
      media: svgText(),
      content: `<mj-text color="${b.text}" font-family="${b.font}" font-size="15px" line-height="1.7">Body copy. Double-click to edit. Keep it short and human — one idea per paragraph reads best on a phone.</mj-text>`,
    },
    {
      id: "email-button",
      label: "Button",
      category: CAT_CONTENT,
      media: svgButton(),
      content: `<mj-button background-color="${b.accent}" color="${b.onAccent}" href="https://" font-family="${b.font}" border-radius="10px" font-weight="700" inner-padding="13px 26px" align="left">Click here</mj-button>`,
    },
    {
      id: "email-image",
      label: "Image",
      category: CAT_CONTENT,
      media: svgImage(),
      content: `<mj-image src="${IMG_PLACEHOLDER}" alt="" border-radius="8px" padding="10px 0" />`,
      select: true, // the logo/upload picker opens on the dropped picture
    },
    {
      id: "email-logo",
      label: "Logo",
      category: CAT_CONTENT,
      media: svgLogo(),
      content: `<mj-image src="${b.logoUrl ?? IMG_PLACEHOLDER}" alt="${escapeAttr(b.name)}" width="150px" align="left" padding="6px 0" />`,
      select: true,
    },

    // ── Blocks ────────────────────────────────────────────────────────────
    {
      id: "email-social",
      label: "Social row",
      category: CAT_BLOCKS,
      media: svgSocial(),
      content: `<mj-section background-color="${b.surface}" padding="8px 28px">
  <mj-column>
    <mj-social font-size="13px" icon-size="28px" mode="horizontal" align="center">
      <mj-social-element name="facebook-noshare" href="https://facebook.com/" background-color="${b.accent}"></mj-social-element>
      <mj-social-element name="instagram-noshare" href="https://instagram.com/" background-color="${b.accent}"></mj-social-element>
      <mj-social-element name="web" href="https://" background-color="${b.accent}"></mj-social-element>
    </mj-social>
  </mj-column>
</mj-section>`,
    },
    {
      id: "email-footer",
      label: "Footer",
      category: CAT_BLOCKS,
      media: svgFooter(),
      content: `<mj-section background-color="${b.bg}" padding="18px 28px 26px">
  <mj-column>
    <mj-text color="${b.muted}" font-family="${b.font}" font-size="12px" line-height="1.6" align="center">
      ${escapeText(b.name)} · Christchurch, New Zealand<br />
      You're receiving this because you're part of ${escapeText(b.name)}.<br />
      <a href="{{unsubscribe_url}}" style="color:${b.muted};text-decoration:underline;">Unsubscribe</a>
    </mj-text>
  </mj-column>
</mj-section>`,
    },

    // ── Club blocks (example of the extension pattern) ──────────────────────
    {
      id: "email-highlight-card",
      label: "Highlight card",
      category: CAT_CLUB,
      media: svgStar(),
      content: `<mj-section background-color="${b.surface}" padding="8px 28px">
  <mj-column border="1px solid ${b.accent}" border-radius="14px" padding="22px">
    <mj-text color="${b.accent}" font-family="${b.font}" font-size="12px" font-weight="800" letter-spacing="1.5px" text-transform="uppercase">Highlight</mj-text>
    <mj-text color="${b.heading}" font-family="${b.font}" font-size="20px" font-weight="800" line-height="1.3" padding-top="6px">Something worth shouting about</mj-text>
    <mj-text color="${b.text}" font-family="${b.font}" font-size="14px" line-height="1.6" padding-top="6px">Use this card to draw the eye to your most important message — a signing, a result, a limited offer.</mj-text>
    <mj-button background-color="${b.accent}" color="${b.onAccent}" href="https://" font-family="${b.font}" border-radius="10px" align="left" padding-top="14px" inner-padding="11px 22px">Learn more</mj-button>
  </mj-column>
</mj-section>`,
    },
  ];
}

// ── palette thumbnails ────────────────────────────────────────────────────────
// A tile's media is a 56×36 WIREFRAME of what the block drops — two boxes for
// "2 columns", a picture for "Image", a dark band for "Footer" — never a glyph.
// Daniel (2026-10-26): "the icons are the same, so it doesn't actually show
// you what you're getting … you should be able to see 'oh, it's three
// columns'." Drawn in currentColor so the tile recolours on hover.
//
// 🔴 Every shape declares its own fill. GrapesJS's own stylesheet paints
// `fill: currentColor` onto every block SVG, which is how the old outline
// icons (fill="none" on the ROOT only) became identical solid blobs: the fill
// swallowed the lines inside each rectangle. A layout block is drawn inside the
// email-row frame; a content block (a piece that drops INTO a column) is drawn
// bare and larger, which is also the nesting model made visible.

/** The 56×36 thumbnail shell. */
export function thumb(inner: string): string {
  return `<svg viewBox="0 0 56 36" width="56" height="36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}
/** A tinted placeholder block. `extra` takes raw attributes (e.g. a class). */
export function blk(x: number, y: number, w: number, h: number, o = 0.22, r = 1.5, extra = ""): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="currentColor" fill-opacity="${o}"${extra ? " " + extra : ""}/>`;
}
/** A line of text. */
export function line(x: number, y: number, w: number, o = 0.35, h = 2): string {
  return blk(x, y, w, h, o, h / 2);
}
/** A white line (on a dark band or a button). */
export function lightLine(x: number, y: number, w: number, o = 0.9, h = 2): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#ffffff" fill-opacity="${o}"/>`;
}
/** The email row: a bordered frame the content sits in. */
export function frame(inner: string, o = 0.05): string {
  return `<rect x="0.5" y="0.5" width="55" height="35" rx="3" fill="currentColor" fill-opacity="${o}" stroke="currentColor" stroke-opacity="0.45"/>${inner}`;
}
/** A bordered card inside the row. */
export function card(x: number, y: number, w: number, h: number, inner = ""): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-opacity="0.6"/>${inner}`;
}
/** A solid button pill. */
export function pill(x: number, y: number, w: number, h = 5, o = 0.75): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="currentColor" fill-opacity="${o}"/>`;
}
/** A picture placeholder: a tinted area with a horizon and a sun. */
export function picture(x: number, y: number, w: number, h: number, o = 0.16): string {
  const n = (v: number) => Math.round(v * 10) / 10;
  const hill = `M${n(x + 1)} ${n(y + h - 1)}L${n(x + w * 0.3)} ${n(y + h * 0.5)}L${n(x + w * 0.52)} ${n(y + h * 0.76)}L${n(x + w * 0.7)} ${n(y + h * 0.58)}L${n(x + w - 1)} ${n(y + h - 1)}Z`;
  return (
    blk(x, y, w, h, o, 1.5) +
    `<path d="${hill}" fill="currentColor" fill-opacity="0.3"/>` +
    `<circle cx="${n(x + w * 0.76)}" cy="${n(y + h * 0.28)}" r="${n(Math.min(w, h) * 0.11)}" fill="currentColor" fill-opacity="0.5"/>`
  );
}
/** A full-bleed dark band (hero, video) with a soft highlight. */
export function darkRow(inner: string, o = 0.6): string {
  return `<rect x="0.5" y="0.5" width="55" height="35" rx="3" fill="currentColor" fill-opacity="${o}"/>${inner}`;
}
/** One column box; `class="col"` lets a check count them. */
function colBox(x: number, w: number): string {
  const inset = w > 16 ? 3 : 2.5;
  return (
    blk(x, 5, w, 26, 0.14, 2, 'class="col"') +
    line(x + inset, 10, w - inset * 2, 0.5, 2.5) +
    line(x + inset, 16, w - inset * 2) +
    line(x + inset, 21, Math.max(4, w - inset * 2 - 4))
  );
}

function svgSection() {
  return thumb(frame(line(6, 8, 20, 0.6, 3) + line(6, 15, 42) + line(6, 20, 34) + pill(6, 25, 14)));
}
function svgCols(n: number) {
  if (n === 3) return thumb(frame(colBox(5, 14) + colBox(21, 14) + colBox(37, 14)));
  return thumb(frame(colBox(5, 22) + colBox(29, 22)));
}
function svgDivider() {
  return thumb(
    frame(
      line(6, 8, 40) +
        line(6, 13, 28) +
        `<rect x="6" y="17.25" width="44" height="1.5" rx="0.75" fill="currentColor" fill-opacity="0.8"/>` +
        line(6, 22, 40) +
        line(6, 27, 24),
    ),
  );
}
function svgSpacer() {
  return thumb(
    frame(
      blk(5, 4, 46, 8) +
        blk(5, 24, 46, 8) +
        `<path d="M28 13.5v9" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.2" stroke-linecap="round"/>` +
        `<path d="M25.5 16l2.5-2.5 2.5 2.5M25.5 20l2.5 2.5 2.5-2.5" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    ),
  );
}
function svgHeading() {
  return thumb(
    `<text x="28" y="27" text-anchor="middle" font-size="24" font-weight="800" letter-spacing="-1" fill="currentColor" fill-opacity="0.8">Aa</text>`,
  );
}
function svgText() {
  return thumb(line(6, 7, 44, 0.4, 2.5) + line(6, 13, 44, 0.4, 2.5) + line(6, 19, 38, 0.4, 2.5) + line(6, 25, 26, 0.4, 2.5));
}
function svgButton() {
  return thumb(pill(10, 11, 36, 14) + lightLine(21, 17, 14));
}
function svgImage() {
  return thumb(picture(5, 4, 46, 28) + `<rect x="5" y="4" width="46" height="28" rx="2" fill="none" stroke="currentColor" stroke-opacity="0.5"/>`);
}
function svgLogo() {
  return thumb(
    `<circle cx="28" cy="18" r="12" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.3"/>` +
      `<circle cx="28" cy="18" r="7.5" fill="none" stroke="currentColor" stroke-opacity="0.5"/>` +
      `<path d="M28 13.5l1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5z" fill="currentColor" fill-opacity="0.6"/>`,
  );
}
function svgSocial() {
  return thumb(
    frame([14.5, 23.5, 32.5, 41.5].map((cx) => `<circle cx="${cx}" cy="18" r="4" fill="currentColor" fill-opacity="0.5"/>`).join("")),
  );
}
function svgFooter() {
  return thumb(
    frame(
      line(16, 7, 24, 0.3) +
        line(20, 11, 16, 0.25) +
        `<path d="M0.5 17h55v15.5a3 3 0 0 1-3 3h-49a3 3 0 0 1-3-3z" fill="currentColor" fill-opacity="0.6"/>` +
        lightLine(17, 22, 22, 0.85) +
        lightLine(21, 27, 14, 0.6),
    ),
  );
}
function svgStar() {
  return thumb(frame(card(6, 5, 44, 26, line(10, 9.5, 10, 0.7) + line(10, 14, 26, 0.55, 3) + line(10, 19.5, 30, 0.3) + pill(10, 24, 14))));
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
