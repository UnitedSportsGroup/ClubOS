// Proves splitSubmission() changes no word: every submission's sections, with their
// labels put back, rebuild the original email exactly (whitespace aside).
import { BREWERY_SUBMISSIONS } from "../server/brewery-submissions";
import { splitSubmission, SUBMISSION_FIELDS } from "../shared/brewery-offers";
let fail = 0;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
for (const [key, sub] of Object.entries(BREWERY_SUBMISSIONS)) {
  const r = splitSubmission(sub.text);
  if (!r) { console.log(`${key}: not a form email — shown raw`); continue; }
  const label = (t: string) => SUBMISSION_FIELDS.find(f => f.title === t)!.label;
  const rebuilt = [r.preamble, ...r.sections.map(s => label(s.title) + s.text)].join(" ");
  const ok = squash(rebuilt) === squash(sub.text);
  if (!ok) fail++;
  console.log(`${key}: ${ok ? "OK" : "MISMATCH"} — ${r.sections.map(s => `${s.title}(${s.text.length})`).join(", ")}`);
}
if (BREWERY_SUBMISSIONS.db && splitSubmission(BREWERY_SUBMISSIONS.db.text) !== null) { console.log("db: should be raw"); fail++; }
process.exit(fail ? 1 : 0);
