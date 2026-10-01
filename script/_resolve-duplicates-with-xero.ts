// READ-ONLY. Resolve the "may be stored twice" children against Olga's Xero
// contacts (export of 23 Sep 2026): contact "(A U10) Child Name" = the child and
// their 2026 age group; FirstName/LastName/Email = the parent who pays.
//   npx tsx --env-file=.env script/_resolve-duplicates-with-xero.ts
// → outputs/contact-merges/xero-resolution.json
import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
pg.types.setTypeParser(1082, (v: string) => v);
const SEASON = 2026;
const X = JSON.parse(readFileSync("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/xero-contacts-migration/source/xero-contacts-20260923.json", "utf8")).rows as any[];
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
type XC = { prefix: string; grade: number | null; child: string; parent: string; email: string; phone: string; status: string };
const xero: XC[] = [];
for (const r of X) {
  const m = /^\(([^)]*)\)\s*(.+)$/.exec(String(r.name ?? ""));
  if (!m) continue;
  const prefix = m[1].trim();
  if (!/^(A|FS|FS_FAM|JA|G)\b/i.test(prefix)) continue;
  const g = /U\s?(\d{1,2})/i.exec(prefix)?.[1];
  const ph = (r.phones ?? []).map((p: any) => `${p.phoneAreaCode ?? ""}${p.phoneNumber ?? ""}`.replace(/\D/g, "")).find((p: string) => p.length >= 7) ?? "";
  xero.push({ prefix, grade: g ? Number(g) : null, child: norm(m[2]), parent: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim(),
    email: String(r.emailAddress ?? "").toLowerCase().trim(), phone: ph.slice(-8), status: String(r.contactStatus ?? "") });
}
const byChild = new Map<string, XC[]>();
for (const x of xero) byChild.set(x.child, [...(byChild.get(x.child) ?? []), x]);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const people = (await pool.query(`
  SELECT p.id, p.first_name, p.last_name, p.date_of_birth dob, p.friendly_manager_id fm,
         lower(btrim(p.first_name))||' '||lower(btrim(p.last_name)) who,
         array_remove(array_agg(DISTINCT right(regexp_replace(coalesce(g.phone,''),'[^0-9]','','g'),8)), '') phones,
         array_remove(array_agg(DISTINCT lower(btrim(g.email))), NULL) emails,
         string_agg(DISTINCT g.first_name||' '||g.last_name, ', ') parents,
         (SELECT count(*) FROM registrations r WHERE r.contact_id=p.id AND r.status IN ('confirmed','refunded','partially_refunded'))::int regs
  FROM contacts p LEFT JOIN contact_relationships cr ON cr.player_id=p.id LEFT JOIN contacts g ON g.id=cr.guardian_id
  WHERE p.type='player' AND p.merged_into_contact_id IS NULL AND btrim(coalesce(p.first_name,''))<>''
  GROUP BY p.id`)).rows;
const byName = new Map<string, any[]>();
for (const p of people) byName.set(p.who, [...(byName.get(p.who) ?? []), p]);
const sameFamily = (a: any, b: any) => a.phones.some((x: string) => x.length === 8 && b.phones.includes(x)) || a.emails.some((x: string) => b.emails.includes(x));
const matchesXero = (p: any, x: XC) => (x.email && p.emails.includes(x.email)) || (x.phone && p.phones.includes(x.phone));

const out: any = { A: [], B: [] };
for (const [who, list] of byName) {
  if (list.length < 2) continue;
  const xs = (byChild.get(norm(who)) ?? []);
  // A — same family, details disagree
  const fam = list.filter((x) => list.some((y) => y !== x && sameFamily(x, y)));
  if (fam.length > 1) {
    const dobs = [...new Set(fam.map((p: any) => p.dob).filter(Boolean))];
    const gradeX = [...new Set(xs.filter((x) => x.grade && fam.some((p: any) => matchesXero(p, x))).map((x) => x.grade))];
    let verdict = "unresolved", rightDob: string | null = null;
    if (gradeX.length === 1) {
      const by = SEASON - gradeX[0]!;
      const fits = dobs.filter((d) => Number(String(d).slice(0, 4)) === by);
      if (fits.length === 1) { verdict = "xero_grade_picks_dob"; rightDob = fits[0] as string; }
      else if (dobs.length && fits.length === 0) verdict = "xero_grade_matches_neither";
      else if (fits.length > 1) verdict = "same_year_dates_differ";
    } else if (dobs.length <= 1) verdict = "dob_agrees"; // e.g. two FM ids only
    out.A.push({ who, ids: fam.map((p: any) => p.id), dobs, xeroGrades: gradeX, verdict, rightDob,
      records: fam.map((p: any) => ({ id: p.id, dob: p.dob, fm: p.fm, parents: p.parents, regs: p.regs })) });
  }
  // B — same name + DOB, different families
  const sameDob = list.filter((x) => x.dob && list.some((y) => y !== x && y.dob === x.dob && !sameFamily(x, y)));
  if (sameDob.length > 1) {
    const xFor = (p: any) => xs.filter((x) => matchesXero(p, x));
    const xIdsPer = sameDob.map((p: any) => xFor(p).map((x) => `${x.prefix}|${x.parent}|${x.email}`));
    const allX = xs.map((x) => `${x.prefix}|${x.parent}|${x.email}`);
    let verdict = "unresolved";
    if (xs.length === 1 && xIdsPer.filter((v) => v.length).length >= 1) verdict = "xero_has_one_child";
    else if (new Set(allX).size >= 2 && xIdsPer.every((v) => v.length === 1) && new Set(xIdsPer.map((v) => v[0])).size === sameDob.length) verdict = "xero_has_separate_children";
    else if (xs.length === 0) verdict = "not_in_xero";
    out.B.push({ who, dob: sameDob[0].dob, ids: sameDob.map((p: any) => p.id), verdict,
      xero: xs.map((x) => ({ prefix: x.prefix, parent: x.parent, email: x.email })),
      records: sameDob.map((p: any) => ({ id: p.id, parents: p.parents, emails: p.emails, regs: p.regs })) });
  }
}
const count = (arr: any[]) => arr.reduce((m: any, x: any) => (m[x.verdict] = (m[x.verdict] ?? 0) + 1, m), {});
console.log("A (same family, details disagree):", out.A.length, count(out.A));
console.log("B (same name+DOB, different parents):", out.B.length, count(out.B));
writeFileSync("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/contact-merges/xero-resolution.json", JSON.stringify(out, null, 1));
for (const a of out.A.filter((x: any) => x.verdict === "xero_grade_picks_dob").slice(0, 6)) console.log(" A ✓", a.who, a.dobs.join(" vs "), "→ Xero U" + a.xeroGrades[0], "→", a.rightDob);
for (const b of out.B.slice(0, 8)) console.log(" B", b.verdict, b.who, b.dob, JSON.stringify(b.xero).slice(0, 160));
await pool.end();
