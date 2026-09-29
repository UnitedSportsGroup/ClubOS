// read-only query runner: node q.cjs "<sql>" [more sql...] → JSON rows per query

const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("set default_transaction_read_only = on"); await c.query("begin read only");
  const out = [];
  for (const q of process.argv.slice(2)) { await c.query('savepoint s'); try { out.push((await c.query(q)).rows); await c.query('release savepoint s'); } catch (e) { out.push({ error: e.message }); await c.query('rollback to savepoint s'); } }
  await c.query("rollback"); await c.end();
  console.log(JSON.stringify(out, null, 1));
})();
