// Task Board — Daniel + Isaac's MFL project board (2026-09-25).
//
// "me and isaac's project management dashboard … start fresh and redesign the
// whole ui/ux and fundamentals of it." Deliberately NOT the System Task Tracker
// (tt_*): own tables (tb_*), own routes (server/task-board-routes.ts), own page.
//
// Fundamentals, kept small on purpose so the two people using it can shape it:
//   · a task has ONE owner (or nobody yet), a status, an optional due date and project
//   · three ways to look at the same tasks: List (by project) · Board (by status) · People
//   · a task that came out of a meeting keeps the recording and what was said
//   · overdue is derived from the due date, never stored
// Rules (statuses, priorities, colours) live in shared/task-board.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { SelectInput } from "@/components/ui/select-input";
import {
  Plus, Search, List, KanbanSquare, Users, Check, Flag, CalendarDays, ChevronDown, ChevronRight,
  Mic, ExternalLink, Archive, Loader2, FolderPlus, X,
} from "lucide-react";
import { TB_STATUSES, TB_COLORS, tbIsOverdue, type TbStatus } from "@shared/task-board";

type Task = {
  id: number; projectId: number | null; title: string; notes: string | null; status: TbStatus;
  priority: "high" | "normal"; ownerUserId: number | null; dueOn: string | null; position: number;
  sourceLabel: string | null; sourceUrl: string | null; sourceQuote: string | null;
  createdAt: string; completedAt: string | null;
};
type Project = { id: number; name: string; color: string; position: number };
type Person = { id: number; name: string; firstName: string; avatarUrl: string | null };
type Board = { projects: Project[]; tasks: Task[]; people: Person[]; terms?: { name: string; start: string; end: string }[]; today: string; me: number };

const KEY = ["/api/admin/task-board"];
type View = "list" | "board" | "people" | "calendar";

const DOT: Record<string, string> = {
  gold: "bg-amber-400", blue: "bg-blue-500", green: "bg-emerald-500",
  violet: "bg-violet-500", rose: "bg-rose-500", slate: "bg-slate-400",
};
const STATUS_PILL: Record<TbStatus, string> = {
  todo: "bg-white/[0.06] text-white/60",
  doing: "bg-blue-500/15 text-blue-400",
  waiting: "bg-amber-500/15 text-amber-400",
  done: "bg-emerald-500/15 text-emerald-400",
};

function shortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]}`;
}
function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
const initials = (p?: Person) => (p ? p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() : "");

function Avatar({ person, size = 22 }: { person?: Person; size?: number }) {
  if (!person) {
    return <span className="inline-flex items-center justify-center rounded-full border border-dashed border-white/20 text-white/30 shrink-0" style={{ width: size, height: size, fontSize: size * 0.42 }} title="Nobody yet">?</span>;
  }
  return person.avatarUrl
    ? <img src={person.avatarUrl} alt={person.name} title={person.name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
    : <span className="inline-flex items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-semibold shrink-0" style={{ width: size, height: size, fontSize: size * 0.4 }} title={person.name}>{initials(person)}</span>;
}

export default function TaskBoard() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<Board>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await workspaceFetch("/api/admin/task-board");
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || "Could not load the board");
      return r.json();
    },
  });

  // View + filters live in the URL hash so Back and a shared link keep them.
  const readHash = () => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return { view: (["list", "board", "people", "calendar"].includes(p.get("view") || "") ? p.get("view") : "list") as View, who: p.get("who") || "all" };
  };
  const [view, setView] = useState<View>(() => readHash().view);
  const [who, setWho] = useState<string>(() => readHash().who);
  useEffect(() => {
    const p = new URLSearchParams(); p.set("view", view); if (who !== "all") p.set("who", who);
    history.replaceState(null, "", `#${p.toString()}`);
  }, [view, who]);

  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const save = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Task> }) => (await apiRequest("PATCH", `/api/admin/task-board/tasks/${id}`, patch)).json(),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const prev = queryClient.getQueryData<Board>(KEY);
      if (prev) queryClient.setQueryData<Board>(KEY, { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } as Task : t)) });
      return { prev };
    },
    onError: (e: any, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(KEY, ctx.prev); toast({ title: "Not saved", description: e.message, variant: "destructive" }); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const create = useMutation({
    mutationFn: async (body: Partial<Task>) => (await apiRequest("POST", "/api/admin/task-board/tasks", body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast({ title: "Not added", description: e.message, variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/task-board/tasks/${id}`),
    onSuccess: () => { setOpenId(null); queryClient.invalidateQueries({ queryKey: KEY }); toast({ title: "Task removed" }); },
  });
  const createProject = useMutation({
    mutationFn: async (body: { name: string; color: string }) => (await apiRequest("POST", "/api/admin/task-board/projects", body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast({ title: "Not added", description: e.message, variant: "destructive" }),
  });

  const people = data?.people ?? [];
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const projectById = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p])), [data?.projects]);
  const today = data?.today ?? new Date().toISOString().slice(0, 10);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.tasks ?? []).filter((t) => {
      if (who === "me" && t.ownerUserId !== data?.me) return false;
      if (who === "none" && t.ownerUserId != null) return false;
      if (/^\d+$/.test(who) && t.ownerUserId !== Number(who)) return false;
      if (needle && !`${t.title} ${t.notes ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, who, q]);
  const open = visible.filter((t) => t.status !== "done");
  const done = visible.filter((t) => t.status === "done").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const weekEnd = addDays(today, 7);
  const stats = {
    open: open.length,
    overdue: open.filter((t) => tbIsOverdue(t, today)).length,
    week: open.filter((t) => t.dueOn && t.dueOn >= today && t.dueOn <= weekEnd).length,
    doneWeek: done.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= addDays(today, -7)).length,
  };
  const current = data?.tasks.find((t) => t.id === openId) ?? null;

  if (isLoading) return <div className="py-24 text-center text-sm text-white/40"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading the board…</div>;
  if (error || !data) return <div className="p-8"><div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-300">{(error as Error)?.message || "Could not load the board"}</div></div>;

  const toggleDone = (t: Task) => save.mutate({ id: t.id, patch: { status: t.status === "done" ? "todo" : "done" } });

  const renderRow = (t: Task) => {
    const overdue = tbIsOverdue(t, today);
    const proj = t.projectId ? projectById.get(t.projectId) : undefined;
    return (
      <div key={t.id} className="group flex items-start gap-3 px-3 sm:px-4 py-3 hover:bg-white/[0.03] cursor-pointer border-b border-white/[0.05] last:border-b-0"
        onClick={() => setOpenId(t.id)} data-testid={`tb-task-${t.id}`}>
        <button type="button" aria-label={t.status === "done" ? "Mark not done" : "Mark done"}
          onClick={(e) => { e.stopPropagation(); toggleDone(t); }}
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${t.status === "done" ? "bg-emerald-500 border-emerald-500 text-white" : "border-white/25 hover:border-emerald-400 text-transparent hover:text-emerald-400"}`}>
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-[14px] leading-snug ${t.status === "done" ? "line-through text-white/35" : "text-white/90"}`}>
            {t.priority === "high" && t.status !== "done" && <Flag className="inline w-3.5 h-3.5 -mt-0.5 mr-1 text-rose-400" fill="currentColor" />}
            {t.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-white/40">
            {t.status !== "todo" && t.status !== "done" && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[t.status]}`}>{TB_STATUSES.find((s) => s.key === t.status)?.label}</span>}
            {t.dueOn && <span className={`inline-flex items-center gap-1 ${overdue ? "text-rose-400 font-medium" : ""}`}><CalendarDays className="w-3 h-3" />{overdue ? "Overdue · " : ""}{shortDate(t.dueOn)}</span>}
            {view !== "list" && proj && <span className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${DOT[proj.color] || DOT.slate}`} />{proj.name}</span>}
            {t.sourceUrl && <span className="inline-flex items-center gap-1" title={t.sourceLabel || "From a meeting"}><Mic className="w-3 h-3" />{t.sourceLabel?.replace(/^MFL meeting · /, "") || "Meeting"}</span>}
          </div>
        </div>
        <Avatar person={t.ownerUserId ? personById.get(t.ownerUserId) : undefined} />
      </div>
    );
  };

  const renderSection = ({ id, title, dot, tasks, onAdd }: { id: string; title: string; dot?: string; tasks: Task[]; onAdd?: (title: string) => void }) => {
    const isCollapsed = !!collapsed[id];
    return (
      <div key={id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden" data-testid={`tb-section-${id}`}>
        <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
          className="w-full flex items-center gap-2 px-3 sm:px-4 py-2.5 text-left hover:bg-white/[0.03]">
          {isCollapsed ? <ChevronRight className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
          {dot && <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />}
          <span className="text-sm font-semibold text-white/90">{title}</span>
          <span className="text-xs text-white/40 ml-1">{tasks.length}</span>
        </button>
        {!isCollapsed && (
          <div className="border-t border-white/[0.06]">
            {tasks.length ? tasks.map((t) => renderRow(t)) : <p className="px-4 py-3 text-[13px] text-white/30">Nothing open here.</p>}
            {onAdd && <InlineAdd onAdd={onAdd} />}
          </div>
        )}
      </div>
    );
  };

  const defaultOwner = who === "me" ? data.me : /^\d+$/.test(who) ? Number(who) : null;

  return (
    <div className="p-4 sm:p-8 max-w-[1400px] mx-auto space-y-5" data-testid="task-board">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Task Tracker</h1>
          <p className="text-sm text-white/50 mt-0.5">Mini Football Leagues · what's on, who has it, what's next</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1" role="tablist">
          {([["list", "List", List], ["board", "Board", KanbanSquare], ["calendar", "Calendar", CalendarDays], ["people", "People", Users]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-sm font-medium transition-colors ${view === k ? "bg-blue-600 text-white" : "text-white/60 hover:text-white/90"}`}
              data-testid={`tb-view-${k}`}>
              <Icon className="w-4 h-4" /><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* The numbers that matter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Open", stats.open, ""], ["Overdue", stats.overdue, stats.overdue ? "text-rose-400" : ""],
          ["Due this week", stats.week, ""], ["Done last 7 days", stats.doneWeek, stats.doneWeek ? "text-emerald-400" : ""],
        ].map(([label, n, cls]) => (
          <div key={label as string} className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-white/40">{label}</p>
            <p className={`text-2xl font-semibold mt-0.5 ${cls || "text-white"}`}>{n as number}</p>
          </div>
        ))}
      </div>

      {/* Quick add */}
      <QuickAdd people={people} projects={data.projects} defaultOwner={defaultOwner}
        onAdd={(body) => create.mutate(body)} busy={create.isPending} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[["all", "Everyone"], ["me", "Me"], ...people.filter((p) => p.id !== data.me).map((p) => [String(p.id), p.firstName]), ["none", "Nobody yet"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setWho(k)}
              className={`h-9 rounded-full px-3.5 text-[13px] font-medium border transition-colors ${who === k ? "bg-blue-600 border-blue-600 text-white" : "border-white/10 text-white/60 hover:text-white/90"}`}
              data-testid={`tb-who-${k}`}>{label}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/50" />
        </div>
      </div>

      {/* LIST — by project */}
      {view === "list" && (
        <div className="space-y-3">
          {data.projects.map((p) => (
            renderSection({ id: `p${p.id}`, title: p.name, dot: DOT[p.color] || DOT.slate,
              tasks: open.filter((t) => t.projectId === p.id),
              onAdd: (title) => create.mutate({ title, projectId: p.id, ownerUserId: defaultOwner }) })
          ))}
          {(open.some((t) => !t.projectId) || !data.projects.length) && (
            renderSection({ id: "none", title: "No project", tasks: open.filter((t) => !t.projectId),
              onAdd: (title) => create.mutate({ title, ownerUserId: defaultOwner }) })
          )}
          <NewProject onCreate={(name, color) => createProject.mutate({ name, color })} />
        </div>
      )}

      {/* BOARD — by status */}
      {view === "board" && (
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-2">
          <div className="grid grid-flow-col auto-cols-[85%] sm:auto-cols-[46%] lg:grid-flow-row lg:grid-cols-4 gap-3 min-w-0">
            {TB_STATUSES.map((s) => {
              const col = (s.key === "done" ? done.slice(0, 20) : open.filter((t) => t.status === s.key));
              return (
                <div key={s.key} className="rounded-xl border border-white/[0.08] bg-white/[0.02] flex flex-col min-h-[200px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { const id = Number(e.dataTransfer.getData("text/plain")); if (id) save.mutate({ id, patch: { status: s.key } }); }}
                  data-testid={`tb-col-${s.key}`}>
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_PILL[s.key]}`}>{s.label}</span>
                    <span className="text-xs text-white/40">{s.key === "done" ? done.length : col.length}</span>
                  </div>
                  <div className="p-2 space-y-2 flex-1">
                    {col.map((t) => {
                      const proj = t.projectId ? projectById.get(t.projectId) : undefined;
                      const overdue = tbIsOverdue(t, today);
                      return (
                        <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(t.id))}
                          onClick={() => setOpenId(t.id)}
                          className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 cursor-pointer hover:border-blue-500/40">
                          {proj && <p className="text-[11px] text-white/40 mb-1 inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${DOT[proj.color] || DOT.slate}`} />{proj.name}</p>}
                          <p className={`text-[13.5px] leading-snug ${t.status === "done" ? "line-through text-white/35" : "text-white/90"}`}>
                            {t.priority === "high" && t.status !== "done" && <Flag className="inline w-3 h-3 -mt-0.5 mr-1 text-rose-400" fill="currentColor" />}{t.title}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className={`text-[11.5px] ${overdue ? "text-rose-400 font-medium" : "text-white/40"}`}>{t.dueOn ? `${overdue ? "Overdue · " : ""}${shortDate(t.dueOn)}` : ""}</span>
                            <Avatar person={t.ownerUserId ? personById.get(t.ownerUserId) : undefined} size={20} />
                          </div>
                        </div>
                      );
                    })}
                    {!col.length && <p className="text-[12px] text-white/25 italic py-4 text-center">Drop a task here</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CALENDAR — tasks on their due dates */}
      {view === "calendar" && (
        <CalendarView tasks={visible} terms={data.terms ?? []} today={today} projectById={projectById} personById={personById}
          renderRow={renderRow} onOpen={setOpenId} onSetDue={(id, dueOn) => save.mutate({ id, patch: { dueOn } })} />
      )}

      {/* PEOPLE — who has what */}
      {view === "people" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...people.map((p) => ({ id: String(p.id), person: p as Person | undefined, name: p.name })), { id: "none", person: undefined, name: "Nobody yet" }].map((col) => {
            const mine = open.filter((t) => (col.person ? t.ownerUserId === col.person.id : t.ownerUserId == null))
              .sort((a, b) => (a.dueOn || "9999").localeCompare(b.dueOn || "9999"));
            return (
              <div key={col.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden" data-testid={`tb-person-${col.id}`}>
                <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06]">
                  <Avatar person={col.person} size={28} />
                  <span className="text-sm font-semibold text-white/90">{col.name}</span>
                  <span className="text-xs text-white/40 ml-auto">{mine.length} open{mine.filter((t) => tbIsOverdue(t, today)).length ? ` · ${mine.filter((t) => tbIsOverdue(t, today)).length} overdue` : ""}</span>
                </div>
                {mine.length ? mine.map((t) => renderRow(t)) : <p className="px-4 py-4 text-[13px] text-white/30">Nothing open.</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Done — out of the way, one tap to see */}
      {(view === "list" || view === "people") && done.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDone((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] text-white/50 hover:text-white/80 h-9" data-testid="tb-show-done">
            {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Done ({done.length})
          </button>
          {showDone && <div className="mt-2 rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">{done.map((t) => renderRow(t))}</div>}
        </div>
      )}

      {/* Task detail */}
      <Sheet open={!!current} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent className="w-full sm:max-w-lg p-0 overflow-y-auto">
          {current && (
            <TaskDetail key={current.id} task={current} people={people} projects={data.projects}
              onSave={(patch) => save.mutate({ id: current.id, patch })}
              onArchive={() => archive.mutate(current.id)} onClose={() => setOpenId(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
type Term = { name: string; start: string; end: string };
type CalView = "week" | "month" | "term" | "year";
const CAL_VIEWS: { key: CalView; label: string }[] = [
  { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "term", label: "Term" }, { key: "year", label: "Year" },
];
// Dates are y-m-d strings throughout — never a local Date (a NZ date read as UTC slips a day).
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const dow = (iso: string) => { const [y, m, d] = parts(iso); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }; // Mon = 0
const mondayOf = (iso: string) => addDays(iso, -dow(iso));
const monthAdd = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const range = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const longDay = (iso: string) => { const [, m, d] = parts(iso); return `${WEEKDAYS[dow(iso)]} ${d} ${MONTHS_LONG[m - 1]}`; };

function CalendarView({ tasks, terms, today, projectById, personById, renderRow, onOpen, onSetDue }: {
  tasks: Task[]; terms: Term[]; today: string; projectById: Map<number, Project>; personById: Map<number, Person>;
  renderRow: (t: Task) => JSX.Element; onOpen: (id: number) => void; onSetDue: (id: number, dueOn: string | null) => void;
}) {
  const [cv, setCv] = useState<CalView>(() => {
    try { const v = localStorage.getItem("tb_cal_view"); if (v && CAL_VIEWS.some((x) => x.key === v)) return v as CalView; } catch { /* private mode */ }
    return "week";
  });
  useEffect(() => { try { localStorage.setItem("tb_cal_view", cv); } catch { /* ignore */ } }, [cv]);
  const [cursor, setCursor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [overDay, setOverDay] = useState<string | null>(null);

  // Keyboard: W M T Y switch view, ← → step (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el?.isContentEditable || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase(); const map: Record<string, CalView> = { w: "week", m: "month", t: "term", y: "year" };
      if (map[k]) setCv(map[k]);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byDay = useMemo(() => { const m = new Map<string, Task[]>(); for (const t of tasks) if (t.dueOn) m.set(t.dueOn, [...(m.get(t.dueOn) || []), t]); return m; }, [tasks]);
  const undated = tasks.filter((t) => !t.dueOn && t.status !== "done");
  // The term the cursor sits in, else the next one, else the last one.
  const termFor = (d: string) => terms.find((t) => d >= t.start && d <= t.end) || terms.find((t) => t.start > d) || terms[terms.length - 1];
  const term = termFor(cursor);

  const step = (dir: 1 | -1) => {
    if (cv === "week") setCursor(addDays(cursor, 7 * dir));
    else if (cv === "month") setCursor(`${monthAdd(cursor.slice(0, 7), dir)}-01`);
    else if (cv === "year") setCursor(`${Number(cursor.slice(0, 4)) + dir}-01-01`);
    else if (term) { const i = terms.indexOf(term); const next = terms[i + dir]; if (next) setCursor(next.start); }
  };
  const canStep = (dir: 1 | -1) => cv !== "term" || (!!term && !!terms[terms.indexOf(term) + dir]);
  const stepName = cv === "term" ? "term" : cv;

  let title = "";
  if (cv === "week") { const s = mondayOf(cursor), e = addDays(s, 6); const [, sm] = parts(s), [ey, em] = parts(e); title = sm === em ? `${MONTHS_LONG[em - 1]} ${ey}` : `${MONTHS_LONG[sm - 1].slice(0, 3)} – ${MONTHS_LONG[em - 1].slice(0, 3)} ${ey}`; }
  else if (cv === "month") { const [y, m] = parts(`${cursor.slice(0, 7)}-01`); title = `${MONTHS_LONG[m - 1]} ${y}`; }
  else if (cv === "year") title = cursor.slice(0, 4);
  else title = term ? term.name : "No terms yet";

  const drop = (day: string | null) => (e: React.DragEvent) => {
    e.preventDefault(); setOverDay(null);
    const id = Number(e.dataTransfer.getData("text/plain")); if (id) onSetDue(id, day);
  };
  const chip = (t: Task) => {
    const proj = t.projectId ? projectById.get(t.projectId) : undefined;
    const overdue = tbIsOverdue(t, today);
    return (
      <div key={t.id} draggable onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData("text/plain", String(t.id)); }}
        onClick={(e) => { e.stopPropagation(); onOpen(t.id); }} title={t.title}
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] leading-tight border cursor-pointer
          ${t.status === "done" ? "line-through text-white/35 border-transparent bg-white/[0.03]" : overdue ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-white/[0.06] bg-white/[0.05] text-white/85 hover:border-blue-500/40"}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${proj ? DOT[proj.color] || DOT.slate : "bg-white/30"}`} />
        <span className="truncate">{t.title}</span>
      </div>
    );
  };
  const dayCell = (day: string, opts: { dim?: boolean; max: number; tall: string }) => {
    const list = byDay.get(day) || [];
    const isToday = day === today, isSel = day === selected;
    const hasOverdue = list.some((t) => tbIsOverdue(t, today));
    return (
      <div key={day} role="button" tabIndex={0} onClick={() => setSelected(day)} onKeyDown={(e) => { if (e.key === "Enter") setSelected(day); }}
        onDragOver={(e) => { e.preventDefault(); setOverDay(day); }} onDragLeave={() => setOverDay((d) => (d === day ? null : d))} onDrop={drop(day)}
        className={`relative ${opts.tall} border-b border-r border-white/[0.05] p-1 sm:p-1.5 cursor-pointer transition-colors min-w-0
          ${opts.dim ? "bg-white/[0.015]" : ""} ${isSel ? "bg-blue-500/[0.08]" : "hover:bg-white/[0.03]"} ${overDay === day ? "ring-2 ring-inset ring-blue-500" : ""}`}
        data-testid={`tb-day-${day}`}>
        <div className="flex items-center justify-between">
          <span className={`inline-flex h-6 min-w-6 px-1 items-center justify-center rounded-full text-[12px] ${isToday ? "bg-blue-600 text-white font-semibold" : opts.dim ? "text-white/25" : "text-white/80"}`}>{Number(day.slice(8))}</span>
          {list.length > 0 && <span className={`sm:hidden text-[10px] font-semibold ${hasOverdue ? "text-rose-400" : "text-blue-400"}`}>{list.length}</span>}
        </div>
        <div className="hidden sm:block mt-1 space-y-1">
          {list.slice(0, opts.max).map(chip)}
          {list.length > opts.max && <div className="text-[11px] text-white/45 px-1">+{list.length - opts.max} more</div>}
        </div>
      </div>
    );
  };

  let body: JSX.Element;
  if (cv === "week") {
    const days = range(mondayOf(cursor), addDays(mondayOf(cursor), 6));
    body = (
      <>
        {/* Desktop: seven columns */}
        <div className="hidden md:grid grid-cols-7">
          {days.map((d) => (
            <div key={d} className="border-r border-white/[0.05] last:border-r-0 min-w-0">
              <div className={`px-2 py-2 border-b border-white/[0.06] text-center ${d === today ? "text-blue-400" : "text-white/50"}`}>
                <div className="text-[11px] uppercase tracking-wider">{WEEKDAYS[dow(d)]}</div>
                <div className={`mx-auto mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-semibold ${d === today ? "bg-blue-600 text-white" : "text-white/85"}`}>{Number(d.slice(8))}</div>
              </div>
              <div onClick={() => setSelected(d)} onDragOver={(e) => { e.preventDefault(); setOverDay(d); }} onDragLeave={() => setOverDay((x) => (x === d ? null : x))} onDrop={drop(d)}
                className={`min-h-[360px] p-1.5 space-y-1.5 cursor-pointer ${d === selected ? "bg-blue-500/[0.06]" : ""} ${overDay === d ? "ring-2 ring-inset ring-blue-500" : ""}`} data-testid={`tb-day-${d}`}>
                {(byDay.get(d) || []).map((t) => (
                  <div key={t.id} draggable onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData("text/plain", String(t.id)); }}
                    onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
                    className={`rounded-lg border p-2 text-[12.5px] leading-snug cursor-pointer ${t.status === "done" ? "line-through text-white/35 border-transparent bg-white/[0.03]" : tbIsOverdue(t, today) ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-white/[0.04] text-white/85 hover:border-blue-500/40"}`}>
                    <div className="flex items-start gap-1.5">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${t.projectId && projectById.get(t.projectId) ? DOT[projectById.get(t.projectId)!.color] || DOT.slate : "bg-white/30"}`} />
                      <span className="min-w-0 break-words">{t.title}</span>
                    </div>
                    <div className="mt-1.5 flex justify-end"><Avatar person={t.ownerUserId ? personById.get(t.ownerUserId) : undefined} size={18} /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Phone/tablet: one day under another */}
        <div className="md:hidden divide-y divide-white/[0.06]">
          {days.map((d) => {
            const list = byDay.get(d) || [];
            return (
              <div key={d} data-testid={`tb-day-${d}`}>
                <div className={`px-4 py-2 text-[12px] font-semibold ${d === today ? "text-blue-400" : "text-white/55"}`}>{longDay(d)}{d === today ? " · Today" : ""}</div>
                {list.length ? list.map((t) => renderRow(t)) : <p className="px-4 pb-3 text-[12.5px] text-white/25">Nothing due</p>}
              </div>
            );
          })}
        </div>
      </>
    );
  } else if (cv === "month") {
    const ym = cursor.slice(0, 7), first = `${ym}-01`;
    const last = addDays(`${monthAdd(ym, 1)}-01`, -1);
    const days = range(mondayOf(first), addDays(mondayOf(last), 6));
    body = (
      <>
        <div className="grid grid-cols-7 border-b border-white/[0.06]">
          {WEEKDAYS.map((d) => <div key={d} className="py-2 text-center text-[11px] uppercase tracking-wider text-white/40">{d.slice(0, 1)}<span className="hidden sm:inline">{d.slice(1)}</span></div>)}
        </div>
        <div className="grid grid-cols-7">{days.map((d) => dayCell(d, { dim: d.slice(0, 7) !== ym, max: 3, tall: "min-h-[52px] sm:min-h-[112px]" }))}</div>
      </>
    );
  } else if (cv === "term") {
    if (!term) body = <p className="px-4 py-10 text-center text-sm text-white/40">No terms set up for this workspace yet.</p>;
    else {
      const weeks: string[][] = [];
      for (let w = mondayOf(term.start); w <= term.end; w = addDays(w, 7)) weeks.push(range(w, addDays(w, 6)));
      body = (
        <>
          <div className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] sm:grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-white/[0.06]">
            <div />
            {WEEKDAYS.map((d) => <div key={d} className="py-2 text-center text-[11px] uppercase tracking-wider text-white/40">{d.slice(0, 1)}<span className="hidden sm:inline">{d.slice(1)}</span></div>)}
          </div>
          {weeks.map((w, i) => (
            <div key={w[0]} className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] sm:grid-cols-[48px_repeat(7,minmax(0,1fr))]">
              <div className="border-b border-r border-white/[0.05] flex items-start justify-center pt-2 text-[10px] sm:text-[11px] font-semibold text-white/40">Wk{i + 1}</div>
              {w.map((d) => dayCell(d, { dim: d < term.start || d > term.end, max: 2, tall: "min-h-[48px] sm:min-h-[84px]" }))}
            </div>
          ))}
        </>
      );
    }
  } else {
    const y = cursor.slice(0, 4);
    body = (
      <div className="grid gap-4 p-3 sm:p-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 12 }, (_, i) => {
          const ym = `${y}-${String(i + 1).padStart(2, "0")}`, first = `${ym}-01`, last = addDays(`${monthAdd(ym, 1)}-01`, -1);
          const days = range(mondayOf(first), addDays(mondayOf(last), 6));
          const count = tasks.filter((t) => t.dueOn?.startsWith(ym) && t.status !== "done").length;
          return (
            <div key={ym} className="rounded-lg border border-white/[0.06] p-2.5" data-testid={`tb-month-${ym}`}>
              <button type="button" onClick={() => { setCursor(first); setCv("month"); }} className="w-full flex items-center justify-between mb-1.5 text-left">
                <span className="text-[13px] font-semibold text-white/85">{MONTHS_LONG[i]}</span>
                {count > 0 && <span className="text-[11px] text-blue-400">{count} open</span>}
              </button>
              <div className="grid grid-cols-7 text-center">
                {WEEKDAYS.map((d) => <span key={d} className="text-[9.5px] text-white/30 py-0.5">{d[0]}</span>)}
                {days.map((d) => {
                  const list = byDay.get(d) || []; const inM = d.slice(0, 7) === ym;
                  const od = list.some((t) => tbIsOverdue(t, today)); const open = list.some((t) => t.status !== "done");
                  return (
                    <button key={d} type="button" disabled={!inM} onClick={() => { setSelected(d); setCursor(d); setCv("week"); }}
                      className={`relative h-7 text-[11px] rounded-full ${!inM ? "invisible" : d === today ? "bg-blue-600 text-white font-semibold" : "text-white/70 hover:bg-white/[0.06]"}`}>
                      {Number(d.slice(8))}
                      {inM && list.length > 0 && <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${od ? "bg-rose-400" : open ? "bg-blue-400" : "bg-white/30"}`} />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const selectedTasks = byDay.get(selected) || [];
  return (
    <div className="space-y-4" data-testid="tb-calendar">
      {/* Toolbar — Google's chrome: Today, ‹ ›, title, the view slider */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <button type="button" onClick={() => { setCursor(today); setSelected(today); }}
          className="h-10 rounded-full border border-white/15 px-5 text-[12px] font-bold uppercase tracking-wide text-white/80 hover:border-blue-500 hover:text-blue-400">Today</button>
        <div className="flex items-center gap-1">
          {([-1, 1] as const).map((dir) => (
            <button key={dir} type="button" onClick={() => step(dir)} disabled={!canStep(dir)} aria-label={`${dir < 0 ? "Previous" : "Next"} ${stepName}`}
              className="grid h-10 w-10 place-items-center rounded-full text-white/60 hover:bg-white/[0.06] hover:text-white disabled:opacity-25">
              <ChevronRight className={`w-5 h-5 ${dir < 0 ? "rotate-180" : ""}`} />
            </button>
          ))}
        </div>
        <h2 className="min-w-0 flex-1 basis-[10rem] text-lg sm:text-xl font-semibold text-white" data-testid="tb-cal-title">
          {title}
          {cv === "term" && term && <span className="ml-2 text-[12px] font-medium text-white/40">{shortDate(term.start)} – {shortDate(term.end)}</span>}
        </h2>
        <div role="tablist" aria-label="Calendar view" className="flex w-full sm:w-auto rounded-full border border-white/10 bg-white/[0.03] p-1">
          {CAL_VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={cv === v.key} onClick={() => setCv(v.key)} title={`${v.label} (${v.label[0]})`}
              className={`h-9 flex-1 sm:flex-none rounded-full px-4 text-[12px] font-bold uppercase tracking-wide transition ${cv === v.key ? "bg-blue-600 text-white" : "text-white/55 hover:text-white"}`}
              data-testid={`tb-cal-${v.key}`}>{v.label}</button>
          ))}
        </div>
      </div>

      <div className={`grid gap-4 grid-cols-[minmax(0,1fr)] ${cv === "year" ? "" : "lg:grid-cols-[minmax(0,1fr)_280px]"}`}>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden min-w-0">{body}</div>
        {cv !== "year" && (
          <div className="space-y-4 min-w-0">
            {cv !== "week" && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden" data-testid="tb-calendar-day">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="text-sm font-semibold text-white/90">{longDay(selected)}</span>
                  <span className="text-xs text-white/40">{selectedTasks.length} task{selectedTasks.length === 1 ? "" : "s"}</span>
                </div>
                {selectedTasks.length ? selectedTasks.map((t) => renderRow(t)) : <p className="px-4 py-4 text-[13px] text-white/30">Nothing due this day.</p>}
              </div>
            )}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden" onDragOver={(e) => e.preventDefault()} onDrop={drop(null)} data-testid="tb-undated">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <span className="text-sm font-semibold text-white/90">No due date</span>
                <span className="text-xs text-white/40">{undated.length}</span>
              </div>
              <p className="hidden md:block px-4 pt-2 text-[11.5px] text-white/35">Drag one onto a day to give it a date.</p>
              <div className="p-2 space-y-1.5 max-h-[420px] overflow-y-auto">
                {undated.map((t) => {
                  const proj = t.projectId ? projectById.get(t.projectId) : undefined;
                  return (
                    <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(t.id))} onClick={() => onOpen(t.id)}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-[13px] text-white/85 cursor-pointer hover:border-blue-500/40">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${proj ? DOT[proj.color] || DOT.slate : "bg-white/30"}`} />
                      <span className="flex-1 min-w-0 truncate">{t.title}</span>
                      <Avatar person={t.ownerUserId ? personById.get(t.ownerUserId) : undefined} size={18} />
                    </div>
                  );
                })}
                {!undated.length && <p className="px-2 py-3 text-[12px] text-white/30">Every open task has a date.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAdd({ people, projects, defaultOwner, onAdd, busy }: {
  people: Person[]; projects: Project[]; defaultOwner: number | null; busy: boolean;
  onAdd: (b: Partial<Task>) => void;
}) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<string>(defaultOwner ? String(defaultOwner) : "");
  const [project, setProject] = useState<string>("");
  useEffect(() => { setOwner(defaultOwner ? String(defaultOwner) : ""); }, [defaultOwner]);
  const submit = () => {
    const t = title.trim(); if (!t) return;
    onAdd({ title: t, ownerUserId: owner ? Number(owner) : null, projectId: project ? Number(project) : null });
    setTitle("");
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex flex-col sm:flex-row gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2" data-testid="tb-quick-add">
      <div className="relative flex-1">
        <Plus className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task — press Enter"
          className="w-full h-10 pl-9 pr-3 rounded-lg bg-transparent text-sm text-white placeholder:text-white/35 outline-none" data-testid="tb-quick-title" />
      </div>
      <div className="flex gap-2">
        <SelectInput value={owner} onChange={(e) => setOwner(e.target.value)} className="h-10 min-w-[120px]" aria-label="Owner">
          <option value="">Nobody yet</option>
          {people.map((p) => <option key={p.id} value={String(p.id)}>{p.firstName}</option>)}
        </SelectInput>
        <SelectInput value={project} onChange={(e) => setProject(e.target.value)} className="h-10 min-w-[140px]" aria-label="Project">
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </SelectInput>
        <button type="submit" disabled={!title.trim() || busy}
          className="h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40 shrink-0">Add</button>
      </div>
    </form>
  );
}

function InlineAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }} className="flex items-center gap-2 px-3 sm:px-4 py-2 border-t border-white/[0.05]">
      <Plus className="w-4 h-4 text-white/30 shrink-0" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add to this project"
        className="flex-1 h-8 bg-transparent text-[13px] text-white placeholder:text-white/30 outline-none" />
    </form>
  );
}

function NewProject({ onCreate }: { onCreate: (name: string, color: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("blue");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 h-10 px-3 text-[13px] text-white/50 hover:text-white/80" data-testid="tb-new-project">
        <FolderPlus className="w-4 h-4" /> New project
      </button>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCreate(name.trim(), color); setName(""); setOpen(false); } }}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name"
        className="flex-1 min-w-[160px] h-10 px-3 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-white outline-none" />
      <div className="flex gap-1.5">
        {TB_COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} aria-label={c}
            className={`w-7 h-7 rounded-full ${DOT[c]} ${color === c ? "ring-2 ring-offset-2 ring-blue-500" : ""}`} />
        ))}
      </div>
      <button type="submit" className="h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold">Create</button>
      <button type="button" onClick={() => setOpen(false)} className="h-10 w-10 inline-flex items-center justify-center text-white/40"><X className="w-4 h-4" /></button>
    </form>
  );
}

function TaskDetail({ task, people, projects, onSave, onArchive, onClose }: {
  task: Task; people: Person[]; projects: Project[];
  onSave: (p: Partial<Task>) => void; onArchive: () => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`;
  }, [title]);
  const label = "text-[11px] uppercase tracking-wider text-white/40 mb-1.5 block";
  return (
    <div className="flex flex-col min-h-full" data-testid="tb-detail">
      <div className="p-5 sm:p-6 space-y-5 flex-1">
        <textarea ref={titleRef} value={title} rows={1} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { const t = title.trim(); if (t && t !== task.title) onSave({ title: t }); else setTitle(task.title); }}
          className="w-full resize-none bg-transparent text-xl font-semibold text-white outline-none leading-snug pr-8" data-testid="tb-detail-title" />

        <div>
          <span className={label}>Status</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {TB_STATUSES.map((s) => (
              <button key={s.key} type="button" onClick={() => onSave({ status: s.key })}
                className={`h-10 rounded-lg text-[13px] font-medium border transition-colors ${task.status === s.key ? `${STATUS_PILL[s.key]} border-transparent` : "border-white/10 text-white/50 hover:text-white/80"}`}
                data-testid={`tb-status-${s.key}`}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>Who</span>
            <SelectInput value={task.ownerUserId ? String(task.ownerUserId) : ""} onChange={(e) => onSave({ ownerUserId: e.target.value ? Number(e.target.value) : null })} className="h-10 w-full" aria-label="Owner">
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </SelectInput>
          </div>
          <div>
            <span className={label}>Due</span>
            <DatePickerInput value={task.dueOn ?? ""} onChange={(e: any) => onSave({ dueOn: (typeof e === "string" ? e : e?.target?.value) || null })} placeholder="No date" />
          </div>
          <div>
            <span className={label}>Project</span>
            <SelectInput value={task.projectId ? String(task.projectId) : ""} onChange={(e) => onSave({ projectId: e.target.value ? Number(e.target.value) : null })} className="h-10 w-full" aria-label="Project">
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </SelectInput>
          </div>
          <div>
            <span className={label}>Priority</span>
            <button type="button" onClick={() => onSave({ priority: task.priority === "high" ? "normal" : "high" })}
              className={`h-10 w-full rounded-lg border text-[13px] font-medium inline-flex items-center justify-center gap-1.5 ${task.priority === "high" ? "border-rose-500/40 bg-rose-500/10 text-rose-400" : "border-white/10 text-white/50"}`}>
              <Flag className="w-3.5 h-3.5" fill={task.priority === "high" ? "currentColor" : "none"} /> {task.priority === "high" ? "High" : "Normal"}
            </button>
          </div>
        </div>

        <div>
          <span className={label}>Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if ((task.notes ?? "") !== notes) onSave({ notes }); }}
            rows={5} placeholder="Anything worth knowing — links, who to call, what done looks like"
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500/50" />
        </div>

        {(task.sourceUrl || task.sourceQuote) && (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3.5" data-testid="tb-source">
            <p className="text-[12px] font-semibold text-white/70 inline-flex items-center gap-1.5"><Mic className="w-3.5 h-3.5" />{task.sourceLabel || "From a meeting"}</p>
            {task.sourceQuote && <p className="mt-1.5 text-[13px] text-white/55 italic leading-relaxed">“{task.sourceQuote}”</p>}
            {task.sourceUrl && (
              <a href={task.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-blue-400 hover:underline">
                Open the recording <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-5 sm:px-6 py-3">
        <button type="button" onClick={onArchive} className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-[13px] text-white/50 hover:text-rose-400">
          <Archive className="w-4 h-4" /> Remove
        </button>
        <button type="button" onClick={onClose} className="h-10 px-5 rounded-lg bg-blue-600 text-white text-sm font-semibold">Done</button>
      </div>
    </div>
  );
}
