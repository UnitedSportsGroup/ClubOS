# CUFC ClubOS

## Overview
Club management platform for Christchurch United Football Club. Replaces Friendly Manager with a modern internal CRM for contacts, registrations, programmes, payments, and communications.

## Tech Stack
- **Frontend**: React + TypeScript + Vite + wouter (routing)
- **UI**: Tailwind CSS + shadcn/ui components
- **Backend**: Express.js
- **Database**: PostgreSQL (Neon via Drizzle ORM)
- **State Management**: TanStack React Query

## Architecture
- `client/src/` - React frontend
  - `pages/` - Page components (dashboard, contacts, programs, registrations, etc.)
  - `components/` - Shared components (app-sidebar, ui/)
- `server/` - Express backend
  - `routes.ts` - API endpoints
  - `storage.ts` - Database storage layer (IStorage interface)
  - `db.ts` - Database connection
  - `seed.ts` - Seed data for demo
- `shared/schema.ts` - Drizzle schema + Zod validation + TypeScript types

## Color Theme (Premium Midnight Blue)
- Background: Midnight blue-black #02060E (HSL 222 47% 4%)
- Cards/Surfaces: Glassmorphic panels (`glass-card` class) with blue-tinted gradient backgrounds, blue-glow borders (rgba 3,86,197), and backdrop-blur
- Primary accent: #0356C5 blue with animated glow effects (`glow-btn`, `animate-pulse-glow`)
- Status colors: Emerald (success), Amber (pending), Red (error), Blue (info)
- Text hierarchy: white/90 (headings), white/75 (body), white/45 (secondary), white/25 (tertiary)
- Labels: blue-300/25 with uppercase tracking-wider
- Font: Inter (system-ui fallback)
- Design language: Premium luxury SaaS dark UI with gradient-mesh background, glassmorphism cards, blue glow borders, staggered fadeInUp animations, and smooth micro-interactions
- Custom CSS utilities: glass-card, glass-panel, glow-btn, glow-border, glow-border-strong, gradient-mesh, sidebar-gradient, premium-input, row-hover, stat-glow, animate-fade-in-up, animate-pulse-glow, animate-breathe
- Accessibility: prefers-reduced-motion media query disables all animations and ensures content visibility

## Data Model
- **users** - Staff users with RBAC roles
- **contacts** - Players, guardians, staff, volunteers, sponsors
- **contactRelationships** - Parent-player linking
- **programs** - Holiday camps, academies, trials, events, open trainings. Each has `slug`, `bookingsOpenDate`, `bookingsCloseDate`, `includeWeekends`, `fullDayCost` fields
- **programSessions** - Individual sessions within programs with `cost`, `rollTaker`, `capacity` fields
- **sessionBookings** - Per-session bookings for individual contacts with `attended`, `paid`, `notes` tracking
- **programDiscounts** - Multi-booking discount tiers per programme (`minBookings`, `discountPercent`)
- **registrations** - Player-programme registrations with status tracking, UTM attribution (source, utm_source/medium/campaign/content, fbclid, gclid)
- **auditLogs** - System activity tracking
- **settings** - Key-value club configuration (club info, registration, financial, emails, tracking pixel IDs)

## Key Commands
- `npm run dev` - Start dev server
- `npm run db:push` - Push schema to database
- `npm run build` - Production build

## Modular Dashboard System
- Dashboard blocks are customisable per-user via localStorage (`cufc-dashboard-blocks`)
- Users can add/remove blocks via "Add Block" modal with search functionality
- Default blocks: Academy Programmes, Recent Contacts, Active Programmes, Quick Actions
- Block definitions live in `AVAILABLE_BLOCKS` array in `dashboard.tsx`
- Block components: `client/src/components/dashboard/` directory
- API: `GET /api/academy-stats` returns tier-grouped registration data with revenue

### Academy Programmes Block
- Three tiers: U4-U8 FUNino, U9-U12 Pre-Academy, U13-U20 Academy
- Overview shows tier cards with registration counts, capacity bars, confirmed/pending breakdown
- Click a tier to drill down into individual programme analytics (registrations, revenue, capacity)
- Tier colours: emerald (U4-U8), amber (U9-U12), blue (U13-U20)

## MVP Modules
1. Modular dashboard with customisable blocks and academy analytics
2. Contacts CRUD with parent-player relationships
3. Programme management with sessions, bookings, attendance, and reports
4. Registration management
5. Audit log
6. Settings (tabbed: Club Info, Registration, Financial, Emails, Embed Codes, Integrations) with persistent key-value storage
7. Public registration landing pages (`/register` index + `/register/:slug` per-programme)

## Holiday Camp / Programme Sessions System
- **Programme Detail Tabs**: Sessions (date-grouped by week), Attendance (per-date roll marking), Registrations (legacy list)
- **Sessions**: Created per-date with Morning/Afternoon (or custom) templates. Each has name, time, venue, roll taker, cost, capacity
- **Add Date**: Modal lets admin pick dates; auto-creates sessions from existing templates
- **Edit Sessions**: Bulk-edit session templates (name, cost, times, venue, roll taker, capacity) applies to all matching sessions
- **Book Attendee**: Search players, show availability grid per date/session with booked/capacity counts, multi-select booking
- **Attendance**: Per-date roll call with paid/attended checkboxes and notes per player
- **Discounts**: Multi-booking discount tiers (e.g., 4+ bookings = 10% off)
- **Reports**: Filter by session, view attendees with attendance stats, CSV export
- **API Routes**: `GET/POST /api/programs/:id/sessions`, `PATCH/DELETE /api/sessions/:id`, `GET/POST /api/session-bookings`, `PATCH/DELETE /api/session-bookings/:id`, `GET/PUT /api/programs/:id/discounts`, `GET /api/programs/:id/report`

## Public Registration System
- **Pages**: `client/src/pages/register.tsx` (per-programme form), `client/src/pages/register-index.tsx` (all programmes listing)
- **Routes**: Public pages render without the admin sidebar/header (separate layout in App.tsx)
- **URLs**: Slug-based (e.g. `/register/u4-u8-funino`, `/register/academy-u13`)
- **Multi-step form**: Step 1 = Player Details, Step 2 = Guardian Details, Step 3 = Additional Info + Consents
- **Backend flow**: Creates guardian contact (or reuses existing guardian by email), creates player contact, creates relationship, creates registration — all in one POST
- **API**: `GET /api/public/programs` (all active), `GET /api/public/programs/:slug` (individual + club info), `POST /api/public/register` (submit registration)
- **UTM tracking**: Captures utm_source, utm_medium, utm_campaign, utm_content, fbclid, gclid from URL params and stores on registration
- **Conversion tracking**: Meta Pixel (auto-injected if FB Pixel ID configured in settings), Google Ads gtag (fires on submit if configured), Meta CAPI token field available
- **Embed Codes tab**: Settings > Embed Codes lists all programmes with copyable iframe snippets using slug-based URLs
- **Tracking config**: Settings > Integrations now has "Conversion Tracking" section for Meta Pixel ID, Google Ads Conversion ID, Meta CAPI Access Token

## Future Modules (Not Yet Built)
- Stripe payments integration
- Xero invoicing sync
- Klaviyo email marketing
- Meta Conversions API (server-side events)
- Shopify customer matching
- COMET (NZF) adapter
- CSV import/export
- Drag-to-reorder dashboard blocks
