/**
 * Google Analytics 4 — daily totals and sessions by channel for one property.
 *
 * Auth is the cufc-aios service account (the one the Mac collectors used),
 * supplied to this server as base64 JSON in MARKETING_GA4_SA_JSON_B64. It needs
 * only Viewer on each property. Verified 2026-09-15: it reads cufc.co.nz,
 * CUFC Shop, South Island United and CIC Youth.
 */
import { JWT } from "google-auth-library";
import { NotConfiguredError } from "./common";
import type { DailyRow, PullContext } from "./sync";

let client: JWT | null = null;

function ga4Client(): JWT {
  if (client) return client;
  const b64 = process.env.MARKETING_GA4_SA_JSON_B64;
  if (!b64) throw new NotConfiguredError("MARKETING_GA4_SA_JSON_B64 is not set on this server.");
  let creds: { client_email?: string; private_key?: string };
  try {
    creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new Error("MARKETING_GA4_SA_JSON_B64 is not valid base64-encoded JSON.");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error("MARKETING_GA4_SA_JSON_B64 is missing client_email or private_key.");
  }
  client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return client;
}

type Ga4Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

async function runReport(propertyId: string, body: Record<string, unknown>): Promise<Ga4Row[]> {
  const out: Ga4Row[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    let data: any;
    try {
      const res = await ga4Client().request({
        url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        method: "POST",
        data: { ...body, limit: 10000, offset },
      });
      data = res.data;
    } catch (e: any) {
      if (e instanceof NotConfiguredError) throw e;
      const msg = e?.response?.data?.error?.message ?? e?.message ?? String(e);
      throw new Error(`Google Analytics: ${msg}`);
    }
    const rows: Ga4Row[] = data?.rows ?? [];
    out.push(...rows);
    offset += rows.length;
    const total = Number(data?.rowCount ?? 0);
    if (!rows.length || offset >= total) break;
  }
  return out;
}

/** GA4 reports dates as YYYYMMDD in the property's own timezone (NZ for all of ours). */
function ga4Day(raw: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const int = (v: string | undefined) => Math.max(0, Math.round(Number(v ?? 0) || 0));

export async function pullGa4(ctx: PullContext): Promise<void> {
  const propertyId = ctx.source.external_id;
  if (!/^\d+$/.test(propertyId)) throw new Error(`"${propertyId}" is not a GA4 property id.`);
  const dateRanges = [{ startDate: ctx.from, endDate: ctx.to }];

  const totals = await runReport(propertyId, {
    dateRanges,
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "screenPageViews" }, { name: "keyEvents" }],
  });
  const rows: DailyRow[] = [];
  for (const r of totals) {
    const day = ga4Day(r.dimensionValues?.[0]?.value);
    if (!day) continue;
    const v = r.metricValues ?? [];
    const base = { day, dimType: "total" as const, dimKey: "", dimLabel: null };
    rows.push({ ...base, metric: "sessions", value: int(v[0]?.value) });
    rows.push({ ...base, metric: "engaged_sessions", value: int(v[1]?.value) });
    rows.push({ ...base, metric: "page_views", value: int(v[2]?.value) });
    rows.push({ ...base, metric: "key_events", value: int(v[3]?.value) });
  }

  const byChannel = await runReport(propertyId, {
    dateRanges,
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
  });
  for (const r of byChannel) {
    const day = ga4Day(r.dimensionValues?.[0]?.value);
    const channel = r.dimensionValues?.[1]?.value || "Unassigned";
    if (!day) continue;
    rows.push({
      day,
      dimType: "channel",
      dimKey: channel,
      dimLabel: channel,
      metric: "sessions",
      value: int(r.metricValues?.[0]?.value),
    });
  }
  await ctx.write(rows);
}
