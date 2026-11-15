// ─────────────────────────────────────────────────────────────────────────────
// Marketing → Ideas: the plan and the ideas backlog.
//
// One board, used two ways: the Ideas tab shows every idea (with a section
// filter), and each Marketing page opens the same board for its own section
// from the "Ideas" button (SectionIdeasButton, mounted once in the admin layout).
// See shared/marketing-ideas.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Lightbulb, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { centsToDollarInput, dollarInputToCents, formatCurrency } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { IDEA_SECTIONS, ideaSection, ideaSectionForPath, parseIdeaInput, type IdeasResponse, type MarketingIdea } from "@shared/marketing-ideas";

const API = "/api/admin/marketing-ideas";
const control = "h-11 md:h-9";
const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith(API) });
const nzDay = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric" });
const niceDay = (iso: string) => nzDay.format(new Date(iso));

export type IdeaSort = "newest" | "cheapest";

/**
 * The plan and the backlog. With `section` it is that section's ideas only;
 * without, it is every idea, narrowed by `filterSection` and `search`.
 */
export function IdeasBoard({
  section,
  filterSection = "all",
  search = "",
  sort = "newest",
  showRemoved = false,
  compact = false,
}: {
  section?: string;
  filterSection?: string;
  search?: string;
  sort?: IdeaSort;
  showRemoved?: boolean;
  compact?: boolean;
}) {
  const params = new URLSearchParams();
  if (section) params.set("section", section);
  if (showRemoved) params.set("removed", "1");
  const qs = params.toString();
  const key = `${API}${qs ? `?${qs}` : ""}`;
  const { data, isLoading, isError, error, refetch } = useQuery<IdeasResponse>({ queryKey: [key], staleTime: 30_000 });
  const [editing, setEditing] = useState<MarketingIdea | "new" | null>(null);

  if (isLoading) return <Loading />;
  if (isError || !data) return <LoadError error={error} onRetry={() => refetch()} />;

  const needle = search.trim().toLowerCase();
  const shown = data.ideas.filter(
    (i) =>
      (filterSection === "all" || i.section === filterSection) &&
      (!needle || i.title.toLowerCase().includes(needle) || (i.description ?? "").toLowerCase().includes(needle)),
  );
  // A blank cost sorts last: it is an unanswered question, not the cheapest idea.
  const byCost = (a: MarketingIdea, b: MarketingIdea) => (a.costCents ?? Infinity) - (b.costCents ?? Infinity);
  const order = (list: MarketingIdea[]) => (sort === "cheapest" ? [...list].sort(byCost) : list);
  const live = shown.filter((i) => !i.archived);
  const plan = order(live.filter((i) => i.stage === "plan"));
  const backlog = order(live.filter((i) => i.stage === "idea"));
  const removed = shown.filter((i) => i.archived);
  const filtered = filterSection !== "all" || !!needle;

  return (
    <div className="space-y-6 min-w-0" data-testid="ideas-board">
      <div className="flex justify-end">
        <Button className={control} onClick={() => setEditing("new")} data-testid="idea-log">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden />
          Log idea
        </Button>
      </div>

      <Group
        title="The plan"
        count={plan.length}
        testId="ideas-plan"
        empty={filtered ? "Nothing in the plan matches." : "Nothing in the plan yet. Move an idea up from the backlog when you decide to do it."}
      >
        {plan.map((i) => (
          <IdeaCard key={i.id} idea={i} showSection={!section} compact={compact} onEdit={() => setEditing(i)} />
        ))}
      </Group>

      <Group
        title="Ideas backlog"
        count={backlog.length}
        testId="ideas-backlog"
        empty={filtered ? "No ideas match." : "No ideas logged yet. Press Log idea whenever one comes up."}
      >
        {backlog.map((i) => (
          <IdeaCard key={i.id} idea={i} showSection={!section} compact={compact} onEdit={() => setEditing(i)} />
        ))}
      </Group>

      {showRemoved && (
        <Group title="Removed" count={removed.length} testId="ideas-removed" empty="Nothing has been removed.">
          {removed.map((i) => (
            <IdeaCard key={i.id} idea={i} showSection={!section} compact={compact} onEdit={() => setEditing(i)} />
          ))}
        </Group>
      )}

      {editing && (
        <IdeaDialog
          idea={editing === "new" ? null : editing}
          sections={data.sections}
          defaultSection={section ?? (filterSection !== "all" ? filterSection : undefined)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Group({ title, count, empty, testId, children }: { title: string; count: number; empty: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0" data-testid={testId}>
      <h2 className="text-base font-semibold text-foreground">
        {title} <span className="text-muted-foreground font-normal tabular-nums">· {count}</span>
      </h2>
      {count === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">{children}</ul>
      )}
    </section>
  );
}

function IdeaCard({ idea, showSection, compact, onEdit }: { idea: MarketingIdea; showSection: boolean; compact: boolean; onEdit: () => void }) {
  const sec = ideaSection(idea.section);
  const move = useMutation({
    mutationFn: (body: object) => apiRequest("PATCH", `${API}/${idea.id}`, body),
    onSuccess: refresh,
  });
  const inPlan = idea.stage === "plan";
  return (
    <li className={cn("rounded-xl border border-border bg-card p-4 min-w-0", idea.archived && "opacity-70")} data-testid="idea-card">
      <div className={cn("flex gap-3 min-w-0", compact ? "flex-col" : "flex-col md:flex-row md:items-start md:justify-between")}>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground break-words" data-testid="idea-title">{idea.title}</p>
          {idea.description && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">{idea.description}</p>}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {showSection && sec && (
              <div className="flex gap-1.5">
                <dt>Section</dt>
                <dd>
                  <Link href={sec.url} className="font-medium text-foreground underline-offset-2 hover:underline" data-testid="idea-section">
                    {sec.label}
                  </Link>
                </dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt>Rough cost</dt>
              <dd className="font-medium text-foreground tabular-nums" data-testid="idea-cost">
                {idea.costCents == null ? "—" : formatCurrency(idea.costCents, { fromCents: true })}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Rough time</dt>
              <dd className="font-medium text-foreground" data-testid="idea-time">{idea.timeEstimate ?? "—"}</dd>
            </div>
            <div>
              Logged {niceDay(idea.createdAt)}
              {idea.createdByName ? ` by ${idea.createdByName}` : ""}
            </div>
            {inPlan && idea.promotedAt && (
              <div>
                Moved to the plan {niceDay(idea.promotedAt)}
                {idea.promotedByName ? ` by ${idea.promotedByName}` : ""}
              </div>
            )}
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {idea.archived ? (
            <Button variant="outline" className={control} disabled={move.isPending} onClick={() => move.mutate({ archived: false })} data-testid="idea-restore">
              Put back
            </Button>
          ) : (
            <>
              {inPlan ? (
                <Button variant="outline" className={control} disabled={move.isPending} onClick={() => move.mutate({ stage: "idea" })} data-testid="idea-demote">
                  <ArrowDown className="w-4 h-4 mr-1.5" aria-hidden />
                  Back to ideas
                </Button>
              ) : (
                <Button className={control} disabled={move.isPending} onClick={() => move.mutate({ stage: "plan" })} data-testid="idea-promote">
                  <ArrowUp className="w-4 h-4 mr-1.5" aria-hidden />
                  Move to plan
                </Button>
              )}
              <Button variant="outline" className={control} onClick={onEdit} data-testid="idea-edit">
                <Pencil className="w-4 h-4 mr-1.5" aria-hidden />
                Edit
              </Button>
            </>
          )}
        </div>
      </div>
      {move.isError && <p role="alert" className="mt-2 text-sm text-destructive">{(move.error as Error)?.message ?? "That did not save."}</p>}
    </li>
  );
}

function IdeaDialog({ idea, sections, defaultSection, onClose }: { idea: MarketingIdea | null; sections: string[]; defaultSection?: string; onClose: () => void }) {
  const allowed = IDEA_SECTIONS.filter((s) => sections.includes(s.key));
  const [form, setForm] = useState({
    title: idea?.title ?? "",
    description: idea?.description ?? "",
    section: idea?.section ?? defaultSection ?? (allowed.length === 1 ? allowed[0].key : ""),
    cost: idea?.costCents != null ? centsToDollarInput(idea.costCents) : "",
    time: idea?.timeEstimate ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (body: object) => (idea ? apiRequest("PATCH", `${API}/${idea.id}`, body) : apiRequest("POST", API, body)),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (e: any) => setError(e?.message ?? "That did not save. Try again."),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("PATCH", `${API}/${idea!.id}`, { archived: true }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (e: any) => setError(e?.message ?? "That did not save. Try again."),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      title: form.title,
      description: form.description,
      section: form.section,
      costCents: form.cost.trim() ? dollarInputToCents(form.cost) : null,
      timeEstimate: form.time,
    };
    const parsed = parseIdeaInput(body);
    if ("error" in parsed) return setError(parsed.error);
    setError(null);
    save.mutate(parsed.value);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{idea ? "Edit idea" : "Log idea"}</DialogTitle>
          <DialogDescription>A title and where it belongs is enough. Cost and time are rough guesses and can stay blank.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 min-w-0" data-testid="idea-form">
          <div className="grid gap-1.5 min-w-0">
            <Label htmlFor="idea-title">Title</Label>
            <Input id="idea-title" className={control} value={form.title} onChange={(e) => set("title")(e.target.value)} autoComplete="off" autoFocus data-testid="idea-input-title" />
          </div>
          <div className="grid gap-1.5 min-w-0">
            <Label htmlFor="idea-desc">Description</Label>
            <Textarea id="idea-desc" rows={5} value={form.description} onChange={(e) => set("description")(e.target.value)} data-testid="idea-input-description" />
          </div>
          <div className="grid gap-1.5 min-w-0">
            <Label htmlFor="idea-section">Belongs to</Label>
            <Select value={form.section} onValueChange={set("section")}>
              <SelectTrigger id="idea-section" className={control} data-testid="idea-input-section">
                <SelectValue placeholder="Choose a part of marketing" />
              </SelectTrigger>
              <SelectContent>
                {allowed.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 min-w-0">
            <div className="grid gap-1.5 min-w-0">
              <Label htmlFor="idea-cost">Rough cost (optional)</Label>
              <MoneyInput id="idea-cost" className={control} value={form.cost} onChange={set("cost")} data-testid="idea-input-cost" />
            </div>
            <div className="grid gap-1.5 min-w-0">
              <Label htmlFor="idea-time">Rough time (optional)</Label>
              <Input id="idea-time" className={control} value={form.time} onChange={(e) => set("time")(e.target.value)} placeholder="e.g. 2 weeks" autoComplete="off" data-testid="idea-input-time" />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-between">
            {idea ? (
              <Button type="button" variant="outline" className={cn(control, "text-destructive")} disabled={remove.isPending || save.isPending} onClick={() => remove.mutate()} data-testid="idea-remove">
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button type="button" variant="outline" className={control} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className={control} disabled={save.isPending || remove.isPending} data-testid="idea-save">
                {save.isPending ? "Saving…" : idea ? "Save" : "Log idea"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The "Ideas" button on every Marketing page. Mounted once in the admin layout:
 * it works out which section the page is from the address, and opens that
 * section's plan and backlog in a side panel. Draws nothing anywhere else.
 */
export function SectionIdeasButton() {
  const [path] = useLocation();
  const { currentOrg } = useWorkspace();
  const section = (currentOrg as any)?.slug === "united-sports-group" ? ideaSectionForPath(path) : null;
  const [open, setOpen] = useState(false);
  const { data } = useQuery<IdeasResponse>({
    queryKey: [`${API}?section=${section?.key}`],
    enabled: !!section,
    staleTime: 30_000,
    retry: false,
  });
  // No section here, or this person cannot reach its ideas: nothing to draw.
  if (!section || !data) return null;
  const live = data.ideas.filter((i) => !i.archived).length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="section-ideas-button"
        className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-40 inline-flex items-center gap-2 h-11 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-lg hover:bg-muted transition-colors"
      >
        <Lightbulb className="w-4 h-4" aria-hidden />
        Ideas
        <span className="tabular-nums text-muted-foreground" data-testid="section-ideas-count">{live}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle>Ideas for {section.label}</SheetTitle>
            <SheetDescription>
              The plan and the backlog for this part of marketing.{" "}
              <Link href="/admin/marketing-ideas" className="underline underline-offset-2" onClick={() => setOpen(false)}>
                See every idea
              </Link>
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">{open && <IdeasBoard section={section.key} compact />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
