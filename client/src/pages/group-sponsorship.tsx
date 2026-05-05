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
import {
  Plus, X, Handshake, TrendingUp, DollarSign, Award, Filter, Check, Trash2,
} from "lucide-react";

// Stages mirror Daniel's existing Pipedrive flow exactly so muscle memory carries over.
const STAGES = [
  { key: "new_lead",       label: "New Lead",       color: "#64748b" },
  { key: "contact_made",   label: "Contact Made",   color: "#94a3b8" },
  { key: "qualified",      label: "Qualified",      color: "#06b6d4" },
  { key: "call_scheduled", label: "Call Scheduled", color: "#3b82f6" },
  { key: "proposal_sent",  label: "Proposal Sent",  color: "#6366f1" },
  { key: "negotiating",    label: "Negotiating",    color: "#a855f7" },
  { key: "won",            label: "Won",            color: "#22c55e" },
  { key: "lost",           label: "Lost",           color: "#ef4444" },
  { key: "contract_sent",  label: "Contract Sent",  color: "#14b8a6" },
  { key: "invoice_sent",   label: "Invoice Sent",   color: "#0ea5e9" },
  { key: "invoice_paid",   label: "Invoice Paid",   color: "#10b981" },
  { key: "onboarded",      label: "Onboarded",      color: "#84cc16" },
  { key: "active",         label: "Active",         color: "#22c55e" },
] as const;
type StageKey = typeof STAGES[number]["key"];

const BRANDS = [
  { slug: "cufc",       label: "CUFC",       color: "#3b82f6" },
  { slug: "siu",        label: "SIU",        color: "#8b5cf6" },
  { slug: "mfl",        label: "MFL",        color: "#06b6d4" },
  { slug: "cic",        label: "CIC",        color: "#a855f7" },
  { slug: "usc",        label: "USC",        color: "#22c55e" },
  { slug: "gymnastics", label: "Gymnastics", color: "#ec4899" },
  { slug: "academy",    label: "Academy",    color: "#f59e0b" },
  { slug: "print",      label: "Print",      color: "#f97316" },
];

const ASSET_CATEGORIES = ["kit","stadium","matchday","led","digital","hospitality","content","community","tournament","other"];
const SOURCES = ["inbound","referral","cold_outreach","warm_intro","event","renewal","agency","other"];

interface SponsorshipDeal {
  id: number;
  organizationId: number;
  title: string;
  sponsorCompany: string;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  stage: StageKey;
  stageChangedAt: string;
  dealValueCents: number;
  contraValueCents: number;
  dealType: "cash" | "contra" | "hybrid";
  currency: string;
  brandTags: string[];
  assetCategory: string | null;
  termMonths: number | null;
  startDate: string | null;
  endDate: string | null;
  exclusivity: string | null;
  ownerId: number | null;
  source: string | null;
  probability: number;
  expectedCloseDate: string | null;
  notes: string | null;
}
interface PipelineSummary {
  totalAcvCents: number;
  totalContraCents: number;
  wonYtdCents: number;
  openPipelineCents: number;
  weightedPipelineCents: number;
  byStage: Record<string, { count: number; valueCents: number }>;
  count: number;
}
interface TeamMember { id: number; first_name: string; last_name: string; email: string; }

const fmtMoney = (cents: number) => {
  if (!cents) return "$0";
  if (cents >= 1_000_000_00) return `$${(cents / 1_000_000_00).toFixed(2)}M`;
  if (cents >= 100_000_00) return `$${Math.round(cents / 100000)}k`;
  if (cents >= 10_00 * 100) return `$${(cents / 100).toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`;
  return `$${(cents / 100).toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`;
};
const fmtMoneyFull = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-NZ", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;

export default function GroupSponsorship() {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const orgId = currentOrg?.id;
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine">("all");
  const [dealModal, setDealModal] = useState<{ mode: "create" | "edit"; deal?: Partial<SponsorshipDeal> } | null>(null);

  const { data: me } = useQuery<{ id: number }>({ queryKey: ["/api/auth/me"] });

  const { data: summary } = useQuery<PipelineSummary>({
    queryKey: ["/api/admin/sponsorship/summary", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/sponsorship/summary?organizationId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId,
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery<SponsorshipDeal[]>({
    queryKey: ["/api/admin/sponsorship/deals", { orgId, brand: brandFilter, owner: ownerFilter, meId: me?.id }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("organizationId", String(orgId));
      if (brandFilter) params.set("brand", brandFilter);
      if (ownerFilter === "mine" && me?.id) params.set("ownerId", String(me.id));
      const r = await fetch(`/api/admin/sponsorship/deals?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId,
  });

  const { data: team = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/admin/projects/team", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/projects/team?organizationId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId,
  });

  const saveDeal = useMutation({
    mutationFn: async ({ id, payload }: { id?: number; payload: any }) => {
      if (id) {
        const r = await apiRequest("PATCH", `/api/admin/sponsorship/deals/${id}`, payload);
        return r.json();
      }
      const r = await apiRequest("POST", "/api/admin/sponsorship/deals", { ...payload, organizationId: orgId });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/summary", orgId] });
      setDealModal(null);
      toast({ title: "Deal saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const deleteDeal = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/sponsorship/deals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/summary", orgId] });
      setDealModal(null);
      toast({ title: "Deal deleted" });
    },
  });

  const dealsByStage = useMemo(() => {
    const m = new Map<StageKey, SponsorshipDeal[]>();
    for (const s of STAGES) m.set(s.key, []);
    for (const d of deals) m.get(d.stage)?.push(d);
    return m;
  }, [deals]);

  if (!orgId) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2"><Handshake className="w-5 h-5 text-blue-400" /> Sponsorship</h1>
            <p className="text-xs text-white/40 mt-0.5">Pipeline · revenue · deliverables across {currentOrg?.name}</p>
          </div>
          <Button onClick={() => setDealModal({ mode: "create" })} data-testid="button-new-deal" className="bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="w-4 h-4 mr-1.5" /> New deal
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Kpi label="Open pipeline" value={summary ? fmtMoneyFull(summary.openPipelineCents) : "—"} icon={<TrendingUp className="w-4 h-4" />} accent="#3b82f6" />
          <Kpi label="Weighted pipeline" value={summary ? fmtMoneyFull(summary.weightedPipelineCents) : "—"} icon={<TrendingUp className="w-4 h-4" />} accent="#a855f7" sub="× probability" />
          <Kpi label="Booked ACV" value={summary ? fmtMoneyFull(summary.totalAcvCents) : "—"} icon={<DollarSign className="w-4 h-4" />} accent="#22c55e" sub={summary && summary.totalContraCents > 0 ? `+ ${fmtMoneyFull(summary.totalContraCents)} contra` : undefined} />
          <Kpi label="Won YTD" value={summary ? fmtMoneyFull(summary.wonYtdCents) : "—"} icon={<Award className="w-4 h-4" />} accent="#f59e0b" />
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button
            onClick={() => setOwnerFilter(ownerFilter === "mine" ? "all" : "mine")}
            data-testid="button-filter-mine"
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition flex items-center ${
              ownerFilter === "mine"
                ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                : "bg-transparent border-white/10 text-white/50 hover:text-white hover:border-white/20"
            }`}
          >
            <Filter className="w-3 h-3 mr-1" />
            {ownerFilter === "mine" ? "My deals" : "All deals"}
          </button>
          {brandFilter && (
            <button onClick={() => setBrandFilter(null)} className="text-[10px] px-2 py-1 rounded-md border border-white/10 text-white/50 hover:text-white">Clear brand</button>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
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
                >{b.label}</button>
              );
            })}
          </div>
          <span className="text-[10px] text-white/30 ml-auto">{deals.length} deal{deals.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {dealsLoading ? (
          <div className="flex gap-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="w-72 h-96 rounded-xl flex-shrink-0" />)}
          </div>
        ) : (
          <div className="flex gap-3 p-4 min-w-max">
            {STAGES.map(s => {
              const items = dealsByStage.get(s.key) || [];
              const totalCents = items.reduce((sum, d) => sum + (d.dealValueCents || 0), 0);
              return (
                <div key={s.key} className="w-72 flex-shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.02]">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.04]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                      <span className="text-sm font-semibold truncate">{s.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-white/40 flex-shrink-0">
                      <span>{items.length}</span>
                      {totalCents > 0 && <span className="text-white/60 font-medium">{fmtMoney(totalCents)}</span>}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px]">
                    {items.length === 0 ? (
                      <button
                        onClick={() => setDealModal({ mode: "create", deal: { stage: s.key } })}
                        className="w-full text-[11px] text-white/30 hover:text-white/50 italic py-3 rounded border border-dashed border-white/10"
                      >
                        + Add deal
                      </button>
                    ) : items.map(d => (
                      <DealCard key={d.id} deal={d} team={team} onClick={() => setDealModal({ mode: "edit", deal: d })} highlightMine={d.ownerId === me?.id} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dealModal && (
        <DealModal
          mode={dealModal.mode}
          deal={dealModal.deal}
          team={team}
          onClose={() => setDealModal(null)}
          onSave={(payload) => saveDeal.mutate({ id: dealModal.deal?.id, payload })}
          onDelete={dealModal.deal?.id ? () => deleteDeal.mutate(dealModal.deal!.id!) : undefined}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, icon, accent, sub }: { label: string; value: string; icon: React.ReactNode; accent: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </div>
      <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

function DealCard({ deal, team, onClick, highlightMine }: { deal: SponsorshipDeal; team: TeamMember[]; onClick: () => void; highlightMine?: boolean }) {
  const owner = team.find(m => m.id === deal.ownerId);
  const closeDate = deal.expectedCloseDate ? new Date(deal.expectedCloseDate + "T00:00:00") : null;
  const today = new Date(); today.setHours(0,0,0,0);
  const daysToClose = closeDate ? Math.ceil((closeDate.getTime() - today.getTime()) / (1000*60*60*24)) : null;

  return (
    <button
      onClick={onClick}
      data-testid={`card-deal-${deal.id}`}
      className="w-full text-left rounded-lg p-2.5 border transition-all hover:border-white/15"
      style={{
        borderColor: highlightMine ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.06)",
        background: highlightMine ? "rgba(59,130,246,0.05)" : "rgba(255,255,255,0.02)",
        boxShadow: highlightMine ? "0 0 0 1px rgba(59,130,246,0.3)" : undefined,
      }}
    >
      <div className="text-xs font-semibold text-white truncate mb-0.5">{deal.sponsorCompany}</div>
      <div className="text-[10px] text-white/50 truncate mb-1.5">{deal.title}</div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {(deal.dealValueCents > 0 || deal.contraValueCents === 0) && (
          <span className="text-[11px] font-semibold text-green-400 tabular-nums">{fmtMoney(deal.dealValueCents)}</span>
        )}
        {deal.contraValueCents > 0 && (
          <span className="text-[10px] font-medium text-orange-300 tabular-nums">+ {fmtMoney(deal.contraValueCents)} contra</span>
        )}
      </div>
      {deal.brandTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {deal.brandTags.slice(0, 3).map(slug => {
            const b = BRANDS.find(x => x.slug === slug);
            return <span key={slug} className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${b?.color || "#64748b"}20`, color: b?.color || "#64748b" }}>{b?.label || slug}</span>;
          })}
        </div>
      )}
      <div className="flex items-center justify-between text-[10px] text-white/40">
        {owner ? (
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded-full bg-white/[0.08] flex items-center justify-center text-[8px] font-semibold text-white/70">
              {owner.first_name[0]}{owner.last_name[0]}
            </span>
            <span>{owner.first_name}</span>
          </span>
        ) : <span className="italic">Unassigned</span>}
        {daysToClose !== null && (
          <span className={daysToClose < 0 ? "text-red-400" : daysToClose < 14 ? "text-amber-300" : "text-white/40"}>
            {daysToClose < 0 ? `${-daysToClose}d overdue` : daysToClose === 0 ? "today" : `${daysToClose}d`}
          </span>
        )}
      </div>
    </button>
  );
}

function DealModal({ mode, deal, team, onClose, onSave, onDelete }: {
  mode: "create" | "edit";
  deal?: Partial<SponsorshipDeal>;
  team: TeamMember[];
  onClose: () => void;
  onSave: (payload: any) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(deal?.title || "");
  const [sponsorCompany, setSponsorCompany] = useState(deal?.sponsorCompany || "");
  const [stage, setStage] = useState<StageKey>((deal?.stage as StageKey) || "new_lead");
  const [dealType, setDealType] = useState<"cash" | "contra" | "hybrid">(deal?.dealType || "cash");
  const [dealValue, setDealValue] = useState(deal?.dealValueCents != null && deal.dealValueCents > 0 ? (deal.dealValueCents / 100).toString() : "");
  const [contraValue, setContraValue] = useState(deal?.contraValueCents != null && deal.contraValueCents > 0 ? (deal.contraValueCents / 100).toString() : "");
  const [brandTags, setBrandTags] = useState<string[]>(deal?.brandTags || []);
  const [assetCategory, setAssetCategory] = useState(deal?.assetCategory || "");
  const [ownerId, setOwnerId] = useState<number | null>(deal?.ownerId ?? null);
  const [contactName, setContactName] = useState(deal?.primaryContactName || "");
  const [contactEmail, setContactEmail] = useState(deal?.primaryContactEmail || "");
  const [contactPhone, setContactPhone] = useState(deal?.primaryContactPhone || "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(deal?.expectedCloseDate || "");
  const [startDate, setStartDate] = useState(deal?.startDate || "");
  const [endDate, setEndDate] = useState(deal?.endDate || "");
  const [termMonths, setTermMonths] = useState(deal?.termMonths != null ? String(deal.termMonths) : "");
  const [exclusivity, setExclusivity] = useState(deal?.exclusivity || "");
  const [source, setSource] = useState(deal?.source || "");
  const [probability, setProbability] = useState(deal?.probability != null ? String(deal.probability) : "");
  const [notes, setNotes] = useState(deal?.notes || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = () => {
    if (!sponsorCompany.trim()) return;
    onSave({
      title: title.trim() || `${sponsorCompany.trim()} sponsorship`,
      sponsorCompany: sponsorCompany.trim(),
      stage,
      dealType,
      dealValueCents: dealValue ? Math.round(parseFloat(dealValue) * 100) : 0,
      contraValueCents: contraValue ? Math.round(parseFloat(contraValue) * 100) : 0,
      brandTags,
      assetCategory: assetCategory || null,
      ownerId,
      primaryContactName: contactName || null,
      primaryContactEmail: contactEmail || null,
      primaryContactPhone: contactPhone || null,
      expectedCloseDate: expectedCloseDate || null,
      startDate: startDate || null,
      endDate: endDate || null,
      termMonths: termMonths ? parseInt(termMonths) : null,
      exclusivity: exclusivity || null,
      source: source || null,
      probability: probability ? parseInt(probability) : undefined,
      notes: notes || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[#0a0e1a] border border-white/10 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-2 duration-200 max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Handshake className="w-4 h-4 text-blue-400" />
            {mode === "create" ? "New deal" : "Edit deal"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Sponsor company *</Label>
              <Input value={sponsorCompany} onChange={e => setSponsorCompany(e.target.value)} placeholder="e.g. NPD Fuel" autoFocus className="bg-white/[0.04] border-white/10 text-white" data-testid="input-sponsor-company" />
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Deal title</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Front-of-shirt 2026-2027" className="bg-white/[0.04] border-white/10 text-white" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/60 mb-1.5 block">Stage</Label>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map(s => {
                const active = stage === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStage(s.key)}
                    data-testid={`stage-${s.key}`}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-md border transition"
                    style={{
                      borderColor: active ? s.color : "rgba(255,255,255,0.1)",
                      background: active ? `${s.color}25` : "transparent",
                      color: active ? "white" : "rgba(255,255,255,0.6)",
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Deal type</Label>
              <select value={dealType} onChange={e => setDealType(e.target.value as any)} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm">
                <option value="cash">Cash</option>
                <option value="contra">Contra</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Cash value (NZD)</Label>
              <Input type="number" min="0" step="100" value={dealValue} onChange={e => setDealValue(e.target.value)} placeholder="0" className="bg-white/[0.04] border-white/10 text-white h-9" />
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Contra value (NZD)</Label>
              <Input type="number" min="0" step="100" value={contraValue} onChange={e => setContraValue(e.target.value)} placeholder="0" className="bg-white/[0.04] border-white/10 text-white h-9" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/60 mb-1.5 block">Brand</Label>
            <div className="flex flex-wrap gap-1.5">
              {BRANDS.map(b => {
                const active = brandTags.includes(b.slug);
                return (
                  <button
                    key={b.slug}
                    type="button"
                    onClick={() => setBrandTags(prev => active ? prev.filter(x => x !== b.slug) : [...prev, b.slug])}
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Asset category</Label>
              <select value={assetCategory} onChange={e => setAssetCategory(e.target.value)} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm capitalize">
                <option value="">—</option>
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Owner</Label>
              <select value={ownerId ?? ""} onChange={e => setOwnerId(e.target.value ? parseInt(e.target.value) : null)} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm">
                <option value="">Unassigned</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2 font-semibold">Primary contact</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name" className="bg-white/[0.04] border-white/10 text-white h-9 text-sm" />
              <Input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="Email" type="email" className="bg-white/[0.04] border-white/10 text-white h-9 text-sm" />
              <Input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="Phone" className="bg-white/[0.04] border-white/10 text-white h-9 text-sm" />
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2 font-semibold">Term & dates</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <Label className="text-[10px] text-white/50 mb-1 block">Start</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-white/[0.04] border-white/10 text-white h-9 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] text-white/50 mb-1 block">End</Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-white/[0.04] border-white/10 text-white h-9 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] text-white/50 mb-1 block">Term (months)</Label>
                <Input type="number" min="1" value={termMonths} onChange={e => setTermMonths(e.target.value)} placeholder="12" className="bg-white/[0.04] border-white/10 text-white h-9 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] text-white/50 mb-1 block">Expected close</Label>
                <Input type="date" value={expectedCloseDate} onChange={e => setExpectedCloseDate(e.target.value)} className="bg-white/[0.04] border-white/10 text-white h-9 text-xs" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Source</Label>
              <select value={source} onChange={e => setSource(e.target.value)} className="w-full h-9 rounded-md bg-white/[0.04] border border-white/10 px-2 text-sm capitalize">
                <option value="">—</option>
                {SOURCES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-white/60 mb-1 block">Probability % <span className="text-white/30">(auto-set by stage)</span></Label>
              <Input type="number" min="0" max="100" value={probability} onChange={e => setProbability(e.target.value)} placeholder="auto" className="bg-white/[0.04] border-white/10 text-white h-9" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/60 mb-1 block">Exclusivity</Label>
            <Input value={exclusivity} onChange={e => setExclusivity(e.target.value)} placeholder="e.g. Category exclusive — Insurance (excluding life insurance)" className="bg-white/[0.04] border-white/10 text-white" />
            <p className="text-[10px] text-white/30 mt-1">The single biggest source of sponsorship disputes. Be specific.</p>
          </div>

          <div>
            <Label className="text-xs text-white/60 mb-1 block">Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Decision-maker, budget cycle, key competitors, last interaction…" className="bg-white/[0.04] border-white/10 text-white min-h-[70px]" />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
          <div>
            {onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-white/60">Delete deal?</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="text-white/50 h-7 text-xs px-2">Cancel</Button>
                  <Button size="sm" onClick={onDelete} className="bg-red-600 hover:bg-red-700 text-white h-7 text-xs px-2"><Trash2 className="w-3 h-3 mr-1" /> Delete</Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              )
            )}
          </div>
          {!confirmDelete && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} className="text-white/50">Cancel</Button>
              <Button size="sm" onClick={submit} disabled={!sponsorCompany.trim()} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-deal">
                <Check className="w-3.5 h-3.5 mr-1" /> {mode === "create" ? "Create deal" : "Save"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
