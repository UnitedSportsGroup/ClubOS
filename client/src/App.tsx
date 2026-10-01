import { lazy, Suspense } from "react";
import { Switch, Route, useRoute, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmHost } from "@/components/confirm-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import AdminLogin from "@/pages/admin-login";
import { Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace-context";
import { CommandPalette } from "@/components/command-palette";
import { ViewAsBar } from "@/components/view-as-bar";
import { AccountMenu } from "@/components/account-menu";

/* ── Every page is its own download (2026-09-30). ClubOS shipped ONE 2.2 MB
   (compressed) JavaScript file holding all 232 pages, so every staff member
   downloaded and unpacked the whole app before seeing a single screen — and
   again after every deploy. Now the shell loads first and a page loads when it
   is opened. The sign-in screen and the 404 stay in the main file. A page
   still loading shows the loading state INSIDE the layout (AdminLayout), so
   the sidebar and header never blank. ── */
const RsvpPage = lazy(() => import("@/pages/rsvp"));
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const AdminDashboard = lazy(() => import("@/pages/admin-dashboard"));
const AdminCamps = lazy(() => import("@/pages/admin-camps"));
const AdminCampDetail = lazy(() => import("@/pages/admin-camp-detail"));
const AdminSessionRoll = lazy(() => import("@/pages/admin-session-roll"));
const AdminRegistrations = lazy(() => import("@/pages/admin-registrations"));
const AdminContacts = lazy(() => import("@/pages/admin-contacts"));
const AdminPersonDetail = lazy(() => import("@/pages/admin-person-detail"));
const AdminMailer = lazy(() => import("@/pages/admin-mailer"));
const AdminMailerHistory = lazy(() => import("@/pages/admin-mailer-history"));
const Predictor = lazy(() => import("@/pages/predictor"));
const FootballInstitute = lazy(() => import("@/pages/football-institute"));
const AdminSettings = lazy(() => import("@/pages/admin-settings"));
const AdminEditPage = lazy(() => import("@/pages/admin-edit-page"));
const CampPage = lazy(() => import("@/pages/camp-page"));
const MembershipPage = lazy(() => import("@/pages/membership-page"));
const TermsPage = lazy(() => import("@/pages/terms"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const BookingPage = lazy(() => import("@/pages/booking-page"));
const ClassBookingPage = lazy(() => import("@/pages/class-booking-page"));
const AcademyRegisterPage = lazy(() => import("@/pages/academy-register-page"));
const BookingSuccess = lazy(() => import("@/pages/booking-success"));
const AttributionSurvey = lazy(() => import("@/pages/attribution-survey"));
const BookingCancel = lazy(() => import("@/pages/booking-cancel"));
const CheckoutPage = lazy(() => import("@/pages/checkout-page"));
const MflLandingPage = lazy(() => import("@/pages/mfl-landing-page"));
const MflRegisterPage = lazy(() => import("@/pages/mfl-register-page"));
const MflWaitlistPage = lazy(() => import("@/pages/mfl-waitlist-page"));
const MflCheckoutPage = lazy(() => import("@/pages/mfl-checkout-page"));
const MflSuccessPage = lazy(() => import("@/pages/mfl-success-page"));
const MflSplitPage = lazy(() => import("@/pages/mfl-split-page"));
const MflLegalPage = lazy(() => import("@/pages/mfl-legal-page"));
const VenueDashboard = lazy(() => import("@/pages/venue-dashboard"));
const VenueCalendar = lazy(() => import("@/pages/venue-calendar"));
const VenueBookings = lazy(() => import("@/pages/venue-bookings"));
const VenueAnalytics = lazy(() => import("@/pages/venue-analytics"));
const CampAnalytics = lazy(() => import("@/pages/camp-analytics"));
const AdminDiscounts = lazy(() => import("@/pages/admin-discounts"));
const AdminDiscountDetail = lazy(() => import("@/pages/admin-discount-detail"));
const AdminDomainSettings = lazy(() => import("@/pages/admin-domain-settings"));
const AdminTeam = lazy(() => import("@/pages/admin-team"));
const GroupDashboard = lazy(() => import("@/pages/group-dashboard"));
const GroupCalendar = lazy(() => import("@/pages/group-calendar"));
const GroupSponsorship = lazy(() => import("@/pages/group-sponsorship"));
const GroupProposals = lazy(() => import("@/pages/group-proposals"));
const GroupGrants = lazy(() => import("@/pages/group-grants"));
const GroupInvoices = lazy(() => import("@/pages/invoices"));
const GroupXeroInvoices = lazy(() => import("@/pages/xero-invoices"));
const GroupPayouts = lazy(() => import("@/pages/payouts"));
const AdminLicensing = lazy(() => import("@/pages/admin-licensing"));
const AdminEvents = lazy(() => import("@/pages/admin-events"));
const AdminMembership = lazy(() => import("@/pages/admin-membership"));
const AdminDeclarations = lazy(() => import("@/pages/admin-declarations"));
const GroupProjects = lazy(() => import("@/pages/group-projects"));
const GroupContent = lazy(() => import("@/pages/group-content"));
const GroupHiring = lazy(() => import("@/pages/group-hiring"));
const GroupVehicles = lazy(() => import("@/pages/group-vehicles"));
const GroupEquipment = lazy(() => import("@/pages/group-equipment"));
const GroupFines = lazy(() => import("@/pages/group-fines"));
const PosRegister = lazy(() => import("@/pages/pos-register"));
const PosReceipt = lazy(() => import("@/pages/pos-receipt"));
const CodingBudget = lazy(() => import("@/pages/coding-budget"));
const EquipmentHolder = lazy(() => import("@/pages/equipment-holder"));
const GroupSponsors = lazy(() => import("@/pages/group-sponsors"));
const MarketingHub = lazy(() => import("@/pages/marketing-hub"));
const FinanceInsight = lazy(() => import("@/pages/finance-insight"));
const GroupVideos = lazy(() => import("@/pages/group-videos"));
const GroupVideoRecord = lazy(() => import("@/pages/group-video-record"));
const GroupVideoDetail = lazy(() => import("@/pages/group-video-detail"));
const VideoShare = lazy(() => import("@/pages/video-share"));
const GroupBudget = lazy(() => import("@/pages/group-budget"));
const GroupBudgetXero = lazy(() => import("@/pages/group-budget-xero"));
const GroupBudgetCostCentre = lazy(() => import("@/pages/group-budget-cost-centre"));
const GroupCashflow = lazy(() => import("@/pages/group-cashflow"));
const AdminAcademy = lazy(() => import("@/pages/admin-academy"));
const AdminSquads = lazy(() => import("@/pages/admin-squads"));
const AdminFisPipeline = lazy(() => import("@/pages/admin-fis-pipeline"));
const LinksPage = lazy(() => import("@/pages/links"));
const AttributionPage = lazy(() => import("@/pages/attribution"));
const BehaviorPage = lazy(() => import("@/pages/behavior"));
const VenueFacilities = lazy(() => import("@/pages/venue-facilities"));
const VenueAddons = lazy(() => import("@/pages/venue-addons"));
const VenueHousing = lazy(() => import("@/pages/venue-housing"));
const VenueMaintenance = lazy(() => import("@/pages/venue-maintenance"));
const EnergyPage = lazy(() => import("@/pages/energy"));
const VenuePeople = lazy(() => import("@/pages/venue-people"));
const VenuePayments = lazy(() => import("@/pages/venue-payments"));
const VenueSettings = lazy(() => import("@/pages/venue-settings"));
const VenueWebsite = lazy(() => import("@/pages/venue-website"));
const VenueBookPage = lazy(() => import("@/pages/venue-book"));
const VenueSplitPage = lazy(() => import("@/pages/venue-split-page"));
const VenuePaySharePage = lazy(() => import("@/pages/venue-payshare-pay"));
const VenueBookSuccess = lazy(() => import("@/pages/venue-book-success"));
const MemberBookingPage = lazy(() => import("@/pages/member-booking"));
const VenueBookingRequests = lazy(() => import("@/pages/venue-booking-requests"));
const LeagueDashboard = lazy(() => import("@/pages/league-dashboard"));
const LeagueCompetitions = lazy(() => import("@/pages/league-competitions"));
const LeagueCompetitionDetail = lazy(() => import("@/pages/league-competition-detail"));
const LeagueDetail = lazy(() => import("@/pages/league-competition-detail").then((m) => ({ default: m.LeagueDetail })));
const LeagueTeams = lazy(() => import("@/pages/league-teams"));
const LeaguePayments = lazy(() => import("@/pages/league-payments"));
const LeagueMailer = lazy(() => import("@/pages/league-mailer"));
const LeagueRewards = lazy(() => import("@/pages/league-rewards"));
const LeagueLoyalty = lazy(() => import("@/pages/league-loyalty"));
const FmHistory = lazy(() => import("@/pages/fm-history"));
const FmCompetitions = lazy(() => import("@/pages/fm-competitions"));
const CufcOpenTrainings = lazy(() => import("@/pages/cufc-open-trainings"));
const ClubEventsAdmin = lazy(() => import("@/pages/club-events"));
const ClubEventDetailAdmin = lazy(() => import("@/pages/club-event-detail"));
const ClubEventPage = lazy(() => import("@/pages/events/event-page"));
const ClubEventOrderPage = lazy(() => import("@/pages/events/order-page"));
const SportySync = lazy(() => import("@/pages/sporty-sync"));
const LeagueAnalytics = lazy(() => import("@/pages/league-analytics"));
const LeagueInbox = lazy(() => import("@/pages/league-inbox"));
const LeagueBusinessPlan = lazy(() => import("@/pages/league-business-plan"));
const LeagueStore = lazy(() => import("@/pages/league-store"));
const CicInbox = lazy(() => import("@/pages/cic-inbox"));
const CicLiveChat = lazy(() => import("@/pages/cic-livechat"));
const MflLiveChat = lazy(() => import("@/pages/mfl-livechat"));
const TaskBoard = lazy(() => import("@/pages/task-board"));
const CugcLiveChat = lazy(() => import("@/pages/cugc-livechat"));
const PrintLiveChat = lazy(() => import("@/pages/print-livechat"));
const PrintsRequests = lazy(() => import("@/pages/prints-requests"));
const PrintsFaqs = lazy(() => import("@/pages/prints-faqs"));
const PrintsExpenses = lazy(() => import("@/pages/prints-expenses"));
const CicLogoConsents = lazy(() => import("@/pages/cic-logo-consents"));
const MediaLibrary = lazy(() => import("@/pages/media-library"));
const CicMailer = lazy(() => import("@/pages/cic-mailer"));
const CicPush = lazy(() => import("@/pages/cic-push"));
const CicWatch = lazy(() => import("@/pages/cic-watch"));
const ContentMarketplace = lazy(() => import("@/pages/content-marketplace"));
const CicReferees = lazy(() => import("@/pages/cic-referees"));
const CicScoreGame = lazy(() => import("@/pages/cic-score-game"));
const RefHome = lazy(() => import("@/pages/ref/RefHome"));
const RefSignup = lazy(() => import("@/pages/ref/RefSignup"));
const RefGameDetail = lazy(() => import("@/pages/ref/RefGameDetail"));
const MflReferees = lazy(() => import("@/pages/mfl-referees"));
const MflGameFeedPage = lazy(() => import("@/pages/mfl-game-feed"));
const MflScoreGame = lazy(() => import("@/pages/mfl-score-game"));
const MflMedia = lazy(() => import("@/pages/mfl-media"));
const MflRefHome = lazy(() => import("@/pages/mfl-ref/MflRefHome"));
const MflRefSignup = lazy(() => import("@/pages/mfl-ref/MflRefSignup"));
const MflRefGameDetail = lazy(() => import("@/pages/mfl-ref/MflRefGameDetail"));
const CugcInbox = lazy(() => import("@/pages/cugc-inbox"));
const CugcRegistrations = lazy(() => import("@/pages/cugc-registrations"));
const CugcFreeSessions = lazy(() => import("@/pages/cugc-free-sessions"));
const CugcRoll = lazy(() => import("@/pages/cugc-roll"));
const CugcAnalytics = lazy(() => import("@/pages/cugc-analytics"));
const CugcMailer = lazy(() => import("@/pages/cugc-mailer"));
const LeagueBuilderPage = lazy(() => import("@/pages/league-builder-page"));
const LeagueSettings = lazy(() => import("@/pages/league-settings"));
const GymnasticsDashboard = lazy(() => import("@/pages/gymnastics-dashboard"));
const CugcPrograms = lazy(() => import("@/pages/cugc-programs"));
const GymnasticsTerms = lazy(() => import("@/pages/gymnastics-terms"));
const TournamentDashboard = lazy(() => import("@/pages/tournament-dashboard"));
const TournamentList = lazy(() => import("@/pages/tournament-list"));
const ClubsList = lazy(() => import("@/pages/clubs-list"));
const ClubDetail = lazy(() => import("@/pages/club-detail"));
const TournamentDetail = lazy(() => import("@/pages/tournament-detail"));
const TournamentTeamDetail = lazy(() => import("@/pages/tournament-team-detail"));
const TournamentSkillsChallenge = lazy(() => import("@/pages/tournament-skills-challenge"));
const TournamentFoodTruck = lazy(() => import("@/pages/tournament-food-truck"));
const TournamentVendors = lazy(() => import("@/pages/tournament-vendors"));
const Volunteers = lazy(() => import("@/pages/volunteers"));
const ESign = lazy(() => import("@/pages/esign"));
const SignPage = lazy(() => import("@/pages/sign"));
const SignDeclaration = lazy(() => import("@/pages/sign-declaration"));
const StudioPublicPage = lazy(() => import("@/pages/studio-public"));
const StudioPreviewPage = lazy(() => import("@/pages/studio-preview"));
const StudioHome = lazy(() => import("@/pages/studio/StudioHome"));
const StudioNew = lazy(() => import("@/pages/studio/StudioNew"));
const StudioEditor = lazy(() => import("@/pages/studio/StudioEditor"));
const StudioAnalytics = lazy(() => import("@/pages/studio/StudioAnalytics"));
const Cic7sRegistrations = lazy(() => import("@/pages/cic7s-registrations"));
const EthnicCupRegistrations = lazy(() => import("@/pages/ethnic-cup-registrations"));
const FootballFest = lazy(() => import("@/pages/football-fest"));
const TeamEntries = lazy(() => import("@/pages/team-entries"));
const TeampayEnterPage = lazy(() => import("@/pages/teampay/enter"));
const TeampayDashboard = lazy(() => import("@/pages/teampay/dashboard"));
const TeampayPlayerPage = lazy(() => import("@/pages/teampay/player"));
const TeampayFillinPage = lazy(() => import("@/pages/teampay/fillin"));
const TeampayHoldPage = lazy(() => import("@/pages/teampay/fillin").then((m) => ({ default: m.TeampayHoldPage })));
const CaptainSignInPage = lazy(() => import("@/pages/teampay/captain").then((m) => ({ default: m.CaptainSignInPage })));
const CaptainSetPasswordPage = lazy(() => import("@/pages/teampay/captain").then((m) => ({ default: m.CaptainSetPasswordPage })));
const CaptainTeamsPage = lazy(() => import("@/pages/teampay/captain").then((m) => ({ default: m.CaptainTeamsPage })));
const CaptainTeamPage = lazy(() => import("@/pages/teampay/captain").then((m) => ({ default: m.CaptainTeamPage })));
const LeagueTeamPage = lazy(() => import("@/pages/teampay/league-team"));
const CicSkillsLandingPage = lazy(() => import("@/pages/cic-skills-landing"));
const PrintsDashboard = lazy(() => import("@/pages/prints-dashboard"));
const PrintsCRM = lazy(() => import("@/pages/prints-crm"));
const PrintsSales = lazy(() => import("@/pages/prints-sales"));
const PrintsOrders = lazy(() => import("@/pages/prints-orders"));
const PrintsProjects = lazy(() => import("@/pages/prints-projects"));
const PrintsManagement = lazy(() => import("@/pages/prints-management"));
const PrintsAnalytics = lazy(() => import("@/pages/prints-analytics"));
const PrintsLanding = lazy(() => import("@/pages/prints-landing"));
const PrintsEmail = lazy(() => import("@/pages/prints-email"));
const PrintsJobs = lazy(() => import("@/pages/prints-jobs"));
const PrintsQuotes = lazy(() => import("@/pages/prints-quotes"));
const PrintsOrderDetail = lazy(() => import("@/pages/prints-order-detail"));
const PrintsMaterials = lazy(() => import("@/pages/prints-materials"));
const PrintsIntegrations = lazy(() => import("@/pages/prints-integrations"));
const WarehouseDashboard = lazy(() => import("@/pages/warehouse-dashboard"));
const WarehouseItems = lazy(() => import("@/pages/warehouse-items"));
const WarehouseLocations = lazy(() => import("@/pages/warehouse-locations"));
const WarehousePOs = lazy(() => import("@/pages/warehouse-pos"));
const WarehouseRequisitions = lazy(() => import("@/pages/warehouse-requisitions"));
const WarehouseLoans = lazy(() => import("@/pages/warehouse-loans"));
const WarehouseCounts = lazy(() => import("@/pages/warehouse-counts"));
const WarehouseSync = lazy(() => import("@/pages/warehouse-sync"));
const WarehouseLedger = lazy(() => import("@/pages/warehouse-ledger"));
const WarehouseScan = lazy(() => import("@/pages/warehouse-scan"));
const WarehouseLabels = lazy(() => import("@/pages/warehouse-labels"));
const WarehouseAssets = lazy(() => import("@/pages/warehouse-assets"));
const WarehouseFieldTemplates = lazy(() => import("@/pages/warehouse-field-templates"));
const WarehouseStockTake = lazy(() => import("@/pages/warehouse-stock-take"));
const WarehouseUniformStocktake = lazy(() => import("@/pages/warehouse-uniform-stocktake"));
const PrintHub = lazy(() => import("@/pages/print-hub"));
const PrintAccountPage = lazy(() => import("@/pages/print-account"));
const PrintDtfPage = lazy(() => import("@/pages/print-dtf"));
const PrintStudioPage = lazy(() => import("@/pages/print-studio"));
const PrintArtworkPage = lazy(() => import("@/pages/print-artwork"));
const PrintConfigure = lazy(() => import("@/pages/print-configure"));
const PrintCheckout = lazy(() => import("@/pages/print-checkout"));
const PrintOrderStatus = lazy(() => import("@/pages/print-order-status"));
const PrintUpload = lazy(() => import("@/pages/print-upload"));
const ClubDossier = lazy(() => import("@/pages/club-dossier"));
const MarketResearch = lazy(() => import("@/pages/market-research"));
const Feedback = lazy(() => import("@/pages/feedback"));
const TaskTracker = lazy(() => import("@/pages/task-tracker"));
const KnowledgeBase = lazy(() => import("@/pages/knowledge-base"));
const Drive = lazy(() => import("@/pages/drive"));
const StaffChat = lazy(() => import("@/pages/staff-chat"));
const NotificationSettings = lazy(() => import("@/pages/notification-settings"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const MarketingHome = lazy(() => import("@/pages/marketing/Home"));
const MarketingCampaignWizard = lazy(() => import("@/pages/marketing/CampaignWizard"));
const MarketingCampaignDetail = lazy(() => import("@/pages/marketing/CampaignDetail"));
const MarketingFlowEditor = lazy(() => import("@/pages/marketing/FlowEditor"));

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center" style={{ background: "hsl(var(--background))" }}>
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
  const { currentOrg } = useWorkspace();
  const [location] = useLocation();
  // Feedback (bug reports / feature requests) is a UNIVERSAL tab — any staff
  // member, in whatever workspace they have, can reach it. Handle it before the
  // per-workspace switches so it works everywhere from one place.
  if (location.startsWith("/admin/feedback")) return <Feedback />;
  // Staff Chat (the in-house Slack) is universal for the same reason — one
  // staff-wide chat, reachable from every workspace's System section.
  if (location.startsWith("/admin/chat")) return <StaffChat />;
  // Notification settings belong to the PERSON, not the workspace — same
  // universal pattern again, gated server-side by requireAuth only.
  if (location.startsWith("/admin/notification-settings")) return <NotificationSettings />;
  // Your profile — the person's own name and photo. Universal for exactly the
  // same reason, and reached from the account menu in the top-right rather
  // than the sidebar. Was a modal until 2026-09-02.
  if (location.startsWith("/admin/profile")) return <ProfilePage />;
  // Task Tracker — one organisation-wide project/task system, deliberately
  // not workspace-scoped, so it is reachable from every workspace too.
  if (location.startsWith("/admin/task-tracker")) return <TaskTracker />;
  // Knowledge Base — one club-wide vault plus Rambo. Universal for the same
  // reason: the knowledge is the organisation's, not a workspace's, and brand
  // is a filter inside the tab.
  if (location.startsWith("/admin/knowledge-base")) return <KnowledgeBase />;
  // Club Drive — one file store for the whole organisation. Universal for the
  // same reason as the vault above: a contract is the club's document whichever
  // workspace you happen to be standing in when you need it.
  if (location.startsWith("/admin/drive")) return <Drive />;
  // QR Code Generator — tracked links + QR posters for every business in one
  // place. Universal because a poster is made for a BUSINESS you pick in the
  // form, not for the workspace you happened to be standing in; the old
  // per-workspace /admin/links path still resolves here for old bookmarks.
  if (location.startsWith("/admin/qr-codes") || location.startsWith("/admin/links")) return <LinksPage />;
  // POS — one register selling every brand from one counter, reached from
  // every workspace's System section (Daniel, 2026-09-21). Gated server-side
  // by the person's POS grant in ANY workspace (requireTabAnywhere), so the
  // page is the same page whichever workspace you opened it from.
  if (location.startsWith("/admin/pos")) return <PosRegister />;
  const isVenue = currentOrg?.slug === "united-sports-centre";
  const isLeague = currentOrg?.slug === "mini-football-leagues";
  const isTournament = currentOrg?.slug === "christchurch-international-cup";
  const isGymnastics = currentOrg?.slug === "united-gymnastics";
  const isGroup = currentOrg?.slug === "united-sports-group";
  const isPrints = currentOrg?.slug === "united-prints";
  const isSandbox = currentOrg?.slug === "sandbox";

  if (isSandbox) {
    return (
      <Switch>
        <Route path="/admin"><Redirect to="/admin/club-dossier" /></Route>
        <Route path="/admin/club-dossier" component={ClubDossier} />
        <Route path="/admin/market-research" component={MarketResearch} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (isPrints) {
    return (
      <Switch>
        <Route path="/admin" component={PrintsDashboard} />
        <Route path="/admin/print-management" component={PrintsManagement} />
        <Route path="/admin/print-jobs" component={PrintsJobs} />
        {/* Internal print requests. In the isPrints Switch, deliberately — a
            tabs.ts entry alone 404s, which is exactly what Live Chat did. */}
        <Route path="/admin/print-requests" component={PrintsRequests} />
        <Route path="/admin/print-quotes" component={PrintsQuotes} />
        <Route path="/admin/print-faqs" component={PrintsFaqs} />
        <Route path="/admin/print-expenses" component={PrintsExpenses} />
        <Route path="/admin/print-orders/:id" component={PrintsOrderDetail} />
        <Route path="/admin/print-orders" component={PrintsOrders} />
        <Route path="/admin/print-materials" component={PrintsMaterials} />
        {/* The visitor live-chat inbox for unitedprints.co.nz. 🔴 This route was
            only ever listed in the CIC tournament Switch below, so the Live Chat
            tab in THIS workspace fell through to NotFound and 404'd from the day
            it shipped. The United Prints workspace has its own Switch — a
            shared/tabs.ts entry alone is never enough. */}
        <Route path="/admin/print-livechat" component={PrintLiveChat} />
        <Route path="/admin/print-crm" component={PrintsCRM} />
        <Route path="/admin/print-sales" component={PrintsSales} />
        <Route path="/admin/print-projects" component={PrintsProjects} />
        <Route path="/admin/print-analytics" component={PrintsAnalytics} />
        <Route path="/admin/print-landing" component={PrintsLanding} />
        <Route path="/admin/print-email" component={PrintsEmail} />
        <Route path="/admin/integrations" component={PrintsIntegrations} />
        <Route path="/admin/warehouse" component={WarehouseDashboard} />
        <Route path="/admin/warehouse/items" component={WarehouseItems} />
        <Route path="/admin/warehouse/locations" component={WarehouseLocations} />
        <Route path="/admin/warehouse/assets" component={WarehouseAssets} />
        <Route path="/admin/warehouse/fields" component={WarehouseFieldTemplates} />
        <Route path="/admin/warehouse/stock-take-classic" component={WarehouseStockTake} />
        <Route path="/admin/warehouse/stock-take" component={WarehouseUniformStocktake} />
        <Route path="/admin/warehouse/pos" component={WarehousePOs} />
        <Route path="/admin/warehouse/requisitions" component={WarehouseRequisitions} />
        <Route path="/admin/warehouse/loans" component={WarehouseLoans} />
        <Route path="/admin/warehouse/counts" component={WarehouseCounts} />
        <Route path="/admin/warehouse/sync" component={WarehouseSync} />
        <Route path="/admin/warehouse/ledger" component={WarehouseLedger} />
        <Route path="/admin/warehouse/scan" component={WarehouseScan} />
        <Route path="/admin/warehouse/labels" component={WarehouseLabels} />
        <Route path="/admin/marketing/campaigns/new" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id/edit" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id" component={MarketingCampaignDetail} />
        <Route path="/admin/marketing/flows/:id" component={MarketingFlowEditor} />
        <Route path="/admin/marketing" component={MarketingHome} />
        <Route path="/admin/studio/new" component={StudioNew} />
        <Route path="/admin/studio/:id/signal" component={StudioAnalytics} />
        <Route path="/admin/studio/:id" component={StudioEditor} />
        <Route path="/admin/studio" component={StudioHome} />
        <Route path="/admin/esign" component={ESign} />
        <Route path="/admin/domains" component={AdminDomainSettings} />
        <Route path="/admin/settings" component={AdminSettings} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/links" component={LinksPage} />
        <Route path="/admin/attribution" component={AttributionPage} />
        <Route path="/admin/behavior" component={BehaviorPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (isGroup) {
    return (
      <Switch>
        <Route path="/admin" component={GroupDashboard} />
        <Route path="/admin/calendar" component={GroupCalendar} />
        <Route path="/admin/projects" component={GroupProjects} />
        <Route path="/admin/content" component={GroupContent} />
        <Route path="/admin/hiring" component={GroupHiring} />
        <Route path="/admin/sponsorship" component={GroupSponsorship} />
        <Route path="/admin/proposals" component={GroupProposals} />
        <Route path="/admin/football-in-schools" component={AdminFisPipeline} />
        <Route path="/admin/grants" component={GroupGrants} />
        <Route path="/admin/invoices" component={GroupInvoices} />
        <Route path="/admin/xero-invoices" component={GroupXeroInvoices} />
        <Route path="/admin/payouts" component={GroupPayouts} />
        <Route path="/admin/budget/cost-centres/:slug" component={GroupBudgetCostCentre} />
        <Route path="/admin/budget/xero" component={GroupBudgetXero} />
        <Route path="/admin/budget" component={GroupBudget} />
        <Route path="/admin/coding-budget" component={CodingBudget} />
        <Route path="/admin/cashflow" component={GroupCashflow} />
        <Route path="/admin/vehicles" component={GroupVehicles} />
        <Route path="/admin/equipment/rounds/:id" component={GroupEquipment} />
        <Route path="/admin/equipment/:id" component={GroupEquipment} />
        <Route path="/admin/equipment" component={GroupEquipment} />
        <Route path="/admin/fines" component={GroupFines} />
        {/* Accommodation — the residency at 482A Yaldhurst Rd. `/admin/housing`
            is kept as an alias so a bookmark from the venue workspace still
            resolves instead of hitting the catch-all NotFound. */}
        <Route path="/admin/accommodation" component={VenueHousing} />
        <Route path="/admin/energy" component={EnergyPage} />
        <Route path="/admin/housing" component={VenueHousing} />
        <Route path="/admin/marketing-hub" component={MarketingHub} />
        <Route path="/admin/finance-insight" component={FinanceInsight} />
        <Route path="/admin/sponsor-traffic" component={GroupSponsors} />
        <Route path="/admin/videos/record" component={GroupVideoRecord} />
        <Route path="/admin/videos/:id" component={GroupVideoDetail} />
        <Route path="/admin/videos" component={GroupVideos} />
        <Route path="/admin/marketing/campaigns/new" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id/edit" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id" component={MarketingCampaignDetail} />
        <Route path="/admin/marketing/flows/:id" component={MarketingFlowEditor} />
        <Route path="/admin/marketing" component={MarketingHome} />
        <Route path="/admin/studio/new" component={StudioNew} />
        <Route path="/admin/studio/:id/signal" component={StudioAnalytics} />
        <Route path="/admin/studio/:id" component={StudioEditor} />
        <Route path="/admin/studio" component={StudioHome} />
        <Route path="/admin/esign" component={ESign} />
        <Route path="/admin/domains" component={AdminDomainSettings} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/links" component={LinksPage} />
        <Route path="/admin/attribution" component={AttributionPage} />
        <Route path="/admin/behavior" component={BehaviorPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (isGymnastics) {
    return (
      <Switch>
        <Route path="/admin" component={GymnasticsDashboard} />
        {/* The gymnastics Programs tab shows the live cugc.co.nz lineup (not the
            generic camp-style pipeline) — website enrolments land in Registrations. */}
        <Route path="/admin/programs" component={CugcPrograms} />
        <Route path="/admin/cugc-registrations" component={CugcRegistrations} />
        <Route path="/admin/cugc-roll" component={CugcRoll} />
        <Route path="/admin/cugc-free-sessions" component={CugcFreeSessions} />
        <Route path="/admin/cugc-analytics" component={CugcAnalytics} />
        <Route path="/admin/cugc-inbox" component={CugcInbox} />
        <Route path="/admin/cugc-mailer" component={CugcMailer} />
        <Route path="/admin/terms" component={GymnasticsTerms} />
        {/* Reuse the camps detail + landing-page editor — they take a
            program id and don't care what type the program is. Gymnastics
            programmes live under /admin/programs so the sidebar highlights
            Programs, not Camps; the /admin/camps aliases stay for old links. */}
        <Route path="/admin/programs/:id/edit-page" component={AdminEditPage} />
        <Route path="/admin/programs/:id/session/:dateId/:sessionType" component={AdminSessionRoll} />
        <Route path="/admin/programs/:id" component={AdminCampDetail} />
        <Route path="/admin/camps/:id/edit-page" component={AdminEditPage} />
        <Route path="/admin/camps/:id/session/:dateId/:sessionType" component={AdminSessionRoll} />
        <Route path="/admin/camps/:id" component={AdminCampDetail} />
        <Route path="/admin/camps/:campId/session/:dateId/:sessionType" component={AdminSessionRoll} />
        <Route path="/admin/marketing/campaigns/new" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id/edit" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id" component={MarketingCampaignDetail} />
        <Route path="/admin/marketing/flows/:id" component={MarketingFlowEditor} />
        <Route path="/admin/marketing" component={MarketingHome} />
        <Route path="/admin/studio/new" component={StudioNew} />
        <Route path="/admin/studio/:id/signal" component={StudioAnalytics} />
        <Route path="/admin/studio/:id" component={StudioEditor} />
        <Route path="/admin/studio" component={StudioHome} />
        <Route path="/admin/esign" component={ESign} />
        <Route path="/admin/domains" component={AdminDomainSettings} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/links" component={LinksPage} />
        <Route path="/admin/attribution" component={AttributionPage} />
        <Route path="/admin/behavior" component={BehaviorPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (isTournament) {
    return (
      <Switch>
        <Route path="/admin" component={TournamentDashboard} />
        <Route path="/admin/tournaments/:tournamentId/teams/:teamId" component={TournamentTeamDetail} />
        <Route path="/admin/tournaments/:id" component={TournamentDetail} />
        <Route path="/admin/tournaments" component={TournamentList} />
        <Route path="/admin/clubs/:id" component={ClubDetail} />
        <Route path="/admin/clubs" component={ClubsList} />
        <Route path="/admin/skills-challenge" component={TournamentSkillsChallenge} />
        <Route path="/admin/food-truck" component={TournamentFoodTruck} />
        <Route path="/admin/vendors" component={TournamentVendors} />
        <Route path="/admin/volunteers" component={Volunteers} />
        <Route path="/admin/cic7s-registrations" component={Cic7sRegistrations} />
        <Route path="/admin/ethnic-cup-registrations" component={EthnicCupRegistrations} />
        <Route path="/admin/football-fest" component={FootballFest} />
        <Route path="/admin/team-entries" component={TeamEntries} />
        <Route path="/admin/cic-registrations" component={CicInbox} />
        <Route path="/admin/cic-livechat" component={CicLiveChat} />
        <Route path="/admin/mfl-livechat" component={MflLiveChat} />
        <Route path="/admin/cugc-livechat" component={CugcLiveChat} />
        <Route path="/admin/print-livechat" component={PrintLiveChat} />
        <Route path="/admin/cic-mailer" component={CicMailer} />
        <Route path="/admin/cic-push" component={CicPush} />
        <Route path="/admin/cic-logo-consents" component={CicLogoConsents} />
        <Route path="/admin/cic-watch" component={CicWatch} />
        <Route path="/admin/media" component={MediaLibrary} />
        <Route path="/admin/cic-content-marketplace" component={ContentMarketplace} />
        <Route path="/admin/cic-referees" component={CicReferees} />
        <Route path="/admin/cic-score/:id" component={CicScoreGame} />
        <Route path="/admin/marketing/campaigns/new" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id/edit" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id" component={MarketingCampaignDetail} />
        <Route path="/admin/marketing/flows/:id" component={MarketingFlowEditor} />
        <Route path="/admin/marketing" component={MarketingHome} />
        <Route path="/admin/studio/new" component={StudioNew} />
        <Route path="/admin/studio/:id/signal" component={StudioAnalytics} />
        <Route path="/admin/studio/:id" component={StudioEditor} />
        <Route path="/admin/studio" component={StudioHome} />
        <Route path="/admin/esign" component={ESign} />
        <Route path="/admin/domains" component={AdminDomainSettings} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/links" component={LinksPage} />
        <Route path="/admin/attribution" component={AttributionPage} />
        <Route path="/admin/behavior" component={BehaviorPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (isLeague) {
    return (
      <Switch>
        <Route path="/admin" component={LeagueDashboard} />
        <Route path="/admin/competitions/:id/divisions/:divisionId" component={LeagueDetail} />
        <Route path="/admin/competitions/:id" component={LeagueCompetitionDetail} />
        <Route path="/admin/competitions" component={LeagueCompetitions} />
        <Route path="/admin/teams" component={LeagueTeams} />
        {/* Individual-signup youth leagues (Ballers, Term 4 2026). These run on
            the academy engine — one child, one term, one price — not on the
            league engine, whose unit of sale is a captain buying a team. The
            MFL workspace has its own Switch, so these routes have to be listed
            here as well as in the general block or the tabs 404. */}
        <Route path="/admin/academy" component={AdminAcademy} />
        <Route path="/admin/academy/:id/edit-page" component={AdminEditPage} />
        <Route path="/admin/academy/:id/session/:dateId/:sessionType" component={AdminSessionRoll} />
        <Route path="/admin/academy/:id" component={AdminCampDetail} />
        <Route path="/admin/registrations" component={AdminRegistrations} />
        <Route path="/admin/task-board" component={TaskBoard} />
        <Route path="/admin/mfl-referees" component={MflReferees} />
        <Route path="/admin/mfl-game-feed" component={MflGameFeedPage} />
        <Route path="/admin/mfl-score/:id" component={MflScoreGame} />
        <Route path="/admin/mfl-media" component={MflMedia} />
        <Route path="/admin/payments" component={LeaguePayments} />
        <Route path="/admin/mailer" component={LeagueMailer} />
        <Route path="/admin/rewards" component={LeagueRewards} />
        <Route path="/admin/loyalty" component={LeagueLoyalty} />
        <Route path="/admin/analytics" component={LeagueAnalytics} />
        <Route path="/admin/business-plan" component={LeagueBusinessPlan} />
        <Route path="/admin/store" component={LeagueStore} />
        <Route path="/admin/inbox" component={LeagueInbox} />
        <Route path="/admin/discounts/new" component={AdminDiscountDetail} />
        <Route path="/admin/discounts/:id" component={AdminDiscountDetail} />
        <Route path="/admin/discounts" component={AdminDiscounts} />
        <Route path="/admin/league-settings" component={LeagueSettings} />
        <Route path="/admin/marketing/campaigns/new" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id/edit" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id" component={MarketingCampaignDetail} />
        <Route path="/admin/marketing/flows/:id" component={MarketingFlowEditor} />
        <Route path="/admin/marketing" component={MarketingHome} />
        <Route path="/admin/studio/new" component={StudioNew} />
        <Route path="/admin/studio/:id/signal" component={StudioAnalytics} />
        <Route path="/admin/studio/:id" component={StudioEditor} />
        <Route path="/admin/studio" component={StudioHome} />
        <Route path="/admin/esign" component={ESign} />
        <Route path="/admin/domains" component={AdminDomainSettings} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/links" component={LinksPage} />
        <Route path="/admin/attribution" component={AttributionPage} />
        <Route path="/admin/behavior" component={BehaviorPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (isVenue) {
    return (
      <Switch>
        <Route path="/admin" component={VenueDashboard} />
        <Route path="/admin/calendar" component={VenueCalendar} />
        <Route path="/admin/bookings" component={VenueBookings} />
        <Route path="/admin/booking-requests" component={VenueBookingRequests} />
        <Route path="/admin/analytics" component={VenueAnalytics} />
        <Route path="/admin/facilities" component={VenueFacilities} />
        <Route path="/admin/addons" component={VenueAddons} />
        <Route path="/admin/housing" component={VenueHousing} />
        <Route path="/admin/maintenance" component={VenueMaintenance} />
        <Route path="/admin/energy" component={EnergyPage} />
        <Route path="/admin/people" component={VenuePeople} />
        <Route path="/admin/payments" component={VenuePayments} />
        <Route path="/admin/venue-settings" component={VenueSettings} />
        <Route path="/admin/website" component={VenueWebsite} />
        <Route path="/admin/marketing/campaigns/new" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id/edit" component={MarketingCampaignWizard} />
        <Route path="/admin/marketing/campaigns/:id" component={MarketingCampaignDetail} />
        <Route path="/admin/marketing/flows/:id" component={MarketingFlowEditor} />
        <Route path="/admin/marketing" component={MarketingHome} />
        <Route path="/admin/studio/new" component={StudioNew} />
        <Route path="/admin/studio/:id/signal" component={StudioAnalytics} />
        <Route path="/admin/studio/:id" component={StudioEditor} />
        <Route path="/admin/studio" component={StudioHome} />
        <Route path="/admin/esign" component={ESign} />
        <Route path="/admin/domains" component={AdminDomainSettings} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/links" component={LinksPage} />
        <Route path="/admin/attribution" component={AttributionPage} />
        <Route path="/admin/behavior" component={BehaviorPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/camps" component={AdminCamps} />
      <Route path="/admin/camps/:id/edit-page" component={AdminEditPage} />
      <Route path="/admin/camps/:id/session/:dateId/:sessionType" component={AdminSessionRoll} />
      <Route path="/admin/camps/:id" component={AdminCampDetail} />
      <Route path="/admin/academy" component={AdminAcademy} />
      {/* Academy programmes get their own detail URL so the sidebar keeps
          Academy highlighted — same components as camps, different section.
          The /admin/camps/:id aliases above still resolve for old links. */}
      <Route path="/admin/academy/:id/edit-page" component={AdminEditPage} />
      <Route path="/admin/academy/:id/session/:dateId/:sessionType" component={AdminSessionRoll} />
      <Route path="/admin/academy/:id" component={AdminCampDetail} />
      <Route path="/admin/squads" component={AdminSquads} />
      <Route path="/admin/football-in-schools" component={AdminFisPipeline} />
      <Route path="/admin/terms" component={GymnasticsTerms} />
      <Route path="/admin/registrations" component={AdminRegistrations} />
      <Route path="/admin/contacts" component={AdminContacts} />
      {/* One person page for both people tables, keyed `contact-{id}` /
          `child-{id}`. The two legacy URLs below redirect into it so existing
          bookmarks and links in old emails keep working. `parent/:id` always
          meant a `contacts` row (it served children too); `player/:id` only
          ever resolved a `children` row — it 404'd on every academy child,
          which is the bug this replaces. */}
      <Route path="/admin/people/:key" component={AdminPersonDetail} />
      {/* The redirect keeps the query string: a programme's Players tab attaches
          `?from=` so Back returns to the programme, and dropping it here is
          exactly how Back ended up in the Contacts list (Daniel, 2026-09-08). */}
      <Route path="/admin/contacts/parent/:id">
        {(params: any) => <Redirect to={`/admin/people/contact-${params.id}${window.location.search}`} />}
      </Route>
      <Route path="/admin/contacts/player/:id">
        {(params: any) => <Redirect to={`/admin/people/child-${params.id}${window.location.search}`} />}
      </Route>
      {/* History before the bare route: wouter matches in order, and a
          sub-page of a tab must never be swallowed by the tab itself. */}
      <Route path="/admin/mailer/history" component={AdminMailerHistory} />
      <Route path="/admin/mailer" component={AdminMailer} />
      <Route path="/admin/predictor" component={Predictor} />
      {/* Friendly Manager History — CUFC's 10-year archive (default/camps
          workspace Switch: CUFC has no is* flag, it lands here). */}
      <Route path="/admin/fm-history" component={FmHistory} />
      <Route path="/admin/fm-competitions" component={FmCompetitions} />
      <Route path="/admin/open-trainings" component={CufcOpenTrainings} />
      {/* Ticketed club events — the club dinner. Tab slug club-events. */}
      <Route path="/admin/club-events" component={ClubEventsAdmin} />
      <Route path="/admin/club-events/:id" component={ClubEventDetailAdmin} />
      {/* Sporty / NZ Football NRS push — same default Switch as fm-history
          (CUFC has no is* flag, so it lands here; SIU shares this Switch too
          since it has no dedicated branch above). */}
      <Route path="/admin/sporty" component={SportySync} />
      <Route path="/admin/football-institute" component={FootballInstitute} />
      <Route path="/admin/analytics" component={CampAnalytics} />
      <Route path="/admin/discounts/new" component={AdminDiscountDetail} />
      <Route path="/admin/discounts/:id" component={AdminDiscountDetail} />
      <Route path="/admin/discounts" component={AdminDiscounts} />
      {/* CUFC Store — the third brand on the shop_* engine (org 1), after
          MFL and CIC. Tab slug "store", CUFC-only (see cufcExtraTabs in
          shared/tabs.ts) — same route component the other two brands use,
          it's already org-aware via useWorkspace().currentOrg.id. */}
      <Route path="/admin/store" component={LeagueStore} />
      <Route path="/admin/domains" component={AdminDomainSettings} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route path="/admin/team" component={AdminTeam} />
      <Route path="/admin/links" component={LinksPage} />
      <Route path="/admin/attribution" component={AttributionPage} />
      <Route path="/admin/behavior" component={BehaviorPage} />
      <Route path="/admin/licensing" component={AdminLicensing} />
      <Route path="/admin/declarations" component={AdminDeclarations} />
      <Route path="/admin/events" component={AdminEvents} />
      <Route path="/admin/membership" component={AdminMembership} />
      <Route path="/admin/marketing/campaigns/new" component={MarketingCampaignWizard} />
      <Route path="/admin/marketing/campaigns/:id/edit" component={MarketingCampaignWizard} />
      <Route path="/admin/marketing/campaigns/:id" component={MarketingCampaignDetail} />
      <Route path="/admin/marketing/flows/:id" component={MarketingFlowEditor} />
      <Route path="/admin/marketing" component={MarketingHome} />
      <Route path="/admin/studio/new" component={StudioNew} />
      <Route path="/admin/studio/:id/signal" component={StudioAnalytics} />
      <Route path="/admin/studio/:id" component={StudioEditor} />
      <Route path="/admin/studio" component={StudioHome} />
      <Route component={NotFound} />
    </Switch>
  );
}

/** Shown inside the content area while a page's own download arrives —
    usually a few hundred milliseconds, so it stays quiet for the first 300ms
    and never replaces the sidebar or header. */
function PageLoading() {
  return (
    <div className="p-6 animate-in fade-in duration-300 [animation-delay:300ms] [animation-fill-mode:both]" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56 mb-6" />
      <Skeleton className="h-32 w-full mb-4" />
      <Skeleton className="h-32 w-full" />
    </div>
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
        <div className="flex h-screen w-full overflow-hidden bg-background">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center justify-between gap-3 sm:gap-4 px-3 sm:px-6 h-14 border-b border-blue-500/[0.06] flex-shrink-0 backdrop-blur-2xl admin-header">
              <div className="flex items-center gap-3">
                <SidebarTrigger data-testid="button-sidebar-toggle" className="text-white/30 hover:text-white/50 transition-colors duration-300" />
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("clubos:open-search"))}
                data-testid="input-global-search"
                className="relative max-w-md flex-1 flex items-center h-9 pl-9 pr-2 text-[13px] premium-input text-white/40 rounded-xl text-left hover:text-white/60 transition-colors"
              >
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400/30" />
                <span className="flex-1 truncate">Search everything…</span>
                <kbd className="hidden sm:inline-flex items-center text-[10px] text-white/30 border border-white/10 rounded px-1.5 py-0.5">⌘K</kbd>
              </button>
              <div className="flex items-center gap-2">
                {/* View As — super-admin only; renders nothing for everyone else. */}
                <ViewAsBar />
                {/* The bell that used to sit here had no click handler and no
                    panel behind it — a button that did nothing, for months.
                    Notification PREFERENCES live in the account menu; a real
                    notification inbox can earn this spot back when it exists. */}
                <AccountMenu />
              </div>
            </header>
            <main className="flex-1 overflow-x-hidden overflow-y-auto gradient-mesh">
              <Suspense fallback={<PageLoading />}>
                <AdminRouter />
              </Suspense>
            </main>
          </div>
        </div>
        <CommandPalette />
      </SidebarProvider>
    </AuthGuard>
  );
}

function App() {
  const [isAdminLogin] = useRoute("/admin/login");
  // The landing-page editor renders full-screen, outside the sidebar layout —
  // match it under every programme prefix, not just camps.
  const [isCampsEditPage] = useRoute("/admin/camps/:id/edit-page");
  const [isAcademyEditPage] = useRoute("/admin/academy/:id/edit-page");
  const [isProgramsEditPage] = useRoute("/admin/programs/:id/edit-page");
  const isAdminEditPage = isCampsEditPage || isAcademyEditPage || isProgramsEditPage;
  const [isAdminDeep] = useRoute("/admin/**");
  const [isAdminRoot] = useRoute("/admin");

  const isAdminRoute = isAdminDeep || isAdminRoot;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
        <Suspense fallback={<div className="min-h-screen bg-background" />}>
        {isAdminLogin ? (
          <AdminLogin />
        ) : isAdminEditPage ? (
          <WorkspaceProvider><AuthGuard><AdminEditPage /></AuthGuard></WorkspaceProvider>
        ) : isAdminRoute ? (
          <WorkspaceProvider><AdminLayout /></WorkspaceProvider>
        ) : (
          <Switch>
            {/* Register receipts — public by 128-bit token, any host. */}
            <Route path="/receipt/:token" component={PosReceipt} />
            <Route path="/">
              {(() => {
                // Hostname-based routing for the public root:
                //  - app.* / clubos.fly.dev / localhost → admin login
                //  - book.* (e.g. book.unitedsportscentre.com) → render the
                //    venue booking flow directly (no /book suffix in the URL).
                //  - everything else (parent-facing hosts like join.cufc.co.nz) →
                //    the legacy holiday-camp booking page they used to live at.
                const host = typeof window !== "undefined" ? window.location.hostname : "";
                const isAdminHost =
                  host.startsWith("app.") || host === "clubos.fly.dev" || host === "localhost";
                const isVenueHost = host.startsWith("book.");
                const isPrintHost = host.startsWith("order.") || host.includes("unitedprints.co.nz");
                const isMflHost = host.includes("minifootball");
                // ref.cicyouth.com / ref.minifootball.co.nz = the referee
                // platforms (login/signup/dashboard). MUST come before BOTH
                // the minifootball check and the cicyouth check below —
                // otherwise the "minifootball"/"cicyouth" substring sends a
                // ref.* host to the league landing page / Skills Challenge
                // page instead. join.cicyouth.com stays Skills Challenge;
                // minifootball.co.nz (no "ref." prefix) stays the league page.
                const isRefHost = host.startsWith("ref.");
                const isMflRefHost = isRefHost && isMflHost;
                const isCicHost = host.includes("cicyouth");
                if (isVenueHost) return <VenueBookPage />;
                if (isPrintHost) return <PrintHub />;
                if (isRefHost) return <Redirect to={isMflRefHost ? "/mfl-ref" : "/login"} />;
                // Keep the query string (utm_*, fbclid, ?ref=) — a bare Redirect drops it.
                if (isMflHost) return <Redirect to={`/league${window.location.search}`} />;
                if (isCicHost) return <Redirect to="/skills" />;
                return <Redirect to={isAdminHost ? "/admin/login" : "/fundamentals-camp"} />;
              })()}
            </Route>
            <Route path="/terms" component={TermsPage} />
            <Route path="/privacy" component={PrivacyPage} />
            {/* Self-service password reset (public, must precede /:slug) */}
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/calendar/rsvp/:token" component={RsvpPage} />
            <Route path="/sign/:token" component={SignPage} />
            <Route path="/declaration/:token" component={SignDeclaration} />
            {/* USG Studio — public proposal pages (unlisted, no auth). Must
                precede the 2-segment /:slug/* and 1-segment /:slug routes. */}
            <Route path="/p/:token" component={StudioPublicPage} />
            {/* Staff Videos — the in-house Loom's public share pages. Random
                non-enumerable tokens; visibility enforced by the public API. */}
            <Route path="/v/:token" component={VideoShare} />
            {/* The equipment holder's own page. A signed link, never a login —
                see server/equipment-routes.ts for why. */}
            <Route path="/equipment/:token" component={EquipmentHolder} />
            <Route path="/studio-preview" component={StudioPreviewPage} />
            {/* CIC referee scoring — the mobile app referees use to score their
                games. Referee token-auth (never a staff session); same-origin.
                Clean URLs on ref.cicyouth.com (/login, /signup, /game/:id) —
                old /ref* paths kept as redirects since links were already shared.
                ref.minifootball.co.nz shares these SAME clean paths but redirects
                into the /mfl-ref/* namespace below — one URL shape, two brands,
                picked by hostname (cicyouth.com behaviour is untouched). */}
            <Route path="/login">
              {() => {
                const host = typeof window !== "undefined" ? window.location.hostname : "";
                if (host.startsWith("ref.") && host.includes("minifootball")) return <Redirect to="/mfl-ref" />;
                return <RefHome />;
              }}
            </Route>
            <Route path="/signup">
              {() => {
                const host = typeof window !== "undefined" ? window.location.hostname : "";
                if (host.startsWith("ref.") && host.includes("minifootball")) return <Redirect to="/mfl-ref/signup" />;
                return <RefSignup />;
              }}
            </Route>
            <Route path="/game/:id">
              {(params) => {
                const host = typeof window !== "undefined" ? window.location.hostname : "";
                if (host.startsWith("ref.") && host.includes("minifootball")) return <Redirect to={`/mfl-ref/game/${params.id}`} />;
                return <RefGameDetail />;
              }}
            </Route>
            <Route path="/ref/signup"><Redirect to="/signup" /></Route>
            <Route path="/ref/game/:id">{(params) => <Redirect to={`/game/${params.id}`} />}</Route>
            <Route path="/ref"><Redirect to="/login" /></Route>
            {/* MFL referee scoring — separate namespace, own gold-on-black
                brand (client/src/pages/mfl-ref/*). Reached directly at
                /mfl-ref/* on app.usg.co.nz, or via the clean-URL redirect
                above on ref.minifootball.co.nz. */}
            <Route path="/mfl-ref" component={MflRefHome} />
            <Route path="/mfl-ref/signup" component={MflRefSignup} />
            <Route path="/mfl-ref/game/:id" component={MflRefGameDetail} />
            <Route path="/book" component={VenueBookPage} />
            <Route path="/book/success" component={VenueBookSuccess} />
            <Route path="/book/split/:code" component={VenueSplitPage} />
            {/* One participant's share of a PayShare group. The URL PayShare
                sends people to, returned from our create-payment hook. */}
            <Route path="/book/payshare/pay/:token" component={VenuePaySharePage} />
            {/* Member booking requests (book.unitedsportscentre.com/members) */}
            <Route path="/members" component={MemberBookingPage} />
            {/* United Prints customer account. Registered before the one-segment
                /:slug route below — otherwise /account falls through to it and a
                customer gets "Camp not found", which is exactly what happened to
                the parent portal. Same-origin on join.unitedprints.co.nz, so the
                __Host- session cookie is first-party. */}
            <Route path="/account" component={PrintAccountPage} />
            {/* DTF / printed tees, with a live placement mockup. Same origin as
                the account portal, so a signed-in trade customer is priced at
                their own rate with no CORS involved. */}
            {/* The custom tee studio — design with your own image or words,
                see it on the shirt, send the order. */}
            <Route path="/print/studio" component={PrintStudioPage} />
            <Route path="/print/artwork/:token" component={PrintArtworkPage} />
            <Route path="/print/dtf" component={PrintDtfPage} />
            <Route path="/print" component={PrintHub} />
            <Route path="/print/configure/:slug" component={PrintConfigure} />
            <Route path="/print/checkout" component={PrintCheckout} />
            <Route path="/print/order/:token/upload" component={PrintUpload} />
            <Route path="/print/order/:token" component={PrintOrderStatus} />
            {/* ── Team Pay ───────────────────────────────────────────────────
                Public, no login. Every page is authenticated by a random token
                in the URL, and each is branded from the competition's own row —
                so these render as the Ethnic Cup, not as ClubOS.

                🔴 /fill-in/reply/:token MUST precede /fill-in/:slug, or wouter
                matches "reply" as a competition slug and a player answering an
                invitation lands on a signup form. Same trap as the View As
                /view-as/stop route, which locked people inside a staff account. */}
            {/* ── Club Events ────────────────────────────────────────────────
                Ticketed club events (join.cufc.co.nz/events/{slug}). Public,
                no login; the order page is authenticated by its token. The
                order route precedes the slug route so "order" is never a slug. */}
            <Route path="/events/:slug/order/:token" component={ClubEventOrderPage} />
            <Route path="/events/:slug" component={ClubEventPage} />
            <Route path="/enter/:slug" component={TeampayEnterPage} />
            <Route path="/team/:token" component={TeampayDashboard} />
            {/* 🔴 The specific captain routes MUST precede /captain, or wouter
                matches the bare path first and the set-password link 404s. */}
            <Route path="/captain/set-password" component={CaptainSetPasswordPage} />
            <Route path="/captain/teams/:id" component={CaptainTeamPage} />
            {/* An MFL league team, through the same session. */}
            <Route path="/captain/league/:id" component={LeagueTeamPage} />
            <Route path="/captain/teams" component={CaptainTeamsPage} />
            <Route path="/captain" component={CaptainSignInPage} />
            <Route path="/pay/:token" component={TeampayPlayerPage} />
            <Route path="/fill-in/reply/:token" component={TeampayHoldPage} />
            <Route path="/fill-in/:slug" component={TeampayFillinPage} />
            {/* CIC Skills Challenge registration (join.cicyouth.com) */}
            <Route path="/skills" component={CicSkillsLandingPage} />
            {/* MFL team registration funnel (join.minifootball.co.nz) */}
            <Route path="/league/balance/:registrationId">{() => <MflCheckoutPage mode="balance" />}</Route>
            <Route path="/league/:slug/register" component={MflRegisterPage} />
            <Route path="/league/:slug/waitlist" component={MflWaitlistPage} />
            <Route path="/league/:slug/checkout">{() => <MflCheckoutPage mode="deposit" />}</Route>
            <Route path="/league/:slug/success" component={MflSuccessPage} />
            {/* Split Pay hub — captain splits a fixed team fee across the squad.
                3-segment route; must precede the 2-segment /league/:slug. */}
            <Route path="/league/split/:code" component={MflSplitPage} />
            {/* League Builders (referral hub) — must precede /league/:slug. */}
            <Route path="/league/builders/:token" component={LeagueBuilderPage} />
            <Route path="/league/builders" component={LeagueBuilderPage} />
            {/* Literal legal routes must precede /league/:slug (else slug='privacy') */}
            <Route path="/league/privacy">{() => <MflLegalPage kind="privacy" />}</Route>
            <Route path="/league/delete-account">{() => <MflLegalPage kind="delete" />}</Route>
            <Route path="/league/:slug" component={MflLandingPage} />
            <Route path="/league" component={MflLandingPage} />
            <Route path="/membership" component={MembershipPage} />
            {/* CUFC Academy registration (join.cufc.co.nz/academy/:slug) — must
                precede /:slug/book so "academy" isn't swallowed as a venue slug. */}
            <Route path="/academy/:slug" component={AcademyRegisterPage} />
            <Route path="/:slug/book" component={BookingPage} />
            <Route path="/:slug/class-book" component={ClassBookingPage} />
            <Route path="/:slug/checkout" component={CheckoutPage} />
            <Route path="/:slug/feedback" component={AttributionSurvey} />
            <Route path="/:slug/success" component={BookingSuccess} />
            <Route path="/:slug/cancel" component={BookingCancel} />
            <Route path="/:slug" component={CampPage} />
            <Route component={NotFound} />
          </Switch>
        )}
        </Suspense>
        <Toaster />
        {/* Spec §7 — askConfirm()'s host. Mounted once, next to the toaster,
            for the same reason: both are called imperatively from anywhere. */}
        <ConfirmHost />
      </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
