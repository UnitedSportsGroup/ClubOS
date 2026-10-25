// "Write an email" — the Mailer's plain mode.
//
// Daniel, 2026-10-25: "a simple editor and the full email builder. The simple
// one is literally just like Gmail … type in and easily send a text-based one.
// That's good for the regular comms." Most of what the office sends is a few
// paragraphs, and a three-pane designer is the wrong tool for a few paragraphs.
//
// What a written email IS: the words someone typed (a small HTML subset — bold,
// italic, underline, headings, lists, links, line breaks), a letterhead on top,
// and a sign-off drawn from the From identity chosen in Setup. This file turns
// that into the ONE sendable HTML the send path reads (`body`), on a plain white
// page at a size a phone can read. The unsubscribe footer is NOT here — the
// server adds it to every email that lacks one (server/mailer-render.ts), so a
// written email can never go out without it.
//
// The editable design is kept beside the HTML as `{ engine: "simple", … }`, so
// History, Reuse and Templates open a written email back in the compose box,
// not in the designer.
import { LETTERHEADS } from "@/components/marketing/grapes/letterheads";
import { brandCanvasTheme, EMAIL_FONT } from "@/components/marketing/grapes/brand";

export type SimpleSignature = { name: string; line: string };

export type SimpleDoc = {
  engine: "simple";
  /** The compose box's own HTML — the subset the toolbar can make. */
  html: string;
  /** A LETTERHEADS id, or null for none. */
  letterhead: string | null;
  signature: SimpleSignature | null;
};

export function isSimpleDoc(d: unknown): d is SimpleDoc {
  return !!d && typeof d === "object" && (d as { engine?: unknown }).engine === "simple"
    && typeof (d as { html?: unknown }).html === "string";
}

/** What the person would read, for "is there anything in this email". */
export function simpleTextOf(innerHtml: string): string {
  return String(innerHtml || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The sign-off, read off the From identity: "Travis Graham · Christchurch
 *  United FC" signs as Travis with the club under his name; "Christchurch
 *  United FC Grassroots" signs as the department. Nothing is invented — if the
 *  From carries no person, the sign-off is the club. */
export function signatureFor(fromName: string): SimpleSignature | null {
  const raw = String(fromName || "").trim();
  if (!raw) return null;
  const [name, ...rest] = raw.split(/\s+[·|–-]\s+/);
  return { name: name.trim(), line: rest.join(" · ").trim() };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Words coming BACK from the designer carry the sign-off the written email
 *  drew under them ("<b>Daniel Meyn</b><br>Christchurch United FC" once a
 *  paste-clean has run over the design). The compose box draws the sign-off
 *  itself, so that trailing copy is dropped or the email would sign twice. */
export function stripSignOff(words: string, signature: SimpleSignature | null): string {
  if (!signature?.name) return words;
  const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const textEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const name = reEsc(textEsc(signature.name));
  const line = signature.line ? `(?:<br>\\s*${reEsc(textEsc(signature.line))})?` : "";
  return words
    .replace(new RegExp(`(?:<br>\\s*)*<b>\\s*${name}\\s*</b>${line}(?:<br>\\s*)*\\s*$`, "i"), "")
    .replace(/(?:<br>\s*)+$/i, "");
}

/** The compose box only makes a small subset, but a drag-drop or an old paste
 *  can carry more. Anything that could run or restyle the page is dropped; the
 *  email's own styles are put on below. */
function safeBody(html: string): string {
  return String(html || "")
    .replace(/<(script|style|iframe|object|embed|link|meta|form|input|button)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|form|input|button)\b[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href\s*=\s*["']?)\s*javascript:[^"'>\s]*/gi, "$1#")
    .replace(/\s(style|class|id|dir|lang)\s*=\s*("[^"]*"|'[^']*')/gi, "");
}

/** Inline styles on the tags the toolbar makes. Inline, not a <style> block,
 *  because Outlook on Windows ignores most of a <style> block and Gmail strips
 *  some of it — inline is the one thing every client honours. */
function styledBody(html: string, accent: string): string {
  return safeBody(html)
    .replace(/<a\b/gi, `<a style="color:${accent};text-decoration:underline;"`)
    .replace(/<h1\b/gi, `<h1 style="font-size:24px;line-height:1.3;font-weight:700;color:#111827;margin:24px 0 8px;"`)
    .replace(/<h2\b/gi, `<h2 style="font-size:20px;line-height:1.3;font-weight:700;color:#111827;margin:20px 0 8px;"`)
    .replace(/<h3\b/gi, `<h3 style="font-size:17px;line-height:1.3;font-weight:700;color:#111827;margin:16px 0 6px;"`)
    .replace(/<(ul|ol)\b/gi, `<$1 style="margin:8px 0 12px;padding-left:24px;"`)
    .replace(/<li\b/gi, `<li style="margin:0 0 4px;"`)
    .replace(/<blockquote\b/gi, `<blockquote style="margin:12px 0;padding:0 0 0 14px;border-left:3px solid #e5e7eb;color:#4b5563;"`);
}

function letterheadOf(id: string | null | undefined) {
  return id ? LETTERHEADS.find((l) => l.id === id) ?? null : null;
}

/** The sendable HTML for a written email. A complete document with a <body>,
 *  so the server's footer lands inside it. */
export function compileSimpleEmail(doc: SimpleDoc, brandKey: string): string {
  const b = brandCanvasTheme(brandKey);
  const lh = letterheadOf(doc.letterhead);
  const sig = doc.signature && doc.signature.name ? doc.signature : null;
  const body = styledBody(doc.html, b.accent);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title></title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr>
    <td align="center" style="padding:0;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        ${lh ? `<tr>
          <td align="center" style="padding:28px 24px 4px 24px;">
            <img src="${lh.src}" width="${lh.width}" alt="${esc(lh.label)}" style="display:block;width:${lh.width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>` : ""}
        <tr>
          <td style="padding:28px 24px 8px 24px;font-family:${EMAIL_FONT};font-size:16px;line-height:1.65;color:${b.text};" class="clubos-written">
${body}
          </td>
        </tr>
        ${sig ? `<tr>
          <td style="padding:20px 24px 8px 24px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.5;color:${b.text};">
            <strong>${esc(sig.name)}</strong>${sig.line ? `<br><span style="color:${b.muted};">${esc(sig.line)}</span>` : ""}
          </td>
        </tr>` : ""}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** The same written email as a design the builder can open — so "open this in
 *  the designer instead" keeps every word, in a text block, under the same
 *  letterhead, with the standard footer. Mirrors grapes/brand.ts's starter. */
export function simpleToMjml(doc: SimpleDoc, brandKey: string): string {
  const b = brandCanvasTheme(brandKey);
  const lh = letterheadOf(doc.letterhead);
  const sig = doc.signature && doc.signature.name ? doc.signature : null;
  return `<mjml>
  <mj-body background-color="#ffffff">
    ${lh ? `<mj-section css-class="clubos-letterhead" background-color="#ffffff" padding="28px 28px 4px">
      <mj-column>
        <mj-image src="${lh.src}" width="${lh.width}px" alt="${esc(lh.label)}" align="center" padding="0" />
      </mj-column>
    </mj-section>` : ""}
    <mj-section background-color="#ffffff" padding="32px 28px 8px">
      <mj-column>
        <mj-text color="${b.text}" font-family="${b.font}" font-size="16px" line-height="1.7" padding="0">
          ${styledBody(doc.html, b.accent)}
        </mj-text>
        ${sig ? `<mj-text color="${b.text}" font-family="${b.font}" font-size="15px" line-height="1.5" padding="24px 0 0">
          <strong>${esc(sig.name)}</strong>${sig.line ? `<br /><span style="color:${b.muted};">${esc(sig.line)}</span>` : ""}
        </mj-text>` : ""}
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="28px 28px 28px">
      <mj-column>
        <mj-divider border-color="${b.border}" border-width="1px" padding="0 0 16px" />
        <mj-text color="${b.muted}" font-family="${b.font}" font-size="12px" line-height="1.6" align="center" padding="0">
          You're receiving this because you're part of ${esc(b.name)}.<br />
          <a href="{{unsubscribe_url}}" style="color:${b.muted};text-decoration:underline;">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
