// The Mailer's audience resolver, proven against PRODUCTION data, read-only.
//
//   npx tsx --env-file=.env script/_verify-mailer-audience-live.ts
//
// What it holds to: nobody the old "By Camp" list reached is lost; the
// guardian-row-only families it missed are now reached; nearly every address
// on a programme carries a player's name; the parent's name is the guardian's,
// not the child's; a day segment names only the children booked that day; the
// same input gives the same list twice. Nothing is written.
import pg from "pg";
import { resolveMailerAudience, lookupMailerRecipient } from "../server/mailer-audience";
import { joinNames } from "../server/mailer-render";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
}
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows;

async function main() {
  console.log("\nMailer audience — live, read-only\n");

  // ── programme segments: FUNiño (4) and Pre-Academy (16) ─────────────────
  for (const programId of [4, 16]) {
    const aud = await resolveMailerAudience("camp", { campId: programId });
    const oldRows = await q<{ email: string }>(
      `select distinct lower(trim(c.email)) email from registrations r join contacts c on c.id=r.contact_id
        where r.program_id=$1 and r.status='confirmed' and c.email is not null and c.email<>''`, [programId]);
    const old = new Set(oldRows.map((r) => r.email));
    const lost = [...old].filter((e) => !aud.byEmail.has(e));
    ok(lost.length === 0, `programme ${programId}: every address the old list reached is still reached (${old.size} old, ${lost.length} lost)`);
    const gained = aud.emails.filter((e) => !old.has(e));
    console.log(`   programme ${programId}: ${aud.emails.length} addresses, +${gained.length} newly reached (families whose address lives on the guardian row only)`);
    ok(gained.length > 0, `programme ${programId}: the guardian-row-only families are now on the list`);

    const noPlayer = aud.emails.filter((e) => aud.byEmail.get(e)!.players.length === 0);
    ok(noPlayer.length / aud.emails.length < 0.03,
      `programme ${programId}: ≥97% of addresses carry a player's name (${aud.emails.length - noPlayer.length}/${aud.emails.length}; without: ${noPlayer.slice(0, 3).join(", ") || "none"})`);

    // The parent is the registration's guardian — never the child.
    const sample = await q<{ email: string; gfirst: string; pfirst: string }>(
      `select lower(trim(g.email)) email, g.first_name gfirst, pl.first_name pfirst
         from registrations r join contacts pl on pl.id=r.contact_id and pl.type='player'
         join contacts g on g.id=r.guardian_id
        where r.program_id=$1 and r.status='confirmed' and g.email is not null and g.email<>'' and g.first_name<>''
          and lower(trim(g.first_name))<>lower(trim(pl.first_name))
        order by r.id desc limit 25`, [programId]);
    const wrongParent = sample.filter((s) => (aud.byEmail.get(s.email)?.firstName || "").toLowerCase() !== s.gfirst.trim().toLowerCase());
    ok(sample.length > 0 && wrongParent.length === 0,
      `programme ${programId}: {{first_name}} is the guardian on every sampled address (${sample.length} sampled, ${wrongParent.length} wrong)`);
    const missingChild = sample.filter((s) => !aud.byEmail.get(s.email)?.players.some((p) => p.firstName.toLowerCase() === s.pfirst.trim().toLowerCase()));
    ok(missingChild.length === 0, `programme ${programId}: {{player_first_name}} names the registered child on every sampled address (${missingChild.length} missing)`);

    const again = await resolveMailerAudience("camp", { campId: programId });
    ok(JSON.stringify(again.emails) === JSON.stringify(aud.emails) &&
       JSON.stringify([...again.byEmail]) === JSON.stringify([...aud.byEmail]),
      `programme ${programId}: the same input gives the same list and the same names twice`);
  }

  // ── a family whose address lives on the guardian row ONLY ───────────────
  {
    const [fam] = await q<{ email: string; gfirst: string; pfirst: string; reg: number }>(
      `select lower(trim(g.email)) email, g.first_name gfirst, pl.first_name pfirst, r.id reg
         from registrations r join contacts pl on pl.id=r.contact_id and pl.type='player'
         join contacts g on g.id=r.guardian_id
        where r.program_id=4 and r.status='confirmed' and coalesce(pl.email,'')='' and g.email<>'' order by r.id desc limit 1`);
    const aud = await resolveMailerAudience("camp", { campId: 4 });
    const who = fam && aud.byEmail.get(fam.email);
    ok(!!who, `reg ${fam?.reg}: a guardian-row-only family is reached on FUNiño (${fam?.email})`);
    ok(!!who && who.firstName === fam.gfirst.trim(), `  …addressed to the parent, ${fam?.gfirst}`);
    ok(!!who && who.players.some((p) => p.firstName === fam.pfirst.trim()), `  …and the player tag reads ${fam?.pfirst}`);
  }

  // ── two children in one programme → "Jack and Lily" ────────────────────
  {
    const [pair] = await q<{ email: string; kids: number }>(
      `select lower(trim(coalesce(g.email, pl.email))) email, count(distinct r.contact_id) kids
         from registrations r join contacts pl on pl.id=r.contact_id and pl.type='player' left join contacts g on g.id=r.guardian_id
        where r.program_id=4 and r.status='confirmed' and coalesce(g.email, pl.email) is not null
        group by 1 having count(distinct r.contact_id) > 1 order by 2 desc, 1 limit 1`);
    const aud = await resolveMailerAudience("camp", { campId: 4 });
    const who = pair && aud.byEmail.get(pair.email);
    ok(!!who && who.players.length >= 2, `a parent with ${pair?.kids} children on FUNiño carries ${who?.players.length} player names`);
    ok(!!who && / and /.test(joinNames(who.players.map((p) => p.firstName))), `  …and reads "${who ? joinNames(who.players.map((p) => p.firstName)) : ""}"`);
    // A child stored twice (two contact rows, one name) is ONE child on the email.
    let repeated = 0;
    for (const e of aud.emails) {
      const names = aud.byEmail.get(e)!.players.map((p) => `${p.firstName} ${p.lastName}`.trim().toLowerCase());
      if (new Set(names).size !== names.length) repeated++;
    }
    ok(repeated === 0, `no address on FUNiño repeats a child's name ("Levi, Max and Levi" — ${repeated} would)`);
  }

  // ── a camp DAY names only the children booked that day ──────────────────
  {
    const [day] = await q<{ camp_date_id: number; n: number }>(
      `select ri.camp_date_id, count(*) n from registration_items ri join registrations r on r.id=ri.registration_id
        where r.program_id=30 and r.status in ('confirmed','refunded','partially_refunded') and ri.child_id is not null
        group by 1 order by 2 desc limit 1`);
    const dayAud = await resolveMailerAudience("day", { campId: 30, campDateId: day.camp_date_id });
    const campAud = await resolveMailerAudience("camp", { campId: 30 });
    ok(dayAud.emails.length > 0 && dayAud.emails.length <= campAud.emails.length,
      `camp 30 day ${day.camp_date_id}: ${dayAud.emails.length} addresses, within the whole camp's ${campAud.emails.length}`);
    ok(dayAud.emails.every((e) => campAud.byEmail.has(e)), "  …and every one of them is on the whole-camp list");
    // For each address, the day's players must be exactly the children with a line on that date.
    let mismatch = 0;
    for (const email of dayAud.emails.slice(0, 40)) {
      // An address reaches a registration as its registrant OR as its guardian.
      const expect = await q<{ first_name: string }>(
        `select distinct ch.first_name from registration_items ri
           join registrations r on r.id=ri.registration_id join children ch on ch.id=ri.child_id
           join contacts c on c.id=r.contact_id left join contacts g on g.id=r.guardian_id
          where r.program_id=30 and r.status in ('confirmed','refunded','partially_refunded') and ri.camp_date_id=$1
            and (lower(trim(c.email))=$2 or lower(trim(g.email))=$2)`, [day.camp_date_id, email]);
      const got = new Set(dayAud.byEmail.get(email)!.players.map((p) => p.firstName.toLowerCase()));
      const want = new Set(expect.map((r) => r.first_name.trim().toLowerCase()));
      if (got.size !== want.size || [...want].some((w) => !got.has(w))) {
        mismatch++;
        console.log(`     differs: ${email} got [${[...got]}] want [${[...want]}]`);
      }
    }
    ok(mismatch === 0, `  …and the day's player names match the children booked that day (40 sampled, ${mismatch} differ)`);
    const morning = await resolveMailerAudience("session", { campId: 30, campDateId: day.camp_date_id, sessionType: "morning" });
    ok(morning.emails.length <= dayAud.emails.length && morning.emails.every((e) => dayAud.byEmail.has(e)),
      `  …a session (${morning.emails.length}) sits inside its day`);
  }

  // ── "All Contacts" ──────────────────────────────────────────────────────
  {
    const all = await resolveMailerAudience("all");
    const oldRows = await q<{ email: string }>(
      `select distinct lower(trim(email)) email from contacts where type='guardian' and email is not null and email<>''`);
    const old = new Set(oldRows.map((r) => r.email));
    const lost = [...old].filter((e) => !all.byEmail.has(e));
    ok(lost.length === 0, `All Contacts: every guardian address the old list had is kept (${old.size}, lost ${lost.length})`);
    console.log(`   All Contacts: ${all.emails.length} addresses (+${all.emails.length - old.size} reached through registrations only)`);
    const named = all.emails.filter((e) => all.byEmail.get(e)!.firstName).length;
    console.log(`   ${named}/${all.emails.length} carry a parent's first name; ${all.emails.filter((e) => all.byEmail.get(e)!.players.length).length} carry a player's`);
    const namedGuardians = await q<{ n: string }>(`select count(distinct lower(trim(email))) n from contacts where type='guardian' and email is not null and email<>'' and coalesce(trim(first_name),'')<>''`);
    ok(named >= Number(namedGuardians[0].n), `All Contacts: every guardian row with a first name is addressed by it (${named} named ≥ ${namedGuardians[0].n} named guardian rows)`);
    ok(all.emails.length === new Set(all.emails).size, "All Contacts: no address twice");
  }

  // ── custom list + the test-send lookup ──────────────────────────────────
  {
    const nobody = await resolveMailerAudience("custom", { emails: ["Nobody@Example.invalid", "nobody@example.invalid", "not-an-email"] });
    ok(nobody.emails.length === 1 && nobody.emails[0] === "nobody@example.invalid", "custom: typed addresses are cleaned and deduped; junk is dropped");
    const n = nobody.byEmail.get("nobody@example.invalid")!;
    ok(n.firstName === null && n.players.length === 0, "custom: an unknown address has no parent name and no players (renders 'Hi there')");

    const [known] = await q<{ email: string }>(
      `select lower(trim(g.email)) email from registrations r join contacts g on g.id=r.guardian_id
        where r.program_id=16 and r.status='confirmed' and g.email<>'' order by r.id desc limit 1`);
    const viaLookup = await lookupMailerRecipient(known.email.toUpperCase());
    const viaAll = (await resolveMailerAudience("all")).byEmail.get(known.email)!;
    ok(viaLookup.firstName === viaAll.firstName &&
       JSON.stringify(viaLookup.players.map((p) => p.firstName).sort()) === JSON.stringify(viaAll.players.map((p) => p.firstName).sort()),
      `test-send lookup agrees with the All Contacts entry for ${known.email} (${viaLookup.firstName}; ${joinNames(viaLookup.players.map((p) => p.firstName))})`);

    const extra = await resolveMailerAudience("camp", { campId: 16 }, [known.email, "nobody@example.invalid"]);
    ok(extra.emails.includes("nobody@example.invalid") && extra.emails.filter((e) => e === known.email).length === 1,
      "a typed extra rides on a programme list once; an address already there is not doubled");
  }

  console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
  await pool.end();
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
