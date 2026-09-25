// Football in Schools — the outreach PIPELINE (2026-09-25).
//
// Every school and early learning centre we built a proposal page for, as a
// board Connor can work: drag a card between stages, send the school its own
// page in one tap, log each call or email, set the next follow-up, and see
// who's due today. Rules (stages, reasons, follow-ups, page URLs) live in
// shared/fis-leads.ts; the server is server/fis-leads-routes.ts. Same shape as
// Isaac's CIC pipeline (components/cic/lead-pipeline.tsx) on purpose.

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { SelectInput } from "@/components/ui/select-input";
import {
  Search, Mail, Phone, MapPin, CalendarClock, ChevronLeft, ChevronRight, X, CheckSquare, Square, Ban,
  UserRound, Flame, StickyNote, Loader2, ExternalLink, Copy, School, Baby, History, ChevronDown, Car, ArrowLeft,
} from "lucide-react";
import {
  FIS_STAGES, FIS_OPEN, FIS_CLOSED, NOT_NOW_REASONS, NOT_A_FIT_REASONS, FIS_PRIORITIES, FIS_QUICK_LOGS,
  type FisStage, fisStageLabel, fisReasonLabel, fisFollowUpStatus, addDaysIso, fisPageUrl, telHref,
} from "@shared/fis-leads";

export type FisLead = {
  id: number; kind: "school" | "elc"; slug: string; name: string; suburb: string | null; address: string | null;
  website: string | null; driveMin: number | null; returning: boolean; deliveredText: string | null;
  leadGroup: string | null; phone: string | null; email: string | null; contactName: string | null;
  contactRole: string | null; contactEmail: string | null; contactPhone: string | null; sheetStatus: string | null;
  background: Record<string, string>; stage: FisStage; status: string; closedReason: string | null;
  priority: string | null; nextFollowUpOn: string | null; ownerUserId: number | null; notes: string | null;
  lastActivityAt: string | null; stageChangedAt: string | null; createdAt: string; activityCount: number;
};
type Team = { id: number; name: string }[];
type Board = { today: string; team: Team; leads: FisLead[] };
type Activity = {
  id: number; type: string; outcome: string | null; note: string | null; fromStage: string | null;
  toStage: string | null; createdAt: string; byName: string | null;
};

const KEY = ["/api/admin/fis/leads"];
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });
};
const fmtWhen = (ts: string) => new Date(ts).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const PRIORITY_CLS: Record<string, string> = {
  hot: "bg-red-500/15 text-red-300", warm: "bg-amber-500/15 text-amber-300", cold: "bg-sky-500/15 text-sky-300",
};
const SEL = "h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white";
const kindLabel = (k: string) => (k === "elc" ? "Early learning" : "School");

/** The email Connor sends: their own page, a free session, nothing else. */
function mailHref(l: FisLead, to: string) {
  const url = fisPageUrl(l.kind, l.slug);
  const subject = l.kind === "elc" ? `Football for your tamariki at ${l.name}` : `Football in Schools at ${l.name}`;
  const first = (l.contactName || "").split(/\s+/)[0];
  const body = [
    `Kia ora${first ? " " + first : ""},`,
    "",
    `We've put together a short page about what we'd run at ${l.name}:`,
    url,
    "",
    "Happy to have a chat, or to come in for a free session so you can see it first.",
    "",
    "Ngā mihi",
  ].join("\n");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

type Quick = "all" | "untouched" | "due" | "booked";

export default function AdminFisPipeline() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<Board>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await workspaceFetch("/api/admin/fis/leads");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `Couldn't load the pipeline (${r.status})`);
      return r.json();
    },
  });
  const leads = data?.leads ?? [];
  const today = data?.today ?? "";
  const team = data?.team ?? [];

  const [kind, setKind] = useState<"all" | "school" | "elc">("all");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [history, setHistory] = useState<"all" | "returning" | "new">("all");
  const [group, setGroup] = useState("all");
  const [quick, setQuick] = useState<Quick>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropOn, setDropOn] = useState<FisStage | null>(null);
  const [closing, setClosing] = useState<{ ids: number[]; stage: FisStage } | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) if (l.leadGroup && (kind === "all" || l.kind === kind)) m.set(l.leadGroup, (m.get(l.leadGroup) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [leads, kind]);
  useEffect(() => { setGroup("all"); }, [kind]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (kind !== "all" && l.kind !== kind) return false;
      if (q && ![l.name, l.suburb, l.contactName, l.email, l.contactEmail, l.phone].some((v) => (v || "").toLowerCase().includes(q))) return false;
      if (owner === "unassigned" && l.ownerUserId != null) return false;
      if (owner !== "all" && owner !== "unassigned" && l.ownerUserId !== Number(owner)) return false;
      if (history === "returning" && !l.returning) return false;
      if (history === "new" && l.returning) return false;
      if (group !== "all" && l.leadGroup !== group) return false;
      if (quick === "untouched" && l.stage !== "new") return false;
      if (quick === "due" && !["overdue", "today"].includes(fisFollowUpStatus(l.nextFollowUpOn, today, l.stage))) return false;
      if (quick === "booked" && l.stage !== "booked") return false;
      return true;
    });
  }, [leads, kind, search, owner, history, group, quick, today]);

  // Within a column: overdue follow-ups first, then hot, then schools we've
  // worked with, then nearest.
  const rank = (l: FisLead) => {
    const fu = fisFollowUpStatus(l.nextFollowUpOn, today, l.stage);
    return (fu === "overdue" ? 0 : fu === "today" ? 1 : 2) * 100
      + (l.priority === "hot" ? 0 : l.priority === "warm" ? 1 : 2) * 10
      + (l.returning ? 0 : 1);
  };
  const byStage = useMemo(() => {
    const m = new Map<FisStage, FisLead[]>();
    for (const s of FIS_STAGES) m.set(s.key, []);
    for (const l of visible) m.get(l.stage)?.push(l);
    for (const list of Array.from(m.values())) list.sort((a, b) => rank(a) - rank(b) || (a.driveMin ?? 99) - (b.driveMin ?? 99) || a.name.localeCompare(b.name));
    return m;
  }, [visible, today]);
  const order = useMemo(
    () => FIS_STAGES.filter((s) => showClosed || !FIS_CLOSED.includes(s.key)).flatMap((s) => byStage.get(s.key) || []),
    [byStage, showClosed],
  );

  const scoped = leads.filter((l) => kind === "all" || l.kind === kind);
  const stats = {
    untouched: scoped.filter((l) => l.stage === "new").length,
    due: scoped.filter((l) => ["overdue", "today"].includes(fisFollowUpStatus(l.nextFollowUpOn, today, l.stage))).length,
    inPlay: scoped.filter((l) => FIS_OPEN.includes(l.stage) && l.stage !== "new").length,
    trials: scoped.filter((l) => l.stage === "trial" || l.stage === "meeting").length,
    booked: scoped.filter((l) => l.stage === "booked").length,
    total: scoped.length,
  };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/admin/fis/leads/${id}`, body).then((r) => r.json()),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const prev = queryClient.getQueryData<Board>(KEY);
      if (prev) {
        queryClient.setQueryData<Board>(KEY, {
          ...prev,
          leads: prev.leads.map((l) => (l.id === id ? { ...l, ...body, ...(body.stage ? { stage: body.stage as FisStage, status: String(body.stage) } : {}) } as FisLead : l)),
        });
      }
      return { prev };
    },
    onError: (e: any, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(KEY, ctx.prev); toast({ title: "Couldn't save", description: e.message, variant: "destructive" }); },
    onSettled: (_d, _e, v) => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fis/leads", v.id, "activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fis/summary"] });
    },
  });
  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", "/api/admin/fis/leads/bulk", body).then((r) => r.json()),
    onSuccess: (r: any, body) => {
      toast({ title: body.stage ? `Moved ${r.moved} to ${fisStageLabel(String(body.stage))}` : "Updated" });
      setSelected(new Set());
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
    onSettled: () => { queryClient.invalidateQueries({ queryKey: KEY }); queryClient.invalidateQueries({ queryKey: ["/api/admin/fis/summary"] }); },
  });

  const move = (ids: number[], stage: FisStage) => {
    if (FIS_CLOSED.includes(stage)) { setClosing({ ids, stage }); return; }
    if (ids.length === 1) patch.mutate({ id: ids[0], body: { stage } });
    else bulk.mutate({ ids, stage });
  };
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const current = openId != null ? leads.find((l) => l.id === openId) ?? null : null;
  const idx = current ? order.findIndex((l) => l.id === current.id) : -1;

  const stageCols = FIS_STAGES.filter((s) => showClosed || !FIS_CLOSED.includes(s.key));
  const tiles: { k: Quick; label: string; value: number; sub: string; tone?: string }[] = [
    { k: "untouched", label: "Not contacted", value: stats.untouched, sub: `of ${stats.total} ${kind === "elc" ? "centres" : kind === "school" ? "schools" : "schools & centres"}` },
    { k: "due", label: "Follow-ups due", value: stats.due, sub: "today or overdue", tone: stats.due ? "text-amber-300" : undefined },
    { k: "all", label: "In play", value: stats.inPlay, sub: `${stats.trials} meeting or free session` },
    { k: "booked", label: "Booked", value: stats.booked, sub: "a term booked with us", tone: stats.booked ? "text-emerald-300" : undefined },
  ];

  return (
    <div className="p-4 sm:p-8 space-y-5 max-w-[1600px] mx-auto" data-testid="fis-pipeline">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/admin/academy" className="inline-flex items-center gap-1 text-[12px] text-white/40 hover:text-white/70 mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Academy
          </Link>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Football in Schools</h1>
          <p className="text-blue-400/35 text-[13px] mt-1">Every school and early learning centre with a proposal page — who we've contacted, who's next, and who's booked.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1" role="tablist" data-testid="fis-kind-switch">
          {([["all", "All"], ["school", "Schools"], ["elc", "Early learning"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} data-testid={`fis-kind-${k}`}
              className={`h-9 px-3 rounded-lg text-[13px] font-medium ${kind === k ? "bg-blue-500/15 text-blue-400" : "text-white/50 hover:text-white/80"}`}>
              {label} <span className="text-white/35 ml-0.5">{k === "all" ? leads.length : leads.filter((l) => l.kind === k).length}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-white/30"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading the pipeline…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-300">{(error as Error).message}</div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <button key={t.label} onClick={() => setQuick(quick === t.k ? "all" : t.k)} data-testid={`fis-tile-${t.k}`}
                className={`text-left rounded-xl border px-4 py-3 transition-colors ${quick === t.k && t.k !== "all" ? "border-amber-500/60 bg-amber-500/[0.07]" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
                <p className="text-[11px] uppercase tracking-wider text-white/35">{t.label}</p>
                <p className={`text-2xl font-bold mt-0.5 ${t.tone || "text-white"}`}>{t.value}</p>
                <p className="text-[11px] text-white/40 mt-0.5">{t.sub}</p>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, suburb, contact, email…" data-testid="fis-search"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/30 outline-none focus:border-amber-500/50" />
            </div>
            <SelectInput value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className={`${SEL} w-44`}>
              <option value="all">Everyone's</option>
              <option value="unassigned">Unassigned</option>
              {team.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
            </SelectInput>
            <SelectInput value={history} onChange={(e) => setHistory(e.target.value as any)} aria-label="History" className={`${SEL} w-48`}>
              <option value="all">Worked with or not</option>
              <option value="returning">Worked with us before</option>
              <option value="new">Never worked with us</option>
            </SelectInput>
            <SelectInput value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group" className={`${SEL} w-52`}>
              <option value="all">{kind === "elc" ? "All service types" : kind === "school" ? "All lead groups" : "All groups & types"}</option>
              {groups.map(([g, n]) => <option key={g} value={g}>{`${g} (${n})`}</option>)}
            </SelectInput>
            <button onClick={() => setShowClosed((v) => !v)} data-testid="fis-toggle-closed"
              className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white">
              {showClosed ? "Hide closed" : "Show closed"}
            </button>
            <span className="text-xs text-white/40 ml-auto">{visible.length} of {leads.length}</span>
          </div>

          {selected.size > 0 && (
            <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-[#141511] px-3 py-2 shadow-lg" data-testid="fis-bulk-bar">
              <span className="text-sm font-semibold text-white">{selected.size} selected</span>
              <SelectInput value="" onChange={(e) => e.target.value && move(Array.from(selected), e.target.value as FisStage)} aria-label="Move selected" className={`${SEL} h-9 w-44`}>
                <option value="">Move to…</option>
                {FIS_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </SelectInput>
              <SelectInput value="" onChange={(e) => e.target.value && bulk.mutate({ ids: Array.from(selected), ownerUserId: e.target.value === "none" ? null : Number(e.target.value) })} aria-label="Assign selected" className={`${SEL} h-9 w-44`}>
                <option value="">Assign to…</option>
                <option value="none">Nobody</option>
                {team.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </SelectInput>
              <button onClick={() => setSelected(new Set(visible.filter((l) => !FIS_CLOSED.includes(l.stage)).map((l) => l.id)))} className="h-9 px-3 text-xs text-white/60 hover:text-white">Select all shown</button>
              <button onClick={() => setSelected(new Set())} className="h-9 px-3 text-xs text-white/60 hover:text-white ml-auto">Clear</button>
            </div>
          )}

          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 pb-2">
            <div className="flex gap-3 min-w-max">
              {stageCols.map((s) => {
                const items = byStage.get(s.key) || [];
                const isDrop = dropOn === s.key;
                const allSel = items.length > 0 && items.every((l) => selected.has(l.id));
                return (
                  <div key={s.key} data-testid={`fis-col-${s.key}`}
                    className={`w-72 flex-shrink-0 flex flex-col rounded-xl border transition-colors ${isDrop ? "border-amber-500/60 bg-amber-500/[0.06]" : "border-white/[0.06] bg-white/[0.02]"}`}
                    onDragOver={(e) => { e.preventDefault(); setDropOn(s.key); }}
                    onDragLeave={() => setDropOn((c) => (c === s.key ? null : c))}
                    onDrop={(e) => {
                      e.preventDefault(); setDropOn(null);
                      if (dragId == null) return;
                      const l = leads.find((x) => x.id === dragId);
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
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[90px] max-h-[calc(100vh-380px)]">
                      {items.length === 0 ? (
                        <div className="text-[11px] text-white/25 italic py-4 text-center rounded border border-dashed border-white/10">{isDrop ? "Drop here" : s.hint}</div>
                      ) : items.map((l) => (
                        <FisCard key={l.id} lead={l} today={today} team={team}
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
        </>
      )}

      <Sheet open={!!current} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 overflow-y-auto bg-[#141511] border-white/10">
          {current && (
            <FisDrawer key={current.id} lead={current} today={today} team={team}
              position={idx >= 0 ? `${idx + 1} of ${order.length}` : null}
              onPrev={idx > 0 ? () => setOpenId(order[idx - 1].id) : undefined}
              onNext={idx >= 0 && idx < order.length - 1 ? () => setOpenId(order[idx + 1].id) : undefined}
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

function FisCard({ lead: l, today, team, selected, dragging, onToggle, onOpen, onDragStart, onDragEnd }: {
  lead: FisLead; today: string; team: Team; selected: boolean; dragging: boolean;
  onToggle: () => void; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void;
}) {
  const fu = fisFollowUpStatus(l.nextFollowUpOn, today, l.stage);
  const owner = team.find((t) => t.id === l.ownerUserId);
  const KindIcon = l.kind === "elc" ? Baby : School;
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd}
      onClick={onOpen} style={{ opacity: dragging ? 0.4 : 1 }} data-testid={`fis-card-${l.id}`}
      className={`rounded-lg border p-2.5 cursor-pointer space-y-1.5 transition-colors ${selected ? "border-amber-500/60 bg-amber-500/[0.08]" : "border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]"}`}>
      <div className="flex items-start gap-2">
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="mt-0.5 text-white/30 hover:text-white/70 shrink-0" aria-label="Select">
          {selected ? <CheckSquare className="w-4 h-4 text-amber-400" /> : <Square className="w-4 h-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white/90 leading-tight break-words">{l.name}</div>
          <div className="text-[11px] text-white/40 truncate mt-0.5">
            {l.suburb || "Suburb unknown"}{l.driveMin != null ? ` · ${l.driveMin} min` : ""}
          </div>
        </div>
        {owner && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70" title={owner.name}>{initials(owner.name)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300"><KindIcon className="w-3 h-3" />{kindLabel(l.kind)}</span>
        {l.returning && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Worked with us</span>}
        {l.priority && <span className={`px-1.5 py-0.5 rounded capitalize ${PRIORITY_CLS[l.priority] || ""}`}>{l.priority}</span>}
        {(fu === "overdue" || fu === "today") && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${fu === "overdue" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>
            <CalendarClock className="w-3 h-3" />{fu === "today" ? "Today" : fmtDate(l.nextFollowUpOn!)}
          </span>
        )}
        {fu === "upcoming" && <span className="inline-flex items-center gap-1 text-white/40"><CalendarClock className="w-3 h-3" />{fmtDate(l.nextFollowUpOn!)}</span>}
        {l.closedReason && <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50">{fisReasonLabel(l.stage, l.closedReason)}</span>}
        {l.activityCount > 0 && <span className="ml-auto text-white/35">{l.activityCount} touch{l.activityCount === 1 ? "" : "es"}</span>}
      </div>
    </div>
  );
}

function ContactField({ label, value, placeholder, onSave, testId }: {
  label: string; value: string | null; placeholder: string; onSave: (v: string | null) => void; testId?: string;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <label className="block space-y-1">
      <span className="text-[10.5px] uppercase tracking-wider text-white/35">{label}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== (value ?? "") && onSave(v.trim() || null)}
        placeholder={placeholder} data-testid={testId}
        className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:border-amber-500/50" />
    </label>
  );
}

function FisDrawer({ lead: l, today, team, position, onPrev, onNext, onPatch, onClose }: {
  lead: FisLead; today: string; team: Team; position: string | null;
  onPrev?: () => void; onNext?: () => void;
  onPatch: (body: Record<string, unknown>) => void; onClose: (stage: FisStage) => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(l.notes ?? "");
  const [noteDraft, setNoteDraft] = useState("");
  const [showBackground, setShowBackground] = useState(false);
  useEffect(() => { setNotes(l.notes ?? ""); }, [l.id]);

  const actKey = ["/api/admin/fis/leads", l.id, "activities"];
  const { data: acts = [], isLoading: actsLoading } = useQuery<Activity[]>({
    queryKey: actKey,
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/fis/leads/${l.id}/activities`);
      if (!r.ok) throw new Error("Couldn't load the history");
      return r.json();
    },
  });
  const log = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("POST", `/api/admin/fis/leads/${l.id}/activities`, body).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actKey });
      queryClient.invalidateQueries({ queryKey: KEY });
      setNoteDraft("");
    },
    onError: (e: any) => toast({ title: "Couldn't log that", description: e.message, variant: "destructive" }),
  });

  const pageUrl = fisPageUrl(l.kind, l.slug);
  const closed = FIS_CLOSED.includes(l.stage);
  const sendTo = l.contactEmail || l.email;
  const bg = Object.entries(l.background || {});
  const copy = async () => {
    try { await navigator.clipboard.writeText(pageUrl); toast({ title: "Link copied" }); }
    catch { toast({ title: "Couldn't copy", description: pageUrl }); }
  };

  return (
    <div className="flex flex-col min-h-full" data-testid="fis-drawer">
      <div className="sticky top-0 z-10 bg-[#141511] border-b border-white/5 px-5 py-4 space-y-3">
        <div className="flex items-center gap-2 pr-8">
          <button onClick={onPrev} disabled={!onPrev} className="h-9 w-9 grid place-items-center rounded-lg border border-white/10 text-white/60 disabled:opacity-30" aria-label="Previous" data-testid="fis-prev"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={onNext} disabled={!onNext} className="h-9 w-9 grid place-items-center rounded-lg border border-white/10 text-white/60 disabled:opacity-30" aria-label="Next" data-testid="fis-next"><ChevronRight className="w-4 h-4" /></button>
          {position && <span className="text-xs text-white/40">{position}</span>}
        </div>
        <div>
          <h2 className="text-lg font-bold text-white leading-tight break-words">{l.name}</h2>
          <p className="text-xs text-white/40 mt-0.5">
            {kindLabel(l.kind)}{l.leadGroup ? ` · ${l.leadGroup}` : ""}{l.returning ? " · worked with us before" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SelectInput value={l.stage} onChange={(e) => {
            const to = e.target.value as FisStage;
            if (FIS_CLOSED.includes(to)) onClose(to); else onPatch({ stage: to });
          }} aria-label="Stage" className={`${SEL} h-9 w-48`} data-testid="fis-stage-select">
            {FIS_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </SelectInput>
          {l.closedReason && <span className="text-xs px-2 py-1 rounded-full bg-white/[0.06] text-white/60">{fisReasonLabel(l.stage, l.closedReason)}</span>}
        </div>
      </div>

      <div className="px-5 py-4 space-y-5 flex-1">
        {/* Their proposal page */}
        <section className="rounded-xl border border-blue-500/20 bg-blue-500/[0.05] p-3 space-y-2" data-testid="fis-page">
          <p className="text-[11px] uppercase tracking-wider text-white/40">Their proposal page</p>
          <p className="text-[12.5px] text-white/70 break-all">{pageUrl.replace("https://", "")}</p>
          <div className="flex flex-wrap gap-2">
            {sendTo && (
              <a href={mailHref(l, sendTo)} data-testid="fis-email-page"
                className="h-10 px-3 rounded-lg bg-amber-500/90 text-black text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-500"><Mail className="w-4 h-4" />Email it to {l.contactEmail ? (l.contactName?.split(/\s+/)[0] || "them") : "the office"}</a>
            )}
            <a href={pageUrl} target="_blank" rel="noreferrer" className="h-10 px-3 rounded-lg border border-white/10 text-white/70 text-xs font-semibold flex items-center gap-1.5 hover:text-white"><ExternalLink className="w-4 h-4" />Open</a>
            <button onClick={copy} data-testid="fis-copy-link" className="h-10 px-3 rounded-lg border border-white/10 text-white/70 text-xs font-semibold flex items-center gap-1.5 hover:text-white"><Copy className="w-4 h-4" />Copy link</button>
          </div>
          <p className="text-[11px] text-white/35">After sending, tap <b>Emailed the page</b> below so it's logged and a follow-up is set.</p>
        </section>

        {/* Contact */}
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Who to talk to</p>
          <div className="flex flex-wrap gap-2">
            {telHref(l.contactPhone || l.phone) && (
              <a href={telHref(l.contactPhone || l.phone)!} className="h-10 px-3 rounded-lg border border-white/10 text-white/70 text-xs font-semibold flex items-center gap-1.5 hover:text-white"><Phone className="w-4 h-4" />Call {l.contactPhone ? "contact" : "office"}</a>
            )}
            {l.contactPhone && telHref(l.phone) && l.phone !== l.contactPhone && (
              <a href={telHref(l.phone)!} className="h-10 px-3 rounded-lg border border-white/10 text-white/70 text-xs font-semibold flex items-center gap-1.5 hover:text-white"><Phone className="w-4 h-4" />Call office</a>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ContactField label="Contact person" value={l.contactName} placeholder="Name" onSave={(v) => onPatch({ contactName: v })} testId="fis-contact-name" />
            <ContactField label="Their role" value={l.contactRole} placeholder="e.g. Sports coordinator" onSave={(v) => onPatch({ contactRole: v })} />
            <ContactField label="Their email" value={l.contactEmail} placeholder="email" onSave={(v) => onPatch({ contactEmail: v })} />
            <ContactField label="Their phone" value={l.contactPhone} placeholder="phone" onSave={(v) => onPatch({ contactPhone: v })} />
            <ContactField label="Office email" value={l.email} placeholder="office email" onSave={(v) => onPatch({ email: v })} />
            <ContactField label="Office phone" value={l.phone} placeholder="office phone" onSave={(v) => onPatch({ phone: v })} />
          </div>
          <div className="text-[12.5px] text-white/55 space-y-1 pt-1">
            {l.address && <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" />{l.address}</div>}
            {l.driveMin != null && <div className="flex items-center gap-1.5"><Car className="w-3.5 h-3.5 shrink-0" />{l.driveMin} min drive from United Sports Centre</div>}
            {l.website && <a href={l.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white break-all"><ExternalLink className="w-3.5 h-3.5 shrink-0" />{l.website.replace(/^https?:\/\//, "")}</a>}
            <div className="flex items-start gap-1.5"><History className="w-3.5 h-3.5 shrink-0 mt-0.5" />{l.deliveredText ? `Delivered: ${l.deliveredText}` : l.returning ? "Worked with us before (no dated sessions on record)" : "No sessions with us on record"}</div>
          </div>
        </section>

        {!closed && (
          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-white/35">Log what you did</p>
            <div className="flex flex-wrap gap-1.5">
              {FIS_QUICK_LOGS.map((q) => (
                <button key={q.key} onClick={() => log.mutate({ quick: q.key })} disabled={log.isPending} data-testid={`fis-quick-${q.key}`}
                  className="h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white/75 hover:bg-white/[0.08] disabled:opacity-50">{q.label}</button>
              ))}
            </div>
            <p className="text-[11px] text-white/35">Each one sets the next follow-up for you and moves the card forward. Move it to Meeting, Free session, Proposal or Booked yourself.</p>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wider text-white/35">Next follow-up</p>
            <DatePickerInput value={l.nextFollowUpOn ?? ""} disabled={closed}
              onChange={(e) => onPatch({ nextFollowUpOn: e.target.value || null })} className="h-10 w-full" />
            {!closed && (
              <div className="flex flex-wrap gap-1.5">
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
              <SelectInput value={l.ownerUserId != null ? String(l.ownerUserId) : ""} onChange={(e) => onPatch({ ownerUserId: e.target.value ? Number(e.target.value) : null })} aria-label="Owner" className={`${SEL} w-full`}>
                <option value="">Nobody yet</option>
                {team.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </SelectInput>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-white/35 flex items-center gap-1"><Flame className="w-3 h-3" />Priority</p>
              <div className="flex gap-1.5">
                {FIS_PRIORITIES.map((p) => (
                  <button key={p.key} onClick={() => onPatch({ priority: l.priority === p.key ? null : p.key })}
                    className={`h-9 flex-1 rounded-lg text-xs font-medium border ${l.priority === p.key ? `${PRIORITY_CLS[p.key]} border-transparent` : "border-white/10 text-white/50 hover:text-white"}`}>{p.label}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Notes</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (l.notes ?? "") && onPatch({ notes: notes || null })}
            rows={3} placeholder="Who decides, which days suit, budget, what they run now…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-amber-500/50" />
        </section>

        {bg.length > 0 && (
          <section className="rounded-xl border border-white/[0.06]" data-testid="fis-background">
            <button onClick={() => setShowBackground((v) => !v)} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
              <span className="text-[11px] uppercase tracking-wider text-white/40">From the outreach database <span className="normal-case tracking-normal text-white/30">— internal, never send</span></span>
              <ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${showBackground ? "" : "-rotate-90"}`} />
            </button>
            {showBackground && (
              <dl className="px-3 pb-3 space-y-2">
                {bg.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10.5px] uppercase tracking-wider text-white/35">{k}</dt>
                    <dd className="text-[12.5px] text-white/65 whitespace-pre-wrap break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}

        {!closed ? (
          <section className="flex flex-wrap gap-2">
            <button onClick={() => onClose("not_now")} data-testid="fis-not-now" className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white">Not now</button>
            <button onClick={() => onClose("not_a_fit")} className="h-10 px-3 rounded-lg bg-red-500/15 text-red-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-red-500/25"><Ban className="w-4 h-4" />Not a fit</button>
          </section>
        ) : (
          <button onClick={() => onPatch({ stage: "new" })} className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white">Re-open</button>
        )}

        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-white/35">History</p>
          <div className="flex gap-2">
            <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note…" data-testid="fis-note-input"
              onKeyDown={(e) => { if (e.key === "Enter" && noteDraft.trim()) log.mutate({ type: "note", note: noteDraft }); }}
              className="flex-1 h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-amber-500/50" />
            <button onClick={() => noteDraft.trim() && log.mutate({ type: "note", note: noteDraft })} disabled={!noteDraft.trim() || log.isPending} aria-label="Add note"
              className="h-10 px-3 rounded-lg bg-white/10 text-xs font-semibold text-white disabled:opacity-40"><StickyNote className="w-4 h-4" /></button>
          </div>
          {actsLoading ? <p className="text-xs text-white/30">Loading…</p> : acts.length === 0 ? (
            <p className="text-xs text-white/30">{l.sheetStatus ? `Nothing logged here yet. The outreach database said: “${l.sheetStatus}”.` : "Nothing logged yet."}</p>
          ) : (
            <ol className="space-y-2" data-testid="fis-timeline">
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
    const to = fisStageLabel(a.toStage || "");
    const why = a.note ? ` — ${a.note}` : "";
    return a.fromStage ? `Moved from ${fisStageLabel(a.fromStage)} to ${to}${why}` : `Moved to ${to}${why}`;
  }
  const q = FIS_QUICK_LOGS.find((x) => x.type === a.type && x.outcome === a.outcome);
  if (q) return q.label;
  return { call: "Call", email: "Email", visit: "Visit", note: "Note" }[a.type] || a.type;
}

function CloseDialog({ ids, stage, onCancel, onConfirm }: {
  ids: number[]; stage: FisStage; onCancel: () => void; onConfirm: (reason: string, note: string) => void;
}) {
  const reasons = stage === "not_a_fit" ? NOT_A_FIT_REASONS : NOT_NOW_REASONS;
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md bg-[#141511] border-white/10" data-testid="fis-close-dialog">
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white">{stage === "not_a_fit" ? "Not a fit" : "Not now"}{ids.length > 1 ? ` — ${ids.length} selected` : ""}</h3>
            <p className="text-xs text-white/45 mt-1">Nothing is deleted. It moves to the {fisStageLabel(stage)} column and can be re-opened.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {reasons.map((r) => (
              <button key={r.key} onClick={() => setReason(r.key)} data-testid={`fis-reason-${r.key}`}
                className={`min-h-10 px-3 py-2 rounded-lg border text-xs font-medium text-left ${reason === r.key ? "border-amber-500/60 bg-amber-500/10 text-amber-200" : "border-white/10 text-white/60 hover:text-white"}`}>{r.label}</button>
            ))}
          </div>
          {ids.length === 1 && (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to add? (optional)"
              className="w-full h-10 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white placeholder:text-white/25 outline-none" />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="h-10 px-4 rounded-lg text-xs text-white/60 hover:text-white"><X className="w-4 h-4 inline mr-1" />Cancel</button>
            <button onClick={() => reason && onConfirm(reason, note)} disabled={!reason} data-testid="fis-close-confirm"
              className="h-10 px-4 rounded-lg bg-amber-500 text-black text-xs font-semibold disabled:opacity-40">Confirm</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
