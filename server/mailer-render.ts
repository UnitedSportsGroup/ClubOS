/**
 * What actually leaves the building — the last step between a design and a
 * person's inbox.
 *
 * Two jobs, both of which the camps mailer was missing before 2026-09-09:
 *
 * 1. **Merge tags.** The builder's palette offers {{first_name}}, {{last_name}},
 *    {{email}} and {{unsubscribe_url}}. Offering them and then posting the
 *    braces to 3,800 people is worse than not offering them, so they are
 *    resolved here, per recipient.
 *
 * 2. **An unsubscribe link, guaranteed.** NZ's Unsolicited Electronic Messages
 *    Act 2007 s11 requires a functional unsubscribe facility on a commercial
 *    electronic message. The old path sent the editor's raw HTML with none.
 *    `renderForRecipient` appends a compliant footer whenever the design does
 *    not already carry the link — so it is not possible to compose your way out
 *    of one, and a designer who places it themselves gets no second copy.
 */

/** Values a campaign can reference. `email` and `unsubscribeUrl` are always
 *  known; a first name often is not, and inventing one is worse than a
 *  neutral greeting. */
export interface RecipientContext {
  email: string;
  unsubscribeUrl: string;
  firstName?: string | null;
  lastName?: string | null;
  /**
   * 🔴 THE OPEN PIXEL, AND WITHOUT IT AN OPEN CAN NEVER BE RECORDED.
   *
   * `runBroadcastQueue` has always handed each `sendOne` a per-recipient pixel
   * URL as its SECOND argument — but a callback written as `(email) => …` is
   * still valid TypeScript, so a mailer could silently opt out by not naming the
   * parameter. The CUFC mailer did exactly that, which is why every one of its
   * campaigns read "Not opened" for every recipient, forever, including a test
   * Daniel opened himself. Passing it here puts the pixel in the ONE place every
   * email already goes through, instead of relying on each mailer to remember.
   */
  pixelUrl?: string | null;
}

/** A name out of the database lands inside markup, so `Tom & Jerry's` must not
 *  be able to break the email — or inject into it. */
function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `{{ first_name }}`, `{{first_name}}`, `{{First_Name}}` — all the same tag.
 *  Anything we do not recognise is left exactly as typed rather than blanked,
 *  because a visible `{{promo_code}}` is a bug someone can see and report,
 *  while a silent deletion is one nobody ever finds. */
export function applyMergeTags(html: string, ctx: RecipientContext): string {
  const first = (ctx.firstName || "").trim();
  const last = (ctx.lastName || "").trim();
  const values: Record<string, string> = {
    // "Hi there," is the fallback: a real greeting when the name is unknown.
    first_name: escapeHtml(first || "there"),
    last_name: escapeHtml(last),
    email: escapeHtml(ctx.email),
    unsubscribe_url: ctx.unsubscribeUrl,
  };
  return html.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (whole, key: string) => {
    const v = values[key.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/** The footer added when a design carries no unsubscribe link. Deliberately
 *  plain and table-based: it has to render in Outlook, and it is a legal
 *  notice, not a design element. */
function unsubscribeFooter(unsubscribeUrl: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr><td align="center" style="padding:24px 16px 32px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a;">
    You are receiving this because you are on Christchurch United Football Club's contact list.<br>
    <a href="${unsubscribeUrl}" style="color:#8a8a8a;text-decoration:underline;">Unsubscribe</a>
  </td></tr>
</table>`.trim();
}

/** True when the rendered email already links to this recipient's unsubscribe
 *  URL — i.e. the designer used the merge tag. Checked against the resolved URL
 *  rather than the word "unsubscribe", so the sentence "unsubscribe below"
 *  cannot satisfy the requirement on its own. */
export function hasUnsubscribeLink(html: string, unsubscribeUrl: string): boolean {
  if (html.includes(unsubscribeUrl)) return true;
  // A hand-written link straight at the public endpoint counts too.
  return /href=["'][^"']*\/api\/public\/unsubscribe\?/i.test(html);
}

/** Put the footer inside `</body>` when there is one (MJML compiles to a full
 *  document), else on the end. Appending after `</html>` would leave it outside
 *  the document, where some clients drop it — which would defeat the point. */
function appendToBody(html: string, block: string): string {
  const idx = html.toLowerCase().lastIndexOf("</body>");
  if (idx === -1) return `${html}\n${block}`;
  return `${html.slice(0, idx)}\n${block}\n${html.slice(idx)}`;
}

/** The one function the send path calls. Resolves merge tags, then guarantees
 *  the unsubscribe link. */
export function renderForRecipient(html: string, ctx: RecipientContext): string {
  const merged = applyMergeTags(html, ctx);
  const withFooter = hasUnsubscribeLink(merged, ctx.unsubscribeUrl)
    ? merged
    : appendToBody(merged, unsubscribeFooter(ctx.unsubscribeUrl));
  // Last, and inside </body> — a tracking image after the closing tag is at the
  // mercy of the client's parser, and the whole point is that it loads.
  return ctx.pixelUrl ? appendToBody(withFooter, openPixel(ctx.pixelUrl)) : withFooter;
}

/** A 1×1 transparent beacon. `alt=""` and `display:none` so no client renders a
 *  broken-image box in the middle of a campaign. */
function openPixel(url: string): string {
  return `<img src="${url.replace(/"/g, "&quot;")}" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden;" />`;
}

/** A campaign is only worth sending if it says something. The builder can emit
 *  a perfectly valid document containing nothing but a spacer, and "we emailed
 *  3,800 people a blank page" is the failure this catches. */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}
