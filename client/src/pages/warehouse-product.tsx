// Warehouse → Products → a product's page, and Add product (2026-11-04).
// Shopify's product page, copied: Title · Description · Media · Category ·
// (Price + Inventory for a one-variant product) · Variants (options as chips,
// a table grouped by colour or size, price and Available per location) ·
// Search engine listing; right rail Status · Publishing · Product
// organization. A dirty form raises the "Unsaved product · Discard · Save"
// bar across the top, exactly as Shopify does.
//
// It edits the SAME shop product the storefront sells (Daniel's decision, 4
// Nov). New products start as Draft. Quantities are the warehouse's and every
// change goes through the ledger as a stock take — the server decides that.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, ChevronDown, ChevronRight, ChevronUp, ExternalLink, ImagePlus, Loader2, Plus, Trash2, Tag, GripVertical, Globe,
} from "lucide-react";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { shopCategoryFor } from "@shared/warehouse";

interface Meta {
  shops: { key: string; name: string; storefront: string; types: string[] }[];
  locations: { id: number; label: string }[];
}
interface Variant {
  id: number; colourId: number; size: string; sku: string | null; active: boolean;
  priceCents: number | null; itemId: number | null; warehouseSku: string | null;
  stock: Record<string, number>;
}
interface Product {
  id: number; brand: string; shopName: string; storefrontUrl: string; slug: string;
  title: string; description: string | null; type: string; status: string;
  priceCents: number; compareAtCents: number | null; prevId: number | null; nextId: number | null;
  colours: { id: number; name: string; swatchHex: string | null; active: boolean }[];
  images: { id: number; colourId: number | null; url: string; alt: string | null }[];
  variants: Variant[];
}

const STATUS_LABEL: Record<string, string> = { active: "Active", draft: "Draft", archived: "Archived" };
const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  draft: "bg-sky-500/15 text-sky-400",
  archived: "bg-white/10 text-white/60",
};
const ALL_LOC = "all";

const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
function toCents(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN as unknown as number;
}
const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-white/[0.02] ${className}`}>{children}</div>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm text-white/80 mb-1.5">{children}</label>;
}
function MoneyField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">$</span>
      <Input inputMode="decimal" value={value} placeholder={placeholder ?? "0.00"} aria-label={label}
        onChange={(e) => onChange(e.target.value)} className="pl-7 bg-white/[0.02] border-white/10 text-white" />
    </div>
  );
}
function Thumb({ src, size = 40 }: { src: string | null; size?: number }) {
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size };
  if (!src || bad) return <div style={box} className="rounded-lg border border-dashed border-white/15 flex items-center justify-center flex-shrink-0"><ImagePlus className="w-4 h-4 text-blue-400" /></div>;
  return <img src={src} alt="" loading="lazy" onError={() => setBad(true)} style={box} className="rounded-lg border border-white/10 bg-white object-contain flex-shrink-0" />;
}

/** The contextual save bar Shopify raises over the top of the page. Portalled:
 *  a fixed bar inside a routed page's transformed ancestor is mis-positioned. */
function SaveBar({ label, onDiscard, onSave, saving, disabled }: { label: string; onDiscard: () => void; onSave: () => void; saving: boolean; disabled?: boolean }) {
  return createPortal(
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-xl bg-blue-600 text-white pl-4 pr-1.5 py-1.5 shadow-2xl" role="region" aria-label="Unsaved changes">
      <span className="text-sm text-white font-medium mr-2">{label}</span>
      <button onClick={onDiscard} className="px-3 py-1.5 rounded-lg text-sm bg-blue-500 hover:bg-blue-400 text-white">Discard</button>
      <button onClick={onSave} disabled={saving || disabled} className="px-3 py-1.5 rounded-lg text-sm bg-white text-blue-700 font-medium disabled:opacity-50">
        {saving ? "Saving…" : "Save"}
      </button>
    </div>,
    document.body,
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Existing product
// ═════════════════════════════════════════════════════════════════════════

function ProductView({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const key = ["/api/admin/warehouse/products", id];
  const { data: p, isLoading, isError } = useQuery<Product>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/products/${id}`)).json(),
  });
  const { data: meta } = useQuery<Meta>({
    queryKey: ["/api/admin/warehouse/product-meta"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/product-meta")).json(),
  });

  // Draft state — what the save bar compares against the loaded product.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [type, setType] = useState("");
  const [price, setPrice] = useState("");
  const [compareAt, setCompareAt] = useState("");
  const [variantPrices, setVariantPrices] = useState<Record<number, string>>({});
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const reset = (prod: Product) => {
    setTitle(prod.title);
    setDescription(prod.description ?? "");
    setStatus(prod.status);
    setType(prod.type);
    setPrice(dollars(prod.priceCents));
    setCompareAt(dollars(prod.compareAtCents));
    setVariantPrices(Object.fromEntries(prod.variants.map((v) => [v.id, dollars(v.priceCents)])));
    setLoadedAt(prod.id);
  };
  useEffect(() => { if (p && loadedAt !== p.id) reset(p); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const changedVariantPrices = useMemo(() => (p ? p.variants.filter((v) => (variantPrices[v.id] ?? "") !== dollars(v.priceCents)) : []), [p, variantPrices]);
  const dirty = !!p && loadedAt === p.id && (
    title !== p.title || description !== (p.description ?? "") || status !== p.status || type !== p.type ||
    price !== dollars(p.priceCents) || compareAt !== dollars(p.compareAtCents) || changedVariantPrices.length > 0
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const badMoney = [price, compareAt, ...changedVariantPrices.map((v) => variantPrices[v.id] ?? "")].some((s) => Number.isNaN(toCents(s) as number));

  const save = useMutation({
    mutationFn: async () => {
      if (!p) return;
      const body: Record<string, unknown> = {};
      if (title !== p.title) body.title = title;
      if (description !== (p.description ?? "")) body.description = description;
      if (status !== p.status) body.status = status;
      if (type !== p.type) body.type = type;
      if (price !== dollars(p.priceCents)) body.priceCents = toCents(price) ?? 0;
      if (compareAt !== dollars(p.compareAtCents)) body.compareAtCents = toCents(compareAt);
      if (changedVariantPrices.length) body.variantPrices = changedVariantPrices.map((v) => ({ variantId: v.id, priceCents: toCents(variantPrices[v.id] ?? "") }));
      await apiRequest("PATCH", `/api/admin/warehouse/products/${id}`, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
      setLoadedAt(null);
      toast({ title: "Product saved" });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const back = () => setLocation(`/admin/warehouse/products${p ? `?shop=${p.brand}` : ""}`);

  if (isLoading) return <div className="p-10 text-center text-sm text-white/40 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  if (isError || !p) return <div className="p-10 text-center text-sm text-red-400">Couldn't load this product.</div>;

  const shop = meta?.shops.find((s) => s.key === p.brand);
  const types = Array.from(new Set([...(shop?.types ?? []), p.type]));
  const singleVariant = p.variants.filter((v) => v.active).length === 1;
  const sv = singleVariant ? p.variants.find((v) => v.active)! : null;

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto pb-24">
      {dirty && <SaveBar label="Unsaved changes" onDiscard={() => reset(p)} onSave={() => save.mutate()} saving={save.isPending} disabled={badMoney} />}

      {/* Top bar: back · breadcrumb · View · prev/next */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={back} className="w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center hover:bg-white/[0.06]" aria-label="Back to products"><ArrowLeft className="w-4 h-4 text-white/70" /></button>
          <Tag className="w-4 h-4 text-white/40" />
          <button onClick={back} className="text-sm text-white/60 hover:text-white">Products</button>
          <span className="text-white/30">/</span>
          <span className="text-sm text-white truncate">{p.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <a href={p.storefrontUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg text-sm text-white/80 border border-white/10 hover:bg-white/[0.06] flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> View
          </a>
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            <button disabled={!p.prevId} onClick={() => p.prevId && setLocation(`/admin/warehouse/products/${p.prevId}`)} className="w-9 h-9 flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30" aria-label="Previous product"><ChevronUp className="w-4 h-4 text-white/70" /></button>
            <button disabled={!p.nextId} onClick={() => p.nextId && setLocation(`/admin/warehouse/products/${p.nextId}`)} className="w-9 h-9 flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30 border-l border-white/10" aria-label="Next product"><ChevronDown className="w-4 h-4 text-white/70" /></button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-white">{p.title}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-md ${STATUS_BADGE[p.status] ?? STATUS_BADGE.draft}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="space-y-5 min-w-0">
          <Card className="p-5 space-y-5">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-white/[0.02] border-white/10 text-white" />
            </div>
            <div>
              <Label>Description</Label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6}
                className="w-full rounded-lg bg-white/[0.02] border border-white/10 text-white text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            </div>
            <div>
              <Label>Media</Label>
              {p.images.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/15 py-10 text-center text-sm text-white/40">No photos yet.</div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {p.images.slice(0, 12).map((im, i) => (
                    <div key={im.id} className={`${i === 0 ? "col-span-2 row-span-2" : ""} rounded-xl border border-white/10 bg-white overflow-hidden aspect-square`}>
                      <img src={im.url} alt={im.alt ?? p.title} loading="lazy" className="w-full h-full object-contain" />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-white/30 mt-2">Adding and removing photos is still done in the {p.shopName} Store tab.</p>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-white/40 mt-1.5">Shows under <b className="text-white/60">{shopCategoryFor(p.brand, type, title)}</b> on the {p.shopName} shop and in the warehouse.</p>
            </div>
          </Card>

          {singleVariant && sv && (
            <>
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-white mb-3">Price</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>Price</Label><MoneyField value={price} onChange={setPrice} label="Price" /></div>
                  <div><Label>Compare-at price</Label><MoneyField value={compareAt} onChange={setCompareAt} label="Compare-at price" /></div>
                </div>
              </Card>
              <InventoryCard productId={id} variant={sv} locations={meta?.locations ?? []} />
            </>
          )}

          <VariantsCard
            product={p}
            locations={meta?.locations ?? []}
            basePrice={price}
            onBasePrice={setPrice}
            variantPrices={variantPrices}
            setVariantPrice={(vid, v) => setVariantPrices((prev) => ({ ...prev, [vid]: v }))}
          />

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Search engine listing</h2>
            <div className="text-sm">
              <div className="text-white/80">{p.shopName}</div>
              <div className="text-xs text-white/40 truncate">{p.storefrontUrl.replace(/^https:\/\//, "").replace(/\//g, " › ")}</div>
              <div className="text-lg text-blue-400 mt-1">{title || p.title}</div>
              <div className="text-white/50 line-clamp-2">{description || "No description yet."}</div>
              <div className="text-white/50 mt-1">${dollars(toCents(price) ?? p.priceCents)} NZD</div>
            </div>
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <Card className="p-5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-white/40 mt-2">{status === "active" ? `Live on ${shop?.storefront.replace(/^https:\/\//, "") ?? "the shop"}.` : status === "draft" ? "Hidden from the shop until it's Active." : "Hidden and out of the way."}</p>
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Publishing</h2>
            <div className="flex items-center gap-2 text-sm text-white/70"><Globe className="w-4 h-4 text-white/40" /> {shop?.storefront.replace(/^https:\/\//, "") ?? p.shopName}</div>
          </Card>
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">Product organization</h2>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vendor</Label>
              <div className="text-sm text-white/80 rounded-lg border border-white/10 px-3 py-2">{p.shopName}</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** One-variant product: quantity at every location, edited in place (Shopify's Inventory card). */
function InventoryCard({ productId, variant, locations }: { productId: number; variant: Variant; locations: Meta["locations"] }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Inventory</h2>
        <span className="text-xs text-white/40">Inventory tracked</span>
      </div>
      <div className="rounded-xl border border-white/10 divide-y divide-white/5">
        <div className="flex items-center justify-between px-4 py-2 text-xs text-white/40"><span>Location</span><span>Quantity</span></div>
        {locations.map((l) => (
          <div key={l.id} className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-white/80">{l.label}</span>
            <QtyCell productId={productId} itemId={variant.itemId} locationId={l.id} value={variant.stock[String(l.id)] ?? 0} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 flex-wrap text-xs">
        <span className="px-2.5 py-1 rounded-md bg-white/[0.04] text-white/60">SKU {variant.sku || "—"}</span>
        <span className="px-2.5 py-1 rounded-md bg-white/[0.04] text-white/60">Warehouse {variant.warehouseSku || "—"}</span>
      </div>
    </Card>
  );
}

/** Editable quantity at ONE location. Saved on blur/Enter as a stock take. */
function QtyCell({ productId, itemId, locationId, value }: { productId: number; itemId: number | null; locationId: number; value: number }) {
  const { toast } = useToast();
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const save = useMutation({
    mutationFn: async (onHand: number) => (await apiRequest("POST", `/api/admin/warehouse/products/${productId}/stock`, { itemId, locationId, onHand })).json(),
    onSuccess: (r: { changed: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/products", productId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
      if (r.changed) toast({ title: "Quantity updated", description: "Recorded as a stock take." });
    },
    onError: (e: Error) => { setV(String(value)); toast({ title: "Quantity not changed", description: e.message, variant: "destructive" }); },
  });
  const commit = () => {
    if (v === String(value)) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) { setV(String(value)); return; }
    save.mutate(n);
  };
  if (!itemId) return <span className="text-sm text-white/30">—</span>;
  return (
    <Input value={v} inputMode="numeric" onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-24 text-right bg-white/[0.02] border-white/10 text-white" aria-label="Quantity" />
  );
}

function VariantsCard({
  product: p, locations, basePrice, onBasePrice, variantPrices, setVariantPrice,
}: {
  product: Product; locations: Meta["locations"]; basePrice: string; onBasePrice: (v: string) => void;
  variantPrices: Record<number, string>; setVariantPrice: (id: number, v: string) => void;
}) {
  const { toast } = useToast();
  const [groupBy, setGroupBy] = useState<"colour" | "size">("colour");
  const [loc, setLoc] = useState<string>(ALL_LOC);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newColour, setNewColour] = useState("");
  const [newSize, setNewSize] = useState("");

  const active = p.variants.filter((v) => v.active);
  const colourName = (id: number) => p.colours.find((c) => c.id === id)?.name ?? "—";
  const imageFor = (v: Variant) => p.images.find((im) => im.colourId === v.colourId)?.url ?? p.images[0]?.url ?? null;
  const sizes = Array.from(new Set(active.map((v) => v.size)));
  const colours = Array.from(new Set(active.map((v) => colourName(v.colourId))));
  const avail = (v: Variant) => (loc === ALL_LOC ? Object.values(v.stock).reduce((a, b) => a + b, 0) : v.stock[loc] ?? 0);
  const total = active.reduce((n, v) => n + Object.values(v.stock).reduce((a, b) => a + b, 0), 0);

  const groups = useMemo(() => {
    const m = new Map<string, Variant[]>();
    for (const v of active) {
      const k = groupBy === "colour" ? colourName(v.colourId) : v.size;
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return Array.from(m.entries());
  }, [p, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/warehouse/products/${p.id}/variants`, { colour: newColour, size: newSize })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/products", p.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
      toast({ title: `${newColour || "Default"} / ${newSize || "One size"} added` });
      setNewSize(""); setAdding(false);
    },
    onError: (e: Error) => toast({ title: "Variant not added", description: e.message, variant: "destructive" }),
  });

  const priceShown = (v: Variant) => variantPrices[v.id] ?? "";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-white">Variants</h2>
        <button onClick={() => setAdding((a) => !a)} className="px-3 py-1.5 rounded-lg text-sm text-white/80 bg-white/[0.04] hover:bg-white/[0.08] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add variant</button>
      </div>
      <Card>
        {/* Options, as chips */}
        <div className="m-3 rounded-xl border border-white/10 divide-y divide-white/5">
          {[{ name: "Color", values: colours }, { name: "Size", values: sizes }].filter((o) => o.values.length && !(o.values.length === 1 && /^(default|one size)$/i.test(o.values[0]))).map((o) => (
            <div key={o.name} className="flex items-start gap-3 px-4 py-3">
              <GripVertical className="w-4 h-4 text-white/20 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-white">{o.name}</div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">{o.values.map((val) => <span key={val} className="text-xs px-2 py-1 rounded-md bg-white/[0.06] text-white/80">{val}</span>)}</div>
              </div>
            </div>
          ))}
          {adding && (
            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div><Label>Color</Label><Input value={newColour} onChange={(e) => setNewColour(e.target.value)} placeholder={colours[0] ?? "Blue"} className="bg-white/[0.02] border-white/10 text-white" /></div>
              <div><Label>Size</Label><Input value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="e.g. 4XL" className="bg-white/[0.02] border-white/10 text-white" /></div>
              <Button onClick={() => add.mutate()} disabled={add.isPending || !newSize.trim()} className="bg-blue-600 hover:bg-blue-700">{add.isPending ? "Adding…" : "Done"}</Button>
            </div>
          )}
        </div>

        {/* Group by · location */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-white/60">
            Group by
            <Select value={groupBy} onValueChange={(v) => { setGroupBy(v as "colour" | "size"); setOpen(new Set()); }}>
              <SelectTrigger className="h-8 w-28 bg-white/[0.04] border-white/10 text-white text-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="colour">Color</SelectItem><SelectItem value="size">Size</SelectItem></SelectContent>
            </Select>
          </div>
          <Select value={loc} onValueChange={setLoc}>
            <SelectTrigger className="h-8 w-56 bg-white/[0.04] border-white/10 text-white text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_LOC}>All locations</SelectItem>
              {locations.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="border-t border-white/5">
          <div className="grid grid-cols-[minmax(0,1fr)_140px_100px_32px] gap-3 px-4 py-2 text-xs text-white/40 bg-white/[0.02]">
            <span>Variant</span><span>Price</span><span className="text-right">Available</span><span />
          </div>
          {groups.map(([name, vs]) => {
            const isOpen = open.has(name);
            const groupAvail = vs.reduce((n, v) => n + avail(v), 0);
            const prices = Array.from(new Set(vs.map((v) => priceShown(v) || basePrice)));
            return (
              <div key={name} className="border-t border-white/5">
                <div className="grid grid-cols-[minmax(0,1fr)_140px_100px_32px] gap-3 px-4 py-3 items-center">
                  <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; })} className="flex items-center gap-3 text-left min-w-0">
                    <Thumb src={imageFor(vs[0])} />
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{name}</div>
                      <div className="text-xs text-white/40">{vs.length} variant{vs.length === 1 ? "" : "s"}</div>
                    </div>
                  </button>
                  <MoneyField
                    value={prices.length === 1 ? prices[0] : ""}
                    placeholder={prices.length === 1 ? undefined : "Varies"}
                    label={`Price for all ${name}`}
                    onChange={(val) => vs.forEach((v) => setVariantPrice(v.id, val))}
                  />
                  <span className="text-sm text-white text-right font-mono">{groupAvail}</span>
                  <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; })} className="text-white/40" aria-label={isOpen ? "Collapse" : "Expand"}>
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
                {isOpen && vs.map((v) => (
                  <div key={v.id} className="grid grid-cols-[minmax(0,1fr)_140px_100px_32px] gap-3 pl-16 pr-4 py-2 items-center border-t border-white/[0.03] bg-white/[0.01]">
                    <div className="min-w-0">
                      <div className="text-sm text-white/80">{groupBy === "colour" ? v.size : colourName(v.colourId)}</div>
                      <div className="text-[11px] text-white/35 font-mono truncate">{v.warehouseSku ?? v.sku ?? ""}</div>
                    </div>
                    <MoneyField value={priceShown(v)} placeholder={basePrice || "0.00"} label={`Price for ${v.size}`} onChange={(val) => setVariantPrice(v.id, val)} />
                    <div className="flex justify-end">
                      {loc === ALL_LOC
                        ? <span className="text-sm text-white font-mono">{avail(v)}</span>
                        : <QtyCell productId={p.id} itemId={v.itemId} locationId={Number(loc)} value={avail(v)} />}
                    </div>
                    <span />
                  </div>
                ))}
              </div>
            );
          })}
          <div className="border-t border-white/5 px-4 py-3 text-sm text-white/60">
            Total inventory across all locations: {total} available
            {loc === ALL_LOC && <span className="text-white/35"> · choose a location to change quantities</span>}
          </div>
        </div>
        {!(active.length === 1) && (
          <div className="border-t border-white/5 px-4 py-3 flex items-center gap-3">
            <span className="text-sm text-white/60">Price for any variant left blank</span>
            <div className="w-40"><MoneyField value={basePrice} onChange={onBasePrice} label="Base price" /></div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Add product
// ═════════════════════════════════════════════════════════════════════════

type OptionKind = "Color" | "Size";
interface OptionDraft { kind: OptionKind; values: string[]; done: boolean }

function NewProductView() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const startShop = new URLSearchParams(window.location.search).get("shop") ?? "";
  const { data: meta } = useQuery<Meta>({
    queryKey: ["/api/admin/warehouse/product-meta"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/product-meta")).json(),
  });

  const [brand, setBrand] = useState(startShop);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [type, setType] = useState("");
  const [price, setPrice] = useState("");
  const [compareAt, setCompareAt] = useState("");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [vqLoc, setVqLoc] = useState<string>("");
  const [vq, setVq] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState(false);

  const shop = meta?.shops.find((s) => s.key === brand);
  const types = shop?.types.length ? shop.types : ["apparel", "accessory"];
  useEffect(() => { if (meta && !vqLoc && meta.locations[0]) setVqLoc(String(meta.locations[0].id)); }, [meta, vqLoc]);
  // Like Shopify, the category starts unchosen; a vendor change clears one the new shop doesn't sell.
  useEffect(() => { if (shop && type && !types.includes(type)) setType(""); }, [brand, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const colours = options.find((o) => o.kind === "Color")?.values.filter((v) => v.trim()) ?? [];
  const sizes = options.find((o) => o.kind === "Size")?.values.filter((v) => v.trim()) ?? [];
  const hasVariants = colours.length > 0 || sizes.length > 0;
  const combos = hasVariants
    ? (colours.length ? colours : ["Default"]).flatMap((c) => (sizes.length ? sizes : ["One size"]).map((s) => ({ c, s, key: `${c}|${s}` })))
    : [];
  const dirty = !!(title || description || price || options.length || Object.values(qty).some(Boolean));
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const create = useMutation({
    mutationFn: async () => {
      const variantQuantities: Record<string, Record<string, number>> = {};
      for (const [k, v] of Object.entries(vq)) {
        const [combo, locId] = k.split("@");
        if (!v) continue;
        (variantQuantities[combo] ??= {})[locId] = Number(v);
      }
      const res = await workspaceFetch("/api/admin/warehouse/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand, title, description, status, type,
          priceCents: toCents(price) ?? 0, compareAtCents: toCents(compareAt),
          colours, sizes, sku,
          quantities: Object.fromEntries(Object.entries(qty).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])),
          variantQuantities,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Couldn't create the product");
      return body as { id: number; warning?: string };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
      toast(r.warning ? { title: "Product created", description: r.warning, variant: "destructive" } : { title: "Product created", description: status === "draft" ? "Saved as Draft — set it Active when it's ready to sell." : undefined });
      setLocation(`/admin/warehouse/products/${r.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't create the product", description: e.message, variant: "destructive" }),
  });

  const badMoney = [price, compareAt].some((s) => Number.isNaN(toCents(s) as number));
  const canSave = !!brand && !!title.trim() && !!type && !badMoney && options.every((o) => o.done || o.values.some((v) => v.trim()));
  const back = () => setLocation(`/admin/warehouse/products${brand ? `?shop=${brand}` : ""}`);
  const setOpt = (i: number, next: Partial<OptionDraft>) => setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, ...next } : o)));
  const remaining: OptionKind[] = (["Color", "Size"] as OptionKind[]).filter((k) => !options.some((o) => o.kind === k));

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto pb-24">
      {dirty && <SaveBar label="Unsaved product" onDiscard={back} onSave={() => create.mutate()} saving={create.isPending} disabled={!canSave} />}

      <div className="flex items-center gap-2 mb-4">
        <button onClick={back} className="w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center hover:bg-white/[0.06]" aria-label="Back to products"><ArrowLeft className="w-4 h-4 text-white/70" /></button>
        <Tag className="w-4 h-4 text-white/40" />
        <button onClick={back} className="text-sm text-white/60 hover:text-white">Products</button>
        <span className="text-white/30">/</span>
        <span className="text-sm text-white">Add product</span>
      </div>
      <h1 className="text-2xl font-bold text-white mb-5">Add product</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="space-y-5 min-w-0">
          <Card className="p-5 space-y-5">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short sleeve t-shirt" className="bg-white/[0.02] border-white/10 text-white" />
            </div>
            <div>
              <Label>Description</Label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6}
                className="w-full rounded-lg bg-white/[0.02] border border-white/10 text-white text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            </div>
            <div>
              <Label>Media</Label>
              <div className="rounded-xl border border-dashed border-white/15 py-8 text-center">
                <p className="text-sm text-white/50">Add photos after saving, in the shop's Store tab.</p>
                <p className="text-xs text-white/30 mt-1">Uploading straight from here is the next stage.</p>
              </div>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={type} onValueChange={setType} disabled={!brand}>
                <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue placeholder={brand ? "Choose a product category" : "Choose a Vendor first"} /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
              {brand && type && <p className="text-xs text-white/40 mt-1.5">Shows under <b className="text-white/60">{shopCategoryFor(brand, type, title)}</b> on the {shop?.name} shop.</p>}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Price</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Price</Label><MoneyField value={price} onChange={setPrice} label="Price" /></div>
              <div><Label>Compare-at price</Label><MoneyField value={compareAt} onChange={setCompareAt} label="Compare-at price" /></div>
            </div>
            {hasVariants && <p className="text-xs text-white/40 mt-2">Every variant starts at this price; change one on the product page after saving.</p>}
          </Card>

          {!hasVariants && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Inventory</h2>
                <span className="text-xs text-white/40">Inventory tracked</span>
              </div>
              <div className="rounded-xl border border-white/10 divide-y divide-white/5">
                <div className="flex items-center justify-between px-4 py-2 text-xs text-white/40"><span>Location</span><span>Quantity</span></div>
                {(meta?.locations ?? []).map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-4 py-2">
                    <span className="text-sm text-white/80">{l.label}</span>
                    <Input value={qty[l.id] ?? ""} placeholder="0" inputMode="numeric" onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value.replace(/[^\d]/g, "") }))} className="w-24 text-right bg-white/[0.02] border-white/10 text-white" aria-label={`Quantity at ${l.label}`} />
                  </div>
                ))}
              </div>
              <div className="mt-3 max-w-xs"><Label>SKU (stock keeping unit)</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} className="bg-white/[0.02] border-white/10 text-white font-mono" /></div>
            </Card>
          )}

          {/* Variants — Shopify's option editor */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-2">Variants</h2>
            <Card>
              {options.length === 0 ? (
                <div className="relative">
                  <button onClick={() => setMenu((m) => !m)} className="w-full flex items-center gap-2 px-5 py-4 text-sm text-white hover:bg-white/[0.03] rounded-2xl">
                    <Plus className="w-4 h-4" /> Add options like size or color
                  </button>
                  {menu && <OptionMenu kinds={remaining} onPick={(k) => { setOptions([{ kind: k, values: [], done: false }]); setMenu(false); }} />}
                </div>
              ) : (
                <div className="m-3 rounded-xl border border-white/10 divide-y divide-white/5">
                  {options.map((o, i) => o.done ? (
                    <button key={o.kind} onClick={() => setOpt(i, { done: false })} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.02]">
                      <GripVertical className="w-4 h-4 text-white/20 mt-0.5" />
                      <div>
                        <div className="text-sm font-medium text-white">{o.kind}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">{o.values.filter((v) => v.trim()).map((v) => <span key={v} className="text-xs px-2 py-1 rounded-md bg-white/[0.06] text-white/80">{v}</span>)}</div>
                      </div>
                    </button>
                  ) : (
                    <div key={o.kind} className="px-4 py-3 space-y-2">
                      <Label>Option name</Label>
                      <div className="text-sm text-white rounded-lg border border-white/10 px-3 py-2">{o.kind}</div>
                      <Label>Option values</Label>
                      {o.values.map((val, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-white/20" />
                          <Input
                            value={val}
                            autoFocus={j === o.values.length - 1 && val.length <= 1}
                            onChange={(e) => setOpt(i, { values: o.values.map((x, k) => (k === j ? e.target.value : x)) })}
                            className="bg-white/[0.02] border-white/10 text-white"
                          />
                          <button tabIndex={-1} onClick={() => setOpt(i, { values: o.values.filter((_, k) => k !== j) })} className="w-9 h-9 flex items-center justify-center text-white/40 hover:text-red-400" aria-label={`Remove ${val || "value"}`}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <span className="w-4" />
                        <Input
                          value=""
                          placeholder={o.values.length === 0 ? (o.kind === "Size" ? "Medium" : "Blue") : "Add another value"}
                          onChange={(e) => e.target.value && setOpt(i, { values: [...o.values, e.target.value] })}
                          className="bg-white/[0.02] border-white/10 text-white"
                          aria-label={`Add a ${o.kind} value`}
                        />
                        <span className="w-9" />
                      </div>
                      <div className="flex justify-between pt-1">
                        <button onClick={() => setOptions((prev) => prev.filter((_, k) => k !== i))} className="px-3 py-1.5 rounded-lg text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20">Delete</button>
                        <button onClick={() => setOpt(i, { done: true })} disabled={!o.values.some((v) => v.trim())} className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white disabled:opacity-40">Done</button>
                      </div>
                    </div>
                  ))}
                  {remaining.length > 0 && (
                    <div className="relative">
                      <button onClick={() => setMenu((m) => !m)} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-white hover:bg-white/[0.03]"><Plus className="w-4 h-4" /> Add another option</button>
                      {menu && <OptionMenu kinds={remaining} onPick={(k) => { setOptions((prev) => [...prev, { kind: k, values: [], done: false }]); setMenu(false); }} />}
                    </div>
                  )}
                </div>
              )}

              {combos.length > 0 && (
                <div className="border-t border-white/5">
                  <div className="flex items-center justify-end px-4 py-2">
                    <Select value={vqLoc} onValueChange={setVqLoc}>
                      <SelectTrigger className="h-8 w-56 bg-white/[0.04] border-white/10 text-white text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{(meta?.locations ?? []).map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px_100px] gap-3 px-4 py-2 text-xs text-white/40 bg-white/[0.02]"><span>Variant</span><span>Price</span><span className="text-right">Available</span></div>
                  {combos.map((cb) => (
                    <div key={cb.key} className="grid grid-cols-[minmax(0,1fr)_120px_100px] gap-3 px-4 py-2 items-center border-t border-white/5">
                      <div className="flex items-center gap-3 min-w-0"><Thumb src={null} size={36} /><span className="text-sm text-white truncate">{[colours.length ? cb.c : null, sizes.length ? cb.s : null].filter(Boolean).join(" / ")}</span></div>
                      <span className="text-sm text-white/60">${price || "0.00"}</span>
                      <Input value={vq[`${cb.key}@${vqLoc}`] ?? ""} placeholder="0" inputMode="numeric" onChange={(e) => setVq((q) => ({ ...q, [`${cb.key}@${vqLoc}`]: e.target.value.replace(/[^\d]/g, "") }))} className="text-right bg-white/[0.02] border-white/10 text-white" aria-label={`Quantity of ${cb.key}`} />
                    </div>
                  ))}
                  <div className="border-t border-white/5 px-4 py-3 text-sm text-white/60">
                    {combos.length} variants · {Object.values(vq).reduce((n, v) => n + (Number(v) || 0), 0)} units entered across all locations
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-white/40 mt-2">{status === "active" ? "Goes live on the shop the moment you save." : "Saved hidden from the shop until you set it Active."}</p>
          </Card>
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">Product organization</h2>
            <div>
              <Label>Vendor</Label>
              <Select value={brand} onValueChange={setBrand}>
                <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue placeholder="Which shop sells it" /></SelectTrigger>
                <SelectContent>{(meta?.shops ?? []).map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType} disabled={!brand}>
                <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </Card>
          {!canSave && dirty && (
            <p className="text-xs text-white/40 px-1">{!brand ? "Choose a Vendor (which shop sells it) to save." : !title.trim() ? "Give it a title to save." : !type ? "Choose a category to save." : badMoney ? "Check the price — numbers only." : "Finish the option you're editing (press Done)."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function OptionMenu({ kinds, onPick }: { kinds: OptionKind[]; onPick: (k: OptionKind) => void }) {
  return (
    <div className="absolute left-4 top-full mt-1 z-20 w-56 rounded-xl border border-white/10 bg-[#0b1220] shadow-xl p-1">
      {kinds.map((k) => (
        <button key={k} onClick={() => onPick(k)} className="w-full text-left px-3 py-2 rounded-lg text-sm text-white hover:bg-white/[0.06]">{k}</button>
      ))}
    </div>
  );
}

export default function WarehouseProduct() {
  const [isNew] = useRoute("/admin/warehouse/products/new");
  const [, params] = useRoute<{ id: string }>("/admin/warehouse/products/:id");
  if (isNew) return <NewProductView />;
  const id = params && /^\d+$/.test(params.id) ? Number(params.id) : null;
  if (id === null) return <div className="p-10 text-center text-sm text-white/40">Product not found.</div>;
  return <ProductView key={id} id={id} />;
}
