// The Send step's two additions of 2026-10-27:
//
//   - "Test two versions" — a subject-line test (judged by opens) or one
//     button's wording (judged by clicks on it), on a share of the list with
//     the winner sent to the rest, or on everyone as a plain split.
//   - "Preview as" — the email exactly as ONE real person on the list gets it:
//     their first name in the greeting, their children where the player tag
//     is, the subject resolved — before anyone presses Send.
//
// Daniel: "add the subject line A/B test, that's super important … an A/B
// test on calls to action … see which one gets more clicks. Send-time preview
// per recipient, that's good."
import { useMemo } from "react";
import { FlaskConical, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectInput } from "@/components/ui/select-input";
import {
  describeTestPlan, extractEmailLinks, MAILER_TEST_SAMPLE_OPTIONS, MAILER_TEST_WAIT_OPTIONS, waitLabel,
  type MailerTestKind, type MailerVariant,
} from "@shared/mailer-tests";

export interface TestState {
  on: boolean;
  kind: MailerTestKind;
  /** The second version: subject B, or the link's new wording. */
  b: string;
  /** Link tests: the wording being tested, as it reads in the email. */
  target: string;
  samplePct: number;
  waitMinutes: number;
}

export const EMPTY_TEST: TestState = { on: false, kind: "subject", b: "", target: "", samplePct: 20, waitMinutes: 120 };

export function AbTestCard({ subject, bodyHtml, test, onChange, audienceCount }: {
  subject: string;
  bodyHtml: string;
  test: TestState;
  onChange: (t: TestState) => void;
  /** How many will get the email, when the list has been counted. */
  audienceCount: number | null;
}) {
  const links = useMemo(() => extractEmailLinks(bodyHtml), [bodyHtml]);
  const linkChoices = useMemo(() => links.filter((l) => l.text), [links]);
  const set = (patch: Partial<TestState>) => onChange({ ...test, ...patch });
  const metric = test.kind === "subject" ? "opens" : "clicks";
  const plan = audienceCount != null && audienceCount > 0
    ? describeTestPlan(audienceCount, { samplePct: test.samplePct, waitMinutes: test.waitMinutes, metric })
    : null;
  const targetOk = test.kind === "subject" || linkChoices.some((l) => l.text === test.target);

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="mailer-ab-card">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={test.on}
          onChange={(e) => set({ on: e.target.checked })}
          className="mt-1 w-5 h-5 accent-blue-600"
          data-testid="checkbox-ab-on"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold text-white/80">
            <FlaskConical className="w-4 h-4 text-violet-400" />
            Test two versions
          </span>
          <span className="block text-xs text-white/40 mt-0.5 leading-relaxed">
            Two subject lines, or two wordings of a button. Part of the list gets one each; the one that does better goes to everyone else.
          </span>
        </span>
      </label>

      {test.on && (
        <div className="space-y-3 pl-8" data-testid="mailer-ab-body">
          <div className="flex flex-wrap gap-2">
            {([["subject", "Subject line"], ["link", "A button's wording"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => set({ kind: k, b: "", target: k === "link" && linkChoices.length === 1 ? linkChoices[0].text : "" })}
                className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${test.kind === k ? "border-violet-500/50 bg-violet-500/15 text-violet-200" : "border-white/10 text-white/60 hover:bg-white/5"}`}
                data-testid={`button-ab-kind-${k}`}
              >
                {label}
              </button>
            ))}
          </div>

          {test.kind === "subject" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">A — the subject as written</div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-white/75 min-h-11 flex items-center" data-testid="text-ab-subject-a">
                  {subject.trim() || <span className="text-white/30">Write the subject on the Content step first</span>}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">B — the other subject</div>
                <Input
                  value={test.b}
                  onChange={(e) => set({ b: e.target.value })}
                  placeholder="A different way to say it"
                  className="premium-input text-white/80 h-11"
                  data-testid="input-ab-subject-b"
                />
              </div>
            </div>
          ) : linkChoices.length === 0 ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200/80" data-testid="text-ab-no-links">
              This email has no button or link with words on it yet. Add one on the Content step, then come back.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">A — which button or link</div>
                <SelectInput
                  value={test.target}
                  onChange={(e) => set({ target: e.target.value })}
                  className="premium-input text-white/80 h-11 w-full"
                  data-testid="select-ab-target"
                >
                  <option value="">Choose one…</option>
                  {linkChoices.map((l) => (
                    <option key={`${l.idx}`} value={l.text}>
                      {l.kind === "button" ? "Button: " : "Link: "}{l.text}{l.count > 1 ? ` (×${l.count})` : ""}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">B — its other wording</div>
                <Input
                  value={test.b}
                  onChange={(e) => set({ b: e.target.value })}
                  placeholder={test.target ? `Instead of "${test.target}"` : "Pick the button first"}
                  disabled={!test.target}
                  className="premium-input text-white/80 h-11"
                  data-testid="input-ab-link-b"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">How much of the list takes part</div>
              <div className="flex flex-wrap gap-2">
                {MAILER_TEST_SAMPLE_OPTIONS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => set({ samplePct: pct })}
                    className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${test.samplePct === pct ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-white/10 text-white/60 hover:bg-white/5"}`}
                    data-testid={`button-ab-sample-${pct}`}
                  >
                    {pct === 100 ? "Everyone, half and half" : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>
            {test.samplePct < 100 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">Pick the winner after</div>
                <div className="flex flex-wrap gap-2">
                  {MAILER_TEST_WAIT_OPTIONS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => set({ waitMinutes: m })}
                      className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${test.waitMinutes === m ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-white/10 text-white/60 hover:bg-white/5"}`}
                      data-testid={`button-ab-wait-${m}`}
                    >
                      {waitLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-white/50 leading-relaxed" data-testid="text-ab-plan">
            {plan ?? `Judged by ${metric}. The exact split shows once the list is counted.`}
            {plan && ` Judged by ${metric}${test.kind === "link" ? " on that button" : ""}; a tie keeps A.`}
            {!targetOk && test.target && <span className="text-amber-300/80"> That link is no longer in the email.</span>}
          </p>
        </div>
      )}
    </div>
  );
}

export interface PreviewPerson {
  email: string;
  firstName: string | null;
  lastName: string | null;
  players: { firstName: string; lastName: string }[];
}

export interface PreviewRendered {
  email: string;
  name: string | null;
  players: string[];
  subject: string;
  html: string;
}

/** "Seen by: Jane Smith" — the one control that turns the review into one
 *  person's inbox. */
export function PreviewAsPicker({ people, loading, value, onChange, rendered, variant, onVariant, hasTest, rendering }: {
  people: PreviewPerson[] | null;
  loading: boolean;
  value: string;
  onChange: (email: string) => void;
  rendered: PreviewRendered | null;
  variant: MailerVariant;
  onVariant: (v: MailerVariant) => void;
  hasTest: boolean;
  rendering: boolean;
}) {
  const options = (people ?? []).slice(0, 200);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="mailer-preview-as">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
        <UserRound className="w-3.5 h-3.5" /> Seen by
      </span>
      <SelectInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || options.length === 0}
        className="premium-input text-white/80 h-11 md:h-9 min-w-[220px] max-w-full"
        data-testid="select-preview-as"
      >
        <option value="">{loading ? "Counting the list…" : options.length === 0 ? "Nobody on the list yet" : "Everyone — tags as written"}</option>
        {options.map((p) => {
          const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
          const kids = p.players.map((k) => k.firstName).filter(Boolean).slice(0, 3).join(", ");
          return (
            <option key={p.email} value={p.email}>
              {name || p.email}{kids ? ` · ${kids}` : ""}{name ? ` (${p.email})` : ""}
            </option>
          );
        })}
      </SelectInput>
      {hasTest && (
        <div className="flex rounded-full border border-white/10 overflow-hidden" data-testid="mailer-preview-variant">
          {(["A", "B"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onVariant(v)}
              className={`px-3 min-h-11 md:min-h-9 text-xs font-semibold ${variant === v ? "bg-violet-500/20 text-violet-200" : "text-white/55 hover:bg-white/5"}`}
              data-testid={`button-preview-variant-${v}`}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      {rendering && <span className="text-xs text-white/40">Rendering…</span>}
      {rendered && !rendering && (
        <span className="text-xs text-white/45 truncate max-w-full" data-testid="text-preview-as-who">
          {rendered.name ?? rendered.email}{rendered.players.length ? ` · ${rendered.players.join(", ")}` : " · no children on file"}
        </span>
      )}
    </div>
  );
}
