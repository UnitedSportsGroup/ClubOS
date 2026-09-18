// Prove, against LIVE production, that an MFL captain's dashboard works, that
// it cannot reach another captain's team, and that a fill-in ask for one night
// goes round the loop — asked, answered, contact details released.
//
//   npx tsx --env-file=.env script/_verify-league-captain-live.ts
//   TEAMPAY_VERIFY_BASE=https://join.minifootball.co.nz npx tsx --env-file=.env script/_verify-league-captain-live.ts
//
// 🔴 It SIGNS IN LIKE A PERSON through the same door the captain uses. Every
// fixture it needs — an archived league competition, a programme, a fill-in
// pool, two teams, a player on the list — is created on production and
// deleted at the end, including on failure. No money path is touched: the
// teams it creates carry no registration, so there is nothing to charge.
import pg from "pg";
import crypto from "crypto";

const BASE = process.env.TEAMPAY_VERIFY_BASE || "https://app.usg.co.nz";
const ORG = 3;
const STAMP = Date.now().toString(36);
const SLUG = `zz-verify-league-captain-${STAMP}`;
const PASSWORD = "correct horse battery staple";
const EMAIL_A = `zz-cap-a-${STAMP}@example.com`;
const EMAIL_B = `zz-cap-b-${STAMP}@example.com`;
const EMAIL_F = `zz-fillin-${STAMP}@example.com`;

const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
function eq(label: string, actual: unknown, expected: unknown) {
  actual === expected ? ok(`${label} = ${String(actual)}`) : bad(`${label} = ${String(actual)}, expected ${String(expected)}`);
}

class Jar {
  private jar = new Map<string, string>();
  header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res: Response) {
    const raw = (res.headers as any).getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = String(line).split(";");
      const i = pair.indexOf("="); if (i < 0) continue;
      const name = pair.slice(0, i).trim(); const value = pair.slice(i + 1).trim();
      if (value === "") this.jar.delete(name); else this.jar.set(name, value);
    }
  }
}
async function call(jar: Jar | null, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(jar ? { cookie: jar.header() } : {}), ...(init.headers || {}) },
  });
  jar?.absorb(res);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function main() {
  console.log(`\n  MFL captain's dashboard, against ${BASE}\n`);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  let compId = 0, progId = 0, poolId = 0, teamA = 0, teamB = 0;
  const cleanup = async () => {
    try {
      if (poolId) await db.query(`delete from teampay_competitions where id = $1`, [poolId]);
      if (progId) await db.query(`delete from programs where id = $1`, [progId]);
      if (compId) await db.query(`delete from league_competitions where id = $1`, [compId]);
      await db.query(`delete from teampay_captains where lower(email) in ($1, $2)`, [EMAIL_A, EMAIL_B]);
      await db.query(`delete from teampay_captain_auth_events where lower(email) in ($1, $2)`, [EMAIL_A, EMAIL_B]);
    } catch (e) { console.error("cleanup", e); }
  };

  try {
    // ── fixtures ────────────────────────────────────────────────────────────
    compId = (await db.query(
      `insert into league_competitions (organization_id, name, archived, active, registration_status, start_date, end_date)
       values ($1, $2, true, false, 'none', current_date, current_date + 60) returning id`,
      [ORG, `ZZ verify league captain ${STAMP}`])).rows[0].id;
    const div = (await db.query(
      `insert into league_divisions (competition_id, name, day_of_week) values ($1, 'ZZ Wednesday 7s', 'Wednesday') returning id`, [compId])).rows[0].id;
    teamA = (await db.query(
      `insert into league_teams (organization_id, competition_id, division_id, name, contact_name, contact_email)
       values ($1, $2, $3, 'ZZ Team A', 'Cap A', $4) returning id`, [ORG, compId, div, EMAIL_A])).rows[0].id;
    teamB = (await db.query(
      `insert into league_teams (organization_id, competition_id, division_id, name, contact_name, contact_email)
       values ($1, $2, $3, 'ZZ Team B', 'Cap B', $4) returning id`, [ORG, compId, div, EMAIL_B])).rows[0].id;
    progId = (await db.query(
      `insert into programs (organization_id, name, slug, type, league_competition_id, is_active)
       values ($1, 'ZZ verify programme', $2, 'league_team', $3, false) returning id`, [ORG, SLUG, compId])).rows[0].id;
    poolId = (await db.query(
      `insert into teampay_competitions (organization_id, kind, program_id, slug, name, brand, fee_cents, default_squad_size, fillins_open)
       values ($1, 'program', $2, $3, 'ZZ verify pool', 'mfl', 0, 12, true) returning id`, [ORG, progId, SLUG])).rows[0].id;
    ok(`fixtures on production: comp ${compId}, teams ${teamA}/${teamB}, pool ${poolId}`);

    // ── the front door ──────────────────────────────────────────────────────
    const stranger = await call(null, "/api/public/teampay/captain/request-link", { method: "POST", body: JSON.stringify({ email: `zz-nobody-${STAMP}@example.com` }) });
    const captain = await call(null, "/api/public/teampay/captain/request-link", { method: "POST", body: JSON.stringify({ email: EMAIL_A }) });
    eq("request-link answers 200 for a stranger", stranger.status, 200);
    eq("request-link answers 200 for an MFL captain", captain.status, 200);
    eq("…with the identical sentence", stranger.body.message, captain.body.message);
    const noRow = await db.query(`select 1 from teampay_captains where lower(email) = $1`, [`zz-nobody-${STAMP}@example.com`]);
    eq("no captain row minted for the stranger", noRow.rowCount, 0);
    const capRow = await db.query(`select id from teampay_captains where lower(email) = $1`, [EMAIL_A]);
    eq("a captain row minted for the MFL captain (no Team Pay entry needed)", capRow.rowCount, 1);
    const capId = capRow.rows[0]?.id;

    // The emailed link, planted the way the mailbox would hold it.
    const setTok = crypto.randomBytes(32).toString("base64url");
    await db.query(`insert into teampay_captain_tokens (captain_id, token_hash, kind, expires_at) values ($1, $2, 'set', now() + interval '1 hour')`, [capId, sha256(setTok)]);
    const jar = new Jar();
    const set = await call(jar, "/api/public/teampay/captain/set-password", { method: "POST", body: JSON.stringify({ token: setTok, password: PASSWORD }) });
    eq("set-password", set.status, 200);
    const signin = await call(jar, "/api/public/teampay/captain/sign-in", { method: "POST", body: JSON.stringify({ email: EMAIL_A, password: PASSWORD }) });
    eq("sign-in with the new password", signin.status, 200);

    // ── my teams ────────────────────────────────────────────────────────────
    const mine = await call(jar, "/api/public/teampay/captain/league/mine");
    eq("league/mine", mine.status, 200);
    eq("lists team A", mine.body.teams?.some((t: any) => t.id === teamA), true);
    eq("does not list team B", mine.body.teams?.some((t: any) => t.id === teamB), false);
    const anon = await call(null, "/api/public/teampay/captain/league/mine");
    eq("league/mine signed out", anon.status, 401);

    // ── the team page and the wall ──────────────────────────────────────────
    const viewA = await call(jar, `/api/public/teampay/captain/league/${teamA}`);
    eq("team A view", viewA.status, 200);
    eq("view is a league view", viewA.body.league, true);
    eq("captain seeded onto their own squad list", viewA.body.squad?.some((m: any) => m.isCaptain), true);
    eq("no registration → no payment block, not a fake one", viewA.body.payment, null);
    eq("fill-ins open", viewA.body.fillins?.open, true);
    eq("nights derived from the division's calendar before a draw exists", (viewA.body.fillins?.nights?.length ?? 0) > 0, true);
    const viewB = await call(jar, `/api/public/teampay/captain/league/${teamB}`);
    eq("team B (another captain's) is 404", viewB.status, 404);

    // ── the squad list ──────────────────────────────────────────────────────
    const add = await call(jar, `/api/public/teampay/captain/league/${teamA}/squad`, {
      method: "POST", body: JSON.stringify({ players: [
        { name: "Seven", shirtNumber: 7 }, { name: "Seven Again", shirtNumber: 7 },
        { name: "No Number" }, { name: "Too Big", shirtNumber: 100 },
      ] }),
    });
    eq("squad add", add.status, 200);
    eq("two added (7 and no number)", add.body.added, 2);
    eq("two rejected (duplicate 7, number 100)", add.body.rejected?.length, 2);
    const after = await call(jar, `/api/public/teampay/captain/league/${teamA}`);
    const noNum = after.body.squad.find((m: any) => m.name === "No Number");
    const patch = await call(jar, `/api/public/teampay/captain/league/${teamA}/squad/${noNum.id}`, { method: "PATCH", body: JSON.stringify({ shirtNumber: 11, position: "Forward" }) });
    eq("patch number + position", patch.status, 200);
    const clash = await call(jar, `/api/public/teampay/captain/league/${teamA}/squad/${noNum.id}`, { method: "PATCH", body: JSON.stringify({ shirtNumber: 7 }) });
    eq("patch to a taken number is refused", clash.status, 400);
    const cap = after.body.squad.find((m: any) => m.isCaptain);
    const rmCap = await call(jar, `/api/public/teampay/captain/league/${teamA}/squad/${cap.id}`, { method: "DELETE" });
    eq("captain cannot remove themselves", rmCap.status, 400);
    const rm = await call(jar, `/api/public/teampay/captain/league/${teamA}/squad/${noNum.id}`, { method: "DELETE" });
    eq("remove a player", rm.status, 200);

    // ── a player lists, a captain asks for a night ──────────────────────────
    const list = await call(null, `/api/public/teampay/competition/${SLUG}/fill-in`, {
      method: "POST", body: JSON.stringify({ firstName: "Zed", lastName: "Fillin", email: EMAIL_F, phone: "021000000", position: "Defender", availableDays: ["Wednesday", "Bogus"] }),
    });
    eq("fill-in signup on the league pool", list.status, 200);
    const market = await call(null, `/api/public/teampay/marketplace/${SLUG}`);
    const pub = market.body.players?.find((p: any) => p.firstName === "Zed");
    eq("public marketplace lists them", !!pub, true);
    eq("…with only the real nights kept", JSON.stringify(pub?.availableDays), JSON.stringify(["Wednesday"]));
    eq("…and no email on the public list", "email" in (pub ?? {}), false);

    const browse = await call(jar, `/api/public/teampay/captain/league/${teamA}/fill-ins`);
    const f = browse.body.fillins?.find((p: any) => p.firstName === "Zed");
    eq("captain browse shows the player", !!f, true);
    eq("…without an email", "email" in (f ?? {}), false);

    const night = viewA.body.fillins.nights[0];
    const badNight = await call(jar, `/api/public/teampay/captain/league/${teamA}/fill-ins/${f.id}/ask`, { method: "POST", body: JSON.stringify({ kind: "game", gameDate: "1999-01-01" }) });
    eq("a night the team does not play is refused", badNight.status, 400);
    const askGame = await call(jar, `/api/public/teampay/captain/league/${teamA}/fill-ins/${f.id}/ask`, { method: "POST", body: JSON.stringify({ kind: "game", gameDate: night.date, note: "Bring a white top" }) });
    eq("night ask", askGame.status, 200);
    const again = await call(jar, `/api/public/teampay/captain/league/${teamA}/fill-ins/${f.id}/ask`, { method: "POST", body: JSON.stringify({ kind: "game", gameDate: night.date }) });
    eq("the same night asked twice is refused", again.status, 400);
    const browse2 = await call(jar, `/api/public/teampay/captain/league/${teamA}/fill-ins?gameDate=${night.date}`);
    eq("the player is hidden for that night while asked", browse2.body.fillins?.some((p: any) => p.id === f.id), false);
    const browse3 = await call(jar, `/api/public/teampay/captain/league/${teamA}/fill-ins?gameDate=${viewA.body.fillins.nights[1]?.date || night.date}`);
    eq("…but still visible for another night", browse3.body.fillins?.some((p: any) => p.id === f.id), viewA.body.fillins.nights.length > 1);

    const tokRow = await db.query(`select request_token from league_fillin_requests where team_id = $1 and state = 'active' order by id desc limit 1`, [teamA]);
    const replyTok = tokRow.rows[0]?.request_token;
    const reply = await call(null, `/api/public/teampay/hold/${replyTok}`);
    eq("reply link resolves through the shared hold route", reply.status, 200);
    eq("…as a league ask", reply.body.league, true);
    eq("…for a game", reply.body.kind, "game");
    eq("…with no captain contact before yes", reply.body.team?.managerEmail, null);
    const accept = await call(null, `/api/public/teampay/hold/${replyTok}/accept`, { method: "POST" });
    eq("accept", accept.status, 200);
    const reply2 = await call(null, `/api/public/teampay/hold/${replyTok}`);
    eq("captain contact released after yes", reply2.body.team?.managerEmail, EMAIL_A);
    const viewA2 = await call(jar, `/api/public/teampay/captain/league/${teamA}`);
    const acc = viewA2.body.fillins.asks.find((a: any) => a.state === "accepted");
    eq("dashboard shows the accepted ask with the player's email", acc?.email, EMAIL_F);
    eq("a night ask does not add them to the squad list", viewA2.body.squad.some((m: any) => m.source === "fillin"), false);

    // season ask → accept → on the list, off the pool
    const askSeason = await call(jar, `/api/public/teampay/captain/league/${teamA}/fill-ins/${f.id}/ask`, { method: "POST", body: JSON.stringify({ kind: "season" }) });
    eq("season ask", askSeason.status, 200);
    const tok2 = (await db.query(`select request_token from league_fillin_requests where team_id = $1 and kind = 'season' and state = 'active'`, [teamA])).rows[0]?.request_token;
    const accept2 = await call(null, `/api/public/teampay/hold/${tok2}/accept`, { method: "POST" });
    eq("accept the season ask", accept2.status, 200);
    const viewA3 = await call(jar, `/api/public/teampay/captain/league/${teamA}`);
    eq("player now on the squad list as a fill-in", viewA3.body.squad.some((m: any) => m.source === "fillin" && m.email === EMAIL_F), true);
    const gone = await call(null, `/api/public/teampay/marketplace/${SLUG}`);
    eq("…and off the public list", gone.body.players?.some((p: any) => p.firstName === "Zed"), false);

    // sign out kills the session
    await call(jar, "/api/public/teampay/captain/sign-out", { method: "POST" });
    const out = await call(jar, `/api/public/teampay/captain/league/${teamA}`);
    eq("after sign-out the team is 401", out.status, 401);
  } catch (e: any) {
    bad(`unexpected: ${e?.stack || e}`);
  } finally {
    await cleanup();
    const left = await db.query(`select count(*)::int as n from league_competitions where name like $1`, [`ZZ verify league captain ${STAMP}%`]);
    eq("fixtures deleted", left.rows[0].n, 0);
    await db.end();
  }

  console.log(problems.length
    ? `\n  ${problems.length} of ${checks} FAILED:\n${problems.map((p) => `    · ${p}`).join("\n")}\n`
    : `\n  ${checks} checks passed against ${BASE}\n`);
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
