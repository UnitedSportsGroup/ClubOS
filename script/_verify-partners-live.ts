/**
 * Sponsorship Partners — live checks against production, as ORDINARY STAFF.
 *
 *   npx tsx --env-file=.env script/_verify-partners-live.ts
 *   VERIFY_BASE=https://app.usg.co.nz (default)
 *
 * Three throwaway accounts (deleted at the end): a USG team_member holding only
 * the sponsorship tab (the person this is for), a USG team_member holding a
 * different tab (must be refused), and a CUFC-only admin (must be refused —
 * the tab lives in USG). Then a probe partner is created, taken through a
 * contract, an instalment, a deliverable and an idea, and the flags the list
 * shows are asserted against what shared/sponsorship-partners.ts says they
 * must be. Everything the probe creates is deleted; nothing seeded is touched.
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const USG = "united-sports-group";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); good ? pass++ : fail++; };
const created: number[] = [];
let probePartnerId: number | null = null;

async function account(tag: string, workspace: string, role: string, tabs: string[] | null): Promise<string> {
  const email = `_partners_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `P${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Partners', 'Probe', $2, 'team_member', true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  created.push(rows[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [workspace]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, $3, $4)`, [rows[0].id, org[0].id, role, tabs == null ? null : JSON.stringify(tabs)]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login for ${tag} failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") || "").split(";")[0];
}
const api = (cookie: string | null, method: string, path: string, workspace: string | null, body?: any) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(workspace ? { "X-Workspace-Slug": workspace } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const iso = (d: Date) => new Date(d.getTime() + 13 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function main() {
  console.log(`\nSponsorship Partners — live checks on ${BASE}\n`);
  const anon = await api(null, "GET", "/api/admin/sponsorship/partners", USG);
  ok("signed out → 401", anon.status === 401, `HTTP ${anon.status}`);

  const staff = await account("staff", USG, "team_member", ["sponsorship"]);
  const other = await account("othertab", USG, "team_member", ["projects"]);
  const cufc = await account("cufc", "christchurch-united", "admin", null);

  const noHeader = await api(staff, "GET", "/api/admin/sponsorship/partners", null);
  ok("sponsorship staff, no workspace header → 400", noHeader.status === 400, `HTTP ${noHeader.status}`);
  const list = await api(staff, "GET", "/api/admin/sponsorship/partners", USG);
  ok("sponsorship staff in USG → 200", list.status === 200, `HTTP ${list.status}`);
  const data: any = list.status === 200 ? await list.json() : {};
  ok("list carries today (y-m-d), partners[] and totals", /^\d{4}-\d{2}-\d{2}$/.test(data.today ?? "") && Array.isArray(data.partners) && !!data.totals, `${data.partners?.length ?? "?"} partners, today ${data.today}`);
  const denied = await api(other, "GET", "/api/admin/sponsorship/partners", USG);
  ok("USG staff WITHOUT the sponsorship tab → 403", denied.status === 403, `HTTP ${denied.status}`);
  const foreign = await api(cufc, "GET", "/api/admin/sponsorship/partners", USG);
  ok("CUFC-only admin asking for USG → 403", foreign.status === 403, `HTTP ${foreign.status}`);
  const foreignHdr = await api(cufc, "GET", "/api/admin/sponsorship/partners", "christchurch-united");
  ok("CUFC-only admin in their own workspace → 403 (the tab is not there)", foreignHdr.status === 403 || foreignHdr.status === 404, `HTTP ${foreignHdr.status}`);

  // ── probe partner: the flags the list must show ──
  const mk = await api(staff, "POST", "/api/admin/sponsorship/partners", USG, { company: `_Probe Sponsor ${Date.now()}`, brandTags: ["cufc"], primaryContactName: "Probe Person", primaryContactEmail: "probe@example.invalid" });
  ok("create partner → 200", mk.status === 200, `HTTP ${mk.status}`);
  const partner: any = mk.status === 200 ? await mk.json() : null;
  probePartnerId = partner?.id ?? null;
  if (!partner) throw new Error("probe partner not created");
  const dup = await api(staff, "POST", "/api/admin/sponsorship/partners", USG, { company: partner.company.toUpperCase() });
  ok("same company again (case-insensitive) → 409", dup.status === 409, `HTTP ${dup.status}`);

  const end = addDays(10);
  const ct = await api(staff, "POST", `/api/admin/sponsorship/partners/${partner.id}/contracts`, USG, { title: "Probe deal", startDate: addDays(-355), endDate: end, noticeDays: 30, cashPerYearCents: 123400, signatureStatus: "both_parties" });
  ok("create contract → 200", ct.status === 200, `HTTP ${ct.status}`);
  const contract: any = await ct.json();
  const badTerm = await api(staff, "POST", `/api/admin/sponsorship/partners/${partner.id}/contracts`, USG, { title: "x", startDate: addDays(5), endDate: addDays(1) });
  ok("a term ending before it starts is refused (Postgres)", badTerm.status === 400, `HTTP ${badTerm.status}`);
  const openEndedWithEnd = await api(staff, "POST", `/api/admin/sponsorship/partners/${partner.id}/contracts`, USG, { title: "x", openEnded: true, endDate: addDays(30) });
  ok("open-ended with an end date is refused", openEndedWithEnd.status === 400, `HTTP ${openEndedWithEnd.status}`);

  const pay = await api(staff, "POST", `/api/admin/sponsorship/partners/contracts/${contract.id}/payments`, USG, { label: "Year 2", dueOn: addDays(-3), amountCents: 141910, gstIncluded: true });
  ok("create instalment → 200", pay.status === 200, `HTTP ${pay.status}`);
  const payment: any = await pay.json();
  const zero = await api(staff, "POST", `/api/admin/sponsorship/partners/contracts/${contract.id}/payments`, USG, { amountCents: 0 });
  ok("a zero instalment is refused", zero.status === 400, `HTTP ${zero.status}`);

  let row: any = ((await (await api(staff, "GET", "/api/admin/sponsorship/partners", USG)).json()) as any).partners.find((p: any) => p.id === partner.id);
  const kinds = (row?.flags ?? []).map((f: any) => f.kind);
  ok("list flags: notice window passed (10 days left, 30 days' notice)", kinds.includes("notice_passed"), kinds.join(","));
  ok("list flags: instalment overdue", kinds.includes("payment_overdue"), kinds.join(","));
  ok("status reads 'attention' with red flags", row?.status === "attention", row?.status);
  ok("renewalOn is the contract end", row?.renewalOn === end, `${row?.renewalOn}`);
  ok("annual value is the cash per year", row?.annualValueCents === 123400, `${row?.annualValueCents}`);
  ok("nextPayment is the overdue one", row?.nextPayment?.id === payment.id && row?.nextPayment?.state === "overdue", `${row?.nextPayment?.state}`);

  const paid = await api(staff, "PATCH", `/api/admin/sponsorship/partners/payments/${payment.id}`, USG, { paidOn: addDays(0) });
  ok("mark paid → 200", paid.status === 200, `HTTP ${paid.status}`);
  const paidRow: any = await paid.json();
  ok("paid carries the amount", paidRow.paidCents === 141910, `${paidRow.paidCents}`);
  row = ((await (await api(staff, "GET", "/api/admin/sponsorship/partners", USG)).json()) as any).partners.find((p: any) => p.id === partner.id);
  ok("overdue flag gone once paid", !(row?.flags ?? []).some((f: any) => f.kind === "payment_overdue"), (row?.flags ?? []).map((f: any) => f.kind).join(","));
  ok("overdue $ in totals no longer counts it", row?.overdueCents === 0, `${row?.overdueCents}`);

  const del = await api(staff, "POST", `/api/admin/sponsorship/partners/contracts/${contract.id}/deliverables`, USG, { title: "Front of shirt", category: "contract" });
  ok("create deliverable → 200", del.status === 200, `HTTP ${del.status}`);
  const deliverable: any = await del.json();
  const idea = await api(staff, "POST", `/api/admin/sponsorship/partners/contracts/${contract.id}/deliverables`, USG, { title: "Player meet and greet", category: "idea" });
  ok("create idea → 200", idea.status === 200, `HTTP ${idea.status}`);
  const patched = await api(staff, "PATCH", `/api/admin/sponsorship/deliverables/${deliverable.id}`, USG, { status: "delivered" });
  ok("existing deliverables PATCH understands a partner-owned row", patched.status === 200, `HTTP ${patched.status}`);
  const patchedOther = await api(cufc, "PATCH", `/api/admin/sponsorship/deliverables/${deliverable.id}`, "christchurch-united", { status: "pending" });
  ok("…and refuses a member of another workspace", patchedOther.status === 403 || patchedOther.status === 404, `HTTP ${patchedOther.status}`);
  const detail: any = await (await api(staff, "GET", `/api/admin/sponsorship/partners/${partner.id}`, USG)).json();
  const c0 = detail.contracts?.find((c: any) => c.id === contract.id);
  ok("detail: contract, 1 instalment, 2 deliverables (1 idea)", !!c0 && c0.payments?.length === 1 && c0.deliverables?.length === 2 && c0.deliverables.filter((d: any) => d.category === "idea").length === 1, `${c0?.payments?.length} / ${c0?.deliverables?.length}`);
  ok("detail: delivered status round-trips", c0?.deliverables?.find((d: any) => d.id === deliverable.id)?.status === "delivered");
  const notMine = await api(cufc, "GET", `/api/admin/sponsorship/partners/${partner.id}`, "christchurch-united");
  ok("another workspace cannot read the partner", notMine.status === 403 || notMine.status === 404, `HTTP ${notMine.status}`);

  // the Deliverables tab (deal-based) must not pick the partner's row up — it filters by deal
  const dAll: any = await (await api(staff, "GET", `/api/admin/sponsorship/deliverables-all?organizationId=${(await pool.query(`select id from organizations where slug=$1`, [USG])).rows[0].id}&category=contract`, USG)).json();
  ok("Deliverables tab is untouched by partner rows", Array.isArray(dAll) && !dAll.some((d: any) => d.id === deliverable.id));

  const arch = await api(staff, "DELETE", `/api/admin/sponsorship/partners/${partner.id}`, USG);
  ok("delete archives (soft)", arch.status === 200, `HTTP ${arch.status}`);
  const after: any = await (await api(staff, "GET", "/api/admin/sponsorship/partners", USG)).json();
  ok("archived partner leaves the list", !after.partners.some((p: any) => p.id === partner.id));
  const withArch: any = await (await api(staff, "GET", "/api/admin/sponsorship/partners?archived=1", USG)).json();
  ok("…and shows with ?archived=1", withArch.partners.some((p: any) => p.id === partner.id));

  // ── a real seeded partner's file opens for sponsorship staff and not for others ──
  const real = (data.partners ?? []).find((p: any) => p.current?.node?.id);
  if (real) {
    const openMine = await api(staff, "GET", real.current.node.openUrl, null);
    ok(`signed file opens for sponsorship staff (${real.company})`, openMine.status === 302, `HTTP ${openMine.status}`);
    const openOther = await api(cufc, "GET", real.current.node.openUrl, null);
    ok("…and is 404 for a CUFC-only admin (Drive gate)", openOther.status === 404, `HTTP ${openOther.status}`);
    const openAnon = await api(null, "GET", real.current.node.openUrl, null);
    ok("…and 401 signed out", openAnon.status === 401, `HTTP ${openAnon.status}`);
  } else {
    ok("a seeded partner with a file exists (skipped: none yet)", true, "seed not run");
  }
}

main().catch(e => { console.error("\n  ✗", e.message); fail++; }).finally(async () => {
  if (probePartnerId) {
    await pool.query(`DELETE FROM sponsorship_partner_contracts WHERE partner_id = $1`, [probePartnerId]).catch(() => {});
    await pool.query(`DELETE FROM sponsorship_partners WHERE id = $1`, [probePartnerId]).catch(() => {});
  }
  for (const id of created) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n  ${fail ? "✗" : "✓"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
});
