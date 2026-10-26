// Run each history tool for real (READ ONLY) and print the text Rambo would see.
import type { Viewer } from "../shared/knowledge-base";
import { HISTORY_TOOL_HANDLERS } from "../server/rambo-history-tools";
const daniel: Viewer = { userId: 0, name: "Probe Super", globalRole: "super_admin", memberships: [{ orgSlug: "christchurch-united", orgName: "Christchurch United", role: "admin", tabs: null }, { orgSlug: "mini-football-leagues", orgName: "Mini Football Leagues", role: "admin", tabs: null }], workspaceSlug: "christchurch-united" };
const coach: Viewer = { userId: 0, name: "Probe Coach", globalRole: "coach", memberships: [{ orgSlug: "christchurch-united", orgName: "Christchurch United", role: "team_member", tabs: ["academy"] }], workspaceSlug: "christchurch-united" };
const show = async (label: string, name: string, viewer: Viewer, input: any) => { const t0 = Date.now(); const r = await HISTORY_TOOL_HANDLERS[name](viewer, input); console.log(`\n=== ${label} (${name} ${JSON.stringify(input)}) ${Date.now() - t0}ms\n${r.text}`); };
const which = process.argv[2] ?? "all";
if (which === "all" || which === "camp") {
  await show("camps this year", "camp_history", daniel, { series: "fundamentals", year: "this year" });
  await show("camps all years, all series", "camp_history", daniel, { series: "all", from_year: "2022" });
}
if (which === "all" || which === "prog") {
  await show("u4-u8 by year", "programme_history", daniel, { programme: "U4-U8", by: "year" });
  await show("academy 2025 by term", "programme_history", daniel, { programme: "academy", year: "2025" });
  await show("all by year", "programme_history", daniel, { programme: "all" });
}
if (which === "all" || which === "life") {
  await show("cohort u48 clean", "customer_lifetime", daniel, { view: "cohort", programme: "U4-U8" });
  await show("retention u48", "customer_lifetime", daniel, { view: "retention", programme: "u4-u8" });
  await show("year 2026 u48", "customer_lifetime", daniel, { view: "year", programme: "U4-U8", year: "2026" });
  await show("funnel", "customer_lifetime", daniel, { view: "funnel" });
  await show("tenure", "customer_lifetime", daniel, { view: "tenure" });
  await show("journey fundamentals", "customer_lifetime", daniel, { view: "journey", programme: "fundamentals camp" });
  await show("conversion camp→u48", "customer_lifetime", daniel, { view: "conversion", transition: "fundamentals camp to U4-U8" });
  await show("totals", "customer_lifetime", daniel, { view: "totals", year: "2022" });
}
if (which === "all" || which === "mfl") await show("league lifetime", "league_lifetime", { ...daniel, workspaceSlug: "mini-football-leagues" }, {});
if (which === "all" || which === "person") await show("person zhu", "person_history", daniel, { name: "Zhu" });
if (which === "all" || which === "deny") {
  await show("coach denied camps", "camp_history", coach, { series: "fundamentals" });
  await show("coach denied lifetime", "customer_lifetime", coach, {});
  await show("cufc-only viewer, mfl tool", "league_lifetime", coach, {});
}
process.exit(0);
