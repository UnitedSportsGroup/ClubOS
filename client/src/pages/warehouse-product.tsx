// Warehouse → Products → a product's page, each variant's own page, and Add
// product (2026-11-04). Shopify's pages, copied: Title · Description (rich
// text) · Media (upload, reorder, remove) · Category · Price (compare-at, unit
// price, charge tax, cost/profit/margin) · Inventory (tracked, per location,
// SKU, barcode, sell when out of stock) · Shipping (physical, size, weight,
// country of origin, HS code) · Variants · Search engine listing; right rail
// Status · Publishing · Product organization (type, vendor, collections, tags).
//
// It edits the SAME shop product the storefront sells (Daniel, 4 Nov). New
// products start as Draft. Quantities are the warehouse's; every change goes
// through the ledger as a stock take — the server decides that.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, Plus, Trash2, Tag, GripVertical, Globe, ArrowLeft } from "lucide-react";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { shopCategoryFor } from "@shared/warehouse";
import {
  type Meta, type Product, type Variant, type VariantDraft,
  Card, Label, MoneyField, Thumb, SaveBar, useLeaveGuard, RichText, plainToHtml, TagsInput, CollectionsPicker, MediaManager,
  PriceCard, InventoryCard, ShippingCard, SeoCard, QtyCell,
  dollars, toCents, isBadMoney, titleCase, draftFromVariant, variantPatch, draftsDiffer, draftError,
} from "@/components/warehouse-product/parts";

const STATUS_LABEL: Record<string, string> = { active: "Active", draft: "Draft", archived: "Archived" };
const STATUS_BADGE: Record<string, string> = { active: "bg-emerald-500/15 text-emerald-400", draft: "bg-sky-500/15 text-sky-400", archived: "bg-white/10 text-white/60" };
const ALL_LOC = "all";

function useMeta() {
  return useQuery<Meta>({ queryKey: ["/api/admin/warehouse/product-meta"], queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/product-meta")).json() });
}
function useProduct(id: number) {
  return useQuery<Product>({ queryKey: ["/api/admin/warehouse/products", id], queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/products/${id}`)).json() });
}
function useCollections(shop: string) {
  return useQuery<{ id: number; title: string }[]>({
    queryKey: ["/api/admin/warehouse/collections", shop], enabled: !!shop,
    queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/collections?shop=${shop}`)).json(),
  });
}
const invalidateAll = (id?: number) => {
  if (id) queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/products", id] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
};

function TopBar({ crumb, onBack, right }: { crumb: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onBack} className="w-9 h-9 rounded-lg border border-white/10 flex items-center justify-center hover:bg-white/[0.06]" aria-label="Back"><ArrowLeft className="w-4 h-4 text-white/70" /></button>
        <Tag className="w-4 h-4 text-white/40" />
        <button onClick={onBack} className="text-sm text-white/60 hover:text-white">Products</button>
        <span className="text-white/30">/</span>
        <span className="text-sm text-white truncate">{crumb}</span>
      </div>
      {right}
    </div>
  );
}

function StatusCard({ status, setStatus, storefront, allowArchive = true }: { status: string; setStatus: (s: string) => void; storefront?: string; allowArchive?: boolean }) {
  const host = storefront?.replace(/^https:\/\//, "");
  return (
    <Card className="p-5">
      <Label>Status</Label>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          {allowArchive && <SelectItem value="archived">Archived</SelectItem>}
        </SelectContent>
      </Select>
      <p className="text-xs text-white/40 mt-2">
        {status === "active" ? `Published — live on ${host ?? "the shop"}.` : status === "draft" ? "Draft — kept in the warehouse, hidden from the shop until it's Active." : "Archived — hidden from the shop and out of the way. Nothing is deleted."}
      </p>
    </Card>
  );
}

function OrganizationCard({ shopName, brand, types, type, setType, collections, collectionIds, setCollections, tags, setTags, vendorPicker }: {
  shopName?: string; brand: string; types: string[]; type: string; setType: (t: string) => void;
  collections: { id: number; title: string }[]; collectionIds: number[]; setCollections: (ids: number[]) => void;
  tags: string[]; setTags: (t: string[]) => void; vendorPicker?: React.ReactNode;
}) {
  return (
    <Card className="p-5 space-y-4">
      <h2 className="text-sm font-semibold text-white">Product organization</h2>
      <div>
        <Label>Type</Label>
        <Select value={type} onValueChange={setType} disabled={!brand}>
          <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Vendor</Label>{vendorPicker ?? <div className="text-sm text-white/80 rounded-lg border border-white/10 px-3 py-2">{shopName}</div>}</div>
      <div>
        <Label>Collections</Label>
        {brand ? <CollectionsPicker shop={brand} all={collections} selected={collectionIds} onChange={setCollections} /> : <p className="text-xs text-white/40">Choose a vendor first.</p>}
      </div>
      <div><Label>Tags</Label><TagsInput value={tags} onChange={setTags} /></div>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Existing product
// ═════════════════════════════════════════════════════════════════════════

interface ProductDraft {
  title: string; html: string; status: string; type: string; tags: string[]; collectionIds: number[];
  seoTitle: string; seoDescription: string; price: string; compareAt: string;
  variants: Record<number, VariantDraft>;
}
function productDraft(p: Product): ProductDraft {
  const single = p.variants.filter((v) => v.active).length === 1;
  return {
    title: p.title, html: p.descriptionHtml ?? plainToHtml(p.description), status: p.status, type: p.type,
    tags: p.tags, collectionIds: p.collections.filter((c) => c.assigned).map((c) => c.id),
    seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "",
    price: dollars(p.priceCents), compareAt: dollars(p.compareAtCents),
    variants: Object.fromEntries(p.variants.map((v) => {
      const d = draftFromVariant(v);
      // A one-variant product's price lives on the product (as Shopify shows it).
      return [v.id, single ? { ...d, price: dollars(v.priceCents ?? p.priceCents), compareAt: dollars(v.compareAtCents ?? p.compareAtCents) } : d];
    })),
  };
}

function ProductView({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: p, isLoading, isError } = useProduct(id);
  const { data: meta } = useMeta();
  const { data: colls = [] } = useCollections(p?.brand ?? "");
  const [d, setD] = useState<ProductDraft | null>(null);
  const [base, setBase] = useState<ProductDraft | null>(null);
  // A refetch (a photo uploaded, a quantity changed) must never wipe typing
  // that isn't saved yet: reload the form only when it's clean, or after a save.
  const forceReset = useRef(false);
  useEffect(() => {
    if (!p) return;
    const clean = !d || !base || JSON.stringify(d) === JSON.stringify(base);
    const fresh = productDraft(p);
    if (forceReset.current || clean) { setD(fresh); setBase(fresh); forceReset.current = false; }
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const single = !!p && p.variants.filter((v) => v.active).length === 1;
  const sv = single && p ? p.variants.find((v) => v.active)! : null;
  const dirty = !!d && !!base && JSON.stringify(d) !== JSON.stringify(base);
  useLeaveGuard(dirty);
  const err = d ? (isBadMoney(d.price) || isBadMoney(d.compareAt) ? "Check the prices — numbers only." : Object.values(d.variants).map(draftError).find(Boolean) ?? (!d.title.trim() ? "Title can't be blank." : null)) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!p || !d || !base) return;
      const body: Record<string, unknown> = {};
      if (d.title !== base.title) body.title = d.title;
      if (d.html !== base.html) body.descriptionHtml = d.html;
      if (d.status !== base.status) body.status = d.status;
      if (d.type !== base.type) body.type = d.type;
      if (JSON.stringify(d.tags) !== JSON.stringify(base.tags)) body.tags = d.tags;
      if (JSON.stringify(d.collectionIds) !== JSON.stringify(base.collectionIds)) body.collectionIds = d.collectionIds;
      if (d.seoTitle !== base.seoTitle) body.seoTitle = d.seoTitle;
      if (d.seoDescription !== base.seoDescription) body.seoDescription = d.seoDescription;
      if (!single && d.price !== base.price) body.priceCents = toCents(d.price) ?? 0;
      if (!single && d.compareAt !== base.compareAt) body.compareAtCents = toCents(d.compareAt);
      const variants: Record<string, unknown>[] = [];
      for (const v of p.variants) {
        const now = d.variants[v.id]; const was = base.variants[v.id];
        if (!now || !was) continue;
        if (single) {
          // The product carries a one-variant product's price and compare-at.
          if (now.price !== was.price) body.priceCents = toCents(now.price) ?? 0;
          if (now.compareAt !== was.compareAt) body.compareAtCents = toCents(now.compareAt);
          const patch = variantPatch(v.id, { ...now, price: was.price, compareAt: was.compareAt }, was);
          if (patch) variants.push(patch);
        } else {
          const patch = variantPatch(v.id, now, was);
          if (patch) variants.push(patch);
        }
      }
      if (variants.length) body.variants = variants;
      await apiRequest("PATCH", `/api/admin/warehouse/products/${id}`, body);
    },
    onSuccess: () => { forceReset.current = true; invalidateAll(id); toast({ title: "Product saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const back = () => setLocation(`/admin/warehouse/products${p ? `?shop=${p.brand}` : ""}`);
  if (isLoading || (p && !d)) return <div className="p-10 text-center text-sm text-white/40">Loading…</div>;
  if (isError || !p || !d || !base) return <div className="p-10 text-center text-sm text-red-400">Couldn't load this product.</div>;

  const shop = meta?.shops.find((s) => s.key === p.brand);
  const types = Array.from(new Set([...(shop?.types ?? []), p.type]));
  const set = (patch: Partial<ProductDraft>) => setD((x) => (x ? { ...x, ...patch } : x));
  const setVariant = (vid: number, patch: Partial<VariantDraft>) => setD((x) => (x ? { ...x, variants: { ...x.variants, [vid]: { ...x.variants[vid], ...patch } } } : x));
  const plain = d.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto pb-24">
      {dirty && <SaveBar label="Unsaved changes" hint={err} onDiscard={() => setD(base)} onSave={() => save.mutate()} saving={save.isPending} disabled={!!err} />}
      <TopBar crumb={p.title} onBack={back} right={
        <div className="flex items-center gap-2">
          <a href={p.storefrontUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg text-sm text-white/80 border border-white/10 hover:bg-white/[0.06] flex items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> View</a>
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            <button disabled={!p.prevId} onClick={() => p.prevId && setLocation(`/admin/warehouse/products/${p.prevId}`)} className="w-9 h-9 flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30" aria-label="Previous product"><ChevronUp className="w-4 h-4 text-white/70" /></button>
            <button disabled={!p.nextId} onClick={() => p.nextId && setLocation(`/admin/warehouse/products/${p.nextId}`)} className="w-9 h-9 flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30 border-l border-white/10" aria-label="Next product"><ChevronDown className="w-4 h-4 text-white/70" /></button>
          </div>
        </div>
      } />
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-white">{p.title}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-md ${STATUS_BADGE[p.status] ?? STATUS_BADGE.draft}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="space-y-5 min-w-0">
          <Card className="p-5 space-y-5">
            <div><Label>Title</Label><Input value={d.title} onChange={(e) => set({ title: e.target.value })} className="bg-white/[0.02] border-white/10 text-white" /></div>
            <div><Label>Description</Label><RichText value={d.html} onChange={(html) => set({ html })} /></div>
            <div><Label>Media</Label><MediaManager productId={p.id} images={p.images} colourId={p.colours[0]?.id ?? null} /></div>
            <div>
              <Label>Category</Label>
              <Select value={d.type} onValueChange={(v) => set({ type: v })}>
                <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-white/40 mt-1.5">Shows under <b className="text-white/60">{shopCategoryFor(p.brand, d.type, d.title)}</b> on the {p.shopName} shop and in the warehouse.</p>
            </div>
          </Card>

          {single && sv && d.variants[sv.id] && (
            <>
              <PriceCard d={d.variants[sv.id]} set={(x) => setVariant(sv.id, x)} />
              <InventoryCard d={d.variants[sv.id]} set={(x) => setVariant(sv.id, x)} locations={meta?.locations ?? []} warehouseSku={sv.warehouseSku} shopStock={sv.shopStock} warehouseDriven={p.warehouseDriven}
                qty={(loc) => <QtyCell productId={p.id} itemId={sv.itemId} locationId={loc} value={sv.stock[String(loc)] ?? 0} />} />
              <ShippingCard d={d.variants[sv.id]} set={(x) => setVariant(sv.id, x)} />
            </>
          )}

          <VariantsCard product={p} locations={meta?.locations ?? []} draft={d} setVariant={setVariant} setBasePrice={(price) => set({ price })} />

          <SeoCard shopName={p.shopName} url={p.storefrontUrl} title={d.title} description={plain} price={single && sv ? d.variants[sv.id]?.price ?? "" : d.price}
            seoTitle={d.seoTitle} seoDescription={d.seoDescription} onChange={(x) => set(x)} />
        </div>

        <div className="space-y-5">
          <StatusCard status={d.status} setStatus={(status) => set({ status })} storefront={shop?.storefront} />
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Publishing</h2>
            <div className="flex items-center gap-2 text-sm text-white/70"><Globe className="w-4 h-4 text-white/40" /> {shop?.storefront.replace(/^https:\/\//, "") ?? p.shopName}</div>
            <p className="text-xs text-white/40 mt-2">{p.warehouseDriven ? "Stock on the shop comes from the warehouse." : "This shop still keeps its own stock count."}</p>
          </Card>
          <OrganizationCard shopName={p.shopName} brand={p.brand} types={types} type={d.type} setType={(type) => set({ type })}
            collections={colls} collectionIds={d.collectionIds} setCollections={(collectionIds) => set({ collectionIds })}
            tags={d.tags} setTags={(tags) => set({ tags })} />
        </div>
      </div>
    </div>
  );
}

function VariantsCard({ product: p, locations, draft, setVariant, setBasePrice }: {
  product: Product; locations: Meta["locations"]; draft: ProductDraft;
  setVariant: (id: number, patch: Partial<VariantDraft>) => void; setBasePrice: (v: string) => void;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [groupBy, setGroupBy] = useState<"colour" | "size">("colour");
  const [loc, setLoc] = useState<string>(ALL_LOC);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newColour, setNewColour] = useState("");
  const [newSize, setNewSize] = useState("");
  const active = p.variants.filter((v) => v.active);
  const colourName = (cid: number) => p.colours.find((c) => c.id === cid)?.name ?? "—";
  const imageFor = (v: Variant) => p.images.find((im) => im.colourId === v.colourId)?.url ?? p.images[0]?.url ?? null;
  const sizes = Array.from(new Set(active.map((v) => v.size)));
  const colours = Array.from(new Set(active.map((v) => colourName(v.colourId))));
  const avail = (v: Variant) => (loc === ALL_LOC ? Object.values(v.stock).reduce((a, b) => a + b, 0) : v.stock[loc] ?? 0);
  const total = active.reduce((n, v) => n + Object.values(v.stock).reduce((a, b) => a + b, 0), 0);
  const single = active.length === 1;
  const groups = useMemo(() => {
    const m = new Map<string, Variant[]>();
    for (const v of active) { const k = groupBy === "colour" ? colourName(v.colourId) : v.size; m.set(k, [...(m.get(k) ?? []), v]); }
    return Array.from(m.entries());
  }, [p, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/warehouse/products/${p.id}/variants`, { colour: newColour || colours[0] || "Default", size: newSize })).json(),
    onSuccess: () => { invalidateAll(p.id); toast({ title: `${newColour || colours[0] || "Default"} / ${newSize} added` }); setNewSize(""); setAdding(false); },
    onError: (e: Error) => toast({ title: "Variant not added", description: e.message, variant: "destructive" }),
  });
  const price = (v: Variant) => draft.variants[v.id]?.price ?? "";
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const optionRows = [{ name: "Color", values: colours }, { name: "Size", values: sizes }].filter((o) => o.values.length && !(o.values.length === 1 && /^(default|one size)$/i.test(o.values[0])));
  const goVariant = (vid: number) => setLocation(`/admin/warehouse/products/${p.id}/variants/${vid}`);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-white">Variants</h2>
        <button onClick={() => setAdding((a) => !a)} className="px-3 py-1.5 rounded-lg text-sm text-white/80 bg-white/[0.04] hover:bg-white/[0.08] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add variant</button>
      </div>
      <Card>
        {(optionRows.length > 0 || adding) && (
          <div className="m-3 rounded-xl border border-white/10 divide-y divide-white/5">
            {optionRows.map((o) => (
              <div key={o.name} className="flex items-start gap-3 px-4 py-3">
                <GripVertical className="w-4 h-4 text-white/20 mt-0.5" />
                <div><div className="text-sm font-medium text-white">{o.name}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">{o.values.map((val) => <span key={val} className="text-xs px-2 py-1 rounded-md bg-white/[0.06] text-white/80">{val}</span>)}</div></div>
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
        )}
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
            <SelectContent><SelectItem value={ALL_LOC}>All locations</SelectItem>{locations.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="border-t border-white/5">
          <div className="grid grid-cols-[minmax(0,1fr)_130px_96px_32px] gap-3 px-4 py-2 text-xs text-white/40 bg-white/[0.02]"><span>Variant</span><span>Price</span><span className="text-right">Available</span><span /></div>
          {groups.map(([name, vs]) => {
            const isOpen = open.has(name);
            const prices = Array.from(new Set(vs.map((v) => price(v) || draft.price)));
            return (
              <div key={name} className="border-t border-white/5">
                <div className="grid grid-cols-[minmax(0,1fr)_130px_96px_32px] gap-3 px-4 py-3 items-center">
                  <button onClick={() => (single ? goVariant(vs[0].id) : toggle(name))} className="flex items-center gap-3 text-left min-w-0">
                    <Thumb src={imageFor(vs[0])} />
                    <div className="min-w-0"><div className="text-sm text-white truncate">{name}</div><div className="text-xs text-white/40">{vs.length} variant{vs.length === 1 ? "" : "s"}</div></div>
                  </button>
                  {single ? <span className="text-sm text-white/60">${price(vs[0]) || draft.price || "0.00"}</span> : (
                    <MoneyField value={prices.length === 1 ? prices[0] : ""} placeholder={prices.length === 1 ? undefined : "Varies"} label={`Price for all ${name}`} onChange={(val) => vs.forEach((v) => setVariant(v.id, { price: val }))} />
                  )}
                  <span className="text-sm text-white text-right font-mono">{vs.reduce((n, v) => n + avail(v), 0)}</span>
                  <button onClick={() => (single ? goVariant(vs[0].id) : toggle(name))} className="text-white/40" aria-label={single ? "Open variant" : isOpen ? "Collapse" : "Expand"}>
                    {single ? <ChevronRight className="w-4 h-4" /> : isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
                {isOpen && !single && vs.map((v) => (
                  <div key={v.id} className="grid grid-cols-[minmax(0,1fr)_130px_96px_32px] gap-3 pl-16 pr-4 py-2 items-center border-t border-white/[0.03] bg-white/[0.01]">
                    <button onClick={() => goVariant(v.id)} className="min-w-0 text-left group" data-testid={`variant-link-${v.id}`}>
                      <div className="text-sm text-white/80 group-hover:text-blue-400 group-hover:underline">{groupBy === "colour" ? v.size : colourName(v.colourId)}</div>
                      <div className="text-[11px] text-white/35 font-mono truncate">{v.warehouseSku ?? v.sku ?? ""}{v.continueSelling ? " · sells when out of stock" : ""}</div>
                    </button>
                    <MoneyField value={price(v)} placeholder={draft.price || "0.00"} label={`Price for ${v.size}`} onChange={(val) => setVariant(v.id, { price: val })} />
                    <div className="flex justify-end">{loc === ALL_LOC ? <span className="text-sm text-white font-mono">{avail(v)}</span> : <QtyCell productId={p.id} itemId={v.itemId} locationId={Number(loc)} value={avail(v)} />}</div>
                    <button onClick={() => goVariant(v.id)} className="text-white/30 hover:text-white" aria-label="Open variant"><ChevronRight className="w-4 h-4" /></button>
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
        {!single && (
          <div className="border-t border-white/5 px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-white/60">Price for any variant left blank</span>
            <div className="w-40"><MoneyField value={draft.price} onChange={setBasePrice} label="Base price" /></div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// One variant's own page (Shopify's /products/:id/variants/:vid)
// ═════════════════════════════════════════════════════════════════════════

function VariantView({ id, vid }: { id: number; vid: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: p, isLoading, isError } = useProduct(id);
  const { data: meta } = useMeta();
  const v = p?.variants.find((x) => x.id === vid) ?? null;
  const [d, setD] = useState<VariantDraft | null>(null);
  const [base, setBase] = useState<VariantDraft | null>(null);
  const forceReset = useRef(false);
  useEffect(() => {
    if (!v) return;
    const clean = !d || !base || !draftsDiffer(d, base);
    if (forceReset.current || clean) { const x = draftFromVariant(v); setD(x); setBase(x); forceReset.current = false; }
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!d && !!base && draftsDiffer(d, base);
  useLeaveGuard(dirty);
  const err = d ? draftError(d) : null;
  const save = useMutation({
    mutationFn: async () => {
      if (!d || !base) return;
      const patch = variantPatch(vid, d, base);
      if (patch) await apiRequest("PATCH", `/api/admin/warehouse/products/${id}`, { variants: [patch] });
    },
    onSuccess: () => { forceReset.current = true; invalidateAll(id); toast({ title: "Variant saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  if (isLoading || (v && !d)) return <div className="p-10 text-center text-sm text-white/40">Loading…</div>;
  if (isError || !p || !v || !d || !base) return <div className="p-10 text-center text-sm text-red-400">Couldn't load this variant.</div>;
  const colourName = (cid: number) => p.colours.find((c) => c.id === cid)?.name ?? "—";
  const label = (x: Variant) => [colourName(x.colourId), x.size].filter((s) => !/^(default|one size)$/i.test(s)).join(" / ") || "Default";
  const active = p.variants.filter((x) => x.active);
  const image = p.images.find((im) => im.colourId === v.colourId)?.url ?? p.images[0]?.url ?? null;
  const set = (x: Partial<VariantDraft>) => setD((o) => (o ? { ...o, ...x } : o));

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto pb-24">
      {dirty && <SaveBar label="Unsaved changes" hint={err} onDiscard={() => setD(base)} onSave={() => save.mutate()} saving={save.isPending} disabled={!!err} />}
      <TopBar crumb={`${p.title} / ${label(v)}`} onBack={() => setLocation(`/admin/warehouse/products/${id}`)} />
      <h1 className="text-2xl font-bold text-white mb-5">{label(v)}</h1>
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5">
        <Card className="p-3 h-fit">
          <button onClick={() => setLocation(`/admin/warehouse/products/${id}`)} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] text-left">
            <Thumb src={p.images[0]?.url ?? null} />
            <div className="min-w-0"><div className="text-sm text-white truncate">{p.title}</div><div className="text-xs text-white/40">{active.length} variants</div></div>
          </button>
          <div className="mt-2 max-h-[60vh] overflow-y-auto">
            {active.map((x) => (
              <button key={x.id} onClick={() => setLocation(`/admin/warehouse/products/${id}/variants/${x.id}`)}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left ${x.id === vid ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}>
                <Thumb src={p.images.find((im) => im.colourId === x.colourId)?.url ?? null} size={32} />
                <span className="text-sm text-white/80 truncate">{label(x)}</span>
                <span className="ml-auto text-xs text-white/40 font-mono">{Object.values(x.stock).reduce((a, b) => a + b, 0)}</span>
              </button>
            ))}
          </div>
        </Card>
        <div className="space-y-5 min-w-0">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Options</h2>
            <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Label>Color</Label><div className="text-sm text-white rounded-lg border border-white/10 px-3 py-2">{colourName(v.colourId)}</div></div>
                <div><Label>Size</Label><div className="text-sm text-white rounded-lg border border-white/10 px-3 py-2">{v.size}</div></div>
              </div>
              <Thumb src={image} size={88} />
            </div>
          </Card>
          <PriceCard d={d} set={set} pricePlaceholder={dollars(p.priceCents)} />
          <InventoryCard d={d} set={set} locations={meta?.locations ?? []} warehouseSku={v.warehouseSku} shopStock={v.shopStock} warehouseDriven={p.warehouseDriven}
            qty={(loc) => <QtyCell productId={id} itemId={v.itemId} locationId={loc} value={v.stock[String(loc)] ?? 0} />} />
          <ShippingCard d={d} set={set} />
        </div>
      </div>
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
  const { data: meta } = useMeta();
  const [brand, setBrand] = useState(startShop);
  const { data: colls = [] } = useCollections(brand);
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [status, setStatus] = useState("draft");
  const [type, setType] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<number[]>([]);
  const [seo, setSeo] = useState({ seoTitle: "", seoDescription: "" });
  const [vd, setVd] = useState<VariantDraft>(() => draftFromVariant(null));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [vqLoc, setVqLoc] = useState<string>("");
  const [vq, setVq] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState(false);

  const shop = meta?.shops.find((s) => s.key === brand);
  const types = shop?.types.length ? shop.types : ["apparel", "accessory"];
  useEffect(() => { if (meta && !vqLoc && meta.locations[0]) setVqLoc(String(meta.locations[0].id)); }, [meta, vqLoc]);
  // Like Shopify, the category starts unchosen; a vendor change clears one the new shop doesn't sell.
  useEffect(() => { if (shop && type && !types.includes(type)) setType(""); setCollectionIds([]); }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps

  const colours = options.find((o) => o.kind === "Color")?.values.filter((v) => v.trim()) ?? [];
  const sizes = options.find((o) => o.kind === "Size")?.values.filter((v) => v.trim()) ?? [];
  const hasVariants = colours.length > 0 || sizes.length > 0;
  const combos = hasVariants ? (colours.length ? colours : ["Default"]).flatMap((c) => (sizes.length ? sizes : ["One size"]).map((s) => ({ c, s, key: `${c}|${s}` }))) : [];
  const dirty = !!(title || html || vd.price || options.length || Object.values(qty).some(Boolean) || tags.length);
  useLeaveGuard(dirty);

  const create = useMutation({
    mutationFn: async () => {
      const variantQuantities: Record<string, Record<string, number>> = {};
      for (const [k, v] of Object.entries(vq)) { const [combo, locId] = k.split("@"); if (v) (variantQuantities[combo] ??= {})[locId] = Number(v); }
      const res = await workspaceFetch("/api/admin/warehouse/products", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand, title, status, type, priceCents: toCents(vd.price) ?? 0, compareAtCents: toCents(vd.compareAt), colours, sizes, sku: vd.sku,
          quantities: Object.fromEntries(Object.entries(qty).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])), variantQuantities,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Couldn't create the product");
      // Then everything else on the page — description, tags, collections,
      // SEO, and the per-variant fields on every new variant.
      const created = (await (await apiRequest("GET", `/api/admin/warehouse/products/${body.id}`)).json()) as Product;
      const variants = created.variants.map((v) => {
        const was = draftFromVariant(v);
        return variantPatch(v.id, { ...vd, price: was.price, compareAt: was.compareAt, sku: hasVariants ? was.sku : vd.sku }, was);
      }).filter(Boolean);
      await apiRequest("PATCH", `/api/admin/warehouse/products/${body.id}`, {
        descriptionHtml: html, tags, collectionIds, seoTitle: seo.seoTitle, seoDescription: seo.seoDescription, ...(variants.length ? { variants } : {}),
      });
      return body as { id: number; warning?: string };
    },
    onSuccess: (r) => {
      invalidateAll();
      toast(r.warning ? { title: "Product created", description: r.warning, variant: "destructive" } : { title: "Product created", description: status === "draft" ? "Saved as Draft — it sits in the warehouse until you set it Active." : `Live on ${shop?.storefront.replace(/^https:\/\//, "")}.` });
      setLocation(`/admin/warehouse/products/${r.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't create the product", description: e.message, variant: "destructive" }),
  });

  const err = !brand ? "Choose a Vendor (which shop sells it)." : !title.trim() ? "Give it a title." : !type ? "Choose a category." : draftError(vd) ?? (options.some((o) => !o.done && !o.values.some((v) => v.trim())) ? "Finish the option you're editing." : null);
  const back = () => setLocation(`/admin/warehouse/products${brand ? `?shop=${brand}` : ""}`);
  const setOpt = (i: number, next: Partial<OptionDraft>) => setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, ...next } : o)));
  const remaining: OptionKind[] = (["Color", "Size"] as OptionKind[]).filter((k) => !options.some((o) => o.kind === k));
  const setV = (x: Partial<VariantDraft>) => setVd((o) => ({ ...o, ...x }));
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto pb-24">
      {dirty && <SaveBar label="Unsaved product" hint={err} onDiscard={back} onSave={() => create.mutate()} saving={create.isPending} disabled={!!err} />}
      <TopBar crumb="Add product" onBack={back} />
      <h1 className="text-2xl font-bold text-white mb-5">Add product</h1>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="space-y-5 min-w-0">
          <Card className="p-5 space-y-5">
            <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short sleeve t-shirt" className="bg-white/[0.02] border-white/10 text-white" /></div>
            <div><Label>Description</Label><RichText value={html} onChange={setHtml} /></div>
            <div>
              <Label>Media</Label>
              <div className="rounded-xl border border-dashed border-white/15 py-8 text-center"><p className="text-sm text-white/50">Upload photos straight after saving — the product page opens next.</p></div>
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
          <PriceCard d={vd} set={setV} />
          {!hasVariants && (
            <InventoryCard d={vd} set={setV} locations={meta?.locations ?? []}
              qty={(loc) => <Input value={qty[loc] ?? ""} placeholder="0" inputMode="numeric" onChange={(e) => setQty((q) => ({ ...q, [loc]: e.target.value.replace(/[^\d]/g, "") }))} className="w-24 text-right bg-white/[0.02] border-white/10 text-white" aria-label="Quantity" />} />
          )}
          <ShippingCard d={vd} set={setV} />

          <div>
            <h2 className="text-sm font-semibold text-white mb-2">Variants</h2>
            <Card>
              {options.length === 0 ? (
                <div className="relative">
                  <button onClick={() => setMenu((m) => !m)} className="w-full flex items-center gap-2 px-5 py-4 text-sm text-white hover:bg-white/[0.03] rounded-2xl"><Plus className="w-4 h-4" /> Add options like size or color</button>
                  {menu && <OptionMenu kinds={remaining} onPick={(k) => { setOptions([{ kind: k, values: [], done: false }]); setMenu(false); }} />}
                </div>
              ) : (
                <div className="m-3 rounded-xl border border-white/10 divide-y divide-white/5">
                  {options.map((o, i) => o.done ? (
                    <button key={o.kind} onClick={() => setOpt(i, { done: false })} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.02]">
                      <GripVertical className="w-4 h-4 text-white/20 mt-0.5" />
                      <div><div className="text-sm font-medium text-white">{o.kind}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">{o.values.filter((v) => v.trim()).map((v) => <span key={v} className="text-xs px-2 py-1 rounded-md bg-white/[0.06] text-white/80">{v}</span>)}</div></div>
                    </button>
                  ) : (
                    <div key={o.kind} className="px-4 py-3 space-y-2">
                      <Label>Option name</Label>
                      <div className="text-sm text-white rounded-lg border border-white/10 px-3 py-2">{o.kind}</div>
                      <Label>Option values</Label>
                      {o.values.map((val, j) => (
                        <div key={j} className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-white/20" />
                          <Input value={val} autoFocus={j === o.values.length - 1 && val.length <= 1} onChange={(e) => setOpt(i, { values: o.values.map((x, k) => (k === j ? e.target.value : x)) })} className="bg-white/[0.02] border-white/10 text-white" />
                          <button tabIndex={-1} onClick={() => setOpt(i, { values: o.values.filter((_, k) => k !== j) })} className="w-9 h-9 flex items-center justify-center text-white/40 hover:text-red-400" aria-label={`Remove ${val || "value"}`}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <span className="w-4" />
                        <Input value="" placeholder={o.values.length === 0 ? (o.kind === "Size" ? "Medium" : "Blue") : "Add another value"} onChange={(e) => e.target.value && setOpt(i, { values: [...o.values, e.target.value] })} className="bg-white/[0.02] border-white/10 text-white" aria-label={`Add a ${o.kind} value`} />
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
                      <span className="text-sm text-white/60">${vd.price || "0.00"}</span>
                      <Input value={vq[`${cb.key}@${vqLoc}`] ?? ""} placeholder="0" inputMode="numeric" onChange={(e) => setVq((q) => ({ ...q, [`${cb.key}@${vqLoc}`]: e.target.value.replace(/[^\d]/g, "") }))} className="text-right bg-white/[0.02] border-white/10 text-white" aria-label={`Quantity of ${cb.key}`} />
                    </div>
                  ))}
                  <div className="border-t border-white/5 px-4 py-3 text-sm text-white/60">{combos.length} variants · {Object.values(vq).reduce((n, v) => n + (Number(v) || 0), 0)} units entered · every variant takes the price, cost, tax and shipping above</div>
                </div>
              )}
            </Card>
          </div>
          <SeoCard shopName={shop?.name ?? ""} url={`${shop?.storefront ?? ""}/products/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`} title={title} description={plain} price={vd.price}
            seoTitle={seo.seoTitle} seoDescription={seo.seoDescription} onChange={(x) => setSeo((o) => ({ ...o, ...x }))} />
        </div>
        <div className="space-y-5">
          <StatusCard status={status} setStatus={setStatus} storefront={shop?.storefront} allowArchive={false} />
          <OrganizationCard brand={brand} types={types} type={type} setType={setType} collections={colls} collectionIds={collectionIds} setCollections={setCollectionIds} tags={tags} setTags={setTags}
            vendorPicker={
              <Select value={brand} onValueChange={setBrand}>
                <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue placeholder="Which shop sells it" /></SelectTrigger>
                <SelectContent>{(meta?.shops ?? []).map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            } />
        </div>
      </div>
    </div>
  );
}

function OptionMenu({ kinds, onPick }: { kinds: OptionKind[]; onPick: (k: OptionKind) => void }) {
  return (
    <div className="absolute left-4 top-full mt-1 z-20 w-56 rounded-xl border border-white/10 bg-[#0b1220] shadow-xl p-1">
      {kinds.map((k) => <button key={k} onClick={() => onPick(k)} className="w-full text-left px-3 py-2 rounded-lg text-sm text-white hover:bg-white/[0.06]">{k}</button>)}
    </div>
  );
}

export default function WarehouseProduct() {
  const [isNew] = useRoute("/admin/warehouse/products/new");
  const [isVariant, vparams] = useRoute<{ id: string; vid: string }>("/admin/warehouse/products/:id/variants/:vid");
  const [, params] = useRoute<{ id: string }>("/admin/warehouse/products/:id");
  if (isNew) return <NewProductView />;
  if (isVariant && vparams && /^\d+$/.test(vparams.id) && /^\d+$/.test(vparams.vid)) return <VariantView key={vparams.vid} id={Number(vparams.id)} vid={Number(vparams.vid)} />;
  const id = params && /^\d+$/.test(params.id) ? Number(params.id) : null;
  if (id === null) return <div className="p-10 text-center text-sm text-white/40">Product not found.</div>;
  return <ProductView key={id} id={id} />;
}
