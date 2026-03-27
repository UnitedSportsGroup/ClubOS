import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Puzzle, Plus, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { FacilityAddon } from "@shared/schema";

const UNITS = [
  { value: "per_hour", label: "Per Hour" },
  { value: "per_booking", label: "Per Booking" },
  { value: "per_day", label: "Per Day" },
  { value: "flat", label: "Flat Rate" },
];

function AddonModal({ addon, orgId, onClose }: { addon?: FacilityAddon; orgId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: addon?.name || "",
    description: addon?.description || "",
    price: addon?.price || "0",
    unit: addon?.unit || "per_hour",
    appliesToAll: addon?.appliesToAll ?? true,
    active: addon?.active ?? true,
  });

  const saveMutation = useMutation({
    mutationFn: () => addon
      ? apiRequest("PATCH", `/api/admin/venue/addons/${addon.id}`, form)
      : apiRequest("POST", "/api/admin/venue/addons", { ...form, organizationId: orgId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/addons"] });
      toast({ title: addon ? "Add-on updated" : "Add-on created" });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0f1423] border border-white/10 rounded-2xl p-6 w-[450px] max-w-[95vw] space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{addon ? "Edit Add-on" : "Create Add-on"}</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Name</label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Floodlights, Changing Room" className="bg-white/5 border-white/10 text-white" data-testid="input-addon-name" />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Description</label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description" className="bg-white/5 border-white/10 text-white min-h-[70px]" data-testid="input-addon-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/40 mb-1 block">Price (ex GST)</label>
              <Input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-addon-price" />
            </div>
            <div>
              <label className="text-xs text-white/40 mb-1 block">Unit</label>
              <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-addon-unit"><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/40">Applies to all resources</span>
            <Switch checked={form.appliesToAll} onCheckedChange={v => setForm({ ...form, appliesToAll: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/40">Active</span>
            <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="text-white/50">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-addon">
            {saveMutation.isPending ? "Saving..." : addon ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function VenueAddons() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editAddon, setEditAddon] = useState<FacilityAddon | undefined>();

  const { data: addons = [] } = useQuery<FacilityAddon[]>({
    queryKey: ["/api/admin/venue/addons", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/addons?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/venue/addons/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/addons"] });
      toast({ title: "Add-on deleted" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1100px]">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Puzzle className="w-6 h-6 text-white/40" />
            <div>
              <h1 className="text-2xl font-bold text-white" data-testid="text-venue-addons-title">Add-ons</h1>
              <p className="text-sm text-white/40">Manage booking add-ons and extras</p>
            </div>
          </div>
        </div>
        <Button onClick={() => { setEditAddon(undefined); setShowModal(true); }} className="bg-white/10 hover:bg-white/15 text-white border border-white/10" data-testid="button-add-addon">
          <Plus className="w-4 h-4 mr-1" /> Add New
        </Button>
      </div>

      {addons.length === 0 ? (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center">
          <Puzzle className="w-12 h-12 text-white/10 mx-auto mb-3" />
          <p className="text-white/40 text-lg mb-1">No add-ons yet</p>
          <p className="text-white/20 text-sm mb-4">Create your first booking add-on to get started</p>
          <Button onClick={() => { setEditAddon(undefined); setShowModal(true); }} className="bg-white/10 hover:bg-white/15 text-white border border-white/10" data-testid="button-create-first-addon">
            <Plus className="w-4 h-4 mr-1" /> Create Add-on
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {addons.map(a => (
            <div key={a.id} className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-4 flex items-center justify-between" data-testid={`addon-row-${a.id}`}>
              <div>
                <h3 className="text-sm font-semibold text-white">{a.name}</h3>
                {a.description && <p className="text-xs text-white/30 mt-0.5">{a.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-white/25">
                  <span>${Number(a.price).toFixed(2)} ex GST</span>
                  <span>{UNITS.find(u => u.value === a.unit)?.label || a.unit}</span>
                  {a.appliesToAll && <span>All resources</span>}
                  <span className={a.active ? "text-green-400" : "text-red-400"}>{a.active ? "Active" : "Inactive"}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditAddon(a); setShowModal(true); }} className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { if (confirm("Delete this add-on?")) deleteMutation.mutate(a.id); }} className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AddonModal
          addon={editAddon}
          orgId={orgId!}
          onClose={() => { setShowModal(false); setEditAddon(undefined); }}
        />
      )}
    </div>
  );
}
