// Prove, against LIVE production, that a captain's account works and that it
// cannot be used to reach anybody else's team.
//
//   npx tsx --env-file=.env script/_verify-captain-live.ts
//
// 🔴 It SIGNS IN LIKE A PERSON — requests a link, reads the token out of the
// database the way a mailbox would, sets a password, signs in with it, and then
// drives the dashboard through the session. A verification that used a service
// credential would prove the plumbing and nothing about the front door.
//
// Creates two captains and two teams on production and deletes all of it at the
// end, including on failure. Never confirms a payment, so no money moves.
import pg from "pg";
import crypto from "crypto";

const BASE = process.env.TEAMPAY_VERIFY_BASE || "https://app.usg.co.nz";
/** Any Team Pay competition with entries open. `TEAMPAY_VERIFY_SLUG=cic-summer-7s-2027-open` proves the 7's. */
const SLUG = process.env.TEAMPAY_VERIFY_SLUG || "ethnic-cup-2026";
const STAMP = Date.now();
const MARK = `ZZ CAPTAIN ${STAMP}`;
const PASSWORD = "correct horse battery staple";
/** Comfortably past MAX_PER_EMAIL (8), so a working limiter must trip. */
const MAX_ATTEMPTS_PROBE = 12;

const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
function eq(label: string, actual: unknown, expected: unknown) {
  actual === expected ? ok(`${label} = ${String(actual)}`)
                      : bad(`${label} = ${String(actual)}, expected ${String(expected)}`);
}

/** A tiny cookie jar, because the session is the thing under test. */
class Jar {
  private jar = new Map<string, string>();
  header(): string { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res: Response) {
    const raw = (res.headers as any).getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = String(line).split(";");
      const eqi = pair.indexOf("=");
      if (eqi < 0) continue;
      const name = pair.slice(0, eqi).trim();
      const value = pair.slice(eqi + 1).trim();
      if (value === "") this.jar.delete(name); else this.jar.set(name, value);
    }
  }
  has(name: string) { return this.jar.has(name); }
}

async function call(jar: Jar | null, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(jar ? { cookie: jar.header() } : {}),
      ...(init.headers || {}),
    },
  });
  jar?.absorb(res);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function main() {
  console.log(`\n  Team Pay — the captain's account, against ${BASE}\n`);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const emailA = `zz-captain-a-${STAMP}@example.invalid`;
  const emailB = `zz-captain-b-${STAMP}@example.invalid`;

  try {
    // ── two teams, two different captains ──────────────────────────────────
    const enter = async (email: string, name: string) => {
      const r = await call(null, `/api/public/teampay/competition/${SLUG}/enter`, {
        method: "POST",
        body: JSON.stringify({
          teamName: `${MARK} ${name}`, community: "Verification",
          managerName: `Verify ${name}`, managerEmail: email,
          squadSize: 16, managerPlays: false, paymentMode: "split",
        }),
      });
      if (r.status !== 200) throw new Error(`enter ${name}: ${r.status} ${JSON.stringify(r.body)}`);
      const tok = String(r.body.dashboardUrl).split("/").pop()!;
      const [row] = (await db.query(
        `select id from teampay_entries where organiser_token = $1`, [tok])).rows;
      return { token: tok, id: row.id as number };
    };
    const teamA = await enter(emailA, "A");
    const teamB = await enter(emailB, "B");
    ok(`two teams entered (#${teamA.id}, #${teamB.id})`);

    // ── the front door ─────────────────────────────────────────────────────
    const jar = new Jar();

    // 🔴 An address that has never entered a team must get the SAME answer as
    // one that has — otherwise this endpoint tells a stranger who has a team.
    const unknown = await call(null, "/api/public/teampay/captain/request-link", {
      method: "POST", body: JSON.stringify({ email: `zz-nobody-${STAMP}@example.invalid` }),
    });
    const known = await call(null, "/api/public/teampay/captain/request-link", {
      method: "POST", body: JSON.stringify({ email: emailA }),
    });
    /* 🔴 Assert 200 FIRST. "The two answers are identical" is trivially true
       when both of them are a 500, and that is exactly how this check passed on
       the first run while every sign-in on production was erroring. An
       equality assertion needs the value pinned as well as matched. */
    eq("request-link for a stranger is 200", unknown.status, 200);
    eq("request-link for a real captain is 200", known.status, 200);
    unknown.body.message === known.body.message
      ? ok("request-link body is identical for a stranger and a real captain")
      : bad(`request-link leaks: "${unknown.body.message}" vs "${known.body.message}"`);

    const made = await db.query(
      `select count(*)::int n from teampay_captains where lower(email) = $1`,
      [`zz-nobody-${STAMP}@example.invalid`]);
    eq("no account is minted for an address with no team", made.rows[0].n, 0);

    // Read the token the way a mailbox would. It is hashed in the database, so
    // mint our own and write the hash — the same thing the emailed link carries.
    const capRow = await db.query(
      `select id from teampay_captains where lower(email) = $1`, [emailA]);
    const capId = capRow.rows[0]?.id;
    capId ? ok("a captain row exists for the address that entered a team") : bad("no captain row created");

    const linkToken = crypto.randomBytes(32).toString("base64url");
    await db.query(
      `update teampay_captain_tokens set token_hash = $2
        where id = (select id from teampay_captain_tokens
                     where captain_id = $1 and used_at is null order by id desc limit 1)`,
      [capId, sha256(linkToken)]);

    // 🔴 A short password must be refused, and refused BEFORE the token is spent.
    const short = await call(null, "/api/public/teampay/captain/set-password", {
      method: "POST", body: JSON.stringify({ token: linkToken, password: "short" }),
    });
    eq("a password under 12 characters is refused", short.status, 400);

    const set = await call(jar, "/api/public/teampay/captain/set-password", {
      method: "POST", body: JSON.stringify({ token: linkToken, password: PASSWORD }),
    });
    eq("setting a password succeeds", set.status, 200);
    jar.has("__Host-teampay_captain")
      ? ok("a __Host- session cookie was issued")
      : bad("no __Host- session cookie");

    // 🔴 The link is single-use. One sitting in a mail archive must be spent.
    const reuse = await call(null, "/api/public/teampay/captain/set-password", {
      method: "POST", body: JSON.stringify({ token: linkToken, password: "another long password" }),
    });
    eq("the same link cannot be used twice", reuse.status, 400);

    // ── sign in ────────────────────────────────────────────────────────────
    const wrongPw = await call(null, "/api/public/teampay/captain/sign-in", {
      method: "POST", body: JSON.stringify({ email: emailA, password: "the wrong password" }),
    });
    const noSuch = await call(null, "/api/public/teampay/captain/sign-in", {
      method: "POST", body: JSON.stringify({ email: `zz-ghost-${STAMP}@example.invalid`, password: PASSWORD }),
    });
    eq("wrong password is 401", wrongPw.status, 401);
    eq("unknown account is also 401", noSuch.status, 401);
    // Same trap as above: both being 500 would satisfy "identical".
    wrongPw.body.message === noSuch.body.message
      ? ok("a wrong password and an unknown account read identically")
      : bad(`sign-in leaks which accounts exist: "${wrongPw.body.message}" vs "${noSuch.body.message}"`);

    const jar2 = new Jar();
    const signIn = await call(jar2, "/api/public/teampay/captain/sign-in", {
      method: "POST", body: JSON.stringify({ email: emailA, password: PASSWORD }),
    });
    eq("signing in with the right password works", signIn.status, 200);

    // ── 🔴 the rate limiter must actually BITE ─────────────────────────────
    //
    // It fails open by design, so a broken query is indistinguishable from a
    // working limiter unless something asserts it. On the first deploy the
    // query threw on every call and there was no rate limiting at all.
    let sawLimit = false;
    for (let i = 0; i < MAX_ATTEMPTS_PROBE; i++) {
      const r = await call(null, "/api/public/teampay/captain/sign-in", {
        method: "POST", body: JSON.stringify({ email: emailB, password: `wrong-${i}` }),
      });
      if (r.status === 429) { sawLimit = true; break; }
    }
    sawLimit
      ? ok("repeated wrong passwords are rate limited (429)")
      : bad("🔴 the rate limiter never fired — it is failing open on every request");

    // ── what the session can reach ─────────────────────────────────────────
    const me = await call(jar2, "/api/public/teampay/captain/me");
    eq("me is 200", me.status, 200);
    const ids = (me.body.entries ?? []).map((e: any) => e.id);
    ids.includes(teamA.id) ? ok("my own team is listed") : bad("my own team is missing from /me");
    !ids.includes(teamB.id)
      ? ok("somebody else's team is NOT listed")
      : bad("🔴 /me listed a team belonging to another captain");

    const mine = await call(jar2, `/api/public/teampay/captain/entries/${teamA.id}`);
    eq("my own team's dashboard is 200", mine.status, 200);

    // 🔴 The one that matters. Another captain's entry id must be unreachable,
    // and must answer 404 rather than 403 so the id space is not a directory.
    const theirs = await call(jar2, `/api/public/teampay/captain/entries/${teamB.id}`);
    eq("another captain's dashboard is 404", theirs.status, 404);

    const theirPlayers = await call(jar2, `/api/public/teampay/captain/entries/${teamB.id}/players`, {
      method: "POST", body: JSON.stringify({ name: "Intruder", email: "x@example.invalid" }),
    });
    eq("adding a player to another captain's team is 404", theirPlayers.status, 404);

    const theirPay = await call(jar2, `/api/public/teampay/captain/entries/${teamB.id}/pay-intent`, {
      method: "POST",
    });
    eq("minting a payment intent on another captain's team is 404", theirPay.status, 404);

    // Signed out entirely.
    const anon = await call(null, `/api/public/teampay/captain/entries/${teamA.id}`);
    eq("no session at all is 401", anon.status, 401);

    // ── the dashboard really works through the session ─────────────────────
    const add = await call(jar2, `/api/public/teampay/captain/entries/${teamA.id}/players`, {
      method: "POST",
      body: JSON.stringify({ players: [{ name: "Verify Player", email: `zz-p-${STAMP}@example.invalid` }] }),
    });
    eq("adding a player through the session works", add.status, 200);
    const after = await call(jar2, `/api/public/teampay/captain/entries/${teamA.id}`);
    (after.body.players ?? []).some((p: any) => p.name === "Verify Player")
      ? ok("the player appears on the squad")
      : bad("the added player is not on the squad");

    const intent = await call(jar2, `/api/public/teampay/captain/entries/${teamA.id}/pay-intent`, { method: "POST" });
    eq("a team payment intent is minted through the session", intent.status, 200);
    // The fee is the COMPETITION's, read live — $800 for the Ethnic Cup, $700 for
    // the 7's Open — never a number typed into this script.
    const compFee = (await call(null, `/api/public/teampay/competition/${SLUG}`)).body?.feeCents;
    eq("for the whole outstanding fee", intent.body.amountCents, compFee);

    // ── sign out revokes, server-side ──────────────────────────────────────
    await call(jar2, "/api/public/teampay/captain/sign-out", { method: "POST" });
    const afterOut = await call(jar2, "/api/public/teampay/captain/me");
    eq("after signing out the session is dead", afterOut.status, 401);

    // ── the public marketplace ─────────────────────────────────────────────
    const mkt = await call(null, `/api/public/teampay/marketplace/${SLUG}`);
    eq("the public marketplace is 200", mkt.status, 200);
    const sample = (mkt.body.players ?? [])[0];
    if (sample) {
      const leaked = ["email", "phone", "lastName", "photoUrl", "photoKey", "highlightUrl"]
        .filter((k) => k in sample);
      leaked.length === 0
        ? ok("the public list carries no email, phone, surname, photo or video link")
        : bad(`🔴 the public marketplace leaks: ${leaked.join(", ")}`);
    } else {
      ok("the public marketplace is empty (nobody on the list yet) — nothing to leak");
    }

  } catch (e: any) {
    bad(`fatal: ${e.message}`);
  } finally {
    // 🔴 Always clean up, even on failure. A verification run must not leave
    // "ZZ CAPTAIN" teams in the draw or test accounts that can be signed into.
    try {
      const delEntries = await db.query(`delete from teampay_entries where team_name like $1`, [`${MARK}%`]);
      await db.query(`delete from teampay_captain_auth_events where lower(email) like $1`, [`zz-%${STAMP}@example.invalid`]);
      const delCaps = await db.query(`delete from teampay_captains where lower(email) like $1`, [`zz-%${STAMP}@example.invalid`]);
      const left = await db.query(
        `select (select count(*) from teampay_entries where team_name like 'ZZ CAPTAIN%')::int a,
                (select count(*) from teampay_captains where email like 'zz-captain-%')::int b`);
      left.rows[0].a === 0 && left.rows[0].b === 0
        ? ok(`cleaned up (${delEntries.rowCount} teams, ${delCaps.rowCount} captains)`)
        : bad(`left behind: ${left.rows[0].a} teams, ${left.rows[0].b} captains`);
    } catch (e: any) {
      bad(`cleanup failed: ${e.message}`);
    }
    await db.end();
  }

  console.log(
    problems.length === 0
      ? `\n  ${checks} checks passed against live production.\n`
      : `\n  ${problems.length} problem(s) of ${checks}:\n` + problems.map((p) => `    · ${p}`).join("\n") + "\n",
  );
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
