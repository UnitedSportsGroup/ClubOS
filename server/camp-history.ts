// Holiday camp history — the numbers behind the camp page's History tab.
// The rules live in @shared/holiday-camp-history (ONE classifier); this file
// only reads the rows and adds them up.
import { sql } from "drizzle-orm";
import { db } from "./db";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { seriesKey } from "@shared/programme-series";
import { nzTodayIso } from "@shared/academy";
import {
  HOLIDAY_CAMP_XERO_YEARS, classifyHistoryRow, crossSourceDuplicates, editionForCampStart, editionForDate,
  editionOrder, editionTitle, personKey, sameHolidayLastYear,
  type CampSeries, type HistoryRow,
} from "@shared/holiday-camp-history";

type Source = "friendly_manager" | "shopify" | "xero" | "clubos";

interface Cell { cents: number; people: Set<string> }
interface EditionAcc { series: Partial<Record<CampSeries, Cell>>; sources: Partial<Record<Source, number>>; people: Set<string>; cents: number; estimated: number; rows: number }

/** Which series a ClubOS camp belongs to, from its (derived) series name. */
function clubosSeries(name: string): CampSeries {
  const k = seriesKey(name);
  if (/fundament/.test(k)) return "fundamentals";
  if (/world cup/.test(k)) return "world_cup";
  return "general";
}

export async function holidayCampHistory(orgId: number, campName: string) {
  const today = nzTodayIso();
  const acc = new Map<string, EditionAcc>();
  const recordsByYear = new Map<number, number>();
  const excluded = new Map<string, { rows: number; cents: number }>();
  const bucket = (k: string) => {
    let e = acc.get(k);
    if (!e) acc.set(k, (e = { series: {}, sources: {}, people: new Set(), cents: 0, estimated: 0, rows: 0 }));
    return e;
  };
  const add = (k: string, s: CampSeries, src: Source, cents: number, person: string | null, estimated: boolean) => {
    const e = bucket(k);
    const cell = (e.series[s] ??= { cents: 0, people: new Set() });
    cell.cents += cents; e.cents += cents; e.rows++;
    e.sources[src] = (e.sources[src] ?? 0) + cents;
    if (estimated) e.estimated += cents;
    if (person) { cell.people.add(person); e.people.add(person); }
  };

  // 1) Friendly Manager, Xero invoices and Shopify orders (the history import).
  const hist: any = await db.execute(sql`
    SELECT id, source, first_name, last_name, fee_description, programme, term_name,
           paid_on::text AS paid_on, amount_cents
    FROM fm_payment_history
    WHERE organization_id = ${orgId}
      AND lower(coalesce(fee_description,'') || ' ' || coalesce(programme,'') || ' ' || coalesce(term_name,''))
          ~ '(holiday|hol prog|camp|fundament|world cup|first skills|netbusters|shotstopper|christmas|multi sport)'`);
  const rows: HistoryRow[] = (hist.rows ?? []).map((r: any) => ({ ...r, id: Number(r.id), amount_cents: Number(r.amount_cents) }));
  const dupes = crossSourceDuplicates(rows);
  const skip = (reason: string, cents: number) => {
    const x = excluded.get(reason) ?? { rows: 0, cents: 0 };
    x.rows++; x.cents += cents; excluded.set(reason, x);
  };
  for (const r of rows) {
    if (dupes.has(r.id)) { skip("Recorded twice (a Friendly Manager payment and a Xero invoice) — counted once", r.amount_cents); continue; }
    const c = classifyHistoryRow(r);
    if (!c.include) { skip(c.reason, r.amount_cents); continue; }
    add(c.edition, c.series, r.source as Source, r.amount_cents, personKey(r.first_name, r.last_name), c.how === "paid_date");
    const y = Number(r.paid_on.slice(0, 4));
    recordsByYear.set(y, (recordsByYear.get(y) ?? 0) + r.amount_cents);
  }

  // 2) ClubOS's own camps — the same money rule as the edition chips.
  const own: any = await db.execute(sql`
    SELECT p.name, p.start_date::text AS start_date, r.id AS reg_id, r.total_cents,
           r.registered_at::date::text AS registered_on,
           (SELECT array_agg(DISTINCT ri.child_id) FROM registration_items ri WHERE ri.registration_id = r.id) AS kids
    FROM registrations r JOIN programs p ON p.id = r.program_id
    WHERE p.type = 'holiday_camp' AND p.organization_id = ${orgId}
      AND r.status IN ${sql.raw(REAL_REGISTRATION_STATUS_SQL)}`);
  for (const r of own.rows ?? []) {
    if (!r.start_date) continue;
    const k = editionForCampStart(r.start_date);
    const s = clubosSeries(String(r.name));
    const cents = Number(r.total_cents ?? 0);
    const kids: number[] = (r.kids ?? []).filter((x: any) => x != null);
    // One registration can cover siblings: the money goes in once, each child counts.
    add(k, s, "clubos", cents, kids.length ? `c:${kids[0]}` : `r:${r.reg_id}`, false);
    for (const kid of kids.slice(1)) {
      const e = bucket(k); e.people.add(`c:${kid}`); e.series[s]!.people.add(`c:${kid}`);
    }
    const y = Number((r.registered_on ?? r.start_date).slice(0, 4));
    recordsByYear.set(y, (recordsByYear.get(y) ?? 0) + cents);
  }

  const current = editionForDate(today);
  const keys = Array.from(acc.keys()).sort((a, b) => editionOrder(a) - editionOrder(b));
  const editions = keys.map((k) => {
    const e = acc.get(k)!;
    return {
      key: k,
      title: editionTitle(k),
      cents: e.cents,
      children: e.people.size,
      estimatedCents: e.estimated,
      inProgress: editionOrder(k) >= editionOrder(current),
      lastYearKey: acc.has(sameHolidayLastYear(k)) ? sameHolidayLastYear(k) : null,
      sources: e.sources,
      series: Object.fromEntries(Object.entries(e.series).map(([s, c]) => [s, { cents: c!.cents, children: c!.people.size }])),
    };
  });

  const years = HOLIDAY_CAMP_XERO_YEARS.years.map((y) => ({
    year: y.year,
    xeroExGstCents: y.incomeExGstCents,
    xeroIncGstCents: Math.round(y.incomeExGstCents * 1.15),
    directCostCents: y.directCostCents,
    recordsCents: recordsByYear.get(y.year) ?? 0,
  }));

  return {
    today,
    thisCampSeries: clubosSeries(campName),
    editions,
    years,
    xero: { asOf: HOLIDAY_CAMP_XERO_YEARS.asOf, account: HOLIDAY_CAMP_XERO_YEARS.account },
    excluded: Array.from(excluded.entries()).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.cents - a.cents),
  };
}
