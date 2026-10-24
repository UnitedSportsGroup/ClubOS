// Mailer → Automations — emails that send themselves.
//
// Daniel, 2026-10-25: "build out the automations page … easy and organised to
// set up and find after it is set up … a single email or a flow of like after
// purchase, after 1 day, after 3 days, 1 week, 30 days, on birthday … if it's
// like an abandoned cart flow … if bought then stop the sequence". First
// testing ground: U4–U8.
//
// Two screens, one file:
//   /admin/mailer/automations       the list, grouped by what starts each one
//   /admin/mailer/automations/:id   one automation as a column of nodes
//
// 🔴 Nodes, but in ONE column (Zapier's shape, not a freeform canvas). Every
// email is timed from the trigger ("3 days after they pay"), so the column is
// simply time running downwards and nobody can draw a knot. The research
// behind this: outputs/deep-research/2026-10-25-email-platform-structure/.
//
// 🔴 Hooks above every early return (a hook after `if (isLoading) return` is
// the white screen of 2026-09-04).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import {
  Plus, Zap, Mail, ShieldCheck, Flag, ChevronLeft, Search, Loader2, Send, Trash2, Pencil,
  CheckCircle2, AlertCircle, Clock, PauseCircle, FlaskConical, Play, Users, Info,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWorkspace } from "@/lib/workspace-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SelectInput } from "@/components/ui/select-input";
import { TimePickerInput } from "@/components/ui/time-picker-input";
import {
  TRIGGERS, TRIGGER_ORDER, GROUP_LABELS, STARTER_FLOWS, AUTOMATION_MERGE_TAGS,
  timingSentence, timingChip, sendTimeApplies, dueAt,
  type TriggerType, type TimingUnit, type AutomationStatus, type EmailKind,
} from "@shared/mailer-automations";

const EmailBuilder = lazy(() => import("@/components/marketing/EmailBuilder"));

const BRAND_BY_SLUG: Record<string, string> = {
  "christchurch-united": "cufc",
  "south-island-united": "siu",
  "mini-football-leagues": "mfl",
  "united-gymnastics": "cugc",
  "united-sports-centre": "usc",
  "christchurch-international-cup": "cic",
  "united-sports-group": "usg",
  "united-prints": "prints",
};

// ── types ─────────────────────────────────────────────────────────────────────

type Step = {
  id?: number;
  /** A client key, so a new email can be selected before it has an id. */
  key: string;
  timingUnit: TimingUnit;
  timingAmount: number;
  timingDirection: "after" | "before";
  sendTime: string | null;
  subject: string;
  preheader: string | null;
  bodyHtml: string;
  bodyDoc: unknown | null;
  enabled: boolean;
};

type Automation = {
  id: number;
  name: string;
  description: string | null;
  trigger: TriggerType;
  programIds: number[] | null;
  stopOnPayment: boolean;
  emailKind: EmailKind;
  status: AutomationStatus;
  testEmails: string[];
  quietHours: boolean;
  fromEmail: string | null;
  replyTo: string | null;
  activatedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
  steps: Omit<Step, "key">[];
  stats: { active: number; entered30d: number; paid30d: number; sent30d: number } | null;
};

type Programme = { id: number; name: string; slug: string; type: string; active: boolean; open: boolean; startDate: string | null };

const STATUS_META: Record<AutomationStatus, { label: string; cls: string; icon: any; blurb: string }> = {
  off: { label: "Off", cls: "border-white/15 bg-white/[0.04] text-white/60", icon: PauseCircle, blurb: "Nothing sends." },
  test: { label: "Test", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: FlaskConical, blurb: "Runs for real families, but every email goes to your test addresses instead." },
  on: { label: "On", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: CheckCircle2, blurb: "Families get the emails." },
};

let keySeq = 0;
const newKey = () => `k${Date.now()}-${keySeq++}`;
const withKeys = (steps: Omit<Step, "key">[]): Step[] => steps.map((s) => ({ ...s, key: `id${s.id ?? newKey()}` }));

function StatusBadge({ status }: { status: AutomationStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.cls}`} data-testid={`status-${status}`}>
      <Icon className="w-3 h-3" />
      {m.label}
    </span>
  );
}

function useProgrammes() {
  return useQuery<{ programmes: Programme[] }>({
    queryKey: ["/api/admin/mailer/automations/programmes"],
  });
}

function programmeNames(ids: number[] | null, programmes: Programme[]): string {
  if (!ids || ids.length === 0) return "Every programme";
  const names = ids.map((id) => programmes.find((p) => p.id === id)?.name).filter(Boolean) as string[];
  if (names.length === 0) return `${ids.length} programme${ids.length === 1 ? "" : "s"}`;
  if (names.length <= 2) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} +${names.length - 2} more`;
}

// ═════════════════════════════════════════════════════════════════════════════
// The list
// ═════════════════════════════════════════════════════════════════════════════

export default function AdminMailerAutomations() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const list = useQuery<{ automations: Automation[] }>({ queryKey: ["/api/admin/mailer/automations"] });
  const progs = useProgrammes();
  const [search, setSearch] = useState("");
  const [programme, setProgramme] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AutomationStatus>("all");
  const [creating, setCreating] = useState(false);

  const programmes = progs.data?.programmes ?? [];
  const autos = list.data?.automations ?? [];
  const counts = useMemo(() => ({
    on: autos.filter((a) => a.status === "on").length,
    test: autos.filter((a) => a.status === "test").length,
    off: autos.filter((a) => a.status === "off").length,
  }), [autos]);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return autos.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (programme !== "all") {
        const pid = Number(programme);
        if (a.programIds && !a.programIds.includes(pid)) return false;
      }
      if (!s) return true;
      const hay = `${a.name} ${TRIGGERS[a.trigger].label} ${programmeNames(a.programIds, programmes)} ${a.steps.map((x) => x.subject).join(" ")}`.toLowerCase();
      return hay.includes(s);
    });
  }, [autos, search, programme, statusFilter, programmes]);

  const groups = useMemo(() => {
    const order = ["unfinished", "purchase", "welcome", "dates"] as const;
    return order
      .map((g) => ({ g, items: shown.filter((a) => TRIGGERS[a.trigger].group === g) }))
      .filter((x) => x.items.length > 0);
  }, [shown]);

  const create = useMutation({
    mutationFn: async (body: { starter: string; programIds: number[] | null }) => {
      const r = await apiRequest("POST", "/api/admin/mailer/automations", body);
      return (await r.json()) as { id: number };
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/mailer/automations"] });
      navigate(`/admin/mailer/automations/${id}`);
    },
    onError: (e: any) => toast({ title: "Couldn't create it", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 min-w-0" data-testid="page-automations">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-white">Automations</h1>
          <p className="text-sm text-white/50 mt-1">
            Emails that send themselves — after someone pays, when a registration is left unfinished, before a programme starts, on a birthday.
          </p>
        </div>
        <Button className="ml-auto bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-9" onClick={() => setCreating(true)} data-testid="button-new-automation">
          <Plus className="w-4 h-4 mr-1.5" /> New automation
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-xl">
        {(["on", "test", "off"] as AutomationStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            className={`rounded-xl border p-3 text-left transition min-h-[44px] ${statusFilter === s ? "border-blue-500/50 bg-blue-500/10" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"}`}
            data-testid={`count-${s}`}
          >
            <div className="text-[10px] uppercase tracking-wider text-white/40">{STATUS_META[s].label}</div>
            <div className="text-xl font-semibold text-white tabular-nums">{counts[s]}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-md">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search automations or subject lines…" className="pl-8 h-11 md:h-9" data-testid="input-search-automations" />
        </div>
        <div className="w-[230px] max-w-full">
          <SelectInput value={programme} onChange={(e) => setProgramme(e.target.value)} data-testid="select-programme-filter">
            <option value="all">All programmes</option>
            {programmes.filter((p) => p.active).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </SelectInput>
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : list.isError ? (
        <div className="text-sm text-red-400 rounded-lg border border-red-500/30 bg-red-500/10 p-3">Couldn't load automations. Refresh to try again.</div>
      ) : autos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 sm:p-8 text-center space-y-3" data-testid="automations-empty">
          <Zap className="w-8 h-8 mx-auto text-blue-400" />
          <div className="text-white font-medium">No automations yet</div>
          <p className="text-sm text-white/50 max-w-md mx-auto">
            Start from a ready-made flow — the emails are already written, you choose the programme and switch it on when you're happy.
          </p>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-9" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Create your first automation
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-white/50">Nothing matches that search.</div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ g, items }) => (
            <section key={g} className="space-y-2" data-testid={`group-${g}`}>
              <h2 className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">{GROUP_LABELS[g]}</h2>
              <div className="space-y-2">
                {items.map((a) => <AutomationRow key={a.id} a={a} programmes={programmes} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      <NewAutomationDialog
        open={creating}
        onOpenChange={setCreating}
        programmes={programmes}
        busy={create.isPending}
        onCreate={(starter, programIds) => create.mutate({ starter, programIds })}
      />
    </div>
  );
}

function AutomationRow({ a, programmes }: { a: Automation; programmes: Programme[] }) {
  const enabled = a.steps.filter((s) => s.enabled);
  return (
    <Link href={`/admin/mailer/automations/${a.id}`} className="block rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition p-3 sm:p-4" data-testid={`automation-row-${a.id}`}>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-blue-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-white break-words">{a.name}</span>
              <StatusBadge status={a.status} />
            </div>
            <div className="text-xs text-white/50 mt-0.5 break-words">
              {TRIGGERS[a.trigger].label} · {programmeNames(a.programIds, programmes)}
              {a.stopOnPayment && a.trigger === "registration_started" ? " · stops when they pay" : ""}
            </div>
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {enabled.map((s, i) => (
                <span key={s.id ?? i} className="inline-flex items-center gap-1 text-[10px] rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-white/60">
                  <Mail className="w-2.5 h-2.5" />{timingChip(s)}
                </span>
              ))}
              <span className="text-[11px] text-white/40 ml-1">{enabled.length} email{enabled.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="text-right text-[11px] text-white/45 shrink-0 ml-auto">
            <div><span className="text-white/80 font-semibold tabular-nums">{a.stats?.sent30d ?? 0}</span> sent · 30 days</div>
            {a.trigger === "registration_started" && (
              <div><span className="text-emerald-300 font-semibold tabular-nums">{a.stats?.paid30d ?? 0}</span> paid after a reminder</div>
            )}
            <div>{a.stats?.active ?? 0} waiting</div>
          </div>
        </div>
    </Link>
  );
}

function NewAutomationDialog({
  open, onOpenChange, programmes, busy, onCreate,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; programmes: Programme[]; busy: boolean;
  onCreate: (starter: string, programIds: number[] | null) => void;
}) {
  const [starter, setStarter] = useState<string>("unfinished_registration");
  const [picked, setPicked] = useState<number[]>([]);
  // U4–U8 is the testing ground (Daniel, 2026-10-25): pre-pick it when it exists.
  useEffect(() => {
    if (!open) return;
    const u48 = programmes.find((p) => p.slug === "u4-u8");
    setPicked(u48 ? [u48.id] : []);
  }, [open, programmes]);
  const flow = STARTER_FLOWS.find((f) => f.key === starter)!;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>New automation</DialogTitle>
        <div className="space-y-5 min-w-0">
          <div>
            <div className="text-xs text-white/50 mb-2">1. What should it do?</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {STARTER_FLOWS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStarter(f.key)}
                  className={`text-left rounded-xl border p-3 transition min-h-[44px] ${starter === f.key ? "border-blue-500/60 bg-blue-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`}
                  data-testid={`starter-${f.key}`}
                >
                  <div className="text-sm font-medium text-white">{f.name}</div>
                  <div className="text-xs text-white/50 mt-0.5">{f.description}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {f.steps.map((s, i) => (
                      <span key={i} className="text-[10px] rounded border border-white/10 px-1.5 py-0.5 text-white/55">{timingChip(s)}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-white/50 mb-2">2. Which programmes?</div>
            <ProgrammePicker programmes={programmes} value={picked} onChange={setPicked} />
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-white/60 flex gap-2">
            <Info className="w-4 h-4 shrink-0 text-blue-400" />
            <span>It starts <strong className="text-white/80">Off</strong>. You can edit every email, try it with <strong className="text-white/80">Run a test family</strong>, then switch it to Test or On. {flow.trigger === "registration_started" ? "It stops by itself the moment the family pays." : ""}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-[44px] md:min-h-9">Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-9"
              disabled={busy}
              onClick={() => onCreate(starter, picked.length ? picked : null)}
              data-testid="button-create-automation"
            >
              {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgrammePicker({ programmes, value, onChange, disabled }: {
  programmes: Programme[]; value: number[]; onChange: (v: number[]) => void; disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [showPast, setShowPast] = useState(false);
  const list = programmes
    .filter((p) => showPast || p.active || value.includes(p.id))
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const all = value.length === 0;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2 space-y-2" data-testid="programme-picker">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button" disabled={disabled}
          onClick={() => onChange([])}
          className={`text-xs rounded-full border px-3 min-h-[36px] ${all ? "border-blue-500/60 bg-blue-500/10 text-blue-300" : "border-white/10 text-white/60"}`}
        >
          Every programme
        </button>
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-white/40" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a programme" className="pl-7 h-9" />
        </div>
      </div>
      <div className="max-h-52 overflow-y-auto space-y-0.5">
        {list.map((p) => {
          const on = value.includes(p.id);
          return (
            <label key={p.id} className={`flex items-center gap-2 rounded-lg px-2 min-h-[40px] text-sm cursor-pointer ${on ? "bg-blue-500/10 text-white" : "text-white/70 hover:bg-white/[0.04]"}`}>
              <input
                type="checkbox" className="w-4 h-4 accent-blue-600" disabled={disabled} checked={on}
                onChange={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
                data-testid={`programme-${p.slug}`}
              />
              <span className="min-w-0 flex-1 break-words">{p.name}</span>
              {!p.active && <span className="text-[10px] text-white/35">past</span>}
            </label>
          );
        })}
        {list.length === 0 && <div className="text-xs text-white/40 p-2">No programmes match.</div>}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-white/45 px-1">
        <input type="checkbox" className="accent-blue-600" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
        Show past programmes
      </label>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// One automation — the node column
// ═════════════════════════════════════════════════════════════════════════════

type Selection = { kind: "trigger" } | { kind: "rules" } | { kind: "step"; key: string };

export function AdminMailerAutomationDetail() {
  const [, params] = useRoute("/admin/mailer/automations/:id");
  const id = Number(params?.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { currentOrg } = useWorkspace();
  const brandKey = BRAND_BY_SLUG[currentOrg?.slug ?? ""] ?? "";

  const q = useQuery<{ automation: Automation }>({ queryKey: [`/api/admin/mailer/automations/${id}`], enabled: !!id });
  const progs = useProgrammes();
  const programmes = progs.data?.programmes ?? [];

  // The tab lives in the URL hash (Back must return to the tab you were on).
  const [tab, setTabState] = useState<"flow" | "activity">(() => (window.location.hash === "#activity" ? "activity" : "flow"));
  const setTab = (t: "flow" | "activity") => {
    setTabState(t);
    history.replaceState(null, "", `${window.location.pathname}${t === "activity" ? "#activity" : ""}`);
  };

  // Local working copy. Settings and emails save together with one button.
  const [draft, setDraft] = useState<Automation | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Selection>({ kind: "trigger" });
  const [editing, setEditing] = useState<string | null>(null); // step key in the full editor
  const [switchTo, setSwitchTo] = useState<AutomationStatus | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const loadedFor = useRef<string>("");

  useEffect(() => {
    const a = q.data?.automation;
    if (!a) return;
    const sig = `${a.id}:${a.updatedAt}:${a.status}`;
    if (loadedFor.current === sig) return;
    loadedFor.current = sig;
    setDraft(a);
    setSteps(withKeys(a.steps));
    setDirty(false);
  }, [q.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await apiRequest("PATCH", `/api/admin/mailer/automations/${id}`, {
        name: draft.name, trigger: draft.trigger, programIds: draft.programIds,
        stopOnPayment: draft.stopOnPayment, emailKind: draft.emailKind, quietHours: draft.quietHours,
        testEmails: draft.testEmails, fromEmail: draft.fromEmail, replyTo: draft.replyTo,
      });
      const r = await apiRequest("PUT", `/api/admin/mailer/automations/${id}/steps`, {
        steps: steps.map(({ key, ...s }) => s),
      });
      return (await r.json()) as { automation: Automation };
    },
    onSuccess: (r) => {
      if (r?.automation) {
        loadedFor.current = "";
        queryClient.setQueryData([`/api/admin/mailer/automations/${id}`], r);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/mailer/automations"] });
      setDirty(false);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: cleanErr(e), variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async (v: { status: AutomationStatus; includeLastDays?: number }) => {
      const r = await apiRequest("POST", `/api/admin/mailer/automations/${id}/status`, v);
      return (await r.json()) as { automation: Automation };
    },
    onSuccess: (r) => {
      loadedFor.current = "";
      queryClient.setQueryData([`/api/admin/mailer/automations/${id}`], r);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/mailer/automations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/mailer/automations/${id}/activity`] });
      setSwitchTo(null);
      toast({ title: r.automation.status === "off" ? "Switched off" : r.automation.status === "test" ? "Test mode is running" : "It's on" });
    },
    onError: (e: any) => toast({ title: "Couldn't switch it", description: cleanErr(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/admin/mailer/automations/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/mailer/automations"] });
      navigate("/admin/mailer/automations");
    },
    onError: (e: any) => toast({ title: "Couldn't delete it", description: cleanErr(e), variant: "destructive" }),
  });

  const patch = (p: Partial<Automation>) => { setDraft((d) => (d ? { ...d, ...p } : d)); setDirty(true); };
  const patchStep = (key: string, p: Partial<Step>) => { setSteps((ss) => ss.map((s) => (s.key === key ? { ...s, ...p } : s))); setDirty(true); };

  // Time order — exactly the order the runner sends them in.
  const ordered = useMemo(() => {
    if (!draft) return steps;
    const anchor = new Date(Date.UTC(2026, 0, 15));
    return [...steps].sort((x, y) => dueAt(anchor, x, draft.trigger, false).getTime() - dueAt(anchor, y, draft.trigger, false).getTime());
  }, [steps, draft?.trigger]);

  const addStep = (after?: Step) => {
    if (!draft) return;
    const base = after ?? ordered[ordered.length - 1];
    const s: Step = {
      key: newKey(),
      timingUnit: base ? (base.timingUnit === "immediately" ? "days" : base.timingUnit) : "immediately",
      timingAmount: base ? (base.timingUnit === "immediately" ? 1 : base.timingAmount + 1) : 0,
      timingDirection: base?.timingDirection ?? "after",
      sendTime: base?.sendTime ?? null,
      subject: "", preheader: null, bodyHtml: "", bodyDoc: null, enabled: true,
    };
    if (base?.timingDirection === "before") s.timingAmount = Math.max(0, base.timingAmount - 1);
    setSteps((ss) => [...ss, s]);
    setSel({ kind: "step", key: s.key });
    setDirty(true);
  };

  if (!id) return null;
  if (q.isLoading || !draft) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        {q.isError ? <div className="text-sm text-red-400">Couldn't load this automation. It may have been deleted.</div> : <><Skeleton className="h-10 w-64" /><Skeleton className="h-96 w-full" /></>}
      </div>
    );
  }

  const trig = TRIGGERS[draft.trigger];
  const selStep = sel.kind === "step" ? steps.find((s) => s.key === sel.key) : undefined;
  const editStep = editing ? steps.find((s) => s.key === editing) : undefined;

  return (
    <div className="p-4 sm:p-6 space-y-4 min-w-0 pb-28 md:pb-6" data-testid="page-automation">
      {/* ── top bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/mailer/automations" className="inline-flex items-center gap-1 text-sm text-white/55 hover:text-white min-h-[44px] md:min-h-0" data-testid="link-back-automations">
          <ChevronLeft className="w-4 h-4" /> Automations
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="text-lg font-semibold h-11 max-w-md"
          aria-label="Automation name"
          data-testid="input-automation-name"
        />
        <StatusSwitch status={draft.status} onPick={(s) => s !== draft.status && setSwitchTo(s)} disabled={setStatus.isPending} />
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <Button variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setSimOpen(true)} data-testid="button-test-family">
            <Play className="w-4 h-4 mr-1.5" /> Run a test family
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-9"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            data-testid="button-save-automation"
          >
            {save.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-white/45 -mt-2">
        {STATUS_META[draft.status].blurb}
        {draft.updatedBy ? ` · Last changed by ${draft.updatedBy}` : ""}
      </p>

      <div className="flex gap-1 border-b border-white/[0.06]">
        {(["flow", "activity"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-3 min-h-[44px] text-sm border-b-2 -mb-px ${tab === t ? "border-blue-500 text-white" : "border-transparent text-white/50 hover:text-white/80"}`}
            data-testid={`tab-${t}`}>
            {t === "flow" ? "Flow" : "Activity"}
          </button>
        ))}
      </div>

      {tab === "activity" ? (
        <ActivityView id={id} steps={ordered} trigger={draft.trigger} />
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
          {/* ── the column of nodes ─────────────────────────────── */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-6 min-w-0 [background-image:radial-gradient(rgba(148,163,184,0.18)_1px,transparent_1px)] [background-size:18px_18px]" data-testid="flow-canvas">
            <div className="max-w-md mx-auto flex flex-col items-stretch">
              <Node
                tone="blue" icon={Zap} eyebrow="Starts when" selected={sel.kind === "trigger"}
                title={trig.label} onClick={() => setSel({ kind: "trigger" })} testId="node-trigger"
              >
                <div className="text-xs text-white/55 break-words">{programmeNames(draft.programIds, programmes)}</div>
              </Node>

              {ordered.map((s, i) => (
                <div key={s.key} className="flex flex-col items-stretch">
                  <Connector label={gapLabel(ordered[i - 1], s)} onAdd={() => addStep(ordered[i - 1] ?? undefined)} />
                  <Node
                    tone={s.enabled ? "white" : "muted"} icon={Mail}
                    eyebrow={timingSentence(s, draft.trigger)}
                    title={s.subject.trim() || "No subject yet"}
                    selected={sel.kind === "step" && sel.key === s.key}
                    onClick={() => setSel({ kind: "step", key: s.key })}
                    testId={`node-step-${i}`}
                    badge={!s.enabled ? "Switched off" : !s.subject.trim() || !s.bodyHtml.trim() ? "Needs words" : undefined}
                  >
                    <div className="text-xs text-white/45 line-clamp-2 break-words">{previewText(s.bodyHtml) || "Tap to write this email."}</div>
                  </Node>
                </div>
              ))}

              <Connector onAdd={() => addStep()} addLabel="Add an email" />

              <Node tone="amber" icon={ShieldCheck} eyebrow="Rules" title="Built-in safety" selected={sel.kind === "rules"} onClick={() => setSel({ kind: "rules" })} testId="node-rules">
                <ul className="text-xs text-white/60 space-y-0.5">
                  {draft.trigger === "registration_started" && (
                    <li className={draft.stopOnPayment ? "text-emerald-300" : "text-red-300"}>
                      {draft.stopOnPayment ? "✓ Stops the moment they pay" : "✗ Does NOT stop when they pay"}
                    </li>
                  )}
                  <li>{draft.quietHours ? "✓ Never sends 8pm–8am (waits for morning)" : "Sends at any hour"}</li>
                  <li>{draft.emailKind === "marketing" ? "✓ Skips anyone who unsubscribed" : "Booking information — always sends"}</li>
                  <li>✓ Each family goes through it once</li>
                </ul>
              </Node>
              <div className="w-px h-5 bg-white/15 mx-auto" />
              <div className="mx-auto flex items-center gap-1.5 text-xs text-white/45 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                <Flag className="w-3.5 h-3.5" /> Finished
              </div>
            </div>
          </div>

          {/* ── settings for what's selected ────────────────────── */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4 min-w-0 lg:sticky lg:top-4" data-testid="settings-panel">
            {sel.kind === "trigger" && (
              <TriggerPanel draft={draft} programmes={programmes} onChange={patch} />
            )}
            {sel.kind === "rules" && <RulesPanel draft={draft} onChange={patch} />}
            {sel.kind === "step" && selStep && (
              <StepPanel
                automationId={id}
                trigger={draft.trigger}
                step={selStep}
                onChange={(p) => patchStep(selStep.key, p)}
                onEdit={() => setEditing(selStep.key)}
                onRemove={() => {
                  if (steps.length <= 1) { toast({ title: "An automation needs at least one email", variant: "destructive" }); return; }
                  setSteps((ss) => ss.filter((x) => x.key !== selStep.key));
                  setSel({ kind: "trigger" });
                  setDirty(true);
                }}
              />
            )}
            {draft.status === "off" && (
              <div className="pt-3 border-t border-white/[0.06]">
                <button type="button" onClick={() => { if (window.confirm("Delete this automation? It's off, so nothing is waiting to send.")) remove.mutate(); }}
                  className="inline-flex items-center gap-1.5 text-xs text-red-300/80 hover:text-red-300 min-h-[44px] md:min-h-0" data-testid="button-delete-automation">
                  <Trash2 className="w-3.5 h-3.5" /> Delete automation
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── the full email editor ───────────────────────────────── */}
      <Dialog open={!!editStep} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-[96vw] w-[1200px] h-[92vh] flex flex-col p-3 sm:p-4 gap-3">
          <DialogTitle className="text-base">
            {editStep ? `${timingSentence(editStep, draft.trigger)} — ${editStep.subject || "no subject yet"}` : ""}
          </DialogTitle>
          {editStep && (
            <>
              <Input value={editStep.subject} onChange={(e) => patchStep(editStep.key, { subject: e.target.value })} placeholder="Subject line" className="h-10" data-testid="input-editor-subject" />
              <div className="flex-1 min-h-0 rounded-xl border border-white/10 bg-white overflow-hidden">
                <Suspense fallback={<div className="h-full flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading the editor…</div>}>
                  <EmailBuilder
                    key={editStep.key}
                    fillParent
                    autoSave
                    workspaceId={currentOrg?.id ?? 1}
                    brandKey={brandKey}
                    // A starter email is plain HTML with no saved design yet; the
                    // builder opens HTML when it is handed as an 'html' doc.
                    initialDoc={(editStep.bodyDoc ?? (editStep.bodyHtml.trim() ? { engine: "html", html: editStep.bodyHtml } : null)) as any}
                    initialHtml={editStep.bodyHtml}
                    onSave={(r: { doc: unknown; html: string }) => patchStep(editStep.key, { bodyHtml: r.html, bodyDoc: r.doc })}
                  />
                </Suspense>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/45">Tags you can type into the email or subject:</span>
                {AUTOMATION_MERGE_TAGS.map((t) => <code key={t.tag} className="text-[11px] rounded border border-white/10 px-1.5 py-0.5 text-white/70" title={t.label}>{t.tag}</code>)}
                <Button className="ml-auto bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-9" onClick={() => setEditing(null)} data-testid="button-editor-done">
                  Done
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <SwitchDialog
        id={id}
        draft={draft}
        to={switchTo}
        dirty={dirty}
        busy={setStatus.isPending}
        onCancel={() => setSwitchTo(null)}
        onConfirm={(includeLastDays) => switchTo && setStatus.mutate({ status: switchTo, includeLastDays })}
        steps={ordered}
      />
      <SimulateDialog id={id} open={simOpen} onOpenChange={setSimOpen} dirty={dirty} steps={ordered} trigger={draft.trigger} />
    </div>
  );
}

function cleanErr(e: any): string {
  const m = String(e?.message ?? e ?? "");
  const j = m.replace(/^\d+:\s*/, "");
  try { return JSON.parse(j).message ?? j; } catch { return j; }
}

function previewText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

/** The label on the line between two emails: how long after the one above. */
function gapLabel(prev: Step | undefined, s: Step): string | undefined {
  if (!prev) return undefined;
  const mins = (x: Step) => (x.timingUnit === "immediately" ? 0 : x.timingAmount * ({ minutes: 1, hours: 60, days: 1440, weeks: 10080 } as any)[x.timingUnit]) * (x.timingDirection === "before" ? -1 : 1);
  const d = mins(s) - mins(prev);
  if (d <= 0) return "same time";
  if (d % 10080 === 0) return `then ${d / 10080} week${d === 10080 ? "" : "s"} later`;
  if (d % 1440 === 0) return `then ${d / 1440} day${d === 1440 ? "" : "s"} later`;
  if (d % 60 === 0) return `then ${d / 60} hour${d === 60 ? "" : "s"} later`;
  return `then ${d} min later`;
}

function Node({
  tone, icon: Icon, eyebrow, title, selected, onClick, children, testId, badge,
}: {
  tone: "blue" | "white" | "amber" | "muted"; icon: any; eyebrow: string; title: string; selected: boolean;
  onClick: () => void; children?: React.ReactNode; testId: string; badge?: string;
}) {
  const ring = selected ? "ring-2 ring-blue-500/70 border-blue-500/60" : "border-white/10 hover:border-white/20";
  const iconCls = tone === "blue" ? "bg-blue-600 text-white" : tone === "amber" ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" : tone === "muted" ? "bg-white/[0.05] text-white/35" : "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left rounded-xl border bg-[#0f1726] shadow-sm transition p-3 flex gap-3 min-w-0 ${ring} ${tone === "muted" ? "opacity-60" : ""}`}
      data-testid={testId}>
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconCls}`}><Icon className="w-4 h-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-white/45 break-words">{eyebrow}</span>
          {badge && <span className="text-[10px] rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 px-1.5">{badge}</span>}
        </span>
        <span className="block text-sm font-medium text-white break-words">{title}</span>
        {children && <span className="block mt-1">{children}</span>}
      </span>
    </button>
  );
}

function Connector({ label, onAdd, addLabel }: { label?: string; onAdd: () => void; addLabel?: string }) {
  return (
    <div className="flex flex-col items-center py-1">
      <div className="w-px h-3 bg-white/15" />
      {label && <div className="text-[10px] text-white/45 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 my-0.5">{label}</div>}
      <button type="button" onClick={onAdd}
        className={`flex items-center justify-center gap-1 rounded-full border border-dashed border-white/20 text-white/50 hover:text-blue-300 hover:border-blue-500/50 transition ${addLabel ? "px-3 min-h-[36px] text-xs" : "w-8 h-8"}`}
        title="Add an email here" aria-label="Add an email here" data-testid={addLabel ? "button-add-step" : undefined}>
        <Plus className="w-3.5 h-3.5" />{addLabel}
      </button>
      <div className="w-px h-3 bg-white/15" />
    </div>
  );
}

function StatusSwitch({ status, onPick, disabled }: { status: AutomationStatus; onPick: (s: AutomationStatus) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5" role="radiogroup" aria-label="Status" data-testid="status-switch">
      {(["off", "test", "on"] as AutomationStatus[]).map((s) => {
        const m = STATUS_META[s];
        const Icon = m.icon;
        const active = status === s;
        return (
          <button key={s} type="button" role="radio" aria-checked={active} disabled={disabled} onClick={() => onPick(s)}
            className={`inline-flex items-center gap-1 rounded-md px-3 min-h-[40px] md:min-h-8 text-xs font-semibold transition ${active ? m.cls + " border" : "text-white/50 hover:text-white/80"}`}
            data-testid={`status-option-${s}`}>
            <Icon className="w-3.5 h-3.5" />{m.label}
          </button>
        );
      })}
    </div>
  );
}

// ── panels ────────────────────────────────────────────────────────────────────

function PanelTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-white">{children}</div>
      {sub && <div className="text-xs text-white/45 mt-0.5">{sub}</div>}
    </div>
  );
}

function TriggerPanel({ draft, programmes, onChange }: { draft: Automation; programmes: Programme[]; onChange: (p: Partial<Automation>) => void }) {
  const locked = draft.status !== "off";
  return (
    <div className="space-y-4">
      <PanelTitle sub="What starts this automation for a family.">Starts when</PanelTitle>
      <div className="space-y-1.5">
        {TRIGGER_ORDER.map((t) => {
          const m = TRIGGERS[t];
          const on = draft.trigger === t;
          return (
            <button key={t} type="button" disabled={locked && !on}
              onClick={() => onChange({ trigger: t, stopOnPayment: m.canStopOnPayment ? true : draft.stopOnPayment })}
              className={`w-full text-left rounded-lg border px-3 py-2 min-h-[44px] transition ${on ? "border-blue-500/60 bg-blue-500/10" : "border-white/10 hover:bg-white/[0.04] disabled:opacity-40"}`}
              data-testid={`trigger-${t}`}>
              <div className="text-sm text-white">{m.label}</div>
              <div className="text-[11px] text-white/45">{m.blurb}</div>
            </button>
          );
        })}
        {locked && <p className="text-[11px] text-white/40">Switch it off to change what starts it.</p>}
      </div>
      <div className="space-y-2">
        <PanelTitle sub="Only families in these programmes go through it.">Programmes</PanelTitle>
        <ProgrammePicker programmes={programmes} value={draft.programIds ?? []} onChange={(v) => onChange({ programIds: v.length ? v : null })} />
      </div>
    </div>
  );
}

function RulesPanel({ draft, onChange }: { draft: Automation; onChange: (p: Partial<Automation>) => void }) {
  const [tests, setTests] = useState(draft.testEmails.join(", "));
  useEffect(() => setTests(draft.testEmails.join(", ")), [draft.testEmails.join(",")]);
  return (
    <div className="space-y-4">
      <PanelTitle sub="These run on every email, automatically.">Rules</PanelTitle>
      {draft.trigger === "registration_started" && (
        <RuleRow
          title="Stop when they pay"
          sub="Checked again just before every email. If they've paid for this programme, the rest are cancelled."
          checked={draft.stopOnPayment} onChange={(v) => onChange({ stopOnPayment: v })} testId="rule-stop-on-payment"
        />
      )}
      <RuleRow
        title="Quiet hours"
        sub="Nothing sends between 8pm and 8am NZ time — it waits for the morning."
        checked={draft.quietHours} onChange={(v) => onChange({ quietHours: v })} testId="rule-quiet-hours"
      />
      <div className="space-y-1.5">
        <div className="text-sm text-white">What kind of email is this?</div>
        {([
          ["operational", "Booking information", "About something they've signed up for. Always sends."],
          ["marketing", "Club news or promotion", "Skips anyone who has unsubscribed from club emails."],
        ] as [EmailKind, string, string][]).map(([k, l, s]) => (
          <label key={k} className={`flex gap-2 rounded-lg border px-3 py-2 min-h-[44px] cursor-pointer ${draft.emailKind === k ? "border-blue-500/60 bg-blue-500/10" : "border-white/10"}`}>
            <input type="radio" className="mt-1 accent-blue-600" checked={draft.emailKind === k} onChange={() => onChange({ emailKind: k })} data-testid={`kind-${k}`} />
            <span><span className="block text-sm text-white">{l}</span><span className="block text-[11px] text-white/45">{s}</span></span>
          </label>
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="text-sm text-white">Test addresses</div>
        <div className="text-[11px] text-white/45">In Test mode every email goes here instead of to the family. Separate with commas.</div>
        <Input value={tests} onChange={(e) => setTests(e.target.value)}
          onBlur={() => onChange({ testEmails: tests.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) })}
          placeholder="you@cufc.co.nz, zach@cufc.co.nz" className="h-10" data-testid="input-test-emails" />
      </div>
      <div className="grid gap-2">
        <div>
          <div className="text-sm text-white mb-1">From</div>
          <Input value={draft.fromEmail ?? ""} onChange={(e) => onChange({ fromEmail: e.target.value })} placeholder="Christchurch United FC <noreply@cufc.co.nz>" className="h-10" />
        </div>
        <div>
          <div className="text-sm text-white mb-1">Replies go to</div>
          <Input value={draft.replyTo ?? ""} onChange={(e) => onChange({ replyTo: e.target.value })} placeholder="info@cufc.co.nz" className="h-10" />
        </div>
      </div>
    </div>
  );
}

function RuleRow({ title, sub, checked, onChange, testId }: { title: string; sub: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/10 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white">{title}</div>
        <div className="text-[11px] text-white/45">{sub}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

function StepPanel({
  automationId, trigger, step, onChange, onEdit, onRemove,
}: {
  automationId: number; trigger: TriggerType; step: Step;
  onChange: (p: Partial<Step>) => void; onEdit: () => void; onRemove: () => void;
}) {
  const { toast } = useToast();
  const meta = TRIGGERS[trigger];
  const timeApplies = sendTimeApplies(step, trigger);
  const test = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/admin/mailer/automations/${automationId}/steps/${step.id ?? 0}/test`, {
        subject: step.subject, bodyHtml: step.bodyHtml,
      });
      return (await r.json()) as { to: string };
    },
    onSuccess: (r) => toast({ title: "Test sent", description: `Check ${r.to} — it's marked [TEST].` }),
    onError: (e: any) => toast({ title: "Couldn't send the test", description: cleanErr(e), variant: "destructive" }),
  });

  // Presets for the timings Daniel named, one tap each.
  const presets: { label: string; unit: TimingUnit; amount: number }[] = meta.dateBased
    ? [
      { label: "On the day", unit: "immediately", amount: 0 },
      { label: "1 day", unit: "days", amount: 1 },
      { label: "3 days", unit: "days", amount: 3 },
      { label: "1 week", unit: "weeks", amount: 1 },
    ]
    : [
      { label: "Straight away", unit: "immediately", amount: 0 },
      { label: "2 hours", unit: "hours", amount: 2 },
      { label: "1 day", unit: "days", amount: 1 },
      { label: "3 days", unit: "days", amount: 3 },
      { label: "1 week", unit: "weeks", amount: 1 },
      { label: "30 days", unit: "days", amount: 30 },
    ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <PanelTitle sub={timingSentence(step, trigger)}>This email</PanelTitle>
        <label className="ml-auto flex items-center gap-2 text-xs text-white/60">
          {step.enabled ? "On" : "Off"}
          <Switch checked={step.enabled} onCheckedChange={(v) => onChange({ enabled: v })} data-testid="switch-step-enabled" />
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-white">When it sends</div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const on = step.timingUnit === p.unit && (p.unit === "immediately" || step.timingAmount === p.amount);
            return (
              <button key={p.label} type="button" onClick={() => onChange({ timingUnit: p.unit, timingAmount: p.amount })}
                className={`text-xs rounded-full border px-3 min-h-[36px] ${on ? "border-blue-500/60 bg-blue-500/10 text-blue-300" : "border-white/10 text-white/60 hover:bg-white/[0.04]"}`}>
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {step.timingUnit !== "immediately" && (
            <Input type="number" min={1} max={999} value={step.timingAmount}
              onChange={(e) => onChange({ timingAmount: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
              className="w-20 h-10" aria-label="How many" data-testid="input-timing-amount" />
          )}
          <div className="w-[150px]">
            <SelectInput value={step.timingUnit} onChange={(e) => onChange({ timingUnit: e.target.value as TimingUnit, timingAmount: e.target.value === "immediately" ? 0 : Math.max(1, step.timingAmount) })} data-testid="select-timing-unit">
              <option value="immediately">{meta.dateBased ? "On the day" : "Straight away"}</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
              <option value="weeks">weeks</option>
            </SelectInput>
          </div>
          {meta.dateBased && step.timingUnit !== "immediately" && (
            <div className="w-[120px]">
              <SelectInput value={step.timingDirection} onChange={(e) => onChange({ timingDirection: e.target.value as "after" | "before" })} data-testid="select-timing-direction">
                <option value="before">before</option>
                <option value="after">after</option>
              </SelectInput>
            </div>
          )}
        </div>
        {timeApplies && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-white/50">at</span>
            <div className="w-[140px]">
              <TimePickerInput value={step.sendTime ?? (meta.dateBased ? "09:00" : "")} onChange={(e) => onChange({ sendTime: e.target.value || null })} placeholder="Same time" data-testid="input-send-time" />
            </div>
            {step.sendTime && !meta.dateBased && (
              <button type="button" className="text-[11px] text-white/45 underline" onClick={() => onChange({ sendTime: null })}>same time of day they paid</button>
            )}
          </div>
        )}
        <div className="text-[11px] text-white/45 flex items-center gap-1"><Clock className="w-3 h-3" />{timingSentence(step, trigger)}</div>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm text-white">Subject</div>
        <Input value={step.subject} onChange={(e) => onChange({ subject: e.target.value })} placeholder="e.g. Your spot in {{programme_name}} isn't booked yet" className="h-10" data-testid="input-step-subject" />
        <div className="flex flex-wrap gap-1">
          {AUTOMATION_MERGE_TAGS.map((t) => (
            <button key={t.tag} type="button" onClick={() => onChange({ subject: `${step.subject}${step.subject && !step.subject.endsWith(" ") ? " " : ""}${t.tag}` })}
              className="text-[10px] rounded border border-white/10 px-1.5 py-1 text-white/55 hover:text-white" title={`Add ${t.label}`}>
              + {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="text-sm text-white">The email</div>
          <Button size="sm" variant="outline" className="ml-auto min-h-[40px] md:min-h-8" onClick={onEdit} data-testid="button-edit-email">
            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit email
          </Button>
        </div>
        <div className="rounded-lg border border-white/10 bg-white overflow-hidden">
          {step.bodyHtml.trim() ? (
            <iframe title="Email preview" className="w-full h-64 bg-white" sandbox="" srcDoc={step.bodyHtml} data-testid="step-preview" />
          ) : (
            <button type="button" onClick={onEdit} className="w-full h-32 text-sm text-gray-500 hover:bg-gray-50">Nothing written yet — tap to write it</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-[44px] md:min-h-9" disabled={test.isPending} onClick={() => test.mutate()} data-testid="button-test-step">
          {test.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
          Send me a test
        </Button>
        <Button variant="outline" className="min-h-[44px] md:min-h-9 text-red-300 border-red-500/30 hover:bg-red-500/10" onClick={onRemove} data-testid="button-remove-step">
          <Trash2 className="w-4 h-4 mr-1.5" /> Remove
        </Button>
      </div>
    </div>
  );
}

// ── switching on / test / off ─────────────────────────────────────────────────

function SwitchDialog({
  id, draft, to, dirty, busy, onCancel, onConfirm, steps,
}: {
  id: number; draft: Automation; to: AutomationStatus | null; dirty: boolean; busy: boolean;
  onCancel: () => void; onConfirm: (includeLastDays: number) => void; steps: Step[];
}) {
  const [includeLast, setIncludeLast] = useState(false);
  useEffect(() => { if (to) setIncludeLast(false); }, [to]);
  const eligible = useQuery<{ count: number; days: number }>({
    queryKey: [`/api/admin/mailer/automations/${id}/eligible?days=7`],
    enabled: !!to && to !== "off",
  });
  const enabled = steps.filter((s) => s.enabled);
  const canBackfill = !TRIGGERS[draft.trigger].dateBased;
  return (
    <Dialog open={!!to} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>
          {to === "on" ? "Turn on for families?" : to === "test" ? "Run in test mode?" : "Switch it off?"}
        </DialogTitle>
        {to && (
          <div className="space-y-4 min-w-0">
            {dirty && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> You have unsaved changes. Save first so the right version runs.
              </div>
            )}
            {to === "off" ? (
              <p className="text-sm text-white/70">Nothing more will send. Families waiting for an email are taken out of it. You can switch it back on any time — it starts fresh from then.</p>
            ) : (
              <>
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-white/75 space-y-1">
                  <div><strong className="text-white">Starts when:</strong> {TRIGGERS[draft.trigger].label.toLowerCase()} — {programmeNamesPlain(draft.programIds)}</div>
                  {enabled.map((s, i) => <div key={s.key}>Email {i + 1}: {timingSentence(s, draft.trigger).replace(/^Sends /, "")} — “{s.subject || "no subject"}”</div>)}
                  {draft.trigger === "registration_started" && draft.stopOnPayment && <div className="text-emerald-300">Stops the moment they pay.</div>}
                  {draft.quietHours && <div>Never between 8pm and 8am.</div>}
                </div>
                {to === "test" ? (
                  <p className="text-sm text-white/70">
                    Real families go through it on the real timings, but <strong className="text-white">every email goes to {draft.testEmails.join(", ") || "your test addresses"}</strong> instead of them. Nobody outside the club gets anything.
                  </p>
                ) : (
                  <p className="text-sm text-white/70">
                    <strong className="text-white">Families will get these emails.</strong> It starts with families from now on — nobody from before today is emailed
                    {canBackfill ? " unless you tick the box below." : "."}
                    {draft.status === "test" ? " The test families stop here and don't cross over." : ""}
                  </p>
                )}
                {canBackfill && (
                  <label className="flex items-start gap-2 text-sm text-white/75 rounded-lg border border-white/10 p-3 cursor-pointer">
                    <input type="checkbox" className="mt-1 accent-blue-600" checked={includeLast} onChange={(e) => setIncludeLast(e.target.checked)} data-testid="checkbox-include-last" />
                    <span>
                      Also include families from the last 7 days
                      <span className="block text-[11px] text-white/45">
                        {eligible.isLoading ? "Counting…" : eligible.data ? `${eligible.data.count} ${eligible.data.count === 1 ? "family" : "families"} would join. Emails whose time has already passed are skipped, not sent late.` : ""}
                      </span>
                    </span>
                  </label>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel} className="min-h-[44px] md:min-h-9">Cancel</Button>
              <Button
                disabled={busy || dirty}
                onClick={() => onConfirm(includeLast ? 7 : 0)}
                className={`min-h-[44px] md:min-h-9 text-white ${to === "on" ? "bg-emerald-600 hover:bg-emerald-700" : to === "test" ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-600 hover:bg-slate-700"}`}
                data-testid="button-confirm-status"
              >
                {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {to === "on" ? "Turn on for families" : to === "test" ? "Start test mode" : "Switch off"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function programmeNamesPlain(ids: number[] | null) {
  return !ids || ids.length === 0 ? "every programme" : `${ids.length} programme${ids.length === 1 ? "" : "s"}`;
}

function SimulateDialog({ id, open, onOpenChange, dirty, steps, trigger }: {
  id: number; open: boolean; onOpenChange: (v: boolean) => void; dirty: boolean; steps: Step[]; trigger: TriggerType;
}) {
  const { toast } = useToast();
  const [fast, setFast] = useState(true);
  const run = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/admin/mailer/automations/${id}/simulate`, { fast });
      return (await r.json()) as { to: string; schedule: { at: string }[] };
    },
    onSuccess: (r) => {
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: [`/api/admin/mailer/automations/${id}/activity`] });
      toast({ title: "Test family started", description: `${r.schedule.length} email${r.schedule.length === 1 ? "" : "s"} on the way to ${r.to}. Watch them in Activity.` });
    },
    onError: (e: any) => toast({ title: "Couldn't start it", description: cleanErr(e), variant: "destructive" }),
  });
  const enabled = steps.filter((s) => s.enabled);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Run a test family</DialogTitle>
        <div className="space-y-4 min-w-0">
          <p className="text-sm text-white/70">Sends this whole flow to <strong className="text-white">you</strong>, with sample names, so you can see exactly how each email lands. No family is involved — it works even while the automation is off.</p>
          {dirty && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">Save your changes first — the test uses the saved version.</div>}
          <div className="space-y-1.5">
            <label className={`flex gap-2 rounded-lg border px-3 py-2 min-h-[44px] cursor-pointer ${fast ? "border-blue-500/60 bg-blue-500/10" : "border-white/10"}`}>
              <input type="radio" className="mt-1 accent-blue-600" checked={fast} onChange={() => setFast(true)} data-testid="sim-fast" />
              <span><span className="block text-sm text-white">Quick — one email a minute</span><span className="block text-[11px] text-white/45">All {enabled.length} in about {enabled.length} minute{enabled.length === 1 ? "" : "s"}, in the right order.</span></span>
            </label>
            <label className={`flex gap-2 rounded-lg border px-3 py-2 min-h-[44px] cursor-pointer ${!fast ? "border-blue-500/60 bg-blue-500/10" : "border-white/10"}`}>
              <input type="radio" className="mt-1 accent-blue-600" checked={!fast} onChange={() => setFast(false)} data-testid="sim-real" />
              <span><span className="block text-sm text-white">Real timings</span><span className="block text-[11px] text-white/45">{enabled.map((s) => timingChip(s)).join(" · ")} — exactly as a family would get them{TRIGGERS[trigger].dateBased ? ", counted from today" : ""}.</span></span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-[44px] md:min-h-9">Cancel</Button>
            <Button disabled={run.isPending || dirty} onClick={() => run.mutate()} className="bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-9" data-testid="button-start-sim">
              {run.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Play className="w-4 h-4 mr-1.5" />}
              Start
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── activity ──────────────────────────────────────────────────────────────────

type Activity = {
  totals: Record<string, number>;
  families: {
    id: number; email: string; status: string; stopReason: string | null; test: boolean;
    enteredAt: string; finishedAt: string | null; programme: string | null; players: string[];
    sends: { stepId: number; dueAt: string; status: string; reason: string | null; sentTo: string | null; sentAt: string | null }[];
  }[];
};

const SEND_META: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Waiting", cls: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
  sending: { label: "Sending", cls: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
  sent: { label: "Sent", cls: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  skipped: { label: "Skipped", cls: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  cancelled: { label: "Stopped", cls: "text-white/60 border-white/15 bg-white/[0.04]" },
  failed: { label: "Failed", cls: "text-red-300 border-red-500/30 bg-red-500/10" },
};

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Pacific/Auckland" });
}

function ActivityView({ id, steps, trigger }: { id: number; steps: Step[]; trigger: TriggerType }) {
  const q = useQuery<Activity>({
    queryKey: [`/api/admin/mailer/automations/${id}/activity`],
    refetchInterval: 20_000,
  });
  const [open, setOpen] = useState<number | null>(null);
  const stepLabel = (stepId: number) => {
    const i = steps.findIndex((s) => s.id === stepId);
    const s = steps[i];
    return s ? `Email ${i + 1} · ${s.subject || "no subject"}` : "A removed email";
  };
  if (q.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  if (q.isError || !q.data) return <div className="text-sm text-red-400">Couldn't load activity.</div>;
  const t = q.data.totals;
  const tiles: [string, number, string][] = [
    ["Entered", t.entered ?? 0, "families"],
    ["Waiting", t.active ?? 0, "for their next email"],
    ["Sent", t.sent ?? 0, "emails"],
    ...(trigger === "registration_started" ? [["Paid", t.paid ?? 0, "stopped because they paid"] as [string, number, string]] : []),
    ["Skipped", t.skipped ?? 0, "each with a reason"],
    ["Failed", t.failed ?? 0, "emails"],
  ];
  return (
    <div className="space-y-4" data-testid="activity">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map(([l, n, s]) => (
          <div key={l} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-white/40">{l}</div>
            <div className="text-lg font-semibold text-white tabular-nums">{n}</div>
            <div className="text-[10px] text-white/40">{s}</div>
          </div>
        ))}
      </div>
      {q.data.families.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-white/50">
          No families yet. When it's on (or in Test), families appear here as they meet the trigger. <strong className="text-white/70">Run a test family</strong> to see one now.
        </div>
      ) : (
        <div className="space-y-2">
          {q.data.families.map((f) => (
            <div key={f.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02]" data-testid={`family-${f.id}`}>
              <button type="button" onClick={() => setOpen(open === f.id ? null : f.id)} className="w-full text-left p-3 flex flex-wrap items-center gap-2 min-h-[44px]">
                <Users className="w-4 h-4 text-white/40 shrink-0" />
                <span className="text-sm text-white break-all">{f.email}</span>
                {f.test && <span className="text-[10px] rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 px-1.5">test</span>}
                <span className="text-xs text-white/45">{[f.players.join(" & "), f.programme].filter(Boolean).join(" · ")}</span>
                <span className="ml-auto flex items-center gap-1">
                  {f.sends.map((s, i) => (
                    <span key={i} className={`w-2.5 h-2.5 rounded-full border ${SEND_META[s.status]?.cls ?? ""}`} title={`${stepLabel(s.stepId)} — ${SEND_META[s.status]?.label ?? s.status}${s.reason ? ` · ${s.reason}` : ""}`} />
                  ))}
                  <span className="text-[11px] text-white/45 ml-2">
                    {f.status === "active" ? "In progress" : f.stopReason === "paid" ? "Paid — stopped" : f.status === "completed" ? "Finished" : "Stopped"}
                  </span>
                </span>
              </button>
              {open === f.id && (
                <div className="border-t border-white/[0.06] p-3 space-y-1.5">
                  <div className="text-[11px] text-white/40">Joined {when(f.enteredAt)}</div>
                  {f.sends.map((s, i) => (
                    <div key={i} className="flex flex-wrap items-start gap-2 text-xs">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${SEND_META[s.status]?.cls ?? ""}`}>{SEND_META[s.status]?.label ?? s.status}</span>
                      <span className="text-white/80 min-w-0 break-words">{stepLabel(s.stepId)}</span>
                      <span className="text-white/45">{s.status === "sent" ? when(s.sentAt) : `due ${when(s.dueAt)}`}</span>
                      {s.reason && <span className="w-full text-white/50 pl-1">{s.reason}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
