import pg from "pg";
import { readFileSync } from "fs";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync("migrations/2026-11-26_cic_packages_visa.sql", "utf8"));
const r = await c.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='cic_pkg_bookings' AND column_name='visa_support'`);
console.log(r.rows);
await c.end();
