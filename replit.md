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

## Color Theme
- Primary: Deep club blue (HSL 217 91% 35%)
- Gold accent: Warm gold (HSL 42 87% 50%)
- Background: White / light grey
- Font: Inter Tight / Inter

## Data Model
- **users** - Staff users with RBAC roles
- **contacts** - Players, guardians, staff, volunteers, sponsors
- **contactRelationships** - Parent-player linking
- **programs** - Holiday camps, academies, trials, events
- **programSessions** - Individual sessions within programs
- **registrations** - Player-programme registrations with status tracking
- **auditLogs** - System activity tracking

## Key Commands
- `npm run dev` - Start dev server
- `npm run db:push` - Push schema to database
- `npm run build` - Production build

## MVP Modules
1. Dashboard with stats and quick actions
2. Contacts CRUD with parent-player relationships
3. Programme management
4. Registration management
5. Audit log
6. Settings/Integrations overview (stubs)

## Future Modules (Not Yet Built)
- Stripe payments integration
- Xero invoicing sync
- Klaviyo email marketing
- Meta Conversions API
- Shopify customer matching
- COMET (NZF) adapter
- Public registration pages
- CSV import/export
