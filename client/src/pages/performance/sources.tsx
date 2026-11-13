import { Pill, Empty, Loading, LoadError, PageHead, Panel, niceDay, useCatalogue, type SourceRow } from "./ui";

const STATE_WORD = { built: "Built", import: "CSV import", planned: "Not connected" } as const;
const STATE_TONE = { built: "green", import: "blue", planned: "grey" } as const;
const GROUPS: { key: SourceRow["priority"]; title: string; note: string }[] = [
  { key: "now", title: "Use now", note: "Worth having from day one." },
  { key: "next", title: "Next", note: "Add when the basics are being used every day." },
  { key: "later", title: "Later", note: "Useful once the club has the staff to act on it." },
];

export default function Sources() {
  const q = useCatalogue();
  const d = q.data;
  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Data sources" blurb="Everything a professional club plugs into one player-monitoring picture, and where each one stands for South Island United." />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          {GROUPS.map((g) => {
            const list = d.sources.filter((s) => s.priority === g.key);
            return (
              <section key={g.key} className="space-y-2" data-testid={`perf-sources-${g.key}`}>
                <div><h2 className="text-lg font-semibold text-foreground">{g.title}</h2><p className="text-xs text-muted-foreground">{g.note}</p></div>
                {list.length === 0 ? <Empty>Nothing here.</Empty> : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {list.map((s) => (
                      <div key={s.key} className="rounded-lg border border-border bg-card p-4 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 justify-between">
                          <h3 className="font-semibold text-foreground">{s.name}</h3>
                          <Pill tone={STATE_TONE[s.state]}>{STATE_WORD[s.state]}</Pill>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {s.readings > 0 ? `Last reading ${niceDay(s.last, true)} · ${s.readings.toLocaleString("en-NZ")} reading${s.readings === 1 ? "" : "s"}` : "No data yet"}
                        </div>
                        <dl className="mt-3 space-y-2 text-sm">
                          <div><dt className="text-xs font-medium text-muted-foreground">What it is</dt><dd>{s.what}</dd></div>
                          <div><dt className="text-xs font-medium text-muted-foreground">How it gets in</dt><dd>{s.how}</dd></div>
                          <div><dt className="text-xs font-medium text-muted-foreground">Our advice</dt><dd>{s.advice}</dd></div>
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          <Panel title="How the numbers are worked out" note="The same formulas everywhere in this area. Nothing is a black box.">
            <dl className="divide-y divide-border">
              {d.formulas.map((f) => (
                <div key={f.name} className="py-2.5 grid grid-cols-1 md:grid-cols-[10rem_1fr] gap-1 md:gap-4">
                  <dt className="font-medium text-foreground">{f.name}</dt>
                  <dd className="text-sm"><code className="text-[13px] bg-muted rounded px-1.5 py-0.5">{f.formula}</code><div className="text-muted-foreground mt-1">{f.reads}</div></dd>
                </div>
              ))}
            </dl>
          </Panel>
        </>
      )}
    </div>
  );
}
