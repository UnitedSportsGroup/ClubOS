import { money, compact } from "./format";

type BarItem = { key: string; label: string; value: number; color?: string };

/** A horizontal bar list — channels, spend by workspace. No chart library:
 *  a plain HTML bar sized against the largest item in the set. */
export function BarList({ items, kind }: { items: BarItem[]; kind: "count" | "money" }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const format = (v: number) => (kind === "money" ? money(v) : compact(v));

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No data in this period.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.key} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: item.color ?? "hsl(var(--muted-foreground))" }}
              />
              <span className="text-foreground truncate">{item.label}</span>
            </span>
            <span className="text-foreground tabular-nums shrink-0">{format(item.value)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-r-full"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                backgroundColor: item.color ?? "hsl(var(--muted-foreground))",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
