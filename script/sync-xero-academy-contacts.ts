// Fill every "(A U…)" academy contact in Xero from ClubOS — phone, address, other parent.
// Blanks only; never overwrites. Dry run by default.
//   npx tsx --env-file=.env script/sync-xero-academy-contacts.ts [--commit] [--limit N]
import { syncAcademyContacts } from "../server/xero-contact-profile";
const commit = process.argv.includes("--commit");
const li = process.argv.indexOf("--limit");
const rows = await syncAcademyContacts(1, { commit, limit: li > 0 ? Number(process.argv[li + 1]) : undefined });
const by = (o: string) => rows.filter((r) => r.outcome === o);
console.log(`${commit ? "COMMIT" : "DRY RUN"} — ${rows.length} academy contacts in Xero`);
console.log(`  ${commit ? "filled" : "would fill"}: ${by("filled").length} · already complete: ${by("complete").length} · not matched: ${by("unmatched").length} · errors: ${by("error").length}`);
for (const r of by("filled")) console.log(`  + ${r.name}: ${r.detail}`);
for (const r of by("unmatched")) console.log(`  ? ${r.name}: ${r.detail}`);
for (const r of by("error")) console.log(`  ✗ ${r.name}: ${r.detail}`);
process.exit(by("error").length ? 1 : 0);
