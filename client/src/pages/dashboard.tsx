import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  GraduationCap,
  DollarSign,
  ClipboardCheck,
  UserPlus,
  ArrowRight,
  Calendar,
  Activity,
} from "lucide-react";
import { Link } from "wouter";
import type { Contact, Program, Registration } from "@shared/schema";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  accentColor,
  testId,
  delay,
}: {
  title: string;
  value: string | number;
  icon: any;
  description?: string;
  accentColor: string;
  testId: string;
  delay: number;
}) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-500/15 to-blue-600/5 border-blue-500/20 shadow-[0_0_20px_rgba(3,86,197,0.08)]",
    emerald: "from-emerald-500/12 to-emerald-600/3 border-emerald-500/15 shadow-[0_0_20px_rgba(16,185,129,0.06)]",
    amber: "from-amber-500/12 to-amber-600/3 border-amber-500/15 shadow-[0_0_20px_rgba(245,158,11,0.06)]",
    violet: "from-violet-500/12 to-violet-600/3 border-violet-500/15 shadow-[0_0_20px_rgba(139,92,246,0.06)]",
  };
  const iconColorMap: Record<string, string> = {
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  };

  return (
    <div
      className={`stat-glow relative rounded-2xl border bg-gradient-to-br p-5 animate-fade-in-up transition-all duration-500 hover:scale-[1.02] ${colorMap[accentColor]}`}
      data-testid={testId}
      style={{ animationDelay: `${delay}ms` , opacity: 0 }}
    >
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[12px] text-white/45 font-medium uppercase tracking-wider">{title}</span>
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${iconColorMap[accentColor]}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <span className="text-3xl font-bold text-white tracking-tight" data-testid={`${testId}-value`}>
          {value}
        </span>
        {description && (
          <p className="text-[11px] text-white/35 mt-2">{description}</p>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  title,
  description,
  icon: Icon,
  href,
  testId,
}: {
  title: string;
  description: string;
  icon: any;
  href: string;
  testId: string;
}) {
  return (
    <Link href={href}>
      <div
        className="flex items-center gap-4 p-3.5 rounded-xl cursor-pointer glass-card hover:border-blue-500/25 transition-all duration-300 group"
        data-testid={testId}
      >
        <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:shadow-[0_0_12px_rgba(3,86,197,0.15)] transition-shadow duration-300">
          <Icon className="w-4 h-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[13px] text-white/75">{title}</p>
          <p className="text-[11px] text-white/30">{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-white/15 group-hover:text-blue-400/50 group-hover:translate-x-0.5 transition-all duration-300" />
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<{
    totalContacts: number;
    totalPlayers: number;
    totalGuardians: number;
    activePrograms: number;
    totalRegistrations: number;
    pendingRegistrations: number;
  }>({
    queryKey: ["/api/stats"],
  });

  const { data: allContacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });
  const recentContacts = allContacts?.slice(0, 5);

  const { data: allPrograms } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
  });
  const activePrograms = allPrograms?.filter((p) => p.isActive);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">
            Welcome to ClubOS
          </h1>
          <p className="text-blue-400/35 text-[13px] mt-1">
            Christchurch United Football Club
          </p>
        </div>
        <Button
          asChild
          data-testid="button-add-contact"
          className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-9 text-[13px] font-medium glow-btn"
        >
          <Link href="/contacts?action=new">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Contact
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-2xl glass-card p-5">
                <Skeleton className="h-20 w-full bg-blue-500/[0.04]" />
              </div>
            ))}
          </>
        ) : (
          <>
            <StatCard
              title="Total Members"
              value={stats?.totalContacts ?? 0}
              icon={Users}
              description={`${stats?.totalPlayers ?? 0} players · ${stats?.totalGuardians ?? 0} guardians`}
              accentColor="blue"
              testId="stat-total-members"
              delay={50}
            />
            <StatCard
              title="Active Programmes"
              value={stats?.activePrograms ?? 0}
              icon={GraduationCap}
              accentColor="emerald"
              testId="stat-active-programs"
              delay={100}
            />
            <StatCard
              title="Registrations"
              value={stats?.totalRegistrations ?? 0}
              icon={ClipboardCheck}
              description={`${stats?.pendingRegistrations ?? 0} pending`}
              accentColor="amber"
              testId="stat-registrations"
              delay={150}
            />
            <StatCard
              title="This Month"
              value="$0.00"
              icon={DollarSign}
              description="Revenue collected"
              accentColor="violet"
              testId="stat-revenue"
              delay={200}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '200ms', opacity: 0 }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
              <h3 className="text-[14px] font-semibold text-white/75">Recent Contacts</h3>
              <Button variant="ghost" size="sm" asChild data-testid="link-view-all-contacts" className="text-blue-400/60 hover:text-blue-400 text-[12px] h-7 transition-colors duration-300">
                <Link href="/contacts">View all</Link>
              </Button>
            </div>
            <div>
              {recentContacts && recentContacts.length > 0 ? (
                <div className="divide-y divide-blue-500/[0.04]">
                  {recentContacts.map((contact) => (
                    <Link
                      key={contact.id}
                      href={`/contacts/${contact.id}`}
                    >
                      <div
                        className="flex items-center gap-3 px-5 py-3 row-hover cursor-pointer"
                        data-testid={`row-contact-${contact.id}`}
                      >
                        <div className="w-8 h-8 rounded-xl bg-blue-500/8 border border-blue-500/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-400/70 text-[11px] font-semibold">
                            {contact.firstName[0]}{contact.lastName[0]}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-white/75 truncate">
                            {contact.firstName} {contact.lastName}
                          </p>
                          <p className="text-[11px] text-white/25 truncate">
                            {contact.email || contact.phone || "No contact info"}
                          </p>
                        </div>
                        <span className="text-[10px] text-blue-300/30 capitalize px-2 py-0.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.08]">
                          {contact.type}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Users className="w-10 h-10 text-blue-400/10 mb-3" />
                  <p className="text-[13px] text-white/25">No contacts yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '250ms', opacity: 0 }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
              <h3 className="text-[14px] font-semibold text-white/75">Active Programmes</h3>
              <Button variant="ghost" size="sm" asChild data-testid="link-view-all-programs" className="text-blue-400/60 hover:text-blue-400 text-[12px] h-7 transition-colors duration-300">
                <Link href="/programs">View all</Link>
              </Button>
            </div>
            <div>
              {activePrograms && activePrograms.length > 0 ? (
                <div className="divide-y divide-blue-500/[0.04]">
                  {activePrograms.map((program) => (
                    <Link key={program.id} href={`/programs/${program.id}`}>
                      <div
                        className="flex items-center gap-3 px-5 py-3 row-hover cursor-pointer"
                        data-testid={`row-program-${program.id}`}
                      >
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/8 border border-emerald-500/15 flex items-center justify-center flex-shrink-0">
                          <GraduationCap className="w-4 h-4 text-emerald-400/70" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-white/75 truncate">{program.name}</p>
                          <p className="text-[11px] text-white/25">
                            {program.startDate && program.endDate
                              ? `${program.startDate} — ${program.endDate}`
                              : "Dates TBD"}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 flex items-center gap-2">
                          {program.fee && (
                            <span className="text-[13px] font-medium text-white/50">${program.fee}</span>
                          )}
                          <span className="text-[10px] text-blue-300/30 capitalize px-2 py-0.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.08]">
                            {program.type.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <GraduationCap className="w-10 h-10 text-blue-400/10 mb-3" />
                  <p className="text-[13px] text-white/25">No active programmes</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6 animate-fade-in-up" style={{ animationDelay: '300ms', opacity: 0 }}>
          <div className="rounded-2xl glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-blue-500/[0.08]">
              <h3 className="text-[14px] font-semibold text-white/75">Quick Actions</h3>
            </div>
            <div className="p-3 space-y-2">
              <QuickAction
                title="Register Player"
                description="Add a new player to a programme"
                icon={UserPlus}
                href="/contacts?action=new&type=player"
                testId="action-register-player"
              />
              <QuickAction
                title="New Programme"
                description="Create a holiday camp or academy"
                icon={GraduationCap}
                href="/programs?action=new"
                testId="action-new-program"
              />
              <QuickAction
                title="View Calendar"
                description="See upcoming events & sessions"
                icon={Calendar}
                href="/events"
                testId="action-view-calendar"
              />
              <QuickAction
                title="View Audit Log"
                description="Track recent activity"
                icon={Activity}
                href="/audit-log"
                testId="action-view-audit"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
