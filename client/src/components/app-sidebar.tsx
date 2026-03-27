import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Tent,
  ClipboardCheck,
  Users,
  Mail,
  Settings,
  LogOut,
  ChevronDown,
  Check,
  Building2,
  Calendar,
  BarChart3,
  Shield,
  Puzzle,
  CreditCard,
  Trophy,
  UsersRound,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWorkspace } from "@/lib/workspace-context";

type Org = {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  active: boolean;
  userRole: string;
};

const campsNav = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Camps", url: "/admin/camps", icon: Tent },
  { title: "Registrations", url: "/admin/registrations", icon: ClipboardCheck },
  { title: "Contacts", url: "/admin/contacts", icon: Users },
  { title: "Mailer", url: "/admin/mailer", icon: Mail },
];

const venueNav = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Bookings Calendar", url: "/admin/calendar", icon: Calendar },
  { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
  { title: "Facilities", url: "/admin/facilities", icon: Shield },
  { title: "Add-ons", url: "/admin/addons", icon: Puzzle },
  { title: "People & Access", url: "/admin/people", icon: Users },
  { title: "Payments", url: "/admin/payments", icon: CreditCard },
];

const campsSecondary = [
  { title: "Settings", url: "/admin/settings", icon: Settings },
];

const leagueNav = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Competitions", url: "/admin/competitions", icon: Trophy },
  { title: "Teams", url: "/admin/teams", icon: UsersRound },
];

const venueSecondary = [
  { title: "Settings", url: "/admin/venue-settings", icon: Settings },
];

const leagueSecondary = [
  { title: "Settings", url: "/admin/league-settings", icon: Settings },
];

function WorkspaceSwitcher() {
  const { currentOrg, setCurrentOrg, organizations, setOrganizations } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { data: user } = useQuery<{ organizations?: Org[] }>({ queryKey: ["/api/auth/me"] });

  useEffect(() => {
    if (user?.organizations && user.organizations.length > 0) {
      setOrganizations(user.organizations);
    }
  }, [user?.organizations, setOrganizations]);

  if (!currentOrg || organizations.length === 0) return null;

  const handleSwitch = (org: Org) => {
    setCurrentOrg(org);
    setOpen(false);
    setLocation("/admin");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-all cursor-pointer group"
        data-testid="button-workspace-switcher"
      >
        <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
          {currentOrg.logoUrl ? (
            <img src={currentOrg.logoUrl} alt={currentOrg.name} className="w-full h-full object-cover" />
          ) : (
            <Building2 className="w-4 h-4 text-white/30" />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[12px] font-medium text-white/80 truncate" data-testid="text-workspace-name">{currentOrg.name}</p>
          <p className="text-[9px] text-blue-400/30 uppercase tracking-wider">Workspace</p>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-white/20 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-2 right-2 top-full mt-1 z-50 rounded-xl border border-blue-500/15 bg-[#0a0e1a] shadow-2xl shadow-black/50 overflow-hidden" data-testid="dropdown-workspace">
            <div className="px-3 py-2 border-b border-white/[0.04]">
              <p className="text-[9px] text-blue-300/25 uppercase tracking-wider font-semibold">Switch Workspace</p>
            </div>
            <div className="py-1 max-h-[280px] overflow-y-auto">
              {organizations.map(org => (
                <button
                  key={org.id}
                  onClick={() => handleSwitch(org)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all cursor-pointer ${
                    currentOrg.id === org.id ? "bg-blue-500/10" : "hover:bg-white/[0.03]"
                  }`}
                  data-testid={`button-workspace-${org.slug}`}
                >
                  <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 bg-white/[0.06] border border-white/[0.06] flex items-center justify-center">
                    {org.logoUrl ? (
                      <img src={org.logoUrl} alt={org.name} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="w-3.5 h-3.5 text-white/25" />
                    )}
                  </div>
                  <span className={`flex-1 text-left text-[12px] truncate ${
                    currentOrg.id === org.id ? "text-blue-400 font-medium" : "text-white/60"
                  }`}>{org.name}</span>
                  {currentOrg.id === org.id && (
                    <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function isVenueWorkspace(slug: string | undefined) {
  return slug === "united-sports-centre";
}

function isLeagueWorkspace(slug: string | undefined) {
  return slug === "mini-football-leagues";
}

function getWorkspaceLabel(slug: string | undefined) {
  if (isVenueWorkspace(slug)) return "Venue";
  if (isLeagueWorkspace(slug)) return "Leagues";
  return "Management";
}

function getWorkspaceInitials(slug: string | undefined) {
  if (isVenueWorkspace(slug)) return "US";
  if (isLeagueWorkspace(slug)) return "ML";
  return "CU";
}

export function AppSidebar() {
  const [location] = useLocation();
  const { currentOrg } = useWorkspace();
  const { data: user } = useQuery<{ firstName: string; lastName: string; role: string }>({ queryKey: ["/api/auth/me"] });

  const isVenue = isVenueWorkspace(currentOrg?.slug);
  const isLeague = isLeagueWorkspace(currentOrg?.slug);
  const mainNav = isLeague ? leagueNav : isVenue ? venueNav : campsNav;
  const secondaryNav = isLeague ? leagueSecondary : isVenue ? venueSecondary : campsSecondary;

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/admin/login";
    },
  });

  return (
    <Sidebar className="sidebar-gradient">
      <SidebarHeader className="px-3 py-4 border-b border-blue-500/[0.08] space-y-3">
        <div className="flex items-center gap-3 px-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/25 animate-pulse-glow">
            <span className="text-white font-bold text-xs tracking-tight">{getWorkspaceInitials(currentOrg?.slug)}</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-[13px] text-white/90 tracking-tight truncate" data-testid="text-club-name">
              ClubOS
            </span>
            <span className="text-[10px] text-blue-400/40 tracking-wider uppercase">{getWorkspaceLabel(currentOrg?.slug)}</span>
          </div>
        </div>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[9px] uppercase tracking-[0.2em] text-blue-300/20 font-semibold mb-2 px-2">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {mainNav.map((item) => {
                const isActive = item.url === "/admin"
                  ? location === "/admin"
                  : location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive}
                      className={`rounded-xl h-9 transition-all duration-300 ${
                        isActive
                          ? "bg-gradient-to-r from-blue-500/15 to-blue-500/5 text-blue-400 border border-blue-500/25 shadow-[0_0_12px_rgba(3,86,197,0.1)]"
                          : "text-white/40 border border-transparent hover:text-white/60 hover:bg-white/[0.03]"
                      }`}
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/[\s&]/g, '-')}`}>
                        <item.icon className="w-4 h-4" />
                        <span className="text-[13px] font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="text-[9px] uppercase tracking-[0.2em] text-blue-300/20 font-semibold mb-2 px-2">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {secondaryNav.map((item) => {
                const isActive = location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive}
                      className={`rounded-xl h-9 transition-all duration-300 ${
                        isActive
                          ? "bg-gradient-to-r from-blue-500/15 to-blue-500/5 text-blue-400 border border-blue-500/25 shadow-[0_0_12px_rgba(3,86,197,0.1)]"
                          : "text-white/40 border border-transparent hover:text-white/60 hover:bg-white/[0.03]"
                      }`}
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4" />
                        <span className="text-[13px] font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 border-t border-blue-500/[0.08]">
        <div className="flex items-center gap-3 px-1">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-700 text-white text-[11px] font-semibold shadow-lg shadow-blue-500/20">
              {user ? `${user.firstName[0]}${user.lastName[0]}` : "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[13px] font-medium text-white/75 truncate" data-testid="text-user-name">
              {user ? `${user.firstName} ${user.lastName}` : "..."}
            </span>
            <span className="text-[10px] text-blue-400/30 capitalize">{user?.role?.replace(/_/g, " ") || ""}</span>
          </div>
          <button
            onClick={() => logoutMutation.mutate()}
            className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/20 transition-all cursor-pointer"
            data-testid="button-logout"
            title="Logout"
          >
            <LogOut className="w-3.5 h-3.5 text-white/30" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
