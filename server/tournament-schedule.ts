// CIC tournament schedule generator. Produces the 48-game format used by
// Christchurch International Cup (and any 16-team / 4-pool tournament that
// follows the same shape):
//
//   • 24 pool games (3 rounds × 4 pools × 2 games)
//   • 8 quarter-finals (4 Cup, 4 Plate)
//   • 8 semi-finals (winners' + losers' brackets, both Cup and Plate)
//   • 8 placement matches (1st, 3rd, 5th, 7th, 9th, 11th, 13th, 15th)
//
// The bracket pairings and game numbering match the CIC 2025 Excel master
// schedule exactly, so anyone used to that format finds the new system
// familiar. Day allocation: Day 1 = pool rounds 1-2, Day 2 morning = pool
// round 3 + Day 2 afternoon = QFs, Day 3 = SFs (morning) + finals (afternoon).

import type { TournamentTeam, TournamentGroup, InsertTournamentGame } from "@shared/schema";

export interface ScheduleInputs {
  tournamentId: number;
  startDate: string | null; // ISO date "2026-07-04". When null, gameDate is left null on every game so admins can set dates later.
  groups: TournamentGroup[];
  teams: TournamentTeam[];
  fields?: [string, string]; // defaults to ["J3", "J4"]
}

interface SlotEntry {
  gameNumber: number;
  dayOffset: 0 | 1 | 2;
  startTime: string;
  endTime: string;
  field: string;
  stage: "group" | "knockout" | "final";
  stageDetail: string;
  // For pool play: pool letter + team indices within that pool (1-4)
  pool?: { letter: string; homeSeed: number; awaySeed: number };
  // For knockout: placeholder strings or earlier-game references
  homePlaceholder?: string;
  awayPlaceholder?: string;
  roundNumber?: number;
}

// ---- Templates ----

// Pool round-robin: a 4-team pool plays each other once = 6 games per pool.
// Spread across 3 rounds, 2 games per round per pool. Using the standard
// rotation so every team plays every other team across rounds 1-3.
const POOL_ROUNDS: { round: 1 | 2 | 3; pairs: [number, number][] }[] = [
  { round: 1, pairs: [[1, 2], [3, 4]] },
  { round: 2, pairs: [[1, 3], [2, 4]] },
  { round: 3, pairs: [[1, 4], [2, 3]] },
];

// Knockout / placement template — game numbers, slots, and bracket
// derivation rules that make CIC distinctive. Day offset and time are
// indexed per the CIC 2025 master schedule (Saturday/Sunday/Monday layout).
const KNOCKOUT_TEMPLATE: Array<{
  gameNumber: number;
  dayOffset: 0 | 1 | 2;
  startTime: string;
  fieldIdx: 0 | 1; // 0 = J3, 1 = J4
  stage: "knockout" | "final";
  stageDetail: string;
  homePlaceholder: string;
  awayPlaceholder: string;
}> = [
  // Day 2 afternoon — Quarter-finals
  { gameNumber: 25, dayOffset: 1, startTime: "12:20", fieldIdx: 0, stage: "knockout", stageDetail: "QF 1 PLATE", homePlaceholder: "A3", awayPlaceholder: "B4" },
  { gameNumber: 26, dayOffset: 1, startTime: "12:20", fieldIdx: 1, stage: "knockout", stageDetail: "QF 2 PLATE", homePlaceholder: "B3", awayPlaceholder: "A4" },
  { gameNumber: 27, dayOffset: 1, startTime: "13:15", fieldIdx: 0, stage: "knockout", stageDetail: "QF 1 CUP",   homePlaceholder: "A1", awayPlaceholder: "B2" },
  { gameNumber: 28, dayOffset: 1, startTime: "13:15", fieldIdx: 1, stage: "knockout", stageDetail: "QF 2 CUP",   homePlaceholder: "B1", awayPlaceholder: "A2" },
  { gameNumber: 29, dayOffset: 1, startTime: "14:10", fieldIdx: 0, stage: "knockout", stageDetail: "QF 3 PLATE", homePlaceholder: "C3", awayPlaceholder: "D4" },
  { gameNumber: 30, dayOffset: 1, startTime: "14:10", fieldIdx: 1, stage: "knockout", stageDetail: "QF 4 PLATE", homePlaceholder: "D3", awayPlaceholder: "C4" },
  { gameNumber: 31, dayOffset: 1, startTime: "15:05", fieldIdx: 0, stage: "knockout", stageDetail: "QF 3 CUP",   homePlaceholder: "C1", awayPlaceholder: "D2" },
  { gameNumber: 32, dayOffset: 1, startTime: "15:05", fieldIdx: 1, stage: "knockout", stageDetail: "QF 4 CUP",   homePlaceholder: "D1", awayPlaceholder: "C2" },

  // Day 3 morning — Semi-finals (losers' bracket first, then winners')
  // Plate losers' SFs (determine 13th/15th placement)
  { gameNumber: 33, dayOffset: 2, startTime: "08:30", fieldIdx: 0, stage: "knockout", stageDetail: "SF 3 PLATE", homePlaceholder: "L G25", awayPlaceholder: "L G30" },
  { gameNumber: 34, dayOffset: 2, startTime: "08:30", fieldIdx: 1, stage: "knockout", stageDetail: "SF 4 PLATE", homePlaceholder: "L G26", awayPlaceholder: "L G29" },
  // Cup losers' SFs (determine 5th/7th placement)
  { gameNumber: 35, dayOffset: 2, startTime: "09:25", fieldIdx: 0, stage: "knockout", stageDetail: "SF 3 CUP",   homePlaceholder: "L G27", awayPlaceholder: "L G32" },
  { gameNumber: 36, dayOffset: 2, startTime: "09:25", fieldIdx: 1, stage: "knockout", stageDetail: "SF 4 CUP",   homePlaceholder: "L G28", awayPlaceholder: "L G31" },
  // Plate winners' SFs (feed Plate Final + 11th)
  { gameNumber: 37, dayOffset: 2, startTime: "10:20", fieldIdx: 0, stage: "knockout", stageDetail: "SF 1 PLATE", homePlaceholder: "W G25", awayPlaceholder: "W G30" },
  { gameNumber: 38, dayOffset: 2, startTime: "10:20", fieldIdx: 1, stage: "knockout", stageDetail: "SF 2 PLATE", homePlaceholder: "W G26", awayPlaceholder: "W G29" },
  // Cup winners' SFs (feed Cup Final + 3rd)
  { gameNumber: 39, dayOffset: 2, startTime: "11:15", fieldIdx: 0, stage: "knockout", stageDetail: "SF 1 CUP",   homePlaceholder: "W G27", awayPlaceholder: "W G32" },
  { gameNumber: 40, dayOffset: 2, startTime: "11:15", fieldIdx: 1, stage: "knockout", stageDetail: "SF 2 CUP",   homePlaceholder: "W G28", awayPlaceholder: "W G31" },

  // Day 3 afternoon — Placement matches
  { gameNumber: 41, dayOffset: 2, startTime: "12:10", fieldIdx: 0, stage: "knockout", stageDetail: "15th Place", homePlaceholder: "L G33", awayPlaceholder: "L G34" },
  { gameNumber: 42, dayOffset: 2, startTime: "12:10", fieldIdx: 1, stage: "knockout", stageDetail: "13th Place", homePlaceholder: "W G33", awayPlaceholder: "W G34" },
  { gameNumber: 45, dayOffset: 2, startTime: "13:05", fieldIdx: 0, stage: "knockout", stageDetail: "7th Place",  homePlaceholder: "L G35", awayPlaceholder: "L G36" },
  { gameNumber: 46, dayOffset: 2, startTime: "13:05", fieldIdx: 1, stage: "knockout", stageDetail: "5th Place",  homePlaceholder: "W G35", awayPlaceholder: "W G36" },
  { gameNumber: 43, dayOffset: 2, startTime: "14:00", fieldIdx: 0, stage: "knockout", stageDetail: "11th Place", homePlaceholder: "L G37", awayPlaceholder: "L G38" },
  { gameNumber: 44, dayOffset: 2, startTime: "14:00", fieldIdx: 1, stage: "final",    stageDetail: "PLATE FINAL", homePlaceholder: "W G37", awayPlaceholder: "W G38" },
  { gameNumber: 47, dayOffset: 2, startTime: "14:55", fieldIdx: 0, stage: "knockout", stageDetail: "3rd Place",  homePlaceholder: "L G39", awayPlaceholder: "L G40" },
  { gameNumber: 48, dayOffset: 2, startTime: "14:55", fieldIdx: 1, stage: "final",    stageDetail: "CUP FINAL",  homePlaceholder: "W G39", awayPlaceholder: "W G40" },
];

// Pool-stage scheduling. Each pool plays its 2 round-N games in the same
// time slot (one on each field). Pools are scheduled sequentially in the day.
// Day 1 = rounds 1+2 (16 games, 9:30-15:20). Day 2 morning = round 3 (8 games, 9:00-11:30).
const POOL_TIME_SLOTS_DAY1 = ["09:30", "10:20", "11:10", "12:00", "12:50", "13:40", "14:30", "15:20"];
const POOL_TIME_SLOTS_DAY2_MORNING = ["09:00", "09:50", "10:40", "11:30"];
const GAME_DURATION_MIN = 40; // 40-minute games with 10-min turnover = 50 min slot

// ---- Helpers ----

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function addDaysToISODate(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Sort a pool's teams by seedNumber (1..4) with id-order fallback so the
// generator works whether or not seeds are explicitly assigned.
function teamsForPoolOrdered(pool: TournamentGroup, allTeams: TournamentTeam[]): TournamentTeam[] {
  return allTeams
    .filter(t => t.groupId === pool.id)
    .sort((a, b) => {
      const sa = a.seedNumber ?? 999;
      const sb = b.seedNumber ?? 999;
      if (sa !== sb) return sa - sb;
      return a.id - b.id;
    });
}

// ---- Main generator ----

export function buildCICSchedule(inputs: ScheduleInputs): InsertTournamentGame[] {
  const fields: [string, string] = inputs.fields ?? ["J3", "J4"];
  const orderedPools = inputs.groups.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));

  if (orderedPools.length !== 4) {
    throw new Error(`CIC schedule requires exactly 4 pools, got ${orderedPools.length}`);
  }

  const games: InsertTournamentGame[] = [];
  let gameNumber = 1;

  // ---- Pool stage ----
  // Slot order across day 1: 8 slots, 2 pool-pairs per slot, scheduled
  // pool-by-pool to keep each club at the venue in a tight window.
  // Day 1 layout: slots 0-3 = round 1 (Pool A,B,C,D), slots 4-7 = round 2 (Pool A,B,C,D)
  // Day 2 morning layout: slots 0-3 = round 3 (Pool A,B,C,D)

  for (let roundIdx = 0; roundIdx < 3; roundIdx++) {
    const round = POOL_ROUNDS[roundIdx];
    for (let poolIdx = 0; poolIdx < orderedPools.length; poolIdx++) {
      const pool = orderedPools[poolIdx];
      const poolTeams = teamsForPoolOrdered(pool, inputs.teams);
      const poolLetter = String.fromCharCode("A".charCodeAt(0) + poolIdx);

      // Pick the time slot for this round + pool
      let dayOffset: 0 | 1 | 2;
      let startTime: string;
      if (roundIdx === 0) {
        dayOffset = 0;
        startTime = POOL_TIME_SLOTS_DAY1[poolIdx]; // slots 0-3
      } else if (roundIdx === 1) {
        dayOffset = 0;
        startTime = POOL_TIME_SLOTS_DAY1[4 + poolIdx]; // slots 4-7
      } else {
        dayOffset = 1;
        startTime = POOL_TIME_SLOTS_DAY2_MORNING[poolIdx];
      }
      const endTime = addMinutes(startTime, GAME_DURATION_MIN);
      const gameDate = addDaysToISODate(inputs.startDate, dayOffset);

      for (let pairIdx = 0; pairIdx < round.pairs.length; pairIdx++) {
        const [homeSeed, awaySeed] = round.pairs[pairIdx];
        const homeTeam = poolTeams[homeSeed - 1];
        const awayTeam = poolTeams[awaySeed - 1];
        games.push({
          tournamentId: inputs.tournamentId,
          groupId: pool.id,
          homeTeamId: homeTeam?.id ?? null,
          awayTeamId: awayTeam?.id ?? null,
          homeTeamPlaceholder: homeTeam ? null : `${poolLetter}${homeSeed}`,
          awayTeamPlaceholder: awayTeam ? null : `${poolLetter}${awaySeed}`,
          gameNumber: gameNumber++,
          roundNumber: round.round,
          stage: "group",
          stageDetail: `POOL ${poolLetter}`,
          gameDate,
          startTime,
          endTime,
          field: fields[pairIdx],
          status: "scheduled",
        });
      }
    }
  }

  // ---- Knockout + placement ----
  // The KNOCKOUT_TEMPLATE has explicit gameNumbers (25-48) so we don't
  // increment our running counter — placement matches deliberately go out
  // of strict numeric order on the schedule (game 41 before 45 etc.) to
  // match the wall-clock progression and the CIC master sheet.
  for (const t of KNOCKOUT_TEMPLATE) {
    const endTime = addMinutes(t.startTime, GAME_DURATION_MIN);
    const gameDate = addDaysToISODate(inputs.startDate, t.dayOffset);
    games.push({
      tournamentId: inputs.tournamentId,
      groupId: null,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamPlaceholder: t.homePlaceholder,
      awayTeamPlaceholder: t.awayPlaceholder,
      gameNumber: t.gameNumber,
      roundNumber: null,
      stage: t.stage,
      stageDetail: t.stageDetail,
      gameDate,
      startTime: t.startTime,
      endTime,
      field: fields[t.fieldIdx],
      status: "scheduled",
    });
  }

  // Sort final output by game number for predictable storage. (When dates
  // and times are present they correlate with game number anyway, but this
  // also works cleanly when startDate is null and gameDate is unset.)
  games.sort((a, b) => (a.gameNumber ?? 0) - (b.gameNumber ?? 0));

  return games;
}
