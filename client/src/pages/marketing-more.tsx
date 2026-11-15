// ─────────────────────────────────────────────────────────────────────────────
// Marketing — the rest of the map (Daniel, 2026-11-12): Mobile Apps · Search &
// Reviews · Flyers & Print · Events & Activations · Product Quality · Listings ·
// Partners & Ambassadors · Word of Mouth · Offers & Codes.
//
// Two kinds of page. A REGISTER is a list staff keep (shared/offline-marketing.ts,
// the same page as Signage). A REPORT is read from what ClubOS already records
// (shared/marketing-more.ts). Some pages are both: the report sits above the list.
// A number ClubOS cannot see is "—", and the page says what is not connected.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarList } from "@/components/marketing-hub/bar-list";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { StatTile } from "@/components/marketing-hub/stat-tile";
import { formatCurrency } from "@/lib/format";
import { MORE_PERIODS, morePeriod, type AppsReport, type MorePeriod, type OffersReport, type WordOfMouthReport } from "@shared/marketing-more";
import { OfflinePage } from "./offline-marketing";

const n = (v: number) => v.toLocaleString("en-NZ");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const dollars = (cents: number) => formatCurrency(cents, { fromCents: true });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceDay = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
};

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5 min-w-0">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

/** Something a person has to connect before ClubOS can read it. */
function NotConnected({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-4" data-testid="more-not-connected">
      <CircleDashed className="w-5 h-5 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="text-sm text-muted-foreground space-y-1">{children}</div>
      </div>
    </div>
  );
}

/** The period, kept in the URL. */
function usePeriod(path: string) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const period = useMemo(() => morePeriod(new URLSearchParams(search).get("period")).key, [search]);
  const set = (p: MorePeriod) => navigate(p === "year" ? path : `${path}?period=${p}`, { replace: true });
  return { period, set };
}

function PeriodSelect({ value, onChange }: { value: MorePeriod; onChange: (p: MorePeriod) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MorePeriod)}>
      <SelectTrigger className="h-11 md:h-9 w-full sm:w-[200px]" aria-label="Period" data-testid="more-period"><SelectValue /></SelectTrigger>
      <SelectContent>{MORE_PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function ReportShell({ title, blurb, controls, children }: { title: string; blurb: string; controls?: ReactNode; children: ReactNode }) {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{blurb}</p>
      </div>
      {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      {children}
    </div>
  );
}

// ── Word of Mouth ───────────────────────────────────────────────────────────
export function WordOfMouthPage() {
  const f = usePeriod("/admin/word-of-mouth");
  const { data, isLoading, isError, error, refetch } = useQuery<WordOfMouthReport>({ queryKey: [`/api/admin/word-of-mouth/report?period=${f.period}`], staleTime: 60_000 });
  const people = data?.groups.find((g) => g.key === "people")?.count ?? 0;
  const before = data?.groups.find((g) => g.key === "before")?.count ?? 0;
  return (
    <ReportShell
      title="Word of Mouth"
      blurb="What people answered when a checkout asked “How did you hear about us?”. Paid bookings only."
      controls={<PeriodSelect value={f.period} onChange={f.set} />}
    >
      {isLoading ? (
        <Loading rows={4} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data ? null : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="wom-tiles">
            <StatTile label="Someone told them" value={data.answered ? pct(people, data.answered) : "—"} note={data.answered ? `${n(people)} of ${n(data.answered)} answers` : "No answers in this period"} />
            <StatTile label="Been with us before" value={data.answered ? pct(before, data.answered) : "—"} note={data.answered ? `${n(before)} said so` : undefined} />
            <StatTile label="Answered the question" value={n(data.answered)} note={`of ${n(data.bookings)} paid bookings`} />
            <StatTile label="Not asked or skipped" value={n(data.bookings - data.answered)} note="The question became required for new buyers on 20 Oct 2026" />
          </div>
          {data.answered === 0 ? (
            <Panel title="No answers yet"><p className="text-sm text-muted-foreground">Nobody who paid in this period answered the question. Try a longer period.</p></Panel>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="How they heard, grouped" note="Share of the people who answered.">
                  <BarList kind="count" items={data.groups.map((g) => ({ key: g.key, label: `${g.label} · ${pct(g.count, data.answered)}`, value: g.count }))} />
                </Panel>
                <Panel title="Every answer" note="As the checkout words it. Typed-in “Other” answers are counted together and not shown.">
                  <BarList kind="count" items={data.answers.map((a) => ({ key: a.label, label: a.label, value: a.count }))} />
                </Panel>
              </div>
              <Panel title="By workspace" note="“Told by someone” and “been before” are shares of that workspace's answers.">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Workspace</TableHead>
                        <TableHead className="text-right">Paid bookings</TableHead>
                        <TableHead className="text-right">Answered</TableHead>
                        <TableHead className="text-right">Told by someone</TableHead>
                        <TableHead className="text-right">Been before</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byWorkspace.map((w) => (
                        <TableRow key={w.name} data-testid="wom-workspace">
                          <TableCell className="font-medium">{w.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{n(w.bookings)}</TableCell>
                          <TableCell className="text-right tabular-nums">{n(w.answered)}</TableCell>
                          <TableCell className="text-right tabular-nums">{w.answered ? pct(w.people, w.answered) : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{w.answered ? pct(w.before, w.answered) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            </>
          )}
        </div>
      )}
    </ReportShell>
  );
}

// ── Offers & Codes ──────────────────────────────────────────────────────────
export function OffersCodesPage() {
  const f = usePeriod("/admin/offers-codes");
  const [showUnused, setShowUnused] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery<OffersReport>({ queryKey: [`/api/admin/offers-codes/report?period=${f.period}`], staleTime: 60_000 });
  return (
    <ReportShell
      title="Offers & Codes"
      blurb="Every promo code used on a paid booking or shop order: how often, what those customers paid and what came off."
      controls={<PeriodSelect value={f.period} onChange={f.set} />}
    >
      {isLoading ? (
        <Loading rows={4} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data ? null : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="offers-tiles">
            <StatTile label="Sales that used a code" value={n(data.totals.uses)} />
            <StatTile label="Those customers paid" value={data.totals.uses ? dollars(data.totals.paidCents) : "—"} note="After the discount" />
            <StatTile label="Discount given" value={data.totals.uses ? dollars(data.totals.discountCents) : "—"} />
            <StatTile label="Codes used" value={n(data.rows.length)} note={`${n(data.unused.length)} live code${data.unused.length === 1 ? "" : "s"} not used in this period`} />
          </div>
          <Panel title="Codes" note="Most used first. A booking that used two codes is on both rows, with its whole discount on each; the totals above count it once.">
            {data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No paid sale used a code in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Used on</TableHead>
                      <TableHead className="text-right">Times used</TableHead>
                      <TableHead className="text-right">Customers paid</TableHead>
                      <TableHead className="text-right">Discount given</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>Now</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={`${r.where}:${r.workspace}:${r.code}`} data-testid="offer-row">
                        <TableCell className="min-w-[160px]">
                          <span className="font-medium text-foreground">{r.code}</span>
                          {r.title && <span className="block text-xs text-muted-foreground">{r.title}</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.workspace}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.where === "shop" ? "Shop orders" : "Bookings"}</TableCell>
                        <TableCell className="text-right tabular-nums">{n(r.uses)}</TableCell>
                        <TableCell className="text-right tabular-nums">{dollars(r.paidCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{dollars(r.discountCents)}</TableCell>
                        <TableCell className="whitespace-nowrap">{niceDay(r.lastUsed)}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{r.active == null ? "Not in the code list" : r.active ? "Live" : "Switched off or ended"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
          {data.unused.length > 0 && (
            <Panel title={`Live codes nobody used in this period (${n(data.unused.length)})`}>
              {showUnused ? (
                <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 text-sm" data-testid="offers-unused">
                  {data.unused.map((u) => (
                    <li key={`${u.where}:${u.workspace}:${u.code}`} className="min-w-0">
                      <span className="font-medium text-foreground">{u.code}</span>
                      <span className="text-muted-foreground"> · {u.workspace}{u.where === "shop" ? " shop" : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setShowUnused(true)}>Show them</Button>
              )}
            </Panel>
          )}
        </div>
      )}
    </ReportShell>
  );
}

// ── Mobile Apps ─────────────────────────────────────────────────────────────
function AppsPanel() {
  const { data, isLoading, isError, error, refetch } = useQuery<AppsReport>({ queryKey: ["/api/admin/mobile-apps/report"], staleTime: 60_000 });
  return (
    <div className="space-y-3">
      <Panel title="What ClubOS can see" note="Phones that have switched on notifications, people who signed up inside an app, and notifications sent from ClubOS.">
        {isLoading ? (
          <Loading rows={2} />
        ) : isError ? (
          <LoadError error={error} onRetry={refetch} />
        ) : !data || data.apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No app has reported anything to ClubOS yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead className="text-right">Phones with notifications on</TableHead>
                  <TableHead className="text-right">iPhone</TableHead>
                  <TableHead className="text-right">Android</TableHead>
                  <TableHead className="text-right">Signed up in the app</TableHead>
                  <TableHead className="text-right">Notifications sent</TableHead>
                  <TableHead>Last one</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.apps.map((a) => (
                  <TableRow key={a.app} data-testid="app-row">
                    <TableCell className="font-medium whitespace-nowrap">{a.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.pushDevices)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.ios)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.android)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.signUps)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.pushesSent)}</TableCell>
                    <TableCell className="whitespace-nowrap">{niceDay(a.lastPush)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
      <NotConnected title="Downloads, ratings and store reviews are not connected">
        <p>The App Store and Google Play hold those numbers. Until they are connected, type them into each app below.</p>
        <p>The Mini Football, South Island United and CIC apps keep their own sign-up lists outside ClubOS, so their members are not counted above.</p>
      </NotConnected>
    </div>
  );
}

export function MobileAppsPage() {
  return (
    <OfflinePage
      path="/admin/mobile-apps"
      title="Mobile Apps"
      blurb="Every club app: where it is in the stores, how many people have it and what ClubOS can see of it."
      lists={[{ key: "mobile-apps", label: "Apps" }]}
      top={<AppsPanel />}
    />
  );
}

// ── Search & Reviews ────────────────────────────────────────────────────────
export function SearchReviewsPage() {
  return (
    <OfflinePage
      path="/admin/search-reviews"
      title="Search & Reviews"
      blurb="Whether the club comes up when someone searches Google or asks an AI assistant, what its reviews say, and the jobs that would improve both."
      lists={[
        { key: "search-checks", label: "Search and AI checks" },
        { key: "review-profiles", label: "Reviews" },
        { key: "search-fixes", label: "Jobs to do" },
      ]}
      top={
        <NotConnected title="Google is not connected yet, so these lists are typed in">
          <p>Google Search Console (what people searched to find each website) and Google Business Profile (ratings and reviews for each venue) each need to be switched on once by a person who owns them.</p>
          <p>AI assistants such as ChatGPT, Claude and Gemini publish no figures. The only way to know is to ask them the question a parent would ask and log the answer under “Search and AI checks”.</p>
        </NotConnected>
      }
    />
  );
}

// ── Product Quality ─────────────────────────────────────────────────────────
function QualitySignals() {
  const { data, isLoading, isError, error, refetch } = useQuery<WordOfMouthReport>({ queryKey: ["/api/admin/product-quality/signals"], staleTime: 60_000 });
  const people = data?.groups.find((g) => g.key === "people")?.count ?? 0;
  const before = data?.groups.find((g) => g.key === "before")?.count ?? 0;
  return (
    <Panel title="Is it working? Last 12 months" note="A better programme shows up as people coming back and telling others. These are what paying families answered at the checkout.">
      {isLoading ? (
        <Loading rows={1} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data ? null : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="quality-tiles">
            <StatTile label="Told by someone" value={data.answered ? pct(people, data.answered) : "—"} note={data.answered ? `${n(people)} of ${n(data.answered)} answers` : "No answers yet"} />
            <StatTile label="Been before" value={data.answered ? pct(before, data.answered) : "—"} note={data.answered ? `${n(before)} of ${n(data.answered)} answers` : undefined} />
            <StatTile label="Answers counted" value={n(data.answered)} note={`of ${n(data.bookings)} paid bookings`} />
          </div>
          {data.byWorkspace.some((w) => w.answered > 0) && (
            <p className="text-sm text-muted-foreground">
              {data.byWorkspace.filter((w) => w.answered > 0).map((w) => `${w.name}: ${pct(w.people, w.answered)} told by someone, ${pct(w.before, w.answered)} been before`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

export function ProductQualityPage() {
  return (
    <OfflinePage
      path="/admin/product-quality"
      title="Product Quality"
      blurb="Money spent on making a programme better, such as camp prizes, so families come back and tell others. The other choice to spending it on adverts."
      lists={[{ key: "product-quality", label: "Improvements" }]}
      top={<QualitySignals />}
    />
  );
}

// ── Plain registers ─────────────────────────────────────────────────────────
export function FlyersPrintPage() {
  return <OfflinePage path="/admin/flyers-print" title="Flyers & Print" blurb="Flyers, posters, school-bag and letterbox drops: how many were printed, where they went and what they cost." lists={[{ key: "flyers-print", label: "Flyers and print" }]} />;
}
export function EventsActivationsPage() {
  return <OfflinePage path="/admin/events-activations" title="Events & Activations" blurb="School visits, stalls, open trainings and matchday activations: what each cost, who it reached and what came of it." lists={[{ key: "events-activations", label: "Events" }]} />;
}
export function ListingsPage() {
  return <OfflinePage path="/admin/listings" title="Listings" blurb="Outside sites that list the club and its programmes: is each one live, is it right, and when it was last checked." lists={[{ key: "listings", label: "Listings" }]} />;
}
export function PartnersAmbassadorsPage() {
  return <OfflinePage path="/admin/partners-ambassadors" title="Partners & Ambassadors" blurb="Schools, sponsors, players and creators who promote the club: where they do it, how many people they reach and what they get for it." lists={[{ key: "partners-ambassadors", label: "Partners and ambassadors" }]} />;
}
/** Sits under the club's own sends on the Email page. */
export function OtherNewsletters() {
  return <OfflinePage embedded path="/admin/email-stats" title="Other people's newsletters" blurb="School, club and business newsletters the club is in, or has asked to be in, to reach their lists." lists={[{ key: "newsletter-placements", label: "Newsletters" }]} />;
}
