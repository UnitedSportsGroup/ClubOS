import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Shield, Plus, Pencil, Trash2, DollarSign, ChevronDown, LayoutGrid, List, X, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Facility } from "@shared/schema";

type FacilityWithRules = Facility & { pricingRulesCount: number };

const FACILITY_TYPES = [
  { value: "field", label: "Field" },
  { value: "mini_pitch", label: "Mini Pitch" },
  { value: "meeting_room", label: "Meeting Room" },
  { value: "changing_room", label: "Changing Room" },
  { value: "futsal", label: "Futsal" },
  { value: "court", label: "Court" },
  { value: "other", label: "Other" },
];

const typeLabels: Record<string, string> = Object.fromEntries(FACILITY_TYPES.map(t => [t.value, t.label]));

function FacilityModal({ facility, orgId, onClose }: { facility?: FacilityWithRules; orgId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: facility?.name || "",
    type: facility?.type || "field",
    description: facility?.description || "",
    imageUrl: facility?.imageUrl || "",
    halfFull: facility?.halfFull || false,
    floodlights: facility?.floodlights || false,
    bufferMinutes: facility?.bufferMinutes || 0,
    publicVisible: facility?.publicVisible ?? true,
    displayOrder: facility?.displayOrder ?? 0,
    pricePerHour: facility?.pricePerHourCents != null ? (facility.pricePerHourCents / 100).toFixed(2) : "",
    halfPricePerHour: facility?.halfFieldPricePerHourCents != null ? (facility.halfFieldPricePerHourCents / 100).toFixed(2) : "",
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        type: form.type,
        description: form.description,
        imageUrl: form.imageUrl,
        halfFull: form.halfFull,
        floodlights: form.floodlights,
        bufferMinutes: form.bufferMinutes,
        publicVisible: form.publicVisible,
        displayOrder: form.displayOrder,
        pricePerHourCents: form.pricePerHour ? Math.round(parseFloat(form.pricePerHour) * 100) : null,
        halfFieldPricePerHourCents: form.halfPricePerHour ? Math.round(parseFloat(form.halfPricePerHour) * 100) : null,
      };
      return facility
        ? apiRequest("PATCH", `/api/admin/venue/facilities/${facility.id}`, payload)
        : apiRequest("POST", "/api/admin/venue/facilities", { ...payload, organizationId: orgId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/facilities"] });
      toast({ title: facility ? "Facility updated" : "Facility created" });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0f1423] border border-white/10 rounded-2xl p-6 w-[480px] max-w-[95vw] space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{facility ? "Edit Facility" : "Add Facility"}</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Name</label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Futsal Court 1" className="bg-white/5 border-white/10 text-white" data-testid="input-facility-name" />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Type</label>
            <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-facility-type"><SelectValue /></SelectTrigger>
              <SelectContent>{FACILITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Description</label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe this facility..." className="bg-white/5 border-white/10 text-white min-h-[80px]" data-testid="input-facility-description" />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Image URL</label>
            <Input value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." className="bg-white/5 border-white/10 text-white" data-testid="input-facility-image" />
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">Half/Full</span>
              <Switch checked={form.halfFull} onCheckedChange={v => setForm({ ...form, halfFull: v })} data-testid="switch-half-full" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">Floodlights</span>
              <Switch checked={form.floodlights} onCheckedChange={v => setForm({ ...form, floodlights: v })} data-testid="switch-floodlights" />
            </div>
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Buffer Minutes</label>
            <Input type="number" value={form.bufferMinutes} onChange={e => setForm({ ...form, bufferMinutes: parseInt(e.target.value) || 0 })} className="bg-white/5 border-white/10 text-white" data-testid="input-buffer-minutes" />
          </div>

          <div className="border-t border-white/[0.06] pt-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-white/30">Public booking site</div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">Show publicly</span>
                <Switch checked={form.publicVisible} onCheckedChange={v => setForm({ ...form, publicVisible: v })} data-testid="switch-public-visible" />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-white/40">Display order</span>
                <Input
                  type="number"
                  value={form.displayOrder}
                  onChange={e => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })}
                  className="bg-white/5 border-white/10 text-white w-24"
                  data-testid="input-display-order"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/40 mb-1 block">Price / hour (NZD)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.pricePerHour}
                  onChange={e => setForm({ ...form, pricePerHour: e.target.value })}
                  placeholder="e.g. 180.00"
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="input-price-per-hour"
                />
              </div>
              {form.halfFull && (
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Half-field / hour (NZD)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.halfPricePerHour}
                    onChange={e => setForm({ ...form, halfPricePerHour: e.target.value })}
                    placeholder="defaults to 50%"
                    className="bg-white/5 border-white/10 text-white"
                    data-testid="input-half-price-per-hour"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="text-white/50">Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-facility">
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function VenueFacilities() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editFacility, setEditFacility] = useState<FacilityWithRules | undefined>();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedPricing, setExpandedPricing] = useState<number | null>(null);

  const { data: facs = [] } = useQuery<FacilityWithRules[]>({
    queryKey: ["/api/admin/venue/facilities", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/facilities?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/venue/facilities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/facilities"] });
      toast({ title: "Facility deleted" });
    },
  });

  const filtered = typeFilter === "all" ? facs : facs.filter(f => f.type === typeFilter);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1100px]">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-white/40" />
            <div>
              <h1 className="text-2xl font-bold text-white" data-testid="text-venue-facilities-title">Facilities</h1>
              <p className="text-sm text-white/40">{facs.length} facilities</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white/60 w-32" data-testid="select-type-filter">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {FACILITY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            <button onClick={() => setViewMode("grid")} className={`p-1.5 ${viewMode === "grid" ? "bg-white/15 text-white" : "text-white/30"}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setViewMode("list")} className={`p-1.5 ${viewMode === "list" ? "bg-white/15 text-white" : "text-white/30"}`}><List className="w-4 h-4" /></button>
          </div>
          <Button onClick={() => { setEditFacility(undefined); setShowModal(true); }} className="bg-white/10 hover:bg-white/15 text-white border border-white/10" data-testid="button-add-facility">
            <Plus className="w-4 h-4 mr-1" /> Add Facility
          </Button>
        </div>
      </div>

      <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-3"}>
        {filtered.map(f => (
          <div key={f.id} className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden" data-testid={`facility-card-${f.id}`}>
            <div className="relative">
              <div className="h-28 bg-gradient-to-br from-white/[0.03] to-white/[0.01] flex items-center justify-center">
                {f.imageUrl ? (
                  <img src={f.imageUrl} alt={f.name} className="w-full h-full object-cover" />
                ) : (
                  <Shield className="w-10 h-10 text-white/10" />
                )}
              </div>
              <span className="absolute top-2 right-2 text-[9px] font-semibold uppercase tracking-wider bg-green-500/20 text-green-400 border border-green-500/20 rounded px-2 py-0.5">
                {f.active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">{f.name}</h3>
                  <p className="text-[10px] text-white/30 mt-0.5">{typeLabels[f.type] || f.type}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditFacility(f); setShowModal(true); }} className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5" data-testid={`button-edit-facility-${f.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm("Delete this facility?")) deleteMutation.mutate(f.id); }} className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10" data-testid={`button-delete-facility-${f.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-white/25">
                {f.halfFull && <span className="flex items-center gap-1">◻ Half/Full</span>}
                {f.floodlights && <span className="flex items-center gap-1"><Lightbulb className="w-3 h-3" /> Floodlights</span>}
              </div>
              <button
                onClick={() => setExpandedPricing(expandedPricing === f.id ? null : f.id)}
                className="flex items-center gap-2 mt-3 text-xs text-white/40 hover:text-white/60 transition-colors w-full"
                data-testid={`button-pricing-${f.id}`}
              >
                <DollarSign className="w-3.5 h-3.5" />
                <span>Pricing Rules ({f.pricingRulesCount})</span>
                <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${expandedPricing === f.id ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-12 text-center">
          <Shield className="w-12 h-12 text-white/10 mx-auto mb-3" />
          <p className="text-white/30">No facilities found</p>
        </div>
      )}

      {showModal && (
        <FacilityModal
          facility={editFacility}
          orgId={orgId!}
          onClose={() => { setShowModal(false); setEditFacility(undefined); }}
        />
      )}
    </div>
  );
}
