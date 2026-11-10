// Campaigns — shared pieces: formatting, the goal bar, the multi-pick list and
// the four forms (campaign, channel, task, split test).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { centsToDollarInput, dollarInputToCents, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_KINDS,
  CHANNEL_STATUSES,
  CHANNEL_STATUS_LABEL,
  PACE_LABEL,
  TASK_KINDS,
  TASK_KIND_LABEL,
  TEST_STATUSES,
  TEST_STATUS_LABEL,
  channelKind,
  type CampaignOptions,
  type CampaignRow,
  type ChannelRow,
  type Pace,
  type TaskRow,
  type TestRow,
} from "@shared/campaigns";
import { SOCIAL_BRANDS } from "@shared/social";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-12-21" → "21 Dec 2026", by splitting the string. */
export function niceDay(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}${withYear ? ` ${y}` : ""}`;
}
export function dayRange(a: string | null, b: string | null): string {
  if (!a && !b) return "No dates set";
  if (a && b && a !== b) return `${niceDay(a, a.slice(0, 4) !== b.slice(0, 4))} – ${niceDay(b)}`;
  return niceDay(a ?? b);
}
export const dollars = (cents: number | null | undefined) => (cents == null ? "—" : formatCurrency(cents, { fromCents: true }));
export const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-NZ"));

export function refreshCampaigns() {
  return queryClient.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === "string" && (query.queryKey[0] as string).startsWith("/api/admin/campaigns"),
  });
}

/** Pull the server's own sentence out of an apiRequest error ("400: {"message":"…"}"). */
export function errorText(e: unknown): string {
  const raw = String((e as any)?.message ?? "That did not work.");
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  return m ? m[1].replace(/\\"/g, '"') : raw.replace(/^\d+:\s*/, "");
}

const PACE_TONE: Record<Pace["state"], string> = {
  reached: "bg-emerald-100 text-emerald-800",
  ahead: "bg-emerald-100 text-emerald-800",
  on_track: "bg-blue-100 text-blue-800",
  behind: "bg-amber-100 text-amber-900",
  missed: "bg-red-100 text-red-800",
  not_started: "bg-muted text-muted-foreground",
  none: "",
};

export function PacePill({ state }: { state: Pace["state"] }) {
  if (state === "none") return null;
  return <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", PACE_TONE[state])}>{PACE_LABEL[state]}</span>;
}

/** Actual against a goal. With no goal, the actual on its own — never a bar to nowhere. */
export function GoalBar({ label, actual, goal, format, pace }: { label: string; actual: number | null; goal: number | null; format: (v: number) => string; pace?: Pace }) {
  const pct = goal && goal > 0 && actual != null ? Math.min(100, Math.round((actual / goal) * 100)) : null;
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {pace && <PacePill state={pace.state} />}
      </div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-xl font-semibold tabular-nums text-foreground">{actual == null ? "—" : format(actual)}</span>
        <span className="text-sm text-muted-foreground">{goal != null ? `of ${format(goal)}` : "no goal set"}</span>
        {pct != null && <span className="text-sm text-muted-foreground tabular-nums">· {goal && actual != null ? Math.round((actual / goal) * 100) : 0}%</span>}
      </div>
      {pct != null && (
        <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-600" : "bg-primary")} style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
      )}
    </div>
  );
}

export function useCampaignOptions(enabled: boolean) {
  return useQuery<CampaignOptions>({ queryKey: ["/api/admin/campaigns/options"], enabled, staleTime: 5 * 60_000 });
}

// ── Pick several from a long list ───────────────────────────────────────────

type PickItem = { value: string; label: string; sub?: string };

export function MultiPick({ items, value, onChange, placeholder, empty }: { items: PickItem[]; value: string[]; onChange: (v: string[]) => void; placeholder: string; empty: string }) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? items.filter((i) => `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(f)) : items;
    // Ticked ones first, so what is linked is never lost down a long list.
    return [...list].sort((a, b) => Number(value.includes(b.value)) - Number(value.includes(a.value)));
  }, [items, filter, value]);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="rounded-lg border border-border">
      {items.length > 8 && (
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={placeholder} className="h-11 md:h-9 border-0 border-b border-border rounded-none rounded-t-lg focus-visible:ring-0" />
      )}
      <div className="max-h-48 overflow-y-auto p-1">
        {shown.length === 0 && <p className="p-2 text-sm text-muted-foreground">{empty}</p>}
        {shown.slice(0, 120).map((i) => (
          <label key={i.value} className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted cursor-pointer min-h-[44px] md:min-h-0">
            <Checkbox checked={value.includes(i.value)} onCheckedChange={() => toggle(i.value)} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-sm text-foreground break-words">{i.label}</span>
              {i.sub && <span className="block text-xs text-muted-foreground">{i.sub}</span>}
            </span>
          </label>
        ))}
      </div>
      {value.length > 0 && <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{value.length} picked</p>}
    </div>
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const control = "h-11 md:h-9";
const NONE = "__none";

function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <DatePickerInput value={value} onChange={(e) => onChange(e.target.value)} className={control} />;
}

function FormShell({
  open,
  onClose,
  title,
  description,
  error,
  saving,
  onSubmit,
  submitLabel,
  onDelete,
  deleteLabel,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  error: string | null;
  saving: boolean;
  onSubmit: () => void;
  submitLabel: string;
  onDelete?: () => void;
  deleteLabel?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (open) setConfirm(false);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto overflow-x-hidden min-w-0", wide ? "max-w-2xl" : "max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-4 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {onDelete &&
                (confirm ? (
                  <span className="inline-flex gap-2">
                    <Button type="button" variant="destructive" className={control} onClick={onDelete}>{deleteLabel ?? "Remove"}</Button>
                    <Button type="button" variant="ghost" className={control} onClick={() => setConfirm(false)}>Keep</Button>
                  </span>
                ) : (
                  <Button type="button" variant="ghost" className={cn(control, "text-muted-foreground")} onClick={() => setConfirm(true)}>{deleteLabel ?? "Remove"}</Button>
                ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" className={control} onClick={onClose}>Cancel</Button>
              <Button type="submit" className={control} disabled={saving} data-testid="form-save">{saving ? "Saving…" : submitLabel}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useSave(run: () => Promise<unknown>, done: (result: any) => void) {
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: run,
    onSuccess: async (r) => {
      await refreshCampaigns();
      done(r);
    },
    onError: (e) => setError(errorText(e)),
  });
  return { error, setError, saving: m.isPending, save: () => { setError(null); m.mutate(); } };
}

const moneyOrNull = (v: string) => (v.trim() === "" ? null : dollarInputToCents(v));
const intOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[,\s]/g, "")));

// ── Campaign ────────────────────────────────────────────────────────────────

export function CampaignDialog({ open, onClose, campaign, onSaved }: { open: boolean; onClose: () => void; campaign: CampaignRow | null; onSaved: (id: number) => void }) {
  const options = useCampaignOptions(open);
  const [f, setF] = useState({
    name: "", brand: "", status: "planning", startsOn: "", endsOn: "", eventStartsOn: "", eventEndsOn: "",
    goalSignups: "", goalRevenue: "", budget: "", programIds: [] as string[], ownerUserId: "", summary: "", manualSignups: "", manualRevenue: "",
  });
  useEffect(() => {
    if (!open) return;
    const c = campaign;
    setF({
      name: c?.name ?? "",
      brand: c?.brand ?? "",
      status: c?.status ?? "planning",
      startsOn: c?.startsOn ?? "",
      endsOn: c?.endsOn ?? "",
      eventStartsOn: c?.eventStartsOn ?? "",
      eventEndsOn: c?.eventEndsOn ?? "",
      goalSignups: c?.goalSignups != null ? String(c.goalSignups) : "",
      goalRevenue: c?.goalRevenueCents != null ? centsToDollarInput(c.goalRevenueCents) : "",
      budget: c?.budgetCents != null ? centsToDollarInput(c.budgetCents) : "",
      programIds: (c?.programIds ?? []).map(String),
      ownerUserId: c?.ownerUserId != null ? String(c.ownerUserId) : "",
      summary: c?.summary ?? "",
      manualSignups: c?.manualSignups != null ? String(c.manualSignups) : "",
      manualRevenue: c?.manualRevenueCents != null ? centsToDollarInput(c.manualRevenueCents) : "",
    });
  }, [open, campaign]);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const s = useSave(
    async () => {
      const body = {
        name: f.name,
        brand: f.brand || null,
        status: f.status,
        startsOn: f.startsOn || null,
        endsOn: f.endsOn || null,
        eventStartsOn: f.eventStartsOn || null,
        eventEndsOn: f.eventEndsOn || null,
        goalSignups: intOrNull(f.goalSignups),
        goalRevenueCents: moneyOrNull(f.goalRevenue),
        budgetCents: moneyOrNull(f.budget),
        programIds: f.programIds.map(Number),
        ownerUserId: f.ownerUserId ? Number(f.ownerUserId) : null,
        summary: f.summary || null,
        manualSignups: f.programIds.length ? null : intOrNull(f.manualSignups),
        manualRevenueCents: f.programIds.length ? null : moneyOrNull(f.manualRevenue),
      };
      if (campaign) {
        await apiRequest("PATCH", `/api/admin/campaigns/${campaign.id}`, body);
        return { id: campaign.id };
      }
      return (await apiRequest("POST", "/api/admin/campaigns", body)).json();
    },
    (r) => {
      onClose();
      onSaved(r.id);
    },
  );
  const programmes = (options.data?.programmes ?? []).map((p) => ({
    value: String(p.id),
    label: p.name,
    sub: [p.workspace, p.startsOn ? `starts ${niceDay(p.startsOn)}` : null, p.active ? null : "not on sale"].filter(Boolean).join(" · "),
  }));
  return (
    <FormShell
      open={open}
      onClose={onClose}
      wide
      title={campaign ? "Edit campaign" : "New campaign"}
      description="Set the goal and link what ClubOS is selling. The numbers then update on their own."
      error={s.error}
      saving={s.saving}
      onSubmit={s.save}
      submitLabel={campaign ? "Save" : "Create campaign"}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Campaign name" className="sm:col-span-2">
          <Input className={control} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. December holiday camps" autoFocus data-testid="campaign-name" />
        </Field>
        <Field label="Brand">
          <Select value={f.brand || NONE} onValueChange={(v) => set({ brand: v === NONE ? "" : v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No brand</SelectItem>
              {SOCIAL_BRANDS.map((b) => <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              {CAMPAIGN_STATUSES.map((st) => <SelectItem key={st} value={st}>{CAMPAIGN_STATUS_LABEL[st]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Sign-up goal" hint="Bookings. Leave blank for no goal.">
          <Input className={control} inputMode="numeric" value={f.goalSignups} onChange={(e) => set({ goalSignups: e.target.value.replace(/[^0-9]/g, "") })} placeholder="e.g. 120" data-testid="campaign-goal-signups" />
        </Field>
        <Field label="Revenue goal" hint="Leave blank for no goal.">
          <MoneyInput className={control} value={f.goalRevenue} onChange={(v) => set({ goalRevenue: v })} placeholder="e.g. 15000" />
        </Field>
        <Field label="Selling starts" hint="Sales from this day count toward the goal.">
          <DateField value={f.startsOn} onChange={(v) => set({ startsOn: v })} />
        </Field>
        <Field label="Selling ends">
          <DateField value={f.endsOn} onChange={(v) => set({ endsOn: v })} />
        </Field>
        <Field label="First day of the event" hint="The timeline counts back from this.">
          <DateField value={f.eventStartsOn} onChange={(v) => set({ eventStartsOn: v })} />
        </Field>
        <Field label="Last day of the event">
          <DateField value={f.eventEndsOn} onChange={(v) => set({ eventEndsOn: v })} />
        </Field>
        <Field label="Budget to spend" hint="Ads, print, shoots.">
          <MoneyInput className={control} value={f.budget} onChange={(v) => set({ budget: v })} />
        </Field>
        <Field label="Who is running it">
          <Select value={f.ownerUserId || NONE} onValueChange={(v) => set({ ownerUserId: v === NONE ? "" : v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nobody yet</SelectItem>
              {(options.data?.people ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="What is being sold" hint="Pick the camps or programmes. Their paid bookings become this campaign's result." className="sm:col-span-2">
          {options.isLoading ? <p className="text-sm text-muted-foreground">Loading programmes…</p> : (
            <MultiPick items={programmes} value={f.programIds} onChange={(v) => set({ programIds: v })} placeholder="Search programmes" empty="No programme matches." />
          )}
        </Field>
        {f.programIds.length === 0 && (
          <>
            <Field label="Sign-ups so far" hint="Only when nothing above is picked: type the number in.">
              <Input className={control} inputMode="numeric" value={f.manualSignups} onChange={(e) => set({ manualSignups: e.target.value.replace(/[^0-9]/g, "") })} />
            </Field>
            <Field label="Revenue so far">
              <MoneyInput className={control} value={f.manualRevenue} onChange={(v) => set({ manualRevenue: v })} />
            </Field>
          </>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.summary} onChange={(e) => set({ summary: e.target.value })} rows={3} placeholder="The offer, who it is for, anything the team should know." />
        </Field>
      </div>
    </FormShell>
  );
}

// ── Channel ─────────────────────────────────────────────────────────────────

export function ChannelDialog({ open, onClose, campaignId, channel }: { open: boolean; onClose: () => void; campaignId: number; channel: ChannelRow | null }) {
  const options = useCampaignOptions(open);
  const [f, setF] = useState({ kind: "meta_ads", name: "", status: "planned", startsOn: "", endsOn: "", budget: "", meta: [] as string[], emails: [] as string[], utm: "", code: "", spend: "", notes: "" });
  useEffect(() => {
    if (!open) return;
    const c = channel;
    setF({
      kind: c?.kind ?? "meta_ads",
      name: c?.name ?? "",
      status: c?.status ?? "planned",
      startsOn: c?.startsOn ?? "",
      endsOn: c?.endsOn ?? "",
      budget: c?.budgetCents != null ? centsToDollarInput(c.budgetCents) : "",
      meta: c?.metaCampaignIds ?? [],
      emails: (c?.emailCampaignIds ?? []).map(String),
      utm: c?.utmCampaign ?? "",
      code: c?.discountCode ?? "",
      spend: c?.manualSpendCents != null ? centsToDollarInput(c.manualSpendCents) : "",
      notes: c?.notes ?? "",
    });
  }, [open, channel]);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const kind = channelKind(f.kind);
  const base = `/api/admin/campaigns/${campaignId}/channels`;
  const s = useSave(async () => {
    const body = {
      kind: f.kind,
      name: f.name || kind.label,
      status: f.status,
      startsOn: f.startsOn || null,
      endsOn: f.endsOn || null,
      budgetCents: moneyOrNull(f.budget),
      metaCampaignIds: kind.links.includes("meta") ? f.meta : [],
      emailCampaignIds: kind.links.includes("email") ? f.emails.map(Number) : [],
      utmCampaign: kind.links.includes("utm") ? f.utm || null : null,
      discountCode: kind.links.includes("discount") ? f.code || null : null,
      manualSpendCents: kind.links.includes("spend") ? moneyOrNull(f.spend) : null,
      notes: f.notes || null,
    };
    await apiRequest(channel ? "PATCH" : "POST", channel ? `${base}/${channel.id}` : base, body);
  }, onClose);
  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `${base}/${channel!.id}`); },
    onSuccess: async () => { await refreshCampaigns(); onClose(); },
  });
  return (
    <FormShell
      open={open}
      onClose={onClose}
      wide
      title={channel ? "Edit channel" : "Add a channel"}
      description="A way this campaign reaches people. What you link decides what ClubOS can measure."
      error={s.error}
      saving={s.saving}
      onSubmit={s.save}
      submitLabel={channel ? "Save" : "Add channel"}
      onDelete={channel ? () => remove.mutate() : undefined}
      deleteLabel="Remove channel"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" className="sm:col-span-2" hint={kind.hint}>
          <Select value={f.kind} onValueChange={(v) => set({ kind: v })}>
            <SelectTrigger className={control} data-testid="channel-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNEL_KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Name" hint="Leave blank to use the kind.">
          <Input className={control} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={kind.label} data-testid="channel-name" />
        </Field>
        <Field label="Status">
          <Select value={f.status} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNEL_STATUSES.map((st) => <SelectItem key={st} value={st}>{CHANNEL_STATUS_LABEL[st]}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Starts"><DateField value={f.startsOn} onChange={(v) => set({ startsOn: v })} /></Field>
        <Field label="Ends"><DateField value={f.endsOn} onChange={(v) => set({ endsOn: v })} /></Field>
        <Field label="Budget"><MoneyInput className={control} value={f.budget} onChange={(v) => set({ budget: v })} /></Field>
        {kind.links.includes("spend") && (
          <Field label="Spent so far" hint="ClubOS cannot see this spend, so type it in.">
            <MoneyInput className={control} value={f.spend} onChange={(v) => set({ spend: v })} />
          </Field>
        )}
        {kind.links.includes("meta") && (
          <Field label="Ad campaigns" className="sm:col-span-2" hint="From the club's Facebook and Instagram ad accounts. Spend and bookings follow.">
            <MultiPick
              items={(options.data?.metaCampaigns ?? []).map((m) => ({ value: m.id, label: m.name, sub: `last ran ${niceDay(m.lastDay)} · ${dollars(m.spendCents)} spent` }))}
              value={f.meta}
              onChange={(v) => set({ meta: v })}
              placeholder="Search ad campaigns"
              empty="No ad campaign matches."
            />
          </Field>
        )}
        {kind.links.includes("email") && (
          <Field label="Emails" className="sm:col-span-2" hint="Sent from the Mailer. Send the email first, then tick it here.">
            <MultiPick
              items={(options.data?.emailCampaigns ?? []).map((e) => ({ value: String(e.id), label: e.subject, sub: `${niceDay(e.day)} · delivered to ${num(e.sent)}` }))}
              value={f.emails}
              onChange={(v) => set({ emails: v })}
              placeholder="Search emails"
              empty="No email matches."
            />
          </Field>
        )}
        {kind.links.includes("utm") && (
          <Field label="Campaign name on the link" className="sm:col-span-2" hint="The utm_campaign on this channel's links, e.g. summer-camps-email. Visitors and bookings that arrive on it are counted.">
            <Input className={control} value={f.utm} onChange={(e) => set({ utm: e.target.value.trim() })} placeholder="e.g. dec-camps-2026" />
          </Field>
        )}
        {kind.links.includes("discount") && (
          <Field label="Discount code" className="sm:col-span-2" hint="Bookings that used this code are counted.">
            <Input className={control} value={f.code} onChange={(e) => set({ code: e.target.value.trim() })} placeholder="e.g. EARLYBIRD" />
            {(options.data?.discountCodes ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(options.data?.discountCodes ?? []).slice(0, 14).map((c) => (
                  <button key={c} type="button" onClick={() => set({ code: c })} className="rounded-md border border-border px-2 min-h-[32px] text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
        </Field>
      </div>
    </FormShell>
  );
}

// ── Task ────────────────────────────────────────────────────────────────────

export function TaskDialog({ open, onClose, campaignId, task, channels, defaultDue }: { open: boolean; onClose: () => void; campaignId: number; task: TaskRow | null; channels: ChannelRow[]; defaultDue?: string | null }) {
  const options = useCampaignOptions(open);
  const [f, setF] = useState({ title: "", kind: "task", dueOn: "", channelId: "", ownerUserId: "", notes: "" });
  useEffect(() => {
    if (!open) return;
    setF({
      title: task?.title ?? "",
      kind: task?.kind ?? "task",
      dueOn: task?.dueOn ?? defaultDue ?? "",
      channelId: task?.channelId != null ? String(task.channelId) : "",
      ownerUserId: task?.ownerUserId != null ? String(task.ownerUserId) : "",
      notes: task?.notes ?? "",
    });
  }, [open, task, defaultDue]);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const base = `/api/admin/campaigns/${campaignId}/tasks`;
  const s = useSave(async () => {
    const body = { title: f.title, kind: f.kind, dueOn: f.dueOn || null, channelId: f.channelId ? Number(f.channelId) : null, ownerUserId: f.ownerUserId ? Number(f.ownerUserId) : null, notes: f.notes || null };
    await apiRequest(task ? "PATCH" : "POST", task ? `${base}/${task.id}` : base, body);
  }, onClose);
  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `${base}/${task!.id}`); },
    onSuccess: async () => { await refreshCampaigns(); onClose(); },
  });
  return (
    <FormShell open={open} onClose={onClose} title={task ? "Edit task" : "Add a task"} error={s.error} saving={s.saving} onSubmit={s.save} submitLabel={task ? "Save" : "Add task"} onDelete={task ? () => remove.mutate() : undefined} deleteLabel="Remove task">
      <Field label="What needs doing">
        <Input className={control} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Shoot day at USC" autoFocus data-testid="task-title" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Due"><DateField value={f.dueOn} onChange={(v) => set({ dueOn: v })} /></Field>
        <Field label="Kind">
          <Select value={f.kind} onValueChange={(v) => set({ kind: v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>{TASK_KINDS.map((k) => <SelectItem key={k} value={k}>{TASK_KIND_LABEL[k]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Who">
          <Select value={f.ownerUserId || NONE} onValueChange={(v) => set({ ownerUserId: v === NONE ? "" : v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nobody yet</SelectItem>
              {(options.data?.people ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Part of">
          <Select value={f.channelId || NONE} onValueChange={(v) => set({ channelId: v === NONE ? "" : v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>The whole campaign</SelectItem>
              {channels.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} /></Field>
    </FormShell>
  );
}

// ── Split test ──────────────────────────────────────────────────────────────

type VariantDraft = { id: number | null; label: string; description: string; utmContent: string; landingPath: string; manualVisitors: string; manualConversions: string };

export function TestDialog({ open, onClose, campaignId, test, channels }: { open: boolean; onClose: () => void; campaignId: number; test: TestRow | null; channels: ChannelRow[] }) {
  const [f, setF] = useState({ name: "", variable: "", hypothesis: "", status: "planned", startsOn: "", endsOn: "", channelId: "", conclusion: "", winner: "" });
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  useEffect(() => {
    if (!open) return;
    setF({
      name: test?.name ?? "",
      variable: test?.variable ?? "",
      hypothesis: test?.hypothesis ?? "",
      status: test?.status ?? "planned",
      startsOn: test?.startsOn ?? "",
      endsOn: test?.endsOn ?? "",
      channelId: test?.channelId != null ? String(test.channelId) : "",
      conclusion: test?.conclusion ?? "",
      winner: test?.winnerVariantId != null ? String(test.winnerVariantId) : "",
    });
    setRemoved([]);
    setVariants(
      test
        ? test.variants.map((v) => ({ id: v.id, label: v.label, description: v.description ?? "", utmContent: v.utmContent ?? "", landingPath: v.landingPath ?? "", manualVisitors: v.manualVisitors != null ? String(v.manualVisitors) : "", manualConversions: v.manualConversions != null ? String(v.manualConversions) : "" }))
        : [
            { id: null, label: "A", description: "", utmContent: "", landingPath: "", manualVisitors: "", manualConversions: "" },
            { id: null, label: "B", description: "", utmContent: "", landingPath: "", manualVisitors: "", manualConversions: "" },
          ],
    );
  }, [open, test]);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const setVariant = (i: number, patch: Partial<VariantDraft>) => setVariants((prev) => prev.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const base = `/api/admin/campaigns/${campaignId}/tests`;
  const s = useSave(async () => {
    const body = { name: f.name, variable: f.variable || null, hypothesis: f.hypothesis || null, status: f.status, startsOn: f.startsOn || null, endsOn: f.endsOn || null, channelId: f.channelId ? Number(f.channelId) : null, conclusion: f.conclusion || null };
    let testId = test?.id ?? null;
    let existing: { id: number; label: string }[] = test?.variants.map((v) => ({ id: v.id, label: v.label })) ?? [];
    if (testId == null) {
      testId = (await (await apiRequest("POST", base, body)).json()).id as number;
      // A new test is born with A and B; read their ids so the drafts land on them.
      const fresh = await (await apiRequest("GET", `/api/admin/campaigns/${campaignId}`)).json();
      existing = (fresh.tests as TestRow[]).find((t) => t.id === testId)?.variants.map((v) => ({ id: v.id, label: v.label })) ?? [];
    } else {
      await apiRequest("PATCH", `${base}/${testId}`, { ...body, winnerVariantId: f.winner ? Number(f.winner) : null });
    }
    for (const rid of removed) await apiRequest("DELETE", `${base}/${testId}/variants/${rid}`);
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const payload = { label: v.label, description: v.description || null, utmContent: v.utmContent || null, landingPath: v.landingPath || null, manualVisitors: intOrNull(v.manualVisitors), manualConversions: intOrNull(v.manualConversions) };
      const target = v.id ?? (test ? null : existing[i]?.id ?? null);
      if (target != null) await apiRequest("PATCH", `${base}/${testId}/variants/${target}`, payload);
      else await apiRequest("POST", `${base}/${testId}/variants`, payload);
    }
  }, onClose);
  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `${base}/${test!.id}`); },
    onSuccess: async () => { await refreshCampaigns(); onClose(); },
  });
  const nextLabel = String.fromCharCode(65 + variants.length);
  return (
    <FormShell
      open={open}
      onClose={onClose}
      wide
      title={test ? "Edit split test" : "New split test"}
      description="Change one thing, give each version its own link, and ClubOS counts visitors and bookings for each."
      error={s.error}
      saving={s.saving}
      onSubmit={s.save}
      submitLabel={test ? "Save" : "Create test"}
      onDelete={test ? () => remove.mutate() : undefined}
      deleteLabel="Remove test"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Test name"><Input className={control} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Landing page headline" autoFocus data-testid="test-name" /></Field>
        <Field label="The one thing that changes"><Input className={control} value={f.variable} onChange={(e) => set({ variable: e.target.value })} placeholder="Headline, picture, price shown…" /></Field>
        <Field label="What we expect" className="sm:col-span-2"><Textarea rows={2} value={f.hypothesis} onChange={(e) => set({ hypothesis: e.target.value })} placeholder="e.g. Showing the price up front brings fewer clicks but more bookings." /></Field>
        <Field label="Status">
          <Select value={f.status} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>{TEST_STATUSES.map((st) => <SelectItem key={st} value={st}>{TEST_STATUS_LABEL[st]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Part of">
          <Select value={f.channelId || NONE} onValueChange={(v) => set({ channelId: v === NONE ? "" : v })}>
            <SelectTrigger className={control}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>The whole campaign</SelectItem>
              {channels.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Starts"><DateField value={f.startsOn} onChange={(v) => set({ startsOn: v })} /></Field>
        <Field label="Ends"><DateField value={f.endsOn} onChange={(v) => set({ endsOn: v })} /></Field>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Versions</p>
        {variants.map((v, i) => (
          <div key={v.id ?? `new-${i}`} className="rounded-lg border border-border p-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[90px_1fr_auto] items-end">
              <Field label="Label"><Input className={control} value={v.label} onChange={(e) => setVariant(i, { label: e.target.value })} /></Field>
              <Field label="What this version is"><Input className={control} value={v.description} onChange={(e) => setVariant(i, { description: e.target.value })} placeholder="e.g. Headline says the price" /></Field>
              {variants.length > 2 && (
                <Button type="button" variant="ghost" className={cn(control, "text-muted-foreground")} onClick={() => { if (v.id != null) setRemoved((r) => [...r, v.id!]); setVariants((prev) => prev.filter((_, j) => j !== i)); }}>Remove</Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tag on its link" hint="The utm_content on this version's link. Visitors and bookings are counted from it.">
                <Input className={control} value={v.utmContent} onChange={(e) => setVariant(i, { utmContent: e.target.value.trim() })} placeholder="e.g. headline-price" />
              </Field>
              <Field label="Or the page it lands on" hint="A path on the booking sites, e.g. /lp/juniors-b. Counts visitors only.">
                <Input className={control} value={v.landingPath} onChange={(e) => setVariant(i, { landingPath: e.target.value.trim() })} placeholder="/…" />
              </Field>
              <Field label="Visitors, typed in" hint="Only if it has no link or page above.">
                <Input className={control} inputMode="numeric" value={v.manualVisitors} onChange={(e) => setVariant(i, { manualVisitors: e.target.value.replace(/[^0-9]/g, "") })} />
              </Field>
              <Field label="Bookings, typed in">
                <Input className={control} inputMode="numeric" value={v.manualConversions} onChange={(e) => setVariant(i, { manualConversions: e.target.value.replace(/[^0-9]/g, "") })} />
              </Field>
            </div>
          </div>
        ))}
        {variants.length < 5 && (
          <Button type="button" variant="outline" className={control} onClick={() => setVariants((prev) => [...prev, { id: null, label: nextLabel, description: "", utmContent: "", landingPath: "", manualVisitors: "", manualConversions: "" }])}>
            Add version {nextLabel}
          </Button>
        )}
      </div>

      {test && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Our call" hint="Decided by a person. ClubOS only says which is ahead.">
            <Select value={f.winner || NONE} onValueChange={(v) => set({ winner: v === NONE ? "" : v })}>
              <SelectTrigger className={control}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not decided</SelectItem>
                {test.variants.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.label} wins</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="What we learned"><Textarea rows={2} value={f.conclusion} onChange={(e) => set({ conclusion: e.target.value })} /></Field>
        </div>
      )}
    </FormShell>
  );
}
