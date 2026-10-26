/**
 * Rambo's chats — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-rambo-chat.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-rambo-chat.ts --commit   # for real
 *
 * Proven: idempotent; a chat can be started in a workspace, carry a priced
 * answer, and be counted for today across BOTH doors (Mailer + chat, NZ day);
 * negative tokens or a negative cost are refused; deleting the chat removes
 * its messages (cascade); the person's deletion removes their chats (cascade —
 * a chat is theirs, not a club record); RLS on both tables.
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
async function mustReject(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was ACCEPTED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(label); }
}
async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { const r = await c.query(sql, params); await c.query("RELEASE SAVEPOINT s"); ok(label); return r.rows[0]; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — REFUSED: ${e.message}`); return null; }
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-26_rambo_chat.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Rambo chats — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql);
    ok("migration ran");
    await c.query(sql);
    ok("migration is idempotent (ran twice)");
    for (const col of ["workspace_slug"]) {
      const r = (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='kb_chat_sessions' AND column_name=$1`, [col])).rows;
      r.length ? ok(`kb_chat_sessions.${col} exists`) : bad(`kb_chat_sessions.${col} missing`);
    }
    for (const col of ["model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd_cents", "duration_ms"]) {
      const r = (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='kb_chat_messages' AND column_name=$1`, [col])).rows;
      r.length ? ok(`kb_chat_messages.${col} exists`) : bad(`kb_chat_messages.${col} missing`);
    }

    const org = (await c.query(`SELECT id FROM organizations WHERE slug='christchurch-united'`)).rows[0];
    await c.query("SAVEPOINT fixtures");
    const u = await mustAccept(c, "a throwaway user", `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ('_rambo_chat_probe@usg.co.nz','Probe','Chat','x','team_member',true) RETURNING id`);
    const s = await mustAccept(c, "a chat can be started in a workspace", `INSERT INTO kb_chat_sessions (user_id, brand, title, workspace_slug) VALUES ($1,'all',NULL,'christchurch-united') RETURNING id`, [u.id]);
    await mustAccept(c, "the question is a row", `INSERT INTO kb_chat_messages (session_id, role, content) VALUES ($1,'user','How many U4–U8 players do we have?')`, [s.id]);
    await mustAccept(c, "the priced answer is a row", `INSERT INTO kb_chat_messages (session_id, role, content, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_cents, duration_ms) VALUES ($1,'assistant','You have 146.','claude-sonnet-5-5',6000,300,8000,0,1.7,4100)`, [s.id]);
    await mustAccept(c, "a Mailer prompt from the same person today", `INSERT INTO mailer_ai_usage (user_id, user_label, organization_id, brand, model, instruction, input_tokens, output_tokens, cost_usd_cents, duration_ms, ok, changed) VALUES ($1,'Probe Chat',$2,'cufc','claude-sonnet-5-5','make it modern',9000,1200,0.03,4200,true,true)`, [u.id, org.id]);
    const n = await mustAccept(c, "today's prompts are counted across BOTH doors (NZ day)", `
      SELECT (SELECT count(*)::int FROM mailer_ai_usage WHERE user_id=$1 AND (created_at AT TIME ZONE 'Pacific/Auckland')::date = (now() AT TIME ZONE 'Pacific/Auckland')::date)
           + (SELECT count(*)::int FROM kb_chat_messages m JOIN kb_chat_sessions s ON s.id=m.session_id WHERE s.user_id=$1 AND m.role='user' AND ((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Auckland')::date = (now() AT TIME ZONE 'Pacific/Auckland')::date) AS n`, [u.id]);
    n?.n === 2 ? ok("…and the count is 2 (one chat question + one Mailer prompt)") : bad(`count was ${n?.n}`);
    await mustReject(c, "negative tokens are refused", `INSERT INTO kb_chat_messages (session_id, role, content, input_tokens) VALUES ($1,'assistant','x',-1)`, [s.id]);
    await mustReject(c, "a negative cost is refused", `INSERT INTO kb_chat_messages (session_id, role, content, cost_usd_cents) VALUES ($1,'assistant','x',-0.01)`, [s.id]);
    await mustAccept(c, "deleting the chat removes its messages", `DELETE FROM kb_chat_sessions WHERE id=$1`, [s.id]);
    const left = (await c.query(`SELECT count(*)::int AS n FROM kb_chat_messages WHERE session_id=$1`, [s.id])).rows[0];
    left.n === 0 ? ok("…none left behind") : bad(`${left.n} messages left`);
    const s2 = await mustAccept(c, "a second chat", `INSERT INTO kb_chat_sessions (user_id, brand) VALUES ($1,'all') RETURNING id`, [u.id]);
    await mustAccept(c, "deleting the person removes their chats (a chat is theirs, not a club record)", `DELETE FROM users WHERE id=$1`, [u.id]);
    const gone = (await c.query(`SELECT count(*)::int AS n FROM kb_chat_sessions WHERE id=$1`, [s2.id])).rows[0];
    gone.n === 0 ? ok("…the chat went with them") : bad("chat survived its owner");
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    ok("probe rows discarded");

    for (const tbl of ["kb_chat_sessions", "kb_chat_messages"]) {
      const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relkind = 'r'`, [tbl])).rows;
      rls.length === 1 && rls[0].relrowsecurity ? ok(`RLS on ${tbl}`) : bad(`RLS ${tbl}: ${JSON.stringify(rls)}`);
    }

    if (problems.length) throw new Error("checks failed");
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${checks} checks, ${problems.length} problems — ${COMMIT ? "COMMITTED" : "rolled back"}\n`);
  } catch (err: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`\n  FAILED: ${err.message}\n  ${problems.join("\n  ")}\n`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
