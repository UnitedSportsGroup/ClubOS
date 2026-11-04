// The building blocks of the Shopify-style product pages (2026-11-04):
// cards, money fields, the save bar, the rich-text description editor, tags,
// collections, the media manager, and the three per-variant cards Shopify
// shows — Price (compare-at, cost, profit, margin, charge tax, unit price),
// Inventory (tracked, quantity per location, SKU, barcode, continue selling)
// and Shipping (physical, weight, size, country of origin, HS code). The same
// cards serve a one-variant product's page, each variant's own page, and Add
// product, so they can never drift apart.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import {
  Bold, Italic, Underline, List, ListOrdered, Link2, RemoveFormatting, Code2, ImagePlus, Loader2, Plus, X, GripVertical, Pencil,
} from "lucide-react";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cleanProductHtml } from "@shared/product-html";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Meta {
  shops: { key: string; name: string; storefront: string; types: string[] }[];
  locations: { id: number; label: string }[];
}
export interface Variant {
  id: number; colourId: number; size: string; sku: string | null; active: boolean;
  priceCents: number | null; itemId: number | null; warehouseSku: string | null;
  stock: Record<string, number>;
  barcode: string | null; compareAtCents: number | null; costCents: number | null; chargeTax: boolean;
  unitPriceMeasure: number | null; unitPriceUnit: string | null; unitPriceBaseMeasure: number | null; unitPriceBaseUnit: string | null;
  trackInventory: boolean; continueSelling: boolean; physical: boolean;
  weightGrams: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null;
  countryOfOrigin: string | null; hsCode: string | null; shopStock: number;
}
export interface Product {
  id: number; brand: string; shopName: string; storefrontUrl: string; slug: string; warehouseDriven: boolean;
  title: string; description: string | null; descriptionHtml: string | null; type: string; status: string;
  priceCents: number; compareAtCents: number | null; prevId: number | null; nextId: number | null;
  tags: string[]; seoTitle: string | null; seoDescription: string | null;
  collections: { id: number; title: string; assigned: boolean }[];
  colours: { id: number; name: string; swatchHex: string | null; active: boolean }[];
  images: { id: number; colourId: number | null; url: string; alt: string | null }[];
  variants: Variant[];
}

/** The editable form of a variant's Shopify fields — strings, as typed. */
export interface VariantDraft {
  price: string; compareAt: string; cost: string; chargeTax: boolean;
  unitMeasure: string; unitUnit: string; unitBase: string; unitBaseUnit: string;
  sku: string; barcode: string; trackInventory: boolean; continueSelling: boolean;
  physical: boolean; weight: string; weightUnit: "g" | "kg"; length: string; width: string; height: string;
  countryOfOrigin: string; hsCode: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
export function toCents(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : (NaN as unknown as number);
}
export const isBadMoney = (s: string) => Number.isNaN(toCents(s) as number);
export const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const numStr = (n: number | null | undefined) => (n == null ? "" : String(n));
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function draftFromVariant(v: Variant | null, productPriceCents = 0, productCompareAt: number | null = null): VariantDraft {
  const g = v?.weightGrams ?? null;
  const inKg = g != null && g >= 1000 && g % 100 === 0;
  return {
    price: v ? dollars(v.priceCents) : dollars(productPriceCents),
    compareAt: v ? dollars(v.compareAtCents) : dollars(productCompareAt),
    cost: dollars(v?.costCents), chargeTax: v ? v.chargeTax : true,
    unitMeasure: numStr(v?.unitPriceMeasure), unitUnit: v?.unitPriceUnit ?? "", unitBase: numStr(v?.unitPriceBaseMeasure), unitBaseUnit: v?.unitPriceBaseUnit ?? "",
    sku: v?.sku ?? "", barcode: v?.barcode ?? "", trackInventory: v ? v.trackInventory : true, continueSelling: v ? v.continueSelling : false,
    physical: v ? v.physical : true, weight: g == null ? "" : String(inKg ? g / 1000 : g), weightUnit: inKg ? "kg" : "g",
    length: numStr(v?.lengthCm), width: numStr(v?.widthCm), height: numStr(v?.heightCm),
    countryOfOrigin: v?.countryOfOrigin ?? "", hsCode: v?.hsCode ?? "",
  };
}

/** The PATCH body for one variant — only what differs from what was loaded. */
export function variantPatch(id: number, d: VariantDraft, base: VariantDraft): Record<string, unknown> | null {
  const out: Record<string, unknown> = { id };
  const ch = (k: keyof VariantDraft) => d[k] !== base[k];
  if (ch("price")) out.priceCents = toCents(d.price);
  if (ch("compareAt")) out.compareAtCents = toCents(d.compareAt);
  if (ch("cost")) out.costCents = toCents(d.cost);
  if (ch("chargeTax")) out.chargeTax = d.chargeTax;
  if (ch("unitMeasure")) out.unitPriceMeasure = numOrNull(d.unitMeasure);
  if (ch("unitUnit")) out.unitPriceUnit = d.unitUnit || null;
  if (ch("unitBase")) out.unitPriceBaseMeasure = numOrNull(d.unitBase);
  if (ch("unitBaseUnit")) out.unitPriceBaseUnit = d.unitBaseUnit || null;
  if (ch("sku")) out.sku = d.sku;
  if (ch("barcode")) out.barcode = d.barcode;
  if (ch("trackInventory")) out.trackInventory = d.trackInventory;
  if (ch("continueSelling")) out.continueSelling = d.continueSelling;
  if (ch("physical")) out.physical = d.physical;
  if (ch("weight") || ch("weightUnit")) out.weightGrams = d.weight.trim() === "" ? null : Number(d.weight) * (d.weightUnit === "kg" ? 1000 : 1);
  if (ch("length")) out.lengthCm = numOrNull(d.length);
  if (ch("width")) out.widthCm = numOrNull(d.width);
  if (ch("height")) out.heightCm = numOrNull(d.height);
  if (ch("countryOfOrigin")) out.countryOfOrigin = d.countryOfOrigin || null;
  if (ch("hsCode")) out.hsCode = d.hsCode || null;
  return Object.keys(out).length > 1 ? out : null;
}
export const draftsDiffer = (a: VariantDraft, b: VariantDraft) => JSON.stringify(a) !== JSON.stringify(b);
export function draftError(d: VariantDraft): string | null {
  if ([d.price, d.compareAt, d.cost].some(isBadMoney)) return "Check the prices — numbers only.";
  for (const [label, v] of [["Weight", d.weight], ["Length", d.length], ["Width", d.width], ["Height", d.height], ["Unit price", d.unitMeasure], ["Unit price base", d.unitBase]] as const) {
    if (v.trim() !== "" && !(Number(v) >= 0)) return `${label} must be a number.`;
  }
  if (d.countryOfOrigin && !/^[A-Z]{2}$/.test(d.countryOfOrigin)) return "Country of origin is a 2-letter code.";
  if (d.hsCode && !/^[0-9]{6,10}$/.test(d.hsCode.replace(/[.\s]/g, ""))) return "An HS code is 6 to 10 digits.";
  return null;
}

// ── Small pieces ─────────────────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-white/[0.02] ${className}`}>{children}</div>;
}
export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-sm text-white/80 mb-1.5">{children}</label>;
}
export function MoneyField({ value, onChange, placeholder, label, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; disabled?: boolean }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">$</span>
      <Input inputMode="decimal" value={value} placeholder={placeholder ?? "0.00"} aria-label={label} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} className="pl-7 bg-white/[0.02] border-white/10 text-white" />
    </div>
  );
}
export function Thumb({ src, size = 40 }: { src: string | null; size?: number }) {
  const [bad, setBad] = useState(false);
  const box = { width: size, height: size };
  if (!src || bad) return <div style={box} className="rounded-lg border border-dashed border-white/15 flex items-center justify-center flex-shrink-0"><ImagePlus className="w-4 h-4 text-blue-400" /></div>;
  return <img src={src} alt="" loading="lazy" onError={() => setBad(true)} style={box} className="rounded-lg border border-white/10 bg-white object-contain flex-shrink-0" />;
}
/** A Shopify chip: a label + its current value, toggling a section open. */
export function Chip({ label, value, active, onClick }: { label: string; value?: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-1.5 min-h-[36px] ${active ? "bg-white/[0.12] text-white" : "bg-white/[0.05] text-white/70 hover:bg-white/[0.09]"}`}>
      {label}{value && <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.08] text-white/60">{value}</span>}
    </button>
  );
}
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none">
      {label}
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        className={`relative w-10 h-6 rounded-full transition-colors ${on ? "bg-blue-600" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/** The contextual save bar Shopify raises over the top of the page. Portalled
 *  (a fixed bar inside a routed page's transformed ancestor is mis-placed);
 *  ClubOS blue, because the light theme repaints near-black surfaces light. */
export function SaveBar({ label, onDiscard, onSave, saving, disabled, hint }: { label: string; onDiscard: () => void; onSave: () => void; saving: boolean; disabled?: boolean; hint?: string | null }) {
  return createPortal(
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-xl bg-blue-600 text-white pl-4 pr-1.5 py-1.5 shadow-2xl max-w-[calc(100vw-2rem)]" role="region" aria-label="Unsaved changes">
      <span className="text-sm text-white font-medium mr-2 truncate">{hint || label}</span>
      <button onClick={onDiscard} className="px-3 py-1.5 rounded-lg text-sm bg-blue-500 hover:bg-blue-400 text-white">Discard</button>
      <button onClick={onSave} disabled={saving || disabled} className="px-3 py-1.5 rounded-lg text-sm bg-white text-blue-700 font-medium disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
    </div>,
    document.body,
  );
}
export function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

// ── Rich text description ────────────────────────────────────────────────────

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Turn the old plain-text description into paragraphs the editor can hold. */
export function plainToHtml(text: string | null): string {
  if (!text) return "";
  return text.split(/\n{2,}/).map((p) => `<p>${escapeText(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Shopify's description editor: Paragraph/Heading, bold, italic, underline,
 *  lists, link, clear formatting, and a "show HTML" switch. The HTML is cleaned
 *  again on the server — this editor never decides what is safe. */
export function RichText({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (!source && ref.current && value !== last.current) { ref.current.innerHTML = value; last.current = value; }
  }, [value, source]);
  useEffect(() => { if (ref.current && !source) { ref.current.innerHTML = value; last.current = value; } }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  const emit = () => { const h = ref.current?.innerHTML ?? ""; last.current = h; onChange(h); };
  const cmd = (c: string, arg?: string) => { ref.current?.focus(); document.execCommand(c, false, arg); emit(); };
  const btn = "w-8 h-8 rounded-md flex items-center justify-center text-white/70 hover:bg-white/[0.08]";
  return (
    <div className="rounded-lg border border-white/10 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/40">
      <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-white/10 bg-white/[0.03]">
        <select aria-label="Text style" disabled={source} onChange={(e) => { cmd("formatBlock", e.target.value); e.target.value = ""; }} defaultValue=""
          className="h-8 rounded-md bg-transparent text-sm text-white/80 px-1 mr-1 border border-white/10">
          <option value="" disabled>Paragraph</option>
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="blockquote">Quote</option>
        </select>
        <button type="button" disabled={source} onClick={() => cmd("bold")} className={btn} aria-label="Bold"><Bold className="w-4 h-4" /></button>
        <button type="button" disabled={source} onClick={() => cmd("italic")} className={btn} aria-label="Italic"><Italic className="w-4 h-4" /></button>
        <button type="button" disabled={source} onClick={() => cmd("underline")} className={btn} aria-label="Underline"><Underline className="w-4 h-4" /></button>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <button type="button" disabled={source} onClick={() => cmd("insertUnorderedList")} className={btn} aria-label="Bulleted list"><List className="w-4 h-4" /></button>
        <button type="button" disabled={source} onClick={() => cmd("insertOrderedList")} className={btn} aria-label="Numbered list"><ListOrdered className="w-4 h-4" /></button>
        <button type="button" disabled={source} onClick={() => { const u = window.prompt("Link to (https://…)"); if (u && /^(https?:\/\/|mailto:)/i.test(u)) cmd("createLink", u); }} className={btn} aria-label="Link"><Link2 className="w-4 h-4" /></button>
        <button type="button" disabled={source} onClick={() => cmd("removeFormat")} className={btn} aria-label="Clear formatting"><RemoveFormatting className="w-4 h-4" /></button>
        <span className="flex-1" />
        <button type="button" onClick={() => { if (source) onChange(cleanProductHtml(value)); setSource((s) => !s); }} className={`${btn} ${source ? "bg-white/[0.1] text-white" : ""}`} aria-label="Show HTML"><Code2 className="w-4 h-4" /></button>
      </div>
      {source ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={8} spellCheck={false}
          className="w-full bg-transparent text-white/80 text-xs font-mono px-3 py-2.5 focus:outline-none" aria-label="Description HTML" />
      ) : (
        <div ref={ref} contentEditable suppressContentEditableWarning onInput={emit} onBlur={emit}
          onPaste={(e) => { e.preventDefault(); const html = e.clipboardData.getData("text/html"); const text = e.clipboardData.getData("text/plain"); document.execCommand("insertHTML", false, html ? cleanProductHtml(html) : plainToHtml(text)); emit(); }}
          className="min-h-[160px] px-3 py-2.5 text-sm text-white focus:outline-none prose-description" aria-label="Description" role="textbox" aria-multiline="true" />
      )}
    </div>
  );
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export function TagsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((t) => t.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange(Array.from(new Set([...value, ...parts])));
    setText("");
  };
  return (
    <div>
      <Input value={text} placeholder="Add a tag, press Enter" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); } }}
        onBlur={() => add(text)} className="bg-white/[0.02] border-white/10 text-white" aria-label="Tags" />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {value.map((t) => (
            <span key={t} className="text-xs pl-2 pr-1 py-1 rounded-md bg-white/[0.08] text-white/80 flex items-center gap-1">
              {t}<button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/[0.1]" aria-label={`Remove tag ${t}`}><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Collections ──────────────────────────────────────────────────────────────

export function CollectionsPicker({ shop, all, selected, onChange }: { shop: string; all: { id: number; title: string }[]; selected: number[]; onChange: (ids: number[]) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const create = useMutation({
    mutationFn: async (title: string) => (await apiRequest("POST", "/api/admin/warehouse/collections", { shop, title })).json() as Promise<{ id: number; title: string }>,
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/collections", shop] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/products"] });
      onChange(Array.from(new Set([...selected, c.id])));
      setQ("");
      toast({ title: `Collection “${c.title}” ready` });
    },
    onError: (e: Error) => toast({ title: "Collection not created", description: e.message, variant: "destructive" }),
  });
  const shown = all.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = all.some((c) => c.title.toLowerCase() === q.trim().toLowerCase());
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full min-h-[40px] rounded-lg border border-white/10 px-2 py-1.5 flex flex-wrap gap-1.5 items-center text-left">
        {selected.length === 0 && <span className="text-sm text-white/40 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add collections</span>}
        {all.filter((c) => selected.includes(c.id)).map((c) => (
          <span key={c.id} className="text-xs pl-2 pr-1 py-1 rounded-md bg-white/[0.08] text-white/80 flex items-center gap-1">
            {c.title}<span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onChange(selected.filter((x) => x !== c.id)); }} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/[0.1]" aria-label={`Remove ${c.title}`}><X className="w-3 h-3" /></span>
          </span>
        ))}
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-white/10 bg-[#0b1220] shadow-xl p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or create a collection" className="bg-white/[0.02] border-white/10 text-white h-9" />
          <div className="max-h-56 overflow-y-auto mt-1">
            {shown.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button type="button" key={c.id} onClick={() => onChange(on ? selected.filter((x) => x !== c.id) : [...selected, c.id])} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-white hover:bg-white/[0.06] text-left">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? "bg-blue-600 border-blue-600" : "border-white/30"}`}>{on && <span className="w-2 h-2 bg-white rounded-sm" />}</span>
                  {c.title}
                </button>
              );
            })}
            {q.trim() && !exact && (
              <button type="button" onClick={() => create.mutate(q.trim())} disabled={create.isPending} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-blue-400 hover:bg-white/[0.06] text-left">
                <Plus className="w-4 h-4" /> Create “{q.trim()}”
              </button>
            )}
            {!shown.length && !q.trim() && <p className="text-xs text-white/40 px-2 py-2">No collections yet — type a name to create one.</p>}
          </div>
          <div className="flex justify-end pt-1"><button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg text-sm bg-white/[0.06] text-white">Done</button></div>
        </div>
      )}
    </div>
  );
}

// ── Media ────────────────────────────────────────────────────────────────────

/** Shopify's Media block: upload (button, drag-and-drop or paste), drag to
 *  reorder — the first photo is the main one — and remove. Each change is
 *  saved the moment it happens, as in Shopify. */
export function MediaManager({ productId, images, colourId }: { productId: number; images: Product["images"]; colourId: number | null }) {
  const { toast } = useToast();
  const [order, setOrder] = useState(images.map((i) => i.id));
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setOrder(images.map((i) => i.id)), [images]);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/products", productId] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
  };
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      if (colourId) fd.append("colourId", String(colourId));
      const res = await workspaceFetch(`/api/admin/warehouse/products/${productId}/images`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Upload failed");
      return body as { added: unknown[]; message?: string };
    },
    onSuccess: (r) => { refresh(); toast(r.message ? { title: `${r.added.length} added`, description: r.message, variant: "destructive" } : { title: r.added.length === 1 ? "Photo added" : `${r.added.length} photos added` }); },
    onError: (e: Error) => toast({ title: "Photo not added", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (imageId: number) => apiRequest("DELETE", `/api/admin/warehouse/products/${productId}/images/${imageId}`),
    onSuccess: refresh,
    onError: (e: Error) => toast({ title: "Photo not removed", description: e.message, variant: "destructive" }),
  });
  const saveOrder = useMutation({
    mutationFn: async (ids: number[]) => apiRequest("POST", `/api/admin/warehouse/products/${productId}/images/order`, { ids }),
    onSuccess: refresh,
    onError: (e: Error) => { setOrder(images.map((i) => i.id)); toast({ title: "Order not saved", description: e.message, variant: "destructive" }); },
  });
  const pick = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) upload.mutate(files);
  };
  const byId = new Map(images.map((i) => [i.id, i]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean) as Product["images"];
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = order.filter((x) => x !== from);
    next.splice(next.indexOf(to) + (order.indexOf(from) < order.indexOf(to) ? 1 : 0), 0, from);
    setOrder(next);
    saveOrder.mutate(next);
  };
  return (
    <div onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); } }}
      onPaste={(e) => pick(e.clipboardData.files)}
      className={`rounded-xl ${over ? "ring-2 ring-blue-500" : ""}`}>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      {ordered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 py-10 text-center">
          <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-lg text-sm bg-white/[0.08] text-white hover:bg-white/[0.12]">{upload.isPending ? "Uploading…" : "Upload new"}</button>
          <p className="text-xs text-white/40 mt-2">Drop photos here, paste them, or upload. JPG, PNG or WebP.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {ordered.map((im, i) => (
            <div key={im.id} draggable onDragStart={() => setDragId(im.id)} onDragEnd={() => setDragId(null)}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={(e) => { if (dragId) { e.preventDefault(); move(dragId, im.id); setDragId(null); } }}
              className={`group relative ${i === 0 ? "col-span-2 row-span-2" : ""} rounded-xl border ${dragId === im.id ? "border-blue-500 opacity-60" : "border-white/10"} bg-white overflow-hidden aspect-square cursor-grab`}>
              <img src={im.url} alt={im.alt ?? ""} loading="lazy" className="w-full h-full object-contain pointer-events-none" />
              <span className="absolute top-1.5 left-1.5 w-7 h-7 rounded-md bg-black/50 text-white flex items-center justify-center"><GripVertical className="w-4 h-4" /></span>
              <button type="button" onClick={() => remove.mutate(im.id)} className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/60 text-white flex items-center justify-center" aria-label="Remove photo"><X className="w-4 h-4" /></button>
              {i === 0 && <span className="absolute bottom-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">Main photo</span>}
            </div>
          ))}
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl border border-dashed border-white/15 aspect-square flex items-center justify-center text-white/50 hover:bg-white/[0.04]" aria-label="Add photos">
            {upload.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-6 h-6" />}
          </button>
        </div>
      )}
      {ordered.length > 1 && <p className="text-xs text-white/35 mt-2">Drag a photo to reorder — the first one is the main photo on the shop.</p>}
    </div>
  );
}

// ── The three per-variant cards ──────────────────────────────────────────────

const UNITS = ["g", "kg", "ml", "l", "cm", "m", "item"];
const COUNTRIES: [string, string][] = [["CN", "China"], ["NZ", "New Zealand"], ["AU", "Australia"], ["BD", "Bangladesh"], ["VN", "Vietnam"], ["IN", "India"], ["PK", "Pakistan"], ["TH", "Thailand"], ["ID", "Indonesia"], ["KH", "Cambodia"], ["TR", "Türkiye"], ["PT", "Portugal"], ["IT", "Italy"], ["ES", "Spain"], ["US", "United States"], ["GB", "United Kingdom"], ["JP", "Japan"], ["KR", "South Korea"], ["TW", "Taiwan"]];

export function PriceCard({ d, set, hideBase }: { d: VariantDraft; set: (p: Partial<VariantDraft>) => void; hideBase?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ compare: !!d.compareAt, unit: !!d.unitMeasure, cost: !!d.cost });
  const price = toCents(d.price) ?? 0;
  const cost = toCents(d.cost);
  const profit = cost != null && !Number.isNaN(cost) ? price - cost : null;
  const margin = profit != null && price > 0 ? Math.round((profit / price) * 1000) / 10 : null;
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-white mb-3">Price</h2>
      {!hideBase && <div className="max-w-xs"><MoneyField value={d.price} onChange={(v) => set({ price: v })} label="Price" /></div>}
      <div className="flex flex-wrap gap-2 mt-3">
        <Chip label="Compare-at" active={open.compare} onClick={() => setOpen((o) => ({ ...o, compare: !o.compare }))} />
        <Chip label="Unit price" active={open.unit} onClick={() => setOpen((o) => ({ ...o, unit: !o.unit }))} />
        <Chip label="Charge tax" value={d.chargeTax ? "Yes" : "No"} onClick={() => set({ chargeTax: !d.chargeTax })} />
        <Chip label="Cost per item" active={open.cost} onClick={() => setOpen((o) => ({ ...o, cost: !o.cost }))} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        {open.compare && <div><Label>Compare-at price</Label><MoneyField value={d.compareAt} onChange={(v) => set({ compareAt: v })} label="Compare-at price" /><p className="text-[11px] text-white/35 mt-1">Shown crossed out beside the price.</p></div>}
        {open.cost && (
          <div>
            <Label>Cost per item</Label><MoneyField value={d.cost} onChange={(v) => set({ cost: v })} label="Cost per item" />
            <p className="text-[11px] text-white/45 mt-1">{profit == null ? "Customers won't see this." : `Profit $${(profit / 100).toFixed(2)} · Margin ${margin ?? "—"}%`}</p>
          </div>
        )}
        {open.unit && (
          <div className="sm:col-span-2">
            <Label>Unit price</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <Input value={d.unitMeasure} onChange={(e) => set({ unitMeasure: e.target.value })} placeholder="Total amount, e.g. 500" inputMode="decimal" className="w-40 bg-white/[0.02] border-white/10 text-white" aria-label="Total measurement" />
              <UnitSelect value={d.unitUnit} onChange={(v) => set({ unitUnit: v })} />
              <span className="text-sm text-white/40">per</span>
              <Input value={d.unitBase} onChange={(e) => set({ unitBase: e.target.value })} placeholder="e.g. 100" inputMode="decimal" className="w-28 bg-white/[0.02] border-white/10 text-white" aria-label="Base measurement" />
              <UnitSelect value={d.unitBaseUnit} onChange={(v) => set({ unitBaseUnit: v })} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger className="w-24 bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="none">Unit</SelectItem>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Quantity at one location — on an existing variant it saves on blur as a stock take. */
export function QtyCell({ productId, itemId, locationId, value }: { productId: number; itemId: number | null; locationId: number; value: number }) {
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

export function InventoryCard({
  d, set, locations, qty, warehouseSku, shopStock, warehouseDriven,
}: {
  d: VariantDraft; set: (p: Partial<VariantDraft>) => void; locations: Meta["locations"];
  /** Renders the quantity input for one location (live QtyCell, or a draft box on Add product). */
  qty: (locationId: number) => React.ReactNode;
  warehouseSku?: string | null; shopStock?: number; warehouseDriven?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ sku: !!d.sku, barcode: !!d.barcode });
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Inventory</h2>
        <Toggle on={d.trackInventory} onChange={(v) => set({ trackInventory: v })} label="Inventory tracked" />
      </div>
      {d.trackInventory ? (
        <div className="rounded-xl border border-white/10 divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-2 text-xs text-white/40"><span>Location</span><span>Quantity</span></div>
          {locations.map((l) => (
            <div key={l.id} className="flex items-center justify-between px-4 py-2">
              <span className="text-sm text-white/80">{l.label}</span>{qty(l.id)}
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-white/50">Not tracked — the shop never shows it as sold out.</p>}
      <div className="flex flex-wrap gap-2 mt-3">
        <Chip label="SKU" value={d.sku || undefined} active={open.sku} onClick={() => setOpen((o) => ({ ...o, sku: !o.sku }))} />
        <Chip label="Barcodes" value={d.barcode || undefined} active={open.barcode} onClick={() => setOpen((o) => ({ ...o, barcode: !o.barcode }))} />
        <Chip label="Sell when out of stock" value={d.continueSelling ? "On" : "Off"} onClick={() => set({ continueSelling: !d.continueSelling })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        {open.sku && <div><Label>SKU (stock keeping unit)</Label><Input value={d.sku} onChange={(e) => set({ sku: e.target.value })} className="bg-white/[0.02] border-white/10 text-white font-mono" /></div>}
        {open.barcode && <div><Label>Barcode (ISBN, UPC, GTIN, etc.)</Label><Input value={d.barcode} onChange={(e) => set({ barcode: e.target.value })} inputMode="numeric" className="bg-white/[0.02] border-white/10 text-white font-mono" /></div>}
      </div>
      {(warehouseSku || shopStock !== undefined) && (
        <p className="text-[11px] text-white/35 mt-3">
          {warehouseSku ? `Warehouse ${warehouseSku}` : ""}
          {shopStock !== undefined ? `${warehouseSku ? " · " : ""}${warehouseDriven ? "The shop shows what the warehouse holds" : `The shop's own count: ${shopStock} (this shop isn't run from the warehouse yet)`}` : ""}
        </p>
      )}
    </Card>
  );
}

export function ShippingCard({ d, set }: { d: VariantDraft; set: (p: Partial<VariantDraft>) => void }) {
  const [more, setMore] = useState(!!(d.countryOfOrigin || d.hsCode));
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Shipping</h2>
        <Toggle on={d.physical} onChange={(v) => set({ physical: v })} label="Physical product" />
      </div>
      {d.physical ? (
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <span className="text-sm text-white/70">Packed size</span>
            <div className="flex items-center gap-2">
              {(["length", "width", "height"] as const).map((k, i) => (
                <div key={k} className="flex items-center gap-2 flex-1">
                  {i > 0 && <span className="text-white/30">×</span>}
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-white/40">{k[0].toUpperCase()}</span>
                    <Input value={d[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<VariantDraft>)} inputMode="decimal" placeholder="0.0" className="pl-6 bg-white/[0.02] border-white/10 text-white" aria-label={`${k} in cm`} />
                  </div>
                </div>
              ))}
              <span className="text-sm text-white/50">cm</span>
            </div>
          </div>
          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <span className="text-sm text-white/70">Weight</span>
            <div className="flex items-center gap-2">
              <Input value={d.weight} onChange={(e) => set({ weight: e.target.value })} inputMode="decimal" placeholder="0.0" className="bg-white/[0.02] border-white/10 text-white" aria-label="Weight" />
              <Select value={d.weightUnit} onValueChange={(v) => set({ weightUnit: v as "g" | "kg" })}>
                <SelectTrigger className="w-20 bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="g">g</SelectItem><SelectItem value="kg">kg</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip label="Country of origin" value={d.countryOfOrigin || undefined} active={more} onClick={() => setMore((m) => !m)} />
            <Chip label="HS Code" value={d.hsCode || undefined} active={more} onClick={() => setMore((m) => !m)} />
          </div>
          {more && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Country/Region of origin</Label>
                <Select value={d.countryOfOrigin || "none"} onValueChange={(v) => set({ countryOfOrigin: v === "none" ? "" : v })}>
                  <SelectTrigger className="bg-white/[0.02] border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select</SelectItem>
                    {(COUNTRIES.some(([c]) => c === d.countryOfOrigin) || !d.countryOfOrigin ? COUNTRIES : [...COUNTRIES, [d.countryOfOrigin, d.countryOfOrigin] as [string, string]]).map(([c, n]) => <SelectItem key={c} value={c}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Harmonized System (HS) code</Label>
                <Input value={d.hsCode} onChange={(e) => set({ hsCode: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 610910" inputMode="numeric" className="bg-white/[0.02] border-white/10 text-white font-mono" />
                <p className="text-[11px] text-white/35 mt-1">6 to 10 digits — used for customs on international orders.</p>
              </div>
            </div>
          )}
        </div>
      ) : <p className="text-sm text-white/50">Not a physical product — no shipping needed (a download or a service).</p>}
    </Card>
  );
}

// ── Search engine listing ───────────────────────────────────────────────────

export function SeoCard({ shopName, url, title, description, price, seoTitle, seoDescription, onChange }: {
  shopName: string; url: string; title: string; description: string; price: string;
  seoTitle: string; seoDescription: string; onChange: (p: { seoTitle?: string; seoDescription?: string }) => void;
}) {
  const [edit, setEdit] = useState(false);
  const shownTitle = seoTitle || title;
  const shownDesc = seoDescription || description;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Search engine listing</h2>
        <button type="button" onClick={() => setEdit((e) => !e)} className="w-8 h-8 rounded-md flex items-center justify-center text-white/60 hover:bg-white/[0.06]" aria-label="Edit search engine listing"><Pencil className="w-4 h-4" /></button>
      </div>
      {shownTitle ? (
        <div className="text-sm">
          <div className="text-white/80">{shopName}</div>
          <div className="text-xs text-white/40 truncate">{url.replace(/^https:\/\//, "").replace(/\//g, " › ")}</div>
          <div className="text-lg text-blue-400 mt-1 line-clamp-1">{shownTitle}</div>
          <div className="text-white/50 line-clamp-2">{shownDesc || "No description yet."}</div>
          {price && <div className="text-white/50 mt-1">${price} NZD</div>}
        </div>
      ) : <p className="text-sm text-white/50">Add a title and description to see how this product might appear in a search engine listing.</p>}
      {edit && (
        <div className="space-y-3 mt-4 pt-4 border-t border-white/5">
          <div>
            <Label>Page title</Label>
            <Input value={seoTitle} placeholder={title} maxLength={70} onChange={(e) => onChange({ seoTitle: e.target.value })} className="bg-white/[0.02] border-white/10 text-white" />
            <p className="text-[11px] text-white/35 mt-1">{(seoTitle || title).length} of 70 characters used</p>
          </div>
          <div>
            <Label>Meta description</Label>
            <textarea value={seoDescription} placeholder={description.slice(0, 160)} maxLength={320} rows={3} onChange={(e) => onChange({ seoDescription: e.target.value })}
              className="w-full rounded-lg bg-white/[0.02] border border-white/10 text-white text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            <p className="text-[11px] text-white/35 mt-1">{(seoDescription || description).length} of 320 characters used</p>
          </div>
          <div>
            <Label>URL handle</Label>
            <div className="text-sm text-white/50 rounded-lg border border-white/10 px-3 py-2 truncate">{url}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
