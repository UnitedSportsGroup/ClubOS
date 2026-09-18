/**
 * League standings — ONE decider.
 *
 * The public league API (which the MFL app reads) and the captain's dashboard
 * both show a ladder. Before 2026-09-18 the public route computed it inline;
 * a second copy on the captain's page would be the first thing to drift — a
 * captain reading "3rd" on their dashboard and "4th" in the app is a support
 * message, and the answer would be "both are right, differently".
 *
 * 3 points a win, 1 a draw. Only games marked `final` count. A final game with
 * a missing score reads as 0 — a game the referee closed without a score is a
 * data-entry problem for the league admin, not something to hide a team's
 * other results behind.
 */
export interface StandingTeam {
  id: number;
  name: string;
  divisionId: number | null;
}

export interface StandingGame {
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
}

export interface StandingRow {
  teamId: number;
  teamName: string;
  divisionId: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

export function computeLeagueStandings(teams: StandingTeam[], games: StandingGame[]): StandingRow[] {
  const map = new Map<number, StandingRow>();
  for (const t of teams) {
    map.set(t.id, {
      teamId: t.id, teamName: t.name, divisionId: t.divisionId,
      played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0,
    });
  }
  for (const g of games) {
    if (g.status !== "final") continue;
    if (g.homeTeamId == null || g.awayTeamId == null) continue;
    const home = map.get(g.homeTeamId);
    const away = map.get(g.awayTeamId);
    if (!home || !away) continue;
    const hs = g.homeScore ?? 0;
    const as = g.awayScore ?? 0;
    home.played++; away.played++;
    home.gf += hs; home.ga += as;
    away.gf += as; away.ga += hs;
    if (hs > as)      { home.won++; home.pts += 3; away.lost++; }
    else if (hs < as) { away.won++; away.pts += 3; home.lost++; }
    else              { home.drawn++; home.pts += 1; away.drawn++; away.pts += 1; }
  }
  return Array.from(map.values())
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.teamName.localeCompare(b.teamName));
}
