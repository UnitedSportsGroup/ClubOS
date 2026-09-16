import pg from "pg"; import bcrypt from "bcryptjs"; import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "https://app.usg.co.nz"; const WS = "christchurch-international-cup";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  const email = `_shot_${Date.now()}@usg.co.nz`, pw = `S${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Shot','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw,10)]);
  const uid = rows[0].id;
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`,[WS]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`,[uid,org[0].id]);
  const r = await fetch(`${BASE}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:pw})});
  const [n,v] = (r.headers.get("set-cookie")||"").split(";")[0].split("=");
  const b = await puppeteer.launch({ executablePath: CHROME, headless:"new", args:["--no-sandbox"] });
  const page = await b.newPage(); await page.setViewport({width:1440,height:900});
  await page.setCookie({name:n,value:v,domain:"app.usg.co.nz",path:"/",httpOnly:true,secure:true});
  const errs: string[] = []; page.on("pageerror", (e:any)=>errs.push(String(e.message).slice(0,120)));
  await page.goto(`${BASE}/admin`,{waitUntil:"domcontentloaded"});
  await page.evaluate((w:string)=>localStorage.setItem("clubos_workspace",w),WS);
  for (const [name, url] of [["all", "/admin/cic7s-registrations"], ["2026", "/admin/cic7s-registrations?year=2026"]] as const) {
    await page.goto(`${BASE}${url}`,{waitUntil:"networkidle2"});
    await new Promise(r=>setTimeout(r,3000));
    await page.screenshot({ path: `/tmp/cic7s-${name}.png` });
  }
  console.log("runtime errors:", errs.length ? errs.join(" | ") : "none");
  const txt = await page.evaluate(()=>document.body.innerText);
  console.log(txt.split("\n").slice(0,12).join("\n"));
  await b.close();
  await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`,[uid]); await pool.query(`DELETE FROM users WHERE id=$1`,[uid]);
  await pool.end(); process.exit(0);
}
main();
