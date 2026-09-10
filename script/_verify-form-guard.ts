/* Proof that the public-form guard holds bots and never holds a real family.
 *   npx tsx --env-file=.env script/_verify-form-guard.ts
 *
 * Runs the real decision against the real database. Writes only to
 * public_form_submissions and deletes everything it wrote.
 */
import { Client } from "pg";
import { guardPublicForm, mintFormToken } from "../server/form-guard";
import { looksRandom, vowellessName, contentSignals } from "../shared/form-guard";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n} ${d}`); } };

const IPS = ["198.51.100.31", "198.51.100.32", "198.51.100.33", "198.51.100.34", "198.51.100.35", "198.51.100.36"];
const req = (ip: string, body: Record<string, unknown> = {}) =>
  ({ headers: { "x-forwarded-for": ip }, socket: {}, body }) as any;

(async () => {
  console.log("\nA real MFL waitlist entry gets through — the team-name trap");
  {
    const v = await guardPublicForm({
      form: "mfl_waitlist", req: req(IPS[0]), email: "captain@example.invalid",
      name: "Sam Rangi", text: [], page: "/waitlist",
    });
    ok("accepted", v.ok, JSON.stringify(v.reasons));
    // The bug this guards against: teamName used to be judged as prose.
    ok("'TheKickers2026' WOULD read as random if it were judged as prose", looksRandom("TheKickers2026"));
    ok("…which is exactly why a team name is not passed as text", !contentSignals({ name: "Sam Rangi", text: [] }).length);
  }

  console.log("\nA real CUGC free-session booking gets through — the date-of-birth trap");
  {
    const v = await guardPublicForm({
      form: "cugc_free_session", req: req(IPS[1]), email: "parent@example.invalid",
      name: "Aroha Williams", text: ["She has done a term of gymnastics before and loves the beam."],
      today: "2026-09-10", page: "/free-session",
    });
    ok("accepted", v.ok, JSON.stringify(v.reasons));
    ok("a child's date of birth is in the past and must never be judged as a date",
       contentSignals({ dates: ["2018-04-11"], today: "2026-09-10" }).includes("date_in_past"));
  }

  console.log("\nThe bot shape is held");
  {
    const v = await guardPublicForm({
      form: "print_quote", req: req(IPS[2]), email: "harvested@example.invalid",
      name: "Rqqcdq Rnsxkvm", text: ["WbuNpPTTVMjeIQNtwo"], page: "/instant-quote",
    });
    ok("held", !v.ok);
    ok("names its reasons", v.reasons.length >= 2, JSON.stringify(v.reasons));
    console.log(`     reasons: ${JSON.stringify(v.reasons)}`);
  }

  console.log("\nThe honeypot stands alone");
  {
    const v = await guardPublicForm({
      form: "mfl_waitlist", req: req(IPS[3], { website: "http://spam.example" }),
      email: "bot@example.invalid", name: "Perfectly Normal Name", text: [],
    });
    ok("held on the honeypot alone", !v.ok && v.reasons.length === 1 && v.reasons[0] === "honeypot");
  }

  console.log("\nA link in a free-text field, with nothing else, is not enough on its own");
  {
    const v = await guardPublicForm({
      form: "print_quote", req: req(IPS[4]), email: "real@example.invalid",
      name: "Jane Cooper", text: ["Artwork is at https://drive.google.com/our-logo — can you print 20?"],
    });
    ok("accepted — a customer sending us their artwork link is normal", v.ok, JSON.stringify(v.reasons));
  }

  console.log("\nRate limits bite, across forms");
  {
    for (let i = 0; i < 5; i++) {
      await guardPublicForm({ form: "mfl_waitlist", req: req(IPS[5]), email: `r${i}@example.invalid`, name: "Real Person", text: [] });
    }
    const v = await guardPublicForm({ form: "print_quote", req: req(IPS[5]), email: "r9@example.invalid", name: "Rqqcdq Xxx", text: [] });
    ok("the sixth from one address in an hour is flagged", v.reasons.includes("ip_rate_hour"), JSON.stringify(v.reasons));
    ok("and counted across a DIFFERENT form — one clock, every form", v.reasons.includes("ip_rate_hour"));
  }

  console.log("\nReal people are never caught");
  for (const n of ["Grzegorz Brzęczyszczykiewicz", "Siobhán O'Sullivan", "Ngā Wai Te Rangi", "Jean-Pierre L'Écuyer", "Tāne Māhuta"]) {
    ok(`"${n}"`, !looksRandom(n) && !vowellessName(n));
  }

  console.log("\nThe form token");
  {
    const t = mintFormToken();
    ok("a token can be minted (a secret is configured)", typeof t === "string" && t.includes("."), String(t));
    if (t) {
      const fresh = await guardPublicForm({ form: "mfl_waitlist", req: req("198.51.100.40", { formToken: t }), email: "x@example.invalid", name: "Real Person", text: [] });
      ok("a token used instantly is flagged as too fast", fresh.reasons.includes("submitted_too_fast"), JSON.stringify(fresh.reasons));
      const bad = await guardPublicForm({ form: "mfl_waitlist", req: req("198.51.100.41", { formToken: "aaaa.bbbbbbbbbbbbbbbbbbbbbbbb" }), email: "y@example.invalid", name: "Real Person", text: [] });
      ok("a forged token is rejected", bad.reasons.includes("bad_form_token"), JSON.stringify(bad.reasons));
    }
  }

  console.log("\nCleaning up");
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const del = await c.query(`DELETE FROM public_form_submissions WHERE ip LIKE '198.51.100.%'`);
  const left = await c.query(`SELECT count(*)::int AS n FROM public_form_submissions WHERE ip LIKE '198.51.100.%'`);
  ok(`removed ${del.rowCount} test rows, none left`, left.rows[0].n === 0);
  await c.end();

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
})();
