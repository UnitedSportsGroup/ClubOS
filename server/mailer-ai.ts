// ── The Mailer's assistant — "make it modern", in a chat box beside the canvas ─
//
// Daniel, 2026-10-26: "add an option to this builder to also make it agentic
// like chatbox type so i can prompt it to make it modern and easier and make it
// way faster to create what I want … what AI we use and maybe we could add
// limit per staff member per day also".
//
//   POST /api/admin/mailer/ai/edit    { brandKey, mjml, instruction, history? }
//   GET  /api/admin/mailer/ai/usage   today's count + limit (super admin: everyone's month)
//
// Gated on the Mailer TAB in the workspace named by X-Workspace-Slug, the same
// as every other Mailer route. The model gets the email's MJML, the brand kit
// (the only pictures it may use), the brand's own newsletter template as the
// house style, and the request. It answers with EDITS (exact find/replace pairs
// against the current document) or a whole new document; the server applies
// them and CHECKS the result (shared/mailer-ai.ts) before the browser sees it —
// a made-up picture, an unsupported tag, or a picture followed by text in one
// column (which the export silently drops) is sent back to the model once, then
// refused.
//
// 🔴 Every prompt is a paid API call on the club's Anthropic account (the key
// Rambo uses). Each is a row in mailer_ai_usage; the per-person daily cap is
// counted from those rows per NZ day and refused BEFORE the call.
//
// The model is Sonnet by default — fast, cheap, good at markup. One env var
// (MAILER_AI_MODEL) moves it to Opus for the whole app, no deploy.

import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { requireTab } from "./auth";
import { mailerAiUsage } from "@shared/schema";
import {
  MAILER_AI_DEFAULT_MODEL,
  MAILER_AI_MAX_MJML_CHARS,
  MAILER_AI_MERGE_TAGS,
  applyMjmlEdits,
  mailerAiCostCents,
  mailerAiDailyLimitFor,
  mjmlImageSrcs,
  validateMailerAiMjml,
  type MailerAiTokenUsage,
} from "@shared/mailer-ai";
import { brandKit, SOCIAL_ICON } from "../client/src/components/marketing/grapes/templates/brand-kit";
import { clubNewsletterTemplate } from "../client/src/components/marketing/grapes/templates/club-newsletter";
import { LETTERHEADS } from "../client/src/components/marketing/grapes/letterheads";

const MODEL = process.env.MAILER_AI_MODEL || MAILER_AI_DEFAULT_MODEL;
const EFFORT = (process.env.MAILER_AI_EFFORT || "medium") as "low" | "medium" | "high";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

/** The organisation behind the workspace header. requireTab has already proved
 *  the caller may use the Mailer there. */
async function orgIdFor(req: Request): Promise<number | null> {
  const slug = String(req.headers["x-workspace-slug"] || "");
  if (!slug) return null;
  const r = rowsOf(await db.execute(sql`SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1`));
  return r[0] ? Number(r[0].id) : null;
}

async function usedToday(userId: number): Promise<number> {
  const r = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n FROM mailer_ai_usage
    WHERE user_id = ${userId}
      AND (created_at AT TIME ZONE 'Pacific/Auckland')::date = (now() AT TIME ZONE 'Pacific/Auckland')::date`));
  return Number(r[0]?.n ?? 0);
}

// ── What the model is told ────────────────────────────────────────────────────

// The answer's shape, as a JSON schema the API enforces (structured outputs).
// 🔴 Written by hand, not through the SDK's zod helper: that helper reads zod
// v4 schemas at runtime and types zod v3 ones, and ClubOS is on the v3 API —
// the first probe died inside it before the request left the machine.
interface AnswerT {
  reply: string;
  edits: { find: string; replace: string }[];
  mjml: string | null;
}
const ANSWER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "One or two short sentences in plain NZ English: what you changed, or the ONE question you need answered. Never describe code.",
    },
    edits: {
      type: "array",
      description: "Small targeted changes. Each `find` is copied EXACTLY (character for character, including whitespace) from the current email and occurs exactly once; `replace` is what goes in its place. Empty when you return `mjml`.",
      items: {
        type: "object",
        properties: { find: { type: "string" }, replace: { type: "string" } },
        required: ["find", "replace"],
        additionalProperties: false,
      },
    },
    mjml: {
      type: ["string", "null"],
      description: "The complete new document, only when the change is too big for edits (a restyle, a new layout, an email built from a brief). Otherwise null.",
    },
  },
  required: ["reply", "edits", "mjml"],
  additionalProperties: false,
};

function parseAnswer(res: Anthropic.Message): AnswerT | null {
  const text = res.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== "object" || typeof o.reply !== "string" || !Array.isArray(o.edits)) return null;
    return {
      reply: o.reply,
      edits: o.edits.filter((e: any) => e && typeof e.find === "string" && typeof e.replace === "string"),
      mjml: typeof o.mjml === "string" ? o.mjml : null,
    };
  } catch {
    return null;
  }
}

const RULES = `You are the email design assistant inside ClubOS, the admin system of Christchurch United FC Inc. in Christchurch, New Zealand. A member of staff is building an email in a drag-and-drop builder that stores the design as MJML. You change that MJML to do what they ask, quickly and well.

HOW TO ANSWER
- A small change (wording, one block, a colour, a button, moving a couple of things): return "edits" — exact "find" strings copied from the current email that occur ONCE each, with their "replace". Keep them minimal. Leave "mjml" null.
- A big change (restyle, new layout, several sections, build an email from a brief, "make it modern"): return the FULL new document in "mjml" and leave "edits" empty.
- "reply": one or two short sentences saying what you did. If you need a fact that is not in the email, the brand kit or the conversation (a date, a price, a name, a link), do NOT invent it — use a clearly marked placeholder like [date] or [price], say so in the reply, and make the change anyway. Only ask a question instead when the request itself cannot be understood.

HARD RULES
- Only these tags: mjml, mj-body, mj-wrapper, mj-section, mj-group, mj-column, mj-text, mj-image, mj-button, mj-divider, mj-spacer, mj-social, mj-social-element, mj-raw. No mj-head, mj-style, mj-attributes, mj-font, no <script>. Styling is attributes and inline styles inside mj-text.
- Pictures: ONLY image URLs from the brand kit below, or ones already in the current email. Never invent or hotlink a picture.
- In a column, an mj-image, mj-divider or mj-spacer must be the LAST child — the builder's export drops everything after one. Put a picture in its own column or section, or last. For a rule between things use border-top / border-bottom on the section or column.
- Keep merge tags exactly as they are: ${MAILER_AI_MERGE_TAGS.map((t) => `{{${t}}}`).join(", ")}. Do not invent new ones. {{first_name}} is the parent; {{player_first_name}} is their registered child.
- Email-safe only: 600px body, no CSS grid or flex, web-safe font stacks (use the kit's), no background images unless already there, buttons as mj-button.
- Keep the document under ${MAILER_AI_MAX_MJML_CHARS} characters.
- Brand: use the kit's colours, fonts, crest, links, socials and address. Keep the header and footer shape of the house style unless asked. The crest stays in the header.
- Copy: warm, specific, plain NZ English in the club's voice. No hype words (elite, unleash, journey, world-class, transform, elevate), no exclamation marks, no em dashes. Short sentences.
- Preserve everything the person did not ask to change — their words, their links, their pictures.
- "Make it modern" means: more white space, one clear hero, bigger photo, tighter copy, one strong button, consistent spacing, fewer competing elements. Not more decoration.`;

const promptCache = new Map<string, string>();

function systemPromptFor(brandKey: string): string {
  const key = (brandKey || "").toLowerCase();
  const hit = promptCache.get(key);
  if (hit) return hit;
  const kit = brandKit(key);
  const kitForModel = {
    brand: kit.key,
    crest: kit.crest,
    crestWidth: kit.crestWidth,
    site: kit.site,
    shop: kit.shop ?? null,
    mainAction: kit.action ?? null,
    nav: kit.nav,
    photos: kit.photos,
    products: kit.products ?? [],
    socials: kit.socials,
    socialIcons: Object.fromEntries(Object.entries(SOCIAL_ICON).map(([k, v]) => [k, v.src])),
    address: kit.address,
    colours: { footerBg: kit.footerBg, footerText: kit.footerText, footerAccent: kit.footerAccent, link: kit.link, button: kit.button, onButton: kit.onButton },
    headlineFont: kit.headlineFont,
  };
  let reference = "";
  try {
    reference = clubNewsletterTemplate.build(key);
  } catch {
    reference = "";
  }
  const text =
    `${RULES}\n\nBRAND KIT (JSON — the only pictures you may use are the URLs in here):\n${JSON.stringify(kitForModel, null, 1)}\n\n` +
    (reference
      ? `HOUSE STYLE — this brand's newsletter template as MJML. Copy its shapes, spacing, fonts and conventions when you build or restyle:\n${reference}`
      : "");
  promptCache.set(key, text);
  return text;
}

function allowedImagesFor(brandKey: string, mjml: string): Set<string> {
  const kit = brandKit(brandKey);
  const set = new Set<string>();
  set.add(kit.crest);
  kit.photos.forEach((p) => set.add(p.src));
  (kit.products ?? []).forEach((p) => set.add(p.src));
  Object.values(SOCIAL_ICON).forEach((s) => set.add(s.src));
  LETTERHEADS.forEach((l) => set.add(l.src));
  mjmlImageSrcs(mjml).forEach((s) => set.add(s));
  return set;
}

// ── One prompt, start to finish ───────────────────────────────────────────────

interface RunOutcome {
  reply?: string;
  mjml?: string | null;
  changed?: boolean;
  error?: string;
}

async function runAssistant(opts: {
  brandKey: string;
  mjml: string;
  instruction: string;
  history: { role: "user" | "assistant"; content: string }[];
  totals: MailerAiTokenUsage;
}): Promise<RunOutcome> {
  const { brandKey, mjml, instruction, totals } = opts;
  const allowed = allowedImagesFor(brandKey, mjml);
  const system = systemPromptFor(brandKey);

  const messages: Anthropic.MessageParam[] = [
    ...opts.history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `<current_email>\n${mjml}\n</current_email>\n\nRequest: ${instruction}`,
    },
  ];

  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA }, effort: EFFORT },
    });

    totals.input += res.usage.input_tokens ?? 0;
    totals.output += res.usage.output_tokens ?? 0;
    totals.cacheRead += (res.usage as any).cache_read_input_tokens ?? 0;
    totals.cacheWrite += (res.usage as any).cache_creation_input_tokens ?? 0;

    if (res.stop_reason === "refusal") return { error: "The assistant declined that request." };

    const out = parseAnswer(res);
    const problems: string[] = [];
    let candidate: string | null = null;

    if (res.stop_reason === "max_tokens") problems.push("the answer was cut off — it was too long; return smaller edits, or a shorter document");
    if (!out) problems.push("the answer was not valid JSON matching the schema");
    else {
      if (out.mjml && out.mjml.trim()) candidate = out.mjml.trim();
      else if (out.edits?.length) {
        const r = applyMjmlEdits(mjml, out.edits);
        problems.push(...r.failures);
        candidate = r.failures.length ? null : r.mjml;
      }
      if (candidate) problems.push(...validateMailerAiMjml(candidate, allowed));
    }

    if (!problems.length && out) {
      const changed = !!candidate && candidate !== mjml;
      return { reply: out.reply, mjml: changed ? candidate : null, changed };
    }

    lastProblems = problems;
    messages.push({ role: "assistant", content: out ? JSON.stringify(out) : "(no valid answer)" });
    messages.push({
      role: "user",
      content:
        `That answer could not be applied:\n- ${problems.join("\n- ")}\n\n` +
        `Try again. If an edit failed to match, return the FULL corrected document in "mjml" instead of edits. ` +
        `Use only pictures from the brand kit or the current email. Keep a picture, rule or spacer as the LAST child of its column.`,
    });
  }
  return {
    error: `The assistant couldn't make a change that passes the checks (${lastProblems[0] || "no usable answer"}). Try describing it differently.`,
  };
}

/** The same run the route makes, for script/_probe-mailer-ai-model.ts. */
export const mailerAiRunForProbe = runAssistant;

function friendly(e: any): string {
  const msg = String(e?.message || e || "");
  if (e?.status === 401 || /authentication/i.test(msg)) return "The assistant's API key was refused. Check ANTHROPIC_API_KEY on the server.";
  if (e?.status === 429 || /rate limit/i.test(msg)) return "The assistant is busy right now (rate limited). Try again in a minute.";
  if (/credit|balance|billing/i.test(msg)) return "The club's Anthropic account is out of credit. Top it up at console.anthropic.com.";
  if (e?.status >= 500 || /overloaded/i.test(msg)) return "Anthropic's service is having a moment. Try again shortly.";
  return `The assistant hit a snag: ${msg.slice(0, 200)}`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerMailerAiRoutes(app: Express) {
  const gate = requireTab("mailer");

  app.get("/api/admin/mailer/ai/usage", gate, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      const org = await orgIdFor(req);
      if (!user || !org) return res.status(400).json({ message: "Unknown workspace" });
      const limit = mailerAiDailyLimitFor(user.mailerAiDailyLimit);
      const used = await usedToday(userId);
      const base: any = { used, limit, model: MODEL, enabled: !!process.env.ANTHROPIC_API_KEY };
      if (user.role === "super_admin") {
        base.people = rowsOf(await db.execute(sql`
          SELECT user_id, coalesce(max(user_label), 'Unknown') AS label,
                 count(*)::int AS prompts,
                 count(*) FILTER (WHERE changed)::int AS changes,
                 round(sum(cost_usd_cents)::numeric, 2)::float AS cents
          FROM mailer_ai_usage
          WHERE organization_id = ${org}
            AND (created_at AT TIME ZONE 'Pacific/Auckland') >= date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland')
          GROUP BY user_id ORDER BY prompts DESC, label`)).map((r) => ({
          userId: r.user_id, label: r.label, prompts: r.prompts, changes: r.changes, cents: Number(r.cents) || 0,
        }));
      }
      res.json(base);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/mailer/ai/edit", gate, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    let user: any = null;
    let org: number | null = null;
    try {
      user = await storage.getUser(userId);
      org = await orgIdFor(req);
    } catch (e: any) {
      return res.status(500).json({ ok: false, message: e.message });
    }
    if (!user || !org) return res.status(400).json({ ok: false, message: "Unknown workspace" });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ ok: false, message: "The assistant isn't switched on — ANTHROPIC_API_KEY isn't set on the server." });
    }

    const body = req.body ?? {};
    const brandKey = typeof body.brandKey === "string" ? body.brandKey.slice(0, 40) : "";
    const mjml = typeof body.mjml === "string" ? body.mjml : "";
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    const history: { role: "user" | "assistant"; content: string }[] = Array.isArray(body.history)
      ? body.history
          .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
          .slice(-8)
          .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
      : [];
    if (!instruction) return res.status(400).json({ ok: false, message: "Say what you'd like changed." });
    if (instruction.length > 4000) return res.status(400).json({ ok: false, message: "That's a long request — keep it under 4,000 characters." });
    if (!mjml.trim() || !/<mjml[\s>]/i.test(mjml)) return res.status(400).json({ ok: false, message: "The design hasn't loaded yet — try again in a moment." });
    if (mjml.length > MAILER_AI_MAX_MJML_CHARS * 2) return res.status(400).json({ ok: false, message: "This design is too large for the assistant to read." });

    const limit = mailerAiDailyLimitFor(user.mailerAiDailyLimit);
    const used = await usedToday(userId);
    if (used >= limit) {
      return res.status(429).json({
        ok: false,
        message:
          limit === 0
            ? "The assistant is switched off for your account. A super admin can turn it on in Team."
            : `You've used today's ${limit} prompt${limit === 1 ? "" : "s"}. It resets at midnight NZ time, or a super admin can raise your limit in Team.`,
        usage: { used, limit },
      });
    }

    // A long answer can take a minute; a quiet connection that long gets
    // closed by the proxy. Whitespace every 15s keeps it open, and JSON.parse
    // ignores it. The status is therefore 200 from here on — failures travel
    // as { ok: false }.
    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders?.();
    const beat = setInterval(() => { try { res.write(" "); } catch { /* gone */ } }, 15_000);

    const started = Date.now();
    const totals: MailerAiTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let outcome: RunOutcome;
    try {
      outcome = await runAssistant({ brandKey, mjml, instruction, history, totals });
    } catch (e: any) {
      console.error("[mailer-ai] failed:", e?.message || e);
      outcome = { error: friendly(e) };
    }
    clearInterval(beat);

    const label = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    try {
      await db.insert(mailerAiUsage).values({
        userId,
        userLabel: label,
        organizationId: org,
        brand: brandKey || null,
        model: MODEL,
        instruction: instruction.slice(0, 2000),
        inputTokens: totals.input,
        outputTokens: totals.output,
        cacheReadTokens: totals.cacheRead,
        cacheWriteTokens: totals.cacheWrite,
        costUsdCents: String(mailerAiCostCents(MODEL, totals)),
        durationMs: Date.now() - started,
        ok: !outcome.error,
        changed: !!outcome.changed,
        error: outcome.error ?? null,
      });
    } catch (e: any) {
      console.error("[mailer-ai] usage row failed:", e?.message || e);
    }

    const usage = { used: used + 1, limit };
    res.end(
      JSON.stringify(
        outcome.error
          ? { ok: false, message: outcome.error, usage }
          : { ok: true, reply: outcome.reply, mjml: outcome.mjml ?? null, changed: !!outcome.changed, usage },
      ),
    );
  });
}
