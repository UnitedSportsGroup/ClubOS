// Product description rich text (2026-11-04) — the ONE cleaner for HTML that
// a staff member types (or pastes) into the description editor and that a
// storefront later renders. An ALLOWLIST: anything not named here is removed,
// every attribute is dropped except a link's href, and a link may only point
// at http(s) or mailto. Script/style/iframe blocks lose their content too.
// Pure — the server cleans on save; the client may use it to preview.

const ALLOWED = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "h2", "h3", "h4", "blockquote"]);
const VOID = new Set(["br"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

function safeHref(raw: string): string | null {
  const v = raw.trim().replace(/^["']|["']$/g, "").replace(/&amp;/g, "&");
  if (/^(https?:\/\/|mailto:)/i.test(v) && !/[\s<>"]/.test(v)) return v.replace(/&/g, "&amp;");
  return null;
}

export function cleanProductHtml(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input).slice(0, 50_000).replace(DROP_WITH_CONTENT, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, (_m, close: string, rawTag: string, attrs: string) => {
    let tag = rawTag.toLowerCase();
    if (tag === "div") tag = "p";
    if (!ALLOWED.has(tag)) return "";
    if (close) return VOID.has(tag) ? "" : `</${tag}>`;
    if (tag === "a") {
      const m = /\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(attrs);
      const href = m ? safeHref(m[1]) : null;
      return href ? `<a href="${href}" rel="noopener noreferrer" target="_blank">` : "<a>";
    }
    return `<${tag}>`;
  });
  // Any "<" left is not a tag we kept — show it as text, never let it open one.
  s = s.replace(/<(?!\/?(p|br|strong|b|em|i|u|ul|ol|li|a|h2|h3|h4|blockquote)\b)/gi, "&lt;");
  return s.replace(/(<p>\s*<\/p>)+$/g, "").trim();
}

/** The plain text the storefronts render today (they show `description` as text). */
export function productHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h2|h3|h4|li|blockquote)>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
