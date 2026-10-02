// Live check of Quotes → Edit quote, against PRODUCTION. Makes a throwaway
// quote (two lines, $100 + $50 excl GST), edits it through the real API the
// way Dima would, checks totals / frozen original / refusals, then deletes it.
//   npx tsx --env-file=.env script/_verify-print-quote-edit-live.ts
import fs from "fs"; import crypto from "crypto"; import pg from "pg";
const BASE = "https://app.usg.co.nz";
const session = JSON.parse(fs.readFileSync(process.env.CLUBOS_SESSION_FILE || "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/credentials/clubos-session.json", "utf8"));
const H = { Cookie: session.cookie, "Content-Type": "application/json", "X-Workspace-Slug": "united-prints" };
const api = async (m: string, p: string, b?: any) => { const r = await fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0; const ok = (c: boolean, m: string) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}`); };
await db.connect();
let qid = 0;
try {
  qid = (await db.query(`INSERT INTO print_quotes (organization_id, token, status, customer_name, customer_email, source, subtotal_cents, gst_cents, total_cents, indicative)
    VALUES (8,$1,'new','ZZ Edit Test (delete)','noreply@unitedprints.co.nz','verify',15000,2250,17250,true) RETURNING id`, [crypto.randomBytes(24).toString("hex")])).rows[0].id;
  const a = (await db.query(`INSERT INTO print_quote_items (quote_id, design_name, material, size_label, area_m2, quantity, line_ex_gst_cents, design_file_name) VALUES ($1,'Club banner','PVC banner','3000×800',2.4,1,10000,'logo.pdf') RETURNING id`, [qid])).rows[0].id;
  const b = (await db.query(`INSERT INTO print_quote_items (quote_id, design_name, material, quantity, line_ex_gst_cents) VALUES ($1,'Corflute','Corflute 5mm',3,5000) RETURNING id`, [qid])).rows[0].id;
  console.log(`throwaway quote ${qid} (lines ${a}, ${b})`);

  // Dima: banner goes to 2, corflute removed, eyelets added.
  const e = await api("PUT", `/api/admin/print-quotes/${qid}/items`, { items: [
    { id: a, designName: "Club banner", material: "PVC banner", sizeLabel: "3000×800", quantity: 2, lineExGstCents: 20000 },
    { designName: "Eyelets + hemming", material: "Finishing", quantity: 1, lineExGstCents: 2500 },
  ] });
  ok(e.status === 200, `edit saved (${e.status} ${e.json.message || ""})`);
  ok(e.json.subtotalCents === 22500 && e.json.gstCents === 3375 && e.json.totalCents === 25875, `server totals: $225 + GST $33.75 = $258.75 (got ${e.json.totalCents})`);
  ok(e.json.originalTotalCents === 17250 && e.json.originalSubtotalCents === 15000, "website's original total frozen at $172.50");
  ok(e.json.indicative === false && !!e.json.editedAt, "no longer 'indicative'; edited stamp set");
  const items = (await db.query(`SELECT id, design_name, quantity, line_ex_gst_cents, area_m2, design_file_name FROM print_quote_items WHERE quote_id=$1 ORDER BY id`, [qid])).rows;
  ok(items.length === 2 && !items.some((i) => i.id === b), "corflute line removed, eyelets line added");
  ok(items[0].id === a && items[0].area_m2 !== null && items[0].design_file_name === "logo.pdf", "kept line keeps its area and artwork filename");

  const e2 = await api("PUT", `/api/admin/print-quotes/${qid}/items`, { items: [{ id: a, designName: "Club banner", quantity: 2, lineExGstCents: 18000 }] });
  ok(e2.json.originalTotalCents === 17250, "second edit keeps the ORIGINAL website total, not the first edit");

  const bad1 = await api("PUT", `/api/admin/print-quotes/${qid}/items`, { items: [{ id: a, designName: "x", quantity: 0, lineExGstCents: 100 }] });
  ok(bad1.status === 400, `refused: quantity 0 (${bad1.status})`);
  const bad2 = await api("PUT", `/api/admin/print-quotes/${qid}/items`, { items: [{ id: a, designName: "x", quantity: 1, lineExGstCents: -5 }] });
  ok(bad2.status === 400, `refused: negative price (${bad2.status})`);
  const bad3 = await api("PUT", `/api/admin/print-quotes/${qid}/items`, { items: [] });
  ok(bad3.status === 400, `refused: no lines (${bad3.status})`);
  const bad4 = await api("PUT", `/api/admin/print-quotes/${qid}/items`, { items: [{ id: 1, designName: "someone else's line", quantity: 1, lineExGstCents: 1 }] });
  ok(bad4.status === 400, `refused: a line from another quote (${bad4.status})`);
  const other = await fetch(BASE + `/api/admin/print-quotes/${qid}/items`, { method: "PUT", headers: { ...H, "X-Workspace-Slug": "mini-football-leagues" }, body: JSON.stringify({ items: [{ id: a, designName: "x", quantity: 1, lineExGstCents: 1 }] }) });
  ok(other.status === 404 || other.status === 403, `another workspace can't edit it (${other.status})`);
  await db.query(`UPDATE print_quotes SET status='rejected' WHERE id=$1`, [qid]);
  const late = await api("PUT", `/api/admin/print-quotes/${qid}/items`, { items: [{ id: a, designName: "x", quantity: 1, lineExGstCents: 1 }] });
  ok(late.status === 409, `refused: quote no longer new (${late.status})`);
} catch (err) { fail++; console.error(err); }
finally {
  if (qid) await db.query(`DELETE FROM print_quotes WHERE id=$1`, [qid]);
  const left = qid ? (await db.query(`SELECT (SELECT count(*) FROM print_quotes WHERE id=$1)+(SELECT count(*) FROM print_quote_items WHERE quote_id=$1) n`, [qid])).rows[0].n : 0;
  ok(Number(left) === 0, "cleaned up");
  await db.end(); console.log(`\n${pass} passed · ${fail} failed`); process.exitCode = fail ? 1 : 0;
}
