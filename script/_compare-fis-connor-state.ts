// Read-only: compare Connor's "Follow-up desk" dashboard state (the app_state
// JSON out of his dashboard.sqlite3) with the live ClubOS Football in Schools
// pipeline (fis_leads), matched by organisation name.
//
//   npx tsx --env-file=.env script/_compare-fis-connor-state.ts <state.json>
import pg from "pg";
import { readFileSync } from "fs";

const norm = (s: string) => s.toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const state = JSON.parse(readFileSync(process.argv[2], "utf8"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'fis_leads' ORDER BY ordinal_position`)).rows.map((r: any) => r.column_name);
  console.log("fis_leads columns:", cols.join(", "));
  const actCols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'fis_lead_activities' ORDER BY ordinal_position`)).rows.map((r: any) => r.column_name);
  console.log("fis_lead_activities columns:", actCols.join(", "));
  const acts = (await pool.query(`SELECT count(*)::int AS n, min(created_at) AS first, max(created_at) AS last FROM fis_lead_activities`)).rows;
  console.log("fis_lead_activities:", JSON.stringify(acts));
  const leads = (await pool.query(`SELECT * FROM fis_leads`)).rows;
  console.log("leads:", leads.length, "by stage:", JSON.stringify(leads.reduce((m: any, l: any) => ((m[l.status] = (m[l.status] || 0) + 1), m), {})));
  console.log("edited after seed (updated_at > created_at + 1 min):", leads.filter((l: any) => new Date(l.updated_at).getTime() > new Date(l.created_at).getTime() + 60000).length);
  console.log("with follow_up:", leads.filter((l: any) => l.next_follow_up_on).length, "with notes:", leads.filter((l: any) => (l.notes || "").trim()).length);
  const byName = new Map(leads.map((l: any) => [norm(l.name), l]));
  const STAGE_MAP: Record<string, string> = { "New": "new", "Contacted": "contacted", "In conversation": "talking", "Meeting booked": "meeting", "Free session": "trial", "Proposal": "proposal", "Booked": "booked", "Closed": "closed" };
  let matched = 0, unmatched: string[] = [], stageDiff: any[] = [], same = 0;
  for (const e of state.entities) {
    const l = byName.get(norm(e.name));
    if (!l) { unmatched.push(`${e.kind}: ${e.name}`); continue; }
    matched++;
    const want = STAGE_MAP[e.stage] ?? e.stage;
    const have = String(l.status).startsWith("closed") ? "closed" : l.status;
    if (want === have) same++; else stageDiff.push({ name: e.name, connor: e.stage, clubos: l.status });
  }
  console.log(`matched ${matched}/${state.entities.length}; same stage ${same}; stage differs ${stageDiff.length}; unmatched ${unmatched.length}`);
  console.log("unmatched:", unmatched);
  console.log("stage differs:", JSON.stringify(stageDiff, null, 0));
  const clubosOnly = leads.filter((l: any) => !state.entities.some((e: any) => norm(e.name) === norm(l.name))).map((l: any) => l.name);
  console.log("in ClubOS but not in Connor's desk:", clubosOnly);
  await pool.end();
})();
