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
    <Sidebar>
      <SidebarHeader className="px-4 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="text-white font-bold text-xs tracking-tight">CU</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-[13px] text-white/90 tracking-tight truncate" data-testid="text-club-name">
              ClubOS
            </span>
            <span className="text-[11px] text-white/40 tracking-normal">Christchurch United</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-white/25 font-medium mb-1 px-2">
            Menu
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
                      className={`rounded-lg h-9 transition-all duration-200 ${
                        isActive 
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/20" 
                          : "text-white/50 border border-transparent"
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
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-white/25 font-medium mb-1 px-2">
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
                      className={`rounded-lg h-9 transition-all duration-200 ${
                        isActive 
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/20" 
                          : "text-white/50 border border-transparent"
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
      <SidebarFooter className="p-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-3 px-1">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[11px] font-semibold">
              DA
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[13px] font-medium text-white/80 truncate" data-testid="text-user-name">Daniel Admin</span>
            <span className="text-[11px] text-white/35">Administrator</span>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
