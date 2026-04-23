# CUFC ClubOS — Holiday Camps

## Overview
CUFC ClubOS is a comprehensive booking and management platform designed for the Christchurch United Football Club, specifically for their holiday camps. The platform streamlines public bookings, handles Stripe payments, generates attendance rolls, facilitates CRM exports, sends confirmation emails, and integrates with the Meta Conversions API. The project aims to provide a robust, multi-brand solution for sports and activity management, with future potential for broader application beyond football, encompassing facility hire, league management, and tournament organization for various sports organizations.

## User Preferences
I prefer detailed explanations of the code and any architectural decisions. When making changes, please prioritize security and data integrity. I value iterative development and would like to be consulted before any major architectural shifts or feature removals. Ensure all new features are thoroughly tested.

## System Architecture
The application follows a client-server architecture.
- **Frontend**: Built with React, TypeScript, Vite, `wouter` for routing, Tailwind CSS, and `shadcn/ui` for components. State management is handled by TanStack React Query.
- **Backend**: An Express.js server handles API requests, authentication (using `express-session` and `bcrypt`), Stripe integrations, email sending via Resend, and Meta Conversions API events.
- **Database**: PostgreSQL is used with Drizzle ORM for schema management and data interaction.
- **UI/UX**:
    - **Public Pages**: Feature a brand-aligned color scheme (Blue, White, Gold, Dark Blue) with the Inter Tight font. The design is conversion-focused, incorporating video embeds, review carousels, and fade-in animations.
    - **Admin Pages**: Utilize a premium midnight blue-black theme with glassmorphic panels and blue glow effects, enhancing the professional feel of the administrative interface. Custom CSS utilities are employed for consistent styling.
- **Multi-Brand Workspaces**: The platform supports multiple organizations (e.g., Christchurch United, United Sports Centre, Mini Football Leagues, United Sports Group) through a workspace context. This allows for tailored features and routing based on the selected organization, enabling modules like VenueFlow for facility hire, League Management, Tournament Management, and the Group-level calendar and dashboard.
- **Tournament Schedule Tab**: The schedule view in `tournament-detail.tsx` uses a spreadsheet-style table layout matching the CIC draw format: Rd | Pool/Stage | Time | Game # | Field | Home Team | Score | Away Team. Games are grouped by date headers with separate sections for Group Stage and Knockout/Finals. Supports inline editing of game time, field (pitch), and date via pencil icon per row. Available fields: S1, S2, J1, J2, J3, J4, Mini 1, Mini 2.
- **Public Tournament API**: Read-only public endpoints at `/api/public/tournament/tournaments` for mobile app integration (Rork). No auth required. Endpoints: list tournaments (requires `orgId` query param), tournament detail, groups, teams, games (with optional `stage` filter), and standings. Only tournaments with status `active` or `completed` are visible.
- **Authentication & Roles**: Session-based authentication with `express-session` and `connect-pg-simple` ensures secure access. Role-based access control (RBAC) with roles like `super_admin`, `admin`, and `team_member` governs permissions across various routes and functionalities.
- **Data Model**: The database schema includes tables for users, contacts, programs (camps/academy), pricing, dates, settings, discounts, children, medical information, registrations, attendance, email logs, Meta event logs, audit logs, and analytics events. Programs with `type='academy'` use an `academy_section` column (values: `'core'` or `'additional'`) to separate Core Academy Programs from Additional Programs (e.g., Technification, GK Training).
- **A/B Split Testing**: Integrated A/B testing functionality allows administrators to test different content variants (e.g., headlines) on public camp pages, track conversions, and automatically determine winning variants based on revenue or registrations.
- **Routing**: A comprehensive routing strategy manages public-facing camp pages, booking flows, and a detailed admin panel for managing camps, registrations, contacts, analytics, and settings.
- **Payment Flow**: Utilizes Stripe Payment Intents for secure and embedded payment processing. The flow involves session selection, parent and child details, and an inline Stripe PaymentElement. Confirmation emails and Meta Purchase events are triggered upon successful payment.
- **Attribution Survey**: Post-payment "Where did you hear about us?" survey at `/:slug/feedback?registrationId=X`. After booking (paid or free), users are redirected to the survey page instead of directly to success. 12 source options: Instagram, Facebook, YouTube, TikTok, Google, Facebook Ad, Word of Mouth, Friend/Family, School/Club, Billboard, Email, Other (with text input). Stored in `registrations.referral_source` column. Users can skip. On submit/skip, navigates to `/:slug/success`. Referral source shown as violet badge on admin registration detail and contact profile pages. Public PATCH endpoint: `/api/public/registrations/:id/attribution`. Admin analytics endpoint: `/api/admin/analytics/attribution`.
- **Refunds**: Admin-initiated Stripe refunds from the registrations page. Each paid registration (with a Stripe payment intent) shows a red "Refund" button in its expanded pricing card. Clicking opens a confirmation dialog where staff can choose a partial amount (or leave blank for full) and add a reason. Refund is processed through Stripe (with idempotency key `refund_reg_{id}_{amount}`) and `registrations` is updated with `refunded_at`, `refunded_amount_cents`, `refund_reason`, `refunded_by`, `stripe_refund_id`. Full refunds set status to `refunded`. The admin list shows both `confirmed` and `refunded` registrations so refunded orders remain visible. Endpoint: `POST /api/admin/registrations/:id/refund`.

## External Dependencies
- **Stripe**: For payment processing and webhook handling.
- **Resend API**: For sending transactional emails, primarily confirmation emails.
- **Meta Pixel & Conversions API**: For client-side and server-side event tracking and analytics.
- **PostgreSQL (Neon)**: The primary database solution.
- **Drizzle ORM**: Object-Relational Mapper for database interactions.
- **Express.js**: Backend web application framework.
- **React**: Frontend JavaScript library.
- **Tailwind CSS**: Utility-first CSS framework.
- **shadcn/ui**: UI component library.
- **TanStack React Query**: Data fetching and state management library.
- **Wistia**: For video embedding on public pages.

## Analytics Module
The analytics module at `/admin/analytics` provides comprehensive insights via tabbed views:
- **Overview**: Key metrics (page views, unique visitors, bounce rate, avg session time)
- **Funnel**: Conversion funnel from page views → registrations
- **Revenue**: Revenue trends and breakdowns
- **Customers**: Customer demographics and behavior
- **Camp Performance**: Per-camp comparison metrics
- **Engagement**: Engagement heatmap (page views by time)
- **Order Timing**: Day×hour heatmap showing when customers place orders (NZ timezone), with peak day/hour cards, day-of-week bars, and time-of-day period breakdown
- **Attribution**: Post-payment survey analytics showing how customers heard about the camps. Displays total registrations, survey responses, response rate, top source, attribution breakdown bars with source labels/colors, and revenue per source.

## Discounts Module
Shopify-style discount management at `/admin/discounts` (Christchurch United workspace only):
- **List page**: Searchable, filterable table (by status: active/expired/scheduled/disabled)
- **Create/Edit page**: Full Shopify-style form with discount type selector, code or automatic method, value configuration, eligibility, minimum purchase requirements, usage limits, combination rules, and active date scheduling
- **Discount types**: Amount off products, Amount off order, Buy X get Y, Free shipping
- **Schema**: `discounts` table with org-scoped CRUD, `discount_usages` for tracking usage per registration
- **Security**: Org-scoped authorization on all CRUD endpoints (user must belong to discount's org)
- **Booking integration**: Discount codes can be applied during camp registration at checkout. Promo code input appears in the pricing summary on the booking page. Validation endpoint at `/api/public/validate-discount`. Server-side application in `/api/public/book` with proper discount calculation (percentage or fixed). Usage tracking (`timesUsed`, `totalDiscountedCents`) only increments on confirmed payment, not on pending bookings.
- **Registration schema**: `registrations` table includes `discount_code` and `discount_id` columns to track which discount was used per registration.

## United Sports Group Workspace
Group-level workspace at "United Sports Group" (slug: `united-sports-group`) with ram logo:
- **Dashboard** (`/admin`): Cross-workspace aggregated view showing total registrations, revenue, upcoming events, and workspace listing
- **Calendar** (`/admin/calendar`): Google Calendar-inspired scheduling with:
  - Day, Week, Month, and Year views with smooth navigation
  - Event create/edit modal with title, time, location, description, calendar type
  - Color-coded calendar types: General, United Events, South Island United, Gymnastics, Payments & Finance, Training, Meetings, Personal
  - Calendar filter toggles in sidebar to show/hide specific calendars
  - Mini calendar in sidebar for quick date navigation
  - Click on time slots to create events, click events to view details
  - Recurring events: Create daily/weekly/monthly/yearly repeating events with custom intervals and optional end dates
  - Dollar amount field: Optional amount input appears when "Payments & Finance" calendar is selected, displayed on event blocks and detail popup in gold accent
  - Schema: `calendar_events` table with title, description, location, start/end times, allDay, calendarType, color, recurrence, amount (decimal), createdBy
- **Sponsorship** (`/admin/sponsorship`): Placeholder page for future sponsor/contract management

## Custom Domains
Multi-workspace custom domain mapping at `/admin/domains` (available in all workspaces):
- **Schema**: `custom_domains` table with `id`, `organizationId`, `domain`, `status` (pending/active/failed), `verified`, `verifiedAt`, `isPrimary`, `createdAt`
- **Admin UI**: Domain management page to add/remove custom domains per workspace, DNS configuration instructions, verification status badges
- **API routes**: Full CRUD at `/api/admin/domains` with org-scoped authorization (user must belong to domain's org), whitelisted PATCH fields
- **Domain resolution**: Public endpoint `/api/public/resolve-domain?hostname=...` resolves a domain to its organization and active programs
- **Storage**: `getCustomDomainsByOrg`, `getCustomDomainByHostname`, `createCustomDomain`, `updateCustomDomain`, `deleteCustomDomain`
- **Security**: All admin endpoints verify user belongs to the domain's organization. PATCH only allows `isPrimary` field updates.

## United Prints Workspace
Signage & print studio management workspace (slug: `united-prints`):
- **Dashboard** (`/admin`): Overview with order pipeline, revenue stats, recent orders
- **CRM** (`/admin/print-crm`): Contact management with customer/supplier/partner types, search, revenue tracking
- **Orders** (`/admin/print-orders`): Full order pipeline with statuses (inquiry → quoted → confirmed → in_production → ready → delivered/cancelled), amounts, due dates, status filters
- **Projects** (`/admin/print-projects`): Project tracking with statuses (planning/active/on_hold/completed/archived), budgets, date ranges, grid view
- **Analytics** (`/admin/print-analytics`): Business performance with order/project status breakdowns, revenue totals, recent orders table
- **Landing Pages** (`/admin/print-landing`): Landing page builder with title, slug, headline, CTA, published/draft status, view counts
- **Email Sender** (`/admin/print-email`): Email campaigns to CRM contacts, compose/send/draft workflow
- **Schema**: `print_orders`, `print_projects`, `print_contacts`, `print_landing_pages`, `print_emails` tables with full CRUD storage and API routes
- **Enums**: `print_order_status` (inquiry/quoted/confirmed/in_production/ready/delivered/cancelled), `print_project_status` (planning/active/on_hold/completed/archived) — created directly in DB

## Currency Formatting
Shared utility at `client/src/lib/format.ts` provides:
- `formatCurrency(amount, options?)` — Formats monetary values with `$`, thousand separators (commas), and configurable decimals. Options: `{ fromCents?: boolean, decimals?: number }`. Default: 2 decimal places, dollars input.
- `formatNumber(value)` — Adds thousand separators to any number.
- `formatCompact(n)` — Shortens large numbers (e.g. 1500 → "1.5K").
All pages displaying monetary values use these shared utilities instead of inline `.toFixed()` calls.

## External API v1
API key-authenticated endpoints at `/api/v1/*` for AIOS integration:
- `/api/v1/overview` — High-level org metrics
- `/api/v1/revenue` — Revenue data
- `/api/v1/analytics` — Analytics events
- `/api/v1/customers` — Customer data
- `/api/v1/camps` — Camp/program listings
- `/api/v1/split-tests` — A/B test results
- `/api/v1/registrations` — Registration records
- `/api/v1/order-timing` — Order timing heatmap data (day×hour)