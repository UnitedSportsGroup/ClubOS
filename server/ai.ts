// Claude integration. Single entry point used by the editor's AI buttons
// to generate brand-aware copy for any text field.
//
// Brand voice + persona context is hardcoded per organisation here for now.
// When we add a second workspace with bespoke copy needs, move these
// constants into an `org_brand_context` table and load by org slug.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";  // Sonnet is the right speed/cost for editor copy gen

// ── Brand voice playbook ─────────────────────────────────────────────────
// CUGC's writing style — distilled from the personas + voice + research
// docs in context/copywriting/. Kept short so the prompt stays cheap.
const CUGC_VOICE = `
You are writing for Christchurch United Gymnastics Club (CUGC) — a rhythmic
gymnastics club in Hornby, South Christchurch, run by Christchurch United
Football Club Inc. (est. 1976, NZ).

Discipline: rhythmic gymnastics (NOT artistic). Hand apparatus: rope, hoop,
ball, clubs, ribbon. The motto on the rhythmic side is "Be Bright. Be
Beautiful. Be You." — never water this down.

Positioning: "A club. Not an academy." Anti-tall-poppy. Radical pricing
transparency. Real coaches who know your kid's name.

5 buyer personas (write to whichever fits the field):
  1. Kelly the Hornby Mum (volume — rec parents, kids 3-12). Fears: shy
     kid / can't sit still / wasting money. Hopes: tired, happy, friends.
  2. Priya the Pathway Mum (high-margin — competitive). Wants real coach
     to tell her straight if her daughter has potential. Pathway pages.
  3. Lena the Rhythmic Mum (niche — Russian/Eastern European immigrant
     families). Knows the sport. Wants female coach with rhythmic-specific
     background. "Apparatus" + "choreography" + "musicality" land.
  4. Brent the Holiday-Camp Dad (cash injection — high-income, time-poor).
     Wants logistics solved. Drop them off, knackered by 3pm.
  5. Megan the Comeback Mum (adult class differentiator). Did gym to 14,
     now postpartum. Wants women-only, judgement-free, no influencer vibe.

Voice:
  - Like the long-serving coach who knows your kid's name. Warm, confident,
    specific.
  - Never use: elite, champion, premier, world-class, unleash, transform,
    journey, ignite, elevate, empower, innovative, excellence, cutting-edge,
    "discover X", "embrace Y", "in today's fast-paced world".
  - Anxiety-first beats aspiration-first. "For the kid who can't sit still"
    > "Build your child's coordination."
  - Anti-elite framing. "We're a club, not an academy."
  - Specific kid moment > generic benefit. "The first time she lands a
    cartwheel without a wobble" > "build confidence and skill."
  - Pricing in the open. Term-by-term. No lock-in. Free trial. Sibling
    discount auto-applied.
  - Three-word values stack: Move. Learn. Belong.

NZ English. No em-dashes (use commas, parentheses, or full stops). No
exclamation marks unless quoting someone genuinely excited. Avoid
"discover", "embark", "vibrant", "passionate", and "individual artist"
type filler.

Output ONLY the copy text. No preamble, no explanation, no quotes around
the result, no markdown. If the user asks for multiple options, separate
them with a single blank line.
`;

const DEFAULT_VOICE = `
You are writing copy for an organisation's landing page or admin field.
Voice: warm, specific, no jargon. NZ English. Output ONLY the copy text
— no preamble, no explanation.
`;

function pickVoice(orgSlug?: string): string {
  if (orgSlug === "united-gymnastics") return CUGC_VOICE;
  return DEFAULT_VOICE;
}

export interface GenerateCopyParams {
  prompt: string;                    // What the user typed
  fieldName?: string;                // 'heroHeadline', 'heroSubheadline', etc.
  fieldHint?: string;                // Human-readable hint, shown to model
  currentValue?: string;             // What's there now (for "rewrite this" cases)
  orgSlug?: string;                  // Drives which brand voice to load
  maxTokens?: number;
}

export async function generateCopy(params: GenerateCopyParams): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured. Set it via fly secrets.");
  }

  const voice = pickVoice(params.orgSlug);

  // Build the user message from the prompt + field hints + any prior value
  const parts: string[] = [];
  if (params.fieldHint) parts.push(`Field: ${params.fieldHint}`);
  if (params.currentValue) parts.push(`Current copy:\n${params.currentValue}`);
  parts.push(`Brief from the editor:\n${params.prompt}`);
  parts.push("Write the copy now.");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 1024,
    system: voice,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });

  // Extract text from the first content block (non-tool-use)
  const textBlock = response.content.find((b: any) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }
  return textBlock.text.trim();
}

// ── Full-page generation ─────────────────────────────────────────────────
// Single Claude call that returns a structured object covering every major
// editable field on a landing page. Faster + cheaper than firing N
// generate-copy calls; also lets the model keep the whole page coherent
// (the headline, subheadline, CTA, and trust badge all riff on the same
// idea instead of feeling stitched together).

export interface GeneratePageParams {
  brief: string;                     // 1-paragraph brief from the user
  orgSlug?: string;
  programName?: string;              // 'Recreational' / 'Beginner Combo'
  programType?: string;              // 'open_training' / 'holiday_camp' / 'academy'
  audience?: string;                 // free-form, e.g. 'parents of 5-12yo girls'
}

export interface PageDraft {
  heroHeadline?: string;
  heroSubheadline?: string;
  primaryCta?: string;
  trustBadge?: string;
  reviewsSectionTitle?: string;
  reviewsSectionSub?: string;
  keyInfoTitle?: string;
  scheduleTitle?: string;
  scheduleSub?: string;
  experienceTitle?: string;
  faqs?: { q: string; a: string }[];
}

export async function generatePageFromBrief(params: GeneratePageParams): Promise<PageDraft> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured. Set it via fly secrets.");
  }

  const voice = pickVoice(params.orgSlug);

  const userMessage = `
Generate a complete landing-page copy draft from this brief.

Program: ${params.programName ?? "(unnamed)"}
Type: ${params.programType ?? "open_training"}
${params.audience ? `Audience: ${params.audience}\n` : ""}

Brief:
${params.brief}

Return ONLY valid JSON matching this exact shape — no markdown, no code fences, no explanation:

{
  "heroHeadline": "1 short sentence — under 12 words",
  "heroSubheadline": "1-2 sentences supporting the headline, names the parent + outcome",
  "primaryCta": "2-3 word action verb (e.g. 'Book a free trial', 'Save my spot')",
  "trustBadge": "All-caps short phrase shown above the star rating, e.g. 'TRUSTED BY 200+ HORNBY FAMILIES'",
  "reviewsSectionTitle": "Section heading for parent reviews",
  "reviewsSectionSub": "1 sentence sub for the reviews section",
  "keyInfoTitle": "Section heading for the 'when, where, how much' info card",
  "scheduleTitle": "Section heading for the schedule",
  "scheduleSub": "1 sentence sub for the schedule",
  "experienceTitle": "Section heading for what to expect / the experience",
  "faqs": [
    { "q": "Question parents actually ask", "a": "Short, direct answer" },
    { "q": "Second FAQ", "a": "Answer" },
    { "q": "Third FAQ", "a": "Answer" },
    { "q": "Fourth FAQ", "a": "Answer" }
  ]
}

All copy must follow the brand voice in the system prompt. Every field is required. JSON only — no preamble.
  `.trim();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: voice,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b: any) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  // Defensive parse: strip code fences if model added them despite instructions
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```\s*$/, "").trim();

  try {
    const parsed = JSON.parse(raw) as PageDraft;
    return parsed;
  } catch (e: any) {
    console.error("[AI page draft] JSON parse failed. Raw:", raw.slice(0, 500));
    throw new Error("Couldn't parse AI response as JSON. Try a shorter brief.");
  }
}
