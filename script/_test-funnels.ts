/**
 * Funnels — the sums (no database) and, with --live, the counter against real
 * data for the CUFC summer camps (read-only; nothing is written).
 *
 *   npx tsx script/_test-funnels.ts
 *   npx tsx --env-file=.env script/_test-funnels.ts --live
 */
import { funnelSteps, funnelSummary, looksLikeCheckout, normalisePage, oneIn, ratePct, scaledSpend, volumeForRevenue, whatIf, type FunnelStage } from "../shared/funnels";

let pass = 0;
const fails: string[] = [];
function check(label: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ""}`); }
}
const near = (a: number | null, b: number, tol = 1e-6) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const st = (key: any, count: number | null): FunnelStage => ({ key, label: key, detail: "", count, unit: "people", source: "web" });
const stages = [st("impressions", 30000), st("clicks", 3000), st("landed", 2400), st("checkout", 600), st("payment", 200), st("paid", 150)];
const f = { stages, bookings: 180, revenueCents: 2_600_000, spendCents: 300_000 };

console.log("\n  Pages");
check("a full address is cut to site and page", normalisePage("https://Join.cufc.co.nz/fundamentals/?utm=1#x") === "join.cufc.co.nz/fundamentals");
check("www is dropped", normalisePage("www.cufc.co.nz/programmes/holiday") === "cufc.co.nz/programmes/holiday");
check("a bare site is its home page", normalisePage("cufc.co.nz") === "cufc.co.nz/");
check("a page with no site is refused", normalisePage("/fundamentals") === null);
check("words are refused", normalisePage("the camp page") === null);
check("/book is a booking form", looksLikeCheckout("/fundamentals/book") && looksLikeCheckout("/ballers-u9/class-book"));
check("a landing page is not a booking form", !looksLikeCheckout("/fundamentals"));

console.log("\n  Steps");
const steps = funnelSteps(stages);
check("five steps between six stages", steps.length === 5);
check("ad view → click is 10%", near(steps[0].rate, 0.1));
check("27,000 did not click", steps[0].lost === 27000);
check("payment → paid is 75%", near(steps[4].rate, 0.75));
const gap = funnelSteps([st("clicks", 100), st("landed", null), st("checkout", 40)]);
check("a step that was not counted is skipped, not treated as zero", gap.length === 1 && near(gap[0].rate, 0.4));
const more = funnelSteps([st("clicks", 100), st("landed", 120)]);
check("more arriving than clicking gives a rate over 100% and no 'lost' number", near(more[0].rate, 1.2) && more[0].lost === null);
check("a first stage of zero gives no rate", funnelSteps([st("clicks", 0), st("landed", 0)])[0].rate === null);

console.log("\n  Summary");
const sum = funnelSummary(f);
check("start to paid is 150 in 30,000", near(sum.overallRate, 150 / 30000));
check("cost per click is $1.00", near(sum.costPerClickCents, 100));
check("cost per booking is spend ÷ bookings", near(sum.costPerBookingCents, 300000 / 180));
check("a booking brings revenue ÷ bookings", near(sum.bookingValueCents, 2600000 / 180));
check("back for every $1 is revenue ÷ spend", near(sum.returnPerDollar, 2600000 / 300000));
check("the biggest drop is page → booking form (the ad step is never named)", sum.biggestLeak?.from === "landed" && sum.biggestLeak?.to === "checkout", sum.biggestLeak);
const noSpend = funnelSummary({ ...f, spendCents: null });
check("no spend means no cost figures, not $0", noSpend.costPerClickCents === null && noSpend.returnPerDollar === null);
check("zero spend is treated the same", funnelSummary({ ...f, spendCents: 0 }).costPerBookingCents === null);

console.log("\n  What if");
const same = whatIf(f, { volume: 1, lifts: {}, costRise: 0.2 });
check("nothing changed gives today's numbers back", near(same.revenueCents, 2600000) && near(same.bookings, 180) && near(same.spendCents, 300000));
const dbl = whatIf(f, { volume: 2, lifts: {}, costRise: 0 });
check("twice the clicks, same rates: twice the revenue", near(dbl.revenueCents, 5200000) && near(dbl.stages[1].count, 6000));
check("…and with no price rise, twice the spend", near(dbl.spendCents, 600000));
const dear = whatIf(f, { volume: 2, lifts: {}, costRise: 0.2 });
check("with clicks 20% dearer per doubling, twice the volume costs 2.4×", near(dear.spendCents, 720000));
check("four times the volume costs 4 × 1.2²", near(scaledSpend(100, 4, 0.2), 576));
check("less volume costs less, with no discount invented", near(scaledSpend(100, 0.5, 0.2), 50));
const lift = whatIf(f, { volume: 1, lifts: { checkout: 2 }, costRise: 0 });
check("a step twice as good doubles everything after it", near(lift.revenueCents, 5200000) && near(lift.stages[2].count, 2400) && near(lift.stages[3].count, 1200));
const cap = whatIf(f, { volume: 1, lifts: { paid: 3 }, costRise: 0 });
check("a step cannot be lifted past 100%", near(cap.stages[5].count, 200));
check("left after spend is revenue less spend", near(dbl.afterSpendCents, 5200000 - 600000));
check("$50,000 needs 50,000 ÷ 26,000 times the clicks", near(volumeForRevenue(f, 5_000_000), 5000000 / 2600000));
check("a target with nothing to scale from gives no answer", volumeForRevenue({ ...f, revenueCents: 0 }, 5_000_000) === null);
const nulls = whatIf({ stages: [st("landed", 100), st("checkout", null), st("paid", 10)], bookings: 10, revenueCents: 1000, spendCents: null }, { volume: 3, lifts: {}, costRise: 0 });
check("a step that was not counted stays not counted", nulls.stages[1].count === null && near(nulls.stages[2].count, 30) && nulls.spendCents === null);

console.log("\n  Words");
check("12.5%", ratePct(0.125) === "12.5%");
check("whole percentages have no decimal", ratePct(0.1) === "10%");
check("a tiny rate is not shown as 0%", ratePct(0.0004) === "<0.1%");
check("unknown is a dash", ratePct(null) === "—");
check("1 in 200", oneIn(0.005) === "1 in 200");

async function live() {
  console.log("\n  Live: CUFC summer camps (read-only)");
  const { viewOf } = await import("../server/campaigns/funnels");
  const { pool } = await import("../server/db");
  const campaign: any = { id: 0, name: "Summer camps (test)", startsOn: "2026-10-15", endsOn: null, programIds: [65, 66] };
  const fn: any = { id: 0, campaign_id: 0, name: "Ads", channel_id: 1, program_ids: [], landing_pages: ["join.cufc.co.nz/fundamentals", "join.cufc.co.nz/worldcup"], checkout_pages: ["join.cufc.co.nz/fundamentals/book", "join.cufc.co.nz/worldcup/book"], starts_on: null, ends_on: null, notes: null };
  const ads: any = { id: 1, kind: "meta_ads", name: "Facebook & Instagram ads", meta_campaign_ids: ["120247082333260669", "120247082336180669"], email_campaign_ids: [], utm_campaign: null, manual_spend_cents: null };
  const today = new Date().toISOString().slice(0, 10);
  await pool.query("select 1");
  const t0 = Date.now();
  const adsView = await viewOf(campaign, fn, ads, today);
  const everyone = await viewOf(campaign, { ...fn, channel_id: null }, null, today);
  const ms = Date.now() - t0;
  for (const v of [adsView, everyone]) {
    console.log(`\n    ${v.entryLabel} — ${v.from} to ${v.to}`);
    for (const s of v.stages) console.log(`      ${s.label.padEnd(26)} ${String(s.count).padStart(7)}`);
    console.log(`      bookings ${v.bookings} · revenue $${((v.revenueCents ?? 0) / 100).toFixed(2)} · spend ${v.spendCents == null ? "—" : `$${(v.spendCents / 100).toFixed(2)}`} · all bookings ${v.allBookings}`);
  }
  const web = (v: typeof adsView) => v.stages.filter((s) => s.source !== "meta").map((s) => s.count ?? 0);
  for (const v of [adsView, everyone]) {
    const c = web(v);
    check(`${v.entryLabel}: each step from the page down is no bigger than the one before`, c.every((n, i) => i === 0 || n <= c[i - 1]), c);
    check(`${v.entryLabel}: funnel bookings never exceed all bookings`, (v.bookings ?? 0) <= (v.allBookings ?? 0));
  }
  check("the ads' people are a part of everyone", web(adsView).every((n, i) => n <= web(everyone)[i]));
  check("the ad funnel has Meta's two steps on top", adsView.stages[0].key === "impressions" && adsView.stages[1].key === "clicks" && (adsView.stages[0].count ?? 0) > 0);
  check("the ad funnel carries Meta's spend", adsView.spendSource === "meta" && (adsView.spendCents ?? 0) > 0);
  // The paid count, checked a second way straight from the table.
  const r = await pool.query(
    `select count(*)::int n from registrations r where r.program_id = any($1) and r.status in ('confirmed','refunded','partially_refunded')
       and (coalesce(r.paid_at, r.registered_at at time zone 'UTC') at time zone 'Pacific/Auckland')::date between $2 and $3`,
    [[65, 66], everyone.from, everyone.to],
  );
  check(`all bookings matches a direct count (${r.rows[0].n})`, r.rows[0].n === everyone.allBookings);
  check(`both funnels counted in under 3 seconds (${ms} ms)`, ms < 3000);
  await pool.end();
}

(async () => {
  if (process.argv.includes("--live")) await live();
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) process.exitCode = 1;
})();
