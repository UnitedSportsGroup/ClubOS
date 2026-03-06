# CUFC ClubOS — Holiday Camps

## Overview
Holiday camp booking and management platform for Christchurch United Football Club. Focused product: public booking pages, Stripe payments, attendance roll, CRM exports, confirmation emails, Meta CAPI.

## Tech Stack
- **Frontend**: React + TypeScript + Vite + wouter (routing)
- **UI**: Tailwind CSS + shadcn/ui components
- **Backend**: Express.js + express-session (bcrypt auth)
- **Database**: PostgreSQL (Neon via Drizzle ORM)
- **State Management**: TanStack React Query
- **Payments**: Stripe Checkout (manual API key integration)
- **Email**: Resend API (optional — logs only if RESEND_API_KEY set)
- **Tracking**: Meta Pixel (client) + Conversions API (server)

## Architecture
- `client/src/` - React frontend
  - `pages/` - Page components:
    - Admin: admin-login, admin-dashboard, admin-camps, admin-camp-detail, admin-registrations, admin-attendance, admin-crm, admin-settings
    - Public: public-landing, camp-page, booking-page, booking-success, booking-cancel
  - `components/` - app-sidebar, ui/ (shadcn)
  - `lib/meta-pixel.ts` - Client-side Meta Pixel tracking
- `server/` - Express backend
  - `routes.ts` - API endpoints (auth, admin/*, public/*, stripe webhook)
  - `storage.ts` - Database storage layer (IStorage interface)
  - `auth.ts` - Session auth with bcrypt + connect-pg-simple
  - `seed.ts` - Seeds admin user + sample camps
  - `stripe.ts` - Stripe Checkout session creation + webhook verification
  - `email.ts` - Resend email sending + confirmation template
  - `meta-capi.ts` - Meta Conversions API server-side events
  - `db.ts` - Database connection
- `shared/schema.ts` - Drizzle schema + Zod validation + TypeScript types

## Auth
- express-session with PgSession store (connect-pg-simple)
- `requireAuth` middleware guards all `/api/admin/*` routes
- Admin login: `daniel@cufc.co.nz` / `Growth2020!` (env `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`)
- Frontend AuthGuard component redirects to /admin/login if not authenticated

## Routing
- `/` — Public landing page (lists active camps)
- `/:slug` — Conversion-focused camp detail page (hero, pricing, FAQ, inclusions)
- `/:slug/book` — Multi-step booking form (parent → children → sessions → Stripe checkout)
- `/:slug/success` — Booking confirmation with payment verification
- `/:slug/cancel` — Booking cancelled
- `/admin/login` — Admin login
- `/admin` — Admin dashboard
- `/admin/camps` — Camp list + create
- `/admin/camps/:id` — Camp detail (tabs: Overview, Content, Dates & Capacity, Pricing, Discounts, Email Template)
- `/admin/registrations` — Registration list with camp filter
- `/admin/attendance` — Attendance roll (camp + date selector, check-in/out)
- `/admin/crm` — CRM export (emails by day, all parents, all registrations as CSV)
- `/admin/settings` — Club settings

## Color Theme
- **Public pages**: Clean white (#FFFFFF) with slate accents, blue-600 CTAs, gradient navy hero sections
- **Admin pages**: Premium midnight blue-black #02060E, glassmorphic panels, blue glow effects
- Custom CSS utilities: glass-card, glass-panel, glow-btn, glow-border, premium-input, row-hover, animate-fade-in-up

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
- **registrations** - Bookings with Stripe fields, pricing in cents, UTM attribution
- **registrationItems** - Individual session bookings
- **attendance** - Check-in/out records
- **emailLogs** - Email send log (idempotency per registration)
- **metaEventLogs** - Meta CAPI event log
- **auditLogs** - System activity tracking
- **settings** - Key-value club configuration

## API Routes
- Auth: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
- Admin: Full CRUD for camps, dates, pricing, discounts, settings, registrations, attendance, CRM export, audit logs
- Public: GET /api/public/camps, GET /api/public/camps/:slug, POST /api/public/book, POST /api/public/book/confirm-free, POST /api/public/confirm-payment, GET /api/public/registrations/:id
- Stripe: POST /api/stripe/webhook

## Payment Flow
1. Parent completes booking form → POST /api/public/book
2. If totalCents > 0 and STRIPE_SECRET_KEY set → creates Stripe Checkout session → redirects to Stripe
3. Stripe redirects to success page with session_id → POST /api/public/confirm-payment verifies payment
4. Webhook (POST /api/stripe/webhook) also confirms payment (backup)
5. On confirmation: updates registration status, sends confirmation email, fires Meta Purchase event

## Environment Variables
- `STRIPE_SECRET_KEY` — Stripe API key (secret, set by user)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (set after deployment)
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
