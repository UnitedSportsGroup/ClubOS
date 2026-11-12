// Social media — the Feed (scroll every post, label it) and the Labels report
// (what each content type and each sponsor got: posts, views, by platform).
//
// 🔴 Only confirmed labels are counted. A suggestion from Rambo is drawn with a
//    dashed outline and a tick and a cross until a person decides.
// 🔴 A number the platform did not give is "—", never 0.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bookmark, Check, ChevronLeft, Copy, ExternalLink, Eye, Heart, ImageOff, MessageCircle, Pencil, Plus, Share2, Sparkles, Tag, Users, X } from "lucide-react";
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
      className={cn("inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 h-8 text-[13px] max-w-full", chipTone(label.kind, suggested))}
      data-testid="feed-label"
      data-status={label.status}
      title={suggested ? `Rambo's suggestion${label.reason ? `: ${label.reason}` : ""}` : label.kind === "sponsor" ? "Sponsor" : "Content type"}
    >
      {suggested && <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden />}
      <span className="truncate">{label.name}</span>
      {suggested && (
        <button type="button" disabled={busy} onClick={onConfirm} aria-label={`Yes, ${label.name}`} data-testid="feed-label-confirm" className="w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-emerald-500/20 text-emerald-700">
          <Check className="w-4 h-4" aria-hidden />
        </button>
      )}
      <button type="button" disabled={busy} onClick={onRemove} aria-label={`${suggested ? "No, not" : "Remove"} ${label.name}`} data-testid="feed-label-remove" className="w-7 h-7 rounded-full inline-flex items-center justify-center hover:bg-foreground/10 text-muted-foreground">
        <X className="w-4 h-4" aria-hidden />
      </button>
    </span>
  );
}

// ── Pick a label for a post ─────────────────────────────────────────────────

function LabelPicker({ labels, taken, onPick, onCreate }: { labels: SocialLabel[]; taken: Set<number>; onPick: (id: number) => void; onCreate: (kind: LabelKind, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const shown = labels.filter((l) => !taken.has(l.id) && (!needle || l.name.toLowerCase().includes(needle)));
  const exact = labels.some((l) => l.name.toLowerCase() === needle);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setText(""); }}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="feed-add-label" className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 h-8 text-[13px] text-muted-foreground hover:text-foreground hover:border-foreground/40">
          <Plus className="w-3.5 h-3.5" aria-hidden />
          Label
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-2">
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

const FEED_PAGE = 15;

export function FeedView({
  query,
  label,
  status,
  year,
  month,
  onFilter,
}: {
  query: string;
  /** "all" · "none" · "check" · a label id. */
  label: string;
  status: string;
  year: string | null;
  month: string | null;
  onFilter: (next: { label?: string; status?: string; year?: string | null; month?: string | null }) => void;
}) {
  const labelsQuery = useLabels();
  const allLabels = labelsQuery.data?.labels ?? [];
  const key = `${query}&label=${label}${status ? `&status=${status}` : ""}${year ? `&year=${year}` : ""}${year && month ? `&month=${month}` : ""}`;
  const [pages, setPages] = useState(1);
  const [seenKey, setSeenKey] = useState(key);
  // Labels changed on this screen, by post — so a tick shows at once without re-reading the feed.
  const [changed, setChanged] = useState<Record<number, PostLabel[]>>({});
  if (seenKey !== key) {
    setSeenKey(key);
    setPages(1);
    setChanged({});
  }
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<FeedResponse>({
    queryKey: [`/api/admin/social/feed?${key}&limit=${FEED_PAGE * pages}`],
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const posts = data?.posts ?? [];
  const labelsOf = (p: FeedPost) => changed[p.id] ?? p.labels;
  const picked = /^\d+$/.test(label) ? allLabels.find((l) => l.id === Number(label)) ?? null : null;

  // Load the next page when the end of the list comes into view.
  const end = useRef<HTMLDivElement | null>(null);
  const canMore = posts.length < (data?.total ?? 0) && FEED_PAGE * pages < 200;
  useEffect(() => {
    const el = end.current;
    if (!el || !canMore || isFetching) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) setPages((v) => v + 1); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [canMore, isFetching, posts.length]);

  // Rambo's unchecked suggestions for the chosen label, among the posts on screen.
  const waiting = picked ? posts.filter((p) => labelsOf(p).some((l) => l.labelId === picked.id && l.status === "suggested")).map((p) => p.id) : [];
  const confirmAll = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/social/labels/${picked!.id}/confirm`, { postIds: waiting });
    },
    onSuccess: () => { setChanged({}); refreshSocial(); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={label} onValueChange={(v) => onFilter({ label: v, status: "" })}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[280px]" aria-label="Show" data-testid="feed-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every post</SelectItem>
            <SelectItem value="none">Not labelled yet</SelectItem>
            <SelectItem value="check">Rambo's suggestions to check</SelectItem>
            {LABEL_KINDS.map((k) => allLabels.filter((l) => l.kind === k.key).map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>{k.one}: {l.name}</SelectItem>
            )))}
          </SelectContent>
        </Select>
        {year && (
          <button type="button" onClick={() => onFilter({ year: null, month: null })} className="inline-flex items-center gap-1 rounded-full border border-border px-3 h-9 text-[13px] text-foreground hover:bg-muted">
            {month ? `${MONTHS[Number(month) - 1]} ${year}` : year}
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
        {data && <span className="text-xs text-muted-foreground sm:ml-auto" data-testid="feed-total">{data.total.toLocaleString("en-NZ")} posts</span>}
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

      {isLoading || labelsQuery.isLoading ? (
        <Loading rows={4} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-6 text-center">
          {label === "check" ? "Nothing waiting to be checked." : label === "none" ? "Every post in this period has a label." : "No posts match. Try a longer period."}
        </p>
      ) : (
        <div className="mx-auto w-full max-w-[560px] space-y-4" data-testid="feed-list">
          {posts.map((p) => (
            <FeedCard key={p.id} post={p} labels={labelsOf(p)} allLabels={allLabels} onChange={(next) => setChanged((c) => ({ ...c, [p.id]: next }))} />
          ))}
          <div ref={end} />
          {canMore ? (
            <div className="flex justify-center">
              <Button variant="outline" className="h-11 md:h-9" disabled={isFetching} onClick={() => setPages((v) => v + 1)}>
                {isFetching ? "Loading…" : "Show more"}
              </Button>
            </div>
          ) : posts.length < (data?.total ?? 0) ? (
            <p className="text-center text-sm text-muted-foreground">Showing the newest {posts.length}. Narrow the period or pick a label to see older posts.</p>
          ) : null}
        </div>
      )}
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
        <Tile label="Views" value={r.views == null ? "—" : compactCount(r.views)} note={change(r.views, r.previous?.views) ?? (r.views != null ? `${r.views.toLocaleString("en-NZ")} exactly` : "The platforms gave no view counts")} testid="label-tile-views" />
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
