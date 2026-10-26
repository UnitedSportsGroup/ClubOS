// ── The Mailer's assistant — the rules shared by the server and the browser ──
//
// Daniel, 2026-10-26: "add an option to this builder to also make it agentic
// like chatbox type so i can prompt it to make it modern and easier and make it
// way faster to create what I want … maybe we could add limit per staff member
// per day also".
//
// A person types what they want; the server hands Claude the email's MJML, the
// brand kit and the request; Claude answers with EDITS (find/replace pairs
// against the current document) or a whole new document; the server applies
// and CHECKS the result before the canvas ever sees it. Everything here is
// pure — no DOM, no database — so a script can prove it.
//
// 🔴 Every prompt is a real API call billed to the club's Anthropic account
// (the key Rambo uses). The per-person daily cap is the only thing between a
// stuck "retry" loop and a bill, which is why the server refuses past it and
// the panel shows the count.

export const MAILER_AI_DEFAULT_DAILY_LIMIT = 50;
export const MAILER_AI_DEFAULT_MODEL = "claude-sonnet-5-5";

/** USD per million tokens. Cache WRITES cost 1.25× input; reads are listed. */
export const MAILER_AI_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export interface MailerAiTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** What one call cost, in US cents to four decimals (a prompt is cents, not dollars). */
export function mailerAiCostCents(model: string, u: MailerAiTokenUsage): number {
  const p = MAILER_AI_PRICES[model] ?? MAILER_AI_PRICES[MAILER_AI_DEFAULT_MODEL];
  const usd =
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) / 1_000_000;
  return Math.round(usd * 100 * 10_000) / 10_000;
}

export interface MailerAiEdit {
  find: string;
  replace: string;
}

export interface MailerAiMessage {
  role: "user" | "assistant";
  content: string;
}

/** The server's answer to one prompt. `mjml` is the new document when the
 *  design changed, null when the assistant only replied (a question, a refusal
 *  to invent a fact). */
export interface MailerAiReply {
  ok: true;
  reply: string;
  mjml: string | null;
  changed: boolean;
  usage: { used: number; limit: number };
}
export interface MailerAiFailure {
  ok: false;
  message: string;
  usage?: { used: number; limit: number };
}

// ── Edits ─────────────────────────────────────────────────────────────────────

/** Apply find/replace edits in order. A `find` must occur EXACTLY once: zero
 *  hits means the model misread the document, two means the change would land
 *  in the wrong place — both are reported, never guessed. */
export function applyMjmlEdits(mjml: string, edits: MailerAiEdit[]): { mjml: string; failures: string[] } {
  let out = mjml;
  const failures: string[] = [];
  edits.forEach((e, i) => {
    const find = typeof e.find === "string" ? e.find : "";
    if (!find) { failures.push(`edit ${i + 1}: empty find`); return; }
    const first = out.indexOf(find);
    if (first < 0) { failures.push(`edit ${i + 1}: not found — ${short(find)}`); return; }
    if (out.indexOf(find, first + 1) >= 0) { failures.push(`edit ${i + 1}: found more than once — ${short(find)}`); return; }
    out = out.slice(0, first) + (typeof e.replace === "string" ? e.replace : "") + out.slice(first + find.length);
  });
  return { mjml: out, failures };
}

function short(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 77)}…` : one;
}

// ── Checks ────────────────────────────────────────────────────────────────────

/** The MJML the builder (grapesjs-mjml 1.0.8) understands. Anything else is
 *  drawn as a stray box or dropped by the export. */
export const MAILER_AI_ALLOWED_TAGS = [
  "mjml", "mj-body", "mj-wrapper", "mj-section", "mj-group", "mj-column",
  "mj-text", "mj-image", "mj-button", "mj-divider", "mj-spacer",
  "mj-social", "mj-social-element", "mj-raw",
] as const;

/** Tags that take no children. 🔴 grapesjs-mjml's export DROPS every sibling
 *  after one of these inside a column (found live, 2026-10-26, when the first
 *  newsletter went out without its stories). */
export const MAILER_AI_VOID_TAGS = ["mj-image", "mj-divider", "mj-spacer"] as const;

/** The merge tags the send path resolves (server/mailer-render.ts). */
export const MAILER_AI_MERGE_TAGS = [
  "first_name", "last_name", "player_first_name", "player_name", "email", "unsubscribe_url",
] as const;

export const MAILER_AI_MAX_MJML_CHARS = 90_000;

export function mjmlImageSrcs(mjml: string): string[] {
  const out: string[] = [];
  const re = /\ssrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mjml))) out.push(m[1].trim());
  return out;
}

/** Problems with a document the assistant produced — empty means it may reach
 *  the canvas. `allowedImages` is the brand kit + whatever the email already
 *  carried, so a made-up picture URL can never ship. */
export function validateMailerAiMjml(mjml: string, allowedImages: Set<string>): string[] {
  const problems: string[] = [];
  const doc = (mjml || "").trim();
  if (!doc) return ["the document is empty"];
  if (doc.length > MAILER_AI_MAX_MJML_CHARS) problems.push(`the document is ${doc.length} characters — keep it under ${MAILER_AI_MAX_MJML_CHARS}`);
  if (!/^<mjml[\s>]/i.test(doc)) problems.push("the document must start with <mjml>");
  if (!/<\/mjml>\s*$/i.test(doc)) problems.push("the document must end with </mjml>");
  if (!/<mj-body[\s>]/i.test(doc)) problems.push("the document needs an <mj-body>");
  if (/<mj-head[\s>]/i.test(doc)) problems.push("no <mj-head> — the builder draws head components as stray boxes; styles go inline");
  if (/<script[\s>]/i.test(doc) || /javascript:/i.test(doc)) problems.push("no scripts");

  // Only the builder's tags.
  const allowed = new Set<string>(MAILER_AI_ALLOWED_TAGS);
  const seen = new Set<string>();
  Array.from(doc.matchAll(/<(mj-[a-z-]+)/gi)).forEach((m) => seen.add(m[1].toLowerCase()));
  Array.from(seen).forEach((t) => { if (!allowed.has(t)) problems.push(`<${t}> is not a tag the builder supports`); });

  // Balanced containers.
  for (const t of ["mjml", "mj-body", "mj-wrapper", "mj-section", "mj-group", "mj-column", "mj-text", "mj-button", "mj-social", "mj-raw"]) {
    const opens = (doc.match(new RegExp(`<${t}(?=[\\s>])[^>]*(?<!/)>`, "gi")) || []).length;
    const closes = (doc.match(new RegExp(`</${t}\\s*>`, "gi")) || []).length;
    if (opens !== closes) problems.push(`<${t}> opens ${opens} times and closes ${closes}`);
  }

  // Pictures only from the kit or the email itself.
  for (const src of mjmlImageSrcs(doc)) {
    if (!allowedImages.has(src)) problems.push(`unknown picture ${src} — use only the brand kit's images or ones already in the email`);
  }

  // Merge tags the send path knows.
  const known = new Set<string>(MAILER_AI_MERGE_TAGS);
  Array.from(doc.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)).forEach((m) => {
    if (!known.has(m[1].toLowerCase())) problems.push(`{{${m[1]}}} is not a merge tag the send path knows`);
  });

  // 🔴 The void-element trap: inside a column, a picture, rule or spacer must
  // be the LAST child.
  Array.from(doc.matchAll(/<mj-column(?=[\s>])[^>]*>([\s\S]*?)<\/mj-column>/gi)).forEach((col) => {
    const kids: string[] = Array.from(col[1].matchAll(/<(mj-[a-z-]+)(?=[\s>/])/gi)).map((k: RegExpMatchArray) => String(k[1]).toLowerCase());
    const voidAt = kids.findIndex((k) => (MAILER_AI_VOID_TAGS as readonly string[]).includes(k));
    if (voidAt >= 0 && voidAt < kids.length - 1) {
      problems.push(`in a column, <${kids[voidAt]}> must be the last thing (the export drops the <${kids[voidAt + 1]}> after it) — give it its own column or section, or move it last`);
    }
  });

  return Array.from(new Set(problems));
}

// ── Limits ────────────────────────────────────────────────────────────────────

/** A person's cap for today: their own number if one was set in Team, else the
 *  default. Zero is a real answer (switched off for them). */
export function mailerAiDailyLimitFor(personal: number | null | undefined): number {
  return Number.isInteger(personal) && (personal as number) >= 0 ? (personal as number) : MAILER_AI_DEFAULT_DAILY_LIMIT;
}
