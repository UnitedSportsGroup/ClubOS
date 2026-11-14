/**
 * Sponsor proposals & contracts — the whole path, as ORDINARY STAFF.
 *
 *   npx tsx --env-file=.env script/_verify-sponsor-proposals-live.ts
 *   VERIFY_BASE=http://localhost:5247 DATABASE_URL=… npx tsx script/_verify-sponsor-proposals-live.ts
 *
 * Signs in as a throwaway team_member holding only the Sponsorship and e-Sign
 * tabs in United Sports Group (never a super admin: he cannot see this class of
 * bug), builds a proposal, opens it as a stranger, accepts it, sends the
 * Sponsorship Agreement through e-Sign's own route, signs it as both parties,
 * and checks a Partner and ONE contract row came out the other end.
 *
 * Every address is a Resend sink (delivered+…@resend.dev). Everything it makes
 * is removed at the end, pass or fail.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const BASE = (process.env.VERIFY_BASE || "https://app.usg.co.nz").replace(/\/$/, "");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = crypto.randomBytes(3).toString("hex");
const COMPANY = `__probe sponsor ${tag}`;
const made = { users: [] as number[], proposals: [] as number[], docs: [] as number[] };

let pass = 0;
const fails: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`); }
}

type Session = { cookie: string; slug: string };
async function account(kind: string, orgSlug: string, role: string, tabs: string[] | null): Promise<Session & { email: string }> {
  const email = `delivered+sponsorprobe-${kind}-${tag}@resend.dev`;
  const pw = crypto.randomBytes(12).toString("hex");
  const { rows } = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Proposal', 'Probe', $2, 'team_member', true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  made.users.push(rows[0].id);
  const org = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [orgSlug]);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, $3, $4)`, [rows[0].id, org.rows[0].id, role, tabs == null ? null : JSON.stringify(tabs)]);
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login for ${kind} failed: HTTP ${res.status}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { cookie, slug: orgSlug, email };
}
async function api(s: Session | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (s) { headers.Cookie = s.cookie; headers["X-Workspace-Slug"] = s.slug; }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}
const API = "/api/admin/sponsorship/proposals";
const PUB = "/api/public/sponsor-proposal";

async function cleanup() {
  const ids = (await pool.query(`SELECT id, partner_id, partner_contract_id, esign_document_id FROM sponsor_proposals WHERE sponsor_company LIKE $1`, [`__probe sponsor ${tag}%`])).rows;
  for (const r of ids) if (r.esign_document_id) made.docs.push(r.esign_document_id);
  await pool.query(`DELETE FROM sponsor_proposals WHERE sponsor_company LIKE $1`, [`__probe sponsor ${tag}%`]);
  for (const r of ids) {
    if (r.partner_contract_id) await pool.query(`DELETE FROM sponsorship_partner_contracts WHERE id = $1`, [r.partner_contract_id]);
    if (r.partner_id) await pool.query(`DELETE FROM sponsorship_partners WHERE id = $1 AND company LIKE '__probe sponsor %'`, [r.partner_id]);
  }
  if (made.docs.length) await pool.query(`DELETE FROM esign_documents WHERE id = ANY($1::int[])`, [made.docs]);
  await pool.query(`DELETE FROM public_form_submissions WHERE form = 'sponsor_proposal_accept' AND email LIKE $1`, [`%${tag}@resend.dev`]).catch(() => undefined);
  if (made.users.length) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = ANY($1::int[])`, [made.users]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [made.users]);
  }
}

async function main() {
  console.log(`\n  Sponsor proposals — ${BASE}\n`);

  // ── The gate ──────────────────────────────────────────────────────────────
  check("signed out is refused (401)", (await api(null, "GET", API)).status === 401);
  const staff = await account("staff", "united-sports-group", "team_member", ["sponsorship", "esign"]);
  const noTab = await account("notab", "united-sports-group", "team_member", ["calendar"]);
  const outsider = await account("outsider", "christchurch-united", "admin", null);
  check("staff without the Sponsorship tab are refused (403)", (await api(noTab, "GET", API)).status === 403);
  check("an admin of another workspace gets 404, not an empty list", (await api(outsider, "GET", API)).status === 404);
  const first = await api(staff, "GET", API);
  check("ordinary staff with the tab get the list (200)", first.status === 200 && Array.isArray(first.json?.proposals), first.status);
  check("both clubs have a published agreement template", Boolean(first.json?.templates?.siu?.published && first.json?.templates?.cufc?.published), first.json?.templates);
  check("the audience figures each carry a source", (first.json?.audience ?? []).length > 10 && first.json.audience.every((a: any) => a.source && a.value && a.label));

  // ── A draft ───────────────────────────────────────────────────────────────
  check("a proposal with no sponsor name is refused", (await api(staff, "POST", API, { sponsorCompany: " ", brand: "siu" })).status === 400);
  const created = await api(staff, "POST", API, { sponsorCompany: COMPANY, brand: "siu" });
  const id: number = created.json?.id;
  const token: string = created.json?.token;
  made.proposals.push(id);
  check("a draft is created", created.status === 200 && created.json?.stage === "draft" && /^[A-Za-z0-9_-]{22,64}$/.test(token ?? ""), created.json);
  check("its link is on the club's own host", created.json?.url === `https://join.southislandunited.com/proposal/${token}`, created.json?.url);
  check("a fee nobody set is null, not zero", created.json?.feeCents === null);
  check("a stranger cannot open a draft (404)", (await api(null, "GET", `${PUB}/${token}`)).status === 404);
  const prev = await api(staff, "GET", `${PUB}/${token}`);
  check("staff of the workspace can preview the draft", prev.status === 200 && prev.json?.preview === true, prev.status);
  check("an admin of another workspace cannot preview it", (await api(outsider, "GET", `${PUB}/${token}`)).status === 404);
  check("a made-up token is 404", (await api(null, "GET", `${PUB}/${"x".repeat(32)}`)).status === 404);
  check("publishing an empty draft is refused with reasons", await api(staff, "POST", `${API}/${id}/publish`).then((r) => r.status === 400 && r.json?.problems?.length >= 2));

  // ── Untrusted input ───────────────────────────────────────────────────────
  const dirty = await api(staff, "PATCH", `${API}/${id}`, {
    partnershipTitle: "Official Shorts Partner", seasonLabel: "OFC Pro League · Season 2027",
    contactName: "Sam Sponsor", contactEmail: `delivered+sponsorprobe-signer-${tag}@resend.dev`,
    assets: [{ name: "Back of shorts", detail: "Home and away kits, every match of the 2027 season.", priceCents: 1500000 }, { name: "", detail: "dropped" }],
    benefits: ["Logo and link on the club website", "  "],
    audienceKeys: ["siu_fifa_streams", "cufc_social_followers", "made_up_number", "siu_match_crowds"],
    logoUrl: "https://evil.example/logo.png", feeCents: -5, termStart: "2027-01-01", termEnd: "2027-12-31",
    paymentTerms: "One payment on 20 January 2027.", status: "signed", acceptedAt: "2020-01-01", organizationId: 1,
  });
  check("an edit is saved", dirty.status === 200, dirty.json);
  check("a figure that is not on the list, or belongs to the other club, is dropped", JSON.stringify(dirty.json?.audienceKeys) === JSON.stringify(["siu_fifa_streams", "siu_match_crowds"]), dirty.json?.audienceKeys);
  check("a logo ClubOS does not host is dropped", dirty.json?.logoUrl === null);
  check("a negative fee is not stored", dirty.json?.feeCents === null);
  check("a blank asset and a blank benefit are dropped", dirty.json?.assets?.length === 1 && dirty.json?.benefits?.length === 1);
  check("the stage cannot be set from the browser", dirty.json?.stage === "draft" && dirty.json?.acceptedAt === null);
  await api(staff, "PATCH", `${API}/${id}`, { feeCents: 1500000 });

  // ── Live ──────────────────────────────────────────────────────────────────
  const pub = await api(staff, "POST", `${API}/${id}/publish`);
  check("it publishes once it is complete", pub.status === 200 && pub.json?.stage === "sent", pub.json);
  const page = await api(null, "GET", `${PUB}/${token}`);
  const body = JSON.stringify(page.json ?? {});
  check("a stranger with the link can open it", page.status === 200 && page.json?.proposal?.sponsorCompany === COMPANY);
  check("the page is marked noindex", /noindex/.test(page.headers.get("x-robots-tag") ?? ""));
  check("the page carries no contact email, phone, ids or token", !body.includes("Sam Sponsor") && !body.includes(`signer-${tag}`) && !("id" in (page.json?.proposal ?? {})) && !body.includes(token));
  check("the figures on the page are the two that were ticked, with their source", page.json?.proposal?.audience?.length === 2 && page.json.proposal.audience.every((a: any) => a.source));
  await api(null, "POST", `${PUB}/${token}/open`, { visitorId: "probe-visitor-1" });
  await api(staff, "POST", `${PUB}/${token}/open`, { visitorId: "probe-staff" });
  const afterOpen = (await api(staff, "GET", API)).json.proposals.find((p: any) => p.id === id);
  check("a stranger's open is counted and a staff open is not", afterOpen?.opens === 1 && afterOpen?.visitors === 1 && afterOpen?.stage === "opened", { opens: afterOpen?.opens, stage: afterOpen?.stage });

  // ── Accept ────────────────────────────────────────────────────────────────
  const acceptEmail = `delivered+sponsorprobe-accept-${tag}@resend.dev`;
  const hp = await api(null, "POST", `${PUB}/${token}/accept`, { name: "Bot Bot", email: acceptEmail, agree: true, website: "http://spam.example" });
  const afterHp = (await api(staff, "GET", API)).json.proposals.find((p: any) => p.id === id);
  check("a honeypot submission gets the ordinary answer and writes nothing", hp.status === 200 && hp.json?.ok === true && afterHp?.acceptedAt === null);
  check("an acceptance with a bad email is refused", (await api(null, "POST", `${PUB}/${token}/accept`, { name: "Sam Sponsor", email: "nope", agree: true })).status === 400);
  check("an acceptance without the tick is refused", (await api(null, "POST", `${PUB}/${token}/accept`, { name: "Sam Sponsor", email: acceptEmail })).status === 400);
  const acc = await api(null, "POST", `${PUB}/${token}/accept`, { name: "Sam Sponsor", role: "Director", email: acceptEmail, agree: true, formToken: page.json?.proposal?.formToken });
  check("a real acceptance is taken", acc.status === 200 && JSON.stringify(acc.json) === JSON.stringify(hp.json), acc.json);
  const again = await api(null, "POST", `${PUB}/${token}/accept`, { name: "Someone Else", email: acceptEmail, agree: true });
  const accepted = (await api(staff, "GET", API)).json.proposals.find((p: any) => p.id === id);
  check("it is recorded once: a second acceptance does not replace the first", again.status === 200 && accepted?.stage === "accepted" && accepted?.acceptedName === "Sam Sponsor" && accepted?.acceptedRole === "Director", accepted?.acceptedName);
  check("an accepted version cannot be edited (409)", (await api(staff, "PATCH", `${API}/${id}`, { feeCents: 1 })).status === 409);
  check("the public page now says accepted", (await api(null, "GET", `${PUB}/${token}`)).json?.proposal?.accepted === true);

  const copy = await api(staff, "POST", `${API}/${id}/duplicate`);
  made.proposals.push(copy.json?.id);
  check("a copy is a fresh draft with its own link", copy.status === 200 && copy.json?.stage === "draft" && copy.json?.token !== token && copy.json?.acceptedAt === null && copy.json?.feeCents === 1500000);

  // ── The contract ──────────────────────────────────────────────────────────
  const plan = await api(staff, "GET", `${API}/${id}/contract`);
  check("the contract plan is ready, with every blank filled from the proposal", plan.status === 200 && plan.json?.problems?.length === 0 && plan.json?.variables?.sponsorship_fee === "$15,000 plus GST" && plan.json?.variables?.commencement_date === "2027-01-01" && plan.json?.variables?.contra === "None", plan.json);
  const copyPlan = await api(staff, "GET", `${API}/${copy.json?.id}/contract`);
  check("a plan is the same for the copy (same terms)", copyPlan.json?.variables?.sponsorship_rights === plan.json?.variables?.sponsorship_rights);
  const doc = await api(staff, "POST", "/api/admin/esign/from-template", {
    templateId: plan.json.template.id, variables: plan.json.variables, signerName: plan.json.signerName, signerEmail: plan.json.signerEmail, send: true,
  });
  if (doc.json?.id) made.docs.push(doc.json.id);
  check("e-Sign makes the agreement from the club's template", doc.status === 200 && doc.json?.signers?.length === 2 && doc.json?.status === "sent", doc.json);
  check("a document that is not a Sponsorship Agreement cannot be linked", (await api(staff, "POST", `${API}/${id}/contract`, { esignDocumentId: 999999999 })).status === 400);
  const linked = await api(staff, "POST", `${API}/${id}/contract`, { esignDocumentId: doc.json?.id });
  check("the agreement is linked and the stage reads contract out", linked.status === 200 && linked.json?.stage === "contract_out", linked.json?.stage);
  check("the same agreement cannot be linked to a second proposal (409)", (await api(staff, "POST", `${API}/${copy.json?.id}/contract`, { esignDocumentId: doc.json?.id })).status === 409);
  check("a second contract on the same proposal is refused (409)", (await api(staff, "POST", `${API}/${id}/contract`, { esignDocumentId: doc.json?.id })).status === 409);

  // The club signs first; the sponsor cannot go before us.
  const club = doc.json.signers.find((s: any) => s.email === staff.email);
  const sponsor = doc.json.signers.find((s: any) => s.email !== staff.email);
  const early = await api(null, "POST", `/api/sign/${sponsor.token}`, { signatureName: "Sam Sponsor", consent: true, formData: { signatory_name: "Sam Sponsor", signatory_position: "Director" } });
  check("the sponsor cannot sign before the club has", early.status === 400 && /not your turn/i.test(early.json?.message ?? ""), early.json);
  const view = await api(null, "GET", `/api/sign/${sponsor.token}`);
  const text = JSON.stringify(view.json ?? {});
  check("the agreement the sponsor reads carries the club's own clauses", text.includes("first right of refusal") && text.includes("Schedule A: Sponsorship Benefits") && text.includes("01-0635-0374823-00"));
  check("…and this proposal's terms", text.includes("$15,000 plus GST") && text.includes("Back of shorts") && text.includes("1 January 2027"), text.slice(0, 200));
  const s1 = await api(null, "POST", `/api/sign/${club.token}`, { signatureName: "Proposal Probe", consent: true });
  check("the club signs", s1.status === 200, s1.json);
  const s2 = await api(null, "POST", `/api/sign/${sponsor.token}`, { signatureName: "Sam Sponsor", consent: true, formData: { signatory_name: "Sam Sponsor", signatory_position: "Director" } });
  check("the sponsor signs and the agreement completes", s2.status === 200, s2.json);

  // ── What signing made ─────────────────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 1500));
  const done = (await api(staff, "GET", API)).json.proposals.find((p: any) => p.id === id);
  check("the proposal reads signed and points at a partner", done?.stage === "signed" && Number.isInteger(done?.partnerId), { stage: done?.stage, partnerId: done?.partnerId });
  await api(staff, "GET", API); // reading it again must not make a second one
  const rows = await pool.query(
    `SELECT c.signature_status, c.start_date::text, c.end_date::text, c.cash_per_year_cents, c.signed_on::text, p.company
     FROM sponsorship_partner_contracts c JOIN sponsorship_partners p ON p.id = c.partner_id WHERE p.company = $1`, [COMPANY]);
  check("exactly ONE contract row was made, however often the list is read", rows.rowCount === 1, rows.rowCount);
  const c = rows.rows[0] ?? {};
  check("it carries the term, the fee and both signatures", c.signature_status === "both_parties" && c.start_date === "2027-01-01" && c.end_date === "2027-12-31" && Number(c.cash_per_year_cents) === 1500000, c);
  const partners = await api(staff, "GET", "/api/admin/sponsorship/partners");
  check("the new partner shows in Sponsorship → Partners", partners.status === 200 && JSON.stringify(partners.json).includes(COMPANY));

  // ── Tidy states ───────────────────────────────────────────────────────────
  const cid = copy.json?.id;
  await api(staff, "PATCH", `${API}/${cid}`, { partnershipTitle: "Official Shorts Partner" });
  await api(staff, "POST", `${API}/${cid}/publish`);
  const off = await api(staff, "POST", `${API}/${cid}/withdraw`);
  check("a live link can be switched off, and then answers 404", off.json?.stage === "withdrawn" && (await api(null, "GET", `${PUB}/${copy.json.token}`)).status === 404);
  check("an acceptance on a switched-off link is refused", (await api(null, "POST", `${PUB}/${copy.json.token}/accept`, { name: "Sam Sponsor", email: acceptEmail, agree: true })).status === 404);
  const arch = await api(staff, "POST", `${API}/${cid}/archive`);
  check("archiving keeps the row and hides the page", arch.json?.stage === "archived" && (await api(null, "GET", `${PUB}/${copy.json.token}`)).status === 404);
}

main()
  .catch((e) => { fails.push(`crashed: ${e.message}`); console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e.message));
    await pool.end();
    console.log(`\n  ${fails.length ? "❌" : "✅"} ${pass} passed, ${fails.length} failed\n`);
    for (const f of fails) console.log(`     - ${f}`);
    process.exit(fails.length ? 1 : 0);
  });
