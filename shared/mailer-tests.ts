/**
 * A/B tests in the Mailer, and the click tracking they stand on — the PURE
 * rules, shared by the browser (the Send step shows the plan and lists the
 * links) and the server (which does the split, wraps the links and picks the
 * winner). Nothing in here touches a database or a network.
 *
 * Daniel, 2026-10-27: "add the subject line A/B test, that's super important …
 * being able to add an A/B test on calls to action in the email and being
 * able to test different kinds of wording and see which one gets more clicks."
 *
 * Two kinds of test:
 *   - subject: two subject lines, judged by OPENS.
 *   - link:    one button or link's wording, two versions, judged by CLICKS on
 *              that link. Variant B is the same email with that one wording
 *              swapped — the href, the layout and every other word stay put.
 *
 * The shape is the industry one (Mailchimp, Klaviyo, beehiiv): a SAMPLE of the
 * list gets A or B now, half each; after a wait the better one goes to the
 * rest. "Test on everyone" (sample 100%) is the plain split: half A, half B,
 * nothing held back, the result is a lesson for next time.
 */

export type MailerTestKind = "subject" | "link";
export type MailerTestMetric = "opens" | "clicks";
export type MailerVariant = "A" | "B";

/** How much of the list takes part. 20% is the industry default (10% each). */
export const MAILER_TEST_SAMPLE_OPTIONS = [20, 50, 100] as const;
export const MAILER_TEST_SAMPLE_DEFAULT = 20;
/** How long to wait before the winner is picked, in minutes. */
export const MAILER_TEST_WAIT_OPTIONS = [60, 120, 240, 1440] as const;
export const MAILER_TEST_WAIT_DEFAULT = 120;
/** Under this many people a hold-out makes no sense: everyone is in the test. */
export const MAILER_TEST_MIN_FOR_HOLDOUT = 10;
export const MAILER_TEST_VARIANT_MAX = 500;

export interface MailerTestInput {
  kind: MailerTestKind;
  /** The second version: a subject line, or a link's new wording. */
  b: string;
  /** Link tests: the wording being tested, exactly as it reads in the email. */
  target?: string;
  samplePct?: number;
  waitMinutes?: number;
}

export interface MailerTestPlan {
  kind: MailerTestKind;
  metric: MailerTestMetric;
  variantA: string;
  variantB: string;
  samplePct: number;
  waitMinutes: number;
}

// ── Links in an email ───────────────────────────────────────────────────────

export type EmailLinkKind = "button" | "link" | "image";

export interface EmailLink {
  /** Position of the first anchor with this href + wording. Stable per email. */
  idx: number;
  href: string;
  /** The words a person reads on it. Empty for a picture link. */
  text: string;
  kind: EmailLinkKind;
  /** How many anchors in the email share this href + wording. */
  count: number;
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

function attrOf(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** The words inside a tag, as a person reads them. */
export function visibleTextOf(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      const c = code.toLowerCase();
      if (c.startsWith("#x")) { const n = parseInt(c.slice(2), 16); return Number.isFinite(n) ? String.fromCodePoint(n) : whole; }
      if (c.startsWith("#")) { const n = parseInt(c.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : whole; }
      return ENTITIES[c] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtmlText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A link worth tracking: a real http(s) destination, not the unsubscribe
 *  endpoint (or any /api/ path), not a merge tag, not mailto/tel/anchor. */
export function isTrackableHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const h = href.trim();
  if (!/^https?:\/\//i.test(h)) return false;
  if (/\{\{/.test(h)) return false;
  try {
    const u = new URL(h);
    if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return false;
  } catch { return false; }
  return true;
}

function linkKind(attrs: string, inner: string, text: string): EmailLinkKind {
  if (!text && /<img\b/i.test(inner)) return "image";
  const style = attrOf(attrs, "style") || "";
  if (/display\s*:\s*inline-block/i.test(style) || /\bpadding\s*:/i.test(style)) return "button";
  return "link";
}

/** Every trackable link in the email, one entry per distinct href + wording,
 *  buttons first (that is where a call to action lives), then in page order. */
export function extractEmailLinks(html: string): EmailLink[] {
  const byKey = new Map<string, EmailLink>();
  let idx = 0;
  for (const m of Array.from(String(html || "").matchAll(ANCHOR_RE))) {
    const href = (attrOf(m[1], "href") || "").trim();
    const i = idx++;
    if (!isTrackableHref(href)) continue;
    const text = visibleTextOf(m[2]);
    const key = `${href}\n${text}`;
    const had = byKey.get(key);
    if (had) { had.count++; continue; }
    byKey.set(key, { idx: i, href, text, kind: linkKind(m[1], m[2], text), count: 1 });
  }
  const order: Record<EmailLinkKind, number> = { button: 0, link: 1, image: 2 };
  return Array.from(byKey.values()).sort((a, b) => order[a.kind] - order[b.kind] || a.idx - b.idx);
}

/** Replace the href of every anchor that is one of `links` with the URL
 *  `urlFor` returns for it. Anything not in the list (unsubscribe, mailto, a
 *  merge tag) is left exactly as it was. */
export function trackEmailLinks(html: string, links: ReadonlyArray<EmailLink>, urlFor: (link: EmailLink) => string): string {
  const byKey = new Map(links.map((l) => [`${l.href}\n${l.text}`, l]));
  return String(html || "").replace(ANCHOR_RE, (whole, attrs: string, inner: string) => {
    const href = (attrOf(attrs, "href") || "").trim();
    if (!isTrackableHref(href)) return whole;
    const link = byKey.get(`${href}\n${visibleTextOf(inner)}`);
    if (!link) return whole;
    const next = urlFor(link);
    const attrs2 = attrs.replace(/\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `href="${escapeHtmlText(next)}"`);
    return `<a${attrs2}>${inner}</a>`;
  });
}

/** Variant B of a link test: every anchor whose wording is `target` reads
 *  `replacement` instead. Tags inside the anchor (a span, a bold) are kept —
 *  the first text run takes the new words, the rest go blank — so the button
 *  keeps its styling and only its words change. */
export function replaceLinkText(html: string, target: string, replacement: string): { html: string; replaced: number } {
  const want = target.trim();
  let replaced = 0;
  const out = String(html || "").replace(ANCHOR_RE, (whole, attrs: string, inner: string) => {
    if (!want || visibleTextOf(inner) !== want) return whole;
    replaced++;
    if (!/</.test(inner)) return `<a${attrs}>${escapeHtmlText(replacement)}</a>`;
    let done = false;
    const inner2 = inner.split(/(<[^>]+>)/).map((tok) => {
      if (tok.startsWith("<")) return tok;
      if (!tok.trim()) return tok;
      if (done) return "";
      done = true;
      return escapeHtmlText(replacement);
    }).join("");
    return `<a${attrs}>${inner2}</a>`;
  });
  return { html: out, replaced };
}

// ── The split ───────────────────────────────────────────────────────────────

/** A small seeded generator (mulberry32) so the split for a campaign is the
 *  same every time it is computed — a resumed send must not reshuffle. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MailerSplit { a: string[]; b: string[]; rest: string[] }

/** Who is in the test and who waits for the winner. Below
 *  MAILER_TEST_MIN_FOR_HOLDOUT people, or at 100%, everyone is in the test. */
export function splitForTest(emails: ReadonlyArray<string>, samplePct: number, seed: number): MailerSplit {
  const list = emails.slice();
  const rnd = seeded(seed || 1);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const n = list.length;
  const pct = Math.min(100, Math.max(1, Math.round(samplePct || MAILER_TEST_SAMPLE_DEFAULT)));
  const everyone = n < MAILER_TEST_MIN_FOR_HOLDOUT || pct >= 100;
  const sampleSize = everyone ? n : Math.max(2, Math.round((n * pct) / 100));
  const sample = list.slice(0, sampleSize);
  const rest = list.slice(sampleSize);
  const a: string[] = [], b: string[] = [];
  sample.forEach((e, i) => (i % 2 === 0 ? a : b).push(e));
  return { a, b, rest };
}

// ── The verdict ─────────────────────────────────────────────────────────────

export interface VariantTally { sent: number; hits: number }

export interface Verdict {
  winner: MailerVariant;
  /** Why: the metric that decided it, or "tie" (A, the original, keeps it). */
  reason: MailerTestMetric | "tie";
  aRate: number;
  bRate: number;
}

/** The better rate wins. A tie, or nothing measured at all, keeps A — it is
 *  the version the sender wrote first, and a coin toss is not a result. */
export function chooseWinner(a: VariantTally, b: VariantTally, metric: MailerTestMetric): Verdict {
  const aRate = a.sent > 0 ? a.hits / a.sent : 0;
  const bRate = b.sent > 0 ? b.hits / b.sent : 0;
  if (Math.abs(aRate - bRate) < 1e-9) return { winner: "A", reason: "tie", aRate, bRate };
  return { winner: bRate > aRate ? "B" : "A", reason: metric, aRate, bRate };
}

// ── Bots ────────────────────────────────────────────────────────────────────

/** Mail scanners (Microsoft Safe Links, Proofpoint, Mimecast, Barracuda…)
 *  follow every link in an email seconds after it lands. They are not people
 *  and must not decide a test. A click from one of these is kept, flagged. */
const BOT_UA = /bot|crawl|spider|slurp|preview|scan|safelinks|proofpoint|mimecast|barracuda|trendmicro|symantec|mcafee|sophos|fortinet|forcepoint|zscaler|cloudflare|googleimageproxy|facebookexternalhit|slackbot|whatsapp|telegram|discord|curl\/|wget\/|python|java\/|go-http|okhttp|headless|phantom|lighthouse|validator|monitor|fetch|http[-_ ]?client|apache|libwww/i;

export function isSuspectedBotUserAgent(ua: string | null | undefined): boolean {
  const s = String(ua || "").trim();
  if (!s) return true;
  return BOT_UA.test(s);
}

/** A sweep: the same person "clicking" a second, different link within this
 *  many seconds of the first is a scanner walking the email, not a reader. */
export const MAILER_CLICK_SWEEP_SECONDS = 3;

// ── Validation ──────────────────────────────────────────────────────────────

export function validateMailerTest(
  raw: unknown,
  subject: string,
  html: string,
): { ok: true; plan: MailerTestPlan } | { ok: false; message: string } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<MailerTestInput>;
  const kind = input.kind === "subject" || input.kind === "link" ? input.kind : null;
  if (!kind) return { ok: false, message: "A test is either of the subject line or of a link's wording." };
  const b = String(input.b ?? "").trim();
  if (!b) return { ok: false, message: kind === "subject" ? "Type the second subject line." : "Type the second wording for the link." };
  if (b.length > MAILER_TEST_VARIANT_MAX) return { ok: false, message: `Keep the second version under ${MAILER_TEST_VARIANT_MAX} characters.` };
  const samplePct = Number(input.samplePct ?? MAILER_TEST_SAMPLE_DEFAULT);
  if (!Number.isFinite(samplePct) || samplePct < 1 || samplePct > 100) return { ok: false, message: "The share of the list in the test must be between 1% and 100%." };
  const waitMinutes = Number(input.waitMinutes ?? MAILER_TEST_WAIT_DEFAULT);
  if (!Number.isFinite(waitMinutes) || waitMinutes < 0 || waitMinutes > 7 * 24 * 60) return { ok: false, message: "The wait before the winner is picked must be within a week." };

  if (kind === "subject") {
    const a = String(subject ?? "").trim();
    if (!a) return { ok: false, message: "Write the subject line first; the test needs it as version A." };
    if (a === b) return { ok: false, message: "The two subject lines are the same — there is nothing to test." };
    return { ok: true, plan: { kind, metric: "opens", variantA: a, variantB: b, samplePct: Math.round(samplePct), waitMinutes: Math.round(waitMinutes) } };
  }

  const target = String(input.target ?? "").trim();
  if (!target) return { ok: false, message: "Pick which button or link to test." };
  const links = extractEmailLinks(html);
  if (!links.some((l) => l.text === target)) return { ok: false, message: `No link in this email reads "${target}" — it may have been edited since.` };
  if (target === b) return { ok: false, message: "The two wordings are the same — there is nothing to test." };
  return { ok: true, plan: { kind, metric: "clicks", variantA: target, variantB: b, samplePct: Math.round(samplePct), waitMinutes: Math.round(waitMinutes) } };
}

// ── Words ───────────────────────────────────────────────────────────────────

export function waitLabel(minutes: number): string {
  if (minutes <= 0) return "straight away";
  if (minutes % 1440 === 0) { const d = minutes / 1440; return d === 1 ? "24 hours" : `${d} days`; }
  if (minutes % 60 === 0) { const h = minutes / 60; return h === 1 ? "1 hour" : `${h} hours`; }
  return `${minutes} minutes`;
}

/** "A to 380 and B to 380 now, then the winner to the other 3,040 after 2 hours." */
export function describeTestPlan(total: number, plan: Pick<MailerTestPlan, "samplePct" | "waitMinutes" | "metric">): string {
  const n = Math.max(0, Math.trunc(total));
  const split = splitForTest(Array.from({ length: n }, (_, i) => String(i)), plan.samplePct, 1);
  const fmt = (x: number) => x.toLocaleString("en-NZ");
  const judged = plan.metric === "opens" ? "more opens" : "more clicks";
  if (split.rest.length === 0) {
    return `Half get A (${fmt(split.a.length)}) and half get B (${fmt(split.b.length)}) now. Nobody waits; the result shows which had ${judged}.`;
  }
  return `A to ${fmt(split.a.length)} and B to ${fmt(split.b.length)} now, then whichever has ${judged} goes to the other ${fmt(split.rest.length)} after ${waitLabel(plan.waitMinutes)}.`;
}
