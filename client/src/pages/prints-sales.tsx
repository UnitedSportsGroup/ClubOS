// ─────────────────────────────────────────────────────────────────────────────
// SALES — United Print prospect database + pipeline. Prints workspace,
// super-admin only (see server/sales-routes.ts: "sales" is a
// SUPER_ADMIN_ONLY_TAB while Daniel shapes it).
//
// Three views over one dataset:
//   Prospects — the ranked database (search + tier/category/region/stage filters)
//   Pipeline  — kanban, drag a card to move its stage
//   Call list — the dialing queue: overdue follow-ups first, then due-today,
//               then the best un-called prospects by score. Quick outcome
//               buttons log the call and carry their consequences (follow-up
//               date, obvious stage moves) in one tap.
//
// Stage changes always go through PATCH { stage } — the server writes the
// activity trail and promotes won deals into the CRM tab; this file never
// fakes any of that locally. `today` comes from the API response, never the
// browser clock (UTC reads a day behind in NZ). Dates render by splitting the
// ISO string — never through `new Date()`.
//
// House style copied from group-vehicles.tsx / group-sponsorship.tsx: stat
// chips that filter, a shadcn Dialog for create/edit, inline <SelectInput>
// mutations, dark-glass Tailwind, page-local types mirroring the server.
// ─────────────────────────────────────────────────────────────────────────────

import { DatePickerInput } from "@/components/ui/date-picker-input";
// 🔴 Never a bare <SelectInput>: its option panel is painted by the OS, so it is
// dark-on-light on one machine and fine on another. Drawn by us instead.
import { SelectInput } from "@/components/ui/select-input";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { centsToDollarInput, dollarInputToCents, formatCurrency } from "@/lib/format";
import {
  PhoneCall, Phone, Mail, Plus, Search, ExternalLink, Trash2, Globe,
  CalendarClock, ClipboardList, TrendingUp, Award, CheckCircle2, Send,
} from "lucide-react";
import {
  SALES_STAGES, SALES_OUTCOMES, SALES_TIERS, SALES_REGIONS,
  followUpStatus, addDaysIso, stageLabel,
  outreachEmailDraft, isSharedInbox, firstNameOf, OUTREACH_FOOTER,
  type SalesStage, type SalesOutcome, type FollowUpStatus,
} from "@shared/sales";

// ── Types (mirror server/sales-routes.ts response shapes) ────────────────────
interface Prospect {
  id: number;
  organizationId: number;
  name: string;
  website: string | null;
  city: string | null;
  region: string | null;
  category: string | null;
  subcategory: string | null;
  whyFit: string | null;
  servicesMatch: string[] | null;
  contactName: string | null;
  contactRole: string | null;
  email: string | null;
  phone: string | null;
  evidenceUrl: string | null;
  fetchedAt: string | null;
  linkStatus: string | null;
  fitScore: number | null;
  volumeScore: number | null;
  accessScore: number | null;
  localityScore: number | null;
  totalScore: number | null;
  tier: string | null;
  rank: number | null;
  source: string;
  stage: SalesStage;
  stageChangedAt: string | null;
  nextFollowUpOn: string | null;
  declinedReason: string | null;
  dealValueCents: number | null;
  promotedContactId: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Activity {
  id: number;
  prospectId: number;
  type: string;
  outcome: string | null;
  note: string | null;
  occurredAt: string;
}

interface Summary {
  total: number;
  byStage: Record<string, number>;
  byTier: Record<string, number>;
  followUpsDue: number;
  pipelineValueCents: number;
  wonValueCents: number;
  paidValueCents: number;
}

interface ListResponse {
  prospects: Prospect[];
  summary: Summary;
  today: string;
}

const LIST_KEY = ["/api/admin/sales/prospects"];

// ── Small render helpers ─────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-07-17" → "17 Jul" by splitting the string — never `new Date()`. */
function formatNzDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

const money = (cents: number) => formatCurrency(cents, { fromCents: true, decimals: 0 });

const TIER_STYLES: Record<string, string> = {
  A: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  B: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  C: "bg-white/[0.06] text-white/50 border-white/10",
};

function TierPill({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-white/25 text-[10px]">—</span>;
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${TIER_STYLES[tier] ?? TIER_STYLES.C}`}>
      {tier}
    </span>
  );
}

const FOLLOWUP_DOT: Record<FollowUpStatus, string> = {
  overdue: "bg-red-400",
  due_today: "bg-amber-400",
  upcoming: "bg-sky-400",
  scheduled: "bg-white/25",
  none: "",
};

function StagePill({ stage }: { stage: SalesStage }) {
  const s = SALES_STAGES.find((x) => x.key === stage);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
      style={{ borderColor: `${s?.color}55`, background: `${s?.color}18`, color: "white" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s?.color }} />
      {s?.label ?? stage}
    </span>
  );
}

const OUTCOME_LABELS: Record<SalesOutcome, string> = {
  no_answer: "No answer",
  left_message: "Left message",
  gatekeeper: "Gatekeeper",
  callback: "Callback",
  interested: "Interested",
  not_interested: "Not interested",
  call_booked: "Call booked",
  other: "Other",
};

// ── Page ─────────────────────────────────────────────────────────────────────

type View = "prospects" | "pipeline" | "call";

export default function PrintsSales() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ListResponse>({ queryKey: LIST_KEY });

  const prospects = data?.prospects ?? [];
  const summary = data?.summary;
  // Server-supplied NZ calendar date. Empty string until the first response —
  // follow-up badges render neutral rather than guessing from the browser clock.
  const today = data?.today ?? "";

  // ?view=pipeline / ?view=call deep-links straight to a view — bookmarkable
  // (the Call list is the one Daniel opens every calling session).
  const [view, setView] = useState<View>(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    return v === "pipeline" || v === "call" ? v : "prospects";
  });
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [emailId, setEmailId] = useState<number | null>(null);
  const emailProspect = emailId === null ? null : prospects.find((p) => p.id === emailId) ?? null;

  const categories = useMemo(
    () => Array.from(new Set(prospects.map((p) => p.category).filter(Boolean) as string[])).sort(),
    [prospects],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects.filter((p) => {
      if (tierFilter && p.tier !== tierFilter) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (regionFilter && p.region !== regionFilter) return false;
      if (stageFilter && p.stage !== stageFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.city ?? ""} ${p.category ?? ""} ${p.contactName ?? ""} ${p.email ?? ""} ${p.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [prospects, search, tierFilter, categoryFilter, regionFilter, stageFilter]);

  const saveProspect = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/admin/sales/prospects/${id}`, payload);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sales/prospects", String(vars.id)] });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const logActivity = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => {
      const res = await apiRequest("POST", `/api/admin/sales/prospects/${id}/activities`, payload);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sales/prospects", String(vars.id)] });
    },
    onError: (e: Error) => toast({ title: "Couldn't log that", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06] space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-emerald-400" /> Sales
            </h1>
            <p className="text-[11px] text-white/40">
              The prospect database and pipeline — every row researched and grounded, every call logged.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            data-testid="button-add-prospect"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add prospect
          </button>
        </div>

        {/* Stat chips */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatChip icon={<ClipboardList className="w-3.5 h-3.5" />} label="Prospects" value={String(summary.total)} accent="#38bdf8" />
            <StatChip
              icon={<Award className="w-3.5 h-3.5" />}
              label="Tier A"
              value={String(summary.byTier.A ?? 0)}
              accent="#f59e0b"
              active={tierFilter === "A"}
              onClick={() => setTierFilter(tierFilter === "A" ? null : "A")}
            />
            <StatChip
              icon={<CalendarClock className="w-3.5 h-3.5" />}
              label="Follow-ups due"
              value={String(summary.followUpsDue)}
              accent={summary.followUpsDue > 0 ? "#f87171" : "#64748b"}
              active={view === "call"}
              onClick={() => setView("call")}
            />
            <StatChip icon={<TrendingUp className="w-3.5 h-3.5" />} label="Pipeline" value={money(summary.pipelineValueCents)} accent="#f97316" />
            <StatChip icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Won" value={money(summary.wonValueCents)} accent="#22c55e" />
            <StatChip icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Paid" value={money(summary.paidValueCents)} accent="#10b981" />
          </div>
        )}

        {/* View switch + filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs">
            {([
              ["prospects", "Prospects"],
              ["pipeline", "Pipeline"],
              ["call", "Call list"],
            ] as Array<[View, string]>).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                data-testid={`view-${k}`}
                className={`px-3 py-1.5 font-semibold transition ${view === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, city, contact…"
              data-testid="input-search"
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs placeholder:text-white/25 focus:outline-none focus:border-white/25"
            />
          </div>

          <FilterSelect value={tierFilter ?? ""} onChange={(v) => setTierFilter(v || null)} label="All tiers">
            {SALES_TIERS.map((t) => <option key={t} value={t}>Tier {t}</option>)}
          </FilterSelect>
          <FilterSelect value={categoryFilter} onChange={setCategoryFilter} label="All categories">
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </FilterSelect>
          <FilterSelect value={regionFilter} onChange={setRegionFilter} label="All regions">
            {SALES_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </FilterSelect>
          {view === "prospects" && (
            <FilterSelect value={stageFilter} onChange={setStageFilter} label="All stages">
              {SALES_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </FilterSelect>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-white/40">Loading the database…</div>
        ) : prospects.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-white/60">No prospects yet.</p>
            <p className="text-xs text-white/35">Seed the researched database, or add your first prospect by hand.</p>
          </div>
        ) : view === "prospects" ? (
          <ProspectsTable rows={filtered} today={today} onOpen={setDetailId} onEmail={setEmailId} onStage={(id, stage) => saveProspect.mutate({ id, payload: { stage } })} />
        ) : view === "pipeline" ? (
          <PipelineBoard rows={filtered} today={today} onOpen={setDetailId} onMove={(id, stage) => saveProspect.mutate({ id, payload: { stage } })} />
        ) : (
          <CallList rows={filtered} today={today} onOpen={setDetailId} onQuickLog={(id, payload) => logActivity.mutate({ id, payload })} />
        )}
      </div>

      {detailId !== null && (
        <ProspectDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onSave={(payload) => saveProspect.mutate({ id: detailId, payload })}
          onLog={(payload) => logActivity.mutate({ id: detailId, payload })}
          onEmail={() => setEmailId(detailId)}
        />
      )}
      {emailProspect && <EmailDialog prospect={emailProspect} today={today} onClose={() => setEmailId(null)} />}
      {showAdd && <AddProspectDialog categories={categories} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function StatChip({ icon, label, value, accent, active, onClick }: {
  icon: React.ReactNode; label: string; value: string; accent: string; active?: boolean; onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-xl border p-2.5 text-left transition ${active ? "border-white/30 bg-white/[0.07]" : "border-white/[0.06] bg-white/[0.02]"} ${onClick ? "hover:bg-white/[0.05] cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/40 mb-1">
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </div>
      <div className="text-base font-semibold text-white tabular-nums">{value}</div>
    </Comp>
  );
}

function FilterSelect({ value, onChange, label, children }: {
  value: string; onChange: (v: string) => void; label: string; children: React.ReactNode;
}) {
  return (
    <SelectInput
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/25"
    >
      <option value="">{label}</option>
      {children}
    </SelectInput>
  );
}

// ── Prospects table ──────────────────────────────────────────────────────────

function ProspectsTable({ rows, today, onOpen, onEmail, onStage }: {
  rows: Prospect[]; today: string;
  onOpen: (id: number) => void;
  onEmail: (id: number) => void;
  onStage: (id: number, stage: SalesStage) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[1000px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-white/35 border-b border-white/[0.06]">
            <th className="text-left font-medium px-3 py-2">#</th>
            <th className="text-left font-medium px-2 py-2">Tier</th>
            <th className="text-left font-medium px-2 py-2">Prospect</th>
            <th className="text-left font-medium px-2 py-2">Category</th>
            <th className="text-left font-medium px-2 py-2">Phone</th>
            <th className="text-left font-medium px-2 py-2">Email</th>
            <th className="px-2 py-2"><span className="sr-only">Send email</span></th>
            <th className="text-left font-medium px-2 py-2">Stage</th>
            <th className="text-left font-medium px-2 py-2">Follow-up</th>
            <th className="text-right font-medium px-3 py-2">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const fu = followUpStatus(p.nextFollowUpOn, today || "9999-12-31");
            return (
              <tr
                key={p.id}
                onClick={() => onOpen(p.id)}
                data-testid={`row-prospect-${p.id}`}
                className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer"
              >
                <td className="px-3 py-2 text-white/30 tabular-nums">{p.rank ?? "—"}</td>
                <td className="px-2 py-2"><TierPill tier={p.tier} /></td>
                <td className="px-2 py-2">
                  <div className="font-medium text-white/90 truncate max-w-[220px]">{p.name}</div>
                  <div className="text-[10px] text-white/35 truncate max-w-[220px]">{[p.city, p.region].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="px-2 py-2 text-white/50 whitespace-nowrap">{p.category ?? "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {p.phone ? (
                    <a href={`tel:${p.phone.replace(/\s+/g, "")}`} className="text-emerald-300/90 hover:text-emerald-200 inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {p.phone}
                    </a>
                  ) : <span className="text-white/25">—</span>}
                </td>
                <td className="px-2 py-2 whitespace-nowrap max-w-[180px] truncate" onClick={(e) => e.stopPropagation()}>
                  {p.email ? (
                    <a href={`mailto:${p.email}`} className="text-sky-300/80 hover:text-sky-200 truncate">{p.email}</a>
                  ) : <span className="text-white/25">—</span>}
                </td>
                <td className="px-2 py-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {/* Only for leads nobody has contacted yet — once it's sent the
                      row moves to Contacted and the button steps aside. The
                      detail view can still write to anyone. */}
                  {p.email && p.stage === "new" && (
                    <button
                      onClick={() => onEmail(p.id)}
                      data-testid={`button-email-${p.id}`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition"
                    >
                      <Send className="w-3 h-3" /> Send email
                    </button>
                  )}
                </td>
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <SelectInput
                    value={p.stage}
                    onChange={(e) => onStage(p.id, e.target.value as SalesStage)}
                    className="bg-transparent border border-white/10 rounded px-1.5 py-1 text-[11px] text-white/70 focus:outline-none"
                  >
                    {SALES_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </SelectInput>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {p.nextFollowUpOn ? (
                    <span className="inline-flex items-center gap-1.5 text-white/60">
                      {fu !== "none" && <span className={`w-1.5 h-1.5 rounded-full ${FOLLOWUP_DOT[fu]}`} />}
                      {formatNzDate(p.nextFollowUpOn)}
                    </span>
                  ) : <span className="text-white/25">—</span>}
                </td>
                <td className="px-3 py-2 text-right text-white/60 tabular-nums">{p.totalScore ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-8 text-center text-xs text-white/35">Nothing matches those filters.</div>}
    </div>
  );
}

// ── Pipeline board ───────────────────────────────────────────────────────────

function PipelineBoard({ rows, today, onOpen, onMove }: {
  rows: Prospect[]; today: string;
  onOpen: (id: number) => void;
  onMove: (id: number, stage: SalesStage) => void;
}) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<SalesStage | null>(null);

  const byStage = useMemo(() => {
    const m = new Map<SalesStage, Prospect[]>();
    for (const s of SALES_STAGES) m.set(s.key, []);
    for (const p of rows) m.get(p.stage)?.push(p);
    return m;
  }, [rows]);

  return (
    <div className="flex gap-3 p-4 min-w-max">
      {SALES_STAGES.map((s) => {
        const items = byStage.get(s.key) || [];
        const totalCents = items.reduce((sum, p) => sum + (p.dealValueCents || 0), 0);
        const isDropTarget = dropTarget === s.key;
        return (
          <div
            key={s.key}
            className={`w-64 flex-shrink-0 flex flex-col rounded-xl border transition-colors ${
              isDropTarget ? "border-emerald-500/50 bg-emerald-500/[0.06]" : "border-white/[0.06] bg-white/[0.02]"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDropTarget(s.key); }}
            onDragLeave={() => setDropTarget((c) => (c === s.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              if (draggingId == null) return;
              const p = rows.find((x) => x.id === draggingId);
              if (p && p.stage !== s.key) onMove(draggingId, s.key);
              setDraggingId(null);
            }}
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.04]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="text-sm font-semibold truncate">{s.label}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-white/40 flex-shrink-0">
                <span>{items.length}</span>
                {totalCents > 0 && <span className="text-white/60 font-medium">{money(totalCents)}</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px] max-h-[calc(100vh-330px)]">
              {items.length === 0 ? (
                <div className="w-full text-[11px] text-white/25 italic py-3 text-center rounded border border-dashed border-white/10">
                  {isDropTarget ? "Drop here" : "Empty"}
                </div>
              ) : items.map((p) => {
                const fu = followUpStatus(p.nextFollowUpOn, today || "9999-12-31");
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => { setDraggingId(p.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                    onClick={() => onOpen(p.id)}
                    style={{ opacity: draggingId === p.id ? 0.4 : 1 }}
                    className="rounded-lg border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] p-2.5 cursor-pointer space-y-1.5"
                    data-testid={`card-prospect-${p.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-white/90 leading-tight">{p.name}</span>
                      <TierPill tier={p.tier} />
                    </div>
                    <div className="text-[10px] text-white/35 truncate">{[p.category, p.city].filter(Boolean).join(" · ")}</div>
                    <div className="flex items-center gap-2 text-[10px] text-white/45">
                      {p.phone && <Phone className="w-3 h-3 text-emerald-400/70" />}
                      {p.email && <Mail className="w-3 h-3 text-sky-400/70" />}
                      {(fu === "overdue" || fu === "due_today") && (
                        <span className={`inline-flex items-center gap-1 ${fu === "overdue" ? "text-red-300" : "text-amber-300"}`}>
                          <CalendarClock className="w-3 h-3" /> {formatNzDate(p.nextFollowUpOn)}
                        </span>
                      )}
                      {p.dealValueCents ? <span className="ml-auto text-white/60 font-medium">{money(p.dealValueCents)}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Call list — the dialing queue ────────────────────────────────────────────

const QUICK_OUTCOMES: Array<{ outcome: SalesOutcome; label: string; moveStage?: SalesStage; followUpDays?: number }> = [
  { outcome: "no_answer", label: "No answer", followUpDays: 3 },
  { outcome: "left_message", label: "Left message", followUpDays: 3 },
  { outcome: "gatekeeper", label: "Gatekeeper", followUpDays: 5 },
  { outcome: "callback", label: "Callback", followUpDays: 1 },
  { outcome: "interested", label: "Interested", moveStage: "contacted", followUpDays: 2 },
  { outcome: "call_booked", label: "Call booked", moveStage: "call_booked" },
  { outcome: "not_interested", label: "Not interested", moveStage: "declined" },
];

function CallList({ rows, today, onOpen, onQuickLog }: {
  rows: Prospect[]; today: string;
  onOpen: (id: number) => void;
  onQuickLog: (id: number, payload: Record<string, unknown>) => void;
}) {
  // The queue: callable prospects only (live stage + a phone number), overdue
  // follow-ups first, then due today, then fresh Tier-A/-B by score.
  const queue = useMemo(() => {
    const t = today || "9999-12-31";
    const callable = rows.filter((p) => p.phone && !["declined", "won", "paid"].includes(p.stage));
    const bucket = (p: Prospect) => {
      const fu = followUpStatus(p.nextFollowUpOn, t);
      if (fu === "overdue") return 0;
      if (fu === "due_today") return 1;
      if (p.stage === "new") return 2;
      return 3;
    };
    return callable.sort((a, b) => bucket(a) - bucket(b) || (b.totalScore ?? 0) - (a.totalScore ?? 0));
  }, [rows, today]);

  return (
    // Full width — the queue was pinned to max-w-3xl and left half the screen
    // empty, which wasted the room the "why they fit" blurb actually needs.
    <div className="p-4 space-y-2">
      <p className="text-[11px] text-white/35">
        {queue.length} callable prospect{queue.length === 1 ? "" : "s"} — overdue follow-ups first, then today's, then the best fresh leads. One tap logs the call and sets the follow-up.
      </p>
      {queue.map((p) => {
        const fu = followUpStatus(p.nextFollowUpOn, today || "9999-12-31");
        return (
          <div key={p.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2" data-testid={`call-row-${p.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <button onClick={() => onOpen(p.id)} className="text-sm font-semibold text-white/90 hover:text-white text-left">
                  {p.name}
                </button>
                <div className="text-[11px] text-white/40 flex items-center gap-2 flex-wrap">
                  <TierPill tier={p.tier} />
                  <span>{[p.category, p.city].filter(Boolean).join(" · ")}</span>
                  <StagePill stage={p.stage} />
                  {fu === "overdue" && <span className="text-red-300 font-medium">follow-up overdue ({formatNzDate(p.nextFollowUpOn)})</span>}
                  {fu === "due_today" && <span className="text-amber-300 font-medium">follow-up today</span>}
                </div>
                {p.whyFit && <p className="text-[11px] text-white/45 mt-1 max-w-4xl">{p.whyFit}</p>}
              </div>
              <a
                href={`tel:${p.phone!.replace(/\s+/g, "")}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold text-sm hover:bg-emerald-500/25 transition flex-shrink-0"
                data-testid={`call-phone-${p.id}`}
              >
                <PhoneCall className="w-4 h-4" /> {p.phone}
              </a>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {QUICK_OUTCOMES.map((q) => (
                <button
                  key={q.outcome}
                  onClick={() => {
                    const payload: Record<string, unknown> = { type: "call", outcome: q.outcome };
                    if (q.moveStage) payload.moveStage = q.moveStage;
                    if (q.followUpDays && today) payload.nextFollowUpOn = addDaysIso(today, q.followUpDays);
                    if (q.outcome === "not_interested") payload.nextFollowUpOn = null;
                    onQuickLog(p.id, payload);
                  }}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition ${
                    q.outcome === "not_interested"
                      ? "border-red-500/30 text-red-300/80 hover:bg-red-500/10"
                      : q.outcome === "call_booked" || q.outcome === "interested"
                        ? "border-emerald-500/30 text-emerald-300/90 hover:bg-emerald-500/10"
                        : "border-white/10 text-white/50 hover:bg-white/[0.06]"
                  }`}
                  data-testid={`quick-${q.outcome}-${p.id}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {queue.length === 0 && <div className="p-8 text-center text-xs text-white/35">Nothing to call — the queue is clear.</div>}
    </div>
  );
}

// ── Detail dialog ────────────────────────────────────────────────────────────

interface DetailResponse {
  prospect: Prospect;
  activities: Activity[];
  today: string;
}

function ProspectDetail({ id, onClose, onSave, onLog, onEmail }: {
  id: number;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  onLog: (payload: Record<string, unknown>) => void;
  onEmail: () => void;
}) {
  const { toast } = useToast();
  const { data } = useQuery<DetailResponse>({ queryKey: ["/api/admin/sales/prospects", String(id)] });
  const p = data?.prospect;

  const [notes, setNotes] = useState<string | null>(null);
  const [dealValue, setDealValue] = useState<string | null>(null);
  const [logNote, setLogNote] = useState("");
  const [logType, setLogType] = useState("call");
  const [logOutcome, setLogOutcome] = useState<string>("");

  const del = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/sales/prospects/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      toast({ title: "Prospect deleted" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  if (!p) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl bg-neutral-950 border-white/10 text-white">
          <div className="p-6 text-sm text-white/40">Loading…</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl bg-neutral-950 border-white/10 text-white max-h-[85vh] overflow-y-auto">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                {p.name} <TierPill tier={p.tier} />
              </h2>
              <div className="text-[11px] text-white/40 flex items-center gap-2 flex-wrap mt-0.5">
                <span>{[p.category, p.subcategory, p.city, p.region].filter(Boolean).join(" · ")}</span>
                {p.totalScore != null && <span>score {p.totalScore}</span>}
                {p.source === "research-fleet" && <span className="text-emerald-300/60">researched</span>}
              </div>
            </div>
            <SelectInput
              value={p.stage}
              onChange={(e) => onSave({ stage: e.target.value })}
              className="bg-white/[0.05] border border-white/15 rounded-lg px-2 py-1.5 text-xs font-semibold focus:outline-none"
              data-testid="detail-stage"
            >
              {SALES_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </SelectInput>
          </div>

          {/* Contact card */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="space-y-1.5">
              {p.phone ? (
                <a href={`tel:${p.phone.replace(/\s+/g, "")}`} className="flex items-center gap-2 text-emerald-300 hover:text-emerald-200 font-semibold">
                  <PhoneCall className="w-3.5 h-3.5" /> {p.phone}
                </a>
              ) : <span className="flex items-center gap-2 text-white/30"><Phone className="w-3.5 h-3.5" /> no phone on file</span>}
              {p.email ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`mailto:${p.email}`} className="flex items-center gap-2 text-sky-300 hover:text-sky-200">
                    <Mail className="w-3.5 h-3.5" /> {p.email}
                  </a>
                  <button
                    onClick={onEmail}
                    data-testid="detail-send-email"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition"
                  >
                    <Send className="w-3 h-3" /> Write email
                  </button>
                </div>
              ) : <span className="flex items-center gap-2 text-white/30"><Mail className="w-3.5 h-3.5" /> no email on file</span>}
              {(p.contactName || p.contactRole) && (
                <div className="text-white/60">{[p.contactName, p.contactRole].filter(Boolean).join(" — ")}</div>
              )}
            </div>
            <div className="space-y-1.5">
              {p.website && (
                <a href={p.website.startsWith("http") ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-white/60 hover:text-white/90 truncate">
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" /> {p.website.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              )}
              {p.evidenceUrl && (
                <a href={p.evidenceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-white/40 hover:text-white/70 truncate">
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" /> evidence · fetched {formatNzDate(p.fetchedAt)}
                </a>
              )}
              {p.servicesMatch && p.servicesMatch.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {p.servicesMatch.map((s) => (
                    <span key={s} className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-white/50">{s}</span>
                  ))}
                </div>
              )}
            </div>
            {p.whyFit && <p className="sm:col-span-2 text-white/55 border-t border-white/[0.05] pt-2">{p.whyFit}</p>}
          </div>

          {/* Pipeline fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-[10px] uppercase tracking-wider text-white/40 space-y-1">
              <span>Next follow-up</span>
              <DatePickerInput
                value={p.nextFollowUpOn ?? ""}
                onChange={(e) => onSave({ nextFollowUpOn: e.target.value || null })}
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-white/25 [color-scheme:dark]"
              />
            </label>
            <label className="text-[10px] uppercase tracking-wider text-white/40 space-y-1">
              <span>Deal value</span>
              <MoneyInput
                value={dealValue ?? centsToDollarInput(p.dealValueCents)}
                onChange={setDealValue}
                onBlur={() => { if (dealValue !== null) onSave({ dealValueCents: dealValue === "" ? null : dollarInputToCents(dealValue) }); }}
                className="bg-white/[0.04] border-white/10 text-xs h-8"
              />
            </label>
            {p.stage === "declined" && (
              <label className="text-[10px] uppercase tracking-wider text-white/40 space-y-1">
                <span>Declined because</span>
                <input
                  defaultValue={p.declinedReason ?? ""}
                  onBlur={(e) => e.target.value !== (p.declinedReason ?? "") && onSave({ declinedReason: e.target.value || null })}
                  placeholder="price / timing / has a supplier…"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none"
                />
              </label>
            )}
          </div>

          {/* Notes */}
          <label className="block text-[10px] uppercase tracking-wider text-white/40 space-y-1">
            <span>Notes</span>
            <textarea
              value={notes ?? p.notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== null && notes !== (p.notes ?? "")) onSave({ notes }); }}
              rows={3}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/25 resize-y"
              placeholder="What matters about this prospect…"
            />
          </label>

          {/* Log an activity */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/40">Log activity</div>
            <div className="flex gap-2 flex-wrap">
              <SelectInput value={logType} onChange={(e) => setLogType(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs">
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="meeting">Meeting</option>
                <option value="note">Note</option>
              </SelectInput>
              <SelectInput value={logOutcome} onChange={(e) => setLogOutcome(e.target.value)} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs">
                <option value="">Outcome…</option>
                {SALES_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
              </SelectInput>
              <input
                value={logNote}
                onChange={(e) => setLogNote(e.target.value)}
                placeholder="What happened…"
                className="flex-1 min-w-[160px] bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs placeholder:text-white/25 focus:outline-none"
              />
              <button
                onClick={() => {
                  onLog({ type: logType, outcome: logOutcome || null, note: logNote || null });
                  setLogNote(""); setLogOutcome("");
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition"
                data-testid="button-log-activity"
              >
                Log
              </button>
            </div>
          </div>

          {/* Activity timeline */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-white/40">History</div>
            {(data?.activities ?? []).length === 0 ? (
              <p className="text-xs text-white/30 italic">No activity yet — this prospect hasn't been touched.</p>
            ) : (
              (data?.activities ?? []).map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-xs border-b border-white/[0.04] pb-1.5">
                  <span className="text-white/30 whitespace-nowrap tabular-nums">{a.occurredAt.slice(0, 10)}</span>
                  <span className="text-white/55 font-medium whitespace-nowrap">{a.type === "stage_change" ? "stage" : a.type}</span>
                  {a.outcome && <span className="text-white/45">{OUTCOME_LABELS[a.outcome as SalesOutcome] ?? a.outcome}</span>}
                  {a.note && (a.type === "email" && a.note.includes("\n\n") ? (
                    <details className="text-white/40 min-w-0">
                      <summary className="cursor-pointer">{a.note.split("\n\n")[0].split("\n").join(" · ")}</summary>
                      <div className="whitespace-pre-line mt-1 text-white/50">{a.note.split("\n\n").slice(1).join("\n\n")}</div>
                    </details>
                  ) : <span className="text-white/40">{a.note}</span>)}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => del.mutate()}
              className="inline-flex items-center gap-1.5 text-[11px] text-red-300/60 hover:text-red-300 transition"
              data-testid="button-delete-prospect"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete (mistakes only — declined keeps the history)
            </button>
            <span className="text-[10px] text-white/25">
              {p.stageChangedAt ? `stage since ${p.stageChangedAt.slice(0, 10)}` : ""}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Send email ───────────────────────────────────────────────────────────────
// A draft written from what the research fleet found (first name, business,
// what that kind of buyer orders), then made bespoke by a human. The server
// sends exactly what is here plus a fixed legal footer, and only once it has
// gone does it log the email and move New → Contacted.

interface Me { firstName: string; lastName: string; email: string }

const draftKey = (id: number) => `sales-email-draft-${id}`;
function readDraft(id: number): { to: string; subject: string; body: string } | null {
  try { const raw = sessionStorage.getItem(draftKey(id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeDraft(id: number, d: { to: string; subject: string; body: string } | null) {
  try { d ? sessionStorage.setItem(draftKey(id), JSON.stringify(d)) : sessionStorage.removeItem(draftKey(id)); } catch { /* private mode */ }
}

function EmailDialog({ prospect: p, today, onClose }: { prospect: Prospect; today: string; onClose: () => void }) {
  const { toast } = useToast();
  const { data: me } = useQuery<Me>({ queryKey: ["/api/auth/me"] });
  const template = () => outreachEmailDraft(p, { firstName: me?.firstName ?? "", lastName: me?.lastName ?? "" });

  const saved = useMemo(() => readDraft(p.id), [p.id]);
  const [to, setTo] = useState(saved?.to ?? p.email ?? "");
  const [subject, setSubject] = useState<string | null>(saved?.subject ?? null);
  const [body, setBody] = useState<string | null>(saved?.body ?? null);
  // The draft is signed with the sender's name, which arrives with /auth/me.
  // Until the person types, it follows the template; after that it is theirs.
  const shownSubject = subject ?? template().subject;
  const shownBody = body ?? (me ? template().body : "");
  const [followUp, setFollowUp] = useState(p.nextFollowUpOn ?? (today ? addDaysIso(today, 4) : ""));

  const edit = (patch: Partial<{ to: string; subject: string; body: string }>) => {
    const next = { to, subject: shownSubject, body: shownBody, ...patch };
    if (patch.to !== undefined) setTo(patch.to);
    if (patch.subject !== undefined) setSubject(patch.subject);
    if (patch.body !== undefined) setBody(patch.body);
    writeDraft(p.id, next);
  };

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/sales/prospects/${p.id}/email`, {
        to: to.trim(), subject: shownSubject.trim(), body: shownBody, nextFollowUpOn: followUp || null,
      });
      return res.json();
    },
    onSuccess: () => {
      writeDraft(p.id, null);
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sales/prospects", String(p.id)] });
      toast({ title: `Email sent to ${p.name}`, description: p.stage === "new" ? "Moved to Contacted and logged in the history." : "Logged in the history." });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Email not sent", description: e.message, variant: "destructive" }),
  });

  const first = firstNameOf(p.contactName);
  const shared = isSharedInbox(to);
  const canSend = !!me && to.includes("@") && shownSubject.trim().length > 0 && shownBody.trim().length >= 20 && !send.isPending;
  const field = "w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25";

  return (
    <Dialog open onOpenChange={(o) => !o && !send.isPending && onClose()}>
      <DialogContent className="max-w-2xl w-[calc(100vw-1.5rem)] bg-neutral-950 border-white/10 text-white max-h-[90vh] overflow-y-auto">
        <div className="space-y-3 min-w-0">
          <div className="pr-6">
            <h2 className="text-base font-semibold flex items-center gap-2"><Send className="w-4 h-4 text-sky-300" /> Email {p.name}</h2>
            <p className="text-[11px] text-white/45 mt-0.5">
              {[p.contactName, p.contactRole].filter(Boolean).join(" — ") || "No named contact"}{p.category ? ` · ${p.category}` : ""}
            </p>
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-white/40">To</span>
            <input value={to} onChange={(e) => edit({ to: e.target.value })} className={field} data-testid="email-to" inputMode="email" />
          </label>
          {shared && first && (
            <p className="text-[11px] text-amber-300/80 -mt-1">
              This is a shared inbox, so {first} may only see it if someone passes it on.
            </p>
          )}

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-white/40">Subject</span>
            <input value={shownSubject} onChange={(e) => edit({ subject: e.target.value })} className={field} data-testid="email-subject" />
          </label>

          <label className="block space-y-1">
            <span className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/40">
              <span>Message — make it theirs</span>
              {(subject !== null || body !== null) && (
                <button
                  type="button"
                  onClick={() => { setSubject(null); setBody(null); writeDraft(p.id, null); }}
                  className="normal-case tracking-normal text-[11px] text-white/45 hover:text-white/80"
                >
                  Start again from the template
                </button>
              )}
            </span>
            <textarea
              value={shownBody}
              onChange={(e) => edit({ body: e.target.value })}
              rows={14}
              className={`${field} leading-relaxed resize-y`}
              data-testid="email-body"
              placeholder={me ? "" : "Loading the template…"}
            />
          </label>

          {p.whyFit && (
            <p className="text-[11px] text-white/40 border-l-2 border-white/10 pl-2">
              <span className="text-white/55 font-semibold">Why they fit:</span> {p.whyFit}
            </p>
          )}

          <div className="text-[11px] text-white/35 whitespace-pre-line rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
            <span className="text-white/50 font-semibold">Added to the bottom automatically</span>{"\n"}{OUTREACH_FOOTER}
          </div>

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-white/40">Follow up on</span>
              <DatePickerInput
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
              />
            </label>
            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={send.isPending} className="text-xs px-3 py-2 rounded-lg text-white/55 hover:text-white/85">Cancel</button>
              <button
                onClick={() => send.mutate()}
                disabled={!canSend}
                data-testid="email-send"
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-40 transition"
              >
                <Send className="w-3.5 h-3.5" /> {send.isPending ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
          {me && (
            <p className="text-[10px] text-white/30">
              Sends as “{me.firstName} {me.lastName} from United Prints”. Replies come to {me.email}.
              {p.stage === "new" ? " The lead moves to Contacted and the email is saved in its history." : " The email is saved in its history."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add prospect ─────────────────────────────────────────────────────────────

function AddProspectDialog({ categories, onClose }: { categories: string[]; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    name: "", website: "", category: "", city: "", region: "christchurch",
    phone: "", email: "", contactName: "", contactRole: "", whyFit: "", tier: "B", notes: "",
  });
  // Takes the minimal event shape, so the same setter serves a real <input> and
  // a SelectInput — which hands back { target: { value } } exactly as the
  // native element did, and is why migrating a call site is a rename.
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/sales/prospects", {
        ...f,
        website: f.website || null,
        category: f.category || null,
        city: f.city || null,
        phone: f.phone || null,
        email: f.email || null,
        contactName: f.contactName || null,
        contactRole: f.contactRole || null,
        whyFit: f.whyFit || null,
        notes: f.notes || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      toast({ title: "Prospect added" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't add prospect", description: e.message, variant: "destructive" }),
  });

  const field = "w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/25";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-neutral-950 border-white/10 text-white">
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Add a prospect</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="sm:col-span-2 space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Company / organisation *</span>
              <input value={f.name} onChange={set("name")} className={field} placeholder="Acme Rugby Club" data-testid="add-name" />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Website</span>
              <input value={f.website} onChange={set("website")} className={field} placeholder="acme.co.nz" />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Category</span>
              <input value={f.category} onChange={set("category")} className={field} placeholder="sports club" list="sales-categories" />
              <datalist id="sales-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>City</span>
              <input value={f.city} onChange={set("city")} className={field} placeholder="Christchurch" />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Region</span>
              <SelectInput value={f.region} onChange={set("region")} className={`${field}`}>
                {SALES_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </SelectInput>
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Phone</span>
              <input value={f.phone} onChange={set("phone")} className={field} placeholder="03 …" />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Email</span>
              <input value={f.email} onChange={set("email")} className={field} placeholder="office@…" />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Contact person</span>
              <input value={f.contactName} onChange={set("contactName")} className={field} />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Their role</span>
              <input value={f.contactRole} onChange={set("contactRole")} className={field} />
            </label>
            <label className="space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Tier</span>
              <SelectInput value={f.tier} onChange={set("tier")} className={`${field}`}>
                {SALES_TIERS.map((t) => <option key={t} value={t}>Tier {t}</option>)}
              </SelectInput>
            </label>
            <label className="sm:col-span-2 space-y-1 text-[10px] uppercase tracking-wider text-white/40">
              <span>Why they fit</span>
              <input value={f.whyFit} onChange={set("whyFit")} className={field} placeholder="Runs an annual prizegiving — trophies + medals buyer" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white/80 transition">Cancel</button>
            <button
              onClick={() => {
                if (!f.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
                create.mutate();
              }}
              disabled={create.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition disabled:opacity-50"
              data-testid="add-submit"
            >
              {create.isPending ? "Adding…" : "Add prospect"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
