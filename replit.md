# CUFC ClubOS — Holiday Camps

## Overview
Holiday camp booking and management platform for Christchurch United Football Club. Focused product: public booking pages, Stripe payments, attendance roll, CRM exports, confirmation emails, Meta CAPI.

## Tech Stack
- **Frontend**: React + TypeScript + Vite + wouter (routing)
- **UI**: Tailwind CSS + shadcn/ui components
- **Backend**: Express.js + express-session (bcrypt auth)
- **Database**: PostgreSQL (Neon via Drizzle ORM)
- **State Management**: TanStack React Query
- **Payments**: Stripe Elements (embedded PaymentIntent, custom checkout page)
- **Email**: Resend API (optional — logs only if RESEND_API_KEY set)
- **Tracking**: Meta Pixel (client) + Conversions API (server)

## Architecture
- `client/src/` - React frontend
  - `pages/` - Page components:
    - Admin: admin-login, admin-dashboard, admin-camps, admin-camp-detail, admin-edit-page, admin-session-roll, admin-registrations, admin-contacts, admin-contact-detail, admin-mailer, admin-settings, admin-register-player (modal component)
    - Public: camp-page, booking-page, checkout-page, booking-success, booking-cancel
  - `components/` - app-sidebar, ui/ (shadcn)
  - `lib/meta-pixel.ts` - Client-side Meta Pixel tracking
- `server/` - Express backend
  - `routes.ts` - API endpoints (auth, admin/*, public/*, stripe webhook)
  - `storage.ts` - Database storage layer (IStorage interface)
  - `auth.ts` - Session auth with bcrypt + connect-pg-simple
  - `seed.ts` - Seeds admin user + sample camps
  - `stripe.ts` - Stripe PaymentIntent creation + webhook verification
  - `email.ts` - Resend email sending + confirmation template
  - `meta-capi.ts` - Meta Conversions API server-side events
  - `db.ts` - Database connection
- `shared/schema.ts` - Drizzle schema + Zod validation + TypeScript types
- `client/src/lib/workspace-context.tsx` - Workspace/organization context provider

## Multi-Brand Workspaces
- 6 organizations: Christchurch United, South Island United, Mini Football Leagues, United Sports Centre, Christchurch International Cup, United Gymnastics
- `organizations` table: id, name, slug, logoUrl, active
- `userOrganizations` table: userId + organizationId (unique constraint) + role
- Super admins assigned to all orgs; other staff assigned to Christchurch United
- Workspace switcher in sidebar header — stores selection in localStorage
- `/api/auth/me` returns user's organizations array
- Logos served from `/logos/` in client/public
- Workspace-aware sidebar: CU shows Camps nav, USC shows VenueFlow nav, MFL shows Leagues nav, CIC shows Tournaments nav, UG shows Gymnastics nav
- Workspace-aware routing: AdminRouter renders different page sets based on currentOrg.slug

### United Sports Centre — VenueFlow
- Facility hire management platform built inside the USC workspace
- DB tables: `facilities`, `facility_pricing_rules`, `facility_bookings`, `facility_addons`
- 9 seeded facilities: S1/S2 (Fields), Mini Pitch 1/2, Meeting Room, Changing Room 1/2/3, Futsal Court
- API routes under `/api/admin/venue/*` (facilities, bookings, addons — all require orgId query param)
- Pages: venue-dashboard, venue-calendar, venue-analytics, venue-facilities, venue-addons, venue-people, venue-payments, venue-settings
- Sidebar nav: Dashboard, Bookings Calendar, Analytics, Facilities, Add-ons, People & Access, Payments, Settings

### Mini Football Leagues — League Management
- SportNinja-inspired league management platform in the MFL workspace
- DB tables: `league_competitions`, `league_divisions`, `league_teams`, `league_games`, `league_coupons`
- Seeded data: 2 competitions (Saturday Morning Mini League, Friday Night Futsal), 4 divisions, 24 teams, sample games with scores
- API routes under `/api/admin/league/*` (competitions, divisions, teams, games, standings, coupons)
- Pages: league-dashboard, league-competitions, league-competition-detail (tabs: Schedule/Standings/Setup/Registration/Coupons), league-teams, league-settings
- Sidebar nav: Dashboard, Competitions, Teams + Settings (secondary)
- Competition detail features: game scheduling, live standings calculation, division management, registration status toggle, coupon management

### Christchurch International Cup — Tournament Management
- Tournament management platform in the CIC workspace
- DB tables: `tournaments`, `tournament_groups`, `tournament_teams`, `tournament_players`, `tournament_staff`, `tournament_games`
- Seeded data: 2 tournaments (U10 active, U12 draft), 4 groups (A-D), 16 teams with club names and colors
- API routes under `/api/admin/tournament/*` (tournaments, groups, teams, players, staff, games, standings, generate-groups, generate-schedule)
- Pages: tournament-dashboard, tournament-list, tournament-detail (tabs: Format/Schedule/Groups & Draw/Teams), tournament-team-detail (tabs: Players/Staff)
- Sidebar nav: Dashboard, Tournaments + Settings (secondary)
- Tournament detail features: format overview, auto schedule generation (round-robin group stage + QF/SF/Finals knockout bracket with Cup + Plate), drag-and-drop group draw editor, team management
- Team detail features: player roster with shirt numbers and ID document support, staff management with roles
- Draw structure: 4 groups × 4 teams → QFs (Cup: 1st/2nd place, Plate: 3rd/4th place) → SFs → 3rd Place + Finals

## Auth & Roles
- express-session with PgSession store (connect-pg-simple)
- `requireAuth` middleware guards all `/api/admin/*` routes
- `requireSuperAdmin` middleware guards user management routes (`/api/admin/users/*`)
- Roles: `super_admin`, `admin`, `team_member` (plus legacy: manager, coach, finance, marketing, registrar)
- Admin login: `daniel@cufc.co.nz` / `Growth2020!` (Super Admin)
- Staff: `grassroots@cufc.co.nz`, `marketing@cufc.co.nz` (Admin role, same password — seed resets on every startup)
- Settings > Users tab (super_admin only): manage staff accounts, change roles, add/delete users
- Frontend AuthGuard component redirects to /admin/login if not authenticated

## Routing
- `/` — Redirects to /fundamentals-camp
- `/:slug` — Conversion-focused camp detail page (hero, pricing, FAQ, inclusions)
- `/:slug/book` — 4-step booking form (sessions → parent details → children → embedded Stripe payment)
- `/:slug/checkout` — Legacy checkout page (fallback, kept for direct URL access)
- `/:slug/success` — Booking confirmation with "What Happens Next" section
- `/:slug/cancel` — Booking cancelled
- `/admin/login` — Admin login
- `/admin` — Admin dashboard
- `/admin/camps` — Camp list + create
- `/admin/camps/:id` — Camp detail (tabs: Overview, Sessions, Content, Dates & Capacity, Pricing, Discounts, Email Template) with stats header (registrations, revenue, occupancy). Buttons: Edit (settings), Edit Page (inline page editor), View Page (opens public page)
- `/admin/camps/:id/edit-page` — Inline page editor: renders camp sales page template with click-to-edit fields (heroHeadline, heroSubheadline, primaryCta, FAQ Q&A). Saves via PATCH /api/admin/camps/:id
- `/admin/registrations` — Registration list with camp filter (confirmed only)
- `/admin/contacts` — Full CRM contact list (parents + players) with search, type filters, CSV export
- `/admin/contacts/parent/:id` — Parent detail page with linked children and registrations
- `/admin/contacts/player/:id` — Player detail page with medical info, linked parent, and registrations
- `/admin/camps/:id/session/:dateId/:type` — Dedicated session roll page with player list, sign-in/out timestamps, search
- `/admin/mailer` — Email campaign builder with segment-based recipient selection, rich text editor, image upload, and Resend-powered sending
- `/admin/analytics` — Comprehensive analytics dashboard with 6 tabs: Overview (page views, sessions, bounce rate, CTA clicks, devices, sources, daily traffic), Funnel (registration funnel visualization), Revenue (total revenue, AOV, discounts, camp breakdown, daily chart), Customers (families, new vs returning, multi-child, LTV), Camp Performance (per-camp metrics), Engagement (most clicked elements, scroll depth)
- `/admin/settings` — Club settings

## Color Theme
- **Public pages**: Brand colors — Blue #22399B (primary), White #FBFBFC (secondary), Gold #D9B10F (accent), Dark Blue #221F7A (accent). Font: Inter Tight (Bold for headings, Regular for body, Italic for emphasis). Conversion-focused layout with Wistia video embed, scrollable review carousel, and fade-in animations.
- **Admin pages**: Premium midnight blue-black #02060E, glassmorphic panels, blue glow effects
- Custom CSS utilities: glass-card, glass-panel, glow-btn, glow-border, premium-input, row-hover, animate-fade-in-up
- **Fonts**: Inter Tight font files stored in `client/public/fonts/`, loaded via `@font-face` in `client/src/index.css`

## Data Model
- **users** - Staff users with RBAC roles
- **contacts** - Players, guardians, staff, volunteers, sponsors
- **programs** - Holiday camps with slug, dates, capacity, age range, landing page content (heroHeadline, heroSubheadline, descriptionShort/Long, whatToBring, inclusions, refundPolicy, contactEmail, primaryCta, faqJson)
- **campPricing** - Per-camp pricing (FULL_DAY, MORNING, AFTERNOON) in cents
- **campDates** - Per-day date records with capacity per session type
- **campSettings** - Email template per camp
- **programDiscounts** - Volume discount tiers
- **children** - Child records linked to parent contacts
- **childMedical** - Medical info per child
- **registrations** - Bookings with Stripe fields, pricing in cents, UTM attribution, registrationLocation ("online" | "cufc_office")
- **registrationItems** - Individual session bookings
- **attendance** - Check-in/out records
- **emailLogs** - Email send log (idempotency per registration)
- **metaEventLogs** - Meta CAPI event log
- **auditLogs** - System activity tracking
- **settings** - Key-value club configuration
- **analyticsEvents** - Web analytics tracking (visitorId, sessionId, eventType, page, referrer, UTM params, device, browser, campSlug, metadata JSONB). Client tracking script at `/analytics.js` fires events: page_view, session_start, time_on_page, scroll_depth, bounce, cta_click, click, form_view, form_step
- **splitTests** - A/B split tests per program (field, status, endCondition, endValue, winnerId, startedAt, endedAt)
- **splitTestVariants** - Variants per split test (value, isControl, views, registrations, revenue)

## A/B Split Testing
- Admin creates tests from Edit Page by hovering over headline/subheadline fields → purple flask button → modal with variant inputs + end conditions
- Public camp page serves random variant per visitor (stored in localStorage) and fires view events
- Booking page fires conversion events (both paid and free) via `window._cufc_split_variants`
- Auto-winner selection: when end condition met (days elapsed or view threshold), winner = highest revenue (tiebreak = registrations), winning value applied to program field
- Performance tab on camp detail page shows active tests with progress bars, variant comparison (views/regs/revenue/conv rate), past tests with winners
- API: GET/POST `/api/admin/split-tests/:programId`, POST `/:id/cancel`, POST `/:id/complete`, GET `/api/public/split-test/variant`, POST `/view`, POST `/conversion`

## API Routes
- Auth: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
- Admin: Full CRUD for camps, dates, pricing, discounts, settings, registrations, attendance, CRM export, audit logs, GET /api/admin/camps/:id/sessions-summary, GET /api/admin/camps/:id/stats, GET /api/admin/camps/registration-counts, POST /api/admin/registrations/manual
- Public: GET /api/public/camps, GET /api/public/camps/:slug, POST /api/public/book, POST /api/public/book/confirm-free, POST /api/public/confirm-payment, GET /api/public/registrations/:id
- Stripe: POST /api/stripe/webhook

## Payment Flow
1. Parent selects sessions (step 1) → enters details (step 2) → adds children (step 3) → POST /api/public/book
2. If totalCents > 0 and STRIPE_SECRET_KEY set → creates Stripe PaymentIntent → fetches checkout data from GET /api/public/checkout/:id
3. Step 4: Embedded Stripe PaymentElement renders within the booking page (no separate checkout page)
4. User pays inline → confirms PaymentIntent → POST /api/public/confirm-payment
5. Webhook (POST /api/stripe/webhook, event: payment_intent.succeeded) also confirms payment (backup)
6. On confirmation: updates registration status, sends confirmation email, fires Meta Purchase event
7. Sessions selected in step 1 are applied to ALL children added in step 3 (template pattern)

## Pricing
- Hardcoded frontend prices: Morning $30 (3000¢), Afternoon $30 (3000¢), Full Day $50 (5000¢)
- Session times: Morning 9am–12pm, Afternoon 12pm–3pm, Full Day 9am–3pm
- Backend uses database camp_pricing table for actual charge calculation

## Environment Variables
- `STRIPE_SECRET_KEY` — Stripe API key (secret, set by user)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `VITE_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (frontend, for Stripe Elements)
- `SESSION_SECRET` — Express session secret
- `RESEND_API_KEY` — Optional: Resend email API key
- `META_PIXEL_ID` — Optional: Meta Pixel ID (also set VITE_META_PIXEL_ID for frontend)
- `META_ACCESS_TOKEN` — Optional: Meta Conversions API access token

## Stripe Integration Note
Stripe integration uses direct API keys (not Replit connector). STRIPE_SECRET_KEY is stored as a Replit secret. Webhook secret needs to be configured after deployment.

## Key Commands
- `npm run dev` - Start dev server
- `npm run db:push` - Push schema to database (interactive — use executeSql for non-interactive)
- `npm run build` - Production build
