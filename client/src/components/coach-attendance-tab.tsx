// Attendance tab — a term programme's roll exactly as the coaches marked it on
// coach.cufc.co.nz (Daniel, 2026-10-14). Read live from the coaching platform
// on every view and every 30 seconds while open (server/coach-attendance.ts);
// ClubOS keeps no copy, so the two cannot disagree.
//
// Built for the office (Olga, Travis): pick a term, find a team or training
// group, see who came — and, at the top, every child who was at a session but
// is not registered for the term, with how to reach them.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { workspaceFetch } from "@/lib/queryClient";
import { AlertTriangle, Check, Mail, Phone, RefreshCw, Search, X } from "lucide-react";

type Status = "present" | "absent" | "injured";
type Row = { id: string; name: string; openTraining: boolean; registered: boolean | null; profilePath: string | null; present: number; absent: number; injured: number; marks: Record<string, Status> };
type Session = { date: string; present: number; absent: number; injured: number; taken: boolean; planned: boolean; past: boolean; today: boolean };
type Team = { id: string; name: string; kind: string; age: number | null; sessions: Session[]; players: Row[] };
type FollowUp = { name: string; openTraining: boolean; teams: string[]; sessionsAttended: number; lastSeen: string | null; email: string | null; phone: string | null; dob: string | null; notes: string | null; addedAt: string };
type Resp =
  | { terms: Array<{ id: number; label: string; current: boolean }>; connected: true; term: { id: number; name: string }; today: string; registrationsInClubos: boolean; teams: Team[]; followUps: FollowUp[] }
  | { terms: Array<{ id: number; label: string; current: boolean }>; connected: false; reason: string };

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer border ${
    on ? "bg-blue-500/15 text-blue-400 border-blue-500/25" : "text-white/45 border-white/[0.08] hover:text-white/70 hover:bg-white/[0.03]"}`;

/** "Tue 14 Oct" from y-m-d parts — never through a Date in local time. */
function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return { wd, day: `${d} ${mon}` };
}
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

function useParam(name: string): [string | undefined, (v: string | null) => void] {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const value = new URLSearchParams(search).get(name) ?? undefined;
  const set = (v: string | null) => {
    const p = new URLSearchParams(search);
    if (v == null) p.delete(name); else p.set(name, v);
    if (name === "aterm") p.delete("ateam");
    const qs = p.toString();
    navigate(`${location}${qs ? `?${qs}` : ""}${window.location.hash}`, { replace: true });
  };
  return [value, set];
}

export function CoachAttendanceTab({ campId }: { campId: number }) {
  const [termParam, setTerm] = useParam("aterm");
  const [teamParam, setTeam] = useParam("ateam");
  const [find, setFind] = useState("");
  const [showUpcoming, setShowUpcoming] = useState(false);

  const { data, isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery<Resp>({
    queryKey: [`/api/admin/camps/${campId}/coach-attendance`, termParam ?? "auto"],
    queryFn: async () => {
      const res = await workspaceFetch(`/api/admin/camps/${campId}/coach-attendance${termParam ? `?termId=${termParam}` : ""}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const teams = data && data.connected ? data.teams : [];
  const q = find.trim().toLowerCase();
  const visibleChips = teams.filter((t) => !q || t.name.toLowerCase().includes(q) || t.players.some((p) => p.name.toLowerCase().includes(q)));
  const selected = teamParam ? teams.filter((t) => t.id === teamParam) : visibleChips;

  const totals = useMemo(() => {
    let due = 0, taken = 0, present = 0, marked = 0;
    for (const t of selected) for (const s of t.sessions) {
      if (s.past || s.today) { if (s.planned || s.taken) due++; if (s.taken) taken++; }
      present += s.present; marked += s.present + s.absent + s.injured;
    }
    return { due, taken, present, marked };
  }, [selected]);

  if (isLoading) return <div className="py-16 text-center text-white/40 text-sm">Loading attendance from the coaching platform…</div>;
  if (error) return <div className="py-16 text-center text-red-400 text-sm">Couldn't load attendance: {(error as Error).message}</div>;
  if (!data) return null;

  const termChips = (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="attendance-terms">
      {data.terms.map((t) => {
        const on = data.connected ? data.term.id === t.id : String(t.id) === termParam;
        return (
          <button key={t.id} onClick={() => setTerm(String(t.id))} className={chip(on)} data-testid={`attendance-term-${t.id}`}>
            {t.label}{t.current && <span className="ml-1.5 text-emerald-400/80">now</span>}
          </button>
        );
      })}
    </div>
  );

  if (!data.connected) {
    return (
      <div className="space-y-4">
        {termChips}
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-sm text-amber-300 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Attendance can't be shown right now — {data.reason} Nothing here is a guess: until the coaching platform answers, this tab shows nothing rather than an empty roll.</span>
        </div>
      </div>
    );
  }

  const updated = new Date(dataUpdatedAt).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
  const follow = data.followUps.filter((f) => !teamParam || f.teams.includes(teams.find((t) => t.id === teamParam)?.name ?? ""));

  return (
    <div className="space-y-5" data-testid="attendance-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {termChips}
        <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70" data-testid="attendance-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Live from coach.cufc.co.nz · updated {updated}
        </button>
      </div>

      {/* Team / training group finder */}
      <div className="space-y-2.5">
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find a team, training group or player…"
            className="premium-input w-full pl-9 pr-3 py-2 text-sm"
            data-testid="attendance-find"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="attendance-teams">
          <button onClick={() => setTeam(null)} className={chip(!teamParam)} data-testid="attendance-team-all">
            All groups <span className="ml-1.5 text-white/30">{teams.length}</span>
          </button>
          {visibleChips.map((t) => (
            <button key={t.id} onClick={() => setTeam(t.id)} className={chip(teamParam === t.id)} data-testid={`attendance-team-${t.id}`}>
              {t.name} <span className="ml-1.5 text-white/30">{t.players.length}</span>
            </button>
          ))}
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] p-8 text-center text-sm text-white/45">
          No team or training group on the coaching platform has a session in {data.term.name} for this programme yet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Rolls taken" value={`${totals.taken} / ${totals.due}`} hint="sessions so far" />
            <Stat label="Attendance" value={pct(totals.present, totals.marked)} hint={`${totals.present} present of ${totals.marked} marked`} />
            <Stat label="Groups" value={String(selected.length)} hint={teamParam ? "selected" : "with sessions this term"} />
            <Stat label="To follow up" value={String(follow.length)} hint="at a session, not registered" warn={follow.length > 0} />
          </div>

          {!data.registrationsInClubos && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[12.5px] text-white/50 flex gap-2" data-testid="attendance-no-regs">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
              <span>No {data.term.name} registrations for this programme are in ClubOS yet, so nobody here can be checked against payment. Only open-training players are listed to follow up.</span>
            </div>
          )}

          {follow.length > 0 && <FollowUps rows={follow} term={data.term.name} />}

          <label className="inline-flex items-center gap-2 text-[12px] text-white/45 cursor-pointer select-none">
            <input type="checkbox" checked={showUpcoming} onChange={(e) => setShowUpcoming(e.target.checked)} data-testid="attendance-upcoming" />
            Show upcoming sessions too
          </label>

          <div className="space-y-6">
            {selected.map((t) => <TeamGrid key={t.id} team={t} showUpcoming={showUpcoming} highlight={q} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wider font-semibold text-white/40">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${warn ? "text-amber-400" : "text-white"}`}>{value}</div>
      <div className="text-[11.5px] text-white/35">{hint}</div>
    </div>
  );
}

function FollowUps({ rows, term }: { rows: FollowUp[]; term: string }) {
  return (
    <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05]" data-testid="attendance-followups">
      <div className="px-4 py-3 border-b border-amber-500/15">
        <div className="text-sm font-semibold text-amber-300">Follow up for payment &amp; registration — {rows.length}</div>
        <div className="text-[12px] text-white/45">Marked at a session by a coach, but not registered for {term} in ClubOS. Open-training players first.</div>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {rows.map((f, i) => (
          <div key={i} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" data-testid="attendance-followup">
            <div className="min-w-[180px] flex-1">
              <span className="font-medium text-white">{f.name}</span>
              <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${f.openTraining ? "bg-violet-500/15 text-violet-400" : "bg-amber-500/15 text-amber-400"}`}>
                {f.openTraining ? "Open training" : "Not registered"}
              </span>
              <div className="text-[11.5px] text-white/40">{f.teams.join(" · ")}</div>
            </div>
            <div className="text-white/60 w-[150px]">
              {f.sessionsAttended} session{f.sessionsAttended === 1 ? "" : "s"}
              {f.lastSeen && <span className="text-white/35"> · last {dayLabel(f.lastSeen).day}</span>}
            </div>
            <div className="flex items-center gap-3 text-white/60">
              {f.phone ? <a href={`tel:${f.phone}`} className="inline-flex items-center gap-1 hover:text-blue-400"><Phone className="w-3.5 h-3.5" />{f.phone}</a> : null}
              {f.email ? <a href={`mailto:${f.email}`} className="inline-flex items-center gap-1 hover:text-blue-400"><Mail className="w-3.5 h-3.5" />{f.email}</a> : null}
              {!f.phone && !f.email && <span className="text-white/30 text-[12px]">No contact details — ask the coach</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Cell({ s }: { s: Status | undefined }) {
  if (s === "present") return <span className="inline-grid place-items-center w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-400" title="Present"><Check className="w-3.5 h-3.5" /></span>;
  if (s === "absent") return <span className="inline-grid place-items-center w-6 h-6 rounded-md bg-red-500/15 text-red-400" title="Absent"><X className="w-3.5 h-3.5" /></span>;
  if (s === "injured") return <span className="inline-grid place-items-center w-6 h-6 rounded-md bg-amber-500/15 text-amber-400 text-[10px] font-bold" title="Injured">INJ</span>;
  return <span className="inline-grid place-items-center w-6 h-6 text-white/20" title="Not marked">–</span>;
}

function TeamGrid({ team, showUpcoming, highlight }: { team: Team; showUpcoming: boolean; highlight: string }) {
  const cols = team.sessions.filter((s) => showUpcoming || s.past || s.today || s.taken);
  const upcoming = team.sessions.filter((s) => !s.past && !s.today && !s.taken).length;
  const presentTotal = team.players.reduce((n, p) => n + p.present, 0);
  const markedTotal = team.players.reduce((n, p) => n + p.present + p.absent + p.injured, 0);
  return (
    <section className="rounded-xl border border-white/[0.08] overflow-hidden" data-testid="attendance-team">
      <div className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02]">
        <div>
          <span className="font-semibold text-white">{team.name}</span>
          <span className="ml-2 text-[12px] text-white/40">{team.players.length} players · {cols.filter((c) => c.taken).length} rolls taken · {pct(presentTotal, markedTotal)} attendance</span>
        </div>
        {!showUpcoming && upcoming > 0 && <span className="text-[11.5px] text-white/35">{upcoming} upcoming session{upcoming === 1 ? "" : "s"} hidden</span>}
      </div>
      {cols.length === 0 ? (
        <div className="px-4 py-6 text-sm text-white/40">No sessions yet this term.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[13px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-background text-left px-4 py-2 text-[10.5px] uppercase tracking-wider font-semibold text-white/40 min-w-[220px]">Player</th>
                <th className="px-3 py-2 text-[10.5px] uppercase tracking-wider font-semibold text-white/40 text-right">Here</th>
                {cols.map((s) => {
                  const l = dayLabel(s.date);
                  return (
                    <th key={s.date} className={`px-1.5 py-2 text-center font-medium min-w-[56px] ${s.today ? "text-blue-400" : "text-white/45"}`}>
                      <div className="text-[10px] uppercase">{l.wd}</div>
                      <div className="text-[11.5px] whitespace-nowrap">{l.day}</div>
                      <div className={`text-[10px] ${s.taken ? "text-emerald-400/80" : s.past ? "text-red-400/80" : "text-white/25"}`}>
                        {s.taken ? `${s.present} here` : s.past ? "no roll" : s.today ? "today" : "—"}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {team.players.map((p) => {
                const hit = highlight && p.name.toLowerCase().includes(highlight);
                return (
                  <tr key={p.id} className={hit ? "bg-blue-500/[0.06]" : ""}>
                    <td className="sticky left-0 z-10 bg-background px-4 py-1.5 border-t border-white/[0.05] whitespace-nowrap">
                      {p.profilePath ? <Link href={p.profilePath} className="text-white hover:text-blue-400">{p.name}</Link> : <span className="text-white">{p.name}</span>}
                      {p.openTraining && <span className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase bg-violet-500/15 text-violet-400">Open training</span>}
                      {!p.openTraining && p.registered === false && <span className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase bg-amber-500/15 text-amber-400">Not registered</span>}
                    </td>
                    <td className="px-3 py-1.5 border-t border-white/[0.05] text-right text-white/60 whitespace-nowrap">{p.present}/{p.present + p.absent + p.injured}</td>
                    {cols.map((s) => (
                      <td key={s.date} className="px-1.5 py-1.5 border-t border-white/[0.05] text-center"><Cell s={p.marks[s.date]} /></td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
