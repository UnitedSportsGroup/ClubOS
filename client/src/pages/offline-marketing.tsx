// ─────────────────────────────────────────────────────────────────────────────
// Marketing → Signage · Billboards · Traditional Media.
// United Sports Group. Registers that staff keep: every row is typed in.
//
// Daniel, 2026-11-11: "signage manages signage we put up/print ourselves,
// billboards is things like Go Media campaigns and others, and traditional
// media is TV and news outlets we can distribute through" (+ radio).
//
// One page shape for all three; what each list calls things is in
// shared/offline-marketing.ts. The list, brand and status filters live in the URL.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { centsToDollarInput, dollarInputToCents, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  OFFLINE_CHANNELS,
  offlineTiming,
  parseOfflineInput,
  type OfflineChannelDef,
  type OfflineChannelKey,
  type OfflineItem,
  type OfflineListResponse,
} from "@shared/offline-marketing";
import { SOCIAL_BRANDS, socialBrand } from "@shared/social";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-12-21" → "21 Dec 2026", by splitting the string (never through a Date). */
function niceDay(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
const dollars = (cents: number | null) => (cents == null ? "—" : formatCurrency(cents, { fromCents: true }));
const count = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-NZ"));
const control = "h-11 md:h-9";

type ListTab = { key: OfflineChannelKey; label: string };

function OfflinePage({ path, title, blurb, lists }: { path: string; title: string; blurb: string; lists: ListTab[] }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const f = useMemo(() => {
    const p = new URLSearchParams(search);
    return {
      list: lists.find((l) => l.key === p.get("list"))?.key ?? lists[0].key,
      brand: p.get("brand") || "all",
      status: p.get("status") || "all",
      removed: p.get("removed") === "1",
    };
  }, [search, lists]);
  const write = (next: Partial<typeof f>) => {
    const m = { ...f, ...next };
    // A status belongs to one list, so changing list clears it.
    if (next.list && next.list !== f.list) m.status = "all";
    const p = new URLSearchParams();
    if (m.list !== lists[0].key) p.set("list", m.list);
    if (m.brand !== "all") p.set("brand", m.brand);
    if (m.status !== "all") p.set("status", m.status);
    if (m.removed) p.set("removed", "1");
    const qs = p.toString();
    navigate(`${path}${qs ? `?${qs}` : ""}`, { replace: true });
  };

  const def = OFFLINE_CHANNELS[f.list];
  const key = `/api/admin/offline-marketing/${def.key}${f.removed ? "?removed=1" : ""}`;
  const { data, isLoading, isError, error, refetch } = useQuery<OfflineListResponse>({ queryKey: [key], staleTime: 30_000 });
  const [editing, setEditing] = useState<OfflineItem | "new" | null>(null);

  const all = data?.items ?? [];
  const live = all.filter((i) => !i.archived);
  const shown = all.filter((i) => (f.brand === "all" || i.brand === f.brand) && (f.status === "all" || i.status === f.status));
  const running = live.filter((i) => i.status && def.liveStatuses.includes(i.status)).length;
  const costed = live.filter((i) => i.costCents != null);
  const today = data?.today ?? "";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{blurb}</p>
        </div>
        <Button className={control} onClick={() => setEditing("new")} data-testid="offline-add">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden />
          {def.addLabel}
        </Button>
      </div>

      {lists.length > 1 && (
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {lists.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => write({ list: l.key })}
              aria-pressed={f.list === l.key}
              data-testid={`offline-list-${l.key}`}
              className={cn(
                "px-3 h-11 md:h-9 rounded-md text-[13px] font-medium transition-colors",
                f.list === l.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label={`${def.statuses.find((s) => s.key === def.liveStatuses[0])?.label ?? "Running"} now`} value={data ? String(running) : "—"} />
        <Stat label="Listed" value={data ? String(live.length) : "—"} />
        {def.labels.cost && (
          <Stat
            label="Cost of everything listed"
            value={data ? (costed.length ? dollars(costed.reduce((s, i) => s + (i.costCents ?? 0), 0)) : "—") : "—"}
            note={data && costed.length < live.length && live.length > 0 ? `${live.length - costed.length} with no cost entered` : undefined}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {def.fields.brand && (
          <Select value={f.brand} onValueChange={(v) => write({ brand: v })}>
            <SelectTrigger className={cn(control, "w-full sm:w-[230px]")} aria-label="Brand"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every brand</SelectItem>
              {SOCIAL_BRANDS.map((b) => <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={f.status} onValueChange={(v) => write({ status: v })}>
          <SelectTrigger className={cn(control, "w-full sm:w-[210px]")} aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every status</SelectItem>
            {def.statuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" className={cn(control, "text-muted-foreground")} onClick={() => write({ removed: !f.removed })}>
          {f.removed ? "Hide removed" : "Show removed"}
        </Button>
      </div>

      {isLoading ? (
        <Loading rows={3} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center space-y-3" data-testid="offline-empty">
          <p className="text-sm font-medium text-foreground">{all.length === 0 ? "Nothing here yet" : "Nothing matches"}</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{all.length === 0 ? def.empty : "Try another brand or status."}</p>
          {all.length === 0 && (
            <Button className={control} onClick={() => setEditing("new")}>
              <Plus className="w-4 h-4 mr-1.5" aria-hidden />
              {def.addLabel}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((i) => <ItemCard key={i.id} def={def} item={i} today={today} onEdit={() => setEditing(i)} listKey={key} />)}
        </div>
      )}

      {editing && <ItemDialog def={def} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground tabular-nums mt-1">{value}</p>
      {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/admin/offline-marketing/") });

function ItemCard({ def, item, today, onEdit, listKey }: { def: OfflineChannelDef; item: OfflineItem; today: string; onEdit: () => void; listKey: string }) {
  const timing = today ? offlineTiming(def, item, today) : null;
  const status = def.statuses.find((s) => s.key === item.status)?.label ?? null;
  const kind = def.kinds.find((k) => k.key === item.kind)?.label ?? null;
  const isLive = Boolean(item.status && def.liveStatuses.includes(item.status));
  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      await apiRequest("PATCH", `/api/admin/offline-marketing/${def.key}/${item.id}`, { archived });
    },
    onSettled: refresh,
  });
  const facts: [string, string][] = [];
  if (item.supplier) facts.push([def.labels.supplier, item.supplier]);
  if (item.location) facts.push([def.labels.location, item.location]);
  if (def.fields.size && (item.size || item.quantity != null)) facts.push(["Size", [item.quantity != null ? `${item.quantity} ×` : null, item.size].filter(Boolean).join(" ") || "—"]);
  if (def.fields.dates && (item.startsOn || item.endsOn)) {
    facts.push([item.endsOn && item.startsOn ? "Dates" : item.startsOn ? def.labels.starts : def.labels.ends, item.startsOn && item.endsOn ? `${niceDay(item.startsOn)} – ${niceDay(item.endsOn)}` : niceDay(item.startsOn ?? item.endsOn)]);
  }
  if (def.labels.cost) facts.push(["Cost", dollars(item.costCents)]);
  if (def.labels.audience && item.audience != null) facts.push([def.labels.audience, count(item.audience)]);
  if (def.fields.contact && (item.contactName || item.contactEmail || item.contactPhone)) {
    facts.push(["Contact", [item.contactName, item.contactEmail, item.contactPhone].filter(Boolean).join(" · ")]);
  }
  void listKey;
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 md:p-5 min-w-0", item.archived && "opacity-60")} data-testid="offline-item">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground break-words">{item.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{[socialBrand(item.brand)?.name, kind].filter(Boolean).join(" · ") || "No brand or type set"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {item.archived ? (
            <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">Removed</span>
          ) : status ? (
            <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", isLive ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>{status}</span>
          ) : null}
        </div>
      </div>
      {timing && (
        <p className={cn("text-xs font-medium mt-2", timing.tone === "late" ? "text-destructive" : "text-amber-700")}>{timing.text}</p>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-3 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground break-words min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {item.notes && <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap break-words">{item.notes}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-border">
        {item.linkUrl && (
          <Button asChild variant="outline" className="h-11 md:h-8">
            <a href={item.linkUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" aria-hidden />
              {def.labels.link.replace(/ link$/i, "").replace(/^Link to it$/i, "Open it")}
            </a>
          </Button>
        )}
        {!item.archived && (
          <Button variant="outline" className="h-11 md:h-8" onClick={onEdit} data-testid="offline-edit">
            <Pencil className="w-3.5 h-3.5 mr-1.5" aria-hidden />
            Edit
          </Button>
        )}
        <Button variant="ghost" className="h-11 md:h-8 text-muted-foreground" disabled={archive.isPending} onClick={() => archive.mutate(!item.archived)}>
          {item.archived ? "Put back" : "Remove"}
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{item.updatedByName ? `Updated by ${item.updatedByName}` : ""}</span>
      </div>
    </div>
  );
}

type Form = Record<"title" | "brand" | "kind" | "supplier" | "location" | "size" | "quantity" | "status" | "startsOn" | "endsOn" | "cost" | "audience" | "linkUrl" | "contactName" | "contactEmail" | "contactPhone" | "notes", string>;

function blankForm(def: OfflineChannelDef, i: OfflineItem | null): Form {
  return {
    title: i?.title ?? "",
    brand: i?.brand ?? "none",
    kind: i?.kind ?? "none",
    supplier: i?.supplier ?? "",
    location: i?.location ?? "",
    size: i?.size ?? "",
    quantity: i?.quantity != null ? String(i.quantity) : "",
    status: i?.status ?? def.statuses[0].key,
    startsOn: i?.startsOn ?? "",
    endsOn: i?.endsOn ?? "",
    cost: i?.costCents != null ? centsToDollarInput(i.costCents) : "",
    audience: i?.audience != null ? String(i.audience) : "",
    linkUrl: i?.linkUrl ?? "",
    contactName: i?.contactName ?? "",
    contactEmail: i?.contactEmail ?? "",
    contactPhone: i?.contactPhone ?? "",
    notes: i?.notes ?? "",
  };
}

function ItemDialog({ def, item, onClose }: { def: OfflineChannelDef; item: OfflineItem | null; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => blankForm(def, item));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setForm(blankForm(def, item));
    setError(null);
  }, [def, item]);
  const set = (k: keyof Form) => (v: string) => setForm((s) => ({ ...s, [k]: v }));

  const body = () => ({
    title: form.title,
    brand: form.brand === "none" ? null : form.brand,
    kind: form.kind === "none" ? null : form.kind,
    supplier: form.supplier,
    location: form.location,
    size: form.size,
    quantity: form.quantity.trim() === "" ? null : Number(form.quantity),
    status: form.status,
    startsOn: form.startsOn || null,
    endsOn: form.endsOn || null,
    // A blank cost stays blank: it is "not entered", not $0.
    costCents: form.cost.trim() === "" ? null : dollarInputToCents(form.cost),
    audience: form.audience.trim() === "" ? null : Number(form.audience.replace(/,/g, "")),
    linkUrl: form.linkUrl,
    contactName: form.contactName,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
    notes: form.notes,
  });

  const save = useMutation({
    mutationFn: async () => {
      const b = body();
      const checked = parseOfflineInput(def, b);
      if ("error" in checked) throw new Error(checked.error);
      if (item) await apiRequest("PATCH", `/api/admin/offline-marketing/${def.key}/${item.id}`, b);
      else await apiRequest("POST", `/api/admin/offline-marketing/${def.key}`, b);
    },
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (e: any) => setError(String(e?.message ?? "That could not be saved.").replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1")),
  });

  const field = (id: string, label: string, node: React.ReactNode, wide = false) => (
    <div className={cn("space-y-1.5 min-w-0", wide && "sm:col-span-2")}>
      <Label htmlFor={id}>{label}</Label>
      {node}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${def.noun}` : def.addLabel}</DialogTitle>
          <DialogDescription>Only the name is needed. Leave anything you do not know blank.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          {field("om-title", def.labels.title, <Input id="om-title" className={control} value={form.title} onChange={(e) => set("title")(e.target.value)} autoComplete="off" data-testid="offline-title" />, true)}
          {def.fields.brand &&
            field("om-brand", "Brand",
              <Select value={form.brand} onValueChange={set("brand")}>
                <SelectTrigger id="om-brand" className={control}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No brand</SelectItem>
                  {SOCIAL_BRANDS.map((b) => <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>)}
          {field("om-kind", "Type",
            <Select value={form.kind} onValueChange={set("kind")}>
              <SelectTrigger id="om-kind" className={control}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {def.kinds.map((k) => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}
              </SelectContent>
            </Select>)}
          {field("om-status", "Status",
            <Select value={form.status} onValueChange={set("status")}>
              <SelectTrigger id="om-status" className={control}><SelectValue /></SelectTrigger>
              <SelectContent>{def.statuses.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
            </Select>)}
          {field("om-supplier", def.labels.supplier, <Input id="om-supplier" className={control} value={form.supplier} onChange={(e) => set("supplier")(e.target.value)} autoComplete="off" />)}
          {field("om-location", def.labels.location, <Input id="om-location" className={control} value={form.location} onChange={(e) => set("location")(e.target.value)} autoComplete="off" />, !def.fields.size)}
          {def.fields.size && field("om-size", "Size", <Input id="om-size" className={control} value={form.size} onChange={(e) => set("size")(e.target.value)} placeholder="e.g. 3000 × 1000 mm" autoComplete="off" />)}
          {def.fields.quantity && field("om-qty", "How many", <Input id="om-qty" className={control} inputMode="numeric" value={form.quantity} onChange={(e) => set("quantity")(e.target.value.replace(/[^0-9]/g, ""))} autoComplete="off" />)}
          {def.fields.dates && field("om-start", def.labels.starts, <DatePickerInput value={form.startsOn} onChange={(e) => set("startsOn")(e.target.value)} className={control} />)}
          {def.fields.dates && field("om-end", def.labels.ends, <DatePickerInput value={form.endsOn} onChange={(e) => set("endsOn")(e.target.value)} className={control} />)}
          {def.labels.cost && field("om-cost", def.labels.cost, <MoneyInput id="om-cost" className={control} value={form.cost} onChange={set("cost")} />)}
          {def.labels.audience && field("om-aud", def.labels.audience, <Input id="om-aud" className={control} inputMode="numeric" value={form.audience} onChange={(e) => set("audience")(e.target.value.replace(/[^0-9,]/g, ""))} autoComplete="off" />)}
          {def.fields.contact && field("om-cn", "Contact name", <Input id="om-cn" className={control} value={form.contactName} onChange={(e) => set("contactName")(e.target.value)} autoComplete="off" />)}
          {def.fields.contact && field("om-ce", "Contact email", <Input id="om-ce" className={control} inputMode="email" value={form.contactEmail} onChange={(e) => set("contactEmail")(e.target.value)} autoComplete="off" />)}
          {def.fields.contact && field("om-cp", "Contact phone", <Input id="om-cp" className={control} inputMode="tel" value={form.contactPhone} onChange={(e) => set("contactPhone")(e.target.value)} autoComplete="off" />)}
          {field("om-link", def.labels.link, <Input id="om-link" className={control} inputMode="url" value={form.linkUrl} onChange={(e) => set("linkUrl")(e.target.value)} placeholder="https://" autoComplete="off" />, true)}
          {field("om-notes", "Notes", <Textarea id="om-notes" rows={3} value={form.notes} onChange={(e) => set("notes")(e.target.value)} />, true)}
          {error && <p role="alert" className="sm:col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" className={control} onClick={onClose}>Cancel</Button>
            <Button type="submit" className={control} disabled={save.isPending || !form.title.trim()} data-testid="offline-save">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SIGNAGE: ListTab[] = [{ key: "signage", label: "Signage" }];
const BILLBOARDS: ListTab[] = [{ key: "billboards", label: "Billboards" }];
const MEDIA: ListTab[] = [
  { key: "media-coverage", label: "Coverage and adverts" },
  { key: "media-outlets", label: "Outlets" },
];

export function SignagePage() {
  return <OfflinePage path="/admin/signage" title="Signage" blurb="Every banner, board and sign the club puts up or prints itself: where it is, when it went up and when it comes down." lists={SIGNAGE} />;
}
export function BillboardsPage() {
  return <OfflinePage path="/admin/billboards" title="Billboards" blurb="Campaigns booked with billboard companies such as Go Media: the sites, the dates, what it cost and what they reported." lists={BILLBOARDS} />;
}
export function TraditionalMediaPage() {
  return <OfflinePage path="/admin/traditional-media" title="Traditional Media" blurb="TV, radio and news outlets the club can send stories and adverts to, and what has gone out through them." lists={MEDIA} />;
}
