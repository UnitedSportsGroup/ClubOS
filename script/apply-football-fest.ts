/**
 * Applies migrations/2026-09-19_football_fest.sql and proves it.
 *
 *   npx tsx --env-file=.env script/apply-football-fest.ts [--dry-run]
 *
 * --dry-run runs the whole thing inside a transaction that is ROLLED BACK, which
 * is how a ClubOS migration is rehearsed (there is no local Postgres). Every
 * invariant below is proven by an insert that MUST be refused — a constraint
 * nobody has watched reject anything is a comment with a semicolon after it.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const DRY = process.argv.includes("--dry-run");
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

/**
 * Asserts an insert is REFUSED. Passing is the failure.
 *
 * 🔴 Each attempt runs inside its own SAVEPOINT. A statement that errors inside
 * a transaction leaves Postgres in an aborted state where every later command
 * answers 25P02 ("current transaction is aborted"), so catching the error in
 * JavaScript is not enough — the FIRST refusal would take out every check after
 * it, and the run would look like a code bug rather than a constraint working.
 */
let spN = 0;
async function refuses(tx: any, label: string, statement: any) {
  const sp = `sp_${++spN}`;
  await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
  try {
    await tx.execute(statement);
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
    ok(label, false, "the database ACCEPTED it");
  } catch {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
    ok(label, true);
  }
}

async function main() {
  const file = path.join(process.cwd(), "migrations/2026-09-19_football_fest.sql");
  const ddl = fs.readFileSync(file, "utf8");
  // A migration carrying its own BEGIN/COMMIT defeats this rehearsal: the inner
  // COMMIT ends the transaction and the ROLLBACK then runs in autocommit.
  // Strip `DO $$ … $$;` bodies first — PL/pgSQL's BEGIN is a block opener.
  const outsideDo = ddl.replace(/DO\s*\$\$[\s\S]*?\$\$\s*;/gi, "");
  if (/^\s*(BEGIN|COMMIT)\b/im.test(outsideDo)) {
    throw new Error("migration carries its own BEGIN/COMMIT — it would defeat --dry-run");
  }

  console.log(`\nFootball Fest — ${DRY ? "DRY RUN (rolled back)" : "APPLYING"}\n`);

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(ddl));

    const [org] = (await tx.execute(
      sql`SELECT id FROM organizations WHERE slug = 'christchurch-international-cup'`
    )).rows as any[];
    ok("CIC organisation exists", !!org?.id, org?.id ? `org ${org.id}` : "NOT FOUND");
    const orgId = Number(org?.id);

    // ── shape ────────────────────────────────────────────────────────────
    const cols = (await tx.execute(sql`
      SELECT column_name, is_nullable, data_type FROM information_schema.columns
      WHERE table_name = 'football_fest_registrations'
    `)).rows as any[];
    const byName = new Map(cols.map((c: any) => [c.column_name, c]));
    for (const c of ["id","organization_id","kind","business_name","contact_name","email","phone",
                     "days","about","message","source_url","status","notes","held","held_reasons",
                     "created_at","updated_at"]) {
      ok(`column ${c}`, byName.has(c));
    }
    ok("held_reasons is an array", byName.get("held_reasons")?.data_type === "ARRAY");
    // 🔴 `held` must stay nullable: NULL means "not recorded", never "clean".
    ok("held is nullable (NULL = not recorded)", byName.get("held")?.is_nullable === "YES");

    ok("RLS is on", ((await tx.execute(sql`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'football_fest_registrations'
    `)).rows[0] as any)?.relrowsecurity === true);

    // ── invariants, each proven by a refusal ─────────────────────────────
    const insert = (b: string, c: string, e: string) => sql`
      INSERT INTO football_fest_registrations (organization_id, business_name, contact_name, email)
      VALUES (${orgId}, ${b}, ${c}, ${e})`;

    await refuses(tx, "refuses a blank business name", insert("   ", "Sam", "sam@example.com"));
    await refuses(tx, "refuses a blank contact name", insert("Kaikoura Coffee", "  ", "sam@example.com"));
    await refuses(tx, "refuses an address with no @", insert("Kaikoura Coffee", "Sam", "not-an-email"));
    await refuses(tx, "refuses an unknown organisation",
      sql`INSERT INTO football_fest_registrations (organization_id, business_name, contact_name, email)
          VALUES (2147483600, 'X', 'Y', 'a@b.co')`);

    // ── a real row behaves ───────────────────────────────────────────────
    const [row] = (await tx.execute(sql`
      INSERT INTO football_fest_registrations
        (organization_id, business_name, contact_name, email, phone, days, about, held, held_reasons)
      VALUES (${orgId}, 'Kaikoura Coffee Co', 'Sam Tai', 'sam@example.com', '021 000 0000',
              'Both', 'Mobile espresso cart', true, ARRAY['rate_ip','no_form_token']::text[])
      RETURNING id, kind, status, held, held_reasons, created_at`)).rows as any[];
    ok("a real enquiry inserts", !!row?.id);
    ok("kind defaults to expo", row?.kind === "expo", String(row?.kind));
    ok("status defaults to new", row?.status === "new", String(row?.status));
    ok("held round-trips", row?.held === true);
    ok("held_reasons round-trips", Array.isArray(row?.held_reasons) && row.held_reasons.length === 2,
       JSON.stringify(row?.held_reasons));

    // An apostrophe in a business name is ordinary, not an attack.
    const [apos] = (await tx.execute(sql`
      INSERT INTO football_fest_registrations (organization_id, business_name, contact_name, email)
      VALUES (${orgId}, ${"O'Malley's Pies"}, 'Pat', 'pat@example.com') RETURNING business_name`)).rows as any[];
    ok("an apostrophe survives", apos?.business_name === "O'Malley's Pies", String(apos?.business_name));

    // Two people from the same business are two real enquiries, not a duplicate.
    const [second] = (await tx.execute(sql`
      INSERT INTO football_fest_registrations (organization_id, business_name, contact_name, email)
      VALUES (${orgId}, 'Kaikoura Coffee Co', 'Jo Tai', 'jo@example.com') RETURNING id`)).rows as any[];
    ok("the same business may enquire twice", !!second?.id);

    ok("indexes exist", ((await tx.execute(sql`
      SELECT count(*)::int AS n FROM pg_indexes
      WHERE tablename = 'football_fest_registrations'
        AND indexname IN ('football_fest_registrations_org_created_idx','football_fest_registrations_open_idx')
    `)).rows[0] as any)?.n === 2);

    if (DRY) {
      console.log("\n  (rolling back — nothing was kept)");
      throw new Error("__ROLLBACK__");
    }
  }).catch((e: any) => {
    if (e?.message !== "__ROLLBACK__") throw e;
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
