// Social media — the Feed (scroll every post, label it) and the Labels report
// (what each content type and each sponsor got: posts, views, by platform).
//
// 🔴 Only confirmed labels are counted. A suggestion from Rambo is drawn with a
//    dashed outline and a tick and a cross until a person decides.
// 🔴 A number the platform did not give is "—", never 0.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Bookmark, Check, ChevronLeft, Copy, ExternalLink, Eye, Heart, ImageOff, Maximize2, MessageCircle, Pencil, Plus, Share2, Sparkles, Tag, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PlatformIcon, PostCard, compactCount, count, longDay, refreshSocial } from "@/components/social/parts";
import { POST_KIND_LABEL, socialBrand, socialPlatform, type SocialPost } from "@shared/social";
import {
  LABEL_KINDS,
  adEquivalentCents,
  cpmCents,
  sponsorMessage,
  type FeedPost,
  type FeedResponse,
  type LabelFindState,
  type LabelKind,
  type LabelReportResponse,
  type LabelSummaryResponse,
  type LabelSummaryRow,
  type LabelsResponse,
  type PostLabel,
  type SocialLabel,
} from "@shared/social-labels";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const nzd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-NZ")}`;
const nzdExact = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function useLabels() {
  return useQuery<LabelsResponse>({ queryKey: ["/api/admin/social/labels"], staleTime: 60_000 });
}

async function readError(e: unknown): Promise<string> {
  const msg = String((e as any)?.message ?? e);
  // apiRequest throws "400: {json}".
  const m = msg.match(/\{.*\}$/);
  if (m) {
    try {
      return JSON.parse(m[0]).message ?? msg;
    } catch {
      return msg;
    }
  }
  return msg;
}

// ── A label chip ────────────────────────────────────────────────────────────

function chipTone(kind: LabelKind, suggested: boolean) {
  if (suggested) return "border-dashed border-amber-500/70 text-foreground bg-amber-500/10";
  return kind === "sponsor" ? "border-emerald-600/40 bg-emerald-500/10 text-foreground" : "border-border bg-muted text-foreground";
}

function LabelChip({ label, onConfirm, onRemove, busy }: { label: PostLabel; onConfirm: () => void; onRemove: () => void; busy: boolean }) {
  const suggested = label.status === "suggested";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 h-10 md:h-8 text-[13px] max-w-full", chipTone(label.kind, suggested))}
      data-testid="feed-label"
      data-status={label.status}
      title={suggested ? `Rambo's suggestion${label.reason ? `: ${label.reason}` : ""}` : label.kind === "sponsor" ? "Sponsor" : "Content type"}
    >
      {suggested && <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden />}
      <span className="truncate">{label.name}</span>
      {suggested && (
        <button type="button" disabled={busy} onClick={onConfirm} aria-label={`Yes, ${label.name}`} data-testid="feed-label-confirm" className="w-9 h-9 md:w-7 md:h-7 rounded-full inline-flex items-center justify-center hover:bg-emerald-500/20 text-emerald-700">
          <Check className="w-4 h-4" aria-hidden />
        </button>
      )}
      <button type="button" disabled={busy} onClick={onRemove} aria-label={`${suggested ? "No, not" : "Remove"} ${label.name}`} data-testid="feed-label-remove" className="w-9 h-9 md:w-7 md:h-7 rounded-full inline-flex items-center justify-center hover:bg-foreground/10 text-muted-foreground">
        <X className="w-4 h-4" aria-hidden />
      </button>
    </span>
  );
}

// ── Pick a label for a post ─────────────────────────────────────────────────

function LabelPicker({ labels, taken, onPick, onCreate, triggerLabel = "Label" }: { labels: SocialLabel[]; taken: Set<number>; onPick: (id: number) => void; onCreate: (kind: LabelKind, name: string) => void; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const shown = labels.filter((l) => !taken.has(l.id) && (!needle || l.name.toLowerCase().includes(needle)));
  const exact = labels.some((l) => l.name.toLowerCase() === needle);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setText(""); }}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="feed-add-label" className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 h-10 md:h-8 text-[13px] text-muted-foreground hover:text-foreground hover:border-foreground/40">
          <Plus className="w-3.5 h-3.5" aria-hidden />
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-[280px] p-2">
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Find or type a new label" className="h-10" data-testid="feed-label-search" />
        <div className="mt-2 max-h-[280px] overflow-y-auto">
          {LABEL_KINDS.map((k) => {
            const list = shown.filter((l) => l.kind === k.key);
            if (!list.length) return null;
            return (
              <div key={k.key} className="mb-1.5">
                <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
                {list.map((l) => (
                  <button key={l.id} type="button" data-testid="feed-label-option" onClick={() => { onPick(l.id); setOpen(false); setText(""); }} className="w-full text-left px-2 min-h-[40px] rounded-md text-sm text-foreground hover:bg-muted">
                    {l.name}
                  </button>
                ))}
              </div>
            );
          })}
          {needle && !exact && (
            <div className="border-t border-border pt-1.5 mt-1.5 space-y-1">
              {LABEL_KINDS.map((k) => (
                <button key={k.key} type="button" onClick={() => { onCreate(k.key, text.trim()); setOpen(false); setText(""); }} className="w-full text-left px-2 min-h-[40px] rounded-md text-sm text-foreground hover:bg-muted">
                  <Plus className="w-3.5 h-3.5 inline mr-1.5" aria-hidden />
                  New {k.one.toLowerCase()}: “{text.trim()}”
                </button>
              ))}
            </div>
          )}
          {!shown.length && !needle && <p className="px-2 py-3 text-sm text-muted-foreground">Every label is already on this post.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── One post in the feed ────────────────────────────────────────────────────

function Stat({ icon, value, label }: { icon: ReactNode; value: number | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={label}>
      {icon}
      <span className="tabular-nums text-foreground font-medium">{count(value)}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function FeedCard({ post, labels, allLabels, onChange }: { post: FeedPost; labels: PostLabel[]; allLabels: SocialLabel[]; onChange: (labels: PostLabel[]) => void }) {
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async (a: { add?: number; remove?: number; create?: { kind: LabelKind; name: string } }) => {
      let labelId = a.add;
      if (a.create) {
        const made = await (await apiRequest("POST", "/api/admin/social/labels", a.create)).json();
        labelId = made.id;
        queryClient.invalidateQueries({ queryKey: ["/api/admin/social/labels"] });
      }
      const res = a.remove != null
        ? await apiRequest("DELETE", `/api/admin/social/posts/${post.id}/labels/${a.remove}`)
        : await apiRequest("POST", `/api/admin/social/posts/${post.id}/labels`, { labelId });
      return (await res.json()).labels as PostLabel[];
    },
    onSuccess: (next) => { setError(null); onChange(next); },
    onError: async (e) => setError(await readError(e)),
  });
  const caption = post.caption ?? "";
  const long = caption.length > 220;
  return (
    <article className="rounded-xl border border-border bg-card overflow-hidden min-w-0" data-testid="feed-post" data-post={post.id}>
      <header className="flex items-center gap-2 px-3 py-2.5 min-w-0">
        <PlatformIcon platform={post.platform} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {/^\d+$/.test(post.handle) ? socialBrand(post.brand)?.name ?? socialPlatform(post.platform).label : `@${post.handle}`}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {longDay(post.day)} · {POST_KIND_LABEL[post.kind] ?? post.kind}
            {socialBrand(post.brand) ? ` · ${socialBrand(post.brand)!.short}` : ""}
          </p>
        </div>
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noreferrer" aria-label={`Open on ${socialPlatform(post.platform).label}`} className="w-11 h-11 md:w-9 md:h-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0">
            <ExternalLink className="w-4 h-4" aria-hidden />
          </a>
        )}
      </header>
      {post.large && !failed ? (
        <img src={post.large} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="w-full max-h-[720px] object-contain bg-muted" />
      ) : !caption ? (
        <div className="h-40 bg-muted flex items-center justify-center"><ImageOff className="w-5 h-5 text-muted-foreground" aria-hidden /></div>
      ) : null}
      <div className="p-3 space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
          <Stat icon={<Eye className="w-4 h-4 text-muted-foreground" aria-hidden />} value={post.views} label="views" />
          <Stat icon={<Users className="w-4 h-4 text-muted-foreground" aria-hidden />} value={post.reach} label="reached" />
          <Stat icon={<Heart className="w-4 h-4 text-muted-foreground" aria-hidden />} value={post.likes} label="likes" />
          <Stat icon={<MessageCircle className="w-4 h-4 text-muted-foreground" aria-hidden />} value={post.comments} label="comments" />
          <Stat icon={<Share2 className="w-4 h-4 text-muted-foreground" aria-hidden />} value={post.shares} label="shares" />
          <Stat icon={<Bookmark className="w-4 h-4 text-muted-foreground" aria-hidden />} value={post.saves} label="saves" />
        </div>
        {caption && (
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
            {long && !more ? `${caption.slice(0, 220).trimEnd()}… ` : caption}
            {long && (
              <button type="button" onClick={() => setMore((v) => !v)} className="text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1">
                {more ? "less" : "more"}
              </button>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0" data-testid="feed-labels">
          <Tag className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
          {labels.map((l) => (
            <LabelChip key={l.labelId} label={l} busy={act.isPending} onConfirm={() => act.mutate({ add: l.labelId })} onRemove={() => act.mutate({ remove: l.labelId })} />
          ))}
          <LabelPicker labels={allLabels} taken={new Set(labels.map((l) => l.labelId))} onPick={(id) => act.mutate({ add: id })} onCreate={(kind, name) => act.mutate({ create: { kind, name } })} />
        </div>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </div>
    </article>
  );
}

// ── The feed ────────────────────────────────────────────────────────────────

/** 1 = one post at a time (like Instagram); 3–6 = a grid that many posts wide, for labelling in bulk. */
export const FEED_COLS = [1, 3, 4, 5, 6] as const;
const COLS_KEY = "social-feed-cols";
export function rememberedFeedCols(): number {
  try {
    const n = Number(window.localStorage.getItem(COLS_KEY));
    return (FEED_COLS as readonly number[]).includes(n) ? n : 4;
  } catch {
    return 4;
  }
}

function ColsIcon({ n }: { n: number }) {
  if (n === 1) return <span className="block w-3 h-4 rounded-[2px] bg-current" aria-hidden />;
  return (
    <span className="flex gap-[2px]" aria-hidden>
      {Array.from({ length: n }, (_, i) => <span key={i} className="block w-[3px] h-4 rounded-[1px] bg-current" />)}
    </span>
  );
}

/** One post as a square tile: picture, views, date, its labels. Click selects it. */
function FeedTile({ post, labels, selected, onToggle, onOpen }: { post: FeedPost; labels: PostLabel[]; selected: boolean; onToggle: (shift: boolean) => void; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn("rounded-lg border bg-card overflow-hidden min-w-0 relative", selected ? "border-blue-600 ring-2 ring-blue-600" : "border-border")}
      data-testid="feed-tile"
      data-post={post.id}
      data-selected={selected ? "1" : "0"}
    >
      <button type="button" onClick={(e) => onToggle(e.shiftKey)} aria-pressed={selected} aria-label={`${selected ? "Unselect" : "Select"} post from ${longDay(post.day)}`} className="block w-full text-left">
        <div className="relative aspect-square bg-muted">
          {post.thumb && !failed ? (
            <img src={post.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 p-2 text-[11px] leading-snug text-muted-foreground overflow-hidden">{post.caption ? post.caption.slice(0, 140) : <ImageOff className="w-5 h-5" aria-hidden />}</div>
          )}
          <span className={cn("absolute top-1.5 left-1.5 w-6 h-6 rounded-full border-2 inline-flex items-center justify-center", selected ? "bg-blue-600 border-blue-600 text-white" : "bg-white/80 border-white text-transparent")}>
            <Check className="w-3.5 h-3.5" aria-hidden />
          </span>
        </div>
      </button>
      <button type="button" onClick={onOpen} aria-label="Open this post" data-testid="feed-tile-open" className="absolute top-1.5 right-1.5 w-8 h-8 rounded-md bg-white/85 text-slate-900 inline-flex items-center justify-center hover:bg-white">
        <Maximize2 className="w-4 h-4" aria-hidden />
      </button>
      <div className="px-1.5 pt-1 flex items-center justify-between gap-1 text-[11px] text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1 min-w-0"><PlatformIcon platform={post.platform} className="w-3 h-3" /><span className="truncate">{shortDay(post.day)}</span></span>
        <span className="inline-flex items-center gap-1 shrink-0 text-foreground font-medium" title="Views"><Eye className="w-3 h-3 text-muted-foreground" aria-hidden />{post.views == null ? "—" : compactCount(post.views)}</span>
      </div>
      <div className="px-1.5 py-1 min-h-[28px] flex flex-wrap gap-1" data-testid="feed-tile-labels">
        {labels.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">No label</span>
        ) : (
          labels.map((l) => (
            <span key={l.labelId} title={l.status === "suggested" ? "Rambo's suggestion, not confirmed" : undefined} className={cn("inline-flex items-center rounded-full border px-1.5 h-5 text-[11px] max-w-full", chipTone(l.kind, l.status === "suggested"))}>
              <span className="truncate">{l.name}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

const shortDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]?.slice(0, 3)} ${y.slice(2)}`;
};

export function FeedView({
  query,
  label,
  status,
  year,
  month,
  cols,
  firstYear,
  onFilter,
}: {
  query: string;
  /** "all" · "none" · "check" · a label id. */
  label: string;
  status: string;
  year: string | null;
  month: string | null;
  /** 1 = list, 3–6 = grid. */
  cols: number;
  firstYear: number;
  onFilter: (next: { label?: string; status?: string; year?: string | null; month?: string | null; cols?: number }) => void;
}) {
  const labelsQuery = useLabels();
  const allLabels = labelsQuery.data?.labels ?? [];
  const grid = cols > 1;
  const pageSize = grid ? 60 : 15;
  const key = `${query}&label=${label}${status ? `&status=${status}` : ""}${year ? `&year=${year}` : ""}${year && month ? `&month=${month}` : ""}`;
  // Labels changed on this screen, by post — so a tick shows at once without re-reading the feed.
  const [changed, setChanged] = useState<Record<number, PostLabel[]>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastTapped, setLastTapped] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setChanged({});
    setSelected(new Set());
    setLastTapped(null);
  }
  const { data, isLoading, isError, error, refetch, isFetching, fetchNextPage, hasNextPage } = useInfiniteQuery<FeedResponse>({
    queryKey: ["/api/admin/social/feed", key, pageSize],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await apiRequest("GET", `/api/admin/social/feed?${key}&limit=${pageSize}&offset=${pageParam}`)).json(),
    getNextPageParam: (last, all) => {
      const got = all.reduce((n, p) => n + p.posts.length, 0);
      return last.posts.length > 0 && got < last.total ? got : undefined;
    },
    staleTime: 30_000,
  });
  const total = data?.pages[0]?.total ?? 0;
  const posts = useMemo(() => {
    const seen = new Set<number>();
    const out: FeedPost[] = [];
    for (const page of data?.pages ?? []) for (const p of page.posts) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
    return out;
  }, [data]);
  const labelsOf = (p: FeedPost) => changed[p.id] ?? p.labels;
  const picked = /^\d+$/.test(label) ? allLabels.find((l) => l.id === Number(label)) ?? null : null;

  // Load the next page when the end of the list comes near.
  const end = useRef<HTMLDivElement | null>(null);
  const canMore = Boolean(hasNextPage);
  useEffect(() => {
    if (!canMore || isFetching) return;
    // The admin page scrolls inside its own panel, so listen for any scroll (capture) and ask
    // where the marker is. An observer misses a fast fling that jumps straight past the marker.
    const check = () => {
      const el = end.current;
      if (el && el.getBoundingClientRect().top < window.innerHeight + 1200) fetchNextPage();
    };
    check();
    window.addEventListener("scroll", check, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", check, { capture: true } as EventListenerOptions);
  }, [canMore, isFetching, posts.length, fetchNextPage]);

  // Rambo's unchecked suggestions for the chosen label, among the posts on screen.
  const waiting = picked ? posts.filter((p) => labelsOf(p).some((l) => l.labelId === picked.id && l.status === "suggested")).map((p) => p.id) : [];
  const confirmAll = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/social/labels/${picked!.id}/confirm`, { postIds: waiting });
    },
    onSuccess: () => { setChanged({}); refreshSocial(); },
  });

  // Grid: pick many, label them in one go.
  const toggle = (id: number, shift: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      const a = shift && lastTapped != null ? posts.findIndex((p) => p.id === lastTapped) : -1;
      const b = posts.findIndex((p) => p.id === id);
      if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(posts[i].id);
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastTapped(id);
  };
  const bulk = useMutation({
    mutationFn: async (a: { labelId?: number; remove?: boolean; create?: { kind: LabelKind; name: string } }) => {
      let labelId = a.labelId;
      if (a.create) {
        const made = await (await apiRequest("POST", "/api/admin/social/labels", a.create)).json();
        labelId = made.id;
        queryClient.invalidateQueries({ queryKey: ["/api/admin/social/labels"] });
      }
      const res = await apiRequest("POST", "/api/admin/social/posts/bulk-labels", { postIds: Array.from(selected), labelId, remove: a.remove === true });
      return (await res.json()).labels as Record<number, PostLabel[]>;
    },
    onSuccess: (next) => { setBulkError(null); setChanged((c) => ({ ...c, ...next })); setSelected(new Set()); setLastTapped(null); },
    onError: async (e) => setBulkError(await readError(e)),
  });
  const onSelected = useMemo(() => {
    const m = new Map<number, PostLabel>();
    for (const p of posts) if (selected.has(p.id)) for (const l of changed[p.id] ?? p.labels) m.set(l.labelId, l);
    return Array.from(m.values());
  }, [posts, selected, changed]);
  const openPost = openId != null ? posts.find((p) => p.id === openId) ?? null : null;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: Math.max(1, thisYear - firstYear + 1) }, (_, i) => String(thisYear - i));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={label} onValueChange={(v) => onFilter({ label: v, status: "" })}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[260px]" aria-label="Show" data-testid="feed-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every post</SelectItem>
            <SelectItem value="none">Not labelled yet</SelectItem>
            <SelectItem value="check">Rambo's suggestions to check</SelectItem>
            {LABEL_KINDS.map((k) => allLabels.filter((l) => l.kind === k.key).map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>{k.one}: {l.name}</SelectItem>
            )))}
          </SelectContent>
        </Select>
        <Select value={year ?? "all"} onValueChange={(v) => onFilter({ year: v === "all" ? null : v, month: null })}>
          <SelectTrigger className="h-11 md:h-9 w-[calc(50%-4px)] sm:w-[130px]" aria-label="Year" data-testid="feed-year"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        {year && (
          <Select value={month ?? "all"} onValueChange={(v) => onFilter({ month: v === "all" ? null : v })}>
            <SelectTrigger className="h-11 md:h-9 w-[calc(50%-4px)] sm:w-[150px]" aria-label="Month"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole year</SelectItem>
              {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-card" role="group" aria-label="Posts in a row" data-testid="feed-cols">
          {FEED_COLS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={cols === n}
              aria-label={n === 1 ? "One post at a time" : `${n} posts in a row`}
              title={n === 1 ? "One post at a time" : `${n} in a row`}
              data-testid={`feed-cols-${n}`}
              onClick={() => { try { window.localStorage.setItem(COLS_KEY, String(n)); } catch {} onFilter({ cols: n }); }}
              className={cn("h-10 md:h-8 min-w-[40px] px-2 rounded-md inline-flex items-center justify-center gap-1.5 text-[13px]", cols === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted", n > 3 && "hidden sm:inline-flex")}
            >
              <ColsIcon n={n} />
              {n > 1 && <span className="tabular-nums">{n}</span>}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-xs text-muted-foreground sm:ml-auto" data-testid="feed-total">
            {posts.length < total ? `${posts.length.toLocaleString("en-NZ")} of ` : ""}{total.toLocaleString("en-NZ")} posts
          </span>
        )}
      </div>

      {picked && waiting.length > 0 && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 flex flex-wrap items-center gap-3" data-testid="feed-confirm-bar">
          <p className="text-sm text-foreground flex-1 min-w-[200px]">
            Rambo thinks {waiting.length === 1 ? "1 post" : `${waiting.length} posts`} shown here {waiting.length === 1 ? "is" : "are"} “{picked.name}”. Scroll through, press the cross on any that are wrong, then confirm the rest. Only confirmed posts are counted.
          </p>
          <Button className="h-11 md:h-9" disabled={confirmAll.isPending} onClick={() => confirmAll.mutate()} data-testid="feed-confirm-all">
            <Check className="w-4 h-4 mr-1.5" aria-hidden />
            {confirmAll.isPending ? "Confirming…" : `Confirm ${waiting.length}`}
          </Button>
        </div>
      )}

      {grid && posts.length > 0 && (
        <p className="text-[13px] text-muted-foreground">
          Click posts to select them, then add a label to all of them at once. Hold Shift and click to select everything in between.{" "}
          <button type="button" className="underline underline-offset-2 text-foreground" onClick={() => setSelected(new Set(posts.map((p) => p.id)))} data-testid="feed-select-all">
            Select all {posts.length.toLocaleString("en-NZ")} shown
          </button>
        </p>
      )}

      {isLoading || labelsQuery.isLoading ? (
        <Loading rows={4} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-6 text-center">
          {label === "check" ? "Nothing waiting to be checked." : label === "none" ? "Every post here has a label." : "No posts match. Try another year or account."}
        </p>
      ) : (
        <div className={cn("w-full", !grid && "mx-auto max-w-[560px]")} data-testid="feed-list">
          {grid ? (
            <div className="grid gap-2 grid-cols-3 sm:[grid-template-columns:repeat(var(--feed-cols),minmax(0,1fr))]" style={{ ["--feed-cols" as any]: cols }} data-testid="feed-grid">
              {posts.map((p) => (
                <FeedTile key={p.id} post={p} labels={labelsOf(p)} selected={selected.has(p.id)} onToggle={(shift) => toggle(p.id, shift)} onOpen={() => setOpenId(p.id)} />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((p) => (
                <FeedCard key={p.id} post={p} labels={labelsOf(p)} allLabels={allLabels} onChange={(next) => setChanged((c) => ({ ...c, [p.id]: next }))} />
              ))}
            </div>
          )}
          {/* The marker: the next page is asked for well before the last post is reached. */}
          <div ref={end} aria-hidden />
          {canMore ? (
            <div className="flex justify-center pt-4">
              <Button variant="outline" className="h-11 md:h-9" disabled={isFetching} onClick={() => fetchNextPage()}>
                {isFetching ? "Loading…" : "Show more"}
              </Button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground pt-4" data-testid="feed-end">That is every post: {total.toLocaleString("en-NZ")}.</p>
          )}
        </div>
      )}

      {grid && selected.size > 0 && (
        <div className="sticky bottom-16 md:bottom-3 z-20 mx-auto w-full max-w-3xl rounded-xl border border-border bg-card shadow-lg p-2.5 flex flex-wrap items-center gap-2" data-testid="feed-bulk-bar">
          <span className="text-sm font-medium text-foreground px-1.5 tabular-nums">{selected.size.toLocaleString("en-NZ")} selected</span>
          <LabelPicker labels={allLabels} taken={new Set()} triggerLabel="Add a label to all" onPick={(id) => bulk.mutate({ labelId: id })} onCreate={(kind, name) => bulk.mutate({ create: { kind, name } })} />
          {onSelected.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 h-10 md:h-8 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted" data-testid="feed-bulk-remove">
                  <X className="w-3.5 h-3.5" aria-hidden />
                  Take a label off
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[260px] p-1.5 max-h-[300px] overflow-y-auto">
                {onSelected.map((l) => (
                  <button key={l.labelId} type="button" onClick={() => bulk.mutate({ labelId: l.labelId, remove: true })} className="w-full text-left px-2 min-h-[40px] rounded-md text-sm text-foreground hover:bg-muted">
                    {l.name}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
          {bulk.isPending && <span className="text-[13px] text-muted-foreground">Saving…</span>}
          {bulkError && <span className="text-[13px] text-red-600" role="alert">{bulkError}</span>}
          <Button variant="ghost" className="h-10 md:h-8 ml-auto" onClick={() => { setSelected(new Set()); setLastTapped(null); }} data-testid="feed-bulk-clear">Clear</Button>
        </div>
      )}

      <Dialog open={openPost != null} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="max-w-[600px] max-h-[92vh] overflow-y-auto p-3">
          <DialogHeader className="sr-only">
            <DialogTitle>Post</DialogTitle>
            <DialogDescription>The post with its numbers and labels.</DialogDescription>
          </DialogHeader>
          {openPost && <FeedCard post={openPost} labels={labelsOf(openPost)} allLabels={allLabels} onChange={(next) => setChanged((c) => ({ ...c, [openPost.id]: next }))} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Labels: add and edit ────────────────────────────────────────────────────

function LabelDialog({ open, editing, defaultKind, onClose }: { open: boolean; editing: SocialLabel | null; defaultKind: LabelKind; onClose: () => void }) {
  const [kind, setKind] = useState<LabelKind>(defaultKind);
  const [name, setName] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setKind(editing?.kind ?? defaultKind);
    setName(editing?.name ?? "");
    setHint(editing?.hint ?? "");
    setError(null);
  }, [open, editing, defaultKind]);
  const save = useMutation({
    mutationFn: async (archive?: boolean) => {
      if (editing) await apiRequest("PATCH", `/api/admin/social/labels/${editing.id}`, archive ? { archived: true } : { name, hint });
      else await apiRequest("POST", "/api/admin/social/labels", { kind, name, hint });
    },
    onSuccess: () => { refreshSocial(); onClose(); },
    onError: async (e) => setError(await readError(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit label" : "New label"}</DialogTitle>
          <DialogDescription>A content type says what a post is. A sponsor says whose name or logo is seen in it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!editing && (
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as LabelKind)}>
                <SelectTrigger className="h-11 md:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{LABEL_KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{k.one}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="label-name">Name</Label>
            <Input id="label-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-11 md:h-9" data-testid="label-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="label-hint">What to look for (optional)</Label>
            <Textarea id="label-hint" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={400} rows={3} placeholder="Rambo reads this when it looks through posts." />
          </div>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {editing ? (
            <Button variant="outline" className="h-11 md:h-9" disabled={save.isPending} onClick={() => save.mutate(true)}>Remove label</Button>
          ) : <span />}
          <Button className="h-11 md:h-9" disabled={save.isPending || !name.trim()} onClick={() => save.mutate(false)} data-testid="label-save">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rambo's search ──────────────────────────────────────────────────────────

function FindCard({ brand, year, onCheck }: { brand: string; year: string; onCheck: () => void }) {
  const url = `/api/admin/social/labels/find?brand=${encodeURIComponent(brand)}&year=${year}`;
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery<LabelFindState>({
    queryKey: [url],
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.run?.status === "running" ? 4000 : false),
  });
  const wasRunning = useRef(false);
  const running = data?.run?.status === "running";
  useEffect(() => {
    // The moment a search ends, the table below has new suggestions to show.
    if (wasRunning.current && !running) refreshSocial();
    wasRunning.current = running;
  }, [running]);
  const start = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/admin/social/labels/find", { brand, year }); },
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: [url] }); },
    onError: async (e) => setError(await readError(e)),
  });
  const stop = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/admin/social/labels/find/stop"); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [url] }),
  });
  if (!data) return null;
  const run = data.run;
  return (
    <Card data-testid="label-find">
      <CardContent className="p-4 flex flex-wrap items-center gap-3">
        <Sparkles className="w-5 h-5 text-amber-600 shrink-0" aria-hidden />
        <div className="flex-1 min-w-[220px] space-y-0.5">
          <p className="text-sm font-medium text-foreground">Find with Rambo</p>
          {running && run ? (
            <p className="text-sm text-muted-foreground" data-testid="label-find-progress">Looked at {run.done.toLocaleString("en-NZ")} of {run.total.toLocaleString("en-NZ")} posts · {run.suggested.toLocaleString("en-NZ")} suggestions so far.</p>
          ) : !data.enabled ? (
            <p className="text-sm text-muted-foreground">Rambo is not switched on for this server.</p>
          ) : data.unchecked === 0 ? (
            <p className="text-sm text-muted-foreground">Rambo has looked at every Instagram and Facebook post in this selection.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Rambo has not looked at {data.unchecked.toLocaleString("en-NZ")} Instagram and Facebook posts in this selection. It looks at each picture and caption and suggests labels for you to check. The next {data.perRun.toLocaleString("en-NZ")} cost about US${(data.estimateCents / 100).toFixed(2)}.
            </p>
          )}
          {!running && run && (run.status === "done" || run.error) && (
            <p className="text-xs text-muted-foreground">
              {run.error ?? `Last search: ${run.done.toLocaleString("en-NZ")} posts, ${run.suggested.toLocaleString("en-NZ")} suggestions, US$${(run.cents / 100).toFixed(2)}.`}
            </p>
          )}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          {run && run.suggested > 0 && !running && (
            <Button variant="outline" className="h-11 md:h-9" onClick={onCheck}>Check suggestions</Button>
          )}
          {running ? (
            <Button variant="outline" className="h-11 md:h-9" disabled={stop.isPending} onClick={() => stop.mutate()}>Stop</Button>
          ) : (
            <Button className="h-11 md:h-9" disabled={!data.enabled || data.unchecked === 0 || start.isPending} onClick={() => start.mutate()} data-testid="label-find-start">
              {start.isPending ? "Starting…" : "Find with Rambo"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── The Labels report ───────────────────────────────────────────────────────

function change(now: number | null, before: number | null | undefined): string | null {
  if (now == null || before == null || before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% on the year before`;
}

function Tile({ label, value, note, testid }: { label: string; value: string; note?: string | null; testid?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 min-w-0" data-testid={testid}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-foreground mt-1 truncate">{value}</p>
      {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );
}

export function LabelsView({
  brand,
  year,
  month,
  kind,
  open,
  today,
  onChange,
  onFeed,
  onOpenPost,
}: {
  brand: string;
  year: string;
  month: string | null;
  kind: LabelKind;
  open: number | null;
  today: string | null;
  onChange: (next: { year?: string; month?: string | null; kind?: LabelKind; open?: number | null }) => void;
  onFeed: (next: { label: string; status?: string; year?: string | null; month?: string | null }) => void;
  onOpenPost: (p: SocialPost) => void;
}) {
  const [dialog, setDialog] = useState<{ editing: SocialLabel | null } | null>(null);
  const thisYear = Number((today ?? "2026").slice(0, 4));
  const years = useMemo(() => Array.from({ length: thisYear - 2017 }, (_, i) => String(thisYear - i)), [thisYear]);
  const scope = `brand=${encodeURIComponent(brand)}&year=${year}${year !== "all" && month ? `&month=${month}` : ""}`;
  const summary = useQuery<LabelSummaryResponse>({
    queryKey: [`/api/admin/social/labels/summary?${scope}&kind=${kind}`],
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    enabled: open == null,
  });

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={year} onValueChange={(v) => onChange({ year: v, month: v === "all" ? null : month })}>
        <SelectTrigger className="h-11 md:h-9 w-[calc(50%-4px)] sm:w-[140px]" aria-label="Year" data-testid="labels-year"><SelectValue /></SelectTrigger>
        <SelectContent>
          {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          <SelectItem value="all">All time</SelectItem>
        </SelectContent>
      </Select>
      <Select value={month ?? "year"} onValueChange={(v) => onChange({ month: v === "year" ? null : v })} disabled={year === "all"}>
        <SelectTrigger className="h-11 md:h-9 w-[calc(50%-4px)] sm:w-[160px]" aria-label="Month" data-testid="labels-month"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="year">Whole year</SelectItem>
          {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  if (open != null) {
    return (
      <div className="space-y-4">
        <LabelReport id={open} scope={scope} brand={brand} controls={controls} onBack={() => onChange({ open: null })} onFeed={onFeed} year={year} month={month} onOpenPost={onOpenPost} onEdit={(l) => setDialog({ editing: l })} />
        <LabelDialog open={!!dialog} editing={dialog?.editing ?? null} defaultKind={kind} onClose={() => { setDialog(null); }} />
      </div>
    );
  }

  const rows = summary.data?.rows ?? [];
  const cpm = cpmCents(summary.data?.adCost ?? null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {LABEL_KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => onChange({ kind: k.key })} aria-pressed={kind === k.key} data-testid={`labels-kind-${k.key}`} className={cn("px-3 h-11 md:h-9 rounded-md text-[13px] font-medium", kind === k.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
              {k.label}
            </button>
          ))}
        </div>
        {controls}
        <Button variant="outline" className="h-11 md:h-9 sm:ml-auto" onClick={() => setDialog({ editing: null })} data-testid="label-new">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden />
          New label
        </Button>
      </div>

      <FindCard brand={brand} year={year} onCheck={() => onFeed({ label: "check", year: year === "all" ? null : year, month: null })} />

      {summary.isLoading ? (
        <Loading rows={4} />
      ) : summary.isError ? (
        <LoadError error={summary.error} onRetry={summary.refetch} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-6 text-center">No labels yet. Add one, then label posts in the Feed.</p>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm font-medium text-foreground">{kind === "sponsor" ? "Where each sponsor was seen" : "What each kind of post got"}: {summary.data!.window.label}</p>
            <p className="text-xs text-muted-foreground">
              Counts posts a person has confirmed. Views are added across posts and platforms; people reached are not, because one person can see several posts.
              {cpm != null ? ` Our own Meta ads cost ${nzdExact(cpm)} per 1,000 views over the last 12 months.` : ""}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {/* Phone: one card a label. */}
            <div className="md:hidden divide-y divide-border">
              {rows.map((r) => (
                <button key={r.label.id} type="button" onClick={() => onChange({ open: r.label.id })} className="w-full text-left p-4 space-y-1 hover:bg-muted" data-testid="label-row">
                  <p className="text-sm font-medium text-foreground">{r.label.name}</p>
                  <p className="text-sm text-muted-foreground">{r.posts.toLocaleString("en-NZ")} posts · {count(r.views)} views</p>
                  {r.toCheck > 0 && <p className="text-xs text-amber-700">{r.toCheck} from Rambo to check</p>}
                </button>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead className="text-right">Posts</TableHead>
                    <TableHead className="text-right">Instagram views</TableHead>
                    <TableHead className="text-right">Facebook views</TableHead>
                    <TableHead className="text-right">All views</TableHead>
                    <TableHead className="text-right">Year before</TableHead>
                    <TableHead className="text-right">Same views as ads</TableHead>
                    <TableHead className="text-right">To check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const ig = r.byPlatform.find((p) => p.platform === "instagram");
                    const fb = r.byPlatform.find((p) => p.platform === "facebook");
                    const ads = adEquivalentCents(r.views, summary.data!.adCost);
                    return (
                      <TableRow key={r.label.id} className="cursor-pointer" onClick={() => onChange({ open: r.label.id })} data-testid="label-row">
                        <TableCell className="font-medium text-foreground">{r.label.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.posts.toLocaleString("en-NZ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(ig?.views ?? null)}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(fb?.views ?? null)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{count(r.views)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.previous ? count(r.previous.views) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{ads != null ? nzd(ads) : "—"}</TableCell>
                        <TableCell className="text-right">
                          {r.toCheck > 0 ? (
                            <button type="button" onClick={(e) => { e.stopPropagation(); onFeed({ label: String(r.label.id), status: "suggested", year: year === "all" ? null : year, month }); }} className="text-amber-700 underline underline-offset-2 tabular-nums">
                              {r.toCheck}
                            </button>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      <LabelDialog open={!!dialog} editing={dialog?.editing ?? null} defaultKind={kind} onClose={() => setDialog(null)} />
    </div>
  );
}

// ── One label's report ──────────────────────────────────────────────────────

function LabelReport({
  id,
  scope,
  brand,
  controls,
  year,
  month,
  onBack,
  onFeed,
  onOpenPost,
  onEdit,
}: {
  id: number;
  scope: string;
  brand: string;
  controls: ReactNode;
  year: string;
  month: string | null;
  onBack: () => void;
  onFeed: (next: { label: string; status?: string; year?: string | null; month?: string | null }) => void;
  onOpenPost: (p: SocialPost) => void;
  onEdit: (l: SocialLabel) => void;
}) {
  const { data, isLoading, isError, error, refetch } = useQuery<LabelReportResponse>({
    queryKey: [`/api/admin/social/labels/${id}/report?${scope}`],
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const [copied, setCopied] = useState(false);
  if (isLoading) return <Loading rows={4} />;
  if (isError || !data) return <LoadError error={error} onRetry={refetch} />;
  const r: LabelSummaryRow = data.row;
  const brandName = socialBrand(brand)?.name ?? null;
  const message = sponsorMessage(r, data.window, brandName);
  const ads = adEquivalentCents(r.views, data.adCost);
  const cpm = cpmCents(data.adCost);
  const peak = Math.max(1, ...data.byMonth.map((m) => m.views));
  const feedScope = { year: year === "all" ? null : year, month };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-4" data-testid="label-report">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-11 md:h-9" onClick={onBack} data-testid="label-back">
          <ChevronLeft className="w-4 h-4 mr-1" aria-hidden />
          Labels
        </Button>
        {controls}
        <Button variant="outline" className="h-11 md:h-9 sm:ml-auto" onClick={() => onEdit(r.label)}>
          <Pencil className="w-4 h-4 mr-1.5" aria-hidden />
          Edit label
        </Button>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{r.label.kind === "sponsor" ? "Sponsor" : "Content type"} · {brandName ?? "All brands"} · {data.window.label}</p>
        <h2 className="text-xl font-semibold text-foreground" data-testid="label-report-name">{r.label.name}</h2>
      </div>

      {r.toCheck > 0 && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-foreground flex-1 min-w-[200px]">Rambo found {r.toCheck} more {r.toCheck === 1 ? "post" : "posts"} it thinks belong here. They are not counted until you check them.</p>
          <Button className="h-11 md:h-9" onClick={() => onFeed({ label: String(id), status: "suggested", ...feedScope })}>Check them</Button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Posts" value={r.posts.toLocaleString("en-NZ")} note={r.previous ? `${r.previous.posts.toLocaleString("en-NZ")} the year before` : null} testid="label-tile-posts" />
        <Tile label="Views" value={r.views == null ? "—" : compactCount(r.views)} note={r.posts === 0 ? "No confirmed posts in this period yet" : change(r.views, r.previous?.views) ?? (r.views != null ? `${r.views.toLocaleString("en-NZ")} exactly` : "The platforms gave no view counts")} testid="label-tile-views" />
        <Tile label="Likes, comments, shares, saves" value={r.interactions.toLocaleString("en-NZ")} />
        <Tile label="Same views bought as ads" value={ads != null ? nzd(ads) : "—"} note={cpm != null ? `At ${nzdExact(cpm)} per 1,000 views, what our own Meta ads cost` : "No ad spend on record to compare with"} />
      </div>
      {r.postsWithoutViews > 0 && (
        <p className="text-xs text-muted-foreground">{r.postsWithoutViews} of these posts had no view count from the platform (usually older posts), so the real total is higher.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><p className="text-sm font-medium text-foreground">By platform</p></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Platform</TableHead><TableHead className="text-right">Posts</TableHead><TableHead className="text-right">Views</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.byPlatform.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">No confirmed posts in this period.</TableCell></TableRow>}
                {r.byPlatform.map((p) => (
                  <TableRow key={p.platform}>
                    <TableCell><span className="inline-flex items-center gap-2"><PlatformIcon platform={p.platform} />{socialPlatform(p.platform).label}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{p.posts.toLocaleString("en-NZ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(p.views)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><p className="text-sm font-medium text-foreground">Views by month</p></CardHeader>
          <CardContent className="space-y-1.5">
            {data.byMonth.length === 0 && <p className="text-sm text-muted-foreground">Nothing to show yet.</p>}
            {data.byMonth.map((m) => (
              <div key={m.month} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{MONTHS[Number(m.month.slice(5)) - 1].slice(0, 3)} {m.month.slice(2, 4)}</span>
                <div className="flex-1 h-4 rounded bg-muted overflow-hidden"><div className="h-full bg-blue-600" style={{ width: `${Math.max(1, (m.views / peak) * 100)}%` }} /></div>
                <span className="w-24 shrink-0 text-right tabular-nums text-foreground">{m.views.toLocaleString("en-NZ")}</span>
                <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{m.posts} {m.posts === 1 ? "post" : "posts"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">Update to send</p>
            <p className="text-xs text-muted-foreground">Plain text for a WhatsApp group or an email. It carries confirmed posts only.</p>
          </div>
          <Button variant="outline" className="h-11 md:h-9 shrink-0" onClick={copy} data-testid="label-copy">
            {copied ? <Check className="w-4 h-4 mr-1.5" aria-hidden /> : <Copy className="w-4 h-4 mr-1.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-sans rounded-lg bg-muted p-3" data-testid="label-message">{message}</pre>
        </CardContent>
      </Card>

      {data.topPosts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Most viewed</p>
            <Button variant="outline" className="h-11 md:h-9" onClick={() => onFeed({ label: String(id), status: "", ...feedScope })}>See all in the feed</Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.topPosts.map((p) => <PostCard key={p.id} post={p} onOpen={onOpenPost} showAccount />)}
          </div>
        </div>
      )}
    </div>
  );
}
