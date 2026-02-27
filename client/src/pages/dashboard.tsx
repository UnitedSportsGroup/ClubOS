import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  TrendingUp,
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
  gradient,
  testId,
}: {
  title: string;
  value: string | number;
  icon: any;
  description?: string;
  gradient: string;
  testId: string;
}) {
  return (
    <div
      className={`relative rounded-xl border border-white/[0.06] p-5 overflow-hidden ${gradient}`}
      data-testid={testId}
    >
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[13px] text-white/50 font-medium">{title}</span>
          <div className="w-8 h-8 rounded-lg bg-white/[0.08] flex items-center justify-center">
            <Icon className="w-4 h-4 text-white/60" />
          </div>
        </div>
        <span className="text-3xl font-bold text-white tracking-tight" data-testid={`${testId}-value`}>
          {value}
        </span>
        {description && (
          <p className="text-[12px] text-white/40 mt-1.5">{description}</p>
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
        className="flex items-center gap-4 p-3.5 rounded-xl cursor-pointer border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-200 group"
        data-testid={testId}
      >
        <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <Icon className="w-4 h-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[13px] text-white/80">{title}</p>
          <p className="text-[11px] text-white/35">{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/40 transition-colors" />
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">
            Welcome to ClubOS
          </h1>
          <p className="text-white/40 text-[13px] mt-1">
            Christchurch United Football Club
          </p>
        </div>
        <Button
          asChild
          data-testid="button-add-contact"
          className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg h-9 text-[13px] font-medium shadow-lg shadow-blue-500/20"
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
              <div key={i} className="rounded-xl border border-white/[0.06] p-5 bg-white/[0.02]">
                <Skeleton className="h-20 w-full bg-white/[0.04]" />
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
              gradient="bg-gradient-to-br from-blue-500/10 via-transparent to-transparent"
              testId="stat-total-members"
            />
            <StatCard
              title="Active Programmes"
              value={stats?.activePrograms ?? 0}
              icon={GraduationCap}
              gradient="bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent"
              testId="stat-active-programs"
            />
            <StatCard
              title="Registrations"
              value={stats?.totalRegistrations ?? 0}
              icon={ClipboardCheck}
              description={`${stats?.pendingRegistrations ?? 0} pending`}
              gradient="bg-gradient-to-br from-amber-500/10 via-transparent to-transparent"
              testId="stat-registrations"
            />
            <StatCard
              title="This Month"
              value="$0.00"
              icon={DollarSign}
              description="Revenue collected"
              gradient="bg-gradient-to-br from-violet-500/10 via-transparent to-transparent"
              testId="stat-revenue"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <h3 className="text-[14px] font-semibold text-white/80">Recent Contacts</h3>
              <Button variant="ghost" size="sm" asChild data-testid="link-view-all-contacts" className="text-blue-400 hover:text-blue-300 text-[12px] h-7">
                <Link href="/contacts">View all</Link>
              </Button>
            </div>
            <div>
              {recentContacts && recentContacts.length > 0 ? (
                <div className="divide-y divide-white/[0.04]">
                  {recentContacts.map((contact) => (
                    <Link
                      key={contact.id}
                      href={`/contacts/${contact.id}`}
                    >
                      <div
                        className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] cursor-pointer transition-colors"
                        data-testid={`row-contact-${contact.id}`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-400 text-[11px] font-semibold">
                            {contact.firstName[0]}{contact.lastName[0]}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-white/80 truncate">
                            {contact.firstName} {contact.lastName}
                          </p>
                          <p className="text-[11px] text-white/30 truncate">
                            {contact.email || contact.phone || "No contact info"}
                          </p>
                        </div>
                        <span className="text-[10px] text-white/30 capitalize px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
                          {contact.type}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Users className="w-10 h-10 text-white/10 mb-3" />
                  <p className="text-[13px] text-white/30">No contacts yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <h3 className="text-[14px] font-semibold text-white/80">Active Programmes</h3>
              <Button variant="ghost" size="sm" asChild data-testid="link-view-all-programs" className="text-blue-400 hover:text-blue-300 text-[12px] h-7">
                <Link href="/programs">View all</Link>
              </Button>
            </div>
            <div>
              {activePrograms && activePrograms.length > 0 ? (
                <div className="divide-y divide-white/[0.04]">
                  {activePrograms.map((program) => (
                    <Link key={program.id} href={`/programs/${program.id}`}>
                      <div
                        className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] cursor-pointer transition-colors"
                        data-testid={`row-program-${program.id}`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                          <GraduationCap className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-white/80 truncate">{program.name}</p>
                          <p className="text-[11px] text-white/30">
                            {program.startDate && program.endDate
                              ? `${program.startDate} — ${program.endDate}`
                              : "Dates TBD"}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 flex items-center gap-2">
                          {program.fee && (
                            <span className="text-[13px] font-medium text-white/60">${program.fee}</span>
                          )}
                          <span className="text-[10px] text-white/30 capitalize px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
                            {program.type.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <GraduationCap className="w-10 h-10 text-white/10 mb-3" />
                  <p className="text-[13px] text-white/30">No active programmes</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h3 className="text-[14px] font-semibold text-white/80">Quick Actions</h3>
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
