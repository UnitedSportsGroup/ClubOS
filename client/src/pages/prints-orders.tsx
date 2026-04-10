import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Search, ShoppingCart, Trash2, Edit, DollarSign, Calendar } from "lucide-react";
import type { PrintOrder } from "@shared/schema";

const STATUSES = ["inquiry", "quoted", "confirmed", "in_production", "ready", "delivered", "cancelled"] as const;

const statusColors: Record<string, string> = {
  inquiry: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  quoted: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  confirmed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  in_production: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  ready: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  delivered: "bg-green-500/20 text-green-400 border-green-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function PrintsOrders() {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const orgId = currentOrg?.id;
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PrintOrder | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [title, setTitle] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("inquiry");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: orders = [], isLoading } = useQuery<PrintOrder[]>({
    queryKey: ["/api/admin/print-orders", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/print-orders?orgId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => { const r = await apiRequest("POST", "/api/admin/print-orders", data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-orders"] }); toast({ title: "Order created" }); closeModal(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => { const r = await apiRequest("PATCH", `/api/admin/print-orders/${id}`, data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-orders"] }); toast({ title: "Order updated" }); closeModal(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/admin/print-orders/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-orders"] }); toast({ title: "Order deleted" }); },
  });

  function openCreate() {
    setEditing(null); setTitle(""); setCustomerName(""); setCustomerEmail(""); setCustomerPhone(""); setDescription(""); setStatus("inquiry"); setAmount(""); setDueDate(""); setNotes("");
    setShowModal(true);
  }

  function openEdit(o: PrintOrder) {
    setEditing(o); setTitle(o.title); setCustomerName(o.customerName); setCustomerEmail(o.customerEmail || ""); setCustomerPhone(o.customerPhone || ""); setDescription(o.description || ""); setStatus(o.status); setAmount(o.amount || ""); setDueDate(o.dueDate || ""); setNotes(o.notes || "");
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSave() {
    const data = { title, customerName, customerEmail: customerEmail || null, customerPhone: customerPhone || null, description: description || null, status, amount: amount || null, dueDate: dueDate || null, notes: notes || null, organizationId: orgId };
    if (editing) updateMutation.mutate({ id: editing.id, ...data });
    else createMutation.mutate(data);
  }

  const filtered = orders.filter(o => {
    if (filterStatus !== "all" && o.status !== filterStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return o.title.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="prints-orders">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center"><ShoppingCart className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">Orders</h1>
            <p className="text-sm text-white/40">{orders.length} total orders</p>
          </div>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2" data-testid="button-add-order"><Plus className="w-4 h-4" /> New Order</Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)} className="premium-input pl-10 text-white/70 rounded-xl" data-testid="input-search-orders" />
        </div>
        <div className="flex gap-1 bg-white/[0.04] rounded-xl p-0.5 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setFilterStatus("all")} className={`text-xs h-7 rounded-lg ${filterStatus === "all" ? "bg-blue-600 text-white" : "text-white/40"}`}>All</Button>
          {STATUSES.map(s => (
            <Button key={s} variant="ghost" size="sm" onClick={() => setFilterStatus(s)} className={`text-xs h-7 rounded-lg capitalize ${filterStatus === s ? "bg-blue-600 text-white" : "text-white/40"}`} data-testid={`filter-${s}`}>
              {s.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-white/30">Loading orders...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-white/30">No orders found</div>
        ) : filtered.map(order => (
          <div key={order.id} className="premium-card border border-white/[0.06] rounded-2xl p-4 hover:bg-white/[0.02] transition-colors" data-testid={`order-card-${order.id}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-white/90">{order.title}</h3>
                  <Badge className={`text-[10px] capitalize border ${statusColors[order.status]}`}>{order.status.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-xs text-white/40">{order.customerName}{order.customerEmail ? ` · ${order.customerEmail}` : ""}</p>
                {order.description && <p className="text-xs text-white/30 mt-1 line-clamp-1">{order.description}</p>}
              </div>
              <div className="flex items-center gap-3 ml-4">
                <div className="text-right">
                  {order.amount && <p className="text-sm font-semibold text-emerald-400">${parseFloat(order.amount).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}</p>}
                  {order.dueDate && <p className="text-[10px] text-white/30 flex items-center gap-1 justify-end"><Calendar className="w-3 h-3" />Due {order.dueDate}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(order)} className="h-7 w-7 text-white/30 hover:text-white/60" data-testid={`button-edit-order-${order.id}`}><Edit className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this order?")) deleteMutation.mutate(order.id); }} className="h-7 w-7 text-red-400/40 hover:text-red-400" data-testid={`button-delete-order-${order.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full max-w-lg premium-card border border-white/[0.08] rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="modal-order">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Order" : "New Order"}</h2>
              <Button variant="ghost" size="icon" onClick={closeModal} className="text-white/30 h-8 w-8"><X className="w-4 h-4" /></Button>
            </div>
            <Input placeholder="Order title *" value={title} onChange={e => setTitle(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-order-title" />
            <Input placeholder="Customer name *" value={customerName} onChange={e => setCustomerName(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-customer-name" />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Customer email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-customer-email" />
              <Input placeholder="Customer phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-customer-phone" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="premium-input text-white/70 rounded-xl" data-testid="select-order-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s}><span className="capitalize">{s.replace(/_/g, " ")}</span></SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <Input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} className="premium-input text-white/70 rounded-xl pl-9" data-testid="input-order-amount" />
              </div>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-due-date" />
            </div>
            <Textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="premium-input text-white/70 rounded-xl min-h-[60px]" data-testid="input-order-description" />
            <Textarea placeholder="Internal notes" value={notes} onChange={e => setNotes(e.target.value)} className="premium-input text-white/70 rounded-xl min-h-[40px]" data-testid="input-order-notes" />
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={!title.trim() || !customerName.trim()} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex-1" data-testid="button-save-order">
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={closeModal} className="border-white/10 text-white/60 rounded-xl">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
