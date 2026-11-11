/** Read-only: run the three Marketing reports against the database and print them. */
import { apps, offers, wordOfMouth } from "../server/marketing-hub/more-reports";
import { pool } from "../server/db";
(async () => {
  for (const p of ["90d", "year", "all"]) {
    const t = Date.now();
    const w = await wordOfMouth(p);
    console.log(p, "wom", Date.now() - t, "ms", { bookings: w.bookings, answered: w.answered, groups: w.groups.map((g) => `${g.label} ${g.count}`).join(" | ") });
    if (w.groups.reduce((s, g) => s + g.count, 0) !== w.answered) throw new Error("groups do not add up to answered");
    if (w.byWorkspace.reduce((s, x) => s + x.bookings, 0) !== w.bookings) throw new Error("workspaces do not add up");
  }
  const w = await wordOfMouth("all");
  console.table(w.byWorkspace);
  console.table(w.answers);
  const o = await offers("all");
  console.log("offers", o.totals, "unused", o.unused.length);
  console.table(o.rows.slice(0, 14));
  console.table((await apps()).apps);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
