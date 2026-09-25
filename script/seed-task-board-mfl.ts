/**
 * Seeds Daniel + Isaac's MFL Task Board from the Fireflies recordings of their
 * MFL meetings (3 Aug, 10 Aug, 4 Sep, 18 Sep 2026). Each task keeps the
 * recording and the action item Fireflies captured, so it can be traced.
 *
 * 🔴 No owner is set: Fireflies credits every action to the account that
 *    recorded it (Daniel), so "who said they'd do it" is not in the data.
 * 🔴 Only work we can PROVE is finished is marked done; anything whose outcome
 *    is unknown stays open for Daniel/Isaac to tick or delete.
 * Idempotent: a task is matched on (org, title); projects on (org, name).
 *
 *   npx tsx --env-file=.env script/seed-task-board-mfl.ts [--commit]
 */
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const FF = (id: string) => `https://app.fireflies.ai/view/${id}`;
const M = {
  aug3:  { label: "MFL meeting · Mon 3 Aug",  url: FF("01KZ2JHS6X690NEJ437WZVNZHN") },
  aug10: { label: "MFL meeting · Mon 10 Aug", url: FF("01KZMK7WJ9Z82QZK6BVS7GDET1") },
  sep4:  { label: "MFL meeting · Fri 4 Sep",  url: FF("01M1MZ3E9890NCJJCQC024JE16") },
  sep18: { label: "MFL meeting · Fri 18 Sep", url: FF("01M2S0N20NB1DQNR32GKXBA44G") },
};
const PROJECTS = [
  { key: "t4", name: "Term 4 launch", color: "gold" },
  { key: "ballers", name: "Ballers Youth League", color: "green" },
  { key: "mkt", name: "Marketing & content", color: "violet" },
  { key: "refs", name: "Referees", color: "blue" },
  { key: "merch", name: "Merch & kits", color: "rose" },
  { key: "ops", name: "Operations", color: "slate" },
] as const;
type P = (typeof PROJECTS)[number]["key"];
type T = { title: string; p: P; m: keyof typeof M; quote: string; status?: string; priority?: string; due?: string; notes?: string };

const TASKS: T[] = [
  // ── Fri 18 Sep — the current term ──
  { p: "t4", m: "sep18", priority: "high", due: "2026-09-27", title: "Call, text or visit every team signed up or mid-signup before early bird ends",
    quote: "Personally follow up with all teams signed up or in process during the critical last week of early bird registration via calls, texts, and in-person visits (36:43)" },
  { p: "t4", m: "sep18", priority: "high", due: "2026-09-27", title: "Send Player Pay registrants a reminder to finish paying before the early bird deadline",
    quote: "Send out reminder emails to player pay registrants to complete their payments before the early bird deadline (13:30)" },
  { p: "mkt", m: "sep18", priority: "high", due: "2026-09-27", title: "Last-chance early bird ad push to fill every night",
    quote: "Advance marketing plans focusing on last chance early bird push to hit full capacity before term starts (54:54)" },
  { p: "t4", m: "sep18", due: "2026-10-12", title: "Season start logistics — Term 4 kicks off Mon 12 Oct",
    quote: "Oversee logistics and scheduling for upcoming league season start and holiday camps (56:13)" },
  { p: "t4", m: "sep18", title: "Decide on graded divisions with promotion and relegation",
    quote: "Graded divisions with promotion/relegation proposed; quarterfinal playoffs keep teams engaged; expansion could hit 100 teams, $50k revenue/term.",
    notes: "From the meeting summary, not a captured action item." },
  { p: "t4", m: "sep18", status: "done", title: "Captain dashboard — squad, fee position, fixtures, fill-ins",
    quote: "Implement a dashboard over the weekend to manage player payments, squad management, logo uploads, and kit orders for CIC 7s and mini football leagues (23:49)",
    notes: "Live 20 Sep at join.minifootball.co.nz/captain. Logo uploads and kit orders are NOT in it yet — see the Merch task." },
  { p: "merch", m: "sep18", title: "Add team logo uploads and kit orders to the captain dashboard",
    quote: "Implement a dashboard over the weekend to manage player payments, squad management, logo uploads, and kit orders for CIC 7s and mini football leagues (23:49)" },
  { p: "merch", m: "sep18", title: "Promote the custom kit store + push hoodies and tees before Term 4",
    quote: "Promote the kit customization store and launch a marketing push for merchandise including hoodies and T-shirts in time for term four registration (46:49)" },
  { p: "merch", m: "sep18", title: "Merch upsell in the Player Pay checkout + on-demand printing",
    quote: "Coordinate merchandising strategy including integrations for upsells during player pay checkout and on-demand printing processes (48:27)" },
  { p: "mkt", m: "sep18", due: "2026-09-21", title: "Capture finals-day content — drone, coach and captain interviews, prize giving",
    quote: "Capture testimonial and promotional content during the finals day on Monday, including drone shots, coach and captain interviews, and prize-giving footage (01:37)",
    notes: "Finals day was Mon 21 Sep — tick this off if it was filmed." },
  { p: "mkt", m: "sep18", title: "Run ads on the new testimonial footage through the holidays",
    quote: "Push marketing ads using new testimonial footage and fresh video content throughout the holiday period (27:13)" },
  { p: "mkt", m: "sep18", title: "Get the new ad video from Max into the campaigns",
    quote: "Receive and integrate fresh advertising video content from Max for upcoming campaigns (01:04:52)" },
  { p: "refs", m: "sep18", title: "Referee recruitment promo video",
    quote: "Coordinate referee recruitment promo video and explore improved refereeing course partnerships with Football Institute and potential paid referee coordinator role (28:33)" },
  { p: "refs", m: "sep18", title: "Refereeing course with Football Institute (target ~20 new refs a year)",
    quote: "Training with Football Institute could add 20 refs yearly; pay competitive, $50-$100/night." },
  { p: "refs", m: "sep18", title: "Decide on a paid referee coordinator role",
    quote: "…potential paid referee coordinator role (28:33)" },
  { p: "refs", m: "sep18", title: "Line up interns — coaching/ops support, and who suits a referee internship",
    quote: "Organize internship candidates for coaching and operational support roles; evaluate suitability for mini football referee internships (43:34)" },
  { p: "ops", m: "sep18", title: "Plan the prize giving — branded shirts, sports bar or on-site",
    quote: "Develop prize-giving plans involving branded shirts and event hosting logistics at a sports bar or on-site venue to build community and celebration culture (25:20)" },

  // ── Fri 4 Sep — Ballers launch ──
  { p: "ballers", m: "sep4", status: "done", title: "Publish the Ballers promo video",
    quote: "Complete and publish the youth league promotional video by today or tomorrow (05:32)", notes: "Ballers ads live 8 Sep." },
  { p: "ballers", m: "sep4", status: "done", title: "Relaunch the Ballers sign-up page with the video",
    quote: "Adjust and relaunch the landing page for individual youth football sign-ups aligned with the video release (07:22)", notes: "minifootball.co.nz/ballers is live." },
  { p: "ballers", m: "sep4", title: "Message captains from past and current terms about Ballers",
    quote: "Message captains from previous and current terms for ethnic tournament and youth league engagement (13:27)" },
  { p: "ballers", m: "sep4", title: "Share Ballers posts through the WhatsApp groups",
    quote: "Coordinate posting marketing materials and promote the youth leagues via WhatsApp groups and other channels (09:38)", notes: "Fireflies put this against Travis." },
  { p: "ops", m: "sep4", status: "done", title: "Redesign the fill-in player marketplace",
    quote: "Continue redesigning the fill-in player marketplace for better usability (22:02)", notes: "MFL fill-ins live 20 Sep (captain dashboard + minifootball.co.nz/players)." },
  { p: "ops", m: "sep4", due: "2026-09-21", title: "Trophies + food truck swap for finals night",
    quote: "Organize trophies and negotiate food truck exchange for mini football finals night (15:25)", notes: "Finals were Mon 21 Sep — tick off if sorted." },
  { p: "ops", m: "sep4", title: "Buy ~40 balls for Term 4 (~$1,000) — grant, or credit if the grant is late",
    quote: "Coordinate football ball purchase using perennial credit if grant funding is delayed or unavailable (27:18) · Track football stock and plan procurement for term four needs (27:18)",
    notes: "Stock at the time: 100 size 3 + 100 size 4." },
  { p: "mkt", m: "sep4", title: "Filming kit for windy nights — water bags and trolleys",
    quote: "Manage logistics for filming in windy conditions, including deployment of water bags and transportation trolleys (25:38)" },

  // ── Mon 10 Aug ──
  { p: "ops", m: "aug10", title: "Forward MFL invoices every Monday (or fortnightly), cc Ryan + Travis",
    quote: "Continue forwarding mini football invoices every Monday or bi-weekly and keep Ryan and Travis informed with CC (41:19)" },
  { p: "ops", m: "aug10", title: "Game-coverage staff rostered and paid the agreed rate on time",
    quote: "Manage staffing and scheduling for mini football game coverage, ensuring compensation aligns with agreed rates and all involved are paid promptly (44:50)" },
  { p: "mkt", m: "aug10", title: "Sort Goal of the Week video production (Adobe if needed)",
    quote: "Resolve and finalize \"goal of the week\" video production issues, including purchasing Adobe software if needed to ensure completion (25:22)" },
  { p: "mkt", m: "aug10", title: "Weekly content plan with Max",
    quote: "Follow up with Max to improve proactivity and creativity in content production, encouraging more structured weekly planning (39:14)" },

  // ── Mon 3 Aug — Ballers origin ──
  { p: "ballers", m: "aug3", title: "Lock the Ballers prize sponsor and write up the rules",
    quote: "Work on finalizing league rules, structure, prize distribution, and time slots, and document them (42:36) · coordinate prize sponsorship with local businesses (30:10)",
    notes: "Night 'n Day voucher deal still unsigned — the page says \"spot prize\"." },
  { p: "mkt", m: "aug3", title: "Automated fixtures and results posts on social",
    quote: "Schedule automated posts for fixtures and results on social media platforms (51:48)" },
];

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows: [org] } = await c.query(`SELECT id FROM organizations WHERE slug = 'mini-football-leagues'`);
  await c.query("BEGIN");
  const pid: Record<string, number> = {};
  let pos = 0;
  for (const p of PROJECTS) {
    pos++;
    const { rows: [ex] } = await c.query(`SELECT id FROM tb_projects WHERE organization_id=$1 AND name=$2 AND archived_at IS NULL`, [org.id, p.name]);
    pid[p.key] = ex?.id ?? (await c.query(`INSERT INTO tb_projects (organization_id, name, color, position, created_by) VALUES ($1,$2,$3,$4,1) RETURNING id`, [org.id, p.name, p.color, pos])).rows[0].id;
  }
  let added = 0, kept = 0, i = 0;
  for (const t of TASKS) {
    i++;
    const { rows: [ex] } = await c.query(`SELECT id FROM tb_tasks WHERE organization_id=$1 AND title=$2`, [org.id, t.title]);
    if (ex) { kept++; continue; }
    const done = t.status === "done";
    await c.query(`INSERT INTO tb_tasks (organization_id, project_id, title, notes, status, priority, due_on, position,
        source_label, source_url, source_quote, created_by, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12)`,
      [org.id, pid[t.p], t.title, t.notes ?? null, t.status ?? "todo", t.priority ?? "normal", t.due ?? null, i,
        M[t.m].label, M[t.m].url, t.quote, done ? new Date() : null]);
    added++;
  }
  const { rows: [n] } = await c.query(`SELECT count(*) FILTER (WHERE status<>'done') open, count(*) FILTER (WHERE status='done') done FROM tb_tasks WHERE organization_id=$1 AND archived_at IS NULL`, [org.id]);
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(`${added} added, ${kept} already there · board now ${n.open} open / ${n.done} done ${COMMIT ? "(COMMITTED)" : "(dry run — rolled back)"}`);
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
