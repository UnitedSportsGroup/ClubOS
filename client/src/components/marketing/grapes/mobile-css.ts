// ─────────────────────────────────────────────────────────────────────────────
// grapes/mobile-css.ts — the ONE place a phone-only rule for a compiled email
// lives.
//
// MJML stacks a row's columns on a phone with a head <style> media query of its
// own (`.mj-column-per-30 { width:30% }` inside `min-width:480px`). The rules
// here ride in the same <head>, so they work in exactly the clients the
// stacking works in — and nowhere the stacking doesn't, which is the honest
// support profile for "centred on a phone".
//
// 🔴 Never loaded into the editor as <mj-head><mj-style>: grapesjs-mjml draws
// head components as stray boxes in the canvas (the same reason the templates
// carry no <mj-attributes>). Instead the rule is APPENDED to the compiled HTML
// (withMobileCss) wherever MJML is compiled — the builder's export, the gallery
// previews, the render script — and handed to the canvas as `canvasCss` so the
// builder's Mobile preview shows the same thing the phone will.
//
// Daniel, 2026-10-26, of the template header on a phone: "the logo is centred
// and the menu items are centred as well … on the desktop one it's off to the
// side, which is fine" — so desktop keeps crest-left / nav-right (the LAFC
// shape his Figma was built on) and only the stacked phone layout centres.
// ─────────────────────────────────────────────────────────────────────────────

/** MJML's desktop rules start at 480px, so a phone is anything narrower. */
export const MOBILE_BREAKPOINT_PX = 479;

/** css-class on the header crest (lands on the <td> that wraps the image). */
export const HEADER_CREST_CLASS = "clubos-hdr-crest";
/** css-class on the header nav text (lands on the <td> that wraps the div). */
export const HEADER_NAV_CLASS = "clubos-hdr-nav";

export const MOBILE_EMAIL_CSS = [
  `@media only screen and (max-width:${MOBILE_BREAKPOINT_PX}px){`,
  // The crest: the image sits in its own fixed-width table inside the td, so
  // centring the td's text does nothing — the table itself takes auto margins.
  `.${HEADER_CREST_CLASS}{text-align:center !important;padding:0 0 14px !important;}`,
  `.${HEADER_CREST_CLASS}>table{margin:0 auto !important;}`,
  // The nav: mj-text renders a div carrying text-align:right inline; a head
  // rule with !important is what beats an inline style.
  `.${HEADER_NAV_CLASS}>div{text-align:center !important;}`,
  `}`,
].join("");

const STYLE_TAG = `<style type="text/css">${MOBILE_EMAIL_CSS}</style>`;

/** Append the phone rules to a compiled email's <head>. Idempotent — a design
 *  re-exported from the builder is not given the rule twice. HTML with no
 *  <head> (never the case for MJML output) gets the style tag in front. */
export function withMobileCss(html: string): string {
  if (!html || html.includes(`.${HEADER_CREST_CLASS}{`)) return html;
  const i = html.search(/<\/head>/i);
  return i === -1 ? STYLE_TAG + html : html.slice(0, i) + STYLE_TAG + html.slice(i);
}
