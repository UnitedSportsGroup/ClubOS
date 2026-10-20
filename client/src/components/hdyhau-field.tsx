import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HDYHAU_OPTIONS, HDYHAU_DETAIL_MAX, parseHdyhau, HDYHAU_REQUIRED_MESSAGE } from "@shared/hdyhau";

/**
 * "How did you hear about us?" — one field for every checkout and the office.
 *
 * Always visible. Whether it is REQUIRED is the server's call (a buyer new to
 * the organisation must answer, a returning one may skip): pass the result of
 * `useHdyhauRequired()`. The server re-checks on submit regardless, so this is
 * guidance, never the gate.
 *
 * Styling follows the host page — public checkouts each have their own brand,
 * so the trigger and the "Other" box take the page's own input class + style.
 * shadcn Select, never a bare <select> (CLAUDE.md "Every control is drawn by us").
 */

export type HdyhauAnswer = { source: string; detail: string };
export const EMPTY_HDYHAU: HdyhauAnswer = { source: "", detail: "" };

/** Fields to spread into a request body. Empty strings are sent as absent. */
export function hdyhauPayload(a: HdyhauAnswer) {
  return {
    referralSource: a.source || undefined,
    referralDetail: a.source === "other" ? a.detail.trim() || undefined : undefined,
  };
}

/** The same rule the server applies, for an inline message before submit. */
export function hdyhauError(required: boolean, a: HdyhauAnswer): string | null {
  const parsed = parseHdyhau(a.source, a.detail);
  if (!parsed.ok) return parsed.message;
  if (!parsed.source && required) return HDYHAU_REQUIRED_MESSAGE;
  return null;
}

/**
 * Ask the server whether this buyer must answer. Fails CLOSED: required until a
 * lookup says otherwise, and required again whenever a lookup fails. Debounced
 * so typing an email doesn't fire a request per keystroke.
 */
export function useHdyhauRequired(opts: {
  slug?: string | null;
  programId?: number | null;
  orgId?: number | null;
  email?: string | null;
  phone?: string | null;
}): { required: boolean; checking: boolean } {
  const [required, setRequired] = useState(true);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const email = (opts.email ?? "").trim();
  const phoneDigits = (opts.phone ?? "").replace(/\D/g, "");
  const hasWho = email.includes("@") || phoneDigits.length >= 7;
  const target = opts.programId ?? opts.slug ?? opts.orgId ?? null;

  useEffect(() => {
    if (!hasWho || target == null || target === "") { setRequired(true); return; }
    const my = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/public/hdyhau/required", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            slug: opts.slug || undefined,
            programId: opts.programId || undefined,
            orgId: opts.orgId || undefined,
            email: email || undefined,
            phone: opts.phone || undefined,
          }),
        });
        const body = res.ok ? await res.json() : { required: true };
        if (my === seq.current) setRequired(body?.required !== false);
      } catch {
        if (my === seq.current) setRequired(true);
      } finally {
        if (my === seq.current) setChecking(false);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, phoneDigits, hasWho, opts.slug, opts.programId, opts.orgId]);

  return { required, checking };
}

export interface HdyhauFieldProps {
  value: HdyhauAnswer;
  onChange: (next: HdyhauAnswer) => void;
  required: boolean;
  /** Shown under the field when set (e.g. after a failed submit). */
  error?: string | null;
  /** Office copy: "How did they hear about us?" */
  audience?: "self" | "staff";
  labelClassName?: string;
  labelStyle?: CSSProperties;
  /** Applied to the Select trigger AND the "Other" text box. */
  fieldClassName?: string;
  fieldStyle?: CSSProperties;
  /** The open dropdown — set a dark background on dark pages. */
  contentClassName?: string;
  contentStyle?: CSSProperties;
  itemClassName?: string;
  mutedStyle?: CSSProperties;
  mutedClassName?: string;
  errorStyle?: CSSProperties;
  idPrefix?: string;
}

export function HdyhauField({
  value, onChange, required, error, audience = "self",
  labelClassName = "block text-sm font-medium mb-1.5", labelStyle,
  fieldClassName = "", fieldStyle,
  contentClassName = "", contentStyle, itemClassName = "",
  mutedClassName = "text-xs mt-1.5", mutedStyle,
  errorStyle, idPrefix = "hdyhau",
}: HdyhauFieldProps) {
  const question = audience === "staff" ? "How did they hear about us?" : "How did you hear about us?";
  const skipHint = audience === "staff"
    ? "Returning family — optional."
    : "Been with us before? You can skip this.";

  return (
    <div data-testid="hdyhau-field" data-required={required ? "true" : "false"}>
      <label htmlFor={`${idPrefix}-select`} className={labelClassName} style={labelStyle}>
        {question}
        {required ? <span aria-hidden="true"> *</span> : <span className="font-normal opacity-70"> (optional)</span>}
      </label>
      <Select value={value.source || undefined} onValueChange={(v) => onChange({ source: v, detail: v === "other" ? value.detail : "" })}>
        <SelectTrigger
          id={`${idPrefix}-select`}
          aria-required={required}
          aria-invalid={!!error}
          className={`h-auto min-h-[44px] ${fieldClassName}`}
          style={fieldStyle}
          data-testid="hdyhau-select"
        >
          <SelectValue placeholder="Choose one" />
        </SelectTrigger>
        <SelectContent className={contentClassName} style={contentStyle}>
          {HDYHAU_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className={`min-h-[44px] ${itemClassName}`} data-testid={`hdyhau-option-${o.value}`}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.source === "other" && (
        <input
          id={`${idPrefix}-detail`}
          aria-label="Where did you hear about us?"
          className={`mt-2 min-h-[44px] ${fieldClassName}`}
          style={fieldStyle}
          maxLength={HDYHAU_DETAIL_MAX}
          value={value.detail}
          onChange={(e) => onChange({ source: "other", detail: e.target.value })}
          placeholder="Where was that?"
          data-testid="hdyhau-detail"
        />
      )}
      {error ? (
        <p className={mutedClassName} style={errorStyle ?? { color: "#dc2626" }} role="alert" data-testid="hdyhau-error">{error}</p>
      ) : !required ? (
        <p className={mutedClassName} style={mutedStyle}>{skipHint}</p>
      ) : null}
    </div>
  );
}
