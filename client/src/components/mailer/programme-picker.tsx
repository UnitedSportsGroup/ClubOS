// The Mailer's "By programme" audience picker.
//
// Zach (27 Oct 2026): "an option to send it to groups again … the 4-8s".
// Daniel: "all u4-u8 or all pre academy or all u9 … organised logically and
// easy to find". Two sections — the TERM PROGRAMMES (a row each, age groups
// as chips beneath) within one term, and the HOLIDAY CAMPS by series, one
// chip per edition — with the number of families beside every choice, so the
// person sees who they are about to email before they press Preview.
//
// Any mix can be ticked at once. A programme row = the whole programme; an
// age-group chip narrows it. Rows and chips nobody is in are not drawn.
import { useMemo } from "react";
import { Check } from "lucide-react";
import {
  familiesFor, isTermProgramme, programmeTitle,
  type AudienceCatalogue, type AudienceGroup, type AudienceProgramme, type AudienceTerm,
} from "@shared/mailer-audiences";
import { groupCampSeries } from "@shared/programme-series";

type Props = {
  data: AudienceCatalogue | undefined;
  loading: boolean;
  groups: AudienceGroup[];
  onGroups: (g: AudienceGroup[]) => void;
  term: AudienceTerm;
  onTerm: (t: AudienceTerm) => void;
};

const n = (v: number) => v.toLocaleString("en-NZ");
const fam = (v: number) => `${n(v)} ${v === 1 ? "family" : "families"}`;

// Core programmes first, youngest first; the extras (Technification,
// Goalkeeper, Morning, Football Institute) after them.
function orderTerm(a: AudienceProgramme, b: AudienceProgramme): number {
  const core = (p: AudienceProgramme) => (p.academySection === "additional" ? 1 : 0);
  return core(a) - core(b) || (a.ageMin ?? 99) - (b.ageMin ?? 99) || a.name.localeCompare(b.name);
}

export function ProgrammePicker({ data, loading, groups, onGroups, term, onTerm }: Props) {
  const termId = term === "all" ? null : term ?? data?.currentTermId ?? null;

  const termProgrammes = useMemo(() =>
    (data?.programmes ?? []).filter((p) => isTermProgramme(p) && familiesFor(p, term, data) > 0).sort(orderTerm),
  [data, term]);

  const campSeries = useMemo(() => {
    const camps = (data?.programmes ?? []).filter((p) => !isTermProgramme(p) && p.families.all > 0);
    return groupCampSeries(camps, data?.today ?? "").map((s) => ({
      name: s.name,
      // Newest edition first — the one just run is the one people mail.
      editions: [...s.editions].reverse(),
    }));
  }, [data]);

  // Terms worth offering: those with anyone registered in a term programme,
  // newest first, plus "Any time".
  const termsOffered = useMemo(() => {
    const used = new Set<string>();
    for (const p of data?.programmes ?? []) if (isTermProgramme(p)) Object.keys(p.families.byTerm).forEach((k) => used.add(k));
    return (data?.terms ?? []).filter((t) => used.has(String(t.id)) || t.current).sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  }, [data]);

  const whole = (pid: number) => groups.some((g) => g.programId === pid && g.optionIds === null);
  const optionsOf = (pid: number) => groups.find((g) => g.programId === pid && g.optionIds !== null)?.optionIds ?? [];
  const without = (pid: number) => groups.filter((g) => g.programId !== pid);

  const toggleWhole = (pid: number) => onGroups(whole(pid) ? without(pid) : [...without(pid), { programId: pid, optionIds: null }]);
  const toggleOption = (pid: number, oid: number) => {
    const cur = whole(pid) ? [] : optionsOf(pid);
    const next = cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid];
    onGroups(next.length ? [...without(pid), { programId: pid, optionIds: next }] : without(pid));
  };
  const toggleCamp = (pid: number) => toggleWhole(pid);

  if (loading && !data) return <div className="text-sm text-white/50" data-testid="programme-picker-loading">Loading programmes…</div>;
  if (!data) return <div className="text-sm text-white/50">Programmes could not be loaded — try again in a moment.</div>;

  const rowCls = (on: boolean) =>
    `w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-all min-h-12 ${
      on ? "bg-blue-500/10 border-blue-500/30" : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"}`;
  const chipCls = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 min-h-11 md:min-h-9 text-sm transition-all ${
      on ? "bg-blue-500/15 border-blue-500/40 text-blue-300" : "bg-white/[0.02] border-white/[0.08] text-white/70 hover:bg-white/[0.05]"}`;
  const tick = (on: boolean) => (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "bg-blue-500 border-blue-500 text-white" : "border-white/20"}`} aria-hidden="true">
      {on && <Check className="h-3.5 w-3.5" />}
    </span>
  );

  return (
    <div className="space-y-5" data-testid="programme-picker">
      {termProgrammes.length > 0 || termsOffered.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <label className="text-xs text-white/40 uppercase tracking-wider">Term programmes</label>
            <span className="text-xs text-white/40">Registered in</span>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which term">
            {termsOffered.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={termId === t.id} onClick={() => onTerm(t.current ? null : t.id)}
                className={chipCls(termId === t.id)} data-testid={`audience-term-${t.id}`}>
                {t.name}{t.current ? " · now" : ""}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={term === "all"} onClick={() => onTerm("all")} className={chipCls(term === "all")} data-testid="audience-term-all">
              Any time
            </button>
          </div>
          <div className="space-y-2 pt-1">
            {termProgrammes.length === 0 && (
              <div className="text-sm text-white/50" data-testid="programme-picker-empty-term">Nobody is registered in a term programme for that term.</div>
            )}
            {termProgrammes.map((p) => {
              const on = whole(p.id);
              const picked = optionsOf(p.id);
              const opts = p.options.filter((o) => o.isActive !== false && familiesFor(p, term, data, o.id) > 0);
              return (
                <div key={p.id} className="space-y-2">
                  <button type="button" onClick={() => toggleWhole(p.id)} className={rowCls(on)} aria-pressed={on} data-testid={`audience-programme-${p.id}`}>
                    <span className="flex items-center gap-3 min-w-0">
                      {tick(on)}
                      <span className={`text-sm font-medium truncate ${on ? "text-blue-300" : "text-white/80"}`}>{programmeTitle(p)}</span>
                    </span>
                    <span className="text-xs text-white/50 whitespace-nowrap">{fam(familiesFor(p, term, data))}</span>
                  </button>
                  {opts.length > 1 && (
                    <div className="flex flex-wrap gap-2 pl-4 md:pl-9" data-testid={`audience-options-${p.id}`}>
                      {opts.map((o) => {
                        const oon = !on && picked.includes(o.id);
                        return (
                          <button key={o.id} type="button" onClick={() => toggleOption(p.id, o.id)} className={chipCls(oon)} aria-pressed={oon}
                            title={on ? `The whole of ${p.name} is ticked — untick it to pick just ${o.name}` : undefined}
                            data-testid={`audience-option-${o.id}`}>
                            <span className={on ? "text-white/40" : ""}>{o.name}</span>
                            <span className="text-xs text-white/40">{n(familiesFor(p, term, data, o.id))}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {campSeries.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-white/40 uppercase tracking-wider">Holiday camps</label>
          <div className="space-y-3">
            {campSeries.map((s) => (
              <div key={s.name} className="space-y-1.5">
                <div className="text-sm font-medium text-white/80">{s.name}</div>
                <div className="flex flex-wrap gap-2" data-testid={`audience-camp-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                  {s.editions.map((e) => {
                    const on = whole(e.id);
                    return (
                      <button key={e.id} type="button" onClick={() => toggleCamp(e.id)} className={chipCls(on)} aria-pressed={on} data-testid={`audience-programme-${e.id}`}>
                        <span>{programmeTitle(e).split(" · ")[1] ?? programmeTitle(e)}</span>
                        <span className="text-xs text-white/40">{n(e.families.all)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {termProgrammes.length === 0 && campSeries.length === 0 && (
        <div className="text-sm text-white/50" data-testid="programme-picker-empty">No programme here has anyone registered yet.</div>
      )}

      <p className="text-xs text-white/40">
        Tick as many as you like. A programme row is everyone in it; an age-group chip narrows it. The number is families
        (one email each, the parent's). Preview shows exactly who will get it.
      </p>
    </div>
  );
}
