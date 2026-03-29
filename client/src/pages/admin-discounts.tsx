import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tag, Plus, Search, MoreHorizontal, Pencil, Trash2, Copy, Filter } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Discount } from "@shared/schema";

function getStatusBadge(discount: Discount) {
  const now = new Date();
  const start = new Date(discount.startDate);
  const end = discount.endDate ? new Date(discount.endDate) : null;

  if (discount.status === "disabled") return <Badge variant="outline" className="text-white/40 border-white/10" data-testid={`status-disabled-${discount.id}`}>Disabled</Badge>;
  if (end && end < now) return <Badge variant="outline" className="text-amber-400/80 border-amber-400/20" data-testid={`status-expired-${discount.id}`}>Expired</Badge>;
  if (start > now) return <Badge variant="outline" className="text-blue-400/80 border-blue-400/20" data-testid={`status-scheduled-${discount.id}`}>Scheduled</Badge>;
  return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30" data-testid={`status-active-${discount.id}`}>Active</Badge>;
}

function getTypeBadge(type: string) {
  const labels: Record<string, string> = {
    amount_off_product: "Amount off product",
    amount_off_order: "Amount off order",
    buy_x_get_y: "Buy X get Y",
    free_shipping: "Free shipping",
  };
  return labels[type] || type;
}

function getMethodBadge(method: string) {
  return method === "automatic" ? "Automatic" : "Code";
}

function formatValue(discount: Discount) {
  if (discount.type === "free_shipping") return "Free shipping";
  if (discount.valueType === "percentage") return `${discount.value}%`;
  return `$${(Number(discount.value) / 1).toFixed(2)}`;
}

export default function AdminDiscounts() {
  const [, navigate] = useLocation();
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id || 1;
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: discountsList, isLoading } = useQuery<Discount[]>({
    queryKey: ["/api/admin/discounts", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/discounts?orgId=${orgId}`);
      if (!r.ok) throw new Error("Failed to load discounts");
      return r.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/discounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/discounts"] });
      toast({ title: "Discount deleted" });
      setDeleteId(null);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (discount: Discount) => {
      const { id, createdAt, updatedAt, timesUsed, totalDiscountedCents, ...rest } = discount;
      const newData = {
        ...rest,
        title: `${discount.title} (Copy)`,
        code: discount.code ? `${discount.code}-COPY` : null,
        status: "active",
        startDate: new Date().toISOString(),
      };
      return apiRequest("POST", "/api/admin/discounts", newData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/discounts"] });
      toast({ title: "Discount duplicated" });
    },
  });

  const filtered = (discountsList || []).filter(d => {
    if (search) {
      const q = search.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !d.code?.toLowerCase().includes(q)) return false;
    }
    if (statusFilter !== "all") {
      const now = new Date();
      const start = new Date(d.startDate);
      const end = d.endDate ? new Date(d.endDate) : null;
      if (statusFilter === "active" && (d.status === "disabled" || (end && end < now) || start > now)) return false;
      if (statusFilter === "expired" && !(end && end < now)) return false;
      if (statusFilter === "scheduled" && !(start > now)) return false;
      if (statusFilter === "disabled" && d.status !== "disabled") return false;
    }
    return true;
  });

  const stats = {
    total: discountsList?.length || 0,
    active: discountsList?.filter(d => {
      const now = new Date();
      const end = d.endDate ? new Date(d.endDate) : null;
      return d.status !== "disabled" && !(end && end < now) && new Date(d.startDate) <= now;
    }).length || 0,
    totalUsed: discountsList?.reduce((s, d) => s + d.timesUsed, 0) || 0,
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Discounts</h1>
          <p className="text-sm text-white/40 mt-1">Create and manage discount codes and automatic discounts</p>
        </div>
        <Button
          onClick={() => navigate("/admin/discounts/new")}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
          data-testid="button-create-discount"
        >
          <Plus className="w-4 h-4" />
          Create discount
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="premium-card border-white/[0.06]">
          <CardContent className="p-4">
            <p className="text-xs text-white/40 font-medium">Total Discounts</p>
            <p className="text-2xl font-semibold text-white mt-1" data-testid="text-total-discounts">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="premium-card border-white/[0.06]">
          <CardContent className="p-4">
            <p className="text-xs text-white/40 font-medium">Active</p>
            <p className="text-2xl font-semibold text-emerald-400 mt-1" data-testid="text-active-discounts">{stats.active}</p>
          </CardContent>
        </Card>
        <Card className="premium-card border-white/[0.06]">
          <CardContent className="p-4">
            <p className="text-xs text-white/40 font-medium">Total Uses</p>
            <p className="text-2xl font-semibold text-white mt-1" data-testid="text-total-uses">{stats.totalUsed}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="premium-card border-white/[0.06]">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <Input
                placeholder="Search discounts..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 premium-input text-white/80 rounded-xl"
                data-testid="input-search-discounts"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="border-white/10 text-white/60 rounded-xl gap-2" data-testid="button-filter-status">
                  <Filter className="w-3.5 h-3.5" />
                  {statusFilter === "all" ? "All" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setStatusFilter("all")} data-testid="filter-all">All</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter("active")} data-testid="filter-active">Active</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter("expired")} data-testid="filter-expired">Expired</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter("scheduled")} data-testid="filter-scheduled">Scheduled</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter("disabled")} data-testid="filter-disabled">Disabled</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Tag className="w-10 h-10 text-white/10 mx-auto mb-3" />
              <p className="text-white/40 text-sm">{search || statusFilter !== "all" ? "No discounts match your filters" : "No discounts yet"}</p>
              {!search && statusFilter === "all" && (
                <Button
                  onClick={() => navigate("/admin/discounts/new")}
                  variant="outline"
                  className="mt-4 border-white/10 text-white/60 rounded-xl"
                  data-testid="button-create-first"
                >
                  Create your first discount
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-discounts">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left text-xs font-medium text-white/40 px-4 py-3">Title</th>
                    <th className="text-left text-xs font-medium text-white/40 px-4 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-white/40 px-4 py-3">Method</th>
                    <th className="text-left text-xs font-medium text-white/40 px-4 py-3">Type</th>
                    <th className="text-right text-xs font-medium text-white/40 px-4 py-3">Used</th>
                    <th className="w-10 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(d => (
                    <tr
                      key={d.id}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] cursor-pointer transition-colors"
                      onClick={() => navigate(`/admin/discounts/${d.id}`)}
                      data-testid={`row-discount-${d.id}`}
                    >
                      <td className="px-4 py-3">
                        <div>
                          <span className="text-sm font-medium text-white/90">{d.title}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            {d.code && <span className="text-xs text-white/40 font-mono">{d.code}</span>}
                            <span className="text-xs text-white/30">{d.type === "free_shipping" ? "Free shipping" : `${formatValue(d)} off`}</span>
                            {d.onePerCustomer && <span className="text-xs text-white/30">· One use per customer</span>}
                            {d.maxTotalUses && <span className="text-xs text-white/30">· Max {d.maxTotalUses} uses</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(d)}</td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-white/60">{getMethodBadge(d.method)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-white/60">{getTypeBadge(d.type)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm text-white/60" data-testid={`text-used-${d.id}`}>{d.timesUsed}</span>
                      </td>
                      <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/30 hover:text-white/60" data-testid={`button-actions-${d.id}`}>
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/admin/discounts/${d.id}`)} data-testid={`action-edit-${d.id}`}>
                              <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicateMutation.mutate(d)} data-testid={`action-duplicate-${d.id}`}>
                              <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-400"
                              onClick={() => setDeleteId(d.id)}
                              data-testid={`action-delete-${d.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete discount?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this discount. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
