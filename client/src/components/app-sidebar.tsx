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
  Users,
  GraduationCap,
  DollarSign,
  Calendar,
  ClipboardCheck,
  Settings,
  Shield,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "People", url: "/contacts", icon: Users },
  { title: "Programmes", url: "/programs", icon: GraduationCap },
  { title: "Registrations", url: "/registrations", icon: ClipboardCheck },
  { title: "Fees", url: "/fees", icon: DollarSign },
  { title: "Events", url: "/events", icon: Calendar },
];

const secondaryNav = [
  { title: "Audit Log", url: "/audit-log", icon: Shield },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar className="sidebar-gradient">
      <SidebarHeader className="px-4 py-5 border-b border-blue-500/[0.08]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/25 animate-pulse-glow">
            <span className="text-white font-bold text-xs tracking-tight">CU</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-[13px] text-white/90 tracking-tight truncate" data-testid="text-club-name">
              ClubOS
            </span>
            <span className="text-[10px] text-blue-400/40 tracking-wider uppercase">Christchurch United</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[9px] uppercase tracking-[0.2em] text-blue-300/20 font-semibold mb-2 px-2">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {mainNav.map((item) => {
                const isActive = item.url === "/"
                  ? location === "/"
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
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(' ', '-')}`}>
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
              DA
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[13px] font-medium text-white/75 truncate" data-testid="text-user-name">Daniel Admin</span>
            <span className="text-[10px] text-blue-400/30">Administrator</span>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)] flex-shrink-0" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
