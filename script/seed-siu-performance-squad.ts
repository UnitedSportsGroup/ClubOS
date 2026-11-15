// The SIU first-team squad for the Performance Hub, from the signed OFC
// declaration (payables_declarations #3 — "Confirmation of No Overdue Payables
// towards Players and Club", signatories of kind 'player').
//
//   npx tsx --env-file=.env script/seed-siu-performance-squad.ts            (dry run)
//   npx tsx --env-file=.env script/seed-siu-performance-squad.ts --commit
//
// 🔴 A player is matched to an EXISTING contact by email only (never by name).
//    No match → a new `player` contact with the name and email exactly as signed.
// 🔴 Idempotent: one squad row, one membership per contact. Re-running adds any
//    new signatory and changes nothing else (never overwrites a position a
//    coach has since edited).
// 🔴 Staff signatories are NOT added — the squad is players. A person who signed
//    as both (Callum Kennett, GK and GK coach) is added as a player.
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const SIU_ORG = 2;
const DECLARATION = 3;
const SQUAD = { name: "SIU First Team", slug: "siu-first-team", season: 2026, competition: "OFC Pro League" };

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  // Dutch particles stay with the surname: "Van Dijk", "Van Rijssel", "Van Hattum".
  const i = parts.findIndex((p, k) => k > 0 && /^(van|von|de|der|den|da|di|le|la)$/i.test(p));
  const cut = i > 0 ? i : parts.length - 1;
  return { first: parts.slice(0, cut).join(" "), last: parts.slice(cut).join(" ") };
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("begin");
  try {
    const { rows: signed } = await c.query(
      `select name, lower(trim(email)) email, role_title from payables_declaration_signatories
       where declaration_id = $1 and organization_id = $2 and group_kind = 'player' order by sort_order`, [DECLARATION, SIU_ORG]);
    console.log(`\n  ${signed.length} players on declaration #${DECLARATION} — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`);

    let { rows: [squad] } = await c.query(`select id from club_squads where organization_id = $1 and slug = $2 and season_year = $3`, [SIU_ORG, SQUAD.slug, SQUAD.season]);
    if (!squad) {
      ({ rows: [squad] } = await c.query(
        `insert into club_squads (organization_id, name, slug, season_year, competition, is_active, notes)
         values ($1,$2,$3,$4,$5,true,$6) returning id`,
        [SIU_ORG, SQUAD.name, SQUAD.slug, SQUAD.season, SQUAD.competition, "From the signed OFC payables declaration #3. Used by Performance."]));
      console.log(`  + squad "${SQUAD.name}" (${SQUAD.season})`);
    } else console.log(`  = squad "${SQUAD.name}" exists (#${squad.id})`);

    let created = 0, added = 0, kept = 0;
    for (const s of signed) {
      if (!s.email) { console.log(`  ! ${s.name}: no email on the declaration — skipped, add by hand`); continue; }
      let { rows: [contact] } = await c.query(
        `select id, first_name, last_name from contacts where lower(email) = $1 and merged_into_contact_id is null order by id limit 1`, [s.email]);
      if (!contact) {
        const n = splitName(s.name);
        ({ rows: [contact] } = await c.query(
          `insert into contacts (type, first_name, last_name, email, notes) values ('player',$1,$2,$3,$4) returning id, first_name, last_name`,
          [n.first, n.last, s.email, "Added from the SIU OFC declaration #3 (Performance Hub, 2026-11-14)."]));
        created++;
        console.log(`  + contact ${s.name} (#${contact.id})`);
      }
      const { rows: [m] } = await c.query(`select id from club_squad_members where squad_id = $1 and contact_id = $2 and left_at is null`, [squad.id, contact.id]);
      if (m) { kept++; continue; }
      await c.query(`insert into club_squad_members (squad_id, contact_id, role, position) values ($1,$2,'player',$3)`, [squad.id, contact.id, s.role_title || null]);
      added++;
      console.log(`  + ${s.name} — ${s.role_title ?? "no position"} (contact #${contact.id}${contact.first_name !== s.name.split(" ")[0] ? `, on file as ${contact.first_name} ${contact.last_name}` : ""})`);
    }
    const { rows: [n] } = await c.query(`select count(*)::int n from club_squad_members where squad_id = $1 and left_at is null`, [squad.id]);
    console.log(`\n  contacts created ${created} · added to squad ${added} · already in ${kept} · squad now ${n.n}`);
    if (COMMIT) { await c.query("commit"); console.log("  ✓ committed"); }
    else { await c.query("rollback"); console.log("  dry run rolled back — re-run with --commit"); }
  } catch (e) {
    await c.query("rollback"); throw e;
  } finally { await c.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
