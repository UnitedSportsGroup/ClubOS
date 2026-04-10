import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { BarChart3, DollarSign, ShoppingCart, FolderKanban, Users, TrendingUp } from "lucide-react";

export default function PrintsAnalytics() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;

  const { data: analytics, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/print-analytics", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/print-analytics?orgId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!orgId,
  });

  const orderStatusColors: Record<string, string> = {
    inquiry: "#3b82f6",
    quoted: "#f59e0b",
    confirmed: "#10b981",
    in_production: "#8b5cf6",
    ready: "#06b6d4",
    delivered: "#22c55e",
    cancelled: "#ef4444",
  };

  const projectStatusColors: Record<string, string> = {
    planning: "#3b82f6",
    active: "#10b981",
    on_hold: "#f59e0b",
    completed: "#22c55e",
    archived: "#6b7280",
  };

  const orderEntries = Object.entries(analytics?.ordersByStatus || {});
  const projectEntries = Object.entries(analytics?.projectsByStatus || {});
  const maxOrderCount = Math.max(...orderEntries.map(([, v]) => v as number), 1);
  const maxProjectCount = Math.max(...projectEntries.map(([, v]) => v as number), 1);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="prints-analytics">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-white/40">Business performance overview</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="premium-card border border-white/[0.06] rounded-2xl p-5" data-testid="stat-total-orders">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/40 uppercase tracking-wider">Total Orders</span>
            <ShoppingCart className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-3xl font-bold text-white">{isLoading ? "..." : analytics?.totalOrders || 0}</div>
        </div>
        <div className="premium-card border border-white/[0.06] rounded-2xl p-5" data-testid="stat-total-revenue">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/40 uppercase tracking-wider">Total Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-emerald-400">${isLoading ? "..." : (analytics?.totalRevenue || 0).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="premium-card border border-white/[0.06] rounded-2xl p-5" data-testid="stat-total-projects">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/40 uppercase tracking-wider">Total Projects</span>
            <FolderKanban className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-3xl font-bold text-white">{isLoading ? "..." : analytics?.totalProjects || 0}</div>
        </div>
        <div className="premium-card border border-white/[0.06] rounded-2xl p-5" data-testid="stat-total-contacts">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/40 uppercase tracking-wider">Total Contacts</span>
            <Users className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl font-bold text-white">{isLoading ? "..." : analytics?.totalContacts || 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="premium-card border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Orders by Status</h3>
          {orderEntries.length === 0 ? (
            <p className="text-sm text-white/30 text-center py-8">No data yet</p>
          ) : (
            <div className="space-y-3">
              {orderEntries.map(([status, count]) => (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white/50 capitalize">{status.replace(/_/g, " ")}</span>
                    <span className="text-xs text-white/70 font-medium">{count as number}</span>
                  </div>
                  <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${((count as number) / maxOrderCount) * 100}%`, backgroundColor: orderStatusColors[status] || "#6b7280" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="premium-card border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Projects by Status</h3>
          {projectEntries.length === 0 ? (
            <p className="text-sm text-white/30 text-center py-8">No data yet</p>
          ) : (
            <div className="space-y-3">
              {projectEntries.map(([status, count]) => (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white/50 capitalize">{status.replace(/_/g, " ")}</span>
                    <span className="text-xs text-white/70 font-medium">{count as number}</span>
                  </div>
                  <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${((count as number) / maxProjectCount) * 100}%`, backgroundColor: projectStatusColors[status] || "#6b7280" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="premium-card border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Recent Orders</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-[10px] text-white/30 uppercase tracking-wider font-medium px-3 py-2">Order</th>
                <th className="text-left text-[10px] text-white/30 uppercase tracking-wider font-medium px-3 py-2">Customer</th>
                <th className="text-left text-[10px] text-white/30 uppercase tracking-wider font-medium px-3 py-2">Status</th>
                <th className="text-right text-[10px] text-white/30 uppercase tracking-wider font-medium px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(analytics?.recentOrders || []).map((o: any) => (
                <tr key={o.id} className="border-b border-white/[0.03]">
                  <td className="px-3 py-2.5 text-sm text-white/80">{o.title}</td>
                  <td className="px-3 py-2.5 text-sm text-white/50">{o.customerName}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-lg capitalize" style={{ backgroundColor: `${orderStatusColors[o.status]}20`, color: orderStatusColors[o.status] }}>
                      {o.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-sm text-right text-emerald-400">{o.amount ? `$${parseFloat(o.amount).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}` : "—"}</td>
                </tr>
              ))}
              {(!analytics?.recentOrders || analytics.recentOrders.length === 0) && (
                <tr><td colSpan={4} className="text-center py-6 text-white/30 text-sm">No orders yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
