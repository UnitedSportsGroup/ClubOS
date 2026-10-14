// Pure tests for Google Ads attribution. No DB, no network.
//   npx tsx script/_test-google-ads-attribution.ts
//
// Covers: gbraid/wbraid classified as paid Google · click ids read off a landing
// URL · the history picker that now names a conversion's channel · the stamp no
// longer reading a checkout's own `source` as utm_source · the click resolver's
// order (own gclid → same visitor → payer's other visitors, window, bots) · CSV
// shape (TimeZone line, header, NZ wall-clock time incl. DST, value net of
// refunds, dedupe, gclid-only) · Google email normalisation.

import {
  classifyTouch,
  shapeAnalyticsEvent,
  googleClickIdsFromUrl,
  pickHistoryTouch,
} from "../shared/attribution";
import {
  GOOGLE_ADS_CSV_HEADER,
  buildGoogleAdsCsv,
  centsToDecimal,
  formatNzDateTime,
  formatNzIsoWithOffset,
  netPaidCents,
  normalizeEmailForGoogle,
  pickGoogleClick,
} from "../shared/google-ads";
import { renderTrackerScript } from "../shared/tracker-script";

let passed = 0;
const fails: string[] = [];
function check(cond: unknown, msg: string) {
  if (cond) passed++;
  else fails.push(msg);
}
function eq(a: unknown, b: unknown, msg: string) {
  check(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const DAY = 86_400_000;

// ── classifier ──────────────────────────────────────────────────────────────
for (const k of ["gclid", "gbraid", "wbraid"] as const) {
  const t = classifyTouch({ [k]: "abc123" });
  eq([t.channel, t.isPaid, t.matchedBy, t.channelRaw], ["google", true, "paid_google", k], `${k} alone → paid google`);
}
eq(classifyTouch({ gbraid: "{{gbraid}}" }).channel, "direct", "an unreplaced gbraid macro is not a click");
eq(classifyTouch({ wbraid: "undefined" }).isPaid, false, "illegal wbraid is not a click");
eq(classifyTouch({ referrer: "https://www.google.com/" }).isPaid, false, "organic google referrer stays unpaid");
eq(classifyTouch({ utmSource: "facebook", utmMedium: "paid", gbraid: "x" }).channel, "facebook", "Meta UTMs still win over a stray gbraid");

// ── URL capture + collector shape ──────────────────────────────────────────
eq(googleClickIdsFromUrl("https://cufc.co.nz/camps?gbraid=0AAAA&utm_source=google"), { gclid: null, gbraid: "0AAAA", wbraid: null }, "gbraid off URL");
eq(googleClickIdsFromUrl("https://cufc.co.nz/"), { gclid: null, gbraid: null, wbraid: null }, "no ids off a bare URL");
eq(googleClickIdsFromUrl(12), { gclid: null, gbraid: null, wbraid: null }, "non-string URL is safe");
{
  const s = shapeAnalyticsEvent({ visitorId: "v1", sessionId: "s1", eventType: "page_view", wbraid: "W1" }, { userAgent: "Mozilla/5.0 Safari" });
  eq([s?.channel, (s?.metadata as any)?.wbraid], ["google", "W1"], "collector: wbraid → metadata + paid google");
  const u = shapeAnalyticsEvent({ visitorId: "v1", sessionId: "s1", eventType: "page_view", landingUrl: "https://join.cufc.co.nz/x?gclid=G9" }, { userAgent: "Mozilla/5.0 Safari" });
  eq([u?.gclid, u?.channel], ["G9", "google"], "collector: gclid recovered from landing URL");
  const b = shapeAnalyticsEvent({ visitorId: "v1", sessionId: "s1", eventType: "page_view", gbraid: "B", webdriver: true }, { userAgent: "Mozilla/5.0" });
  eq(b?.isBot, true, "collector: webdriver touch flagged as bot");
}
{
  const js = renderTrackerScript({ collectorBase: "https://join.cufc.co.nz", domains: ["cufc.co.nz"] });
  check(js.includes("qp('gbraid')") && js.includes("qp('wbraid')"), "/t.js reads gbraid + wbraid");
  check(js.includes("gbraid:landing.gbraid"), "/t.js sends gbraid on the touch");
  check(Buffer.byteLength(js, "utf8") < 6 * 1024, "/t.js still under 6KB");
}

// ── history picker (stamp fallback) ────────────────────────────────────────
{
  const now = 1_760_000_000_000;
  const touches = [
    { channel: "facebook", utmMedium: "paid", timestampMs: now - 10 * DAY },
    { channel: "google", timestampMs: now - 2 * DAY }, // organic search, later
    { channel: "direct", timestampMs: now - 1 * DAY },
  ];
  eq(pickHistoryTouch(touches, now)?.touch.channel, "facebook", "paid touch beats a later organic one");
  eq(pickHistoryTouch([{ channel: "google", timestampMs: now - DAY }], now)?.isPaid, false, "organic fallback when no paid touch");
  eq(pickHistoryTouch([{ channel: "facebook", utmMedium: "paid", timestampMs: now + DAY }], now), null, "touch after the conversion ignored");
  eq(pickHistoryTouch([{ channel: "facebook", utmMedium: "paid", timestampMs: now - 91 * DAY }], now), null, "touch outside 90 days ignored");
  eq(pickHistoryTouch([{ channel: "facebook", utmMedium: "paid", isBot: true, timestampMs: now - DAY }], now), null, "bot touch ignored");
  eq(pickHistoryTouch([{ channel: "google", gbraid: "B", timestampMs: now - DAY }], now)?.isPaid, true, "gbraid touch counts as paid");
  eq(pickHistoryTouch([{ channel: "direct", timestampMs: now - DAY }], now), null, "direct only → null (stay direct)");
}

// ── resolver order ─────────────────────────────────────────────────────────
{
  const conv = 1_760_000_000_000;
  const t = (o: any) => ({ visitorId: "v", sameVisitor: true, timestampMs: conv - DAY, ...o });
  eq(pickGoogleClick({ ownGclid: "OWN", convertedAtMs: conv, touches: [t({ gclid: "EV" })] })?.id, "OWN", "1. the conversion's own gclid wins");
  const r2 = pickGoogleClick({
    convertedAtMs: conv,
    touches: [t({ gclid: "OLD", timestampMs: conv - 5 * DAY }), t({ gbraid: "NEW", timestampMs: conv - 2 * DAY }), t({ gclid: "P", sameVisitor: false, timestampMs: conv - DAY })],
  });
  eq([r2?.id, r2?.type, r2?.source], ["NEW", "gbraid", "visitor"], "2. latest click on the SAME visitor beats a later click on another of the payer's visitors");
  const r3 = pickGoogleClick({ convertedAtMs: conv, touches: [t({ wbraid: "W", sameVisitor: false })] });
  eq([r3?.id, r3?.source], ["W", "person"], "3. falls back to the payer's other visitors");
  eq(pickGoogleClick({ convertedAtMs: conv, touches: [t({ gclid: "X", timestampMs: conv - 91 * DAY })] }), null, "click older than 90 days ignored");
  eq(pickGoogleClick({ convertedAtMs: conv, touches: [t({ gclid: "X", timestampMs: conv + 1000 })] }), null, "click after the conversion ignored");
  eq(pickGoogleClick({ convertedAtMs: conv, touches: [t({ gclid: "X", isBot: true })] }), null, "automated (webdriver) visitor ignored");
  eq(pickGoogleClick({ ownGclid: "{{gclid}}", convertedAtMs: conv, touches: [] }), null, "macro gclid on the row is not a click");
}

// ── values + time ──────────────────────────────────────────────────────────
eq(netPaidCents(16000, null), 16000, "no refund");
eq(netPaidCents(16000, 4800), 11200, "partial refund netted");
eq(netPaidCents(5000, 9000), 0, "never negative");
eq(centsToDecimal(11200), "112.00", "dollars 2dp");
eq(centsToDecimal(5), "0.05", "cents pad");
eq(formatNzDateTime(Date.UTC(2026, 0, 15, 2, 30, 0)), "2026-01-15 15:30:00", "NZDT (+13) in January");
eq(formatNzDateTime(Date.UTC(2026, 5, 15, 2, 30, 0)), "2026-06-15 14:30:00", "NZST (+12) in June");
eq(formatNzDateTime(Date.UTC(2026, 9, 13, 11, 5, 9)), "2026-10-14 00:05:09", "crosses midnight into the NZ date, 24h clock");

// ── Data Manager shape (default) ──
{
  eq(formatNzIsoWithOffset(Date.UTC(2026, 0, 15, 2, 30, 0)), "2026-01-15T15:30:00+13:00", "ISO with NZDT offset");
  eq(formatNzIsoWithOffset(Date.UTC(2026, 5, 15, 2, 30, 0)), "2026-06-15T14:30:00+12:00", "ISO with NZST offset");
  const dm = buildGoogleAdsCsv([{ orderId: "reg-1", gclid: "Cj0KCQ", convertedAtMs: Date.UTC(2026, 0, 15, 2, 30, 0), valueCents: 11200, currency: "NZD" }]);
  const l = dm.trimEnd().split("\r\n");
  eq(l[0], GOOGLE_ADS_CSV_HEADER.join(","), "default: header is the FIRST line (no Parameters line)");
  eq(l[1], "Cj0KCQ,ClubOS Purchase,2026-01-15T15:30:00+13:00,112.00,NZD,reg-1", "default row carries the zone in the time");
  eq(buildGoogleAdsCsv([]).split("\r\n").length, 2, "empty default export = header only");
}

// ── CSV ────────────────────────────────────────────────────────────────────
{
  const csv = buildGoogleAdsCsv([
    { orderId: "reg-1", gclid: "Cj0KCQ", convertedAtMs: Date.UTC(2026, 0, 15, 2, 30, 0), valueCents: 11200, currency: "nzd" },
    { orderId: "reg-1", gclid: "Cj0KCQ", convertedAtMs: Date.UTC(2026, 0, 15, 2, 30, 0), valueCents: 11200, currency: "NZD" },
    { orderId: "reg-2", gclid: "G2", convertedAtMs: Date.UTC(2026, 0, 15, 2, 30, 0), valueCents: 0, currency: "NZD" },
    { orderId: "reg-3", gclid: "undefined", convertedAtMs: Date.UTC(2026, 0, 15, 2, 30, 0), valueCents: 500, currency: "NZD" },
  ], { legacy: true });
  const lines = csv.trimEnd().split("\r\n");
  eq(lines[0], "Parameters:TimeZone=Pacific/Auckland", "first line is the TimeZone parameter");
  eq(lines[1], GOOGLE_ADS_CSV_HEADER.join(","), "header row");
  eq(lines[1], "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID", "header text exact");
  eq(lines[2], "Cj0KCQ,ClubOS Purchase,2026-01-15 15:30:00,112.00,NZD,reg-1", "row: NZ time, net value, upper currency, order id");
  eq(lines.length, 3, "duplicate order id, zero value and junk gclid all dropped");
  check(!csv.includes("@"), "no email in the default export");
  const withHash = buildGoogleAdsCsv([{ orderId: "reg-9", gclid: "G", convertedAtMs: 0, valueCents: 100, currency: "NZD", emailSha256: "ab" }], { includeEmailHash: true, legacy: true });
  check(withHash.split("\r\n")[1].endsWith(",Email") && withHash.includes(",reg-9,ab"), "opt-in hash column");
  eq(buildGoogleAdsCsv([], { legacy: true }).split("\r\n").length, 3, "empty legacy export is still a valid file (param + header)");
  const q = buildGoogleAdsCsv([{ orderId: 'x,"y', gclid: "G", convertedAtMs: 0, valueCents: 100, currency: "NZD" }]);
  check(q.includes('"x,""y"'), "CSV quoting");
}

// ── email normalisation ────────────────────────────────────────────────────
eq(normalizeEmailForGoogle("  Jane.Doe@GMAIL.com "), "janedoe@gmail.com", "gmail dots dropped, lowercased");
eq(normalizeEmailForGoogle("jane.doe@xtra.co.nz"), "jane.doe@xtra.co.nz", "non-gmail dots kept");
eq(normalizeEmailForGoogle("nope"), null, "not an address");

// ── stamp: a checkout's own `source` is not a utm_source ───────────────────
async function stampTests() {
  process.env.DATABASE_URL ||= "postgres://nobody@127.0.0.1:1/none"; // never connected
  const { pick, readAttributionStamp } = await import("../server/attribution-stamp");
  eq(pick({ source: "cufc-website" }, ["utmSource", "utm_source"], ["source"]), null, "top-level source ignored");
  eq(pick({ source: "cufc-website", utm: { source: "facebook" } }, ["utmSource", "utm_source"], ["source"]), "facebook", "utm.source read");
  eq(pick({ utmSource: "ig" }, ["utmSource", "utm_source"], ["source"]), "ig", "utmSource read");
  const req = (body: any) => ({ body, headers: {} }) as any;
  eq(readAttributionStamp(req({ source: "cufc-website" })).attributionChannel, "direct", "academy checkout with only source → direct (not 'other')");
  eq(readAttributionStamp(req({ source: "x", utm: { source: "facebook", medium: "paid" } })).attributionChannel, "facebook", "nested utm still classifies");
  eq(readAttributionStamp(req({ gbraid: "B" })).attributionChannel, "google", "gbraid in body → google");
}

stampTests()
  .catch((e) => fails.push(`stamp tests threw: ${e?.message ?? e}`))
  .finally(() => {
    if (fails.length) {
      console.log(`FAIL ${fails.length} (passed ${passed})`);
      for (const f of fails) console.log("  ✗ " + f);
      process.exit(1);
    }
    console.log(`PASS ${passed} checks`);
    process.exit(0);
  });
