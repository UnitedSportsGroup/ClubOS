/**
 * Seed Sponsorship Partners from the contracts read out of the club's Google
 * Drive "Contracts" folder (23 Oct 2026).
 *
 *   npx tsx --env-file=.env script/seed-sponsorship-partners.ts --src <dir>             # DRY RUN — prints the plan, writes nothing
 *   npx tsx --env-file=.env script/seed-sponsorship-partners.ts --src <dir> --commit    # writes partners, contracts, instalments, deliverables; uploads the signed files
 *   …                                                                      --replace   # with --commit: re-create an existing partner's contracts from the extraction
 *
 * <dir> holds extract/all.json (one object per sponsor folder, written by the
 * readers who LOOKED at every signature page), drive_inventory.json (the folder
 * listing with Google's created/modified stamps), manifest.json (local copies)
 * and prepped.json (extracted text, incl. OCR of the six scans).
 *
 * Rules this seed keeps:
 *   - 🔴 Signed is king. THE contract file is the one the reader marked signed;
 *     a folder with nothing signed still gets its best copy attached, with the
 *     signature status saying so in red. Nothing is invented: a blank in the
 *     document is NULL here.
 *   - The file lands in Club Drive under "Sponsor Contracts / <Company>" — the
 *     folder gated to the Sponsorship tab — by its Google id, so a re-run never
 *     doubles it. The Google Drive link rides along as contract_source_url.
 *   - Instalments: the contract's own dated schedule as written; multi-year
 *     contracts with a yearly fee also get one row per contract year, labelled
 *     as derived. Paid-or-not comes ONLY from Xero (a snapshot of the sponsor
 *     invoices, --xero <sponsors.json>): an instalment is marked paid when an
 *     invoice of the same amount (to the dollar, GST-inclusive) in the window
 *     is fully paid; anything partial is a note, never a tick.
 *   - Every reader flag and gap lands on the contract's flags, so the page says
 *     where the document contradicts itself.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  organizations, sponsorshipDeals, sponsorshipDeliverables, sponsorshipPartners,
  sponsorshipPartnerContracts, sponsorshipPartnerPayments, sponsors,
} from "../shared/schema";
import { addMonths, daysBetween, isIsoDate } from "../shared/sponsorship-partners";
import { findStoredContractBySourceId, storeContractFile } from "../server/sponsorship-partner-files";

const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const COMMIT = flag("--commit");
const REPLACE = flag("--replace");
const SRC = opt("--src");
const XERO = opt("--xero") ?? "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/club-finance-2026/sponsors.json";
const XERO_LIVE = opt("--xero-live");
const TODAY = new Date(Date.now() + 13 * 3600 * 1000).toISOString().slice(0, 10); // NZDT
const XERO_CONTACTS = opt("--xero-contacts") ?? "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/club-finance-2026/xero_contacts.json";
if (!SRC) { console.error("--src <dir> required"); process.exit(2); }

const ORG_SLUG = "united-sports-group";

// Folder → how the club knows them. Company is the name a manager will search
// for; keywords find the Xero contact and the Sponsor Traffic row; deal is the
// pipeline deal that won them (probed on production, 23 Oct 2026).
const META: Record<string, { company: string; keywords: string[]; deal?: number; brand?: string }> = {
  "Better Football":        { company: "Better Football",                   keywords: ["better football"], deal: 47 },
  "Cupra (Miles Group)":    { company: "CUPRA Christchurch (Miles Group)",  keywords: ["cupra", "miles christchurch"] },
  "Drifter Hotels":         { company: "The Drifter",                       keywords: ["drifter"] },
  "Flamin Pizza":           { company: "Flamin Pizza",                      keywords: ["flamin"] },
  "Formosa Foods":          { company: "Formosa Foods",                     keywords: ["formosa"] },
  "Frontrunner Northlands": { company: "Frontrunner Northlands",            keywords: ["frontrunner"] },
  "Fusion 5":               { company: "Fusion5",                           keywords: ["fusion5", "fusion 5"] },
  "Go Media":               { company: "Go Media",                          keywords: ["go media"] },
  "Happy Helper":           { company: "Happy Helper",                      keywords: ["happy helper"] },
  "Heartland Technologies": { company: "Heartland Technology",              keywords: ["heartland"], deal: 42 },
  "Lone Star":              { company: "Lone Star",                         keywords: ["lonestar", "lone star"] },
  "LT McGuiness":           { company: "LT McGuinness",                     keywords: ["mcguiness", "mcguinness"] },
  "Milano Tiling":          { company: "Milano Tiling",                     keywords: ["milano"] },
  "Pak n Save Tamatea":     { company: "Pak'nSave Tamatea",                 keywords: ["tamatea", "pak n save tam", "pak'nsave tam"], deal: 24 },
  "Perennial Sport & Turf": { company: "Perennial Sport & Turf",            keywords: ["perennial"], deal: 55 },
  "Platform Sports":        { company: "Platform Sports Management",        keywords: ["platform sports"] },
  "Revamp Digital":         { company: "Revamp Digital",                    keywords: ["revamp"], deal: 25 },
  "Ricardo Felitti":        { company: "Harcourts Grenadier (Ricardo Felitti)", keywords: ["harcourts", "felitti"], deal: 30 },
  "Shadeplus":              { company: "Shadeplus",                         keywords: ["shadeplus", "shade plus", "radburn"], deal: 29 },
  "SMC Design Studio":      { company: "SMC Design Studio",                 keywords: ["smc design"] },
  "Victoria Foods":         { company: "Victoria Foods",                    keywords: ["victoria foods"] },
  "Your Local Services":    { company: "Your Local Services",               keywords: ["your local", "pongracz"], deal: 31 },
};

const phone = (v: unknown): string | null => {
  const raw = v == null ? "" : typeof v === "object" ? String((v as any).number ?? (v as any).PhoneNumber ?? "") : String(v);
  const d = raw.replace(/[^\d+]/g, "");
  if (!d) return null;
  if (/^64\d{8,10}$/.test(d)) return `+64 ${d.slice(2, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^0\d{8,9}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return raw.trim().slice(0, 60) || null;
};
const BRANDS = new Set(["cufc", "siu", "mfl", "cic", "usc", "gymnastics", "academy", "print", "usg"]);
const lower = (s: unknown) => String(s ?? "").toLowerCase();
const iso = (v: unknown): string | null => (typeof v === "string" && isIsoDate(v.slice(0, 10)) ? v.slice(0, 10) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const text = (v: unknown, max = 20000): string | null => { if (v === null || v === undefined) return null; const s = Array.isArray(v) ? v.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") : String(v); return s.trim() ? s.trim().slice(0, max) : null; };

const extract: any[] = JSON.parse(readFileSync(join(SRC, "extract", "all.json"), "utf8"));
const inventory: any = JSON.parse(readFileSync(join(SRC, "drive_inventory.json"), "utf8"));
const manifest: any[] = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
const prepped: any[] = JSON.parse(readFileSync(join(SRC, "prepped.json"), "utf8"));
const xero: any = existsSync(XERO) ? JSON.parse(readFileSync(XERO, "utf8")) : null;
const xeroLive: Record<string, any> | null = XERO_LIVE && existsSync(XERO_LIVE) ? JSON.parse(readFileSync(XERO_LIVE, "utf8")) : null;
const xeroContacts: any[] = existsSync(XERO_CONTACTS) ? JSON.parse(readFileSync(XERO_CONTACTS, "utf8")) : [];
const byId = new Map<string, any>(inventory.files.map((f: any) => [f.id, f]));
const localById = new Map<string, any>(manifest.map((m: any) => [m.id, m]));
const preppedById = new Map<string, any>(prepped.map((p: any) => [p.id, p]));

function xeroRow(keywords: string[]) {
  const rows: any[] = xero?.rows ?? [];
  return rows.find(r => keywords.some(k => lower(r.sponsor).includes(k))) ?? null;
}
function xeroContact(keywords: string[]) {
  const hits = xeroContacts.filter(c => keywords.some(k => lower(c.name).includes(k)));
  return hits.find(c => String(c.name).startsWith("(S)")) ?? hits.find(c => c.email) ?? hits[0] ?? null;
}

type Plan = { line: string; warn?: boolean };
const plan: Plan[] = [];
const say = (line: string, warn = false) => { plan.push({ line, warn }); console.log((warn ? "  ⚠ " : "    ") + line); };

type PayRow = { label: string | null; dueOn: string | null; amountCents: number; gstIncluded: boolean; notes: string | null; paidOn?: string | null; paidCents?: number | null; xeroInvoiceNumber?: string | null };
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const num = (w: string) => WORDS[w.toLowerCase()] ?? parseInt(w, 10);
const dmy = (d: string, m: string, y: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
const near = (a: string | null, b: string | null, days = 3) => !!a && !!b && Math.abs(daysBetween(a, b)) <= days;
const LEDGER_FROM = "2025-01-01"; // the Xero snapshot starts here; earlier instalments cannot be checked, so they are not listed

function expandSchedule(k: any, start: string | null, termMonths: number | null, cashPerYear: number | null, flags: string[]): PayRow[] {
  const entries: any[] = ((k.payment_schedule ?? []) as any[]).filter(p => int(p.amount_cents) && int(p.amount_cents)! > 0);
  if (cashPerYear === 0) return []; // a contra deal: invoices offset each other, nothing falls due in cash
  const years = termMonths ? Math.max(1, Math.round(termMonths / 12)) : 1;
  const rows: PayRow[] = [];
  const push = (r: PayRow) => { if (!rows.some(x => near(x.dueOn, r.dueOn) && x.amountCents === r.amountCents)) rows.push(r); };
  const gst = (p: any) => p.gst === "incl";
  const dated = entries.filter(p => iso(p.due));
  for (const [i, p] of dated.entries()) push({ label: `Instalment ${i + 1}`, dueOn: iso(p.due), amountCents: int(p.amount_cents)!, gstIncluded: gst(p), notes: text(p.note, 500) });
  for (const p of entries.filter(p => !iso(p.due))) {
    const t = `${p.due ?? ""} ${p.note ?? ""}`;
    const amt = int(p.amount_cents)!;
    if (/option ?(b|2)|alternative|variant/i.test(t) && !/upfront/i.test(t)) continue; // "or 6 monthly payments" — the alternative, not the deal
    const m1 = /(\d+|twelve|six|five|four|three|two)\s+['"]?(?:separate|monthly)?['"]?\s*(?:payments|instal?lments)[^\d]{0,40}?(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
    const monthlyWord = /monthly/i.test(t);
    const perYear = /(\d+|twelve|six|five|four|three|two)\s+['"]?(?:separate|monthly)?['"]?\s*(?:payments|instal?lments)/i.exec(t);
    if (m1) {
      const n = num(m1[1]); const first = dmy(m1[2], m1[3], m1[4]);
      if (Math.abs(n * amt - (cashPerYear ?? n * amt)) <= (cashPerYear ?? 0) * 0.05 + 100) {
        for (let i = 0; i < n; i++) push({ label: `Instalment ${i + 1} of ${n}`, dueOn: addMonths(first, i), amountCents: amt, gstIncluded: gst(p), notes: `Expanded from the contract wording: "${String(p.due).slice(0, 120)}"` });
        continue;
      }
    }
    if (monthlyWord && dated.length && termMonths) {
      const first = iso(dated[0].due)!; const n = termMonths;
      if (cashPerYear && Math.abs(n * amt - cashPerYear * years) <= cashPerYear * years * 0.1) {
        for (let i = 1; i < n; i++) push({ label: `Instalment ${i + 1} of ${n}`, dueOn: addMonths(first, i), amountCents: amt, gstIncluded: gst(p), notes: `Expanded from the contract wording: "${String(p.due).slice(0, 120)}" — ${n} monthly from the first payment` });
        continue;
      }
    }
    if (perYear && start && (monthlyWord || /instal/i.test(t))) {
      const n = num(perYear[1]);
      if (cashPerYear && Math.abs(n * amt - cashPerYear) <= cashPerYear * 0.05 + 100) {
        for (let y = 0; y < years; y++) for (let i = 0; i < n; i++) push({ label: `Year ${y + 1} · instalment ${i + 1} of ${n}`, dueOn: addMonths(addMonths(start, 12 * y), i), amountCents: amt, gstIncluded: gst(p), notes: `Derived: ${n} monthly instalments per contract year from the term start (the contract gives no dates)` });
        flags.push(`Instalment dates are derived from the term start — the contract says "${String(p.due).slice(0, 100)}" without dates.`);
        continue;
      }
    }
    if (cashPerYear && Math.abs(amt - cashPerYear) <= 100 && start) {
      for (let y = 0; y < years; y++) push({ label: years > 1 ? `Year ${y + 1}` : "Payment", dueOn: addMonths(start, 12 * y), amountCents: amt, gstIncluded: gst(p), notes: `Derived: due at the start of the ${years > 1 ? "contract year" : "term"} — the contract says "${String(p.due).slice(0, 100)}"` });
      continue;
    }
    push({ label: `Instalment (${String(p.due ?? "").slice(0, 60)})`, dueOn: null, amountCents: amt, gstIncluded: gst(p), notes: text(p.note, 500) });
  }
  if (!rows.length && cashPerYear && start) {
    for (let y = 0; y < years; y++) push({ label: years > 1 ? `Year ${y + 1}` : "Year 1", dueOn: addMonths(start, 12 * y), amountCents: cashPerYear, gstIncluded: false, notes: "Derived from the term: one instalment per contract year. The contract's own wording is under Payment terms." });
  } else if (cashPerYear && start && years > 1 && rows.every(r => r.dueOn && daysBetween(start, r.dueOn) < 366)) {
    // a dated first-year schedule on a multi-year deal: later years fall due on the anniversary
    for (let y = 1; y < years; y++) push({ label: `Year ${y + 1}`, dueOn: addMonths(start, 12 * y), amountCents: cashPerYear, gstIncluded: false, notes: "Derived: the annual fee on the anniversary of the term start." });
  }
  return rows.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}

// Documented corrections where the contract's own words change a derived
// amount. Each one names its clause; nothing here is a guess.
const OVERRIDES: Record<string, { label: string; amountCents: number; why: string }[]> = {
  "Shadeplus": [{ label: "Year 1", amountCents: 340000, why: "Contract: \"$4,000 + GST p/a less $600 for prior work completed by Shadeplus\" — Year 1 is $3,400 + GST ($3,910), which is the invoice Xero holds." }],
};
// Where an earlier agreement with the same sponsor was still being paid as this
// one began, only invoices from this date count towards this contract.
const XERO_FROM: Record<string, { date: string; why: string }> = {
  "Fusion5": { date: "2026-01-01", why: "INV-15286 (Nov 2025, $17,250) is the last three instalments of the 2025 agreement; this contract is invoiced as INV-15439 (21 Jan 2026, $69,000) — finance review 23 Sep 2026." },
};

function allocateXero(pays: PayRow[], xr: any, live: any | null, today: string, flags: string[], term: { start: string | null; end: string | null }) {
  // Live pull (--xero-live): the payments on this sponsor's sponsorship
  // invoices DATED WITHIN THIS CONTRACT'S WINDOW (a month and a half before the
  // start to three months after the end), allocated to instalments oldest-first
  // the way a debtor ledger reads. Each instalment is "paid" on the date of the
  // payment that completed it. A sponsor who paid the year up front is simply
  // paid; money beyond the listed instalments becomes a flag, never a row.
  const inclOf = (p: PayRow) => (p.gstIncluded ? p.amountCents : Math.round(p.amountCents * 1.15));
  const dated = pays.filter(x => x.dueOn).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  if (live) {
    const firstDue = dated[0]?.dueOn ?? null;
    const from = term.start ? addMonths(term.start, -5) : firstDue ? addMonths(firstDue, -5) : null;
    const to = term.end ? addMonths(term.end, 3) : null;
    const invs: any[] = (live.invoices ?? []).filter((v: any) => (!from || String(v.date) >= from) && (!to || String(v.date) <= to));
    const outside: any[] = (live.invoices ?? []).filter((v: any) => !invs.includes(v));
    const pulled = live.pulledAt?.slice(0, 10) ?? today;
    const payments = invs.flatMap((v: any) => (v.payments ?? []).map((q: any) => ({ date: String(q.date), cents: Math.round(q.amount * 100), invoice: v.number }))).sort((a, b) => a.date.localeCompare(b.date));
    let i = 0, carry = 0, carryDate = "", carryInv = "";
    let stopped = false;
    for (const p of dated) {
      const need = inclOf(p);
      let have = carry, last = carryDate, inv = carryInv;
      while (have < need && i < payments.length) { have += payments[i].cents; last = payments[i].date; inv = payments[i].invoice; i++; }
      if (have >= need) {
        carry = have - need; carryDate = last; carryInv = inv;
        p.paidOn = last; p.paidCents = need; p.xeroInvoiceNumber = inv;
        p.notes = [p.notes, `Paid — ${inv} in Xero, completed by the payment of ${last} (pulled ${pulled})`].filter(Boolean).join(" · ");
      } else {
        carry = 0; stopped = true;
        const invMatch = invs.find((v: any) => Math.abs(Math.round(v.total * 100) - need) <= 100 && Math.abs(daysBetween(p.dueOn!, String(v.date))) <= 200);
        if (invMatch) p.xeroInvoiceNumber = invMatch.number;
        if (have >= 1000) p.notes = [p.notes, `$${(have / 100).toLocaleString()} of $${(need / 100).toLocaleString()} received so far per Xero (pulled ${pulled})`].filter(Boolean).join(" · ");
        else if (p.dueOn! <= today) p.notes = [p.notes, `Not paid per Xero (pulled ${pulled})${invMatch ? ` — ${invMatch.number} ${invMatch.status}` : ""}`].filter(Boolean).join(" · ");
        break;
      }
    }
    if (!stopped) for (const p of dated) if (!p.paidOn && p.dueOn! <= today) p.notes = [p.notes, `Not paid per Xero (pulled ${pulled})`].filter(Boolean).join(" · ");
    const leftover = carry + payments.slice(i).reduce((s2, q) => s2 + q.cents, 0);
    if (leftover > 1000) flags.push(`Xero shows $${(leftover / 100).toLocaleString()} received on ${Array.from(new Set(invs.map((v: any) => v.number))).join(", ")} beyond the instalments listed here (pulled ${pulled}) — the schedule or the invoicing differs from the contract.`);
    if (!dated.length && invs.length) flags.push(`Xero holds sponsorship invoices in this term: ${invs.map((v: any) => `${v.number} $${Number(v.total).toLocaleString()} (paid $${Number(v.paid ?? 0).toLocaleString()}${v.credited ? `, credited $${Number(v.credited).toLocaleString()}` : ""})`).join("; ")} (pulled ${pulled}).`);
    if (outside.length) flags.push(`Xero also holds ${outside.length} sponsorship invoice(s) outside this term: ${outside.map((v: any) => `${v.number} ${String(v.date).slice(0, 10)} $${Number(v.total).toLocaleString()}`).join("; ")}.`);
    return;
  }
  if (!xr) return;
  // Snapshot fallback (sponsors.json, 23 Sep 2026): the money received since 1 Jan 2025, oldest-first.
  const asAt = String(xero?.asAt ?? "2026-09-23");
  const invs: any[] = (xr.invs ?? []).slice().sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
  const paysIn: any[] = (xr.pays ?? []).slice().sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
  let cash = Math.round(invs.reduce((s2: number, v: any) => s2 + (v.paid ?? 0), 0) * 100);
  for (const p of dated.filter(x => x.dueOn! <= addMonths(asAt, 1))) {
    const incl = inclOf(p);
    if (cash >= incl) { cash -= incl; p.paidOn = paysIn.filter((x: any) => String(x.date) >= addMonths(p.dueOn!, -2) && String(x.date) <= asAt)[0]?.date ?? asAt; p.paidCents = incl; p.notes = [p.notes, `Paid per Xero (snapshot ${asAt})`].filter(Boolean).join(" · "); }
    else if (cash > 0) { p.notes = [p.notes, `$${(cash / 100).toLocaleString()} of $${(incl / 100).toLocaleString()} paid as at ${asAt} per Xero`].filter(Boolean).join(" · "); cash = 0; }
    else if (p.dueOn! <= asAt) p.notes = [p.notes, `Not paid as at ${asAt} per Xero`].filter(Boolean).join(" · ");
  }
}

async function main() {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, ORG_SLUG));
  if (!org) throw new Error("United Sports Group workspace not found");
  const sponsorRows = await db.select().from(sponsors);
  const deals = await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.organizationId, org.id));

  console.log(`\n  Sponsorship Partners seed — ${COMMIT ? "COMMIT" : "DRY RUN (nothing written)"}${REPLACE ? " + REPLACE" : ""}\n  ${extract.length} sponsor folders · org ${org.id} ${org.slug}\n`);
  let created = 0, skipped = 0, contracts = 0, payments = 0, deliverables = 0, uploads = 0;

  for (const e of extract) {
    const meta = META[e.folder];
    if (!meta) { say(`${e.folder}: no META entry — skipped`, true); continue; }
    console.log(`\n  ── ${meta.company}  (folder "${e.folder}")`);
    const k = e.contract ?? {};
    const brandTags = Array.from(new Set((e.brand_tags ?? []).map(lower).filter((b: string) => BRANDS.has(b))));
    const deal = meta.deal ? deals.find(d => d.id === meta.deal) ?? null : null;
    const xr = xeroRow(meta.keywords);
    const xc = xeroContact(meta.keywords);
    const link = sponsorRows.find(s => meta.keywords.some(kw => lower(s.name).includes(kw)) && (brandTags.includes(s.brand) || s.brand === "cufc")) ?? sponsorRows.find(s => meta.keywords.some(kw => lower(s.name).includes(kw))) ?? null;

    const contact = e.contact ?? {};
    const partnerVals = {
      organizationId: org.id,
      company: meta.company,
      brandTags,
      // The day-to-day person: the pipeline deal's contact when it has an email
      // (a real relationship), else the contract's own contact with the email
      // accounts files them under. The signatory stays on the contract row.
      ...(deal?.primaryContactEmail
        ? { primaryContactName: deal.primaryContactName, primaryContactRole: text(contact.name, 200) && lower(contact.name) !== lower(deal.primaryContactName) ? `Signatory: ${text(contact.name, 120)}` : text(contact.role, 200), primaryContactEmail: deal.primaryContactEmail, primaryContactPhone: deal.primaryContactPhone ?? phone(xc?.phones?.[0]) }
        : { primaryContactName: text(contact.name, 200) ?? (xc?.people?.[0] ? `${xc.people[0].first ?? ""} ${xc.people[0].last ?? ""}`.trim() || null : null), primaryContactRole: text(contact.role, 200), primaryContactEmail: text(contact.email, 200) ?? (xc?.email ? String(xc.email) : null), primaryContactPhone: phone(text(contact.phone, 60) ?? xc?.phones?.[0]) }),
      dealId: deal?.id ?? null,
      sponsorLinkId: link?.id ?? null,
      xeroContactName: xr?.sponsor ?? (xc?.name && String(xc.name).startsWith("(S)") ? xc.name : null),
      notes: `Imported from the Google Drive "Contracts" folder on 23 Oct 2026 (folder "${e.folder}").${xr?.note ? `\n\nFinance note (23 Sep 2026): ${xr.note}` : ""}`,
    };
    say(`contact: ${partnerVals.primaryContactName ?? "—"} · ${partnerVals.primaryContactEmail ?? "no email"} · ${partnerVals.primaryContactPhone ?? "no phone"}${deal ? ` · deal #${deal.id}` : ""}${link ? ` · sponsor-link #${link.id}` : ""}${partnerVals.xeroContactName ? ` · Xero "${partnerVals.xeroContactName}"` : ""}`);

    // ── the file ──
    const files: any[] = e.files ?? [];
    const signed = e.signed_file ? files.find(f => f.name === e.signed_file) : null;
    const best = signed
      ?? files.filter(f => f.classification === "unsigned_copy").sort((a, b) => (byId.get(b.id)?.modifiedTime ?? "").localeCompare(byId.get(a.id)?.modifiedTime ?? ""))[0]
      ?? files.filter(f => f.classification === "proposal").sort((a, b) => (byId.get(b.id)?.modifiedTime ?? "").localeCompare(byId.get(a.id)?.modifiedTime ?? ""))[0]
      ?? files[0] ?? null;
    const inv = best ? byId.get(best.id) : null;
    const local = best ? localById.get(best.id) : null;
    say(best ? `file: ${signed ? "SIGNED" : "best available (" + best.classification + ")"} → ${best.name}  [uploaded to Drive ${inv?.createdTime?.slice(0, 10)} by ${inv?.lastModifyingUser?.emailAddress ?? "?"}]` : "file: NONE in the folder", !signed);

    // ── contract values ──
    const start = iso(k.start_date), end = iso(k.end_date);
    const termMonths = int(k.term_months) ?? (start && end ? Math.round(daysBetween(start, end) / 30.4375) : null);
    const flags: string[] = [...(e.flags ?? []).map(String), ...(e.gaps ?? []).map((g: string) => `Gap: ${g}`)];
    if (!signed) flags.unshift(`No signed copy in the folder — the file attached is the ${best?.classification ?? "only"} copy.`);
    const sig = ["both_parties", "sponsor_only", "club_only", "unsigned", "unclear"].includes(e.signature_verdict) ? e.signature_verdict : "not_checked";
    const signedBy = (best?.signature?.signed_by ?? []).map((x: any) => `${x.name ?? "?"}${x.role ? ` (${x.role})` : ""}${x.party ? ` — ${x.party}` : ""}${x.date ? `, ${x.date}` : ""}`).join("; ") || null;
    const contractVals = {
      title: text(k.package, 300),
      clubEntity: text(e.club_entity, 120),
      signedOn: iso(e.signed_on),
      startDate: start, endDate: end, openEnded: false,
      termMonths, termText: text(k.term_text),
      renewalTerms: text(k.renewal), autoRenews: typeof k.auto_renews === "boolean" ? k.auto_renews : null, noticeDays: int(k.notice_days),
      cashPerYearCents: int(k.cash_per_year_cents), cashTotalCents: int(k.cash_total_cents), gstNote: text(k.gst_note, 500),
      contraPerYearCents: int(k.contra_per_year_cents), contraDescription: text(k.contra_description),
      paymentTerms: text(k.payment_terms_verbatim), exclusivity: text(k.exclusivity), termination: text(k.termination),
      otherClauses: text(k.other_clauses),
      contractSourceUrl: inv?.webViewLink ?? null,
      signatureStatus: sig, signedBy, signatureEvidence: text(best?.signature?.evidence, 2000),
      signatureCheckedAt: new Date(),
      flags,
      sourceFiles: files.map(f => ({ name: f.name, url: byId.get(f.id)?.webViewLink ?? null, classification: f.classification, uploadedToDrive: byId.get(f.id)?.createdTime?.slice(0, 10) ?? null, by: byId.get(f.id)?.lastModifyingUser?.emailAddress ?? null })),
    };
    say(`contract: ${contractVals.title ?? "—"} · ${start ?? "?"} → ${end ?? "?"} · cash/yr ${contractVals.cashPerYearCents != null ? "$" + (contractVals.cashPerYearCents / 100).toLocaleString() : "—"} · contra/yr ${contractVals.contraPerYearCents != null ? "$" + (contractVals.contraPerYearCents / 100).toLocaleString() : "—"} · signature ${sig} · ${flags.length} flags`);

    // ── instalments ──
    // The contract's dated schedule as written, expanded where the wording is
    // unambiguous (a count and a first date, or "monthly" after a dated first
    // payment, or "N monthly instalments" per annum), one row per contract year
    // for a plain per-annum fee, and nothing at all for a contra deal. Every
    // expansion is checked against the annual fee and labelled as derived.
    type Pay = { label: string | null; dueOn: string | null; amountCents: number; gstIncluded: boolean; notes: string | null; paidOn?: string | null; paidCents?: number | null; xeroInvoiceNumber?: string | null };
    let pays = expandSchedule(k, start, termMonths, contractVals.cashPerYearCents, flags);
    for (const o of OVERRIDES[meta.company] ?? []) { const row = pays.find(r => r.label === o.label); if (row) { row.amountCents = o.amountCents; row.notes = [row.notes, o.why].filter(Boolean).join(" · "); } }
    // Paid-or-not from the Xero snapshot: the money that has landed on this
    // sponsor since 1 Jan 2025 is allocated to instalments oldest-first, the
    // way a debtor ledger reads. Fully covered = paid; partly covered = a note.
    let live = xeroLive ? xeroLive[meta.company] ?? xeroLive[e.folder] ?? null : null;
    const xf = XERO_FROM[meta.company];
    if (xf && live) { live = { ...live, invoices: (live.invoices ?? []).filter((v: any) => String(v.date) >= xf.date) }; flags.push(`Xero invoices before ${xf.date} are not counted here: ${xf.why}`); }
    allocateXero(pays, xr, live, TODAY, flags, { start, end });
    if (live?.contacts?.length && !partnerVals.xeroContactName) partnerVals.xeroContactName = live.contacts[0];
    // The ledger starts where the Xero data does: instalments due before 2025
    // took part in the allocation above (so 2024's money pays 2024's year) but
    // are not listed.
    const before = pays.filter(r => r.dueOn && r.dueOn < LEDGER_FROM).length;
    if (before) { flags.push(`${before} instalment(s) due before ${LEDGER_FROM} are not listed — the Xero data this ledger starts from begins there.`); pays = pays.filter(r => !r.dueOn || r.dueOn >= LEDGER_FROM); }
    // 🔴 An agreement nobody has signed carries no instalments unless money has
    // actually landed on it — an "overdue" flag on a draft is a lie.
    if (sig !== "both_parties" && !pays.some(r => r.paidOn)) {
      if (pays.length) flags.push(`No instalments listed: the agreement is ${sig === "not_checked" ? "unchecked" : sig.replace("_", " ")} and Xero shows nothing paid against it. The contract's wording is under Payment terms.`);
      pays = [];
    }
    for (const p of pays) say(`instalment: ${p.label} · due ${p.dueOn ?? "unscheduled"} · $${(p.amountCents / 100).toLocaleString()} ${p.gstIncluded ? "incl" : "excl"} GST${p.paidOn ? ` · PAID ${p.paidOn}${p.xeroInvoiceNumber ? ` (${p.xeroInvoiceNumber})` : ""}` : p.notes?.includes("of $") ? " · partly paid" : ""}`);

    const dels = ((k.deliverables ?? []) as any[]).filter(d => text(d.title, 300));
    say(`${dels.length} deliverables from the contract`);

    // ── existing? ──
    const [existing] = await db.select().from(sponsorshipPartners).where(and(eq(sponsorshipPartners.organizationId, org.id), sql`lower(${sponsorshipPartners.company}) = lower(${meta.company})`, isNull(sponsorshipPartners.archivedAt)));
    if (existing && !REPLACE) { say(`already a partner (#${existing.id}) — skipped (use --replace to rebuild its contracts)`, true); skipped++; continue; }
    if (!COMMIT) { created++; contracts += best || contractVals.title ? 1 : 0; payments += pays.length; deliverables += dels.length; if (best && local?.local) uploads++; continue; }

    // ── write ──
    let partnerId = existing?.id;
    if (existing) {
      await db.update(sponsorshipPartners).set({ ...partnerVals, updatedAt: new Date() }).where(eq(sponsorshipPartners.id, existing.id));
      await db.delete(sponsorshipPartnerContracts).where(eq(sponsorshipPartnerContracts.partnerId, existing.id));
      say(`partner #${existing.id} updated; old contracts removed`);
    } else {
      const [row] = await db.insert(sponsorshipPartners).values(partnerVals).returning();
      partnerId = row.id; created++;
      say(`partner #${row.id} created`);
    }

    let nodeId: number | null = null;
    if (best && local?.local && existsSync(local.local)) {
      // Prefixed: the August Google import already owns the bare id (unique) under the Budget-locked folder.
      const already = await findStoredContractBySourceId(`contract:${best.id}`);
      if (already) { nodeId = already.id; say(`file already in Club Drive (node #${already.id})`); }
      else {
        const buf = readFileSync(local.local);
        const pp = preppedById.get(best.id);
        const txt = pp?.txt && existsSync(pp.txt) ? readFileSync(pp.txt, "utf8") : null;
        const mime = inv?.mimeType?.startsWith("application/vnd.google-apps.") ? "application/pdf" : (inv?.mimeType ?? "application/pdf");
        let name = best.name;
        if (mime === "application/pdf" && !/\.pdf$/i.test(name)) name += ".pdf";
        const node = await storeContractFile({
          buffer: buf, name, contentType: mime, company: meta.company, userId: null,
          sourceId: `contract:${best.id}`, sourceUrl: inv?.webViewLink ?? null, sourceModifiedAt: inv?.modifiedTime ? new Date(inv.modifiedTime) : null,
          extractedText: txt, description: `${signed ? "Signed agreement" : "Agreement (" + best.classification + ")"} — ${meta.company}. From the Google Drive Contracts folder, uploaded there ${inv?.createdTime?.slice(0, 10) ?? "?"} by ${inv?.lastModifyingUser?.emailAddress ?? "?"}.`,
        });
        nodeId = node.id; uploads++;
        say(`file stored in Club Drive (node #${node.id}, ${buf.length} bytes)`);
      }
    }

    if (best || contractVals.title || start) {
      const [c] = await db.insert(sponsorshipPartnerContracts).values({ ...contractVals, partnerId: partnerId!, contractNodeId: nodeId } as any).returning();
      contracts++;
      for (const p of pays) {
        await db.insert(sponsorshipPartnerPayments).values({ contractId: c.id, label: p.label, dueOn: p.dueOn, amountCents: p.amountCents, gstIncluded: p.gstIncluded, paidOn: p.paidOn ?? null, paidCents: p.paidOn ? (p.paidCents ?? p.amountCents) : null, xeroInvoiceNumber: p.xeroInvoiceNumber ?? null, notes: p.notes });
        payments++;
      }
      const TRIG: Record<string, string> = { once: "once", per_match: "per_match", weekly: "weekly", monthly: "monthly", quarterly: "quarterly", per_season: "annually", annually: "annually" };
      for (const [i, d] of dels.entries()) {
        await db.insert(sponsorshipDeliverables).values({
          partnerContractId: c.id, title: text(d.title, 300)!, notes: text(d.detail, 4000), category: "contract",
          triggerType: (TRIG[d.frequency] ?? "once") as any, entitlementQty: int(d.quantity) ?? 1, usedQty: 0, status: "pending", displayOrder: i + 1,
        } as any);
        deliverables++;
      }
      say(`contract #${c.id} with ${pays.length} instalments and ${dels.length} deliverables`);
    } else {
      say(`no contract row (nothing in the folder) — the partner shows "No contract on file"`, true);
    }
  }

  console.log(`\n  ${COMMIT ? "Wrote" : "Would write"}: ${created} partners · ${contracts} contracts · ${payments} instalments · ${deliverables} deliverables · ${uploads} files to Club Drive · ${skipped} skipped\n`);
  process.exit(0);
}
main().catch(e => { console.error("\n  ✗", e); process.exit(1); });
