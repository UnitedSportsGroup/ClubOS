import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FormsResponse } from "@shared/marketing-hub";
import { Loading, LoadError } from "./section-state";
import { StatTile } from "./stat-tile";
import { TrendChart } from "./trend-chart";
import { compact } from "./format";

export function FormsSection({ query }: { query: string }) {
  const url = `/api/admin/marketing-hub/forms?${query}`;
  const { data, isLoading, isError, error, refetch } = useQuery<FormsResponse>({
    queryKey: [url],
    staleTime: 60_000,
  });

  if (isLoading) return <Loading rows={5} />;
  if (isError) return <LoadError error={error} onRetry={refetch} />;
  if (!data) return null;

  const sortedForms = [...data.forms].sort((a, b) => b.current - a.current);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile
          label="Total submissions"
          value={compact(data.total.current)}
          current={data.total.current}
          previous={data.total.previous}
        />
      </div>

      <TrendChart
        title="Submissions"
        kind="count"
        data={data.series.map((s) => ({ date: s.date, value: s.submissions }))}
      />

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">By form</h3>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">This period</TableHead>
                  <TableHead className="text-right">Previous</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedForms.map((f) => {
                  const change =
                    f.previous === 0 ? null : ((f.current - f.previous) / f.previous) * 100;
                  return (
                    <TableRow key={`${f.key}-${f.workspace ?? "all"}`}>
                      <TableCell>{f.label}</TableCell>
                      <TableCell className="text-muted-foreground">{f.workspace ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(f.current)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(f.previous)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(0)}%`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {data.byProgramme.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-foreground">By programme</h3>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Programme</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead className="text-right">This period</TableHead>
                    <TableHead className="text-right">Previous</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProgramme.map((p) => (
                    <TableRow key={p.programId}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.workspace ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(p.current)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(p.previous)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {data.guard.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-foreground">Spam guard</h3>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead className="text-right">Accepted</TableHead>
                    <TableHead className="text-right">Held</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.guard.map((g) => (
                    <TableRow key={g.form}>
                      <TableCell>{g.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(g.accepted)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(g.held)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {data.notes.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          {data.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
