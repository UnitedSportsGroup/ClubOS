// "Try the player app" — Daniel, 14 Nov: "allow me to test the player side
// without a login". The real form, in a phone frame, signed in as staff. It
// SAVES as a TEST entry (no player, never on the board, never in the load
// engine) so the whole flow — answer, flag, report — can be walked end to end.
// The public no-save demo is join.southislandunited.com/athlete?demo=1.
import { useState } from "react";
import { Link } from "wouter";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Answers, FormDef } from "@shared/perf-forms";
import { AnswerList, CheckInForm, SIU } from "@/components/performance/checkin-form";
import { Empty, LoadError, Loading, PageHead, Panel, Pill, control, errText, refresh, send, usePerfQuery } from "./ui";

const DEMO_URL = "https://join.southislandunited.com/athlete?demo=1";

export default function TryPlayerApp() {
  const q = usePerfQuery<{ form: null | { id: number; title: string; definition: FormDef }; today: string }>("checkins", "/checkins?range=today");
  const [sent, setSent] = useState<null | { answers: Answers; flag: "red" | "amber" | null; reasons: string[] }>(null);
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState(false);
  const def = q.data?.form?.definition;

  return (
    <div className="space-y-4 min-w-0">
      <PageHead
        title="Try the player app"
        blurb="Answer the check-in exactly as a player would. It saves as a TEST entry: it shows in Check-ins with a Test tag (tick Show test entries) and never counts for a player."
        right={<Link href="/admin/performance/checkins"><Button variant="outline" className={control}>Open Check-ins</Button></Link>}
      />
      <Panel title="No-login demo link" note="Anyone can open this on a phone. It shows the real form and saves nothing.">
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-sm bg-muted rounded px-2 py-1 break-all">{DEMO_URL}</code>
          <Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(DEMO_URL); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ } }}>
            <Copy className="w-4 h-4 mr-1.5" />{copied ? "Copied" : "Copy"}</Button>
          <a href={DEMO_URL} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><ExternalLink className="w-4 h-4 mr-1.5" />Open</Button></a>
        </div>
      </Panel>

      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !def && <Empty>No check-in form is set up yet.</Empty>}
      {def && (
        <div className="mx-auto w-full max-w-[400px] rounded-[2.2rem] border-[10px] border-neutral-900 shadow-xl overflow-hidden" data-testid="phone-frame">
          <div className="max-h-[78vh] overflow-y-auto px-4 pt-5 pb-8" style={{ background: SIU.bg, color: SIU.ink }}>
            <div className="flex items-center gap-3">
              <img src="/logos/south-island-united.png" alt="" style={{ height: 40, width: "auto" }} />
              <div><p className="text-lg font-semibold leading-tight">Kia ora</p><p className="text-xs" style={{ color: SIU.mute }}>Test entry, saved under your name</p></div>
            </div>
            {sent ? (
              <section className="mt-4 rounded-2xl p-4" style={{ background: SIU.card, border: `1px solid ${SIU.line}` }}>
                <p className="font-semibold" style={{ color: "#8FC99B" }}>Done for today. Thanks.</p>
                <p className="mt-1 mb-3 text-xs" style={{ color: SIU.mute }}>What staff would see on the board:{" "}
                  {sent.flag ? <Pill tone={sent.flag}>{sent.flag === "red" ? "Concern" : "Take care"}</Pill> : <Pill tone="green">Nothing flagged</Pill>}</p>
                {sent.reasons.length > 0 && <p className="mb-3 text-xs" style={{ color: SIU.mute }}>{sent.reasons.join(" · ")}</p>}
                <AnswerList def={def} answers={sent.answers} />
                <button type="button" onClick={() => { setSent(null); setRound((n) => n + 1); }} className="mt-4 min-h-[48px] w-full rounded-xl" style={{ border: `1px solid ${SIU.line}` }}>Try it again</button>
              </section>
            ) : (
              <>
                <h2 className="mt-5 text-lg font-semibold">{def.title}</h2>
                {def.intro && <p className="mt-1 text-sm" style={{ color: SIU.mute }}>{def.intro}</p>}
                <CheckInForm key={round} def={def} submitLabel="Submit check-in (test)"
                  onSubmit={async (answers) => {
                    try {
                      const r = await send<{ flag: "red" | "amber" | null; reasons: string[] }>("POST", "/checkins", { test: true, answers });
                      setSent({ answers, flag: r.flag, reasons: r.reasons }); await refresh(); return { ok: true };
                    } catch (e) { return { ok: false, message: errText(e) }; }
                  }} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
