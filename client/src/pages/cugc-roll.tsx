// CUGC — the class roll.
//
// The gymnastics club had no attendance at all before 2026-09-20: nobody could
// answer "who was in the gym on Tuesday", and a coach chasing a missing child
// had nothing to check. This is the timetable, and a roll per class per week.
//
// 🔴 ONLY PAID CHILDREN APPEAR. "If you ain't paid you ain't registered" — a
// pending_payment row is an unfinished checkout, and putting one in front of a
// coach tells them to expect a child nobody has taken money for.
//
// 🔴 NOT MARKED is not ABSENT. A child with no mark is a question nobody has
// answered yet; a half-taken roll must never read as "nobody came".
import { useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  ClipboardList, CalendarDays, Users, Check, X, ChevronLeft, AlertTriangle, Phone, Clock,
} from "lucide-react";

interface ClassDate { date: string; taken: boolean; past: boolean; today: boolean }
interface RollClass {
  id: string; label: string; weekday: number; start: string; end: string;
  programSlug: string; onRoll: number; dates: ClassDate[];
}
interface TermCfg { id: string; name: string; start: string; end: string; status: string; window: string }
interface RollIndex {
  term: TermCfg;
  terms: TermCfg[];
  today: string;
  classes: RollClass[];
  unplaced: { id: number; name: string; programName: string; optionLabel: string; reason: string }[];
}
interface Child {
  registrationId: number; name: string; dob: string | null; programName: string; optionLabel: string;
  parentName: string; phone: string | null; medical: string | null;
  status: "present" | "absent" | null; markedAt: string | null; markedBy: string | null;
}
interface SessionRoll { class: RollClass; date: string; term: { name: string }; children: Child[] }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function niceDate(iso: string): string {
  // Built from the date's own parts — never `new Date(iso)`, which reads a day
  // earlier in NZ and has printed the wrong day on this codebase before.
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[at.getUTCDay()].slice(0, 3)} ${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]}`;
}

export default function CugcRoll() {
  const search = useSearch();
  const q = new URLSearchParams(search);
  // The open session lives in the URL so Back returns to the timetable and a
  // particular week can be sent to a coach as a link.
  const [openSession, setOpenSessionState] = useState<{ classId: string; date: string } | null>(() => {
    const c = q.get("class"), d = q.get("date");
    return c && d ? { classId: c, date: d } : null;
  });
  const [term, setTermState] = useState<string>(() => q.get("term") || "");

  const writeUrl = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };
  const setOpenSession = (s: { classId: string; date: string } | null) => {
    setOpenSessionState(s);
    writeUrl({ class: s?.classId ?? null, date: s?.date ?? null });
  };
  const setTerm = (t: string) => { setTermState(t); writeUrl({ term: t, class: null, date: null }); setOpenSessionState(null); };

  const { data: index, isLoading } = useQuery<RollIndex>({
    queryKey: [`/api/admin/cugc/roll${term ? `?term=${encodeURIComponent(term)}` : ""}`],
  });

  if (openSession) {
    return <SessionView
      classId={openSession.classId}
      date={openSession.date}
      onBack={() => setOpenSession(null)}
    />;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white/90 flex items-center gap-2.5">
          <ClipboardList className="w-6 h-6 text-blue-400" />
          Roll{index ? ` · ${index.term.name}` : ""}
        </h1>
        <p className="text-sm text-white/40 mt-1">
          Every class, week by week. Tap a week to mark who came.
        </p>
      </div>

      {index && index.terms.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-white/35 inline-flex items-center gap-1.5 pr-1">
            <CalendarDays className="w-3.5 h-3.5" /> Term
          </span>
          {index.terms.map((t) => (
            <button
              key={t.id}
              onClick={() => setTerm(t.name)}
              data-testid={`roll-term-${t.id}`}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${
                index.term.name === t.name
                  ? "bg-blue-500/15 border-blue-400/40 text-blue-200"
                  : "bg-white/[0.04] border-white/10 text-white/60 hover:text-white/90"
              }`}
            >
              {t.name}
              <span className="text-white/30"> · {t.window}</span>
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="text-white/40 text-sm py-16 text-center">Loading the timetable…</div>
      ) : !index ? null : index.classes.every((c) => c.onRoll === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-10 h-10 text-white/20 mb-3" />
          <p className="text-white/60 font-medium">Nobody is enrolled for {index.term.name} yet</p>
          <p className="text-white/35 text-sm mt-1">Paid enrolments appear on their class roll automatically.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {index.classes.filter((c) => c.onRoll > 0 || c.dates.length > 0).map((c) => (
            <div key={c.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-white/90">{c.label}</p>
                  <p className="text-xs text-white/35 mt-0.5 capitalize">{c.programSlug}</p>
                </div>
                <p className="text-xs text-white/50">
                  <Users className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                  {c.onRoll} {c.onRoll === 1 ? "child" : "children"}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.dates.map((d) => {
                  // Colour says one thing and the label says it too — colour is
                  // never the only signal. A FUTURE session is never red: it is
                  // not late, it simply has not happened.
                  const tone = d.today
                    ? "bg-amber-500/15 border-amber-400/40 text-amber-200"
                    : d.taken
                      ? "bg-emerald-500/15 border-emerald-400/35 text-emerald-200"
                      : d.past
                        ? "bg-rose-500/10 border-rose-400/30 text-rose-200/90"
                        : "bg-white/[0.04] border-white/10 text-white/50 hover:text-white/80";
                  return (
                    <button
                      key={d.date}
                      onClick={() => setOpenSession({ classId: c.id, date: d.date })}
                      data-testid={`session-${c.id}-${d.date}`}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${tone}`}
                      title={d.taken ? "Roll taken" : d.past ? "Roll not taken" : d.today ? "Today" : "Not yet"}
                    >
                      {niceDate(d.date)}
                      <span className="block text-[10px] opacity-70">
                        {d.taken ? "Taken" : d.today ? "Today" : d.past ? "Not taken" : "Upcoming"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {index.unplaced.length > 0 && (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] p-4">
              <p className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {index.unplaced.length} paid {index.unplaced.length === 1 ? "child is" : "children are"} not on any roll
              </p>
              <p className="text-xs text-amber-200/60 mt-1">
                They have paid, so somebody needs to ask which class they are in. They are listed here rather than
                put on every class — that would invent an attendance expectation for a real child.
              </p>
              <ul className="mt-3 space-y-1.5">
                {index.unplaced.map((u) => (
                  <li key={u.id} className="text-xs text-white/70">
                    <span className="font-medium text-white/90">{u.name}</span>
                    <span className="text-white/40"> · {u.programName} · {u.optionLabel} — {u.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionView({ classId, date, onBack }: { classId: string; date: string; onBack: () => void }) {
  const key = `/api/admin/cugc/roll/${classId}/${date}`;
  const { data, isLoading } = useQuery<SessionRoll>({ queryKey: [key] });

  const mark = useMutation({
    mutationFn: ({ registrationId, status }: { registrationId: number; status: string | null }) =>
      apiRequest("POST", key, { registrationId, status }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
  });

  const marked = data?.children.filter((c) => c.status).length ?? 0;
  const present = data?.children.filter((c) => c.status === "present").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <button onClick={onBack} className="text-sm text-white/50 hover:text-white/90 inline-flex items-center gap-1.5">
        <ChevronLeft className="w-4 h-4" /> All classes
      </button>

      <div>
        <h1 className="text-2xl font-semibold text-white/90">{data?.class.label ?? "Roll"}</h1>
        <p className="text-sm text-white/40 mt-1 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" />{niceDate(date)}</span>
          {data && <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{data.term.name}</span>}
          {data && (
            <span>
              {/* Deliberately "x of y marked", not a percentage present. An
                  unmarked roll must read as unfinished, not as 0% attendance. */}
              {marked} of {data.children.length} marked
              {marked > 0 && <span className="text-emerald-300/70"> · {present} here</span>}
            </span>
          )}
        </p>
      </div>

      {isLoading ? (
        <div className="text-white/40 text-sm py-16 text-center">Loading the roll…</div>
      ) : !data || data.children.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-10 h-10 text-white/20 mb-3" />
          <p className="text-white/60 font-medium">Nobody is on this roll</p>
          <p className="text-white/35 text-sm mt-1">Only paid enrolments for this term appear here.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06]">
          {data.children.map((c) => (
            <div key={c.registrationId} className="flex items-center justify-between gap-4 p-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white/90 truncate">{c.name}</p>
                <p className="text-xs text-white/40 truncate">
                  {c.parentName}
                  {c.phone && (
                    <> · <a href={`tel:${c.phone}`} className="hover:text-blue-300 inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" />{c.phone}
                    </a></>
                  )}
                </p>
                {/* A medical note belongs where the coach is standing, not two
                    screens away in a detail modal. */}
                {c.medical && (
                  <p className="text-xs text-amber-200/90 mt-1 inline-flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />{c.medical}
                  </p>
                )}
                {c.status && c.markedBy && (
                  <p className="text-[11px] text-white/25 mt-1">Marked by {c.markedBy}</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(["present", "absent"] as const).map((s) => {
                  const on = c.status === s;
                  const tone = s === "present"
                    ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-100"
                    : "bg-rose-500/20 border-rose-400/50 text-rose-100";
                  return (
                    <button
                      key={s}
                      disabled={mark.isPending}
                      // Tapping the state it already has CLEARS it. A mis-tap
                      // must be undoable back to "not marked" — not merely
                      // flipped to the opposite claim about a child.
                      onClick={() => mark.mutate({ registrationId: c.registrationId, status: on ? null : s })}
                      data-testid={`mark-${s}-${c.registrationId}`}
                      aria-pressed={on}
                      className={`min-h-[44px] min-w-[96px] px-4 rounded-xl border text-sm font-medium transition-colors inline-flex items-center justify-center gap-1.5 ${
                        on ? tone : "bg-white/[0.04] border-white/10 text-white/50 hover:text-white/90"
                      }`}
                    >
                      {s === "present" ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                      {s === "present" ? "Here" : "Away"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
