const {Client}=require('pg');const fs=require('fs');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
let sp=JSON.parse(fs.readFileSync(process.argv[2]));sp=Array.isArray(sp)?sp:sp.products;
const cv=(await c.query("select v.id,v.product_id,v.size,v.sku,v.stock,v.active,coalesce(v.price_cents,p.price_cents) price,p.title,p.status from shop_variants v join shop_products p on p.id=v.product_id where p.organization_id=1 and p.type<>'photo'")).rows;
const bySku={};cv.forEach(x=>{if(x.sku)(bySku[x.sku]=bySku[x.sku]||[]).push(x)});
const s={variants:0,matched:0,noSku:0,missing:0,dup:0,priceDiff:0,stockDiff:0,shopifyUnits:0,clubosUnits:0};const lines=[];
for(const p of sp)for(const v of p.variants){s.variants++;s.shopifyUnits+=Math.max(0,v.inventory_quantity||0);
 if(!v.sku){s.noSku++;lines.push(`no sku: ${p.title} / ${v.title} stock ${v.inventory_quantity}`);continue}
 const m=bySku[v.sku]||[];if(!m.length){s.missing++;lines.push(`missing: ${p.status} ${p.title} / ${v.title} ${v.sku} stock ${v.inventory_quantity}`);continue}
 if(m.length>1)s.dup++;const x=m[0];s.matched++;
 const spr=Math.round(parseFloat(v.price)*100);if(x.price!==spr){s.priceDiff++;lines.push(`price: ${x.title} ${x.size} clubos ${x.price} shopify ${spr}`)}
 if(x.stock!==v.inventory_quantity){s.stockDiff++;lines.push(`stock: ${x.title} ${x.size} (${v.sku}) clubos ${x.stock} shopify ${v.inventory_quantity}`)}}
s.clubosUnits=cv.reduce((a,x)=>a+Math.max(0,x.stock||0),0);
console.log(lines.join('\n'));console.log(s);await c.end()})()
