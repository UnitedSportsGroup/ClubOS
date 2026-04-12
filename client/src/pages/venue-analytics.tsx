import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { DollarSign, Calendar, TrendingUp, Users, BarChart3, Clock } from "lucide-react";
import type { FacilityBooking, Facility } from "@shared/schema";

type BookingWithFacility = FacilityBooking & { facility?: Facility };

import { formatCurrency as _formatCurrency } from "@/lib/format";
function formatCurrency(v: number) {
  return _formatCurrency(v, { decimals: 0 });
}

const PERIOD_DAYS: Record<string, number> = { "7 Days": 7, "30 Days": 30, "90 Days": 90, "1 Year": 365 };

export default function VenueAnalytics() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const [period, setPeriod] = useState("30 Days");

  const { data: bookings = [] } = useQuery<BookingWithFacility[]>({
    queryKey: ["/api/admin/venue/bookings", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/bookings?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const { data: allFacilities = [] } = useQuery<Facility[]>({
    queryKey: ["/api/admin/venue/facilities", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/facilities?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const days = PERIOD_DAYS[period];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const periodBookings = bookings.filter(b => new Date(b.bookingDate) >= cutoff && b.status !== "cancelled");
  const totalRevenue = periodBookings.reduce((s, b) => s + Number(b.totalAmount), 0);
  const avgBookingValue = periodBookings.length ? totalRevenue / periodBookings.length : 0;

  const uniqueEmails = [...new Set(bookings.filter(b => b.status !== "cancelled").map(b => b.customerEmail))];
  const repeatEmails = uniqueEmails.filter(e => bookings.filter(b => b.customerEmail === e && b.status !== "cancelled").length > 1);
  const repeatPct = uniqueEmails.length ? Math.round((repeatEmails.length / uniqueEmails.length) * 100) : 0;

  const topFacility = allFacilities.reduce((best, f) => {
    const count = periodBookings.filter(b => b.facilityId === f.id).length;
    return count > (best.count || 0) ? { name: f.name, count } : best;
  }, { name: "—", count: 0 });

  const facilityStats = allFacilities.map(f => ({
    name: f.name,
    count: periodBookings.filter(b => b.facilityId === f.id).length,
  })).sort((a, b) => b.count - a.count);
  const maxFacCount = Math.max(...facilityStats.map(f => f.count), 1);

  const revenueByDate: Record<string, number> = {};
  periodBookings.forEach(b => {
    revenueByDate[b.bookingDate] = (revenueByDate[b.bookingDate] || 0) + Number(b.totalAmount);
  });
  const sortedDates = Object.keys(revenueByDate).sort();
  const maxRev = Math.max(...Object.values(revenueByDate), 1);

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hourLabels = Array.from({ length: 15 }, (_, i) => `${i + 7}${i + 7 < 12 ? "am" : "pm"}`);
  const heatmap: number[][] = dayNames.map(() => Array(15).fill(0));
  periodBookings.forEach(b => {
    const d = new Date(b.bookingDate);
    let day = d.getDay() - 1;
    if (day < 0) day = 6;
    const h = parseInt(b.startTime.split(":")[0]) - 7;
    if (h >= 0 && h < 15 && day >= 0 && day < 7) heatmap[day][h]++;
  });
  const maxHeat = Math.max(...heatmap.flat(), 1);

  const weeklyData: Record<string, number> = {};
  periodBookings.forEach(b => {
    const d = new Date(b.bookingDate);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay() + 1);
    const key = weekStart.toISOString().split("T")[0];
    weeklyData[key] = (weeklyData[key] || 0) + 1;
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1100px]">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-white/40" />
            <h1 className="text-2xl font-bold text-white" data-testid="text-venue-analytics-title">Analytics</h1>
          </div>
          <p className="text-sm text-white/40 mt-1">Revenue, trends, and insights</p>
        </div>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {Object.keys(PERIOD_DAYS).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? "bg-white/15 text-white" : "text-white/30 hover:text-white/50"}`}
              data-testid={`button-period-${p.replace(/\s/g, "-").toLowerCase()}`}
            >{p}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: formatCurrency(totalRevenue), sub: `${periodBookings.length} bookings`, icon: DollarSign },
          { label: "Bookings", value: String(periodBookings.length), sub: `In last ${days} days`, icon: Calendar },
          { label: "Avg. Booking Value", value: formatCurrency(avgBookingValue), sub: `Top: ${topFacility.name}`, icon: TrendingUp },
          { label: "Repeat Customers", value: `${repeatPct}%`, sub: `${repeatEmails.length} of ${uniqueEmails.length} customers`, icon: Users },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-white/40">{s.label}</p>
              <s.icon className="w-4 h-4 text-white/20" />
            </div>
            <p className="text-xl font-bold text-white">{s.value}</p>
            <p className="text-[10px] text-white/30 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-blue-500/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Revenue Over Time</h3>
          <p className="text-[10px] text-white/30 mb-4">Last {days} days</p>
          <div className="flex items-end justify-between mb-2">
            <span className="text-xs text-white/20">{formatCurrency(totalRevenue)}</span>
          </div>
          {sortedDates.length > 0 ? (
            <div className="h-48 flex items-end gap-[2px]">
              {sortedDates.map(d => (
                <div key={d} className="flex-1 min-w-[3px]" title={`${d}: ${formatCurrency(revenueByDate[d])}`}>
                  <div className="bg-blue-500 rounded-t w-full" style={{ height: `${(revenueByDate[d] / maxRev) * 100}%`, minHeight: "2px" }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-white/20 text-sm">No data</div>
          )}
          <div className="flex justify-between mt-2 text-[9px] text-white/20">
            <span>{sortedDates[0] || ""}</span>
            <span>{sortedDates[sortedDates.length - 1] || ""}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Customer Retention</h3>
          <p className="text-[10px] text-white/30 mb-6">Repeat vs new customers</p>
          <div className="flex items-center justify-center">
            <div className="relative w-36 h-36">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" strokeWidth="12"
                  strokeDasharray={`${repeatPct * 2.51} ${251 - repeatPct * 2.51}`} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-bold text-white">{repeatEmails.length}</span>
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-6 mt-4 text-xs">
            <span className="flex items-center gap-1.5 text-white/50"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />Repeat ({repeatEmails.length})</span>
            <span className="flex items-center gap-1.5 text-white/50"><span className="w-2.5 h-2.5 rounded-full bg-white/10" />New ({uniqueEmails.length - repeatEmails.length})</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Popular Facilities</h3>
          <p className="text-[10px] text-white/30 mb-4">By total confirmed bookings</p>
          <div className="space-y-3">
            {facilityStats.map(f => (
              <div key={f.name} className="flex items-center gap-3">
                <span className="text-[10px] text-white/40 w-24 text-right truncate">{f.name}</span>
                <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                  <div className="h-full bg-blue-500 rounded" style={{ width: `${(f.count / maxFacCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Booking Trends</h3>
          <p className="text-[10px] text-white/30 mb-4">Weekly booking volume</p>
          {Object.keys(weeklyData).length > 0 ? (
            <div className="h-40 flex items-end gap-1">
              {Object.entries(weeklyData).sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => (
                <div key={week} className="flex-1 min-w-[6px] flex flex-col items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500" style={{ marginBottom: `${(count / Math.max(...Object.values(weeklyData), 1)) * 130}px` }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-white/20 text-sm">No data</div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-4 h-4 text-white/30" />
          <h3 className="text-sm font-semibold text-white">Popular Time Slots</h3>
        </div>
        <p className="text-[10px] text-white/30 mb-4">Booking frequency by day and hour</p>
        <div className="overflow-x-auto">
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: `60px repeat(${hourLabels.length}, 1fr)` }}>
            <div />
            {hourLabels.map(h => (
              <div key={h} className="text-center text-[9px] text-white/25 pb-1">{h}</div>
            ))}
            {dayNames.map((day, di) => (
              <div key={day} className="contents">
                <div className="text-[10px] text-white/30 flex items-center pr-2 justify-end">{day}</div>
                {heatmap[di].map((val, hi) => (
                  <div key={hi} className="aspect-square rounded-sm flex items-center justify-center text-[9px] font-medium"
                    style={{
                      backgroundColor: val > 0 ? `rgba(59, 130, 246, ${Math.min(0.2 + (val / maxHeat) * 0.8, 1)})` : "rgba(255,255,255,0.03)",
                      color: val > 0 ? "rgba(255,255,255,0.8)" : "transparent",
                    }}
                  >
                    {val > 0 ? val : ""}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
