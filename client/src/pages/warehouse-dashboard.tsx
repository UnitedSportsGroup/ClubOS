// Warehouse dashboard (T16a, SPEC §4.4) — the `/admin/warehouse` landing
// page: stock health, pending requisitions, overdue loans, sync drift
// alerts, and the ledger's recent tail. One aggregated read from
// `GET /api/admin/warehouse/dashboard` (added this task — no prior
// endpoint computed any of this). Visual style matches `prints-dashboard.tsx`
// (dark premium stat cards + feed panels) since this is the same "workspace
// landing page" role for the warehouse feature that prints-dashboard plays
// for United Prints' print-shop side.
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Package, AlertTriangle, ClipboardList, Clock, ArrowRight, ScanLine,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface DashboardLowStockItem {
  id: number;
  sku: string;
  name: string;
  brandOwner: string;
  minQty: number;
  onHand: number;
}
interface DashboardRequisition {
  id: number;
  chargeTo: string;
  status: string;
  neededBy: string | null;
  requesterName: string;
}
interface DashboardLoan {
  id: number;
  borrowerName: string;
  dueOn: string;
  overdue: boolean;
}
interface DashboardDriftAlert {
  itemId: number;
  store: string;
  lastPushedQty: string | null;
  lastDriftAt: string;
  driftNote: string | null;
  itemSku: string;
  itemName: string;
}
interface DashboardMovement {
  id: number;
  delta: string;
  movementType: string;
  reasonCode: string | null;
  createdAt: string;
  itemSku: string;
  itemName: string;
  locationCode: string;
  operatorName: string;
}
interface DashboardData {
  activeItemCount: number;
  lowStockItems: DashboardLowStockItem[];
  lowStockCount: number;
  pendingRequisitions: DashboardRequisition[];
  pendingRequisitionsCount: number;
  overdueLoans: DashboardLoan[];
  overdueLoansCount: number;
  driftAlerts: DashboardDriftAlert[];
  driftAlertsCount: number;
  recentMovements: DashboardMovement[];
}

export default function WarehouseDashboard() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/admin/warehouse/dashboard"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/dashboard")).json(),
  });

  const cards = [
    { label: "Active items", value: data?.activeItemCount ?? 0, sub: "In the catalog", icon: Package, accent: "blue" },
    { label: "Low stock", value: data?.lowStockCount ?? 0, sub: "Below reorder point", icon: AlertTriangle, accent: data && data.lowStockCount > 0 ? "amber" : "green" },
    { label: "Pending requisitions", value: data?.pendingRequisitionsCount ?? 0, sub: "Awaiting pick/collection", icon: ClipboardList, accent: "purple" },
    { label: "Overdue loans", value: data?.overdueLoansCount ?? 0, sub: "Past their due date", icon: Clock, accent: data && data.overdueLoansCount > 0 ? "red" : "green" },
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
          <h1 className="text-2xl font-bold text-white">Warehouse</h1>
          <p className="text-sm text-white/40 mt-0.5">Stock health across every bin, requisition and loan.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLocation("/admin/warehouse/scan")}
            className="px-3 py-2 rounded-lg text-xs text-white/70 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] flex items-center gap-1.5"
          >
            <ScanLine className="w-3.5 h-3.5" /> Scan station
          </button>
          <button
            onClick={() => setLocation("/admin/warehouse/stock-take")}
            className="px-3 py-2 rounded-lg text-xs text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5"
          >
            Stock take
          </button>
          <button
            onClick={() => setLocation("/admin/warehouse/assets")}
            className="px-3 py-2 rounded-lg text-xs text-white/70 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] flex items-center gap-1.5"
          >
            Assets
          </button>
          <button
            onClick={() => setLocation("/admin/warehouse/fields")}
            className="px-3 py-2 rounded-lg text-xs text-white/70 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] flex items-center gap-1.5"
          >
            Fields
          </button>
          <button
            onClick={() => setLocation("/admin/warehouse/items")}
            className="px-3 py-2 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5"
          >
            Browse items <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
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
    </div>
  );
}
