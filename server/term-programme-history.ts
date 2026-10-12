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

  // ClubOS's own term registrations. A migrated one (legacy_source set) is the
  // same money as a history row with that fee number — ClubOS's copy wins.
  const own: any = await db.execute(sql`
    SELECT p.slug, p.name, r.id AS reg_id, r.total_cents, r.legacy_external_id,
           t.year, t.term_number, r.registered_at::date::text AS registered_on,
           c.first_name, c.last_name
    FROM registrations r
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

  return {
    today,
    thisStream: streamForProgramme(programme.slug, programme.name),
    periods,
    excluded: Array.from(excluded.entries()).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.cents - a.cents),
  };
}
