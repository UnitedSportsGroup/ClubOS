// Give somebody refund rights over SOME programmes, not all.
//
//   npx tsx --env-file=.env script/grant-refund-scope.ts <email> --kinds camp --programs 4
//   npx tsx --env-file=.env script/grant-refund-scope.ts <email> --all      (unrestricted)
//   npx tsx --env-file=.env script/grant-refund-scope.ts <email> --list
//   … add --commit to write it
//
// 🔴 `can_issue_refunds` is the master switch and this turns it ON as part of
// granting. Off means no refunds anywhere, with no role bypass — not even for a
// super admin. These lists NARROW it.
//
// 🔴 NULL on both lists = every programme, which is what everybody who already
// held the right keeps. Narrowing is deliberate, never a side effect.
import pg from "pg";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const email = args.find((a) => !a.startsWith("--"));
const flag = (name: string): string[] | null => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const out: string[] = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]);
  return out;
};

async function main() {
  if (!email) { console.error("\n  usage: grant-refund-scope.ts <email> [--kinds camp] [--programs 4] [--all] [--list] [--commit]\n"); process.exit(1); }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(
      `select id, email, first_name, last_name, can_issue_refunds, refund_programme_kinds, refund_program_ids
         from users where lower(email)=lower($1)`, [email]);
    if (!rows.length) { console.error(`\n  No user with email ${email}\n`); process.exit(1); }
    const u = rows[0];
    const describe = (r: any) =>
      `refunds ${r.can_issue_refunds ? "ON" : "OFF"} · kinds ${JSON.stringify(r.refund_programme_kinds)} · programmes ${JSON.stringify(r.refund_program_ids)}`;
    console.log(`\n  ${u.first_name} ${u.last_name} <${u.email}>  #${u.id}`);
    console.log(`  now:  ${describe(u)}`);

    if (args.includes("--list")) {
      // Show what those ids and kinds actually mean, so a grant can be read back.
      const { rows: progs } = await c.query(
        `select id, name, type, academy_section from programs order by id`);
      const ids: number[] = Array.isArray(u.refund_program_ids) ? u.refund_program_ids : [];
      for (const id of ids) {
        const p = progs.find((x: any) => Number(x.id) === Number(id));
        console.log(`        programme ${id}: ${p ? p.name : "‼ NO SUCH PROGRAMME"}`);
      }
      console.log();
      return;
    }

    const kinds = args.includes("--all") ? null : flag("kinds");
    const ids = args.includes("--all") ? null : (flag("programs") ?? []).map(Number).filter((n) => Number.isInteger(n));

    // Refuse to point at a programme that does not exist — a typo would look
    // like a grant and silently refuse every refund on it.
    if (ids && ids.length) {
      const { rows: found } = await c.query(`select id, name from programs where id = any($1::int[])`, [ids]);
      const missing = ids.filter((id) => !found.some((f: any) => Number(f.id) === id));
      if (missing.length) { console.error(`\n  ‼ No programme with id ${missing.join(", ")} — nothing written.\n`); process.exit(1); }
      for (const f of found) console.log(`        + programme ${f.id}: ${f.name}`);
    }
    if (kinds?.length) console.log(`        + every programme of kind: ${kinds.join(", ")}`);
    if (args.includes("--all")) console.log(`        + EVERY programme (unrestricted)`);

    const next = {
      can_issue_refunds: true,
      refund_programme_kinds: kinds && kinds.length ? JSON.stringify(kinds) : null,
      refund_program_ids: ids && ids.length ? JSON.stringify(ids) : null,
    };
    console.log(`  after: refunds ON · kinds ${next.refund_programme_kinds} · programmes ${next.refund_program_ids}`);

    if (!COMMIT) { console.log(`\n  Dry run — re-run with --commit.\n`); return; }
    await c.query(
      `update users set can_issue_refunds=true, refund_programme_kinds=$2::jsonb, refund_program_ids=$3::jsonb where id=$1`,
      [u.id, next.refund_programme_kinds, next.refund_program_ids]);
    const { rows: after } = await c.query(
      `select can_issue_refunds, refund_programme_kinds, refund_program_ids from users where id=$1`, [u.id]);
    console.log(`  read back: ${describe(after[0])}`);
    console.log(`\n  COMMITTED. Effective on their next request — no deploy, no re-login.\n`);
  } finally { await c.end(); }
}
main();
