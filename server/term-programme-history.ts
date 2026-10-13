// Term programme history — the numbers behind a term programme's History tab.
// The rules live in @shared/term-programme-history (ONE classifier); this file
// only reads the rows and adds them up. Twin of server/camp-history.ts.
import { sql } from "drizzle-orm";
import { db } from "./db";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { nzTodayIso } from "@shared/academy";
import { personKey } from "@shared/holiday-camp-history";
import {
  classifyTermRow, periodOrder, periodTitle, periodYear, samePeriodLastYear, streamForProgramme, termForPaidDate,
  type TermHistoryRow, type TermStream,
} from "@shared/term-programme-history";

type Source = "friendly_manager" | "shopify" | "xero" | "clubos";
interface Cell { cents: number; people: Set<string> }
interface PeriodAcc { streams: Partial<Record<TermStream, Cell>>; sources: Partial<Record<Source, number>>; people: Set<string>; cents: number; estimated: number }

export async function termProgrammeHistory(orgId: number, programme: { slug: string | null; name: string }) {
  const today = nzTodayIso();
  const acc = new Map<string, PeriodAcc>();
  const excluded = new Map<string, { rows: number; cents: number }>();
  const skip = (reason: string, cents: number) => {
    const x = excluded.get(reason) ?? { rows: 0, cents: 0 };
    x.rows++; x.cents += cents; excluded.set(reason, x);
  };
  const add = (k: string, s: TermStream, src: Source, cents: number, person: string | null, estimated: boolean) => {
    let e = acc.get(k);
    if (!e) acc.set(k, (e = { streams: {}, sources: {}, people: new Set(), cents: 0, estimated: 0 }));
    const cell = (e.streams[s] ??= { cents: 0, people: new Set() });
    cell.cents += cents; e.cents += cents;
    e.sources[src] = (e.sources[src] ?? 0) + cents;
    if (estimated) e.estimated += cents;
    if (person) { cell.people.add(person); e.people.add(person); }
  };

  // PRICE HISTORY (Daniel, 2026-10-14: "see price history over time … for our
  // database records"). What families were actually charged for THIS
  // programme, per term and age group, from the same rows as the money above.
  // 🔴 The most common amount in a term is its fee; anything else is pro-rata,
  // a discount or a part-payment — shown, never averaged into the fee.
  const thisStream = streamForProgramme(programme.slug, programme.name);
  const prices = new Map<string, Map<string, Map<number, { n: number; sources: Set<Source> }>>>();
  const price = (k: string, s: TermStream, group: string, src: Source, cents: number) => {
    if (s !== thisStream || cents <= 0) return;
    let byGroup = prices.get(k); if (!byGroup) prices.set(k, (byGroup = new Map()));
    let byAmt = byGroup.get(group); if (!byAmt) byGroup.set(group, (byAmt = new Map()));
    const e = byAmt.get(cents) ?? { n: 0, sources: new Set<Source>() };
    e.n++; e.sources.add(src); byAmt.set(cents, e);
  };
  const ageGroupOf = (t: string | null | undefined) => {
    const m = /\bu\s?(\d{1,2})(?:\s?(?:[-–\/]|to)\s?u?\s?(\d{1,2}))?\b/i.exec(t ?? "");
    return m ? (m[2] ? `U${m[1]}–U${m[2]}` : `U${m[1]}`) : "All ages";
  };

  // ClubOS's own term registrations. A migrated one (legacy_source set) is the
  // same money as a history row with that fee number — ClubOS's copy wins.
  const own: any = await db.execute(sql`
    SELECT p.slug, p.name, r.id AS reg_id, r.total_cents, r.legacy_external_id,
           t.year, t.term_number, r.registered_at::date::text AS registered_on,
           c.first_name, c.last_name, po.name AS option_name
    FROM registrations r
    LEFT JOIN program_options po ON po.id = r.program_option_id
    JOIN programs p ON p.id = r.program_id
    LEFT JOIN terms t ON t.id = r.term_id
    LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE p.organization_id = ${orgId} AND p.schedule_type = 'term'
      AND r.status IN ${sql.raw(REAL_REGISTRATION_STATUS_SQL)}`);
  const migrated = new Set<string>();
  for (const r of own.rows ?? []) {
    if (r.legacy_external_id) migrated.add(String(r.legacy_external_id));
    const s = streamForProgramme(r.slug, r.name);
    if (!s) continue;
    const cents = Number(r.total_cents ?? 0);
    const named = r.year && r.term_number;
    const k = named ? `${r.year}-t${r.term_number}` : termForPaidDate(r.registered_on ?? today);
    add(k, s, "clubos", cents, personKey(r.first_name, r.last_name) ?? `r:${r.reg_id}`, !named);
    price(k, s, ageGroupOf(r.option_name), "clubos", cents);
  }

  // Friendly Manager and Xero (the history import).
  const hist: any = await db.execute(sql`
    SELECT id, source, first_name, last_name, fee_number, fee_description, programme, term_name, season_year,
           paid_on::text AS paid_on, amount_cents
    FROM fm_payment_history WHERE organization_id = ${orgId}`);
  const rows: Array<TermHistoryRow & { fee_number: string | null }> = (hist.rows ?? []).map((r: any) => ({
    ...r, id: Number(r.id), amount_cents: Number(r.amount_cents), season_year: r.season_year == null ? null : Number(r.season_year),
  }));
  // One booking in two systems: an FM payment and a Xero invoice for the same
  // child, amount and week. Normally the Xero copy is dropped — but when ClubOS
  // already holds that Xero invoice as a registration, the FM copy is the one
  // that would double it, so the FM twin goes instead.
  const dupes = new Set<number>();
  const fmRows = rows.filter((r) => r.source === "friendly_manager");
  const day = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
  const usedFm = new Set<number>();
  for (const x of rows) {
    if (x.source !== "xero") continue;
    const f = (x.first_name ?? "").trim().toLowerCase();
    if (!f) continue;
    const twin = fmRows.find((m) => !usedFm.has(m.id) && (m.first_name ?? "").trim().toLowerCase() === f &&
      m.amount_cents === x.amount_cents && Math.abs(day(m.paid_on) - day(x.paid_on)) <= 7);
    if (!twin) continue;
    usedFm.add(twin.id);
    dupes.add(x.fee_number && migrated.has(x.fee_number) ? twin.id : x.id);
  }
  for (const r of rows) {
    const c = classifyTermRow(r);
    if (!c.include) {
      // Only report the reasons that matter on THIS page — not every uniform sale.
      if (/not a term programme|test|free/i.test(c.reason)) skip(c.reason, r.amount_cents);
      continue;
    }
    if (r.fee_number && migrated.has(r.fee_number)) continue; // counted from ClubOS
    if (dupes.has(r.id)) { skip("Recorded twice (a Friendly Manager payment and a Xero invoice) — counted once", r.amount_cents); continue; }
    add(c.period, c.stream, r.source as Source, r.amount_cents, personKey(r.first_name, r.last_name), c.how === "paid_date");
    price(c.period, c.stream, ageGroupOf([r.programme, r.fee_description].filter(Boolean).join(" ")), r.source as Source, r.amount_cents);
  }

  const current = termForPaidDate(today);
  const periods = Array.from(acc.keys()).sort((a, b) => periodOrder(a) - periodOrder(b)).map((k) => {
    const e = acc.get(k)!;
    return {
      key: k,
      title: periodTitle(k),
      year: periodYear(k),
      cents: e.cents,
      children: e.people.size,
      estimatedCents: e.estimated,
      inProgress: periodOrder(k) >= periodOrder(current),
      lastYearKey: acc.has(samePeriodLastYear(k)) ? samePeriodLastYear(k) : null,
      sources: e.sources,
      streams: Object.fromEntries(Object.entries(e.streams).map(([s, c]) => [s, { cents: c!.cents, children: c!.people.size }])),
    };
  });

  const priceHistory = Array.from(prices.entries())
    .sort((a, b) => periodOrder(b[0]) - periodOrder(a[0]))
    .map(([k, byGroup]) => ({
      key: k, title: periodTitle(k), year: periodYear(k),
      groups: Array.from(byGroup.entries()).map(([group, byAmt]) => {
        const amounts = Array.from(byAmt.entries()).map(([cents, e]) => ({ cents, count: e.n, sources: Array.from(e.sources) }))
          .sort((a, b) => b.count - a.count || b.cents - a.cents);
        // 🔴 Academy was paid in weekly instalments ($50, $70, $72.90), which
        // outnumber full fees — so the fee is the most common FULL-SIZE amount
        // (≥40% of the largest repeated one), and the small ones are labelled
        // part-payments rather than read as the price.
        const repeated = amounts.filter((a) => a.count >= 2);
        const ceiling = Math.max(...(repeated.length ? repeated : amounts).map((a) => a.cents));
        const fee = amounts.find((a) => a.cents >= ceiling * 0.4) ?? amounts[0];
        return {
          group, feeCents: fee.cents, feeCount: fee.count,
          payments: amounts.reduce((n, a) => n + a.count, 0),
          amounts: amounts.map((a) => ({ ...a, part: a.cents < fee.cents * 0.4 })),
        };
      }).sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true })),
    }));

  return {
    today,
    thisStream,
    priceHistory,
    periods,
    excluded: Array.from(excluded.entries()).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.cents - a.cents),
  };
}
