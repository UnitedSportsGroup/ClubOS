import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import ContactsPage from "@/pages/contacts";
import ProgramsPage from "@/pages/programs";
import RegistrationsPage from "@/pages/registrations";
import EventsPage from "@/pages/events";
import FeesPage from "@/pages/fees";
import AuditLogPage from "@/pages/audit-log";
import SettingsPage from "@/pages/settings";
import { Search, Bell } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/contacts" component={ContactsPage} />
      <Route path="/contacts/:id" component={ContactsPage} />
      <Route path="/programs" component={ProgramsPage} />
      <Route path="/programs/:id" component={ProgramsPage} />
      <Route path="/registrations" component={RegistrationsPage} />
      <Route path="/events" component={EventsPage} />
      <Route path="/fees" component={FeesPage} />
      <Route path="/audit-log" component={AuditLogPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
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
                    placeholder="Search anything..."
                    className="pl-9 h-9 text-[13px] premium-input text-white/80 rounded-xl"
                    data-testid="input-global-search"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="text-white/30 hover:text-white/50 relative transition-colors duration-300 rounded-xl">
                    <Bell className="w-4 h-4" />
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(3,86,197,0.5)]" />
                  </Button>
                </div>
              </header>
              <main className="flex-1 overflow-auto gradient-mesh">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
