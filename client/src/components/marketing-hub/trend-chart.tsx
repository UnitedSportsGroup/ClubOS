import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMeasuredWidth } from "@/lib/use-measured-width";
import { money, shortDate } from "./format";

type Point = { date: string; value: number };

/**
 * A single-series trend line — visitors, submissions, spend. Never two
 * measures on one chart (see the marketing-hub.tsx design note): a shared axis
 * across different units always misleads one of them.
 */
export function TrendChart({
  title,
  data,
  kind,
  height = 200,
}: {
  title: string;
  data: Point[];
  kind: "count" | "money";
  height?: number;
}) {
  const chart = useMeasuredWidth<HTMLDivElement>();
  const [showTable, setShowTable] = useState(false);
  const hasAny = data.some((p) => p.value > 0);
  const format = (v: number) => (kind === "money" ? money(v) : v.toLocaleString("en-NZ"));

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showTable ? "Hide table" : "Show table"}
          {showTable ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <div
            className="flex items-center justify-center rounded-lg border border-dashed border-border"
            style={{ height }}
          >
            <p className="text-sm text-muted-foreground">No data in this period.</p>
          </div>
        ) : (
          <div ref={chart.ref} style={{ height }} className="-ml-2">
            {chart.width > 0 && (
              <AreaChart
                width={chart.width}
                height={height}
                data={data}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id={`trendFill-${title.replace(/\s+/g, "-")}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    kind === "money"
                      ? v >= 100000
                        ? `$${Math.round(v / 100000)}k`
                        : `$${Math.round(v / 100)}`
                      : String(Math.round(v))
                  }
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  labelFormatter={(d: string) => shortDate(d)}
                  formatter={(v: number) => [format(v), title]}
                />
                <Area
                  type="linear"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill={`url(#trendFill-${title.replace(/\s+/g, "-")})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            )}
          </div>
        )}

        {showTable && (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">{title}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => (
                  <TableRow key={p.date}>
                    <TableCell>{shortDate(p.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(p.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
