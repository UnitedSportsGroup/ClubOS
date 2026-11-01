// ─────────────────────────────────────────────────────────────────────────────
// Website — staff write the club site's news; the site rebuilds from it.
//
// Daniel, 2026-11-01: "give my people the keys, but be able to have the super
// admin control … revert it to what it was."
//
// What a person can do here is decided by the SERVER per site (shared/sites.ts):
// this page only hides buttons the server would refuse anyway. State lives in
// the URL (?site= &view= &status= &article=) so Back and links work.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft, CalendarClock, Check, ExternalLink, Eye, History, ImageIcon, Loader2, Newspaper, Pencil, Plus,
  RotateCcw, Search, Send, ShieldCheck, Sparkles, Trash2, Undo2, Upload, UserPlus, Users, X,
} from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { TimePickerInput } from "@/components/ui/time-picker-input";
import { SelectInput } from "@/components/ui/select-input";
import { RamboWorking } from "@/components/rambo-working";
import {
  ARTICLE_STATUS_LABEL, markdownToBlocks, nzLocalToInstant, slugify, nzTimeOf, nzToday, SITE_LEVEL_HELP, SITE_LEVEL_LABEL, SITE_LEVELS,
  type ArticleStatus, type BodyBlock, type SiteLevel,
} from "@shared/sites";

// ── Types (the server's answers) ─────────────────────────────────────────────
interface SiteSummary {
  id: number; key: string; brand: string; domain: string; name: string; ownerName: string | null; ownerNote: string | null;
  contentChangedAt: string | null; hasDeployHook: boolean; tags: string[]; level: SiteLevel | null;
  counts: { draft: number; scheduled: number; published: number; unpublished: number; forReview: number };
  can: { publish: boolean; revert: boolean; managePeople: boolean; grantApprover: boolean; rambo: boolean };
}
interface SitesAnswer { viewer: { userId: number; name: string; isSuperAdmin: boolean }; sites: SiteSummary[]; today: string }
interface Article {
  id: number; slug: string; title: string; summary: string; body?: string; heroImage: string | null; authorName: string | null;
  tags: string[]; status: ArticleStatus; displayDate: string; publishAt: string | null; seoTitle: string | null; seoDescription: string | null;
  source: string; reviewRequestedAt: string | null; reviewRequestedByName: string | null; firstPublishedAt: string | null;
  version: number; updatedAt: string; updatedByName: string | null; createdByName: string | null; isLive: boolean; canEdit: boolean;
}
interface Version { id: number; version: number; action: string; snapshot: any; savedBy: string | null; at: string }
interface Member { userId: number; name: string; email: string; level: SiteLevel; grantedAt: string; grantedBy: string | null }

// ── Small helpers ────────────────────────────────────────────────────────────
async function call<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await workspaceFetch(url, {
    method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text.trim() ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok || data?.ok === false) {
    const err: any = new Error(data?.message || `Something went wrong (${res.status}).`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data as T;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const niceWhen = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
};

const STATUS_STYLE: Record<ArticleStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  scheduled: "border-amber-500/40 bg-amber-500/15 text-amber-700",
  published: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700",
  unpublished: "border-red-500/40 bg-red-500/15 text-red-700",
};

function StatusBadge({ status, review }: { status: ArticleStatus; review?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>{ARTICLE_STATUS_LABEL[status]}</span>
      {review && status === "draft" && <span className="inline-flex items-center rounded-full border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-700">For review</span>}
    </span>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{children}</span>
);

/** The body as cufc.co.nz will show it — the same blocks, plain paragraphs. */
function BodyPreview({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => markdownToBlocks(markdown), [markdown]);
  if (!blocks.length) return <p className="text-sm text-muted-foreground">Nothing written yet.</p>;
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-foreground">
      {blocks.map((b: BodyBlock, i) => {
        if (typeof b === "string") return <p key={i}>{b}</p>;
        if ("image" in b) return (
          <figure key={i} className="overflow-hidden rounded-lg border border-border">
            <img src={b.image} alt={b.alt ?? ""} className="block w-full max-h-80 object-cover" loading="lazy" />
            {b.caption && <figcaption className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{b.caption}</figcaption>}
          </figure>
        );
        if ("video" in b) return <div key={i} className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Video: {b.video}</div>;
        return <p key={i}><a href={b.file} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">{b.label} (document)</a></p>;
      })}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────
export default function SitesPage() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const siteParam = Number(params.get("site")) || null;
  const view = (params.get("view") as "articles" | "people" | "activity") || "articles";
  const articleParam = params.get("article");

  const setParams = (patch: Record<string, string | null>, opts: { push?: boolean } = {}) => {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") p.delete(k); else p.set(k, v); }
    const qs = p.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: !opts.push });
  };

  const { data, isLoading, error } = useQuery<SitesAnswer>({
    queryKey: ["/api/admin/sites"],
    queryFn: () => call("GET", "/api/admin/sites"),
  });

  const sites = data?.sites ?? [];
  const site = sites.find((s) => s.id === siteParam) ?? (sites.length === 1 ? sites[0] : null);

  if (isLoading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading your sites…</div>;
  if (error) return <div className="p-6 text-red-700">Couldn't load the Website tab: {(error as Error).message}</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5 pb-28 md:pb-10" data-testid="sites-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Newspaper className="w-6 h-6" /> Website</h1>
          <p className="text-sm text-muted-foreground">Write and publish the club's news. Every change is kept, so anything can be put back.</p>
        </div>
      </div>

      {!sites.length && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2" data-testid="sites-empty">
          <p className="font-medium">{data?.viewer.isSuperAdmin ? "No website is set up for this workspace yet." : "You haven't been given access to a website yet."}</p>
          <p className="text-sm text-muted-foreground">{data?.viewer.isSuperAdmin ? "Websites live in the United Sports Group workspace and in the brand's own workspace." : "Ask Daniel or Travis to add you to the site you look after."}</p>
        </div>
      )}

      {sites.length > 1 && !site && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="sites-list">
          {sites.map((s) => (
            <button key={s.id} type="button" onClick={() => setParams({ site: String(s.id) }, { push: true })}
              className="text-left rounded-xl border border-border p-4 hover:bg-muted min-h-11" data-testid={`site-card-${s.key}`}>
              <div className="font-semibold">{s.name}</div>
              <div className="text-sm text-muted-foreground">{s.domain}</div>
              <div className="mt-2 text-xs text-muted-foreground">{s.counts.published} published · {s.counts.draft} drafts{s.counts.forReview ? ` · ${s.counts.forReview} for review` : ""}</div>
            </button>
          ))}
        </div>
      )}

      {site && (
        <SiteView
          key={site.id}
          site={site}
          isSuperAdmin={!!data?.viewer.isSuperAdmin}
          view={view}
          articleParam={articleParam}
          params={params}
          setParams={setParams}
          showAllSitesLink={sites.length > 1}
        />
      )}
    </div>
  );
}

// ── One site ─────────────────────────────────────────────────────────────────
function SiteView({ site, isSuperAdmin, view, articleParam, params, setParams, showAllSitesLink }: {
  site: SiteSummary; isSuperAdmin: boolean; view: string; articleParam: string | null; params: URLSearchParams;
  setParams: (p: Record<string, string | null>, o?: { push?: boolean }) => void; showAllSitesLink: boolean;
}) {
  const { data: live } = useQuery<{ checked: boolean; builtAt: string | null; upToDate: boolean | null; contentChangedAt: string | null; error: string | null }>({
    queryKey: ["/api/admin/sites", site.id, "live"],
    queryFn: () => call("GET", `/api/admin/sites/${site.id}/live`),
    refetchInterval: 60_000,
  });
  const levelLabel = isSuperAdmin ? "Super admin" : site.level ? SITE_LEVEL_LABEL[site.level] : "";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          {showAllSitesLink && (
            <button type="button" onClick={() => setParams({ site: null, article: null, view: null, status: null }, { push: true })} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 min-h-9">
              <ArrowLeft className="w-3 h-3" /> All sites
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{site.name}</h2>
            <a href={`https://${site.domain}/news`} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline inline-flex items-center gap-1 min-h-11 md:min-h-0">{site.domain} <ExternalLink className="w-3 h-3" /></a>
            {levelLabel && <span className="rounded-full border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-700" data-testid="site-level">{levelLabel}</span>}
          </div>
          <p className="text-xs text-muted-foreground" data-testid="site-live-status">
            {!live ? "Checking the live site…"
              : !live.checked ? `Couldn't reach ${site.domain} to check it (${live.error}).`
                : live.upToDate === false ? `Changes waiting to go live — the site was last rebuilt ${niceWhen(live.builtAt)}. It rebuilds automatically within a few minutes.`
                  : `The live site is up to date (rebuilt ${niceWhen(live.builtAt)}).`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist">
          {([["articles", "Articles", Newspaper], ...(site.can.managePeople ? [["people", "People", Users]] : []), ["activity", "Activity", History]] as [string, string, any][]).map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k}
              onClick={() => setParams({ view: k === "articles" ? null : k, article: null })}
              className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium inline-flex items-center gap-1.5 ${view === k ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}
              data-testid={`site-view-${k}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {view === "people" && site.can.managePeople ? <PeoplePanel site={site} />
        : view === "activity" ? <ActivityPanel site={site} />
          : articleParam ? <ArticleEditor site={site} articleParam={articleParam} onBack={() => setParams({ article: null }, { push: true })} onOpen={(id) => setParams({ article: String(id) })} />
            : <ArticleList site={site} params={params} setParams={setParams} />}
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────
const FILTERS: [string, string][] = [["all", "All"], ["draft", "Drafts"], ["review", "For review"], ["scheduled", "Scheduled"], ["published", "Published"], ["unpublished", "Unpublished"]];

function ArticleList({ site, params, setParams }: { site: SiteSummary; params: URLSearchParams; setParams: (p: Record<string, string | null>, o?: { push?: boolean }) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const status = params.get("status") || "all";
  const [q, setQ] = useState(params.get("q") || "");
  const [debounced, setDebounced] = useState(q);
  const [limit, setLimit] = useState(50);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const { data, isLoading, isFetching } = useQuery<{ total: number; articles: Article[] }>({
    queryKey: ["/api/admin/sites", site.id, "articles", status, debounced, limit],
    queryFn: () => call("GET", `/api/admin/sites/${site.id}/articles?status=${status}&limit=${limit}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
  });
  const counts: Record<string, number | null> = { all: null, draft: site.counts.draft, review: site.counts.forReview, scheduled: site.counts.scheduled, published: site.counts.published, unpublished: site.counts.unpublished };

  const create = async () => {
    setCreating(true);
    try {
      const r = await call<{ article: Article }>("POST", `/api/admin/sites/${site.id}/articles`, { title: "Untitled article", displayDate: nzToday(), tags: site.tags.slice(0, 1) });
      qc.invalidateQueries({ queryKey: ["/api/admin/sites"] });
      setParams({ article: String(r.article.id) }, { push: true });
    } catch (e: any) { toast({ title: "Couldn't start an article", description: e.message, variant: "destructive" }); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" data-testid="article-filters">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setLimit(50); setParams({ status: k === "all" ? null : k }); }}
              className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${status === k ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}
              data-testid={`article-filter-${k}`}>
              {label}{counts[k] != null ? <span className="opacity-60"> {counts[k]}</span> : null}
            </button>
          ))}
        </div>
        <Button onClick={create} disabled={creating} className="h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white" data-testid="article-new">
          {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />} New article
        </Button>
      </div>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an article by title or web address" className="pl-9 h-11 md:h-9" data-testid="article-search" />
      </div>

      {isLoading ? <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading articles…</div>
        : !data?.articles.length ? <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="article-empty">No articles here.</div>
          : (
            <div className="divide-y divide-border rounded-xl border border-border overflow-hidden" data-testid="article-list">
              {data.articles.map((a) => (
                <button key={a.id} type="button" onClick={() => setParams({ article: String(a.id) }, { push: true })}
                  className="w-full text-left flex items-center gap-3 p-3 hover:bg-muted min-h-11" data-testid={`article-row-${a.slug}`}>
                  <div className="w-20 h-14 md:w-24 md:h-16 shrink-0 overflow-hidden rounded-md bg-muted">
                    {a.heroImage ? <img src={heroSrc(a.heroImage, site.domain)} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-muted-foreground" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium leading-snug line-clamp-2">{a.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <StatusBadge status={a.status} review={!!a.reviewRequestedAt} />
                      <span>{a.status === "scheduled" && a.publishAt ? `Goes out ${niceWhen(a.publishAt)}` : niceDate(a.displayDate)}</span>
                      {a.updatedByName && <span>· edited by {a.updatedByName}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
      {data && data.total > data.articles.length && (
        <Button variant="outline" onClick={() => setLimit((l) => l + 50)} disabled={isFetching} className="h-11 md:h-9 w-full" data-testid="article-more">
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null} Show more ({data.total - data.articles.length} more)
        </Button>
      )}
    </div>
  );
}

/** A site path ("/img/…") is shown from the live site; a full link as it is. */
const heroSrc = (src: string, domain: string) => (src.startsWith("/") ? `https://${domain}${src}` : src);

// ── The editor ───────────────────────────────────────────────────────────────
type Draft = Pick<Article, "title" | "slug" | "summary" | "heroImage" | "authorName" | "tags" | "displayDate" | "seoTitle" | "seoDescription"> & { body: string };
const draftOf = (a: Article): Draft => ({
  title: a.title, slug: a.slug, summary: a.summary, body: a.body ?? "", heroImage: a.heroImage, authorName: a.authorName,
  tags: a.tags, displayDate: a.displayDate, seoTitle: a.seoTitle, seoDescription: a.seoDescription,
});
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

function ArticleEditor({ site, articleParam, onBack, onOpen }: { site: SiteSummary; articleParam: string; onBack: () => void; onOpen: (id: number) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const articleId = Number(articleParam);
  const { data, isLoading, error, refetch } = useQuery<{ article: Article; live: { checked: boolean; onSite: boolean | null; builtAt: string | null } | null; url: string }>({
    queryKey: ["/api/admin/sites", site.id, "article", articleId],
    queryFn: () => call("GET", `/api/admin/sites/${site.id}/articles/${articleId}`),
    enabled: Number.isInteger(articleId),
  });
  const article = data?.article ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSeo, setShowSeo] = useState(false);
  const [picking, setPicking] = useState(false);
  const [beforeRambo, setBeforeRambo] = useState<Draft | null>(null);
  const [publishKind, setPublishKind] = useState<"now" | "schedule">("now");
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("09:00");

  // Take the server's copy whenever a new version arrives.
  useEffect(() => {
    if (article && article.version !== baseVersion) {
      setDraft(draftOf(article)); setBaseVersion(article.version);
      if (article.status === "scheduled" && article.publishAt) {
        setPublishKind("schedule");
        setSchedDate(new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date(article.publishAt)));
        setSchedTime(nzTimeOf(new Date(article.publishAt)));
      }
    }
  }, [article, baseVersion]);

  const dirty = !!(article && draft && !sameDraft(draftOf(article), draft));
  // Leaving with unsaved words asks first.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const refresh = (a?: Article) => {
    qc.invalidateQueries({ queryKey: ["/api/admin/sites"] });
    if (a) qc.setQueryData(["/api/admin/sites", site.id, "article", articleId], (old: any) => (old ? { ...old, article: a } : old));
    refetch();
  };

  const save = async (): Promise<Article | null> => {
    if (!article || !draft) return null;
    setSaving(true);
    try {
      const r = await call<{ article: Article }>("PATCH", `/api/admin/sites/${site.id}/articles/${article.id}`, { ...draft, version: article.version });
      refresh(r.article);
      toast({ title: "Saved", description: r.article.isLive ? "The live site will update at its next rebuild." : undefined });
      return r.article;
    } catch (e: any) {
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
      return null;
    } finally { setSaving(false); }
  };

  const act = async (label: string, fn: (a: Article) => Promise<any>) => {
    if (!article) return;
    setBusy(label);
    try {
      let a: Article = article;
      if (dirty) { const s = await save(); if (!s) return; a = s; }
      const r = await fn(a);
      if (r?.article) refresh(r.article); else refresh();
      return r;
    } catch (e: any) {
      toast({ title: "That didn't work", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  if (isLoading || !draft) {
    if (error) return <div className="space-y-3"><BackLink onBack={onBack} /><p className="text-red-700">{(error as Error).message}</p></div>;
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Opening the article…</div>;
  }
  const a = article!;
  const canEdit = a.canEdit;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const schedInstant = schedDate && schedTime ? nzLocalToInstant(schedDate, schedTime) : null;

  return (
    <div className="space-y-4" data-testid="article-editor">
      {/* On a phone the Save button sits below the whole article — keep it in reach while there is something to save. */}
      {dirty && canEdit && (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background px-4 pt-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }} data-testid="article-save-bar">
          <Button onClick={save} disabled={saving} className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null} Save changes
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink onBack={() => { if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return; onBack(); }} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge status={a.status} review={!!a.reviewRequestedAt} />
          <span>Version {a.version}{a.updatedByName ? ` · last saved by ${a.updatedByName}` : ""} · {niceWhen(a.updatedAt)}</span>
          {a.isLive && <a href={data!.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1 min-h-11 md:min-h-0">View on site <ExternalLink className="w-3 h-3" /></a>}
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800" data-testid="article-readonly">
          {a.status === "draft" ? "You can read this article but not change it." : "This article is live or scheduled — only an editor can change it. You can read it and its history."}
        </div>
      )}
      {a.status === "draft" && a.reviewRequestedAt && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-800">
          {a.reviewRequestedByName ?? "Someone"} asked for this to be reviewed {niceWhen(a.reviewRequestedAt)}.
        </div>
      )}
      {data?.live && a.isLive && data.live.checked && data.live.onSite === false && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800" data-testid="article-not-yet-live">
          Published in ClubOS — it appears on {site.domain} at the site's next rebuild.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        {/* The words */}
        <div className="space-y-4 min-w-0">
          <label className="block">
            <Label>Headline</Label>
            <Input value={draft.title} onChange={(e) => {
              const title = e.target.value;
              // Until it has been public, the web address follows the headline (unless someone typed their own).
              const follows = !a.firstPublishedAt && (draft.slug.startsWith("untitled-article") || draft.slug === slugify(draft.title));
              setDraft((d) => (d ? { ...d, title, ...(follows ? { slug: slugify(title) } : {}) } : d));
            }} disabled={!canEdit} className="h-11 text-base font-semibold" data-testid="article-title" />
          </label>
          <label className="block">
            <Label>Summary (shows under the headline and on the news card)</Label>
            <Textarea value={draft.summary} onChange={(e) => set("summary", e.target.value)} disabled={!canEdit} rows={2} data-testid="article-summary" />
          </label>

          <div>
            <Label>Main photo</Label>
            <div className="flex flex-wrap items-start gap-3">
              <div className="w-40 h-24 overflow-hidden rounded-md border border-border bg-muted shrink-0">
                {draft.heroImage ? <img src={heroSrc(draft.heroImage, site.domain)} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No photo</div>}
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => setPicking(true)} data-testid="article-pick-photo"><ImageIcon className="w-4 h-4 mr-1.5" /> Choose a photo</Button>
                  {draft.heroImage && <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={() => set("heroImage", null)}><X className="w-4 h-4 mr-1" /> Remove</Button>}
                </div>
              )}
            </div>
            {picking && <PhotoPicker brand={site.brand} onClose={() => setPicking(false)} onPick={(src) => { set("heroImage", src); setPicking(false); }} />}
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The article</span>
              <div className="flex gap-1">
                {(["write", "preview"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`rounded-full border px-3 min-h-9 text-xs font-medium inline-flex items-center gap-1 ${mode === m ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}
                    data-testid={`article-mode-${m}`}>
                    {m === "write" ? <><Pencil className="w-3 h-3" /> Write</> : <><Eye className="w-3 h-3" /> Preview</>}
                  </button>
                ))}
              </div>
            </div>
            {mode === "write" ? (
              <>
                <Textarea value={draft.body} onChange={(e) => set("body", e.target.value)} disabled={!canEdit} rows={18} className="font-mono text-[13px] leading-relaxed" data-testid="article-body" />
                <p className="mt-1 text-xs text-muted-foreground">Leave a blank line between paragraphs. A picture on its own line: <code>![what it shows](https://… "caption")</code>. A video: <code>[video](https://www.youtube.com/embed/…)</code>.</p>
              </>
            ) : (
              <div className="rounded-xl border border-border p-4" data-testid="article-preview">
                <h3 className="text-xl font-semibold mb-1">{draft.title}</h3>
                <p className="text-muted-foreground mb-4">{draft.summary}</p>
                <BodyPreview markdown={draft.body} />
              </div>
            )}
          </div>

          {canEdit && site.can.rambo && (
            <RamboBox site={site} draft={draft} articleId={a.id} beforeRambo={beforeRambo}
              onResult={(next) => { setBeforeRambo(draft); setDraft(next); setMode("preview"); }}
              onUndo={() => { if (beforeRambo) setDraft(beforeRambo); setBeforeRambo(null); }} />
          )}

          <div className="rounded-xl border border-border">
            <button type="button" onClick={() => setShowSeo((v) => !v)} className="w-full text-left px-4 min-h-11 text-sm font-medium flex items-center justify-between" data-testid="article-seo-toggle">
              Search engines and web address <span className="text-xs text-muted-foreground">{showSeo ? "Hide" : "Show"}</span>
            </button>
            {showSeo && (
              <div className="px-4 pb-4 space-y-3">
                <label className="block">
                  <Label>Web address</Label>
                  <div className="flex items-center gap-1 text-sm"><span className="text-muted-foreground shrink-0">{site.domain}/news/</span>
                    <Input value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} disabled={!canEdit || !!a.firstPublishedAt} className="h-11 md:h-9" data-testid="article-slug" />
                  </div>
                  {a.firstPublishedAt && <p className="mt-1 text-xs text-muted-foreground">Fixed — this article has been public, and its address carries links and search ranking.</p>}
                </label>
                <label className="block">
                  <Label>Search title (blank = the headline)</Label>
                  <Input value={draft.seoTitle ?? ""} onChange={(e) => set("seoTitle", e.target.value)} disabled={!canEdit} className="h-11 md:h-9" />
                </label>
                <label className="block">
                  <Label>Search description (blank = the summary)</Label>
                  <Textarea value={draft.seoDescription ?? ""} onChange={(e) => set("seoDescription", e.target.value)} disabled={!canEdit} rows={2} />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* The side: details, publishing, history */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-4 space-y-3">
            <label className="block">
              <Label>Section</Label>
              <SelectInput value={draft.tags[0] ?? ""} onChange={(e) => set("tags", [e.target.value, ...draft.tags.filter((t) => t !== e.target.value)].slice(0, 4))} disabled={!canEdit} className="h-11 md:h-9 w-full">
                {site.tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </SelectInput>
            </label>
            <label className="block">
              <Label>Author (optional)</Label>
              <Input value={draft.authorName ?? ""} onChange={(e) => set("authorName", e.target.value)} disabled={!canEdit} className="h-11 md:h-9" />
            </label>
            <label className="block">
              <Label>Date shown on the site</Label>
              <DatePickerInput value={draft.displayDate} onChange={(e) => set("displayDate", e.target.value)} disabled={!canEdit} data-testid="article-date" />
              {draft.displayDate < nzToday() && <p className="mt-1 text-xs text-muted-foreground">Backdated — it sorts among the news of {niceDate(draft.displayDate)}. Nobody is emailed.</p>}
            </label>
            {canEdit && (
              <Button onClick={save} disabled={!dirty || saving} className="w-full h-11 md:h-9" variant={dirty ? "default" : "outline"} data-testid="article-save">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : dirty ? null : <Check className="w-4 h-4 mr-1.5" />} {dirty ? "Save changes" : "Saved"}
              </Button>
            )}
          </div>

          {/* Publishing */}
          <div className="rounded-xl border border-border p-4 space-y-3" data-testid="article-publishing">
            <div className="text-sm font-semibold">Publishing</div>
            {site.can.publish ? (
              <>
                {a.status !== "published" && (
                  <>
                    <div className="flex gap-2">
                      {([["now", "Publish now"], ["schedule", "Schedule"]] as const).map(([k, label]) => (
                        <button key={k} type="button" onClick={() => setPublishKind(k)}
                          className={`flex-1 rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${publishKind === k ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}
                          data-testid={`publish-kind-${k}`}>{label}</button>
                      ))}
                    </div>
                    {publishKind === "schedule" && (
                      <div className="grid grid-cols-2 gap-2">
                        <DatePickerInput value={schedDate} onChange={(e) => setSchedDate(e.target.value)} min={nzToday()} data-testid="schedule-date" />
                        <TimePickerInput value={schedTime} onChange={(e) => setSchedTime(e.target.value)} data-testid="schedule-time" />
                        <p className="col-span-2 text-xs text-muted-foreground">New Zealand time. It goes live on its own, then the site rebuilds.</p>
                      </div>
                    )}
                    <Button className="w-full h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white" disabled={!!busy || (publishKind === "schedule" && !schedInstant)}
                      data-testid="article-publish"
                      onClick={() => act("publish", (x) => call("POST", `/api/admin/sites/${site.id}/articles/${x.id}/publish`, publishKind === "now"
                        ? { kind: "now", displayDate: draft.displayDate, version: x.version }
                        : { kind: "schedule", publishAt: schedInstant!.toISOString(), displayDate: draft.displayDate <= schedDate ? draft.displayDate : schedDate, version: x.version })
                        .then((r) => { toast({ title: r.action === "scheduled" ? `Scheduled for ${niceWhen(r.article.publishAt)}` : "Published", description: "The site picks it up at its next rebuild." }); return r; }))}>
                      {busy === "publish" ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : publishKind === "now" ? <Send className="w-4 h-4 mr-1.5" /> : <CalendarClock className="w-4 h-4 mr-1.5" />}
                      {publishKind === "now" ? (a.status === "scheduled" ? "Publish now instead" : "Publish now") : a.status === "scheduled" ? "Change the schedule" : "Schedule it"}
                    </Button>
                  </>
                )}
                {a.status === "published" && <p className="text-sm text-muted-foreground">Published {niceDate(a.displayDate)}. Saved changes go live at the next rebuild.</p>}
                {(a.status === "published" || a.status === "scheduled") && (
                  <Button variant="outline" className="w-full h-11 md:h-9" disabled={!!busy} data-testid="article-unpublish"
                    onClick={() => { if (!confirm(a.status === "scheduled" ? "Cancel the schedule? It goes back to being a draft." : "Take this article off the website? It stays here and can be published again.")) return; act("unpublish", (x) => call("POST", `/api/admin/sites/${site.id}/articles/${x.id}/publish`, { kind: "unpublish", version: x.version })); }}>
                    {busy === "unpublish" ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Undo2 className="w-4 h-4 mr-1.5" />} {a.status === "scheduled" ? "Cancel the schedule" : "Unpublish"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">An editor publishes it. Send it for review when it's ready.</p>
                {a.status === "draft" && (
                  <Button className="w-full h-11 md:h-9" variant={a.reviewRequestedAt ? "outline" : "default"} disabled={!!busy} data-testid="article-submit"
                    onClick={() => act("submit", (x) => call("POST", `/api/admin/sites/${site.id}/articles/${x.id}/submit`, { withdraw: !!x.reviewRequestedAt }))}>
                    {busy === "submit" ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <ShieldCheck className="w-4 h-4 mr-1.5" />} {a.reviewRequestedAt ? "Withdraw from review" : "Send for review"}
                  </Button>
                )}
              </>
            )}
            {a.status === "draft" && !a.firstPublishedAt && (site.can.publish || a.canEdit) && (
              <Button variant="ghost" className="w-full h-11 md:h-9 text-red-700" disabled={!!busy} data-testid="article-delete"
                onClick={async () => {
                  if (!confirm("Delete this draft for good? It has never been public.")) return;
                  try { await call("DELETE", `/api/admin/sites/${site.id}/articles/${a.id}`); qc.invalidateQueries({ queryKey: ["/api/admin/sites"] }); onBack(); }
                  catch (e: any) { toast({ title: "Not deleted", description: e.message, variant: "destructive" }); }
                }}>
                <Trash2 className="w-4 h-4 mr-1.5" /> Delete draft
              </Button>
            )}
          </div>

          {/* History */}
          <div className="rounded-xl border border-border">
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="w-full text-left px-4 min-h-11 text-sm font-semibold flex items-center justify-between" data-testid="article-history-toggle">
              <span className="inline-flex items-center gap-1.5"><History className="w-4 h-4" /> History</span>
              <span className="text-xs text-muted-foreground font-normal">{showHistory ? "Hide" : `${a.version} version${a.version === 1 ? "" : "s"}`}</span>
            </button>
            {showHistory && (
              <VersionList site={site} article={a} canRevert={site.can.revert || a.status === "draft" && a.canEdit}
                onReverted={(next) => { refresh(next); toast({ title: "Put back", description: next.isLive ? "The live site will update at its next rebuild." : undefined }); }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1 min-h-11 md:min-h-9" data-testid="article-back">
      <ArrowLeft className="w-4 h-4" /> Articles
    </button>
  );
}

// ── History ──────────────────────────────────────────────────────────────────
function VersionList({ site, article, canRevert, onReverted }: { site: SiteSummary; article: Article; canRevert: boolean; onReverted: (a: Article) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ versions: Version[] }>({
    queryKey: ["/api/admin/sites", site.id, "article", article.id, "versions", article.version],
    queryFn: () => call("GET", `/api/admin/sites/${site.id}/articles/${article.id}/versions`),
  });
  if (isLoading) return <div className="px-4 pb-4 text-sm text-muted-foreground">Loading history…</div>;
  return (
    <div className="px-2 pb-3 space-y-1" data-testid="article-versions">
      {(data?.versions ?? []).map((v) => (
        <div key={v.id} className="rounded-lg px-2 py-2 hover:bg-muted">
          <div className="flex items-start justify-between gap-2">
            <button type="button" className="text-left min-w-0" onClick={() => setOpen(open === v.id ? null : v.id)}>
              <div className="text-sm"><span className="font-medium">v{v.version}</span> · {v.action}</div>
              <div className="text-xs text-muted-foreground">{v.savedBy ?? "ClubOS"} · {niceWhen(v.at)}</div>
            </button>
            {canRevert && v.version !== article.version && (
              <Button size="sm" variant="outline" className="h-9 shrink-0" disabled={busy != null} data-testid={`version-revert-${v.version}`}
                onClick={async () => {
                  if (!confirm(`Put the words back to version ${v.version}? This saves as a new version; nothing is lost.`)) return;
                  setBusy(v.id);
                  try { const r = await call<{ article: Article }>("POST", `/api/admin/sites/${site.id}/articles/${article.id}/revert`, { versionId: v.id, version: article.version }); onReverted(r.article); }
                  catch (e: any) { toast({ title: "Not put back", description: e.message, variant: "destructive" }); }
                  finally { setBusy(null); }
                }}>
                {busy === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><RotateCcw className="w-3.5 h-3.5 mr-1" /> Put back</>}
              </Button>
            )}
          </div>
          {open === v.id && (
            <div className="mt-2 rounded-md border border-border p-2 text-xs space-y-1">
              <div className="font-semibold">{v.snapshot?.title}</div>
              <div className="text-muted-foreground">{v.snapshot?.summary}</div>
              <div className="text-muted-foreground line-clamp-4 whitespace-pre-wrap">{String(v.snapshot?.body ?? "").slice(0, 400)}</div>
              <div className="text-muted-foreground">Status then: {ARTICLE_STATUS_LABEL[v.snapshot?.status as ArticleStatus] ?? v.snapshot?.status} · dated {niceDate(v.snapshot?.displayDate)}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Photos: the club's library, or upload your own ───────────────────────────
function PhotoPicker({ brand, onPick, onClose }: { brand: string; onPick: (src: string) => void; onClose: () => void }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery<{ pictures: { src: string; caption: string; brand: string }[] }>({
    queryKey: ["/api/admin/content-studio/pictures", brand],
    queryFn: () => call("GET", `/api/admin/content-studio/pictures?brand=${brand}`),
  });
  const pictures = (data?.pictures ?? []).filter((p) => p.brand === brand && !/product shot/i.test(p.caption));
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await workspaceFetch("/api/admin/content-studio/pictures", { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.message || "Upload failed");
      onPick(j.url);
    } catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setUploading(false); }
  };
  return (
    <div className="mt-3 rounded-xl border border-border p-3 space-y-3" data-testid="photo-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Choose a photo</span>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="photo-upload">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Upload className="w-4 h-4 mr-1.5" />} Upload
          </Button>
          <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a photo link (https://…)" className="h-11 md:h-9" />
        <Button type="button" variant="outline" className="h-11 md:h-9" disabled={!/^https:\/\//.test(link.trim())} onClick={() => onPick(link.trim())}>Use</Button>
      </div>
      {isLoading ? <div className="text-sm text-muted-foreground">Loading the library…</div> : (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 max-h-80 overflow-y-auto">
          {pictures.map((p) => (
            <button key={p.src} type="button" onClick={() => onPick(p.src)} title={p.caption} className="aspect-[4/3] overflow-hidden rounded-md border border-border hover:ring-2 hover:ring-blue-500">
              <img src={p.src} alt={p.caption} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Rambo for words ──────────────────────────────────────────────────────────
function RamboBox({ site, draft, articleId, beforeRambo, onResult, onUndo }: {
  site: SiteSummary; draft: Draft; articleId: number; beforeRambo: Draft | null; onResult: (d: Draft) => void; onUndo: () => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [instruction, setInstruction] = useState("");
  const [working, setWorking] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const hasWords = draft.body.trim().length > 0;
  const go = async () => {
    setWorking(true); setReply(null);
    try {
      const r = await call<any>("POST", `/api/admin/sites/${site.id}/rambo`, { notes, instruction, articleId, current: hasWords ? { title: draft.title, summary: draft.summary, body: draft.body } : null });
      onResult({ ...draft, title: r.title || draft.title, summary: r.summary || draft.summary, body: r.body || draft.body, seoTitle: r.seoTitle || draft.seoTitle, seoDescription: r.seoDescription || draft.seoDescription });
      setReply(r.reply || "Done.");
    } catch (e: any) { toast({ title: "Rambo couldn't write it", description: e.message, variant: "destructive" }); }
    finally { setWorking(false); }
  };
  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3" data-testid="rambo-box">
      <div className="flex items-center gap-2 text-sm font-semibold"><img src="/mailer/rambo.png" alt="" className="w-6 h-6 rounded-full" /> Rambo writes it</div>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder={"Your notes: what happened, who, when, where, the score, any quote word for word.\nRambo only uses what you give it — it never makes up a name, score or quote."} data-testid="rambo-notes" />
      <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={hasWords ? "What to change (e.g. shorter, warmer, lead with the result)" : "Anything else (optional)"} className="h-11 md:h-9" data-testid="rambo-instruction" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={go} disabled={working || (!notes.trim() && !hasWords)} className="h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white" data-testid="rambo-go">
          {working ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Sparkles className="w-4 h-4 mr-1.5" />} {hasWords ? "Rewrite it" : "Write it"}
        </Button>
        {beforeRambo && !working && <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => { onUndo(); setReply(null); }} data-testid="rambo-undo"><Undo2 className="w-4 h-4 mr-1.5" /> Undo Rambo</Button>}
      </div>
      {working && <RamboWorking stage="Writing the article" expect="usually under a minute" expectSeconds={35} compact />}
      {reply && !working && <p className="text-sm text-muted-foreground" data-testid="rambo-reply">{reply} Nothing is saved until you press Save — read the preview first.</p>}
    </div>
  );
}

// ── People ───────────────────────────────────────────────────────────────────
function PeoplePanel({ site }: { site: SiteSummary }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [newLevel, setNewLevel] = useState<SiteLevel>("writer");
  const [busy, setBusy] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ members: Member[]; superAdmins: { userId: number; name: string; email: string }[]; canGrantApprover: boolean }>({
    queryKey: ["/api/admin/sites", site.id, "people"],
    queryFn: () => call("GET", `/api/admin/sites/${site.id}/people`),
  });
  const { data: found } = useQuery<{ people: { userId: number; name: string; email: string }[] }>({
    queryKey: ["/api/admin/sites", site.id, "people", "candidates", q.trim()],
    queryFn: () => call("GET", `/api/admin/sites/${site.id}/people/candidates?q=${encodeURIComponent(q.trim())}`),
    enabled: q.trim().length >= 2,
  });
  const levels = SITE_LEVELS.filter((l) => l !== "approver" || data?.canGrantApprover);
  const grant = async (userId: number, level: SiteLevel) => {
    setBusy(userId);
    try { await call("POST", `/api/admin/sites/${site.id}/people`, { userId, level }); qc.invalidateQueries({ queryKey: ["/api/admin/sites", site.id, "people"] }); setQ(""); }
    catch (e: any) { toast({ title: "Not changed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const remove = async (m: Member) => {
    if (!confirm(`Take ${m.name}'s access to ${site.name} away? They keep nothing they could publish with; their past changes stay in the history.`)) return;
    setBusy(m.userId);
    try { await call("DELETE", `/api/admin/sites/${site.id}/people/${m.userId}`); qc.invalidateQueries({ queryKey: ["/api/admin/sites", site.id, "people"] }); }
    catch (e: any) { toast({ title: "Not removed", description: e.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  if (isLoading) return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading people…</div>;
  const members = data?.members ?? [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4" data-testid="people-panel">
      <div className="space-y-3 min-w-0">
        <div className="rounded-xl border border-border divide-y divide-border">
          {(data?.superAdmins ?? []).map((s) => (
            <div key={`s${s.userId}`} className="p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground truncate">{s.email}</div></div>
              <span className="text-xs text-muted-foreground">Super admin — every site, always</span>
            </div>
          ))}
          {members.map((m) => (
            <div key={m.userId} className="p-3 flex flex-wrap items-center justify-between gap-2" data-testid={`member-${m.userId}`}>
              <div className="min-w-0">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}{m.grantedBy ? ` · added by ${m.grantedBy}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                {m.level === "approver" && !data?.canGrantApprover
                  ? <span className="text-xs font-medium">{SITE_LEVEL_LABEL[m.level]}</span>
                  : (
                    <SelectInput value={m.level} onChange={(e) => grant(m.userId, e.target.value as SiteLevel)} disabled={busy === m.userId} className="w-36 h-11 md:h-9">
                      {levels.map((l) => <option key={l} value={l}>{SITE_LEVEL_LABEL[l]}</option>)}
                    </SelectInput>
                  )}
                {(m.level !== "approver" || data?.canGrantApprover) && (
                  <Button variant="ghost" className="h-11 md:h-9 text-red-700" onClick={() => remove(m)} disabled={busy === m.userId} aria-label={`Remove ${m.name}`}><X className="w-4 h-4" /></Button>
                )}
              </div>
            </div>
          ))}
          {!members.length && <div className="p-4 text-sm text-muted-foreground">Nobody else has access yet.</div>}
        </div>
        <div className="rounded-xl border border-border p-3 space-y-2">
          <div className="text-sm font-semibold flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> Give someone access</div>
          <div className="flex flex-wrap gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or email" className="h-11 md:h-9 flex-1 min-w-48" data-testid="people-search" />
            <SelectInput value={newLevel} onChange={(e) => setNewLevel(e.target.value as SiteLevel)} className="w-40 h-11 md:h-9">
              {levels.map((l) => <option key={l} value={l}>{SITE_LEVEL_LABEL[l]}</option>)}
            </SelectInput>
          </div>
          {(found?.people ?? []).filter((p) => !members.some((m) => m.userId === p.userId)).map((p) => (
            <div key={p.userId} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-muted-foreground truncate">{p.email}</div></div>
              <Button className="h-11 md:h-9" onClick={() => grant(p.userId, newLevel)} disabled={busy === p.userId}>Add as {SITE_LEVEL_LABEL[newLevel]}</Button>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border p-4 space-y-3 h-fit">
        <div className="text-sm font-semibold">What each level can do</div>
        {SITE_LEVELS.map((l) => (
          <div key={l}><div className="text-sm font-medium">{SITE_LEVEL_LABEL[l]}</div><p className="text-xs text-muted-foreground">{SITE_LEVEL_HELP[l]}</p></div>
        ))}
        <p className="text-xs text-muted-foreground">Access is given per site, by name. Being an admin of a workspace does not give anyone access to its website.</p>
      </div>
    </div>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────
function ActivityPanel({ site }: { site: SiteSummary }) {
  const { data, isLoading } = useQuery<{ events: { id: number; action: string; detail: any; by: string | null; at: string; title: string | null }[] }>({
    queryKey: ["/api/admin/sites", site.id, "activity"],
    queryFn: () => call("GET", `/api/admin/sites/${site.id}/activity`),
  });
  if (isLoading) return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading activity…</div>;
  const events = data?.events ?? [];
  if (!events.length) return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing has happened on this site in ClubOS yet.</div>;
  return (
    <div className="rounded-xl border border-border divide-y divide-border" data-testid="activity-panel">
      {events.map((e) => (
        <div key={e.id} className="p-3 text-sm">
          <span className="font-medium">{e.by ?? "ClubOS"}</span> <span className="text-muted-foreground">{e.action.replace(/-/g, " ")}</span>
          {e.title ? <> · <span>{e.title}</span></> : e.detail?.name ? <> · <span>{e.detail.name}{e.detail.level ? ` (${SITE_LEVEL_LABEL[e.detail.level as SiteLevel] ?? e.detail.level})` : ""}</span></> : null}
          <div className="text-xs text-muted-foreground">{niceWhen(e.at)}</div>
        </div>
      ))}
    </div>
  );
}
