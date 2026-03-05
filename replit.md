# CUFC ClubOS — Holiday Camps

## Overview
Holiday camp booking and management platform for Christchurch United Football Club. Focused product: public booking pages, Stripe payments, attendance roll, CRM exports, confirmation emails, Meta CAPI.

## Tech Stack
- **Frontend**: React + TypeScript + Vite + wouter (routing)
- **UI**: Tailwind CSS + shadcn/ui components
- **Backend**: Express.js + express-session (bcrypt auth)
- **Database**: PostgreSQL (Neon via Drizzle ORM)
- **State Management**: TanStack React Query

## Architecture
- `client/src/` - React frontend
  - `pages/` - Page components:
    - Admin: admin-login, admin-dashboard, admin-camps, admin-camp-detail, admin-registrations, admin-attendance, admin-crm, admin-settings
    - Public: public-landing, camp-page, booking-page, booking-success, booking-cancel
  - `components/` - app-sidebar, ui/ (shadcn)
- `server/` - Express backend
  - `routes.ts` - API endpoints (auth, admin/*, public/*)
  - `storage.ts` - Database storage layer (IStorage interface)
  - `auth.ts` - Session auth with bcrypt + connect-pg-simple
  - `seed.ts` - Seeds admin user + sample camps
  - `db.ts` - Database connection
- `shared/schema.ts` - Drizzle schema + Zod validation + TypeScript types

## Auth
- express-session with PgSession store (connect-pg-simple)
- `requireAuth` middleware guards all `/api/admin/*` routes
- Admin login: `daniel@cufc.co.nz` / `Growth2020!` (env `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`)
- Frontend AuthGuard component redirects to /admin/login if not authenticated

## Routing
- `/` — Public landing page (lists active camps)
- `/:slug` — Public camp detail page
- `/:slug/book` — Multi-step booking form
- `/:slug/success` — Booking confirmation
- `/:slug/cancel` — Booking cancelled
- `/admin/login` — Admin login
- `/admin` — Admin dashboard
- `/admin/camps` — Camp list + create
- `/admin/camps/:id` — Camp detail (tabs: Overview, Dates & Capacity, Pricing, Discounts, Email Template)
- `/admin/registrations` — Registration list with camp filter
- `/admin/attendance` — Attendance roll (camp + date selector, check-in/out)
- `/admin/crm` — CRM export (emails by day, all parents, all registrations as CSV)
- `/admin/settings` — Club settings

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

## Data Model
- **users** - Staff users with RBAC roles
- **contacts** - Players, guardians, staff, volunteers, sponsors
- **contactRelationships** - Parent-player linking
- **programs** - Holiday camps (type="holiday_camp") with slug, dates, capacity, age range
- **campPricing** - Per-camp pricing (FULL_DAY, MORNING, AFTERNOON) in cents
- **campDates** - Per-day date records with capacity per session type
- **campSettings** - Email template per camp (subject, body with variables, from/reply-to)
- **programDiscounts** - Volume discount tiers (minBookings → discountPercent)
- **children** - Child records linked to parent contacts
- **childMedical** - Medical info per child (allergies, epiPen, notes)
- **registrations** - Bookings with Stripe fields, pricing in cents, UTM attribution
- **registrationItems** - Individual session bookings (child + campDate + productType)
- **attendance** - Check-in/out records per camp date per child
- **emailLogs** - Email send log
- **metaEventLogs** - Meta CAPI event log
- **auditLogs** - System activity tracking
- **settings** - Key-value club configuration

## API Routes
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout
- `GET /api/auth/me` — Current user
- `GET /api/admin/stats` — Dashboard stats
- `GET/POST /api/admin/camps` — Camp CRUD
- `GET/PATCH/DELETE /api/admin/camps/:id` — Camp detail
- `GET/POST /api/admin/camps/:id/dates` — Camp dates
- `PATCH/DELETE /api/admin/camp-dates/:id` — Individual date
- `GET/PUT /api/admin/camps/:id/pricing` — Camp pricing
- `GET/PUT /api/admin/camps/:id/discounts` — Discount tiers
- `GET/PUT /api/admin/camps/:id/settings` — Email settings
- `GET /api/admin/registrations` — Registrations (optional ?campId filter)
- `GET /api/admin/registrations/:id` — Registration detail
- `GET /api/admin/attendance` — Attendance (requires ?campId&campDateId)
- `PATCH /api/admin/attendance/:id` — Toggle check-in/out
- `GET /api/admin/crm/export` — CSV exports (type=emails-by-day|all-parents|all-registrations)
- `GET/PUT /api/admin/settings` — Club settings
- `GET /api/admin/audit-logs` — Audit log
- `GET /api/public/camps` — Active camps list
- `GET /api/public/camps/:slug` — Camp detail with pricing/dates/discounts
- `POST /api/public/book` — Create booking (parent, children, items)
- `POST /api/public/book/confirm-free` — Confirm free bookings

## Public Booking Flow
1. Parent fills contact details (step 1)
2. Add children with medical info (step 2)
3. Select sessions per child per date with live pricing (step 3)
4. Submit → creates contact, children, registration, items, attendance records
5. Redirects to success page

## Pending Features
- T008: Stripe Integration (checkout session + webhook)
- T011: Confirmation Email (Resend API)
- T012: Meta CAPI (server-side events)

## Key Commands
- `npm run dev` - Start dev server
- `npm run db:push` - Push schema to database (interactive — use executeSql for non-interactive)
- `npm run build` - Production build
