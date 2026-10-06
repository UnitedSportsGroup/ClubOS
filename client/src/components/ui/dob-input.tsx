// Date of birth, typed in three boxes — day, month, year. No picker.
//
// Why not a calendar: a date of birth is remembered, not chosen. The calendar
// popover that stood here opened on THIS month, so a 2017 birthday was ~110
// taps of "previous month" (Zach, 2026-10-07: "improve the smoothness of
// inputting the DOB"). The phone's native wheel on the academy checkout was
// no better — it starts at today and spins back ten years — and it is drawn
// by the browser, which the standing rule forbids for every other control.
//
// The shape is the GOV.UK date-input pattern, the most-tested one there is
// for memorised dates: three plain boxes, a number keypad on a phone,
// autofill hints (`bday-day` …), and a clear message when the date is not a
// real date. On top of that: focus moves on by itself once a box is full
// ("11" → month; "7" in month can only be July, so it moves too), Backspace
// in an empty box steps back, a whole pasted date fills all three, and the
// age appears the moment the date is valid, so a parent sees "8 years old"
// and knows they typed the right year.
//
// Value contract is unchanged from the control it replaces: an ISO
// `yyyy-mm-dd` string, emitted ONLY when the date is complete and real, else
// "". The pure rules live in shared/dob.ts and are tested without a browser.

import * as React from "react";
import { cn } from "@/lib/utils";
import { nzTodayIso } from "@shared/academy";
import {
  EMPTY_DOB,
  ageOnDate,
  boxComplete,
  checkDobParts,
  digits,
  dobProblemMessage,
  padBox,
  parseWholeDate,
  partsComplete,
  partsFromIso,
  type DobParts,
} from "@shared/dob";

/** The shadcn Input look, so a page that uses <Input> gets matching boxes by
 *  passing only its own additions (border colour, height). */
export const DOB_BOX_BASE =
  "flex h-9 w-full rounded-md border border-input bg-background px-2 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

export interface DobInputProps {
  /** ISO `yyyy-mm-dd`, or "" / undefined. */
  value?: string;
  /** Called with the ISO date once it is complete and real, with "" otherwise. */
  onChange?: (e: { target: { value: string } }) => void;
  /** Classes for each box. Merged onto the shadcn look unless `unstyled`. */
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
  /** Drop the shadcn base entirely (a page with its own field primitive). */
  unstyled?: boolean;
  /** The small Day / Month / Year captions. */
  labelClassName?: string;
  labelStyle?: React.CSSProperties;
  /** Decides the default caption, message and age-line colours. */
  tone?: "light" | "dark";
  /** Show "8 years old" under a valid date. On by default. */
  showAge?: boolean;
  /** Replace the age line with the page's own status (e.g. an eligibility line). */
  renderStatus?: (iso: string) => React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  /** A hidden input carries the ISO value under this name, for FormData forms. */
  name?: string;
  className?: string;
  "data-testid"?: string;
}

type Box = keyof DobParts;
const ORDER: Box[] = ["day", "month", "year"];
const MAX: Record<Box, number> = { day: 2, month: 2, year: 4 };
const PLACEHOLDER: Record<Box, string> = { day: "DD", month: "MM", year: "YYYY" };
const CAPTION: Record<Box, string> = { day: "Day", month: "Month", year: "Year" };
const AUTOCOMPLETE: Record<Box, string> = { day: "bday-day", month: "bday-month", year: "bday-year" };

export function DobInput({
  value,
  onChange,
  inputClassName,
  inputStyle,
  unstyled,
  labelClassName,
  labelStyle,
  tone = "light",
  showAge = true,
  renderStatus,
  disabled,
  required,
  autoFocus,
  name,
  className,
  ...rest
}: DobInputProps) {
  const testId = rest["data-testid"];
  const [parts, setParts] = React.useState<DobParts>(() => partsFromIso(value));
  // 🔴 Handlers read THIS, never `parts` from their render: typing the second
  // digit of "11" moves focus, the day box blurs in the SAME tick, and a blur
  // handler holding the previous render's "1" would pad it to "01" over the
  // "11" that had just landed. A screenshot found it; the text checks did not.
  const partsRef = React.useRef<DobParts>(parts);
  const [touched, setTouched] = React.useState<Record<Box, boolean>>({ day: false, month: false, year: false });
  const refs = { day: React.useRef<HTMLInputElement>(null), month: React.useRef<HTMLInputElement>(null), year: React.useRef<HTMLInputElement>(null) };
  const lastEmitted = React.useRef<string>(value ?? "");
  const today = React.useMemo(() => nzTodayIso(), []);

  // A value set from OUTSIDE (a returning child picked from a list, a form
  // reset) replaces what is typed. Our own emissions never loop back here.
  React.useEffect(() => {
    const v = value ?? "";
    if (v === lastEmitted.current) return;
    lastEmitted.current = v;
    partsRef.current = partsFromIso(v);
    setParts(partsRef.current);
  }, [value]);

  const check = checkDobParts(parts, today);
  const iso = check.iso ?? "";

  const emit = React.useCallback(
    (next: DobParts) => {
      const nextIso = checkDobParts(next, today).iso ?? "";
      if (nextIso !== lastEmitted.current) {
        lastEmitted.current = nextIso;
        onChange?.({ target: { value: nextIso } });
      }
    },
    [onChange, today],
  );

  const update = (next: DobParts) => {
    partsRef.current = next;
    setParts(next);
    emit(next);
  };

  const focusBox = (box: Box, atEnd = false) => {
    const el = refs[box].current;
    if (!el) return;
    el.focus();
    if (atEnd) {
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch { /* not all input types allow it */ }
    } else {
      try { el.select(); } catch { /* ignore */ }
    }
  };

  const onBoxChange = (box: Box, raw: string) => {
    // A whole date typed or autofilled into one box fills all three.
    const whole = parseWholeDate(raw);
    if (whole) {
      update(whole);
      setTouched({ day: true, month: true, year: true });
      focusBox("year", true);
      return;
    }
    const v = digits(raw, MAX[box]);
    const done = boxComplete(box, v);
    const next = { ...partsRef.current, [box]: done ? padBox(box, v) : v };
    update(next);
    if (done) {
      const i = ORDER.indexOf(box);
      if (i < ORDER.length - 1) focusBox(ORDER[i + 1]);
    }
  };

  const onBoxKeyDown = (box: Box, e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const i = ORDER.indexOf(box);
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (e.key === "Backspace" && el.value === "" && i > 0) {
      e.preventDefault();
      focusBox(ORDER[i - 1], true);
      return;
    }
    if ((e.key === "/" || e.key === "." || e.key === "-" || e.key === " ") && i < ORDER.length - 1) {
      e.preventDefault();
      if (el.value) update({ ...partsRef.current, [box]: padBox(box, el.value) });
      focusBox(ORDER[i + 1]);
      return;
    }
    if (e.key === "ArrowLeft" && atStart && i > 0) { e.preventDefault(); focusBox(ORDER[i - 1], true); return; }
    if (e.key === "ArrowRight" && atEnd && i < ORDER.length - 1) { e.preventDefault(); focusBox(ORDER[i + 1]); }
  };

  const onBoxPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const whole = parseWholeDate(e.clipboardData.getData("text"));
    if (!whole) return; // a lone "11" pastes into the box as typed
    e.preventDefault();
    update(whole);
    setTouched({ day: true, month: true, year: true });
    focusBox("year", true);
  };

  const onBoxBlur = (box: Box) => {
    setTouched((t) => ({ ...t, [box]: true }));
    const padded = padBox(box, partsRef.current[box]);
    if (padded !== partsRef.current[box]) update({ ...partsRef.current, [box]: padded });
  };

  // Shout only once the person has been through the boxes — never on the
  // first keystroke — and never for "not finished yet".
  const allTouched = touched.day && touched.month && touched.year;
  const problem = check.problem && check.problem !== "incomplete" && (allTouched || partsComplete(parts)) ? check.problem : null;
  const message = dobProblemMessage(problem);

  // So a plain <form> with `required` boxes also refuses "31/02/2018".
  React.useEffect(() => {
    const el = refs.year.current;
    if (!el || typeof el.setCustomValidity !== "function") return;
    el.setCustomValidity(message && partsComplete(parts) ? message : "");
  }, [message, parts]);

  const dark = tone === "dark";
  const captionCls = cn("block text-[11px] font-semibold tracking-wide mb-1", dark ? "text-white/50" : "text-slate-500", labelClassName);
  const age = iso ? ageOnDate(iso, today) : null;

  return (
    <div className={cn("w-full", className)} data-testid={testId} role="group" aria-label="Date of birth">
      <div className="flex items-end gap-2">
        {ORDER.map((box) => (
          <div key={box} className={box === "year" ? "w-[6.25rem]" : "w-[4.5rem]"}>
            <span className={captionCls} style={labelStyle} aria-hidden="true">{CAPTION[box]}</span>
            <input
              ref={refs[box]}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={AUTOCOMPLETE[box]}
              maxLength={box === "year" ? 4 : 2}
              placeholder={PLACEHOLDER[box]}
              aria-label={`${CAPTION[box]} of birth`}
              aria-invalid={problem ? true : undefined}
              value={parts[box]}
              onChange={(e) => onBoxChange(box, e.target.value)}
              onKeyDown={(e) => onBoxKeyDown(box, e)}
              onPaste={onBoxPaste}
              onBlur={() => onBoxBlur(box)}
              // A tap into a box selects what it holds, so typing replaces it —
              // with maxLength=2 a third digit otherwise goes nowhere and the box
              // looks dead (a live trace found exactly that). Arriving by tap or
              // Tab: select on focus. Tapping a box that is ALREADY focused and
              // fully selected: Chrome treats that mousedown as a possible drag of
              // the selected text and collapses the selection on its own schedule,
              // undoing any select() made in a click handler — so the mousedown is
              // cancelled and the selection made right there. 🔴 Never defer a
              // select() with a timer: select() also FOCUSES, and a stale one
              // yanked focus back mid-typing ("11 7 2018" became "20 18").
              onFocus={(e) => { try { e.currentTarget.select(); } catch { /* ignore */ } }}
              onMouseDown={(e) => {
                const el = e.currentTarget;
                if (document.activeElement === el) { e.preventDefault(); try { el.select(); } catch { /* ignore */ } }
              }}
              disabled={disabled}
              required={required}
              autoFocus={autoFocus && box === "day"}
              className={cn(!unstyled && DOB_BOX_BASE, "text-center tabular-nums", inputClassName)}
              style={inputStyle}
              data-testid={testId ? `${testId}-${box}` : undefined}
            />
          </div>
        ))}
      </div>
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      {message ? (
        <p className={cn("mt-1.5 text-[12px]", dark ? "text-red-400" : "text-red-600")} role="alert" data-testid={testId ? `${testId}-message` : undefined}>
          {message}
        </p>
      ) : iso && renderStatus ? (
        <div className="mt-1.5">{renderStatus(iso)}</div>
      ) : iso && showAge && age !== null ? (
        <p className={cn("mt-1.5 text-[12px]", dark ? "text-white/60" : "text-slate-500")} data-testid={testId ? `${testId}-age` : undefined}>
          {age === 0 ? "Under 1 year old" : age === 1 ? "1 year old" : `${age} years old`}
        </p>
      ) : null}
    </div>
  );
}
