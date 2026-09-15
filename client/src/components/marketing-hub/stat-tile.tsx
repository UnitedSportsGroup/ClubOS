import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { pct } from "./format";
import type { Availability } from "@shared/marketing-hub";

const STATUS_TEXT: Record<Exclude<Availability, "ok">, string> = {
  not_connected: "Not connected",
  not_split: "Can't be split by programme yet",
  no_data: "No data in this period",
};

/**
 * One number, one card. Four states:
 *   - status set to anything but "ok" → the status sentence INSTEAD of a value
 *     (never 0, never $0.00 — see the revenue-widget note on why that lies)
 *   - deltaMode "pct" (default) → percentChange(current, previous); null &
 *     current > 0 reads "nothing in the previous period"
 *   - deltaMode "diff" → a signed current-minus-previous count (followers);
 *     hidden entirely when previous is null
 *   - neutral → the delta still shows, but in muted ink rather than
 *     green/red (ad spend going up is not "good")
 */
export function StatTile({
  label,
  value,
  current,
  previous,
  deltaMode = "pct",
  neutral = false,
  note,
  status,
}: {
  label: string;
  /** Already formatted for display — money(), compact(), or plain text. */
  value: string;
  current?: number;
  previous?: number | null;
  deltaMode?: "pct" | "diff";
  neutral?: boolean;
  note?: string;
  status?: Availability;
}) {
  const unavailable = status && status !== "ok";

  let deltaNode: ReactNode = null;
  if (!unavailable && current != null) {
    if (deltaMode === "pct") {
      const change = previous == null ? null : pct(current, previous);
      if (change === null) {
        if (previous === 0 && current > 0) {
          deltaNode = (
            <span className="text-xs text-muted-foreground">nothing in the previous period</span>
          );
        }
      } else {
        const flat = Math.abs(change) < 0.5;
        const up = change > 0;
        deltaNode = (
          <DeltaBadge flat={flat} up={up} neutral={neutral}>
            {Math.abs(change).toFixed(Math.abs(change) >= 10 ? 0 : 1)}%
          </DeltaBadge>
        );
      }
    } else if (previous != null) {
      const diff = current - previous;
      const flat = diff === 0;
      const up = diff > 0;
      deltaNode = (
        <DeltaBadge flat={flat} up={up} neutral={neutral}>
          {Math.abs(diff).toLocaleString("en-NZ")}
        </DeltaBadge>
      );
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
        {unavailable ? (
          <p className="text-sm text-muted-foreground leading-snug">
            {STATUS_TEXT[status as Exclude<Availability, "ok">]}
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-semibold tracking-tight">{value}</span>
            {deltaNode}
          </div>
        )}
        {note && <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{note}</p>}
      </CardContent>
    </Card>
  );
}

function DeltaBadge({
  flat,
  up,
  neutral,
  children,
}: {
  flat: boolean;
  up: boolean;
  neutral: boolean;
  children: ReactNode;
}) {
  const colorClass = flat || neutral ? "text-muted-foreground" : up ? "text-emerald-600" : "text-rose-600";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", colorClass)}>
      {flat ? (
        <Minus className="w-3 h-3" />
      ) : up ? (
        <ArrowUpRight className="w-3.5 h-3.5" />
      ) : (
        <ArrowDownRight className="w-3.5 h-3.5" />
      )}
      {children}
    </span>
  );
}
