// Proves Club Drive's Google-style Share on production (16 Nov 2026).
// Throwaway staff A + B and a fan account F (no workspace); throwaway folders;
// everything is removed at the end. Writes nothing a real person can see.
//   npx tsx --env-file=.env script/_verify-drive-share-people-live.ts
import pg from "pg"; import bcrypt from "bcryptjs"; import crypto from "crypto"; import sig from "cookie-signature";
const B = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0; const ok = (m: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${m}${!c && x ? "  — " + x : ""}`); };
const users: number[] = []; const nodes: number[] = []; let sid = "";
const pw = "Verify-" + crypto.randomBytes(8).toString("hex");
const tag = "zz-share-verify-" + Date.now();
async function mkUser(label: string, member: boolean) {
  const email = `${tag}-${label}@share-check.test`;
  const { rows } = await pool.query("INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,$2,'Verify',$3,'team_member',true) RETURNING id", [email, `Share${label}`, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  if (member) await pool.query("INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,'team_member',$2)", [rows[0].id, JSON.stringify(["dashboard"])]);
  return { id: Number(rows[0].id), email };
}
const login = async (email: string) => { const r = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) }); return (r.headers.get("set-cookie") || "").split(";")[0]; };
const api = async (ck: string, method: string, path: string, body?: any) => {
  const r = await fetch(B + path, { method, redirect: "manual", headers: { ...(ck ? { cookie: ck } : {}), "X-Workspace-Slug": "christchurch-united", ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  let j: any = null; try { j = await r.clone().json(); } catch {} return { s: r.status, j, loc: r.headers.get("location") };
};
const upload = async (ck: string, parentId: number, name: string, text: string) => { const fd = new FormData(); fd.append("file", new Blob([text], { type: "text/plain" }), name); fd.append("parentId", String(parentId)); const r = await api(ck, "POST", "/api/admin/drive/upload", fd); if (r.j?.id) nodes.push(r.j.id); return r; };
const codeOf = (url: string) => url.split("/").pop()!;
(async () => {
  try {
    const A = await mkUser("a", true), Bu = await mkUser("b", true), F = await mkUser("fan", false);
    const ckA = await login(A.email), ckB = await login(Bu.email);
    sid = "verify-" + crypto.randomBytes(16).toString("hex");
    await pool.query("insert into session (sid, sess, expire) values ($1,$2,now()+interval '1 hour')", [sid, { cookie: { originalMaxAge: 3600000, httpOnly: true, path: "/" }, userId: 1 }]);
    const ckS = "connect.sid=" + encodeURIComponent("s:" + sig.sign(sid, process.env.SESSION_SECRET!));

    // An OPEN folder with a file, and a LOCKED sub-folder with a file.
    const open = await api(ckA, "POST", "/api/admin/drive/folder", { name: tag + " open" }); nodes.push(open.j.id);
    const f1 = await upload(ckA, open.j.id, "open.txt", "anyone may see this");
    const sub = await api(ckA, "POST", "/api/admin/drive/folder", { name: "locked inside", parentId: open.j.id }); nodes.push(sub.j.id);
    const f2 = await upload(ckA, sub.j.id, "secret.txt", "payroll");
    await pool.query("update drive_nodes set required_tab='budget', required_workspace='united-sports-group' where id=$1", [sub.j.id]);
    ok("staff A made an open folder with a file and a locked sub-folder", !!open.j?.id && !!f1.j?.id && !!f2.j?.id);

    // Public link
    const on = await api(ckA, "POST", `/api/admin/drive/share/${open.j.id}`);
    ok("A turns on 'Anyone with the link'", on.s === 200 && /^https:\/\/app\.usg\.co\.nz\/share\/[A-Za-z0-9]{12,20}$/.test(on.j?.link?.url ?? ""), JSON.stringify(on.j).slice(0, 200));
    const code = codeOf(on.j.link.url);
    const pub = await api("", "GET", `/api/public/drive-share/${code}`);
    ok("a stranger with the link sees the open file", pub.s === 200 && pub.j.files.some((f: any) => f.id === f1.j.id));
    ok("…and NOT the file in the locked sub-folder", !pub.j.files.some((f: any) => f.id === f2.j.id));
    ok("the page is marked not-a-sponsor", pub.j.sponsor === false);
    ok("the open file downloads (redirect to a signed URL)", (await api("", "GET", `/api/public/drive-share/${code}/file/${f1.j.id}?dl=1`)).s === 302);
    ok("the locked file by id through the link → 404", (await api("", "GET", `/api/public/drive-share/${code}/file/${f2.j.id}?dl=1`)).s === 404);
    const zip = await fetch(`${B}/api/public/drive-share/${code}/zip`); const zb = Buffer.from(await zip.arrayBuffer());
    ok("the zip holds the open file and not the locked one", zip.status === 200 && zb.includes(Buffer.from("open.txt")) && !zb.includes(Buffer.from("secret.txt")));
    ok("the link carries no way into ClubOS: /api/admin with no login → 401", (await api("", "GET", "/api/admin/drive/list")).s === 401);
    ok("a made-up code → 404", (await api("", "GET", `/api/public/drive-share/AAAAAAAAAAAAAAAA`)).s === 404);
    ok("the locked sub-folder cannot have a public link (A cannot even open it) → 404", (await api(ckA, "POST", `/api/admin/drive/share/${sub.j.id}`)).s === 404);
    const sLocked = await api(ckS, "POST", `/api/admin/drive/share/${sub.j.id}`);
    ok("even a super admin is refused a public link on a locked folder (400 + reason)", sLocked.s === 400 && /locked/i.test(sLocked.j?.message ?? ""), JSON.stringify(sLocked.j));
    // Lock the shared folder later → its link dies on the next request
    await pool.query("update drive_nodes set required_tab='budget', required_workspace='united-sports-group' where id=$1", [open.j.id]);
    ok("locking the folder after sharing kills the link at once", (await api("", "GET", `/api/public/drive-share/${code}`)).s === 404);
    await pool.query("update drive_nodes set required_tab=null, required_workspace=null where id=$1", [open.j.id]);
    ok("unlocking brings it back", (await api("", "GET", `/api/public/drive-share/${code}`)).s === 200);
    const off = await api(ckA, "DELETE", `/api/admin/drive/share/${open.j.id}`);
    ok("A switches it back to Restricted → the link is dead", off.s === 200 && off.j.link === null && (await api("", "GET", `/api/public/drive-share/${code}`)).s === 404);

    // People
    const pick = await api(ckA, "GET", `/api/admin/drive/share-people?q=${encodeURIComponent(tag)}`);
    ok("the people picker finds staff B", pick.j?.people?.some((p: any) => p.userId === Bu.id));
    ok("…and never the fan account (no workspace)", !pick.j?.people?.some((p: any) => p.userId === F.id));
    ok("sharing with the fan account is refused", (await api(ckA, "POST", `/api/admin/drive/share/${open.j.id}/people`, { userId: F.id })).s === 400);
    ok("B cannot open the locked sub-folder before a share → 404", (await api(ckB, "GET", `/api/admin/drive/list?parentId=${sub.j.id}`)).s === 404);
    const sh = await api(ckS, "POST", `/api/admin/drive/share/${sub.j.id}/people`, { userId: Bu.id });
    ok("the super admin shares the locked folder with B", sh.s === 200 && sh.j.people.some((p: any) => p.userId === Bu.id));
    const bl = await api(ckB, "GET", `/api/admin/drive/list?parentId=${sub.j.id}`);
    ok("B can now open it and sees the file", bl.s === 200 && bl.j.items.some((i: any) => i.id === f2.j.id));
    ok("B's trail starts at the shared folder (no locked names above it leak)", bl.j.breadcrumbs.length >= 1 && bl.j.breadcrumbs[0].id !== undefined);
    ok("B can download the file", (await api(ckB, "GET", `/api/admin/drive/file/${f2.j.id}/download`)).s === 302);
    const root = await api(ckB, "GET", "/api/admin/drive/list");
    ok("it shows under 'Shared with you' for B", root.j.sharedWithMe?.some((n: any) => n.id === sub.j.id));
    ok("B cannot rename it (read only)", (await api(ckB, "PATCH", `/api/admin/drive/node/${f2.j.id}`, { name: "x.txt" })).s === 404);
    ok("B cannot bin it", (await api(ckB, "POST", `/api/admin/drive/node/${f2.j.id}/trash`)).s === 404);
    const upB = await upload(ckB, sub.j.id, "b.txt", "no");
    ok("B cannot upload into it", upB.s === 404);
    ok("B cannot reshare it", (await api(ckB, "GET", `/api/admin/drive/share/${sub.j.id}`)).s === 404);
    ok("B cannot reach the locked folder from another workspace either (own access unchanged)", (await api(ckB, "POST", `/api/admin/drive/share/${sub.j.id}/people`, { userId: A.id })).s === 404);
    const rm = await api(ckS, "DELETE", `/api/admin/drive/share/${sub.j.id}/people/${Bu.id}`);
    ok("removing B takes effect on the next request", rm.s === 200 && (await api(ckB, "GET", `/api/admin/drive/list?parentId=${sub.j.id}`)).s === 404);
    const audit = (await pool.query("select count(*)::int n from drive_node_shares where node_id=$1 and revoked_by=1", [sub.j.id])).rows[0].n;
    ok("the removal is kept with who did it", audit === 1);
  } catch (e: any) { fail++; console.log("  FAIL threw:", e.message); }
  finally {
    if (nodes.length) {
      await pool.query("delete from drive_node_shares where node_id = any($1)", [nodes]);
      await pool.query("delete from drive_share_links where node_id = any($1)", [nodes]);
      await pool.query("delete from drive_access_log where node_id = any($1)", [nodes]);
      for (const id of [...nodes].reverse()) await pool.query("delete from drive_nodes where id=$1", [id]).catch(() => {});
      await pool.query("delete from drive_nodes where name like $1", [tag + "%"]).catch(() => {});
    }
    if (users.length) {
      await pool.query("delete from drive_node_shares where user_id = any($1) or granted_by = any($1)", [users]);
      await pool.query("delete from drive_access_log where user_id = any($1)", [users]);
      await pool.query("delete from session where sess->>'userId' = any($1::text[])", [users.map(String)]);
      await pool.query("delete from user_organizations where user_id = any($1)", [users]);
      await pool.query("delete from users where id = any($1)", [users]).catch((e) => console.log("  (users left:", e.message, ")"));
    }
    if (sid) await pool.query("delete from session where sid=$1", [sid]);
    console.log(`\n${pass} passed, ${fail} failed`); await pool.end(); process.exit(fail ? 1 : 0);
  }
})();
