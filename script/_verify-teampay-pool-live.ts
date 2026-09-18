// Prove, against LIVE production, that the CIC 7's fill-in pool spans BOTH grades.
//
//   npx tsx --env-file=.env script/_verify-teampay-pool-live.ts
//
// Lists a player under Social, enters a team under Open, and walks the whole
// path: the Open team sees the Social-listed player, asks them, the player
// accepts, and is on the Open squad. Also proves the Ethnic Cup's pool is still
// its own, and that listing twice under different grades is ONE row that moves.
//
// Creates real rows on production and deletes every one of them at the end,
// including on failure. No payment is ever confirmed; no money moves. Every
// address is `.invalid`, so every email the path sends fails to deliver.
import pg from "pg";

const BASE = process.env.TEAMPAY_VERIFY_BASE || "https://app.usg.co.nz";
const OPEN = "cic-summer-7s-2027-open";
const SOCIAL = "cic-summer-7s-2027-social";
const ETHNIC = "ethnic-cup-2026";
const STAMP = Date.now();
const MARK = `ZZ POOL ${STAMP}`;
const PLAYER_EMAIL = `zz-pool-player-${STAMP}@example.invalid`;
const MANAGER_EMAIL = `zz-pool-manager-${STAMP}@example.invalid`;

const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
const eq = (label: string, actual: unknown, expected: unknown) =>
  actual === expected ? ok(`${label} = ${String(actual)}`) : bad(`${label} = ${String(actual)}, expected ${String(expected)}`);

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log(`\n  Team Pay — the tournament-wide fill-in pool, against ${BASE}\n`);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  try {
    // ── the pool is declared on the competition ────────────────────────────
    const open = await call(`/api/public/teampay/competition/${OPEN}`);
    eq("GET open competition", open.status, 200);
    const pool: Array<{ slug: string; name: string }> = open.body.pool ?? [];
    eq("open's pool has two grades", pool.length, 2);
    eq("open's pool names social", pool.some((p) => p.slug === SOCIAL), true);
    eq("open: fill-ins open", open.body.fillinsOpen, true);
    const social = await call(`/api/public/teampay/competition/${SOCIAL}`);
    eq("social: fill-ins open", social.body.fillinsOpen, true);
    const ethnic = await call(`/api/public/teampay/competition/${ETHNIC}`);
    eq("ethnic cup's pool is itself alone", (ethnic.body.pool ?? []).length, 1);

    // ── a player lists under Social ────────────────────────────────────────
    const listed = await call(`/api/public/teampay/competition/${SOCIAL}/fill-in`, {
      method: "POST",
      body: JSON.stringify({
        firstName: MARK, lastName: "Player", email: PLAYER_EMAIL, phone: "021 000 0000",
        position: "Goalkeeper", ability: "Social kickabout", note: "verification row — delete me",
      }),
    });
    eq("list under social", listed.status, 200);
    eq("first listing is new", listed.body.alreadyIn, false);
    const playerToken = String(listed.body.playerToken || "");
    ok(`player token minted (${playerToken.length} chars)`);

    // ── listing again under Open is the SAME row, moved ────────────────────
    const again = await call(`/api/public/teampay/competition/${OPEN}/fill-in`, {
      method: "POST",
      body: JSON.stringify({ firstName: MARK, email: PLAYER_EMAIL, position: "Striker" }),
    });
    eq("re-list under open answers 200", again.status, 200);
    eq("re-list is recognised as the same person", again.body.alreadyIn, true);
    eq("re-list keeps the same token", again.body.playerToken, playerToken);
    const rows = (await db.query(
      `select f.id, f.position, c.slug from teampay_fillins f join teampay_competitions c on c.id = f.competition_id
        where lower(f.email) = $1`, [PLAYER_EMAIL])).rows;
    eq("ONE row across the pool", rows.length, 1);
    eq("the row moved to open", rows[0]?.slug, OPEN);
    eq("the row took the new position", rows[0]?.position, "Striker");
    const fillinId = Number(rows[0]?.id);
    // …and back to Social, so the team in Open below asks a Social-listed player.
    await call(`/api/public/teampay/competition/${SOCIAL}/fill-in`, {
      method: "POST", body: JSON.stringify({ firstName: MARK, email: PLAYER_EMAIL, position: "Striker" }),
    });
    const back = (await db.query(`select c.slug from teampay_fillins f join teampay_competitions c on c.id = f.competition_id where f.id = $1`, [fillinId])).rows[0];
    eq("moved back to social", back?.slug, SOCIAL);

    // ── the public marketplace: both grades see them, the Ethnic Cup does not ─
    const mktOpen = await call(`/api/public/teampay/marketplace/${OPEN}`);
    eq("marketplace (open) answers", mktOpen.status, 200);
    const mine = (mktOpen.body.players ?? []).find((p: any) => p.id === fillinId);
    eq("marketplace (open) lists the social-listed player", !!mine, true);
    eq("…tagged as listed for social", mine?.listedFor?.slug, SOCIAL);
    eq("marketplace (open) declares the pool", (mktOpen.body.competition?.pool ?? []).length, 2);
    for (const k of ["email", "phone", "lastName", "photoKey", "highlightUrl", "playerToken"]) {
      eq(`marketplace never carries ${k}`, mine ? k in mine : false, false);
    }
    const mktSocial = await call(`/api/public/teampay/marketplace/${SOCIAL}`);
    eq("marketplace (social) lists them too", (mktSocial.body.players ?? []).some((p: any) => p.id === fillinId), true);
    const mktEthnic = await call(`/api/public/teampay/marketplace/${ETHNIC}`);
    eq("marketplace (ethnic cup) does NOT", (mktEthnic.body.players ?? []).some((p: any) => p.id === fillinId), false);

    // ── a team in Open asks them ───────────────────────────────────────────
    const entered = await call(`/api/public/teampay/competition/${OPEN}/enter`, {
      method: "POST",
      body: JSON.stringify({
        teamName: `${MARK} FC`, managerName: "Verify Manager", managerEmail: MANAGER_EMAIL,
        squadSize: 10, managerPlays: false, paymentMode: "split",
      }),
    });
    eq("team entered under open", entered.status, 200);
    const token = String(entered.body.dashboardUrl || "").split("/").pop()!;
    const entry = (await db.query(`select id from teampay_entries where organiser_token = $1`, [token])).rows[0];
    ok(`entry #${entry?.id}`);

    const browse = await call(`/api/public/teampay/team/${token}/fill-ins`);
    eq("open team browses the pool", browse.status, 200);
    const seen = (browse.body.fillins ?? []).find((f: any) => f.id === fillinId);
    eq("open team sees the social-listed player", !!seen, true);
    eq("…with listedFor = social", seen?.listedFor?.slug, SOCIAL);
    eq("holds left before asking", browse.body.holdsLeft, 3);

    const asked = await call(`/api/public/teampay/team/${token}/fill-ins/${fillinId}/request`, {
      method: "POST", body: JSON.stringify({ note: "verification ask" }),
    });
    eq("open team asks the social-listed player", asked.status, 200);
    const hold = (await db.query(
      `select hold_token, state from teampay_fillin_holds where fillin_id = $1 and entry_id = $2 order by id desc limit 1`,
      [fillinId, entry.id])).rows[0];
    eq("a hold is active", hold?.state, "active");
    const afterAsk = await call(`/api/public/teampay/marketplace/${OPEN}`);
    eq("a held player leaves the public list", (afterAsk.body.players ?? []).some((p: any) => p.id === fillinId), false);

    // ── the player says yes and lands on the Open squad ────────────────────
    const view = await call(`/api/public/teampay/hold/${hold.hold_token}`);
    eq("hold page answers", view.status, 200);
    eq("hold page names the team", view.body.team?.name, `${MARK} FC`);
    const accepted = await call(`/api/public/teampay/hold/${hold.hold_token}/accept`, { method: "POST" });
    eq("accept", accepted.status, 200);
    const player = (await db.query(
      `select id, source, fillin_id from teampay_players where entry_id = $1 and lower(email) = $2`,
      [entry.id, PLAYER_EMAIL])).rows[0];
    eq("player row on the open entry", !!player, true);
    eq("…sourced from the fill-in", player?.source, "fillin");
    const placed = (await db.query(`select status from teampay_fillins where id = $1`, [fillinId])).rows[0];
    eq("fill-in is placed", placed?.status, "placed");
    const dash = await call(`/api/public/teampay/team/${token}`);
    eq("dashboard lists the new player", (dash.body.players ?? []).some((p: any) => p.id === player?.id), true);

    // ── the Ethnic Cup's own pool is unchanged by any of this ──────────────
    const ethnicCount = (await db.query(
      `select count(*)::int n from teampay_fillins f join teampay_competitions c on c.id = f.competition_id
        where c.slug = $1 and lower(f.email) like 'zz-pool-%'`, [ETHNIC])).rows[0];
    eq("no verification row in the ethnic cup pool", ethnicCount?.n, 0);
  } catch (e: any) {
    bad(`threw: ${e?.message || e}`);
  } finally {
    // 🔴 Always clean up, even on failure. Entries cascade to players + holds;
    // the fill-in row is deleted by email; events keep nulls (SET NULL).
    try {
      const e1 = await db.query(`delete from teampay_entries where team_name like $1`, [`${MARK}%`]);
      const e2 = await db.query(`delete from teampay_fillins where lower(email) like $1`, [`zz-pool-%${STAMP}@example.invalid`]);
      const left = await db.query(
        `select (select count(*) from teampay_entries where team_name like 'ZZ POOL%')::int a,
                (select count(*) from teampay_fillins where email like 'zz-pool-%')::int b`);
      console.log(`\n  cleanup: ${e1.rowCount} entries, ${e2.rowCount} fill-ins removed; ${left.rows[0].a} ZZ POOL teams and ${left.rows[0].b} zz-pool fill-ins remain`);
      if (left.rows[0].a !== 0 || left.rows[0].b !== 0) problems.push("cleanup left rows behind");
    } catch (e: any) { problems.push(`cleanup failed: ${e?.message || e}`); }
    await db.end();
  }

  console.log(`\n  ${checks - problems.length}/${checks} passed${problems.length ? `\n\n  Problems:\n${problems.map((p) => `   - ${p}`).join("\n")}` : ""}\n`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
