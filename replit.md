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
- **programs** - Holiday camps, academies, trials, events
- **programSessions** - Individual sessions within programs
- **registrations** - Player-programme registrations with status tracking
- **auditLogs** - System activity tracking
- **settings** - Key-value club configuration (club info, registration, financial, emails)

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
3. Programme management
4. Registration management
5. Audit log
6. Settings (tabbed: Club Info, Registration, Financial, Emails, Integrations) with persistent key-value storage

## Future Modules (Not Yet Built)
- Stripe payments integration
- Xero invoicing sync
- Klaviyo email marketing
- Meta Conversions API
- Shopify customer matching
- COMET (NZF) adapter
- Public registration pages
- CSV import/export
