// Warehouse items (T16a, SPEC §4.4) — list/filter/detail over `wh_items`.
// Detail view carries per-location stock + movement history (the two
// endpoints added this task: `GET /items/:id/stock`, `GET /items/:id/movements`
// — nothing before T16a ever needed a per-item stock/ledger read). List +
// CRUD reuse the existing T4 endpoints verbatim. Bulk-select + "Print
// labels" deep-links to `warehouse-labels.tsx` (T14) via its documented
// `?kind=item&ids=1,2,3` contract.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Search, Plus, X, Tag, MapPin, History, Printer, Trash2, Loader2, ScanLine, ChevronDown, ChevronRight, Package,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BarcodeEditor, BarcodeDraftEditor, type DraftBarcode } from "@/components/warehouse-barcodes";
import {
  TrackingModeChooser, DynamicItemForm, ModeHeader, EMPTY_DRAFT, draftToPayload, type ItemDraft,
} from "@/components/warehouse-item-form";
import { useToast } from "@/hooks/use-toast";
import { askConfirm } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ITEM_KINDS, ITEM_KIND_LABELS, BRAND_OWNERS, BRAND_OWNER_LABELS, UNITS, UNIT_LABELS, MOVEMENT_TYPE_LABELS, REASON_CODE_LABELS, type ItemKind, type BrandOwner, type Unit, type TrackingMode, locationLabel, SHOP_ORDER, SHOP_SHORT_LABELS, shopCategoryRank } from "@shared/warehouse";
import type { WhItem, WhLocation, WhBarcodeAlias } from "@shared/schema";

interface ItemRow extends WhItem {
  defaultLocationCode: string | null;
}
interface ItemDetail extends ItemRow {
  aliases: WhBarcodeAlias[];
}
interface StockRow {
  locationId: number;
  onHand: string;
  updatedAt: string;
  locationCode: string;
  locationZone: string | null;
  locationKind: string;
}
interface MovementRow {
  id: number;
  delta: string;
  movementType: string;
  reasonCode: string | null;
  refKind: string | null;
  refId: number | null;
  note: string | null;
  createdAt: string;
  locationCode: string;
  operatorName: string;
}

const ALL = "__all__";

function qty(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "—";
  const n = Number(raw);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toggleId(set: Set<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

interface ItemFormValue {
  sku: string;
  name: string;
  kind: ItemKind;
  brandOwner: BrandOwner;
  category: string;
  unit: Unit;
  minQty: string;
  costCents: string;
  allowNegative: boolean;
  isLoanable: boolean;
  defaultLocationId: string;
  active: boolean;
  notes: string;
}

const EMPTY_FORM: ItemFormValue = {
  sku: "", name: "", kind: "merch", brandOwner: "club", category: "", unit: "ea",
  minQty: "", costCents: "", allowNegative: false, isLoanable: false, defaultLocationId: "", active: true, notes: "",
};

function formFromItem(item: ItemRow): ItemFormValue {
  return {
    sku: item.sku,
    name: item.name,
    kind: item.kind as ItemKind,
    brandOwner: item.brandOwner as BrandOwner,
    category: item.category ?? "",
    unit: item.unit as Unit,
    minQty: item.minQty ?? "",
    costCents: item.costCents != null ? String(item.costCents) : "",
    allowNegative: item.allowNegative,
    isLoanable: item.isLoanable,
    defaultLocationId: item.defaultLocationId != null ? String(item.defaultLocationId) : "",
    active: item.active,
    notes: item.notes ?? "",
  };
}

function formToPayload(f: ItemFormValue) {
  return {
    sku: f.sku,
    name: f.name,
    kind: f.kind,
    brandOwner: f.brandOwner,
    category: f.category || null,
    unit: f.unit,
    minQty: f.minQty === "" ? null : f.minQty,
    costCents: f.costCents === "" ? null : parseInt(f.costCents, 10),
    allowNegative: f.allowNegative,
    isLoanable: f.isLoanable,
    defaultLocationId: f.defaultLocationId === "" ? null : parseInt(f.defaultLocationId, 10),
    active: f.active,
    notes: f.notes || null,
  };
}

function ItemForm({
  value, onChange, locations,
}: { value: ItemFormValue; onChange: (v: ItemFormValue) => void; locations: WhLocation[] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">SKU</label>
          <Input value={value.sku} onChange={(e) => onChange({ ...value, sku: e.target.value })} className="bg-white/[0.02] border-white/10 text-white font-mono" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Name</label>
          <Input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} className="bg-white/[0.02] border-white/10 text-white" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Kind</label>
          <Select value={value.kind} onValueChange={(v) => onChange({ ...value, kind: v as ItemKind })}>
            <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)]">
              {ITEM_KINDS.map((k) => <SelectItem key={k} value={k}>{ITEM_KIND_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Brand owner</label>
          <Select value={value.brandOwner} onValueChange={(v) => onChange({ ...value, brandOwner: v as BrandOwner })}>
            <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BRAND_OWNERS.map((b) => <SelectItem key={b} value={b}>{BRAND_OWNER_LABELS[b]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Unit</label>
          <Select value={value.unit} onValueChange={(v) => onChange({ ...value, unit: v as Unit })}>
            <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => <SelectItem key={u} value={u}>{UNIT_LABELS[u]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Category</label>
          <Input value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })} className="bg-white/[0.02] border-white/10 text-white" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Default location</label>
          <Select value={value.defaultLocationId || ALL} onValueChange={(v) => onChange({ ...value, defaultLocationId: v === ALL ? "" : v })}>
            <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>None</SelectItem>
              {locations.map((l) => <SelectItem key={l.id} value={String(l.id)}>{locationLabel(l)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Reorder point (min qty)</label>
          <Input type="number" value={value.minQty} onChange={(e) => onChange({ ...value, minQty: e.target.value })} className="bg-white/[0.02] border-white/10 text-white" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-white/40">Cost (cents, reference)</label>
          <Input type="number" value={value.costCents} onChange={(e) => onChange({ ...value, costCents: e.target.value })} className="bg-white/[0.02] border-white/10 text-white" />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-white/40">Notes</label>
        <textarea value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} className="w-full px-3 py-2 rounded-md bg-white/[0.02] border border-white/10 text-white text-sm min-h-[50px]" />
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1">
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={value.active} onChange={(e) => onChange({ ...value, active: e.target.checked })} /> Active
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={value.allowNegative} onChange={(e) => onChange({ ...value, allowNegative: e.target.checked })} /> Allow negative
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={value.isLoanable} onChange={(e) => onChange({ ...value, isLoanable: e.target.checked })} /> Loanable
        </label>
      </div>
    </div>
  );
}

function CreateItemModal({ open, onClose, locations }: { open: boolean; onClose: () => void; locations: WhLocation[] }) {
  const { toast } = useToast();
  // D26 — step 1 picks the tracking mode, step 2 renders the admin's layout.
  // null means we're still on step 1.
  const [mode, setMode] = useState<TrackingMode | null>(null);
  const [form, setForm] = useState<ItemDraft>(EMPTY_DRAFT);
  const [barcodes, setBarcodes] = useState<DraftBarcode[]>([]);
  const [custom, setCustom] = useState<Record<string, string | boolean>>({});

  const reset = () => { setMode(null); setForm(EMPTY_DRAFT); setBarcodes([]); setCustom({}); };

  const create = useMutation({
    mutationFn: async () => {
      const item = await (await apiRequest("POST", "/api/admin/warehouse/items", draftToPayload(form, mode!))).json();

      // Barcodes are linked AFTER the item exists — they need its id. One that
      // fails (usually already pointing at another item) must not lose the
      // item just created, so each is reported and the rest still go through.
      const rejected: string[] = [];
      for (const b of barcodes) {
        try { await apiRequest("POST", `/api/admin/warehouse/items/${item.id}/aliases`, b); }
        catch { rejected.push(b.code); }
      }

      // Custom field values, if the category defined any.
      const filled = Object.fromEntries(Object.entries(custom).filter(([, v]) => v !== "" && v !== undefined));
      if (Object.keys(filled).length > 0) {
        try { await apiRequest("PUT", `/api/admin/warehouse/fields/item/${item.id}`, { values: filled }); }
        catch { /* reported below via the item still being created */ }
      }
      return { item, rejected };
    },
    onSuccess: ({ rejected }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/items"] });
      toast(
        rejected.length
          ? {
              title: "Item created, some barcodes weren't linked",
              description: `${rejected.join(", ")} — already linked to another item. Add them from the item once that's sorted.`,
              variant: "destructive",
            }
          : { title: barcodes.length ? `Item created with ${barcodes.length} barcode(s)` : "Item created" },
      );
      reset();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[#02060E] p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">New item</h3>
          <button onClick={() => { reset(); onClose(); }} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {mode === null ? (
          <TrackingModeChooser onPick={setMode} />
        ) : (
          <>
            <ModeHeader mode={mode} onBack={() => setMode(null)} />
            <DynamicItemForm
              mode={mode}
              value={form}
              onChange={setForm}
              locations={locations}
              barcodes={barcodes}
              onBarcodesChange={setBarcodes}
              customValues={custom}
              onCustomChange={setCustom}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
              <Button
                onClick={() => create.mutate()}
                disabled={create.isPending || !form.sku || !form.name}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {create.isPending ? "Creating..." : "Create item"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ItemDetailModal({
  itemId, onClose, locations, onPrintLabel,
}: { itemId: number | null; onClose: () => void; locations: WhLocation[]; onPrintLabel: (id: number) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ItemFormValue | null>(null);

  const { data: item, isLoading } = useQuery<ItemDetail>({
    queryKey: ["/api/admin/warehouse/items", itemId],
    queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/items/${itemId}`)).json(),
    enabled: itemId !== null,
  });
  const { data: stock = [] } = useQuery<StockRow[]>({
    queryKey: ["/api/admin/warehouse/items", itemId, "stock"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/items/${itemId}/stock`)).json(),
    enabled: itemId !== null,
  });
  const { data: movements = [] } = useQuery<MovementRow[]>({
    queryKey: ["/api/admin/warehouse/items", itemId, "movements"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/items/${itemId}/movements?limit=50`)).json(),
    enabled: itemId !== null,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form || itemId === null) throw new Error("Nothing to save");
      return (await apiRequest("PATCH", `/api/admin/warehouse/items/${itemId}`, formToPayload(form))).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/items"] });
      toast({ title: "Saved" });
      setEditing(false);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (itemId === null) throw new Error("Nothing to delete");
      return (await apiRequest("DELETE", `/api/admin/warehouse/items/${itemId}`)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/items"] });
      toast({ title: "Item deleted" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const totalOnHand = stock.reduce((sum, s) => sum + Number(s.onHand), 0);

  if (itemId === null) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl rounded-2xl border border-white/10 bg-[#02060E] p-6 max-h-[90vh] overflow-auto">
        {isLoading || !item ? (
          <div className="py-16 flex items-center justify-center gap-2 text-white/40 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white font-mono">{item.sku}</h3>
                <div className="text-sm text-white/50">{item.name}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => onPrintLabel(item.id)} className="px-2.5 py-1.5 rounded-lg text-xs text-white/70 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5" /> Label
                </button>
                <button onClick={onClose} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
            </div>

            {editing && form ? (
              <>
                <ItemForm value={form} onChange={setForm} locations={locations} />
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button onClick={() => save.mutate()} disabled={save.isPending} className="bg-blue-600 hover:bg-blue-700">
                    {save.isPending ? "Saving..." : "Save changes"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                    <div className="text-[10px] uppercase text-white/30">Total on hand</div>
                    <div className="text-lg font-mono text-white">{qty(totalOnHand)}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                    <div className="text-[10px] uppercase text-white/30">Reorder point</div>
                    <div className="text-lg font-mono text-white">{qty(item.minQty)}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                    <div className="text-[10px] uppercase text-white/30">Kind</div>
                    <div className="text-sm text-white/80 mt-1">{ITEM_KIND_LABELS[item.kind as ItemKind] ?? item.kind}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                    <div className="text-[10px] uppercase text-white/30">Brand</div>
                    <div className="text-sm text-white/80 mt-1">{BRAND_OWNER_LABELS[item.brandOwner as BrandOwner] ?? item.brandOwner}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> Stock by location
                    </h4>
                    {stock.length === 0 ? (
                      <div className="text-sm text-white/30 py-4 text-center rounded-lg bg-white/[0.02] border border-white/5">No stock recorded yet.</div>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {stock.map((s) => (
                          <div key={s.locationId} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5 text-sm">
                            <span className="text-white/70 font-mono">{s.locationCode}</span>
                            <span className="text-white font-mono">{qty(s.onHand)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5" /> Barcode aliases
                    </h4>
                    <BarcodeEditor itemId={item.id} />
                  </div>
                </div>

                <div className="mb-5">
                  <h4 className="text-xs uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> Movement history
                  </h4>
                  {movements.length === 0 ? (
                    <div className="text-sm text-white/30 py-4 text-center rounded-lg bg-white/[0.02] border border-white/5">No movements posted yet.</div>
                  ) : (
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                      {movements.map((m) => {
                        const delta = Number(m.delta);
                        return (
                          <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/5 text-xs">
                            <span className={`font-mono w-16 flex-shrink-0 ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {delta >= 0 ? "+" : ""}{qty(delta)}
                            </span>
                            <span className="text-white/60 flex-shrink-0">{m.locationCode}</span>
                            <span className="text-white/40 flex-1 truncate">{m.operatorName}{m.note ? ` · ${m.note}` : ""}</span>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] text-white/50 flex-shrink-0">
                              {MOVEMENT_TYPE_LABELS[m.movementType as keyof typeof MOVEMENT_TYPE_LABELS] ?? m.movementType}
                              {m.reasonCode ? ` · ${REASON_CODE_LABELS[m.reasonCode as keyof typeof REASON_CODE_LABELS] ?? m.reasonCode}` : ""}
                            </span>
                            <span className="text-white/30 flex-shrink-0">{fmtDateTime(m.createdAt)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-white/5">
                  <button
                    onClick={async () => {
                      if (await askConfirm(`Delete ${item.sku}? This can't be undone.`,
                        { title: "Delete this item?", confirmLabel: "Delete" })) remove.mutate();
                    }}
                    disabled={remove.isPending}
                    className="text-xs text-red-400/70 hover:text-red-400 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete item
                  </button>
                  <Button onClick={() => { setForm(formFromItem(item)); setEditing(true); }} className="bg-blue-600 hover:bg-blue-700">
                    Edit item
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface CatalogueRow {
  id: number;
  sku: string;
  name: string;
  shop: string;
  category: string;
  productId: number | null;
  productTitle: string;
  productDraft: boolean;
  productSort: number | null;
  colour: string | null;
  size: string | null;
  locationCode: string | null;
  onHand: number;
  active: boolean;
  productImage: string | null;
  colourImage: string | null;
}

/** The shop's own photo, drawn small. A missing or broken picture shows a
 *  plain tile rather than the browser's broken-image icon. */
function Thumb({ src, alt, size = 44 }: { src: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!src || failed) {
    return <div style={box} className="rounded-lg bg-white/[0.04] border border-white/5 flex-shrink-0 flex items-center justify-center"><Package className="w-4 h-4 text-white/20" /></div>;
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={box}
      className="rounded-lg bg-white border border-white/5 object-contain flex-shrink-0"
    />
  );
}

interface ProductGroup {
  key: string;
  image: string | null;
  title: string;
  draft: boolean;
  sort: number | null;
  items: CatalogueRow[];
  onHand: number;
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL"];
function sizeRank(size: string | null): [number, number, string] {
  const s = (size ?? "").trim().toUpperCase();
  // "6", "10 (140)" are kids' ages → numeric; "2XL" is a letter size, not 2.
  if (/^\d+(\.\d+)?(\s|\(|$)/.test(s)) return [0, parseFloat(s), s];
  const i = SIZE_ORDER.indexOf(s.replace(/^ADULT\s+|^YOUTH\s+/, ""));
  if (i >= 0) return [1, i, s];
  return [2, 0, s];
}
function compareRank(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/** Shop + category + search live in the URL, so Back and a shared link land on
 *  the same view (the "section owns its URL" rule). */
function readParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}
function writeParams(next: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

export default function WarehouseItems() {
  const [, setLocation] = useLocation();
  const [shop, setShopState] = useState<string>(() => readParam("shop"));
  const [cat, setCatState] = useState<string>(() => readParam("cat"));
  const [q, setQState] = useState<string>(() => readParam("q"));
  const [activeOnly, setActiveOnly] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detailId, setDetailId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const setShop = (v: string) => { setShopState(v); setCatState(""); setOpen(new Set()); writeParams({ shop: v, cat: "" }); };
  const setCat = (v: string) => { setCatState(v); writeParams({ cat: v }); };
  const setQ = (v: string) => { setQState(v); writeParams({ q: v }); };

  const { data: rows = [], isLoading, isError } = useQuery<CatalogueRow[]>({
    queryKey: ["/api/admin/warehouse/catalogue", activeOnly],
    queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/catalogue${activeOnly ? "?active=true" : ""}`)).json(),
  });
  const { data: locations = [] } = useQuery<WhLocation[]>({
    queryKey: ["/api/admin/warehouse/locations", "active"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/locations?active=true")).json(),
  });

  // Shops in house order, only those holding something.
  const shops = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.shop, (counts.get(r.shop) ?? 0) + 1);
    const ordered = [...SHOP_ORDER.filter((b) => counts.has(b)), ...Array.from(counts.keys()).filter((b) => !SHOP_ORDER.includes(b as BrandOwner)).sort()];
    return ordered.map((b) => ({
      key: b,
      label: SHOP_SHORT_LABELS[b as BrandOwner] ?? b,
      products: new Set(rows.filter((r) => r.shop === b).map((r) => r.productId ?? `i${r.id}`)).size,
    }));
  }, [rows]);

  const activeShop = shops.some((s) => s.key === shop) ? shop : (shops[0]?.key ?? "");
  const needle = q.trim().toLowerCase();

  // Every word must appear somewhere ("home shirt kids" finds "2026 Home Shirt (Kids)").
  const shopRows = useMemo(() => {
    const words = needle ? needle.split(/\s+/) : [];
    return rows.filter((r) => {
      if (r.shop !== activeShop) return false;
      if (!words.length) return true;
      const hay = `${r.productTitle} ${r.name} ${r.sku} ${r.colour ?? ""} ${r.size ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, activeShop, needle]);

  // Category → products → variants.
  const categories = useMemo(() => {
    const byCat = new Map<string, Map<string, ProductGroup>>();
    for (const r of shopRows) {
      const key = r.productId != null ? `p${r.productId}` : `i${r.id}`;
      let prods = byCat.get(r.category);
      if (!prods) { prods = new Map(); byCat.set(r.category, prods); }
      let g = prods.get(key);
      if (!g) { g = { key, image: r.productImage ?? r.colourImage, title: r.productTitle, draft: r.productDraft, sort: r.productSort, items: [], onHand: 0 }; prods.set(key, g); }
      g.items.push(r);
      g.onHand += r.onHand;
    }
    return Array.from(byCat.entries())
      .sort(([a], [b]) => compareRank(shopCategoryRank(activeShop, a), shopCategoryRank(activeShop, b)))
      .map(([name, prods]) => ({
        name,
        products: Array.from(prods.values())
          .map((g) => ({
            ...g,
            items: [...g.items].sort((x, y) =>
              (x.colour ?? "").localeCompare(y.colour ?? "") || compareRank(sizeRank(x.size), sizeRank(y.size)) || x.sku.localeCompare(y.sku)),
          }))
          .sort((x, y) => (x.sort ?? 1e9) - (y.sort ?? 1e9) || x.title.localeCompare(y.title)),
      }));
  }, [shopRows, activeShop]);

  const shownCats = categories.filter((c) => !cat || c.name === cat);
  const toggleOpen = (key: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const printSelected = () => setLocation(`/admin/warehouse/labels?kind=item&ids=${Array.from(selected).join(",")}`);

  const navButton = "px-3 py-2 rounded-lg text-xs text-white/70 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] flex items-center gap-1.5";

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Warehouse</h1>
          <p className="text-sm text-white/40 mt-0.5">Every shop's stock, in the same categories as its website.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setLocation("/admin/warehouse/scan")} className={navButton}>
            <ScanLine className="w-3.5 h-3.5" /> Scan station
          </button>
          <button onClick={() => setLocation("/admin/warehouse/stock-take")} className="px-3 py-2 rounded-lg text-xs text-white bg-emerald-600 hover:bg-emerald-700">
            Stock take
          </button>
          <button onClick={() => setLocation("/admin/warehouse/locations")} className={navButton}>Locations</button>
          <button onClick={() => setLocation("/admin/warehouse/assets")} className={navButton}>Assets</button>
          <button onClick={() => setLocation("/admin/warehouse/fields")} className={navButton}>Fields</button>
          <Button onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> New item
          </Button>
        </div>
      </div>

      {/* Shops */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Shops">
        {shops.map((s) => {
          const on = s.key === activeShop;
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={on}
              data-testid={`shop-tab-${s.key}`}
              onClick={() => setShop(s.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap border flex items-center gap-2 min-h-[44px] ${on ? "bg-blue-600 border-blue-600 text-white" : "bg-white/[0.02] border-white/10 text-white/70 hover:bg-white/[0.06]"}`}
            >
              {s.label}
              <span className={`text-[11px] font-semibold ${on ? "text-white" : "text-white/40"}`}>{s.products}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <Input placeholder="Search product, SKU, size..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-10 bg-white/[0.02] border-white/10 text-white" />
        </div>
        <label className="flex items-center gap-2 text-sm text-white/60 flex-shrink-0">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
        </label>
      </div>

      {/* Categories within the shop */}
      {categories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap" aria-label="Categories">
          {[{ name: "", count: categories.reduce((n, c) => n + c.products.length, 0) }, ...categories.map((c) => ({ name: c.name, count: c.products.length }))].map((c) => {
            const on = c.name === cat || (!c.name && !cat);
            return (
              <button
                key={c.name || "all"}
                data-testid={`cat-chip-${c.name || "all"}`}
                onClick={() => setCat(c.name)}
                className={`px-3 py-1.5 rounded-full text-xs border min-h-[32px] ${on ? "bg-white/10 border-white/30 text-white" : "bg-transparent border-white/10 text-white/60 hover:text-white"}`}
              >
                {c.name || "All"} <span className="text-white/40 ml-0.5">{c.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <span className="text-sm text-white/80">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="text-xs text-white/50 hover:text-white/80">Clear</button>
            <button onClick={printSelected} className="px-3 py-1.5 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Print labels
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-white/40 text-sm py-10 text-center flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading stock…</div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-red-400">Couldn't load the warehouse. Refresh to try again.</div>
      ) : shops.length === 0 ? (
        <div className="py-16 text-center text-sm text-white/30">No items in the warehouse yet.</div>
      ) : shownCats.length === 0 ? (
        <div className="py-16 text-center text-sm text-white/30">Nothing in {SHOP_SHORT_LABELS[activeShop as BrandOwner] ?? activeShop} matches “{q}”.</div>
      ) : (
        <div className="space-y-6">
          {shownCats.map((c) => (
            <section key={c.name} data-testid={`cat-section-${c.name}`}>
              <h2 className="text-xs uppercase tracking-wider text-white/40 mb-2">
                {c.name} <span className="text-white/25 normal-case tracking-normal ml-1">{c.products.length} product{c.products.length === 1 ? "" : "s"}</span>
              </h2>
              <div className="rounded-2xl border border-white/5 overflow-hidden">
                {c.products.map((g, gi) => {
                  const isOpen = open.has(g.key);
                  const single = g.items.length === 1 && !g.key.startsWith("p");
                  return (
                    <div key={g.key} className={gi > 0 ? "border-t border-white/5" : ""}>
                      <button
                        onClick={() => (single ? setDetailId(g.items[0].id) : toggleOpen(g.key))}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] min-h-[52px]"
                        aria-expanded={single ? undefined : isOpen}
                      >
                        {!single && (isOpen ? <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-white/40 flex-shrink-0" />)}
                        <Thumb src={g.image} alt={g.title} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white">
                            {g.title}
                            {g.draft && <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 align-middle">Not on the website</span>}
                          </div>
                          <div className="text-[11px] text-white/40">
                            {single ? g.items[0].sku : `${g.items.length} size${g.items.length === 1 ? "" : "s"}/colours`}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-mono text-white">{qty(g.onHand)}</div>
                          <div className="text-[10px] text-white/30">on hand</div>
                        </div>
                      </button>
                      {isOpen && !single && (
                        <div className="bg-white/[0.015] border-t border-white/5">
                          {g.items.map((it) => (
                            <div
                              key={it.id}
                              className="grid grid-cols-[auto_auto_1fr_auto_auto] gap-3 pl-11 pr-4 py-2 items-center border-t border-white/[0.03] first:border-t-0 hover:bg-white/[0.03] cursor-pointer"
                              onClick={() => setDetailId(it.id)}
                            >
                              <span onClick={(e) => e.stopPropagation()}>
                                <Checkbox checked={selected.has(it.id)} onCheckedChange={() => setSelected((prev) => toggleId(prev, it.id))} />
                              </span>
                              <Thumb src={it.colourImage ?? g.image} alt={it.name} size={32} />
                              <div className="min-w-0">
                                <div className="text-sm text-white/80 truncate">
                                  {[it.colour && !/^default$/i.test(it.colour) ? it.colour : null, it.size].filter(Boolean).join(" · ") || it.name}
                                  {!it.active && <span className="text-white/30"> · inactive</span>}
                                </div>
                                <div className="text-[11px] text-white/35 font-mono truncate">{it.sku}</div>
                              </div>
                              <span className="text-xs text-white/40 font-mono whitespace-nowrap">{it.locationCode ?? "—"}</span>
                              <span className="text-sm text-white font-mono w-10 text-right">{qty(it.onHand)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <CreateItemModal
        open={creating}
        onClose={() => { setCreating(false); queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] }); }}
        locations={locations}
      />
      {/* key={detailId} forces a fresh mount per item — without it, switching
          from viewing/editing item A straight to item B would carry over A's
          stale `editing`/`form` local state. */}
      <ItemDetailModal
        key={detailId ?? "none"}
        itemId={detailId}
        onClose={() => { setDetailId(null); queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] }); }}
        locations={locations}
        onPrintLabel={(id) => setLocation(`/admin/warehouse/labels?kind=item&ids=${id}`)}
      />
    </div>
  );
}
