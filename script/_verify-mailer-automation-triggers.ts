/**
 * READ-ONLY: who would each trigger pick up for U4–U8 over the last 30 days?
 *   npx tsx --env-file=.env script/_verify-mailer-automation-triggers.ts
 * Writes nothing. Proves the SQL runs on real data and the numbers are plausible.
 */
process.env.MAILER_AUTOMATIONS = "0";
const { _candidatesForVerify } = await import("../server/mailer-automations");
const { pool } = await import("../server/db");
const org = (await pool.query(`SELECT id, slug FROM organizations WHERE slug='christchurch-united'`)).rows[0];
const u48 = (await pool.query(`SELECT id, name FROM programs WHERE slug='u4-u8' AND organization_id=$1`, [org.id])).rows[0];
console.log(`\n  ${u48.name} (programme ${u48.id})\n`);
const since = new Date(Date.now() - 30 * 86400_000);
for (const t of ["registration_paid", "registration_started", "first_registration", "birthday", "programme_start", "programme_end"]) {
  const a = { organization_id: org.id, program_ids: [u48.id], trigger_type: t };
  const c = await _candidatesForVerify(a, org.slug, since, true);
  const s = c[0];
  console.log(`  ${t.padEnd(22)} ${String(c.length).padStart(4)}  ${s ? `e.g. ${s.email.replace(/(.).+@/, "$1•••@")} · players ${JSON.stringify(s.context.players)} · start ${s.context.programmeStart} · ${s.context.programmeLink}` : ""}`);
}
// Sanity: the unfinished list must never contain a family who has paid for U4–U8.
const started = await _candidatesForVerify({ organization_id: org.id, program_ids: [u48.id], trigger_type: "registration_started" }, org.slug, since, true);
const paidEmails = new Set((await pool.query(`
  SELECT lower(btrim(COALESCE(NULLIF(btrim(g.email),''), c.email))) e FROM registrations r
  LEFT JOIN contacts c ON c.id=r.contact_id LEFT JOIN contacts g ON g.id=r.guardian_id
  WHERE r.program_id=$1 AND r.status IN ('confirmed','refunded','partially_refunded')`, [u48.id])).rows.map((r) => r.e));
const leak = started.filter((c) => paidEmails.has(c.email));
console.log(`\n  unfinished list contains a family who already paid: ${leak.length === 0 ? "no ✓" : `YES ✗ ${leak.length}`}`);
await pool.end();
process.exit(leak.length ? 1 : 0);
