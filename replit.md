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
- **Authentication & Roles**: Session-based authentication with `express-session` and `connect-pg-simple` ensures secure access. Role-based access control (RBAC) with roles like `super_admin`, `admin`, and `team_member` governs permissions across various routes and functionalities.
- **Data Model**: The database schema includes tables for users, contacts, programs (camps/academy), pricing, dates, settings, discounts, children, medical information, registrations, attendance, email logs, Meta event logs, audit logs, and analytics events. Programs with `type='academy'` use an `academy_section` column (values: `'core'` or `'additional'`) to separate Core Academy Programs from Additional Programs (e.g., Technification, GK Training).
- **A/B Split Testing**: Integrated A/B testing functionality allows administrators to test different content variants (e.g., headlines) on public camp pages, track conversions, and automatically determine winning variants based on revenue or registrations.
- **Routing**: A comprehensive routing strategy manages public-facing camp pages, booking flows, and a detailed admin panel for managing camps, registrations, contacts, analytics, and settings.
- **Payment Flow**: Utilizes Stripe Payment Intents for secure and embedded payment processing. The flow involves session selection, parent and child details, and an inline Stripe PaymentElement. Confirmation emails and Meta Purchase events are triggered upon successful payment.

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