import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, X, User, Calendar as CalendarIcon, Flag, Check, Inbox, LayoutGrid, Layers, AlertCircle, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";

// Brand vocabulary — the slugs of every org so brand_tags filter chips read
// naturally. Stays in sync with organizations.slug values.
const BRANDS: { slug: string; label: string; color: string }[] = [
  { slug: "cufc",       label: "CUFC",         color: "#3b82f6" },
  { slug: "siu",        label: "SIU",          color: "#8b5cf6" },
  { slug: "mfl",        label: "MFL",          color: "#06b6d4" },
  { slug: "cic",        label: "CIC",          color: "#a855f7" },
  { slug: "usc",        label: "USC",          color: "#22c55e" },
  { slug: "gymnastics", label: "Gymnastics",   color: "#ec4899" },
  { slug: "usg",        label: "USG",          color: "#64748b" },
  { slug: "print",      label: "Print",        color: "#f59e0b" },
  { slug: "sponsorship",label: "Sponsorship",  color: "#ef4444" },
];

const PRIORITY_COLORS: Record<string, string> = {
  low:    "#64748b",
  medium: "#3b82f6",
  high:   "#f59e0b",
  urgent: "#ef4444",
};

interface ProjectGroup {
  id: number;
  boardId: number;
  name: string;
  color: string;
  isDone: boolean;
  displayOrder: number;
}
interface ProjectBoard {
  id: number;
  organizationId: number;
  name: string;
  description: string | null;
  brandTags: string[];
  color: string;
  archived: boolean;
  groups: ProjectGroup[];
}
interface ProjectTask {
  id: number;
  organizationId: number;
  boardId: number;
  groupId: number | null;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  ownerId: number | null;
  dueDate: string | null;
  brandTags: string[];
  displayOrder: number;
  completedAt: string | null;
}
interface TeamMember {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export default function GroupProjectsPage() {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const orgId = currentOrg?.id;

  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null);
  const [view, setView] = useState<"board" | "mine" | "calendar">("board");
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [taskModal, setTaskModal] = useState<{ mode: "create" | "edit"; task?: ProjectTask; defaultGroupId?: number } | null>(null);
  const [boardModal, setBoardModal] = useState<{ mode: "create" | "edit"; board?: ProjectBoard } | null>(null);

  const { data: me } = useQuery<{ id: number }>({ queryKey: ["/api/auth/me"] });

  const { data: boards = [], isLoading: boardsLoading } = useQuery<ProjectBoard[]>({
    queryKey: ["/api/admin/projects/boards", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/projects/boards?organizationId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load boards");
      return r.json();
    },
    enabled: !!orgId,
  });

  // Auto-select first board on load
  const board = useMemo(() => {
    if (selectedBoardId) return boards.find(b => b.id === selectedBoardId) || null;
    return boards[0] || null;
  }, [boards, selectedBoardId]);

  const { data: tasks = [] } = useQuery<ProjectTask[]>({
    queryKey: ["/api/admin/projects/tasks", { boardId: board?.id, orgId, brand: brandFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("organizationId", String(orgId));
      if (board) params.set("boardId", String(board.id));
      if (brandFilter) params.set("brand", brandFilter);
      const r = await fetch(`/api/admin/projects/tasks?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load tasks");
      return r.json();
    },
    enabled: !!orgId && !!board && view === "board",
  });

  const { data: myTasks = [] } = useQuery<ProjectTask[]>({
    queryKey: ["/api/admin/projects/tasks/mine"],
    queryFn: async () => {
      const r = await fetch("/api/admin/projects/tasks/mine", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: view === "mine" || view === "calendar",
  });

  // Calendar view fetches every task across every board (org-scoped) plus the
  // org-wide events from /api/admin/calendar-events so the customer sees the
  // full alignment picture: their work + the team's work + scheduled events.
  const { data: allTasks = [] } = useQuery<ProjectTask[]>({
    queryKey: ["/api/admin/projects/tasks", { all: true, orgId, brand: brandFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("organizationId", String(orgId));
      if (brandFilter) params.set("brand", brandFilter);
      const r = await fetch(`/api/admin/projects/tasks?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId && view === "calendar",
  });

  const { rangeStart, rangeEnd } = useMemo(() => {
    const start = new Date(calendarMonth.year, calendarMonth.month, 1);
    start.setDate(1 - ((start.getDay() + 6) % 7)); // back to Monday
    const end = new Date(start);
    end.setDate(end.getDate() + 42);
    return { rangeStart: start, rangeEnd: end };
  }, [calendarMonth]);

  const { data: orgEvents = [] } = useQuery<Array<{ id: number; title: string; date: string; categorySlug: string | null; allDay: boolean }>>({
    queryKey: ["/api/admin/calendar-events", rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: async () => {
      const r = await fetch(`/api/admin/calendar-events?startDate=${rangeStart.toISOString()}&endDate=${rangeEnd.toISOString()}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: view === "calendar",
  });

  const { data: eventCategories = [] } = useQuery<Array<{ slug: string; label: string; color: string }>>({
    queryKey: ["/api/admin/calendar-categories", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/calendar-categories?organizationId=${orgId}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!orgId && view === "calendar",
  });

  const { data: team = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/admin/projects/team", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/projects/team?organizationId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load team");
      return r.json();
    },
    enabled: !!orgId,
  });

  const saveBoard = useMutation({
    mutationFn: async ({ id, payload }: { id?: number; payload: any }) => {
      if (id) {
        const r = await apiRequest("PATCH", `/api/admin/projects/boards/${id}`, payload);
        return r.json();
      }
      const r = await apiRequest("POST", "/api/admin/projects/boards", { ...payload, organizationId: orgId });
      return r.json();
    },
    onSuccess: (board: ProjectBoard, vars) => {
      // Refetch so the new/edited board shows up immediately, and auto-select
      // it so the customer sees their new board open straight away.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/boards"] });
      queryClient.refetchQueries({ queryKey: ["/api/admin/projects/boards", orgId] });
      if (!vars.id && board?.id) {
        setSelectedBoardId(board.id);
        setView("board");
      }
      setBoardModal(null);
      toast({ title: vars.id ? "Board updated" : "Board created" });
    },
    onError: (e: any) => toast({ title: "Couldn't save board", description: e.message, variant: "destructive" }),
  });

  const deleteBoard = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/projects/boards/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/boards"] });
      queryClient.refetchQueries({ queryKey: ["/api/admin/projects/boards", orgId] });
      setSelectedBoardId(null);
      setBoardModal(null);
      toast({ title: "Board deleted" });
    },
  });

  const createTask = useMutation({
    mutationFn: async (payload: any) => {
      const r = await apiRequest("POST", "/api/admin/projects/tasks", payload);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/tasks/mine"] });
      setTaskModal(null);
      toast({ title: "Task created" });
    },
    onError: (e: any) => toast({ title: "Couldn't create task", description: e.message, variant: "destructive" }),
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: any }) => {
      const r = await apiRequest("PATCH", `/api/admin/projects/tasks/${id}`, patch);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/tasks/mine"] });
      setTaskModal(null);
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/projects/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/projects/tasks/mine"] });
      setTaskModal(null);
      toast({ title: "Task deleted" });
    },
  });

  // ── Render ────────────────────────────────────────────────────────────────
  if (!orgId) return null;
  return (
    <div className="flex h-full">
      {/* Sidebar — boards list */}
      <aside className="w-60 border-r border-white/[0.06] flex flex-col">
        <div className="px-4 py-4 border-b border-white/[0.06]">
          <h1 className="text-base font-semibold">Projects</h1>
          <p className="text-[11px] text-white/40 mt-0.5">Boards across {currentOrg?.name}</p>
        </div>

        {/* My Tasks + Calendar pinned at top */}
        <button
          onClick={() => setView("mine")}
          data-testid="button-view-mine"
          className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition-colors border-l-2 ${
            view === "mine" ? "bg-blue-500/[0.08] text-blue-300 border-blue-500" : "text-white/70 hover:bg-white/[0.03] border-transparent"
          }`}
        >
          <span className="flex items-center gap-2">
            <Inbox className="w-4 h-4" />
            My Tasks
          </span>
          {myTasks.length > 0 && view !== "mine" && (
            <span className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded">{myTasks.length}</span>
          )}
        </button>
        <button
          onClick={() => setView("calendar")}
          data-testid="button-view-calendar"
          className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-l-2 ${
            view === "calendar" ? "bg-blue-500/[0.08] text-blue-300 border-blue-500" : "text-white/70 hover:bg-white/[0.03] border-transparent"
          }`}
        >
          <CalendarIcon className="w-4 h-4" />
          Calendar
        </button>

        <div className="px-4 pt-4 pb-1.5 text-[10px] uppercase tracking-wider text-white/30 font-semibold flex items-center justify-between">
          <span>Boards</span>
          <button
            onClick={() => setBoardModal({ mode: "create" })}
            data-testid="button-create-board"
            className="w-5 h-5 rounded hover:bg-white/[0.06] flex items-center justify-center text-white/40 hover:text-white transition"
            title="New board"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {boardsLoading ? (
            <div className="px-4 py-2 space-y-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          ) : boards.length === 0 ? (
            <button
              onClick={() => setBoardModal({ mode: "create" })}
              data-testid="button-empty-create-board"
              className="mx-3 mt-2 w-[calc(100%-1.5rem)] rounded-lg border border-dashed border-white/10 px-3 py-3 text-[11px] text-white/40 hover:text-white hover:border-white/20 transition"
            >
              + Create your first board
            </button>
          ) : boards.map(b => {
            const active = view === "board" && board?.id === b.id;
            return (
              <div
                key={b.id}
                className={`group relative flex items-center gap-2 transition-colors border-l-2 ${
                  active ? "bg-white/[0.04] border-blue-500" : "hover:bg-white/[0.02] border-transparent"
                }`}
              >
                <button
                  onClick={() => { setView("board"); setSelectedBoardId(b.id); }}
                  data-testid={`button-board-${b.id}`}
                  className={`flex-1 flex items-center gap-2 pl-4 pr-2 py-2 text-sm text-left ${active ? "text-white" : "text-white/60"}`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: b.color || "#3b82f6" }} />
                  <span className="truncate">{b.name}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setBoardModal({ mode: "edit", board: b }); }}
                  data-testid={`button-edit-board-${b.id}`}
                  className="opacity-0 group-hover:opacity-100 mr-2 w-6 h-6 rounded text-white/30 hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition"
                  title="Edit board"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — title, view toggle, brand filter, new task */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">
              {view === "mine" ? "My Tasks" : board?.name || "Select a board"}
            </h2>
            {view === "board" && board?.description && (
              <p className="text-xs text-white/40 truncate">{board.description}</p>
            )}
            {view === "mine" && (
              <p className="text-xs text-white/40">{myTasks.length} task{myTasks.length === 1 ? "" : "s"} assigned to you</p>
            )}
          </div>

          {view === "board" && (
            <>
              {/* Brand filter chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {brandFilter && (
                  <button
                    onClick={() => setBrandFilter(null)}
                    data-testid="button-clear-brand-filter"
                    className="text-[10px] px-2 py-1 rounded-md border border-white/10 text-white/50 hover:text-white hover:border-white/20"
                  >
                    Clear filter
                  </button>
                )}
                {BRANDS.map(b => {
                  const active = brandFilter === b.slug;
                  return (
                    <button
                      key={b.slug}
                      onClick={() => setBrandFilter(active ? null : b.slug)}
                      data-testid={`chip-brand-${b.slug}`}
                      className="text-[10px] font-semibold px-2 py-1 rounded-md border transition"
                      style={{
                        borderColor: active ? b.color : "rgba(255,255,255,0.1)",
                        background: active ? `${b.color}25` : "transparent",
                        color: active ? "white" : "rgba(255,255,255,0.5)",
                      }}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>

              {board && (
                <Button
                  size="sm"
                  onClick={() => setTaskModal({ mode: "create", defaultGroupId: board.groups[0]?.id })}
                  data-testid="button-new-task"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-1" /> New task
                </Button>
              )}
            </>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {view === "mine" ? (
            <MyTasksView tasks={myTasks} boards={boards} team={team} onEdit={t => setTaskModal({ mode: "edit", task: t })} />
          ) : view === "calendar" ? (
            <CalendarView
              year={calendarMonth.year}
              month={calendarMonth.month}
              setMonth={setCalendarMonth}
              tasks={allTasks}
              myTaskIds={new Set(myTasks.map(t => t.id))}
              boards={boards}
              team={team}
              orgEvents={orgEvents}
              eventCategories={eventCategories}
              onEditTask={(t) => setTaskModal({ mode: "edit", task: t })}
              currentUserId={me?.id}
            />
          ) : board ? (
            <KanbanView
              board={board}
              tasks={tasks}
              team={team}
              onCreate={(groupId) => setTaskModal({ mode: "create", defaultGroupId: groupId })}
              onEdit={(t) => setTaskModal({ mode: "edit", task: t })}
              onMoveToGroup={(taskId, groupId) => updateTask.mutate({ id: taskId, patch: { groupId } })}
              currentUserId={me?.id}
            />
          ) : (
            <div className="p-12 text-center text-white/40 text-sm">
              Create a board to get started.
            </div>
          )}
        </div>
      </div>

      {boardModal && (
        <BoardModal
          mode={boardModal.mode}
          board={boardModal.board}
          onClose={() => setBoardModal(null)}
          onSave={(payload) => saveBoard.mutate({ id: boardModal.board?.id, payload })}
          onDelete={boardModal.board ? () => deleteBoard.mutate(boardModal.board!.id) : undefined}
          saving={saveBoard.isPending}
        />
      )}
      {taskModal && board && (
        <TaskModal
          mode={taskModal.mode}
          task={taskModal.task}
          board={board}
          allBoards={boards}
          team={team}
          defaultGroupId={taskModal.defaultGroupId}
          orgId={orgId}
          onClose={() => setTaskModal(null)}
          onSubmit={(payload) => {
            if (taskModal.mode === "create") createTask.mutate(payload);
            else if (taskModal.task) updateTask.mutate({ id: taskModal.task.id, patch: payload });
          }}
          onDelete={taskModal.task ? () => deleteTask.mutate(taskModal.task!.id) : undefined}
        />
      )}
    </div>
  );
}

// ── Kanban view ──────────────────────────────────────────────────────────────
function KanbanView({
  board, tasks, team, onCreate, onEdit, onMoveToGroup, currentUserId,
}: {
  board: ProjectBoard;
  tasks: ProjectTask[];
  team: TeamMember[];
  onCreate: (groupId: number) => void;
  onEdit: (task: ProjectTask) => void;
  onMoveToGroup: (taskId: number, groupId: number) => void;
  currentUserId?: number;
}) {
  const tasksByGroup = useMemo(() => {
    const m = new Map<number | null, ProjectTask[]>();
    for (const t of tasks) {
      const arr = m.get(t.groupId) || [];
      arr.push(t);
      m.set(t.groupId, arr);
    }
    return m;
  }, [tasks]);

  return (
    <div className="flex gap-3 p-4 h-full min-w-max">
      {board.groups.map(g => {
        const items = tasksByGroup.get(g.id) || [];
        return (
          <div key={g.id} className="w-72 flex-shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                <span className="text-sm font-semibold">{g.name}</span>
                <span className="text-[10px] text-white/30">{items.length}</span>
              </div>
              <button
                onClick={() => onCreate(g.id)}
                data-testid={`button-add-task-${g.id}`}
                className="w-6 h-6 rounded text-white/30 hover:text-white hover:bg-white/[0.06] flex items-center justify-center"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
              {items.length === 0 ? (
                <button
                  onClick={() => onCreate(g.id)}
                  className="w-full text-[11px] text-white/30 hover:text-white/50 italic py-3 rounded border border-dashed border-white/10"
                >
                  + Add a task
                </button>
              ) : items.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  team={team}
                  groupIsDone={g.isDone}
                  onClick={() => onEdit(t)}
                  highlightOwner={currentUserId === t.ownerId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Task card (used in both kanban and my tasks) ─────────────────────────────
function TaskCard({ task, team, groupIsDone, onClick, highlightOwner }: {
  task: ProjectTask;
  team: TeamMember[];
  groupIsDone?: boolean;
  onClick: () => void;
  highlightOwner?: boolean;
}) {
  const owner = team.find(m => m.id === task.ownerId);
  const dueDate = task.dueDate ? new Date(task.dueDate + "T00:00:00") : null;
  const today = new Date(); today.setHours(0,0,0,0);
  const overdue = dueDate && !groupIsDone && dueDate < today;
  const dueSoon = dueDate && !overdue && !groupIsDone && (dueDate.getTime() - today.getTime()) < 1000*60*60*24*3;

  return (
    <button
      onClick={onClick}
      data-testid={`card-task-${task.id}`}
      className={`w-full text-left rounded-lg p-2.5 border transition-all hover:border-white/15 ${
        groupIsDone ? "opacity-60" : ""
      } ${highlightOwner ? "ring-1 ring-blue-500/30" : ""}`}
      style={{
        borderColor: highlightOwner ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.06)",
        background: highlightOwner ? "rgba(59,130,246,0.05)" : "rgba(255,255,255,0.02)",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className={`text-xs font-medium leading-snug ${groupIsDone ? "line-through text-white/40" : "text-white"}`}>
          {task.title}
        </div>
        {task.priority !== "medium" && (
          <Flag className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: PRIORITY_COLORS[task.priority] }} />
        )}
      </div>
      {task.brandTags && task.brandTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {task.brandTags.slice(0, 3).map(slug => {
            const b = BRANDS.find(x => x.slug === slug);
            return (
              <span key={slug} className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{
                background: `${(b?.color || "#64748b")}20`,
                color: b?.color || "#64748b",
              }}>{b?.label || slug}</span>
            );
          })}
          {task.brandTags.length > 3 && <span className="text-[9px] text-white/30">+{task.brandTags.length - 3}</span>}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-white/40">
          {owner ? (
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-white/[0.08] flex items-center justify-center text-[8px] font-semibold text-white/70">
                {owner.first_name[0]}{owner.last_name[0]}
              </span>
              <span>{owner.first_name}</span>
            </span>
          ) : <span className="italic">Unassigned</span>}
        </div>
        {dueDate && (
          <span className={`text-[10px] flex items-center gap-1 ${overdue ? "text-red-400" : dueSoon ? "text-amber-300" : "text-white/40"}`}>
            <CalendarIcon className="w-2.5 h-2.5" />
            {dueDate.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
    </button>
  );
}

// ── My Tasks view (grouped by due bucket) ────────────────────────────────────
function MyTasksView({ tasks, boards, team, onEdit }: {
  tasks: ProjectTask[];
  boards: ProjectBoard[];
  team: TeamMember[];
  onEdit: (t: ProjectTask) => void;
}) {
  const today = new Date(); today.setHours(0,0,0,0);
  const buckets = useMemo(() => {
    const overdue: ProjectTask[] = [];
    const todayList: ProjectTask[] = [];
    const thisWeek: ProjectTask[] = [];
    const later: ProjectTask[] = [];
    const noDate: ProjectTask[] = [];
    for (const t of tasks) {
      if (!t.dueDate) { noDate.push(t); continue; }
      const d = new Date(t.dueDate + "T00:00:00");
      const dt = d.getTime() - today.getTime();
      if (dt < 0) overdue.push(t);
      else if (dt < 1000*60*60*24) todayList.push(t);
      else if (dt < 1000*60*60*24*7) thisWeek.push(t);
      else later.push(t);
    }
    return { overdue, today: todayList, thisWeek, later, noDate };
  }, [tasks]);

  const sections = [
    { label: "Overdue", icon: AlertCircle, items: buckets.overdue, color: "text-red-400" },
    { label: "Today",   icon: CalendarIcon, items: buckets.today, color: "text-blue-300" },
    { label: "This week", icon: CalendarIcon, items: buckets.thisWeek, color: "text-white/70" },
    { label: "Later",   icon: Layers, items: buckets.later, color: "text-white/40" },
    { label: "No due date", icon: Inbox, items: buckets.noDate, color: "text-white/30" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {tasks.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-12 text-center text-white/40 text-sm">
          No tasks assigned to you. Open any board and assign yourself a task to see it here.
        </div>
      )}
      {sections.filter(s => s.items.length > 0).map(s => {
        const Icon = s.icon;
        return (
          <div key={s.label}>
            <div className={`flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wider ${s.color}`}>
              <Icon className="w-3.5 h-3.5" />
              {s.label}
              <span className="text-white/30 normal-case font-normal">· {s.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {s.items.map(t => {
                const board = boards.find(b => b.id === t.boardId);
                const group = board?.groups.find(g => g.id === t.groupId);
                return (
                  <button
                    key={t.id}
                    onClick={() => onEdit(t)}
                    data-testid={`my-task-${t.id}`}
                    className="w-full text-left rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15 p-3 flex items-center gap-3 transition-colors"
                  >
                    {t.priority !== "medium" && (
                      <Flag className="w-3.5 h-3.5 flex-shrink-0" style={{ color: PRIORITY_COLORS[t.priority] }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${group?.isDone ? "line-through text-white/40" : "text-white"}`}>{t.title}</div>
                      <div className="text-[11px] text-white/40 mt-0.5 flex items-center gap-2">
                        {board && <span>{board.name}</span>}
                        {group && <span className="text-white/25">·</span>}
                        {group && <span style={{ color: group.color }}>{group.name}</span>}
                        {t.brandTags.length > 0 && (
                          <>
                            <span className="text-white/25">·</span>
                            <span className="flex gap-1">
                              {t.brandTags.slice(0, 3).map(slug => {
                                const b = BRANDS.find(x => x.slug === slug);
                                return <span key={slug} className="text-[9px] font-semibold px-1 py-0.5 rounded" style={{ background: `${b?.color || "#64748b"}20`, color: b?.color || "#64748b" }}>{b?.label || slug}</span>;
                              })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {t.dueDate && (
                      <span className={`text-xs flex items-center gap-1 ${s.label === "Overdue" ? "text-red-400" : "text-white/50"}`}>
                        <CalendarIcon className="w-3 h-3" />
                        {new Date(t.dueDate + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}
                      </span>
                    )}
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

// ── Task modal (create/edit) ─────────────────────────────────────────────────
function TaskModal({
  mode, task, board, allBoards, team, defaultGroupId, orgId, onClose, onSubmit, onDelete,
}: {
  mode: "create" | "edit";
  task?: ProjectTask;
  board: ProjectBoard;
  allBoards: ProjectBoard[];
  team: TeamMember[];
  defaultGroupId?: number;
  orgId: number;
  onClose: () => void;
  onSubmit: (payload: any) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<ProjectTask["priority"]>(task?.priority || "medium");
  const [groupId, setGroupId] = useState<number | null>(task?.groupId ?? defaultGroupId ?? null);
  const [boardId, setBoardId] = useState<number>(task?.boardId ?? board.id);
  const [ownerId, setOwnerId] = useState<number | null>(task?.ownerId ?? null);
  const [dueDate, setDueDate] = useState(task?.dueDate || "");
  const [brandTags, setBrandTags] = useState<string[]>(task?.brandTags || []);

  const activeBoard = allBoards.find(b => b.id === boardId) || board;

  const submit = () => {
    if (!title.trim()) return;
    const payload: any = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      groupId,
      ownerId,
      dueDate: dueDate || null,
      brandTags,
    };
    if (mode === "create") {
      payload.organizationId = orgId;
      payload.boardId = boardId;
    } else if (boardId !== task?.boardId) {
      payload.boardId = boardId;
    }
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-[#0a0e1a] border border-white/10 rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-base font-semibold">{mode === "create" ? "New task" : "Edit task"}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <Label className="text-xs text-white/60 mb-1 block">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus className="bg-white/[0.04] border-white/10 text-white" data-testid="input-task-title" />
          </div>
          <div>
            <Label className="text-xs text-white/60 mb-1 block">Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Add detail, links, acceptance criteria…" className="bg-white/[0.04] border-white/10 text-white min-h-[80px]" data-testid="input-task-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Board</Label>
              <select value={boardId} onChange={e => { setBoardId(parseInt(e.target.value)); setGroupId(null); }} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm">
                {allBoards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Status</Label>
              <select value={groupId ?? ""} onChange={e => setGroupId(e.target.value ? parseInt(e.target.value) : null)} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm">
                <option value="">—</option>
                {activeBoard.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Priority</Label>
              <select value={priority} onChange={e => setPriority(e.target.value as any)} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm">
                {["low","medium","high","urgent"].map(p => <option key={p} value={p}>{p[0].toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Owner</Label>
              <select value={ownerId ?? ""} onChange={e => setOwnerId(e.target.value ? parseInt(e.target.value) : null)} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm">
                <option value="">Unassigned</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Due date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="bg-white/[0.04] border-white/10 text-white h-9" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-white/60 mb-1.5 block">Brand tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {BRANDS.map(b => {
                const active = brandTags.includes(b.slug);
                return (
                  <button
                    key={b.slug}
                    type="button"
                    onClick={() => setBrandTags(prev => active ? prev.filter(x => x !== b.slug) : [...prev, b.slug])}
                    className="text-[11px] font-semibold px-2 py-1 rounded-md border transition"
                    style={{
                      borderColor: active ? b.color : "rgba(255,255,255,0.1)",
                      background: active ? `${b.color}25` : "transparent",
                      color: active ? "white" : "rgba(255,255,255,0.6)",
                    }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
          <div>
            {onDelete && (
              <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-white/50">Cancel</Button>
            <Button size="sm" onClick={submit} disabled={!title.trim()} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-task">
              <Check className="w-3.5 h-3.5 mr-1" /> {mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Calendar view — month grid showing tasks (mine vs others) + org events ──
// The headline alignment view: "how do my deadlines line up with what
// everyone else is doing across the brands". Personal tasks render solid
// and prominent; org-wide tasks render as muted bars; calendar events
// render in their category colour.
function CalendarView({
  year, month, setMonth, tasks, myTaskIds, boards, team, orgEvents, eventCategories, onEditTask, currentUserId,
}: {
  year: number;
  month: number;
  setMonth: (m: { year: number; month: number }) => void;
  tasks: ProjectTask[];
  myTaskIds: Set<number>;
  boards: ProjectBoard[];
  team: TeamMember[];
  orgEvents: Array<{ id: number; title: string; date: string; categorySlug: string | null; allDay: boolean }>;
  eventCategories: Array<{ slug: string; label: string; color: string }>;
  onEditTask: (t: ProjectTask) => void;
  currentUserId?: number;
}) {
  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-NZ", { month: "long", year: "numeric" });
  const todayStr = new Date().toISOString().slice(0, 10);

  // Build a 6×7 grid starting on Monday containing the requested month
  const cells: Date[] = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - startOffset);
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [year, month]);

  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const tasksByDate = useMemo(() => {
    const m = new Map<string, ProjectTask[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const arr = m.get(t.dueDate) || [];
      arr.push(t);
      m.set(t.dueDate, arr);
    }
    return m;
  }, [tasks]);
  const eventsByDate = useMemo(() => {
    const m = new Map<string, typeof orgEvents>();
    for (const e of orgEvents) {
      const day = e.date?.slice(0, 10);
      if (!day) continue;
      const arr = m.get(day) || [];
      arr.push(e);
      m.set(day, arr);
    }
    return m;
  }, [orgEvents]);
  const catColor = (slug: string | null) => slug ? (eventCategories.find(c => c.slug === slug)?.color || "#64748b") : "#64748b";

  return (
    <div className="p-4 space-y-3">
      {/* Header — month nav + legend */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 })}
            data-testid="button-cal-prev"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition"
          ><ChevronLeft className="w-4 h-4" /></button>
          <div className="text-base font-semibold w-44 text-center">{monthLabel}</div>
          <button
            onClick={() => setMonth(month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 })}
            data-testid="button-cal-next"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition"
          ><ChevronRight className="w-4 h-4" /></button>
          <button
            onClick={() => { const d = new Date(); setMonth({ year: d.getFullYear(), month: d.getMonth() }); }}
            data-testid="button-cal-today"
            className="ml-2 text-[11px] px-2.5 py-1 rounded-md border border-white/10 text-white/60 hover:text-white hover:border-white/20"
          >Today</button>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-white/40">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: "#3b82f6" }} />Your tasks</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-white/20" />Team tasks</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: "#22c55e" }} />Org events</span>
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
          <div key={d} className="text-[10px] uppercase tracking-wider text-white/30 font-semibold text-center pb-1">{d}</div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map(d => {
          const dStr = ymd(d);
          const inMonth = d.getMonth() === month;
          const isToday = dStr === todayStr;
          const dayTasks = tasksByDate.get(dStr) || [];
          const dayEvents = eventsByDate.get(dStr) || [];
          // Personal tasks first so they jump out
          const sortedTasks = [...dayTasks].sort((a, b) =>
            (myTaskIds.has(b.id) ? 1 : 0) - (myTaskIds.has(a.id) ? 1 : 0)
          );
          const totalItems = sortedTasks.length + dayEvents.length;
          const visibleTasks = sortedTasks.slice(0, 3);
          const visibleEvents = dayEvents.slice(0, Math.max(0, 4 - visibleTasks.length));
          const hidden = totalItems - visibleTasks.length - visibleEvents.length;

          return (
            <div
              key={dStr}
              className={`min-h-[110px] rounded-lg border p-1.5 transition-colors ${
                isToday ? "border-blue-500/40 bg-blue-500/[0.06]" : "border-white/[0.06] bg-white/[0.02]"
              } ${inMonth ? "" : "opacity-40"}`}
              data-testid={`cal-day-${dStr}`}
            >
              <div className={`text-[11px] font-semibold mb-1 ${isToday ? "text-blue-300" : "text-white/60"}`}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {visibleTasks.map(t => {
                  const mine = myTaskIds.has(t.id);
                  const owner = team.find(m => m.id === t.ownerId);
                  const board = boards.find(b => b.id === t.boardId);
                  return (
                    <button
                      key={`t${t.id}`}
                      onClick={() => onEditTask(t)}
                      data-testid={`cal-task-${t.id}`}
                      className={`w-full text-left rounded px-1.5 py-0.5 text-[10px] truncate transition border ${
                        mine
                          ? "border-blue-500/50 text-white font-semibold"
                          : "border-transparent text-white/55"
                      }`}
                      style={{
                        background: mine ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.04)",
                      }}
                      title={`${t.title} · ${owner ? owner.first_name + " " + owner.last_name : "unassigned"} · ${board?.name || ""}`}
                    >
                      {t.title}
                    </button>
                  );
                })}
                {visibleEvents.map(e => {
                  const color = catColor(e.categorySlug);
                  return (
                    <div
                      key={`e${e.id}`}
                      className="w-full text-left rounded px-1.5 py-0.5 text-[10px] truncate border"
                      style={{
                        borderColor: `${color}55`,
                        background: `${color}15`,
                        color,
                      }}
                      title={e.title}
                    >
                      {e.title}
                    </div>
                  );
                })}
                {hidden > 0 && (
                  <div className="text-[9px] text-white/30 px-1">+{hidden} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer summary — what's coming up for me this month */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/50">
        {(() => {
          const monthMineCount = tasks.filter(t =>
            t.dueDate &&
            myTaskIds.has(t.id) &&
            new Date(t.dueDate + "T00:00:00").getMonth() === month &&
            new Date(t.dueDate + "T00:00:00").getFullYear() === year
          ).length;
          const monthTeamCount = tasks.filter(t =>
            t.dueDate &&
            !myTaskIds.has(t.id) &&
            new Date(t.dueDate + "T00:00:00").getMonth() === month &&
            new Date(t.dueDate + "T00:00:00").getFullYear() === year
          ).length;
          return (
            <>
              <span className="text-blue-300 font-semibold">{monthMineCount}</span> task{monthMineCount === 1 ? "" : "s"} on you
              {" · "}
              <span className="text-white/70 font-semibold">{monthTeamCount}</span> across the team
              {" · "}
              <span className="text-green-300/70 font-semibold">{orgEvents.length}</span> org event{orgEvents.length === 1 ? "" : "s"} this view
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── Board create/edit modal ──────────────────────────────────────────────────
function BoardModal({
  mode, board, onClose, onSave, onDelete, saving,
}: {
  mode: "create" | "edit";
  board?: ProjectBoard;
  onClose: () => void;
  onSave: (payload: any) => void;
  onDelete?: () => void;
  saving?: boolean;
}) {
  const [name, setName] = useState(board?.name || "");
  const [description, setDescription] = useState(board?.description || "");
  const [color, setColor] = useState(board?.color || "#3b82f6");
  const [brandTags, setBrandTags] = useState<string[]>(board?.brandTags || []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const PRESET_COLORS = [
    "#3b82f6", "#06b6d4", "#22c55e", "#84cc16", "#eab308",
    "#f97316", "#ef4444", "#ec4899", "#a855f7", "#8b5cf6",
    "#64748b", "#14b8a6",
  ];

  const submit = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      color,
      brandTags,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#0a0e1a] border border-white/10 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-2 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: color }} />
            <h2 className="text-base font-semibold">{mode === "create" ? "New board" : "Edit board"}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] flex items-center justify-center" data-testid="button-close-board-modal">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <Label className="text-xs text-white/60 mb-1 block">Board name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && name.trim()) submit(); }}
              placeholder="e.g. CIC July Tournament Ops"
              autoFocus
              className="bg-white/[0.04] border-white/10 text-white"
              data-testid="input-board-name"
            />
          </div>

          <div>
            <Label className="text-xs text-white/60 mb-1 block">Description <span className="text-white/30">(optional)</span></Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What's this board for?"
              className="bg-white/[0.04] border-white/10 text-white min-h-[60px]"
              data-testid="input-board-description"
            />
          </div>

          <div>
            <Label className="text-xs text-white/60 mb-1.5 block">Colour</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => {
                const active = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    data-testid={`board-color-${c}`}
                    className={`w-7 h-7 rounded-lg transition-all ${active ? "ring-2 ring-white/80 scale-110" : "hover:scale-105"}`}
                    style={{ background: c }}
                    title={c}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/60 mb-1.5 block">Default brand tags <span className="text-white/30">(optional)</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {BRANDS.map(b => {
                const active = brandTags.includes(b.slug);
                return (
                  <button
                    key={b.slug}
                    type="button"
                    onClick={() => setBrandTags(prev => active ? prev.filter(x => x !== b.slug) : [...prev, b.slug])}
                    data-testid={`board-brand-${b.slug}`}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-md border transition"
                    style={{
                      borderColor: active ? b.color : "rgba(255,255,255,0.1)",
                      background: active ? `${b.color}25` : "transparent",
                      color: active ? "white" : "rgba(255,255,255,0.6)",
                    }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-white/30 mt-1.5">Pre-populates new tasks created in this board.</p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
          <div>
            {onDelete && (
              <>
                {confirmDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-white/60">Delete and all its tasks?</span>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="text-white/50 h-7 text-xs px-2">Cancel</Button>
                    <Button size="sm" onClick={onDelete} className="bg-red-600 hover:bg-red-700 text-white h-7 text-xs px-2" data-testid="button-confirm-delete-board">
                      <Trash2 className="w-3 h-3 mr-1" /> Delete
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10" data-testid="button-delete-board">
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                  </Button>
                )}
              </>
            )}
          </div>
          {!confirmDelete && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} className="text-white/50">Cancel</Button>
              <Button size="sm" onClick={submit} disabled={!name.trim() || saving} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-board">
                <Check className="w-3.5 h-3.5 mr-1" /> {mode === "create" ? "Create board" : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
