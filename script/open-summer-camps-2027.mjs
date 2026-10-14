// Opens the Dec 2026 – Jan 2027 CUFC holiday camps (Zach, WhatsApp 14 Oct 2026):
//   December 21–23 · January 4–8, 11–15, 18–22  → 18 days.
//
// Each camp run is its own `programs` row (see shared/programme-series.ts). The two
// summer rows are COPIED from the October rows (30 FUNdamentals, 39 World Cup) —
// page content, FAQ, prices — and given the evergreen slugs `fundamentals` /
// `worldcup`, so every existing link, ad and website button now sells the next camp.
// The October rows keep their registrations and move to `*-oct-2026`.
//
// Also creates the early-bird code (10% off, ends Sun 15 Nov 2026 23:59 NZDT).
//
//   node --env-file=.env script/open-summer-camps-2027.mjs            # dry run (rolled back)
//   node --env-file=.env script/open-summer-camps-2027.mjs --commit
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const DATES = [
  "2026-12-21", "2026-12-22", "2026-12-23",
  "2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08",
  "2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15",
  "2027-01-18", "2027-01-19", "2027-01-20", "2027-01-21", "2027-01-22",
];
// camp_dates.date is stored at 11:00 UTC = midnight NZDT on the day (both months are NZDT, +13).
const stamp = (iso) => {
  const d = new Date(`${iso}T00:00:00+13:00`);
  return d.toISOString();
};
const CAMPS = [
  { from: 30, oldSlug: "fundamentals-oct-2026", slug: "fundamentals", name: "FUNdamentals Holiday Camp Summer 2027" },
  { from: 39, oldSlug: "worldcup-oct-2026", slug: "worldcup", name: "World Cup Holiday Camp Summer 2027" },
];
const EARLY_BIRD = {
  code: "EARLYBIRD",
  title: "Early bird 10% — summer camps Dec 2026 / Jan 2027",
  value: "10.00",
  start: new Date().toISOString(),
  end: "2026-11-15T10:59:00.000Z", // Sun 15 Nov 2026 23:59 NZDT
};

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("BEGIN");
const out = [];
try {
  const cols = (await c.query(
    `select column_name from information_schema.columns where table_name='programs' and column_name not in ('id','created_at','slug','name','start_date','end_date','page_content_json','is_active','registration_open','early_bird_deadline') order by ordinal_position`,
  )).rows.map((r) => `"${r.column_name}"`);
  const newIds = [];
  for (const camp of CAMPS) {
    const src = (await c.query("select * from programs where id=$1", [camp.from])).rows[0];
    if (!src) throw new Error(`source programme ${camp.from} missing`);
    const existing = (await c.query("select id from programs where name=$1", [camp.name])).rows[0];
    if (existing) throw new Error(`"${camp.name}" already exists (id ${existing.id}) — nothing to do`);
    if (src.slug === camp.slug) {
      await c.query("update programs set slug=$1 where id=$2", [camp.oldSlug, camp.from]);
      out.push(`programme ${camp.from}: slug ${camp.slug} → ${camp.oldSlug}`);
    }
    let pc = src.page_content_json;
    if (pc && typeof pc === "object" && !Array.isArray(pc) && "0" in pc) pc = Object.values(pc).join("");
    pc = typeof pc === "string" ? JSON.parse(pc) : { ...(pc || {}) };
    pc.infoDatesWeek1 = "December: Mon 21 – Wed 23 Dec";
    pc.infoDatesWeek2 = "January: 4–8 · 11–15 · 18–22 Jan";
    pc.infoDatesNote = "Mon – Fri · book one day or all 18";
    const ins = await c.query(
      `insert into programs (${cols.join(",")}, slug, name, start_date, end_date, page_content_json, is_active, registration_open, early_bird_deadline)
       select ${cols.join(",")}, $2, $3, $4, $5, $6, true, true, $7 from programs where id=$1 returning id`,
      [camp.from, camp.slug, camp.name, stamp(DATES[0]), stamp(DATES[DATES.length - 1]), JSON.stringify(pc), EARLY_BIRD.end],
    );
    const id = ins.rows[0].id;
    newIds.push(id);
    await c.query(
      `insert into camp_pricing (camp_id, product_type, price_cents, currency) select $1, product_type, price_cents, currency from camp_pricing where camp_id=$2`,
      [id, camp.from],
    );
    for (const d of DATES) {
      await c.query(
        `insert into camp_dates (camp_id, date, capacity_full_day, capacity_morning, capacity_afternoon) values ($1,$2,100,100,100)`,
        [id, stamp(d)],
      );
    }
    out.push(`created programme ${id} "${camp.name}" /${camp.slug} — ${DATES.length} days`);
  }
  const clash = (await c.query("select id from discounts where organization_id=1 and lower(code)=lower($1)", [EARLY_BIRD.code])).rows[0];
  if (clash) throw new Error(`code ${EARLY_BIRD.code} already exists for CUFC (id ${clash.id})`);
  const d = await c.query(
    `insert into discounts (organization_id, title, code, type, method, value_type, value, applies_to, camp_ids, eligibility, min_purchase_type, one_per_customer, start_date, end_date, status, times_used, total_discounted_cents)
     values (1,$1,$2,'amount_off_order','code','percentage',$3,'specific_camps',$4,'all','none',false,$5,$6,'active',0,0) returning id`,
    [EARLY_BIRD.title, EARLY_BIRD.code, EARLY_BIRD.value, newIds, EARLY_BIRD.start, EARLY_BIRD.end],
  );
  out.push(`created discount ${d.rows[0].id} ${EARLY_BIRD.code} 10% → camps ${newIds.join(", ")}, ends 15 Nov 23:59`);

  // Self-check
  for (const id of newIds) {
    const r = (await c.query(
      `select p.slug, p.is_active, p.registration_open, (select count(*) from camp_dates where camp_id=p.id) n,
              (select string_agg(product_type||'='||price_cents, ' ' order by product_type) from camp_pricing where camp_id=p.id) prices
         from programs p where p.id=$1`, [id])).rows[0];
    if (Number(r.n) !== 18 || !r.is_active || !r.registration_open || !r.prices) throw new Error(`self-check failed for ${id}: ${JSON.stringify(r)}`);
    out.push(`  ✓ ${id} /${r.slug} 18 dates · ${r.prices}`);
  }
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log((COMMIT ? "COMMITTED\n" : "DRY RUN (rolled back)\n") + out.join("\n"));
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLED BACK:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
