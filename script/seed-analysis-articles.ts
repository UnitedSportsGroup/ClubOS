/**
 * Seed the 20 October 2026 lifetime-value analyses into the Knowledge Base as
 * "Analysis" articles — so the REASONING behind the numbers is searchable in
 * ClubOS and Rambo cites it beside the live figures.
 *
 *   npx tsx --env-file=.env script/seed-analysis-articles.ts            # dry run
 *   npx tsx --env-file=.env script/seed-analysis-articles.ts --commit
 *
 * Daniel, 2026-10-27: "the whole analysis and the previous stuff is something
 * that's usually scattered in different places. Now we're bringing it all in
 * one place, and we want to be able to have that all searchable in here."
 *
 * One article per report section (H2; an over-long H2 is split on its H3s), so
 * a question retrieves the paragraph it needs rather than an 11,000-word file.
 * Every article opens with WHEN it was written and WHICH Rambo tool gives the
 * live figure today, so a dated report is never mistaken for the present.
 *
 * Gates: the youth reports carry programme totals, GP margins and cost to serve
 * → Registrations tab (CUFC); the MFL reports → the MFL Analytics tab. Owner is
 * Daniel (user 1). Idempotent on (brand, title); an article a person has since
 * edited by hand is left alone.
 */
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { kbArticles } from "../shared/schema";

const COMMIT = process.argv.includes("--commit");
const DANIEL = 1;
const ROOT = process.env.AIOS_ROOT || path.resolve(process.cwd(), "../../../..");

interface Report {
  file: string;
  brand: "cufc" | "mfl";
  requiredTab: string;
  requiredWorkspace?: string;
  title: string;
  tool: string;
  keywords: string[];
  skip?: RegExp;
}
const REPORTS: Report[] = [
  { file: "outputs/youth-ltv/2026-10-20/U48-LTV-CAC.md", brand: "cufc", requiredTab: "registrations", title: "U4–U8 lifetime value, gross profit and acquisition cost", tool: "customer_lifetime (view cohort, retention, year) and camp_history", keywords: ["lifetime value", "LTV", "LTGP", "CAC", "U4-U8", "FUNiño", "FUNino", "retention", "acquisition cost", "gross profit", "cost to serve", "Hormozi", "30-day rule"] },
  { file: "outputs/youth-ltv/2026-10-20/YOUTH-LTV-CAC-ALL.md", brand: "cufc", requiredTab: "registrations", title: "Every youth programme: lifetime value, gross profit and acquisition cost", tool: "customer_lifetime (view cohort, journey, conversion) and programme_history", keywords: ["lifetime value", "LTV", "LTGP", "CAC", "pre-academy", "academy", "technification", "goalkeeper", "fundamentals camp", "world cup camp", "where to spend", "acquisition", "retention"] },
  { file: "outputs/youth-ltv/2026-10-20/JOURNEYS.md", brand: "cufc", requiredTab: "registrations", title: "Customer journeys and tenure (youth)", tool: "customer_lifetime (view journey, conversion, funnel, tenure)", keywords: ["customer journey", "tenure", "funnel", "conversion", "camp to programme", "one and done", "churn", "years with us", "pathway", "progression", "what they buy next"] },
  { file: "outputs/youth-ltv/2026-10-20/METHOD.md", brand: "cufc", requiredTab: "registrations", title: "Youth lifetime value: method", tool: "customer_lifetime", keywords: ["method", "data sources", "identity matching", "cohort definition", "Friendly Manager", "Xero", "Shopify", "reconciliation"], skip: /^(Files|`child_terms\.csv` columns)$/ },
  { file: "outputs/youth-ltv/2026-10-20/attribution_youth.md", brand: "cufc", requiredTab: "registrations", title: "Youth programmes: attribution findings", tool: "programme_history and the Marketing hub", keywords: ["attribution", "how did you hear about us", "first touch", "Meta", "Facebook", "Google", "Shopify", "referral source", "landing page", "UTM"] },
  { file: "outputs/youth-ltv/2026-10-20/AD_SPEND_YOUTH.md", brand: "cufc", requiredTab: "registrations", title: "Youth programmes: paid acquisition spend", tool: "the Marketing hub (ad spend) and customer_lifetime", keywords: ["ad spend", "Meta spend", "Google Ads", "advertising", "Xero 403", "cost per child", "camp ads", "spend by term"] },
  { file: "outputs/mfl-ltv/2026-10-20/LTV-CAC.md", brand: "mfl", requiredTab: "analytics", requiredWorkspace: "mini-football-leagues", title: "Mini Football Leagues: LTV, LTGP and CAC", tool: "league_lifetime", keywords: ["MFL", "lifetime value", "LTV", "LTGP", "CAC", "team", "retention", "referee cost", "fee per team", "5-a-side", "7-a-side", "Hormozi"] },
  { file: "outputs/mfl-ltv/2026-10-20/METHOD.md", brand: "mfl", requiredTab: "analytics", requiredWorkspace: "mini-football-leagues", title: "MFL customer lifetime: method", tool: "league_lifetime", keywords: ["MFL", "method", "team matching", "sources", "SportNinja", "Friendly Manager", "scenarios", "gaps"], skip: /^Files$/ },
  { file: "outputs/mfl-ltv/2026-10-20/AD_SPEND.md", brand: "mfl", requiredTab: "analytics", requiredWorkspace: "mini-football-leagues", title: "Mini Football Leagues: paid advertising spend history", tool: "league_lifetime (acquisition)", keywords: ["MFL", "ad spend", "Meta", "advertising", "spend by term", "conversion tracking"] },
];

interface Article { brand: string; title: string; summary: string; body: string; keywords: string[]; requiredTab: string; requiredWorkspace: string | null }

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const cleanHeading = (h: string) => h.replace(/^#+\s*/, "").replace(/^\d+\s*·\s*/, "").replace(/^[A-E]\.\s*/, "").replace(/`/g, "").trim();
const firstParagraph = (md: string) => {
  const paras = md.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith("|") && !p.startsWith("#") && !p.startsWith("```"));
  const p = (paras[0] ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ");
  return p.length > 240 ? p.slice(0, 237).replace(/\s\S*$/, "") + "…" : p;
};

function split(md: string, level: "##" | "###"): { heading: string; body: string }[] {
  const re = new RegExp(`^${level} (?!#)`, "m");
  const parts = md.split(re);
  const out: { heading: string; body: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i];
    if (i === 0) { if (chunk.trim()) out.push({ heading: "", body: chunk.trim() }); continue; }
    const nl = chunk.indexOf("\n");
    out.push({ heading: cleanHeading(nl < 0 ? chunk : chunk.slice(0, nl)), body: (nl < 0 ? "" : chunk.slice(nl + 1)).trim() });
  }
  return out;
}

function articlesFor(r: Report): Article[] {
  const md = fs.readFileSync(path.join(ROOT, r.file), "utf8");
  const reportTitle = cleanHeading(md.split("\n").find((l) => l.startsWith("# ")) ?? r.title);
  const preface =
    `> **From the report “${reportTitle}”, written on 20 October 2026** from ClubOS production (read-only) — ` +
    `Friendly Manager 2017→, Xero office invoices, Shopify camps, live registrations, the Meta ad accounts and the Xero P&L. ` +
    `Every figure is as at that date. For today's numbers ask Rambo (${r.tool}). Source file: \`${r.file}\`.\n\n`;
  const out: Article[] = [];
  const seen = new Map<string, number>();
  const push = (heading: string, body: string, sub?: string) => {
    if (!body.trim() || words(body) < 25) return;
    let title = `${r.title} — ${heading}${sub ? ` › ${sub}` : ""}`;
    const n = (seen.get(title) ?? 0) + 1; seen.set(title, n);
    if (n > 1) title += ` (${n})`;
    out.push({ brand: r.brand, title, summary: firstParagraph(body), body: preface + (sub ? `## ${heading} › ${sub}\n\n` : `## ${heading}\n\n`) + body, keywords: Array.from(new Set([...r.keywords, ...heading.toLowerCase().split(/[^a-z0-9+-]+/).filter((w) => w.length > 3)])), requiredTab: r.requiredTab, requiredWorkspace: r.requiredWorkspace ?? null });
  };
  for (const s of split(md, "##")) {
    const heading = s.heading || "Introduction";
    if (r.skip?.test(heading)) continue;
    if (words(s.body) > 1800) {
      const subs = split(s.body, "###");
      if (subs.length > 1) { for (const x of subs) push(heading, x.body, x.heading || undefined); continue; }
    }
    push(heading, s.body);
  }
  return out;
}

async function main() {
  console.log(`\n📚 Knowledge Base seed — the 20 Oct 2026 lifetime-value analyses (${COMMIT ? "COMMIT" : "DRY RUN"})\n   root ${ROOT}\n`);
  let created = 0, updated = 0, skipped = 0, total = 0;
  for (const r of REPORTS) {
    if (!fs.existsSync(path.join(ROOT, r.file))) { console.log(`   ✗ missing ${r.file}`); continue; }
    const arts = articlesFor(r);
    console.log(`   ${r.file}: ${arts.length} articles (${arts.reduce((a, x) => a + words(x.body), 0).toLocaleString()} words)`);
    for (const a of arts) {
      total++;
      const [existing] = await db.select().from(kbArticles).where(and(eq(kbArticles.brand, a.brand), eq(kbArticles.title, a.title)));
      if (existing) {
        if (existing.updatedBy != null && existing.updatedBy !== DANIEL) { skipped++; console.log(`      ⏭ "${a.title}" — edited by a person, left alone`); continue; }
        updated++;
        if (COMMIT) await db.update(kbArticles).set({ summary: a.summary, body: a.body, category: "Analysis", keywords: a.keywords, requiredTab: a.requiredTab, requiredWorkspace: a.requiredWorkspace, updatedAt: new Date() }).where(eq(kbArticles.id, existing.id));
      } else {
        created++;
        if (COMMIT) await db.insert(kbArticles).values({ brand: a.brand, category: "Analysis", title: a.title, summary: a.summary, body: a.body, keywords: a.keywords, status: "published", requiredTab: a.requiredTab, requiredWorkspace: a.requiredWorkspace, ownerUserId: DANIEL, createdBy: DANIEL, updatedBy: DANIEL, publishedAt: new Date() });
      }
    }
  }
  console.log(`\n   ${total} articles: ${created} to create, ${updated} to update, ${skipped} left alone${COMMIT ? " — written" : " — nothing written (pass --commit)"}\n`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
