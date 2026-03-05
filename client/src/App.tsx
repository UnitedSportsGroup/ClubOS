import { Switch, Route, useRoute, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import AdminLogin from "@/pages/admin-login";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminCamps from "@/pages/admin-camps";
import AdminCampDetail from "@/pages/admin-camp-detail";
import AdminRegistrations from "@/pages/admin-registrations";
import AdminAttendance from "@/pages/admin-attendance";
import AdminCRM from "@/pages/admin-crm";
import AdminSettings from "@/pages/admin-settings";
import PublicLanding from "@/pages/public-landing";
import CampPage from "@/pages/camp-page";
import BookingPage from "@/pages/booking-page";
import BookingSuccess from "@/pages/booking-success";
import BookingCancel from "@/pages/booking-cancel";
import { Search, Bell } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center" style={{ background: '#02060E' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/25 animate-pulse">
            <span className="text-white font-bold text-sm">CU</span>
          </div>
          <Skeleton className="h-4 w-24 bg-blue-500/10" />
        </div>
      </div>
    );
  }

  if (!user || error) {
    return <Redirect to="/admin/login" />;
  }

  return <>{children}</>;
}

function AdminRouter() {
  return (
    <Switch>
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/camps" component={AdminCamps} />
      <Route path="/admin/camps/:id" component={AdminCampDetail} />
      <Route path="/admin/registrations" component={AdminRegistrations} />
      <Route path="/admin/attendance" component={AdminAttendance} />
      <Route path="/admin/crm" component={AdminCRM} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminLayout() {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <AuthGuard>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full" style={{ background: '#02060E' }}>
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center justify-between gap-4 px-6 h-14 border-b border-blue-500/[0.06] flex-shrink-0 backdrop-blur-2xl" style={{ background: 'rgba(2,6,14,0.7)' }}>
              <div className="flex items-center gap-3">
                <SidebarTrigger data-testid="button-sidebar-toggle" className="text-white/30 hover:text-white/50 transition-colors duration-300" />
              </div>
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400/30" />
                <Input
                  placeholder="Search..."
                  className="pl-9 h-9 text-[13px] premium-input text-white/80 rounded-xl"
                  data-testid="input-global-search"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="text-white/30 hover:text-white/50 relative transition-colors duration-300 rounded-xl">
                  <Bell className="w-4 h-4" />
                </Button>
              </div>
            </header>
            <main className="flex-1 overflow-auto gradient-mesh">
              <AdminRouter />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </AuthGuard>
  );
}

function App() {
  const [isPublicLanding] = useRoute("/");
  const [isCampSlug] = useRoute("/:slug");
  const [isCampBook] = useRoute("/:slug/book");
  const [isCampSuccess] = useRoute("/:slug/success");
  const [isCampCancel] = useRoute("/:slug/cancel");
  const [isAdminLogin] = useRoute("/admin/login");
  const [isAdmin] = useRoute("/admin/:rest*");
  const [isAdminRoot] = useRoute("/admin");

  const isAdminRoute = isAdmin || isAdminRoot;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isAdminLogin ? (
          <AdminLogin />
        ) : isAdminRoute ? (
          <AdminLayout />
        ) : (
          <Switch>
            <Route path="/" component={PublicLanding} />
            <Route path="/:slug/book" component={BookingPage} />
            <Route path="/:slug/success" component={BookingSuccess} />
            <Route path="/:slug/cancel" component={BookingCancel} />
            <Route path="/:slug" component={CampPage} />
            <Route component={NotFound} />
          </Switch>
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
