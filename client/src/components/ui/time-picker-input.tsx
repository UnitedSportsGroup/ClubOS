// Drop-in replacement for <Input type="time" />. Native browser time inputs
// don't reliably commit their value to React state in Safari — the controlled
// `value` desyncs from what's shown, so the field looks filled while form state
// stays empty (this is what silently disabled the "Create Booking" button).
//
// This component is fully controlled and never renders a native time widget, so
// it behaves identically across Safari / Chrome / Firefox. Same value contract
// as the native input: a 24-hour "HH:MM" string, with onChange receiving an
// event-shaped object so existing form code keeps working untouched. Mirrors
// date-picker-input.tsx so the two read and style the same.

import * as React from "react";
import { Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TimePickerInputProps {
  value?: string;                      // 24h "HH:MM" (or '' / undefined)
  onChange?: (e: { target: { value: string } }) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  minuteStep?: number;                 // minute increments shown (default 5)
  "data-testid"?: string;
}

function parse24(value?: string): { h: number; m: number } | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function to24(h12: number, m: number, period: "AM" | "PM"): string {
  let h = h12 % 12;                    // 12 -> 0
  if (period === "PM") h += 12;        // PM adds 12 (12 PM -> 12, 12 AM -> 0)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function format12(value?: string): string | null {
  const p = parse24(value);
  if (!p) return null;
  const period = p.h >= 12 ? "PM" : "AM";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.m).padStart(2, "0")} ${period}`;
}

export function TimePickerInput({
  value,
  onChange,
  placeholder = "--:-- --",
  disabled,
  className,
  minuteStep = 5,
  ...rest
}: TimePickerInputProps) {
  const [open, setOpen] = React.useState(false);
  const parsed = parse24(value);
  const display = format12(value);

  // Current 12h parts. When empty we fall back to a sensible default (9:00 AM)
  // purely for *composing* a value on the first click — nothing is highlighted
  // until the user has actually picked something (parsed != null).
  const cur = parsed ?? { h: 9, m: 0 };
  const curPeriod: "AM" | "PM" = cur.h >= 12 ? "PM" : "AM";
  const curH12 = cur.h % 12 === 0 ? 12 : cur.h % 12;

  const hours = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
  const minutes = React.useMemo(() => {
    const list: number[] = [];
    for (let m = 0; m < 60; m += Math.max(1, minuteStep)) list.push(m);
    // Keep an off-step current minute (e.g. a saved 17:23) visible & selectable.
    if (parsed && !list.includes(parsed.m)) {
      list.push(parsed.m);
      list.sort((a, b) => a - b);
    }
    return list;
  }, [minuteStep, parsed?.m]);

  // Emit a complete value when any part changes; unset parts use the current
  // (or default) so a single click always yields a valid time.
  const emit = (next: Partial<{ h12: number; m: number; period: "AM" | "PM" }>) => {
    const h12 = next.h12 ?? curH12;
    const m = next.m ?? cur.m;
    const period = next.period ?? curPeriod;
    onChange?.({ target: { value: to24(h12, m, period) } });
  };

  const colBtn = (active: boolean) =>
    cn(
      "px-2.5 py-1.5 rounded-md text-sm w-full text-center transition-colors",
      active ? "bg-blue-600 text-white" : "text-white/70 hover:bg-white/[0.06]",
    );

  return (
    <Popover open={open} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          data-testid={rest["data-testid"]}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-xl border bg-white/[0.03] border-white/[0.06] px-3 py-2 text-sm text-left text-white/80",
            "hover:bg-white/[0.05] focus:outline-none focus:border-blue-500/30 transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !display && "text-white/30",
            className,
          )}
        >
          <span className="truncate">{display ?? placeholder}</span>
          <Clock className="h-4 w-4 text-white/30 flex-shrink-0 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-2 bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl"
      >
        <div className="flex gap-1" data-testid="time-picker-columns">
          {/* Hours */}
          <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto pr-1 w-14">
            {hours.map((h) => (
              <button
                key={h}
                type="button"
                className={colBtn(parsed != null && h === curH12)}
                onClick={() => emit({ h12: h })}
                data-testid={`time-hour-${h}`}
              >
                {h}
              </button>
            ))}
          </div>
          {/* Minutes */}
          <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto pr-1 w-14">
            {minutes.map((m) => (
              <button
                key={m}
                type="button"
                className={colBtn(parsed != null && m === cur.m)}
                onClick={() => emit({ m })}
                data-testid={`time-min-${m}`}
              >
                {String(m).padStart(2, "0")}
              </button>
            ))}
          </div>
          {/* AM / PM */}
          <div className="flex flex-col gap-0.5 w-14">
            {(["AM", "PM"] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={colBtn(parsed != null && p === curPeriod)}
                onClick={() => emit({ period: p })}
                data-testid={`time-period-${p}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
