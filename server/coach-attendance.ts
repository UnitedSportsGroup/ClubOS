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
import { sql } from "drizzle-orm";
import { db } from "./db";

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
    // 🔴 A term run in TRAINING GROUPS (Pre-Academy from Term 4) shows only
    // them — the winter squads are last term's shape (Daniel, 2026-10-14).
    .filter((t, _i, all) => !all.some((x) => x.kind === "training_group") || t.kind === "training_group")
    .sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Kids ClubOS already knows (a past term, another programme) — the office
  // calls the PARENT on their latest registration, else the contact itself.
  const follow = Array.from(followUps.values());
  // The coaching roster usually holds only a NAME. Resolve to a ClubOS player
  // by exact full name — and 🔴 only when exactly one player has it; two
  // children sharing a name get no details rather than the wrong parent's.
  const unnamed = follow.filter((f) => f.contactId == null);
  if (unnamed.length) {
    const names = Array.from(new Set(unnamed.map((f) => norm(f.name)).filter(Boolean)));
    const m: any = await db.execute(sql`
      SELECT trim(regexp_replace(regexp_replace(lower(first_name || ' ' || last_name), '[^a-z ]', '', 'g'), ' +', ' ', 'g')) AS n, array_agg(id ORDER BY id DESC) AS ids,
             count(DISTINCT date_of_birth) AS dobs, bool_and(date_of_birth IS NOT NULL) AS all_dob
      FROM contacts
      WHERE type = 'player' AND trim(regexp_replace(regexp_replace(lower(first_name || ' ' || last_name), '[^a-z ]', '', 'g'), ' +', ' ', 'g')) IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})
      GROUP BY 1`);
    const one = new Map<string, number>();
    // Several records, ONE date of birth = the same child entered twice (175
    // known duplicate groups) — use the newest. Different birthdays = siblings
    // or strangers, and nobody gets a guessed parent.
    for (const row of (m.rows ?? m)) {
      const same = (row.ids ?? []).length === 1 || (row.all_dob && Number(row.dobs) === 1);
      if (same) one.set(String(row.n), Number(row.ids[0]));
    }
    for (const f of unnamed) { const id = one.get(norm(f.name)); if (id) f.contactId = id; }
  }
  const ids = Array.from(new Set(follow.map((f) => f.contactId).filter((n: unknown): n is number => typeof n === "number")));
  if (ids.length) {
    const r: any = await db.execute(sql`
      SELECT c.id,
             COALESCE(g.first_name || ' ' || g.last_name, NULL) AS parent_name,
             COALESCE(g.email, c.email) AS email, COALESCE(g.phone, c.phone) AS phone,
             lr.program_name, lr.term_label
      FROM contacts c
      LEFT JOIN LATERAL (
        SELECT r.guardian_id, p.name AS program_name,
               CASE WHEN t.id IS NULL THEN NULL ELSE 'Term ' || t.term_number || ' ' || t.year END AS term_label
        FROM registrations r JOIN programs p ON p.id = r.program_id LEFT JOIN terms t ON t.id = r.term_id
        WHERE r.contact_id = c.id ORDER BY r.registered_at DESC LIMIT 1
      ) lr ON true
      LEFT JOIN contacts g ON g.id = lr.guardian_id
      WHERE c.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    const by = new Map<number, any>((r.rows ?? r).map((x: any) => [Number(x.id), x]));
    for (const f of follow) {
      const x = f.contactId != null ? by.get(f.contactId) : undefined;
      if (!x) continue;
      f.parentName = x.parent_name ?? null;
      f.email = f.email ?? x.email ?? null;
      f.phone = f.phone ?? x.phone ?? null;
      f.lastRegistered = x.program_name ? `${x.program_name}${x.term_label ? ` · ${x.term_label}` : ""}` : null;
      f.profilePath = `/admin/people/contact-${f.contactId}`;
    }
  }

  return {
    connected: true as const,
    term: opts.term,
    today: opts.today,
    registrationsInClubos: canCheck,
    teams,
    followUps: follow.sort((a, b) => Number(b.openTraining) - Number(a.openTraining) || (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")),
  };
}
