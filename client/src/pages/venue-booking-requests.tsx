// USC workspace — Booking Requests tab.
//
// Member booking requests submitted from book.unitedsportscentre.com/members
// land here as "pending". Approving one creates a confirmed $0 booking on the
// calendar (blocking the slot) and emails the member a branded confirmation;
// declining emails them a polite heads-up with an optional reason.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardCheck, CheckCircle2, XCircle, Clock, Mail, Phone, Cake,
  Calendar as CalendarIcon, MapPin, X, Loader2, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface BookingRequestRow {
  id: number;
  organizationId: number;
  facilityId: number;
  facilityName: string | null;
  fullName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  halfFull: string | null;
  halfPosition: string | null;
  waiverAccepted: boolean;
  waiverVersion: string | null;
  waiverAcceptedAt: string | null;
  status: "pending" | "approved" | "declined";
  reviewedAt: string | null;
  declineReason: string | null;
  facilityBookingId: number | null;
  createdAt: string;
}

type Filter = "pending" | "approved" | "declined" | "all";

function fmtDateLong(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function fmtTimestamp(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function ageFromDob(dob: string): number | null {
  const d = new Date(dob + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function sizeLabel(halfFull: string | null, halfPosition: string | null): string | null {
  if (halfFull === "half") return halfPosition ? `${halfPosition} half` : "half field";
  if (halfFull === "quarter") return halfPosition ? `quarter ${halfPosition.toUpperCase()}` : "quarter field";
  return null;
}

const STATUS_STYLES: Record<BookingRequestRow["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  approved: { label: "Approved", cls: "bg-green-500/15 text-green-300 border-green-500/30" },
  declined: { label: "Declined", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
};

function DeclineModal({ request, listKey, onClose }: { request: BookingRequestRow; listKey: string[]; onClose: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const declineMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/venue/booking-requests/${request.id}/decline`, { reason: reason.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Request declined", description: `${request.fullName} has been emailed.` });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't decline", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0f1423] border border-white/10 rounded-2xl p-6 w-[460px] max-w-[95vw] space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Decline request</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-white/50">
          {request.fullName} — {request.facilityName}, {fmtDateLong(request.bookingDate)},{" "}
          {fmtTime(request.startTime)}–{fmtTime(request.endTime)}. They'll receive an email letting them know.
        </p>
        <div>
          <label className="text-xs text-white/40 mb-1 block">Reason (optional — included in the email)</label>
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. The pitch is closed for maintenance that evening"
            className="bg-white/5 border-white/10 text-white min-h-[80px]"
            data-testid="input-decline-reason"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} className="text-white/50">Cancel</Button>
          <Button
            onClick={() => declineMutation.mutate()}
            disabled={declineMutation.isPending}
            className="bg-red-600 hover:bg-red-700 text-white"
            data-testid="button-confirm-decline"
          >
            {declineMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Declining…</> : "Decline & email member"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function VenueBookingRequests() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("pending");
  const [declining, setDeclining] = useState<BookingRequestRow | null>(null);

  // Single-string key so the default queryFn (which sends the
  // X-Workspace-Slug header requireTab needs) fetches it directly. The
  // mutations must invalidate this EXACT key — react-query compares key
  // elements whole, so a bare "/api/admin/venue/booking-requests" prefix
  // would NOT match this string and the list would never refetch.
  const listKey = [`/api/admin/venue/booking-requests?orgId=${orgId}`];

  const { data: requests = [], isLoading } = useQuery<BookingRequestRow[]>({
    queryKey: listKey,
    enabled: !!orgId,
  });

  const approveMutation = useMutation({
    mutationFn: (r: BookingRequestRow) => apiRequest("POST", `/api/admin/venue/booking-requests/${r.id}/approve`),
    onSuccess: (_res, r) => {
      queryClient.invalidateQueries({ queryKey: listKey });
      // Matches ["/api/admin/venue/bookings", { orgId }] used by the
      // Bookings Calendar + Dashboard, so the new booking shows there too.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/bookings"], exact: false });
      toast({ title: "Booking approved", description: `Confirmation email sent to ${r.email}. The slot is now on the calendar.` });
    },
    onError: (e: any) => {
      // A 409 ("already approved/declined") means this screen was stale —
      // refetch so the row shows its real status instead of staying pending.
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Couldn't approve", description: e.message, variant: "destructive" });
    },
  });

  const pendingCount = requests.filter(r => r.status === "pending").length;
  const filtered = filter === "all" ? requests : requests.filter(r => r.status === filter);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "pending", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { key: "approved", label: "Approved" },
    { key: "declined", label: "Declined" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="w-6 h-6 text-white/40" />
          <div>
            <h1 className="text-2xl font-bold text-white" data-testid="text-booking-requests-title">Booking Requests</h1>
            <p className="text-sm text-white/40">Member requests from book.unitedsportscentre.com/members — approve to confirm the slot and email the member</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            data-testid={`filter-${f.key}`}
            className={`px-3.5 h-8 rounded-full text-xs font-medium border transition ${
              filter === f.key
                ? "bg-blue-500/20 border-blue-500/40 text-blue-200"
                : "bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center text-white/30">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center">
          <ClipboardCheck className="w-12 h-12 text-white/10 mx-auto mb-3" />
          <p className="text-white/40 text-lg mb-1">
            {filter === "pending" ? "No pending requests" : "Nothing here yet"}
          </p>
          <p className="text-white/20 text-sm">
            Member requests from the booking site will appear here for approval.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const size = sizeLabel(r.halfFull, r.halfPosition);
            const age = ageFromDob(r.dateOfBirth);
            const status = STATUS_STYLES[r.status];
            return (
              <div key={r.id} className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-4 sm:p-5" data-testid={`request-row-${r.id}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-sm font-semibold text-white">{r.fullName}</h3>
                      <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${status.cls}`} data-testid={`status-${r.id}`}>
                        {status.label}
                      </span>
                      <span className="text-[10px] text-white/25">MBR-{r.id}</span>
                    </div>

                    <div className="flex items-center gap-4 mt-2 text-xs text-white/50 flex-wrap">
                      <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-white/25" />{r.facilityName || `Facility #${r.facilityId}`}{size ? ` · ${size}` : ""}</span>
                      <span className="flex items-center gap-1.5"><CalendarIcon className="w-3.5 h-3.5 text-white/25" />{fmtDateLong(r.bookingDate)}</span>
                      <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-white/25" />{fmtTime(r.startTime)}–{fmtTime(r.endTime)}</span>
                    </div>

                    <div className="flex items-center gap-4 mt-1.5 text-xs text-white/40 flex-wrap">
                      <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 hover:text-white/70"><Mail className="w-3.5 h-3.5 text-white/20" />{r.email}</a>
                      <a href={`tel:${r.phone}`} className="flex items-center gap-1.5 hover:text-white/70"><Phone className="w-3.5 h-3.5 text-white/20" />{r.phone}</a>
                      <span className="flex items-center gap-1.5"><Cake className="w-3.5 h-3.5 text-white/20" />{fmtDateLong(r.dateOfBirth)}{age != null ? ` (${age})` : ""}</span>
                    </div>

                    <div className="flex items-center gap-4 mt-1.5 text-[11px] text-white/25 flex-wrap">
                      <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-green-400/50" />Waiver agreed{r.waiverVersion ? ` (v${r.waiverVersion})` : ""}</span>
                      <span>Requested {fmtTimestamp(r.createdAt)}</span>
                      {r.status !== "pending" && <span>Reviewed {fmtTimestamp(r.reviewedAt)}</span>}
                      {r.status === "declined" && r.declineReason && <span className="text-red-300/50">"{r.declineReason}"</span>}
                    </div>
                  </div>

                  {r.status === "pending" && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (confirm(`Approve ${r.fullName}'s booking for ${r.facilityName}, ${fmtDateLong(r.bookingDate)} ${fmtTime(r.startTime)}–${fmtTime(r.endTime)}?\n\nThis confirms the slot on the calendar and emails them.`)) {
                            approveMutation.mutate(r);
                          }
                        }}
                        disabled={approveMutation.isPending}
                        className="bg-green-600 hover:bg-green-700 text-white"
                        data-testid={`button-approve-${r.id}`}
                      >
                        {approveMutation.isPending && approveMutation.variables?.id === r.id
                          ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeclining(r)}
                        className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                        data-testid={`button-decline-${r.id}`}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1.5" /> Decline
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {declining && <DeclineModal request={declining} listKey={listKey} onClose={() => setDeclining(null)} />}
    </div>
  );
}
