import pg from "pg"; import bcrypt from "bcryptjs"; import puppeteer from "puppeteer-core";
const BASE="https://app.usg.co.nz", WS="christchurch-united";
const CHROME=process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const wait=(m:number)=>new Promise(r=>setTimeout(r,m));
let pass=0,fail=0; const ok=(l:string,g:boolean,d="")=>{console.log(`  ${g?"ok  ":"FAIL"} ${l}${d?` — ${d}`:""}`);g?pass++:fail++;};
(async()=>{
  const email=`_mail_${Date.now()}@usg.co.nz`, pw=`T${Math.random().toString(36).slice(2)}!aA9`;
  const {rows}=await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Mail','Probe',$2,'team_member',true) RETURNING id`,[email,await bcrypt.hash(pw,10)]);
  const id=rows[0].id;
  const {rows:o}=await pool.query(`SELECT id FROM organizations WHERE slug=$1`,[WS]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`,[id,o[0].id]);
  const login=await fetch(`${BASE}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:pw})});
  const [n,v]=(login.headers.get("set-cookie")||"").split(";")[0].split("=");

  // the endpoint, as staff
  const api=await fetch(`${BASE}/api/admin/mailer/search-people?q=whittle`,{headers:{cookie:`${n}=${v}`,"X-Workspace-Slug":WS}});
  ok("search endpoint answers for ordinary staff", api.ok, `HTTP ${api.status}`);
  const body:any = api.ok ? await api.json() : {people:[]};
  const beauden = (body.people||[]).find((p:any)=>/Beauden Whittle/i.test(p.name));
  ok("a player is found by surname", !!beauden, (body.people||[]).slice(0,3).map((p:any)=>p.name).join(", "));
  ok("the player resolves to a real address", !!beauden?.email, beauden?.email ?? "none");
  const unreachable=(body.people||[]).find((p:any)=>!p.email);
  console.log(`        sample: ${(body.people||[]).slice(0,4).map((p:any)=>`${p.name} → ${p.email??"UNREACHABLE"}${p.emailOwner?` (via ${p.emailOwner})`:""}`).join("  |  ")}`);
  ok("the endpoint refuses a stranger", (await fetch(`${BASE}/api/admin/mailer/search-people?q=whittle`)).status===401);

  // the UI
  const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox"]});
  const p=await b.newPage(); await p.setViewport({width:1440,height:900,deviceScaleFactor:2});
  const errs:string[]=[]; p.on("pageerror",(e:any)=>errs.push(String(e.message).slice(0,120)));
  await p.setCookie({name:n,value:v,domain:"app.usg.co.nz",path:"/",httpOnly:true,secure:true});
  await p.goto(`${BASE}/admin`,{waitUntil:"domcontentloaded"});
  await p.evaluate((s:string)=>localStorage.setItem("clubos_workspace",s),WS);
  await p.goto(`${BASE}/admin/mailer`,{waitUntil:"networkidle2"}); await wait(3200);
  const box=await p.$('[data-testid="input-recipient-search"]');
  ok("the search box is on the Mailer page", !!box);
  if(box){
    await box.type("whittle",{delay:40}); await wait(1800);
    const results=await p.evaluate(()=>Array.from(document.querySelectorAll('[data-testid^="option-person-"]')).map(e=>(e as HTMLElement).innerText.replace(/\s+/g," ").trim()));
    console.log(`        dropdown: ${results.slice(0,4).join(" | ")}`);
    ok("results appear as she types", results.length>0, `${results.length}`);
    ok("a result shows the address", results.some(r=>/@/.test(r)));
    const first=await p.$('[data-testid^="option-person-"]');
    if(first){ await first.click(); await wait(900); }
    const chips=await p.evaluate(()=>Array.from(document.querySelectorAll('[data-testid^="button-remove-"]')).length);
    ok("clicking a person adds them as a recipient", chips>0, `${chips} chip(s)`);
  }
  ok("no React error", errs.length===0, errs.slice(0,2).join(" · "));
  await p.screenshot({path:"/tmp/mailer-search.png"});
  await b.close();
  await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`,[id]);
  await pool.query(`DELETE FROM users WHERE id=$1`,[id]); await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
