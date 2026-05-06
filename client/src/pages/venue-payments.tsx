import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { CreditCard, DollarSign, Clock, TrendingUp, Search, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FacilityBooking, Facility } from "@shared/schema";

type BookingWithFacility = FacilityBooking & { facility?: Facility };

import { formatCurrency as _formatCurrency } from "@/lib/format";
function formatCurrency(v: number) {
  return _formatCurrency(v);
}

const statusBadge: Record<string, string> = {
  confirmed: "bg-green-500/20 text-green-400 border-green-500/20",
  paid: "bg-blue-500/20 text-blue-400 border-blue-500/20",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/20",
};

export default function VenuePayments() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: bookings = [] } = useQuery<BookingWithFacility[]>({
    queryKey: ["/api/admin/venue/bookings", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/bookings?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const filtered = bookings.filter(b => {
    const q = search.toLowerCase();
    const matchSearch = !q || b.customerName.toLowerCase().includes(q) || b.customerEmail.toLowerCase().includes(q) || (b.stripePaymentId || "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || b.status === statusFilter;
    const matchFrom = !dateFrom || b.bookingDate >= dateFrom;
    const matchTo = !dateTo || b.bookingDate <= dateTo;
    return matchSearch && matchStatus && matchFrom && matchTo;
  });

  const totalCollected = bookings.filter(b => b.status === "confirmed" || b.status === "paid").reduce((s, b) => s + Number(b.totalAmount), 0);
  const pendingAmount = bookings.filter(b => b.status === "pending").reduce((s, b) => s + Number(b.totalAmount), 0);
  const confirmedBookings = bookings.filter(b => b.status === "confirmed" || b.status === "paid");
  const avgBookingValue = confirmedBookings.length ? totalCollected / confirmedBookings.length : 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <CreditCard className="w-6 h-6 text-white/40" />
          <div>
            <h1 className="text-2xl font-bold text-white" data-testid="text-venue-payments-title">Payments</h1>
            <p className="text-sm text-white/40">Track payments and revenue</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            <p className="text-xs text-white/40">Total Collected</p>
          </div>
          <p className="text-xl font-bold text-white">{formatCurrency(totalCollected)}</p>
          <p className="text-[10px] text-white/25 mt-1">{confirmedBookings.length} confirmed bookings</p>
        </div>
        <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-yellow-400" />
            <p className="text-xs text-white/40">Pending Amount</p>
          </div>
          <p className="text-xl font-bold text-white">{formatCurrency(pendingAmount)}</p>
          <p className="text-[10px] text-white/25 mt-1">Awaiting payment</p>
        </div>
        <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <p className="text-xs text-white/40">Avg Booking Value</p>
          </div>
          <p className="text-xl font-bold text-white">{formatCurrency(avgBookingValue)}</p>
          <p className="text-[10px] text-white/25 mt-1">Per confirmed booking</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email, or Stripe ID..." className="bg-white/5 border-white/10 text-white pl-10" data-testid="input-search-payments" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-white/5 border-white/10 text-white/60 w-36" data-testid="select-payment-status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <DatePickerInput value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-white/5 border-white/10 text-white/60 w-36" placeholder="From" data-testid="input-date-from" />
        <DatePickerInput value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-white/5 border-white/10 text-white/60 w-36" placeholder="To" data-testid="input-date-to" />
      </div>

      <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-4 py-3 text-xs font-medium text-white/30">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-white/30">Facility</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-white/30">Date</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-white/30">Amount</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-white/30">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-white/30">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const gst = Number(b.gstAmount || 0);
                const exGst = Number(b.totalAmount) - gst;
                return (
                  <tr key={b.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors" data-testid={`payment-row-${b.id}`}>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-white/80">{b.customerName}</p>
                      <p className="text-xs text-white/30">{b.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-white/50">{b.facility?.name || "—"}</td>
                    <td className="px-4 py-3 text-sm text-white/50">
                      {new Date(b.bookingDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}, {b.startTime}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-sm font-medium text-white/70">{formatCurrency(Number(b.totalAmount))}</p>
                      <p className="text-[10px] text-white/25">ex GST: {formatCurrency(exGst)}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider rounded px-2 py-0.5 border ${statusBadge[b.status]}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {b.stripePaymentId ? (
                        <span className="flex items-center gap-1 text-xs text-white/30 truncate max-w-[120px]">
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          {b.stripePaymentId.slice(0, 15)}...
                        </span>
                      ) : (
                        <span className="text-xs text-white/15">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-white/20 text-sm">No payments found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
