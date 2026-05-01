# CUFC ClubOS — Holiday Camps

## Overview
CUFC ClubOS is a comprehensive booking and management platform for the Christchurch United Football Club, focusing on holiday camps. It handles public bookings, Stripe payments, generates attendance rolls, facilitates CRM exports, sends confirmation emails, and integrates with the Meta Conversions API. The project aims to be a robust, multi-brand solution for sports and activity management, with future expansion to facility hire, league management, and tournament organization across various sports.

## User Preferences
I prefer detailed explanations of the code and any architectural decisions. When making changes, please prioritize security and data integrity. I value iterative development and would like to be consulted before any major architectural shifts or feature removals. Ensure all new features are thoroughly tested.

## System Architecture
The application employs a client-server architecture.
- **Frontend**: Developed with React, TypeScript, Vite, `wouter` for routing, Tailwind CSS, and `shadcn/ui` for components. State management uses TanStack React Query.
- **Backend**: An Express.js server manages API requests, authentication (`express-session`, `bcrypt`), Stripe integrations, email sending (Resend), and Meta Conversions API events.
- **Database**: PostgreSQL with Drizzle ORM for schema and data interaction.
- **UI/UX**:
    - **Public Pages**: Brand-aligned color scheme (Blue, White, Gold, Dark Blue) with Inter Tight font, conversion-focused design including video embeds, review carousels, and fade-in animations.
    - **Admin Pages**: Midnight blue-black theme with glassmorphic panels and blue glow effects for a professional administrative interface.
- **Multi-Brand Workspaces**: Supports multiple organizations (e.g., Christchurch United, United Sports Centre) with tailored features and routing based on workspace context, enabling modules like VenueFlow, League Management, Tournament Management, and group-level dashboards.
- **Tournament Schedule**: Spreadsheet-style table for tournament schedules, supporting inline editing of game details and grouping by date and stage.
- **Public Tournament API**: Read-only public endpoints for mobile app integration, providing tournament listings, details, groups, teams, games, and standings without authentication.
- **Authentication & Roles**: Session-based authentication using `express-session` and `connect-pg-simple`, with role-based access control (RBAC) for `super_admin`, `admin`, and `team_member` roles.
- **Data Model**: Comprehensive schema including users, contacts, programs, pricing, registrations, attendance, and various logs. Programs of type 'academy' differentiate between 'core' and 'additional' sections.
- **A/B Split Testing**: Allows administrators to test content variants on public camp pages, track conversions, and identify winning variants.
- **Routing**: Manages public camp pages, booking flows, and an extensive admin panel.
- **Payment Flow**: Utilizes Stripe Payment Intents for secure, embedded payment processing, triggering confirmation emails and Meta Purchase events upon success.
- **Attribution Survey**: Post-payment survey to track referral sources, integrated into the booking flow and providing analytics in the admin panel.
- **Refunds (per-item)**: Admin-initiated Stripe refunds at session granularity, allowing selection of individual items for refund with proportional discount application and robust status tracking.
- **Analytics Module**: Provides comprehensive insights through tabbed views covering overview, funnel, revenue, customers, camp performance, engagement, order timing, and attribution.
- **Discounts Module**: Shopify-style discount management with various discount types, usage limits, and integration into the booking process.
- **United Sports Group Workspace**: Group-level workspace with an aggregated dashboard, a Google Calendar-inspired scheduling system with recurring events and financial tracking, and a placeholder for sponsorship management.
- **Facility Photo Galleries (USC)**: Each facility supports a multi-image gallery stored in Replit App Storage. Admins upload photos via drag-and-drop (or file picker) on the Edit Facility modal and reorder them by dragging the thumbnails — the first image is automatically the "main" shown in card previews. The customer-facing /book page renders an image carousel (chevron arrows + dot indicators + touch swipe) on each facility card and a hero-size carousel inside the Configure panel. Uploads run through a single multipart endpoint that authorises org membership *before* parsing the body, then for every file produces TWO optimised variants in parallel using sharp: a WebP (quality 82, universal modern fallback) and an AVIF (quality 55, effort 3 — typically 30-60% smaller than the WebP on real photographic content). Both variants are stored at matching `/objects/uploads/<uuid>.webp` and `/objects/uploads/<uuid>.avif` paths so the frontend can derive the AVIF sibling by extension swap. Pipeline (per variant): auto-rotate via EXIF, fit within 2400×2400, encode, strip metadata. The customer carousel renders each photo inside a `<picture>` element with an AVIF `<source>` and the WebP `<img>` fallback so each browser picks the best format it supports. Per-file cap is 25 MB and per-pixel cap is 50 MP to prevent decode bombs; SVG and animated formats are rejected; partial failures roll back ALL uploaded objects (both formats) to avoid orphans. Public `/objects/*` reads are gated by the object ACL.
- **VenueFlow Public Booking Site (USC)**: Customer-facing booking website served at `/book` (auto-resolves the workspace via the request `Host` header for custom domains like `book.unitedsportscentre.com`, with a `?slug=` fallback for in-app use). Multi-step flow — Choose Facility → Configure (date, start time, duration, full/half field, add-ons, optional multi-day) → Review Cart → Your Details → Stripe PaymentElement → Success page. Server-trusted pricing using per-facility hourly rates (with per-rule overrides), 50%-of-full default for half-field, NZ GST applied on top, and add-ons priced per-hour or per-booking. Real-time availability blocks slots already booked or held in pending bookings (pending bookings auto-expire from blocking after 30 minutes so abandoned carts don't permanently lock slots). Going back from the payment step actively releases the held bookings. The Stripe webhook handles `payment_intent.succeeded` to mark the booking group `paid` and send a Resend confirmation email; `payment_intent.payment_failed` cancels the group. Admins configure the site from a "Booking Site" admin page (title, intro copy, brand colour, opening/closing hours, slot length, advance-booking window, GST rate, contact, footer) and toggle per-facility public visibility, display order, and fallback hourly pricing from the Facilities admin page.
- **Custom Domains**: Enables multi-workspace custom domain mapping with DNS configuration instructions and secure resolution.
- **United Prints Workspace**: Manages signage and print studio operations with modules for orders, projects, CRM, analytics, landing pages, and email campaigns.
- **Currency Formatting**: Shared utility for consistent currency and number formatting across the application.
- **External API v1**: API key-authenticated endpoints for AIOS integration, providing access to various organizational metrics and data.

## External Dependencies
- **Stripe**: Payment processing and webhooks.
- **Resend API**: Transactional email sending.
- **Meta Pixel & Conversions API**: Event tracking and analytics.
- **PostgreSQL (Neon)**: Primary database.
- **Drizzle ORM**: Database interactions.
- **Express.js**: Backend framework.
- **React**: Frontend library.
- **Tailwind CSS**: CSS framework.
- **shadcn/ui**: UI component library.
- **TanStack React Query**: Data fetching and state management.
- **Wistia**: Video embedding.