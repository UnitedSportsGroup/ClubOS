// ─────────────────────────────────────────────────────────────────────────────
// Marketing channels — Paid ads · Email · SMS · WhatsApp. One page each under
// United Sports Group → Marketing. Report pages: nothing is sent from here.
//
// Daniel, 2026-11-10: "a tab for SMS … emails … paid ads … WhatsApp … the
// foundational stuff, all built and mapped out."
//
// The period lives in the URL. Where a channel is not connected yet the page
// says what is missing, and never draws a zero that means "we cannot see".
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdsSection } from "@/components/marketing-hub/ads-section";
import { BarList } from "@/components/marketing-hub/bar-list";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { StatTile } from "@/components/marketing-hub/stat-tile";
import { TrendChart } from "@/components/marketing-hub/trend-chart";
import { money, shortDate } from "@/components/marketing-hub/format";
import { workspaceColor } from "@/components/marketing-hub/palette";
import { DASHBOARD_PERIODS, resolvePeriod, type DashboardPeriod, type DateRange } from "@shared/dashboard";
import { HUB_WORKSPACES } from "@shared/marketing-hub";
import type { EmailCampaignRow, EmailReport, SmsReport, WhatsAppReport } from "@shared/marketing-channels";

const n = (v: number) => v.toLocaleString("en-NZ");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** Period (and optionally workspace) in the URL, shared by all four pages. */
function useFilters(path: string) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const state = useMemo(() => {
    const p = new URLSearchParams(search);
    const raw = p.get("period") ?? "30d";
    const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(raw) ? (raw as DashboardPeriod) : "30d";
    const fallback = resolvePeriod("30d");
    const custom: DateRange = { from: p.get("from") || fallback.from, to: p.get("to") || fallback.to };
    return { period, custom, workspace: p.get("workspace") };
  }, [search]);
  const write = useCallback(
    (next: { period?: DashboardPeriod; custom?: DateRange; workspace?: string | null }) => {
      const p = new URLSearchParams();
      const per = next.period ?? state.period;
      p.set("period", per);
      if (per === "custom") {
        const r = next.custom ?? state.custom;
        p.set("from", r.from);
        p.set("to", r.to);
      }
      const ws = next.workspace !== undefined ? next.workspace : state.workspace;
      if (ws) p.set("workspace", ws);
      navigate(`${path}?${p.toString()}`, { replace: true });
    },
    [navigate, path, state],
  );
  const query = useMemo(() => {
    const p = new URLSearchParams({ period: state.period });
    if (state.period === "custom") {
      p.set("from", state.custom.from);
      p.set("to", state.custom.to);
    }
    if (state.workspace) p.set("workspace", state.workspace);
    return p.toString();
  }, [state]);
  return { ...state, write, query };
}

function Shell({ title, blurb, controls, children }: { title: string; blurb: string; controls: ReactNode; children: ReactNode }) {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{blurb}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{controls}</div>
      {children}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A plain status line: connected, not yet, or needs attention. */
function Status({ state, title, children }: { state: "ok" | "todo" | "warn"; title: string; children?: ReactNode }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? AlertTriangle : CircleDashed;
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-4" data-testid="channel-status">
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${state === "warn" ? "text-destructive" : state === "ok" ? "text-foreground" : "text-muted-foreground"}`} aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children && <div className="text-sm text-muted-foreground space-y-1">{children}</div>}
      </div>
    </div>
  );
}

// ── Paid ads ────────────────────────────────────────────────────────────────

export function PaidAdsPage() {
  const f = useFilters("/admin/paid-ads");
  return (
    <Shell
      title="Paid ads"
      blurb="What every ad account spent, and what came back."
      controls={
        <>
          <PeriodPicker period={f.period} custom={f.custom} onChange={(period, custom) => f.write({ period, custom })} />
          <Select value={f.workspace ?? "all"} onValueChange={(v) => f.write({ workspace: v === "all" ? null : v })}>
            <SelectTrigger className="h-11 md:h-9 w-full sm:w-[240px]" aria-label="Brand"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every brand</SelectItem>
              {HUB_WORKSPACES.map((w) => (
                <SelectItem key={w.slug} value={w.slug}>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: workspaceColor(w.slug) }} />
                    {w.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    >
      <AdsSection query={f.query} base="/api/admin/paid-ads" />
    </Shell>
  );
}

// ── Email ───────────────────────────────────────────────────────────────────

function CampaignTable({ rows }: { rows: EmailCampaignRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sent</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Brand</TableHead>
            <TableHead className="text-right">Delivered to</TableHead>
            <TableHead className="text-right">Opened</TableHead>
            <TableHead className="text-right">Clicked</TableHead>
            <TableHead className="text-right">Failed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} data-testid="email-campaign-row">
              <TableCell className="whitespace-nowrap text-muted-foreground">{shortDate(c.day)}</TableCell>
              <TableCell className="max-w-[360px]">
                <span className="block truncate font-medium text-foreground" title={c.subject}>{c.subject}</span>
                {c.stalled && <span className="text-xs text-destructive">Stopped part-way: {n(c.sent)} of {n(c.recipients)} sent</span>}
                {!c.stalled && c.status !== "sent" && <span className="text-xs text-muted-foreground capitalize">{c.status}</span>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{c.brand}</TableCell>
              <TableCell className="text-right tabular-nums">{n(c.sent)}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">
                {c.opened == null ? "—" : `${n(c.opened)} (${pct(c.opened, c.tracked ?? 0)})`}
              </TableCell>
              <TableCell className="text-right tabular-nums">{c.clicked == null ? "—" : n(c.clicked)}</TableCell>
              <TableCell className="text-right tabular-nums">{c.failed ? n(c.failed) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EmailStatsPage() {
  const f = useFilters("/admin/email-stats");
  const { data, isLoading, isError, error, refetch } = useQuery<EmailReport>({
    queryKey: [`/api/admin/email-stats/report?${f.query}`],
    staleTime: 60_000,
  });
  const t = data?.totals;
  return (
    <Shell
      title="Email"
      blurb="Every email campaign ClubOS has sent, and what happened to it."
      controls={<PeriodPicker period={f.period} custom={f.custom} onChange={(period, custom) => f.write({ period, custom })} />}
    >
      {isLoading ? (
        <Loading rows={4} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data || !t ? null : (
        <div className="space-y-5">
          {data.stalled.length > 0 && (
            <Status state="warn" title={`${data.stalled.length} campaign${data.stalled.length === 1 ? "" : "s"} in this period stopped part-way through sending`}>
              <p>
                {data.stalled.slice(0, 4).map((c) => `"${c.subject.slice(0, 50)}" (${n(c.sent)} of ${n(c.recipients)})`).join(" · ")}
                {data.stalled.length > 4 ? ` · and ${data.stalled.length - 4} more` : ""}
              </p>
              <p>The people who did not get it were never sent it. Each one is marked in the list below.</p>
            </Status>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="email-tiles">
            <StatTile label="Campaigns" value={n(t.campaigns)} note={t.oneToOne ? `plus ${n(t.oneToOne)} one-to-one emails, not listed` : undefined} />
            <StatTile label="Emails delivered to" value={n(t.sent)} note={t.failed ? `${n(t.failed)} failed to send` : undefined} />
            <StatTile label="Opened" value={t.tracked ? pct(t.opened, t.tracked) : "—"} note={t.tracked ? `${n(t.opened)} of ${n(t.tracked)}. A guide: Apple Mail opens every email itself` : "Opens were not recorded for these sends"} />
            <StatTile label="Clicked a link" value={t.tracked ? n(t.clicked) : "—"} note="Counted on campaigns sent since 27 Oct 2026" />
            <StatTile label="Unsubscribed" value={n(t.unsubscribes)} />
            <StatTile label="Dead addresses" value={n(t.bouncesPermanent)} note="Bounced for good; left out of future sends" />
            <StatTile label="Temporary bounces" value={n(t.bouncesTemporary)} note={t.complaints ? `${n(t.complaints)} marked as spam` : "Full inbox or similar"} />
            <StatTile label="Other emails sent" value={n(t.otherEmails)} note="Confirmations, receipts and reminders" />
          </div>

          <TrendChart title="Campaign emails sent per day" kind="count" data={data.series.map((s) => ({ date: s.date, value: s.sent }))} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By brand" note="Read off the address each campaign was sent from.">
              <BarList kind="count" items={data.byBrand.map((b) => ({ key: b.brand, label: `${b.brand} · ${b.campaigns} campaign${b.campaigns === 1 ? "" : "s"}`, value: b.sent }))} />
            </Panel>
            <Panel title="Emails that send themselves" note="Automations set up in the Mailer.">
              {data.automations.length ? (
                <div className="space-y-2">
                  {data.automations.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-foreground">{a.name}</span>
                      <span className="shrink-0 text-muted-foreground">{a.status === "on" ? "On" : a.status === "test" ? "Test" : "Off"} · {n(a.sends)} sent</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No automations set up yet.</p>
              )}
            </Panel>
          </div>

          <Panel title="Campaigns" note="Newest first, sends to ten or more people. A dash under Opened means the send was before opens were recorded per person.">
            {data.campaigns.length ? <CampaignTable rows={data.campaigns} /> : <p className="text-sm text-muted-foreground">No campaign was sent in this period.</p>}
          </Panel>
        </div>
      )}
    </Shell>
  );
}

// ── SMS ─────────────────────────────────────────────────────────────────────

export function SmsStatsPage() {
  const f = useFilters("/admin/sms-stats");
  const { data, isLoading, isError, error, refetch } = useQuery<SmsReport>({
    queryKey: [`/api/admin/sms-stats/report?${f.query}`],
    staleTime: 60_000,
  });
  const t = data?.totals;
  return (
    <Shell
      title="SMS"
      blurb="Text messages ClubOS has sent, what they cost and who can be texted."
      controls={<PeriodPicker period={f.period} custom={f.custom} onChange={(period, custom) => f.write({ period, custom })} />}
    >
      {isLoading ? (
        <Loading rows={3} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data || !t ? null : (
        <div className="space-y-5">
          <Status state={data.live ? "ok" : "todo"} title={data.live ? "ClubOS can send texts (websms, short code 2190)" : "ClubOS is in test mode: texts are written down but not sent"} />
          <Status
            state={data.consent.canText > 0 ? "ok" : "warn"}
            title={data.consent.canText > 0 ? `${n(data.consent.canText)} people have agreed to receive texts` : "Nobody has agreed to receive marketing texts yet"}
          >
            <p>
              New Zealand law needs a person's clear yes before a marketing text. {n(data.consent.profiles)} people are on the marketing list
              and none of them has been asked. Until a tick box for texts is on the registration forms, ClubOS can only text about something a
              person already booked (a reminder, a change of time).
            </p>
          </Status>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="sms-tiles">
            <StatTile label="Texts sent" value={n(t.sent)} />
            <StatTile label="Delivered" value={t.sent ? `${n(t.delivered)} (${pct(t.delivered, t.sent)})` : "—"} />
            <StatTile label="Failed" value={t.sent ? n(t.failed) : "—"} />
            <StatTile label="Cost" value={t.sent ? money(t.costCents) : "—"} note="About 10c a text, plus GST" />
          </div>
          {t.sent > 0 && <TrendChart title="Texts sent per day" kind="count" data={data.series.map((s) => ({ date: s.date, value: s.sent }))} />}
          <Panel title="Messages" note={t.tests ? `${n(t.tests)} test message${t.tests === 1 ? "" : "s"} in this period (never sent to a phone).` : undefined}>
            {data.messages.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.messages.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{shortDate(m.day)}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{m.to}</TableCell>
                        <TableCell className="max-w-[420px]"><span className="block truncate" title={m.body}>{m.body}</span></TableCell>
                        <TableCell className="whitespace-nowrap capitalize">{m.test ? "Test only" : m.status}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.costCents == null || m.test ? "—" : money(m.costCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No text was sent in this period.</p>
            )}
          </Panel>
        </div>
      )}
    </Shell>
  );
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

export function WhatsAppStatsPage() {
  const f = useFilters("/admin/whatsapp-stats");
  const { data, isLoading, isError, error, refetch } = useQuery<WhatsAppReport>({
    queryKey: [`/api/admin/whatsapp-stats/report?${f.query}`],
    staleTime: 60_000,
  });
  return (
    <Shell
      title="WhatsApp"
      blurb="How people reach the club on WhatsApp, and what is needed to message them from ClubOS."
      controls={<PeriodPicker period={f.period} custom={f.custom} onChange={(period, custom) => f.write({ period, custom })} />}
    >
      {isLoading ? (
        <Loading rows={3} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data ? null : (
        <div className="space-y-5">
          <Status state={data.connected ? "ok" : "todo"} title={data.connected ? "A WhatsApp Business number is connected" : "ClubOS is not connected to WhatsApp yet"}>
            {!data.connected && (
              <>
                <p>Sending from ClubOS needs a WhatsApp Business account from Meta. Three things, in order:</p>
                <p>1. A phone number that is not already in use on WhatsApp (a new SIM or a landline).</p>
                <p>2. The club's Meta business account verified (the same one the ads run from), then the number added to it.</p>
                <p>3. Each message that starts a conversation approved by Meta as a template, and each person's yes recorded first.</p>
                <p>Once that is done this page shows messages sent, delivered, read and replied to.</p>
              </>
            )}
          </Status>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="whatsapp-tiles">
            <StatTile label="WhatsApp links pressed" value={n(data.linkClicks)} note="On the booking and checkout sites, which record presses" />
            <StatTile label="People who pressed one" value={n(data.linkVisitors)} />
            <StatTile label="Messages sent from ClubOS" value="—" note="Not connected" />
            <StatTile label="Replies" value="—" note="Not connected" />
          </div>
          {data.linkClicks > 0 ? (
            <>
              <TrendChart title="WhatsApp links pressed per day" kind="count" data={data.series.map((s) => ({ date: s.date, value: s.clicks }))} />
              <Panel title="Which links">
                <BarList kind="count" items={data.links.map((l) => ({ key: l.href, label: l.href.replace(/^https?:\/\//, ""), value: l.clicks }))} />
              </Panel>
            </>
          ) : (
            <Panel title="WhatsApp links on the websites">
              <p className="text-sm text-muted-foreground">
                No WhatsApp link was pressed in this period. None of the pages that record button presses carries one yet. Adding a "Message us on
                WhatsApp" button to a booking page would start counting here straight away.
              </p>
            </Panel>
          )}
        </div>
      )}
    </Shell>
  );
}
