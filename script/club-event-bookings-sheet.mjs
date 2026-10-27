// A one-page, brand-correct PDF of who has booked a club event and what they paid —
// the sheet Daniel sends round before the SIU Club Dinner.
//
//   node --env-file=.env script/club-event-bookings-sheet.mjs                       # club-dinner-2026
//   node --env-file=.env script/club-event-bookings-sheet.mjs --event <slug> --out <dir>
//
// Reads production read-only. PAID bookings only (status 'paid'): an unfinished
// checkout is not a booking — "if you ain't paid you ain't registered". The five
// pending rows on the dinner at 27 Oct were all duplicates of a booking the same
// person then paid. Names and prices only: no email, phone or card detail reaches
// the sheet, because it is written to be forwarded.
//
// Brand: the event's own brand (siu → Unity Black + gold #C59949, Rough Cut + Arpona
// from apps/siu-dinner/public). Renders HTML → A4 PDF + a PNG proof in headless Chrome.
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";

pg.types.setTypeParser(1082, (v) => v);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SLUG = arg("--event", "club-dinner-2026");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AIOS = path.resolve(HERE, "../../../../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const BRANDS = {
  siu: {
    name: "South Island United",
    crest: path.join(AIOS, "apps/siu-dinner/public/brand/crest-color.png"),
    fonts: path.join(AIOS, "apps/siu-dinner/public/fonts"),
    display: "Rough Cut", body: "Arpona",
    ink: "#000000", gold: "#C59949", bone: "#F3EEE4", paper: "#FFFFFF", muted: "#6B6560", rule: "#E2DACB",
  },
};

const money = (c) => "$" + (c / 100).toLocaleString("en-NZ", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const nz = (d, opts) => new Date(d).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", ...opts });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const { rows: [ev] } = await pool.query(`select * from club_events where slug=$1`, [SLUG]);
if (!ev) { console.error(`no club event with slug ${SLUG}`); process.exit(1); }
const brand = BRANDS[ev.brand];
if (!brand) { console.error(`no brand kit for "${ev.brand}" — add it to BRANDS`); process.exit(1); }
const { rows: types } = await pool.query(`select id, name, price_cents from club_event_ticket_types where event_id=$1 order by sort`, [ev.id]);
const { rows: orders } = await pool.query(
  `select o.ref, o.buyer_name, o.quantity, o.unit_price_cents, o.total_cents, o.paid_cents, o.refunded_cents, o.paid_at, o.payment_method, o.table_name, t.name ticket_type,
          coalesce((select json_agg(g.full_name order by g.seat_no) from club_event_guests g where g.order_id=o.id and nullif(trim(g.full_name),'') is not null), '[]') guests
     from club_event_orders o left join club_event_ticket_types t on t.id=o.ticket_type_id
    where o.event_id=$1 and o.status='paid' order by o.paid_at, o.ref`, [ev.id]);
const { rows: [pend] } = await pool.query(`select count(*)::int n from club_event_orders where event_id=$1 and status='pending'`, [ev.id]);
await pool.end();

const tickets = orders.reduce((a, o) => a + o.quantity, 0);
const taken = orders.reduce((a, o) => a + o.paid_cents - o.refunded_cents, 0);
const byType = types.map((t) => {
  const os = orders.filter((o) => o.ticket_type === t.name);
  return { ...t, bookings: os.length, tickets: os.reduce((a, o) => a + o.quantity, 0), cents: os.reduce((a, o) => a + o.paid_cents - o.refunded_cents, 0) };
}).filter((t) => t.bookings);
const asAt = nz(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
const when = nz(ev.starts_at, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " · " + nz(ev.starts_at, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");

const font = (file) => `url("file://${path.join(brand.fonts, file)}") format("opentype")`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ev.name)} — bookings</title>
<style>
@font-face{font-family:"Rough Cut";src:${font("RoughCut.otf")};font-weight:400}
@font-face{font-family:"Arpona";src:${font("Arpona-Regular.otf")};font-weight:400}
@font-face{font-family:"Arpona";src:${font("Arpona-SemiBold.otf")};font-weight:600}
@font-face{font-family:"Arpona";src:${font("Arpona-Bold.otf")};font-weight:700}
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:210mm;height:297mm;background:${brand.paper};color:${brand.ink};font-family:"${brand.body}",Georgia,serif;font-size:10.5pt;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:210mm;height:297mm;display:flex;flex-direction:column;overflow:hidden}
.head{background:${brand.ink};color:#fff;padding:12mm 14mm 9mm;display:flex;align-items:center;gap:9mm;position:relative}
.head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.2mm;background:${brand.gold}}
.head img{width:24mm;height:24mm;object-fit:contain}
.kicker{font-family:"${brand.display}";text-transform:uppercase;letter-spacing:.14em;font-size:9.5pt;color:${brand.gold}}
h1{font-family:"${brand.display}";text-transform:uppercase;font-weight:400;font-size:26pt;line-height:1;letter-spacing:.02em;margin:2.2mm 0 2.2mm}
.sub{font-size:10pt;color:#D8D2C6}
.sub b{color:#fff;font-weight:600}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;padding:7mm 14mm 0}
.stat{border:0.35mm solid ${brand.rule};border-top:1mm solid ${brand.gold};padding:3mm 4mm 3.2mm}
.stat .n{font-family:"${brand.display}";font-size:20pt;line-height:1;letter-spacing:.02em}
.stat .l{font-size:8.5pt;color:${brand.muted};margin-top:1.4mm;text-transform:uppercase;letter-spacing:.08em}
.body{padding:6mm 14mm 0;flex:1}
table{width:100%;border-collapse:collapse}
th{font-family:"${brand.display}";font-weight:400;text-transform:uppercase;letter-spacing:.1em;font-size:8.5pt;color:${brand.muted};text-align:left;padding:0 2mm 2.2mm;border-bottom:0.5mm solid ${brand.ink}}
td{padding:2.3mm 2mm;border-bottom:0.25mm solid ${brand.rule};vertical-align:top}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.name{font-weight:600}
td.ref{color:${brand.muted};font-size:8.5pt;white-space:nowrap}
td .guests{display:block;color:${brand.muted};font-size:8.5pt;margin-top:.6mm}
td .sit{color:${brand.muted};font-size:9pt}
tr.total td{border-bottom:0;border-top:0.5mm solid ${brand.ink};font-weight:700;padding-top:2.6mm}
.note{padding:3mm 14mm 0;font-size:8.5pt;color:${brand.muted}}
.foot{margin-top:auto;padding:4mm 14mm 9mm;display:flex;justify-content:space-between;align-items:flex-end;font-size:8pt;color:${brand.muted};border-top:0.25mm solid ${brand.rule}}
.foot .brand{font-family:"${brand.display}";text-transform:uppercase;letter-spacing:.14em;color:${brand.ink};font-size:8.5pt}
</style></head><body><div class="sheet">
<div class="head"><img src="file://${brand.crest}" alt=""><div>
  <div class="kicker">${esc(brand.name)} · Bookings as at ${esc(asAt)}</div>
  <h1>${esc(ev.name)}</h1>
  <div class="sub"><b>${esc(when)}</b> · ${esc(ev.venue_name)}${ev.venue_address ? ", " + esc(ev.venue_address) : ""}</div>
</div></div>
<div class="stats">
  <div class="stat"><div class="n">${tickets}</div><div class="l">Tickets sold</div></div>
  <div class="stat"><div class="n">${orders.length}</div><div class="l">Bookings</div></div>
  ${byType.slice(0, 2).map((t) => `<div class="stat"><div class="n">${t.tickets}</div><div class="l">${esc(t.name)} at ${money(t.price_cents)}</div></div>`).join("")}
</div>
<div class="body"><table>
<thead><tr><th>Booked by</th><th>Sit with</th><th>Booked</th><th class="num">Tickets</th><th class="num">Price each</th><th class="num">Paid</th></tr></thead>
<tbody>
${orders.map((o) => {
  const guests = (o.guests || []).filter((g) => g && g.trim().toLowerCase() !== (o.buyer_name || "").trim().toLowerCase());
  const net = o.paid_cents - o.refunded_cents;
  return `<tr><td class="name">${esc(o.buyer_name)}${guests.length ? `<span class="guests">with ${esc(guests.join(", "))}</span>` : ""}</td><td><span class="sit">${esc(o.table_name || "—")}</span></td><td class="ref">${esc(nz(o.paid_at, { day: "numeric", month: "short" }))} · ${esc(o.ref)}</td><td class="num">${o.quantity}</td><td class="num">${money(o.unit_price_cents)}<span class="sit"> ${esc((o.ticket_type || "").toLowerCase())}</span></td><td class="num">${money(net)}${o.refunded_cents ? `<span class="sit"> (${money(o.refunded_cents)} refunded)</span>` : ""}</td></tr>`;
}).join("\n")}
<tr class="total"><td colspan="3">Total paid</td><td class="num">${tickets}</td><td class="num"></td><td class="num">${money(taken)}</td></tr>
</tbody></table></div>
<div class="note">Paid bookings only, from ClubOS. ${pend.n ? `${pend.n} unfinished checkout${pend.n === 1 ? "" : "s"} not counted. ` : ""}Guest names appear where the booker filled them in; “Sit with” is what they typed at checkout. Tickets: ${types.map((t) => `${esc(t.name)} ${money(t.price_cents)}`).join(" · ")}.</div>
<div class="foot"><div class="brand">${esc(brand.name)}</div><div>${esc(ev.contact_email || "")}</div></div>
</div></body></html>`;

const outDir = arg("--out", path.join(AIOS, "outputs/siu-dinner", `${new Date().toISOString().slice(0, 10)}-bookings`));
fs.mkdirSync(outDir, { recursive: true });
const base = path.join(outDir, `${SLUG}-bookings`);
fs.writeFileSync(`${base}.html`, html);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
await page.goto(`file://${base}.html`, { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
const overflow = await page.evaluate(() => { const s = document.querySelector(".sheet"); const foot = document.querySelector(".foot").getBoundingClientRect(); return { sheet: s.scrollHeight, box: s.clientHeight, footBottom: Math.round(foot.bottom), fonts: Array.from(document.fonts).map((f) => `${f.family}:${f.status}`) }; });
await page.pdf({ path: `${base}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
await page.screenshot({ path: `${base}.png`, fullPage: false });
await browser.close();
console.log(`${orders.length} paid bookings · ${tickets} tickets · ${money(taken)} · ${pend.n} pending left out`);
console.log(`fonts: ${overflow.fonts.join(", ")}`);
if (overflow.sheet > overflow.box + 1) console.log(`⚠️ content overflows the page by ${overflow.sheet - overflow.box}px — it will NOT fit on one sheet`);
console.log(`PDF  ${base}.pdf\nPNG  ${base}.png`);
