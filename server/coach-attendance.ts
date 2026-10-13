// A term programme's ATTENDANCE, as the coaches marked it on coach.cufc.co.nz.
//
// Daniel, 2026-10-14: "attendance tab … select team or training group … so Olga
// and Travis can easily see all attendance data and new open training players
// to follow up with for payment and registration … a live one to one sync with
// coaches platform so whatever got marked on coaches platform appears exact
// same here."
//
// 🔴 READ-THROUGH, NEVER A COPY. Every view asks the coaching platform for its
// marks (GET /api/attendance?feed=clubos, server to server, COACHING_FEED_SECRET),
// so there is no second table to drift and nothing to re-sync. If the coaching
// platform cannot be reached the tab SAYS so — it never shows an empty roll.
// 🔴 Which coach teams belong to this programme is decided by links the roster
// sync already stamped: the programme's own training groups, plus the club
// squads its registered players are on this term (the same `team` the Players
// tab groups by).
// 🔴 "Registered" is answered by ClubOS (the term's real registrations), never
// by the coaching roster — a child on a coach's roll who has not paid for this
// term is exactly who the office needs to follow up.
import type { ProgramPlayer } from "./storage";

const BASE = (process.env.COACHING_BASE_URL || "https://coach.cufc.co.nz").replace(/\/$/, "");

type FeedPlayer = {
  id: string; name: string; active: boolean; source: string; openTraining: boolean;
  contactId: number | null; registrationId: number | null;
  dob: string | null; email: string | null; phone: string | null; notes: string | null; addedAt: string;
};
type FeedTeam = { id: string; name: string; kind: string; squadId: number | null; age: number | null; trainingDays: string[]; players: FeedPlayer[] };
type Feed = { teams: FeedTeam[]; marks: Array<{ player_id: string; date: string; status: string }> };

export type AttendanceStatus = "present" | "absent" | "injured";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

export async function coachAttendance(opts: {
  programId: number;
  term: { id: number; name: string; startDate: string; endDate: string };
  players: ProgramPlayer[];
  /** Squads to include even when nobody is registered for this term yet —
   *  Academy's Term 4 roll exists before its fees are taken in ClubOS. */
  extraSquadIds?: number[];
  today: string;
}) {
  const secret = process.env.COACHING_FEED_SECRET;
  if (!secret) return { connected: false as const, reason: "The link to the coaching platform is not switched on (COACHING_FEED_SECRET)." };

  const squadIds = Array.from(new Set([
    ...opts.players.map((p) => p.team?.id).filter((n): n is number => typeof n === "number"),
    ...(opts.extraSquadIds ?? []),
  ]));
  const qs = new URLSearchParams({ feed: "clubos", programId: String(opts.programId), from: opts.term.startDate, to: opts.term.endDate });
  if (squadIds.length) qs.set("squadIds", squadIds.join(","));

  let feed: Feed;
  try {
    const r = await fetch(`${BASE}/api/attendance?${qs}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return { connected: false as const, reason: `The coaching platform answered ${r.status}.` };
    feed = (await r.json()) as Feed;
  } catch (e: any) {
    return { connected: false as const, reason: `Couldn't reach the coaching platform (${e?.name === "TimeoutError" ? "timed out" : "network error"}).` };
  }

  // Who is really registered for THIS term, by contact id and by name.
  const byContact = new Map<number, ProgramPlayer>();
  const byName = new Map<string, ProgramPlayer>();
  for (const p of opts.players) {
    if (p.personType === "contact") byContact.set(p.personId, p);
    byName.set(norm(`${p.firstName} ${p.lastName}`), p);
  }
  // 🔴 No registrations at all for this term means ClubOS cannot answer "have
  // they paid" — Academy's Term 4 fees are not in ClubOS — so nobody is flagged
  // as unregistered on a missing fact; only open-training players are listed.
  const canCheck = opts.players.length > 0;
  const clubosMatch = (fp: FeedPlayer) => (fp.contactId != null ? byContact.get(fp.contactId) : undefined) ?? byName.get(norm(fp.name)) ?? null;

  const marksByPlayer = new Map<string, Map<string, AttendanceStatus>>();
  for (const m of feed.marks) {
    if (!["present", "absent", "injured"].includes(m.status)) continue;
    let mm = marksByPlayer.get(m.player_id);
    if (!mm) marksByPlayer.set(m.player_id, (mm = new Map()));
    mm.set(m.date, m.status as AttendanceStatus);
  }

  const followUps = new Map<string, any>();
  const teams = feed.teams
    .map((t) => {
      const markDates = new Set<string>();
      for (const p of t.players) for (const d of Array.from(marksByPlayer.get(p.id)?.keys() ?? [])) markDates.add(d);
      const dates = Array.from(new Set([...t.trainingDays, ...Array.from(markDates)])).sort();
      const rows = t.players
        .filter((p) => p.active || marksByPlayer.has(p.id))
        .map((p) => {
          const marks = Object.fromEntries(Array.from(marksByPlayer.get(p.id)?.entries() ?? []));
          const vals = Object.values(marks);
          const match = clubosMatch(p);
          const row = {
            id: p.id, name: p.name, openTraining: p.openTraining,
            registered: canCheck ? !!match : null, profilePath: match?.profilePath ?? null,
            present: vals.filter((v) => v === "present").length,
            absent: vals.filter((v) => v === "absent").length,
            injured: vals.filter((v) => v === "injured").length,
            marks,
          };
          // The office's follow-up list: at a session, but not paid up for this term.
          if (!match && (p.openTraining || (canCheck && row.present > 0))) {
            const key = p.contactId ? `c${p.contactId}` : `n${norm(p.name)}`;
            const prev = followUps.get(key);
            const seen = Object.entries(marks).filter(([, v]) => v === "present").map(([d]) => d);
            if (prev) {
              prev.teams.push(t.name); prev.sessionsAttended += row.present;
              prev.lastSeen = [prev.lastSeen, ...seen].filter(Boolean).sort().pop() ?? null;
            } else {
              followUps.set(key, {
                name: p.name, openTraining: p.openTraining, teams: [t.name],
                sessionsAttended: row.present, lastSeen: seen.sort().pop() ?? null,
                email: p.email, phone: p.phone, dob: p.dob, notes: p.notes, addedAt: p.addedAt,
                contactId: p.contactId,
              });
            }
          }
          return row;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const sessions = dates.map((d) => {
        let present = 0, absent = 0, injured = 0;
        for (const r of rows) { const s = r.marks[d]; if (s === "present") present++; else if (s === "absent") absent++; else if (s === "injured") injured++; }
        const taken = present + absent + injured > 0;
        return { date: d, present, absent, injured, taken, planned: t.trainingDays.includes(d), past: d < opts.today, today: d === opts.today };
      });
      return { id: t.id, name: t.name, kind: t.kind, age: t.age, sessions, players: rows };
    })
    // The old whole-programme mirrors carry no sessions; a team with neither a
    // planned training day nor a mark this term has nothing to show.
    .filter((t) => t.sessions.length > 0)
    .sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    connected: true as const,
    term: opts.term,
    today: opts.today,
    registrationsInClubos: canCheck,
    teams,
    followUps: Array.from(followUps.values()).sort((a, b) => Number(b.openTraining) - Number(a.openTraining) || (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")),
  };
}
