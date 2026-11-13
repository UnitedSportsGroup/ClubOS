import { useLocation } from "wouter";
import { Pill, AvailBadge, Empty, LevelDot, Loading, LoadError, PageHead, Panel, TableWrap, td, th, useOverview, niceDay } from "./ui";

export const ACCOUNT_WORD: Record<string, string> = { none: "No account", invited: "Invited", active: "Active", disabled: "Disabled" };
export const ACCOUNT_TONE: Record<string, "grey" | "amber" | "green" | "red"> = { none: "grey", invited: "amber", active: "green", disabled: "red" };

export default function Players() {
  const q = useOverview();
  const [, navigate] = useLocation();
  const d = q.data;
  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Players" blurb="Everyone on the South Island United squad. Open a player for their load, check-ins, availability, tests and clips." />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (d.players.length === 0 ? (
        <Empty>No players on the squad yet. Add players to a South Island United squad in the Squads tab.</Empty>
      ) : (
        <Panel>
          <TableWrap>
            <table className="w-full" data-testid="perf-players">
              <thead><tr>{["Player", "Squad", "Ready?", "Availability", "Check-in app", "Last sign-in"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {d.players.map((p) => (
                  <tr key={p.contactId} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/performance/players/${p.contactId}?from=/admin/performance/players`)}>
                    <td className={td}>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{[p.position, p.squadNumber != null ? `#${p.squadNumber}` : null].filter(Boolean).join(" · ") || "—"}</div>
                    </td>
                    <td className={td}>{p.squad}</td>
                    <td className={td}><LevelDot level={p.readiness.level} /></td>
                    <td className={td}><AvailBadge state={p.availability.state} /></td>
                    <td className={td}><Pill tone={ACCOUNT_TONE[p.account]}>{ACCOUNT_WORD[p.account]}</Pill></td>
                    <td className={`${td} text-xs text-muted-foreground`}>{p.lastSignIn ? niceDay(p.lastSignIn.slice(0, 10), true) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      ))}
    </div>
  );
}
