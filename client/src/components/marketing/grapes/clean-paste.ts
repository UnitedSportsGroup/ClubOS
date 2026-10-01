// ─────────────────────────────────────────────────────────────────────────────
// Clean paste for the email canvas.
//
// Zach (2026-09-30) pastes term letters into the Mailer from Word, Google Docs and
// old emails. The browser's own paste carries the SOURCE's styling with it —
// Arial 11pt, black text on a white background, Word's mso-* classes and <o:p>
// tags — straight into a dark, on-brand email: white boxes behind every line on
// a navy section, and markup MJML was never meant to hold.
//
// So a paste into a text block is rebuilt from scratch: the words, paragraph
// breaks, and the formatting people mean (bold, italic, underline, links,
// lists). Everything else — fonts, colours, sizes, backgrounds, classes, ids,
// comments, scripts, images — is dropped, and the text takes the block's own
// style, which is what the person expected to happen.
// ─────────────────────────────────────────────────────────────────────────────

const KEEP_INLINE = new Set(["B", "STRONG", "I", "EM", "U", "A", "BR"]);
const LISTS = new Set(["UL", "OL"]);
const BLOCKS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE",
  "TR", "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "LI",
]);
const DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "IMG", "SVG", "VIDEO", "AUDIO", "IFRAME", "OBJECT", "NOSCRIPT", "TEMPLATE"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A safe href, or null. Only web and mail links survive a paste. */
function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  return /^(https?:|mailto:|tel:)/i.test(v) || v.startsWith("{{") ? v.replace(/"/g, "%22") : null;
}

/** Bold/italic/underline as Google Docs expresses them — on a span's style —
 *  are still bold/italic/underline the person meant. */
function styleWraps(el: HTMLElement): [string, string] {
  const st = el.getAttribute("style") || "";
  let open = "", close = "";
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st) && !/font-weight\s*:\s*normal/i.test(st)) { open += "<b>"; close = "</b>" + close; }
  if (/font-style\s*:\s*italic/i.test(st)) { open += "<i>"; close = "</i>" + close; }
  if (/text-decoration[^;]*underline/i.test(st)) { open += "<u>"; close = "</u>" + close; }
  return [open, close];
}

function walk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(esc((node.textContent || "").replace(/\s+/g, " ")));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;   // comments (<!--StartFragment-->) etc.
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag) || tag.includes(":")) return;     // Word's <o:p>, <v:shape>…
  // Google Docs wraps the whole paste in <b style="font-weight:normal"> — not bold.
  if (tag === "B" && /font-weight\s*:\s*normal/i.test(el.getAttribute("style") || "")) {
    el.childNodes.forEach((c) => walk(c, out));
    return;
  }

  if (LISTS.has(tag)) {
    out.push("\u0000", `<${tag.toLowerCase()}>`);
    el.childNodes.forEach((c) => {
      if (c.nodeType === Node.ELEMENT_NODE && (c as HTMLElement).tagName.toUpperCase() === "LI") {
        const inner: string[] = [];
        c.childNodes.forEach((g) => walk(g, inner));
        // Google Docs wraps every bullet in its own <p>: inside a list item a
        // paragraph boundary is a line break at most, never a blank line.
        const t = inner.join("").split("\u0000").map((x) => x.trim()).filter(Boolean).join("<br>");
        if (t) out.push(`<li>${t}</li>`);
      }
    });
    out.push(`</${tag.toLowerCase()}>`, "\u0000");
    return;
  }

  if (KEEP_INLINE.has(tag)) {
    if (tag === "BR") { out.push("<br>"); return; }
    if (tag === "A") {
      const href = safeHref(el.getAttribute("href"));
      const inner: string[] = [];
      el.childNodes.forEach((c) => walk(c, inner));
      out.push(href ? `<a href="${href}">${inner.join("")}</a>` : inner.join(""));
      return;
    }
    const t = tag === "STRONG" ? "b" : tag === "EM" ? "i" : tag.toLowerCase();
    out.push(`<${t}>`);
    el.childNodes.forEach((c) => walk(c, out));
    out.push(`</${t}>`);
    return;
  }

  const [open, close] = tag === "SPAN" || tag === "FONT" ? styleWraps(el) : ["", ""];
  if (BLOCKS.has(tag)) out.push("\u0000");            // a paragraph boundary
  out.push(open);
  el.childNodes.forEach((c) => walk(c, out));
  out.push(close);
  if (BLOCKS.has(tag)) out.push("\u0000");
}

/** Pasted HTML → the small, safe subset an email text block should hold.
 *  Paragraphs become blank-line breaks; runs of empty paragraphs collapse. */
export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  doc.body.childNodes.forEach((n) => walk(n, out));
  return out.join("")
    .split("\u0000")
    .map((p) => p.replace(/^(\s|&nbsp;|<br>)+|(\s|&nbsp;|<br>)+$/g, "").trim())
    .filter((p) => p && !/^(<(b|i|u)>\s*<\/\2>)+$/.test(p))
    .join("<br><br>")
    // Empty formatting left behind by dropped content.
    .replace(/<(b|i|u)>\s*<\/\1>/g, "")
    .replace(/(<br>\s*){3,}/g, "<br><br>");
}

/** Plain text → the same shape: blank lines are paragraphs, single newlines are
 *  line breaks. */
export function cleanPastedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => esc(p.trim()).replace(/\n/g, "<br>"))
    .filter(Boolean)
    .join("<br><br>");
}

/**
 * Take over paste inside the canvas's editable text. Anything outside an active
 * text edit (the inspector, the code view) keeps the browser's own paste.
 * Idempotent per document.
 */
export function installCleanPaste(doc: Document | null | undefined): void {
  if (!doc || (doc as any).__clubosCleanPaste) return;
  (doc as any).__clubosCleanPaste = true;
  doc.addEventListener("paste", (ev: ClipboardEvent) => {
    const target = ev.target as HTMLElement | null;
    const editable = target?.closest?.("[contenteditable=true], [contenteditable='']");
    if (!editable || !ev.clipboardData) return;
    const html = ev.clipboardData.getData("text/html");
    const text = ev.clipboardData.getData("text/plain");
    const clean = html ? cleanPastedHtml(html) : cleanPastedText(text);
    if (!clean && !text) return;
    ev.preventDefault();
    // insertHTML goes through the editing host, so undo (Cmd+Z) still works.
    doc.execCommand("insertHTML", false, clean || esc(text));
  }, true);
}
