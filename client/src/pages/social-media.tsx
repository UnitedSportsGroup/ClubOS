// ─────────────────────────────────────────────────────────────────────────────
// Social media — every brand's accounts, stats, posts and a calendar of
// everything ever posted. United Sports Group → Marketing → Social media.
//
// Daniel, 2026-11-10: "a place to select the brand … then I'd be able to see
// the Instagram, Facebook, TikTok, YouTube, X, LinkedIn … click into it, see
// stats, see the posts, see the calendar of all time."
//
// Everything a person chooses lives in the URL (brand, account, period, view,
// month), so Back, reload and a shared link all land on the same screen.
// A number a platform did not give is drawn as "—", never as 0.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { StatTile } from "@/components/marketing-hub/stat-tile";
import { TrendChart } from "@/components/marketing-hub/trend-chart";
import { relativeTime } from "@/components/marketing-hub/format";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  ConnectDialog,
  FollowersDialog,
  PlatformIcon,
  PostCard,
  PostDialog,
  compactCount,
  count,
  longDay,
  refreshSocial,
} from "@/components/social/parts";
import {
  POST_KIND_LABEL,
  SOCIAL_BRANDS,
  SOCIAL_PERIODS,
  SOCIAL_PLATFORMS,
  socialBrand,
  socialPeriod,
  socialPlatform,
  type SocialAccount,
  type SocialAccountsResponse,
  type SocialCalendarResponse,
  type SocialOverviewResponse,
  type SocialPlatformKey,
  type SocialPost,
  type SocialPostsResponse,
} from "@shared/social";

const VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "posts", label: "Posts" },
  { key: "calendar", label: "Calendar" },
  { key: "accounts", label: "Accounts" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (v: number) => String(v).padStart(2, "0");

/** A page id is not a name: show the page's own name when there is no @handle. */
function accountName(a: { handle: string; displayName?: string | null }): string {
  return /^\d+$/.test(a.handle) ? a.displayName || a.handle : `@${a.handle}`;
}

type Filters = { brand: string; account: number | null; period: string; view: ViewKey; month: string | null; sort: string; kind: string };

export default function SocialMedia() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [openPost, setOpenPost] = useState<SocialPost | null>(null);
  const [connect, setConnect] = useState<{ platform: SocialPlatformKey | null } | null>(null);
  const [followersFor, setFollowersFor] = useState<SocialAccount | null>(null);

  const f: Filters = useMemo(() => {
    const p = new URLSearchParams(search);
    const view = (VIEWS.find((v) => v.key === p.get("view"))?.key ?? "overview") as ViewKey;
    const account = p.get("account") ? Number(p.get("account")) : null;
    const month = p.get("month");
    return {
      brand: p.get("brand") || "all",
      account: Number.isInteger(account) ? account : null,
      period: socialPeriod(p.get("period")).key,
      view,
      month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
      sort: p.get("sort") || "recent",
      kind: p.get("kind") || "all",
    };
  }, [search]);

  const write = useCallback(
    (next: Partial<Filters>) => {
      const m = { ...f, ...next };
      const p = new URLSearchParams();
      if (m.brand !== "all") p.set("brand", m.brand);
      if (m.account != null) p.set("account", String(m.account));
      if (m.period !== "30d") p.set("period", m.period);
      if (m.view !== "overview") p.set("view", m.view);
      if (m.view === "calendar" && m.month) p.set("month", m.month);
      if (m.view === "posts" && m.sort !== "recent") p.set("sort", m.sort);
      if (m.view === "posts" && m.kind !== "all") p.set("kind", m.kind);
      const qs = p.toString();
      navigate(`/admin/social-media${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [f, navigate],
  );

  const accountsUrl = `/api/admin/social/accounts?brand=${encodeURIComponent(f.brand)}&period=${f.period}`;
  const accountsQuery = useQuery<SocialAccountsResponse>({
    queryKey: [accountsUrl],
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.syncing ? 5000 : false),
  });
  // Every account, whatever brand is chosen — for "is anything unfiled" and the Accounts view.
  const allQuery = useQuery<SocialAccountsResponse>({ queryKey: [`/api/admin/social/accounts?brand=all&period=${f.period}`], staleTime: 30_000 });

  const sync = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/social/sync");
    },
    onSettled: () => refreshSocial(),
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const selected = f.account != null ? accounts.find((a) => a.id === f.account) ?? null : null;
  const unfiled = (allQuery.data?.accounts ?? []).filter((a) => !a.brand).length;
  const syncing = Boolean(accountsQuery.data?.syncing) || sync.isPending;
  const lastSynced = accounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().pop() ?? null;

  // The scope every section asks for.
  const scopeQuery = useMemo(() => {
    const p = new URLSearchParams({ brand: f.brand, period: f.period });
    if (selected) p.set("account", String(selected.id));
    return p.toString();
  }, [f.brand, f.period, selected]);

  const missingPlatforms =
    f.brand !== "all" && f.brand !== "none"
      ? SOCIAL_PLATFORMS.filter((p) => p.mode !== "auto" && !accounts.some((a) => a.platform === p.key))
      : [];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Social Media</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Every brand's accounts, posts and stats in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="h-11 md:h-9" onClick={() => setConnect({ platform: null })} data-testid="social-connect">
            <Plus className="w-4 h-4 mr-1.5" aria-hidden />
            Connect account
          </Button>
          <Button
            variant="outline"
            className="h-11 md:h-9"
            disabled={syncing || Boolean(accountsQuery.data?.nextSyncAt)}
            onClick={() => sync.mutate()}
            title={accountsQuery.data?.nextSyncAt ? "Updated a few minutes ago" : "Pull the latest posts and numbers"}
          >
            <RefreshCw className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} aria-hidden />
            {syncing ? "Updating…" : "Update now"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.brand} onValueChange={(v) => write({ brand: v, account: null })}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[260px]" data-testid="social-brand" aria-label="Brand">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {SOCIAL_BRANDS.map((b) => (
              <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>
            ))}
            {unfiled > 0 && <SelectItem value="none">Not filed under a brand ({unfiled})</SelectItem>}
          </SelectContent>
        </Select>
        <Select value={f.period} onValueChange={(v) => write({ period: v })}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[180px]" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOCIAL_PERIODS.map((p) => (
              <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {lastSynced ? `Updated ${relativeTime(lastSynced)}` : accountsQuery.isLoading ? "" : "Not pulled yet"}
        </span>
      </div>

      {/* The accounts in this brand. Click one to see just that account. */}
      {accountsQuery.isLoading ? (
        <Loading rows={1} />
      ) : accountsQuery.isError ? (
        <LoadError error={accountsQuery.error} onRetry={accountsQuery.refetch} />
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <div className="flex gap-2 w-max md:w-auto md:flex-wrap" data-testid="social-accounts">
            <AccountChip
              active={!selected}
              onClick={() => write({ account: null })}
              title={f.brand === "all" ? "All accounts" : `All ${socialBrand(f.brand)?.short ?? ""} accounts`.replace("  ", " ")}
              sub={`${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
            />
            {accounts.map((a) => (
              <AccountChip
                key={a.id}
                active={selected?.id === a.id}
                onClick={() => write({ account: a.id })}
                platform={a.platform}
                title={accountName(a)}
                sub={
                  a.followers != null
                    ? `${compactCount(a.followers)} ${socialPlatform(a.platform).audience}`
                    : a.connection === "link"
                      ? "Saved link"
                      : "Not read yet"
                }
                brand={f.brand === "all" ? socialBrand(a.brand)?.short ?? "Unfiled" : undefined}
                warn={Boolean(a.lastError)}
              />
            ))}
            {missingPlatforms.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setConnect({ platform: p.key })}
                className="h-[58px] px-3 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" aria-hidden />
                <PlatformIcon platform={p.key} />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 whitespace-nowrap">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => write({ view: v.key })}
              aria-pressed={f.view === v.key}
              data-testid={`social-view-${v.key}`}
              className={cn(
                "px-3 h-11 md:h-9 rounded-md text-[13px] font-medium transition-colors",
                f.view === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {f.view === "overview" && <OverviewView query={scopeQuery} period={f.period} showAccount={!selected} onOpen={setOpenPost} onSeeAll={() => write({ view: "posts", sort: "top" })} />}
      {f.view === "posts" && (
        <PostsView query={scopeQuery} sort={f.sort} kind={f.kind} showAccount={!selected} onOpen={setOpenPost} onSort={(sort) => write({ sort })} onKind={(kind) => write({ kind })} />
      )}
      {f.view === "calendar" && (
        <CalendarView query={scopeQuery} month={f.month} today={accountsQuery.data?.today ?? null} showAccount={!selected} onOpen={setOpenPost} onMonth={(month) => write({ month })} />
      )}
      {f.view === "accounts" && (
        <AccountsView
          accounts={(f.brand === "all" ? allQuery.data?.accounts : accounts) ?? []}
          loading={allQuery.isLoading}
          tiktokSignIn={Boolean(allQuery.data?.tiktokSignIn)}
          tiktokResult={new URLSearchParams(search).get("tiktok")}
          tiktokName={new URLSearchParams(search).get("name")}
          onConnect={() => setConnect({ platform: null })}
          onFollowers={setFollowersFor}
        />
      )}

      <PostDialog post={openPost} onClose={() => setOpenPost(null)} />
      <ConnectDialog
        open={!!connect}
        onClose={() => setConnect(null)}
        defaultBrand={socialBrand(f.brand)?.key ?? null}
        defaultPlatform={connect?.platform ?? null}
      />
      <FollowersDialog account={followersFor} onClose={() => setFollowersFor(null)} />
    </div>
  );
}

function AccountChip({
  active,
  onClick,
  platform,
  title,
  sub,
  brand,
  warn,
}: {
  active: boolean;
  onClick: () => void;
  platform?: SocialPlatformKey;
  title: string;
  sub: string;
  brand?: string;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid="social-account-chip"
      className={cn(
        "h-[58px] px-3 rounded-xl border text-left inline-flex items-center gap-2.5 whitespace-nowrap transition-colors",
        active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-foreground/30",
      )}
    >
      {platform && <PlatformIcon platform={platform} className="w-5 h-5 text-foreground" />}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-foreground leading-tight">
          {title}
          {warn && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-destructive align-middle" title="The last update failed" />}
        </span>
        <span className="block text-xs text-muted-foreground leading-tight mt-0.5">
          {brand ? `${brand} · ` : ""}
          {sub}
        </span>
      </span>
    </button>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewView({
  query,
  period,
  showAccount,
  onOpen,
  onSeeAll,
}: {
  query: string;
  period: string;
  showAccount: boolean;
  onOpen: (p: SocialPost) => void;
  onSeeAll: () => void;
}) {
  const { data, isLoading, isError, error, refetch } = useQuery<SocialOverviewResponse>({
    queryKey: [`/api/admin/social/overview?${query}`],
    staleTime: 30_000,
  });
  if (isLoading) return <Loading rows={4} />;
  if (isError) return <LoadError error={error} onRetry={refetch} />;
  if (!data) return null;

  const label = socialPeriod(period).label.toLowerCase();
  const fl = data.followers;
  const bucketWord = data.postsOverTime.bucket === "day" ? "day" : data.postsOverTime.bucket === "week" ? "week" : "month";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Followers"
          value={fl.total == null ? "—" : fl.total.toLocaleString("en-NZ")}
          current={fl.total ?? undefined}
          previous={fl.atStart}
          deltaMode="diff"
          note={
            fl.total == null
              ? "No follower count read yet"
              : fl.accountsMissing > 0
                ? `${fl.accountsMissing} account${fl.accountsMissing === 1 ? "" : "s"} not counted (no reading yet)`
                : fl.atStart == null && period !== "all"
                  ? "No reading from the start of this period yet"
                  : undefined
          }
        />
        <StatTile label="Posts" value={data.posts.toLocaleString("en-NZ")} note={label} />
        <StatTile label="Likes, comments, shares, saves" value={data.interactions.toLocaleString("en-NZ")} note={`on posts from the ${label}`} />
        <StatTile
          label="Post views"
          value={data.postViews == null ? "—" : compactCount(data.postViews)}
          note={data.postViews == null ? "The platform gave no view counts" : `on posts from the ${label}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.followerSeries.length > 1 ? (
          <TrendChart title="Followers" kind="count" data={data.followerSeries.map((p) => ({ date: p.day, value: p.value }))} />
        ) : (
          <Card>
            <CardHeader className="pb-2"><h3 className="text-sm font-medium text-foreground">Followers</h3></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Platforms only give today's follower count, so this line builds up from the day an account is connected. Check back tomorrow.
              </p>
            </CardContent>
          </Card>
        )}
        <TrendChart title={`Posts per ${bucketWord}`} kind="count" data={data.postsOverTime.points.map((p) => ({ date: p.day, value: p.value }))} />
        {data.daily && data.daily.views.length > 0 && (
          <TrendChart title="Views per day (Instagram and Facebook)" kind="count" data={data.daily.views.map((p) => ({ date: p.day, value: p.value }))} />
        )}
        {data.daily && data.daily.reach.length > 0 && (
          <TrendChart title="People reached per day" kind="count" data={data.daily.reach.map((p) => ({ date: p.day, value: p.value }))} />
        )}
        {data.daily && data.daily.reach.length === 0 && data.daily.interactions.length > 0 && (
          <TrendChart title="Interactions per day (Instagram and Facebook)" kind="count" data={data.daily.interactions.map((p) => ({ date: p.day, value: p.value }))} />
        )}
      </div>

      {data.byKind.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><h3 className="text-sm font-medium text-foreground">By type of post</h3></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Posts</TableHead>
                    <TableHead className="text-right">Interactions</TableHead>
                    <TableHead className="text-right">Per post</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byKind.map((k) => (
                    <TableRow key={k.kind}>
                      <TableCell>{POST_KIND_LABEL[k.kind] ?? k.kind}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(k.posts)}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(k.interactions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{k.posts ? Math.round(k.interactions / k.posts).toLocaleString("en-NZ") : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(k.views)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Best posts, {label}</h2>
          {data.topPosts.length > 0 && (
            <button type="button" onClick={onSeeAll} className="text-xs text-muted-foreground hover:text-foreground h-11 md:h-auto px-1">
              See all posts
            </button>
          )}
        </div>
        {data.topPosts.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-6 text-center">Nothing was posted in the {label}.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.topPosts.map((p) => (
              <PostCard key={p.id} post={p} onOpen={onOpen} showAccount={showAccount} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Posts ───────────────────────────────────────────────────────────────────

const PAGE = 60;

function PostsView({
  query,
  sort,
  kind,
  showAccount,
  onOpen,
  onSort,
  onKind,
}: {
  query: string;
  sort: string;
  kind: string;
  showAccount: boolean;
  onOpen: (p: SocialPost) => void;
  onSort: (s: string) => void;
  onKind: (k: string) => void;
}) {
  const [pages, setPages] = useState(1);
  const key = `${query}&sort=${sort}${kind !== "all" ? `&kind=${kind}` : ""}`;
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setPages(1);
  }
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<SocialPostsResponse>({
    queryKey: [`/api/admin/social/posts?${key}&limit=${PAGE * pages}`],
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sort} onValueChange={onSort}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[200px]" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Newest first</SelectItem>
            <SelectItem value="top">Most interactions</SelectItem>
            <SelectItem value="views">Most views</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={onKind}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[160px]" aria-label="Type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(POST_KIND_LABEL).filter(([k]) => k !== "story" && k !== "short").map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && <span className="text-xs text-muted-foreground sm:ml-auto" data-testid="social-post-total">{data.total.toLocaleString("en-NZ")} posts</span>}
      </div>
      {isLoading ? (
        <Loading rows={4} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data || data.posts.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-6 text-center">No posts match. Try a longer period.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.posts.map((p) => (
              <PostCard key={p.id} post={p} onOpen={onOpen} showAccount={showAccount} />
            ))}
          </div>
          {data.posts.length < data.total && (
            <div className="flex justify-center">
              <Button variant="outline" className="h-11 md:h-9" disabled={isFetching} onClick={() => setPages((v) => v + 1)}>
                {isFetching ? "Loading…" : `Show more (${(data.total - data.posts.length).toLocaleString("en-NZ")} left)`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Calendar ────────────────────────────────────────────────────────────────

function CalendarView({
  query,
  month,
  today,
  showAccount,
  onOpen,
  onMonth,
}: {
  query: string;
  month: string | null;
  today: string | null;
  showAccount: boolean;
  onOpen: (p: SocialPost) => void;
  onMonth: (m: string) => void;
}) {
  const [day, setDay] = useState<string | null>(null);
  const cal = useQuery<SocialCalendarResponse>({ queryKey: [`/api/admin/social/calendar?${query}`], staleTime: 60_000 });

  const current = month ?? (today ? today.slice(0, 7) : null);
  const [y, m] = current ? current.split("-").map(Number) : [0, 0];
  const daysInMonth = current ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 0;
  const from = current ? `${current}-01` : "";
  const to = current ? `${current}-${pad(daysInMonth)}` : "";
  const posts = useQuery<SocialPostsResponse>({
    queryKey: [`/api/admin/social/posts?${query}&from=${from}&to=${to}&sort=oldest&limit=500`],
    enabled: Boolean(current),
    staleTime: 60_000,
  });

  const perMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of cal.data?.days ?? []) map.set(d.day.slice(0, 7), (map.get(d.day.slice(0, 7)) ?? 0) + d.posts);
    return map;
  }, [cal.data]);
  const byDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const p of posts.data?.posts ?? []) map.set(p.day, [...(map.get(p.day) ?? []), p]);
    return map;
  }, [posts.data]);

  if (cal.isLoading || !current) return <Loading rows={4} />;
  if (cal.isError) return <LoadError error={cal.error} onRetry={cal.refetch} />;

  const firstYear = cal.data?.firstDay ? Number(cal.data.firstDay.slice(0, 4)) : y;
  const thisYear = today ? Number(today.slice(0, 4)) : y;
  const years: number[] = [];
  for (let yr = thisYear; yr >= Math.min(firstYear, y); yr--) years.push(yr);
  const total = (cal.data?.days ?? []).reduce((s, d) => s + d.posts, 0);
  const step = (delta: number) => {
    const idx = y * 12 + (m - 1) + delta;
    setDay(null);
    onMonth(`${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`);
  };
  // Monday-first: getUTCDay() is 0 for Sunday.
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${current}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const dayPosts = day ? byDay.get(day) ?? [] : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {total === 0
          ? "No posts stored yet."
          : `${total.toLocaleString("en-NZ")} posts since ${cal.data?.firstDay ? longDay(cal.data.firstDay) : "the start"}.`}
      </p>

      {/* The whole history: a year, twelve months, how many posts in each. */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Select value={String(y)} onValueChange={(v) => { setDay(null); onMonth(`${v}-${pad(m)}`); }}>
              <SelectTrigger className="h-11 md:h-9 w-[120px]" aria-label="Year" data-testid="social-cal-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((yr) => (
                  <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {today && current !== today.slice(0, 7) && (
              <Button variant="outline" className="h-11 md:h-9" onClick={() => { setDay(null); onMonth(today.slice(0, 7)); }}>This month</Button>
            )}
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-1.5">
            {MONTHS.map((name, i) => {
              const key = `${y}-${pad(i + 1)}`;
              const n = perMonth.get(key) ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setDay(null); onMonth(key); }}
                  aria-pressed={key === current}
                  className={cn(
                    "rounded-lg border px-1 py-2 text-center transition-colors min-h-[44px]",
                    key === current ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-foreground/30",
                  )}
                >
                  <span className="block text-xs text-muted-foreground">{name.slice(0, 3)}</span>
                  <span className={cn("block text-sm font-medium tabular-nums", n ? "text-foreground" : "text-muted-foreground")}>{n || "·"}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground" data-testid="social-cal-title">{MONTHS[m - 1]} {y}</h3>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => step(-1)} aria-label="Previous month">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-11 w-11 md:h-9 md:w-9" onClick={() => step(1)} aria-label="Next month">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground mb-1">
            {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((iso, i) => {
              if (!iso) return <div key={`x${i}`} className="min-h-[52px] md:min-h-[96px]" />;
              const list = byDay.get(iso) ?? [];
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!list.length}
                  onClick={() => setDay(iso === day ? null : iso)}
                  aria-pressed={iso === day}
                  aria-label={`${longDay(iso)}, ${list.length} post${list.length === 1 ? "" : "s"}`}
                  data-testid={list.length ? "social-cal-day" : undefined}
                  className={cn(
                    "min-h-[52px] md:min-h-[96px] rounded-lg border p-1 text-left align-top flex flex-col gap-1 min-w-0 transition-colors",
                    iso === day ? "border-primary ring-1 ring-primary" : "border-border",
                    list.length ? "bg-card hover:border-foreground/30 cursor-pointer" : "bg-muted/30 cursor-default",
                  )}
                >
                  <span className={cn("text-[11px] leading-none tabular-nums", isToday ? "font-bold text-primary" : "text-muted-foreground")}>
                    {Number(iso.slice(8))}
                  </span>
                  {list.length > 0 && (
                    <>
                      <span className="hidden md:grid grid-cols-3 gap-0.5 w-full">
                        {list.slice(0, 3).map((p) =>
                          p.thumb ? (
                            <img key={p.id} src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full aspect-square object-cover rounded-sm bg-muted" />
                          ) : (
                            <span key={p.id} className="w-full aspect-square rounded-sm bg-muted flex items-center justify-center">
                              <PlatformIcon platform={p.platform} className="w-3 h-3 text-muted-foreground" />
                            </span>
                          ),
                        )}
                      </span>
                      <span className="text-[11px] font-medium text-foreground leading-none mt-auto">
                        {list.length}
                        <span className="hidden md:inline"> post{list.length === 1 ? "" : "s"}</span>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {posts.isLoading && <p className="text-xs text-muted-foreground mt-3">Loading this month's posts…</p>}
          {posts.isError && <p className="text-xs text-destructive mt-3">This month's posts could not be loaded.</p>}
          {posts.data && posts.data.total > posts.data.posts.length && (
            <p className="text-xs text-muted-foreground mt-3">Showing the first {posts.data.posts.length} of {posts.data.total} posts this month.</p>
          )}
        </CardContent>
      </Card>

      {day && (
        <div className="space-y-3" data-testid="social-cal-daylist">
          <h3 className="text-sm font-medium text-foreground">{longDay(day)} · {dayPosts.length} post{dayPosts.length === 1 ? "" : "s"}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {dayPosts.map((p) => (
              <PostCard key={p.id} post={p} onOpen={onOpen} showAccount={showAccount} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Accounts ────────────────────────────────────────────────────────────────

function AccountsView({
  accounts,
  loading,
  tiktokSignIn,
  tiktokResult,
  tiktokName,
  onConnect,
  onFollowers,
}: {
  accounts: SocialAccount[];
  loading: boolean;
  tiktokSignIn: boolean;
  tiktokResult: string | null;
  tiktokName: string | null;
  onConnect: () => void;
  onFollowers: (a: SocialAccount) => void;
}) {
  const [found, setFound] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const discover = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/social/discover");
      return (await res.json()) as { found: number; added: number };
    },
    onSuccess: async (r) => {
      setFound(r.added ? `Found ${r.added} new account${r.added === 1 ? "" : "s"}.` : `All ${r.found} Instagram and Facebook accounts are already here.`);
      await refreshSocial();
    },
    onError: () => setFound("Meta could not be reached. Try again."),
  });
  const patch = useMutation({
    mutationFn: async (v: { id: number; body: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/admin/social/accounts/${v.id}`, v.body);
    },
    onSettled: async () => {
      setRemoving(null);
      await refreshSocial();
    },
  });

  if (loading) return <Loading rows={4} />;
  const tiktokNote =
    tiktokResult === "connected" ? `TikTok @${tiktokName ?? ""} is connected. Its videos are loading now.`
    : tiktokResult === "added" ? `TikTok @${tiktokName ?? ""} is connected. Pick its brand in the list below.`
    : tiktokResult === "declined" ? "TikTok sign-in was cancelled. Nothing changed."
    : tiktokResult === "expired" ? "That sign-in took too long. Press Sign in with TikTok again."
    : tiktokResult === "off" ? "TikTok sign-in is not switched on yet."
    : tiktokResult === "failed" ? "TikTok did not accept the sign-in. Try again; if it keeps failing, the account may not be on the club's approved list at TikTok."
    : null;
  return (
    <div className="space-y-5">
      {tiktokNote && (
        <p
          role="status"
          data-testid="tiktok-result"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            tiktokResult === "connected" || tiktokResult === "added" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          {tiktokNote}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-11 md:h-9" onClick={onConnect}>
          <Plus className="w-4 h-4 mr-1.5" aria-hidden />
          Connect account
        </Button>
        <Button variant="outline" className="h-11 md:h-9" disabled={discover.isPending} onClick={() => discover.mutate()} data-testid="social-discover">
          <SearchIcon className="w-4 h-4 mr-1.5" aria-hidden />
          {discover.isPending ? "Looking…" : "Find Instagram and Facebook accounts"}
        </Button>
        {tiktokSignIn && (
          <Button asChild variant="outline" className="h-11 md:h-9">
            <a href="/api/admin/social/connect/tiktok" data-testid="tiktok-sign-in">Sign in with TikTok</a>
          </Button>
        )}
        {found && <span className="text-sm text-muted-foreground" role="status">{found}</span>}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Followers</TableHead>
                  <TableHead className="text-right">Posts stored</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No accounts yet. Press "Find Instagram and Facebook accounts".</TableCell>
                  </TableRow>
                )}
                {accounts.map((a) => (
                  <TableRow key={a.id} data-testid="social-account-row">
                    <TableCell>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <PlatformIcon platform={a.platform} />
                        {a.profileUrl ? (
                          <a href={a.profileUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline inline-flex items-center gap-1">
                            {accountName(a)}
                            <ExternalLink className="w-3 h-3 text-muted-foreground" aria-hidden />
                          </a>
                        ) : (
                          <span className="font-medium">{accountName(a)}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Select value={a.brand ?? "none"} onValueChange={(v) => patch.mutate({ id: a.id, body: { brand: v === "none" ? null : v } })}>
                        <SelectTrigger className="h-11 md:h-9 w-[190px]" aria-label={`Brand for ${accountName(a)}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not filed</SelectItem>
                          {SOCIAL_BRANDS.map((b) => (
                            <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.lastError ? (
                        <span className="text-destructive" title={a.lastError}>Last update failed</span>
                      ) : a.connection === "api" ? (
                        <span className="text-foreground">
                          Connected
                          {!a.historyComplete && <span className="block text-xs text-muted-foreground">Older posts still loading</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Saved link, not read yet</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">
                      {count(a.followers)}
                      {a.followersSource === "manual" && a.followersAt && (
                        <span className="block text-xs text-muted-foreground">typed in {longDay(a.followersAt)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.connection === "api" ? count(a.postsStored) : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{a.connection === "api" ? relativeTime(a.lastSyncedAt) : "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {a.platform === "tiktok" && tiktokSignIn && (a.connection === "link" || /sign-in|signed in/i.test(a.lastError ?? "")) && (
                        <Button asChild className="h-11 md:h-8 mr-1.5">
                          <a href="/api/admin/social/connect/tiktok">Sign in with TikTok</a>
                        </Button>
                      )}
                      {a.connection === "link" && (
                        <Button variant="outline" className="h-11 md:h-8 mr-1.5" onClick={() => onFollowers(a)}>Type in followers</Button>
                      )}
                      {removing === a.id ? (
                        <>
                          <Button variant="destructive" className="h-11 md:h-8 mr-1.5" onClick={() => patch.mutate({ id: a.id, body: { archived: true } })}>Remove</Button>
                          <Button variant="ghost" className="h-11 md:h-8" onClick={() => setRemoving(null)}>Keep</Button>
                        </>
                      ) : (
                        <Button variant="ghost" className="h-11 md:h-8 text-muted-foreground" onClick={() => setRemoving(a.id)}>Remove</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><h3 className="text-sm font-medium text-foreground">What each platform needs</h3></CardHeader>
        <CardContent className="space-y-3">
          {SOCIAL_PLATFORMS.map((p) => (
            <div key={p.key} className="flex gap-3">
              <PlatformIcon platform={p.key} className="mt-0.5 text-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {p.label}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {p.mode === "auto" ? "Found automatically through the club's Meta business account." : p.mode === "api" ? "Read automatically once switched on." : "Link saved; followers typed in for now."}
                  </span>
                </p>
                {p.setup?.map((s) => (
                  <p key={s} className="text-xs text-muted-foreground mt-0.5">{s}</p>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
