// ─────────────────────────────────────────────────────────────────────────────
// Marketing hub — every marketing number the group has, in one place.
//
// Daniel, 2026-09-15: "the one-stop dashboard I'm going to look at for
// everything … as a whole organisation … broken down by each workspace and
// each program … Google Analytics, how our websites are performing, form
// submissions, ads, organics."
//
// One filter row (period / workspace / programme) feeds six sections
// (Overview / Websites / Forms / Ads / Social / Data sources). The active
// section lives in the URL hash so it survives a reload and can be linked to;
// only that one section's data is fetched — the others don't mount.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DASHBOARD_PERIODS, resolvePeriod, type DashboardPeriod, type DateRange } from "@shared/dashboard";
import { HUB_WORKSPACES } from "@shared/marketing-hub";
import { workspaceColor } from "@/components/marketing-hub/palette";
import { OverviewSection } from "@/components/marketing-hub/overview-section";
import { WebsitesSection } from "@/components/marketing-hub/websites-section";
import { FormsSection } from "@/components/marketing-hub/forms-section";
import { AdsSection } from "@/components/marketing-hub/ads-section";
import { SocialSection } from "@/components/marketing-hub/social-section";
import { SourcesSection } from "@/components/marketing-hub/sources-section";

const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "websites", label: "Websites" },
  { key: "forms", label: "Forms" },
  { key: "ads", label: "Ads" },
  { key: "social", label: "Social" },
  { key: "sources", label: "Data sources" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

function sectionFromHash(): SectionKey {
  const raw = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  return (SECTIONS.find((s) => s.key === raw)?.key ?? "overview") as SectionKey;
}

type Programme = { id: number; name: string; workspace: string | null; active: boolean };

export default function MarketingHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [section, setSection] = useState<SectionKey>(sectionFromHash);

  useEffect(() => {
    const onHashChange = () => setSection(sectionFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const changeSection = useCallback((key: SectionKey) => {
    window.history.replaceState(null, "", `#${key}`);
    setSection(key);
  }, []);

  const { period, custom, workspace, programId } = useMemo(() => {
    const p = new URLSearchParams(search);
    const raw = p.get("period") ?? "30d";
    const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(raw)
      ? (raw as DashboardPeriod)
      : "30d";
    const fallback = resolvePeriod("30d");
    const custom: DateRange = {
      from: p.get("from") || fallback.from,
      to: p.get("to") || fallback.to,
    };
    const workspace = p.get("workspace");
    const programRaw = p.get("program");
    const programId = programRaw ? Number(programRaw) : null;
    return { period, custom, workspace, programId: Number.isFinite(programId) ? programId : null };
  }, [search]);

  const writeFilters = useCallback(
    (next: { period?: DashboardPeriod; custom?: DateRange; workspace?: string | null; programId?: number | null }) => {
      const p = new URLSearchParams();
      const nextPeriod = next.period ?? period;
      p.set("period", nextPeriod);
      if (nextPeriod === "custom") {
        const r = next.custom ?? custom;
        p.set("from", r.from);
        p.set("to", r.to);
      }
      const nextWorkspace = next.workspace !== undefined ? next.workspace : workspace;
      if (nextWorkspace) p.set("workspace", nextWorkspace);
      const nextProgram = next.programId !== undefined ? next.programId : programId;
      if (nextWorkspace && nextProgram != null) p.set("program", String(nextProgram));
      navigate(`/admin/marketing-hub?${p.toString()}`, { replace: true });
    },
    [navigate, period, custom, workspace, programId],
  );

  const onPeriodChange = useCallback(
    (next: DashboardPeriod, nextCustom?: DateRange) => writeFilters({ period: next, custom: nextCustom }),
    [writeFilters],
  );

  const onWorkspaceChange = useCallback(
    (value: string) => {
      const next = value === "all" ? null : value;
      // Changing workspace clears the programme filter — a programme id from
      // one workspace means nothing filtered against another.
      writeFilters({ workspace: next, programId: null });
    },
    [writeFilters],
  );

  const onProgramChange = useCallback(
    (value: string) => writeFilters({ programId: value === "all" ? null : Number(value) }),
    [writeFilters],
  );

  const { data: programmesData, isLoading: programmesLoading } = useQuery<{ programmes: Programme[] }>({
    queryKey: [`/api/admin/marketing-hub/programmes?workspace=${encodeURIComponent(workspace ?? "")}`],
    enabled: !!workspace,
    staleTime: 60_000,
  });
  const programmes = programmesData?.programmes ?? [];

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams({ period });
    if (period === "custom") {
      p.set("from", custom.from);
      p.set("to", custom.to);
    }
    if (workspace) p.set("workspace", workspace);
    if (workspace && programId != null) p.set("program", String(programId));
    return p.toString();
  }, [period, custom, workspace, programId]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Marketing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every brand, every channel, in one place.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker period={period} custom={custom} onChange={onPeriodChange} />

        <Select value={workspace ?? "all"} onValueChange={onWorkspaceChange}>
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Whole organisation</SelectItem>
            {HUB_WORKSPACES.map((w) => (
              <SelectItem key={w.slug} value={w.slug}>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: workspaceColor(w.slug) }}
                  />
                  {w.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={programId != null ? String(programId) : "all"}
          onValueChange={onProgramChange}
          disabled={!workspace || (workspace ? programmes.length === 0 && !programmesLoading : true)}
        >
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue
              placeholder={!workspace ? "All programmes" : programmes.length === 0 ? "No programmes" : "All programmes"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All programmes</SelectItem>
            {programmes.map((prog) => (
              <SelectItem key={prog.id} value={String(prog.id)}>
                {prog.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 whitespace-nowrap">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => changeSection(s.key)}
              aria-pressed={section === s.key}
              className={`px-3 h-9 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap ${
                section === s.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {section === "overview" && <OverviewSection query={filterQuery} onSelectWorkspace={onWorkspaceChange} />}
      {section === "websites" && <WebsitesSection query={filterQuery} />}
      {section === "forms" && <FormsSection query={filterQuery} />}
      {section === "ads" && <AdsSection query={filterQuery} />}
      {section === "social" && <SocialSection query={filterQuery} />}
      {section === "sources" && <SourcesSection />}
    </div>
  );
}
