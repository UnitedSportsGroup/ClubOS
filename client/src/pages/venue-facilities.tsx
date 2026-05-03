import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Shield, Plus, Pencil, Trash2, DollarSign, ChevronDown, LayoutGrid, List, X, Lightbulb, Upload, GripVertical, Star, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Facility, FacilityPricingRule } from "@shared/schema";
import { FacilityCarousel } from "@/components/FacilityCarousel";

type FacilityWithRules = Facility & { pricingRulesCount: number };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_PILLS = [
  { n: 1, short: "M" }, { n: 2, short: "T" }, { n: 3, short: "W" },
  { n: 4, short: "T" }, { n: 5, short: "F" }, { n: 6, short: "S" }, { n: 0, short: "S" },
];

function describeDays(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 5 && [1, 2, 3, 4, 5].every(d => sorted.includes(d))) return "Mon–Fri (weekdays)";
  if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) return "Sat & Sun (weekends)";
  return sorted.map(d => DAY_NAMES[d]).join(", ");
}

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

const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB per image (server resizes + re-encodes to WebP)

function FacilityImageManager({
  facilityId,
  imageUrls,
  onChange,
}: {
  facilityId: number;
  imageUrls: string[];
  onChange: (urls: string[]) => void;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadFiles = useCallback(async (files: File[]) => {
    const valid: File[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) {
        toast({ title: "Skipped a file", description: `"${f.name}" isn't an image.`, variant: "destructive" });
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        toast({ title: "Image too large", description: `"${f.name}" is over 25 MB.`, variant: "destructive" });
        continue;
      }
      valid.push(f);
    }
    if (valid.length === 0) return;

    setUploading(true);
    try {
      // One multipart request — the server runs every file through sharp:
      // auto-rotate → cap to 2400px → re-encode as WebP @ q82 → strip EXIF.
      const fd = new FormData();
      for (const file of valid) fd.append("files", file, file.name);

      const res = await fetch(`/api/admin/venue/facilities/${facilityId}/images/upload`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Upload failed");
      }
      const updated = await res.json();
      onChange(updated.imageUrls || []);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/facilities"] });
      toast({ title: `Optimised & uploaded ${valid.length} image${valid.length === 1 ? "" : "s"}` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [facilityId, onChange, toast]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (dragIndex !== null) return; // a thumbnail-reorder drop, not a file drop
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) uploadFiles(files);
  }, [dragIndex, uploadFiles]);

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) uploadFiles(files);
    e.target.value = "";
  };

  const removeAt = (idx: number) => {
    const next = imageUrls.filter((_, i) => i !== idx);
    onChange(next);
  };

  const moveItem = (from: number, to: number) => {
    if (from === to) return;
    const copy = imageUrls.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    onChange(copy);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); if (dragIndex === null) setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
          dragActive ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
        }`}
        data-testid="dropzone-facility-images"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPicked}
          className="hidden"
          data-testid="input-facility-image-files"
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-white/60 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-white/50">
            <Upload className="w-5 h-5 text-white/40" />
            <div className="text-sm">
              <span className="text-white/80 font-medium">Click to choose photos</span>
              <span className="text-white/40"> or drag &amp; drop here</span>
            </div>
            <div className="text-[10px] text-white/30">Any size — auto-resized & converted to WebP for fast page loads</div>
          </div>
        )}
      </div>

      {imageUrls.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2 flex items-center justify-between">
            <span>{imageUrls.length} photo{imageUrls.length === 1 ? "" : "s"}</span>
            <span className="text-white/30 normal-case tracking-normal text-[10px]">Drag to reorder · the first one is the main image</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="grid-facility-thumbs">
            {imageUrls.map((url, idx) => (
              <div
                key={`${url}-${idx}`}
                draggable
                onDragStart={e => { setDragIndex(idx); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={e => { e.preventDefault(); if (dragIndex !== null && dragIndex !== idx) setOverIndex(idx); }}
                onDragLeave={() => setOverIndex(prev => (prev === idx ? null : prev))}
                onDrop={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragIndex !== null && dragIndex !== idx) moveItem(dragIndex, idx);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                className={`relative group rounded-xl overflow-hidden border bg-white/[0.02] aspect-[4/3] ${
                  overIndex === idx ? "border-blue-400/60 ring-2 ring-blue-400/40" : "border-white/10"
                } ${dragIndex === idx ? "opacity-50" : ""}`}
                data-testid={`thumb-image-${idx}`}
              >
                <img src={url} alt="" className="w-full h-full object-cover pointer-events-none" />
                {idx === 0 && (
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/70 backdrop-blur text-amber-300 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider">
                    <Star className="w-2.5 h-2.5 fill-amber-300" /> Main
                  </div>
                )}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeAt(idx); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  data-testid={`button-remove-image-${idx}`}
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
                <div className="absolute bottom-1 left-1 bg-black/70 text-white/60 rounded p-0.5 opacity-0 group-hover:opacity-100 transition">
                  <GripVertical className="w-3 h-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PricingRulesEditor({ facilityId, baseRate }: { facilityId: number; baseRate: string }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [editingSig, setEditingSig] = useState<string | null>(null);
  const [editingIds, setEditingIds] = useState<number[]>([]);
  const [newRule, setNewRule] = useState({
    name: "",
    days: [] as number[],
    startTime: "07:00",
    endTime: "15:00",
    pricePerHour: "",
  });

  const resetForm = () => {
    setAdding(false);
    setEditingSig(null);
    setEditingIds([]);
    setNewRule({ name: "", days: [], startTime: "07:00", endTime: "15:00", pricePerHour: "" });
  };

  const { data: rules = [], isLoading } = useQuery<FacilityPricingRule[]>({
    queryKey: ["/api/admin/venue/facilities", facilityId, "pricing"],
    queryFn: () => fetch(`/api/admin/venue/facilities/${facilityId}/pricing`).then(r => r.json()),
  });

  // Group rules by signature so a single "Mon-Fri 7-15 @ $180" entry shows as one card
  // even though it's stored as 5 separate rows in the DB (one per day).
  const groups = (() => {
    const map = new Map<string, { signature: string; ids: number[]; days: number[]; rule: FacilityPricingRule }>();
    for (const r of rules) {
      const sig = `${r.name}|${r.startTime || ""}|${r.endTime || ""}|${r.pricePerHour}|${r.isDefault ? 1 : 0}`;
      if (!map.has(sig)) {
        map.set(sig, { signature: sig, ids: [], days: [], rule: r });
      }
      const g = map.get(sig)!;
      g.ids.push(r.id);
      if (r.dayOfWeek != null) g.days.push(r.dayOfWeek);
    }
    return Array.from(map.values());
  })();

  const saveMutation = useMutation({
    mutationFn: async () => {
      // On edit, wipe the previous rows for this group first — a "rule" is virtual
      // (N rows sharing name/time/price), so swap-by-replace keeps the data model simple.
      if (editingIds.length > 0) {
        for (const id of editingIds) {
          await apiRequest("DELETE", `/api/admin/venue/pricing/${id}`);
        }
      }
      for (const day of newRule.days) {
        await apiRequest("POST", `/api/admin/venue/facilities/${facilityId}/pricing`, {
          name: newRule.name,
          dayOfWeek: day,
          startTime: newRule.startTime,
          endTime: newRule.endTime,
          pricePerHour: newRule.pricePerHour,
          isDefault: false,
        });
      }
    },
    onSuccess: () => {
      const wasEdit = editingIds.length > 0;
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/facilities", facilityId, "pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/facilities"] });
      resetForm();
      toast({ title: wasEdit ? "Pricing rule updated" : "Pricing rule added" });
    },
    onError: (e: any) => toast({ title: "Couldn't save rule", description: e?.message || String(e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      // A grouped rule = N rows; delete them all together.
      for (const id of ids) {
        await apiRequest("DELETE", `/api/admin/venue/pricing/${id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/facilities", facilityId, "pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/facilities"] });
      toast({ title: "Pricing rule removed" });
    },
  });

  const setPreset = (preset: "weekdays" | "weekends" | "all") => {
    if (preset === "weekdays") setNewRule({ ...newRule, days: [1, 2, 3, 4, 5] });
    else if (preset === "weekends") setNewRule({ ...newRule, days: [0, 6] });
    else setNewRule({ ...newRule, days: [0, 1, 2, 3, 4, 5, 6] });
  };

  const toggleDay = (d: number) => {
    setNewRule({
      ...newRule,
      days: newRule.days.includes(d)
        ? newRule.days.filter(x => x !== d)
        : [...newRule.days, d],
    });
  };

  return (
    <div className="space-y-2" data-testid="pricing-rules-editor">
      <p className="text-[11px] text-white/40">
        Override the base rate{baseRate ? ` of $${baseRate}/hr` : ""} for specific days &amp; times. The first matching rule wins; if none match, the base rate is used.
      </p>

      {isLoading ? (
        <div className="text-xs text-white/30">Loading...</div>
      ) : groups.length === 0 ? (
        <div className="text-xs text-white/30 italic">No variable pricing yet — base rate applies all the time.</div>
      ) : (
        <div className="space-y-1.5">
          {groups.map(g => (
            <div key={g.signature} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5" data-testid={`pricing-rule-${g.rule.id}`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white truncate">{g.rule.name}</div>
                <div className="text-[10px] text-white/40 mt-0.5">
                  {describeDays(g.days)} · {g.rule.startTime} – {g.rule.endTime} · <span className="text-green-400 font-medium">${parseFloat(g.rule.pricePerHour).toFixed(2)}/hr</span>
                </div>
              </div>
              <button
                onClick={() => {
                  setEditingSig(g.signature);
                  setEditingIds(g.ids);
                  setNewRule({
                    name: g.rule.name,
                    days: [...g.days],
                    startTime: g.rule.startTime || "07:00",
                    endTime: g.rule.endTime || "15:00",
                    pricePerHour: g.rule.pricePerHour,
                  });
                  setAdding(true);
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-blue-400 hover:bg-blue-500/10 flex-shrink-0"
                data-testid={`button-edit-pricing-${g.rule.id}`}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { if (confirm(`Delete pricing rule "${g.rule.name}"?`)) deleteMutation.mutate(g.ids); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
                disabled={deleteMutation.isPending}
                data-testid={`button-delete-pricing-${g.rule.id}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-1"
          data-testid="button-add-pricing-rule"
        >
          <Plus className="w-3 h-3" /> Add pricing rule
        </button>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3" data-testid="pricing-rule-form">
          <div>
            <label className="text-[10px] text-white/40 mb-1 block">Rule name</label>
            <Input
              value={newRule.name}
              onChange={e => setNewRule({ ...newRule, name: e.target.value })}
              placeholder="e.g. Weekday peak"
              className="bg-white/5 border-white/10 text-white text-xs h-8"
              data-testid="input-rule-name"
            />
          </div>

          <div>
            <label className="text-[10px] text-white/40 mb-1 block">Days</label>
            <div className="flex items-center gap-1.5 mb-2">
              {DAY_PILLS.map(d => {
                const active = newRule.days.includes(d.n);
                return (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() => toggleDay(d.n)}
                    className={`w-7 h-7 rounded-full text-[11px] font-medium border transition-colors ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"}`}
                    data-testid={`button-rule-day-${d.n}`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setPreset("weekdays")} className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/50 hover:bg-white/5" data-testid="button-preset-weekdays">Weekdays</button>
              <button type="button" onClick={() => setPreset("weekends")} className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/50 hover:bg-white/5" data-testid="button-preset-weekends">Weekends</button>
              <button type="button" onClick={() => setPreset("all")} className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/50 hover:bg-white/5" data-testid="button-preset-all">Every day</button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-white/40 mb-1 block">Start</label>
              <Input
                type="time"
                value={newRule.startTime}
                onChange={e => setNewRule({ ...newRule, startTime: e.target.value })}
                className="bg-white/5 border-white/10 text-white text-xs h-8"
                data-testid="input-rule-start"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/40 mb-1 block">End</label>
              <Input
                type="time"
                value={newRule.endTime}
                onChange={e => setNewRule({ ...newRule, endTime: e.target.value })}
                className="bg-white/5 border-white/10 text-white text-xs h-8"
                data-testid="input-rule-end"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/40 mb-1 block">Price / hr</label>
              <Input
                type="number"
                step="0.01"
                value={newRule.pricePerHour}
                onChange={e => setNewRule({ ...newRule, pricePerHour: e.target.value })}
                placeholder="180.00"
                className="bg-white/5 border-white/10 text-white text-xs h-8"
                data-testid="input-rule-price"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={resetForm} className="text-white/50 h-7 text-xs">Cancel</Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={
                !newRule.name ||
                newRule.days.length === 0 ||
                !newRule.startTime ||
                !newRule.endTime ||
                !newRule.pricePerHour ||
                saveMutation.isPending
              }
              className="bg-blue-600 hover:bg-blue-700 text-white h-7 text-xs"
              data-testid="button-save-pricing-rule"
            >
              {saveMutation.isPending ? (editingSig ? "Saving..." : "Adding...") : (editingSig ? "Save changes" : "Add rule")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FacilityModal({ facility, orgId, onClose }: { facility?: FacilityWithRules; orgId: number; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: facility?.name || "",
    type: facility?.type || "field",
    description: facility?.description || "",
    imageUrls: facility?.imageUrls || [],
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
        imageUrls: form.imageUrls,
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
      <div className="bg-[#0f1423] border border-white/10 rounded-2xl p-6 w-[520px] max-w-[95vw] max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
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
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-white/40">Photos</label>
              {form.imageUrls.length > 0 && (
                <span className="text-[10px] text-white/30">{form.imageUrls.length} added</span>
              )}
            </div>
            {facility ? (
              <FacilityImageManager
                facilityId={facility.id}
                imageUrls={form.imageUrls}
                onChange={urls => setForm({ ...form, imageUrls: urls })}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs text-white/40 flex items-center justify-center gap-2" data-testid="text-images-after-save-hint">
                <ImageIcon className="w-4 h-4 text-white/30" />
                Save the facility first, then you can upload photos.
              </div>
            )}
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

            {/* Variable pricing rules — peak/off-peak, weekday/weekend, etc. */}
            <div className="border-t border-white/[0.06] pt-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-white/30">Variable pricing</div>
              {facility ? (
                <PricingRulesEditor facilityId={facility.id} baseRate={form.pricePerHour} />
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-3 text-center text-[11px] text-white/40">
                  Save the facility first, then you can add peak/off-peak pricing rules.
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
    <div className="p-4 sm:p-6 space-y-6">
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

      <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4" : "space-y-3"}>
        {filtered.map(f => {
          const allImages = (f.imageUrls && f.imageUrls.length > 0) ? f.imageUrls : (f.imageUrl ? [f.imageUrl] : []);
          return (
          <div key={f.id} className={`rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden ${viewMode === "list" ? "flex" : ""}`} data-testid={`facility-card-${f.id}`}>
            <div className={`relative ${viewMode === "list" ? "w-48 flex-shrink-0" : ""}`}>
              {allImages.length > 0 ? (
                viewMode === "list" ? (
                  <div className="h-full w-full relative">
                    <img src={allImages[0]} alt={f.name} className="w-full h-full object-cover" />
                    {allImages.length > 1 && (
                      <span className="absolute bottom-1.5 right-1.5 bg-black/70 backdrop-blur text-white/80 text-[10px] px-1.5 py-0.5 rounded font-medium" data-testid={`badge-photo-count-${f.id}`}>
                        +{allImages.length - 1}
                      </span>
                    )}
                  </div>
                ) : (
                  <FacilityCarousel
                    images={allImages}
                    alt={f.name}
                    brand="#3b82f6"
                    testIdPrefix={`admin-facility-${f.id}`}
                  />
                )
              ) : (
                <div className={`${viewMode === "list" ? "h-full" : "aspect-video"} bg-gradient-to-br from-white/[0.03] to-white/[0.01] flex items-center justify-center`}>
                  <Shield className="w-10 h-10 text-white/10" />
                </div>
              )}
              <span className="absolute top-2 right-2 z-10 text-[9px] font-semibold uppercase tracking-wider bg-green-500/20 text-green-400 border border-green-500/20 rounded px-2 py-0.5">
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
          );
        })}
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
