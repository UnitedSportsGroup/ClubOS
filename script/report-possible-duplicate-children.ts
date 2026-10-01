// The office's list of children who MAY be stored twice, after every clear-cut
// duplicate has been merged by merge-duplicate-contacts.ts. Read-only.
//   npx tsx --env-file=.env script/report-possible-duplicate-children.ts
// → outputs/contact-merges/<date>-for-the-office-to-confirm.md
import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
pg.types.setTypeParser(1082, (v: string) => v);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
await c.query("SET default_transaction_read_only = on");
const people = (await c.query(`
  SELECT p.id, p.first_name, p.last_name, p.date_of_birth dob, p.friendly_manager_id fm,
         lower(btrim(p.first_name))||' '||lower(btrim(p.last_name)) who,
         array_remove(array_agg(DISTINCT right(regexp_replace(coalesce(g.phone,''),'[^0-9]','','g'),8)), '') phones,
         array_remove(array_agg(DISTINCT lower(btrim(g.email))), NULL) emails,
         string_agg(DISTINCT g.first_name||' '||g.last_name||' ('||coalesce(g.phone,'no phone')||')', ', ') parents,
         (SELECT count(*) FROM registrations r WHERE r.contact_id=p.id AND r.status IN ('confirmed','refunded','partially_refunded'))::int regs,
         (SELECT max(r.registered_at)::date::text FROM registrations r WHERE r.contact_id=p.id) last_reg
  FROM contacts p
  LEFT JOIN contact_relationships cr ON cr.player_id=p.id
  LEFT JOIN contacts g ON g.id=cr.guardian_id
  WHERE p.type='player' AND p.merged_into_contact_id IS NULL AND btrim(coalesce(p.first_name,''))<>''
  GROUP BY p.id`)).rows;
const byName = new Map<string, any[]>();
for (const p of people) byName.set(p.who, [...(byName.get(p.who) ?? []), p]);
const sameFamily = (a: any, b: any) => a.phones.some((x: string) => x.length === 8 && b.phones.includes(x)) || a.emails.some((x: string) => b.emails.includes(x));
const A: any[][] = [], B: any[][] = [];
for (const [, list] of byName) {
  if (list.length < 2) continue;
  const fam = list.filter((x) => list.some((y) => y !== x && sameFamily(x, y)));
  if (fam.length > 1) A.push(fam);
  const sameDob = list.filter((x) => x.dob && list.some((y) => y !== x && y.dob === x.dob && !sameFamily(x, y)));
  if (sameDob.length > 1) B.push(sameDob);
}
const line = (d: any) => `  - #${d.id} — born ${d.dob ?? "not recorded"}${d.fm ? ` · FM ${d.fm}` : ""} · ${d.parents ?? "no parent linked"} · ${d.regs} registration(s)${d.last_reg ? `, latest ${d.last_reg}` : ""} · app.usg.co.nz/admin/people/contact-${d.id}`;
const name = (g: any[]) => `${g[0].first_name} ${g[0].last_name}`;
const today = new Date().toISOString().slice(0, 10);
let md = `# Children who may be stored twice — for the office to confirm (${today})\n\n`
  + `Every clear-cut duplicate has already been merged (same name, same date of birth, same parent phone or email). `
  + `What's left needs a person: open both, decide, and tell Daniel which to merge — and **which date of birth is right**, `
  + `because it decides the age group.\n\n`;
md += `## A. Same child, same family — but the date of birth (or Friendly Manager id) disagrees (${A.length})\n\n`;
for (const g of A.sort((a, b) => name(a).localeCompare(name(b)))) md += `- **${name(g)}**\n${g.map(line).join("\n")}\n`;
md += `\n## B. Same name and date of birth, but different parents and phones (${B.length})\n\nOften separated parents each registering the same child — or genuinely two different children. Ask before merging.\n\n`;
for (const g of B.sort((a, b) => name(a).localeCompare(name(b)))) md += `- **${name(g)}**\n${g.map(line).join("\n")}\n`;
md += `\n## C. Holiday-camp bookings\n\nCamp bookings are kept in their own list and often have no date of birth, so they are never linked automatically — `
  + `e.g. Miles Wogan's camp booking under Jaime Duggan shows as a second Miles on the Contacts page. Not counted above.\n`;
mkdirSync("outputs/contact-merges", { recursive: true });
const out = `outputs/contact-merges/${today}-for-the-office-to-confirm.md`;
writeFileSync(out, md);
console.log(`A: ${A.length} · B: ${B.length} → ${out}`);
c.release(); await pool.end();
