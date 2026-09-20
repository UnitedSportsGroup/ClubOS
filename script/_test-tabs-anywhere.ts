// Unit checks for canAccessTabAnywhere (@shared/tabs) — the rule behind the
// POS register living in every workspace's System section.
//   npx tsx script/_test-tabs-anywhere.ts
import { canAccessTabAnywhere } from "../shared/tabs";
let pass = 0, fail = 0;
const eq = (label: string, got: boolean, want: boolean) => {
  const ok = got === want; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); ok ? pass++ : fail++;
};
const m = (slug: string, userRole: string, userTabs: string[] | null, userUnlockedTabs: string[] | null = null) => ({ slug, userRole, userTabs, userUnlockedTabs });
eq("a super admin always", canAccessTabAnywhere("super_admin", [], "pos"), true);
eq("POS ticked in CUFC → yes", canAccessTabAnywhere("team_member", [m("christchurch-united", "team_member", ["pos"])], "pos"), true);
eq("POS ticked in CUFC, standing anywhere else → still yes (the list is the person's, not the workspace's)",
  canAccessTabAnywhere("team_member", [m("united-sports-group", "team_member", ["hiring"]), m("christchurch-united", "team_member", ["pos"])], "pos"), true);
eq("only an unrelated tab in USG → no", canAccessTabAnywhere("team_member", [m("united-sports-group", "team_member", ["hiring"])], "pos"), false);
eq("no memberships → no", canAccessTabAnywhere("team_member", [], "pos"), false);
eq("an ADMIN of CUFC (every tab there) → yes", canAccessTabAnywhere("coach", [m("christchurch-united", "admin", null)], "pos"), true);
eq("an unrestricted member of United Prints (no register there) → no", canAccessTabAnywhere("team_member", [m("united-prints", "team_member", null)], "pos"), false);
eq("an ADMIN of United Prints (no register there) → no", canAccessTabAnywhere("team_member", [m("united-prints", "admin", null)], "pos"), false);
eq("a locked tab needs the per-person unlock, as ever", canAccessTabAnywhere("team_member", [m("united-sports-group", "admin", null)], "budget"), false);
eq("…and the unlock grants it", canAccessTabAnywhere("team_member", [m("united-sports-group", "admin", null, ["budget"])], "budget"), true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
