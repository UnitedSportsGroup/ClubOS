import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (s: string) => (await pool.query(s)).rows;
console.log(await q(`select id, slug from organizations order by id`));
console.log(await q(`
with g as (select id, lower(trim(email)) email from contacts where type='guardian' and coalesce(email,'')<>''),
ties as (
  select c.id cid, p.organization_id org from registrations r join programs p on p.id=r.program_id
   join contacts c on c.id in (r.contact_id, r.guardian_id)
   where r.status in ('confirmed','refunded','partially_refunded')
)
select
  count(distinct g.email) total,
  count(distinct g.email) filter (where exists (select 1 from ties t where t.cid=g.id and t.org=1)) with_cufc,
  count(distinct g.email) filter (where not exists (select 1 from ties t where t.cid=g.id)) no_regs,
  count(distinct g.email) filter (where exists (select 1 from ties t where t.cid=g.id) and not exists (select 1 from ties t where t.cid=g.id and t.org=1)) other_only
from g`));
console.log(await q(`select p.organization_id org, count(distinct r.id) regs from registrations r join programs p on p.id=r.program_id where r.status in ('confirmed','refunded','partially_refunded') group by 1`));
await pool.end();
