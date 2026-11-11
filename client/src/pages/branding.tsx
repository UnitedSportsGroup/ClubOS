// ─────────────────────────────────────────────────────────────────────────────
// Branding — every brand's guidelines site, with a working board beside it.
// United Sports Group → Branding (its own item in the side menu).
//
// Daniel, 2026-11-11: "a separate tab in the side menu, not in the dropdown, for
// branding … each brand in there and its brand.southislandunited.com type page
// and info where we can work on branding, as branding is different to marketing."
//
// The guidelines live on each brand's own site; this page shows that site and
// keeps the notes, to-do list and links for the work. The brand is in the URL.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BRAND_HUBS, type BrandBoard, type BrandBoardsResponse, type BrandHub, type BrandLink, type BrandTodo } from "@shared/branding";

const KEY = "/api/admin/branding/boards";
const control = "h-11 md:h-9";
const newId = () => Math.random().toString(36).slice(2, 12);

export default function Branding() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const hub = useMemo(() => BRAND_HUBS.find((b) => b.key === new URLSearchParams(search).get("brand")) ?? BRAND_HUBS[0], [search]);
  const pick = (key: string) => navigate(key === BRAND_HUBS[0].key ? "/admin/branding" : `/admin/branding?brand=${key}`, { replace: true });

  const { data, isLoading, isError, error, refetch } = useQuery<BrandBoardsResponse>({ queryKey: [KEY], staleTime: 30_000 });
  const board = data?.boards.find((b) => b.brand === hub.key) ?? null;
  const open = (b: BrandBoard | undefined) => (b ? b.todos.filter((t) => !t.done).length : 0);

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-5 min-w-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Branding</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Each brand's guidelines, with the notes, to-do list and links for the work on it.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Brand">
        {BRAND_HUBS.map((b) => {
          const todo = open(data?.boards.find((x) => x.brand === b.key));
          return (
            <button
              key={b.key}
              type="button"
              role="tab"
              aria-selected={hub.key === b.key}
              onClick={() => pick(b.key)}
              data-testid={`brand-${b.key}`}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 h-11 text-sm font-medium transition-colors",
                hub.key === b.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-foreground/30",
              )}
            >
              <BrandMark hub={b} />
              <span className="whitespace-nowrap">{b.short}</span>
              {todo > 0 && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", hub.key === b.key ? "bg-white/20" : "bg-muted text-muted-foreground")} title={`${todo} to do`}>
                  {todo}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] items-start">
        <section className="rounded-xl border border-border bg-card overflow-hidden min-w-0 order-2 xl:order-1">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">{hub.name} brand guidelines</h2>
              <p className="text-xs text-muted-foreground truncate">{hub.hubUrl.replace(/^https:\/\//, "")}</p>
            </div>
            <Button asChild variant="outline" className={control}>
              <a href={hub.hubUrl} target="_blank" rel="noreferrer" data-testid="brand-open">
                <ExternalLink className="w-4 h-4 mr-1.5" aria-hidden />
                Open in a new tab
              </a>
            </Button>
          </div>
          {/* key = the brand, so switching brand loads the new site instead of navigating inside the old frame */}
          <iframe key={hub.key} src={hub.hubUrl} title={`${hub.name} brand guidelines`} className="block w-full h-[70vh] min-h-[480px] bg-white" loading="lazy" data-testid="brand-frame" />
        </section>

        <section className="min-w-0 order-1 xl:order-2">
          {isLoading ? (
            <Loading rows={3} />
          ) : isError ? (
            <LoadError error={error} onRetry={refetch} />
          ) : board ? (
            <Board key={hub.key} hub={hub} board={board} />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function BrandMark({ hub }: { hub: BrandHub }) {
  if (!hub.logo) {
    return <span className="grid place-items-center w-6 h-6 rounded bg-muted text-[10px] font-semibold text-muted-foreground" aria-hidden>{hub.short.slice(0, 2).toUpperCase()}</span>;
  }
  // Crests are drawn on a white tile so a white or dark mark both stay visible on the selected (dark) chip.
  return <span className="grid place-items-center w-6 h-6 rounded bg-white" aria-hidden><img src={hub.logo} alt="" className="max-w-[20px] max-h-[20px] object-contain" /></span>;
}

function Board({ hub, board }: { hub: BrandHub; board: BrandBoard }) {
  const [notes, setNotes] = useState(board.notes);
  const [todos, setTodos] = useState<BrandTodo[]>(board.todos);
  const [links, setLinks] = useState<BrandLink[]>(board.links);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [newTodo, setNewTodo] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  // The newest values, for the save that runs when the page is left mid-typing.
  const latest = useRef({ notes, todos, links });
  latest.current = { notes, todos, links };
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: async (v: { notes: string; todos: BrandTodo[]; links: BrandLink[] }) => {
      await apiRequest("PUT", `${KEY}/${hub.key}`, v);
    },
    onMutate: () => setState("saving"),
    onSuccess: () => {
      dirty.current = false;
      setState("saved");
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: [KEY] });
    },
    onError: (e: any) => {
      setState("error");
      setMessage(String(e?.message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1") || "That could not be saved.");
    },
  });

  const commit = (next: Partial<{ notes: string; todos: BrandTodo[]; links: BrandLink[] }>, wait = 0) => {
    const v = { ...latest.current, ...next };
    latest.current = v;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate(latest.current), wait);
  };

  // Leaving the page (or switching brand) with typing not yet saved: save it now.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) void apiRequest("PUT", `${KEY}/${hub.key}`, latest.current).then(() => queryClient.invalidateQueries({ queryKey: [KEY] })).catch(() => {});
    },
    [hub.key],
  );

  const addTodo = () => {
    const text = newTodo.trim();
    if (!text) return;
    const next = [...todos, { id: newId(), text, done: false }];
    setTodos(next);
    setNewTodo("");
    commit({ todos: next });
  };
  const addLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const next = [...links, { label: linkLabel.trim() || url.replace(/^https?:\/\//i, "").slice(0, 60), url }];
    setLinks(next);
    setLinkLabel("");
    setLinkUrl("");
    commit({ links: next });
  };

  const openTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">To do for {hub.short}</h2>
          <span className="text-xs text-muted-foreground" role="status" data-testid="brand-save-state">
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : board.updatedByName ? `Last edited by ${board.updatedByName}` : ""}
          </span>
        </div>
        {message && <p role="alert" className="text-sm text-destructive mt-2">{message}</p>}
        <form
          className="flex gap-2 mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            addTodo();
          }}
        >
          <Input className={control} value={newTodo} onChange={(e) => setNewTodo(e.target.value)} placeholder="Add something to do" aria-label="New to-do" autoComplete="off" data-testid="brand-todo-input" />
          <Button type="submit" className={control} disabled={!newTodo.trim()} aria-label="Add to-do" data-testid="brand-todo-add">
            <Plus className="w-4 h-4" aria-hidden />
          </Button>
        </form>
        {todos.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">Nothing on the list yet.</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {[...openTodos, ...doneTodos].map((t) => (
              <li key={t.id} className="flex items-start gap-2 min-h-11 md:min-h-9" data-testid="brand-todo">
                <label className="flex items-start gap-2.5 flex-1 min-w-0 py-2.5 md:py-1.5 cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={t.done}
                    onCheckedChange={(v) => {
                      const next = todos.map((x) => (x.id === t.id ? { ...x, done: v === true } : x));
                      setTodos(next);
                      commit({ todos: next });
                    }}
                  />
                  <span className={cn("text-sm break-words min-w-0", t.done ? "line-through text-muted-foreground" : "text-foreground")}>{t.text}</span>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-11 md:h-9 md:w-9 p-0 shrink-0 text-muted-foreground"
                  aria-label={`Remove "${t.text}"`}
                  onClick={() => {
                    const next = todos.filter((x) => x.id !== t.id);
                    setTodos(next);
                    commit({ todos: next });
                  }}
                >
                  <X className="w-4 h-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Working notes</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Decisions, ideas and anything still open. Saves as you type.</p>
        <Textarea
          className="mt-3 min-h-[180px]"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            commit({ notes: e.target.value }, 900);
          }}
          placeholder={`Notes on the ${hub.name} brand`}
          aria-label="Working notes"
          data-testid="brand-notes"
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Links</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Logo files, design files, fonts, photo folders.</p>
        {links.length > 0 && (
          <ul className="mt-3 space-y-1">
            {links.map((l, i) => (
              <li key={`${l.url}-${i}`} className="flex items-center gap-2 min-h-11 md:min-h-9">
                <a href={l.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-sm text-primary underline-offset-2 hover:underline truncate" title={l.url}>
                  {l.label}
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-11 md:h-9 md:w-9 p-0 shrink-0 text-muted-foreground"
                  aria-label={`Remove link ${l.label}`}
                  onClick={() => {
                    const next = links.filter((_, j) => j !== i);
                    setLinks(next);
                    commit({ links: next });
                  }}
                >
                  <X className="w-4 h-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            addLink();
          }}
        >
          <Input className={control} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="What it is (e.g. Logo pack)" aria-label="Link name" autoComplete="off" />
          <div className="flex gap-2">
            <Input className={control} inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" aria-label="Link address" autoComplete="off" />
            <Button type="submit" variant="outline" className={control} disabled={!linkUrl.trim()}>Add link</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
