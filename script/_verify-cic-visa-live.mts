// Book an overseas team saying it needs visa support; check the column; delete it.
import pg from "pg";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const input = { origin: "overseas", pkg: "legacy", age: "U12", players: 13, staff: 2, adults: 0, nights: 4, vans: 1, breakfast: true, addOns: [] };
const r = await fetch("https://join.cicyouth.com/api/public/cic/packages/book", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input, clubName: "ZZ Probe Visa FC", managerName: "Probe", managerEmail: "probe-visa@example.com", managerPhone: "0210000000", termsAccepted: true, website: "probe", visaSupport: true }) });
console.log("book", r.status);
const row = (await db.query(`SELECT id, visa_support FROM cic_pkg_bookings WHERE club_name='ZZ Probe Visa FC'`)).rows;
console.log("saved:", row.map((x) => x.visa_support));
await db.query(`DELETE FROM cic_pkg_bookings WHERE club_name='ZZ Probe Visa FC'`);
console.log("left:", (await db.query(`SELECT count(*)::int n FROM cic_pkg_bookings WHERE club_name='ZZ Probe Visa FC'`)).rows[0].n);
await db.end();
