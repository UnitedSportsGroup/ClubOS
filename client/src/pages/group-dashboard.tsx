import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutDashboard, Users, DollarSign, Calendar, TrendingUp, Building2 } from "lucide-react";
import usgLogoPath from "@assets/Untitled_design_-_2026-04-10T083202.470_1775766890766.png";

export default function GroupDashboard() {
  const { data: registrations } = useQuery<any[]>({
    queryKey: ["/api/admin/registrations"],
  });

  const { data: events } = useQuery<any[]>({
    queryKey: ["/api/admin/calendar-events"],
  });

  const confirmedRegs = registrations?.filter((r: any) => r.status === "confirmed") || [];
  const totalRevenue = confirmedRegs.reduce((sum: number, r: any) => sum + (r.amountPaidCents || 0), 0);
  const upcomingEvents = events?.filter((e: any) => new Date(e.startTime) > new Date()).length || 0;

  const stats = [
    { label: "Total Registrations", value: confirmedRegs.length, icon: Users, color: "blue" },
    { label: "Total Revenue", value: `$${(totalRevenue / 100).toLocaleString()}`, icon: DollarSign, color: "emerald" },
    { label: "Upcoming Events", value: upcomingEvents, icon: Calendar, color: "amber" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <img src={usgLogoPath} alt="USG" className="w-10 h-10 rounded-xl object-contain" />
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">United Sports Group</h1>
          <p className="text-sm text-white/40 mt-0.5">Cross-workspace overview</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="premium-card border-white/[0.06]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/40 font-medium">{stat.label}</p>
                  <p className="text-2xl font-semibold text-white mt-1" data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, '-')}`}>{stat.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-${stat.color}-500/10`}>
                  <stat.icon className={`w-5 h-5 text-${stat.color}-400`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="premium-card border-white/[0.06]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-white/40" />
              Workspaces
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { name: "Christchurch United", desc: "Holiday Camps & Academy", color: "bg-blue-500" },
              { name: "South Island United", desc: "Regional Football", color: "bg-indigo-500" },
              { name: "Mini Football Leagues", desc: "Youth Leagues", color: "bg-green-500" },
              { name: "United Sports Centre", desc: "Venue & Facilities", color: "bg-amber-500" },
              { name: "Christchurch International Cup", desc: "Tournaments", color: "bg-purple-500" },
              { name: "United Gymnastics", desc: "Gymnastics Programs", color: "bg-pink-500" },
            ].map((ws) => (
              <div key={ws.name} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]" data-testid={`workspace-${ws.name.toLowerCase().replace(/\s/g, '-')}`}>
                <div className={`w-2 h-2 rounded-full ${ws.color}`} />
                <div>
                  <p className="text-sm text-white/80">{ws.name}</p>
                  <p className="text-xs text-white/30">{ws.desc}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="premium-card border-white/[0.06]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-white/80 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-white/40" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-white/40">
              Use the sidebar to navigate to the Calendar for scheduling, or switch to individual workspaces for detailed management.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {[
                { label: "Calendar", desc: "View & create events", icon: Calendar },
                { label: "Registrations", desc: `${confirmedRegs.length} total`, icon: Users },
              ].map((action) => (
                <div key={action.label} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer">
                  <action.icon className="w-5 h-5 text-blue-400/60 mb-2" />
                  <p className="text-sm text-white/80 font-medium">{action.label}</p>
                  <p className="text-xs text-white/30 mt-0.5">{action.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
