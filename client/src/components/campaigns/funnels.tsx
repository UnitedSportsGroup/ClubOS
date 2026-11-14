// Funnels — the drawing, the card with its numbers, the "what if" sums and the
// form. Used on a campaign's Funnels tab and on /admin/funnels.
//
// Daniel, 2026-11-14: "visualize it really beautifully … at each of those there
// are percentages … once we have those numbers, it becomes a math game."
//
// Every number drawn here comes from the server (shared/funnels.ts says how).
// The what-if panel is arithmetic on those numbers and is labelled as such.
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ChevronDown, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { DateField, Field, FormShell, MultiPick, control, dayRange, dollars, num, refreshCampaigns, useCampaignOptions, useSave } from "@/components/campaigns/parts";
import { apiRequest } from "@/lib/queryClient";
import { dollarInputToCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignRow, ChannelRow } from "@shared/campaigns";
import {
  DEFAULT_COST_RISE,
  WHAT_IF_MIN_BOOKINGS,
  funnelSteps,
  funnelSummary,
  normalisePage,
  oneIn,
  ratePct,
  volumeForRevenue,
  whatIf,
  type FunnelPageSuggestion,
  type FunnelStage,
  type FunnelStageKey,
  type FunnelView,
} from "@shared/funnels";

const whole = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-NZ"));
const wholeDollars = (cents: number | null | undefined) => (cents == null ? "—" : `$${Math.round(cents / 100).toLocaleString("en-NZ")}`);

// ── The drawing ─────────────────────────────────────────────────────────────

// Counts fall by a factor of a thousand from the ad to the sale. Drawn to scale
// the bottom of the funnel would be a hairline, so the band uses a gentle power
// scale: the order is always true, the exact proportions are in the numbers.
const bandShare = (count: number, max: number) => (max <= 0 ? 0.12 : Math.max(0.12, Math.pow(count / max, 0.3)));

const BAND = ["#1e2a5e", "#27408f", "#2f5bd0", "#2c7fd6", "#1f9fb5", "#10a37f"];
const bandColour = (i: number, n: number) => BAND[Math.min(BAND.length - 1, Math.round((i / Math.max(1, n - 1)) * (BAND.length - 1)))];

function stepNote(lost: number | null, rate: number | null) {
  if (rate != null && rate > 1) return "More arrived than clicked: people come back, or share the link";
  if (lost == null) return null;
  return `${whole(lost)} did not go on`;
}

function WideFunnel({ stages }: { stages: FunnelStage[] }) {
  const gid = useId().replace(/:/g, "");
  const counted = stages.filter((s) => s.count != null);
  const steps = funnelSteps(stages);
  const n = counted.length;
  const max = Math.max(...counted.map((s) => s.count ?? 0), 0);
  const W = 200;
  const H = 150;
  const mid = H / 2;
  const half = counted.map((s) => (bandShare(s.count ?? 0, max) * (H - 10)) / 2);
  // Each stage is flat across the middle of its column and eases into the next.
  const flat = 0.3;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * W + (i === 0 ? 0 : W * flat);
    const x1 = (i + 1) * W - (i === n - 1 ? 0 : W * flat);
    if (i === 0) top.push(`M ${x0} ${mid - half[i]}`);
    top.push(`L ${x1} ${mid - half[i]}`);
    if (i < n - 1) {
      const nx = (i + 1) * W + W * flat;
      const cx = (x1 + nx) / 2;
      top.push(`C ${cx} ${mid - half[i]}, ${cx} ${mid - half[i + 1]}, ${nx} ${mid - half[i + 1]}`);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const x0 = i * W + (i === 0 ? 0 : W * flat);
    const x1 = (i + 1) * W - (i === n - 1 ? 0 : W * flat);
    bottom.push(`L ${x1} ${mid + half[i]}`);
    bottom.push(`L ${x0} ${mid + half[i]}`);
    if (i > 0) {
      const px = i * W - W * flat;
      const cx = (x0 + px) / 2;
      bottom.push(`C ${cx} ${mid + half[i]}, ${cx} ${mid + half[i - 1]}, ${px} ${mid + half[i - 1]}`);
    }
  }
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  return (
    <div className="hidden lg:block" data-testid="funnel-wide">
      <div className="grid" style={cols}>
        {counted.map((s, i) => (
          <div key={s.key} className="px-3 pb-3 min-w-0" data-testid={`funnel-stage-${s.key}`}>
            <p className="text-[12px] leading-tight font-medium text-muted-foreground flex items-start gap-1.5 min-h-[30px]">
              <span className="inline-block w-2 h-2 rounded-full shrink-0 mt-[3px]" style={{ background: bandColour(i, n) }} aria-hidden />
              <span>{s.label}</span>
            </p>
            <p className="mt-1 text-[28px] leading-none font-semibold tracking-tight tabular-nums text-foreground" data-testid={`funnel-count-${s.key}`}>{num(s.count)}</p>
          </div>
        ))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${n * W} ${H}`} preserveAspectRatio="none" className="block w-full h-[150px]" role="img" aria-label="Funnel: how many people reach each step">
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="1" y1="0" y2="0">
              {counted.map((s, i) => (
                <stop key={s.key} offset={`${((i + 0.5) / n) * 100}%`} stopColor={bandColour(i, n)} />
              ))}
            </linearGradient>
          </defs>
          <path d={`${top.join(" ")} ${bottom.join(" ")} Z`} fill={`url(#g${gid})`} />
          {counted.slice(1).map((s, i) => (
            <line key={s.key} x1={(i + 1) * W} x2={(i + 1) * W} y1={0} y2={H} stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
          ))}
        </svg>
        {steps.map((st, i) => (
          <span
            key={st.to}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[12px] font-semibold tabular-nums text-foreground shadow-sm whitespace-nowrap"
            style={{ left: `${((i + 1) / n) * 100}%` }}
            data-testid={`funnel-rate-${st.to}`}
          >
            {ratePct(st.rate)}
            <ArrowRight className="w-3 h-3 text-muted-foreground" aria-hidden />
          </span>
        ))}
      </div>
      <div className="grid" style={cols}>
        {counted.map((s, i) => {
          const st = steps[i];
          return (
            <div key={s.key} className="px-3 pt-3 min-w-0">
              <p className="text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{s.detail}</p>
              {st && stepNote(st.lost, st.rate) && <p className="mt-1.5 text-[12px] leading-snug text-foreground/70">{stepNote(st.lost, st.rate)}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TallFunnel({ stages }: { stages: FunnelStage[] }) {
  const counted = stages.filter((s) => s.count != null);
  const steps = funnelSteps(stages);
  const n = counted.length;
  const max = Math.max(...counted.map((s) => s.count ?? 0), 0);
  return (
    <div className="lg:hidden space-y-0" data-testid="funnel-tall">
      {counted.map((s, i) => {
        const st = steps[i];
        return (
          <div key={s.key}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium text-foreground min-w-0">{s.label}</p>
              <p className="text-xl font-semibold tabular-nums text-foreground shrink-0">{num(s.count)}</p>
            </div>
            <div className="mt-1.5 flex justify-center">
              <div className="h-7 rounded-md" style={{ width: `${bandShare(s.count ?? 0, max) * 100}%`, background: bandColour(i, n) }} aria-hidden />
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{s.detail}</p>
            {st && (
              <div className="my-2.5 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
                <ArrowDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-semibold tabular-nums text-foreground">{ratePct(st.rate)}</span>
                <span className="min-w-0">{st.rate != null && st.rate > 1 ? "more arrived than clicked" : st.lost != null ? `${whole(st.lost)} did not go on` : "went on"}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const counted = stages.filter((s) => s.count != null);
  if (counted.length < 2) {
    return <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-4">Not enough is linked to draw this funnel yet. It needs a landing page, and something being sold.</p>;
  }
  return (
    <>
      <WideFunnel stages={stages} />
      <TallFunnel stages={stages} />
    </>
  );
}

// ── The numbers under the drawing ───────────────────────────────────────────

function Figure({ label, value, note, testid }: { label: string; value: string; note?: string | null; testid?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2.5" data-testid={testid}>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-foreground break-words">{value}</p>
      {note && <p className="text-[11.5px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  );
}

const stageLabel = (stages: FunnelStage[], key: FunnelStageKey) => stages.find((s) => s.key === key)?.label ?? key;

// ── What if ─────────────────────────────────────────────────────────────────

function WhatIf({ funnel }: { funnel: FunnelView }) {
  const [volume, setVolume] = useState(1);
  const [lifts, setLifts] = useState<Partial<Record<FunnelStageKey, number>>>({});
  const [costRise, setCostRise] = useState(DEFAULT_COST_RISE);
  const [target, setTarget] = useState("");
  const steps = useMemo(() => funnelSteps(funnel.stages), [funnel.stages]);
  const counted = funnel.stages.filter((s) => s.count != null);
  const result = useMemo(() => whatIf(funnel, { volume, lifts, costRise }), [funnel, volume, lifts, costRise]);
  const base = useMemo(() => whatIf(funnel, { volume: 1, lifts: {}, costRise: 0 }), [funnel]);
  const lever = counted.find((s) => s.key === "clicks") ?? counted[0];
  const leverNow = lever?.count ?? null;
  const leverThen = result.stages.find((s) => s.key === lever?.key)?.count ?? null;
  const changed = volume !== 1 || Object.values(lifts).some((v) => v !== 1 && v != null) || costRise !== DEFAULT_COST_RISE;
  const hasSpend = funnel.spendCents != null && funnel.spendCents > 0;
  const paidNow = funnel.bookings ?? 0;

  if (!funnel.bookings || !funnel.revenueCents) {
    return <p className="text-sm text-muted-foreground">Once this funnel has paid bookings, you can try out "what if we doubled the clicks" here. There is nothing to work from yet.</p>;
  }

  const applyTarget = () => {
    const cents = target.trim() === "" ? null : dollarInputToCents(target);
    if (!cents) return;
    const v = volumeForRevenue(funnel, cents, lifts);
    if (v != null) setVolume(Math.max(0.1, Math.min(50, Number(v.toFixed(2)))));
  };
  const sliderMax = Math.max(5, Math.ceil(volume));

  return (
    <div className="space-y-5" data-testid="funnel-whatif">
      {paidNow < WHAT_IF_MIN_BOOKINGS && (
        <p className="text-[13px] rounded-lg bg-amber-100 text-amber-900 px-3 py-2">
          This funnel has only {paidNow} paid booking{paidNow === 1 ? "" : "s"} so far. The rates will move a lot as more come in, so read these sums as rough.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5 min-w-0">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-foreground">More people in the top</p>
              <p className="text-sm tabular-nums text-foreground" data-testid="whatif-volume">
                {lever ? `${lever.label}: ${whole(leverNow)} → ${whole(leverThen)}` : ""} <span className="text-muted-foreground">({volume.toFixed(volume % 1 ? 1 : 0)}×)</span>
              </p>
            </div>
            <Slider min={0.5} max={sliderMax} step={0.1} value={[volume]} onValueChange={([v]) => setVolume(v)} aria-label="Times as many people coming in" className="py-2" />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Or work back from a revenue target</p>
            <div className="flex gap-2">
              <MoneyInput value={target} onChange={setTarget} placeholder="50,000" className={cn(control, "max-w-[11rem]")} aria-label="Revenue target in dollars" data-testid="whatif-target" />
              <Button type="button" variant="outline" className={control} onClick={applyTarget} data-testid="whatif-target-go">Work it out</Button>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Make a step work better</p>
            {steps.map((st) => {
              const lift = lifts[st.to] ?? 1;
              if (st.rate == null) return null;
              const shown = st.rate > 1 ? st.rate * lift : Math.min(1, st.rate * lift);
              return (
                <div key={st.to} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-muted-foreground min-w-0">{stageLabel(funnel.stages, st.from)} → {stageLabel(funnel.stages, st.to)}</span>
                    <span className="tabular-nums text-foreground shrink-0">
                      {ratePct(st.rate)}
                      {lift !== 1 && <> → <strong>{ratePct(shown)}</strong></>}
                    </span>
                  </div>
                  <Slider min={0.5} max={2} step={0.05} value={[lift]} onValueChange={([v]) => setLifts((prev) => ({ ...prev, [st.to]: v }))} aria-label={`How well ${stageLabel(funnel.stages, st.to)} works`} className="py-1.5" />
                </div>
              );
            })}
          </div>

          {hasSpend && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-foreground">Each time the volume doubles, a click costs</p>
                <p className="text-sm tabular-nums text-foreground">{Math.round(costRise * 100)}% more</p>
              </div>
              <Slider min={0} max={0.6} step={0.05} value={[costRise]} onValueChange={([v]) => setCostRise(v)} aria-label="How much dearer a click gets as volume doubles" className="py-2" />
              <p className="text-[12px] text-muted-foreground">A guess, not a measurement. The cheapest people to reach are reached first, so more volume costs more per click. Move it to see how much that matters.</p>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Projection, not a result</p>
            <div className="grid grid-cols-2 gap-3">
              <Figure label="Paid bookings" value={whole(result.bookings)} note={`now ${whole(base.bookings)}`} testid="whatif-bookings" />
              <Figure label="Revenue" value={wholeDollars(result.revenueCents)} note={`now ${wholeDollars(base.revenueCents)}`} testid="whatif-revenue" />
              <Figure label="Ad spend" value={hasSpend ? wholeDollars(result.spendCents) : "—"} note={hasSpend ? `now ${wholeDollars(funnel.spendCents)}` : "No spend linked"} testid="whatif-spend" />
              <Figure label="Left after spend" value={hasSpend ? wholeDollars(result.afterSpendCents) : "—"} note={hasSpend ? `now ${wholeDollars((funnel.revenueCents ?? 0) - (funnel.spendCents ?? 0))}` : null} />
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-normal py-1">Step</th>
                  <th className="font-normal py-1 text-right">Now</th>
                  <th className="font-normal py-1 text-right">What if</th>
                </tr>
              </thead>
              <tbody>
                {counted.map((s) => (
                  <tr key={s.key} className="border-t border-border">
                    <td className="py-1.5 text-foreground">{s.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{whole(s.count)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium text-foreground">{whole(result.stages.find((x) => x.key === s.key)?.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {changed && (
            <Button type="button" variant="ghost" className={cn(control, "text-muted-foreground")} onClick={() => { setVolume(1); setLifts({}); setCostRise(DEFAULT_COST_RISE); setTarget(""); }}>
              <RotateCcw className="w-4 h-4 mr-1.5" aria-hidden />
              Back to today's numbers
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One funnel ──────────────────────────────────────────────────────────────

export function FunnelCard({ funnel, onEdit, campaignLink }: { funnel: FunnelView; onEdit?: () => void; campaignLink?: string }) {
  const [open, setOpen] = useState(false);
  const sum = funnelSummary(funnel);
  const hasSpend = funnel.spendCents != null && funnel.spendCents > 0;
  const others = funnel.allBookings != null && funnel.bookings != null ? funnel.allBookings - funnel.bookings : null;
  const leak = sum.biggestLeak;
  return (
    <Card data-testid={`funnel-card-${funnel.id}`}>
      <CardContent className="pt-5 space-y-5 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground break-words" data-testid="funnel-name">{funnel.name}</h3>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {[funnel.channelName ? `Follows ${funnel.channelName}` : "Follows everyone who reaches the page", dayRange(funnel.from, funnel.to)].join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {campaignLink && (
              <Link href={campaignLink} className="inline-flex items-center h-11 md:h-9 px-3 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted" data-testid="funnel-open-campaign">
                {funnel.campaignName}
                <ArrowRight className="w-4 h-4 ml-1.5" aria-hidden />
              </Link>
            )}
            {onEdit && (
              <Button variant="outline" className={control} onClick={onEdit} data-testid="funnel-edit">
                <Pencil className="w-4 h-4 mr-1.5" aria-hidden />
                Edit
              </Button>
            )}
          </div>
        </div>

        <FunnelChart stages={funnel.stages} />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Figure label="Revenue" value={dollars(funnel.revenueCents)} note={funnel.bookings != null ? `${num(funnel.bookings)} paid booking${funnel.bookings === 1 ? "" : "s"}, after refunds` : "Nothing linked as sold"} testid="funnel-revenue" />
          <Figure label="Spent" value={hasSpend ? dollars(funnel.spendCents) : "—"} note={hasSpend ? (funnel.spendSource === "typed" ? "typed in" : "from Meta") : "No spend linked"} />
          <Figure label="Cost per ad click" value={sum.costPerClickCents != null ? dollars(Math.round(sum.costPerClickCents)) : "—"} note={sum.costPerVisitorCents != null ? `${dollars(Math.round(sum.costPerVisitorCents))} per person on the page` : null} />
          <Figure label="Cost per booking" value={sum.costPerBookingCents != null ? dollars(Math.round(sum.costPerBookingCents)) : "—"} note={sum.bookingValueCents != null ? `a booking brings ${dollars(Math.round(sum.bookingValueCents))}` : null} />
          <Figure label="Back for every $1" value={sum.returnPerDollar != null ? `$${sum.returnPerDollar.toFixed(2)}` : "—"} note={sum.overallRate != null ? `From the first step, ${oneIn(sum.overallRate) ?? ratePct(sum.overallRate)} pay` : null} />
        </div>

        {(leak || (others != null && others > 0) || funnel.caveats.length > 0) && (
          <ul className="space-y-1.5 text-[13px] text-muted-foreground">
            {leak && (
              <li data-testid="funnel-leak">
                <span className="text-foreground font-medium">Biggest drop:</span> {stageLabel(funnel.stages, leak.from)} → {stageLabel(funnel.stages, leak.to)}. {ratePct(leak.rate)} go on, {whole(leak.lost)} do not.
              </li>
            )}
            {others != null && others > 0 && (
              <li>
                {num(others)} more paid booking{others === 1 ? "" : "s"} of the same thing in these days did not come through this funnel (the office, another channel, or a device ClubOS could not follow).
              </li>
            )}
            {funnel.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-3 min-h-[44px] text-left text-sm font-medium text-foreground"
            data-testid="funnel-whatif-toggle"
          >
            <span>What if… <span className="font-normal text-muted-foreground">more clicks, a better page, a revenue target</span></span>
            <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && <div className="pt-3"><WhatIf funnel={funnel} /></div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── The form ────────────────────────────────────────────────────────────────

const EVERYONE = "__everyone";

function PagePicker({ label, hint, value, onChange, suggestions, testid }: { label: string; hint: string; value: string[]; onChange: (v: string[]) => void; suggestions: FunnelPageSuggestion[]; testid: string }) {
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const all = useMemo(() => {
    const seen = new Map<string, number | null>();
    for (const s of suggestions) seen.set(s.page, s.visitors);
    for (const v of value) if (!seen.has(v)) seen.set(v, null);
    return Array.from(seen.entries());
  }, [suggestions, value]);
  const add = () => {
    const p = normalisePage(draft);
    if (!p) return setBad(true);
    setBad(false);
    setDraft("");
    if (!value.includes(p)) onChange([...value, p]);
  };
  return (
    <Field label={label} hint={hint}>
      <div className="rounded-lg border border-border" data-testid={testid}>
        {all.length > 0 && (
          <div className="p-1">
            {all.map(([page, visitors]) => (
              <label key={page} className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted cursor-pointer min-h-[44px] md:min-h-0">
                <Checkbox checked={value.includes(page)} onCheckedChange={() => onChange(value.includes(page) ? value.filter((x) => x !== page) : [...value, page])} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground break-all">{page}</span>
                  <span className="block text-xs text-muted-foreground">{visitors != null ? `${num(visitors)} visitors in the last 6 months` : "added by hand"}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <div className={cn("flex gap-2 p-2", all.length > 0 && "border-t border-border")}>
          <Input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setBad(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Add another page, e.g. cufc.co.nz/programmes/holiday"
            className={control}
            aria-label={`Add a page to ${label}`}
          />
          <Button type="button" variant="outline" className={control} onClick={add}>Add</Button>
        </div>
        {bad && <p className="px-3 pb-2 text-xs text-destructive">Write the site and the page, like join.cufc.co.nz/fundamentals.</p>}
      </div>
    </Field>
  );
}

export function FunnelDialog({ open, onClose, campaign, channels, funnel }: { open: boolean; onClose: () => void; campaign: CampaignRow; channels: ChannelRow[]; funnel: FunnelView | null }) {
  const [f, setF] = useState({ name: "", channelId: EVERYONE, startsOn: "", endsOn: "" });
  const [programIds, setProgramIds] = useState<string[]>([]);
  const [landing, setLanding] = useState<string[]>([]);
  const [checkout, setCheckout] = useState<string[]>([]);
  const [ownDates, setOwnDates] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const options = useCampaignOptions(open && campaign.programIds.length > 1);

  useEffect(() => {
    if (!open) return;
    setF({ name: funnel?.name ?? "", channelId: funnel?.channelId != null ? String(funnel.channelId) : EVERYONE, startsOn: funnel?.startsOn ?? "", endsOn: funnel?.endsOn ?? "" });
    setProgramIds((funnel?.programIds ?? []).map(String));
    setLanding(funnel?.landingPages ?? []);
    setCheckout(funnel?.checkoutPages ?? []);
    setOwnDates(Boolean(funnel?.startsOn || funnel?.endsOn));
    setSeeded(Boolean(funnel));
  }, [open, funnel]);

  const sold = programIds.length ? programIds.map(Number) : campaign.programIds;
  const pagesUrl = `/api/admin/campaigns/funnel-pages?programIds=${sold.join(",")}`;
  const suggested = useQuery<{ pages: FunnelPageSuggestion[] }>({ queryKey: [pagesUrl], enabled: open && sold.length > 0, staleTime: 5 * 60_000 });
  const pages = suggested.data?.pages ?? [];
  // A new funnel starts with the pages people already use ticked.
  useEffect(() => {
    if (!open || seeded || !suggested.data) return;
    setLanding(pages.filter((p) => p.kind === "landing").map((p) => p.page));
    setCheckout(pages.filter((p) => p.kind === "checkout").map((p) => p.page));
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seeded, suggested.data]);

  const base = `/api/admin/campaigns/${campaign.id}/funnels`;
  const s = useSave(async () => {
    const body = {
      name: f.name,
      channelId: f.channelId === EVERYONE ? null : Number(f.channelId),
      programIds: programIds.map(Number),
      landingPages: landing,
      checkoutPages: checkout,
      startsOn: ownDates ? f.startsOn || null : null,
      endsOn: ownDates ? f.endsOn || null : null,
    };
    if (funnel) await apiRequest("PATCH", `${base}/${funnel.id}`, body);
    else await apiRequest("POST", base, body);
  }, onClose);
  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `${base}/${funnel!.id}`); },
    onSuccess: async () => { await refreshCampaigns(); onClose(); },
  });
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const campaignProgrammes = (options.data?.programmes ?? []).filter((p) => campaign.programIds.includes(p.id));

  return (
    <FormShell
      open={open}
      onClose={onClose}
      wide
      title={funnel ? "Edit funnel" : "New funnel"}
      description="Pick who to follow and the pages they go through. ClubOS counts each step from then on."
      error={s.error}
      saving={s.saving}
      onSubmit={s.save}
      submitLabel={funnel ? "Save" : "Create funnel"}
      onDelete={funnel ? () => remove.mutate() : undefined}
      deleteLabel="Remove funnel"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Funnel name"><Input className={control} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Facebook ads to FUNdamentals" autoFocus data-testid="funnel-name-input" /></Field>
        <Field label="Who to follow" hint={channels.length ? "A channel's own people, or everyone who reaches the page." : "Add a channel to the campaign (ads, email) to follow just its people."}>
          <Select value={f.channelId} onValueChange={(v) => set({ channelId: v })}>
            <SelectTrigger className={control} data-testid="funnel-channel"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERYONE}>Everyone who reaches the page</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {campaign.programIds.length > 1 && (
        <Field label="What is sold at the end" hint="Leave everything unticked to count all the campaign sells.">
          <MultiPick
            items={campaignProgrammes.map((p) => ({ value: String(p.id), label: p.name }))}
            value={programIds}
            onChange={(v) => { setProgramIds(v); if (!funnel) setSeeded(false); }}
            placeholder="Find a programme"
            empty={options.isLoading ? "Loading…" : "Nothing linked to the campaign."}
          />
        </Field>
      )}
      {campaign.programIds.length === 0 && (
        <p className="text-sm rounded-lg bg-amber-100 text-amber-900 px-3 py-2">This campaign has nothing linked as being sold, so the funnel can count page visits but not payments. Link it on the campaign (Edit → What is being sold).</p>
      )}

      <PagePicker
        label="The page people land on"
        hint="Where the ad or the email sends them. Tick more than one if several pages lead to the same booking."
        value={landing}
        onChange={setLanding}
        suggestions={pages.filter((p) => p.kind === "landing")}
        testid="funnel-landing"
      />
      <PagePicker
        label="The booking form"
        hint="The page with the form on it. Leave empty to skip this step."
        value={checkout}
        onChange={setCheckout}
        suggestions={pages.filter((p) => p.kind === "checkout")}
        testid="funnel-checkout"
      />

      <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer min-h-[44px] md:min-h-0">
        <Checkbox checked={ownDates} onCheckedChange={(v) => setOwnDates(v === true)} />
        Count different days from the campaign's selling dates
      </label>
      {ownDates && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From"><DateField value={f.startsOn} onChange={(v) => set({ startsOn: v })} /></Field>
          <Field label="To"><DateField value={f.endsOn} onChange={(v) => set({ endsOn: v })} /></Field>
        </div>
      )}
    </FormShell>
  );
}

// ── A campaign's Funnels tab ────────────────────────────────────────────────

export function useCampaignFunnels(campaignId: number | string) {
  return useQuery<{ today: string; funnels: FunnelView[] }>({ queryKey: [`/api/admin/campaigns/${campaignId}/funnels`], staleTime: 30_000 });
}

export function CampaignFunnels({ campaign, channels }: { campaign: CampaignRow; channels: ChannelRow[] }) {
  const { data, isLoading, isError } = useCampaignFunnels(campaign.id);
  const [form, setForm] = useState<{ funnel: FunnelView | null } | null>(null);
  return (
    <div className="space-y-4" data-testid="campaign-funnels">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          A funnel follows people step by step, from seeing the ad to paying. Make one for each way in: the ads, an email, everyone.
        </p>
        <Button className={control} onClick={() => setForm({ funnel: null })} data-testid="funnel-new">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden />
          New funnel
        </Button>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Counting…</p>}
      {isError && <p role="alert" className="text-sm text-destructive">The funnels could not be loaded. Reload the page to try again.</p>}
      {data && data.funnels.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-3">
          <p className="text-base font-medium text-foreground">No funnels yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">Pick the page people land on and ClubOS shows how many reach it, open the booking form, get to payment and pay, with the share that goes on at each step.</p>
          <Button className={control} onClick={() => setForm({ funnel: null })}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden />
            New funnel
          </Button>
        </div>
      )}
      {data?.funnels.map((fn) => <FunnelCard key={fn.id} funnel={fn} onEdit={() => setForm({ funnel: fn })} />)}
      <FunnelDialog open={form != null} onClose={() => setForm(null)} campaign={campaign} channels={channels} funnel={form?.funnel ?? null} />
    </div>
  );
}
