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
} from "lucide-react";
import { Link } from "wouter";
import type { Contact, Program, Registration } from "@shared/schema";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  color,
  testId,
}: {
  title: string;
  value: string | number;
  icon: any;
  description?: string;
  color: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-1">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{title}</span>
            <span className="text-2xl font-bold tracking-tight" data-testid={`${testId}-value`}>
              {value}
            </span>
            {description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>
          <div className={`p-2.5 rounded-md ${color}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
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
        className="flex items-center gap-4 p-4 rounded-md cursor-pointer border border-border hover-elevate"
        data-testid={testId}
      >
        <div className="p-2 rounded-md bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground" />
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
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            Welcome to ClubOS
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Christchurch United Football Club dashboard
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild data-testid="button-add-contact">
            <Link href="/contacts?action=new">
              <UserPlus className="w-4 h-4 mr-2" />
              Add Contact
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <StatCard
              title="Total Members"
              value={stats?.totalContacts ?? 0}
              icon={Users}
              description={`${stats?.totalPlayers ?? 0} players · ${stats?.totalGuardians ?? 0} guardians`}
              color="bg-primary"
              testId="stat-total-members"
            />
            <StatCard
              title="Active Programmes"
              value={stats?.activePrograms ?? 0}
              icon={GraduationCap}
              color="bg-emerald-600"
              testId="stat-active-programs"
            />
            <StatCard
              title="Registrations"
              value={stats?.totalRegistrations ?? 0}
              icon={ClipboardCheck}
              description={`${stats?.pendingRegistrations ?? 0} pending`}
              color="bg-gold"
              testId="stat-registrations"
            />
            <StatCard
              title="This Month"
              value="$0.00"
              icon={DollarSign}
              description="Revenue collected"
              color="bg-violet-600"
              testId="stat-revenue"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-3">
              <CardTitle className="text-base font-semibold">Recent Contacts</CardTitle>
              <Button variant="ghost" size="sm" asChild data-testid="link-view-all-contacts">
                <Link href="/contacts">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {recentContacts && recentContacts.length > 0 ? (
                <div className="divide-y">
                  {recentContacts.map((contact) => (
                    <Link
                      key={contact.id}
                      href={`/contacts/${contact.id}`}
                    >
                      <div
                        className="flex items-center gap-3 px-5 py-3 hover-elevate cursor-pointer"
                        data-testid={`row-contact-${contact.id}`}
                      >
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary text-xs font-semibold">
                            {contact.firstName[0]}{contact.lastName[0]}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {contact.firstName} {contact.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {contact.email || contact.phone || "No contact info"}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {contact.type}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Users className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No contacts yet</p>
                  <Button variant="ghost" size="sm" className="mt-2" asChild>
                    <Link href="/contacts?action=new">Add your first contact</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-3">
              <CardTitle className="text-base font-semibold">Active Programmes</CardTitle>
              <Button variant="ghost" size="sm" asChild data-testid="link-view-all-programs">
                <Link href="/programs">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {activePrograms && activePrograms.length > 0 ? (
                <div className="divide-y">
                  {activePrograms.map((program) => (
                    <Link key={program.id} href={`/programs/${program.id}`}>
                      <div
                        className="flex items-center gap-3 px-5 py-3 hover-elevate cursor-pointer"
                        data-testid={`row-program-${program.id}`}
                      >
                        <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                          <GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{program.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {program.startDate && program.endDate
                              ? `${program.startDate} — ${program.endDate}`
                              : "Dates TBD"}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {program.fee && (
                            <span className="text-sm font-medium">${program.fee}</span>
                          )}
                          <Badge variant="secondary" className="ml-2 text-[10px] capitalize">
                            {program.type.replace("_", " ")}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <GraduationCap className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No active programmes</p>
                  <Button variant="ghost" size="sm" className="mt-2" asChild>
                    <Link href="/programs?action=new">Create a programme</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
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
                icon={TrendingUp}
                href="/audit-log"
                testId="action-view-audit"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
