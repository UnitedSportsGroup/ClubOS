// The /api/admin staff gate (server/auth.ts requireStaffForAdminApi), proven
// against REAL accounts in the live database (read-only) with a stand-in
// session — the server is never booked against prod .env.
//   npx tsx --env-file=.env script/_test-staff-admin-gate.ts
import { pool } from "../server/db";
import { isStaffUser, requireStaffForAdminApi } from "../server/auth";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fail++; };

function run(path: string, userId?: number): Promise<number> {
  return new Promise((resolve) => {
    const req: any = { path, session: userId ? { userId } : {} };
    const res: any = { status(c: number) { resolve(c); return { json() {} }; } };
    requireStaffForAdminApi(req, res, () => resolve(200));
  });
}

const one = async (s: string) => (await pool.query(s)).rows[0]?.id as number | undefined;
const orphan = await one(`SELECT id FROM users u WHERE role <> 'super_admin' AND NOT EXISTS (SELECT 1 FROM user_organizations uo WHERE uo.user_id = u.id) LIMIT 1`);
const member = await one(`SELECT u.id FROM users u JOIN user_organizations uo ON uo.user_id = u.id WHERE u.role <> 'super_admin' LIMIT 1`);
const superAdmin = await one(`SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`);
ok(!!orphan && !!member && !!superAdmin, "found an orphan, a member and a super admin");

ok(await isStaffUser(orphan!) === false, "an account with no workspace is not staff");
ok(await isStaffUser(member!) === true, "a workspace member is staff");
ok(await isStaffUser(superAdmin!) === true, "a super admin is staff");

ok(await run("/api/admin/contacts", orphan) === 403, "orphan → /api/admin/contacts refused 403");
ok(await run("/api/admin/crm/export", orphan) === 403, "orphan → CRM export refused 403");
ok(await run("/api/admin/camps/4/session-roll", orphan) === 403, "orphan → session roll refused 403");
ok(await run("/api/admin/contacts", member) === 200, "member → passes the gate (the route's own checks still apply)");
ok(await run("/api/admin/contacts", superAdmin) === 200, "super admin → passes");
ok(await run("/api/admin/contacts") === 200, "no session → passes the gate (the route answers its own 401 / token check)");
ok(await run("/api/public/league/register/x", orphan) === 200, "orphan → public routes untouched");
ok(await run("/api/auth/me", orphan) === 200, "orphan → /api/auth untouched (the fan apps still sign in)");
ok(await run("/api/administrator", orphan) === 200, "a path that merely starts with 'admin' is not caught");

await pool.end();
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
