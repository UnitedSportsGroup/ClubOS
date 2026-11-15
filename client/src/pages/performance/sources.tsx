import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Pill, Empty, Loading, LoadError, PageHead, Panel, niceDay, useCatalogue, usePerfQuery, send, refresh, type SourceRow } from "./ui";

type SyncStatus = {
  configured: boolean; scheduled: boolean; everyMinutes: number;
  lastSuccessAt: string | null; failing: boolean; lastError: string | null; unlinkedAthletes: number;
  runs: Array<{ started_at: string; ok: boolean | null; trigger: string; sessions_seen: number | null; sessions_written: number | null; stats_written: number | null; error: string | null }>;
};

const ago = (iso: string | null) => {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/** Catapult One live sync — status, last result, and a Sync now button. */
function CatapultSyncPanel() {
  const q = usePerfQuery<SyncStatus>("catapult-sync", "/sync/catapult");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const s = q.data;
  const syncNow = async () => {
    setBusy(true); setNote(null);
    try {
      const r: any = await send("POST", "/sync/catapult");
      setNote(r.ok ? `Synced: ${r.sessionsWritten} session${r.sessionsWritten === 1 ? "" : "s"} updated, ${r.valuesWritten} readings.` : (r.error || r.skipped || "Sync failed."));
    } catch (e: any) { setNote(e?.message ?? "Sync failed."); }
    finally { setBusy(false); refresh(); }
  };
  const tone = !s ? "grey" : !s.configured ? "grey" : s.failing ? "red" : s.scheduled ? "green" : "amber";
  const word = !s ? "…" : !s.configured ? "Not set up" : s.failing ? "Failing" : s.scheduled ? `Live · every ${s.everyMinutes} min` : "Set up, schedule off";
  return (
    <Panel title="Catapult One live sync" note="ClubOS signs in to Catapult One with the club's sync login and pulls new sessions on its own. Read-only: nothing in Catapult is changed."
      right={<Pill tone={tone as any}>{word}</Pill>}>
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {s && (
        <div className="space-y-3 text-sm" data-testid="perf-catapult-sync">
          {!s.configured ? (
            <p className="text-muted-foreground">Waiting for the club's Catapult sync login. Until then, use <b>Import data</b> with a CSV from Catapult One.</p>
          ) : (
            <>
              <p>
                {s.lastSuccessAt ? <>Last synced <b>{ago(s.lastSuccessAt)}</b>.</> : "Not synced yet."}
                {s.unlinkedAthletes > 0 && <> <b>{s.unlinkedAthletes}</b> Catapult player{s.unlinkedAthletes === 1 ? "" : "s"} still to link to a squad member (Dashboard → Data to fix).</>}
              </p>
              {s.failing && s.lastError && (
                <p className="rounded-md border border-red-200 bg-red-50 text-red-900 px-3 py-2">Last attempt failed: {s.lastError}. CSV import still works while this is fixed.</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={syncNow} disabled={busy} className="min-h-[44px]">{busy ? "Syncing…" : "Sync now"}</Button>
                {note && <span className="text-muted-foreground">{note}</span>}
              </div>
              {s.runs.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {s.runs.slice(0, 5).map((r, i) => (
                    <li key={i}>{ago(r.started_at)} · {r.trigger === "manual" ? "by hand" : "scheduled"} · {r.ok ? `${r.sessions_written ?? 0} session(s), ${r.stats_written ?? 0} readings` : r.ok === false ? `failed: ${r.error ?? "unknown"}` : "running"}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

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
      <CatapultSyncPanel />
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
