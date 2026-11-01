// What Rambo is doing while it works — everywhere Rambo works (Studio's
// composer, a piece's Rambo tab, Rambo's own chat).
//
// Daniel, 2026-11-01, of a three-minute "Making the change…" spinner: "that's
// bad UI. Other places have figured it out, like Claude has the little word
// things … while waiting." So the wait says three true things and one playful
// one: the REAL step the server reported (with the steps already done ticked),
// how long it has been, roughly how long it usually takes, and a rotating line
// of what that step involves. The rotating line is decoration and says so by
// sitting beside the real step, never replacing it.

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

const RAMBO_FACE = "/mailer/rambo.png";

/** Lines that fit each real step; the step's own words always show too. */
const FLAVOUR: [RegExp, string[]][] = [
  [/^checking|^looking it up/i, ["Opening the records", "Counting carefully", "Cross-checking the numbers"]],
  [/look|phone|laptop|full size/i, ["Holding it up to a phone", "Squinting at the type sizes", "Checking nothing runs off the edge", "Looking for words on faces", "Testing the button with a thumb"]],
  [/fix/i, ["Tightening the spacing", "Nudging the headline", "Fixing what it spotted", "Giving it more room to breathe"]],
  [/png|draw/i, ["Inking the final version", "Exporting at full size"]],
  [/design|making|build|graphic|page/i, ["Reading the brief", "Picking the photo", "Choosing the type", "Laying out the sections", "Writing the headline", "Pulling the real dates and prices", "Lining everything up on the grid"]],
  [/reading|question/i, ["Reading your question", "Working out which records to open", "Thinking it through"]],
  [/together|answer/i, ["Writing it up", "Putting it in plain English", "Double-checking the figures"]],
];
const DEFAULT_FLAVOUR = ["Warming up", "Lacing the boots", "Thinking it through", "On it"];

function flavourFor(stage: string | null): string[] {
  if (!stage) return DEFAULT_FLAVOUR;
  for (const [re, lines] of FLAVOUR) if (re.test(stage)) return lines;
  return DEFAULT_FLAVOUR;
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

export interface RamboWorkingProps {
  /** The step the server last reported ("Designing the page"), or null before the first. */
  stage: string | null;
  /** "About 2–4 minutes" — omit when there is no honest estimate. */
  expect?: string;
  /** Roughly how many seconds it takes — drives the progress bar (which never reaches the end on its own). */
  expectSeconds?: number;
  /** One line, or the full panel with the steps. */
  compact?: boolean;
  className?: string;
}

export function RamboWorking({ stage, expect, expectSeconds, compact, className = "" }: RamboWorkingProps) {
  const [elapsed, setElapsed] = useState(0);
  const [tick, setTick] = useState(0);
  const [done, setDone] = useState<string[]>([]);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const f = setInterval(() => setTick((n) => n + 1), 2600);
    return () => { clearInterval(t); clearInterval(f); };
  }, []);

  // Each new step moves the previous one into "done".
  useEffect(() => {
    if (!stage || stage === last.current) return;
    const prev = last.current;
    if (prev && !/^done$/i.test(prev)) setDone((d) => (d.includes(prev) ? d : [...d, prev]));
    last.current = stage;
    setTick(0);
  }, [stage]);

  const lines = flavourFor(stage);
  const line = lines[tick % lines.length];
  const now = stage && !/^done$/i.test(stage) ? stage : "Getting started";
  const pct = expectSeconds ? Math.min(92, Math.round((1 - Math.exp(-elapsed / (expectSeconds * 0.6))) * 100)) : null;

  const style = (
    <style>{`
      @keyframes rw-bob { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-3px) rotate(3deg) } }
      @keyframes rw-shine { from { background-position: 200% 0 } to { background-position: -200% 0 } }
      @keyframes rw-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
      .rw-bob { animation: rw-bob 1.6s ease-in-out infinite }
      .rw-shine { background: linear-gradient(90deg, hsl(var(--muted-foreground)) 0%, hsl(var(--muted-foreground)) 40%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 60%, hsl(var(--muted-foreground)) 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: rw-shine 2.4s linear infinite }
      .rw-in { animation: rw-in .35s cubic-bezier(0.16,1,0.3,1) both }
      @media (prefers-reduced-motion: reduce) { .rw-bob, .rw-shine, .rw-in { animation: none } .rw-shine { color: hsl(var(--muted-foreground)); background: none } }
    `}</style>
  );

  if (compact) {
    return (
      <span className={`inline-flex min-w-0 items-center gap-2 ${className}`} role="status" aria-live="polite" data-testid="rambo-working">
        {style}
        <img src={RAMBO_FACE} alt="" className="rw-bob h-5 w-5 shrink-0 object-contain" />
        <span className="truncate text-[13px] font-medium text-foreground">{now}</span>
        <span key={line} className="rw-in rw-shine hidden truncate text-[12px] sm:inline">· {line}…</span>
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{clock(elapsed)}</span>
      </span>
    );
  }

  return (
    <div className={`rounded-xl border bg-background p-3 ${className}`} role="status" aria-live="polite" data-testid="rambo-working">
      {style}
      <div className="flex items-start gap-3">
        <img src={RAMBO_FACE} alt="" className="rw-bob mt-0.5 h-8 w-8 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold text-foreground">Rambo is working</p>
            <p className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{clock(elapsed)}{expect ? ` · ${expect}` : ""}</p>
          </div>
          <p key={line} className="rw-in rw-shine mt-0.5 truncate text-[13px]" data-testid="rambo-working-line">{line}…</p>
          {pct != null && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-blue-600 transition-[width] duration-1000 ease-out" style={{ width: `${pct}%` }} />
            </div>
          )}
          <ul className="mt-2 space-y-1">
            {done.map((d) => (
              <li key={d} className="flex items-center gap-2 text-[12px] text-muted-foreground"><Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />{d}</li>
            ))}
            <li className="flex items-center gap-2 text-[12px] font-medium text-foreground" data-testid="rambo-working-stage"><Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />{now}</li>
          </ul>
          {elapsed > 20 && <p className="mt-2 text-[11px] text-muted-foreground">You can keep working in another tab — this keeps going.</p>}
        </div>
      </div>
    </div>
  );
}
