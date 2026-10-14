// Rewards for holiday-camp video testimonials (cufc.co.nz/camp-stories).
//
// The loop: a parent uploads → USG Proof holds it as `pending` → a person watches it and
// APPROVES it in usg-proof.vercel.app/admin (space "Christchurch United Holiday Camps") →
// this script gives every approved family a personal single-use 20% code for the summer
// camps and saves the thank-you email as a DRAFT in daniel@cufc.co.nz for a human to send.
//
// One code per email address, ever: the code's title carries the address, and an address
// that already has one is skipped. Nothing is sent by this script.
//
//   node --env-file=.env script/camp-story-codes.mjs            # list what it would do
//   node --env-file=.env script/camp-story-codes.mjs --commit   # create codes + drafts
import pg from "pg";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const COMMIT = process.argv.includes("--commit");
// The workspace root holds .env + scripts/email — walk up until we find it (works from a worktree too).
let ROOT = process.cwd();
while (!fs.existsSync(path.join(ROOT, "scripts/email/send_email.py")) && ROOT !== "/") ROOT = path.dirname(ROOT);
const rootEnv = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const MEET = rootEnv.SUPABASE_MEET_URL;
const KEY = rootEnv.SUPABASE_MEET_SERVICE_ROLE_KEY;
const SUMMER_CAMPS = [65, 66];
const ENDS = "2027-01-22T10:59:00.000Z"; // last camp day, 23:59 NZDT
const TITLE_PREFIX = "Camp story reward — ";

const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const space = (await (await fetch(`${MEET}/rest/v1/testi_spaces?slug=eq.cufc-camps&select=id`, { headers: h })).json())[0];
const items = await (await fetch(
  `${MEET}/rest/v1/testi_items?space_id=eq.${space.id}&status=eq.approved&select=id,author_name,author_email,author_title,created_at&order=created_at`,
  { headers: h },
)).json();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const issued = new Set((await c.query(
  `select lower(substring(title from $1)) e from discounts where organization_id=1 and title like $2`,
  [`${TITLE_PREFIX.length + 1}`, `${TITLE_PREFIX}%`],
)).rows.map((r) => r.e));

let n = 0;
for (const it of items) {
  const email = (it.author_email || "").toLowerCase();
  if (!email || issued.has(email)) continue;
  issued.add(email);
  n++;
  const code = `CAMPSTORY-${randomBytes(3).toString("hex").toUpperCase()}`;
  const first = (it.author_name || "").split(" ")[0] || "there";
  console.log(`${COMMIT ? "ISSUE" : "would issue"} ${code} → ${it.author_name} <${email}> (${it.author_title || ""})`);
  if (!COMMIT) continue;
  await c.query(
    `insert into discounts (organization_id, title, code, type, method, value_type, value, applies_to, camp_ids, eligibility, min_purchase_type, max_total_uses, one_per_customer, start_date, end_date, status, times_used, total_discounted_cents)
     values (1,$1,$2,'amount_off_order','code','percentage','20.00','specific_camps',$3,'all','none',1,true,now(),$4,'active',0,0)`,
    [`${TITLE_PREFIX}${email}`, code, SUMMER_CAMPS, ENDS],
  );
  const body = `Hi ${first},

Thank you so much for the video. It's exactly what other parents need to see.

Here's your personal code for 20% off a summer camp booking:

${code}

Type it in the discount box at checkout. It works once, on any of our summer camp days: 21–23 December and 4–22 January.

Book here:
FUNdamentals (U4–U8): https://join.cufc.co.nz/fundamentals
World Cup camp (U9–U13): https://join.cufc.co.nz/worldcup

If you've already booked, reply to this email and we'll refund the difference.

See you in the holidays!`;
  execFileSync("python3", [
    path.join(ROOT, "scripts/email/send_email.py"), "--from", "cufc", "--to", email,
    "--subject", "Your 20% summer camp code", "--body", body, "--draft",
  ], { stdio: "inherit" });
}
console.log(n ? `${n} famil${n === 1 ? "y" : "ies"} ${COMMIT ? "rewarded (drafts in daniel@cufc.co.nz)" : "to reward — re-run with --commit"}` : "Nobody new to reward.");
await c.end();
