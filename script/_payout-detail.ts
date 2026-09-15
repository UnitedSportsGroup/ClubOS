// What is actually inside each Stripe payout, at PLAYER level.
//
// Daniel, 2026-09-16: "map all the transactions for the stripe payouts according
// to new coding structure … as detailed as possible ideally with players name and
// mapped to olga's per player/parent system in xero contacts".
//
// 🔴 READ-ONLY and makes ZERO Xero API calls. walkPayout() is Stripe + ClubOS
// only, and the Xero contact match reads the CONTACTS EXPORT ON DISK. That is
// deliberate: the tenant's 5,000/day quota is exhausted, and this has to be
// reviewable without it.
//
//   npx tsx --env-file=.env script/_payout-detail.ts [nPayouts]
import { readFileSync } from "node:fs";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { walkPayout, listRecentPayouts, type WalkedItem } from "../server/xero-payout";

const N = Number(process.argv[2] ?? 3);
const CONTACTS = "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/xero-contacts-migration/source/xero-contacts-20260911.json";

/** Olga's contact name carries the programme and grade: "(A U10) Beauden Whittle". */
function parseOlgaName(n: string) {
  const m = /^\s*\(([^)]*)\)\s*(.*)$/.exec(n || "");
  return m ? { prefix: m[1].trim(), child: m[2].trim() } : { prefix: null as string | null, child: (n || "").trim() };
}

(async () => {
  // --- Olga's Xero contacts, indexed by the PARENT's email (never by name) ---
  const raw = JSON.parse(readFileSync(CONTACTS, "utf8"));
  const byEmail = new Map<string, any>();
  for (const c of raw.rows as any[]) {
    const e = (c.emailAddress || "").trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, c);
  }
  console.log(`Xero contacts on disk: ${raw.rows.length} (pulled ${String(raw.pulledAt).slice(0,10)}), ${byEmail.size} with a parent email\n`);

  const payouts = await listRecentPayouts(N);
  let totalCharges = 0, withPerson = 0, withGrade = 0, withXero = 0;

  for (const p of payouts) {
    const { split, items } = await walkPayout(p.id);
    console.log("=".repeat(104));
    console.log(`PAYOUT ${p.id}   arrives ${p.arrivalDate}   $${(split.payoutCents/100).toFixed(2)}   balances=${split.balances}`);
    console.log("=".repeat(104));

    const regIds = (items as WalkedItem[])
      .filter(i => (i.resolved as any)?.source === "registrations")
      .map(i => Number((i.resolved as any).recordId)).filter(Number.isFinite);

    const people = new Map<number, any>();
    if (regIds.length) {
      const r = await db.execute(sql`
        SELECT r.id,
               player.first_name || ' ' || player.last_name AS player_name,
               player.date_of_birth                         AS player_dob,
               guardian.first_name || ' ' || guardian.last_name AS guardian_name,
               lower(guardian.email)                        AS guardian_email,
               lower(player.email)                          AS player_email,
               pr.name AS programme, pr.academy_section, pr.type AS prog_type,
               t.name AS term_name, t.year AS term_year,
               r.total_cents, r.term_id
          FROM registrations r
          LEFT JOIN contacts player   ON player.id   = r.contact_id
          LEFT JOIN contacts guardian ON guardian.id = r.guardian_id
          LEFT JOIN programs pr       ON pr.id       = r.program_id
          LEFT JOIN terms t           ON t.id        = r.term_id
         WHERE r.id = ANY(${sql.raw(`ARRAY[${regIds.join(",")}]::int[]`)})`);
      for (const row of r.rows as any[]) people.set(Number(row.id), row);
    }

    // 🔴 A CAMP names the PAYER, not the child. The children sit on
    // registration_items, one row per child per day, each with its own price —
    // so a booking for two siblings becomes two named lines, not one lump.
    const kids = new Map<number, any[]>();
    if (regIds.length) {
      const k = await db.execute(sql`
        SELECT ri.registration_id, ch.id AS child_id,
               ch.first_name || ' ' || ch.last_name AS child_name,
               ch.date_of_birth AS child_dob,
               SUM(ri.price_cents)::bigint AS cents,
               COUNT(*)::int AS days
          FROM registration_items ri
          LEFT JOIN children ch ON ch.id = ri.child_id
         WHERE ri.registration_id = ANY(${sql.raw(`ARRAY[${regIds.join(",")}]::int[]`)})
         GROUP BY ri.registration_id, ch.id, ch.first_name, ch.last_name, ch.date_of_birth
         ORDER BY 1, 3`);
      for (const row of k.rows as any[]) {
        const a = kids.get(Number(row.registration_id)) ?? [];
        a.push(row); kids.set(Number(row.registration_id), a);
      }
    }

    for (const it of items as WalkedItem[]) {
      totalCharges++;
      const res: any = it.resolved ?? {};
      const amt = `$${(it.grossCents/100).toFixed(2)}`.padStart(10);
      if (res.source !== "registrations") {
        console.log(`${amt}  ${String(it.category).padEnd(18)} ${String(res.description ?? "—").slice(0,46).padEnd(46)} (${res.source ?? "UNRESOLVED"})`);
        continue;
      }
      const pe = people.get(Number(res.recordId));
      if (!pe) { console.log(`${amt}  ${String(it.category).padEnd(18)} registration ${res.recordId} — NOT FOUND`); continue; }
      withPerson++;
      const year = pe.term_year ?? null;
      const dobY = pe.player_dob ? new Date(pe.player_dob).getUTCFullYear() : null;
      const grade = year && dobY ? year - dobY : null;
      if (grade) withGrade++;
      const email = pe.guardian_email || pe.player_email || "";
      const xc = email ? byEmail.get(email) : null;
      if (xc) withXero++;
      const olga = xc ? parseOlgaName(xc.name) : null;
      const campKids = (kids.get(Number(res.recordId)) ?? []).filter(k => k.child_name);
      const campYear = pe.term_year ?? new Date(p.arrivalDate).getUTCFullYear();

      if (campKids.length) {
        // One line per CHILD, priced from their own items.
        for (const k of campKids) {
          const ky = k.child_dob ? new Date(k.child_dob).getUTCFullYear() : null;
          const kg = ky ? campYear - ky : null;
          if (kg) withGrade++;
          console.log(
            `${`$${(Number(k.cents)/100).toFixed(2)}`.padStart(10)}  ${String(it.category).padEnd(18)}` +
            ` ${String(k.child_name).slice(0,22).padEnd(22)}` +
            ` ${kg ? ("U"+kg).padEnd(4) : "—   "}` +
            ` ${String(pe.programme ?? "?").slice(0,22).padEnd(22)}` +
            ` ${(k.days+"d").padEnd(14)}` +
            ` paid by ${String(pe.player_name ?? pe.guardian_name ?? "?").slice(0,20)}`
          );
        }
        continue;
      }

      console.log(
        `${amt}  ${String(it.category).padEnd(18)}` +
        ` ${String(pe.player_name ?? "?").slice(0,22).padEnd(22)}` +
        ` ${grade ? ("U"+grade).padEnd(4) : "—   "}` +
        ` ${String(pe.programme ?? "?").slice(0,22).padEnd(22)}` +
        ` ${String(pe.term_name ?? "no term").slice(0,14).padEnd(14)}` +
        ` ${xc ? "xero:"+String(olga!.prefix ?? "-").padEnd(7)+" "+String(olga!.child).slice(0,20) : "NO XERO CONTACT"}`
      );
    }
    const fee = split.feeCents + split.stripeChargeCents;
    console.log(`${`-$${(fee/100).toFixed(2)}`.padStart(10)}  stripe fee`);
  }

  console.log("\n" + "=".repeat(104));
  console.log(`charges ${totalCharges} | resolved to a person ${withPerson} | age grade derived ${withGrade} | matched to an Olga Xero contact ${withXero}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message ?? JSON.stringify(e).slice(0,300)); process.exit(1); });
