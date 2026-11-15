/**
 * One Mailer, every workspace (2026-11-14) — live check, as ORDINARY workspace
 * admins (a super admin sees through scoping). Writes nothing but two throwaway
 * users (deleted) and ONE test email per workspace to delivered@resend.dev.
 *   npx tsx --env-file=.env script/_verify-one-mailer-live.ts
 */
import puppeteer from "puppeteer-core"; import pg from "pg"; import bcrypt from "bcryptjs";
const BASE = "https://app.usg.co.nz";
const SHOTS = process.env.SHOTS || "/tmp";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let failed = 0; const ok = (m: string) => console.log("  ok   " + m); const bad = (m: string) => { failed++; console.log("  FAIL " + m); };
const users: number[] = []; let browser: any = null;
const WS = ["christchurch-united", "united-gymnastics", "mini-football-leagues", "christchurch-international-cup", "south-island-united"];
try {
  const orgs = new Map((await pool.query("select id, slug from organizations")).rows.map((r: any) => [r.slug, r.id]));
  const email = `_mailer_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query("INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Mailer','Check',$2,'admin',true) RETURNING id", [email, await bcrypt.hash(pw, 10)]);
  users.push(rows[0].id);
  for (const s of WS) await pool.query("INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)", [rows[0].id, orgs.get(s)]);
  // A second account in Gymnastics ONLY, to prove another workspace answers 404.
  const e2 = `_mailer2_${Date.now()}@usg.co.nz`;
  const r2 = await pool.query("INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Mailer','Gym',$2,'admin',true) RETURNING id", [e2, await bcrypt.hash(pw, 10)]);
  users.push(r2.rows[0].id);
  await pool.query("INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)", [r2.rows[0].id, orgs.get("united-gymnastics")]);
  const login = async (em: string) => (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em, password: pw }) })).headers.get("set-cookie")!.split(";")[0];
  const ck = await login(email), ck2 = await login(e2);
  const api = async (c: string, slug: string | null, path: string, body?: any) => {
    const r = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { cookie: c, "Content-Type": "application/json", ...(slug ? { "X-Workspace-Slug": slug } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j: any = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  const count = async (slug: string, segmentType: string, segmentConfig: any) => (await api(ck, slug, "/api/admin/mailer/preview-recipients", { segmentType, segmentConfig })).j;

  // Gates
  const noHdr = await api(ck, null, "/api/admin/mailer/audiences");
  noHdr.status === 400 ? ok("no workspace header → 400") : bad(`no header → ${noHdr.status}`);
  const foreign = await api(ck2, "christchurch-united", "/api/admin/mailer/campaigns");
  foreign.status === 404 ? ok("gym-only account asking for CUFC history → 404") : bad(`foreign workspace → ${foreign.status}`);

  for (const slug of WS) {
    const w = await api(ck, slug, "/api/admin/mailer/workspace");
    w.status === 200 ? ok(`${slug}: kind ${w.j.kind}, from ${w.j.defaultFrom}`) : bad(`${slug} workspace ${w.status}`);
    const cat = await api(ck, slug, "/api/admin/mailer/audiences");
    cat.status === 200 ? ok(`${slug}: catalogue (${cat.j.kind ?? "programmes"})`) : bad(`${slug} catalogue ${cat.status} ${JSON.stringify(cat.j)}`);
    const all = await count(slug, "all", {});
    all?.count >= 0 ? ok(`${slug}: Everyone = ${all.count} (will send ${all.willSend})`) : bad(`${slug} all ${JSON.stringify(all)}`);
    const h = await api(ck, slug, "/api/admin/mailer/campaigns?limit=100");
    if (h.status !== 200) bad(`${slug} history ${h.status}`);
    else {
      const types = Array.from(new Set(h.j.campaigns.map((c: any) => String(c.segmentType).split("_")[0])));
      ok(`${slug}: history ${h.j.total} campaigns · segment kinds ${types.join(",") || "none"}`);
      if (slug === "united-gymnastics" && types.some((t: any) => t !== "cugc" && t !== "group" && t !== "custom" && t !== "all")) bad("gym history holds another workspace's sends");
      if (slug === "christchurch-united" && types.some((t: any) => ["cugc", "cic", "league"].includes(t))) bad("CUFC history holds another workspace's sends");
    }
    const auto = await api(ck, slug, "/api/admin/mailer/automations");
    auto.status === 200 ? ok(`${slug}: automations ${auto.j.automations?.length ?? 0}`) : bad(`${slug} automations ${auto.status}`);
  }

  // CUGC: the counts against SQL
  const gym = orgs.get("united-gymnastics");
  const sqlPaid = Number((await pool.query("select count(distinct lower(trim(email))) n from cugc_registrations where organization_id=$1 and status='paid' and term='Term 4 2026'", [gym])).rows[0].n);
  const c1 = await count("united-gymnastics", "group", { choice: { who: "confirmed", term: "t4-2026", program: "" } });
  c1.count === sqlPaid ? ok(`gym confirmed T4 = ${c1.count} = SQL`) : bad(`gym confirmed T4 ${c1.count} vs SQL ${sqlPaid}`);
  const sqlTrial = Number((await pool.query("select count(distinct lower(trim(email))) n from cugc_free_sessions where organization_id=$1 and status<>'cancelled' and session_date between '2026-10-12' and '2026-12-18'", [gym])).rows[0].n);
  const c2 = await count("united-gymnastics", "group", { choice: { who: "trial", term: "t4-2026", program: "" } });
  c2.count === sqlTrial ? ok(`gym trialists T4 = ${c2.count} = SQL`) : bad(`gym trial ${c2.count} vs SQL ${sqlTrial}`);
  // CUFC Everyone: never the MFL-only families
  const cufc = await count("christchurch-united", "all", {});
  cufc.count > 4000 ? ok(`CUFC Everyone ${cufc.count} (was 5,422 across every workspace)`) : bad(`CUFC Everyone suspiciously small: ${cufc.count}`);
  // MFL + CIC one group each
  const m = await count("mini-football-leagues", "group", { choice: { who: "captains", term: "", division: "" } });
  m.count >= 0 ? ok(`MFL captains, every term = ${m.count}`) : bad(`MFL captains ${JSON.stringify(m)}`);
  const c = await count("christchurch-international-cup", "group", { choice: { event: "7s", edition: "" } });
  c.count >= 0 ? ok(`CIC 7's every edition = ${c.count}`) : bad(`CIC 7s ${JSON.stringify(c)}`);

  // Test sends (one per brand) to Resend's test inbox
  for (const slug of ["united-gymnastics", "mini-football-leagues", "christchurch-international-cup"]) {
    const t = await api(ck, slug, "/api/admin/mailer/test-send", { to: "delivered@resend.dev", subject: "One Mailer check", body: "<html><body><p>Hello {{first_name}}</p></body></html>" });
    t.j?.ok ? ok(`${slug}: test send accepted by Resend`) : bad(`${slug} test send ${JSON.stringify(t.j).slice(0, 160)}`);
  }

  // Browser: the page, history and automations in each workspace
  browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
  const [cn, cv] = ck.split("=");
  for (const slug of ["united-gymnastics", "mini-football-leagues", "christchurch-international-cup", "christchurch-united"]) {
    for (const [path, name] of [["/admin/mailer", "mailer"], ["/admin/mailer/history", "history"], ["/admin/mailer/automations", "automations"]]) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
      await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
      await page.evaluateOnNewDocument((s: string) => { try { localStorage.setItem("clubos_workspace", s); sessionStorage.setItem("clubos_workspace", s); } catch {} }, slug);
      const errs: string[] = []; page.on("pageerror", (e: any) => errs.push(e.message));
      await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 2500));
      if (name === "mailer") {
        const btn = await page.$('[data-testid="button-segment-group"]') || await page.$('[data-testid="button-segment-programme"]');
        if (btn) { await btn.click(); await new Promise((r) => setTimeout(r, 3000)); }
      }
      const info = await page.evaluate(() => ({ ws: document.body.innerText.slice(0, 80).replace(/\s+/g, " "), main: (document.querySelector("main")?.textContent || "").length, picker: !!document.querySelector('[data-testid="group-picker"]'), count: document.querySelector('[data-testid="group-picker-count"]')?.textContent || "" }));
      const react = errs.find((e) => /Minified React error|is not defined|undefined is not/i.test(e));
      if (react || info.main < 60) bad(`${slug} ${path}: ${react || "blank"}`);
      else ok(`${slug} ${path}: renders${name === "mailer" ? ` · group picker ${info.picker} ${info.count}` : ""}`);
      await page.screenshot({ path: `${SHOTS}/mailer-${slug}-${name}.png` });
      await page.close();
    }
  }
} catch (e: any) { bad("threw: " + e.message); }
finally {
  if (browser) await browser.close();
  for (const id of users) { await pool.query("DELETE FROM user_organizations WHERE user_id=$1", [id]); await pool.query("DELETE FROM users WHERE id=$1", [id]); }
  await pool.end();
}
console.log(failed ? `\n✗ ${failed} failed` : "\n✓ all passed"); process.exit(failed ? 1 : 0);
