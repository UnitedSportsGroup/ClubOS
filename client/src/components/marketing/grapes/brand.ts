// ─────────────────────────────────────────────────────────────────────────────
// grapes/brand.ts — maps a brandKey → the GrapesJS canvas theme.
//
// Everything on-brand-before-you-touch-it lives here:
//   • brandCanvasTheme(key)  — the flat colour/font row the blocks + starter read.
//   • buildStarterMjml(key)  — a beautiful, on-brand starter email (header + hero +
//     body + button + footer-with-unsubscribe) so a blank campaign opens looking
//     designed, not empty. Carries <mj-attributes> defaults so EVERY block dropped
//     afterwards inherits brand fonts/colours automatically.
//   • brandColorPalette(key) — swatch rows injected into the Style Manager colour
//     pickers (via the editor's `colorPicker.palette`), so brand colours are one
//     click away wherever a colour is edited.
//   • applyBrandTheme(editor, key) — best-effort injection of brand font options
//     into the Style Manager typography dropdown (defensive; never throws).
//
// Palette source of truth is ../brand-themes.ts (getBrandMeta) — the SAME rows the
// live brand email shells use — so the builder and the sent email agree.
// ─────────────────────────────────────────────────────────────────────────────

import type { Editor } from "grapesjs";
import { getBrandMeta, type BrandTheme } from "../brand-themes";

/** Email-safe font stack — brand display faces (Anton/Kanit…) can't be relied on
 *  across email clients without hosted web-fonts, so the CANVAS/email uses this. */
export const EMAIL_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface BrandCanvas {
  key: string;
  name: string;
  isDark: boolean;
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  heading: string;
  accent: string;
  onAccent: string;
  logoUrl?: string;
  font: string;
}

/** Daniel, 2026-10-09: "make all templates on white background to make it all
 *  super simple". The BUILDER is light for every brand: white page, ink text,
 *  hairline borders. Only the accent stays the brand's — and on a white page a
 *  dark brand's light accent (MFL gold, CIC 7's lime) cannot carry text, so each
 *  brand gets an accent that reads on white, with its own colour on the button
 *  label (black button + gold label is MFL; navy button + lime is the 7's).
 *  🔴 Emails already designed keep their own colours — they carry them inline. */
const LIGHT_ACCENT: Record<string, { accent: string; onAccent: string }> = {
  mfl: { accent: "#111111", onAccent: "#d1b96e" },
  cufc: { accent: "#1d3fae", onAccent: "#ffffff" },
  siu: { accent: "#111111", onAccent: "#c59949" },
  cic: { accent: "#111111", onAccent: "#c9a43e" },
  cic7s: { accent: "#0a1122", onAccent: "#cffd5a" },
  cugc: { accent: "#013590", onAccent: "#ffffff" },
  usc: { accent: "#4f46e5", onAccent: "#ffffff" },
  usg: { accent: "#1d3fae", onAccent: "#ffffff" },
  prints: { accent: "#d4541f", onAccent: "#ffffff" },
  neutral: { accent: "#1d3fae", onAccent: "#ffffff" },
};

/** The flat brand row the blocks, templates and starter read — always LIGHT. */
export function brandCanvasTheme(brandKey: string | null | undefined): BrandCanvas {
  const b: BrandTheme = getBrandMeta(brandKey);
  const a = LIGHT_ACCENT[b.key] ?? LIGHT_ACCENT.neutral;
  return {
    key: b.key,
    name: b.name,
    isDark: false,
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#e5e7eb",
    text: "#1f2937",
    muted: "#6b7280",
    heading: "#111827",
    accent: a.accent,
    onAccent: a.onAccent,
    // A dark brand's logo is white artwork and vanishes on white — the name is
    // set as type instead. Only a brand that is already light keeps its logo.
    logoUrl: b.isDark ? undefined : b.logoUrl,
    font: EMAIL_FONT,
  };
}

/** Swatch rows for the colour pickers: brand colours first, then a neutral ramp. */
export function brandColorPalette(brandKey: string | null | undefined): string[][] {
  const b = brandCanvasTheme(brandKey);
  return [
    [b.accent, b.heading, b.text, b.muted, b.surface, b.bg],
    ["#ffffff", "#f4f4f5", "#d4d4d8", "#a1a1aa", "#52525b", "#000000"],
  ];
}

/**
 * What a new email opens as — a BLANK white page (Daniel, 2026-10-09: "default
 * option is start from blank not template"). One text block to type into, and the
 * unsubscribe footer the law requires (NZ UEMA s11) so nobody has to remember it.
 * Every element carries explicit colours + font so the canvas is true WYSIWYG
 * (no <mj-attributes> — grapesjs-mjml renders those as stray components).
 */
export function buildStarterMjml(brandKey: string | null | undefined): string {
  const b = brandCanvasTheme(brandKey);
  return `<mjml>
  <mj-body background-color="${b.bg}">
    <mj-section background-color="${b.surface}" padding="32px 28px 8px">
      <mj-column>
        <mj-text color="${b.text}" font-family="${b.font}" font-size="16px" line-height="1.7" padding="0">
          Hi {{first_name}},<br /><br />Start typing your message here.
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="${b.bg}" padding="28px 28px 28px">
      <mj-column>
        <mj-divider border-color="${b.border}" border-width="1px" padding="0 0 16px" />
        <mj-text color="${b.muted}" font-family="${b.font}" font-size="12px" line-height="1.6" align="center" padding="0">
          You're receiving this because you're part of ${escapeText(b.name)}.<br />
          <a href="{{unsubscribe_url}}" style="color:${b.muted};text-decoration:underline;">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

/**
 * Best-effort brand tailoring after init. Injects brand-safe font options into the
 * Style Manager's font-family dropdown so the brand's own stack is pickable. Wrapped
 * defensively — the Style Manager sector/property shape varies across minor GrapesJS
 * versions, and a failure here must never break the editor.
 */
export function applyBrandTheme(editor: Editor, brandKey: string | null | undefined): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sm: any = editor.StyleManager;
    const fontProp =
      sm?.getProperty?.("typography", "font-family") ??
      findFontProperty(sm);
    if (!fontProp?.set) return;
    const b = brandCanvasTheme(brandKey);
    const existing: Array<{ value: string; name?: string }> =
      (typeof fontProp.get === "function" ? fontProp.get("options") : fontProp.options) || [];
    const brandOption = { value: b.font, name: `${b.name} (email-safe)` };
    const hasBrand = existing.some((o) => o.value === b.font);
    fontProp.set("options", hasBrand ? existing : [brandOption, ...existing]);
  } catch {
    /* non-fatal — brand fonts are a nicety, not a requirement */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFontProperty(sm: any): any {
  try {
    const sectors = sm?.getSectors?.() ?? [];
    for (const sec of sectors) {
      const p = sec?.getProperty?.("font-family");
      if (p) return p;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
