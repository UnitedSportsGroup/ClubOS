import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { Award, UsersRound, Calendar, DollarSign, TrendingUp } from "lucide-react";
import type { Tournament, TournamentTeam } from "@shared/schema";

export default function TournamentDashboard() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;

  const { data: tournaments = [] } = useQuery<Tournament[]>({
    queryKey: ["/api/admin/tournament/tournaments", { orgId }],
    queryFn: () => fetch(`/api/admin/tournament/tournaments?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const activeTournaments = tournaments.filter(t => t.active && !t.archived);
  const totalTeams = 0;
  const openReg = tournaments.filter(t => t.registrationStatus === "open");
  const totalRevenue = tournaments.reduce((sum, t) => sum + (t.registrationFeeCents || 0), 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white" data-testid="text-tournament-dashboard-title">Dashboard</h1>
        <p className="text-sm text-white/40 mt-1">Tournament management overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-5" data-testid="stat-tournaments">
          <Award className="w-5 h-5 text-white/50 mb-3" />
          <p className="text-2xl font-bold text-white">{tournaments.length}</p>
          <p className="text-xs text-white/40 mt-1">Tournaments</p>
        </div>
        <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-5" data-testid="stat-active">
          <TrendingUp className="w-5 h-5 text-white/50 mb-3" />
          <p className="text-2xl font-bold text-white">{activeTournaments.length}</p>
          <p className="text-xs text-white/40 mt-1">Active</p>
        </div>
        <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-5" data-testid="stat-open-reg">
          <UsersRound className="w-5 h-5 text-white/50 mb-3" />
          <p className="text-2xl font-bold text-white">{openReg.length}</p>
          <p className="text-xs text-white/40 mt-1">Registration Open</p>
        </div>
        <div className="rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-5" data-testid="stat-revenue">
          <DollarSign className="w-5 h-5 text-white/50 mb-3" />
          <p className="text-2xl font-bold text-white">{tournaments.filter(t => t.status !== "draft").length}</p>
          <p className="text-xs text-white/40 mt-1">Published</p>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Award className="w-4 h-4 text-white/40" />
          <h3 className="text-sm font-semibold text-white">Active Tournaments</h3>
        </div>
        {activeTournaments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-white/20">
            <Award className="w-10 h-10 mb-2" />
            <p className="text-sm">No active tournaments</p>
            <p className="text-xs mt-1">Create your first tournament to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeTournaments.map(t => (
              <div key={t.id} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0" data-testid={`tournament-row-${t.id}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                    <Award className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white/80">{t.name}</p>
                    <p className="text-xs text-white/30">{t.ageGroup || "Open"} · {t.numGroups} groups · {t.teamsPerGroup} teams/group</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    t.status === "active" ? "bg-green-500/15 text-green-400" :
                    t.status === "draft" ? "bg-white/5 text-white/30" :
                    t.status === "completed" ? "bg-blue-500/15 text-blue-400" :
                    "bg-white/5 text-white/30"
                  }`}>
                    {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                  </span>
                  {t.startDate && (
                    <p className="text-[10px] text-white/20 mt-1">
                      {new Date(t.startDate + "T12:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
