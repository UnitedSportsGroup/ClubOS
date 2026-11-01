// Serve ONLY the Website routes locally — no schedulers, no other routes.
// For testing a site build (cufc-website's gen-news-api) or the Website tab's
// preview against REAL data without booting ClubOS (which would start eight
// schedulers against the live database).
//   npx tsx --env-file=.env script/_serve-sites-public.ts 5321              # public routes only
//   npx tsx --env-file=.env script/_serve-sites-public.ts 5322 --as 1       # + admin routes as user 1
// 🔴 It talks to the LIVE database. With --as, every click is that person's,
// for real. Use it to LOOK; write through the e2e script, which cleans up.
import express from "express";
import { registerSiteRoutes } from "../server/site-routes";
const port = Number(process.argv[2] || 5321);
const as = process.argv.includes("--as") ? Number(process.argv[process.argv.indexOf("--as") + 1]) : undefined;
const app = express(); app.use(express.json());
app.use((req: any, _r, n) => { req.session = { userId: as }; n(); });
registerSiteRoutes(app);
app.listen(port, "127.0.0.1", () => console.log(`ready on ${port}${as ? ` as user ${as}` : ""}`));
