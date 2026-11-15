// Rambo drafts an e-Sign agreement template from a plain-English request.
//
// 🔴 Rambo writes a DOCUMENT in the template shape, never HTML; the server runs
// it through cleanTemplate() — the same decider a hand-made template meets —
// and a person reviews it before it can be PUBLISHED. A draft is never sent.
// 🔴 It must not invent commercial facts: no money, dates or names that were
// not in the request become terms — they become {{variables}} the sender sets.
// 🔴 One daily allowance across every Rambo door (server/rambo-usage.ts).

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { cleanTemplate, ESIGN_FORM_TYPES, ESIGN_VARIABLE_TYPES, type EsignTemplateInput } from "@shared/esign-template";
import { ramboCostCents } from "./rambo-usage";

const MODEL = process.env.ESIGN_AI_MODEL || "claude-sonnet-5-5";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ITEM = { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { type: "string", enum: ["p", "bullet", "numbered"] }, text: { type: "string" } } };
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["reply", "name", "description", "content", "variables", "form", "settings"],
  properties: {
    reply: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    content: {
      type: "object", additionalProperties: false, required: ["docTitle", "partiesIntro", "sections", "signAck"],
      properties: {
        docTitle: { type: "string" },
        partiesIntro: { type: "array", items: { type: "string" } },
        sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["heading", "items"], properties: { heading: { type: "string" }, items: { type: "array", items: ITEM } } } },
        signAck: { type: "string" },
      },
    },
    variables: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "label", "type", "required", "default", "options"], properties: { key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: [...ESIGN_VARIABLE_TYPES] }, required: { type: "boolean" }, default: { type: "string" }, options: { type: "array", items: { type: "string" } } } } },
    form: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "label", "type", "required", "placeholder"], properties: { key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: [...ESIGN_FORM_TYPES] }, required: { type: "boolean" }, placeholder: { type: "string" } } } },
    settings: { type: "object", additionalProperties: false, required: ["counterSignerRole", "primarySignerRole", "detailsHeading", "guardianUnder18"], properties: { counterSignerRole: { type: "string" }, primarySignerRole: { type: "string" }, detailsHeading: { type: "string" }, guardianUnder18: { type: "boolean" } } },
  },
};

function systemPrompt(brandLabel: string, legalEntity: string): string {
  return `You are Rambo, the in-house assistant for United Sports Group (Christchurch, New Zealand). You draft agreements that people sign electronically on a web page: a player agreement, a letter of offer, a sponsorship agreement, a volunteer or contractor agreement, a hire agreement, a consent form.

You return ONE agreement template as JSON in the schema given. The club's software renders it as a branded signing page and a PDF; you write only words and fields.

THE PARTIES
- The organisation signing is ${legalEntity}, trading as ${brandLabel}. Unless the request says otherwise, name it that way in partiesIntro.
- The other party is whoever opens the link. Put their name in the text with a {{placeholder}} that matches a form field key, e.g. {{full_name}}.

TWO KINDS OF BLANK
- "form" = details the SIGNER types in when they sign (their full name, date of birth, address, phone, email, bank account, IRD number…). Field types: text, date, dob, phone, email, bank, address. The FIRST text field must be the signer's full name.
- "variables" = details the CLUB sets before sending (fee, start date, end date, position, season, term length). Types: text, select (give options), date, money. Give a sensible default only when the request states one; otherwise leave default "".
- Every {{key}} you use in the text MUST be the key of a form field or a variable. Keys are lower_snake_case.

DO NOT INVENT FACTS
- Never invent amounts, dates, durations, names, addresses or obligations that are not in the request. If an agreement needs one, make it a variable for the club to set.
- Write in plain New Zealand English. Clear headings, short numbered clauses. No legalese for its own sake.
- Refer to New Zealand law where it matters (e.g. the Contract and Commercial Law Act 2017 for electronic signing, the Privacy Act 2020 for personal information, the Employment Relations Act 2000 only when it truly is employment). Do not claim the document is legal advice.
- If the signer could be under 18 (a youth player, a junior), set guardianUnder18 true and include a "dob" form field.

SHAPE
- docTitle: the title printed at the top.
- partiesIntro: 2–4 short lines naming the parties.
- sections: start with a "The Deal at a Glance" section of bullets summarising the key terms (using the variables), then the numbered clauses. Keep the whole agreement readable on a phone: usually 6–14 sections.
- signAck: one sentence the signer agrees to when they sign.
- settings: counterSignerRole e.g. "The Club"; primarySignerRole e.g. "The Player"; detailsHeading e.g. "Player Details".
- reply: one or two plain sentences to the staff member about what you drafted and what they must check or fill in before publishing (e.g. "Set the weekly payment and the contract end date before sending. Have Ryan check clause 6.").

If you are given an existing template and asked to change it, return the WHOLE updated template.`;
}

export async function draftEsignTemplate(opts: {
  prompt: string;
  brandKey: string;
  brandLabel: string;
  legalEntity: string;
  existing?: EsignTemplateInput | null;
  userId: number;
  orgId: number;
}): Promise<{ template: EsignTemplateInput; problems: string[]; reply: string } | { error: string }> {
  const started = Date.now();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: (opts.existing ? `<current_template>\n${JSON.stringify(opts.existing)}\n</current_template>\n\n` : "") + `Request: ${opts.prompt}`,
  }];
  let result: { template: EsignTemplateInput; problems: string[]; reply: string } | null = null;
  let error: string | null = null;
  try {
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: "text", text: systemPrompt(opts.brandLabel, opts.legalEntity), cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      } as any);
      totals.input += res.usage.input_tokens ?? 0;
      totals.output += res.usage.output_tokens ?? 0;
      totals.cacheRead += (res.usage as any).cache_read_input_tokens ?? 0;
      totals.cacheWrite += (res.usage as any).cache_creation_input_tokens ?? 0;
      if (res.stop_reason === "refusal") { error = "Rambo declined that request."; break; }
      const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("");
      let out: any = null;
      try { out = JSON.parse(text); } catch { /* retry */ }
      if (!out) {
        messages.push({ role: "assistant", content: text || "(no answer)" }, { role: "user", content: "That was not valid JSON for the schema. Return the whole template again." });
        continue;
      }
      const { template, problems } = cleanTemplate({ ...out, settings: { ...out.settings, published: false } }, { brandKey: opts.brandKey });
      // A wrong placeholder is worth one retry; anything else is for the person.
      const fixable = problems.filter((p) => p.includes("{{"));
      if (fixable.length && attempt === 0) {
        messages.push({ role: "assistant", content: text }, { role: "user", content: `Fix these and return the whole template again:\n- ${fixable.join("\n- ")}` });
        continue;
      }
      result = { template, problems, reply: String(out.reply ?? "").slice(0, 600) };
    }
    if (!result && !error) error = "Rambo couldn't produce a usable draft. Try rewording the request.";
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.error("[esign-ai]", e?.status, msg.slice(0, 500));
    error = /credit|balance|billing/i.test(msg) ? "The club's Anthropic account is out of credit." : e?.status >= 500 || /overloaded/i.test(msg) ? "Rambo's service is busy. Try again shortly." : "Rambo hit an error drafting that.";
  }
  try {
    await db.execute(sql`INSERT INTO esign_ai_usage (user_id, organization_id, model, instruction, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_cents, duration_ms, ok, error)
      VALUES (${opts.userId}, ${opts.orgId}, ${MODEL}, ${opts.prompt.slice(0, 2000)}, ${totals.input}, ${totals.output}, ${totals.cacheRead}, ${totals.cacheWrite},
              ${ramboCostCents(MODEL, totals as any)}, ${Date.now() - started}, ${!!result}, ${error})`);
  } catch { /* usage logging never blocks the answer */ }
  return result ?? { error: error! };
}
