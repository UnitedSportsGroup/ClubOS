import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useWorkspace } from "@/lib/workspace-context";
import {
  Printer, ShoppingCart, DollarSign, TrendingUp, Activity, AlertCircle,
  Package, ArrowRight, Download,
} from "lucide-react";
import type { PrintOrder } from "@shared/schema";

interface Analytics {
  totalOrders: number;
  ordersThisWeek: number;
  ordersThisMonth: number;
  revenueThisWeekCents: number;
  revenueThisMonthCents: number;
  revenueAllTimeCents: number;
  grossMarginPct: number;
  inProduction: number;
  overdue: number;
  topMaterials: { name: string; cents: number }[];
  recentOrders: PrintOrder[];
  ordersByStatus: Record<string, number>;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_LABEL: Record<string, string> = {
  quote_sent: "Quote sent",
  paid: "Paid",
  artwork_pending: "Awaiting artwork",
  in_design: "Design",
  in_proof: "Proof",
  proof_approved: "Approved",
  in_production: "Production",
  finishing: "Finishing",
  ready: "Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export default function PrintsDashboard() {
  const { currentOrg } = useWorkspace();
  const [, setLocation] = useLocation();
  const orgId = currentOrg?.id;

  const { data, isLoading } = useQuery<Analytics>({
    queryKey: ["/api/admin/print-analytics", { orgId }],
    queryFn: () => fetch(`/api/admin/print-analytics?orgId=${orgId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!orgId,
  });

  const cards = [
    { label: "Orders this month", value: data?.ordersThisMonth ?? 0, sub: `${data?.ordersThisWeek ?? 0} this week`, icon: ShoppingCart, accent: "blue" },
    { label: "Revenue this month", value: money(data?.revenueThisMonthCents ?? 0), sub: `${money(data?.revenueThisWeekCents ?? 0)} this week`, icon: DollarSign, accent: "green" },
    { label: "Gross margin", value: data?.grossMarginPct != null ? `${data.grossMarginPct}%` : "—", sub: "On paid items", icon: TrendingUp, accent: "purple" },
    { label: "In production", value: data?.inProduction ?? 0, sub: data && data.overdue > 0 ? `${data.overdue} overdue` : "On track", icon: Activity, accent: data && data.overdue > 0 ? "red" : "amber" },
  ];

  const accentClass = (a: string) => ({
    blue: "bg-blue-500/10 text-blue-400",
    green: "bg-emerald-500/10 text-emerald-400",
    purple: "bg-purple-500/10 text-purple-400",
    amber: "bg-amber-500/10 text-amber-400",
    red: "bg-red-500/10 text-red-400",
  } as Record<string, string>)[a] ?? "bg-white/5 text-white/40";

  if (isLoading) {
    return <div className="p-6 text-white/40">Loading dashboard...</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">United Prints</h1>
          <p className="text-sm text-white/40 mt-0.5">Live numbers across the print shop.</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/admin/print-orders/export.csv?orgId=${orgId}`}
            className="px-3 py-2 rounded-lg text-xs text-white/70 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </a>
          <button
            onClick={() => setLocation("/admin/print-jobs")}
            className="px-3 py-2 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"
          >
            Open jobs <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => (
          <div key={c.label} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">{c.label}</div>
              <div className="text-3xl font-bold text-white">{c.value}</div>
              <div className="text-[11px] text-white/40 mt-1">{c.sub}</div>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accentClass(c.accent)}`}>
              <c.icon className="w-5 h-5" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent orders */}
        <div className="lg:col-span-2 rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/70">Recent orders</h2>
            <button onClick={() => setLocation("/admin/print-jobs")} className="text-xs text-blue-400/70 hover:text-blue-400">View all</button>
          </div>
          {(!data?.recentOrders || data.recentOrders.length === 0) ? (
            <div className="py-10 text-center">
              <Package className="w-8 h-8 text-white/15 mx-auto mb-2" />
              <p className="text-sm text-white/40">No orders yet — first one's on its way.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.recentOrders.map(o => (
                <button
                  key={o.id}
                  onClick={() => setLocation(`/admin/print-orders/${o.id}`)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{o.title}</div>
                    <div className="text-[11px] text-white/40 flex items-center gap-1.5 mt-0.5">
                      <span className="font-mono">{o.orderNumber || `#${o.id}`}</span>
                      <span>·</span>
                      <span className="truncate">{o.customerName}</span>
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/[0.04] text-white/60 flex-shrink-0">
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                  <span className="text-sm font-mono text-white/70 flex-shrink-0">{money(o.totalCents ?? 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Top materials this month */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white/70 mb-3">Top materials · 30d</h2>
          {(!data?.topMaterials || data.topMaterials.length === 0) ? (
            <div className="py-6 text-sm text-white/30 text-center">No paid orders yet</div>
          ) : (
            <div className="space-y-3">
              {data.topMaterials.map((m, i) => {
                const max = data.topMaterials[0]?.cents ?? 1;
                const pct = (m.cents / max) * 100;
                return (
                  <div key={m.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-white/70 truncate">{i + 1}. {m.name}</span>
                      <span className="font-mono text-white/50 ml-2 flex-shrink-0">{money(m.cents)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                      <div className="h-full bg-blue-500/60" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Status breakdown bar */}
      {data?.ordersByStatus && Object.keys(data.ordersByStatus).length > 0 && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white/70 mb-3">Status breakdown</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(data.ordersByStatus).map(([status, count]) => (
              <div key={status} className="text-center p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="text-2xl font-bold text-white">{count}</div>
                <div className="text-[10px] uppercase tracking-wider text-white/40 mt-0.5">{STATUS_LABEL[status] ?? status}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.overdue > 0 && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-red-300">{data.overdue} overdue order{data.overdue === 1 ? "" : "s"}</div>
            <div className="text-sm text-red-300/70 mt-0.5">Past their pickup-ready date and not yet delivered. Open the jobs board to triage.</div>
          </div>
          <button onClick={() => setLocation("/admin/print-jobs")} className="text-xs text-red-300 hover:underline self-center flex-shrink-0">
            Open jobs →
          </button>
        </div>
      )}
    </div>
  );
}
