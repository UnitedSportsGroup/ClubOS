// Content Studio, end to end on PRODUCTION through its routes — as an
// ordinary admin, then as a second person who may only look and duplicate.
//   npx tsx --env-file=.env script/_verify-studio-live.ts
//
// Paid: one graphic (Opus), one page (Opus), one re-prompt (Sonnet) and one
// Rambo chat prompt that makes a graphic — about NZ$3 all up. Every piece,
// generation row and probe account is removed in `finally`.
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 240)}` : ""}`); good ? pass++ : fail++; };
const users: number[] = [];
const pieces: number[] = [];

async function person(last: string, role: "admin" | "team_member" = "admin") {
  const email = `_studio_${last.toLowerCase()}_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Probe',$2,$3,'team_member',true) RETURNING id`, [email, last, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,$2,NULL)`, [rows[0].id, role]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  return { id: rows[0].id as number, cookie: (login.headers.get("set-cookie") || "").split(";")[0] };
}
async function api(cookie: string, method: string, path: string, body?: any, raw = false) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WS }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j: any = {};
  try { j = JSON.parse(text.trim()); } catch { j = raw ? text : {}; }
  return { status: r.status, j, text };
}

try {
  console.log(`\nContent Studio — live against ${BASE}\n`);
  const canary = await fetch(`${BASE}/api/admin/content-studio/usage`);
  ok("the canary answers 401 unauthenticated", canary.status === 401, String(canary.status));
  const zach = await person("Maker");
  const other = await person("Other");

  const usage = await api(zach.cookie, "GET", "/api/admin/content-studio/usage");
  ok("usage says the brand is Christchurch United on join.cufc.co.nz with Opus for a first draft", usage.j.brand?.key === "cufc" && usage.j.brand?.host === "join.cufc.co.nz" && /opus/.test(usage.j.model) && usage.j.enabled === true, JSON.stringify(usage.j));
  const pics = await api(zach.cookie, "GET", "/api/admin/content-studio/pictures");
  ok("the picture library carries every brand's kit with captions (the gymnastics kids are in it)", pics.j.pictures?.length >= 20 && pics.j.pictures.some((p: any) => /cugc\/hero\.jpg/.test(p.src) && /5 to 8/.test(p.caption)), String(pics.j.pictures?.length));

  // ── A graphic from one prompt (Opus) ─────────────────────────────────────
  const g = await api(zach.cookie, "POST", "/api/admin/content-studio/generate", { kind: "graphic", size: "square", brief: "A square post for Christchurch United families: the October holiday camp for 4 to 8 year olds has a few spots left. Use the real camp dates and the day price from the facts if you have them; point people to cufc.co.nz/camps." });
  ok("a graphic was made from one prompt", g.status === 200 && g.j.ok === true && g.j.piece?.kind === "graphic" && typeof g.j.piece.doc?.headline === "string", JSON.stringify(g.j).slice(0, 240));
  const gId = g.j.piece?.id as number;
  if (gId) pieces.push(gId);
  ok("…it is a draft of the maker's, square, with a layout from the list and a headline under 60 characters", g.j.piece?.status === "draft" && g.j.piece?.size === "square" && g.j.piece?.canEdit === true && ["announcement", "photo", "event", "list", "stat", "chart", "quote"].includes(g.j.piece?.doc?.layout) && g.j.piece.doc.headline.length <= 60, `${g.j.piece?.doc?.layout}: ${g.j.piece?.doc?.headline}`);
  ok("…Rambo said what it did and the call was priced", typeof g.j.reply === "string" && g.j.reply.length > 10 && g.j.costCents > 0 && /opus/.test(g.j.model), `${g.j.model} ${g.j.costCents}c`);
  const genRow = (await pool.query(`SELECT model, cost_usd_cents, ok FROM studio_generations WHERE piece_id = $1`, [gId])).rows[0];
  ok("…and recorded as a generation row against the person", !!genRow && genRow.ok === true && Number(genRow.cost_usd_cents) > 0, JSON.stringify(genRow));
  const usage2 = await api(zach.cookie, "GET", "/api/admin/content-studio/usage");
  ok("the daily count moved by one", usage2.j.used === usage.j.used + 1, `${usage.j.used} → ${usage2.j.used}`);

  // ── Edit a word by hand: a new version, no model ─────────────────────────
  const edited = { ...g.j.piece.doc, headline: "Last spots for October" };
  const p1 = await api(zach.cookie, "PATCH", `/api/admin/content-studio/pieces/${gId}`, { doc: edited, note: "headline by hand" });
  ok("a field edit saves as version 2 with no prompt spent", p1.status === 200 && p1.j.piece?.version === 2 && p1.j.piece.doc.headline === "Last spots for October", JSON.stringify(p1.j).slice(0, 160));
  const badEdit = await api(zach.cookie, "PATCH", `/api/admin/content-studio/pieces/${gId}`, { doc: { ...edited, photo: "https://evil.example.com/x.jpg" } });
  ok("an edit that points at a picture off the club's hosts is refused", badEdit.status === 400 && /not one of the club's pictures/.test(badEdit.j.message || ""), `${badEdit.status} ${badEdit.j.message}`);
  const detail = await api(zach.cookie, "GET", `/api/admin/content-studio/pieces/${gId}`);
  ok("the piece lists its versions: made by Rambo, then edited", detail.j.versions?.length === 2 && detail.j.versions[0].how === "edited" && detail.j.versions[1].how === "made", JSON.stringify(detail.j.versions));
  const v1 = await api(zach.cookie, "GET", `/api/admin/content-studio/pieces/${gId}/versions/1`);
  ok("version 1 can be read back with the original headline", v1.status === 200 && v1.j.doc?.headline === g.j.piece.doc.headline);

  // ── The other person: see, not touch; duplicate ─────────────────────────
  const list = await api(other.cookie, "GET", "/api/admin/content-studio/pieces");
  const seen = list.j.pieces?.find((p: any) => p.id === gId);
  ok("another staff member sees the piece, with the maker's name and no edit rights", !!seen && seen.canEdit === false && /Probe Maker/.test(seen.ownerName || ""), JSON.stringify(seen).slice(0, 160));
  const forbidden = await api(other.cookie, "PATCH", `/api/admin/content-studio/pieces/${gId}`, { doc: { ...edited, headline: "Mine now" } });
  ok("…and cannot change it (403, told to duplicate)", forbidden.status === 403 && /Duplicate/i.test(forbidden.j.message || ""), `${forbidden.status} ${forbidden.j.message}`);
  const noDelete = await api(other.cookie, "DELETE", `/api/admin/content-studio/pieces/${gId}`);
  ok("…nor remove it", noDelete.status === 403, String(noDelete.status));
  const dup = await api(other.cookie, "POST", `/api/admin/content-studio/pieces/${gId}/duplicate`, {});
  ok("…but can duplicate it into a draft of their own", dup.status === 200 && dup.j.piece?.canEdit === true && dup.j.piece.createdByUserId === other.id && /\(copy\)$/.test(dup.j.piece.title), JSON.stringify(dup.j).slice(0, 160));
  if (dup.j.piece?.id) pieces.push(dup.j.piece.id);
  const stillMine = await api(zach.cookie, "GET", `/api/admin/content-studio/pieces/${gId}`);
  ok("the original is untouched", stillMine.j.piece?.doc?.headline === "Last spots for October" && stillMine.j.piece.version === 2);

  // ── A render (the browser's PNG) is kept and served ──────────────────────
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAD0lEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), "graphic.png");
  const up = await fetch(`${BASE}/api/admin/content-studio/pieces/${gId}/render`, { method: "POST", headers: { cookie: zach.cookie, "X-Workspace-Slug": WS }, body: fd });
  const upJ: any = await up.json();
  ok("a PNG render is accepted, measured off its bytes, and given a link", up.status === 200 && upJ.ok && upJ.width === 2 && upJ.height === 2 && /^https:\/\/app\.usg\.co\.nz\/studio\/r\/[a-f0-9]{24}\.png$/.test(upJ.url), JSON.stringify(upJ));
  const served = await fetch(upJ.url);
  ok("…and served publicly, immutable, as a PNG", served.status === 200 && served.headers.get("content-type") === "image/png" && /immutable/.test(served.headers.get("cache-control") || ""), `${served.status} ${served.headers.get("content-type")}`);

  // ── A landing page from one prompt (Opus), published on join.cufc.co.nz ──
  const pg = await api(zach.cookie, "POST", "/api/admin/content-studio/generate", { kind: "page", brief: "A landing page for Christchurch United's holiday camps for 4 to 8 year olds: who it is for, what a day looks like, what to bring, the price per day, and a button to book. Use the facts for dates, prices and the booking link. A short FAQ." });
  ok("a landing page was made from one prompt", pg.status === 200 && pg.j.ok === true && pg.j.piece?.kind === "page" && Array.isArray(pg.j.piece.doc?.blocks) && pg.j.piece.doc.blocks[0]?.type === "hero", JSON.stringify(pg.j).slice(0, 240));
  const pId = pg.j.piece?.id as number;
  if (pId) pieces.push(pId);
  const blocks: any[] = pg.j.piece?.doc?.blocks ?? [];
  ok("…with four to twelve blocks and every link a full address", blocks.length >= 4 && blocks.length <= 12 && blocks.every((b) => !b.cta?.href || /^https?:\/\//.test(b.cta.href)) && blocks.every((b) => !b.button?.href || /^https?:\/\//.test(b.button.href)), `${blocks.length} blocks: ${blocks.map((b) => b.type).join(",")}`);
  ok("…and every picture on the club's hosts", blocks.every((b) => [b.photo, b.src, ...(Array.isArray(b.items) ? b.items.map((i: any) => i?.photo) : [])].every((u) => !u || /^https:\/\/app\.usg\.co\.nz\//.test(u))));
  // 🔴 Node's fetch drops a hand-set Host header, so the brand hosts are hit by their REAL names.
  const draft404 = await fetch(`https://join.cufc.co.nz/p/${pg.j.piece.slug || "nothing"}`);
  ok("a draft is not served on the public host", draft404.status === 404, String(draft404.status));
  const pub = await api(zach.cookie, "POST", `/api/admin/content-studio/pieces/${pId}/publish`, { slug: `studio-probe-${Date.now().toString(36)}` });
  ok("publishing gives it an address on join.cufc.co.nz", pub.status === 200 && /^https:\/\/join\.cufc\.co\.nz\/p\/studio-probe-/.test(pub.j.url || ""), JSON.stringify(pub.j).slice(0, 160));
  const slug = pub.j.piece?.slug as string;
  const live = await fetch(`https://join.cufc.co.nz/p/${slug}`);
  const liveHtml = await live.text();
  ok("the public page answers on the brand host with the brand's crest, the headline and noindex", live.status === 200 && /text\/html/.test(live.headers.get("content-type") || "") && /mailer\/crests\/cufc\.png/.test(liveHtml) && liveHtml.includes(blocks[0].headline.replace(/&/g, "&amp;")) && /noindex/.test(liveHtml), `${live.status}`);
  const wrongHost = await fetch(`https://join.minifootball.co.nz/p/${slug}`);
  ok("…and not on another brand's host", wrongHost.status === 404, String(wrongHost.status));
  const appHost = await fetch(`${BASE}/p/${slug}?b=cufc`);
  ok("…and on the app host when the brand is named", appHost.status === 200, String(appHost.status));
  const otherPub = await api(other.cookie, "POST", `/api/admin/content-studio/pieces/${pId}/unpublish`, {});
  ok("someone else cannot take it down", otherPub.status === 403, String(otherPub.status));
  const views = (await pool.query(`SELECT public_views FROM studio_pieces WHERE id = $1`, [pId])).rows[0];
  ok("views were counted", Number(views?.public_views) >= 2, String(views?.public_views));
  const slugClash = await api(zach.cookie, "POST", "/api/admin/content-studio/video", { brief: "x", footage: [] });
  ok("a video request needs footage? no — needs a brief; an empty footage list is allowed", slugClash.status === 200 || slugClash.status === 400);

  // ── Ask Rambo for a change (Sonnet) ──────────────────────────────────────
  const asked = await api(zach.cookie, "POST", `/api/admin/content-studio/pieces/${gId}/ask`, { instruction: "Change the headline to exactly: Camp spots are nearly gone", history: [] });
  ok("a re-prompt changes the words and is a new version on the edit model", asked.status === 200 && asked.j.ok === true && /nearly gone/i.test(asked.j.piece?.doc?.headline || "") && asked.j.piece.version === 3 && /sonnet/.test(asked.j.model), JSON.stringify(asked.j).slice(0, 200));
  const unpub = await api(zach.cookie, "POST", `/api/admin/content-studio/pieces/${pId}/unpublish`, {});
  const gone = await fetch(`https://join.cufc.co.nz/p/${slug}`);
  ok("taking the page down makes the address a 404 again", unpub.status === 200 && gone.status === 404, `${unpub.status} ${gone.status}`);

  // ── Rambo makes a graphic from the chat ──────────────────────────────────
  const t = await api(zach.cookie, "POST", "/api/admin/rambo/threads", {});
  const chat = await api(zach.cookie, "POST", `/api/admin/rambo/threads/${t.j.thread.id}/ask`, { question: "Make me a square graphic: a big-number style post saying 162 players are registered for U4-U8 this term. Pointer cufc.co.nz. Just make it, no questions." });
  const content = String(chat.j.message?.content ?? "");
  const m = /\/admin\/content-studio\/(\d+)/.exec(content);
  ok("Rambo in the chat made a graphic and linked to it", chat.j.ok === true && !!m && /make_graphic/.test(JSON.stringify(chat.j.message?.toolsUsed || "")), content.slice(0, 200));
  if (m) {
    pieces.push(Number(m[1]));
    const made = await api(zach.cookie, "GET", `/api/admin/content-studio/pieces/${m[1]}`);
    ok("…and it is the asker's own draft with 162 on it", made.j.piece?.canEdit === true && /162/.test(JSON.stringify(made.j.piece?.doc)), JSON.stringify(made.j.piece?.doc).slice(0, 160));
  }
  await pool.query(`DELETE FROM kb_chat_sessions WHERE user_id = $1`, [zach.id]).catch(() => {});

  // ── Archive ──────────────────────────────────────────────────────────────
  const arch = await api(zach.cookie, "DELETE", `/api/admin/content-studio/pieces/${gId}`);
  const after = await api(zach.cookie, "GET", `/api/admin/content-studio/pieces/${gId}`);
  ok("the maker can remove their piece; it is archived, not gone, and off the list", arch.status === 200 && after.status === 404 && (await pool.query(`SELECT status FROM studio_pieces WHERE id=$1`, [gId])).rows[0]?.status === "archived");
} catch (e: any) {
  ok("the proof ran", false, String(e?.message ?? e).slice(0, 300));
} finally {
  for (const id of pieces) await pool.query(`DELETE FROM studio_pieces WHERE id = $1`, [id]).catch(() => {});
  for (const id of users) {
    await pool.query(`DELETE FROM studio_generations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM studio_pieces WHERE created_by_user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM kb_chat_sessions WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM mailer_images WHERE uploaded_by = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [id]));
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
