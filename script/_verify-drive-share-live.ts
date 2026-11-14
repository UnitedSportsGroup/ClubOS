// Live check of Club Drive share links against production (or BASE=...).
//   npx tsx --env-file=.env script/_verify-drive-share-live.ts
// Reads a real sponsor link, and proves a link on a folder OUTSIDE Sponsor
// Content is refused. Its two probe rows are deleted at the end.
import { pool } from "../server/db";
const BASE = process.env.BASE || "https://app.usg.co.nz";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "✓" : "✗"} ${n}${x ? "  " + x : ""}`); c ? pass++ : fail++; };
(async () => {
  const c = await pool.connect();
  let probeFolder: number | null = null; const probeTok = "probe" + "x".repeat(40);
  try {
    const l = await c.query(`select s.token, n.name from drive_share_links s join drive_nodes n on n.id=s.node_id where s.revoked_at is null and n.name='SMC Design Studio' limit 1`);
    ok("the SMC Design Studio folder has a live link", l.rowCount === 1);
    const tok = l.rows[0].token; const api = `${BASE}/api/public/drive-share/${tok}`;
    const before = (await c.query(`select view_count from drive_share_links where token=$1`, [tok])).rows[0].view_count;
    const r = await fetch(api); const j: any = await r.json();
    ok("the link lists the folder with no sign-in", r.status === 200 && Array.isArray(j.files) && j.files.length > 10, `${j.files?.length} files`);
    ok("it is told not to be indexed", /noindex/.test(r.headers.get("x-robots-tag") || ""));
    ok("no storage key or id of another folder leaks", !JSON.stringify(j).includes("storage") && !JSON.stringify(j).includes("drive/"));
    ok("files carry their sub-folder", j.files.some((f: any) => /Photos$/.test(f.folder)) && j.files.some((f: any) => /Graphics$/.test(f.folder)));
    const after = (await c.query(`select view_count from drive_share_links where token=$1`, [tok])).rows[0].view_count;
    ok("an open is counted", after === before + 1, `${before} -> ${after}`);
    const img = j.files.find((f: any) => f.kind === "image");
    const t = await fetch(`${api}/thumb/${img.id}`); const tb = Buffer.from(await t.arrayBuffer());
    ok("a small picture is served as WebP", t.status === 200 && tb.slice(8, 12).toString() === "WEBP" && tb.length < 200_000, `${tb.length} bytes`);
    const f = await fetch(`${api}/file/${img.id}`, { redirect: "manual" });
    ok("a file answers with a redirect to a short-lived signed address", f.status === 302 && /token=/.test(f.headers.get("location") || ""));
    const full = await fetch(f.headers.get("location")!); const fb = Buffer.from(await full.arrayBuffer());
    ok("the full picture downloads", full.status === 200 && fb[0] === 0xff && fb[1] === 0xd8 && fb.length > 100_000, `${fb.length} bytes`);
    const other = (await c.query(`select n.id from drive_nodes n where n.kind='file' and n.trashed_at is null and n.id not in (${j.files.map((x: any) => x.id).join(",")}) order by n.id limit 1`)).rows[0].id;
    ok("a file from elsewhere in the Drive is refused through this link", (await fetch(`${api}/file/${other}`, { redirect: "manual" })).status === 404);
    ok("a file from elsewhere has no thumbnail through this link", (await fetch(`${api}/thumb/${other}`)).status === 404);
    const z = await fetch(`${api}/zip?folder=${encodeURIComponent(j.files.find((x: any) => /Photos$/.test(x.folder)).folder)}`); const zb = Buffer.from(await z.arrayBuffer());
    const n = j.files.filter((x: any) => /Photos$/.test(x.folder)).length;
    ok("one folder downloads as a zip", z.status === 200 && zb.slice(0, 2).toString() === "PK" && zb.readUInt16LE(zb.length - 12) === n, `${zb.length} bytes, ${n} files`);
    ok("a made-up link is refused", (await fetch(`${BASE}/api/public/drive-share/${"z".repeat(43)}`)).status === 404);
    ok("a malformed link is refused", (await fetch(`${BASE}/api/public/drive-share/short`)).status === 404);
    // A link row pointing OUTSIDE Sponsor Content must not work.
    probeFolder = (await c.query(`insert into drive_nodes (kind, name, brand) values ('folder','_probe not shareable','all') returning id`)).rows[0].id;
    await c.query(`insert into drive_share_links (token, node_id) values ($1,$2)`, [probeTok, probeFolder]);
    ok("a link on a folder outside Sponsor Content is refused", (await fetch(`${BASE}/api/public/drive-share/${probeTok}`)).status === 404);
    ok("the staff route needs a sign-in", (await fetch(`${BASE}/api/admin/drive/share/1`)).status === 401);
    const page = await fetch(`${BASE}/share/${tok}`); ok("the share page itself loads", page.status === 200);
  } finally {
    await c.query(`delete from drive_share_links where token=$1`, [probeTok]);
    if (probeFolder) await c.query(`delete from drive_nodes where id=$1`, [probeFolder]);
    const left = await c.query(`select (select count(*) from drive_share_links where token=$1) l, (select count(*) from drive_nodes where name='_probe not shareable') f`, [probeTok]);
    console.log("left behind:", left.rows[0]);
    c.release(); await pool.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
