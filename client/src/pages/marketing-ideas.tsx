// ─────────────────────────────────────────────────────────────────────────────
// Marketing → Ideas. United Sports Group.
//
// Daniel, 2026-11-12: "an ideas backlog … when anything pops up, I can just log
// it in there". Every idea across Marketing: the plan on top, the backlog under
// it. The section, search, sort and "show removed" live in the URL.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IdeasBoard, type IdeaSort } from "@/components/marketing-ideas";
import { IDEAS_URL, IDEA_SECTIONS, ideaSection } from "@shared/marketing-ideas";

const control = "h-11 md:h-9";

export default function MarketingIdeasPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const f = useMemo(() => {
    const p = new URLSearchParams(search);
    return {
      section: ideaSection(p.get("section"))?.key ?? "all",
      q: p.get("q") ?? "",
      sort: (p.get("sort") === "cheapest" ? "cheapest" : "newest") as IdeaSort,
      removed: p.get("removed") === "1",
    };
  }, [search]);
  const write = (next: Partial<typeof f>) => {
    const m = { ...f, ...next };
    const p = new URLSearchParams();
    if (m.section !== "all") p.set("section", m.section);
    if (m.q) p.set("q", m.q);
    if (m.sort !== "newest") p.set("sort", m.sort);
    if (m.removed) p.set("removed", "1");
    const qs = p.toString();
    navigate(`${IDEAS_URL}${qs ? `?${qs}` : ""}`, { replace: true });
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5 min-w-0" data-testid="marketing-ideas-page">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ideas</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Log a marketing idea the moment it comes up. Each one also shows on the page of the section it belongs to. Move it to the plan when you decide to do it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.section} onValueChange={(v) => write({ section: v })}>
          <SelectTrigger className={`${control} w-full sm:w-56`} aria-label="Section" data-testid="ideas-filter-section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every section</SelectItem>
            {IDEA_SECTIONS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className={`${control} w-full sm:w-56`}
          value={f.q}
          onChange={(e) => write({ q: e.target.value })}
          placeholder="Search ideas"
          aria-label="Search ideas"
          autoComplete="off"
          data-testid="ideas-search"
        />
        <Select value={f.sort} onValueChange={(v) => write({ sort: v as IdeaSort })}>
          <SelectTrigger className={`${control} w-full sm:w-44`} aria-label="Order" data-testid="ideas-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="cheapest">Lowest cost first</SelectItem>
          </SelectContent>
        </Select>
        <label className="inline-flex items-center gap-2 h-11 md:h-9 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" className="h-4 w-4" checked={f.removed} onChange={(e) => write({ removed: e.target.checked })} data-testid="ideas-show-removed" />
          Show removed
        </label>
      </div>

      <IdeasBoard filterSection={f.section} search={f.q} sort={f.sort} showRemoved={f.removed} />
    </div>
  );
}
