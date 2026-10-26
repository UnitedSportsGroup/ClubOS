/**
 * Content Studio — the generator. Rambo turns a brief into a DOCUMENT (a
 * graphic's words and layout, a page's blocks), the API enforces the shape,
 * and shared/studio.ts checks every picture and link before anything is
 * saved. The renderer owns the look, so the model cannot make an off-brand
 * piece — only a wrong one, which the checks catch and a retry fixes.
 *
 * Models: the first version of a piece on STUDIO_MODEL (Opus — the copy is
 * what a parent reads); a re-prompt on an existing piece on STUDIO_EDIT_MODEL
 * (Sonnet — a change to something that already works). Both switchable on
 * Fly with no deploy.
 */
import Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { studioGenerations } from "@shared/schema";
import { mailerAiCostCents, type MailerAiTokenUsage } from "@shared/mailer-ai";
import {
  checkGraphicDoc, checkPageDoc, GRAPHIC_LAYOUTS, GRAPHIC_SCHEMA, PAGE_SCHEMA, STUDIO_DEFAULT_EDIT_MODEL, STUDIO_DEFAULT_MODEL,
  graphicSize, isAllowedPicture, studioBrand, type GraphicDoc, type PageDoc, type StudioKind,
} from "@shared/studio";
import { brandVoice, HOUSE_VOICE } from "@shared/studio-voice";
import { BRAND_KITS, brandKit, CLUB_LOGOS } from "../client/src/components/marketing/grapes/templates/brand-kit";
import { programmeFactsFor } from "./brand-facts";

export const STUDIO_MODEL = process.env.STUDIO_MODEL || STUDIO_DEFAULT_MODEL;
export const STUDIO_EDIT_MODEL = process.env.STUDIO_EDIT_MODEL || STUDIO_DEFAULT_EDIT_MODEL;
const EFFORT = (process.env.STUDIO_AI_EFFORT || "medium") as "low" | "medium" | "high";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

// ── What the model is told ──────────────────────────────────────────────────

/** Every picture the club owns that a piece may use, with its caption. */
export async function pictureLibrary(orgId: number, brandKey: string): Promise<{ src: string; caption: string; brand: string }[]> {
  const out: { src: string; caption: string; brand: string }[] = [];
  const own = brandKit(brandKey);
  for (const p of own.photos) out.push({ src: p.src, caption: p.alt, brand: brandKey });
  for (const p of own.products ?? []) out.push({ src: p.src, caption: `${p.alt} (product shot on white)`, brand: brandKey });
  for (const k of Object.values(BRAND_KITS)) {
    if (k.key === brandKey) continue;
    for (const p of k.photos) out.push({ src: p.src, caption: p.alt, brand: k.key });
  }
  // Pictures staff uploaded to the Mailer or the Studio in this workspace.
  try {
    const rows = rowsOf(await db.execute(sql`SELECT key, mime, original_name FROM mailer_images WHERE organization_id = ${orgId} ORDER BY created_at DESC LIMIT 40`));
    for (const r of rows) {
      const ext = r.mime === "image/png" ? "png" : r.mime === "image/gif" ? "gif" : "jpg";
      out.push({ src: `https://app.usg.co.nz/mailer/img/${r.key}.${ext}`, caption: `uploaded by staff: ${r.original_name || "picture"}`, brand: brandKey });
    }
  } catch { /* the library is a convenience */ }
  return out;
}

const promptCache = new Map<string, { at: number; text: string }>();

async function systemPromptFor(kind: StudioKind, brandKey: string, orgId: number): Promise<string> {
  const cacheKey = `${kind}:${brandKey}:${orgId}`;
  const hit = promptCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.text;
  const brand = studioBrand(brandKey) ?? studioBrand("cufc")!;
  const kit = brandKit(brandKey);
  const facts = await programmeFactsFor(orgId);
  const pictures = await pictureLibrary(orgId, brandKey);
  const pictureList = pictures.map((p) => `- ${p.src}  (${p.brand}: ${p.caption})`).join("\n");

  const job = kind === "graphic"
    ? `YOUR JOB: turn the brief into ONE social graphic as a document. Pick the LAYOUT that fits the brief:\n${GRAPHIC_LAYOUTS.map((l) => `- ${l.key}: ${l.when}`).join("\n")}\nRules for a graphic: the headline is at most 60 characters and carries the whole message on its own; the sub is one line; a photo is used only when it shows the right people (match the caption to the age group and the activity — gymnastics kids for a gymnastics piece, never football); "cta" is a short pointer like "cufc.co.nz/camps" or "Book at the office", never a sentence; "theme" is "dark" (the brand ground) unless the brief asks for white. A chart's items are the numbers the brief gives you — never invent a number; if the brief has no numbers, do not pick chart. An event layout fills date/time/venue/price from the FACTS only.`
    : `YOUR JOB: turn the brief into ONE landing page as a list of blocks. A good page: a hero (eyebrow, headline, one-line sub, a photo if a fitting one exists, a button to the REAL booking link from the facts) · a short text block that says who it is for and what happens · bullets of what is included or what to bring · stats only if the facts carry numbers · cards for two to four options or age groups · a faq of the questions a parent actually asks (cost, what to bring, what if it rains, siblings, refunds — answer only from the facts; otherwise point to the office email) · a closing cta with the same booking link. Four to nine blocks. Every link is a full https:// address from the facts or the brand's site. Never a link you made up.`;

  const text = `You are Rambo, the club's own assistant inside ClubOS, making content for the club's staff. You write ONLY the words and choose the layout; the design is drawn by the club's own templates, so you never write HTML or CSS.

BRAND: ${brand.name} (${brand.key}). Site ${kit.site}. ${brandVoice(brandKey)}

${HOUSE_VOICE}

${job}

${facts}

PICTURES YOU MAY USE (URL — brand: what it shows). Use a URL exactly as written, or none. Prefer this brand's own; use another brand's ONLY when the piece is about that brand.
${pictureList}

CLUB CRESTS are drawn by the template automatically — never put a crest URL in a photo field. Crest URLs for reference: ${CLUB_LOGOS.map((l) => `${l.key}=${l.src}`).join(", ")}.

ANSWERING: return the document that matches the schema. "reply" is one or two plain sentences to the staff member: what you made and the one thing they should check (a price, a date), or the ONE question you need answered if the brief is missing something a page or graphic cannot do without. When you are asked to CHANGE an existing document, return the whole document again with only the asked-for change made — keep every other word as it was.`;
  promptCache.set(cacheKey, { at: Date.now(), text });
  return text;
}

// ── One generation ──────────────────────────────────────────────────────────

export interface StudioGenerateInput {
  kind: "graphic" | "page";
  brandKey: string;
  orgId: number;
  userId: number | null;
  userLabel: string | null;
  brief: string;
  /** Graphics: the size the artboard is drawn at (the words are sized to it). */
  sizeKey?: string;
  /** A re-prompt: the document as it stands, and what to change. */
  current?: GraphicDoc | PageDoc | null;
  history?: { role: "user" | "assistant"; content: string }[];
  pieceId?: number | null;
}

export interface StudioGenerateResult {
  ok: boolean;
  reply: string;
  title: string | null;
  doc: GraphicDoc | PageDoc | null;
  model: string;
  usage: MailerAiTokenUsage;
  costCents: number;
  /** The usage row — a first generation is written before its piece exists;
   *  the caller stamps the piece id on it once the piece is saved. */
  generationId: number | null;
  error?: string;
}

function parseJson(res: Anthropic.Message): any | null {
  const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Stamp the piece on the usage row written before the piece existed. */
export async function stampGeneration(generationId: number | null, pieceId: number): Promise<void> {
  if (!generationId) return;
  try { await db.update(studioGenerations).set({ pieceId }).where(eq(studioGenerations.id, generationId)); } catch { /* bookkeeping */ }
}

export async function generateStudioPiece(input: StudioGenerateInput): Promise<StudioGenerateResult> {
  const started = Date.now();
  const model = input.current ? STUDIO_EDIT_MODEL : STUDIO_MODEL;
  const usage: MailerAiTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const system = await systemPromptFor(input.kind, input.brandKey, input.orgId);
  const size = graphicSize(input.sizeKey);
  const schema = input.kind === "graphic" ? GRAPHIC_SCHEMA : PAGE_SCHEMA;
  const messages: Anthropic.MessageParam[] = [
    ...(input.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: input.current
        ? `<current_document>\n${JSON.stringify(input.current, null, 1)}\n</current_document>\n\nChange requested: ${input.brief}`
        : `${input.kind === "graphic" ? `Size: ${size.label} ${size.width}×${size.height} (${size.use}).\n` : ""}Brief: ${input.brief}`,
    },
  ];

  let generationId: number | null = null;
  const record = async (ok: boolean, error: string | null, reply: string | null) => {
    try {
      const [row] = await db.insert(studioGenerations).values({
        pieceId: input.pieceId ?? null, userId: input.userId, userLabel: input.userLabel, organizationId: input.orgId, brand: input.brandKey,
        kind: input.kind, model, instruction: input.brief.slice(0, 4000),
        inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite,
        costUsdCents: String(mailerAiCostCents(model, usage)), durationMs: Date.now() - started, ok, error: error ?? (ok ? null : reply),
      }).returning({ id: studioGenerations.id });
      generationId = row?.id ?? null;
    } catch (e) { console.error("[studio] usage row failed:", e); }
  };

  let lastProblems: string[] = [];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await client.messages.create({
        model,
        max_tokens: 8000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { format: { type: "json_schema", schema }, effort: EFFORT },
      });
      usage.input += res.usage.input_tokens ?? 0;
      usage.output += res.usage.output_tokens ?? 0;
      usage.cacheRead += (res.usage as any).cache_read_input_tokens ?? 0;
      usage.cacheWrite += (res.usage as any).cache_creation_input_tokens ?? 0;
      if (res.stop_reason === "refusal") { await record(false, "refused", null); return { ok: false, reply: "", title: null, doc: null, model, usage, costCents: mailerAiCostCents(model, usage), generationId, error: "Rambo declined that brief." }; }
      const out = parseJson(res);
      const problems: string[] = [];
      if (res.stop_reason === "max_tokens") problems.push("the answer was cut off — keep the page to nine blocks and the words short");
      if (!out || typeof out.reply !== "string") problems.push("the answer was not valid JSON matching the schema");
      let doc: GraphicDoc | PageDoc | null = null;
      if (out) {
        if (input.kind === "graphic") {
          const c = checkGraphicDoc(out.graphic, isAllowedPicture);
          problems.push(...c.problems);
          doc = c.doc;
        } else {
          const c = checkPageDoc(out.page, isAllowedPicture);
          problems.push(...c.problems);
          doc = c.doc;
        }
      }
      if (!problems.length && out && doc) {
        await record(true, null, out.reply);
        const title = input.kind === "graphic" ? String(out.title || (doc as GraphicDoc).headline || "Graphic").slice(0, 120) : String((doc as PageDoc).title || "Page").slice(0, 120);
        return { ok: true, reply: String(out.reply), title, doc, model, usage, costCents: mailerAiCostCents(model, usage), generationId };
      }
      lastProblems = problems;
      messages.push({ role: "assistant", content: out ? JSON.stringify(out) : "(no valid answer)" });
      messages.push({ role: "user", content: `That document could not be used:\n- ${problems.join("\n- ")}\n\nReturn the corrected document. Use only pictures from the list, links from the facts, and the limits given.` });
    }
    await record(false, lastProblems[0] ?? "no usable answer", null);
    return { ok: false, reply: "", title: null, doc: null, model, usage, costCents: mailerAiCostCents(model, usage), generationId, error: `Rambo couldn't make a version that passes the checks (${lastProblems[0] || "no usable answer"}). Try a shorter or more specific brief.` };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    await record(false, msg.slice(0, 500), null);
    const friendly = e?.status === 401 ? "Rambo's API key was refused. Check ANTHROPIC_API_KEY on the server."
      : e?.status === 429 ? "Rambo is busy right now (rate limited). Try again in a minute."
      : /credit|balance|billing/i.test(msg) ? "The club's Anthropic account is out of credit. Top it up at console.anthropic.com."
      : `Rambo hit a snag: ${msg.slice(0, 200)}`;
    return { ok: false, reply: "", title: null, doc: null, model, usage, costCents: mailerAiCostCents(model, usage), generationId, error: friendly };
  }
}
