// CIC Youth — the registrations-of-interest PIPELINE (2026-09-25).
//
// Built for Isaac to work through every lead the cicyouth.com form and the
// CIC 2027 ads bring in: drag a club between stages, log each touch in one tap,
// set the next follow-up, and sweep spam out in bulk. Rules (stages, reasons,
// flags, follow-up due) live in shared/cic-leads.ts; the server is
// server/cic-leads-routes.ts. Nothing is ever disqualified automatically.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { SelectInput } from "@/components/ui/select-input";
import {
  Search, Mail, Phone, MessageCircle, MapPin, Megaphone, AlertTriangle, ShieldAlert, CalendarClock,
  ChevronLeft, ChevronRight, X, CheckSquare, Square, Ban, UserRound, Flame, StickyNote, ArrowRight, Loader2,
} from "lucide-react";
import {
  LEAD_STAGES, OPEN_STAGES, CLOSED_STAGES, DISQUALIFY_REASONS, NOT_COMING_REASONS, PRIORITIES, QUICK_LOGS,
  type LeadStage, stageLabel, reasonLabel, followUpStatus, addDaysIso, countryOf, marketOf, leadFlags,
  looksLikeSpam, visibleFlags, whatsappHref, type LeadFlag,
} from "@shared/cic-leads";

const AGE_GROUPS = ["U9", "U10", "U11", "U12", "U13", "U14", "U15"];

export type Lead = {
  id: number; firstName: string; lastName: string | null; email: string; phone: string | null;
  club: string | null; location: string | null; ageGroups: string[]; stage: LeadStage; status: string;
  notes: string | null; sourceUrl: string | null; closedReason: string | null; priority: string | null;
  nextFollowUpOn: string | null; ownerUserId: number | null; lastActivityAt: string | null;
  stageChangedAt: string | null; createdAt: string; activityCount: number;
};
type Team = { id: number; name: string }[];
type Board = { today: string; team: Team; leads: Lead[] };
type Activity = {
  id: number; type: string; outcome: string | null; note: string | null; fromStage: string | null;
  toStage: string | null; createdAt: string; byName: string | null;
};

const KEY = ["/api/admin/cic/leads"];
const leadName = (l: Lead) => `${l.firstName}${l.lastName ? " " + l.lastName : ""}`.trim();
const title = (l: Lead) => l.club?.trim() || leadName(l);
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });
};
const fmtWhen = (ts: string) => new Date(ts).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const PRIORITY_CLS: Record<string, string> = {
  hot: "bg-red-500/15 text-red-300", warm: "bg-amber-500/15 text-amber-300", cold: "bg-sky-500/15 text-sky-300",
};
const STAGE_ORDER = Object.fromEntries(LEAD_STAGES.map((s, i) => [s.key, i]));

type Quick = "all" | "untouched" | "due" | "flagged" | "spam";

export default function LeadPipeline() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<Board>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await workspaceFetch("/api/admin/cic/leads");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `Couldn't load leads (${r.status})`);
      return r.json();
    },
  });
  const leads = data?.leads ?? [];
  const today = data?.today ?? "";
  const team = data?.team ?? [];

  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState<string>("all");
  const [region, setRegion] = useState<string>("all");
  const [age, setAge] = useState<string>("all");
  const [source, setSource] = useState<"all" | "paid" | "organic">("all");
  const [quick, setQuick] = useState<Quick>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropOn, setDropOn] = useState<LeadStage | null>(null);
  const [closing, setClosing] = useState<{ ids: number[]; stage: LeadStage } | null>(null);

  const flags = useMemo(() => {
    const all = leadFlags(leads);
    const m = new Map<number, LeadFlag[]>();
    all.forEach((f, id) => m.set(id, visibleFlags(f)));
    return m;
  }, [leads]);
  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) { const c = countryOf(l); if (c) m.set(c, (m.get(c) || 0) + 1); }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (q && ![l.club, l.firstName, l.lastName, l.email, l.phone, l.location].some((v) => (v || "").toLowerCase().includes(q))) return false;
      if (owner === "unassigned" && l.ownerUserId != null) return false;
      if (owner !== "all" && owner !== "unassigned" && l.ownerUserId !== Number(owner)) return false;
      const c = countryOf(l);
      if (region === "nz" && c !== "New Zealand") return false;
      if (region === "intl" && (c === null || c === "New Zealand")) return false;
      if (!["all", "nz", "intl"].includes(region) && c !== region) return false;
      if (age !== "all" && !l.ageGroups.includes(age)) return false;
      if (source !== "all" && marketOf(l.sourceUrl).paid !== (source === "paid")) return false;
      const f = flags.get(l.id) || [];
      if (quick === "untouched" && l.stage !== "new") return false;
      if (quick === "due" && !["overdue", "today"].includes(followUpStatus(l.nextFollowUpOn, today, l.stage))) return false;
      if (quick === "flagged" && (f.length === 0 || CLOSED_STAGES.includes(l.stage))) return false;
      if (quick === "spam" && (!looksLikeSpam(f) || CLOSED_STAGES.includes(l.stage))) return false;
      return true;
    });
  }, [leads, search, owner, region, age, source, quick, flags, today]);

  // Within a column: overdue follow-ups first, then hot, then newest.
  const rank = (l: Lead) => {
    const fu = followUpStatus(l.nextFollowUpOn, today, l.stage);
    return (fu === "overdue" ? 0 : fu === "today" ? 1 : 2) * 10 + (l.priority === "hot" ? 0 : l.priority === "warm" ? 1 : 2);
  };
  const byStage = useMemo(() => {
    const m = new Map<LeadStage, Lead[]>();
    for (const s of LEAD_STAGES) m.set(s.key, []);
    for (const l of visible) m.get(l.stage)?.push(l);
    for (const list of Array.from(m.values())) list.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
    return m;
  }, [visible, today]);
  // The order Prev/Next walks: the board, left to right, top to bottom.
  const order = useMemo(
    () => LEAD_STAGES.filter((s) => showClosed || OPEN_STAGES.includes(s.key)).flatMap((s) => byStage.get(s.key) || []),
    [byStage, showClosed],
  );

  const stats = useMemo(() => {
    const open = leads.filter((l) => OPEN_STAGES.includes(l.stage));
    return {
      untouched: leads.filter((l) => l.stage === "new").length,
      due: leads.filter((l) => ["overdue", "today"].includes(followUpStatus(l.nextFollowUpOn, today, l.stage))).length,
      inPlay: open.filter((l) => l.stage !== "new").length,
      committed: leads.filter((l) => l.stage === "committed").length,
      entered: leads.filter((l) => l.stage === "entered").length,
      spam: open.filter((l) => looksLikeSpam(flags.get(l.id) || [])).length,
      disqualified: leads.filter((l) => l.stage === "disqualified").length,
    };
  }, [leads, flags, today]);

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/admin/cic/leads/${id}`, body).then((r) => r.json()),
    onMutate: async ({ id, body }) => {
      // Optimistic, so a drag lands where it was dropped.
      await queryClient.cancelQueries({ queryKey: KEY });
      const prev = queryClient.getQueryData<Board>(KEY);
      if (prev) {
        queryClient.setQueryData<Board>(KEY, {
          ...prev,
          leads: prev.leads.map((l) => (l.id === id ? { ...l, ...body, ...(body.stage ? { stage: body.stage as LeadStage, status: String(body.stage) } : {}) } as Lead : l)),
        });
      }
      return { prev };
    },
    onError: (e: any, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(KEY, ctx.prev); toast({ title: "Couldn't save", description: e.message, variant: "destructive" }); },
    onSettled: (_d, _e, v) => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cic/leads", v.id, "activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cic/registrations"] });
    },
  });
  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/admin/cic/leads/bulk", body).then((r) => r.json()),
    onSuccess: (r: any, body) => {
      toast({ title: body.stage ? `Moved ${r.moved} to ${stageLabel(String(body.stage))}` : "Updated" });
      setSelected(new Set());
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
    onSettled: () => { queryClient.invalidateQueries({ queryKey: KEY }); queryClient.invalidateQueries({ queryKey: ["/api/admin/cic/registrations"] }); },
  });

  const move = (ids: number[], stage: LeadStage) => {
    if (CLOSED_STAGES.includes(stage)) { setClosing({ ids, stage }); return; }
    if (ids.length === 1) patch.mutate({ id: ids[0], body: { stage } });
    else bulk.mutate({ ids, stage });
  };
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const current = openId != null ? leads.find((l) => l.id === openId) ?? null : null;
  const idx = current ? order.findIndex((l) => l.id === current.id) : -1;

  if (isLoading) return <div className="py-16 text-center text-sm text-white/30"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading leads…</div>;
  if (error) return <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-300">{(error as Error).message}</div>;

  const stageCols = LEAD_STAGES.filter((s) => showClosed || OPEN_STAGES.includes(s.key));
  const tiles: { k: Quick; label: string; value: number; sub: string; tone?: string }[] = [
    { k: "untouched", label: "Untouched", value: stats.untouched, sub: "nobody has contacted them" },
    { k: "due", label: "Follow-ups due", value: stats.due, sub: "today or overdue", tone: stats.due ? "text-amber-300" : undefined },
    { k: "all", label: "In play", value: stats.inPlay, sub: `${stats.committed} committed · ${stats.entered} entered` },
    { k: "spam", label: "Likely spam", value: stats.spam, sub: `${stats.disqualified} already disqualified`, tone: stats.spam ? "text-red-300" : undefined },
  ];

  return (
    <div className="space-y-4" data-testid="cic-lead-pipeline">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.label} onClick={() => setQuick(quick === t.k ? "all" : t.k)} data-testid={`lead-tile-${t.k}`}
            className={`text-left rounded-xl border px-4 py-3 transition-colors ${quick === t.k && t.k !== "all" ? "border-amber-500/60 bg-amber-500/[0.07]" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
            <p className="text-[11px] uppercase tracking-wider text-white/35">{t.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${t.tone || "text-white"}`}>{t.value}</p>
            <p className="text-[11px] text-white/40 mt-0.5">{t.sub}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search club, name, email, phone, city…" data-testid="lead-search"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/30 outline-none focus:border-amber-500/50" />
        </div>
        <SelectInput value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className="h-10 min-w-[150px]">
          <option value="all">Everyone's leads</option>
          <option value="unassigned">Unassigned</option>
          {team.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
        </SelectInput>
        <SelectInput value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" className="h-10 min-w-[150px]">
          <option value="all">All countries</option>
          <option value="nz">New Zealand</option>
          <option value="intl">International</option>
          {countries.map(([c, n]) => <option key={c} value={c}>{`${c} (${n})`}</option>)}
        </SelectInput>
        <SelectInput value={age} onChange={(e) => setAge(e.target.value)} aria-label="Age group" className="h-10 min-w-[120px]">
          <option value="all">All ages</option>
          {AGE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </SelectInput>
        <SelectInput value={source} onChange={(e) => setSource(e.target.value as any)} aria-label="Source" className="h-10 min-w-[130px]">
          <option value="all">Any source</option>
          <option value="paid">From ads</option>
          <option value="organic">Website / organic</option>
        </SelectInput>
        <button onClick={() => setQuick(quick === "flagged" ? "all" : "flagged")} data-testid="lead-filter-flagged"
          className={`h-10 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${quick === "flagged" ? "border-amber-500/60 bg-amber-500/10 text-amber-300" : "border-white/10 text-white/60 hover:text-white"}`}>
          <AlertTriangle className="w-3.5 h-3.5" /> Needs a check
        </button>
        <button onClick={() => setShowClosed((v) => !v)} data-testid="lead-toggle-closed"
          className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white">
          {showClosed ? "Hide closed" : "Show closed"}
        </button>
        <span className="text-xs text-white/40 ml-auto">{visible.length} of {leads.length}</span>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-[#141511] px-3 py-2 shadow-lg" data-testid="lead-bulk-bar">
          <span className="text-sm font-semibold text-white">{selected.size} selected</span>
          <SelectInput value="" onChange={(e) => e.target.value && move(Array.from(selected), e.target.value as LeadStage)} aria-label="Move selected" className="h-9 min-w-[150px]">
            <option value="">Move to…</option>
            {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </SelectInput>
          <SelectInput value="" onChange={(e) => e.target.value && bulk.mutate({ ids: Array.from(selected), ownerUserId: e.target.value === "none" ? null : Number(e.target.value) })} aria-label="Assign selected" className="h-9 min-w-[150px]">
            <option value="">Assign to…</option>
            <option value="none">Nobody</option>
            {team.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          </SelectInput>
          <button onClick={() => setClosing({ ids: Array.from(selected), stage: "disqualified" })} data-testid="lead-bulk-disqualify"
            className="h-9 px-3 rounded-lg bg-red-500/15 text-red-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-red-500/25">
            <Ban className="w-3.5 h-3.5" /> Disqualify
          </button>
          <button onClick={() => setSelected(new Set(visible.filter((l) => !CLOSED_STAGES.includes(l.stage)).map((l) => l.id)))} className="h-9 px-3 text-xs text-white/60 hover:text-white">Select all shown</button>
          <button onClick={() => setSelected(new Set())} className="h-9 px-3 text-xs text-white/60 hover:text-white ml-auto">Clear</button>
        </div>
      )}

      {/* Board */}
      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 pb-2">
        <div className="flex gap-3 min-w-max">
          {stageCols.map((s) => {
            const items = byStage.get(s.key) || [];
            const isDrop = dropOn === s.key;
            const allSel = items.length > 0 && items.every((l) => selected.has(l.id));
            return (
              <div key={s.key} data-testid={`lead-col-${s.key}`}
                className={`w-72 flex-shrink-0 flex flex-col rounded-xl border transition-colors ${isDrop ? "border-amber-500/60 bg-amber-500/[0.06]" : "border-white/[0.06] bg-white/[0.02]"}`}
                onDragOver={(e) => { e.preventDefault(); setDropOn(s.key); }}
                onDragLeave={() => setDropOn((c) => (c === s.key ? null : c))}
                onDrop={(e) => {
                  e.preventDefault(); setDropOn(null);
                  if (dragId == null) return;
                  const l = leads.find((x) => x.id === dragId);
                  // Dragging a selected card moves the whole selection.
                  const ids = selected.has(dragId) ? Array.from(selected) : [dragId];
                  if (l && (l.stage !== s.key || ids.length > 1)) move(ids, s.key);
                  setDragId(null);
                }}>
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.05]">
                  <button onClick={() => setSelected((sel) => { const n = new Set(sel); items.forEach((l) => (allSel ? n.delete(l.id) : n.add(l.id))); return n; })}
                    className="text-white/30 hover:text-white/70" aria-label={`Select all in ${s.label}`} disabled={!items.length}>
                    {allSel ? <CheckSquare className="w-4 h-4 text-amber-400" /> : <Square className="w-4 h-4" />}
                  </button>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-sm font-semibold text-white/90 truncate" title={s.hint}>{s.label}</span>
                  <span className="ml-auto text-xs text-white/40">{items.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[90px] max-h-[calc(100vh-360px)]">
                  {items.length === 0 ? (
                    <div className="text-[11px] text-white/25 italic py-4 text-center rounded border border-dashed border-white/10">{isDrop ? "Drop here" : s.hint}</div>
                  ) : items.map((l) => (
                    <LeadCard key={l.id} lead={l} flags={flags.get(l.id) || []} today={today} team={team}
                      selected={selected.has(l.id)} dragging={dragId === l.id}
                      onToggle={() => toggle(l.id)} onOpen={() => setOpenId(l.id)}
                      onDragStart={() => setDragId(l.id)} onDragEnd={() => { setDragId(null); setDropOn(null); }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Sheet open={!!current} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 overflow-y-auto bg-[#141511] border-white/10">
          {current && (
            <LeadDrawer key={current.id} lead={current} flags={flags.get(current.id) || []} today={today} team={team}
              position={idx >= 0 ? `${idx + 1} of ${order.length}` : null}
              onPrev={idx > 0 ? () => setOpenId(order[idx - 1].id) : undefined}
              onNext={idx >= 0 && idx < order.length - 1 ? () => setOpenId(order[idx + 1].id) : undefined}
              onOpenLead={(id) => setOpenId(id)}
              onPatch={(body) => patch.mutate({ id: current.id, body })}
              onClose={(stage) => setClosing({ ids: [current.id], stage })} />
          )}
        </SheetContent>
      </Sheet>

      {closing && (
        <CloseDialog ids={closing.ids} stage={closing.stage} onCancel={() => setClosing(null)}
          onConfirm={(reason, note) => {
            if (closing.ids.length === 1) patch.mutate({ id: closing.ids[0], body: { stage: closing.stage, closedReason: reason, stageNote: note || null } });
            else bulk.mutate({ ids: closing.ids, stage: closing.stage, closedReason: reason });
            setClosing(null);
          }} />
      )}
    </div>
  );
}

function LeadCard({ lead: l, flags, today, team, selected, dragging, onToggle, onOpen, onDragStart, onDragEnd }: {
  lead: Lead; flags: LeadFlag[]; today: string; team: Team; selected: boolean; dragging: boolean;
  onToggle: () => void; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const fu = followUpStatus(l.nextFollowUpOn, today, l.stage);
  const spam = looksLikeSpam(flags);
  const owner = team.find((t) => t.id === l.ownerUserId);
  const country = countryOf(l);
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd}
      onClick={onOpen} style={{ opacity: dragging ? 0.4 : 1 }} data-testid={`lead-card-${l.id}`}
      className={`rounded-lg border p-2.5 cursor-pointer space-y-1.5 transition-colors ${selected ? "border-amber-500/60 bg-amber-500/[0.08]" : "border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]"}`}>
      <div className="flex items-start gap-2">
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="mt-0.5 text-white/30 hover:text-white/70 shrink-0" aria-label="Select">
          {selected ? <CheckSquare className="w-4 h-4 text-amber-400" /> : <Square className="w-4 h-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white/90 leading-tight break-words">{title(l)}</div>
          <div className="text-[11px] text-white/40 truncate mt-0.5">{leadName(l)} · {l.location || country || "location unknown"}</div>
        </div>
        {owner && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70" title={owner.name}>{initials(owner.name)}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {l.ageGroups.map((g) => <span key={g} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{g}</span>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {l.priority && <span className={`px-1.5 py-0.5 rounded capitalize ${PRIORITY_CLS[l.priority] || ""}`}>{l.priority}</span>}
        {(fu === "overdue" || fu === "today") && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${fu === "overdue" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>
            <CalendarClock className="w-3 h-3" />{fu === "today" ? "Today" : fmtDate(l.nextFollowUpOn!)}
          </span>
        )}
        {fu === "upcoming" && <span className="inline-flex items-center gap-1 text-white/40"><CalendarClock className="w-3 h-3" />{fmtDate(l.nextFollowUpOn!)}</span>}
        {spam ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 text-red-300"><ShieldAlert className="w-3 h-3" />Likely spam</span>
        ) : flags.length > 0 && !CLOSED_STAGES.includes(l.stage) ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300" title={flags.map((f) => f.label).join("\n")}><AlertTriangle className="w-3 h-3" />{flags.length}</span>
        ) : null}
        {l.closedReason && <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50">{reasonLabel(l.stage, l.closedReason)}</span>}
        {marketOf(l.sourceUrl).paid && <Megaphone className="w-3 h-3 text-violet-300/70" aria-label="From an ad" />}
        {l.activityCount > 0 && <span className="ml-auto text-white/35">{l.activityCount} touch{l.activityCount === 1 ? "" : "es"}</span>}
      </div>
    </div>
  );
}

function LeadDrawer({ lead: l, flags, today, team, position, onPrev, onNext, onOpenLead, onPatch, onClose }: {
  lead: Lead; flags: LeadFlag[]; today: string; team: Team; position: string | null;
  onPrev?: () => void; onNext?: () => void; onOpenLead: (id: number) => void;
  onPatch: (body: Record<string, unknown>) => void; onClose: (stage: LeadStage) => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(l.notes ?? "");
  const [noteDraft, setNoteDraft] = useState("");
  useEffect(() => { setNotes(l.notes ?? ""); }, [l.id]);

  const actKey = ["/api/admin/cic/leads", l.id, "activities"];
  const { data: acts = [], isLoading: actsLoading } = useQuery<Activity[]>({
    queryKey: actKey,
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/cic/leads/${l.id}/activities`);
      if (!r.ok) throw new Error("Couldn't load the timeline");
      return r.json();
    },
  });
  const log = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", `/api/admin/cic/leads/${l.id}/activities`, body).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actKey });
      queryClient.invalidateQueries({ queryKey: KEY });
      setNoteDraft("");
    },
    onError: (e: any) => toast({ title: "Couldn't log that", description: e.message, variant: "destructive" }),
  });

  const wa = whatsappHref(l.phone);
  const country = countryOf(l);
  const market = marketOf(l.sourceUrl);
  const closed = CLOSED_STAGES.includes(l.stage);
  const mailHref = `mailto:${l.email}?subject=${encodeURIComponent("Christchurch International Cup 2027 — your team")}`;

  return (
    <div className="flex flex-col min-h-full" data-testid="lead-drawer">
      <div className="sticky top-0 z-10 bg-[#141511] border-b border-white/5 px-5 py-4 space-y-3">
        <div className="flex items-center gap-2 pr-8">
          <button onClick={onPrev} disabled={!onPrev} className="h-9 w-9 grid place-items-center rounded-lg border border-white/10 text-white/60 disabled:opacity-30" aria-label="Previous lead" data-testid="lead-prev"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={onNext} disabled={!onNext} className="h-9 w-9 grid place-items-center rounded-lg border border-white/10 text-white/60 disabled:opacity-30" aria-label="Next lead" data-testid="lead-next"><ChevronRight className="w-4 h-4" /></button>
          {position && <span className="text-xs text-white/40">{position}</span>}
        </div>
        <div>
          <h2 className="text-lg font-bold text-white leading-tight break-words">{title(l)}</h2>
          <p className="text-xs text-white/40 mt-0.5">#{l.id} · registered {fmtWhen(l.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SelectInput value={l.stage} onChange={(e) => {
            const to = e.target.value as LeadStage;
            if (CLOSED_STAGES.includes(to)) onClose(to); else onPatch({ stage: to });
          }} aria-label="Stage" className="h-9 min-w-[170px]" data-testid="lead-stage-select">
            {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </SelectInput>
          {l.closedReason && <span className="text-xs px-2 py-1 rounded-full bg-white/[0.06] text-white/60">{reasonLabel(l.stage, l.closedReason)}</span>}
        </div>
      </div>

      <div className="px-5 py-4 space-y-5 flex-1">
        {/* Contact */}
        <section className="space-y-2">
          <p className="text-sm font-semibold text-white">{leadName(l)}</p>
          <div className="flex flex-wrap gap-2">
            <a href={mailHref} className="h-10 px-3 rounded-lg bg-amber-500/90 text-black text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-500"><Mail className="w-4 h-4" />Email</a>
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="h-10 px-3 rounded-lg bg-green-500/15 text-green-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-green-500/25"><MessageCircle className="w-4 h-4" />WhatsApp</a>}
            {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="h-10 px-3 rounded-lg border border-white/10 text-white/70 text-xs font-semibold flex items-center gap-1.5 hover:text-white"><Phone className="w-4 h-4" />Call</a>}
          </div>
          <div className="text-[12.5px] text-white/55 space-y-1">
            <div className="break-all">{l.email}</div>
            {l.phone && <div>{l.phone}</div>}
            <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{l.location || "No location"}{country && l.location && !l.location.includes(country) ? ` · ${country}` : ""}</div>
            <div className="flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" />{market.label}</div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {l.ageGroups.map((g) => <span key={g} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500 text-black">{g}</span>)}
          </div>
        </section>

        {/* Flags */}
        {flags.length > 0 && (
          <section className={`rounded-xl border p-3 space-y-1.5 ${looksLikeSpam(flags) ? "border-red-500/30 bg-red-500/[0.06]" : "border-amber-500/25 bg-amber-500/[0.05]"}`} data-testid="lead-flags">
            <p className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
              {looksLikeSpam(flags) ? <><ShieldAlert className="w-3.5 h-3.5 text-red-300" />Likely spam — worth a look before contacting</> : <><AlertTriangle className="w-3.5 h-3.5 text-amber-300" />Worth checking</>}
            </p>
            {flags.map((f) => (
              <div key={f.key} className="text-[12px] text-white/60 flex items-center gap-2">
                <span>• {f.label}</span>
                {f.duplicateOf && <button onClick={() => onOpenLead(f.duplicateOf!)} className="text-amber-300 hover:underline inline-flex items-center gap-0.5">open <ArrowRight className="w-3 h-3" /></button>}
              </div>
            ))}
          </section>
        )}

        {/* Log a touch */}
        {!closed && (
          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-white/35">Log what you did</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_LOGS.map((q) => (
                <button key={q.key} onClick={() => log.mutate({ quick: q.key })} disabled={log.isPending} data-testid={`lead-quick-${q.key}`}
                  className="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white/75 hover:bg-white/[0.08] disabled:opacity-50">{q.label}</button>
              ))}
            </div>
            <p className="text-[11px] text-white/35">Each one sets the next follow-up for you, and moves a New lead forward.</p>
          </section>
        )}

        {/* Follow-up · owner · priority */}
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wider text-white/35">Next follow-up</p>
            <DatePickerInput value={l.nextFollowUpOn ?? ""} disabled={closed}
              onChange={(e) => onPatch({ nextFollowUpOn: e.target.value || null })} className="h-10 w-full" />
            {!closed && (
              <div className="flex gap-1.5">
                {[["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]].map(([label, d]) => (
                  <button key={label} onClick={() => onPatch({ nextFollowUpOn: addDaysIso(today, d as number) })} className="text-[11px] px-2 py-1 rounded-md bg-white/[0.05] text-white/60 hover:text-white">{label}</button>
                ))}
                {l.nextFollowUpOn && <button onClick={() => onPatch({ nextFollowUpOn: null })} className="text-[11px] px-2 py-1 text-white/40 hover:text-white">Clear</button>}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-white/35 flex items-center gap-1"><UserRound className="w-3 h-3" />Owner</p>
              <SelectInput value={l.ownerUserId != null ? String(l.ownerUserId) : ""} onChange={(e) => onPatch({ ownerUserId: e.target.value ? Number(e.target.value) : null })} aria-label="Owner" className="h-10 w-full">
                <option value="">Nobody yet</option>
                {team.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </SelectInput>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-white/35 flex items-center gap-1"><Flame className="w-3 h-3" />Priority</p>
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button key={p.key} onClick={() => onPatch({ priority: l.priority === p.key ? null : p.key })}
                    className={`h-9 flex-1 rounded-lg text-xs font-medium border ${l.priority === p.key ? `${PRIORITY_CLS[p.key]} border-transparent` : "border-white/10 text-white/50 hover:text-white"}`}>{p.label}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Notes */}
        <section className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Notes about this club</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (l.notes ?? "") && onPatch({ notes: notes || null })}
            rows={3} placeholder="Squad size, budget, who decides, travel plans…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-amber-500/50" />
        </section>

        {/* Close */}
        {!closed ? (
          <section className="flex flex-wrap gap-2">
            <button onClick={() => onClose("not_coming")} className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white">Not coming</button>
            <button onClick={() => onClose("disqualified")} data-testid="lead-disqualify" className="h-10 px-3 rounded-lg bg-red-500/15 text-red-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-red-500/25"><Ban className="w-4 h-4" />Disqualify</button>
          </section>
        ) : (
          <button onClick={() => onPatch({ stage: "new" })} className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white">Re-open this lead</button>
        )}

        {/* Timeline */}
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-white/35">History</p>
          <div className="flex gap-2">
            <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note…"
              onKeyDown={(e) => { if (e.key === "Enter" && noteDraft.trim()) log.mutate({ type: "note", note: noteDraft }); }}
              className="flex-1 h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-amber-500/50" />
            <button onClick={() => noteDraft.trim() && log.mutate({ type: "note", note: noteDraft })} disabled={!noteDraft.trim() || log.isPending}
              className="h-10 px-3 rounded-lg bg-white/10 text-xs font-semibold text-white disabled:opacity-40"><StickyNote className="w-4 h-4" /></button>
          </div>
          {actsLoading ? <p className="text-xs text-white/30">Loading…</p> : acts.length === 0 ? (
            <p className="text-xs text-white/30">Nothing logged yet.</p>
          ) : (
            <ol className="space-y-2" data-testid="lead-timeline">
              {acts.map((a) => (
                <li key={a.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                  <div className="text-[12.5px] text-white/80">{describe(a)}</div>
                  {a.note && a.type !== "stage_change" && <div className="text-[12px] text-white/55 whitespace-pre-wrap mt-0.5">{a.note}</div>}
                  <div className="text-[10.5px] text-white/35 mt-0.5">{a.byName || "Someone"} · {fmtWhen(a.createdAt)}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function describe(a: Activity): string {
  if (a.type === "stage_change") {
    const to = stageLabel(a.toStage || "");
    const why = a.note ? ` — ${a.note}` : "";
    return a.fromStage ? `Moved from ${stageLabel(a.fromStage)} to ${to}${why}` : `Moved to ${to}${why}`;
  }
  const q = QUICK_LOGS.find((x) => x.type === a.type && x.outcome === a.outcome);
  if (q) return q.label;
  return { call: "Call", email: "Email", whatsapp: "WhatsApp", note: "Note" }[a.type] || a.type;
}

function CloseDialog({ ids, stage, onCancel, onConfirm }: {
  ids: number[]; stage: LeadStage; onCancel: () => void; onConfirm: (reason: string, note: string) => void;
}) {
  const reasons = stage === "disqualified" ? DISQUALIFY_REASONS : NOT_COMING_REASONS;
  const [reason, setReason] = useState<string>(stage === "disqualified" ? "spam" : "");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md bg-[#141511] border-white/10" data-testid="lead-close-dialog">
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white">{stage === "disqualified" ? "Disqualify" : "Mark not coming"}{ids.length > 1 ? ` ${ids.length} leads` : ""}</h3>
            <p className="text-xs text-white/45 mt-1">Nothing is deleted. It moves to the {stageLabel(stage)} column and can be re-opened.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {reasons.map((r) => (
              <button key={r.key} onClick={() => setReason(r.key)} data-testid={`lead-reason-${r.key}`}
                className={`h-10 px-3 rounded-lg border text-xs font-medium text-left ${reason === r.key ? "border-amber-500/60 bg-amber-500/10 text-amber-200" : "border-white/10 text-white/60 hover:text-white"}`}>{r.label}</button>
            ))}
          </div>
          {ids.length === 1 && (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to add? (optional)"
              className="w-full h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white placeholder:text-white/25 outline-none" />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="h-10 px-4 rounded-lg text-xs text-white/60 hover:text-white"><X className="w-4 h-4 inline mr-1" />Cancel</button>
            <button onClick={() => reason && onConfirm(reason, note)} disabled={!reason} data-testid="lead-close-confirm"
              className="h-10 px-4 rounded-lg bg-amber-500 text-black text-xs font-semibold disabled:opacity-40">Confirm</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
