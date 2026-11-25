/**
 * Partners → By asset: load the 2026 positions from the budget sheet.
 *
 *   npx tsx --env-file=.env script/seed-sponsorship-assets.ts            # dry run (rolled back)
 *   npx tsx --env-file=.env script/seed-sponsorship-assets.ts --commit
 *
 * Source: the Sponsorship tab of "2026 Programme budget - CUFC - SIU MAIN.xlsx"
 * (Google id 1zN5g6yfVsFaEsNcvfdgatEtMw-sIS8Hm), read from the Club Drive copy
 * (drive_nodes.extracted_text, imported 24 Jul 2026). Every row and dollar is
 * the sheet's. A business is linked to a signed partner only by the hand map
 * below; a few empty positions are filled from a partner's SIGNED CONTRACT and
 * say so in `source` + `comments`. Idempotent on (season, club, group, order).
 * Never deletes, never overwrites a row a person has edited since (updated_at
 * later than created_at).
 */
import pg from "pg";
const commit = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SHEET = "1zN5g6yfVsFaEsNcvfdgatEtMw-sIS8Hm";
const SRC = "2026 Programme budget sheet (Sponsorship tab)";
const SEASON = 2026;

/** Sheet business name → partner company in ClubOS (exact). */
const PARTNER_OF: Record<string, string> = {
  "Pak N Save Tamatea": "Pak'nSave Tamatea", "Perennial": "Perennial Sport & Turf", "Cupra": "CUPRA Christchurch (Miles Group)",
  "Heartland Technologies": "Heartland Technology", "Revamp": "Revamp Digital", "Milano Tiles": "Milano Tiling",
  "Formosa Foods": "Formosa Foods", "Shadeplus": "Shadeplus", "Ricardo Real Estate": "Harcourts Grenadier (Ricardo Felitti)",
  "Your Local": "Your Local Services", "Drifters Hotel": "The Drifter", "United Steel": "United Steel FC",
  "Go Media": "Go Media", "SMC": "SMC Design Studio",
};
/** Empty sheet positions a SIGNED CONTRACT fills: [club, group, position, company, what the contract says]. */
const FROM_CONTRACT: [string, string, string, string, string][] = [
  ["cufc", "kit", "Front of Shirt Home", "Fusion5", "Contract: Marquee Sponsor, front of shirt (home & away), 2026"],
  ["cufc", "kit", "Front of Shirt Away", "Fusion5", "Contract: Marquee Sponsor, front of shirt (home & away), 2026"],
  ["cufc", "kit", "Academy Front of Shirt", "Signbiz", "Contract: Academy front of shirt, 2026"],
  ["siu", "kit", "Back of Shirt - Lower", "The Drifter", "Contract: back of shirt, home & away (SMC holds the top)"],
  ["siu", "digital", "Gym Partner", "Fitness Canterbury", "Contract: Official Gym Partner of South Island United (contra)"],
  ["siu", "digital", "Accommodation Partner", "The Drifter", "Contract: Preferred Accommodation Partner"],
];
/** Notes only — the contract does not say which exact position. */
const NOTE_ONLY: [string, string, string, string][] = [
  ["cufc", "kit", "Back of Shirt - Upper", "CUPRA's contract includes back of shirt (home & away); upper or lower not recorded."],
  ["siu", "kit", "Shorts Front - Left", "LT McGuinness and Victoria Foods each hold front of shorts by contract; which side is not recorded."],
];

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
const money = (v: string): number | null => {
  const t = v.replace(/[$,\s]/g, ""); if (!t || t === "-") return null;
  const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) : null;
};

async function main() {
  const cx = await pool.connect();
  try {
    await cx.query("BEGIN");
    const { rows: [org] } = await cx.query(`SELECT id FROM organizations WHERE slug='united-sports-group'`);
    const { rows: [node] } = await cx.query(`SELECT extracted_text FROM drive_nodes WHERE source_id=$1 AND trashed_at IS NULL ORDER BY id LIMIT 1`, [SHEET]);
    if (!node?.extracted_text) throw new Error("Club Drive copy of the sheet not found");
    const text: string = node.extracted_text;
    const start = text.indexOf("# Sponsorship");
    const end = text.indexOf("\n# ", start + 5);
    const lines = text.slice(start, end < 0 ? undefined : end).split("\n").slice(1);

    const { rows: partners } = await cx.query(`SELECT id, company FROM sponsorship_partners WHERE organization_id=$1`, [org.id]);
    const pid = (company: string) => { const p = partners.find((x: any) => x.company === company); if (!p) throw new Error(`no partner ${company}`); return p.id as number; };

    type Row = { club: string; group: string; name: string; business: string | null; staff: string | null; target: number | null; contra: number | null; actual: number | null; comments: string | null; order: number };
    const out: Row[] = [];
    let club = "", group = "", order = 0;
    for (const raw of lines) {
      const c = parseCsvLine(raw);
      const first = (c[0] || "").trim();
      if (first === "CHRISTCHURCH UNITED") { club = "cufc"; continue; }
      if (first === "SOUTH ISLAND UNITED") { club = "siu"; continue; }
      if (first === "KIT SPONSORSHIP") { group = "kit"; order = 0; continue; }
      if (first === "DIGITAL/PROGRAMME ASSETS") { group = "digital"; order = 0; continue; }
      if (first === "PHYSICAL ASSETS") { group = "physical"; order = 0; continue; }
      const name = (c[1] || "").trim();
      if (!club || !group || !name || name === "Sponsorship Package") continue;
      order += 10;
      out.push({ club, group, name, business: (c[2] || "").trim() || null, staff: (c[3] || "").trim() || null,
        target: money(c[4] || ""), contra: money(c[5] || ""), actual: money(c[6] || ""), comments: (c[8] || "").trim() || null, order });
    }
    console.log(`${out.length} positions read from the sheet`);

    let ins = 0, upd = 0, kept = 0;
    for (const r of out) {
      let partnerId: number | null = r.business && PARTNER_OF[r.business] ? pid(PARTNER_OF[r.business]) : null;
      let source = SRC, comments = r.comments;
      const fc = FROM_CONTRACT.find(f => f[0] === r.club && f[1] === r.group && f[2] === r.name);
      if (!r.business && fc) { partnerId = pid(fc[3]); source = "Signed contract (sheet position was blank)"; comments = fc[4]; }
      const nn = NOTE_ONLY.find(f => f[0] === r.club && f[1] === r.group && f[2] === r.name);
      if (nn && !comments) comments = nn[3];
      const vals = [SEASON, r.club, r.group, r.name, partnerId, r.business, r.staff, r.target, r.contra, r.actual, comments, source, r.order];
      const { rows: [ex] } = await cx.query(`SELECT id, created_at, updated_at FROM sponsorship_assets WHERE organization_id=$1 AND season_year=$2 AND club=$3 AND asset_group=$4 AND display_order=$5 AND archived_at IS NULL`,
        [org.id, SEASON, r.club, r.group, r.order]);
      if (!ex) {
        await cx.query(`INSERT INTO sponsorship_assets (organization_id,season_year,club,asset_group,name,partner_id,business_name,staff_name,target_cents,contra_cents,actual_cents,comments,source,display_order,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)`, [org.id, ...vals]);
        ins++;
      } else if (new Date(ex.updated_at).getTime() - new Date(ex.created_at).getTime() > 2000) { kept++; }
      else {
        await cx.query(`UPDATE sponsorship_assets SET name=$1, partner_id=$2, business_name=$3, staff_name=$4, target_cents=$5, contra_cents=$6, actual_cents=$7, comments=$8, source=$9 WHERE id=$10`,
          [r.name, partnerId, r.business, r.staff, r.target, r.contra, r.actual, comments, source, ex.id]);
        upd++;
      }
      console.log(`  ${r.club} ${r.group.padEnd(8)} ${r.name.padEnd(30)} ${(r.business ?? "").padEnd(24)} ${partnerId ? `→ partner ${partnerId}` : ""}`);
    }
    console.log(`inserted ${ins} · refreshed ${upd} · kept (edited by a person) ${kept}`);
    if (commit) { await cx.query("COMMIT"); console.log("COMMITTED"); } else { await cx.query("ROLLBACK"); console.log("dry run — rolled back"); }
  } catch (e) { await cx.query("ROLLBACK"); throw e; } finally { cx.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
