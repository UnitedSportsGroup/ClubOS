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
- **Multi-Brand Workspaces**: The platform supports multiple organizations (e.g., Christchurch United, United Sports Centre, Mini Football Leagues) through a workspace context. This allows for tailored features and routing based on the selected organization, enabling modules like VenueFlow for facility hire, League Management, and Tournament Management.
- **Authentication & Roles**: Session-based authentication with `express-session` and `connect-pg-simple` ensures secure access. Role-based access control (RBAC) with roles like `super_admin`, `admin`, and `team_member` governs permissions across various routes and functionalities.
- **Data Model**: The database schema includes tables for users, contacts, programs (camps), pricing, dates, settings, discounts, children, medical information, registrations, attendance, email logs, Meta event logs, audit logs, and analytics events.
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