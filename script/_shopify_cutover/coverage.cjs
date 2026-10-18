// Which CUFC Shopify order lines are NOT yet in ClubOS (fm_payment_history or mfl_customer_history)?
const {Client}=require('pg');const fs=require('fs');
const A=process.argv[2];
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const have=new Set();
for(const r of (await c.query("select external_key k from fm_payment_history where source='shopify'")).rows){const m=/^shopify:(\d+)/.exec(r.k);if(m)have.add(m[1]);}
const mfl=new Set((await c.query("select external_line_id k from mfl_customer_history where external_line_id is not null")).rows.map(r=>String(r.k)));
let o=JSON.parse(fs.readFileSync(A+'/raw/orders.json'));o=Array.isArray(o)?o:o.orders;
const out={fm:0,mfl:0,missing:[]};
for(const od of o)for(const li of od.line_items){const id=String(li.id);if(have.has(id))out.fm++;else if(mfl.has(id))out.mfl++;else out.missing.push({order:od.name,id,title:li.title,cents:Math.round(parseFloat(li.price)*100)*li.quantity,fin:od.financial_status,at:od.created_at});}
console.log('in fm history',out.fm,'in mfl history',out.mfl,'missing',out.missing.length);
const g={};for(const m of out.missing){g[m.title]=g[m.title]||[0,0];g[m.title][0]++;g[m.title][1]+=m.cents}
Object.entries(g).sort((a,b)=>b[1][0]-a[1][0]).forEach(([t,[n,v]])=>console.log(String(n).padStart(4),('$'+(v/100).toFixed(2)).padStart(10),t));
fs.writeFileSync(process.argv[3],JSON.stringify(out.missing));await c.end()})()
