// Run by a HUMAN after the deploy that ships Google Ads attribution.
//   GOOGLE_ADS_EXPORT_USER=… GOOGLE_ADS_EXPORT_PASSWORD=… \
//     npx tsx --env-file=.env script/_verify-google-ads-export-live.ts
//
// Read-only. Asserts:
//   - the export 404s with no auth and with wrong auth (and with right user, wrong password)
//   - with the real credentials it returns text/csv starting with the TimeZone
//     parameter and Google's header row, and every data row has 6 cells
//   - /t.js on join.cufc.co.nz (and the other funnel hosts) ships gbraid + wbraid
//   - the admin attribution check is gated (401 without a session)
// Uses curl, not node fetch (node's outbound fetch has been dead on this Mac).

import { execFileSync } from "child_process";
import { GOOGLE_ADS_CSV_HEADER } from "../shared/google-ads";

const BASE = process.env.BASE || "https://app.usg.co.nz";
const URL_CSV = `${BASE}/api/integrations/google-ads/conversions.csv`;
const user = process.env.GOOGLE_ADS_EXPORT_USER || "";
const pass = process.env.GOOGLE_ADS_EXPORT_PASSWORD || "";

let passed = 0;
const fails: string[] = [];
const check = (c: unknown, m: string) => (c ? passed++ : fails.push(m));

function curl(url: string, auth?: string): { status: number; type: string; body: string } {
  const args = ["-s", "-o", "-", "-w", "\n__STATUS__%{http_code} %{content_type}", url];
  if (auth !== undefined) args.unshift("-u", auth);
  const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const i = out.lastIndexOf("\n__STATUS__");
  const [status, ...type] = out.slice(i + "\n__STATUS__".length).split(" ");
  return { status: Number(status), type: type.join(" "), body: out.slice(0, i) };
}

check(curl(URL_CSV).status === 404, "export: no auth → 404");
check(curl(URL_CSV, "nobody:wrong").status === 404, "export: wrong auth → 404");
if (user) check(curl(URL_CSV, `${user}:definitely-not-the-password`).status === 404, "export: right user, wrong password → 404");

if (!user || !pass) {
  fails.push("GOOGLE_ADS_EXPORT_USER / GOOGLE_ADS_EXPORT_PASSWORD not set locally — authenticated checks skipped");
} else {
  const r = curl(URL_CSV, `${user}:${pass}`);
  check(r.status === 200, `export: with auth → 200 (got ${r.status})`);
  check(/text\/csv/.test(r.type), `export: content-type text/csv (got ${r.type})`);
  const lines = r.body.split(/\r?\n/).filter((l) => l.length);
  check(lines[0] === "Parameters:TimeZone=Pacific/Auckland", `export: first line is the TimeZone parameter (got ${lines[0]})`);
  check(lines[1] === GOOGLE_ADS_CSV_HEADER.join(","), `export: header row (got ${lines[1]})`);
  const bad = lines.slice(2).filter((l) => l.split(",").length !== 6 || !/,ClubOS Purchase,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d+\.\d\d,[A-Z]{3},(reg|shop)-\d+$/.test(l));
  check(bad.length === 0, `export: every data row well-formed (bad: ${bad.slice(0, 3).join(" | ")})`);
  check(!r.body.includes("@"), "export: no email address in the default export");
  console.log(`  export rows: ${Math.max(0, lines.length - 2)}`);
}

for (const host of ["join.cufc.co.nz", "join.minifootball.co.nz"]) {
  const t = curl(`https://${host}/t.js`);
  check(t.status === 200, `${host}/t.js → 200`);
  check(t.body.includes("gbraid") && t.body.includes("wbraid"), `${host}/t.js carries gbraid + wbraid`);
}
const a = curl(`${BASE}/analytics.js`);
check(a.body.includes("gbraid"), "analytics.js (checkout pages) carries gbraid");

check(curl(`${BASE}/api/admin/google-ads/attribution-check`).status === 401, "admin attribution check: 401 without a session (404 = not deployed)");

if (fails.length) {
  console.log(`FAIL ${fails.length} (passed ${passed})`);
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
console.log(`PASS ${passed} checks`);
