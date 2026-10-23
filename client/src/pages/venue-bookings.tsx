// USC workspace — Bookings tab.
//
// A single master ledger of EVERY booking on the calendar, whatever its origin:
//   • paid online through the booking website   (source = "public")
//   • added manually by a staff member          (source = "manual")
//   • a member request a staff member approved   (source = "member_request")
//
// Each row carries a plain-English paper trail — who added it or approved it, or
// that it came straight off the website — and, since 2026-10-22, the TRUTH about
// the money: PAID (card or Player Pay) · PLAYER PAY in progress · CHECKOUT OPEN ·
// NOT PAID (with why) · NEEDS ATTENTION (money landed on a released slot).
// Daniel: "cancelled makes me concerned and it's confusing if they have actually
// paid and we received the money." The badge used to read the row's bare status;
// it now reads shared/venue-booking-truth.ts, the one decider every surface uses.
//
// Click a row for the breakdown — the MFL Payments popup, for venue bookings:
// total · collected · how it was paid · every Player Pay member and their share ·
// the share link · cancel & refund. The Player Pay view lists every split.

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { ListChecks, Search, X, Crown, Mail, Phone, Copy, Link2, ExternalLink, Users, AlertTriangle, Check } from "lucide-react";
import type { FacilityBooking, Facility } from "@shared/schema";
import { describeVenuePayment, venueSplitShareUrl, type VenueSplitSummary, type VenuePaymentTone, type VenuePaymentState } from "@shared/venue-booking-truth";

type BookingRow = FacilityBooking & { facility?: Facility; split?: VenueSplitSummary | null };

type SourceFilter = "all" | "public" | "manual" | "member_request";
type StateFilter = "all" | VenuePaymentState;
type SortKey = "added" | "date";
type View = "bookings" | "player-pay";

const TONE_CLS: Record<VenuePaymentTone, string> = {
  green:  "bg-green-500/15 text-green-300 border-green-500/30",
  blue:   "bg-blue-500/15 text-blue-300 border-blue-500/30",
  amber:  "bg-amber-500/15 text-amber-300 border-amber-500/30",
  slate:  "bg-white/[0.06] text-white/50 border-white/15",
  red:    "bg-red-500/15 text-red-300 border-red-500/30",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

const SOURCE_STYLES: Record<string, { label: string; cls: string }> = {
  public:         { label: "Website",  cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  manual:         { label: "Staff",    cls: "bg-slate-500/15 text-slate-300 border-slate-400/30" },
  member_request: { label: "Member",   cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
};

// A split that did not complete is "Released" — the slot went back on sale and
// anyone who paid was refunded. Never "Cancelled": that word reads as a verdict
// on the customer, and it is the word that had Daniel worried paid bookings were not.
const SPLIT_LABEL: Record<string, string> = { open: "Collecting", settling: "Collecting", settled: "Settled", cancelled: "Released", failed: "Failed" };
const SPLIT_BADGE: Record<string, string> = {
  open: TONE_CLS.amber, settling: TONE_CLS.amber, settled: TONE_CLS.green, cancelled: TONE_CLS.slate, failed: TONE_CLS.red,
};
const MEMBER_BADGE: Record<string, string> = {
  paid: "bg-green-500/15 text-green-400", card_saved: "bg-white/10 text-white/60", joined: "bg-white/10 text-white/40",
  failed: "bg-red-500/15 text-red-400", removed: "bg-white/[0.06] text-white/30",
};
const MEMBER_LABEL: Record<string, string> = { paid: "Paid", card_saved: "Card saved", joined: "Not paid yet", failed: "Failed", removed: "Removed" };

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}
function fmtAdded(ts: string | Date | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
}
function fmtStamp(ts: string | Date | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-NZ", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
// What was added on top of the pitch — floodlights, changing rooms — stored at
// checkout as addons_json [{ addonId, name, unit, qty, priceCents }] where
// priceCents is that line's total. Daniel, 2026-10-23: "is it with lights or
// without lights — this stuff needs to be easily visible."
type AddonLine = { addonId?: number; name: string; unit?: string; qty?: number; priceCents?: number };
function addonsOf(b: { addonsJson?: unknown }): AddonLine[] {
  return Array.isArray(b.addonsJson) ? (b.addonsJson as AddonLine[]).filter(a => a && a.name) : [];
}
function addonSummary(b: { addonsJson?: unknown }): string {
  return addonsOf(b).map(a => `${a.name}${a.qty && a.qty > 1 ? ` ×${a.qty}` : ""}`).join(" · ");
}

function sizeLabel(b: { halfFull: string | null; halfPosition: string | null }): string {
  if (b.halfFull === "half") return b.halfPosition ? ` · ${b.halfPosition} half` : " · half";
  if (b.halfFull === "quarter") return b.halfPosition ? ` · quarter ${b.halfPosition.toUpperCase()}` : " · quarter";
  return "";
}

// Plain-English paper trail for a booking — matches the calendar detail modal.
function attribution(b: BookingRow): string {
  if (b.source === "public") return "Booked online via the website";
  if (b.source === "member_request") return b.createdByName ? `Approved by ${b.createdByName}` : "Member request (approved)";
  if (b.source === "manual") return b.createdByName ? `Added by ${b.createdByName}` : "Added by staff";
  return "—";
}

function Badge({ tone, children, testId }: { tone: VenuePaymentTone; children: React.ReactNode; testId?: string }) {
  return <span data-testid={testId} className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${TONE_CLS[tone]}`}>{children}</span>;
}

function ProgressBar({ paid, target }: { paid: number; target: number | null }) {
  const n = target && target > 0 ? target : Math.max(paid, 1);
  return (
    <div className="flex gap-0.5 mt-1" aria-hidden>
      {Array.from({ length: Math.min(n, 24) }).map((_, i) => (
        <div key={i} className={`h-1 flex-1 rounded-full ${i < paid ? "bg-green-500" : "bg-white/10"}`} />
      ))}
    </div>
  );
}

export default function VenueBookings() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const [view, setView] = useState<View>("bookings");
  const [source, setSource] = useState<SourceFilter>("all");
  const [state, setState] = useState<StateFilter>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BookingRow | null>(null);

  // Same endpoint + query key the Bookings Calendar uses, so this list stays in
  // lock-step with it (and updates when a booking is created/approved).
  const { data: bookings = [], isLoading } = useQuery<BookingRow[]>({
    queryKey: ["/api/admin/venue/bookings", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/bookings?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const described = useMemo(() => bookings.map(b => ({ b, t: describeVenuePayment(b) })), [bookings]);

  const counts = useMemo(() => ({
    all: bookings.length,
    public: bookings.filter(b => b.source === "public").length,
    manual: bookings.filter(b => b.source === "manual").length,
    member_request: bookings.filter(b => b.source === "member_request").length,
  }), [bookings]);

  const stateCounts = useMemo(() => {
    const c: Record<string, number> = { all: described.length };
    for (const { t } of described) c[t.state] = (c[t.state] || 0) + 1;
    return c;
  }, [described]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = described.filter(({ b, t }) => (source === "all" || b.source === source) && (state === "all" || t.state === state));
    if (q) {
      list = list.filter(({ b }) =>
        (b.customerName || "").toLowerCase().includes(q) ||
        (b.customerEmail || "").toLowerCase().includes(q) ||
        (b.customerClub || "").toLowerCase().includes(q) ||
        (b.facility?.name || "").toLowerCase().includes(q) ||
        (b.createdByName || "").toLowerCase().includes(q) ||
        (b.attributionSource || "").toLowerCase().includes(q)
      );
    }
    return list.slice().sort((x, y) =>
      sort === "added"
        ? new Date(y.b.createdAt as any).getTime() - new Date(x.b.createdAt as any).getTime()
        : y.b.bookingDate.localeCompare(x.b.bookingDate) || y.b.startTime.localeCompare(x.b.startTime)
    );
  }, [described, source, state, search, sort]);

  // Live count + money for the CURRENT filtered view. "Revenue collected" is
  // money the club actually holds on PAID bookings; shares collected on a
  // Player Pay split still in progress are shown on their own line, because
  // that money is real but the booking is not yet confirmed.
  const summary = useMemo(() => {
    let paidCents = 0, paidCount = 0, inProgress = 0, inProgressCents = 0, attention = 0;
    for (const { t } of rows) {
      if (t.state === "paid") { paidCents += t.collectedCents; paidCount++; }
      if (t.state === "in_progress") { inProgress++; inProgressCents += t.collectedCents; }
      if (t.state === "attention") attention++;
    }
    return { count: rows.length, paidCount, paidRevenue: paidCents / 100, inProgress, inProgressCents, attention };
  }, [rows]);

  const FILTERS: { key: SourceFilter; label: string }[] = [
    { key: "all", label: `All (${counts.all})` },
    { key: "public", label: `Website (${counts.public})` },
    { key: "manual", label: `Staff (${counts.manual})` },
    { key: "member_request", label: `Member (${counts.member_request})` },
  ];
  const STATES: { key: StateFilter; label: string }[] = [
    { key: "all", label: "Any status" },
    { key: "paid", label: `Paid (${stateCounts.paid || 0})` },
    { key: "in_progress", label: `Player Pay (${stateCounts.in_progress || 0})` },
    { key: "no_charge", label: `Confirmed (${stateCounts.no_charge || 0})` },
    { key: "checkout_open", label: `Checkout open (${stateCounts.checkout_open || 0})` },
    { key: "not_paid", label: `Not paid (${stateCounts.not_paid || 0})` },
    ...(stateCounts.attention ? [{ key: "attention" as StateFilter, label: `Needs attention (${stateCounts.attention})` }] : []),
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <ListChecks className="w-6 h-6 text-white/40 flex-shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-white" data-testid="text-bookings-title">Bookings</h1>
            <p className="text-sm text-white/40">
              {view === "player-pay"
                ? "Player Pay bookings — who has paid their share, who to chase, and what each split has collected."
                : "Every booking — paid online, added by staff, or approved from a member request — with who added it and what was actually paid."}
            </p>
          </div>
        </div>
        <div className="flex items-center rounded-full bg-white/[0.03] border border-white/10 p-0.5">
          {([["bookings", "Bookings"], ["player-pay", "Player Pay"]] as [View, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} data-testid={`view-${k}`}
              className={`px-3.5 h-8 rounded-full text-xs font-medium transition ${view === k ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "player-pay" ? (
        <PlayerPayView orgId={orgId} bookings={bookings} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" data-testid="bookings-summary">
            <div><span className="text-white/40">Showing</span> <span className="text-white font-semibold">{summary.count}</span> <span className="text-white/40">booking{summary.count === 1 ? "" : "s"}</span></div>
            <div><span className="text-white/40">Paid</span> <span className="text-white font-semibold">{summary.paidCount}</span></div>
            <div><span className="text-white/40">Revenue collected</span> <span className="text-green-300 font-semibold">${summary.paidRevenue.toFixed(2)}</span></div>
            {summary.inProgress > 0 && (
              <div data-testid="summary-player-pay"><span className="text-white/40">Player Pay in progress</span> <span className="text-amber-300 font-semibold">{summary.inProgress}</span> <span className="text-white/40">· {formatCurrency(summary.inProgressCents, { fromCents: true })} collected so far</span></div>
            )}
            {summary.attention > 0 && (
              <div data-testid="summary-attention" className="flex items-center gap-1 text-red-300"><AlertTriangle className="w-3.5 h-3.5" /> <span className="font-semibold">{summary.attention}</span> <span>need{summary.attention === 1 ? "s" : ""} attention</span></div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {FILTERS.map(f => (
                <button key={f.key} onClick={() => setSource(f.key)} data-testid={`filter-source-${f.key}`}
                  className={`px-3.5 h-8 rounded-full text-xs font-medium border transition ${source === f.key ? "bg-blue-500/20 border-blue-500/40 text-blue-200" : "bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80"}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 rounded-full bg-white/[0.03] border border-white/10 px-3 h-8">
                <Search className="w-3.5 h-3.5 text-white/30" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, facility, tag…"
                  className="bg-transparent text-xs text-white placeholder:text-white/30 outline-none w-44" data-testid="input-bookings-search" />
              </div>
              <div className="flex items-center rounded-full bg-white/[0.03] border border-white/10 p-0.5">
                {([["added", "Recently added"], ["date", "Booking date"]] as [SortKey, string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setSort(k)} data-testid={`sort-${k}`}
                    className={`px-3 h-7 rounded-full text-[11px] font-medium transition ${sort === k ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap" data-testid="filter-states">
            {STATES.map(s => (
              <button key={s.key} onClick={() => setState(s.key)} data-testid={`filter-state-${s.key}`}
                className={`px-3 h-7 rounded-full text-[11px] font-medium border transition ${state === s.key ? "bg-white/10 border-white/20 text-white" : "bg-transparent border-white/10 text-white/40 hover:text-white/70"}`}>
                {s.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center text-white/30">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center">
              <ListChecks className="w-12 h-12 text-white/10 mx-auto mb-3" />
              <p className="text-white/40 text-lg mb-1">No bookings to show</p>
              <p className="text-white/20 text-sm">Try a different filter or clear your search.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left" style={{ tableLayout: "fixed" }} data-testid="bookings-table">
                  <colgroup>
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "180px" }} />
                    <col style={{ width: "200px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "240px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "200px" }} />
                  </colgroup>
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-white/40 border-b border-white/10">
                      <th className="px-3 py-2.5 font-medium">Date</th>
                      <th className="px-3 py-2.5 font-medium">Time</th>
                      <th className="px-3 py-2.5 font-medium">Facility</th>
                      <th className="px-3 py-2.5 font-medium">Customer</th>
                      <th className="px-3 py-2.5 font-medium">Amount</th>
                      <th className="px-3 py-2.5 font-medium">Payment</th>
                      <th className="px-3 py-2.5 font-medium">Source</th>
                      <th className="px-3 py-2.5 font-medium">Added / approved by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ b, t }) => {
                      const amount = Number(b.totalAmount || 0);
                      const sr = b.source ? SOURCE_STYLES[b.source] : null;
                      return (
                        <tr key={b.id} onClick={() => setSelected(b)} className="border-b border-white/5 hover:bg-white/[0.03] align-top cursor-pointer" data-testid={`booking-row-${b.id}`}>
                          <td className="px-3 py-2.5 text-xs text-white/80 truncate">{fmtDate(b.bookingDate)}</td>
                          <td className="px-3 py-2.5 text-xs text-white/50 truncate">{fmtTime(b.startTime)}–{fmtTime(b.endTime)}</td>
                          <td className="px-3 py-2.5 text-xs text-white/80 truncate" title={`${b.facility?.name || "Facility"}${sizeLabel(b)}${addonSummary(b) ? ` · ${addonSummary(b)}` : ""}`}>
                            {b.facility?.name || "Facility"}<span className="text-white/40">{sizeLabel(b)}</span>
                            {addonSummary(b)
                              ? <div className="text-[11px] text-amber-200/80 truncate mt-0.5" data-testid={`addons-${b.id}`}>+ {addonSummary(b)}</div>
                              : (b.source === "public" && <div className="text-[11px] text-white/25 truncate mt-0.5">No add-ons</div>)}
                          </td>
                          <td className="px-3 py-2.5 truncate" title={`${b.customerName || ""}${b.customerEmail ? " · " + b.customerEmail : ""}`}>
                            <div className="text-xs text-white/85 truncate">{b.customerName || "—"}</div>
                            {b.customerEmail && <div className="text-[11px] text-white/35 truncate">{b.customerEmail}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-white/70 truncate">{amount > 0 ? `$${amount.toFixed(2)}` : "—"}</td>
                          <td className="px-3 py-2.5">
                            <Badge tone={t.tone} testId={`payment-state-${b.id}`}>{t.headline}</Badge>
                            <div className="text-[11px] text-white/45 truncate mt-1" title={t.detail} data-testid={`payment-detail-${b.id}`}>{t.detail}</div>
                            {b.split && (t.state === "in_progress" || t.state === "attention") && <ProgressBar paid={b.split.paidCount} target={b.split.targetCount} />}
                          </td>
                          <td className="px-3 py-2.5">
                            {sr
                              ? <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${sr.cls}`}>{sr.label}</span>
                              : <span className="text-xs text-white/30">—</span>}
                            {b.attributionSource && <div className="text-[10px] text-white/40 truncate mt-1" title={`Came from: ${b.attributionSource}`}>{b.attributionSource}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-white/55 truncate" title={attribution(b)}>
                            {attribution(b)}
                            <div className="text-[11px] text-white/30 truncate">{fmtAdded(b.createdAt)}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {selected && <BookingDetailModal booking={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Booking detail — the MFL Payments popup, for a venue booking.
   ────────────────────────────────────────────────────────────────────────── */

function BookingDetailModal({ booking: b, onClose }: { booking: BookingRow; onClose: () => void }) {
  const { toast } = useToast();
  const t = describeVenuePayment(b);
  const total = b.totalCents ?? Math.round(Number(b.totalAmount || 0) * 100);

  const confirmPaid = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/venue/bookings/${b.id}/confirm-paid`).then(r => r.json()),
    onSuccess: (r: { paid: number[]; conflicts: number[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/bookings"] });
      if (r.paid.length > 0) toast({ title: "Booking confirmed", description: "It now reads Paid — the money was already on the club's account." });
      else toast({ title: "Slot is taken", description: "Someone else now holds that slot. Move or refund this booking.", variant: "destructive" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't confirm", description: e?.message || "Try again.", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose} data-testid="booking-detail-modal">
      <div className="bg-[#0a0e1a] border border-blue-500/15 rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-white/5 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-white truncate">{b.customerName || "Booking"}</h2>
              <Badge tone={t.tone} testId="modal-payment-state">{t.headline}</Badge>
            </div>
            <p className="text-xs text-white/40 mt-0.5">
              {b.facility?.name || "Facility"}{sizeLabel(b)} · {fmtDate(b.bookingDate)} · {fmtTime(b.startTime)}–{fmtTime(b.endTime)}
            </p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 flex-shrink-0" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total", value: formatCurrency(total, { fromCents: true }) },
              { label: "Collected", value: formatCurrency(t.collectedCents, { fromCents: true }), klass: t.collectedCents > 0 ? "text-green-400" : "text-white/60" },
              b.split
                ? { label: "Shares paid", value: `${b.split.paidCount}/${b.split.targetCount || b.split.joinedCount}`, klass: b.split.targetCount && b.split.paidCount < b.split.targetCount ? "text-yellow-400" : "text-white/60" }
                : { label: "Paid on", value: b.paidAt ? fmtAdded(b.paidAt) : "—", klass: "text-white/60" },
            ].map((s, i) => (
              <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/30">{s.label}</p>
                <p className={`text-base font-bold mt-0.5 ${s.klass || "text-white"}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* The one-line truth */}
          <div className={`rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed ${t.state === "attention" ? "border-red-500/25 bg-red-500/[0.06] text-red-200/90" : t.state === "in_progress" ? "border-amber-500/20 bg-amber-500/[0.05] text-amber-100/80" : "border-white/5 bg-white/[0.02] text-white/60"}`} data-testid="modal-payment-detail">
            {t.state === "attention" && <AlertTriangle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />}
            {t.detail}
          </div>

          {t.state === "attention" && (
            <button onClick={() => confirmPaid.mutate()} disabled={confirmPaid.isPending} data-testid="confirm-paid"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-green-500/15 text-green-300 hover:bg-green-500/25 disabled:opacity-50 transition-colors">
              <Check className="w-3.5 h-3.5" /> {confirmPaid.isPending ? "Checking the slot…" : "Confirm booking — the money is in"}
            </button>
          )}

          {b.split && <SplitPanel splitId={b.split.id} onChanged={onClose} />}

          {/* Card payment reference */}
          {!b.split && b.stripePaymentIntentId && (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-white/30">Card payment</p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] font-mono text-white/50 break-all">{b.stripePaymentIntentId}</span>
                <a href={`https://dashboard.stripe.com/payments/${b.stripePaymentIntentId}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200" data-testid="stripe-link">
                  <ExternalLink className="w-3 h-3" /> Open in Stripe
                </a>
              </div>
              {b.paidAt && <p className="text-[11px] text-white/40">Paid {fmtStamp(b.paidAt)}</p>}
            </div>
          )}

          {/* What was bought — pitch + every add-on, then GST. addons_json holds
              each add-on line's total; the pitch is what is left of the subtotal. */}
          {(() => {
            const addons = addonsOf(b);
            const subtotal = b.subtotalCents ?? Math.max(0, total - (b.gstCents ?? 0));
            const addonCentsIncl = addons.reduce((a, x) => a + (x.priceCents || 0), 0);
            const gst = b.gstCents ?? Math.max(0, total - subtotal);
            // add-on prices are stored GST-inclusive; show pitch hire as the rest
            const pitchIncl = Math.max(0, total - addonCentsIncl);
            const hours = (() => { const [sh, sm] = b.startTime.split(":").map(Number); const [eh, em] = b.endTime.split(":").map(Number); return ((eh * 60 + em) - (sh * 60 + sm)) / 60; })();
            return (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-1.5" data-testid="price-breakdown">
                <p className="text-[10px] uppercase tracking-wider text-white/30">What was booked</p>
                <div className="flex justify-between text-[12px]"><span className="text-white/70">{b.facility?.name || "Pitch"}{sizeLabel(b)} · {hours % 1 === 0 ? hours : hours.toFixed(1)}h</span><span className="text-white/80">{formatCurrency(pitchIncl, { fromCents: true })}</span></div>
                {addons.map((a, i) => (
                  <div key={i} className="flex justify-between text-[12px]" data-testid={`price-addon-${i}`}>
                    <span className="text-amber-200/80">+ {a.name}{a.qty && a.qty > 1 ? ` ×${a.qty}` : ""}{a.unit === "per_hour" ? " (per hour)" : ""}</span>
                    <span className="text-white/80">{typeof a.priceCents === "number" ? formatCurrency(a.priceCents, { fromCents: true }) : "—"}</span>
                  </div>
                ))}
                {addons.length === 0 && b.source === "public" && <div className="text-[11px] text-white/30">No add-ons — no floodlights, no changing rooms</div>}
                {(b.discountCents ?? 0) > 0 && <div className="flex justify-between text-[12px]"><span className="text-white/50">Discount{b.discountCode ? ` (${b.discountCode})` : ""}</span><span className="text-white/60">−{formatCurrency(b.discountCents ?? 0, { fromCents: true })}</span></div>}
                <div className="flex justify-between text-[11px] text-white/35 pt-1 border-t border-white/5"><span>Includes GST</span><span>{formatCurrency(gst, { fromCents: true })}</span></div>
                <div className="flex justify-between text-[12px] font-semibold"><span className="text-white/80">Total</span><span className="text-white">{formatCurrency(total, { fromCents: true })}</span></div>
              </div>
            );
          })()}

          {/* Who and what */}
          <div className="space-y-1.5 text-[12px]">
            {b.customerEmail && <Row label="Email"><a href={`mailto:${b.customerEmail}`} className="text-blue-300 hover:underline break-all">{b.customerEmail}</a></Row>}
            {b.customerPhone && <Row label="Phone"><a href={`tel:${b.customerPhone}`} className="text-blue-300 hover:underline">{b.customerPhone}</a></Row>}
            {b.customerClub && <Row label="Club / org">{b.customerClub}</Row>}
            {b.discountCode && <Row label="Discount">{b.discountCode}{b.discountCents ? ` · −${formatCurrency(b.discountCents, { fromCents: true })}` : ""}</Row>}
            {b.notes && <Row label="Notes"><span className="whitespace-pre-wrap">{b.notes}</span></Row>}
            <Row label="Booked">{fmtStamp(b.createdAt)}{b.attributionSource ? ` · from ${b.attributionSource}` : ""}</Row>
            <Row label="Added by">{attribution(b)}</Row>
            {b.bookingGroupId && <Row label="Reference"><span className="font-mono text-white/50 break-all">{b.bookingGroupId}</span></Row>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 flex-shrink-0 text-white/35">{label}</span>
      <span className="text-white/75 min-w-0">{children}</span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Player Pay — the split's members, share link and cancel & refund.
   Shared by the booking popup and the Player Pay view.
   ────────────────────────────────────────────────────────────────────────── */

type SplitMember = {
  id: number; name: string | null; email: string | null; phone: string | null;
  role: "organiser" | "member"; status: "joined" | "card_saved" | "paid" | "failed" | "removed";
  chargedCents: number | null; paidAt: string | null; stripeRefundStatus: string | null;
};
type SplitDetail = {
  session: { id: number; teamName: string | null; totalCents: number; status: string; shareCode: string; targetCount: number | null; settledAt: string | null; deadlineAt: string | null; createdAt: string };
  members: SplitMember[];
};

function SplitPanel({ splitId, onChanged }: { splitId: number; onChanged?: () => void }) {
  const { toast } = useToast();
  const { data: detail, isLoading } = useQuery<SplitDetail>({
    queryKey: ["/api/admin/venue/splits", splitId],
    queryFn: () => fetch(`/api/admin/venue/splits/${splitId}`).then(r => r.json()),
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/splits"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/bookings"] });
  };
  const cancel = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/venue/splits/${splitId}/cancel`).then(r => r.json()),
    onSuccess: (r: any) => {
      invalidate();
      toast({ title: "Player Pay cancelled", description: r.refunded ? `Refunded ${r.refunded} share${r.refunded === 1 ? "" : "s"} and released the slot.` : "Nothing had been charged. Slot released." });
      onChanged?.();
    },
    onError: (e: any) => toast({ title: "Couldn't cancel", description: e?.message || "Try again.", variant: "destructive" }),
  });

  const s = detail?.session;
  const shareUrl = s ? venueSplitShareUrl(s.shareCode) : "";
  const copyShareLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); toast({ title: "Copied", description: "Share link copied — paste it anywhere" }); }
    catch { window.prompt("Copy the share link:", shareUrl); }
  };
  const members = (detail?.members ?? []).filter(m => m.status !== "removed");
  const paidCount = members.filter(m => m.status === "paid").length;

  if (isLoading || !s) return <div className="text-center text-white/20 text-sm py-4">Loading Player Pay…</div>;

  return (
    <div className="space-y-3" data-testid="split-panel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] uppercase tracking-wider text-white/30 flex items-center gap-1.5"><Users className="w-3 h-3" /> Player Pay · {paidCount} of {s.targetCount || members.length} paid</p>
        <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${SPLIT_BADGE[s.status] || TONE_CLS.slate}`} data-testid="split-status">{SPLIT_LABEL[s.status] || s.status}</span>
      </div>

      {s.status !== "cancelled" && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30 flex items-center gap-1"><Link2 className="w-3 h-3" /> Share link — the page the squad pays on</p>
          <div className="flex items-center gap-2">
            <input readOnly value={shareUrl} onFocus={e => e.currentTarget.select()} data-testid="split-share-url"
              className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] font-mono text-white/60 focus:outline-none focus:border-blue-500/40" />
            <button onClick={copyShareLink} data-testid="split-copy-link"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white/[0.06] text-white/70 hover:bg-white/10 transition-colors flex-shrink-0">
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
          {s.deadlineAt && s.status === "open" && <p className="text-[11px] text-white/35">Slot held until {fmtStamp(s.deadlineAt)} — after that the split closes and anyone who paid is refunded.</p>}
        </div>
      )}

      <div className="space-y-1.5">
        {members.length === 0 ? (
          <p className="text-xs text-white/30 text-center py-3">Nobody has joined this split yet.</p>
        ) : members.map(m => (
          <div key={m.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5" data-testid={`split-member-${m.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {m.role === "organiser" && <Crown className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                <span className="text-sm font-medium text-white/80 truncate">{m.name || "—"}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-white/30 mt-0.5 flex-wrap">
                {m.email && <a href={`mailto:${m.email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 hover:text-white/50 truncate"><Mail className="w-3 h-3 flex-shrink-0" />{m.email}</a>}
                {m.phone && <span className="flex items-center gap-1 flex-shrink-0"><Phone className="w-3 h-3" />{m.phone}</span>}
                {m.status === "paid" && m.paidAt && <span className="flex-shrink-0">paid {fmtAdded(m.paidAt)}</span>}
                {m.stripeRefundStatus && <span className="flex-shrink-0 text-white/40">refund {m.stripeRefundStatus}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {(m.chargedCents ?? 0) > 0 && <span className={`text-sm font-semibold ${m.status === "paid" ? "text-white" : "text-white/40"}`}>{formatCurrency(m.chargedCents ?? 0, { fromCents: true })}</span>}
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${MEMBER_BADGE[m.status] || MEMBER_BADGE.joined}`}>{MEMBER_LABEL[m.status] || m.status}</span>
            </div>
          </div>
        ))}
      </div>

      {(s.status === "open" || s.status === "settling") && (
        <div className="flex items-center justify-end pt-1">
          <button
            onClick={() => { if (window.confirm("Cancel this Player Pay split, refund anyone who has paid, and release the slot? This can't be undone.")) cancel.mutate(); }}
            disabled={cancel.isPending} data-testid="split-cancel"
            className="text-xs font-medium px-3 py-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
            {cancel.isPending ? "Cancelling…" : "Cancel & refund"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Player Pay view — every split that funds a booking at this venue.
   ────────────────────────────────────────────────────────────────────────── */

type SplitRow = {
  id: number; shareCode: string; label: string | null; bookingGroupId: string | null;
  organiserName: string | null; organiserEmail: string | null;
  status: string; totalCents: number; targetCount: number | null; shareCents: number;
  joinedCount: number; paidCount: number; collectedCents: number;
  createdAt: string; deadlineAt: string | null; settledAt: string | null;
};

function PlayerPayView({ orgId, bookings }: { orgId: number | undefined; bookings: BookingRow[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: splits = [], isLoading } = useQuery<SplitRow[]>({
    queryKey: ["/api/admin/venue/splits", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/splits?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });
  const settled = splits.filter(s => s.status === "settled").length;
  const collecting = splits.filter(s => s.status === "open" || s.status === "settling").length;
  const collected = splits.reduce((a, s) => a + (s.status === "cancelled" ? 0 : (s.collectedCents || 0)), 0);
  const bookingFor = (s: SplitRow) => bookings.find(b => b.bookingGroupId && b.bookingGroupId === s.bookingGroupId) || null;
  const selectedSplit = selectedId ? splits.find(s => s.id === selectedId) || null : null;
  const selectedBooking = selectedSplit ? bookingFor(selectedSplit) : null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="player-pay-stats">
        {[
          { label: "Splits", value: String(splits.length) },
          { label: "Collecting now", value: String(collecting), klass: collecting > 0 ? "text-amber-300" : undefined },
          { label: "Settled", value: String(settled), klass: "text-green-400" },
          { label: "Collected", value: formatCurrency(collected, { fromCents: true }), klass: "text-green-400" },
        ].map((c, i) => (
          <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30">{c.label}</p>
            <p className={`text-base font-bold mt-0.5 ${c.klass || "text-white"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center text-white/30">Loading…</div>
      ) : splits.length === 0 ? (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center">
          <Users className="w-12 h-12 text-white/10 mx-auto mb-3" />
          <p className="text-white/40 text-lg mb-1">No Player Pay bookings yet</p>
          <p className="text-white/20 text-sm">They appear here when a customer splits a pitch booking across their squad.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="player-pay-table">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-white/40 border-b border-white/10">
                  {["Booking", "Organiser", "Status", "Progress", "Collected", "Closes / settled"].map(h => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {splits.map(s => {
                  const bk = bookingFor(s);
                  const t = bk ? describeVenuePayment(bk) : null;
                  return (
                    <tr key={s.id} onClick={() => setSelectedId(s.id)} className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer align-top" data-testid={`split-row-${s.id}`}>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-white/85">{s.label || `Split #${s.id}`}</div>
                        {t && <div className="text-[11px] text-white/40 mt-0.5">{t.headline} · {t.detail}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-white/80">{s.organiserName || "—"}</div>
                        {s.organiserEmail && <div className="text-[11px] text-white/35">{s.organiserEmail}</div>}
                      </td>
                      <td className="px-3 py-2.5"><span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${SPLIT_BADGE[s.status] || TONE_CLS.slate}`}>{SPLIT_LABEL[s.status] || s.status}</span></td>
                      <td className="px-3 py-2.5 min-w-[140px]">
                        <div className="text-xs text-white/70">{s.paidCount} of {s.targetCount || s.joinedCount} paid · {formatCurrency(s.shareCents, { fromCents: true })} each</div>
                        <ProgressBar paid={s.paidCount} target={s.targetCount} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-white/80 whitespace-nowrap">{formatCurrency(s.collectedCents, { fromCents: true })} <span className="text-white/35">of {formatCurrency(s.totalCents, { fromCents: true })}</span></td>
                      <td className="px-3 py-2.5 text-[11px] text-white/45 whitespace-nowrap">
                        {s.status === "settled" ? `Settled ${fmtAdded(s.settledAt)}` : s.status === "cancelled" ? "Released" : s.deadlineAt ? `Closes ${fmtStamp(s.deadlineAt)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedSplit && (selectedBooking
        ? <BookingDetailModal booking={selectedBooking} onClose={() => setSelectedId(null)} />
        : (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelectedId(null)}>
            <div className="bg-[#0a0e1a] border border-blue-500/15 rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-white/5">
                <h2 className="text-lg font-semibold text-white">{selectedSplit.label || `Split #${selectedSplit.id}`}</h2>
                <button onClick={() => setSelectedId(null)} className="text-white/30 hover:text-white/60" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 overflow-y-auto flex-1"><SplitPanel splitId={selectedSplit.id} onChanged={() => setSelectedId(null)} /></div>
            </div>
          </div>
        ))}
    </>
  );
}
