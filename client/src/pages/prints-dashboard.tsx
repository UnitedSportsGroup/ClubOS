import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { Printer, ShoppingCart, FolderKanban, Users, DollarSign, TrendingUp } from "lucide-react";

export default function PrintsDashboard() {
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

  const stats = [
    { label: "Total Orders", value: analytics?.totalOrders || 0, icon: ShoppingCart, color: "from-blue-500 to-blue-700" },
    { label: "Total Revenue", value: `$${(analytics?.totalRevenue || 0).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}`, icon: DollarSign, color: "from-emerald-500 to-emerald-700" },
    { label: "Active Projects", value: analytics?.projectsByStatus?.active || 0, icon: FolderKanban, color: "from-purple-500 to-purple-700" },
    { label: "Contacts", value: analytics?.totalContacts || 0, icon: Users, color: "from-amber-500 to-amber-700" },
  ];

  const statusColors: Record<string, string> = {
    inquiry: "bg-blue-500/20 text-blue-400",
    quoted: "bg-amber-500/20 text-amber-400",
    confirmed: "bg-emerald-500/20 text-emerald-400",
    in_production: "bg-purple-500/20 text-purple-400",
    ready: "bg-cyan-500/20 text-cyan-400",
    delivered: "bg-green-500/20 text-green-400",
    cancelled: "bg-red-500/20 text-red-400",
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="prints-dashboard">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
          <Printer className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-dashboard-title">United Prints</h1>
          <p className="text-sm text-white/40">Signage & Print Studio Management</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="premium-card border border-white/[0.06] rounded-2xl p-5" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-white/40 uppercase tracking-wider font-medium">{stat.label}</span>
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                <stat.icon className="w-4 h-4 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-white">{isLoading ? "..." : stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="premium-card border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Order Pipeline</h3>
          <div className="space-y-2">
            {Object.entries(analytics?.ordersByStatus || {}).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className={`text-xs px-2.5 py-1 rounded-lg capitalize ${statusColors[status] || "bg-white/10 text-white/60"}`}>
                  {status.replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium text-white/70">{count as number}</span>
              </div>
            ))}
            {!analytics?.ordersByStatus || Object.keys(analytics?.ordersByStatus || {}).length === 0 ? (
              <p className="text-sm text-white/30 text-center py-4">No orders yet</p>
            ) : null}
          </div>
        </div>

        <div className="premium-card border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Recent Orders</h3>
          <div className="space-y-3">
            {(analytics?.recentOrders || []).map((order: any) => (
              <div key={order.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <div>
                  <p className="text-sm font-medium text-white/80">{order.title}</p>
                  <p className="text-xs text-white/40">{order.customerName}</p>
                </div>
                <div className="text-right">
                  {order.amount && <p className="text-sm font-medium text-emerald-400">${parseFloat(order.amount).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}</p>}
                  <span className={`text-[10px] px-2 py-0.5 rounded-lg capitalize ${statusColors[order.status] || "bg-white/10 text-white/60"}`}>
                    {order.status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            ))}
            {(!analytics?.recentOrders || analytics.recentOrders.length === 0) && (
              <p className="text-sm text-white/30 text-center py-4">No orders yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
