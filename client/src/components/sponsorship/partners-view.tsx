/**
 * USG → Sponsorship → Partners.
 * The sponsors we have already SIGNED: company, main contact, signed-on date,
 * renewal date, annual value, flags, and the signed contract one click away.
 * Click a row for contracts, instalments, deliverables (promised), ideas, notes.
 * Data: /api/admin/sponsorship/partners (server/sponsorship-partners.ts).
 * 🔴 Every state (contract, payment, status, flag) is decided in
 * shared/sponsorship-partners.ts and only DISPLAYED here.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { TickButton, DoneStamp, StatusMenu, ProofControls, isDone } from "@/components/sponsorship/deliverable-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BadgeCheck, Plus, Search, FileText, Download, ExternalLink, Upload, Pencil, Trash2, Mail, Phone,
  Globe, AlertCircle, AlertTriangle, Info, ArrowUp, ArrowDown, Check, Lightbulb, ListChecks, Archive,
  Banknote, Handshake, Clock,
} from "lucide-react";
import {
  CONTRACT_STATE_LABEL, PARTNER_STATUS_LABEL, SIGNATURE_LABEL, SIGNATURE_STATUSES, comparePartners, fmtDateNz,
  type ContractState, type PartnerFlag, type PartnerSortKey, type PartnerStatus, type PaymentState, type SignatureStatus,
} from "@shared/sponsorship-partners";

// ── Types (mirror server/sponsorship-partners.ts responses) ──────────────────
interface NodeView { id: number; name: string; openUrl: string; downloadUrl: string; sourceUrl: string | null }
interface PartnerBase {
  id: number; company: string; tradingName: string | null; website: string | null; brandTags: string[];
  logoUrl?: string | null; logoGround?: "light" | "dark" | null;
  primaryContactName: string | null; primaryContactRole: string | null; primaryContactEmail: string | null; primaryContactPhone: string | null;
  notes: string | null; archivedAt: string | null; dealId?: number | null;
}
interface PartnerRow extends PartnerBase {
  since: string | null; renewalOn: string | null; annualValueCents: number; cashPerYearCents: number; contraPerYearCents: number;
  status: PartnerStatus; flags: PartnerFlag[]; contractsCount: number;
  current: { id: number; state: ContractState; openEnded: boolean; endDate: string | null; node: NodeView | null; contractSourceUrl?: string | null } | null;
  nextPayment: { id: number; amountCents: number; dueOn: string | null; label: string | null; state: PaymentState } | null;
  paidCents: number; overdueCents: number;
}
interface ListResp {
  today: string; partners: PartnerRow[];
  totals: { partners: number; active: number; annualCashCents: number; annualContraCents: number; renewalsDue: number; overdueCents: number; needsAttention: number };
}
interface Payment {
  id: number; contractId: number; label: string | null; dueOn: string | null; amountCents: number; gstIncluded: boolean;
  paidOn: string | null; paidCents: number | null; xeroInvoiceNumber: string | null; notes: string | null; state: PaymentState;
}
interface Deliverable {
  id: number; title: string; category: string; triggerType: string; status: string; scheduledDate: string | null;
  ownerId: number | null; proofUrl: string | null; notes: string | null; entitlementQty?: number | null;
  deliveredAt?: string | null; proof?: { url: string; name: string; isFile: boolean } | null;
}
interface Contract {
  id: number; title: string | null; clubEntity: string | null; signedOn: string | null; startDate: string | null; endDate: string | null;
  openEnded: boolean; termMonths: number | null; termText: string | null; renewalTerms: string | null; autoRenews: boolean | null;
  noticeDays: number | null; cashPerYearCents: number | null; cashTotalCents: number | null; gstNote: string | null;
  contraPerYearCents: number | null; contraDescription: string | null; paymentTerms: string | null; exclusivity: string | null;
  termination: string | null; otherClauses: string | null; signatureStatus: SignatureStatus; signedBy: string | null;
  contractSourceUrl: string | null; flags: string[] | null;
  state: ContractState; isCurrent: boolean; node: NodeView | null; payments: Payment[]; deliverables: Deliverable[];
}
interface DetailResp {
  today: string;
  partner: PartnerBase & { since: string | null; status: PartnerStatus; flags: PartnerFlag[]; annualValueCents: number };
  deal: { id: number; title: string; stage: string } | null;
  contracts: Contract[];
  people: { id: number; name: string }[];
}

const BRANDS = [
  { slug: "cufc", label: "CUFC", color: "#3b82f6" }, { slug: "siu", label: "SIU", color: "#8b5cf6" },
  { slug: "mfl", label: "MFL", color: "#06b6d4" }, { slug: "cic", label: "CIC", color: "#a855f7" },
  { slug: "usc", label: "USC", color: "#22c55e" }, { slug: "gymnastics", label: "Gymnastics", color: "#ec4899" },
  { slug: "academy", label: "Academy", color: "#f59e0b" }, { slug: "print", label: "Print", color: "#f97316" },
];

const fmtMoneyFull = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-NZ", { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
/** Dollars typed on screen → cents stored. Blank → null. */
const dollarsToCents = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const centsToDollars = (c: number | null | undefined) => (c == null ? "" : String(c / 100));

const STATUS_STYLE: Record<PartnerStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  renewal_due: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  expired: "bg-red-500/15 text-red-400 border-red-500/30",
  attention: "bg-red-500/15 text-red-400 border-red-500/30",
  no_contract: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
const PAY_STYLE: Record<PaymentState, string> = {
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  overdue: "bg-red-500/15 text-red-400 border-red-500/30",
  due_soon: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  scheduled: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  unscheduled: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
const PAY_LABEL: Record<PaymentState, string> = { paid: "Paid", overdue: "Overdue", due_soon: "Due soon", scheduled: "Scheduled", unscheduled: "No date" };
const PAY_TEXT: Record<PaymentState, string> = { paid: "text-emerald-400", overdue: "text-red-400", due_soon: "text-amber-400", scheduled: "text-white/60", unscheduled: "text-white/60" };
const CONTRACT_STATE_STYLE: Record<ContractState, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  open_ended: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  ending_soon: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  expired: "bg-red-500/15 text-red-400 border-red-500/30",
  not_started: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  undated: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
const FLAG_TEXT = { red: "text-red-400", amber: "text-amber-400", grey: "text-white/60" } as const;
const FLAG_DOT = { red: "bg-red-500", amber: "bg-amber-500", grey: "bg-slate-400" } as const;

const STATUS_FILTERS: { key: "all" | PartnerStatus; label: string }[] = [
  { key: "all", label: "All" }, { key: "active", label: "Active" }, { key: "renewal_due", label: "Renewal due" },
  { key: "attention", label: "Needs attention" }, { key: "expired", label: "Expired" }, { key: "no_contract", label: "No contract" },
];
const SORTS: { key: PartnerSortKey; label: string }[] = [
  { key: "company", label: "Company" }, { key: "value", label: "Annual value" }, { key: "since", label: "Longest serving" },
  { key: "renewal", label: "Renewal date" }, { key: "status", label: "Status" },
];

async function readError(r: Response, fallback: string): Promise<string> {
  try { const j = await r.json(); return j?.message || fallback; } catch { return fallback; }
}
const invalidateAll = () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/partners"] }); queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/partners/deliverables"] }); };

// ── Small pieces ─────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: PartnerStatus }) {
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${STATUS_STYLE[status]}`}>{PARTNER_STATUS_LABEL[status]}</span>;
}
/** The sponsor's mark on the ground it was drawn for — white artwork on the
 *  club navy, colour artwork on white — or their initials until a logo is on
 *  file. The Mailer's recipient search draws the same tile.
 *  🔴 The navy is the blue-900 TOKEN, not a hex: the light-theme generator
 *  rewrites any hex darker than L 0.02 into a white panel (it did — the tile
 *  shipped white-on-white once), and leaves a colour token alone. */
function LogoTile({ company, logoUrl, ground, size }: { company: string; logoUrl?: string | null; ground?: "light" | "dark" | null; size: "sm" | "lg" }) {
  const dim = size === "lg" ? "w-16 h-16 rounded-xl p-1.5" : "w-9 h-9 rounded-lg p-1";
  const initials = company.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  if (!logoUrl) {
    return <span className={`${dim} shrink-0 bg-amber-500/10 text-amber-300 font-semibold flex items-center justify-center ${size === "lg" ? "text-base" : "text-[11px]"}`} title="No logo on file yet" data-testid="partner-logo-initials">{initials || "?"}</span>;
  }
  return <img src={logoUrl} alt={`${company} logo`} className={`${dim} shrink-0 object-contain ${ground === "dark" ? "bg-blue-900" : "bg-white border border-black/10"}`} data-testid="partner-logo" />;
}

function BrandChips({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tags.map(t => {
        const b = BRANDS.find(x => x.slug === t);
        return <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded border" style={{ borderColor: `${b?.color ?? "#64748b"}66`, background: `${b?.color ?? "#64748b"}1f`, color: "hsl(var(--foreground) / 0.85)" }}>{b?.label ?? t}</span>;
      })}
    </div>
  );
}
function FlagIcon({ sev }: { sev: PartnerFlag["severity"] }) {
  const Icon = sev === "red" ? AlertCircle : sev === "amber" ? AlertTriangle : Info;
  return <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${FLAG_TEXT[sev]}`} />;
}
function FlagList({ flags, max }: { flags: PartnerFlag[]; max?: number }) {
  if (!flags.length) return <span className="text-white/30 text-xs">—</span>;
  const shown = max ? flags.slice(0, max) : flags;
  return (
    <ul className="space-y-1">
      {shown.map((f, i) => (
        <li key={i} title={f.text} className={`flex items-start gap-1.5 text-xs ${FLAG_TEXT[f.severity]}`}>
          <FlagIcon sev={f.severity} /><span className="min-w-0 break-words">{f.text}</span>
        </li>
      ))}
      {max && flags.length > max && <li className="text-[11px] text-white/40" title={flags.slice(max).map(f => f.text).join("\n")}>+{flags.length - max} more</li>}
    </ul>
  );
}
function OpenButton({ node, size = "sm" }: { node: NodeView | null | undefined; size?: "sm" | "md" }) {
  const cls = size === "md" ? "min-h-[44px]" : "min-h-[36px] md:min-h-0";
  if (!node) return <Button size="sm" variant="outline" disabled title="No file" className={cls}><FileText className="w-3.5 h-3.5 mr-1" />No file</Button>;
  return (
    <Button size="sm" variant="outline" asChild className={cls}>
      <a href={node.openUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} data-testid="partner-open-contract"><FileText className="w-3.5 h-3.5 mr-1" />Open</a>
    </Button>
  );
}

// ── Hash state: #partners  /  #partners/<id> ────────────────────────────────
function readHashId(): number | null {
  if (typeof window === "undefined") return null;
  const m = /^#partners\/(\d+)/.exec(window.location.hash);
  return m ? Number(m[1]) : null;
}

// ── Main view ────────────────────────────────────────────────────────────────
export function PartnersView() {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<number | null>(() => readHashId());
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<"all" | PartnerStatus>("all");
  const [brandF, setBrandF] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<PartnerSortKey>("company");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onHash = () => setOpenId(readHashId());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("popstate", onHash); };
  }, []);

  const open = (id: number) => { try { window.history.pushState(null, "", `#partners/${id}`); } catch { /* ignore */ } setOpenId(id); };
  const close = () => { try { window.history.pushState(null, "", "#partners"); } catch { /* ignore */ } setOpenId(null); };

  const { data, isLoading, error } = useQuery<ListResp>({
    queryKey: ["/api/admin/sponsorship/partners", { archived }],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/sponsorship/partners${archived ? "?archived=1" : ""}`);
      if (!r.ok) throw new Error(await readError(r, `Could not load partners (${r.status})`));
      return r.json();
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.partners ?? []).filter(p => {
      if (statusF !== "all" && p.status !== statusF) return false;
      if (brandF.length && !brandF.some(b => p.brandTags?.includes(b))) return false;
      if (q) {
        const hay = [p.company, p.tradingName, p.primaryContactName, p.primaryContactEmail].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return list.slice().sort(comparePartners(sortKey, dir));
  }, [data, search, statusF, brandF, sortKey, dir]);

  const t = data?.totals;
  const kpis = [
    { label: "Active partners", value: t ? String(t.active) : "—", accent: "#22c55e", sub: t ? `of ${t.partners}` : undefined },
    { label: "Annual cash", value: t ? fmtMoneyFull(t.annualCashCents) : "—", accent: "#3b82f6", sub: "excl GST" },
    { label: "Annual contra", value: t ? fmtMoneyFull(t.annualContraCents) : "—", accent: "#a855f7", sub: "value in kind" },
    { label: "Renewals due", value: t ? String(t.renewalsDue) : "—", accent: "#f59e0b", sub: "next 90 days" },
    { label: "Overdue", value: t ? fmtMoneyFull(t.overdueCents) : "—", accent: "#ef4444", sub: "unpaid instalments" },
    { label: "Needs attention", value: t ? String(t.needsAttention) : "—", accent: "#ef4444" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 min-w-0" data-testid="partners-view">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5" style={{ borderLeft: `3px solid ${k.accent}`, paddingLeft: 6 }}>{k.label}</div>
            <div className="text-lg font-semibold text-white tabular-nums">{k.value}</div>
            {k.sub && <div className="text-[10px] text-white/40 mt-0.5">{k.sub}</div>}
          </div>
        ))}
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-md">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company or contact" className="pl-8 h-11 md:h-9" data-testid="partners-search" />
          </div>
          <div className="flex items-center gap-1.5" data-testid="partners-sort">
            <Select value={sortKey} onValueChange={v => setSortKey(v as PartnerSortKey)}>
              <SelectTrigger className="h-11 md:h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>{SORTS.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => setDir(d => (d === "asc" ? "desc" : "asc"))} title={dir === "asc" ? "Ascending" : "Descending"} data-testid="partners-sort-dir">
              {dir === "asc" ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/60 min-h-[44px] md:min-h-0">
            <Switch checked={archived} onCheckedChange={setArchived} data-testid="partners-archived" /> Show archived
          </label>
          <Button onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-0 ml-auto" data-testid="partners-new"><Plus className="w-4 h-4 mr-1.5" />New partner</Button>
        </div>
        <p className="text-[11px] text-white/40" data-testid="partners-hint">New sponsor signed? New partner → Add contract → upload the signed PDF, or press Make partner on the won deal in Prospects → Pipeline.</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button key={f.key} onClick={() => setStatusF(f.key)} data-testid={`partners-status-${f.key}`}
              className={`text-xs font-semibold px-3 py-2 md:py-1.5 min-h-[44px] md:min-h-[32px] rounded-md border transition ${statusF === f.key ? "bg-blue-600 border-blue-600 text-white" : "border-white/10 text-white/60 hover:text-white bg-white/[0.02]"}`}>{f.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BRANDS.map(b => {
            const on = brandF.includes(b.slug);
            return (
              <button key={b.slug} onClick={() => setBrandF(on ? brandF.filter(x => x !== b.slug) : [...brandF, b.slug])} data-testid={`partners-brand-${b.slug}`}
                className="text-[11px] font-semibold px-2.5 py-1.5 min-h-[44px] md:min-h-0 rounded-md border transition"
                style={{ borderColor: on ? b.color : "hsl(var(--foreground) / 0.085)", background: on ? `${b.color}25` : "transparent", color: "hsl(var(--foreground) / 0.85)" }}>{b.label}</button>
            );
          })}
        </div>
      </div>

      {isLoading && <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
      {error && <div className="text-sm text-red-400 rounded-lg border border-red-500/30 bg-red-500/10 p-3" data-testid="partners-error">{(error as Error).message}</div>}
      {!isLoading && !error && data && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-white/50" data-testid="partners-empty">
          {data.partners.length === 0 ? "No partners yet — add the first one or run the contracts import." : "No partners match these filters."}
          {data.partners.length === 0 && <div className="text-xs text-white/40 mt-2">New sponsor signed? New partner → Add contract → upload the signed PDF, or press Make partner on the won deal in Prospects → Pipeline.</div>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-white/[0.06] overflow-x-auto" data-testid="partners-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.06]">
                  {["Company", "Contract", "Main contact", "Signed on", "Renews / ends", "Annual value", "Status", "Flags"].map(h => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} onClick={() => open(p.id)} data-testid={`partner-row-${p.id}`}
                    className={`border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.03] align-top ${p.archivedAt ? "opacity-50" : ""}`}>
                    <td className="px-2.5 py-2.5 min-w-[190px] max-w-[260px]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <LogoTile company={p.company} logoUrl={p.logoUrl} ground={p.logoGround} size="sm" />
                        <div className="min-w-0">
                          <div className="font-semibold text-white break-words">{p.company}</div>
                          <BrandChips tags={p.brandTags} />
                        </div>
                      </div>
                    </td>
                    {/* Signed is king: the file sits beside the name, never off the right edge */}
                    <td className="px-2.5 py-2.5 whitespace-nowrap"><OpenButton node={p.current?.node} /></td>
                    <td className="px-2.5 py-2.5 min-w-[170px] max-w-[210px]">
                      <div className="text-white/90 break-words">{p.primaryContactName || "—"}</div>
                      {p.primaryContactRole && <div className="text-[11px] text-white/45 break-words">{p.primaryContactRole}</div>}
                      <div className="flex flex-wrap gap-x-2 text-[11px]" onClick={e => e.stopPropagation()}>
                        {p.primaryContactEmail && <a className="text-blue-400 hover:underline [overflow-wrap:anywhere]" href={`mailto:${p.primaryContactEmail}`}>{p.primaryContactEmail}</a>}
                        {p.primaryContactPhone && <a className="text-blue-400 hover:underline" href={`tel:${p.primaryContactPhone}`}>{p.primaryContactPhone}</a>}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap text-white/80">{fmtDateNz(p.since)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap text-white/80">{p.current?.openEnded ? "Ongoing" : fmtDateNz(p.renewalOn)}</td>
                    <td className="px-2.5 py-2.5 whitespace-nowrap tabular-nums">
                      <div className="text-white font-semibold">{fmtMoneyFull(p.cashPerYearCents)}</div>
                      {p.contraPerYearCents > 0 && <div className="text-[11px] text-white/50">+ {fmtMoneyFull(p.contraPerYearCents)} contra</div>}
                    </td>
                    <td className="px-2.5 py-2.5"><StatusPill status={p.status} /></td>
                    <td className="px-2.5 py-2.5 min-w-[170px]"><FlagList flags={p.flags.filter(f => f.severity !== "grey")} max={2} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone cards */}
          <div className="md:hidden space-y-2.5">
            {rows.map(p => (
              <div key={p.id} role="button" tabIndex={0} onClick={() => open(p.id)} onKeyDown={e => { if (e.key === "Enter") open(p.id); }} data-testid={`partner-card-${p.id}`}
                className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-h-[44px] ${p.archivedAt ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <LogoTile company={p.company} logoUrl={p.logoUrl} ground={p.logoGround} size="sm" />
                      <div className="font-semibold text-white break-words min-w-0">{p.company}</div>
                    </div>
                    <BrandChips tags={p.brandTags} />
                  </div>
                  <StatusPill status={p.status} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-2 text-xs">
                  <div className="text-white tabular-nums font-semibold">{fmtMoneyFull(p.cashPerYearCents)}{p.contraPerYearCents > 0 && <span className="text-white/50 font-normal"> + {fmtMoneyFull(p.contraPerYearCents)} contra</span>}</div>
                  <div className="text-white/50 whitespace-nowrap">{p.current?.openEnded ? "Ongoing" : `Ends ${fmtDateNz(p.renewalOn)}`}</div>
                </div>
                {p.flags.some(f => f.severity !== "grey") && <div className="mt-2"><FlagList flags={p.flags.filter(f => f.severity !== "grey")} max={2} /></div>}
                <div className="mt-2.5"><OpenButton node={p.current?.node} size="md" /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {creating && (
        <PartnerDialog
          onClose={() => setCreating(false)}
          onSaved={(row) => { setCreating(false); toast({ title: "Partner added" }); if (row?.id) open(row.id); }}
        />
      )}
      {openId !== null && <PartnerSheet id={openId} onClose={close} />}
    </div>
  );
}

// ── Partner create / edit dialog ─────────────────────────────────────────────
function PartnerDialog({ partner, onClose, onSaved }: { partner?: PartnerBase; onClose: () => void; onSaved: (row: any) => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    company: partner?.company ?? "", tradingName: partner?.tradingName ?? "", website: partner?.website ?? "",
    primaryContactName: partner?.primaryContactName ?? "", primaryContactRole: partner?.primaryContactRole ?? "",
    primaryContactEmail: partner?.primaryContactEmail ?? "", primaryContactPhone: partner?.primaryContactPhone ?? "",
    notes: partner?.notes ?? "",
  });
  const [brands, setBrands] = useState<string[]>(partner?.brandTags ?? []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...f, brandTags: brands };
      const r = partner ? await apiRequest("PATCH", `/api/admin/sponsorship/partners/${partner.id}`, body) : await apiRequest("POST", "/api/admin/sponsorship/partners", body);
      return r.json();
    },
    onSuccess: (row) => { invalidateAll(); if (partner) toast({ title: "Partner saved" }); onSaved(row); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="partner-dialog">
        <DialogHeader><DialogTitle>{partner ? "Edit partner" : "New partner"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Company</Label><Input value={f.company} onChange={set("company")} data-testid="partner-company" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Trading name</Label><Input value={f.tradingName} onChange={set("tradingName")} /></div>
            <div><Label>Website</Label><Input value={f.website} onChange={set("website")} placeholder="https://" /></div>
          </div>
          <div>
            <Label>Brands</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {BRANDS.map(b => {
                const on = brands.includes(b.slug);
                return <button type="button" key={b.slug} onClick={() => setBrands(on ? brands.filter(x => x !== b.slug) : [...brands, b.slug])}
                  className="text-[11px] font-semibold px-2.5 py-2 rounded-md border" style={{ borderColor: on ? b.color : "hsl(var(--foreground) / 0.085)", background: on ? `${b.color}25` : "transparent", color: "hsl(var(--foreground) / 0.85)" }}>{b.label}</button>;
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Main contact</Label><Input value={f.primaryContactName} onChange={set("primaryContactName")} /></div>
            <div><Label>Role</Label><Input value={f.primaryContactRole} onChange={set("primaryContactRole")} /></div>
            <div><Label>Email</Label><Input value={f.primaryContactEmail} onChange={set("primaryContactEmail")} /></div>
            <div><Label>Phone</Label><Input value={f.primaryContactPhone} onChange={set("primaryContactPhone")} /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={f.notes} onChange={set("notes")} rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.company.trim() || save.isPending} data-testid="partner-save">{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The sheet ────────────────────────────────────────────────────────────────
function PartnerSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [contractDlg, setContractDlg] = useState<{ contract?: Contract } | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<DetailResp>({
    queryKey: ["/api/admin/sponsorship/partners", "detail", id],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/sponsorship/partners/${id}`);
      if (!r.ok) throw new Error(await readError(r, `Could not load partner (${r.status})`));
      return r.json();
    },
  });

  const archive = useMutation({
    mutationFn: async (archived: boolean) => (await apiRequest("PATCH", `/api/admin/sponsorship/partners/${id}`, { archived })).json(),
    onSuccess: (_r, archived) => { invalidateAll(); toast({ title: archived ? "Partner archived" : "Partner restored" }); setConfirmArchive(false); if (archived) onClose(); },
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
  const saveNotes = useMutation({
    mutationFn: async (n: string) => (await apiRequest("PATCH", `/api/admin/sponsorship/partners/${id}`, { notes: n })).json(),
    onSuccess: () => { invalidateAll(); toast({ title: "Notes saved" }); setNotes(null); },
    onError: (e: any) => toast({ title: "Couldn't save notes", description: e.message, variant: "destructive" }),
  });

  const p = data?.partner;
  const contracts = useMemo(() => {
    const list = data?.contracts ?? [];
    return list.slice().sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  }, [data]);

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-4 sm:p-6" data-testid="partner-sheet">
        {isLoading && <div className="space-y-3 pt-6"><SheetTitle className="sr-only">Loading partner</SheetTitle><Skeleton className="h-8 w-2/3" /><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>}
        {error && <div className="pt-6"><SheetTitle className="sr-only">Partner</SheetTitle><div className="text-sm text-red-400" data-testid="partner-error">{(error as Error).message}</div></div>}
        {data && p && (
          <div className="space-y-6 pt-4 min-w-0">
            <SheetHeader className="text-left space-y-2">
              <div className="flex items-start gap-3 pr-6 min-w-0">
                <LogoTile company={p.company} logoUrl={p.logoUrl} ground={p.logoGround} size="lg" />
                <div className="flex items-start gap-2 flex-wrap min-w-0">
                  <SheetTitle className="text-xl break-words min-w-0">{p.company}</SheetTitle>
                  <StatusPill status={p.status} />
                </div>
              </div>
              <SheetDescription className="sr-only">Signed partner details</SheetDescription>
              {p.tradingName && <div className="text-xs text-white/50">Trading as {p.tradingName}</div>}
              <BrandChips tags={p.brandTags} />
            </SheetHeader>

            {p.flags.length > 0 && <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"><FlagList flags={p.flags} /></div>}

            <div className="rounded-lg border border-white/[0.06] p-3 space-y-1.5 text-sm">
              <div className="text-[10px] uppercase tracking-wider text-white/40">Main contact</div>
              <div className="text-white">{p.primaryContactName || "—"}{p.primaryContactRole && <span className="text-white/50"> · {p.primaryContactRole}</span>}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {p.primaryContactEmail && <a className="text-blue-400 hover:underline inline-flex items-center gap-1 min-h-[28px] break-all" href={`mailto:${p.primaryContactEmail}`}><Mail className="w-3.5 h-3.5" />{p.primaryContactEmail}</a>}
                {p.primaryContactPhone && <a className="text-blue-400 hover:underline inline-flex items-center gap-1 min-h-[28px]" href={`tel:${p.primaryContactPhone}`}><Phone className="w-3.5 h-3.5" />{p.primaryContactPhone}</a>}
                {p.website && <a className="text-blue-400 hover:underline inline-flex items-center gap-1 min-h-[28px] break-all" href={/^https?:/i.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer"><Globe className="w-3.5 h-3.5" />{p.website}</a>}
              </div>
              <div className="text-xs text-white/50 pt-1">Partner since {fmtDateNz(p.since)} · {fmtMoneyFull(p.annualValueCents)} a year{data.deal && <> · Won via pipeline deal: {data.deal.title}</>}</div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5 mr-1" />Edit</Button>
                {p.archivedAt ? (
                  <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => archive.mutate(false)}>Restore</Button>
                ) : confirmArchive ? (
                  <span className="inline-flex items-center gap-2 text-xs">
                    <span className="text-white/60">Archive this partner?</span>
                    <Button size="sm" variant="destructive" className="min-h-[44px] md:min-h-0" onClick={() => archive.mutate(true)} disabled={archive.isPending}>Yes, archive</Button>
                    <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setConfirmArchive(false)}>No</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setConfirmArchive(true)} data-testid="partner-archive"><Archive className="w-3.5 h-3.5 mr-1" />Archive</Button>
                )}
              </div>
            </div>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FileText className="w-4 h-4" />Contracts</h3>
              {contracts.length === 0 && <div className="text-sm text-white/50 rounded-lg border border-dashed border-white/10 p-4">No contract on file yet.</div>}
              {contracts.map(c => <ContractCard key={c.id} c={c} people={data.people} today={data.today} onEdit={() => setContractDlg({ contract: c })} />)}
              <Button variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setContractDlg({})} data-testid="partner-add-contract"><Plus className="w-4 h-4 mr-1.5" />Add contract</Button>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-white">Notes</h3>
              <Textarea rows={4} value={notes ?? p.notes ?? ""} onChange={e => setNotes(e.target.value)} placeholder="Anything we should remember about this partner" />
              <Button size="sm" className="min-h-[44px] md:min-h-0" disabled={notes === null || saveNotes.isPending} onClick={() => notes !== null && saveNotes.mutate(notes)}>Save notes</Button>
            </section>
          </div>
        )}
        {editing && p && <PartnerDialog partner={p} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
        {contractDlg && <ContractDialog partnerId={id} contract={contractDlg.contract} onClose={() => setContractDlg(null)} />}
      </SheetContent>
    </Sheet>
  );
}

// ── One contract ─────────────────────────────────────────────────────────────
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return <div className="min-w-0"><div className="text-[10px] uppercase tracking-wider text-white/40">{k}</div><div className="text-sm text-white/85 break-words">{v}</div></div>;
}

function ContractCard({ c, people, today, onEdit }: { c: Contract; people: { id: number; name: string }[]; today: string; onEdit: () => void }) {
  const { toast } = useToast();
  const [confirmDel, setConfirmDel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const sigOk = c.signatureStatus === "both_parties";

  const del = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/admin/sponsorship/partners/contracts/${c.id}`),
    onSuccess: () => { invalidateAll(); toast({ title: "Contract deleted" }); },
    onError: (e: any) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      // workspaceFetch adds the X-Workspace-Slug header; no Content-Type so the browser sets the boundary.
      const r = await workspaceFetch(`/api/admin/sponsorship/partners/contracts/${c.id}/file`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await readError(r, `Upload failed (${r.status})`));
      invalidateAll(); toast({ title: "Contract file saved" });
    } catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setUploading(false); }
  };
  const driveUrl = c.node?.sourceUrl || c.contractSourceUrl;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 sm:p-4 space-y-3 min-w-0" data-testid={`contract-${c.id}`}>
      <div className="flex items-start gap-2 flex-wrap">
        <div className="text-sm font-semibold leading-snug text-white break-words min-w-0 flex-1">{c.title || "Sponsorship agreement"}</div>
        {c.isCurrent && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">Current</span>}
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${CONTRACT_STATE_STYLE[c.state]}`}>{CONTRACT_STATE_LABEL[c.state]}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <KV k="Club entity" v={c.clubEntity} />
        <KV k="Term" v={`${fmtDateNz(c.startDate)} → ${c.openEnded ? "Ongoing" : fmtDateNz(c.endDate)}`} />
        <KV k="Signed on" v={c.signedOn ? fmtDateNz(c.signedOn) : null} />
        <KV k="Signature" v={<span className={sigOk ? "text-emerald-400" : "text-red-400"}>{SIGNATURE_LABEL[c.signatureStatus] ?? c.signatureStatus}{c.signedBy && <span className="text-white/60"> · {c.signedBy}</span>}</span>} />
        <KV k="Cash per year" v={c.cashPerYearCents != null ? `${fmtMoneyFull(c.cashPerYearCents)} excl GST` : null} />
        <KV k="Contra per year" v={c.contraPerYearCents ? `${fmtMoneyFull(c.contraPerYearCents)}${c.contraDescription ? ` — ${c.contraDescription}` : ""}` : null} />
        <KV k="Total cash" v={c.cashTotalCents != null ? fmtMoneyFull(c.cashTotalCents) : null} />
        <KV k="GST" v={c.gstNote} />
        <KV k="Renewal terms" v={c.renewalTerms ? `${c.renewalTerms}${c.autoRenews ? " (auto-renews)" : ""}` : (c.autoRenews ? "Auto-renews" : null)} />
        <KV k="Notice" v={c.noticeDays != null ? `${c.noticeDays} days` : null} />
        <KV k="Exclusivity" v={c.exclusivity} />
        <KV k="Termination" v={c.termination} />
      </div>
      {c.paymentTerms && <details className="text-sm"><summary className="cursor-pointer text-white/60 text-xs min-h-[28px]">Payment terms (verbatim)</summary><div className="mt-1 whitespace-pre-wrap text-white/80 text-xs break-words">{c.paymentTerms}</div></details>}
      {c.otherClauses && <details className="text-sm"><summary className="cursor-pointer text-white/60 text-xs min-h-[28px]">Other clauses</summary><div className="mt-1 whitespace-pre-wrap text-white/80 text-xs break-words">{c.otherClauses}</div></details>}
      {Array.isArray(c.flags) && c.flags.length > 0 && (
        <ul className="space-y-1">{c.flags.map((f, i) => <li key={i} className="flex items-start gap-1.5 text-xs text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" /><span className="break-words min-w-0">{f}</span></li>)}</ul>
      )}

      <div className="flex flex-wrap gap-2">
        {c.node ? (
          <>
            <Button size="sm" asChild className="min-h-[44px] md:min-h-0"><a href={c.node.openUrl} target="_blank" rel="noreferrer" data-testid="partner-open-contract"><FileText className="w-3.5 h-3.5 mr-1" />Open signed contract</a></Button>
            <Button size="sm" variant="outline" asChild className="min-h-[44px] md:min-h-0"><a href={c.node.downloadUrl}><Download className="w-3.5 h-3.5 mr-1" />Download</a></Button>
          </>
        ) : <Button size="sm" disabled title="No file" className="min-h-[44px] md:min-h-0"><FileText className="w-3.5 h-3.5 mr-1" />No signed file</Button>}
        {driveUrl && <Button size="sm" variant="outline" asChild className="min-h-[44px] md:min-h-0"><a href={driveUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" />Google Drive</a></Button>}
        <label className="inline-flex">
          <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={uploading} data-testid={`contract-file-${c.id}`}
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <span className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium min-h-[44px] md:min-h-[36px] cursor-pointer hover:bg-accent"><Upload className="w-3.5 h-3.5 mr-1" />{uploading ? "Uploading…" : c.node ? "Replace file" : "Upload file"}</span>
        </label>
        <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={onEdit}><Pencil className="w-3.5 h-3.5 mr-1" />Edit</Button>
        {confirmDel ? (
          <span className="inline-flex items-center gap-2 text-xs">
            <span className="text-white/60">Delete contract, instalments and promises?</span>
            <Button size="sm" variant="destructive" className="min-h-[44px] md:min-h-0" onClick={() => del.mutate()} disabled={del.isPending}>Delete</Button>
            <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setConfirmDel(false)}>No</Button>
          </span>
        ) : <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setConfirmDel(true)}><Trash2 className="w-3.5 h-3.5 mr-1" />Delete</Button>}
      </div>

      <Instalments contract={c} today={today} />
      <Deliverables contract={c} people={people} kind="promised" />
      <Deliverables contract={c} people={people} kind="idea" />
    </div>
  );
}

// ── Contract dialog (money typed in dollars) ─────────────────────────────────
function ContractDialog({ partnerId, contract, onClose }: { partnerId: number; contract?: Contract; onClose: () => void }) {
  const { toast } = useToast();
  const c = contract;
  const [f, setF] = useState({
    title: c?.title ?? "", clubEntity: c?.clubEntity ?? "", signedOn: c?.signedOn ?? "", startDate: c?.startDate ?? "", endDate: c?.endDate ?? "",
    openEnded: c?.openEnded ?? false, termMonths: c?.termMonths != null ? String(c.termMonths) : "", termText: c?.termText ?? "",
    renewalTerms: c?.renewalTerms ?? "", autoRenews: c?.autoRenews ?? false, noticeDays: c?.noticeDays != null ? String(c.noticeDays) : "",
    cashPerYear: centsToDollars(c?.cashPerYearCents), cashTotal: centsToDollars(c?.cashTotalCents), gstNote: c?.gstNote ?? "",
    contraPerYear: centsToDollars(c?.contraPerYearCents), contraDescription: c?.contraDescription ?? "", paymentTerms: c?.paymentTerms ?? "",
    exclusivity: c?.exclusivity ?? "", termination: c?.termination ?? "", otherClauses: c?.otherClauses ?? "",
    signatureStatus: (c?.signatureStatus ?? "not_checked") as SignatureStatus, signedBy: c?.signedBy ?? "",
    contractSourceUrl: c?.contractSourceUrl ?? "", flags: (c?.flags ?? []).join("\n"),
  });
  const txt = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: f.title, clubEntity: f.clubEntity, signedOn: f.signedOn || null, startDate: f.startDate || null,
        endDate: f.openEnded ? null : f.endDate || null, openEnded: f.openEnded, termMonths: num(f.termMonths), termText: f.termText,
        renewalTerms: f.renewalTerms, autoRenews: f.autoRenews, noticeDays: num(f.noticeDays),
        cashPerYearCents: dollarsToCents(f.cashPerYear), cashTotalCents: dollarsToCents(f.cashTotal), gstNote: f.gstNote,
        contraPerYearCents: dollarsToCents(f.contraPerYear), contraDescription: f.contraDescription, paymentTerms: f.paymentTerms,
        exclusivity: f.exclusivity, termination: f.termination, otherClauses: f.otherClauses,
        signatureStatus: f.signatureStatus, signedBy: f.signedBy, contractSourceUrl: f.contractSourceUrl,
        flags: f.flags.split("\n").map(x => x.trim()).filter(Boolean),
      };
      const r = c ? await apiRequest("PATCH", `/api/admin/sponsorship/partners/contracts/${c.id}`, body) : await apiRequest("POST", `/api/admin/sponsorship/partners/${partnerId}/contracts`, body);
      return r.json();
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Contract saved" }); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't save contract", description: e.message, variant: "destructive" }),
  });
  const field = (label: string, node: React.ReactNode) => <div className="min-w-0"><Label className="text-xs">{label}</Label>{node}</div>;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="contract-dialog">
        <DialogHeader><DialogTitle>{c ? "Edit contract" : "Add contract"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field("Title", <Input value={f.title} onChange={txt("title")} />)}
          {field("Club entity", <Input value={f.clubEntity} onChange={txt("clubEntity")} />)}
          {field("Signed on", <DatePickerInput value={f.signedOn} onChange={e => setF(s => ({ ...s, signedOn: e.target.value }))} fromYear={2015} toYear={2040} />)}
          {field("Start date", <DatePickerInput value={f.startDate} onChange={e => setF(s => ({ ...s, startDate: e.target.value }))} fromYear={2015} toYear={2040} />)}
          {field("End date", <DatePickerInput value={f.openEnded ? "" : f.endDate} disabled={f.openEnded} onChange={e => setF(s => ({ ...s, endDate: e.target.value }))} fromYear={2015} toYear={2045} />)}
          <label className="flex items-center gap-2 text-sm min-h-[44px] sm:self-end"><Switch checked={f.openEnded} onCheckedChange={v => setF(s => ({ ...s, openEnded: v }))} /> Ongoing (no end date)</label>
          {field("Term (months)", <Input inputMode="numeric" value={f.termMonths} onChange={txt("termMonths")} />)}
          {field("Term wording", <Input value={f.termText} onChange={txt("termText")} />)}
          {field("Cash per year ($, excl GST)", <Input inputMode="decimal" value={f.cashPerYear} onChange={txt("cashPerYear")} />)}
          {field("Total cash over the term ($)", <Input inputMode="decimal" value={f.cashTotal} onChange={txt("cashTotal")} />)}
          {field("Contra per year ($)", <Input inputMode="decimal" value={f.contraPerYear} onChange={txt("contraPerYear")} />)}
          {field("Contra is…", <Input value={f.contraDescription} onChange={txt("contraDescription")} />)}
          {field("GST note", <Input value={f.gstNote} onChange={txt("gstNote")} />)}
          {field("Notice (days)", <Input inputMode="numeric" value={f.noticeDays} onChange={txt("noticeDays")} />)}
          {field("Renewal terms", <Input value={f.renewalTerms} onChange={txt("renewalTerms")} />)}
          <label className="flex items-center gap-2 text-sm min-h-[44px] sm:self-end"><Switch checked={f.autoRenews} onCheckedChange={v => setF(s => ({ ...s, autoRenews: v }))} /> Auto-renews</label>
          {field("Signature status", (
            <Select value={f.signatureStatus} onValueChange={v => setF(s => ({ ...s, signatureStatus: v as SignatureStatus }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SIGNATURE_STATUSES.map(s => <SelectItem key={s} value={s}>{SIGNATURE_LABEL[s]}</SelectItem>)}</SelectContent>
            </Select>
          ))}
          {field("Signed by", <Input value={f.signedBy} onChange={txt("signedBy")} />)}
          <div className="sm:col-span-2">{field("Google Drive link", <Input value={f.contractSourceUrl} onChange={txt("contractSourceUrl")} placeholder="https://" />)}</div>
          <div className="sm:col-span-2">{field("Payment terms (verbatim)", <Textarea rows={3} value={f.paymentTerms} onChange={txt("paymentTerms")} />)}</div>
          {field("Exclusivity", <Textarea rows={2} value={f.exclusivity} onChange={txt("exclusivity")} />)}
          {field("Termination", <Textarea rows={2} value={f.termination} onChange={txt("termination")} />)}
          <div className="sm:col-span-2">{field("Other clauses", <Textarea rows={3} value={f.otherClauses} onChange={txt("otherClauses")} />)}</div>
          <div className="sm:col-span-2">{field("Notes on this contract (one per line)", <Textarea rows={3} value={f.flags} onChange={txt("flags")} />)}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="contract-save">{save.isPending ? "Saving…" : "Save contract"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Instalments ──────────────────────────────────────────────────────────────
function Instalments({ contract, today }: { contract: Contract; today: string }) {
  const { toast } = useToast();
  const [dlg, setDlg] = useState<{ payment?: Payment; mode: "edit" | "paid" } | null>(null);
  const [delId, setDelId] = useState<number | null>(null);
  const pays = contract.payments;
  const paid = pays.reduce((s, p) => s + (p.paidOn ? (p.paidCents ?? p.amountCents) : 0), 0);
  const outstanding = pays.reduce((s, p) => s + (p.paidOn ? 0 : p.amountCents), 0);

  const unmark = useMutation({
    mutationFn: async (pid: number) => apiRequest("PATCH", `/api/admin/sponsorship/partners/payments/${pid}`, { paidOn: null }),
    onSuccess: () => { invalidateAll(); toast({ title: "Marked unpaid" }); },
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: async (pid: number) => apiRequest("DELETE", `/api/admin/sponsorship/partners/payments/${pid}`),
    onSuccess: () => { invalidateAll(); setDelId(null); toast({ title: "Instalment deleted" }); },
    onError: (e: any) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2 pt-1">
      <h4 className="text-xs font-semibold text-white/80 flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5" />Instalments</h4>
      {pays.length === 0 && <div className="text-xs text-white/40">No instalments recorded.</div>}
      <div className="space-y-1.5">
        {pays.map(p => (
          <div key={p.id} className="rounded-lg border border-white/[0.06] p-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs" data-testid={`payment-${p.id}`}>
            <div className="min-w-[120px] flex-1 break-words text-white/85 font-medium">{p.label || "Instalment"}</div>
            <div className="text-white/60 whitespace-nowrap">Due {fmtDateNz(p.dueOn)}</div>
            <div className="tabular-nums text-white whitespace-nowrap">{fmtMoneyFull(p.amountCents)} <span className="text-white/40">{p.gstIncluded ? "incl GST" : "excl GST"}</span></div>
            {p.paidOn && <div className="text-emerald-400 whitespace-nowrap">Paid {fmtDateNz(p.paidOn)}</div>}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${PAY_STYLE[p.state]}`}>{PAY_LABEL[p.state]}</span>
            <div className="flex items-center gap-1 ml-auto">
              {p.paidOn
                ? <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => unmark.mutate(p.id)} disabled={unmark.isPending}>Unmark</Button>
                : <Button size="sm" className="min-h-[44px] md:min-h-0" onClick={() => setDlg({ payment: p, mode: "paid" })} data-testid={`payment-mark-paid-${p.id}`}><Check className="w-3.5 h-3.5 mr-1" />Mark paid</Button>}
              <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8" onClick={() => setDlg({ payment: p, mode: "edit" })} title="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
              {delId === p.id
                ? <Button size="sm" variant="destructive" className="min-h-[44px] md:min-h-0" onClick={() => del.mutate(p.id)}>Confirm</Button>
                : <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8" onClick={() => setDelId(p.id)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setDlg({ mode: "edit" })} data-testid="payment-add"><Plus className="w-3.5 h-3.5 mr-1" />Add instalment</Button>
        <div className="text-xs text-white/60 tabular-nums">Paid <span className="text-emerald-400 font-semibold">{fmtMoneyFull(paid)}</span> · Outstanding <span className="text-white font-semibold">{fmtMoneyFull(outstanding)}</span></div>
      </div>
      {dlg && <PaymentDialog contractId={contract.id} payment={dlg.payment} mode={dlg.mode} today={today} onClose={() => setDlg(null)} />}
    </div>
  );
}

function PaymentDialog({ contractId, payment, mode, today, onClose }: { contractId: number; payment?: Payment; mode: "edit" | "paid"; today: string; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    label: payment?.label ?? "", dueOn: payment?.dueOn ?? "", amount: centsToDollars(payment?.amountCents),
    gstIncluded: payment?.gstIncluded ?? false, xero: payment?.xeroInvoiceNumber ?? "", notes: payment?.notes ?? "",
    paidOn: payment?.paidOn ?? (mode === "paid" ? today : ""), paidAmount: centsToDollars(payment?.paidCents ?? payment?.amountCents),
  });
  const save = useMutation({
    mutationFn: async () => {
      const amountCents = dollarsToCents(f.amount);
      if (!amountCents || amountCents <= 0) throw new Error("Amount must be more than zero");
      const body: Record<string, unknown> = {
        label: f.label, dueOn: f.dueOn || null, amountCents, gstIncluded: f.gstIncluded, xeroInvoiceNumber: f.xero, notes: f.notes,
        paidOn: f.paidOn || null,
      };
      if (f.paidOn) body.paidCents = dollarsToCents(f.paidAmount) ?? amountCents;
      const r = payment ? await apiRequest("PATCH", `/api/admin/sponsorship/partners/payments/${payment.id}`, body) : await apiRequest("POST", `/api/admin/sponsorship/partners/contracts/${contractId}/payments`, body);
      return r.json();
    },
    onSuccess: () => { invalidateAll(); toast({ title: mode === "paid" ? "Marked paid" : "Instalment saved" }); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="payment-dialog">
        <DialogHeader><DialogTitle>{mode === "paid" ? "Mark instalment paid" : payment ? "Edit instalment" : "Add instalment"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {mode === "edit" && (
            <>
              <div><Label className="text-xs">Label</Label><Input value={f.label} onChange={e => setF(s => ({ ...s, label: e.target.value }))} placeholder="Year 2 instalment" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Due</Label><DatePickerInput value={f.dueOn} onChange={e => setF(s => ({ ...s, dueOn: e.target.value }))} fromYear={2015} toYear={2045} /></div>
                <div><Label className="text-xs">Amount ($)</Label><Input inputMode="decimal" value={f.amount} onChange={e => setF(s => ({ ...s, amount: e.target.value }))} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm min-h-[44px]"><Switch checked={f.gstIncluded} onCheckedChange={v => setF(s => ({ ...s, gstIncluded: v }))} /> Amount includes GST</label>
              <div><Label className="text-xs">Xero invoice number</Label><Input value={f.xero} onChange={e => setF(s => ({ ...s, xero: e.target.value }))} /></div>
              <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} /></div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Paid on {mode === "edit" && <span className="text-white/40">(blank = unpaid)</span>}</Label><DatePickerInput value={f.paidOn} onChange={e => setF(s => ({ ...s, paidOn: e.target.value }))} fromYear={2015} toYear={2045} /></div>
            <div><Label className="text-xs">Amount paid ($)</Label><Input inputMode="decimal" value={f.paidAmount} onChange={e => setF(s => ({ ...s, paidAmount: e.target.value }))} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (mode === "paid" && !f.paidOn)} data-testid="payment-save">{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Deliverables (promised) and ideas ────────────────────────────────────────
function Deliverables({ contract, people, kind }: { contract: Contract; people: { id: number; name: string }[]; kind: "promised" | "idea" }) {
  const { toast } = useToast();
  const isIdea = kind === "idea";
  const items = contract.deliverables.filter(d => (isIdea ? d.category === "idea" : d.category !== "idea"));
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState<"contract" | "activation">("contract");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");

  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/sponsorship/partners/contracts/${contract.id}/deliverables`, {
      title, category: isIdea ? "idea" : cat, triggerType: "once", scheduledDate: when || null, notes: notes || null,
    })).json(),
    onSuccess: () => { invalidateAll(); setTitle(""); setWhen(""); setNotes(""); setAdding(false); toast({ title: isIdea ? "Idea added" : "Deliverable added" }); },
    onError: (e: any) => toast({ title: "Couldn't add", description: e.message, variant: "destructive" }),
  });
  const patch = useMutation({
    mutationFn: async (v: { id: number; body: Record<string, unknown> }) => (await apiRequest("PATCH", `/api/admin/sponsorship/deliverables/${v.id}`, v.body)).json(),
    onSuccess: () => invalidateAll(),
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/sponsorship/deliverables/${id}`),
    onSuccess: () => { invalidateAll(); toast({ title: "Removed" }); },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2 pt-1">
      <h4 className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
        {isIdea ? <><Lightbulb className="w-3.5 h-3.5" />Ideas — above and beyond</> : <><ListChecks className="w-3.5 h-3.5" />Deliverables — what we promised</>}
      </h4>
      {items.length === 0 && <div className="text-xs text-white/40">{isIdea ? "No ideas yet." : "Nothing recorded yet."}</div>}
      <div className="space-y-1.5">
        {items.map(d => (
          <div key={d.id} className={`rounded-lg border border-white/[0.06] p-2 space-y-1.5 text-xs ${!isIdea && isDone(d.status) ? "opacity-70" : ""}`} data-testid={`deliverable-${d.id}`}>
            <div className="flex items-start gap-1">
              {!isIdea && <TickButton id={d.id} status={d.status} onToggle={() => patch.mutate({ id: d.id, body: { status: isDone(d.status) ? "pending" : "delivered" } })} />}
              <div className={`min-w-0 flex-1 font-medium break-words self-center ${!isIdea && isDone(d.status) ? "line-through text-white/40" : "text-white/90"}`}>{d.title}{!isIdea && d.category === "activation" && <span className="ml-1.5 text-[10px] text-white/40">activation</span>}</div>
              <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8 flex-shrink-0" onClick={() => del.mutate(d.id)} title="Remove"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
            {d.notes && <div className="text-white/50 break-words">{d.notes}</div>}
            {!isIdea && (
              <div className="flex flex-wrap items-center gap-2">
                <DoneStamp status={d.status} deliveredAt={d.deliveredAt} onUndo={() => patch.mutate({ id: d.id, body: { status: "pending" } })} />
                <StatusMenu id={d.id} status={d.status} onSet={st => patch.mutate({ id: d.id, body: { status: st } })} />
                <div className="w-[150px]"><DatePickerInput value={d.scheduledDate ?? ""} placeholder="Scheduled" onChange={e => patch.mutate({ id: d.id, body: { scheduledDate: e.target.value || null } })} fromYear={2015} toYear={2045} /></div>
                <Select value={d.ownerId ? String(d.ownerId) : "none"} onValueChange={v => patch.mutate({ id: d.id, body: { ownerId: v === "none" ? null : Number(v) } })}>
                  <SelectTrigger className="h-11 md:h-8 w-[140px] text-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No owner</SelectItem>{people.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
                <ProofControls id={d.id} proof={d.proof} proofUrl={d.proofUrl} />
              </div>
            )}
          </div>
        ))}
      </div>
      {adding ? (
        <div className="rounded-lg border border-white/10 p-2.5 space-y-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={isIdea ? "e.g. Player visit to their staff day" : "e.g. Logo on the home shirt"} autoFocus />
          {!isIdea && (
            <div className="flex flex-wrap gap-2">
              <Select value={cat} onValueChange={v => setCat(v as "contract" | "activation")}>
                <SelectTrigger className="h-11 md:h-9 w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="contract">In the contract</SelectItem><SelectItem value="activation">Scheduled activation</SelectItem></SelectContent>
              </Select>
              <div className="w-[170px]"><DatePickerInput value={when} placeholder="Scheduled (optional)" onChange={e => setWhen(e.target.value)} fromYear={2015} toYear={2045} /></div>
            </div>
          )}
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" />
          <div className="flex gap-2">
            <Button size="sm" className="min-h-[44px] md:min-h-0" onClick={() => add.mutate()} disabled={!title.trim() || add.isPending}>Add</Button>
            <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setAdding(true)} data-testid={isIdea ? "partner-add-idea" : "partner-add-deliverable"}>
          {isIdea ? <Lightbulb className="w-3.5 h-3.5 mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}{isIdea ? "Add idea" : "Add deliverable"}
        </Button>
      )}
    </div>
  );
}
