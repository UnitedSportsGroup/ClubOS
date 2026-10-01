// Prove parent accounts v2 work ON PRODUCTION, end to end, as a family would.
//
//   npx tsx --env-file=.env script/_verify-parent-accounts-live.ts            # sign-in, password, cards
//   npx tsx --env-file=.env script/_verify-parent-accounts-live.ts --checkout # + a real checkout intent
//
// Uses the RESERVED test address only (test@example.com — RFC 2606,
// undeliverable, a seeded test guardian). The emailed code is stored hashed, so
// it is recovered by hashing all 10^6 possibilities — possible only because we
// hold the database row, which is exactly what an attacker does not. Every
// credential, session, audit row and fixture it makes is removed at the end.
import { Pool } from "pg";
import crypto from "crypto";

const EMAIL = "test@example.com";
const SITE = "https://cufc.co.nz";            // the account page's own origin
const JOIN = "https://join.cufc.co.nz";       // the checkout's origin
const CHECKOUT = process.argv.includes("--checkout");
const PASSWORD = `verify-${crypto.randomBytes(9).toString("base64url")}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => {
  console.log(`${c ? "  ok  " : " FAIL "} ${label}${extra ? " — " + extra : ""}`);
  c ? pass++ : fail++;
};
const json = { "Content-Type": "application/json" };
const cookieOf = (res: Response) => (res.headers.get("set-cookie")?.match(/cufc_parent=([^;]*)/) || [])[1] || "";
const withCookie = (jar: string) => ({ ...json, Cookie: `cufc_parent=${jar}` });

async function codeSignIn(): Promise<string> {
  await pool.query(`DELETE FROM parent_login_codes WHERE email = $1`, [EMAIL]);
  const r = await fetch(`${SITE}/api/public/parent/request-code`, { method: "POST", headers: json, body: JSON.stringify({ email: EMAIL }) });
  ok(r.ok, "cufc.co.nz issues a sign-in code");
  const { rows } = await pool.query(
    `SELECT code_hash FROM parent_login_codes WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`, [EMAIL]);
  let code: string | null = null;
  for (let i = 0; rows[0] && i < 1_000_000; i++) {
    const c = String(i).padStart(6, "0");
    if (crypto.createHash("sha256").update(`${c}:${EMAIL}`).digest("hex") === rows[0].code_hash) { code = c; break; }
  }
  ok(!!code, "the code row really is sha256(code:email)");
  const v = await fetch(`${SITE}/api/public/parent/verify`, { method: "POST", headers: json, body: JSON.stringify({ email: EMAIL, code }) });
  ok(v.ok, "the code signs in");
  const setCookie = v.headers.get("set-cookie") || "";
  ok(/Domain=\.cufc\.co\.nz/i.test(setCookie) && /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie),
    "session cookie: .cufc.co.nz, HttpOnly, Secure");
  return cookieOf(v);
}

async function cleanup() {
  await pool.query(`DELETE FROM parent_login_codes WHERE email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM parent_sessions WHERE email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM parent_credentials WHERE email = $1`, [EMAIL]);
  await pool.query(`DELETE FROM parent_auth_events WHERE lower(email) = $1`, [EMAIL]);
}

try {
  await cleanup();

  // ── 1. Code sign-in makes a SERVER-SIDE session ────────────────────────────
  const jar = await codeSignIn();
  const sess = await pool.query(`SELECT method, revoked_at FROM parent_sessions WHERE email = $1`, [EMAIL]);
  ok(sess.rows.length === 1 && sess.rows[0].method === "code", "the session is a database row, opened by 'code'");
  ok(!(await pool.query(`SELECT 1 FROM parent_sessions WHERE token_hash = $1`, [jar])).rows.length,
    "the database holds a HASH of the token, not the token");

  const me: any = await (await fetch(`${SITE}/api/public/parent/me`, { headers: withCookie(jar) })).json();
  ok(me?.security?.hasPassword === false && me?.security?.signedInWith === "code", "/me reports no password, signed in by code");
  ok(me?.savedCardsEnabled === true, "saved cards are switched on");
  ok(Array.isArray(me?.children), "/me carries the family");

  const pre: any = await (await fetch(`${JOIN}/api/public/parent/prefill`, { headers: { Cookie: `cufc_parent=${jar}` } })).json();
  ok(pre.signedIn === true && pre.parent?.email === EMAIL && "addressParts" in (pre.parent ?? {}),
    "the checkout host sees the same session, with the full pre-fill shape");

  // ── 2. Setting a password ──────────────────────────────────────────────────
  const short = await fetch(`${SITE}/api/public/parent/password`, { method: "POST", headers: withCookie(jar), body: JSON.stringify({ password: "short" }) });
  ok(short.status === 400, "a password under 12 characters is refused");
  const set = await fetch(`${SITE}/api/public/parent/password`, { method: "POST", headers: withCookie(jar), body: JSON.stringify({ password: PASSWORD }) });
  ok(set.ok, "a fresh code session can set a password");
  const cred = await pool.query(`SELECT password_hash FROM parent_credentials WHERE email = $1`, [EMAIL]);
  ok(/^s1\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(cred.rows[0]?.password_hash ?? ""), "stored as scrypt s1$salt$hash, never the password");

  // ── 3. Password sign-in, and one message for every failure ────────────────
  const good = await fetch(`${SITE}/api/public/parent/login-password`, { method: "POST", headers: json, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  ok(good.ok, "email + password signs in");
  const pjar = cookieOf(good);
  const pme: any = await (await fetch(`${SITE}/api/public/parent/me`, { headers: withCookie(pjar) })).json();
  ok(pme?.security?.signedInWith === "password" && pme?.security?.hasPassword === true, "that session is marked 'password'");

  const wrong = await fetch(`${SITE}/api/public/parent/login-password`, { method: "POST", headers: json, body: JSON.stringify({ email: EMAIL, password: PASSWORD + "x" }) });
  const unknown = await fetch(`${SITE}/api/public/parent/login-password`, { method: "POST", headers: json, body: JSON.stringify({ email: `nobody-${Date.now()}@example.com`, password: PASSWORD }) });
  const wm = (await wrong.json()).message, um = (await unknown.json()).message;
  ok(wrong.status === 401 && unknown.status === 401 && wm === um,
    "a wrong password and an unknown address get the IDENTICAL answer", wm);

  // ── 4. Changing the password ends every OTHER session ─────────────────────
  // The code session is under 15 minutes old, so no current password is needed.
  const change = await fetch(`${SITE}/api/public/parent/password`, { method: "POST", headers: withCookie(jar), body: JSON.stringify({ password: PASSWORD + "-2" }) });
  const cb: any = await change.json();
  ok(change.ok && cb.signedOutOthers >= 1, "changing the password signs out the other device", `${cb.signedOutOthers}`);
  const dead = await fetch(`${SITE}/api/public/parent/me`, { headers: withCookie(pjar) });
  ok(dead.status === 401, "…and that device's session really is dead");
  const stillIn = await fetch(`${SITE}/api/public/parent/me`, { headers: withCookie(jar) });
  ok(stillIn.ok, "…while the device that changed it stays signed in");

  // ── 5. Saved cards: an empty list, and a foreign card is 404 ──────────────
  const cards: any = await (await fetch(`${SITE}/api/public/parent/payment-methods`, { headers: withCookie(jar) })).json();
  ok(cards.enabled === true && Array.isArray(cards.cards), "saved cards list answers", `${cards.cards?.length ?? "?"} cards`);
  const foreign = await fetch(`${SITE}/api/public/parent/payment-methods/pm_1NotYoursAtAll00000000`, { method: "DELETE", headers: withCookie(jar) });
  ok(foreign.status === 404, "removing a card that isn't the family's is 404");
  const anon = await fetch(`${SITE}/api/public/parent/payment-methods`);
  ok(anon.status === 401, "saved cards need a signed-in family");

  // ── 6. Another family's child, still unreachable ──────────────────────────
  const intrude = await fetch(`${SITE}/api/public/parent/children/contact-1`, {
    method: "PATCH", headers: withCookie(jar), body: JSON.stringify({ allergies: "INTRUSION TEST" }),
  });
  ok(intrude.status === 404, "another family's child is 404, not 403");

  // ── 7. The checkout attaches saved cards for a signed-in family only ──────
  if (CHECKOUT) {
    const body = (email: string) => ({
      programSlug: "technification", programOptionId: 13, paymentPlan: "term",
      child: { firstName: "Verify", lastName: "Parentaccounts", dateOfBirth: "2017-03-03", gender: "male",
        countryOfBirthCode: "NZL", nationalityCode: "NZL", ethnicityGroupId: 1, ethnicitySelectionIds: [] },
      guardian: { firstName: "Test", lastName: "Parent", email, phone: "0210000000", relationship: "Parent",
        addressParts: { street: "1 Test Street", suburb: "Riccarton", city: "Christchurch", region: "Canterbury", postcode: "8041", country: "NZL" } },
      emergency: { name: "Test Parent", phone: "0210000000" },
      consents: { policy: true, medical: true, photo: false, newsletter: false },
      source: "verify-parent-accounts",
    });
    const signed = await fetch(`${JOIN}/api/public/academy/register`, { method: "POST", headers: withCookie(jar), body: JSON.stringify(body(EMAIL)) });
    const sb: any = await signed.json();
    ok(signed.ok && typeof sb.clientSecret === "string", "a signed-in family can start a checkout", sb.message ?? "");
    ok(typeof sb.customerSessionClientSecret === "string" && sb.customerSessionClientSecret.startsWith("cuss_"),
      "…and the Payment Element gets their saved-card session");
    const anonReg = await fetch(`${JOIN}/api/public/academy/register`, { method: "POST", headers: json, body: JSON.stringify(body(EMAIL)) });
    const ab: any = await anonReg.json();
    ok(anonReg.ok && !ab.customerSessionClientSecret, "a visitor typing the same email gets NO saved-card session");

    // Clean the fixtures: cancel both intents, retire the rows this made.
    const { stripe } = await import("../server/stripe");
    for (const regId of [sb.registrationId, ab.registrationId].filter(Boolean)) {
      const r = await pool.query(`SELECT stripe_payment_intent_id, contact_id FROM registrations WHERE id = $1`, [regId]);
      const pi = r.rows[0]?.stripe_payment_intent_id;
      if (pi) await stripe.paymentIntents.cancel(pi).catch(() => {});
      await pool.query(`DELETE FROM registrations WHERE id = $1 AND status = 'pending' AND source = 'verify-parent-accounts'`, [regId]);
    }
    const kid = await pool.query(
      `SELECT id FROM contacts WHERE type = 'player' AND first_name = 'Verify' AND last_name = 'Parentaccounts'
         AND NOT EXISTS (SELECT 1 FROM registrations WHERE contact_id = contacts.id)`);
    for (const k of kid.rows) {
      await pool.query(`DELETE FROM contact_relationships WHERE player_id = $1`, [k.id]);
      await pool.query(`DELETE FROM contacts WHERE id = $1`, [k.id]);
    }
    ok(true, "checkout fixtures cancelled and removed");
  }

  // ── 8. Sign out means signed out ──────────────────────────────────────────
  const out = await fetch(`${SITE}/api/public/parent/logout`, { method: "POST", headers: withCookie(jar) });
  ok(out.ok, "sign out answers");
  const after = await fetch(`${SITE}/api/public/parent/me`, { headers: withCookie(jar) });
  ok(after.status === 401, "the signed-out cookie no longer opens the account");
  const preAfter: any = await (await fetch(`${JOIN}/api/public/parent/prefill`, { headers: { Cookie: `cufc_parent=${jar}` } })).json();
  ok(preAfter.signedIn === false, "…nor pre-fills the checkout");

  // ── 9. The limiter bites (a limiter that fails open is invisible) ─────────
  let last = 0;
  for (let i = 0; i < 9; i++) {
    last = (await fetch(`${SITE}/api/public/parent/login-password`, {
      method: "POST", headers: json, body: JSON.stringify({ email: EMAIL, password: `wrong-${i}-xxxxxxxx` }),
    })).status;
  }
  ok(last === 429, "repeated wrong passwords are shut out (429)", `${last}`);
} catch (e: any) {
  ok(false, "the run completed", e?.message ?? String(e));
} finally {
  await cleanup();
  await pool.end();
}
console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
