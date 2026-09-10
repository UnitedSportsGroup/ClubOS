// Pull the Xero contacts list — and every invoice against it — through the API.
//
// Daniel, 2026-09-10: "the real source of truth especially this year and also
// all previous years is Xero contacts list."
//
// 🔴 WHY THE API AND NOT THE CSV EXPORT. Xero's own Contacts → Export gives 75
// columns and NOT ONE OF THEM IS AN ID. Three things follow:
//
//   · No stable join key. Every re-run has to re-match on email, and a family
//     that corrects their address in Xero can never be recognised as the same
//     record we matched last time.
//   · Nothing to hang the PAYMENT HISTORY on. Olga's point is that Xero is the
//     payment record; an invoice names a ContactID, not an email.
//   · The export is not provably complete — "Alex Meaclem" sits in Xero's
//     Archived tab and is absent from the export. `includeArchived` is explicit.
//
// 🔴 IT WRITES NOTHING. This only fetches and saves. `apply-xero-contacts.ts`
// decides what changes, dry-run by default.
//
// 🔴 IT IS POLITE ABOUT THE QUOTA, because that is what blocked it in the first
// place: 5,000 calls/tenant/day and 60/minute. It paginates, sleeps between
// pages, and STOPS CLEANLY on a 429 with whatever it has, telling you how far
// it got and when the limit resets, rather than hammering a closed door.
//
//   npx tsx --env-file=.env script/xero-pull.ts contacts   --out out.json
//   npx tsx --env-file=.env script/xero-pull.ts invoices   --out out.json
import { writeFileSync } from "node:fs";
import { getXeroForOrg } from "../server/xero";

const WHAT = process.argv[2];
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
if (!["contacts", "invoices"].includes(WHAT ?? "") || !OUT) {
  console.error("usage: xero-pull.ts <contacts|invoices> --out <file.json>"); process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Xero's own words when it says stop, in a form a human can act on.
 *
 *  🔴 The SDK nests the real response differently depending on where the throw
 *  came from, so every plausible shape is checked rather than one. Getting this
 *  wrong is not cosmetic: the generic branch below prints the error, and a
 *  xero-node error object carries the full BEARER TOKEN in `request.headers`.
 *  That is how a live credential ends up in a log. Nothing here ever prints a
 *  raw error. */
function unwrap(e: any): any {
  // 🔴 xero-node 15 rejects with a JSON STRING, not an Error. `e.response` is
  // undefined, `e.message` is undefined, and the generic branch then prints the
  // whole thing — which is how a live bearer token reached a log the first time
  // this ran. Parse it before asking it anything.
  if (typeof e === "string") { try { return JSON.parse(e); } catch { return { message: e.slice(0, 200) }; } }
  return e;
}

function rateLimited(raw: any): { limited: boolean; retryAfter: number; which: string } {
  const e = unwrap(raw);
  const res = e?.response ?? e?.body?.response ?? e;
  const code = Number(res?.statusCode ?? res?.status ?? e?.statusCode ?? e?.status);
  const h = res?.headers ?? e?.headers ?? {};
  return { limited: code === 429, retryAfter: Number(h["retry-after"] ?? 0), which: String(h["x-rate-limit-problem"] ?? "?") };
}

/** Everything safe to say about a failure. Never the error itself. */
function safeError(raw: any): string {
  const e = unwrap(raw);
  const res = e?.response ?? e;
  const code = res?.statusCode ?? res?.status ?? "?";
  const msg = typeof e?.message === "string" ? e.message : "";
  return `HTTP ${code}${msg ? ` — ${msg.slice(0, 200)}` : ""}`;
}

async function main() {
  const { xero, tenantId } = await getXeroForOrg(1);
  const all: any[] = [];
  let page = 1, stoppedEarly: string | null = null;

  for (;;) {
    try {
      const res = WHAT === "contacts"
        // (tenantId, ifModifiedSince, where, order, ids, page, includeArchived)
        ? await xero.accountingApi.getContacts(tenantId, undefined, undefined, undefined, undefined, page, true)
        : await xero.accountingApi.getInvoices(tenantId, undefined, undefined, undefined, undefined, undefined, undefined, undefined, page);
      const batch: any[] = (WHAT === "contacts" ? res.body.contacts : res.body.invoices) ?? [];
      all.push(...batch);
      process.stdout.write(`\r  page ${page} — ${all.length} ${WHAT}   `);
      if (batch.length < 100) break;         // Xero pages at 100
      page++;
      await sleep(1100);                     // stay well inside 60/minute
    } catch (e: any) {
      const rl = rateLimited(e);
      if (!rl.limited) throw e;
      const mins = Math.round(rl.retryAfter / 60);
      stoppedEarly = `rate limit hit on page ${page} (${rl.which}); resets in ~${mins} min`;
      console.log(`\n\n  🔴 ${stoppedEarly}`);
      console.log(`     Keeping the ${all.length} already fetched.`);
      break;
    }
  }

  console.log(`\n\n${all.length} ${WHAT}${stoppedEarly ? " (INCOMPLETE)" : ""}`);
  if (WHAT === "contacts") {
    const archived = all.filter((c) => String(c.contactStatus) === "ARCHIVED").length;
    console.log(`  archived included: ${archived}`);
    console.log(`  with a ContactID : ${all.filter((c) => c.contactID).length}   ← the join key the CSV has not got`);
  } else {
    const paid = all.filter((i) => String(i.status) === "PAID").length;
    console.log(`  PAID: ${paid}   AUTHORISED: ${all.filter((i) => String(i.status) === "AUTHORISED").length}`);
    const refs = all.map((i) => String(i.reference ?? "")).filter(Boolean);
    console.log(`  with a reference: ${refs.length}  e.g. ${refs.slice(0, 3).map((r) => JSON.stringify(r)).join(", ")}`);
  }
  writeFileSync(OUT!, JSON.stringify({ what: WHAT, pulledAt: new Date().toISOString(), complete: !stoppedEarly, note: stoppedEarly, rows: all }, null, 1));
  console.log(`\nwrote ${OUT}`);
  if (stoppedEarly) process.exit(3);
}

main().catch((e) => {
  const rl = rateLimited(e);
  if (rl.limited) {
    console.error(`\n🔴 Xero says stop before we even started: ${rl.which} limit, resets in ~${Math.round(rl.retryAfter / 60)} min.`);
    process.exit(3);
  }
  console.error("\n✗", safeError(e));   // never the raw error — it carries the bearer token
  process.exit(1);
});
