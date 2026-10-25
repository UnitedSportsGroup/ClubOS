// ─────────────────────────────────────────────────────────────────────────────
// grapes/templates/pieces.ts — the visual language every starter shares.
//
// Born in club-newsletter.ts (Daniel's SIU Figma, 2026-10-25) and pulled out so
// the match-day, registration, camp, shop, welcome and announcement starters
// are the SAME email in different orders: crest header, "Label." with the
// brand's full stop, a photograph, a two-tone headline, link bullets, a
// bulletproof button, a soft grey card, a dark footer with the socials.
//
// Each piece is a COLUMN CHILD; `section()` wraps a run of them in one
// mj-section. Every mj-section compiles to ~1.5KB of Outlook scaffolding and
// Gmail clips at 102KB, so pieces are grouped, never one per section.
// ─────────────────────────────────────────────────────────────────────────────
import { escText, escAttr, type Brand } from "./sections";
import { SOCIAL_ICON, SOCIAL_ORDER, type BrandKit } from "./brand-kit";
import { HEADER_CREST_CLASS, HEADER_NAV_CLASS } from "../mobile-css";

export const WHITE = "#ffffff";
export const INK = "#111111";
export const BODY = "#2b2b2b";
export const MUTED = "#6b6b6b";
export const RULE = "#e6e6e6";
export const CARD = "#f5f5f3";
export const PAGE = "#efefed";

export type Link = { label: string; href: string };

export const a = (href: string, text: string, color: string, weight = 700) =>
  `<a href="${escAttr(href)}" style="color:${color};text-decoration:none;font-weight:${weight};">${escText(text)}</a>`;

// 🔴 grapesjs-mjml drops every sibling that FOLLOWS a void element (mj-image,
// mj-divider) in a column: the canvas still draws them, the export does not,
// so a template looks whole in the builder and arrives without its words. A
// photograph is therefore always the LAST child of its column, and a rule is
// a border on the column, never an mj-divider with text after it. Found on the
// first live send of the club newsletter (2026-10-25).
export function section(children: string[], opts: { bg?: string; padding?: string; column?: string; rule?: boolean } = {}): string {
  const bg = opts.bg ?? WHITE;
  const padding = opts.padding ?? "0 28px";
  const col = [opts.column ?? "", opts.rule ? `border-top="1px solid ${RULE}" padding="24px 0 0"` : ""].filter(Boolean).join(" ");
  return `    <mj-section background-color="${bg}" padding="${padding}">
      <mj-column${col ? ` ${col}` : ""}>
${children.filter(Boolean).join("\n")}
      </mj-column>
    </mj-section>`;
}

/** Crest left, up to three nav links right. */
export function header(b: Brand, k: BrandKit): string {
  // Crest left, nav right on a laptop; both CENTRED once the columns stack on
  // a phone — the css-classes are what mobile-css.ts's phone rule targets.
  const nav = k.nav.length
    ? `        <mj-column width="70%" vertical-align="middle">
          <mj-text css-class="${HEADER_NAV_CLASS}" align="right" color="${k.link}" font-family="${b.font}" font-size="11px" font-weight="700" letter-spacing="1.4px" text-transform="uppercase" padding="0">${k.nav
            .map((n) => a(n.href, n.label, k.link))
            .join("&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;")}</mj-text>
        </mj-column>`
    : "";
  return `    <mj-section background-color="${WHITE}" padding="22px 28px 16px" border-bottom="1px solid ${RULE}">
        <mj-column width="${nav ? "30%" : "100%"}" vertical-align="middle">
          <mj-image css-class="${HEADER_CREST_CLASS}" src="${escAttr(k.crest)}" alt="${escAttr(b.name)}" href="${escAttr(k.site)}" width="${k.crestWidth}px" align="${nav ? "left" : "center"}" padding="0" />
        </mj-column>
${nav}
    </mj-section>`;
}

/** "Matchday." — the bold section label with the brand's full stop. */
export const label = (b: Brand, k: BrandKit, text: string) =>
  `        <mj-text color="${INK}" font-family="${b.font}" font-size="22px" font-weight="800" letter-spacing="-0.4px" line-height="1.2" padding="0 0 12px">${escText(text)}<span style="color:${k.link};">.</span></mj-text>`;

/** A small uppercase eyebrow in the muted ink. */
export const eyebrow = (b: Brand, text: string, align = "left", bottom = 10) =>
  `        <mj-text align="${align}" color="${MUTED}" font-family="${b.font}" font-size="11px" font-weight="700" letter-spacing="1.6px" text-transform="uppercase" padding="0 0 ${bottom}px">${escText(text)}</mj-text>`;

/** 🔴 Always the LAST child of its column (see section()). */
export const photo = (k: BrandKit, i: number | null, href: string, bottom = 16) => {
  if (i === null || !k.photos[i]) return "";
  const p = k.photos[i];
  return `        <mj-image src="${escAttr(p.src)}" alt="${escAttr(p.alt)}" href="${escAttr(href)}" border-radius="4px" padding="0 0 ${bottom}px" />`;
};

/** A photograph if the brand has one, else a brand-coloured band carrying
 *  the words — never a broken image. Both are whole sections. */
export function hero(b: Brand, k: BrandKit, i: number | null, text: string, href: string): string {
  if (i !== null && k.photos[i]) return section([photo(k, i, href, 0)], { padding: "0 28px 16px" });
  return section(
    [`        <mj-text align="center" color="${k.onButton}" font-family="${k.headlineFont}" font-size="30px" font-weight="800" line-height="1.15" letter-spacing="-0.5px" padding="0">${escText(text)}</mj-text>`],
    { column: `background-color="${k.button}" border-radius="4px" padding="44px 28px"`, padding: "0 28px 16px" },
  );
}

export const headline = (b: Brand, k: BrandKit, lead: string, rest: string, size = 26) =>
  `        <mj-text color="${INK}" font-family="${k.headlineFont}" font-size="${size}px" font-weight="800" line-height="1.2" letter-spacing="-0.4px" padding="0 0 8px"><span style="color:${k.link};">${escText(lead)}</span>${escText(rest)}</mj-text>`;

export const subhead = (b: Brand, text: string, bottom = 8) =>
  `        <mj-text color="${INK}" font-family="${b.font}" font-size="19px" font-weight="800" line-height="1.3" padding="0 0 ${bottom}px">${escText(text)}</mj-text>`;

export const para = (b: Brand, k: BrandKit, text: string, link?: Link, bottom = 10) =>
  `        <mj-text color="${BODY}" font-family="${b.font}" font-size="15px" line-height="1.65" padding="0 0 ${bottom}px">${escText(text)}${link ? ` ${a(link.href, `${link.label} →`, k.link)}` : ""}</mj-text>`;

/** Link bullets — a brand-coloured dot and a bold link per line. */
export const links = (b: Brand, k: BrandKit, items: Link[], bottom = 6) =>
  items
    .map(
      (l, i) =>
        `        <mj-text color="${k.link}" font-family="${b.font}" font-size="14px" line-height="1.5" padding="0 0 ${i === items.length - 1 ? bottom : 6}px"><span style="color:${k.link};">&#9679;</span>&nbsp;&nbsp;${a(l.href, l.label, k.link)}</mj-text>`,
    )
    .join("\n");

/** Plain bullets — the dot in the brand colour, the words in ink. */
export const bullets = (b: Brand, k: BrandKit, items: string[], bottom = 6) =>
  items
    .map(
      (t, i) =>
        `        <mj-text color="${BODY}" font-family="${b.font}" font-size="15px" line-height="1.55" padding="0 0 ${i === items.length - 1 ? bottom : 8}px"><span style="color:${k.link};">&#9679;</span>&nbsp;&nbsp;${escText(t)}</mj-text>`,
    )
    .join("\n");

export const button = (b: Brand, k: BrandKit, l: Link, opts: { align?: string; top?: number; bottom?: number } = {}) =>
  `        <mj-button href="${escAttr(l.href)}" align="${opts.align ?? "left"}" background-color="${k.button}" color="${k.onButton}" font-family="${b.font}" font-size="14px" font-weight="700" letter-spacing="0.2px" border-radius="6px" inner-padding="13px 26px" padding="${opts.top ?? 4}px 0 ${opts.bottom ?? 8}px">${escText(l.label)}</mj-button>`;

export const muted = (b: Brand, text: string, size = 12, bottom = 0, align = "left") =>
  `        <mj-text align="${align}" color="${MUTED}" font-family="${b.font}" font-size="${size}px" line-height="1.6" padding="0 0 ${bottom}px">${escText(text)}</mj-text>`;

/** Label : value rows for the facts people scan for (date, time, where, cost). */
export const facts = (b: Brand, k: BrandKit, rows: [string, string][]) =>
  rows
    .map(
      ([l, v], i) =>
        `        <mj-text color="${BODY}" font-family="${b.font}" font-size="14px" line-height="1.5" padding="0 0 ${i === rows.length - 1 ? 0 : 8}px"><span style="color:${MUTED};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${escText(l)}</span><br /><span style="color:${INK};font-size:16px;font-weight:700;">${escText(v)}</span></mj-text>`,
    )
    .join("\n");

/** The soft grey card: an eyebrow, a two-tone headline, a line, a centred
 *  button and a note. The newsletter's NEXT MATCH; a camp's dates; a drop. */
export function card(
  b: Brand,
  k: BrandKit,
  c: { eyebrow: string; headA: string; headB: string; line: string; cta: Link; note?: string },
): string {
  return section(
    [
      eyebrow(b, c.eyebrow, "center"),
      `        <mj-text align="center" color="${INK}" font-family="${k.headlineFont}" font-size="24px" font-weight="800" line-height="1.2" letter-spacing="-0.3px" padding="0 0 8px"><span style="color:${k.link};">${escText(c.headA)}</span>${escText(c.headB)}</mj-text>`,
      `        <mj-text align="center" color="${BODY}" font-family="${b.font}" font-size="14px" line-height="1.5" padding="0 0 18px">${escText(c.line)}</mj-text>`,
      `        <mj-button href="${escAttr(c.cta.href)}" align="center" background-color="${k.button}" color="${k.onButton}" font-family="${b.font}" font-size="14px" font-weight="700" border-radius="6px" inner-padding="13px 30px" padding="0 0 ${c.note ? 12 : 0}px">${escText(c.cta.label)}</mj-button>`,
      c.note ? muted(b, c.note, 12, 0, "center") : "",
    ],
    { column: `background-color="${CARD}" border-radius="6px" padding="26px 24px 24px"`, padding: "22px 28px 6px" },
  );
}

/** Two products side by side: name, price, a link, then the photo (last — see
 *  section()). Stacks on a phone. */
export function productPair(
  b: Brand,
  k: BrandKit,
  items: [{ photo: number; name: string; price: string; href: string }, { photo: number; name: string; price: string; href: string }],
): string {
  const cell = (p: { photo: number; name: string; price: string; href: string }) => {
    // A negative index means "no picture" — better than a photograph of
    // something that is not the product.
    const ph = p.photo < 0 ? undefined : k.photos[p.photo] ?? k.photos[0];
    return `      <mj-column width="50%" padding="0 6px">
        <mj-text color="${INK}" font-family="${b.font}" font-size="15px" font-weight="700" line-height="1.3" padding="0 0 2px">${escText(p.name)}</mj-text>
        <mj-text color="${BODY}" font-family="${b.font}" font-size="14px" line-height="1.4" padding="0 0 8px">${escText(p.price)}&nbsp;&nbsp;${a(p.href, "Shop now →", k.link)}</mj-text>
${ph ? `        <mj-image src="${escAttr(ph.src)}" alt="${escAttr(p.name)}" href="${escAttr(p.href)}" border-radius="4px" padding="0" />` : ""}
      </mj-column>`;
  };
  return `    <mj-section background-color="${WHITE}" padding="4px 22px 14px">
${cell(items[0])}
${cell(items[1])}
    </mj-section>`;
}

/** The dark footer: socials, the club and its address, the links the law and
 *  good manners need, and the crest to sign off. `{{unsubscribe_url}}` here is
 *  what tells the server not to add its own plain footer. */
export function footer(b: Brand, k: BrandKit): string {
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
