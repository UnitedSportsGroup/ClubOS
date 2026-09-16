// Drop-in replacement for a bare <select>.
//
// Daniel, 2026-09-16, of the Sales page on Dima's machine: *"make this dropdown
// built natively in software as it's not readable on dima's browser — make it
// custom built in our software so ui/ux is same for all users no matter what
// light or dark mode settings, browser or device."*
//
// That is the standing rule (CLAUDE.md, "Every Control Is Drawn By Us"): a
// native <select> paints its OPTION PANEL with the operating system, so the
// list is dark-on-light for one person and fine for another, and no CSS
// reaches it. The `[&>option]:bg-neutral-900` hack sprinkled around this
// codebase is the same dead end as the old `style={{ colorScheme: "dark" }}` —
// it is trying to restyle somebody else's widget.
//
// 🔴 Same contract as the native element, ON PURPOSE, so migrating a call site
// is a rename and nothing else:
//     <select value={x} onChange={e => set(e.target.value)}>
//       <option value="a">A</option>
//     </select>
//   becomes
//     <SelectInput value={x} onChange={e => set(e.target.value)}>
//       <option value="a">A</option>
//     </SelectInput>
//
// The <option> children are READ, never rendered — they are the data. That is
// what lets 237 existing call sites move without rewriting each one into
// shadcn's SelectTrigger/SelectContent/SelectItem shape.
import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface SelectInputProps {
  value?: string | number;
  /** Uncontrolled, exactly as the native element — some call sites use it. */
  defaultValue?: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  style?: React.CSSProperties;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
  id?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  children?: React.ReactNode;
}

type Opt = { value: string; label: string; disabled?: boolean; group?: string };

/** Read <option> / <optgroup> children as data. */
function readOptions(children: React.ReactNode, group?: string): Opt[] {
  const out: Opt[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === "optgroup") {
      const props: any = child.props;
      out.push(...readOptions(props.children, String(props.label ?? "")));
      return;
    }
    if (child.type === "option") {
      const props: any = child.props;
      // An <option> with no value attribute falls back to its text, exactly as
      // the native element does — several call sites rely on that.
      const label = typeof props.children === "string"
        ? props.children
        : React.Children.toArray(props.children).filter((c) => typeof c === "string").join("");
      out.push({
        value: props.value !== undefined ? String(props.value) : label,
        label: label || String(props.value ?? ""),
        disabled: !!props.disabled,
        group,
      });
    }
  });
  return out;
}

export function SelectInput({
  value, defaultValue, onChange, disabled, className, placeholder, children, ...rest
}: SelectInputProps) {
  const [open, setOpen] = React.useState(false);
  // Controlled when `value` is given, uncontrolled when only `defaultValue` is
  // — the same rule React applies to the native element, so a call site that
  // relied on either keeps working.
  const [inner, setInner] = React.useState(() => String(defaultValue ?? ""));
  const isControlled = value !== undefined;
  const selected = isControlled ? String(value ?? "") : inner;

  const options = React.useMemo(() => readOptions(children), [children]);
  const current = options.find((o) => o.value === selected);

  // Groups keep their order of first appearance.
  const groups: { name: string | undefined; items: Opt[] }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.name === o.group);
    if (g) g.items.push(o); else groups.push({ name: o.group, items: [o] });
  }

  const pick = (v: string) => {
    setOpen(false);
    if (!isControlled) setInner(v);
    onChange?.({ target: { value: v } });
  };

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex items-center justify-between gap-2 w-full text-left",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
          {...rest}
        >
          <span className={cn("truncate", !current && "opacity-55")}>
            {current?.label ?? placeholder ?? ""}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // 🔴 Drawn by us: our surface, our ink, our hover — identical on every
        // browser, OS and colour-scheme setting. `--radix-popover-trigger-width`
        // keeps the panel the width of the control it came from.
        className="p-1 w-[var(--radix-popover-trigger-width)] min-w-[9rem] max-h-72 overflow-auto bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl"
      >
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-xs opacity-50">Nothing to choose</div>
        ) : groups.map((g, gi) => (
          <div key={gi}>
            {g.name && (
              <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider opacity-40">{g.name}</div>
            )}
            {g.items.map((o) => {
              const active = o.value === selected;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={o.disabled}
                  onClick={() => !o.disabled && pick(o.value)}
                  data-testid={`option-${o.value}`}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    "hover:bg-foreground/[0.06] disabled:opacity-40 disabled:cursor-not-allowed",
                    active && "bg-foreground/[0.08] font-medium",
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default SelectInput;
