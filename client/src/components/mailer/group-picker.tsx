// "By Programme" for a workspace whose people are not `programs` registrations
// — United Gymnastics, Mini Football Leagues, the CIC (one Mailer for every
// workspace, 2026-11-14). The SERVER describes the rows (Who · Term ·
// Programme, or Event · Who · Age group · Edition); this only draws them and
// says how many people the current choice reaches. Who a choice reaches is
// decided on the server, never here.
import { Users } from "lucide-react";
import { groupRowOptions, settleGroupChoice, type GroupCatalogue, type GroupChoice } from "@shared/mailer-audiences";

export function GroupPicker({ data, loading, choice, onChoice, count }: {
  data: GroupCatalogue | undefined;
  loading: boolean;
  choice: GroupChoice;
  onChoice: (c: GroupChoice) => void;
  /** People the settled choice reaches (opt-outs left out); undefined = counting. */
  count: number | undefined;
}) {
  if (loading || !data) return <p className="text-xs text-white/40" data-testid="group-picker-loading">Loading…</p>;
  const settled = settleGroupChoice(data, choice);
  const first = data.rows[0];
  const note = first ? data.notes?.[settled[first.key] ?? ""] : undefined;
  return (
    <div className="space-y-3" data-testid="group-picker">
      {data.rows.map((row) => {
        if (!(row.key in settled)) return null;
        const options = groupRowOptions(row, settled);
        return (
          <div key={row.key} className="flex items-start gap-3">
            <div className="w-24 shrink-0 pt-2 text-[11px] uppercase tracking-wider text-white/30 font-semibold">{row.label}</div>
            <div className="flex flex-wrap gap-1.5 min-w-0">
              {options.map((o) => {
                const on = settled[row.key] === o.value;
                return (
                  <button
                    key={o.value || "_any"}
                    type="button"
                    onClick={() => onChoice({ ...settled, [row.key]: o.value })}
                    data-testid={`group-${row.key}-${o.value || "any"}`}
                    className={`min-h-[36px] text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                      on ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/10 bg-white/[0.02] text-white/55 hover:text-white/80"
                    }`}
                  >
                    {o.label}{o.hint ? <span className="text-white/35"> · {o.hint}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        {note ? <p className="text-[11px] text-white/40">{note}</p> : <span />}
        <span className="text-xs text-white/60 flex items-center gap-1.5 whitespace-nowrap" data-testid="group-picker-count">
          <Users className="w-3.5 h-3.5" /> {count ?? "…"} {count === 1 ? "person" : "people"}
        </span>
      </div>
    </div>
  );
}
