/**
 * The MFL captain's dashboard — the engine.
 *
 * Daniel, 2026-09-18: "the same team captain dashboard and login we created
 * for ethnic cup needs to be built for MFL to allow captain to manage his
 * squad list, player numbers optional for now, player pay payments weekly
 * payments, competitions entered, league standings etc... and see the fill in
 * marketplace to invite players to team or even specific gameweeks when they
 * are low on players."
 *
 * 🔴 THIS FILE MOVES NO MONEY. An MFL team is paid through its registration —
 * up front, deposit + weekly subscription, or Player Pay — by paths that
 * already exist and are already live. Everything here READS that position and
 * LINKS to those paths. A third way to charge an MFL team would be a money
 * rule with two owners.
 *
 * 🔴 Ownership is by VERIFIED EMAIL, re-resolved per request, against
 * league_teams.contact_email — the same rule the Team Pay captain uses for
 * teampay_entries and United Prints uses for orders. Every one of the 57 MFL
 * teams on file carries its captain's email there, and it matches the
 * registration's contact in every case (checked 2026-09-18).
 */
import { randomBytes } from "crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  leagueTeams, leagueCompetitions, leagueDivisions, leagueGames, registrations, programs,
  splitSessions, splitMembers, teampayCompetitions, teampayFillins,
  leagueSquadMembers, leagueFillinRequests,
  type LeagueTeam, type TeampayCompetition, type TeampayCaptain, type LeagueSquadMember,
} from "@shared/schema";
import { emailShell, fromFor, escapeHtml, competitionPublic } from "./teampay";
import { sendEmail } from "./email";
import { driveStorage } from "./drive-storage";
import { splitShareUrl } from "./split-pay";
import { brandFor, FILLIN_PUBLIC_FIELDS, TOKEN_BYTES } from "@shared/teampay";
import {
  nzTodayIso, nightDates, askLabel, hm, nzDateLabel, paymentSummary, isLeagueAskKind,
  SQUAD_POSITIONS,
  LEAGUE_MAX_ACTIVE_ASKS, LEAGUE_REASK_COOLDOWN_DAYS, LEAGUE_ASK_HOURS,
  MIN_SHIRT_NUMBER, MAX_SHIRT_NUMBER, MAX_SQUAD_LIST,
  type LeagueAskKind, type SplitMoneyFacts,
} from "@shared/league-captain";
import { computeLeagueStandings } from "@shared/league-standings";

const MFL_PUBLIC_URL = process.env.MFL_PUBLIC_URL || "https://join.minifootball.co.nz";
const VENUE = "United Sports Centre, 466 Yaldhurst Rd, Russley";

const token = () => randomBytes(TOKEN_BYTES).toString("hex");
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const iso = (v: unknown): string | null => (v == null ? null : String(v).slice(0, 10));

export function captainUrl() { return `${MFL_PUBLIC_URL}/captain`; }
export function teamUrl(teamId: number) { return `${MFL_PUBLIC_URL}/captain/league/${teamId}`; }
export function replyUrl(t: string) { return `${MFL_PUBLIC_URL}/fill-in/reply/${t}`; }

// ── who owns what ────────────────────────────────────────────────────────────

/**
 * Does this address captain an MFL team? Used by the sign-in "email me a link"
 * step, which must never mint an account for a stranger's address — and must
 * mint one for a captain whose only team is a league team.
 *
 * A captain mid Player Pay has no league_teams row yet (the team is
 * materialised when the split settles) but is exactly the person who needs
 * the dashboard to chase their squad, so a pending split counts too.
 */
export async function leagueCaptainByEmail(email: string): Promise<{ name: string | null } | null> {
  const e = email.toLowerCase();
  const [t] = await db.select({ name: leagueTeams.contactName }).from(leagueTeams)
    .where(sql`lower(${leagueTeams.contactEmail}) = ${e}`).limit(1);
  if (t) return { name: t.name };
  const pending = await pendingSplitsForEmail(e);
  if (pending.length) return { name: pending[0].captainName };
  return null;
}

export async function ownedLeagueTeam(captain: TeampayCaptain, teamId: number): Promise<LeagueTeam | null> {
  if (!Number.isInteger(teamId)) return null;
  const [t] = await db.select().from(leagueTeams)
    .where(and(
      eq(leagueTeams.id, teamId),
      sql`lower(${leagueTeams.contactEmail}) = ${captain.email.toLowerCase()}`,
    )).limit(1);
  return t ?? null;
}

export interface LeagueTeamSummary {
  id: number;
  name: string;
  competition: { id: number; name: string; startDate: string | null; endDate: string | null; current: boolean };
  division: { id: number; name: string; dayOfWeek: string | null } | null;
  paymentStatus: string | null;
  paymentMode: string | null;
  squadCount: number;
}

/** Every league team this captain runs, newest competition first. */
export async function leagueTeamsForEmail(email: string): Promise<LeagueTeamSummary[]> {
  const today = nzTodayIso();
  const rows = await db
    .select({
      team: leagueTeams,
      comp: leagueCompetitions,
      division: leagueDivisions,
      paymentMode: registrations.paymentMode,
      squadCount: sql<number>`(select count(*)::int from league_squad_members m where m.team_id = ${leagueTeams.id} and m.removed_at is null)`,
    })
    .from(leagueTeams)
    .innerJoin(leagueCompetitions, eq(leagueCompetitions.id, leagueTeams.competitionId))
    .leftJoin(leagueDivisions, eq(leagueDivisions.id, leagueTeams.divisionId))
    .leftJoin(registrations, eq(registrations.id, leagueTeams.registrationId))
    .where(and(
      sql`lower(${leagueTeams.contactEmail}) = ${email.toLowerCase()}`,
      eq(leagueTeams.active, true),
    ))
    .orderBy(desc(leagueCompetitions.startDate), asc(leagueTeams.name));

  return rows.map((r) => ({
    id: r.team.id,
    name: r.team.name,
    competition: {
      id: r.comp.id, name: r.comp.name,
      startDate: iso(r.comp.startDate), endDate: iso(r.comp.endDate),
      // A competition is current until its last day has passed.
      current: !r.comp.endDate || String(iso(r.comp.endDate)) >= today,
    },
    division: r.division ? { id: r.division.id, name: r.division.name, dayOfWeek: r.division.dayOfWeek } : null,
    paymentStatus: r.team.paymentStatus,
    paymentMode: r.paymentMode ?? null,
    squadCount: Number(r.squadCount ?? 0),
  }));
}

export interface PendingSplitSummary {
  registrationId: number;
  teamName: string | null;
  programName: string;
  divisionName: string | null;
  captainName: string | null;
  shareUrl: string | null;
  totalCents: number;
  targetCount: number | null;
  paidCount: number;
  createdAt: string;
}

/**
 * Teams still being paid for through Player Pay — pending registrations with
 * an open split. No league_teams row exists yet, so these are found through
 * the registration's contact. Shown so the captain can chase, never as a
 * confirmed team: "if you ain't paid you ain't registered".
 */
export async function pendingSplitsForEmail(email: string): Promise<PendingSplitSummary[]> {
  const r = await db.execute(sql`
    select r.id as registration_id, r.team_name, p.name as program_name, d.name as division_name,
           c.first_name, c.last_name,
           s.share_code, s.funding_type, s.total_cents, s.target_count, r.registered_at as created_at,
           (select count(*)::int from split_members m where m.split_session_id = s.id and m.status = 'paid') as paid_count
      from registrations r
      join programs p on p.id = r.program_id and p.type = 'league_team'
      join split_sessions s on s.registration_id = r.id and s.status = 'open'
      join contacts c on c.id = r.contact_id
      left join league_divisions d on d.id = r.league_division_id
     where r.status = 'pending'
       and exists (
         select 1 from contacts cc
          where cc.id in (r.contact_id, r.guardian_id) and lower(cc.email) = ${email.toLowerCase()}
       )
     order by r.registered_at desc`);
  const rows: any[] = (r as any).rows ?? (r as any) ?? [];
  return rows.map((x) => ({
    registrationId: Number(x.registration_id),
    teamName: x.team_name ?? null,
    programName: x.program_name,
    divisionName: x.division_name ?? null,
    captainName: [x.first_name, x.last_name].filter(Boolean).join(" ") || null,
    shareUrl: splitShareUrl({ shareCode: x.share_code, fundingType: x.funding_type }),
    totalCents: Number(x.total_cents ?? 0),
    targetCount: x.target_count == null ? null : Number(x.target_count),
    paidCount: Number(x.paid_count ?? 0),
    createdAt: new Date(x.created_at).toISOString(),
  }));
}

// ── the pool this team draws from ────────────────────────────────────────────

/**
 * The teampay competition whose fill-in pool serves this league team: the row
 * bound to the `league_team` PROGRAMME that wraps the team's league
 * competition. One INSERT per term (script/seed-teampay-mfl.ts); no deploy.
 */
export async function poolForTeam(team: LeagueTeam): Promise<TeampayCompetition | null> {
  const [row] = await db.select({ comp: teampayCompetitions })
    .from(teampayCompetitions)
    .innerJoin(programs, eq(programs.id, teampayCompetitions.programId))
    .where(and(
      eq(teampayCompetitions.kind, "program"),
      eq(programs.leagueCompetitionId, team.competitionId),
    ))
    .limit(1);
  return row?.comp ?? null;
}

// ── the squad list ───────────────────────────────────────────────────────────

async function squadOf(teamId: number): Promise<LeagueSquadMember[]> {
  return db.select().from(leagueSquadMembers)
    .where(and(eq(leagueSquadMembers.teamId, teamId), isNull(leagueSquadMembers.removedAt)))
    .orderBy(desc(leagueSquadMembers.isCaptain), asc(leagueSquadMembers.shirtNumber), asc(leagueSquadMembers.name));
}

/**
 * The captain is on their own squad list from the first time they open it.
 * Idempotent: the partial unique index on (team_id) WHERE is_captain makes a
 * second insert a no-op rather than a second row.
 */
async function ensureCaptainRow(team: LeagueTeam) {
  const [existing] = await db.select({ id: leagueSquadMembers.id }).from(leagueSquadMembers)
    .where(and(eq(leagueSquadMembers.teamId, team.id), eq(leagueSquadMembers.isCaptain, true), isNull(leagueSquadMembers.removedAt)))
    .limit(1);
  if (existing) return;
  try {
    await db.insert(leagueSquadMembers).values({
      teamId: team.id,
      name: team.contactName?.trim() || "Captain",
      email: team.contactEmail?.toLowerCase() || null,
      phone: team.contactPhone || null,
      isCaptain: true,
      source: "captain",
    });
  } catch (e: any) {
    // The email is already on the list as an ordinary player (the captain
    // added themselves by hand before this shipped) or two tabs raced. Either
    // way the list is not wrong; promote the existing row if there is one.
    await db.update(leagueSquadMembers)
      .set({ isCaptain: true, updatedAt: new Date() })
      .where(and(
        eq(leagueSquadMembers.teamId, team.id), isNull(leagueSquadMembers.removedAt),
        sql`lower(${leagueSquadMembers.email}) = ${(team.contactEmail || "").toLowerCase()}`,
      )).catch(() => {});
  }
}

function cleanShirt(v: unknown): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (v === "" || v == null) return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < MIN_SHIRT_NUMBER || n > MAX_SHIRT_NUMBER) {
    return { ok: false, reason: `a shirt number is ${MIN_SHIRT_NUMBER}–${MAX_SHIRT_NUMBER}` };
  }
  return { ok: true, value: n };
}

function cleanPosition(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return (SQUAD_POSITIONS as readonly string[]).includes(s) ? s : null;
}

/** Translate a refused insert into the sentence the captain should read. */
function squadRefusal(e: any): string {
  const m = String(e?.message || "");
  if (m.includes("league_squad_members_team_number_unique")) return "that number is already taken";
  if (m.includes("league_squad_members_team_email_unique")) return "already on your list";
  if (m.includes("league_squad_members_one_team_per_fillin")) return "already on another team";
  if (m.includes("30 players")) return `your list is full (${MAX_SQUAD_LIST} is the most it holds)`;
  if (m.includes("shirt_range")) return `a shirt number is ${MIN_SHIRT_NUMBER}–${MAX_SHIRT_NUMBER}`;
  return "couldn't be added just now";
}

export async function addSquadMembers(
  team: LeagueTeam, captain: TeampayCaptain,
  rows: Array<{ name?: string; email?: string; phone?: string; shirtNumber?: unknown; position?: string }>,
): Promise<{ added: number; rejected: Array<{ name: string; reason: string }> }> {
  await ensureCaptainRow(team);
  let added = 0;
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const r of rows.slice(0, 40)) {
    const name = String(r.name ?? "").trim().slice(0, 80);
    if (!name) continue;
    const shirt = cleanShirt(r.shirtNumber);
    if (!shirt.ok) { rejected.push({ name, reason: shirt.reason }); continue; }
    const email = String(r.email ?? "").trim().toLowerCase() || null;
    if (email && !/.+@.+\..+/.test(email)) { rejected.push({ name, reason: "that email doesn't look right" }); continue; }
    try {
      await db.insert(leagueSquadMembers).values({
        teamId: team.id, name, email,
        phone: String(r.phone ?? "").trim().slice(0, 40) || null,
        shirtNumber: shirt.value,
        position: cleanPosition(r.position),
        source: "captain",
        addedByCaptainId: captain.id,
      });
      added++;
    } catch (e: any) {
      rejected.push({ name, reason: squadRefusal(e) });
    }
  }
  return { added, rejected };
}

export async function updateSquadMember(
  team: LeagueTeam, memberId: number,
  patch: { name?: string; email?: string; phone?: string; shirtNumber?: unknown; position?: string },
): Promise<{ error?: string; ok?: boolean }> {
  const [row] = await db.select().from(leagueSquadMembers)
    .where(and(eq(leagueSquadMembers.id, memberId), eq(leagueSquadMembers.teamId, team.id), isNull(leagueSquadMembers.removedAt)))
    .limit(1);
  if (!row) return { error: "not_found" };

  const set: Partial<typeof leagueSquadMembers.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = String(patch.name).trim().slice(0, 80);
    if (!name) return { error: "A player needs a name." };
    set.name = name;
  }
  if (patch.email !== undefined) {
    const email = String(patch.email).trim().toLowerCase() || null;
    if (email && !/.+@.+\..+/.test(email)) return { error: "That email doesn't look right." };
    set.email = email;
  }
  if (patch.phone !== undefined) set.phone = String(patch.phone).trim().slice(0, 40) || null;
  if (patch.shirtNumber !== undefined) {
    const shirt = cleanShirt(patch.shirtNumber);
    if (!shirt.ok) return { error: `Sorry — ${shirt.reason}.` };
    set.shirtNumber = shirt.value;
  }
  if (patch.position !== undefined) set.position = cleanPosition(patch.position);

  try {
    await db.update(leagueSquadMembers).set(set).where(eq(leagueSquadMembers.id, row.id));
    return { ok: true };
  } catch (e: any) {
    return { error: `Sorry — ${squadRefusal(e)}.` };
  }
}

export async function removeSquadMember(team: LeagueTeam, memberId: number): Promise<{ error?: string; ok?: boolean }> {
  const [row] = await db.select().from(leagueSquadMembers)
    .where(and(eq(leagueSquadMembers.id, memberId), eq(leagueSquadMembers.teamId, team.id), isNull(leagueSquadMembers.removedAt)))
    .limit(1);
  if (!row) return { error: "not_found" };
  if (row.isCaptain) return { error: "You're the captain — you can't take yourself off the list." };
  await db.update(leagueSquadMembers)
    .set({ removedAt: new Date(), updatedAt: new Date() })
    .where(eq(leagueSquadMembers.id, row.id));
  return { ok: true };
}

/** Put a player who paid through Player Pay onto the squad list, by their split row. */
export async function adoptSplitMember(team: LeagueTeam, captain: TeampayCaptain, splitMemberId: number): Promise<{ error?: string; ok?: boolean }> {
  if (!team.registrationId) return { error: "not_found" };
  const [row] = await db.select({ m: splitMembers })
    .from(splitMembers)
    .innerJoin(splitSessions, eq(splitSessions.id, splitMembers.splitSessionId))
    .where(and(eq(splitMembers.id, splitMemberId), eq(splitSessions.registrationId, team.registrationId)))
    .limit(1);
  if (!row) return { error: "not_found" };
  await ensureCaptainRow(team);
  const r = await addSquadMembers(team, captain, [{
    name: row.m.name || row.m.email.split("@")[0], email: row.m.email, phone: row.m.phone || "",
  }]);
  if (!r.added) return { error: `${row.m.name || "They"} ${r.rejected[0]?.reason || "couldn't be added"}.` };
  await db.update(leagueSquadMembers).set({ source: "split" })
    .where(and(eq(leagueSquadMembers.teamId, team.id), sql`lower(${leagueSquadMembers.email}) = ${row.m.email.toLowerCase()}`, isNull(leagueSquadMembers.removedAt)));
  return { ok: true };
}

// ── the money, read off the registration ────────────────────────────────────

async function splitFor(registrationId: number | null): Promise<(SplitMoneyFacts & { shareCode: string; fundingType: string }) | null> {
  if (!registrationId) return null;
  const [s] = await db.select().from(splitSessions).where(eq(splitSessions.registrationId, registrationId)).limit(1);
  if (!s) return null;
  const members = await db.select().from(splitMembers)
    .where(eq(splitMembers.splitSessionId, s.id))
    .orderBy(desc(splitMembers.role), asc(splitMembers.joinedAt));
  return {
    shareCode: s.shareCode, fundingType: (s as any).fundingType || "registration",
    status: s.status, totalCents: s.totalCents, targetCount: s.targetCount, settledAt: s.settledAt,
    members: members.map((m) => ({
      id: m.id, name: m.name, email: m.email, phone: m.phone, role: m.role,
      status: m.status, chargedCents: m.chargedCents, paidAt: m.paidAt,
    })),
  };
}

// ── fixtures and the ladder ──────────────────────────────────────────────────

export interface NightOption {
  gameId: number | null;
  date: string;
  label: string;
  startTime: string | null;
  opponent: string | null;
}

async function fixturesAndTable(team: LeagueTeam, comp: typeof leagueCompetitions.$inferSelect, division: typeof leagueDivisions.$inferSelect | null) {
  const today = nzTodayIso();
  const teams = await db.select().from(leagueTeams).where(eq(leagueTeams.competitionId, team.competitionId));
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const games = await db.select().from(leagueGames)
    .where(eq(leagueGames.competitionId, team.competitionId))
    .orderBy(asc(leagueGames.gameDate), asc(leagueGames.startTime));

  const mine = games.filter((g) => g.homeTeamId === team.id || g.awayTeamId === team.id);
  const shaped = mine.map((g) => {
    const home = g.homeTeamId === team.id;
    const oppId = home ? g.awayTeamId : g.homeTeamId;
    const gf = home ? g.homeScore : g.awayScore;
    const ga = home ? g.awayScore : g.homeScore;
    const final = g.status === "final";
    const result = !final || gf == null || ga == null ? null : gf > ga ? "W" : gf < ga ? "L" : "D";
    const date = iso(g.gameDate);
    return {
      id: g.id, date, dateLabel: date ? nzDateLabel(date) : null,
      startTime: g.startTime, timeLabel: g.startTime ? hm(g.startTime) : null,
      opponent: oppId ? names.get(oppId) ?? "TBC" : "TBC",
      home, location: g.location, status: g.status, final,
      score: final && gf != null && ga != null ? `${gf}–${ga}` : null,
      result,
    };
  });
  const upcoming = shaped.filter((g) => !g.final && g.date && g.date >= today);
  const results = shaped.filter((g) => g.final).reverse();

  const ladder = computeLeagueStandings(
    teams.map((t) => ({ id: t.id, name: t.name, divisionId: t.divisionId })),
    games,
  ).filter((r) => (team.divisionId ? r.divisionId === team.divisionId : true));
  const position = ladder.findIndex((r) => r.teamId === team.id);

  // Nights a captain can ask a fill-in for: the real fixtures once they exist,
  // otherwise the division's calendar until the draw is generated.
  const nights: NightOption[] = upcoming.length
    ? upcoming.slice(0, 10).map((g) => ({
        gameId: g.id, date: g.date!, startTime: g.startTime,
        label: `${g.dateLabel}${g.timeLabel ? `, ${g.timeLabel}` : ""} v ${g.opponent}`,
        opponent: g.opponent,
      }))
    : nightDates({ dayOfWeek: division?.dayOfWeek, startDate: iso(comp.startDate), endDate: iso(comp.endDate), todayIso: today })
        .map((d) => ({ gameId: null, date: d, startTime: null, label: nzDateLabel(d), opponent: null }));

  return {
    fixtures: { next: upcoming[0] ?? null, upcoming, results, drawn: games.length > 0 },
    standings: {
      division: division?.name ?? null,
      position: position >= 0 ? position + 1 : null,
      rows: ladder.map((r) => ({ ...r, you: r.teamId === team.id })),
    },
    nights,
  };
}

// ── the whole view ───────────────────────────────────────────────────────────

export async function teamView(team: LeagueTeam, captain: TeampayCaptain) {
  await ensureCaptainRow(team);

  const [comp] = await db.select().from(leagueCompetitions).where(eq(leagueCompetitions.id, team.competitionId));
  if (!comp) return null;
  const [division] = team.divisionId
    ? await db.select().from(leagueDivisions).where(eq(leagueDivisions.id, team.divisionId))
    : [undefined];
  const [reg] = team.registrationId
    ? await db.select().from(registrations).where(eq(registrations.id, team.registrationId))
    : [undefined];

  const split = await splitFor(team.registrationId);
  const payment = reg
    ? paymentSummary({
        status: reg.status, paymentMode: reg.paymentMode, totalCents: reg.totalCents,
        amountPaid: reg.amountPaid as any, depositCents: reg.depositCents, balanceCents: reg.balanceCents,
        balanceDueDate: iso(reg.balanceDueDate), balanceStatus: reg.balanceStatus,
        weeklyAmountCents: reg.weeklyAmountCents, weeksPaid: reg.weeksPaid, weeksTotal: reg.weeksTotal,
        weeklyFirstChargeDate: iso(reg.weeklyFirstChargeDate), createdAt: reg.registeredAt,
      }, split, { compStartDate: iso(comp.startDate), nowMs: Date.now() })
    : null;

  // Player Pay members matched to the squad by email, so a row can say
  // "paid $45" without a second list.
  const paidByEmail = new Map<string, { chargedCents: number | null; paidAt: Date | string | null; status: string; id: number }>();
  for (const m of split?.members ?? []) paidByEmail.set(m.email.toLowerCase(), m);

  const squad = (await squadOf(team.id)).map((m) => {
    const paid = m.email ? paidByEmail.get(m.email.toLowerCase()) : undefined;
    return {
      id: m.id, name: m.name, email: m.email, phone: m.phone,
      shirtNumber: m.shirtNumber, position: m.position,
      isCaptain: m.isCaptain, source: m.source,
      paid: paid?.status === "paid" ? { cents: paid.chargedCents ?? 0, at: paid.paidAt } : null,
    };
  });
  const onList = new Set(squad.map((s) => s.email?.toLowerCase()).filter(Boolean));
  const unlisted = (split?.members ?? [])
    .filter((m) => m.status === "paid" && !onList.has(m.email.toLowerCase()))
    .map((m) => ({ splitMemberId: m.id, name: m.name, email: m.email, chargedCents: m.chargedCents ?? 0 }));

  const { fixtures, standings, nights } = await fixturesAndTable(team, comp, division ?? null);

  const pool = await poolForTeam(team);
  if (pool) await sweepExpiredAsks(pool.id);
  const asks = await db.select({ r: leagueFillinRequests, f: teampayFillins })
    .from(leagueFillinRequests)
    .innerJoin(teampayFillins, eq(teampayFillins.id, leagueFillinRequests.fillinId))
    .where(and(eq(leagueFillinRequests.teamId, team.id), inArray(leagueFillinRequests.state, ["active", "accepted"])))
    .orderBy(desc(leagueFillinRequests.requestedAt));
  const activeCount = asks.filter((a) => a.r.state === "active").length;

  return {
    league: true as const,
    competition: {
      id: comp.id, name: comp.name, brand: pool?.brand ?? "mfl", theme: brandFor(pool?.brand ?? "mfl"),
      startDate: iso(comp.startDate), endDate: iso(comp.endDate),
      fillinsOpen: !!pool?.fillinsOpen,
    },
    team: {
      id: team.id, name: team.name,
      divisionName: division?.name ?? null, dayOfWeek: division?.dayOfWeek ?? null,
      captainName: team.contactName, captainEmail: team.contactEmail, captainPhone: team.contactPhone,
    },
    payment,
    links: {
      payoff: reg && (reg.paymentMode === "deposit_weekly" || reg.paymentMode === "installment") && !payment?.isPaidUp
        ? `${MFL_PUBLIC_URL}/league/balance/${reg.id}` : null,
      splitHub: split ? splitShareUrl({ shareCode: split.shareCode, fundingType: split.fundingType }) : null,
    },
    squad,
    unlisted,
    fixtures,
    standings,
    fillins: {
      open: !!pool?.fillinsOpen,
      asksLeft: Math.max(0, LEAGUE_MAX_ACTIVE_ASKS - activeCount),
      nights,
      asks: asks.map(({ r, f }) => ({
        id: r.id, kind: r.kind, state: r.state,
        gameDate: iso(r.gameDate), label: askLabel(r.kind as LeagueAskKind, iso(r.gameDate)),
        expiresAt: r.expiresAt, respondedAt: r.respondedAt,
        firstName: f.firstName,
        // Contact details swap on acceptance and never before.
        name: r.state === "accepted" ? [f.firstName, f.lastName].filter(Boolean).join(" ") : f.firstName,
        email: r.state === "accepted" ? f.email : null,
        phone: r.state === "accepted" ? f.phone : null,
      })),
    },
  };
}

// ── the fill-in marketplace, for a league team ───────────────────────────────

export async function sweepExpiredAsks(poolId: number): Promise<number> {
  const r = await db.execute(sql`
    update league_fillin_requests q
       set state = 'expired', responded_at = now()
      from teampay_fillins f
     where q.fillin_id = f.id and f.competition_id = ${poolId}
       and q.state = 'active' and q.expires_at <= now()
    returning q.id`);
  return ((r as any).rows ?? (r as any) ?? []).length;
}

function safeHighlight(raw: string | null | undefined): { url: string; host: string } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { url: u.toString(), host: u.hostname.replace(/^www\./, "") };
  } catch { return null; }
}

/**
 * Who a captain may ask. Public allowlist + the nights they can play, plus the
 * two signed-in-captain fields (a five-minute photo URL and a validated
 * highlight link). Never a surname, email or phone before they say yes.
 *
 * Hidden from THIS team: players with an open season ask from any team;
 * players already spoken for on the night being asked about; players who
 * turned this team down in the last week.
 */
export async function browseLeagueFillins(team: LeagueTeam, opts: { gameDate?: string | null } = {}) {
  const pool = await poolForTeam(team);
  if (!pool) return { error: "The fill-in list isn't set up for this league yet." };
  if (!pool.fillinsOpen) return { error: "The fill-in list isn't open yet." };
  await sweepExpiredAsks(pool.id);

  const gameDate = opts.gameDate ? iso(opts.gameDate) : null;
  const rows = await db.select().from(teampayFillins)
    .where(and(eq(teampayFillins.competitionId, pool.id), eq(teampayFillins.status, "available")))
    .orderBy(desc(teampayFillins.createdAt));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { fillins: [], asksLeft: LEAGUE_MAX_ACTIVE_ASKS, pool: { name: pool.name } };

  const spoken = await db.select({ fillinId: leagueFillinRequests.fillinId, kind: leagueFillinRequests.kind, gameDate: leagueFillinRequests.gameDate, state: leagueFillinRequests.state, teamId: leagueFillinRequests.teamId, respondedAt: leagueFillinRequests.respondedAt })
    .from(leagueFillinRequests)
    .where(and(
      inArray(leagueFillinRequests.fillinId, ids),
      or(
        inArray(leagueFillinRequests.state, ["active", "accepted"]),
        and(eq(leagueFillinRequests.state, "declined"), eq(leagueFillinRequests.teamId, team.id),
            sql`${leagueFillinRequests.respondedAt} > now() - interval '${sql.raw(String(LEAGUE_REASK_COOLDOWN_DAYS))} days'`),
      ),
    ));
  const hidden = new Set<number>();
  for (const s of spoken) {
    if (s.state === "declined") { hidden.add(s.fillinId); continue; }
    if (s.kind === "season" && s.state === "active") { hidden.add(s.fillinId); continue; }
    if (s.kind === "game" && gameDate && iso(s.gameDate) === gameDate) hidden.add(s.fillinId);
  }

  const [{ open }] = await db.select({ open: sql<number>`count(*)::int` }).from(leagueFillinRequests)
    .where(and(eq(leagueFillinRequests.teamId, team.id), eq(leagueFillinRequests.state, "active")));

  const storage = driveStorage();
  const fillins = await Promise.all(rows.filter((r) => !hidden.has(r.id)).map(async (row: any) => {
    const out: Record<string, unknown> = {};
    for (const f of FILLIN_PUBLIC_FIELDS) out[f] = row[f];
    out.createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
    out.availableDays = row.availableDays ?? null;
    out.highlight = safeHighlight(row.highlightUrl);
    out.photoUrl = row.photoKey ? await storage.signedUrl(row.photoKey, { expiresIn: 300 }).catch(() => null) : null;
    return out;
  }));

  return { fillins, asksLeft: Math.max(0, LEAGUE_MAX_ACTIVE_ASKS - Number(open ?? 0)), pool: { name: pool.name } };
}

/** The clock on a night ask runs out an hour before kick-off, never after the game. */
function askExpiry(kind: LeagueAskKind, night: NightOption | null): Date {
  const byClock = new Date(Date.now() + LEAGUE_ASK_HOURS * 3600_000);
  if (kind !== "game" || !night) return byClock;
  const t = night.startTime && /^\d{1,2}:\d{2}/.test(night.startTime) ? night.startTime.slice(0, 5) : "18:00";
  // +12:00 is NZ standard time; in daylight time this lands one hour earlier
  // still, which is the safe direction.
  const kickoff = new Date(`${night.date}T${t.padStart(5, "0")}:00+12:00`);
  const cutoff = new Date(kickoff.getTime() - 3600_000);
  return cutoff < byClock ? cutoff : byClock;
}

export async function requestLeagueFillin(
  team: LeagueTeam, captain: TeampayCaptain, fillinId: number,
  input: { kind?: unknown; gameDate?: unknown; note?: unknown },
): Promise<{ error?: string; ok?: boolean; expiresAt?: Date }> {
  const pool = await poolForTeam(team);
  if (!pool || !pool.fillinsOpen) return { error: "The fill-in list isn't open yet." };
  if (!isLeagueAskKind(input.kind)) return { error: "Say whether it's for the term or for one night." };
  const kind = input.kind;
  await sweepExpiredAsks(pool.id);

  const [{ open }] = await db.select({ open: sql<number>`count(*)::int` }).from(leagueFillinRequests)
    .where(and(eq(leagueFillinRequests.teamId, team.id), eq(leagueFillinRequests.state, "active")));
  if (Number(open ?? 0) >= LEAGUE_MAX_ACTIVE_ASKS) {
    return { error: `You can only have ${LEAGUE_MAX_ACTIVE_ASKS} asks out at once. Wait for one to answer.` };
  }

  // A night must be one this team actually plays. The browser offered the
  // list; the server does not trust that it picked from it.
  let night: NightOption | null = null;
  if (kind === "game") {
    const [comp] = await db.select().from(leagueCompetitions).where(eq(leagueCompetitions.id, team.competitionId));
    const [division] = team.divisionId
      ? await db.select().from(leagueDivisions).where(eq(leagueDivisions.id, team.divisionId)) : [undefined];
    if (!comp) return { error: "not_found" };
    const { nights } = await fixturesAndTable(team, comp, division ?? null);
    const wanted = iso(String(input.gameDate ?? ""));
    night = nights.find((n) => n.date === wanted) ?? null;
    if (!night) return { error: "Pick one of your team's nights." };
  }

  const [f] = await db.select().from(teampayFillins)
    .where(and(eq(teampayFillins.id, fillinId), eq(teampayFillins.competitionId, pool.id)));
  if (!f) return { error: "not_found" };
  if (f.status !== "available") return { error: "They've just joined a team — try another player." };

  const [cooled] = await db.select({ id: leagueFillinRequests.id }).from(leagueFillinRequests)
    .where(and(
      eq(leagueFillinRequests.teamId, team.id), eq(leagueFillinRequests.fillinId, f.id),
      eq(leagueFillinRequests.state, "declined"),
      sql`${leagueFillinRequests.respondedAt} > now() - interval '${sql.raw(String(LEAGUE_REASK_COOLDOWN_DAYS))} days'`,
    )).limit(1);
  if (cooled) return { error: `${f.firstName} said no recently — give it a week before asking again.` };

  const requestToken = token();
  const expiresAt = askExpiry(kind, night);
  const note = String(input.note ?? "").trim().slice(0, 500) || null;
  try {
    // 🔴 The partial unique indexes decide the race. Two captains asking the
    // same player for the same Wednesday: one insert wins, one raises.
    await db.insert(leagueFillinRequests).values({
      teamId: team.id, fillinId: f.id, kind,
      gameId: night?.gameId ?? null, gameDate: night?.date ?? null,
      requestToken, expiresAt, managerNote: note, requestedByCaptainId: captain.id,
    });
  } catch (e: any) {
    const m = String(e?.message || "");
    if (m.includes("one_per_night")) return { error: `Someone's already got ${f.firstName} for that night — try another player.` };
    if (m.includes("one_season_open")) return { error: `Another team has just asked ${f.firstName} to join them — try another player.` };
    throw e;
  }

  const what = askLabel(kind, night?.date, night?.startTime);
  await sendEmail({
    from: fromFor(team.organizationId, pool),
    to: f.email,
    subject: `${team.name} wants you ${kind === "game" ? `on ${nzDateLabel(night!.date)}` : "in their squad"}`,
    html: emailShell(pool, kind === "game" ? "Can you play?" : "A team wants you",
      `<p>Hi ${escapeHtml(f.firstName)},</p>
       <p><strong>${escapeHtml(team.name)}</strong> is a player short and would like you ${escapeHtml(what)}.</p>
       ${night ? `<p><strong>${escapeHtml(nzDateLabel(night.date))}${night.startTime ? `, ${escapeHtml(hm(night.startTime))}` : ""}</strong><br>${escapeHtml(VENUE)}${night.opponent ? `<br>v ${escapeHtml(night.opponent)}` : ""}</p>` : ""}
       ${note ? `<p style="padding:12px 14px;border-left:3px solid #D1B96E;margin:16px 0;">“${escapeHtml(note)}”<br><span style="color:#9A9A9A;font-size:13px;">— ${escapeHtml(team.contactName || "the captain")}</span></p>` : ""}
       <p>Say yes and we'll put you in touch with ${escapeHtml(team.contactName || "the captain")}. Say no and you stay on the list. If you don't answer in time you go back on the list automatically.</p>
       <p style="color:#9A9A9A;font-size:13px;">Anything towards the team fee is between you and the captain — Mini Football doesn't charge fill-ins.</p>`,
      { label: "Yes or no", href: replyUrl(requestToken) }),
  }).catch((e) => console.error("[league-captain] ask email failed:", e));

  return { ok: true, expiresAt };
}

export async function cancelLeagueAsk(team: LeagueTeam, askId: number): Promise<{ error?: string; ok?: boolean }> {
  const r = await db.update(leagueFillinRequests)
    .set({ state: "cancelled", respondedAt: new Date() })
    .where(and(eq(leagueFillinRequests.id, askId), eq(leagueFillinRequests.teamId, team.id), eq(leagueFillinRequests.state, "active")))
    .returning({ id: leagueFillinRequests.id });
  return r.length ? { ok: true } : { error: "That ask has already been answered." };
}

// ── the player's reply ───────────────────────────────────────────────────────

async function askByToken(t: string) {
  const [row] = await db.select({ q: leagueFillinRequests, f: teampayFillins, team: leagueTeams })
    .from(leagueFillinRequests)
    .innerJoin(teampayFillins, eq(teampayFillins.id, leagueFillinRequests.fillinId))
    .innerJoin(leagueTeams, eq(leagueTeams.id, leagueFillinRequests.teamId))
    .where(eq(leagueFillinRequests.requestToken, t)).limit(1);
  return row ?? null;
}

/** Same shape the Team Pay hold page renders, plus `league` and the night. */
export async function leagueAskView(t: string) {
  const row = await askByToken(t);
  if (!row) return null;
  const { q, f, team } = row;
  const pool = await poolForTeam(team);
  if (!pool) return null;
  const live = q.state === "active" && new Date(q.expiresAt) > new Date();
  const [game] = q.gameId ? await db.select().from(leagueGames).where(eq(leagueGames.id, q.gameId)) : [undefined];
  const accepted = q.state === "accepted";
  return {
    league: true,
    competition: competitionPublic(pool),
    state: live ? "active" : (q.state === "active" ? "expired" : q.state),
    expiresAt: q.expiresAt,
    managerNote: q.managerNote,
    kind: q.kind,
    gameDate: iso(q.gameDate),
    startTime: game?.startTime ?? null,
    ask: askLabel(q.kind as LeagueAskKind, iso(q.gameDate), game?.startTime),
    venue: q.kind === "game" ? (game?.location || VENUE) : null,
    team: {
      name: team.name,
      community: null,
      managerName: team.contactName || "the captain",
      managerEmail: accepted ? team.contactEmail : null,
      managerPhone: accepted ? team.contactPhone : null,
    },
    you: { firstName: f.firstName },
    shareCents: null,
  };
}

export async function acceptLeagueAsk(t: string): Promise<{ error?: string; ok?: boolean }> {
  const row = await askByToken(t);
  if (!row) return { error: "not_found" };
  const { q, f, team } = row;
  if (q.state !== "active") return { error: "This invitation has already been answered." };
  if (new Date(q.expiresAt) <= new Date()) return { error: "This invitation has expired — you're back on the list." };
  const pool = await poolForTeam(team);
  if (!pool) return { error: "not_found" };

  // 🔴 Claim first, atomically. Two taps on Yes make one roster row.
  const claimed = await db.update(leagueFillinRequests)
    .set({ state: "accepted", respondedAt: new Date() })
    .where(and(eq(leagueFillinRequests.id, q.id), eq(leagueFillinRequests.state, "active")))
    .returning({ id: leagueFillinRequests.id });
  if (!claimed.length) return { error: "This invitation has already been answered." };

  if (q.kind === "season") {
    await ensureCaptainRow(team);
    let member: LeagueSquadMember | undefined;
    try {
      [member] = await db.insert(leagueSquadMembers).values({
        teamId: team.id,
        name: [f.firstName, f.lastName].filter(Boolean).join(" "),
        email: f.email, phone: f.phone,
        source: "fillin", fillinId: f.id,
      }).returning();
    } catch (e: any) {
      // The list filled up, or they were placed elsewhere in the meantime.
      // Put the ask back rather than leave them accepted onto nothing.
      await db.update(leagueFillinRequests).set({ state: "expired", respondedAt: new Date() })
        .where(eq(leagueFillinRequests.id, q.id));
      return { error: `That team's squad list filled up while you were deciding — you're still on the list.` };
    }
    await db.update(leagueFillinRequests).set({ squadMemberId: member.id }).where(eq(leagueFillinRequests.id, q.id));
    // Off the list: they have a team for the term.
    await db.update(teampayFillins).set({ status: "placed", updatedAt: new Date() }).where(eq(teampayFillins.id, f.id));
  }

  const [game] = q.gameId ? await db.select().from(leagueGames).where(eq(leagueGames.id, q.gameId)) : [undefined];
  const what = askLabel(q.kind as LeagueAskKind, iso(q.gameDate), game?.startTime);
  const fullName = [f.firstName, f.lastName].filter(Boolean).join(" ");
  const nightBlock = q.kind === "game"
    ? `<p><strong>${escapeHtml(nzDateLabel(iso(q.gameDate)!))}${game?.startTime ? `, ${escapeHtml(hm(game.startTime))}` : ""}</strong><br>${escapeHtml(game?.location || VENUE)}</p>` : "";

  await sendEmail({
    from: fromFor(team.organizationId, pool),
    to: team.contactEmail || "",
    subject: `${f.firstName} said yes ${q.kind === "game" ? `for ${nzDateLabel(iso(q.gameDate)!)}` : "— they're on your squad"}`,
    html: emailShell(pool, `${escapeHtml(f.firstName)} is in`,
      `<p><strong>${escapeHtml(fullName)}</strong> said yes ${escapeHtml(what)} for <strong>${escapeHtml(team.name)}</strong>.</p>
       ${nightBlock}
       <p>Email: ${escapeHtml(f.email)}${f.phone ? `<br>Mobile: ${escapeHtml(f.phone)}` : ""}</p>
       ${q.kind === "season" ? `<p>They're on your squad list now.</p>` : `<p>They'll see you there. Sort any share of the fee between you.</p>`}`,
      { label: "Open your team page", href: teamUrl(team.id) }),
  }).catch(() => {});

  await sendEmail({
    from: fromFor(team.organizationId, pool),
    to: f.email,
    subject: `You're in — ${team.name}`,
    html: emailShell(pool, `You're in with ${escapeHtml(team.name)}`,
      `<p>Nice one. You said yes ${escapeHtml(what)}.</p>
       ${nightBlock}
       <p>Your captain is ${escapeHtml(team.contactName || "the captain")} — ${escapeHtml(team.contactEmail || "")}${team.contactPhone ? `, ${escapeHtml(team.contactPhone)}` : ""}. Get in touch to sort the details.</p>`),
  }).catch(() => {});

  return { ok: true };
}

export async function declineLeagueAsk(t: string): Promise<{ error?: string; ok?: boolean }> {
  const row = await askByToken(t);
  if (!row) return { error: "not_found" };
  if (row.q.state !== "active") return { error: "This invitation has already been answered." };
  await db.update(leagueFillinRequests)
    .set({ state: "declined", respondedAt: new Date() })
    .where(and(eq(leagueFillinRequests.id, row.q.id), eq(leagueFillinRequests.state, "active")));
  return { ok: true };
}

