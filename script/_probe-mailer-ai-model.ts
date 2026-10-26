// One REAL call to the model through the assistant's own code path, before a
// deploy: proves the request shape the SDK sends (structured output, effort,
// cached system prompt) is accepted, that an edit lands, and what it cost.
//
//   ANTHROPIC_API_KEY=… npx tsx --env-file=.env script/_probe-mailer-ai-model.ts
//   (the key is in the ROOT .env; the worktree's has none — pass it in.)
//
// Costs a few cents. Writes nothing.
import { clubNewsletterTemplate } from "../client/src/components/marketing/grapes/templates/club-newsletter";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const { mailerAiRunForProbe } = await import("../server/mailer-ai");
  const mjml = clubNewsletterTemplate.build("siu");
  const started = Date.now();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const out = await mailerAiRunForProbe({
    brandKey: "siu",
    mjml,
    instruction: "Change the big headline so it says Hello from the probe. Nothing else.",
    history: [],
    totals,
  });
  console.log(JSON.stringify({ ms: Date.now() - started, totals, reply: out.reply, error: out.error, changed: out.changed, landed: !!out.mjml && /Hello from the probe/.test(out.mjml), length: out.mjml?.length ?? null }, null, 1));
  process.exit(out.error ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
