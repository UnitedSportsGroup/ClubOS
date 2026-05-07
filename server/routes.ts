import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertProgramSchema, insertRegistrationSchema, emailCampaigns, analyticsEvents, splitTests, splitTestVariants, apiKeys, customDomains, organizations, programs as programsTable, facilityBookings, facilities, clubs, projectBoards, projectGroups, projectTasks, sponsorshipDeals, sponsorshipDeliverables, sponsorshipOnboardingTemplates, billboardDeals, leagueCompetitions, leagueDivisions, leagueTeams, leagueGames, leagueTeamMembers, leagueGameReferees, leagueAnnouncements, users as usersTable, terms, campDates, type InsertCalendarCategory } from "@shared/schema";
import { db } from "./db";
import { eq, and, sql, asc, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireSuperAdmin, verifyPassword, hashPassword } from "./auth";
import { createPaymentIntent, retrievePaymentIntent, constructWebhookEvent, createRefund, retrieveRefund } from "./stripe";
import { sendPurchaseEvent } from "./meta-capi";
import { sendConfirmationEmail } from "./email";
import { buildCICSchedule } from "./tournament-schedule";
import crypto from "crypto";
import { ObjectStorageService, ObjectNotFoundError, setObjectAclPolicy } from "./replit_integrations/object_storage";
import multer from "multer";
import sharp from "sharp";
import { detectDnsProvider, getCnameHost, getApexDomain } from "./dns/detectProvider";
import { isGoDaddyConfigured, checkConnection as checkGoDaddyConnection, setCnameRecord as setGoDaddyCname, ownsDomain as goDaddyOwnsDomain, getRecords as getGoDaddyRecords, setForwarding as setGoDaddyForwarding, getForwarding as getGoDaddyForwarding } from "./dns/godaddyClient";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });
      const user = await storage.getUserByEmail(email);
      if (!user || !user.active) return res.status(401).json({ message: "Invalid credentials" });
      const valid = await verifyPassword(password, user.password);
      if (!valid) return res.status(401).json({ message: "Invalid credentials" });
      req.session.userId = user.id;
      res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  // Google sign-in. Client (mobile or web) gets a Google ID token via
  // expo-auth-session / Google Identity, posts it here. We verify the token
  // against Google's tokeninfo endpoint, then either match an existing user
  // (by googleId, then by email) or create a new account with no password.
  app.post("/api/auth/google", async (req, res) => {
    try {
      const idToken: string | undefined = req.body?.idToken;
      if (!idToken) return res.status(400).json({ message: "idToken required" });

      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!r.ok) return res.status(401).json({ message: "Invalid Google token" });
      const info: { sub: string; email?: string; email_verified?: string | boolean; given_name?: string; family_name?: string; name?: string; aud?: string } = await r.json();
      if (!info.sub || !info.email) return res.status(401).json({ message: "Google token missing identity" });
      if (info.email_verified === false || info.email_verified === "false") {
        return res.status(401).json({ message: "Google email not verified" });
      }

      // Optional audience check — only enforce if env var is set so dev with
      // multiple Google clients (iOS/web) doesn't break.
      const expectedAud = process.env.GOOGLE_OAUTH_CLIENT_IDS;
      if (expectedAud) {
        const allowed = expectedAud.split(",").map(s => s.trim()).filter(Boolean);
        if (!info.aud || !allowed.includes(info.aud)) {
          return res.status(401).json({ message: "Google token audience not allowed" });
        }
      }

      // 1) Match by googleId (most stable). 2) Fall back to email + link.
      // 3) Create new account.
      let [user] = await db.select().from(usersTable).where(eq(usersTable.googleId, info.sub));
      if (!user) {
        const emailLower = info.email.toLowerCase();
        const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, emailLower));
        if (byEmail) {
          [user] = await db.update(usersTable).set({ googleId: info.sub }).where(eq(usersTable.id, byEmail.id)).returning();
        } else {
          const firstName = info.given_name || info.name?.split(" ")[0] || "Player";
          const lastName = info.family_name || info.name?.split(" ").slice(1).join(" ") || "";
          // Random unusable password — Google users never need it, but the
          // column is NOT NULL so we generate something they'll never know.
          const placeholder = await hashPassword(`google-${info.sub}-${Date.now()}-${Math.random()}`);
          [user] = await db.insert(usersTable).values({
            email: emailLower,
            firstName,
            lastName,
            password: placeholder,
            googleId: info.sub,
            role: "coach",
          }).returning();
        }
      }

      if (!user.active) return res.status(403).json({ message: "Account disabled" });

      req.session.userId = user.id;
      res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role });
    } catch (e: any) {
      console.error("[google-auth]", e);
      res.status(500).json({ message: e.message || "Google sign-in failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    const orgs = await storage.getUserOrganizations(req.session.userId);
    res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, organizations: orgs });
  });

  app.patch("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const updates: any = {};
      if (req.body.firstName !== undefined) updates.firstName = req.body.firstName;
      if (req.body.lastName !== undefined) updates.lastName = req.body.lastName;
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No fields to update" });
      const updated = await storage.updateUser(req.session.userId!, updates);
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ id: updated.id, email: updated.email, firstName: updated.firstName, lastName: updated.lastName, role: updated.role });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/users", requireSuperAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers.map(u => ({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, active: u.active, createdAt: u.createdAt })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Team management — used by /admin/team. Returns every user with their
  // per-workspace memberships so the UI can show which orgs each person
  // can access and at what role.
  app.get("/api/admin/team", requireSuperAdmin, async (_req, res) => {
    try {
      const all = await storage.getAllUsersWithMemberships();
      res.json(all.map(u => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        globalRole: u.role,
        active: u.active,
        createdAt: u.createdAt,
        memberships: u.memberships,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Per-user detail (memberships included) for the edit modal
  app.get("/api/admin/team/:id", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "Not found" });
      const memberships = await storage.getUserOrganizations(userId);
      res.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        globalRole: user.role,
        active: user.active,
        memberships: memberships.map(m => ({ orgId: m.id, orgName: m.name, orgSlug: m.slug, role: m.userRole })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a user + add memberships in one call. This is the primary
  // onboarding endpoint. Body:
  //   { email, firstName, lastName, password, globalRole, memberships: [{orgId, role}] }
  // The user gets globalRole 'admin' by default (NOT super_admin), then
  // their actual access is governed by which workspaces they're in.
  app.post("/api/admin/team", requireSuperAdmin, async (req, res) => {
    try {
      const { email, firstName, lastName, password, globalRole, memberships, sendWelcomeEmail } = req.body;
      if (!email || !firstName || !lastName || !password) {
        return res.status(400).json({ message: "email, firstName, lastName, and password are required" });
      }
      if (!Array.isArray(memberships) || memberships.length === 0) {
        return res.status(400).json({ message: "At least one workspace membership is required" });
      }
      const validRoles = ["super_admin", "admin", "team_member", "manager", "coach", "finance", "marketing", "registrar"];
      const finalGlobalRole = globalRole || "admin";
      if (!validRoles.includes(finalGlobalRole)) {
        return res.status(400).json({ message: `Invalid global role: ${finalGlobalRole}` });
      }
      for (const m of memberships) {
        if (!m.orgId || !m.role) return res.status(400).json({ message: "Each membership needs orgId and role" });
        if (!validRoles.includes(m.role)) return res.status(400).json({ message: `Invalid workspace role: ${m.role}` });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "A user with this email already exists" });

      const hashed = await hashPassword(password);
      const user = await storage.createUser({
        email, firstName, lastName, password: hashed,
        role: finalGlobalRole as any,
        active: true,
      });
      for (const m of memberships) {
        await storage.addUserToOrganization(user.id, m.orgId, m.role);
      }

      // Optional welcome email — fire-and-forget
      if (sendWelcomeEmail) {
        const orgNames = (await storage.getUserOrganizations(user.id)).map(o => o.name);
        await sendTeamInviteEmail({ email, firstName, password, orgNames });
      }

      res.json({
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
        globalRole: user.role, active: user.active,
        memberships: (await storage.getUserOrganizations(user.id)).map(o => ({ orgId: o.id, orgName: o.name, orgSlug: o.slug, role: o.userRole })),
      });
    } catch (error: any) {
      console.error("[Team create] failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Manage individual workspace memberships
  app.post("/api/admin/team/:id/memberships", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const { orgId, role } = req.body;
      if (!orgId || !role) return res.status(400).json({ message: "orgId and role required" });
      const created = await storage.addUserToOrganization(userId, orgId, role);
      res.json(created);
    } catch (error: any) {
      // duplicate membership
      if (error?.code === "23505") {
        return res.status(409).json({ message: "User already has access to this workspace" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/team/:id/memberships/:orgId", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const orgId = parseInt(req.params.orgId);
      const { role } = req.body;
      if (!role) return res.status(400).json({ message: "role required" });
      const updated = await storage.updateUserOrgRole(userId, orgId, role);
      if (!updated) return res.status(404).json({ message: "Membership not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/team/:id/memberships/:orgId", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const orgId = parseInt(req.params.orgId);
      await storage.removeUserFromOrganization(userId, orgId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Reset a team member's password. Generates a new temp password (or uses
  // the one passed in the body), hashes it, saves it, optionally emails it.
  // Super-admin only — no self-service password reset for now (low priority
  // for an internal-tool with <10 users).
  app.post("/api/admin/team/:id/reset-password", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const newPassword = (req.body?.password as string) || generateTempPassword();
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const hashed = await hashPassword(newPassword);
      await storage.updateUser(userId, { password: hashed });

      // Optionally email the user the new credentials
      const sendEmailFlag = req.body?.sendEmail !== false;  // default true
      let emailSent = false;
      if (sendEmailFlag && user.email) {
        const orgNames = (await storage.getUserOrganizations(userId)).map(o => o.name);
        emailSent = await sendPasswordResetEmail({
          email: user.email,
          firstName: user.firstName,
          password: newPassword,
          orgNames,
        });
      }

      // Return the password so the admin can also share it via Slack/text
      // if needed. This is fine here because this endpoint is super-admin
      // gated and the response goes back to the admin who issued the reset.
      res.json({ ok: true, password: newPassword, emailSent });
    } catch (error: any) {
      console.error("[Team reset-password] failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Re-send the welcome email with a new temp password. Use this when the
  // first email didn't deliver. Same logic as reset-password but framed
  // differently in the UI.
  app.post("/api/admin/team/:id/resend-invite", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const newPassword = generateTempPassword();
      const hashed = await hashPassword(newPassword);
      await storage.updateUser(userId, { password: hashed });

      const orgNames = (await storage.getUserOrganizations(userId)).map(o => o.name);
      const emailSent = await sendTeamInviteEmail({
        email: user.email,
        firstName: user.firstName,
        password: newPassword,
        orgNames,
      });

      res.json({ ok: true, password: newPassword, emailSent });
    } catch (error: any) {
      console.error("[Team resend-invite] failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users", requireSuperAdmin, async (req, res) => {
    try {
      const { email, firstName, lastName, password, role } = req.body;
      if (!email || !firstName || !lastName || !password) {
        return res.status(400).json({ message: "email, firstName, lastName, and password are required" });
      }
      const validRoles = ["super_admin", "admin", "team_member", "manager", "coach", "finance", "marketing", "registrar"];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role: ${role}` });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "A user with this email already exists" });

      const hashed = await hashPassword(password);
      const user = await storage.createUser({ email, firstName, lastName, password: hashed, role: role || "team_member", active: true });
      res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, active: user.active });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/users/:id", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const updates: any = {};
      if (req.body.role) {
        const validRoles = ["super_admin", "admin", "team_member", "manager", "coach", "finance", "marketing", "registrar"];
        if (!validRoles.includes(req.body.role)) {
          return res.status(400).json({ message: `Invalid role: ${req.body.role}` });
        }
        updates.role = req.body.role;
      }
      if (req.body.firstName) updates.firstName = req.body.firstName;
      if (req.body.lastName) updates.lastName = req.body.lastName;
      if (req.body.email) updates.email = req.body.email;
      if (typeof req.body.active === "boolean") updates.active = req.body.active;
      if (req.body.password) updates.password = await hashPassword(req.body.password);

      const updated = await storage.updateUser(userId, updates);
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ id: updated.id, email: updated.email, firstName: updated.firstName, lastName: updated.lastName, role: updated.role, active: updated.active });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/users/:id", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (req.session.userId === userId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      await storage.deleteUser(userId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/stats", requireAuth, async (_req, res) => {
    try {
      const stats = await storage.getCampStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps", requireAuth, async (_req, res) => {
    try {
      const all = await storage.getPrograms();
      const camps = all.filter(p => p.type === "holiday_camp");
      res.json(camps);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Generic programs endpoint — same underlying table as camps/academy but
  // returns whatever the workspace needs. Used by United Gymnastics (and
  // future workspaces) where the program isn't a 'holiday_camp' or
  // 'academy' but uses the same programs/registrations infrastructure.
  app.get("/api/admin/programs", requireAuth, async (req, res) => {
    try {
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
      const type = req.query.type as string | undefined;
      const all = await storage.getPrograms();
      const filtered = all.filter(p => {
        if (orgId && p.organizationId !== orgId) return false;
        if (type && p.type !== type) return false;
        return true;
      });
      res.json(filtered);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/programs", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.organizationId) return res.status(400).json({ message: "organizationId required" });
      if (!data.type) data.type = "open_training";

      // Term-bound programs auto-populate start/end + session count from
      // the linked term so the admin doesn't have to copy dates manually.
      if (data.scheduleType === "term" && data.termId) {
        const { db } = await import("./db");
        const { terms } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [term] = await db.select().from(terms).where(eq(terms.id, data.termId));
        if (!term) return res.status(400).json({ message: "Term not found" });
        if (term.organizationId !== data.organizationId) {
          return res.status(400).json({ message: "Term belongs to a different workspace" });
        }
        if (!data.startDate) data.startDate = term.startDate;
        if (!data.endDate) data.endDate = term.endDate;
        if (!data.sessionCount) {
          const a = new Date(term.startDate + "T00:00:00").getTime();
          const b = new Date(term.endDate + "T00:00:00").getTime();
          data.sessionCount = Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24 * 7)) + 1);
        }
      }

      // Convert dollar amounts to cents if termPriceCents arrived as a
      // dollar value (defensive — keep cents-only on the wire long term).
      if (data.termPrice && !data.termPriceCents) {
        data.termPriceCents = Math.round(parseFloat(data.termPrice) * 100);
        delete data.termPrice;
      }

      const program = await storage.createProgram(data);
      await storage.createAuditLog({
        userId: req.session.userId,
        action: "create",
        entity: "program",
        entityId: program.id,
        details: `Created ${data.type} program: ${program.name}`,
      });
      res.status(201).json(program);
    } catch (error: any) {
      // Surface unique-constraint violations (now per-org on slug) as a
      // human-readable conflict instead of dumping the raw SQL.
      if (error?.code === "23505") {
        return res.status(409).json({
          message: `A program with that slug already exists in this workspace. Pick a different slug, or open the existing program from your Programs list.`,
        });
      }
      res.status(400).json({ message: error.message });
    }
  });

  // Program options — admin CRUD. Each option is a priced package on a
  // class-mode program (e.g. Beginner Thursday / Saturday / Combo).
  app.get("/api/admin/programs/:id/options", requireAuth, async (req, res) => {
    try {
      const list = await storage.getProgramOptions(parseInt(req.params.id));
      res.json(list);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/admin/programs/:id/options", requireAuth, async (req, res) => {
    try {
      const programId = parseInt(req.params.id);
      const r = await storage.createProgramOption({ ...req.body, programId } as any);
      res.status(201).json(r);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.patch("/api/admin/program-options/:id", requireAuth, async (req, res) => {
    try {
      const r = await storage.updateProgramOption(parseInt(req.params.id), req.body);
      if (!r) return res.status(404).json({ message: "Not found" });
      res.json(r);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/admin/program-options/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteProgramOption(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Public — list options for a program (the registration-page picker).
  app.get("/api/public/programs/:slug/options", async (req, res) => {
    try {
      const program = await storage.getProgramBySlug(req.params.slug);
      if (!program || !program.isActive) return res.status(404).json({ message: "Program not found" });
      const list = await storage.getProgramOptions(program.id, { activeOnly: true });
      res.json({ programId: program.id, options: list });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Public class-registration intent — single endpoint that creates the
  // contact records, the registration row, and the Stripe PaymentIntent
  // in one shot. Server-side re-quotes pricing so the client can never
  // spoof the amount paid. After Stripe confirms the PaymentIntent, the
  // webhook flips the registration to 'confirmed' and fires confirmation.
  app.post("/api/public/class-registrations/intent", async (req, res) => {
    try {
      const {
        programSlug,
        programOptionId,
        paymentMode,  // 'upfront' | 'weekly'
        parent: { firstName, lastName, email, phone },
        child: { firstName: childFirst, lastName: childLast, dateOfBirth },
        notes,
        utm,
      } = req.body || {};

      if (!programSlug || !firstName || !lastName || !email || !phone || !childFirst || !childLast) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Look up program + linked term, server-side quote
      const program = await storage.getProgramBySlug(programSlug);
      if (!program || !program.isActive) return res.status(404).json({ message: "Program not found" });
      if (program.scheduleType !== "term") return res.status(400).json({ message: "This program isn't a class" });

      let term = null;
      if (program.termId) {
        const { db } = await import("./db");
        const { terms } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [t] = await db.select().from(terms).where(eq(terms.id, program.termId));
        term = t ?? null;
      }

      // If a programOptionId was passed, build a synthetic 'program' that
      // overrides termPriceCents + sessionCount with the option's values
      // before quoting. This keeps quoteProgram() unchanged while letting
      // us price each option independently.
      let option = null;
      let priceProgram: any = program;
      if (programOptionId) {
        option = await storage.getProgramOption(parseInt(programOptionId));
        if (!option || option.programId !== program.id) {
          return res.status(400).json({ message: "Invalid option for this program" });
        }
        if (!option.isActive) return res.status(400).json({ message: "That option isn't available" });
        priceProgram = {
          ...program,
          termPriceCents: option.fullPriceCents,
          sessionCount: option.sessionCount ?? program.sessionCount,
          pricingModel: option.pricingModel,
        };
      }

      const { quoteProgram } = await import("./program-pricing");
      const quote = quoteProgram(priceProgram, term);
      if (quote.payNowCents <= 0) {
        return res.status(400).json({ message: quote.reason });
      }

      // Weekly subscription branch — only available when an option opts in.
      const isWeekly = paymentMode === "weekly" && option?.allowPayWeekly;
      if (paymentMode === "weekly" && !option?.allowPayWeekly) {
        return res.status(400).json({ message: "Weekly payment isn't available for this option" });
      }

      // Create / find guardian + child contacts
      let guardian = await storage.getContactByEmail?.(email);
      if (!guardian) {
        guardian = await storage.createContact({
          type: "guardian",
          firstName, lastName, email, phone,
          newsletterConsent: true,
        } as any);
      }
      const child = await storage.createContact({
        type: "player",
        firstName: childFirst,
        lastName: childLast,
        dateOfBirth: dateOfBirth || null,
      } as any);
      // Link guardian → child
      await storage.createContactRelationship?.({
        guardianId: guardian.id,
        playerId: child.id,
        relationship: "parent",
        isPrimaryContact: true,
      } as any);

      // Pay-mode-specific Stripe setup
      const { stripe } = await import("./stripe");
      const optionLabel = option ? ` (${option.name})` : "";

      // Compute the weekly price for the subscription branch.
      // weekly_price = full_price / total_sessions, rounded.
      const weeklyPriceCents = isWeekly
        ? (option?.weeklyPriceCents ?? Math.round((option?.fullPriceCents ?? 0) / (option?.sessionCount ?? quote.totalSessions)))
        : 0;

      // Create the registration row in 'pending' state
      const reg = await storage.createRegistration({
        programId: program.id,
        programOptionId: option?.id ?? null,
        paymentMode: isWeekly ? "weekly" : "upfront",
        contactId: child.id,
        guardianId: guardian.id,
        status: "pending",
        amountPaid: "0",
        subtotalCents: isWeekly ? weeklyPriceCents : quote.payNowCents,
        discountCents: quote.discountCents,
        totalCents: isWeekly ? weeklyPriceCents : quote.payNowCents,
        currency: "NZD",
        notes: notes || null,
        utmSource: utm?.source || null,
        utmMedium: utm?.medium || null,
        utmCampaign: utm?.campaign || null,
        utmContent: utm?.content || null,
        fbclid: utm?.fbclid || null,
        gclid: utm?.gclid || null,
        registrationLocation: "online",
      } as any);

      const sharedMetadata = {
        registrationId: String(reg.id),
        programId: String(program.id),
        programSlug,
        registrationType: "class",
        parentEmail: email,
        childName: `${childFirst} ${childLast}`,
        ...(option ? { programOptionId: String(option.id), optionName: option.name } : {}),
        ...(term ? { termId: String(term.id) } : {}),
      };

      let clientSecret: string | null;
      let paymentIntentId: string | null = null;
      let subscriptionId: string | null = null;

      if (isWeekly) {
        // Stripe Subscription — bills `weeklyPriceCents` every week for
        // up to `totalSessions` cycles. Customer charged immediately for
        // week 1; subsequent weeks auto-charge.
        const customer = await stripe.customers.create({
          email,
          name: `${firstName} ${lastName}`,
          metadata: sharedMetadata,
        });
        const product = await stripe.products.create({
          name: `${program.name}${optionLabel}`,
          metadata: sharedMetadata,
        });
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: weeklyPriceCents,
          currency: "nzd",
          recurring: { interval: "week" },
        });
        const subscription = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: price.id }],
          payment_behavior: "default_incomplete",
          payment_settings: { save_default_payment_method: "on_subscription" },
          expand: ["latest_invoice.payment_intent"],
          metadata: sharedMetadata,
          // Cancel after totalSessions cycles
          cancel_at: Math.floor(Date.now() / 1000) + (option?.sessionCount ?? quote.totalSessions) * 7 * 24 * 60 * 60,
        });
        const latestInvoice: any = subscription.latest_invoice;
        const pi = latestInvoice?.payment_intent;
        clientSecret = pi?.client_secret ?? null;
        paymentIntentId = pi?.id ?? null;
        subscriptionId = subscription.id;
        await storage.updateRegistration(reg.id, {
          stripeSubscriptionId: subscription.id,
          stripePaymentIntentId: paymentIntentId,
        } as any);
      } else {
        // One-shot PaymentIntent for upfront payment
        const paymentIntent = await stripe.paymentIntents.create({
          amount: quote.payNowCents,
          currency: "nzd",
          receipt_email: email,
          description: `${program.name}${optionLabel}${term ? ` — Term ${term.termNumber} ${term.year}` : ""}`,
          automatic_payment_methods: { enabled: true },
          metadata: sharedMetadata,
        });
        clientSecret = paymentIntent.client_secret;
        paymentIntentId = paymentIntent.id;
        await storage.updateRegistration(reg.id, {
          stripePaymentIntentId: paymentIntent.id,
        } as any);
      }

      res.json({
        registrationId: reg.id,
        clientSecret,
        paymentIntentId,
        subscriptionId,
        paymentMode: isWeekly ? "weekly" : "upfront",
        quote: {
          fullPriceCents: quote.fullPriceCents,
          payNowCents: isWeekly ? weeklyPriceCents : quote.payNowCents,
          discountCents: quote.discountCents,
          sessionsRemaining: quote.sessionsRemaining,
          totalSessions: quote.totalSessions,
          reason: isWeekly
            ? `${weeklyPriceCents > 0 ? `$${(weeklyPriceCents / 100).toFixed(2)}/week` : ""} × ${option?.sessionCount ?? quote.totalSessions} weeks`
            : quote.reason,
          weeklyPriceCents,
        },
        option: option ? { id: option.id, name: option.name, scheduleText: option.scheduleText } : null,
        program: { name: program.name, slug: program.slug },
        term: term ? { name: term.name, termNumber: term.termNumber, year: term.year, startDate: term.startDate, endDate: term.endDate } : null,
      });
    } catch (e: any) {
      console.error("[Class registration intent] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // Public program quote — used by the public registration page to show
  // a live pro-rated price ('$200 → $100, 5 of 10 sessions remaining').
  // Server is the source of truth; client uses this endpoint for display
  // and we re-validate the same value before charging Stripe.
  // Newsletter / wait-list capture from the Newsletter block on program pages.
  // For v1 we just log and email the workspace owner — no table yet. When a
  // pattern emerges we can add a real subscribers table.
  app.post("/api/public/newsletter", async (req, res) => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const name = String(req.body?.name ?? "").trim();
      const listId = String(req.body?.listId ?? "default").trim();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ message: "Please enter a valid email." });
      }
      const referer = req.get("referer") || "";
      const userAgent = req.get("user-agent") || "";
      console.log(`[newsletter] capture: ${email} (${name || "no name"}) list=${listId} from=${referer}`);
      try {
        const { sendEmail } = await import("./email");
        await sendEmail({
          to: process.env.NEWSLETTER_NOTIFY_TO || "danielmeyn963@gmail.com",
          subject: `New newsletter signup: ${email}`,
          html: `
            <p>A new email was captured from a program landing page.</p>
            <ul>
              <li><strong>Email:</strong> ${email}</li>
              ${name ? `<li><strong>Name:</strong> ${name}</li>` : ""}
              <li><strong>List:</strong> ${listId}</li>
              <li><strong>Page:</strong> ${referer || "(unknown)"}</li>
              <li><strong>User-Agent:</strong> ${userAgent}</li>
            </ul>
          `,
        });
      } catch (e) {
        console.warn("[newsletter] email notify failed:", e);
        // Don't fail the request if the notification fails — we already logged it.
      }
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[newsletter] error:", error);
      res.status(500).json({ message: error.message || "Couldn't sign up — please try again." });
    }
  });

  app.get("/api/public/program-quote/:slug", async (req, res) => {
    try {
      const programs = await storage.getPrograms();
      const program = programs.find(p => p.slug === req.params.slug);
      if (!program || !program.isActive) return res.status(404).json({ message: "Program not found" });

      let term = null;
      if (program.termId) {
        const { db } = await import("./db");
        const { terms } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [t] = await db.select().from(terms).where(eq(terms.id, program.termId));
        term = t ?? null;
      }

      const { quoteProgram } = await import("./program-pricing");
      const quote = quoteProgram(program, term);
      res.json({
        program: {
          id: program.id,
          name: program.name,
          slug: program.slug,
          scheduleType: program.scheduleType,
          startDate: program.startDate,
          endDate: program.endDate,
          sessionCount: program.sessionCount,
        },
        term: term ? { id: term.id, year: term.year, termNumber: term.termNumber, name: term.name, startDate: term.startDate, endDate: term.endDate } : null,
        quote,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Terms — org-scoped school/program term calendar (NZ school terms etc.)
  app.get("/api/admin/terms", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const list = await storage.getTerms(orgId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/terms", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      if (!data.organizationId) return res.status(400).json({ message: "organizationId required" });
      if (!data.year || !data.termNumber || !data.startDate || !data.endDate) {
        return res.status(400).json({ message: "year, termNumber, startDate, endDate are required" });
      }
      const term = await storage.createTerm(data);
      res.status(201).json(term);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "A term with that year + term number already exists for this organisation" });
      }
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/terms/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const term = await storage.updateTerm(id, req.body);
      if (!term) return res.status(404).json({ message: "Term not found" });
      res.json(term);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/terms/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTerm(parseInt(req.params.id));
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/registration-counts", requireAuth, async (_req, res) => {
    try {
      const counts = await storage.getCampRegistrationCounts();
      res.json(counts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/camps", requireAuth, async (req, res) => {
    try {
      const data = { ...req.body };
      // Default to holiday_camp for backwards compat. The frontend Mode toggle
      // sends scheduleType="term" + type="academy" (or another non-holiday
      // type) for term-mode programs.
      if (!data.type) data.type = "holiday_camp";

      // Term auto-fill — mirrors the gymnastics /programs route. When the
      // camp is bound to a term, copy startDate/endDate/sessionCount from
      // the term so the admin doesn't have to re-type.
      if (data.scheduleType === "term" && data.termId) {
        const [term] = await db.select().from(terms).where(eq(terms.id, data.termId));
        if (!term) return res.status(400).json({ message: "Term not found" });
        if (data.organizationId && term.organizationId !== data.organizationId) {
          return res.status(400).json({ message: "Term belongs to a different workspace" });
        }
        if (!data.startDate) data.startDate = term.startDate;
        if (!data.endDate) data.endDate = term.endDate;
        if (!data.sessionCount) {
          const a = new Date(term.startDate + "T00:00:00").getTime();
          const b = new Date(term.endDate + "T00:00:00").getTime();
          data.sessionCount = Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24 * 7)) + 1);
        }
      }

      // Defensive: dollar→cents conversion if the form posts dollars
      if (data.termPrice && !data.termPriceCents) {
        data.termPriceCents = Math.round(parseFloat(data.termPrice) * 100);
        delete data.termPrice;
      }

      const camp = await storage.createProgram(data);
      await storage.createAuditLog({ userId: req.session.userId, action: "create", entity: "camp", entityId: camp.id, details: `Created camp: ${camp.name}` });
      res.status(201).json(camp);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/academy", requireAuth, async (_req, res) => {
    try {
      const all = await storage.getPrograms();
      const academy = all.filter(p => p.type === "academy");
      const sectionRows = await db.execute(sql`SELECT id, academy_section FROM programs WHERE type = 'academy'`);
      const sectionMap: Record<number, string> = {};
      for (const row of sectionRows.rows) {
        sectionMap[(row as any).id] = (row as any).academy_section || "core";
      }
      const enriched = academy.map((p: any) => ({
        ...p,
        academySection: sectionMap[p.id] || "core",
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/academy/registration-counts", requireAuth, async (_req, res) => {
    try {
      const counts = await storage.getCampRegistrationCounts();
      res.json(counts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/academy", requireAuth, async (req, res) => {
    try {
      const { academySection, ...rest } = req.body;
      const data = { ...rest, type: "academy" };
      const program = await storage.createProgram(data);
      const section = academySection === "additional" ? "additional" : "core";
      await db.execute(sql`UPDATE programs SET academy_section = ${section} WHERE id = ${program.id}`);
      await storage.createAuditLog({ userId: req.session.userId, action: "create", entity: "academy", entityId: program.id, details: `Created academy program: ${program.name}` });
      res.status(201).json({ ...program, academySection: section });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id", requireAuth, async (req, res) => {
    try {
      const camp = await storage.getProgram(parseInt(req.params.id));
      if (!camp) return res.status(404).json({ message: "Camp not found" });
      res.json(camp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/camps/:id", requireAuth, async (req, res) => {
    try {
      const camp = await storage.updateProgram(parseInt(req.params.id), req.body);
      if (!camp) return res.status(404).json({ message: "Camp not found" });
      res.json(camp);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/camps/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteProgram(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id/dates", requireAuth, async (req, res) => {
    try {
      const dates = await storage.getCampDates(parseInt(req.params.id));
      res.json(dates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id/sessions-summary", requireAuth, async (req, res) => {
    try {
      const campId = parseInt(req.params.id);
      const summary = await storage.getSessionsSummary(campId);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id/session-roll", requireAuth, async (req, res) => {
    try {
      const campId = parseInt(req.params.id);
      const campDateId = parseInt(req.query.campDateId as string);
      const sessionType = req.query.sessionType as string;
      if (!campDateId || !sessionType) return res.status(400).json({ message: "campDateId and sessionType required" });
      const roll = await storage.getSessionRoll(campId, campDateId, sessionType);
      res.json(roll);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/attendance/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data: any = { ...req.body };
      if (data.checkedInAt) data.checkedInAt = new Date(data.checkedInAt);
      if (data.checkedOutAt) data.checkedOutAt = new Date(data.checkedOutAt);
      const updated = await storage.updateAttendance(id, data);
      if (!updated) return res.status(404).json({ message: "Attendance record not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id/stats", requireAuth, async (req, res) => {
    try {
      const campId = parseInt(req.params.id);
      const stats = await storage.getCampRegistrationStats(campId);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/camps/:id/dates", requireAuth, async (req, res) => {
    try {
      const campId = parseInt(req.params.id);
      const d = await storage.createCampDate({ ...req.body, campId });
      res.status(201).json(d);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Bulk-generate weekly class sessions for a term-bound program. Walks the
  // linked term's date range and creates one camp_date row for every
  // matching (day, slot) combination — supports multiple slots in a single
  // call, e.g. Mon-Fri 4:30-5:15pm + Sat 9:30-10:15am (Age 4-6) +
  // Sat 10:30-11:15am (Age 7-8) for the U4-U8 academy.
  //
  // Body (preferred):
  //   { slots: Array<{ daysOfWeek: number[], startTime: "HH:MM",
  //                    endTime: "HH:MM", capacity?: number, name?: string }>,
  //     replaceExisting?: boolean,
  //     persistPattern?: boolean }
  // Body (legacy single-slot, kept for backwards compat):
  //   { dayOfWeek, startTime, endTime, capacity, replaceExisting }
  app.post("/api/admin/camps/:id/dates/generate-from-term", requireAuth, async (req, res) => {
    try {
      const campId = parseInt(req.params.id);
      const body = req.body ?? {};

      // Normalise legacy single-slot body into the new shape.
      let slots: Array<{ daysOfWeek: number[]; startTime: string; endTime: string; capacity?: number | null; name?: string | null }> = [];
      if (Array.isArray(body.slots) && body.slots.length > 0) {
        slots = body.slots;
      } else if (typeof body.dayOfWeek === "number") {
        slots = [{
          daysOfWeek: [body.dayOfWeek],
          startTime: body.startTime,
          endTime: body.endTime,
          capacity: body.capacity ?? null,
          name: body.name ?? null,
        }];
      }
      if (slots.length === 0) {
        return res.status(400).json({ message: "Provide slots[] or legacy dayOfWeek/startTime/endTime" });
      }
      for (const s of slots) {
        if (!Array.isArray(s.daysOfWeek) || s.daysOfWeek.length === 0) {
          return res.status(400).json({ message: "Each slot needs at least one day-of-week" });
        }
        if (s.daysOfWeek.some(d => typeof d !== "number" || d < 0 || d > 6)) {
          return res.status(400).json({ message: "daysOfWeek must contain 0..6 (Sun=0)" });
        }
        if (!s.startTime || !s.endTime) {
          return res.status(400).json({ message: "Each slot needs startTime and endTime" });
        }
      }

      const program = await storage.getProgram(campId);
      if (!program) return res.status(404).json({ message: "Program not found" });
      if (!program.termId) return res.status(400).json({ message: "Program is not linked to a term" });

      const [term] = await db.select().from(terms).where(eq(terms.id, program.termId));
      if (!term) return res.status(404).json({ message: "Linked term not found" });

      // Refuse to wipe existing dates if any have linked registrations.
      // The Daniel-style guard: protect parents who already paid.
      if (body.replaceExisting) {
        const existing = await storage.getCampDates(campId);
        for (const d of existing) {
          const reg = await storage.getRegistrationsByCampDate?.(d.id);
          if (reg && reg.length > 0) {
            return res.status(409).json({
              message: "Cannot regenerate — one or more existing sessions already have registrations. Cancel/refund those first or generate without replacing.",
            });
          }
        }
        await db.delete(campDates).where(eq(campDates.campId, campId));
      }

      const generated: any[] = [];
      const start = new Date(term.startDate + "T00:00:00");
      const end = new Date(term.endDate + "T00:00:00");
      // Walk every day of the term ONCE, then for each day check every slot.
      const cursor = new Date(start);
      while (cursor <= end) {
        const dow = cursor.getDay();
        const dateStr = cursor.toISOString().split("T")[0];
        for (const slot of slots) {
          if (slot.daysOfWeek.includes(dow)) {
            const created = await storage.createCampDate({
              campId,
              date: dateStr,
              capacityFullDay: slot.capacity ?? null,
              capacityMorning: null,
              capacityAfternoon: null,
              startTime: slot.startTime,
              endTime: slot.endTime,
              name: slot.name ?? null,
            } as any);
            generated.push(created);
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      // Optionally remember the schedule pattern on the program so re-generating
      // after a term-date change doesn't require re-typing the slots.
      if (body.persistPattern !== false) {
        await storage.updateProgram(campId, {
          weeklyPatternJson: JSON.stringify(slots),
        } as any);
      }

      res.status(201).json({ count: generated.length, dates: generated });
    } catch (error: any) {
      console.error("[Class generate] failed:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/camp-dates/:id", requireAuth, async (req, res) => {
    try {
      const d = await storage.updateCampDate(parseInt(req.params.id), req.body);
      if (!d) return res.status(404).json({ message: "Date not found" });
      res.json(d);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/camp-dates/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteCampDate(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id/pricing", requireAuth, async (req, res) => {
    try {
      const pricing = await storage.getCampPricing(parseInt(req.params.id));
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/admin/camps/:id/pricing", requireAuth, async (req, res) => {
    try {
      const campId = parseInt(req.params.id);
      const pricing = await storage.setCampPricing(campId, req.body.map((p: any) => ({ ...p, campId })));
      res.json(pricing);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id/discounts", requireAuth, async (req, res) => {
    try {
      const discounts = await storage.getProgramDiscounts(parseInt(req.params.id));
      res.json(discounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/admin/camps/:id/discounts", requireAuth, async (req, res) => {
    try {
      const discounts = await storage.setProgramDiscounts(parseInt(req.params.id), req.body);
      res.json(discounts);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/camps/:id/settings", requireAuth, async (req, res) => {
    try {
      const s = await storage.getCampSettings(parseInt(req.params.id));
      res.json(s || {});
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/admin/camps/:id/settings", requireAuth, async (req, res) => {
    try {
      const s = await storage.upsertCampSettings(parseInt(req.params.id), req.body);
      res.json(s);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/registrations", requireAuth, async (req, res) => {
    try {
      const campId = req.query.campId ? parseInt(req.query.campId as string) : undefined;
      let regs;
      if (campId) {
        regs = await storage.getRegistrationsByProgram(campId);
      } else {
        regs = await storage.getRegistrations();
      }
      const enriched = await Promise.all(regs.map(async (r: any) => {
        const items = await storage.getRegistrationItems(r.id);
        const parentContact = await storage.getContact(r.contactId);
        const kids = parentContact ? await storage.getChildren(parentContact.id) : [];
        const program = r.program || await storage.getProgram(r.programId);
        return { ...r, items, contact: r.contact || parentContact, children: kids, program };
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/registrations/:id", requireAuth, async (req, res) => {
    try {
      const reg = await storage.getRegistration(parseInt(req.params.id));
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      const items = await storage.getRegistrationItems(reg.id);
      const contact = await storage.getContact(reg.contactId);
      const program = await storage.getProgram(reg.programId);
      res.json({ ...reg, items, contact, program });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/registrations/:id", requireAuth, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await storage.getRegistration(regId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      await storage.deleteRegistration(regId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/registrations/:id/refund", requireAuth, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await storage.getRegistration(regId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });

      if (reg.status === "refunded") {
        return res.status(400).json({ message: "Registration is already fully refunded" });
      }

      const { itemIds, amountCents, reason } = req.body || {};
      const totalCents = reg.totalCents || 0;

      if (totalCents <= 0) {
        return res.status(400).json({ message: "Nothing to refund — registration has no payment amount" });
      }
      if (!reg.stripePaymentIntentId) {
        return res.status(400).json({ message: "No Stripe payment found for this registration. Cannot process automated refund." });
      }

      const allItems = await storage.getRegistrationItems(regId);
      const pricing = await storage.getCampPricing(reg.programId);
      const priceMap = new Map(pricing.map((p) => [p.productType, p.priceCents]));

      let refundAmount = 0;
      let selectedItemIds: number[] = [];
      // Per-item refund allocation map (itemId -> cents). Computed deterministically so
      // sum(itemAllocations) === refundAmount, preventing stranded cents that would block
      // future refunds or leave the registration permanently in `partially_refunded`.
      const itemAllocations = new Map<number, number>();

      if (Array.isArray(itemIds) && itemIds.length > 0) {
        const idSet = new Set(itemIds.map((i: any) => Number(i)));
        const selected = allItems.filter((it) => idSet.has(it.id));
        if (selected.length !== idSet.size) {
          return res.status(400).json({ message: "One or more selected items don't belong to this registration" });
        }
        const alreadyRefunded = selected.filter((it) => it.refundedAmountCents && it.refundedAmountCents > 0);
        if (alreadyRefunded.length > 0) {
          return res.status(400).json({ message: `${alreadyRefunded.length} item(s) already refunded` });
        }

        const subtotalCents = reg.subtotalCents || totalCents;
        const selectedBaseSum = selected.reduce((s, it) => s + (priceMap.get(it.productType) || 0), 0);
        // Target refund amount with proportional discount applied (basket-level)
        let targetRefund = (subtotalCents > 0 && totalCents !== subtotalCents)
          ? Math.round((selectedBaseSum * totalCents) / subtotalCents)
          : selectedBaseSum;

        // If selected items are ALL the remaining unrefunded items, force the refund to
        // exactly clear the remaining balance so the registration can transition to `refunded`.
        const otherUnrefunded = allItems.filter(
          (it) => !idSet.has(it.id) && !(it.refundedAmountCents && it.refundedAmountCents > 0)
        );
        const remainingBalance = totalCents - (reg.refundedAmountCents || 0);
        if (otherUnrefunded.length === 0) {
          targetRefund = remainingBalance;
        } else if (targetRefund > remainingBalance) {
          targetRefund = remainingBalance;
        }

        // Allocate per-item amounts via Largest-Remainder method so sum === targetRefund exactly
        const denom = selectedBaseSum > 0 ? selectedBaseSum : selected.length;
        const raw = selected.map((it) => {
          const base = selectedBaseSum > 0 ? (priceMap.get(it.productType) || 0) : 1;
          return { id: it.id, exact: (base * targetRefund) / denom };
        });
        const floors = raw.map((r) => ({ id: r.id, floor: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
        let allocated = floors.reduce((s, f) => s + f.floor, 0);
        let remainder = targetRefund - allocated;
        // Distribute the leftover cents to the items with the largest fractional parts (stable by id for ties)
        const order = [...floors].sort((a, b) => b.frac - a.frac || a.id - b.id);
        for (let i = 0; i < order.length && remainder > 0; i++, remainder--) {
          order[i].floor += 1;
        }
        floors.forEach((f) => itemAllocations.set(f.id, f.floor));
        refundAmount = targetRefund;
        selectedItemIds = selected.map((it) => it.id);
      } else if (typeof amountCents === "number" && amountCents > 0) {
        refundAmount = Math.min(amountCents, totalCents - (reg.refundedAmountCents || 0));
      } else {
        // Default: full refund of remainder
        refundAmount = totalCents - (reg.refundedAmountCents || 0);
      }

      if (refundAmount <= 0) {
        return res.status(400).json({ message: "Refund amount must be greater than zero" });
      }
      const remainingRefundable = totalCents - (reg.refundedAmountCents || 0);
      if (refundAmount > remainingRefundable) {
        return res.status(400).json({ message: `Refund amount exceeds remaining balance ($${(remainingRefundable / 100).toFixed(2)})` });
      }

      let refund;
      try {
        const idemSuffix = selectedItemIds.length > 0
          ? `items_${[...selectedItemIds].sort((a, b) => a - b).join("_")}`
          : `amt_${refundAmount}`;
        refund = await createRefund({
          paymentIntentId: reg.stripePaymentIntentId,
          amountCents: refundAmount,
          reason: reason || undefined,
          idempotencyKey: `refund_reg_${regId}_${idemSuffix}`,
          metadata: {
            registrationId: String(regId),
            adminUserId: String((req.session as any).userId || ""),
            ...(selectedItemIds.length > 0 ? { itemIds: selectedItemIds.join(",") } : {}),
          },
        });
      } catch (stripeErr: any) {
        console.error("Stripe refund failed:", stripeErr);
        return res.status(400).json({
          message: stripeErr?.message || "Stripe refund failed",
          code: stripeErr?.code,
        });
      }

      // Mark refunded items using the allocation that sums exactly to refundAmount
      if (selectedItemIds.length > 0) {
        for (const itemId of selectedItemIds) {
          const itemRefund = itemAllocations.get(itemId) ?? 0;
          await storage.updateRegistrationItem(itemId, { refundedAmountCents: itemRefund });
        }
      }

      const newRefundedTotal = (reg.refundedAmountCents || 0) + refundAmount;
      const isFullRefund = newRefundedTotal >= totalCents;
      await storage.updateRegistration(regId, {
        status: isFullRefund ? "refunded" : "partially_refunded",
        refundedAt: new Date(),
        refundedAmountCents: newRefundedTotal,
        refundReason: reason || reg.refundReason || null,
        refundedBy: (req.session as any).userId || null,
        stripeRefundId: refund.id,
        stripeRefundStatus: refund.status,
      });

      res.json({
        ok: true,
        refundId: refund.id,
        status: refund.status,
        amountRefunded: refundAmount,
        totalRefunded: newRefundedTotal,
        isFullRefund,
      });
    } catch (error: any) {
      console.error("Refund endpoint error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/registrations/:id/refund/refresh-status", requireAuth, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await storage.getRegistration(regId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      if (!reg.stripeRefundId) return res.status(400).json({ message: "No refund to refresh" });

      const refund = await retrieveRefund(reg.stripeRefundId);
      await storage.updateRegistration(regId, { stripeRefundStatus: refund.status });
      res.json({ ok: true, status: refund.status });
    } catch (error: any) {
      console.error("Refresh refund status error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/admin/registrations/:id/items", requireAuth, async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const reg = await storage.getRegistration(regId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });

      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: "items array is required" });
      }

      const validProductTypes = ["FULL_DAY", "MORNING", "AFTERNOON"];
      for (const item of items) {
        if (!item.childId || !item.campDateId || !item.productType) {
          return res.status(400).json({ message: "Each item must have childId, campDateId, and productType" });
        }
        if (!validProductTypes.includes(item.productType)) {
          return res.status(400).json({ message: `Invalid productType: ${item.productType}` });
        }
      }

      const campDates = await storage.getCampDates(reg.programId);
      const validDateIds = new Set(campDates.map(d => d.id));
      for (const item of items) {
        if (!validDateIds.has(item.campDateId)) {
          return res.status(400).json({ message: `campDateId ${item.campDateId} does not belong to this camp` });
        }
      }

      const contact = await storage.getContact(reg.contactId);
      if (contact) {
        const kids = await storage.getChildren(contact.id);
        const validChildIds = new Set(kids.map(k => k.id));
        for (const item of items) {
          if (!validChildIds.has(item.childId)) {
            return res.status(400).json({ message: `childId ${item.childId} does not belong to this contact` });
          }
        }
      }

      const oldItems = await storage.getRegistrationItems(regId);
      const oldPairs = new Set(oldItems.map(i => `${i.campDateId}:${i.childId}`));

      await storage.replaceRegistrationItems(regId, items.map((i: any) => ({
        registrationId: regId,
        childId: i.childId,
        campDateId: i.campDateId,
        productType: i.productType,
      })));

      const newPairs = new Set(items.map((i: any) => `${i.campDateId}:${i.childId}`));

      const toCreate: { campId: number; campDateId: number; childId: number }[] = [];
      for (const item of items) {
        const key = `${item.campDateId}:${item.childId}`;
        if (!oldPairs.has(key)) {
          toCreate.push({ campId: reg.programId, campDateId: item.campDateId, childId: item.childId });
        }
      }
      if (toCreate.length > 0) {
        try { await storage.createAttendanceBulk(toCreate); } catch (e) { /* ignore duplicates */ }
      }

      for (const oldItem of oldItems) {
        const key = `${oldItem.campDateId}:${oldItem.childId}`;
        if (!newPairs.has(key)) {
          await storage.deleteAttendanceIfUnused(reg.programId, oldItem.campDateId, oldItem.childId);
        }
      }

      const enrichedItems = await storage.getRegistrationItems(regId);
      res.json(enrichedItems);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/registrations/manual", requireAuth, async (req, res) => {
    try {
      const { campId, parent, children: childrenData, items, isPaid } = req.body;
      if (!campId || !parent || !childrenData || !items) {
        return res.status(400).json({ message: "campId, parent, children, and items are required" });
      }

      const camp = await storage.getProgram(campId);
      if (!camp) return res.status(404).json({ message: "Camp not found" });

      let parentContact = parent.email ? await storage.findContactByEmail(parent.email) : null;
      if (!parentContact) {
        parentContact = await storage.createContact({
          type: "guardian",
          firstName: parent.firstName,
          lastName: parent.lastName,
          email: parent.email || null,
          phone: parent.phone || null,
          emergencyContact: parent.emergencyContact || null,
          emergencyPhone: parent.emergencyPhone || null,
        });
      } else {
        parentContact = (await storage.updateContact(parentContact.id, {
          firstName: parent.firstName,
          lastName: parent.lastName,
          phone: parent.phone || parentContact.phone,
          emergencyContact: parent.emergencyContact || parentContact.emergencyContact,
          emergencyPhone: parent.emergencyPhone || parentContact.emergencyPhone,
        }))!;
      }

      const createdChildren = [];
      for (const childData of childrenData) {
        const child = await storage.createChild({
          parentId: parentContact.id,
          firstName: childData.firstName,
          lastName: childData.lastName,
          dateOfBirth: childData.dateOfBirth || null,
          gender: childData.gender || null,
        });
        if (childData.allergies || childData.epiPen || childData.medicalNotes) {
          await storage.upsertChildMedical(child.id, {
            allergies: childData.allergies || null,
            epiPen: childData.epiPen || false,
            notes: childData.medicalNotes || null,
          });
        }
        createdChildren.push(child);
      }

      const pricing = await storage.getCampPricing(camp.id);
      const discounts = await storage.getProgramDiscounts(camp.id);

      let subtotalCents = 0;
      const registrationItems: { childId: number; campDateId: number; productType: string }[] = [];

      for (const item of items) {
        const child = createdChildren[item.childIndex];
        if (!child) continue;
        const price = pricing.find((p: any) => p.productType === item.productType);
        if (price) {
          subtotalCents += price.priceCents;
        }
        registrationItems.push({
          childId: child.id,
          campDateId: item.campDateId,
          productType: item.productType,
        });
      }

      let discountCents = 0;
      const totalItems = registrationItems.length;
      const applicableDiscount = discounts
        .filter((d: any) => totalItems >= d.minBookings)
        .sort((a: any, b: any) => Number(b.discountPercent) - Number(a.discountPercent))[0];
      if (applicableDiscount) {
        discountCents = Math.round(subtotalCents * Number(applicableDiscount.discountPercent) / 100);
      }
      const totalCents = subtotalCents - discountCents;

      const registration = await storage.createRegistration({
        programId: camp.id,
        contactId: parentContact.id,
        guardianId: parentContact.id,
        status: isPaid ? "confirmed" : "pending",
        subtotalCents,
        discountCents,
        totalCents,
        currency: "NZD",
        registrationLocation: "cufc_office",
        source: "admin_manual",
      });

      if (isPaid) {
        await storage.assignOrderNumber(registration.id);
      }

      await storage.createRegistrationItems(registrationItems.map(item => ({
        registrationId: registration.id,
        childId: item.childId,
        campDateId: item.campDateId,
        productType: item.productType,
      })));

      const campDates = await storage.getCampDates(camp.id);
      const attendanceItems = registrationItems.map(item => ({
        campId: camp.id,
        campDateId: item.campDateId,
        childId: item.childId,
      }));
      if (attendanceItems.length > 0) {
        await storage.createAttendanceBulk(attendanceItems);
      }

      res.json({ registrationId: registration.id, totalCents, status: registration.status });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/attendance", requireAuth, async (req, res) => {
    try {
      const campId = parseInt(req.query.campId as string);
      const campDateId = parseInt(req.query.campDateId as string);
      if (!campId || !campDateId) return res.status(400).json({ message: "campId and campDateId required" });
      const records = await storage.getAttendanceByDate(campId, campDateId);
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });


  app.get("/api/admin/contacts", requireAuth, async (_req, res) => {
    try {
      const allContacts = await storage.getContacts();
      const allChildren = await storage.getAllChildren();
      const allPrograms = await storage.getPrograms();

      const parentList = allContacts
        .filter(c => c.type === "guardian")
        .map(c => ({
          id: c.id,
          personType: "parent" as const,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          dateOfBirth: c.dateOfBirth,
          createdAt: c.createdAt,
        }));

      const playerList = allChildren.map(c => {
        const parent = allContacts.find(p => p.id === c.parentId);
        return {
          id: c.id,
          personType: "player" as const,
          firstName: c.firstName,
          lastName: c.lastName,
          email: null,
          phone: null,
          dateOfBirth: c.dateOfBirth,
          createdAt: c.createdAt,
          parentName: parent ? `${parent.firstName} ${parent.lastName}` : null,
          parentId: c.parentId,
        };
      });

      res.json({ parents: parentList, players: playerList, programs: allPrograms.map(p => ({ id: p.id, name: p.name })) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/contacts/parent/:id", requireAuth, async (req, res) => {
    try {
      const contact = await storage.getContact(parseInt(req.params.id));
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const kids = await storage.getChildren(contact.id);
      const regs = await storage.getRegistrations();
      const contactRegs = regs.filter(r => r.contactId === contact.id || r.guardianId === contact.id);
      const regDetails = await Promise.all(contactRegs.map(async (r) => {
        const items = await storage.getRegistrationItems(r.id);
        return { ...r, items };
      }));
      res.json({ contact, children: kids, registrations: regDetails });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/contacts/player/:id", requireAuth, async (req, res) => {
    try {
      const child = await storage.getChild(parseInt(req.params.id));
      if (!child) return res.status(404).json({ message: "Player not found" });
      const parent = await storage.getContact(child.parentId);
      const medical = await storage.getChildMedical(child.id);
      const regs = await storage.getRegistrations();
      const parentRegs = regs.filter(r => r.contactId === child.parentId || r.guardianId === child.parentId);
      const regDetails = await Promise.all(parentRegs.map(async (r) => {
        const items = await storage.getRegistrationItems(r.id);
        const playerItems = items.filter(i => i.childId === child.id);
        if (playerItems.length === 0) return null;
        return { ...r, items: playerItems };
      }));
      res.json({ child: { ...child, medical }, parent, registrations: regDetails.filter(Boolean) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/mailer/campaigns", requireAuth, async (_req, res) => {
    try {
      const campaigns = await storage.getEmailCampaigns();
      res.json(campaigns);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/mailer/segments", requireAuth, async (_req, res) => {
    try {
      const allCamps = await storage.getPrograms();
      const segments = [];
      for (const camp of allCamps) {
        const dates = await storage.getCampDates(camp.id);
        segments.push({
          campId: camp.id,
          campName: camp.name,
          dates: dates.map(d => ({ id: d.id, date: d.date })),
        });
      }
      res.json(segments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/mailer/preview-recipients", requireAuth, async (req, res) => {
    try {
      const { segmentType, segmentConfig } = req.body;
      const validSegments = ["all", "camp", "day", "session", "custom"];
      if (!segmentType || !validSegments.includes(segmentType)) {
        return res.status(400).json({ message: "Invalid segment type" });
      }
      const emails = await storage.getMailerSegmentEmails(segmentType, segmentConfig);
      res.json({ count: emails.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/mailer/test-send", requireAuth, async (req, res) => {
    try {
      const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
      if (!RESEND_API_KEY) return res.status(500).json({ message: "RESEND_API_KEY not configured" });

      const { to, from: fromAddr } = req.body;
      const senderEmail = fromAddr || "CUFC Camps <onboarding@resend.dev>";

      const apiRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: senderEmail,
          to: [to || "daniel@cufc.co.nz"],
          subject: "CUFC ClubOS — Test Email",
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2 style="color:#22399B;">Test Email from ClubOS</h2><p>If you're reading this, email delivery is working correctly.</p><p style="color:#666;font-size:13px;">Sent at: ${new Date().toISOString()}</p></div>`,
        }),
      });
      const result = await apiRes.json();
      console.log("[Mailer Test]", apiRes.status, JSON.stringify(result));
      res.json({ status: apiRes.status, ok: apiRes.ok, result });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/mailer/send", requireAuth, async (req, res) => {
    try {
      const { subject, body, fromEmail, replyTo, segmentType, segmentConfig, manualEmails } = req.body;
      if (!subject || typeof subject !== 'string' || subject.length > 500) return res.status(400).json({ message: "Valid subject required (max 500 chars)" });
      if (!body || typeof body !== 'string') return res.status(400).json({ message: "Email body is required" });
      const validSegments = ["all", "camp", "day", "session", "custom"];
      if (!segmentType || !validSegments.includes(segmentType)) return res.status(400).json({ message: "Invalid segment type" });

      let emails: string[] = [];
      if (segmentType === 'custom' && manualEmails) {
        emails = manualEmails.filter((e: string) => e && e.includes('@'));
      } else {
        emails = await storage.getMailerSegmentEmails(segmentType, segmentConfig);
      }

      if (manualEmails && manualEmails.length > 0 && segmentType !== 'custom') {
        const manual = manualEmails.filter((e: string) => e && e.includes('@'));
        emails = [...new Set([...emails, ...manual])];
      }

      if (emails.length === 0) return res.status(400).json({ message: "No recipients found for this segment" });

      const senderEmail = fromEmail || "CUFC Camps <noreply@cufc.co.nz>";
      const replyAddress = replyTo || "info@cufc.co.nz";

      const campaign = await storage.createEmailCampaign({
        subject,
        body,
        fromEmail: senderEmail,
        replyTo: replyAddress,
        segmentType,
        segmentConfig: JSON.stringify(segmentConfig || {}),
        recipientCount: emails.length,
        sentCount: 0,
        failedCount: 0,
        status: "sending",
      });

      const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
      if (!RESEND_API_KEY) {
        await storage.updateEmailCampaign(campaign.id, { status: "failed" } as any);
        return res.status(500).json({ message: "RESEND_API_KEY not configured" });
      }

      let sentCount = 0;
      let failedCount = 0;
      const BATCH_SIZE = 50;
      const DELAY_MS = 1000;

      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const batch = emails.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (email) => {
          try {
            const apiRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
              },
              body: JSON.stringify({
                from: senderEmail,
                to: [email],
                reply_to: replyAddress,
                subject,
                html: body,
                headers: {
                  "List-Unsubscribe": `<mailto:${replyAddress}?subject=unsubscribe>`,
                },
              }),
            });
            const result = await apiRes.json();
            await storage.createEmailLog({
              campId: null,
              registrationId: null,
              toEmail: email,
              subject,
              body,
              providerMessageId: result.id || null,
            });
            if (apiRes.ok) {
              sentCount++;
            } else {
              console.error(`[Mailer] Failed to send to ${email}:`, JSON.stringify(result));
              failedCount++;
            }
          } catch (err: any) {
            console.error(`[Mailer] Exception sending to ${email}:`, err?.message || err);
            failedCount++;
          }
        });
        await Promise.all(promises);
        if (i + BATCH_SIZE < emails.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }

      await storage.updateEmailCampaign(campaign.id, {
        sentCount,
        failedCount,
        status: failedCount === emails.length ? "failed" : "sent",
      } as any);
      await db.update(emailCampaigns).set({ sentAt: new Date() }).where(eq(emailCampaigns.id, campaign.id));

      res.json({
        campaignId: campaign.id,
        recipientCount: emails.length,
        sentCount,
        failedCount,
        status: failedCount === emails.length ? "failed" : "sent",
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/crm/export", requireAuth, async (req, res) => {
    try {
      const { type, campId, campDateId } = req.query;

      if (type === "emails-by-day" && campId && campDateId) {
        const records = await storage.getAttendanceByDate(parseInt(campId as string), parseInt(campDateId as string));
        const rows = records.map(r => ({
          date: "", 
          childFirstName: r.child?.firstName || "",
          childLastName: r.child?.lastName || "",
          parentFirstName: r.parent?.firstName || "",
          parentLastName: r.parent?.lastName || "",
          parentEmail: r.parent?.email || "",
          parentPhone: r.parent?.phone || "",
        }));
        res.json(rows);
      } else if (type === "all-parents") {
        const allContacts = await storage.getContacts();
        const parents = allContacts.filter(c => c.type === "guardian");
        res.json(parents.map(p => ({
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email || "",
          phone: p.phone || "",
          address: p.address || "",
        })));
      } else if (type === "all-registrations") {
        const regs = await storage.getRegistrations();
        res.json(regs);
      } else {
        res.status(400).json({ message: "Invalid export type" });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/settings", requireAuth, async (_req, res) => {
    try {
      const s = await storage.getSettings();
      res.json(s);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/admin/settings", requireAuth, async (req, res) => {
    try {
      const entries = Object.entries(req.body).map(([key, value]) => ({ key, value: String(value) }));
      await storage.upsertSettings(entries);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ VENUE / FACILITY ROUTES ============
  // Org-membership guard (mirrors the pattern used by /api/admin/discounts/*)
  async function checkUserOrg(userId: number, orgId: number): Promise<boolean> {
    const userOrgs = await storage.getUserOrganizations(userId);
    return userOrgs.some((o: any) => o.id === orgId);
  }

  // === Public file serving (object storage) ===
  // Uploaded facility images live in object storage; this route streams them by path.
  app.get(/^\/objects\/.+/, async (req, res) => {
    try {
      const svc = new ObjectStorageService();
      const file = await svc.getObjectEntityFile(req.path);
      // Enforce ACL: anonymous reads only allowed for objects explicitly marked public.
      const userId = (req.session as any)?.userId
        ? String((req.session as any).userId)
        : undefined;
      const allowed = await svc.canAccessObjectEntity({ userId, objectFile: file });
      if (!allowed) return res.status(userId ? 403 : 401).end();
      await svc.downloadObject(file, res, 86400);
    } catch (error: any) {
      if (error instanceof ObjectNotFoundError) return res.status(404).end();
      console.error("[objects] serve error:", error);
      res.status(500).end();
    }
  });

  app.get("/api/admin/venue/facilities", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const list = await storage.getFacilities(orgId);
      const withRules = await Promise.all(list.map(async f => {
        const rules = await storage.getFacilityPricingRules(f.id);
        return { ...f, pricingRulesCount: rules.length };
      }));
      res.json(withRules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/venue/facilities", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const facility = await storage.createFacility(req.body);
      res.json(facility);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/venue/facilities/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacility(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      // Don't allow moving a facility into another org via PATCH
      const { organizationId: _ignore, ...patch } = req.body || {};
      const facility = await storage.updateFacility(parseInt(req.params.id), patch);
      if (!facility) return res.status(404).json({ message: "Not found" });
      res.json(facility);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/facilities/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacility(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteFacility(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // === Facility images: optimized multipart upload ===
  // Every image — large or small, JPG/PNG/HEIC/WebP/etc — is normalized server-side via sharp
  // before being stored. For each upload we produce TWO optimized variants stored side-by-side
  // with the same UUID stem and different extensions:
  //   • <uuid>.webp  — universal modern fallback (quality 82, ~96% browser support)
  //   • <uuid>.avif  — newest gen, ~20-30% smaller than WebP at equal quality
  // The customer site uses a <picture> element so each browser picks the best one it supports.
  // Only the .webp path is stored in facility.imageUrls; the .avif sibling path is derived by
  // swapping the extension. Pipeline (per variant): auto-rotate (EXIF) → cap to 2400px on the
  // longest side → re-encode → strip EXIF/colour-profile metadata.
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file (covers DSLR JPGs and HEIC)
  const MAX_FILES_PER_REQUEST = 10;
  const MAX_DIMENSION_PX = 2400;
  const WEBP_QUALITY = 82;
  const AVIF_QUALITY = 55;   // AVIF achieves equivalent perceptual quality at lower numbers than WebP/JPEG
  const AVIF_EFFORT = 3;     // 0-9; 3 keeps single-photo encode under ~3s on this hardware while still giving real savings on photographic content
  const SHARP_PIXEL_CAP = 50_000_000; // 50 MP — rejects pixel-bombs well below sharp's 268 MP default
  const ALLOWED_RASTER_FORMATS = new Set([
    "jpeg", "jpg", "png", "webp", "gif", "tiff", "heif", "heic", "avif",
  ]);

  const facilityImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_REQUEST },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/") || file.mimetype === "image/svg+xml") {
        return cb(new Error(`"${file.originalname}" is not a supported image type`));
      }
      cb(null, true);
    },
  });

  app.post(
    "/api/admin/venue/facilities/:id/images/upload",
    requireAuth,
    // 1) Authorize BEFORE parsing the body so unauthorized callers can't make us buffer files.
    async (req, res, next) => {
      try {
        const facility = await storage.getFacility(parseInt(req.params.id));
        if (!facility) return res.status(404).json({ message: "Facility not found" });
        if (!(await checkUserOrg(req.session.userId!, facility.organizationId)))
          return res.status(403).json({ message: "Forbidden" });
        (req as any)._facility = facility;
        next();
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },
    // 2) Now parse the multipart body.
    (req, res, next) => {
      facilityImageUpload.array("files", MAX_FILES_PER_REQUEST)(req, res, (err: any) => {
        if (err) {
          const message =
            err?.code === "LIMIT_FILE_SIZE"
              ? `One of the files is over ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`
              : err?.code === "LIMIT_FILE_COUNT"
                ? `Too many files in one upload (max ${MAX_FILES_PER_REQUEST})`
                : err?.message || "Upload rejected";
          return res.status(400).json({ message });
        }
        next();
      });
    },
    async (req, res) => {
      const facility = (req as any)._facility;
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      if (files.length === 0) return res.status(400).json({ message: "No files uploaded" });

      const svc = new ObjectStorageService();
      const uploadedFiles: { gcsFile: any; objectPath: string }[] = [];

      try {
        for (const file of files) {
          // Probe with sharp: validates real image content + dimensions.
          let meta: sharp.Metadata;
          try {
            meta = await sharp(file.buffer, {
              failOn: "error",
              animated: false,
              limitInputPixels: SHARP_PIXEL_CAP,
            }).metadata();
            if (!meta.format || !ALLOWED_RASTER_FORMATS.has(meta.format)) {
              throw new Error(`Unsupported format: ${meta.format || "unknown"}`);
            }
          } catch (e: any) {
            throw new Error(`"${file.originalname}" couldn't be read as an image (${e.message})`);
          }

          // Build a base sharp pipeline once; clone it for each output format so we
          // only pay the decode + rotate + resize cost a single time per upload.
          const base = sharp(file.buffer, {
            failOn: "error",
            animated: false,
            limitInputPixels: SHARP_PIXEL_CAP,
          })
            .rotate()
            .resize({
              width: MAX_DIMENSION_PX,
              height: MAX_DIMENSION_PX,
              fit: "inside",
              withoutEnlargement: true,
            });

          const [webpBuf, avifBuf] = await Promise.all([
            base.clone().webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer(),
            base.clone().avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toBuffer(),
          ]);

          // Use one shared UUID so the two variants live at matching paths
          //   /objects/uploads/<uuid>.webp   and   /objects/uploads/<uuid>.avif
          // The frontend swaps the extension to find the AVIF sibling.
          const sharedId = crypto.randomUUID();

          // Upload + ACL each variant via a helper that records the file in
          // `uploadedFiles` IMMEDIATELY after upload — before ACL runs — so that
          // any later failure (sibling upload, sibling ACL, our own ACL) still
          // rolls this object back via the catch-block cleanup below. This is
          // the fix for the "successful sibling left orphaned" race that would
          // otherwise occur if we only tracked after both legs fully completed.
          const uploadAndAcl = async (buf: Buffer, contentType: string, ext: string) => {
            const u = await svc.uploadBufferToUploads(buf, contentType, ext, sharedId);
            uploadedFiles.push({ gcsFile: u.file, objectPath: u.objectPath });
            await setObjectAclPolicy(u.file, {
              owner: String(req.session.userId),
              visibility: "public",
            });
            return u;
          };

          // allSettled lets us see BOTH outcomes; if either failed, throw and
          // let the catch-block clean up every object that was registered.
          const results = await Promise.allSettled([
            uploadAndAcl(webpBuf, "image/webp", "webp"),
            uploadAndAcl(avifBuf, "image/avif", "avif"),
          ]);
          const failed = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
          if (failed) {
            throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
          }
        }

        // Persist only the .webp paths; the .avif siblings are derived in the UI.
        const newWebpPaths = uploadedFiles
          .filter(u => u.objectPath.endsWith(".webp"))
          .map(u => u.objectPath);
        const updated = await storage.updateFacility(facility.id, {
          imageUrls: [...(facility.imageUrls || []), ...newWebpPaths],
        } as any);
        res.json(updated);
      } catch (error: any) {
        // Best-effort cleanup so a partial failure doesn't leave orphaned public objects.
        await Promise.allSettled(
          uploadedFiles.map(u => u.gcsFile.delete({ ignoreNotFound: true })),
        );
        console.error("[facility-images] upload error:", error);
        const status = /couldn't be read|Unsupported format|over \d+ MB/i.test(error.message || "")
          ? 400 : 500;
        res.status(status).json({ message: error.message || "Upload failed" });
      }
    },
  );

  app.get("/api/admin/venue/facilities/:id/pricing", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacility(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const rules = await storage.getFacilityPricingRules(parseInt(req.params.id));
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/venue/facilities/:id/pricing", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacility(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const rule = await storage.createFacilityPricingRule({ ...req.body, facilityId: parseInt(req.params.id) });
      res.json(rule);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/pricing/:id", requireAuth, async (req, res) => {
    try {
      const rule = await storage.getFacilityPricingRule(parseInt(req.params.id));
      if (!rule) return res.status(404).json({ message: "Not found" });
      const fac = await storage.getFacility(rule.facilityId);
      if (!fac) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, fac.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteFacilityPricingRule(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/venue/bookings", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const bookings = await storage.getFacilityBookings(orgId);
      res.json(bookings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/venue/bookings", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });

      const facId = parseInt(req.body?.facilityId);
      if (!facId) return res.status(400).json({ message: "facilityId required" });

      // Validate primary facility belongs to org
      const fac = await storage.getFacility(facId);
      if (!fac || fac.organizationId !== orgId) {
        return res.status(400).json({ message: "Facility does not belong to this organization" });
      }

      // Validate any additional facilities also belong to the same org
      const rawAdditional = Array.isArray(req.body?.additionalFacilityIds) ? req.body.additionalFacilityIds : [];
      const additionalFacilityIds: number[] = Array.from(new Set(
        rawAdditional.map((x: any) => parseInt(x)).filter((n: number) => !isNaN(n) && n !== facId)
      ));
      for (const extraId of additionalFacilityIds) {
        const extraFac = await storage.getFacility(extraId);
        if (!extraFac || extraFac.organizationId !== orgId) {
          return res.status(400).json({ message: `Facility ${extraId} does not belong to this organization` });
        }
      }
      const allFacilityIds = [facId, ...additionalFacilityIds];

      // Recurrence expansion. We accept a small "repeat" config and expand into
      // individual rows so the existing calendar (which reads single-day rows)
      // works without changes. All occurrences share a bookingGroupId so they
      // can later be cancelled / edited as a series.
      const repeat = req.body?.repeat as { freq?: string; byDay?: number[]; until?: string } | undefined;
      const baseDate = req.body?.bookingDate as string;
      if (!baseDate || !/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
        return res.status(400).json({ message: "bookingDate required (YYYY-MM-DD)" });
      }

      // Hard cap on total rows produced (occurrences × facilities). Protects against
      // pathological combinations even though per-occurrence is also capped below.
      const MAX_TOTAL_ROWS = 365;
      const MAX_OCCURRENCES = 365;

      const occurrences: string[] = [];
      const freq = repeat?.freq || "none";
      if (freq === "none") {
        occurrences.push(baseDate);
      } else {
        const until = repeat?.until;
        if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
          return res.status(400).json({ message: "Repeat 'until' date is required (YYYY-MM-DD) when repeating" });
        }
        if (until < baseDate) {
          return res.status(400).json({ message: "Repeat end date must be on or after the start date" });
        }

        // Pure date-string arithmetic to avoid timezone / DST off-by-one. We construct
        // the date in UTC and only use UTC getters so the local server TZ is irrelevant.
        const startParts = baseDate.split("-").map(Number);
        const startDayOfWeek = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2])).getUTCDay();

        const allowedDays = (() => {
          if (freq === "daily") return [0, 1, 2, 3, 4, 5, 6];
          if (freq === "weekly") return [startDayOfWeek];
          if (freq === "weekdays") return [1, 2, 3, 4, 5];
          if (freq === "custom" && Array.isArray(repeat?.byDay) && repeat.byDay.length > 0) {
            return repeat.byDay.map(n => parseInt(String(n))).filter(n => n >= 0 && n <= 6);
          }
          return [startDayOfWeek];
        })();
        if (allowedDays.length === 0) {
          return res.status(400).json({ message: "Custom repeat requires at least one weekday" });
        }

        const cursorUtc = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
        const untilParts = until.split("-").map(Number);
        const untilUtc = new Date(Date.UTC(untilParts[0], untilParts[1] - 1, untilParts[2]));
        while (cursorUtc.getTime() <= untilUtc.getTime() && occurrences.length < MAX_OCCURRENCES) {
          if (allowedDays.includes(cursorUtc.getUTCDay())) {
            const y = cursorUtc.getUTCFullYear();
            const m = String(cursorUtc.getUTCMonth() + 1).padStart(2, "0");
            const d = String(cursorUtc.getUTCDate()).padStart(2, "0");
            occurrences.push(`${y}-${m}-${d}`);
          }
          cursorUtc.setUTCDate(cursorUtc.getUTCDate() + 1);
        }
        if (occurrences.length === 0) {
          return res.status(400).json({ message: "Repeat schedule produced zero bookings — check your weekday selection and end date" });
        }
      }

      const totalRows = occurrences.length * allFacilityIds.length;
      if (totalRows > MAX_TOTAL_ROWS) {
        return res.status(400).json({ message: `That would create ${totalRows} bookings — please narrow the date range or fewer facilities (max ${MAX_TOTAL_ROWS}).` });
      }

      // Generate a group id if there will be more than one row created (multi-facility OR recurrence)
      const willGroup = occurrences.length > 1 || allFacilityIds.length > 1;
      const bookingGroupId = willGroup ? `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;

      // STRICT ALLOW-LIST. We do NOT spread req.body — sensitive fields like status,
      //   paidAt, stripe_*, totalCents, gstCents are server-managed and must never
      //   come from client input. Manual admin bookings always start as "confirmed"
      //   and unpaid.
      const allowedClient = {
        customerName: typeof req.body?.customerName === "string" ? req.body.customerName.trim() : "",
        customerEmail: typeof req.body?.customerEmail === "string" ? req.body.customerEmail.trim() : "",
        customerPhone: typeof req.body?.customerPhone === "string" ? req.body.customerPhone : null,
        customerClub: typeof req.body?.customerClub === "string" ? req.body.customerClub : null,
        startTime: typeof req.body?.startTime === "string" ? req.body.startTime : "",
        endTime: typeof req.body?.endTime === "string" ? req.body.endTime : "",
        notes: typeof req.body?.notes === "string" ? req.body.notes : null,
        color: typeof req.body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : null,
        totalAmount: req.body?.totalAmount != null ? String(req.body.totalAmount) : "0",
        gstAmount: req.body?.gstAmount != null ? String(req.body.gstAmount) : null,
      };
      if (!allowedClient.customerName) return res.status(400).json({ message: "customerName required" });
      if (!allowedClient.customerEmail) return res.status(400).json({ message: "customerEmail required" });
      if (!allowedClient.startTime || !allowedClient.endTime) return res.status(400).json({ message: "startTime and endTime required" });

      const recurrenceRule = freq !== "none"
        ? `FREQ=${freq.toUpperCase()}` +
          (freq === "custom" ? `;BYDAY=${(repeat?.byDay || []).join(",")}` : "")
        : null;
      const recurrenceEndDate = freq !== "none" ? (repeat?.until || null) : null;

      // Build all rows: one per (occurrence × facility). Server-managed fields are
      //   set explicitly here; status is always "confirmed" for admin-created bookings.
      const rows: any[] = [];
      for (const date of occurrences) {
        for (const fid of allFacilityIds) {
          rows.push({
            ...allowedClient,
            organizationId: orgId,
            facilityId: fid,
            bookingDate: date,
            status: "confirmed" as const,
            bookingGroupId,
            // Only the primary row of each occurrence carries the additional-facilities
            //   metadata so the UI can show the group at a glance; all rows still
            //   have their own facilityId.
            additionalFacilityIds: fid === facId && additionalFacilityIds.length > 0 ? additionalFacilityIds : null,
            recurrenceRule,
            recurrenceEndDate,
          });
        }
      }

      const created = [];
      for (const row of rows) {
        created.push(await storage.createFacilityBooking(row));
      }

      // Response: single booking shape if just one, else summary so the client can show "X bookings created"
      if (created.length === 1) {
        return res.json(created[0]);
      }
      return res.json({
        count: created.length,
        bookingGroupId,
        bookings: created,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/venue/bookings/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacilityBooking(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      // Strip organizationId so a row can't be moved to another org via PATCH
      const { organizationId: _ignore, ...patch } = req.body || {};
      // If facilityId is being changed, validate the new facility is in the same org
      if (patch.facilityId !== undefined && parseInt(patch.facilityId) !== existing.facilityId) {
        const newFac = await storage.getFacility(parseInt(patch.facilityId));
        if (!newFac || newFac.organizationId !== existing.organizationId) {
          return res.status(400).json({ message: "Facility does not belong to this organization" });
        }
      }
      // Same cross-org check for additionalFacilityIds — keeps the multi-facility model honest.
      if (Array.isArray(patch.additionalFacilityIds)) {
        const cleaned: number[] = Array.from(new Set(
          patch.additionalFacilityIds.map((x: any) => parseInt(x)).filter((n: number) => !isNaN(n))
        ));
        for (const extraId of cleaned) {
          const extraFac = await storage.getFacility(extraId);
          if (!extraFac || extraFac.organizationId !== existing.organizationId) {
            return res.status(400).json({ message: `Facility ${extraId} does not belong to this organization` });
          }
        }
        patch.additionalFacilityIds = cleaned.length > 0 ? cleaned : null;
      }
      const booking = await storage.updateFacilityBooking(parseInt(req.params.id), patch);
      if (!booking) return res.status(404).json({ message: "Not found" });
      res.json(booking);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/bookings/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacilityBooking(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteFacilityBooking(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/venue/addons", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const addons = await storage.getFacilityAddons(orgId);
      res.json(addons);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/venue/addons", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const addon = await storage.createFacilityAddon(req.body);
      res.json(addon);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/venue/addons/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacilityAddon(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const { organizationId: _ignore, ...patch } = req.body || {};
      const addon = await storage.updateFacilityAddon(parseInt(req.params.id), patch);
      if (!addon) return res.status(404).json({ message: "Not found" });
      res.json(addon);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/addons/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getFacilityAddon(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteFacilityAddon(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ========= Public Venue Booking APIs =========

  function calcItemPriceCents(
    item: { date: string; startTime: string; endTime: string; halfFull?: string | null },
    facility: { pricePerHourCents: number | null; halfFieldPricePerHourCents: number | null },
    rules: { dayOfWeek: number | null; startTime: string | null; endTime: string | null; pricePerHour: string; isDefault: boolean | null }[]
  ): number {
    const [sh, sm] = item.startTime.split(":").map(Number);
    const [eh, em] = item.endTime.split(":").map(Number);
    const minutes = (eh * 60 + em) - (sh * 60 + sm);
    if (minutes <= 0) return 0;
    const hours = minutes / 60;

    const dayOfWeek = new Date(item.date + "T00:00:00").getDay();
    let pricePerHourCents = 0;

    const specific = rules.find(r =>
      r.dayOfWeek != null && r.dayOfWeek === dayOfWeek &&
      r.startTime && r.endTime &&
      item.startTime >= r.startTime && item.endTime <= r.endTime
    );

    let halfPricePerHourCents: number | null = null;

    if (specific) {
      pricePerHourCents = Math.round(parseFloat(specific.pricePerHour) * 100);
      if (specific.halfFieldPricePerHour != null) {
        halfPricePerHourCents = Math.round(parseFloat(specific.halfFieldPricePerHour) * 100);
      }
    } else {
      const def = rules.find(r => r.isDefault);
      if (def) {
        pricePerHourCents = Math.round(parseFloat(def.pricePerHour) * 100);
        if (def.halfFieldPricePerHour != null) {
          halfPricePerHourCents = Math.round(parseFloat(def.halfFieldPricePerHour) * 100);
        }
      } else {
        pricePerHourCents = facility.pricePerHourCents || 0;
      }
    }

    let baseCents = Math.round(pricePerHourCents * hours);

    if (item.halfFull === "half") {
      // Resolution order: rule half price → facility half price → 50% of full.
      if (halfPricePerHourCents != null) {
        baseCents = Math.round(halfPricePerHourCents * hours);
      } else if (facility.halfFieldPricePerHourCents != null) {
        baseCents = Math.round(facility.halfFieldPricePerHourCents * hours);
      } else {
        baseCents = Math.round(baseCents / 2);
      }
    }
    return baseCents;
  }

  function calcAddonCents(addon: { name: string; price: string; unit: string; maxQty?: number | null }, qty: number, hours: number): number {
    if (addon.maxQty != null && qty > addon.maxQty) {
      throw new Error(`${addon.name}: maximum ${addon.maxQty} per booking`);
    }
    const priceCents = Math.round(parseFloat(addon.price) * 100);
    if (addon.unit === "per_hour") return priceCents * qty * Math.max(1, hours);
    return priceCents * qty;
  }

  async function resolveVenueOrg(req: Request) {
    const slug = (req.query.slug as string) || "";
    const hostHeader = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "";
    const hostname = hostHeader.split(":")[0].toLowerCase();
    let org: any = null;
    if (slug) {
      const [o] = await db.select().from(organizations).where(eq(organizations.slug, slug));
      if (o) org = o;
    }
    if (!org && hostname) {
      try {
        const dom = await storage.getCustomDomainByHostname(hostname);
        if (dom) {
          const [o] = await db.select().from(organizations).where(eq(organizations.id, dom.organizationId));
          if (o) org = o;
        }
      } catch {}
    }
    return org;
  }

  app.get("/api/public/venue/resolve", async (req, res) => {
    try {
      const org = await resolveVenueOrg(req);
      if (!org) return res.status(404).json({ message: "Venue not found" });
      let settings = await storage.getVenueSettings(org.id);
      if (!settings) {
        settings = await storage.upsertVenueSettings(org.id, {
          siteTitle: `Book ${org.name}`,
          introText: "",
        });
      }
      res.json({
        organization: { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl || null },
        settings,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Tenant-binding helper: verify a facility actually belongs to the requested org
  async function assertFacilityInOrg(facilityId: number, orgId: number): Promise<boolean> {
    const f = await storage.getFacility(facilityId);
    return !!f && f.organizationId === orgId;
  }

  app.get("/api/public/venue/:orgId/facilities", async (req, res) => {
    try {
      const orgId = parseInt(req.params.orgId);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const facs = await storage.getPublicFacilities(orgId);
      res.json(facs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/venue/:orgId/availability", async (req, res) => {
    try {
      const orgId = parseInt(req.params.orgId);
      const facilityId = parseInt(req.query.facilityId as string);
      const datesStr = (req.query.dates as string) || "";
      const dates = datesStr.split(",").map(d => d.trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      if (!orgId || !facilityId || dates.length === 0) return res.status(400).json({ message: "orgId, facilityId and dates required" });
      if (!(await assertFacilityInOrg(facilityId, orgId))) {
        return res.status(404).json({ message: "Facility not found" });
      }
      const bookings = await storage.getFacilityBookingsForDates(facilityId, dates);
      res.json(bookings.map(b => ({
        date: b.bookingDate,
        startTime: b.startTime,
        endTime: b.endTime,
        halfFull: b.halfFull,
        halfPosition: b.halfPosition,
        status: b.status,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const bookingItemSchema = z.object({
    facilityId: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    halfFull: z.enum(["half", "full"]).nullable().optional(),
    // For half bookings: which half. Required when halfFull === 'half'; ignored otherwise.
    halfPosition: z.enum(["front", "back"]).nullable().optional(),
    addons: z.array(z.object({
      addonId: z.number().int().positive(),
      qty: z.number().int().positive().default(1),
    })).default([]),
  }).refine(
    (v) => v.halfFull !== "half" || (v.halfPosition === "front" || v.halfPosition === "back"),
    { message: "halfPosition (front or back) is required for half bookings", path: ["halfPosition"] }
  );

  async function buildQuote(orgId: number, items: z.infer<typeof bookingItemSchema>[]) {
    const settings = await storage.getVenueSettings(orgId);
    const gstRate = settings ? parseFloat(settings.gstRatePercent) : 15;
    const facs = await storage.getPublicFacilities(orgId);
    const facMap = new Map(facs.map(f => [f.id, f]));
    const allAddons = facs[0]?.addons ?? [];
    const addonMap = new Map(allAddons.map(a => [a.id, a]));

    // Tenant binding: every facilityId in the request must belong to this org's public catalog
    for (const it of items) {
      if (!facMap.has(it.facilityId)) throw new Error(`Facility ${it.facilityId} not available`);
    }

    const lineItems = items.map((item) => {
      const facility = facMap.get(item.facilityId);
      if (!facility) throw new Error(`Facility ${item.facilityId} not available`);
      const baseCents = calcItemPriceCents(item, facility, facility.pricingRules);
      const [sh, sm] = item.startTime.split(":").map(Number);
      const [eh, em] = item.endTime.split(":").map(Number);
      const hours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      const addonLines = item.addons.map(a => {
        const addon = addonMap.get(a.addonId);
        if (!addon) throw new Error(`Add-on ${a.addonId} not available`);
        return {
          addonId: addon.id,
          name: addon.name,
          unit: addon.unit,
          qty: a.qty,
          priceCents: calcAddonCents(addon, a.qty, hours),
        };
      });
      const addonsCents = addonLines.reduce((s, a) => s + a.priceCents, 0);
      return {
        facilityId: item.facilityId,
        facilityName: facility.name,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        halfFull: item.halfFull || null,
        halfPosition: item.halfFull === "half" ? (item.halfPosition || null) : null,
        hours,
        baseCents,
        addons: addonLines,
        totalCents: baseCents + addonsCents,
      };
    });

    // Prices are stored GST-inclusive. The customer-facing total is the sum of
    // line items as-is; GST is the portion of that total (15/115 ≈ 13.04%), and
    // the ex-GST subtotal is the remainder. This matches NZ retail convention:
    // "Total $X.XX (includes 15% GST $Y.YY)".
    const totalCents = lineItems.reduce((s, l) => s + l.totalCents, 0);
    const gstCents = totalCents - Math.round(totalCents / (1 + gstRate / 100));
    const subtotalCents = totalCents - gstCents;
    return { lineItems, subtotalCents, gstCents, totalCents, gstRate };
  }

  app.post("/api/public/venue/:orgId/bookings/quote", async (req, res) => {
    try {
      const orgId = parseInt(req.params.orgId);
      const items = z.array(bookingItemSchema).min(1).parse(req.body.items);
      const quote = await buildQuote(orgId, items);
      res.json(quote);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  const checkoutSchema = z.object({
    items: z.array(bookingItemSchema).min(1),
    customer: z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional().default(""),
      club: z.string().optional().default(""),
      notes: z.string().optional().default(""),
    }),
  });

  app.post("/api/public/venue/:orgId/bookings/checkout", async (req, res) => {
    try {
      const orgId = parseInt(req.params.orgId);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ message: "Stripe not configured" });

      const parsed = checkoutSchema.parse(req.body);
      const quote = await buildQuote(orgId, parsed.items);

      const groupId = `vbg_${crypto.randomBytes(8).toString("hex")}`;

      // line.totalCents is GST-inclusive. Per-line GST is the inc-GST portion
      // (15/115 of the total), and the ex-GST subtotal is the remainder.
      const bookingsToCreate: any[] = quote.lineItems.map((line) => {
        const lineTotalCents = line.totalCents;
        const lineGstCents = lineTotalCents - Math.round(lineTotalCents / (1 + quote.gstRate / 100));
        const lineSubtotalCents = lineTotalCents - lineGstCents;
        return {
          organizationId: orgId,
          facilityId: line.facilityId,
          customerName: parsed.customer.name,
          customerEmail: parsed.customer.email,
          customerPhone: parsed.customer.phone || null,
          customerClub: parsed.customer.club || null,
          bookingDate: line.date,
          startTime: line.startTime,
          endTime: line.endTime,
          halfFull: line.halfFull,
          halfPosition: line.halfFull === "half" ? line.halfPosition : null,
          addonsJson: line.addons,
          subtotalCents: lineSubtotalCents,
          gstCents: lineGstCents,
          totalCents: lineTotalCents,
          totalAmount: (lineTotalCents / 100).toFixed(2),
          gstAmount: (lineGstCents / 100).toFixed(2),
          status: "pending" as const,
          bookingGroupId: groupId,
          notes: parsed.customer.notes || null,
        };
      });

      // Atomic availability reservation: serialize concurrent checkouts for the same facility
      // using PostgreSQL transaction-scoped advisory locks, then re-check for conflicts inside
      // the transaction before inserting the draft bookings.
      const uniqueFacilityIds = Array.from(new Set(parsed.items.map(i => i.facilityId))).sort((a, b) => a - b);
      const created = await db.transaction(async (tx) => {
        for (const fid of uniqueFacilityIds) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${fid})`);
        }
        const datesByFacility = new Map<number, string[]>();
        for (const it of parsed.items) {
          if (!datesByFacility.has(it.facilityId)) datesByFacility.set(it.facilityId, []);
          datesByFacility.get(it.facilityId)!.push(it.date);
        }
        for (const [fid, dates] of datesByFacility.entries()) {
          const existing = await tx.select().from(facilityBookings)
            .where(and(
              eq(facilityBookings.facilityId, fid),
              inArray(facilityBookings.bookingDate, Array.from(new Set(dates))),
              inArray(facilityBookings.status, ["pending", "confirmed", "paid"]),
            ));
          for (const it of parsed.items) {
            if (it.facilityId !== fid) continue;
            const conflict = existing.find(e => {
              if (e.bookingDate !== it.date) return false;
              if (!(e.startTime < it.endTime && e.endTime > it.startTime)) return false;
              // Half-field conflict matrix:
              // - any FULL booking conflicts with anything overlapping
              // - two HALF bookings only coexist if both have a known half_position
              //   AND they're on opposite sides. A null half_position (legacy /
              //   migrated bookings from before front-back tracking existed)
              //   is treated as "blocks both halves" — safer than risking a
              //   double-book until the booking is manually classified.
              const eIsHalf = e.halfFull === "half";
              const nIsHalf = it.halfFull === "half";
              if (!eIsHalf || !nIsHalf) return true;
              if (!e.halfPosition || !it.halfPosition) return true;
              return e.halfPosition === it.halfPosition;
            });
            if (conflict) {
              const half = it.halfFull === "half" ? ` ${it.halfPosition} half` : "";
              throw new Error(`Slot already booked: ${it.date} ${it.startTime}-${it.endTime}${half}`);
            }
          }
        }
        return await tx.insert(facilityBookings).values(bookingsToCreate).returning();
      });

      // Stripe payment intent (created after slots are reserved)
      const { stripe } = await import("./stripe");
      const paymentIntent = await stripe.paymentIntents.create({
        amount: quote.totalCents,
        currency: "nzd",
        receipt_email: parsed.customer.email,
        description: `Facility booking — ${parsed.items.length} session${parsed.items.length > 1 ? "s" : ""}`,
        automatic_payment_methods: { enabled: true },
        metadata: {
          facilityBookingGroupId: groupId,
          organizationId: String(orgId),
          customerEmail: parsed.customer.email,
        },
      });

      // Stamp the PI on the just-created bookings
      await db.update(facilityBookings)
        .set({ stripePaymentIntentId: paymentIntent.id })
        .where(eq(facilityBookings.bookingGroupId, groupId));

      res.json({
        bookingGroupId: groupId,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        quote,
        bookingIds: created.map(b => b.id),
      });
    } catch (error: any) {
      console.error("[Venue Checkout] Error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Subscription checkout — pay-weekly recurring bookings. Creates ALL the
  // future booking rows upfront as 'pending' (so the slots are reserved), plus
  // a Stripe Subscription that bills the customer weekly. As each weekly
  // invoice succeeds the webhook advances the NEXT pending booking → 'paid'.
  // If the customer cancels (or all retries fail), the webhook cancels any
  // remaining pending bookings — already-paid bookings stay confirmed.
  //
  // Constraints (enforced):
  //  - All items must share the same facility, time, half/full, half_position
  //    and add-ons (it's a single recurring slot, not a multi-item cart).
  //  - At least 2 dates, all in the future.
  app.post("/api/public/venue/:orgId/bookings/checkout-subscription", async (req, res) => {
    try {
      const orgId = parseInt(req.params.orgId);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ message: "Stripe not configured" });

      const parsed = checkoutSchema.parse(req.body);
      if (parsed.items.length < 2) {
        return res.status(400).json({ message: "Subscription bookings need at least 2 dates" });
      }

      // All items must share the same shape — it's one recurring slot.
      const first = parsed.items[0];
      const sameSlot = parsed.items.every(it =>
        it.facilityId === first.facilityId &&
        it.startTime === first.startTime &&
        it.endTime === first.endTime &&
        (it.halfFull || null) === (first.halfFull || null) &&
        (it.halfPosition || null) === (first.halfPosition || null) &&
        JSON.stringify(it.addons) === JSON.stringify(first.addons)
      );
      if (!sameSlot) {
        return res.status(400).json({ message: "All recurring bookings must be the same slot" });
      }

      const quote = await buildQuote(orgId, parsed.items);
      const totalCents = quote.totalCents;
      const weeklyCents = Math.round(totalCents / parsed.items.length);

      const groupId = `vbg_${crypto.randomBytes(8).toString("hex")}`;
      const sortedDates = [...parsed.items].sort((a, b) => a.date.localeCompare(b.date));
      const lastDate = sortedDates[sortedDates.length - 1].date;

      // Reserve all the slots first (same locking as one-shot checkout).
      const bookingsToCreate = quote.lineItems.map((line, idx) => {
        const lineTotalCents = line.totalCents;
        const lineGstCents = lineTotalCents - Math.round(lineTotalCents / (1 + quote.gstRate / 100));
        const lineSubtotalCents = lineTotalCents - lineGstCents;
        return {
          organizationId: orgId,
          facilityId: line.facilityId,
          customerName: parsed.customer.name,
          customerEmail: parsed.customer.email,
          customerPhone: parsed.customer.phone || null,
          customerClub: parsed.customer.club || null,
          bookingDate: line.date,
          startTime: line.startTime,
          endTime: line.endTime,
          halfFull: line.halfFull,
          halfPosition: line.halfFull === "half" ? line.halfPosition : null,
          addonsJson: line.addons,
          subtotalCents: lineSubtotalCents,
          gstCents: lineGstCents,
          totalCents: lineTotalCents,
          totalAmount: (lineTotalCents / 100).toFixed(2),
          gstAmount: (lineGstCents / 100).toFixed(2),
          status: "pending" as const,
          bookingGroupId: groupId,
          notes: parsed.customer.notes
            ? `${parsed.customer.notes}\n[Recurring weekly · ${idx + 1}/${parsed.items.length}]`
            : `[Recurring weekly · ${idx + 1}/${parsed.items.length}]`,
        };
      });

      const uniqueFacilityIds = Array.from(new Set(parsed.items.map(i => i.facilityId))).sort((a, b) => a - b);
      await db.transaction(async (tx) => {
        for (const fid of uniqueFacilityIds) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${fid})`);
        }
        const existing = await tx.select().from(facilityBookings)
          .where(and(
            eq(facilityBookings.facilityId, first.facilityId),
            inArray(facilityBookings.bookingDate, parsed.items.map(i => i.date)),
            inArray(facilityBookings.status, ["pending", "confirmed", "paid"]),
          ));
        for (const it of parsed.items) {
          const conflict = existing.find(e => {
            if (e.bookingDate !== it.date) return false;
            if (!(e.startTime < it.endTime && e.endTime > it.startTime)) return false;
            const eIsHalf = e.halfFull === "half";
            const nIsHalf = it.halfFull === "half";
            if (!eIsHalf || !nIsHalf) return true;
            if (!e.halfPosition || !it.halfPosition) return true;
            return e.halfPosition === it.halfPosition;
          });
          if (conflict) {
            const half = it.halfFull === "half" ? ` ${it.halfPosition} half` : "";
            throw new Error(`Slot already booked: ${it.date} ${it.startTime}-${it.endTime}${half}`);
          }
        }
        await tx.insert(facilityBookings).values(bookingsToCreate);
      });

      // Stripe: customer + subscription. Use price_data inline so we don't
      // need to manage long-lived Price objects per booking.
      const { stripe } = await import("./stripe");
      const customer = await stripe.customers.create({
        email: parsed.customer.email,
        name: parsed.customer.name,
        phone: parsed.customer.phone || undefined,
        metadata: { facilityBookingGroupId: groupId, organizationId: String(orgId) },
      });

      // cancel_at = end of last booking day so Stripe auto-cancels after the
      // final week is paid. Adds 1 day so the final invoice fires in time.
      const cancelAt = Math.floor(new Date(lastDate + "T23:59:00Z").getTime() / 1000) + 86400;

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{
          price_data: {
            currency: "nzd",
            product_data: { name: `Weekly facility booking — ${parsed.items.length} weeks` },
            unit_amount: weeklyCents,
            recurring: { interval: "week" },
          },
        }],
        cancel_at: cancelAt,
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
          payment_method_types: ["card"],
        },
        expand: ["latest_invoice.payment_intent"],
        metadata: {
          facilityBookingGroupId: groupId,
          organizationId: String(orgId),
          customerEmail: parsed.customer.email,
          totalWeeks: String(parsed.items.length),
        },
      });

      const latestInvoice: any = subscription.latest_invoice;
      const paymentIntent: any = latestInvoice?.payment_intent;
      const clientSecret: string | undefined = paymentIntent?.client_secret;
      if (!clientSecret) {
        throw new Error("Stripe did not return a client secret for the subscription's first invoice");
      }

      // Stamp the subscription id on every booking + the first invoice's PI on
      // the first chronological booking so the existing payment_intent.succeeded
      // webhook can confirm it.
      await db.update(facilityBookings)
        .set({ stripeSubscriptionId: subscription.id })
        .where(eq(facilityBookings.bookingGroupId, groupId));
      await db.update(facilityBookings)
        .set({ stripePaymentIntentId: paymentIntent.id })
        .where(and(
          eq(facilityBookings.bookingGroupId, groupId),
          eq(facilityBookings.bookingDate, sortedDates[0].date),
        ));

      res.json({
        bookingGroupId: groupId,
        subscriptionId: subscription.id,
        clientSecret,
        weeklyAmountCents: weeklyCents,
        totalWeeks: parsed.items.length,
        quote,
      });
    } catch (error: any) {
      console.error("[Venue Subscription Checkout] Error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Cancel any still-pending bookings in a group (used when the customer navigates back
  // from the payment step). Only updates rows whose status is still 'pending' so a
  // concurrent payment success isn't clobbered. Requires the customer's email to prove
  // ownership — group ids have ~64 bits of entropy but we still gate this to prevent
  // abuse if a group id is leaked (e.g. via a shared link).
  app.post("/api/public/venue/booking-group/:groupId/cancel-pending", async (req, res) => {
    try {
      const groupId = req.params.groupId;
      const emailQ = ((req.body?.email as string) || "").trim().toLowerCase();
      if (!emailQ) return res.status(400).json({ message: "email required" });
      const bookings = await db.select().from(facilityBookings)
        .where(eq(facilityBookings.bookingGroupId, groupId));
      if (bookings.length === 0) return res.status(404).json({ message: "Booking group not found" });
      if ((bookings[0].customerEmail || "").toLowerCase() !== emailQ) {
        return res.status(404).json({ message: "Booking group not found" });
      }
      const cancelled = await storage.cancelPendingFacilityBookingsByGroup(groupId);
      res.json({ cancelled: cancelled.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Fetch a booking group for the success page. Requires ?email= matching the booking's
  // customer email (case-insensitive) so anyone with the group id alone can't read PII.
  app.get("/api/public/venue/booking-group/:groupId", async (req, res) => {
    try {
      const groupId = req.params.groupId;
      const emailQ = ((req.query.email as string) || "").trim().toLowerCase();
      if (!emailQ) return res.status(400).json({ message: "email required" });
      const bookings = await db.select({
        booking: facilityBookings,
        facility: facilities,
      }).from(facilityBookings)
        .leftJoin(facilities, eq(facilityBookings.facilityId, facilities.id))
        .where(eq(facilityBookings.bookingGroupId, groupId));
      if (bookings.length === 0) return res.status(404).json({ message: "Booking group not found" });
      if ((bookings[0].booking.customerEmail || "").toLowerCase() !== emailQ) {
        return res.status(404).json({ message: "Booking group not found" });
      }
      res.json({
        bookings: bookings.map(r => ({ ...r.booking, facilityName: r.facility?.name })),
        status: bookings[0].booking.status,
        customerName: bookings[0].booking.customerName,
        customerEmail: bookings[0].booking.customerEmail,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========= Admin venue settings =========

  // Helper: ensure the current user is a member of the requested org
  async function userHasOrg(userId: number, orgId: number): Promise<boolean> {
    const userOrgs = await storage.getUserOrganizations(userId);
    return userOrgs.some((o: any) => o.id === orgId);
  }

  app.get("/api/admin/venue/settings", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!(await userHasOrg(req.session.userId!, orgId))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      let settings = await storage.getVenueSettings(orgId);
      if (!settings) {
        settings = await storage.upsertVenueSettings(orgId, { siteTitle: "Book a Facility" });
      }
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/venue/settings", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      if (!(await userHasOrg(req.session.userId!, orgId))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const settings = await storage.upsertVenueSettings(orgId, req.body);
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/league/competitions", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const comps = await storage.getLeagueCompetitions(orgId);
      res.json(comps);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/league/competitions/:id", requireAuth, async (req, res) => {
    try {
      const comp = await storage.getLeagueCompetition(parseInt(req.params.id));
      if (!comp) return res.status(404).json({ message: "Not found" });
      res.json(comp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/league/competitions", requireAuth, async (req, res) => {
    try {
      const comp = await storage.createLeagueCompetition(req.body);
      res.json(comp);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/league/competitions/:id", requireAuth, async (req, res) => {
    try {
      const comp = await storage.updateLeagueCompetition(parseInt(req.params.id), req.body);
      if (!comp) return res.status(404).json({ message: "Not found" });
      res.json(comp);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/league/competitions/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteLeagueCompetition(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/league/competitions/:id/divisions", requireAuth, async (req, res) => {
    try {
      const divs = await storage.getLeagueDivisions(parseInt(req.params.id));
      res.json(divs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/league/divisions", requireAuth, async (req, res) => {
    try {
      const div = await storage.createLeagueDivision(req.body);
      res.json(div);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/league/divisions/:id", requireAuth, async (req, res) => {
    try {
      const div = await storage.updateLeagueDivision(parseInt(req.params.id), req.body);
      if (!div) return res.status(404).json({ message: "Not found" });
      res.json(div);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/league/divisions/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteLeagueDivision(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/league/teams", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const competitionId = req.query.competitionId ? parseInt(req.query.competitionId as string) : undefined;
      const teams = await storage.getLeagueTeams(orgId, competitionId);
      res.json(teams);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/league/teams", requireAuth, async (req, res) => {
    try {
      const team = await storage.createLeagueTeam(req.body);
      res.json(team);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/league/teams/:id", requireAuth, async (req, res) => {
    try {
      const team = await storage.updateLeagueTeam(parseInt(req.params.id), req.body);
      if (!team) return res.status(404).json({ message: "Not found" });
      res.json(team);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/league/teams/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteLeagueTeam(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/league/competitions/:id/games", requireAuth, async (req, res) => {
    try {
      const games = await storage.getLeagueGames(parseInt(req.params.id));
      res.json(games);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/league/games", requireAuth, async (req, res) => {
    try {
      const game = await storage.createLeagueGame(req.body);
      res.json(game);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/league/games/:id", requireAuth, async (req, res) => {
    try {
      const game = await storage.updateLeagueGame(parseInt(req.params.id), req.body);
      if (!game) return res.status(404).json({ message: "Not found" });
      res.json(game);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/league/games/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteLeagueGame(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/league/competitions/:id/standings", requireAuth, async (req, res) => {
    try {
      const divisionId = req.query.divisionId ? parseInt(req.query.divisionId as string) : undefined;
      const standings = await storage.getLeagueStandings(parseInt(req.params.id), divisionId);
      res.json(standings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/league/competitions/:id/coupons", requireAuth, async (req, res) => {
    try {
      const coupons = await storage.getLeagueCoupons(parseInt(req.params.id));
      res.json(coupons);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/league/coupons", requireAuth, async (req, res) => {
    try {
      const coupon = await storage.createLeagueCoupon(req.body);
      res.json(coupon);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/league/coupons/:id", requireAuth, async (req, res) => {
    try {
      const coupon = await storage.updateLeagueCoupon(parseInt(req.params.id), req.body);
      if (!coupon) return res.status(404).json({ message: "Not found" });
      res.json(coupon);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/league/coupons/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteLeagueCoupon(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ============ CLUBS (tournament CRM — org-scoped club registry) ============

  app.get("/api/admin/clubs", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const list = await storage.getClubs(orgId);
      res.json(list);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/clubs/:id", requireAuth, async (req, res) => {
    try {
      const club = await storage.getClub(parseInt(req.params.id));
      if (!club) return res.status(404).json({ message: "Club not found" });
      res.json(club);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/clubs/:id/teams", requireAuth, async (req, res) => {
    try {
      const teams = await storage.getClubTeams(parseInt(req.params.id));
      res.json(teams);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/clubs", requireAuth, async (req, res) => {
    try {
      const club = await storage.createClub(req.body);
      res.status(201).json(club);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch("/api/admin/clubs/:id", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updateClub(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Club not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/admin/clubs/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteClub(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // Club logo upload — same image pipeline as team logos (sharp validate,
  // resize 512px square-fit, webp + avif, public ACL, write logoUrl).
  const clubLogoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/") || file.mimetype === "image/svg+xml") {
        return cb(new Error(`"${file.originalname}" is not a supported image type`));
      }
      cb(null, true);
    },
  });

  app.post(
    "/api/admin/clubs/:id/logo",
    requireAuth,
    clubLogoUpload.single("file"),
    async (req, res) => {
      const id = parseInt(req.params.id);
      const club = await storage.getClub(id);
      if (!club) return res.status(404).json({ message: "Club not found" });
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });

      const svc = new ObjectStorageService();
      const uploaded: { gcsFile: any; objectPath: string }[] = [];
      try {
        const meta = await sharp(file.buffer, { failOn: "error", animated: false, limitInputPixels: 50_000_000 }).metadata();
        if (!meta.format || !["jpeg","jpg","png","webp","gif","tiff","heif","heic","avif"].includes(meta.format)) {
          throw new Error(`Unsupported format: ${meta.format || "unknown"}`);
        }
        const base = sharp(file.buffer, { failOn: "error", animated: false, limitInputPixels: 50_000_000 })
          .rotate()
          .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true });
        const [webpBuf, avifBuf] = await Promise.all([
          base.clone().webp({ quality: 90, effort: 4 }).toBuffer(),
          base.clone().avif({ quality: 60, effort: 3 }).toBuffer(),
        ]);
        const sharedId = crypto.randomUUID();
        const upload = async (buf: Buffer, contentType: string, ext: string) => {
          const u = await svc.uploadBufferToUploads(buf, contentType, ext, sharedId);
          uploaded.push({ gcsFile: u.file, objectPath: u.objectPath });
          await setObjectAclPolicy(u.file, { owner: String(req.session.userId), visibility: "public" });
          return u;
        };
        const results = await Promise.allSettled([
          upload(webpBuf, "image/webp", "webp"),
          upload(avifBuf, "image/avif", "avif"),
        ]);
        const failed = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
        if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
        const webpPath = uploaded.find(u => u.objectPath.endsWith(".webp"))!.objectPath;
        const updated = await storage.updateClub(id, { logoUrl: webpPath } as any);
        res.json(updated);
      } catch (error: any) {
        await Promise.allSettled(uploaded.map(u => u.gcsFile.delete({ ignoreNotFound: true })));
        res.status(400).json({ message: error.message || "Logo upload failed" });
      }
    }
  );

  app.delete("/api/admin/clubs/:id/logo", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updateClub(parseInt(req.params.id), { logoUrl: null } as any);
      res.json(updated);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // ============ TOURNAMENT ROUTES ============

  app.get("/api/admin/tournament/tournaments", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      const list = await storage.getTournaments(orgId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/tournaments/:id", requireAuth, async (req, res) => {
    try {
      const t = await storage.getTournament(parseInt(req.params.id));
      if (!t) return res.status(404).json({ message: "Not found" });
      res.json(t);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/tournaments", requireAuth, async (req, res) => {
    try {
      const t = await storage.createTournament(req.body);
      res.json(t);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tournament/tournaments/:id", requireAuth, async (req, res) => {
    try {
      const t = await storage.updateTournament(parseInt(req.params.id), req.body);
      if (!t) return res.status(404).json({ message: "Not found" });
      res.json(t);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/tournament/tournaments/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTournament(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/tournaments/:id/groups", requireAuth, async (req, res) => {
    try {
      const groups = await storage.getTournamentGroups(parseInt(req.params.id));
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/groups", requireAuth, async (req, res) => {
    try {
      const g = await storage.createTournamentGroup(req.body);
      res.json(g);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tournament/groups/:id", requireAuth, async (req, res) => {
    try {
      const g = await storage.updateTournamentGroup(parseInt(req.params.id), req.body);
      if (!g) return res.status(404).json({ message: "Not found" });
      res.json(g);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/tournament/groups/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTournamentGroup(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/tournaments/:id/teams", requireAuth, async (req, res) => {
    try {
      const teams = await storage.getTournamentTeams(parseInt(req.params.id));
      res.json(teams);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/teams/:id", requireAuth, async (req, res) => {
    try {
      const t = await storage.getTournamentTeam(parseInt(req.params.id));
      if (!t) return res.status(404).json({ message: "Not found" });
      res.json(t);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/teams", requireAuth, async (req, res) => {
    try {
      const t = await storage.createTournamentTeam(req.body);
      res.json(t);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tournament/teams/:id", requireAuth, async (req, res) => {
    try {
      const t = await storage.updateTournamentTeam(parseInt(req.params.id), req.body);
      if (!t) return res.status(404).json({ message: "Not found" });
      res.json(t);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Team logo upload — single image, resized to a 512px square-fit, written
  // to Supabase Storage with both .webp and .avif siblings (the .avif is
  // picked up automatically by client-side <picture> tags). Logo URL stored
  // on tournament_teams.logoUrl. Mirrors the facility-image upload flow but
  // simpler since there's only one logo per team (not an array).
  const teamLogoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap — logos are small
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/") || file.mimetype === "image/svg+xml") {
        return cb(new Error(`"${file.originalname}" is not a supported image type`));
      }
      cb(null, true);
    },
  });

  app.post(
    "/api/admin/tournament/teams/:id/logo",
    requireAuth,
    teamLogoUpload.single("file"),
    async (req, res) => {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTournamentTeam(teamId);
      if (!team) return res.status(404).json({ message: "Team not found" });
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });

      const svc = new ObjectStorageService();
      const uploaded: { gcsFile: any; objectPath: string }[] = [];
      try {
        // Probe with sharp first to validate it's a real image.
        const meta = await sharp(file.buffer, {
          failOn: "error",
          animated: false,
          limitInputPixels: 50_000_000,
        }).metadata();
        if (!meta.format || !["jpeg","jpg","png","webp","gif","tiff","heif","heic","avif"].includes(meta.format)) {
          throw new Error(`Unsupported format: ${meta.format || "unknown"}`);
        }

        // Logos: cap dimension at 512 (plenty for retina), preserve aspect.
        const base = sharp(file.buffer, {
          failOn: "error",
          animated: false,
          limitInputPixels: 50_000_000,
        })
          .rotate()
          .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true });

        const [webpBuf, avifBuf] = await Promise.all([
          base.clone().webp({ quality: 90, effort: 4 }).toBuffer(),
          base.clone().avif({ quality: 60, effort: 3 }).toBuffer(),
        ]);

        const sharedId = crypto.randomUUID();
        const upload = async (buf: Buffer, contentType: string, ext: string) => {
          const u = await svc.uploadBufferToUploads(buf, contentType, ext, sharedId);
          uploaded.push({ gcsFile: u.file, objectPath: u.objectPath });
          await setObjectAclPolicy(u.file, {
            owner: String(req.session.userId),
            visibility: "public",
          });
          return u;
        };
        const results = await Promise.allSettled([
          upload(webpBuf, "image/webp", "webp"),
          upload(avifBuf, "image/avif", "avif"),
        ]);
        const failed = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
        if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));

        const webpPath = uploaded.find(u => u.objectPath.endsWith(".webp"))!.objectPath;
        const updated = await storage.updateTournamentTeam(teamId, { logoUrl: webpPath } as any);
        res.json(updated);
      } catch (error: any) {
        await Promise.allSettled(uploaded.map(u => u.gcsFile.delete({ ignoreNotFound: true })));
        res.status(400).json({ message: error.message || "Logo upload failed" });
      }
    }
  );

  app.delete("/api/admin/tournament/teams/:id/logo", requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTournamentTeam(teamId);
      if (!team) return res.status(404).json({ message: "Team not found" });
      // We deliberately don't delete the storage object — different teams
      // may share a logo (e.g. CUFC entering multiple age groups). Clearing
      // logoUrl just unbinds it from this team.
      const updated = await storage.updateTournamentTeam(teamId, { logoUrl: null } as any);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/tournament/teams/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTournamentTeam(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/teams/:id/players", requireAuth, async (req, res) => {
    try {
      const players = await storage.getTournamentPlayers(parseInt(req.params.id));
      res.json(players);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/players", requireAuth, async (req, res) => {
    try {
      const p = await storage.createTournamentPlayer(req.body);
      res.json(p);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tournament/players/:id", requireAuth, async (req, res) => {
    try {
      const p = await storage.updateTournamentPlayer(parseInt(req.params.id), req.body);
      if (!p) return res.status(404).json({ message: "Not found" });
      res.json(p);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/tournament/players/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTournamentPlayer(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/teams/:id/staff", requireAuth, async (req, res) => {
    try {
      const staff = await storage.getTournamentStaff(parseInt(req.params.id));
      res.json(staff);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/staff", requireAuth, async (req, res) => {
    try {
      const s = await storage.createTournamentStaff(req.body);
      res.json(s);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tournament/staff/:id", requireAuth, async (req, res) => {
    try {
      const s = await storage.updateTournamentStaff(parseInt(req.params.id), req.body);
      if (!s) return res.status(404).json({ message: "Not found" });
      res.json(s);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/tournament/staff/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTournamentStaff(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/tournaments/:id/games", requireAuth, async (req, res) => {
    try {
      const games = await storage.getTournamentGames(parseInt(req.params.id));
      res.json(games);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/games", requireAuth, async (req, res) => {
    try {
      const g = await storage.createTournamentGame(req.body);
      res.json(g);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tournament/games/:id", requireAuth, async (req, res) => {
    try {
      const g = await storage.updateTournamentGame(parseInt(req.params.id), req.body);
      if (!g) return res.status(404).json({ message: "Not found" });
      res.json(g);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/tournament/games/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTournamentGame(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ─── Goals (one row per goal scored — feeds top scorers + match goal lists) ───

  app.get("/api/admin/tournament/games/:id/goals", requireAuth, async (req, res) => {
    try {
      const list = await storage.getTournamentGoalsByGame(parseInt(req.params.id));
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/goals", requireAuth, async (req, res) => {
    try {
      const goal = await storage.createTournamentGoal(req.body);
      res.status(201).json(goal);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/tournament/goals/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTournamentGoal(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ─── Player age verification ───
  // Admin uploads a passport / birth certificate scan, then flips the
  // ageVerified flag once they've eyeballed it. Documents go to private
  // Supabase Storage (no public ACL) — only authenticated admins should
  // be able to retrieve them.

  const ageDocUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap (pdf scans can be big)
    fileFilter: (_req, file, cb) => {
      const ok = file.mimetype.startsWith("image/") || file.mimetype === "application/pdf";
      if (!ok) return cb(new Error(`"${file.originalname}" is not a supported document type (image or PDF)`));
      cb(null, true);
    },
  });

  app.post(
    "/api/admin/tournament/players/:id/age-document",
    requireAuth,
    ageDocUpload.single("file"),
    async (req, res) => {
      const id = parseInt(req.params.id);
      const player = await storage.getTournamentPlayer(id);
      if (!player) return res.status(404).json({ message: "Player not found" });
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });

      const docType = (req.body?.documentType as string) || "unknown";
      const svc = new ObjectStorageService();
      try {
        const ext = file.mimetype === "application/pdf" ? "pdf"
          : file.mimetype === "image/jpeg" ? "jpg"
          : file.mimetype === "image/png" ? "png"
          : file.mimetype === "image/webp" ? "webp"
          : "bin";
        const sharedId = crypto.randomUUID();
        const u = await svc.uploadBufferToUploads(file.buffer, file.mimetype, ext, sharedId);
        // Private ACL — age verification docs are sensitive personal info.
        await setObjectAclPolicy(u.file, {
          owner: String(req.session.userId),
          visibility: "private",
        });
        const updated = await storage.updateTournamentPlayer(id, {
          idDocumentUrl: u.objectPath,
          idDocumentType: docType,
          // Uploading a new doc resets verification — admin must re-confirm.
          ageVerified: false,
          verifiedByUserId: null,
          verifiedAt: null,
        } as any);
        res.json(updated);
      } catch (error: any) {
        res.status(400).json({ message: error.message || "Document upload failed" });
      }
    }
  );

  app.post("/api/admin/tournament/players/:id/verify-age", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const player = await storage.getTournamentPlayer(id);
      if (!player) return res.status(404).json({ message: "Player not found" });
      if (!player.idDocumentUrl) {
        return res.status(400).json({ message: "Cannot verify — no age document uploaded yet" });
      }
      const updated = await storage.updateTournamentPlayer(id, {
        ageVerified: true,
        verifiedByUserId: req.session.userId,
        verifiedAt: new Date(),
      } as any);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/players/:id/unverify-age", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateTournamentPlayer(id, {
        ageVerified: false,
        verifiedByUserId: null,
        verifiedAt: null,
      } as any);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/tournament/tournaments/:id/standings", requireAuth, async (req, res) => {
    try {
      const standings = await storage.getTournamentGroupStandings(parseInt(req.params.id));
      res.json(standings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/tournaments/:id/generate-groups", requireAuth, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) return res.status(404).json({ message: "Not found" });
      const numGroups = tournament.numGroups || 4;
      const existingGroups = await storage.getTournamentGroups(tournamentId);
      if (existingGroups.length > 0) {
        return res.status(400).json({ message: "Groups already exist. Delete them first to regenerate." });
      }
      const groups = [];
      for (let i = 0; i < numGroups; i++) {
        const g = await storage.createTournamentGroup({
          tournamentId,
          name: `Group ${String.fromCharCode(65 + i)}`,
          sortOrder: i,
        });
        groups.push(g);
      }
      res.json(groups);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/admin/tournament/tournaments/:id/generate-schedule", requireAuth, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) return res.status(404).json({ message: "Not found" });
      const groups = await storage.getTournamentGroups(tournamentId);
      const allTeams = await storage.getTournamentTeams(tournamentId);

      // Wipe any existing schedule first so re-runs don't pile up duplicates.
      // Score data on existing games is intentionally lost — generators are
      // for setting up an empty bracket, not editing a live tournament.
      const existing = await storage.getTournamentGames(tournamentId);
      for (const g of existing) {
        await storage.deleteTournamentGame(g.id);
      }

      // CIC 16-team / 4-pool format. Pulls in the canonical 48-game schedule
      // (pool play + Cup/Plate brackets + 1st/3rd/5th/7th/9th/11th/13th/15th
      // placement matches) with times and field allocation per the master sheet.
      // Works without a start date — gameDate is left null per game so admins
      // can fill dates in later, but the full bracket structure + times +
      // fields still get generated.
      if (groups.length === 4 && allTeams.length >= 12) {
        // Postgres `date` columns come back from node-pg as JS Dates parsed
        // in local time. Using toISOString() converts to UTC and silently
        // shifts the date back by a day in NZST (UTC+12/+13). Use local
        // accessors so the user-intended date is preserved.
        const sd = tournament.startDate;
        const startDate: string | null = !sd
          ? null
          : typeof sd === "string"
            ? sd.slice(0, 10)
            : `${(sd as Date).getFullYear()}-${String((sd as Date).getMonth() + 1).padStart(2, "0")}-${String((sd as Date).getDate()).padStart(2, "0")}`;
        const inserts = buildCICSchedule({
          tournamentId,
          startDate,
          groups,
          teams: allTeams,
        });
        const created = [];
        for (const ins of inserts) {
          created.push(await storage.createTournamentGame(ins));
        }
        return res.json(created);
      }

      // Fallback for non-CIC layouts (2 pools, etc.) — simple round-robin
      // pool play + flat knockout bracket. Doesn't allocate times/fields.
      let gameNumber = 1;
      const games = [];
      for (const group of groups) {
        const groupTeams = allTeams.filter(t => t.groupId === group.id);
        for (let i = 0; i < groupTeams.length; i++) {
          for (let j = i + 1; j < groupTeams.length; j++) {
            const g = await storage.createTournamentGame({
              tournamentId,
              groupId: group.id,
              homeTeamId: groupTeams[i].id,
              awayTeamId: groupTeams[j].id,
              gameNumber: gameNumber++,
              roundNumber: null,
              stage: "group",
              stageDetail: group.name,
              gameDate: tournament.startDate || null,
              status: "scheduled",
            });
            games.push(g);
          }
        }
      }
      if (groups.length === 2) {
        const pairs = [
          { home: "A1", away: "B2", stage: "knockout", detail: "SF 1" },
          { home: "B1", away: "A2", stage: "knockout", detail: "SF 2" },
          { home: "L SF1", away: "L SF2", stage: "knockout", detail: "3rd Place" },
          { home: "W SF1", away: "W SF2", stage: "final", detail: "FINAL" },
        ];
        for (const p of pairs) {
          const g = await storage.createTournamentGame({
            tournamentId,
            groupId: null,
            homeTeamId: null,
            awayTeamId: null,
            homeTeamPlaceholder: p.home,
            awayTeamPlaceholder: p.away,
            gameNumber: gameNumber++,
            stage: p.stage,
            stageDetail: p.detail,
            gameDate: tournament.endDate || tournament.startDate || null,
            status: "scheduled",
          });
          games.push(g);
        }
      }
      res.json(games);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/audit-logs", requireAuth, async (_req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============ ANALYTICS ROUTES ============

  function rows(result: any): any[] {
    if (Array.isArray(result)) return result;
    if (result && result.rows) return result.rows;
    return [];
  }
  function row0(result: any): any {
    const r = rows(result);
    return r[0] || {};
  }

  app.post("/api/public/analytics/event", async (req, res) => {
    try {
      await db.insert(analyticsEvents).values(req.body);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/public/analytics/batch", async (req, res) => {
    try {
      const { events } = req.body || {};
      if (!events || !Array.isArray(events) || events.length === 0) {
        return res.json({ ok: true });
      }
      const validEvents = events.filter((e: any) => e.visitorId && e.sessionId && e.eventType).slice(0, 50);
      if (validEvents.length > 0) {
        await db.insert(analyticsEvents).values(validEvents);
      }
      res.json({ ok: true, count: validEvents.length });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/overview", requireAuth, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const campSlug = req.query.campSlug as string || null;
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;

      let campFilter = "";
      if (campSlug) campFilter = `AND camp_slug = '${campSlug.replace(/'/g, "''")}'`;
      if (orgId) campFilter += ` AND camp_slug IN (SELECT slug FROM programs WHERE organization_id = ${orgId})`;

      const pageViews = row0(await db.execute(sql.raw(`SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as unique_visitors FROM analytics_events WHERE event_type = 'page_view' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const sessions = row0(await db.execute(sql.raw(`SELECT COUNT(DISTINCT session_id) as total FROM analytics_events WHERE event_type IN ('session_start', 'page_view') AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const nvr = row0(await db.execute(sql.raw(`SELECT COUNT(*) FILTER (WHERE (metadata->>'isNewVisitor')::text = 'true') as new_visitors, COUNT(*) FILTER (WHERE (metadata->>'isNewVisitor')::text != 'true' OR metadata->>'isNewVisitor' IS NULL) as returning_visitors FROM analytics_events WHERE event_type = 'session_start' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const avgTime = row0(await db.execute(sql.raw(`SELECT COALESCE(AVG((metadata->>'seconds')::int), 0) as avg_seconds FROM analytics_events WHERE event_type = 'time_on_page' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const scrollDepth = row0(await db.execute(sql.raw(`SELECT COALESCE(AVG((metadata->>'maxPercent')::int), 0) as avg_percent FROM analytics_events WHERE event_type = 'scroll_depth' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const bounceCount = row0(await db.execute(sql.raw(`SELECT COUNT(*) as bounces FROM analytics_events WHERE event_type = 'bounce' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const ctaClicks = row0(await db.execute(sql.raw(`SELECT COUNT(*) as clicks FROM analytics_events WHERE event_type = 'cta_click' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));

      const deviceRows = rows(await db.execute(sql.raw(`SELECT device, COUNT(*) as count FROM analytics_events WHERE event_type = 'page_view' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter} GROUP BY device ORDER BY count DESC`)));
      const sourceRows = rows(await db.execute(sql.raw(`SELECT metadata->>'trafficSource' as source, COUNT(*) as count FROM analytics_events WHERE event_type = 'page_view' AND metadata->>'trafficSource' IS NOT NULL AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter} GROUP BY metadata->>'trafficSource' ORDER BY count DESC`)));

      const totalSessions = Number(sessions.total || 0);
      const totalBounces = Number(bounceCount.bounces || 0);
      const totalPV = Number(pageViews.total || 0);
      const totalCtaClicks = Number(ctaClicks.clicks || 0);

      res.json({
        pageViews: {
          total: totalPV,
          unique: Number(pageViews.unique_visitors || 0),
        },
        sessions: totalSessions,
        newVisitors: Number(nvr.new_visitors || 0),
        returningVisitors: Number(nvr.returning_visitors || 0),
        avgTimeOnPage: Math.round(Number(avgTime.avg_seconds || 0)),
        avgScrollDepth: Math.round(Number(scrollDepth.avg_percent || 0)),
        bounceRate: totalSessions > 0 ? Math.round((totalBounces / totalSessions) * 100) : 0,
        ctaClicks: totalCtaClicks,
        ctaRate: totalPV > 0 ? Math.round((totalCtaClicks / totalPV) * 10000) / 100 : 0,
        devices: deviceRows,
        sources: sourceRows,
      });
    } catch (error: any) {
      console.error("Analytics overview error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/funnel", requireAuth, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const campSlug = req.query.campSlug as string || null;
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
      let campFilter = "";
      if (campSlug) campFilter = `AND camp_slug = '${campSlug.replace(/'/g, "''")}'`;
      if (orgId) campFilter += ` AND camp_slug IN (SELECT slug FROM programs WHERE organization_id = ${orgId})`;

      const pageViewCount = row0(await db.execute(sql.raw(`SELECT COUNT(DISTINCT session_id) as count FROM analytics_events WHERE event_type = 'page_view' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const formViewCount = row0(await db.execute(sql.raw(`SELECT COUNT(DISTINCT session_id) as count FROM analytics_events WHERE event_type = 'form_view' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const formStartCount = row0(await db.execute(sql.raw(`SELECT COUNT(DISTINCT session_id) as count FROM analytics_events WHERE event_type = 'form_step' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));
      const ctaClickCount = row0(await db.execute(sql.raw(`SELECT COUNT(DISTINCT session_id) as count FROM analytics_events WHERE event_type = 'cta_click' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter}`)));

      const stepRows = rows(await db.execute(sql.raw(`SELECT metadata->>'step' as step, COUNT(DISTINCT session_id) as count FROM analytics_events WHERE event_type = 'form_step' AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day' ${campFilter} GROUP BY metadata->>'step' ORDER BY step`)));

      let regFilter = "";
      if (campSlug) {
        const camp = await storage.getProgramBySlug(campSlug);
        if (camp) regFilter = `AND program_id = ${camp.id}`;
      }
      const completedRegs = row0(await db.execute(sql.raw(`SELECT COUNT(*) as count FROM registrations WHERE status = 'confirmed' AND registered_at >= '${from}' AND registered_at < '${to}'::date + interval '1 day' ${regFilter}`)));
      const pendingRegs = row0(await db.execute(sql.raw(`SELECT COUNT(*) as count FROM registrations WHERE status = 'pending' AND registered_at >= '${from}' AND registered_at < '${to}'::date + interval '1 day' ${regFilter}`)));

      const pvSessions = Number(pageViewCount.count || 0);
      const fvSessions = Number(formViewCount.count || 0);
      const fsSessions = Number(formStartCount.count || 0);
      const completed = Number(completedRegs.count || 0);
      const pending = Number(pendingRegs.count || 0);

      res.json({
        pageViewSessions: pvSessions,
        formViewSessions: fvSessions,
        formStartSessions: fsSessions,
        ctaClickSessions: Number(ctaClickCount.count || 0),
        completedRegistrations: completed,
        abandonedRegistrations: pending,
        steps: stepRows,
        dropOffRate: fvSessions > 0 ? Math.round(((fvSessions - completed) / fvSessions) * 100) : 0,
      });
    } catch (error: any) {
      console.error("Analytics funnel error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/revenue", requireAuth, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const campSlug = req.query.campSlug as string || null;
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;

      let regFilter = "";
      if (campSlug) {
        const camp = await storage.getProgramBySlug(campSlug);
        if (camp) regFilter = `AND r.program_id = ${camp.id}`;
      }
      if (orgId) regFilter += ` AND r.program_id IN (SELECT id FROM programs WHERE organization_id = ${orgId})`;

      const revenueRows = await db.execute(sql.raw(`
        SELECT
          COUNT(*) as total_registrations,
          COALESCE(SUM(r.total_cents), 0) as total_revenue,
          COALESCE(AVG(r.total_cents), 0) as avg_order_value,
          COALESCE(SUM(r.discount_cents), 0) as total_discounts,
          COUNT(*) FILTER (WHERE r.discount_cents > 0) as discounted_orders,
          COUNT(*) FILTER (WHERE r.status = 'refunded') as refunded_orders,
          COALESCE(SUM(CASE WHEN r.status = 'refunded' THEN r.total_cents ELSE 0 END), 0) as refund_amount
        FROM registrations r
        WHERE r.status IN ('confirmed', 'refunded')
        AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day'
        ${regFilter}
      `));

      const campRevenue = await db.execute(sql.raw(`
        SELECT p.name as camp_name, p.slug as camp_slug,
          COUNT(*) as registrations,
          COALESCE(SUM(r.total_cents), 0) as revenue
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE r.status = 'confirmed'
        AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day'
        ${regFilter}
        GROUP BY p.id, p.name, p.slug
        ORDER BY revenue DESC
      `));

      const productMix = await db.execute(sql.raw(`
        SELECT ri.product_type, COUNT(*) as count
        FROM registration_items ri
        JOIN registrations r ON ri.registration_id = r.id
        WHERE r.status = 'confirmed'
        AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day'
        ${regFilter}
        GROUP BY ri.product_type
      `));

      const dailyRevenue = await db.execute(sql.raw(`
        SELECT DATE(r.registered_at) as date, COUNT(*) as registrations, COALESCE(SUM(r.total_cents), 0) as revenue
        FROM registrations r
        WHERE r.status = 'confirmed'
        AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day'
        ${regFilter}
        GROUP BY DATE(r.registered_at)
        ORDER BY date
      `));

      const revRow = row0(revenueRows);
      res.json({
        totalRegistrations: Number(revRow.total_registrations || 0),
        totalRevenue: Number(revRow.total_revenue || 0),
        avgOrderValue: Math.round(Number(revRow.avg_order_value || 0)),
        totalDiscounts: Number(revRow.total_discounts || 0),
        discountedOrders: Number(revRow.discounted_orders || 0),
        refundedOrders: Number(revRow.refunded_orders || 0),
        refundAmount: Number(revRow.refund_amount || 0),
        campRevenue: rows(campRevenue),
        productMix: rows(productMix),
        dailyRevenue: rows(dailyRevenue),
      });
    } catch (error: any) {
      console.error("Analytics revenue error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/customers", requireAuth, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
      const orgFilter = orgId ? `AND r.program_id IN (SELECT id FROM programs WHERE organization_id = ${orgId})` : "";
      const orgFilterPlain = orgId ? `AND program_id IN (SELECT id FROM programs WHERE organization_id = ${orgId})` : "";

      const totalFamilies = row0(await db.execute(sql.raw(`
        SELECT COUNT(DISTINCT r.contact_id) as total FROM registrations r WHERE r.status = 'confirmed' AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day' ${orgFilter}
      `)));

      const newFamilies = row0(await db.execute(sql.raw(`
        SELECT COUNT(DISTINCT r.contact_id) as count FROM registrations r
        WHERE r.status = 'confirmed' AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day' ${orgFilter}
        AND r.contact_id NOT IN (
          SELECT DISTINCT r2.contact_id FROM registrations r2
          WHERE r2.status = 'confirmed' AND r2.registered_at < '${from}' ${orgFilter.replace(/\br\./g, 'r2.')}
        )
      `)));

      const multiChild = row0(await db.execute(sql.raw(`
        SELECT COUNT(*) as count FROM (
          SELECT r.contact_id FROM registration_items ri
          JOIN registrations r ON ri.registration_id = r.id
          WHERE r.status = 'confirmed' AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day' ${orgFilter}
          GROUP BY r.contact_id
          HAVING COUNT(DISTINCT ri.child_id) >= 2
        ) sub
      `)));

      const avgRegsPerFamily = row0(await db.execute(sql.raw(`
        SELECT COALESCE(AVG(reg_count), 0) as avg FROM (
          SELECT contact_id, COUNT(*) as reg_count FROM registrations
          WHERE status = 'confirmed' ${orgFilterPlain}
          GROUP BY contact_id
        ) sub
      `)));

      const ltv = row0(await db.execute(sql.raw(`
        SELECT COALESCE(AVG(total_spent), 0) as avg_ltv FROM (
          SELECT contact_id, SUM(total_cents) as total_spent FROM registrations
          WHERE status = 'confirmed' ${orgFilterPlain}
          GROUP BY contact_id
        ) sub
      `)));

      const total = Number(totalFamilies.total || 0);
      const newCount = Number(newFamilies.count || 0);
      res.json({
        totalFamilies: total,
        newFamilies: newCount,
        returningFamilies: total - newCount,
        returningRate: total > 0 ? Math.round(((total - newCount) / total) * 100) : 0,
        multiChildFamilies: Number(multiChild.count || 0),
        avgRegsPerFamily: Math.round(Number(avgRegsPerFamily.avg || 0) * 10) / 10,
        avgLTV: Math.round(Number(ltv.avg_ltv || 0)),
      });
    } catch (error: any) {
      console.error("Analytics customers error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/camps", requireAuth, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
      const orgFilter = orgId ? `AND p.organization_id = ${orgId}` : "";

      const campPerformance = await db.execute(sql.raw(`
        SELECT p.id, p.name, p.slug, p.start_date, p.end_date,
          COUNT(DISTINCT r.id) as registrations,
          COALESCE(SUM(r.total_cents), 0) as revenue,
          p.age_min, p.age_max
        FROM programs p
        LEFT JOIN registrations r ON r.program_id = p.id AND r.status = 'confirmed'
        AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day'
        WHERE p.type = 'holiday_camp' ${orgFilter}
        GROUP BY p.id, p.name, p.slug, p.start_date, p.end_date, p.age_min, p.age_max
        ORDER BY p.start_date DESC
      `));

      const regTimeline = await db.execute(sql.raw(`
        SELECT DATE(r.registered_at) as date, COUNT(*) as count, p.slug as camp_slug
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE r.status = 'confirmed' ${orgFilter}
        AND r.registered_at >= '${from}' AND r.registered_at < '${to}'::date + interval '1 day'
        GROUP BY DATE(r.registered_at), p.slug
        ORDER BY date
      `));

      res.json({
        campPerformance: rows(campPerformance),
        registrationTimeline: rows(regTimeline),
      });
    } catch (error: any) {
      console.error("Analytics camps error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/heatmap", requireAuth, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const campSlug = req.query.campSlug as string || null;
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
      let campFilter = "";
      if (campSlug) campFilter = `AND camp_slug = '${campSlug.replace(/'/g, "''")}'`;
      if (orgId) campFilter += ` AND camp_slug IN (SELECT slug FROM programs WHERE organization_id = ${orgId})`;

      const clickData = await db.execute(sql.raw(`
        SELECT metadata->>'x' as x, metadata->>'y' as y, metadata->>'scrollY' as scroll_y,
          metadata->>'text' as text, metadata->>'testid' as testid, COUNT(*) as clicks
        FROM analytics_events
        WHERE event_type = 'click'
        AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day'
        ${campFilter}
        GROUP BY metadata->>'x', metadata->>'y', metadata->>'scrollY', metadata->>'text', metadata->>'testid'
        ORDER BY clicks DESC
        LIMIT 200
      `));

      const scrollDropoff = await db.execute(sql.raw(`
        SELECT
          CASE
            WHEN (metadata->>'maxPercent')::int < 25 THEN '0-25%'
            WHEN (metadata->>'maxPercent')::int < 50 THEN '25-50%'
            WHEN (metadata->>'maxPercent')::int < 75 THEN '50-75%'
            ELSE '75-100%'
          END as range,
          COUNT(*) as count
        FROM analytics_events
        WHERE event_type = 'scroll_depth'
        AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day'
        ${campFilter}
        GROUP BY range
        ORDER BY range
      `));

      const topClicked = await db.execute(sql.raw(`
        SELECT metadata->>'text' as element, metadata->>'testid' as testid, COUNT(*) as clicks
        FROM analytics_events
        WHERE event_type = 'click'
        AND timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day'
        ${campFilter}
        AND metadata->>'text' IS NOT NULL AND metadata->>'text' != ''
        GROUP BY metadata->>'text', metadata->>'testid'
        ORDER BY clicks DESC
        LIMIT 20
      `));

      res.json({
        clickData: rows(clickData),
        scrollDropoff: rows(scrollDropoff),
        topClicked: rows(topClicked),
      });
    } catch (error: any) {
      console.error("Analytics heatmap error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/discounts", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string) || 1;
      const list = await storage.getDiscountsByOrg(orgId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/discounts/:id", requireAuth, async (req, res) => {
    try {
      const d = await storage.getDiscount(parseInt(req.params.id));
      if (!d) return res.status(404).json({ message: "Discount not found" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some(o => o.id === d.organizationId)) return res.status(403).json({ message: "Forbidden" });
      res.json(d);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/discounts", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      if (!data.title || !data.organizationId) return res.status(400).json({ message: "Title and organizationId required" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === data.organizationId)) return res.status(403).json({ message: "Forbidden" });
      if (data.method === 'code' && data.code) {
        const existing = await storage.getDiscountsByOrg(data.organizationId);
        const codeExists = existing.find((d: any) => d.code?.toLowerCase() === data.code.toLowerCase());
        if (codeExists) return res.status(400).json({ message: "A discount with this code already exists" });
      }
      if (data.startDate && typeof data.startDate === 'string') data.startDate = new Date(data.startDate);
      if (data.endDate && typeof data.endDate === 'string') data.endDate = new Date(data.endDate);
      const d = await storage.createDiscount(data);
      res.json(d);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/discounts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getDiscount(id);
      if (!existing) return res.status(404).json({ message: "Discount not found" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === existing.organizationId)) return res.status(403).json({ message: "Forbidden" });
      const data = req.body;
      if (data.startDate && typeof data.startDate === 'string') data.startDate = new Date(data.startDate);
      if (data.endDate && typeof data.endDate === 'string') data.endDate = new Date(data.endDate);
      const d = await storage.updateDiscount(id, data);
      res.json(d);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/discounts/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getDiscount(parseInt(req.params.id));
      if (!existing) return res.status(404).json({ message: "Discount not found" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === existing.organizationId)) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteDiscount(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/deployment-info", requireAuth, (_req, res) => {
    const slug = process.env.REPL_SLUG || "";
    const owner = process.env.REPL_OWNER || "";
    const cnameTarget = slug && owner ? `${slug}-${owner}.replit.app` : null;
    res.json({ cnameTarget });
  });

  app.get("/api/admin/domains", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === orgId)) return res.status(403).json({ message: "Forbidden" });
      const domains = await storage.getCustomDomainsByOrg(orgId);
      res.json(domains);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/domains", requireAuth, async (req, res) => {
    try {
      const { organizationId, domain } = req.body;
      if (!organizationId || !domain) return res.status(400).json({ message: "organizationId and domain required" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === organizationId)) return res.status(403).json({ message: "Forbidden" });
      const cleanDomain = domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(cleanDomain)) {
        return res.status(400).json({ message: "Invalid domain format" });
      }
      const existing = await storage.getCustomDomainByHostname(cleanDomain);
      if (existing) return res.status(400).json({ message: "This domain is already registered" });
      const d = await storage.createCustomDomain({ organizationId, domain: cleanDomain, status: "active", verified: false, isPrimary: false });
      res.json(d);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/domains/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const domains = await db.select().from(customDomains).where(eq(customDomains.id, id));
      if (!domains.length) return res.status(404).json({ message: "Domain not found" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === domains[0].organizationId)) return res.status(403).json({ message: "Forbidden" });
      const { isPrimary } = req.body;
      const allowedUpdates: Record<string, any> = {};
      if (typeof isPrimary === "boolean") allowedUpdates.isPrimary = isPrimary;
      const d = await storage.updateCustomDomain(id, allowedUpdates);
      res.json(d);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/domains/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const domains = await db.select().from(customDomains).where(eq(customDomains.id, id));
      if (!domains.length) return res.status(404).json({ message: "Domain not found" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === domains[0].organizationId)) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteCustomDomain(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ====== Native DNS provider integration (GoDaddy) ======
  // Detects which DNS provider hosts a domain (by nameserver lookup) and, when GoDaddy
  // credentials are present and the domain is in the connected GoDaddy account, lets the
  // admin configure the CNAME with one click instead of pasting it in manually.

  app.get("/api/admin/dns/detect", requireAuth, async (req, res) => {
    try {
      const host = String(req.query.domain || "").trim().toLowerCase();
      if (!host) return res.status(400).json({ message: "domain query param required" });
      const detection = await detectDnsProvider(host);
      const cnameHost = getCnameHost(host);
      let canAutoConfigure = false;
      let ownershipError: string | undefined;
      if (detection.provider === "godaddy" && isGoDaddyConfigured()) {
        try {
          canAutoConfigure = await goDaddyOwnsDomain(detection.apexDomain);
          if (!canAutoConfigure) ownershipError = "Detected on GoDaddy, but this domain isn't in the connected GoDaddy account.";
        } catch (e: any) {
          ownershipError = e?.message || "Couldn't verify ownership in GoDaddy account.";
        }
      }
      res.json({
        ...detection,
        cnameHost,
        godaddy: {
          configured: isGoDaddyConfigured(),
          canAutoConfigure,
          ownershipError,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/dns/godaddy/status", requireAuth, async (_req, res) => {
    try {
      const status = await checkGoDaddyConnection();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/domains/:id/auto-configure", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const domains = await db.select().from(customDomains).where(eq(customDomains.id, id));
      if (!domains.length) return res.status(404).json({ message: "Domain not found" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === domains[0].organizationId)) return res.status(403).json({ message: "Forbidden" });

      const slug = process.env.REPL_SLUG || "";
      const owner = process.env.REPL_OWNER || "";
      const cnameTarget = (req.body?.cnameTarget as string)?.trim()
        || (slug && owner ? `${slug}-${owner}.replit.app` : "");
      if (!cnameTarget) {
        return res.status(400).json({ message: "Couldn't determine the CNAME target. Add it in Replit Deployments first." });
      }
      if (!isGoDaddyConfigured()) {
        return res.status(400).json({ message: "GoDaddy API credentials are not set up. An admin needs to add them in environment secrets." });
      }

      const fullHost = domains[0].domain;
      const { apex } = getApexDomain(fullHost);
      const cnameHost = getCnameHost(fullHost);

      const owns = await goDaddyOwnsDomain(apex).catch(() => false);
      if (!owns) {
        return res.status(400).json({ message: `${apex} isn't in the connected GoDaddy account.` });
      }

      // Apex domains can't have a CNAME (DNS spec). The standard workaround is to put the
      // CNAME on www.<apex> and set up a 301 redirect from <apex> → https://www.<apex>.
      if (cnameHost === "@") {
        const wwwTargetUrl = `https://www.${apex}`;
        // Step 1: CNAME the www subdomain to the deployment
        await setGoDaddyCname(apex, "www", cnameTarget);
        // Step 2: Forward the apex to the www version. If forwarding fails (some account types
        //   don't allow it via API), surface a clear error instead of a partial success.
        try {
          await setGoDaddyForwarding(apex, apex, wwwTargetUrl);
        } catch (fwdErr: any) {
          // Return 200 (not 500) so the client can show the partial-success state cleanly.
          // The CNAME *did* get applied, so this isn't a hard failure — the user just needs
          // to add the forward manually (some GoDaddy account types restrict the API).
          return res.status(200).json({
            success: false,
            partialSuccess: true,
            apex,
            cnameHost: "www",
            cnameTarget,
            attachedHost: `www.${apex}`,
            forwardingError: fwdErr?.message || String(fwdErr),
            instructionsUrl: `https://dcc.godaddy.com/control/portfolio/${encodeURIComponent(apex)}/settings?subtab=forwarding`,
            note: `CNAME on www.${apex} was set successfully, but apex forwarding couldn't be set via API. In GoDaddy go to My Products → ${apex} → Domain Settings → Forwarding, and add a permanent (301) redirect from ${apex} to ${wwwTargetUrl}.`,
          });
        }
        return res.json({
          success: true,
          apex,
          cnameHost: "www",
          cnameTarget,
          apexForwarding: { from: apex, to: wwwTargetUrl },
          attachedHost: `www.${apex}`,
          note: "CNAME placed on www subdomain; apex set to forward to www (301 redirect).",
        });
      }

      await setGoDaddyCname(apex, cnameHost, cnameTarget);
      res.json({ success: true, apex, cnameHost, cnameTarget });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/domains/:id/dns-status", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const domains = await db.select().from(customDomains).where(eq(customDomains.id, id));
      if (!domains.length) return res.status(404).json({ message: "Domain not found" });
      const userOrgs = await storage.getUserOrganizations(req.session.userId!);
      if (!userOrgs.some((o: any) => o.id === domains[0].organizationId)) return res.status(403).json({ message: "Forbidden" });
      const fullHost = domains[0].domain;
      const { apex } = getApexDomain(fullHost);
      const cnameHost = getCnameHost(fullHost);
      let configuredTarget: string | null = null;
      let apexForwardingTo: string | null = null;
      // For apex domains, the CNAME lives on `www`, and the apex itself uses HTTP forwarding.
      const effectiveCnameHost = cnameHost === "@" ? "www" : cnameHost;
      try {
        if (isGoDaddyConfigured()) {
          const recs = await getGoDaddyRecords(apex, "CNAME", effectiveCnameHost);
          configuredTarget = recs?.[0]?.data?.replace(/\.$/, "") || null;
          if (cnameHost === "@") {
            const fwd = await getGoDaddyForwarding(apex, apex);
            apexForwardingTo = fwd?.url || null;
          }
        }
      } catch {}
      res.json({
        configuredTarget,
        cnameHost: effectiveCnameHost,
        apex,
        isApex: cnameHost === "@",
        apexForwardingTo,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ====== Calendar categories (sub-calendars) ======
  // Per-organization. Org-membership enforced. Defaults are lazily seeded on first GET.
  app.get("/api/admin/calendar-categories", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const cats = await storage.getCalendarCategories(orgId);
      res.json(cats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Slugify a label into a stable identifier we can store on each event.
  function slugifyLabel(label: string): string {
    return label.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  app.post("/api/admin/calendar-categories", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const label = String(req.body?.label || "").trim();
      const color = String(req.body?.color || "#3b82f6").trim();
      if (!label) return res.status(400).json({ message: "label required" });
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ message: "color must be a #rrggbb hex" });
      // Server generates the slug to keep it canonical and avoid client tampering.
      let slug = slugifyLabel(label);
      if (!slug) return res.status(400).json({ message: "label must contain letters or numbers" });
      // If a category with this slug already exists for this org, append a numeric suffix.
      const existing = await storage.getCalendarCategories(orgId);
      let candidate = slug;
      let n = 2;
      while (existing.some(c => c.slug === candidate)) {
        candidate = `${slug}-${n++}`;
      }
      const displayOrder = existing.length > 0 ? Math.max(...existing.map(c => c.displayOrder)) + 1 : 0;
      const created = await storage.createCalendarCategory({
        organizationId: orgId,
        slug: candidate,
        label,
        color,
        displayOrder,
        isSystem: false,
      });
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/calendar-categories/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getCalendarCategory(id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const patch: Partial<InsertCalendarCategory> = {};
      if (req.body?.label !== undefined) {
        const label = String(req.body.label).trim();
        if (!label) return res.status(400).json({ message: "label cannot be empty" });
        patch.label = label;
      }
      if (req.body?.color !== undefined) {
        const color = String(req.body.color).trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ message: "color must be a #rrggbb hex" });
        patch.color = color;
      }
      if (req.body?.displayOrder !== undefined && Number.isFinite(Number(req.body.displayOrder))) {
        patch.displayOrder = Number(req.body.displayOrder);
      }
      // slug, organizationId, isSystem are intentionally NOT mutable.
      const updated = await storage.updateCalendarCategory(id, patch);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/calendar-categories/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getCalendarCategory(id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      if (existing.isSystem) {
        return res.status(400).json({ message: "Built-in calendars can't be deleted. You can rename or recolour them instead." });
      }
      // Re-home any existing events using this slug to "general" so they stay visible,
      // then delete the category — atomically, in a single transaction. If anything
      // fails mid-way we'd rather the whole operation roll back than leave events
      // pointing at a deleted slug.
      const reassigned = await storage.deleteCalendarCategoryWithReassign(
        id,
        existing.organizationId,
        existing.slug,
        "general"
      );
      res.json({ ok: true, reassignedEvents: reassigned });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ── Project management (boards / groups / tasks) ───────────────────────────
  // Lightweight Monday-style PM. All endpoints are auth-gated. Access is
  // gated on the requesting user belonging to the board's org. brand_tags
  // is a free-form text[] (slugs of orgs the task touches), so a USG-level
  // task can carry ['cufc','sponsorship'] and surface in the right filters.

  app.get("/api/admin/projects/boards", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const boards = await db.select().from(projectBoards)
        .where(and(eq(projectBoards.organizationId, orgId), eq(projectBoards.archived, false)))
        .orderBy(asc(projectBoards.displayOrder), asc(projectBoards.id));
      // Fetch all groups for these boards in one go
      const boardIds = boards.map(b => b.id);
      const groups = boardIds.length > 0
        ? await db.select().from(projectGroups).where(inArray(projectGroups.boardId, boardIds)).orderBy(asc(projectGroups.boardId), asc(projectGroups.displayOrder))
        : [];
      const groupsByBoard = new Map<number, typeof groups>();
      for (const g of groups) {
        const arr = groupsByBoard.get(g.boardId) || [];
        arr.push(g);
        groupsByBoard.set(g.boardId, arr);
      }
      res.json(boards.map(b => ({ ...b, groups: groupsByBoard.get(b.id) || [] })));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/admin/projects/boards", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ message: "name required" });
      const [board] = await db.insert(projectBoards).values({
        organizationId: orgId,
        name,
        description: req.body?.description || null,
        brandTags: Array.isArray(req.body?.brandTags) ? req.body.brandTags : [],
        color: req.body?.color || "#3b82f6",
        createdBy: req.session.userId!,
      }).returning();
      // Auto-seed standard groups
      await db.insert(projectGroups).values([
        { boardId: board.id, name: "Backlog",     color: "#6b7280", isDone: false, displayOrder: 0 },
        { boardId: board.id, name: "In Progress", color: "#3b82f6", isDone: false, displayOrder: 1 },
        { boardId: board.id, name: "Blocked",     color: "#f59e0b", isDone: false, displayOrder: 2 },
        { boardId: board.id, name: "Done",        color: "#22c55e", isDone: true,  displayOrder: 3 },
      ]);
      res.json(board);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/admin/projects/boards/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(projectBoards).where(eq(projectBoards.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const patch: any = {};
      if (typeof req.body.name === "string") patch.name = req.body.name.trim();
      if (typeof req.body.description === "string") patch.description = req.body.description;
      if (Array.isArray(req.body.brandTags)) patch.brandTags = req.body.brandTags;
      if (typeof req.body.color === "string") patch.color = req.body.color;
      if (typeof req.body.archived === "boolean") patch.archived = req.body.archived;
      const [updated] = await db.update(projectBoards).set(patch).where(eq(projectBoards.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.delete("/api/admin/projects/boards/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(projectBoards).where(eq(projectBoards.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await db.delete(projectBoards).where(eq(projectBoards.id, id));
      res.json({ ok: true });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  // ── Tasks ────────────────────────────────────────────────────────────────
  app.get("/api/admin/projects/tasks", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const filters: any[] = [eq(projectTasks.organizationId, orgId)];
      if (req.query.boardId) filters.push(eq(projectTasks.boardId, parseInt(req.query.boardId as string)));
      if (req.query.ownerId) filters.push(eq(projectTasks.ownerId, parseInt(req.query.ownerId as string)));
      const rows = await db.select().from(projectTasks)
        .where(and(...filters))
        .orderBy(asc(projectTasks.displayOrder), asc(projectTasks.id));
      // Optional brand_tag filter — applied server-side on the array column.
      const brand = req.query.brand as string | undefined;
      const filtered = brand
        ? rows.filter(t => Array.isArray(t.brandTags) && t.brandTags.includes(brand))
        : rows;
      res.json(filtered);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // "My tasks" — every task owned by the requesting user, across all boards
  // they have access to. Used by the home view + daily brief integration.
  app.get("/api/admin/projects/tasks/mine", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const userOrgs = await storage.getUserOrganizations(userId);
      const orgIds = userOrgs.map((o: any) => o.id);
      if (orgIds.length === 0) return res.json([]);
      const rows = await db.select().from(projectTasks)
        .where(and(eq(projectTasks.ownerId, userId), inArray(projectTasks.organizationId, orgIds)))
        .orderBy(asc(projectTasks.dueDate), asc(projectTasks.priority));
      res.json(rows);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/admin/projects/tasks", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      const boardId = parseInt(req.body?.boardId);
      if (!orgId || !boardId) return res.status(400).json({ message: "organizationId and boardId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const title = String(req.body?.title || "").trim();
      if (!title) return res.status(400).json({ message: "title required" });
      // Default to first group of the board if none supplied
      let groupId = req.body?.groupId ? parseInt(req.body.groupId) : null;
      if (!groupId) {
        const [firstGroup] = await db.select().from(projectGroups)
          .where(eq(projectGroups.boardId, boardId))
          .orderBy(asc(projectGroups.displayOrder)).limit(1);
        if (firstGroup) groupId = firstGroup.id;
      }
      const [task] = await db.insert(projectTasks).values({
        organizationId: orgId,
        boardId,
        groupId,
        title,
        description: req.body?.description || null,
        priority: req.body?.priority || "medium",
        ownerId: req.body?.ownerId ? parseInt(req.body.ownerId) : null,
        dueDate: req.body?.dueDate || null,
        brandTags: Array.isArray(req.body?.brandTags) ? req.body.brandTags : [],
        createdBy: req.session.userId!,
      }).returning();
      res.json(task);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/admin/projects/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(projectTasks).where(eq(projectTasks.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const patch: any = { updatedAt: new Date() };
      if (typeof req.body.title === "string") patch.title = req.body.title.trim();
      if (typeof req.body.description === "string") patch.description = req.body.description;
      if (typeof req.body.priority === "string") patch.priority = req.body.priority;
      if (req.body.ownerId === null) patch.ownerId = null;
      else if (typeof req.body.ownerId === "number") patch.ownerId = req.body.ownerId;
      if (req.body.dueDate === null) patch.dueDate = null;
      else if (typeof req.body.dueDate === "string") patch.dueDate = req.body.dueDate;
      if (Array.isArray(req.body.brandTags)) patch.brandTags = req.body.brandTags;
      if (typeof req.body.groupId === "number") {
        patch.groupId = req.body.groupId;
        // Auto-stamp completedAt when moved into a 'done' group
        const [g] = await db.select().from(projectGroups).where(eq(projectGroups.id, req.body.groupId));
        if (g) patch.completedAt = g.isDone ? new Date() : null;
      }
      if (typeof req.body.displayOrder === "number") patch.displayOrder = req.body.displayOrder;
      const [updated] = await db.update(projectTasks).set(patch).where(eq(projectTasks.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.delete("/api/admin/projects/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(projectTasks).where(eq(projectTasks.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await db.delete(projectTasks).where(eq(projectTasks.id, id));
      res.json({ ok: true });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  // Lightweight team list — every user with access to a given org. Used by
  // the assignee dropdown in the task editor.
  app.get("/api/admin/projects/team", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const rows = await db.execute(sql`
        SELECT u.id, u.first_name, u.last_name, u.email
        FROM users u
        JOIN user_organizations uo ON uo.user_id = u.id
        WHERE uo.organization_id = ${orgId} AND u.active = true
        ORDER BY u.first_name, u.last_name
      `);
      res.json(rows.rows);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // ── Sponsorship CRM ───────────────────────────────────────────────────────
  // Pipeline + deals lifecycle. All endpoints org-scoped + auth-gated.
  // Stages mirror Daniel's existing Pipedrive flow so the muscle memory
  // carries over: the same 13 columns from sales (new_lead → won) through
  // fulfilment (contract → invoice → onboarded → active).
  const STAGE_DEFAULT_PROBABILITY: Record<string, number> = {
    new_lead: 5, contact_made: 15, qualified: 25, call_scheduled: 35,
    proposal_sent: 50, negotiating: 70, won: 100, lost: 0,
    contract_sent: 100, invoice_sent: 100, invoice_paid: 100,
    onboarded: 100, active: 100,
  };

  app.get("/api/admin/sponsorship/deals", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const rows = await db.select().from(sponsorshipDeals)
        .where(eq(sponsorshipDeals.organizationId, orgId))
        .orderBy(asc(sponsorshipDeals.stage), desc(sponsorshipDeals.dealValueCents));
      const brand = req.query.brand as string | undefined;
      const owner = req.query.ownerId ? parseInt(req.query.ownerId as string) : undefined;
      let filtered = rows;
      if (brand) filtered = filtered.filter(d => Array.isArray(d.brandTags) && d.brandTags.includes(brand));
      if (owner) filtered = filtered.filter(d => d.ownerId === owner);
      res.json(filtered);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // Pipeline summary — KPI strip up top of the sponsorship dashboard.
  app.get("/api/admin/sponsorship/summary", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const rows = await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.organizationId, orgId));
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const wonStages = ["won","contract_sent","invoice_sent","invoice_paid","onboarded","active"];
      const openStages = ["new_lead","contact_made","qualified","call_scheduled","proposal_sent","negotiating"];
      const totalAcv = rows
        .filter(d => wonStages.includes(d.stage))
        .reduce((s, d) => s + (d.dealValueCents || 0), 0);
      const totalContra = rows
        .filter(d => wonStages.includes(d.stage))
        .reduce((s, d) => s + (d.contraValueCents || 0), 0);
      const wonYtd = rows
        .filter(d => wonStages.includes(d.stage) && d.stageChangedAt && new Date(d.stageChangedAt) >= yearStart)
        .reduce((s, d) => s + (d.dealValueCents || 0), 0);
      const openPipeline = rows
        .filter(d => openStages.includes(d.stage))
        .reduce((s, d) => s + (d.dealValueCents || 0), 0);
      const weightedPipeline = rows
        .filter(d => openStages.includes(d.stage))
        .reduce((s, d) => s + Math.round((d.dealValueCents || 0) * ((d.probability || 0) / 100)), 0);
      const byStage: Record<string, { count: number; valueCents: number }> = {};
      for (const d of rows) {
        const k = d.stage;
        if (!byStage[k]) byStage[k] = { count: 0, valueCents: 0 };
        byStage[k].count += 1;
        byStage[k].valueCents += d.dealValueCents || 0;
      }
      res.json({ totalAcvCents: totalAcv, totalContraCents: totalContra, wonYtdCents: wonYtd, openPipelineCents: openPipeline, weightedPipelineCents: weightedPipeline, byStage, count: rows.length });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/admin/sponsorship/deals", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const title = String(req.body?.title || "").trim();
      const company = String(req.body?.sponsorCompany || "").trim();
      if (!title || !company) return res.status(400).json({ message: "title and sponsorCompany required" });
      const stage = req.body?.stage || "new_lead";
      const probability = req.body?.probability ?? STAGE_DEFAULT_PROBABILITY[stage] ?? 10;
      const [deal] = await db.insert(sponsorshipDeals).values({
        organizationId: orgId,
        title,
        sponsorCompany: company,
        primaryContactName: req.body?.primaryContactName || null,
        primaryContactEmail: req.body?.primaryContactEmail || null,
        primaryContactPhone: req.body?.primaryContactPhone || null,
        stage,
        dealValueCents: req.body?.dealValueCents != null ? Math.round(req.body.dealValueCents) : 0,
        contraValueCents: req.body?.contraValueCents != null ? Math.round(req.body.contraValueCents) : 0,
        dealType: req.body?.dealType || "cash",
        currency: req.body?.currency || "NZD",
        brandTags: Array.isArray(req.body?.brandTags) ? req.body.brandTags : [],
        assetCategory: req.body?.assetCategory || null,
        termMonths: req.body?.termMonths ?? null,
        startDate: req.body?.startDate || null,
        endDate: req.body?.endDate || null,
        exclusivity: req.body?.exclusivity || null,
        ownerId: req.body?.ownerId ?? null,
        source: req.body?.source || null,
        probability,
        expectedCloseDate: req.body?.expectedCloseDate || null,
        notes: req.body?.notes || null,
        createdBy: req.session.userId!,
      }).returning();
      res.json(deal);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/admin/sponsorship/deals/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const patch: any = { updatedAt: new Date() };
      const fields = [
        "title","sponsorCompany","primaryContactName","primaryContactEmail","primaryContactPhone",
        "dealType","currency","assetCategory","exclusivity","source","notes",
      ];
      for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f] === "" ? null : req.body[f];
      if (req.body.dealValueCents !== undefined) patch.dealValueCents = req.body.dealValueCents == null ? 0 : Math.round(req.body.dealValueCents);
      if (req.body.contraValueCents !== undefined) patch.contraValueCents = req.body.contraValueCents == null ? 0 : Math.round(req.body.contraValueCents);
      if (req.body.brandTags !== undefined) patch.brandTags = Array.isArray(req.body.brandTags) ? req.body.brandTags : [];
      if (req.body.termMonths !== undefined) patch.termMonths = req.body.termMonths;
      if (req.body.startDate !== undefined) patch.startDate = req.body.startDate || null;
      if (req.body.endDate !== undefined) patch.endDate = req.body.endDate || null;
      if (req.body.expectedCloseDate !== undefined) patch.expectedCloseDate = req.body.expectedCloseDate || null;
      if (req.body.ownerId !== undefined) patch.ownerId = req.body.ownerId;
      if (req.body.probability !== undefined) patch.probability = req.body.probability;
      const wonStages = ["won","contract_sent","invoice_sent","invoice_paid","onboarded","active"];
      const wasWon = wonStages.includes(existing.stage);
      let nowWon = wasWon;
      if (req.body.stage !== undefined && req.body.stage !== existing.stage) {
        patch.stage = req.body.stage;
        patch.stageChangedAt = new Date();
        nowWon = wonStages.includes(req.body.stage);
        // If client didn't override probability, snap it to the new stage's default.
        if (req.body.probability === undefined) {
          patch.probability = STAGE_DEFAULT_PROBABILITY[req.body.stage] ?? existing.probability;
        }
      }
      const [updated] = await db.update(sponsorshipDeals).set(patch).where(eq(sponsorshipDeals.id, id)).returning();

      // Auto-instantiate onboarding template the first time a deal crosses
      // into a "won" state. Only fires once — if any onboarding deliverables
      // already exist for this deal we don't double-up.
      if (!wasWon && nowWon) {
        const existingOnboarding = await db.select().from(sponsorshipDeliverables)
          .where(and(
            eq(sponsorshipDeliverables.dealId, id),
            eq(sponsorshipDeliverables.category, "onboarding"),
          )).limit(1);
        if (existingOnboarding.length === 0) {
          const templates = await db.select().from(sponsorshipOnboardingTemplates)
            .where(and(
              eq(sponsorshipOnboardingTemplates.organizationId, existing.organizationId),
              eq(sponsorshipOnboardingTemplates.isActive, true),
            ))
            .orderBy(asc(sponsorshipOnboardingTemplates.displayOrder));
          if (templates.length > 0) {
            await db.insert(sponsorshipDeliverables).values(templates.map(t => ({
              dealId: id,
              title: t.title,
              type: "onboarding",
              category: "onboarding",
              triggerType: "once" as const,
              status: "pending" as const,
              ownerId: t.defaultOwnerId,
              notes: t.description,
              displayOrder: t.displayOrder,
              createdBy: req.session.userId!,
            })));
          }
        }
      }
      res.json(updated);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  // Manual trigger: instantiate the onboarding template for a deal even
  // if it didn't transition through the auto-fire path (e.g. for the 65
  // imported Pipedrive deals that are already past "won" but missing onboarding).
  app.post("/api/admin/sponsorship/deals/:id/apply-onboarding", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });

      const existingOnboarding = await db.select().from(sponsorshipDeliverables)
        .where(and(
          eq(sponsorshipDeliverables.dealId, id),
          eq(sponsorshipDeliverables.category, "onboarding"),
        ));
      const have = new Set(existingOnboarding.map(d => d.title));

      const templates = await db.select().from(sponsorshipOnboardingTemplates)
        .where(and(
          eq(sponsorshipOnboardingTemplates.organizationId, existing.organizationId),
          eq(sponsorshipOnboardingTemplates.isActive, true),
        ))
        .orderBy(asc(sponsorshipOnboardingTemplates.displayOrder));
      const toInsert = templates.filter(t => !have.has(t.title));
      if (toInsert.length > 0) {
        await db.insert(sponsorshipDeliverables).values(toInsert.map(t => ({
          dealId: id,
          title: t.title,
          type: "onboarding",
          category: "onboarding",
          triggerType: "once" as const,
          status: "pending" as const,
          ownerId: t.defaultOwnerId,
          notes: t.description,
          displayOrder: t.displayOrder,
          createdBy: req.session.userId!,
        })));
      }
      res.json({ ok: true, added: toInsert.length, alreadyExisted: existingOnboarding.length });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  // Onboarding template CRUD (org-scoped)
  app.get("/api/admin/sponsorship/onboarding-templates", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const rows = await db.select().from(sponsorshipOnboardingTemplates)
        .where(eq(sponsorshipOnboardingTemplates.organizationId, orgId))
        .orderBy(asc(sponsorshipOnboardingTemplates.displayOrder));
      res.json(rows);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/admin/sponsorship/onboarding-templates", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const title = String(req.body?.title || "").trim();
      if (!title) return res.status(400).json({ message: "title required" });
      const [row] = await db.insert(sponsorshipOnboardingTemplates).values({
        organizationId: orgId,
        title,
        description: req.body?.description || null,
        defaultOwnerId: req.body?.defaultOwnerId ?? null,
        displayOrder: req.body?.displayOrder ?? 0,
        isActive: req.body?.isActive ?? true,
      }).returning();
      res.json(row);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/admin/sponsorship/onboarding-templates/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(sponsorshipOnboardingTemplates).where(eq(sponsorshipOnboardingTemplates.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const patch: any = {};
      for (const f of ["title","description","defaultOwnerId","displayOrder","isActive"]) {
        if (req.body[f] !== undefined) patch[f] = req.body[f] === "" ? null : req.body[f];
      }
      const [updated] = await db.update(sponsorshipOnboardingTemplates).set(patch).where(eq(sponsorshipOnboardingTemplates.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.delete("/api/admin/sponsorship/onboarding-templates/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(sponsorshipOnboardingTemplates).where(eq(sponsorshipOnboardingTemplates.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await db.delete(sponsorshipOnboardingTemplates).where(eq(sponsorshipOnboardingTemplates.id, id));
      res.json({ ok: true });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  // Cross-deal deliverables — every deliverable across every deal in an org,
  // with the parent deal info inlined. Powers the Deliverables + Onboarding
  // tabs on the sponsorship page.
  app.get("/api/admin/sponsorship/deliverables-all", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const category = req.query.category as string | undefined;
      const deals = await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.organizationId, orgId));
      const dealIds = deals.map(d => d.id);
      if (dealIds.length === 0) return res.json([]);
      const where = category
        ? and(inArray(sponsorshipDeliverables.dealId, dealIds), eq(sponsorshipDeliverables.category, category))
        : inArray(sponsorshipDeliverables.dealId, dealIds);
      const rows = await db.select().from(sponsorshipDeliverables).where(where).orderBy(asc(sponsorshipDeliverables.dealId), asc(sponsorshipDeliverables.displayOrder));
      const dealMap = new Map(deals.map(d => [d.id, d]));
      res.json(rows.map(r => ({ ...r, deal: dealMap.get(r.dealId) || null })));
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete("/api/admin/sponsorship/deals/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await db.delete(sponsorshipDeals).where(eq(sponsorshipDeals.id, id));
      res.json({ ok: true });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  // ── Sponsorship deliverables ─────────────────────────────────────────────
  // Per-deal checklist of what we promised. Source of truth for end-of-season
  // partner reports (the #1 renewal driver per industry research). "Done"
  // requires a proof_url to enforce evidence-of-delivery.
  async function dealForUser(req: Request, dealId: number) {
    const [deal] = await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.id, dealId));
    if (!deal) return null;
    if (!(await checkUserOrg(req.session.userId!, deal.organizationId))) return null;
    return deal;
  }

  app.get("/api/admin/sponsorship/deals/:dealId/deliverables", requireAuth, async (req, res) => {
    try {
      const dealId = parseInt(req.params.dealId);
      const deal = await dealForUser(req, dealId);
      if (!deal) return res.status(404).json({ message: "Not found" });
      const rows = await db.select().from(sponsorshipDeliverables)
        .where(eq(sponsorshipDeliverables.dealId, dealId))
        .orderBy(asc(sponsorshipDeliverables.displayOrder), asc(sponsorshipDeliverables.id));
      res.json(rows);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/admin/sponsorship/deals/:dealId/deliverables", requireAuth, async (req, res) => {
    try {
      const dealId = parseInt(req.params.dealId);
      const deal = await dealForUser(req, dealId);
      if (!deal) return res.status(404).json({ message: "Not found" });
      const title = String(req.body?.title || "").trim();
      if (!title) return res.status(400).json({ message: "title required" });
      const [row] = await db.insert(sponsorshipDeliverables).values({
        dealId,
        title,
        type: req.body?.type || null,
        triggerType: req.body?.triggerType || "once",
        scheduledDate: req.body?.scheduledDate || null,
        entitlementQty: req.body?.entitlementQty != null ? req.body.entitlementQty : 1,
        usedQty: req.body?.usedQty != null ? req.body.usedQty : 0,
        status: req.body?.status || "pending",
        ownerId: req.body?.ownerId ?? null,
        proofUrl: req.body?.proofUrl || null,
        notes: req.body?.notes || null,
        createdBy: req.session.userId!,
      }).returning();
      res.json(row);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/admin/sponsorship/deliverables/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(sponsorshipDeliverables).where(eq(sponsorshipDeliverables.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      const deal = await dealForUser(req, existing.dealId);
      if (!deal) return res.status(403).json({ message: "Forbidden" });
      const patch: any = { updatedAt: new Date() };
      const fields = ["title", "type", "triggerType", "scheduledDate", "ownerId", "proofUrl", "notes", "entitlementQty", "usedQty", "displayOrder"];
      for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f] === "" ? null : req.body[f];
      if (req.body.status !== undefined) {
        patch.status = req.body.status;
        // Auto-stamp deliveredAt the moment a deliverable transitions to delivered.
        if (req.body.status === "delivered" && existing.status !== "delivered") {
          patch.deliveredAt = new Date();
        } else if (req.body.status !== "delivered" && existing.deliveredAt) {
          patch.deliveredAt = null;
        }
      }
      const [updated] = await db.update(sponsorshipDeliverables).set(patch).where(eq(sponsorshipDeliverables.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.delete("/api/admin/sponsorship/deliverables/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(sponsorshipDeliverables).where(eq(sponsorshipDeliverables.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      const deal = await dealForUser(req, existing.dealId);
      if (!deal) return res.status(403).json({ message: "Forbidden" });
      await db.delete(sponsorshipDeliverables).where(eq(sponsorshipDeliverables.id, id));
      res.json({ ok: true });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  // ── Billboard sales (Go Media contra resell) ─────────────────────────────
  // USG holds a $250k credit with Go Media; we resell at 20-30% off rate-card
  // up to a $200k revenue target. This pipeline tracks credit-consumed vs
  // cap, revenue collected vs target, and per-deal source attribution so
  // Daniel can see what's actually working (walk-ins vs ads vs cold).
  const BILLBOARD_CREDIT_CAP_CENTS = 250_000_00;   // $250k contra
  const BILLBOARD_REVENUE_TARGET_CENTS = 200_000_00; // $200k revenue goal

  app.get("/api/admin/billboards/deals", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const rows = await db.select().from(billboardDeals)
        .where(eq(billboardDeals.organizationId, orgId))
        .orderBy(asc(billboardDeals.stage), desc(billboardDeals.netValueCents));
      const source = req.query.source as string | undefined;
      const owner = req.query.ownerId ? parseInt(req.query.ownerId as string) : undefined;
      let filtered = rows;
      if (source) filtered = filtered.filter(d => d.source === source);
      if (owner) filtered = filtered.filter(d => d.ownerId === owner);
      res.json(filtered);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/admin/billboards/summary", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.organizationId as string);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const rows = await db.select().from(billboardDeals).where(eq(billboardDeals.organizationId, orgId));

      // Credit consumed = rate-card value of any deal that's been booked (paid → completed)
      // Revenue collected = actual money in the door (revenueCollectedCents)
      const bookedStages = ["paid", "live", "completed"];
      const openStages = ["lead", "contacted", "quoted", "negotiating", "contract_sent"];
      const creditConsumed = rows
        .filter(d => bookedStages.includes(d.stage))
        .reduce((s, d) => s + (d.rateCardValueCents || 0), 0);
      const revenueCollected = rows.reduce((s, d) => s + (d.revenueCollectedCents || 0), 0);
      const openPipelineNet = rows
        .filter(d => openStages.includes(d.stage))
        .reduce((s, d) => s + (d.netValueCents || 0), 0);
      const wonCount = rows.filter(d => bookedStages.includes(d.stage)).length;

      const byStage: Record<string, { count: number; netCents: number }> = {};
      for (const d of rows) {
        const k = d.stage;
        if (!byStage[k]) byStage[k] = { count: 0, netCents: 0 };
        byStage[k].count += 1;
        byStage[k].netCents += d.netValueCents || 0;
      }

      const bySource: Record<string, { count: number; netCents: number; revenueCents: number }> = {};
      for (const d of rows) {
        const k = d.source;
        if (!bySource[k]) bySource[k] = { count: 0, netCents: 0, revenueCents: 0 };
        bySource[k].count += 1;
        bySource[k].netCents += d.netValueCents || 0;
        bySource[k].revenueCents += d.revenueCollectedCents || 0;
      }

      res.json({
        creditCapCents: BILLBOARD_CREDIT_CAP_CENTS,
        revenueTargetCents: BILLBOARD_REVENUE_TARGET_CENTS,
        creditConsumedCents: creditConsumed,
        creditRemainingCents: BILLBOARD_CREDIT_CAP_CENTS - creditConsumed,
        revenueCollectedCents: revenueCollected,
        revenueGapCents: BILLBOARD_REVENUE_TARGET_CENTS - revenueCollected,
        openPipelineNetCents: openPipelineNet,
        wonCount,
        totalCount: rows.length,
        byStage,
        bySource,
      });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  function computeNetCents(rateCardCents: number, discountPct: number): number {
    const d = Math.max(0, Math.min(100, discountPct || 0));
    return Math.round(rateCardCents * (100 - d) / 100);
  }

  app.post("/api/admin/billboards/deals", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body?.organizationId);
      if (!orgId) return res.status(400).json({ message: "organizationId required" });
      if (!(await checkUserOrg(req.session.userId!, orgId))) return res.status(403).json({ message: "Forbidden" });
      const customer = String(req.body?.customerName || "").trim();
      if (!customer) return res.status(400).json({ message: "customerName required" });
      const rateCard = req.body?.rateCardValueCents != null ? Math.round(req.body.rateCardValueCents) : 0;
      const discount = req.body?.discountPct != null ? parseInt(req.body.discountPct) : 20;
      const net = req.body?.netValueCents != null ? Math.round(req.body.netValueCents) : computeNetCents(rateCard, discount);
      const [row] = await db.insert(billboardDeals).values({
        organizationId: orgId,
        customerName: customer,
        contactName: req.body?.contactName || null,
        contactEmail: req.body?.contactEmail || null,
        contactPhone: req.body?.contactPhone || null,
        source: req.body?.source || "cold_outreach",
        sourceNotes: req.body?.sourceNotes || null,
        stage: req.body?.stage || "lead",
        rateCardValueCents: rateCard,
        discountPct: discount,
        netValueCents: net,
        revenueCollectedCents: req.body?.revenueCollectedCents != null ? Math.round(req.body.revenueCollectedCents) : 0,
        creditConsumedCents: req.body?.creditConsumedCents != null ? Math.round(req.body.creditConsumedCents) : 0,
        billboardLocations: Array.isArray(req.body?.billboardLocations) ? req.body.billboardLocations : [],
        startDate: req.body?.startDate || null,
        endDate: req.body?.endDate || null,
        weeksBooked: req.body?.weeksBooked ?? null,
        expectedCloseDate: req.body?.expectedCloseDate || null,
        ownerId: req.body?.ownerId ?? null,
        notes: req.body?.notes || null,
        createdBy: req.session.userId!,
      }).returning();
      res.json(row);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/admin/billboards/deals/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(billboardDeals).where(eq(billboardDeals.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      const patch: any = { updatedAt: new Date() };
      const fields = [
        "customerName", "contactName", "contactEmail", "contactPhone",
        "source", "sourceNotes", "notes",
      ];
      for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f] === "" ? null : req.body[f];
      if (req.body.rateCardValueCents !== undefined) patch.rateCardValueCents = Math.round(req.body.rateCardValueCents || 0);
      if (req.body.discountPct !== undefined) patch.discountPct = parseInt(req.body.discountPct) || 0;
      if (req.body.netValueCents !== undefined) patch.netValueCents = Math.round(req.body.netValueCents || 0);
      // Auto-recompute net if rate card or discount changed but net wasn't explicitly set
      if ((req.body.rateCardValueCents !== undefined || req.body.discountPct !== undefined) && req.body.netValueCents === undefined) {
        const rc = patch.rateCardValueCents ?? existing.rateCardValueCents;
        const dp = patch.discountPct ?? existing.discountPct;
        patch.netValueCents = computeNetCents(rc, dp);
      }
      if (req.body.revenueCollectedCents !== undefined) patch.revenueCollectedCents = Math.round(req.body.revenueCollectedCents || 0);
      if (req.body.creditConsumedCents !== undefined) patch.creditConsumedCents = Math.round(req.body.creditConsumedCents || 0);
      if (Array.isArray(req.body.billboardLocations)) patch.billboardLocations = req.body.billboardLocations;
      if (req.body.startDate !== undefined) patch.startDate = req.body.startDate || null;
      if (req.body.endDate !== undefined) patch.endDate = req.body.endDate || null;
      if (req.body.weeksBooked !== undefined) patch.weeksBooked = req.body.weeksBooked;
      if (req.body.expectedCloseDate !== undefined) patch.expectedCloseDate = req.body.expectedCloseDate || null;
      if (req.body.ownerId !== undefined) patch.ownerId = req.body.ownerId;
      if (req.body.stage !== undefined && req.body.stage !== existing.stage) {
        patch.stage = req.body.stage;
        patch.stageChangedAt = new Date();
        // When the deal transitions to "paid", auto-set credit consumed = rate card
        // and (if not yet collected) revenue collected = net value. Operator can
        // override if reality differs.
        if (req.body.stage === "paid" && existing.stage !== "paid") {
          if (req.body.creditConsumedCents === undefined) {
            patch.creditConsumedCents = patch.rateCardValueCents ?? existing.rateCardValueCents;
          }
          if (req.body.revenueCollectedCents === undefined && (existing.revenueCollectedCents || 0) === 0) {
            patch.revenueCollectedCents = patch.netValueCents ?? existing.netValueCents;
          }
        }
      }
      const [updated] = await db.update(billboardDeals).set(patch).where(eq(billboardDeals.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.delete("/api/admin/billboards/deals/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(billboardDeals).where(eq(billboardDeals.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!(await checkUserOrg(req.session.userId!, existing.organizationId))) return res.status(403).json({ message: "Forbidden" });
      await db.delete(billboardDeals).where(eq(billboardDeals.id, id));
      res.json({ ok: true });
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.get("/api/admin/calendar-events", requireAuth, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.organizationId) filters.organizationId = parseInt(req.query.organizationId as string);
      if (req.query.calendarType) filters.calendarType = req.query.calendarType as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      const events = await storage.getCalendarEvents(filters);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/calendar-events", requireAuth, async (req, res) => {
    try {
      const { title, description, location, startTime, endTime, allDay, calendarType, color, recurrence, organizationId, repeatRule, amount } = req.body;
      if (!title || !startTime || !endTime) return res.status(400).json({ message: "title, startTime, and endTime required" });

      const baseStart = new Date(startTime);
      const baseEnd = new Date(endTime);
      const durationMs = baseEnd.getTime() - baseStart.getTime();

      if (!repeatRule || repeatRule.type === "none") {
        const event = await storage.createCalendarEvent({
          title, description, location,
          startTime: baseStart, endTime: baseEnd,
          allDay: allDay || false,
          calendarType: calendarType || "general",
          color: color || "#3b82f6",
          recurrence: recurrence || null,
          amount: amount || null,
          organizationId: organizationId || null,
          createdBy: req.session.userId!,
        });
        return res.json(event);
      }

      const { type: rType, interval: rawInterval = 1, until } = repeatRule;
      const allowedTypes = ["daily", "weekly", "monthly", "yearly"];
      if (!allowedTypes.includes(rType)) {
        return res.status(400).json({ message: "Invalid repeat type" });
      }
      const interval = Math.max(1, Math.min(99, Math.floor(Number(rawInterval) || 1)));
      const untilDate = until ? new Date(new Date(until).getTime() + 86400000 - 1) : null;
      const maxOccurrences = 365;
      const occurrences: Date[] = [baseStart];
      let current = new Date(baseStart);

      for (let i = 1; i < maxOccurrences; i++) {
        const next = new Date(current);
        if (rType === "daily") next.setDate(next.getDate() + interval);
        else if (rType === "weekly") next.setDate(next.getDate() + 7 * interval);
        else if (rType === "monthly") next.setMonth(next.getMonth() + interval);
        else if (rType === "yearly") next.setFullYear(next.getFullYear() + interval);
        else break;

        if (untilDate && next > untilDate) break;
        if (!untilDate && i >= 52) break;
        occurrences.push(new Date(next));
        current = next;
      }

      const recurrenceLabel = `${rType}${interval > 1 ? `:${interval}` : ""}${untilDate ? `:until:${untilDate.toISOString().split("T")[0]}` : ""}`;

      const createdEvents = [];
      for (const occ of occurrences) {
        const occEnd = new Date(occ.getTime() + durationMs);
        const event = await storage.createCalendarEvent({
          title, description, location,
          startTime: occ, endTime: occEnd,
          allDay: allDay || false,
          calendarType: calendarType || "general",
          color: color || "#3b82f6",
          recurrence: recurrenceLabel,
          amount: amount || null,
          organizationId: organizationId || null,
          createdBy: req.session.userId!,
        });
        createdEvents.push(event);
      }

      res.json({ created: createdEvents.length, events: createdEvents });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/calendar-events/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getCalendarEvent(id);
      if (!existing) return res.status(404).json({ message: "Event not found" });
      const { title, description, location, startTime, endTime, allDay, calendarType, color, recurrence, organizationId, amount } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (location !== undefined) updates.location = location;
      if (startTime !== undefined) updates.startTime = new Date(startTime);
      if (endTime !== undefined) updates.endTime = new Date(endTime);
      if (allDay !== undefined) updates.allDay = allDay;
      if (calendarType !== undefined) updates.calendarType = calendarType;
      if (color !== undefined) updates.color = color;
      if (recurrence !== undefined) updates.recurrence = recurrence;
      if (organizationId !== undefined) updates.organizationId = organizationId;
      if (amount !== undefined) updates.amount = amount;
      const event = await storage.updateCalendarEvent(id, updates);
      res.json(event);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/calendar-events/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getCalendarEvent(id);
      if (!existing) return res.status(404).json({ message: "Event not found" });
      await storage.deleteCalendarEvent(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/order-timing", requireAuth, async (req, res) => {
    try {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const rawFrom = req.query.from as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const rawTo = req.query.to as string || new Date().toISOString().split('T')[0];
      const from = dateRegex.test(rawFrom) ? rawFrom : new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = dateRegex.test(rawTo) ? rawTo : new Date().toISOString().split('T')[0];
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
      let orgFilter = "";
      if (orgId && !isNaN(orgId)) orgFilter = `AND p.organization_id = ${orgId}`;

      const heatmapData = await db.execute(sql.raw(`
        SELECT
          EXTRACT(DOW FROM r.registered_at AT TIME ZONE 'Pacific/Auckland') as day_of_week,
          EXTRACT(HOUR FROM r.registered_at AT TIME ZONE 'Pacific/Auckland') as hour_of_day,
          COUNT(*) as order_count,
          COALESCE(SUM(r.total_cents), 0) as revenue_cents
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE r.status = 'confirmed'
          AND r.registered_at >= '${from}'
          AND r.registered_at < '${to}'::date + interval '1 day'
          ${orgFilter}
        GROUP BY day_of_week, hour_of_day
        ORDER BY day_of_week, hour_of_day
      `));

      const dailyTotals = await db.execute(sql.raw(`
        SELECT
          EXTRACT(DOW FROM r.registered_at AT TIME ZONE 'Pacific/Auckland') as day_of_week,
          COUNT(*) as order_count,
          COALESCE(SUM(r.total_cents), 0) as revenue_cents
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE r.status = 'confirmed'
          AND r.registered_at >= '${from}'
          AND r.registered_at < '${to}'::date + interval '1 day'
          ${orgFilter}
        GROUP BY day_of_week
        ORDER BY order_count DESC
      `));

      const hourlyTotals = await db.execute(sql.raw(`
        SELECT
          EXTRACT(HOUR FROM r.registered_at AT TIME ZONE 'Pacific/Auckland') as hour_of_day,
          COUNT(*) as order_count,
          COALESCE(SUM(r.total_cents), 0) as revenue_cents
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE r.status = 'confirmed'
          AND r.registered_at >= '${from}'
          AND r.registered_at < '${to}'::date + interval '1 day'
          ${orgFilter}
        GROUP BY hour_of_day
        ORDER BY hour_of_day
      `));

      const totalOrders = await db.execute(sql.raw(`
        SELECT COUNT(*) as total, COALESCE(SUM(r.total_cents), 0) as revenue
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE r.status = 'confirmed'
          AND r.registered_at >= '${from}'
          AND r.registered_at < '${to}'::date + interval '1 day'
          ${orgFilter}
      `));

      res.json({
        heatmap: rows(heatmapData),
        dailyTotals: rows(dailyTotals),
        hourlyTotals: rows(hourlyTotals),
        summary: row0(totalOrders),
      });
    } catch (error: any) {
      console.error("Analytics order-timing error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/timeline", requireAuth, async (req, res) => {
    try {
      const from = req.query.from as string || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = req.query.to as string || new Date().toISOString().split('T')[0];
      const campSlug = req.query.campSlug as string || null;
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : null;
      let campFilter = "";
      if (campSlug) campFilter = `AND camp_slug = '${campSlug.replace(/'/g, "''")}'`;
      if (orgId) campFilter += ` AND camp_slug IN (SELECT slug FROM programs WHERE organization_id = ${orgId})`;

      const timeline = await db.execute(sql.raw(`
        SELECT DATE(timestamp) as date,
          COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
          COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'page_view') as unique_visitors,
          COUNT(DISTINCT session_id) FILTER (WHERE event_type IN ('session_start', 'page_view')) as sessions,
          COUNT(*) FILTER (WHERE event_type = 'cta_click') as cta_clicks,
          COUNT(*) FILTER (WHERE event_type = 'bounce') as bounces
        FROM analytics_events
        WHERE timestamp >= '${from}' AND timestamp < '${to}'::date + interval '1 day'
        ${campFilter}
        GROUP BY DATE(timestamp)
        ORDER BY date
      `));

      res.json(rows(timeline));
    } catch (error: any) {
      console.error("Analytics timeline error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============ SPLIT TEST ROUTES ============

  app.get("/api/admin/split-tests/:programId", requireAuth, async (req, res) => {
    try {
      const programId = parseInt(req.params.programId);
      const tests = await db.select().from(splitTests).where(eq(splitTests.programId, programId)).orderBy(splitTests.createdAt);
      const testsWithVariants = await Promise.all(tests.map(async (t) => {
        const variants = await db.select().from(splitTestVariants).where(eq(splitTestVariants.splitTestId, t.id));
        return { ...t, variants };
      }));
      res.json(testsWithVariants);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/split-tests", requireAuth, async (req, res) => {
    try {
      const { programId, field, endCondition, endValue, variants } = req.body;
      const existing = await db.select().from(splitTests).where(and(eq(splitTests.programId, programId), eq(splitTests.field, field), eq(splitTests.status, "active")));
      if (existing.length > 0) {
        return res.status(400).json({ message: `An active split test for this field already exists. Complete or cancel it first.` });
      }
      const [test] = await db.insert(splitTests).values({
        programId,
        field,
        endCondition,
        endValue,
        status: "active",
      }).returning();
      const insertedVariants = await Promise.all(variants.map((v: any, i: number) =>
        db.insert(splitTestVariants).values({
          splitTestId: test.id,
          label: v.label || `Variant ${String.fromCharCode(65 + i)}`,
          value: v.value,
          isControl: i === 0,
        }).returning()
      ));
      res.json({ ...test, variants: insertedVariants.map(v => v[0]) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/split-tests/:id/cancel", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.update(splitTests).set({ status: "cancelled", endedAt: new Date() }).where(eq(splitTests.id, id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/split-tests/:id/complete", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const variants = await db.select().from(splitTestVariants).where(eq(splitTestVariants.splitTestId, id));
      let winner = variants[0];
      for (const v of variants) {
        if (v.revenue > winner.revenue || (v.revenue === winner.revenue && v.registrations > winner.registrations)) {
          winner = v;
        }
      }
      await db.update(splitTests).set({ status: "completed", winnerId: winner.id, endedAt: new Date() }).where(eq(splitTests.id, id));
      const test = await db.select().from(splitTests).where(eq(splitTests.id, id));
      if (test[0]) {
        const field = test[0].field;
        const updateData: any = {};
        updateData[field] = winner.value;
        await storage.updateProgram(test[0].programId, updateData);
      }
      res.json({ ok: true, winnerId: winner.id, winnerValue: winner.value });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/split-test/variant", async (req, res) => {
    try {
      const programId = parseInt(req.query.programId as string);
      const field = req.query.field as string;
      if (!programId || !field) return res.json({ variant: null });
      const activeTests = await db.select().from(splitTests).where(and(eq(splitTests.programId, programId), eq(splitTests.field, field), eq(splitTests.status, "active")));
      if (activeTests.length === 0) return res.json({ variant: null });
      const test = activeTests[0];
      let shouldEnd = false;
      if (test.endCondition === "days") {
        const elapsed = (Date.now() - new Date(test.startedAt).getTime()) / 86400000;
        if (elapsed >= test.endValue) shouldEnd = true;
      }
      const variants = await db.select().from(splitTestVariants).where(eq(splitTestVariants.splitTestId, test.id));
      if (test.endCondition === "views") {
        const totalViews = variants.reduce((s, v) => s + v.views, 0);
        if (totalViews >= test.endValue) shouldEnd = true;
      }
      if (shouldEnd) {
        let winner = variants[0];
        for (const v of variants) {
          if (v.revenue > winner.revenue || (v.revenue === winner.revenue && v.registrations > winner.registrations)) winner = v;
        }
        await db.update(splitTests).set({ status: "completed", winnerId: winner.id, endedAt: new Date() }).where(eq(splitTests.id, test.id));
        const updateData: any = {};
        updateData[field] = winner.value;
        await storage.updateProgram(test.programId, updateData);
        return res.json({ variant: null, completed: true, winnerId: winner.id });
      }
      const chosen = variants[Math.floor(Math.random() * variants.length)];
      res.json({ variant: chosen, testId: test.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/public/split-test/view", async (req, res) => {
    try {
      const { variantId } = req.body;
      if (!variantId) return res.json({ ok: true });
      await db.update(splitTestVariants).set({ views: sql`views + 1` }).where(eq(splitTestVariants.id, variantId));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/public/split-test/conversion", async (req, res) => {
    try {
      const { variantId, revenue } = req.body;
      if (!variantId) return res.json({ ok: true });
      await db.update(splitTestVariants).set({
        registrations: sql`registrations + 1`,
        revenue: sql`revenue + ${revenue || 0}`,
      }).where(eq(splitTestVariants.id, variantId));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/public/tournament/tournaments", async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId || isNaN(orgId)) {
        return res.status(400).json({ message: "orgId query parameter is required" });
      }
      const all = await storage.getTournaments(orgId);
      const visible = all.filter(t => t.status === "active" || t.status === "completed");
      res.json(visible.map(t => ({
        id: t.id,
        name: t.name,
        ageGroup: t.ageGroup,
        location: t.location,
        status: t.status,
        startDate: t.startDate,
        endDate: t.endDate,
        numGroups: t.numGroups,
        teamsPerGroup: t.teamsPerGroup,
        gameDurationMinutes: t.gameDurationMinutes,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/tournament/tournaments/:id", async (req, res) => {
    try {
      const t = await storage.getTournament(parseInt(req.params.id));
      if (!t || (t.status !== "active" && t.status !== "completed")) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      res.json({
        id: t.id,
        name: t.name,
        ageGroup: t.ageGroup,
        location: t.location,
        status: t.status,
        startDate: t.startDate,
        endDate: t.endDate,
        numGroups: t.numGroups,
        teamsPerGroup: t.teamsPerGroup,
        groupStageFormat: t.groupStageFormat,
        knockoutFormat: t.knockoutFormat,
        gameDurationMinutes: t.gameDurationMinutes,
        breakBetweenMinutes: t.breakBetweenMinutes,
        pointsForWin: t.pointsForWin,
        pointsForDraw: t.pointsForDraw,
        pointsForLoss: t.pointsForLoss,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/tournament/tournaments/:id/groups", async (req, res) => {
    try {
      const t = await storage.getTournament(parseInt(req.params.id));
      if (!t || (t.status !== "active" && t.status !== "completed")) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      const groups = await storage.getTournamentGroups(t.id);
      res.json(groups.map(g => ({
        id: g.id,
        name: g.name,
        sortOrder: g.sortOrder,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Build a teamId → clubLogoUrl map for a tournament so the public games
  // and teams endpoints can cascade team.logoUrl → club.logoUrl when a team
  // doesn't have its own logo override.
  //
  // First version did Promise.all(clubIds.map(storage.getClub)) which fires
  // N parallel DB queries — for 16+ clubs that maxes out the Supabase
  // session-mode pool (15 connections) and the public games endpoint
  // returns 500 'EMAXCONNSESSION'. Now: single IN-query.
  async function clubLogoMapForTournament(tournamentId: number): Promise<Map<number, string | null>> {
    const teams = await storage.getTournamentTeams(tournamentId);
    const clubIds = [...new Set(teams.map(t => t.clubId).filter((id): id is number => !!id))];
    if (clubIds.length === 0) return new Map();
    const rows = await db.select({ id: clubs.id, logoUrl: clubs.logoUrl })
      .from(clubs)
      .where(inArray(clubs.id, clubIds));
    const clubMap = new Map<number, string | null>();
    for (const c of rows) clubMap.set(c.id, c.logoUrl ?? null);
    const teamToClubLogo = new Map<number, string | null>();
    for (const t of teams) {
      if (t.clubId) teamToClubLogo.set(t.id, clubMap.get(t.clubId) ?? null);
    }
    return teamToClubLogo;
  }

  app.get("/api/public/tournament/tournaments/:id/teams", async (req, res) => {
    try {
      const t = await storage.getTournament(parseInt(req.params.id));
      if (!t || (t.status !== "active" && t.status !== "completed")) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      const teams = await storage.getTournamentTeams(t.id);
      const clubLogo = await clubLogoMapForTournament(t.id);
      res.json(teams.map(tm => ({
        id: tm.id,
        name: tm.name,
        clubName: tm.clubName,
        logoUrl: tm.logoUrl || clubLogo.get(tm.id) || null,
        primaryColor: tm.primaryColor,
        secondaryColor: tm.secondaryColor,
        groupId: tm.groupId,
        groupName: tm.group?.name || null,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/tournament/tournaments/:id/games", async (req, res) => {
    try {
      const t = await storage.getTournament(parseInt(req.params.id));
      if (!t || (t.status !== "active" && t.status !== "completed")) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      const games = await storage.getTournamentGames(t.id);
      const category = req.query.stage as string | undefined;
      const filtered = category ? games.filter(g => g.stage === category) : games;
      const clubLogo = await clubLogoMapForTournament(t.id);
      const resolveLogo = (team: { id: number; logoUrl: string | null } | undefined) =>
        team ? (team.logoUrl || clubLogo.get(team.id) || null) : null;
      res.json(filtered.map(g => ({
        id: g.id,
        gameNumber: g.gameNumber,
        roundNumber: g.roundNumber,
        stage: g.stage,
        stageDetail: g.stageDetail,
        gameDate: g.gameDate,
        startTime: g.startTime,
        field: g.field,
        status: g.status,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeTeamName: g.homeTeam?.name || g.homeTeamPlaceholder || "TBD",
        awayTeamName: g.awayTeam?.name || g.awayTeamPlaceholder || "TBD",
        homeTeamLogo: resolveLogo(g.homeTeam),
        awayTeamLogo: resolveLogo(g.awayTeam),
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        homePenalties: g.homePenalties,
        awayPenalties: g.awayPenalties,
        groupId: g.groupId,
        groupName: g.group?.name || null,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/tournament/tournaments/:id/standings", async (req, res) => {
    try {
      const t = await storage.getTournament(parseInt(req.params.id));
      if (!t || (t.status !== "active" && t.status !== "completed")) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      const standings = await storage.getTournamentGroupStandings(t.id);
      res.json(standings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Top scorers — feeds the Golden Boot tab in the CIC Youth app. Resolves
  // logos via team override → club fallback so unbranded teams still get
  // a crest if their parent club uploaded one.
  app.get("/api/public/tournament/tournaments/:id/top-scorers", async (req, res) => {
    try {
      const t = await storage.getTournament(parseInt(req.params.id));
      if (!t || (t.status !== "active" && t.status !== "completed")) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      const scorers = await storage.getTournamentTopScorers(t.id);
      res.json(scorers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/camps", async (_req, res) => {
    try {
      const all = await storage.getPrograms();
      const camps = all.filter(p => p.type === "holiday_camp" && p.isActive);
      res.json(camps.map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        descriptionShort: c.descriptionShort,
        location: c.location,
        startDate: c.startDate,
        endDate: c.endDate,
        ageMin: c.ageMin,
        ageMax: c.ageMax,
        heroImage: c.heroImage,
        heroHeadline: c.heroHeadline,
        heroSubheadline: c.heroSubheadline,
        primaryCta: c.primaryCta,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/camps/:slug", async (req, res) => {
    try {
      const camp = await storage.getProgramBySlug(req.params.slug);
      if (!camp || !camp.isActive) return res.status(404).json({ message: "Camp not found" });
      const pricing = await storage.getCampPricing(camp.id);
      const dates = await storage.getCampDates(camp.id);
      const discounts = await storage.getProgramDiscounts(camp.id);
      const activeTests = await db.select().from(splitTests).where(and(eq(splitTests.programId, camp.id), eq(splitTests.status, "active")));
      const activeSplitTests: any[] = [];
      for (const t of activeTests) {
        let shouldEnd = false;
        const variants = await db.select().from(splitTestVariants).where(eq(splitTestVariants.splitTestId, t.id));
        if (t.endCondition === "days") {
          const elapsed = (Date.now() - new Date(t.startedAt).getTime()) / 86400000;
          if (elapsed >= t.endValue) shouldEnd = true;
        }
        if (t.endCondition === "views") {
          const totalViews = variants.reduce((s, v) => s + v.views, 0);
          if (totalViews >= t.endValue) shouldEnd = true;
        }
        if (shouldEnd) {
          let winner = variants[0];
          for (const v of variants) {
            if (v.revenue > winner.revenue || (v.revenue === winner.revenue && v.registrations > winner.registrations)) winner = v;
          }
          await db.update(splitTests).set({ status: "completed", winnerId: winner.id, endedAt: new Date() }).where(eq(splitTests.id, t.id));
          const updateData: any = {};
          updateData[t.field] = winner.value;
          await storage.updateProgram(t.programId, updateData);
        } else {
          const chosen = variants[Math.floor(Math.random() * variants.length)];
          activeSplitTests.push({ testId: t.id, field: t.field, variant: chosen });
        }
      }
      // Include the organisation so the public page can render the right
      // brand crest. Gymnastics programs get the CUGC crest, etc. — without
      // this the hero falls back to the hardcoded CUFC logo regardless of
      // which workspace owns the program.
      let organization = null;
      if (camp.organizationId) {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, camp.organizationId));
        if (org) organization = { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl };
      }
      res.json({ camp, organization, pricing, dates, discounts, splitTests: activeSplitTests });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/resolve-domain", async (req, res) => {
    try {
      const hostname = (req.query.hostname as string || "").toLowerCase().trim();
      if (!hostname) return res.json({ resolved: false });
      const domain = await storage.getCustomDomainByHostname(hostname);
      if (!domain || domain.status !== "active") return res.json({ resolved: false });
      const [org] = await db.select().from(organizations).where(eq(organizations.id, domain.organizationId));
      if (!org) return res.json({ resolved: false });
      const programsResult = await db.execute(sql.raw(`SELECT * FROM programs WHERE organization_id = ${domain.organizationId} AND is_active = true`));
      res.json({ resolved: true, organization: { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl }, programs: programsResult.rows });
    } catch (error: any) {
      res.json({ resolved: false });
    }
  });

  app.post("/api/public/validate-discount", async (req, res) => {
    try {
      const { code, campSlug } = req.body;
      if (!code || !campSlug) return res.status(400).json({ valid: false, message: "Code and camp are required" });
      const camp = await storage.getProgramBySlug(campSlug);
      if (!camp) return res.status(404).json({ valid: false, message: "Camp not found" });
      const orgId = (camp as any).organizationId || 1;
      const discount = await storage.getDiscountByCode(code.trim(), orgId);
      if (!discount) return res.json({ valid: false, message: "Invalid discount code" });
      if (discount.status === "disabled") return res.json({ valid: false, message: "This discount code is no longer active" });
      const now = new Date();
      if (discount.startDate && new Date(discount.startDate) > now) return res.json({ valid: false, message: "This discount code is not yet active" });
      if (discount.endDate && new Date(discount.endDate) < now) return res.json({ valid: false, message: "This discount code has expired" });
      if (discount.maxTotalUses && discount.timesUsed >= discount.maxTotalUses) return res.json({ valid: false, message: "This discount code has reached its usage limit" });
      res.json({
        valid: true,
        discount: {
          id: discount.id,
          code: discount.code,
          type: discount.type,
          valueType: discount.valueType,
          value: discount.value,
          title: discount.title,
        },
      });
    } catch (error: any) {
      res.status(500).json({ valid: false, message: error.message });
    }
  });

  app.post("/api/public/book", async (req, res) => {
    try {
      const { parent, children: childrenData, items, campSlug, discountCode, utmSource, utmMedium, utmCampaign, fbclid, fbp, fbc, userAgent } = req.body;

      const camp = await storage.getProgramBySlug(campSlug);
      if (!camp) return res.status(404).json({ message: "Camp not found" });

      let parentContact = await storage.findContactByEmail(parent.email);
      if (!parentContact) {
        parentContact = await storage.createContact({
          type: "guardian",
          firstName: parent.firstName,
          lastName: parent.lastName,
          email: parent.email,
          phone: parent.phone,
        });
      } else {
        parentContact = (await storage.updateContact(parentContact.id, {
          firstName: parent.firstName,
          lastName: parent.lastName,
          phone: parent.phone,
        }))!;
      }

      const createdChildren = [];
      for (const childData of childrenData) {
        const child = await storage.createChild({
          parentId: parentContact.id,
          firstName: childData.firstName,
          lastName: childData.lastName,
          dateOfBirth: childData.dateOfBirth || null,
          gender: childData.gender || null,
        });
        if (childData.allergies || childData.epiPen || childData.medicalNotes) {
          await storage.upsertChildMedical(child.id, {
            allergies: childData.allergies || null,
            epiPen: childData.epiPen || false,
            notes: childData.medicalNotes || null,
          });
        }
        createdChildren.push(child);
      }

      const pricing = await storage.getCampPricing(camp.id);
      const discounts = await storage.getProgramDiscounts(camp.id);

      let subtotalCents = 0;
      const registrationItems: { childId: number; campDateId: number; productType: string }[] = [];

      for (const item of items) {
        const childIndex = item.childIndex;
        const child = createdChildren[childIndex];
        if (!child) continue;
        const price = pricing.find(p => p.productType === item.productType);
        if (!price) continue;
        subtotalCents += price.priceCents;
        registrationItems.push({
          childId: child.id,
          campDateId: item.campDateId,
          productType: item.productType,
        });
      }

      let discountCents = 0;
      let appliedDiscountId: number | null = null;
      let appliedDiscountCode: string | null = null;
      const totalItems = registrationItems.length;

      if (discountCode) {
        const orgId = (camp as any).organizationId || 1;
        const promoDiscount = await storage.getDiscountByCode(discountCode.trim(), orgId);
        if (promoDiscount && promoDiscount.status !== "disabled") {
          const now = new Date();
          const startOk = !promoDiscount.startDate || new Date(promoDiscount.startDate) <= now;
          const endOk = !promoDiscount.endDate || new Date(promoDiscount.endDate) >= now;
          const usageOk = !promoDiscount.maxTotalUses || promoDiscount.timesUsed < promoDiscount.maxTotalUses;
          if (startOk && endOk && usageOk) {
            if (promoDiscount.valueType === "percentage") {
              discountCents = Math.round(subtotalCents * Number(promoDiscount.value) / 100);
            } else {
              discountCents = Math.round(Number(promoDiscount.value) * 100);
            }
            if (discountCents > subtotalCents) discountCents = subtotalCents;
            appliedDiscountId = promoDiscount.id;
            appliedDiscountCode = promoDiscount.code;
          }
        }
      }

      let volumeDiscountLabel: string | null = null;
      if (discountCents === 0) {
        const applicableDiscount = discounts
          .filter(d => totalItems >= d.minBookings)
          .sort((a, b) => Number(b.discountPercent) - Number(a.discountPercent))[0];
        if (applicableDiscount) {
          discountCents = Math.round(subtotalCents * Number(applicableDiscount.discountPercent) / 100);
          volumeDiscountLabel = `${applicableDiscount.discountPercent}%`;
        }
      }

      const totalCents = subtotalCents - discountCents;

      const registration = await storage.createRegistration({
        programId: camp.id,
        contactId: parentContact.id,
        guardianId: parentContact.id,
        status: "pending",
        subtotalCents,
        discountCents,
        discountCode: appliedDiscountCode || null,
        discountId: appliedDiscountId || null,
        totalCents,
        currency: "NZD",
        registrationLocation: "online",
        source: "public_booking",
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        fbclid: fbclid || null,
      });

      await storage.createRegistrationItems(registrationItems.map(item => ({
        registrationId: registration.id,
        childId: item.childId,
        campDateId: item.campDateId,
        productType: item.productType,
      })));

      const campDates = await storage.getCampDates(camp.id);
      const attendanceItems = registrationItems.map(item => ({
        campId: camp.id,
        campDateId: item.campDateId,
        childId: item.childId,
      }));
      try {
        await storage.createAttendanceBulk(attendanceItems);
      } catch (e) {
        // ignore duplicates
      }

      if (totalCents > 0 && process.env.STRIPE_SECRET_KEY) {
        const paymentIntent = await createPaymentIntent({
          registrationId: registration.id,
          campName: camp.name,
          totalCents,
          currency: "NZD",
          parentEmail: parent.email,
          metadata: {
            campId: String(camp.id),
            campSlug,
            fbp: fbp || "",
            fbc: fbc || "",
            userAgent: userAgent || "",
          },
        });

        await storage.updateRegistration(registration.id, {
          stripePaymentIntentId: paymentIntent.id,
        });

        res.status(201).json({
          registrationId: registration.id,
          subtotalCents,
          discountCents,
          totalCents,
          currency: "NZD",
          discountApplied: appliedDiscountCode || volumeDiscountLabel || null,
          requiresPayment: true,
          campSlug,
        });
      } else {
        res.status(201).json({
          registrationId: registration.id,
          subtotalCents,
          discountCents,
          totalCents,
          currency: "NZD",
          discountApplied: appliedDiscountCode || volumeDiscountLabel || null,
        });
      }
    } catch (error: any) {
      console.error("Booking error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/public/book/confirm-free", async (req, res) => {
    try {
      const { registrationId } = req.body;
      const reg = await storage.getRegistration(registrationId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      if (reg.totalCents && reg.totalCents > 0) {
        return res.status(400).json({ message: "This booking requires payment" });
      }
      await storage.updateRegistration(registrationId, { status: "confirmed" });
      await storage.assignOrderNumber(registrationId);
      if ((reg as any).discountId && reg.discountCents && reg.discountCents > 0) {
        await storage.incrementDiscountUsage((reg as any).discountId, reg.discountCents);
      }
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    try {
      const sig = req.headers["stripe-signature"] as string;
      if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
        console.warn("[Stripe Webhook] Missing signature or webhook secret — rejecting event");
        return res.status(400).json({ message: "Webhook signature verification required" });
      }

      const event = constructWebhookEvent(req.rawBody as Buffer, sig);

      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object as any;
        const registrationId = parseInt(paymentIntent.metadata?.registrationId);
        if (registrationId) {
          await handlePaymentSuccess(registrationId, paymentIntent.id, paymentIntent.metadata);
        }
        const facilityGroupId = paymentIntent.metadata?.facilityBookingGroupId;
        if (facilityGroupId) {
          try {
            const updated = await storage.confirmFacilityBookingsByPaymentIntent(paymentIntent.id);
            console.log(`[Stripe Webhook] Confirmed ${updated.length} facility bookings for group ${facilityGroupId}`);
            if (updated.length > 0) {
              const first = updated[0];
              const totalCents = updated.reduce((s, b) => s + (b.totalCents || 0), 0);
              const lines = await Promise.all(updated.map(async b => {
                const f = await storage.getFacility(b.facilityId);
                return `<li>${f?.name || 'Facility'} — ${b.bookingDate} ${b.startTime}–${b.endTime}${b.halfFull === 'half' ? ' (Half)' : ''}</li>`;
              }));
              try {
                const { sendEmail } = await import("./email");
                await sendEmail({
                  to: first.customerEmail,
                  from: "United Sports Centre <bookings@unitedsportscentre.com>",
                  subject: `Booking confirmation — ${updated.length} session${updated.length > 1 ? 's' : ''}`,
                  html: `<p>Hi ${first.customerName},</p>
                    <p>Thanks for your booking! Your reservation is confirmed.</p>
                    <ul>${lines.join('')}</ul>
                    <p><strong>Total paid:</strong> NZ$${(totalCents / 100).toFixed(2)} (incl. GST)</p>
                    <p>Reference: <code>${facilityGroupId}</code></p>
                    <p>See you at the centre!</p>`,
                });
              } catch (e) { console.error("[Venue email] failed", e); }
            }
          } catch (e) {
            console.error("[Stripe Webhook] Facility booking confirm failed:", e);
          }
        }
      } else if (event.type === "payment_intent.payment_failed") {
        const paymentIntent = event.data.object as any;
        const facilityGroupId = paymentIntent.metadata?.facilityBookingGroupId;
        if (facilityGroupId) {
          try { await storage.cancelFacilityBookingsByGroup(facilityGroupId); } catch (e) { console.error(e); }
        }
      }

      // Print order branch — fires for both `payment_intent.succeeded` (above
      // is camp/venue) and the same event type but with print metadata. We
      // detect by metadata.printOrderId being present rather than re-checking
      // event.type so this stays self-contained.
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as any;
        const printOrderId = parseInt(pi.metadata?.printOrderId);
        if (printOrderId) {
          try {
            await handlePrintPaymentSuccess(printOrderId, pi.id);
          } catch (e) {
            console.error("[Stripe Webhook] Print order handler failed:", e);
          }
        }
      } else if (event.type === "invoice.paid") {
        // Weekly subscription invoice succeeded. Advance the next pending
        // booking for that subscription → 'paid'.
        //
        // De-dupe: the FIRST invoice (billing_reason="subscription_create")
        // fires alongside payment_intent.succeeded, which already advances
        // the first booking via stripePaymentIntentId. Skip first-invoice
        // events here so we don't double-count and accidentally mark the
        // SECOND week paid when only the first has been paid.
        const invoice = event.data.object as any;
        const subId: string | undefined = invoice.subscription;
        const billingReason: string = invoice.billing_reason || "";
        if (subId && billingReason !== "subscription_create") {
          try {
            const pending = await db.select().from(facilityBookings)
              .where(and(
                eq(facilityBookings.stripeSubscriptionId, subId),
                eq(facilityBookings.status, "pending"),
              ))
              .orderBy(facilityBookings.bookingDate);
            const next = pending[0];
            if (next) {
              await db.update(facilityBookings)
                .set({ status: "paid", paidAt: new Date(), stripePaymentIntentId: invoice.payment_intent || next.stripePaymentIntentId })
                .where(eq(facilityBookings.id, next.id));
              console.log(`[Stripe Webhook] Subscription ${subId} cycle: marked booking ${next.id} (${next.bookingDate}) paid`);
            } else {
              console.log(`[Stripe Webhook] Subscription ${subId}: no pending bookings left to advance`);
            }
          } catch (e) {
            console.error("[Stripe Webhook] invoice.paid handler failed:", e);
          }
        }
      } else if (event.type === "invoice.payment_failed") {
        // A weekly invoice failed. Stripe will retry per its schedule; we
        // don't cancel the booking here — wait for subscription.deleted.
        const invoice = event.data.object as any;
        console.warn(`[Stripe Webhook] invoice.payment_failed for subscription ${invoice.subscription} (will retry)`);
      } else if (event.type === "customer.subscription.deleted") {
        // Subscription cancelled (either by customer, by Stripe after retries
        // exhausted, or by our own cancel_at fence). Cancel any remaining
        // pending bookings for this subscription. Already-paid bookings stay.
        const sub = event.data.object as any;
        try {
          const updated = await db.update(facilityBookings)
            .set({ status: "cancelled" })
            .where(and(
              eq(facilityBookings.stripeSubscriptionId, sub.id),
              eq(facilityBookings.status, "pending"),
            ))
            .returning();
          console.log(`[Stripe Webhook] Subscription ${sub.id} cancelled: ${updated.length} pending bookings cancelled`);
        } catch (e) {
          console.error("[Stripe Webhook] subscription.deleted handler failed:", e);
        }
      } else if (
        event.type === "charge.refunded" ||
        event.type === "refund.updated" ||
        event.type === "refund.failed" ||
        event.type === "charge.refund.updated"
      ) {
        const obj = event.data.object as any;
        const refundId: string | undefined = obj?.id?.startsWith?.("re_")
          ? obj.id
          : obj?.refunds?.data?.[0]?.id;
        const refundStatus: string | undefined = obj?.status || obj?.refunds?.data?.[0]?.status;
        const regIdMeta = parseInt(obj?.metadata?.registrationId || obj?.refunds?.data?.[0]?.metadata?.registrationId || "");
        if (regIdMeta && refundStatus) {
          try {
            await storage.updateRegistration(regIdMeta, { stripeRefundStatus: refundStatus, ...(refundId ? { stripeRefundId: refundId } : {}) });
            console.log(`[Stripe Webhook] Updated reg ${regIdMeta} refund status → ${refundStatus}`);
          } catch (err) {
            console.error(`[Stripe Webhook] Failed to update reg ${regIdMeta}:`, err);
          }
        }
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("[Stripe Webhook] Error:", error.message);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/public/confirm-payment", async (req, res) => {
    try {
      const { registrationId, paymentIntentId } = req.body;
      if (!registrationId) return res.status(400).json({ message: "registrationId required" });
      const reg = await storage.getRegistration(registrationId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      if (reg.status === "confirmed") return res.json({ ok: true, alreadyConfirmed: true });

      if (reg.stripePaymentIntentId) {
        if (paymentIntentId && paymentIntentId !== reg.stripePaymentIntentId) {
          return res.status(403).json({ message: "Payment intent mismatch" });
        }
        const pi = await retrievePaymentIntent(reg.stripePaymentIntentId);
        if (pi.status === "succeeded") {
          const metaRegistrationId = pi.metadata?.registrationId;
          if (metaRegistrationId && parseInt(metaRegistrationId) !== reg.id) {
            return res.status(403).json({ message: "Registration mismatch" });
          }
          await handlePaymentSuccess(reg.id, pi.id, pi.metadata as any);
          return res.json({ ok: true });
        }
        return res.status(400).json({ message: "Payment not completed" });
      }

      return res.status(400).json({ message: "No payment intent" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/checkout/:registrationId", async (req, res) => {
    try {
      const regId = parseInt(req.params.registrationId);
      const reg = await storage.getRegistration(regId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      if (reg.status === "confirmed") return res.status(400).json({ message: "Already confirmed" });
      if (!reg.stripePaymentIntentId) return res.status(400).json({ message: "No payment intent" });

      const pi = await retrievePaymentIntent(reg.stripePaymentIntentId);
      if (!pi.client_secret) return res.status(400).json({ message: "No client secret" });

      const contact = await storage.getContact(reg.contactId);
      const program = await storage.getProgram(reg.programId);
      const items = await storage.getRegistrationItems(reg.id);

      const childIds = [...new Set(items.map(i => i.childId))];
      const childrenNames: string[] = [];
      for (const childId of childIds) {
        const child = await storage.getChild(childId);
        if (child) childrenNames.push(`${child.firstName} ${child.lastName}`);
      }

      const campDates = await storage.getCampDates(reg.programId);
      const itemDetails = items.map(item => {
        const campDate = campDates.find(d => d.id === item.campDateId);
        const dateLabel = campDate
          ? new Date(campDate.date + 'T12:00:00').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
          : "Unknown";
        const childIndex = childIds.indexOf(item.childId);
        return {
          dateName: dateLabel,
          productType: item.productType,
          childIndex,
        };
      });

      res.json({
        clientSecret: pi.client_secret,
        registrationId: reg.id,
        totalCents: reg.totalCents,
        subtotalCents: reg.subtotalCents,
        discountCents: reg.discountCents,
        currency: reg.currency || "NZD",
        campName: program?.name || "",
        campSlug: program?.slug || "",
        parentName: contact ? `${contact.firstName} ${contact.lastName}` : "",
        parentEmail: contact?.email || "",
        items: itemDetails,
        childrenNames,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/registrations/:id", async (req, res) => {
    try {
      const reg = await storage.getRegistration(parseInt(req.params.id));
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      const contact = await storage.getContact(reg.contactId);
      const program = await storage.getProgram(reg.programId);
      const items = await storage.getRegistrationItems(reg.id);
      res.json({
        id: reg.id,
        status: reg.status,
        totalCents: reg.totalCents,
        discountCents: reg.discountCents,
        subtotalCents: reg.subtotalCents,
        currency: reg.currency,
        campName: program?.name,
        campSlug: program?.slug,
        parentName: contact ? `${contact.firstName} ${contact.lastName}` : "",
        parentEmail: contact?.email,
        itemCount: items.length,
        registeredAt: reg.registeredAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/public/registrations/:id/attribution", async (req, res) => {
    try {
      const regId = parseInt(req.params.id);
      const { referralSource } = req.body;
      if (!referralSource || typeof referralSource !== "string") {
        return res.status(400).json({ message: "referralSource is required" });
      }
      const reg = await storage.getRegistration(regId);
      if (!reg) return res.status(404).json({ message: "Registration not found" });
      await storage.updateRegistration(regId, { referralSource });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/attribution", requireAuth, async (req, res) => {
    try {
      const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : undefined;
      const campSlug = req.query.campSlug as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      const allRegs = await storage.getRegistrations();
      let filtered = allRegs.filter(r => r.status === "confirmed");

      if (orgId) {
        const programs = await storage.getPrograms();
        const orgProgramIds = programs.filter(p => p.organizationId === orgId).map(p => p.id);
        filtered = filtered.filter(r => orgProgramIds.includes(r.programId));
      }

      if (campSlug && campSlug !== "all") {
        const programs = await storage.getPrograms();
        const program = programs.find(p => p.slug === campSlug);
        if (program) filtered = filtered.filter(r => r.programId === program.id);
      }

      if (from) filtered = filtered.filter(r => r.registeredAt >= new Date(from));
      if (to) {
        const toDate = new Date(to);
        toDate.setDate(toDate.getDate() + 1);
        filtered = filtered.filter(r => r.registeredAt < toDate);
      }

      const totalResponses = filtered.filter(r => r.referralSource).length;
      const totalRegistrations = filtered.length;
      const responseRate = totalRegistrations > 0 ? Math.round((totalResponses / totalRegistrations) * 100) : 0;

      const sourceCounts: Record<string, { count: number; revenue: number }> = {};
      for (const reg of filtered) {
        const src = reg.referralSource || "No Response";
        if (!sourceCounts[src]) sourceCounts[src] = { count: 0, revenue: 0 };
        sourceCounts[src].count++;
        sourceCounts[src].revenue += reg.totalCents || 0;
      }

      const sources = Object.entries(sourceCounts)
        .map(([source, data]) => ({
          source,
          count: data.count,
          revenue: data.revenue,
          percentage: totalRegistrations > 0 ? Math.round((data.count / totalRegistrations) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      res.json({
        totalRegistrations,
        totalResponses,
        responseRate,
        sources,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── API Key helpers ──
  function hashApiKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex");
  }

  function generateApiKey(): { raw: string; prefix: string; hash: string } {
    const raw = `clubos_${crypto.randomBytes(32).toString("hex")}`;
    const prefix = raw.slice(0, 12) + "...";
    const hash = hashApiKey(raw);
    return { raw, prefix, hash };
  }

  async function requireApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <api_key>" });
      }
      const key = authHeader.slice(7);
      const hash = hashApiKey(key);
      const [apiKey] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.active, true)));
      if (!apiKey) {
        return res.status(401).json({ error: "Invalid API key" });
      }
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        return res.status(401).json({ error: "API key has expired" });
      }
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, apiKey.id));
      (req as any).apiKeyOrg = apiKey.organizationId;
      (req as any).apiKeyScopes = apiKey.scopes;
      next();
    } catch (error: any) {
      res.status(500).json({ error: "Authentication error" });
    }
  }

  // ── Admin: API Key Management (super_admin only) ──
  app.get("/api/admin/api-keys", requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string) || 1;
      const keys = await db.select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        organizationId: apiKeys.organizationId,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        active: apiKeys.active,
        createdAt: apiKeys.createdAt,
      }).from(apiKeys).where(eq(apiKeys.organizationId, orgId)).orderBy(desc(apiKeys.createdAt));
      res.json(keys);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/api-keys", requireSuperAdmin, async (req, res) => {
    try {
      const { name, organizationId, expiresInDays } = req.body;
      if (!name) return res.status(400).json({ message: "name is required" });
      const orgId = parseInt(organizationId) || 1;
      const { raw, prefix, hash } = generateApiKey();
      const expiresAt = expiresInDays && parseInt(expiresInDays) > 0 ? new Date(Date.now() + parseInt(expiresInDays) * 86400000) : null;
      const [created] = await db.insert(apiKeys).values({
        name: String(name).slice(0, 100),
        keyHash: hash,
        keyPrefix: prefix,
        organizationId: orgId,
        createdById: (req as any).session.userId,
        scopes: ["read"],
        expiresAt,
      }).returning();
      res.json({ id: created.id, name: created.name, key: raw, keyPrefix: prefix, expiresAt: created.expiresAt, scopes: created.scopes, message: "Save this key now — it won't be shown again." });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/api-keys/:id", requireSuperAdmin, async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      if (isNaN(keyId)) return res.status(400).json({ message: "Invalid key ID" });
      await db.update(apiKeys).set({ active: false }).where(eq(apiKeys.id, keyId));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── External API v1 (authenticated by API key) ──
  app.get("/api/v1/overview", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;
      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const { rows: revenueRows } = await db.execute(sql.raw(`
        SELECT COALESCE(SUM(r.total_cents), 0) as total_revenue,
               COUNT(DISTINCT r.id) as total_registrations,
               COUNT(DISTINCT r.contact_id) as unique_customers,
               CASE WHEN COUNT(r.id) > 0 THEN ROUND(SUM(r.total_cents)::numeric / COUNT(r.id), 0) ELSE 0 END as avg_order_value
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE p.organization_id = ${orgId}
          AND r.registered_at >= '${since}'
          AND r.status = 'confirmed'
      `));
      const rev = revenueRows[0] || {};

      const { rows: analyticsRows } = await db.execute(sql.raw(`
        SELECT COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
               COUNT(DISTINCT session_id) as sessions,
               COUNT(DISTINCT visitor_id) as unique_visitors,
               COUNT(*) FILTER (WHERE event_type = 'cta_click') as cta_clicks
        FROM analytics_events ae
        JOIN programs p ON ae.camp_slug = p.slug
        WHERE p.organization_id = ${orgId}
          AND ae.timestamp >= '${since}'
      `));
      const analytics = analyticsRows[0] || {};

      const totalRev = Number(rev.total_revenue || 0);
      const totalRegs = Number(rev.total_registrations || 0);
      const pageViews = Number(analytics.page_views || 0);

      res.json({
        period: { days, since },
        revenue: {
          totalCents: totalRev,
          totalFormatted: `$${(totalRev / 100).toFixed(2)}`,
          currency: "NZD",
        },
        registrations: totalRegs,
        uniqueCustomers: Number(rev.unique_customers || 0),
        avgOrderValueCents: Number(rev.avg_order_value || 0),
        analytics: {
          pageViews,
          sessions: Number(analytics.sessions || 0),
          uniqueVisitors: Number(analytics.unique_visitors || 0),
          ctaClicks: Number(analytics.cta_clicks || 0),
          conversionRate: pageViews > 0 ? parseFloat(((totalRegs / pageViews) * 100).toFixed(2)) : 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/revenue", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;
      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const { rows } = await db.execute(sql.raw(`
        SELECT p.id as camp_id, p.name as camp_name, p.slug,
               COUNT(r.id) as registrations,
               COALESCE(SUM(r.total_cents), 0) as revenue_cents,
               CASE WHEN COUNT(r.id) > 0 THEN ROUND(SUM(r.total_cents)::numeric / COUNT(r.id), 0) ELSE 0 END as avg_order_cents
        FROM programs p
        LEFT JOIN registrations r ON r.program_id = p.id AND r.status = 'confirmed' AND r.registered_at >= '${since}'
        WHERE p.organization_id = ${orgId}
        GROUP BY p.id, p.name, p.slug
        ORDER BY revenue_cents DESC
      `));

      const camps = rows.map((r: any) => ({
        campId: r.camp_id,
        campName: r.camp_name,
        slug: r.slug,
        registrations: Number(r.registrations),
        revenueCents: Number(r.revenue_cents),
        revenueFormatted: `$${(Number(r.revenue_cents) / 100).toFixed(2)}`,
        avgOrderCents: Number(r.avg_order_cents),
      }));

      const totals = {
        totalRevenueCents: camps.reduce((s: number, c: any) => s + c.revenueCents, 0),
        totalRegistrations: camps.reduce((s: number, c: any) => s + c.registrations, 0),
      };

      res.json({ period: { days, since }, camps, totals: { ...totals, totalRevenueFormatted: `$${(totals.totalRevenueCents / 100).toFixed(2)}` } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/analytics", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;
      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const campSlug = req.query.camp as string;

      let slugFilter = "";
      if (campSlug) {
        const safeSlug = campSlug.replace(/[^a-z0-9\-_]/gi, "");
        slugFilter = `AND ae.camp_slug = '${safeSlug}'`;
      }

      const { rows } = await db.execute(sql.raw(`
        SELECT COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
               COUNT(DISTINCT session_id) as sessions,
               COUNT(DISTINCT visitor_id) as unique_visitors,
               COUNT(*) FILTER (WHERE event_type = 'cta_click') as cta_clicks,
               COUNT(*) FILTER (WHERE event_type = 'form_view') as form_views,
               COUNT(*) FILTER (WHERE event_type = 'form_step') as form_steps,
               COUNT(*) FILTER (WHERE event_type = 'session_start') as session_starts,
               ROUND(AVG(CASE WHEN event_type = 'time_on_page' THEN (metadata->>'seconds')::numeric END), 1) as avg_time_on_page,
               ROUND(AVG(CASE WHEN event_type = 'scroll_depth' THEN (metadata->>'depth')::numeric END), 1) as avg_scroll_depth
        FROM analytics_events ae
        JOIN programs p ON ae.camp_slug = p.slug
        WHERE p.organization_id = ${orgId}
          AND ae.timestamp >= '${since}'
          ${slugFilter}
      `));

      const a = rows[0] || {};
      const pageViews = Number(a.page_views || 0);
      const formViews = Number(a.form_views || 0);

      const { rows: deviceRows } = await db.execute(sql.raw(`
        SELECT COALESCE(device, 'unknown') as device, COUNT(*) as count
        FROM analytics_events ae
        JOIN programs p ON ae.camp_slug = p.slug
        WHERE p.organization_id = ${orgId}
          AND ae.timestamp >= '${since}'
          AND ae.event_type = 'page_view'
          ${slugFilter}
        GROUP BY device ORDER BY count DESC
      `));

      const { rows: sourceRows } = await db.execute(sql.raw(`
        SELECT COALESCE(ae.metadata->>'trafficSource', 'Direct') as source, COUNT(*) as count
        FROM analytics_events ae
        JOIN programs p ON ae.camp_slug = p.slug
        WHERE p.organization_id = ${orgId}
          AND ae.timestamp >= '${since}'
          AND ae.event_type = 'page_view'
          ${slugFilter}
        GROUP BY source ORDER BY count DESC
      `));

      const { rows: dailyRows } = await db.execute(sql.raw(`
        SELECT DATE(ae.timestamp) as date,
               COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
               COUNT(DISTINCT session_id) as sessions
        FROM analytics_events ae
        JOIN programs p ON ae.camp_slug = p.slug
        WHERE p.organization_id = ${orgId}
          AND ae.timestamp >= '${since}'
          ${slugFilter}
        GROUP BY DATE(ae.timestamp) ORDER BY date
      `));

      res.json({
        period: { days, since },
        pageViews,
        sessions: Number(a.sessions || 0),
        uniqueVisitors: Number(a.unique_visitors || 0),
        ctaClicks: Number(a.cta_clicks || 0),
        formViews,
        formSteps: Number(a.form_steps || 0),
        funnelConversion: formViews > 0 ? parseFloat(((Number(a.form_steps || 0) / formViews) * 100).toFixed(2)) : 0,
        avgTimeOnPage: Number(a.avg_time_on_page || 0),
        avgScrollDepth: Number(a.avg_scroll_depth || 0),
        devices: deviceRows.map((d: any) => ({ device: d.device, count: Number(d.count) })),
        sources: sourceRows.map((s: any) => ({ source: s.source, count: Number(s.count) })),
        daily: dailyRows.map((d: any) => ({ date: d.date, pageViews: Number(d.page_views), sessions: Number(d.sessions) })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/customers", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const { rows } = await db.execute(sql.raw(`
        SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.created_at,
               COUNT(DISTINCT r.id) as total_orders,
               COALESCE(SUM(r.total_cents), 0) as lifetime_value_cents,
               MAX(r.registered_at) as last_order_at
        FROM contacts c
        JOIN registrations r ON r.contact_id = c.id AND r.status = 'confirmed'
        JOIN programs p ON r.program_id = p.id
        WHERE p.organization_id = ${orgId}
        GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.created_at
        ORDER BY lifetime_value_cents DESC
        LIMIT ${limit} OFFSET ${offset}
      `));

      const { rows: countRows } = await db.execute(sql.raw(`
        SELECT COUNT(DISTINCT c.id) as total
        FROM contacts c
        JOIN registrations r ON r.contact_id = c.id AND r.status = 'confirmed'
        JOIN programs p ON r.program_id = p.id
        WHERE p.organization_id = ${orgId}
      `));

      res.json({
        customers: rows.map((c: any) => ({
          id: c.id,
          firstName: c.first_name,
          lastName: c.last_name,
          email: c.email,
          phone: c.phone,
          totalOrders: Number(c.total_orders),
          lifetimeValueCents: Number(c.lifetime_value_cents),
          lifetimeValueFormatted: `$${(Number(c.lifetime_value_cents) / 100).toFixed(2)}`,
          lastOrderAt: c.last_order_at,
          createdAt: c.created_at,
        })),
        total: Number(countRows[0]?.total || 0),
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/camps", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;

      const { rows } = await db.execute(sql.raw(`
        SELECT p.id, p.name, p.slug, p.type, p.location, p.capacity, p.fee,
               p.start_date, p.end_date, p.is_active, p.created_at,
               COUNT(r.id) FILTER (WHERE r.status = 'confirmed') as confirmed_registrations,
               COALESCE(SUM(r.total_cents) FILTER (WHERE r.status = 'confirmed'), 0) as revenue_cents
        FROM programs p
        LEFT JOIN registrations r ON r.program_id = p.id
        WHERE p.organization_id = ${orgId}
        GROUP BY p.id
        ORDER BY p.start_date DESC
      `));

      res.json({
        camps: rows.map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          type: c.type,
          location: c.location,
          capacity: c.capacity,
          fee: c.fee,
          startDate: c.start_date,
          endDate: c.end_date,
          active: c.is_active,
          confirmedRegistrations: Number(c.confirmed_registrations),
          revenueCents: Number(c.revenue_cents),
          revenueFormatted: `$${(Number(c.revenue_cents) / 100).toFixed(2)}`,
          occupancyRate: c.capacity > 0 ? parseFloat(((Number(c.confirmed_registrations) / c.capacity) * 100).toFixed(1)) : 0,
          createdAt: c.created_at,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/split-tests", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;

      const { rows } = await db.execute(sql.raw(`
        SELECT st.id, st.program_id, st.field, st.status, st.started_at, st.ended_at,
               st.winner_id, st.end_condition, p.name as camp_name
        FROM split_tests st
        JOIN programs p ON st.program_id = p.id
        WHERE p.organization_id = ${orgId}
        ORDER BY st.started_at DESC
      `));

      const tests = [];
      for (const t of rows as any[]) {
        const { rows: variants } = await db.execute(sql.raw(`
          SELECT id, label, value, views, registrations, revenue, is_control
          FROM split_test_variants
          WHERE split_test_id = ${t.id}
          ORDER BY is_control DESC
        `));

        const totalViews = variants.reduce((s: number, v: any) => s + Number(v.views || 0), 0);
        const totalRegs = variants.reduce((s: number, v: any) => s + Number(v.registrations || 0), 0);

        tests.push({
          id: t.id,
          campName: t.camp_name,
          programId: t.program_id,
          field: t.field,
          status: t.status,
          startedAt: t.started_at,
          endedAt: t.ended_at,
          winnerId: t.winner_id,
          endCondition: t.end_condition,
          conversionRate: totalViews > 0 ? parseFloat(((totalRegs / totalViews) * 100).toFixed(2)) : 0,
          variants: variants.map((v: any) => ({
            id: v.id,
            label: v.label,
            value: v.value,
            isControl: v.is_control,
            views: Number(v.views || 0),
            registrations: Number(v.registrations || 0),
            revenue: Number(v.revenue || 0),
            conversionRate: Number(v.views || 0) > 0 ? parseFloat(((Number(v.registrations || 0) / Number(v.views || 0)) * 100).toFixed(2)) : 0,
          })),
        });
      }

      res.json({ splitTests: tests });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/registrations", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;
      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const { rows } = await db.execute(sql.raw(`
        SELECT r.id, r.status, r.total_cents, r.currency, r.registered_at,
               p.name as camp_name, p.slug as camp_slug,
               c.first_name, c.last_name, c.email
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        JOIN contacts c ON r.contact_id = c.id
        WHERE p.organization_id = ${orgId}
          AND r.registered_at >= '${since}'
        ORDER BY r.registered_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `));

      const { rows: countRows } = await db.execute(sql.raw(`
        SELECT COUNT(*) as total
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE p.organization_id = ${orgId}
          AND r.registered_at >= '${since}'
      `));

      res.json({
        period: { days, since },
        registrations: rows.map((r: any) => ({
          id: r.id,
          status: r.status,
          totalCents: r.total_cents,
          totalFormatted: `$${(Number(r.total_cents || 0) / 100).toFixed(2)}`,
          currency: r.currency,
          registeredAt: r.registered_at,
          campName: r.camp_name,
          campSlug: r.camp_slug,
          contactName: `${r.first_name} ${r.last_name}`,
          contactEmail: r.email,
        })),
        total: Number(countRows[0]?.total || 0),
        limit,
        offset,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/order-timing", requireApiKey, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).apiKeyOrg;
      const days = parseInt(req.query.days as string) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const { rows: heatmapRows } = await db.execute(sql.raw(`
        SELECT
          EXTRACT(DOW FROM r.registered_at AT TIME ZONE 'Pacific/Auckland') as day_of_week,
          EXTRACT(HOUR FROM r.registered_at AT TIME ZONE 'Pacific/Auckland') as hour_of_day,
          COUNT(*) as order_count,
          COALESCE(SUM(r.total_cents), 0) as revenue_cents
        FROM registrations r
        JOIN programs p ON r.program_id = p.id
        WHERE r.status = 'confirmed'
          AND p.organization_id = ${orgId}
          AND r.registered_at >= '${since}'
        GROUP BY day_of_week, hour_of_day
        ORDER BY day_of_week, hour_of_day
      `));

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      res.json({
        period: { days, since },
        heatmap: heatmapRows.map((r: any) => ({
          dayOfWeek: Number(r.day_of_week),
          dayName: dayNames[Number(r.day_of_week)],
          hourOfDay: Number(r.hour_of_day),
          orderCount: Number(r.order_count),
          revenueCents: Number(r.revenue_cents),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── United Prints Routes ───────────────────────────────────

  app.get("/api/admin/print-orders", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const orders = await storage.getPrintOrdersByOrg(orgId);
      res.json(orders);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/print-orders", requireAuth, async (req, res) => {
    try {
      const order = await storage.createPrintOrder({ ...req.body, createdBy: req.session.userId! });
      res.json(order);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/admin/print-orders/:id", requireAuth, async (req, res) => {
    try {
      const order = await storage.updatePrintOrder(parseInt(req.params.id), req.body);
      if (!order) return res.status(404).json({ message: "Not found" });
      res.json(order);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/admin/print-orders/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePrintOrder(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/print-projects", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const projects = await storage.getPrintProjectsByOrg(orgId);
      res.json(projects);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/print-projects", requireAuth, async (req, res) => {
    try {
      const project = await storage.createPrintProject({ ...req.body, createdBy: req.session.userId! });
      res.json(project);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/admin/print-projects/:id", requireAuth, async (req, res) => {
    try {
      const project = await storage.updatePrintProject(parseInt(req.params.id), req.body);
      if (!project) return res.status(404).json({ message: "Not found" });
      res.json(project);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/admin/print-projects/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePrintProject(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/print-contacts", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const contacts = await storage.getPrintContactsByOrg(orgId);
      res.json(contacts);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/print-contacts", requireAuth, async (req, res) => {
    try {
      const contact = await storage.createPrintContact(req.body);
      res.json(contact);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/admin/print-contacts/:id", requireAuth, async (req, res) => {
    try {
      const contact = await storage.updatePrintContact(parseInt(req.params.id), req.body);
      if (!contact) return res.status(404).json({ message: "Not found" });
      res.json(contact);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/admin/print-contacts/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePrintContact(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/print-landing-pages", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const pages = await storage.getPrintLandingPagesByOrg(orgId);
      res.json(pages);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/print-landing-pages", requireAuth, async (req, res) => {
    try {
      const page = await storage.createPrintLandingPage(req.body);
      res.json(page);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/admin/print-landing-pages/:id", requireAuth, async (req, res) => {
    try {
      const page = await storage.updatePrintLandingPage(parseInt(req.params.id), req.body);
      if (!page) return res.status(404).json({ message: "Not found" });
      res.json(page);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/admin/print-landing-pages/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePrintLandingPage(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/print-emails", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const emails = await storage.getPrintEmailsByOrg(orgId);
      res.json(emails);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/print-emails", requireAuth, async (req, res) => {
    try {
      const email = await storage.createPrintEmail({ ...req.body, createdBy: req.session.userId! });
      res.json(email);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/admin/print-emails/:id", requireAuth, async (req, res) => {
    try {
      const email = await storage.updatePrintEmail(parseInt(req.params.id), req.body);
      if (!email) return res.status(404).json({ message: "Not found" });
      res.json(email);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── AI copy generation ────────────────────────────────────────────────
  // Powers the ✨ AI button on every text field in the editor. Brand voice
  // is picked server-side based on the orgSlug in the request so the model
  // always knows the workspace's tone of voice + personas.
  // Generic image upload — used by the page-block editor to add images to
  // image+text blocks, logo strips, testimonial avatars. Re-encodes to webp,
  // resizes, marks public via objectAcls. Returns the public /objects/...
  // URL the client stores in the block props.
  const blockImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  app.post(
    "/api/admin/uploads/image",
    requireAuth,
    (req, res, next) => {
      blockImageUpload.single("file")(req, res, (err: any) => {
        if (err) {
          const msg = err?.code === "LIMIT_FILE_SIZE" ? "File too big — max 10MB" : err?.message || "Upload rejected";
          return res.status(400).json({ message: msg });
        }
        next();
      });
    },
    async (req: any, res) => {
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ message: "No file uploaded" });
        const sharp = (await import("sharp")).default;
        const meta = await sharp(file.buffer, { failOn: "error", animated: false, limitInputPixels: 200_000_000 }).metadata();
        if (!meta.format || !["jpeg", "jpg", "png", "webp", "avif", "gif"].includes(meta.format)) {
          return res.status(400).json({ message: `Unsupported image format: ${meta.format}` });
        }
        const buf = await sharp(file.buffer)
          .rotate()
          .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85, effort: 4 })
          .toBuffer();
        const svc = new ObjectStorageService();
        const upload = await svc.uploadBufferToUploads(buf, "image/webp", "webp");
        await setObjectAclPolicy(upload.file, { owner: String(req.session.userId), visibility: "public" });
        res.json({ url: upload.objectPath });
      } catch (e: any) {
        console.error("[Block image upload] failed:", e);
        res.status(500).json({ message: e.message });
      }
    }
  );

  app.post("/api/admin/ai/generate-copy", requireAuth, async (req, res) => {
    try {
      const { prompt, fieldName, fieldHint, currentValue, orgSlug, maxTokens } = req.body || {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ message: "prompt is required" });
      }
      const { generateCopy } = await import("./ai");
      const text = await generateCopy({
        prompt,
        fieldName,
        fieldHint,
        currentValue,
        orgSlug,
        maxTokens: maxTokens ? Math.min(parseInt(maxTokens), 4000) : undefined,
      });
      res.json({ text });
    } catch (e: any) {
      console.error("[AI generate-copy] failed:", e);
      // Surface model errors clearly so the UI can show 'Anthropic key not
      // configured' vs 'rate limit' vs 'overloaded' rather than a generic
      // 500.
      const status = /not configured/i.test(e.message) ? 503
        : /rate limit|overloaded/i.test(e.message) ? 429
        : 500;
      res.status(status).json({ message: e.message });
    }
  });

  // Generate a full landing-page draft from one short brief. Returns a
  // structured object covering hero / CTAs / section headings / FAQs.
  app.post("/api/admin/ai/generate-page", requireAuth, async (req, res) => {
    try {
      const { brief, orgSlug, programName, programType, audience } = req.body || {};
      if (!brief || typeof brief !== "string") {
        return res.status(400).json({ message: "brief is required" });
      }
      const { generatePageFromBrief } = await import("./ai");
      const draft = await generatePageFromBrief({ brief, orgSlug, programName, programType, audience });
      res.json({ draft });
    } catch (e: any) {
      console.error("[AI generate-page] failed:", e);
      const status = /not configured/i.test(e.message) ? 503
        : /rate limit|overloaded/i.test(e.message) ? 429
        : /parse/i.test(e.message) ? 422
        : 500;
      res.status(status).json({ message: e.message });
    }
  });

  // ── Integrations (Xero, Stripe status) ────────────────────────────────
  app.get("/api/admin/integrations", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const { getOrgIntegration } = await import("./xero");
      const xero = await getOrgIntegration(orgId, "xero");
      // Stripe is configured globally via env vars — surface that as connected
      // when the keys are present. Per-org Stripe Connect can come later.
      const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
      res.json({
        xero: xero ? {
          isActive: xero.isActive,
          tenantName: xero.externalName,
          tenantId: xero.externalId,
          connectedAt: xero.connectedAt,
          lastSyncedAt: xero.lastSyncedAt,
          tokenExpiresAt: xero.tokenExpiresAt,
        } : null,
        stripe: stripeConfigured ? {
          isActive: true,
          mode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test",
          webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
        } : null,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/integrations/xero/connect", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const { buildAuthUrl } = await import("./xero");
      const url = await buildAuthUrl(orgId);
      res.json({ url });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // OAuth callback — Xero redirects here after user grants access. NOT
  // requireAuth (the user comes back via a browser redirect; the state
  // param carries the orgId).
  app.get("/api/integrations/xero/callback", async (req, res) => {
    try {
      const state = req.query.state as string;
      if (!state) return res.status(400).send("Missing state");
      const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      const { handleCallback } = await import("./xero");
      const { tenantName } = await handleCallback(fullUrl, state);
      // Redirect back to the integrations page with success
      res.redirect(`/admin/integrations?xero=connected&tenant=${encodeURIComponent(tenantName)}`);
    } catch (e: any) {
      console.error("[Xero callback] failed:", e);
      res.redirect(`/admin/integrations?xero=error&message=${encodeURIComponent(e.message)}`);
    }
  });

  app.post("/api/admin/integrations/xero/disconnect", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.body.orgId);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const { disconnectIntegration } = await import("./xero");
      await disconnectIntegration(orgId, "xero");
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Manually push an order to Xero (used by admin when auto-push fails or
  // for orders created before Xero was connected).
  app.post("/api/admin/print-orders/:id/push-to-xero", requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const allOrders = await storage.getPrintOrdersByOrg(8);
      const order = allOrders.find(o => o.id === orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      const items = await storage.getPrintOrderItems(orderId);
      const { pushPaidOrderToXero } = await import("./xero");
      const result = await pushPaidOrderToXero(order, items);
      await storage.createPrintOrderEvent({
        orderId,
        eventType: "xero_pushed",
        notes: `Pushed to Xero (invoice ${result.invoiceNumber})`,
        metadataJson: result,
        createdBy: req.session.userId,
      } as any);
      res.json(result);
    } catch (e: any) {
      console.error("[Xero push] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Print Materials (catalog) ──────────────────────────────────────────
  app.get("/api/admin/print-materials", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const activeOnly = req.query.activeOnly === "true";
      const materials = await storage.getPrintMaterials(orgId, { activeOnly });
      res.json(materials);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/print-materials/:id", requireAuth, async (req, res) => {
    try {
      const m = await storage.getPrintMaterial(parseInt(req.params.id));
      if (!m) return res.status(404).json({ message: "Not found" });
      res.json(m);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/admin/print-materials", requireAuth, async (req, res) => {
    try {
      if (!req.body.organizationId) return res.status(400).json({ message: "organizationId required" });
      const m = await storage.createPrintMaterial(req.body);
      res.status(201).json(m);
    } catch (e: any) {
      if (e?.code === "23505") {
        return res.status(409).json({ message: "A material with that slug already exists." });
      }
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/admin/print-materials/:id", requireAuth, async (req, res) => {
    try {
      const m = await storage.updatePrintMaterial(parseInt(req.params.id), req.body);
      if (!m) return res.status(404).json({ message: "Not found" });
      res.json(m);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // Order detail bundle for the admin order detail page — single round-trip.
  app.get("/api/admin/print-orders/:id/detail", requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const allOrders = await storage.getPrintOrdersByOrg(8);
      const order = allOrders.find(o => o.id === orderId);
      if (!order) return res.status(404).json({ message: "Not found" });
      const [items, files, events] = await Promise.all([
        storage.getPrintOrderItems(orderId),
        storage.getPrintOrderFiles(orderId),
        storage.getPrintOrderEvents(orderId),
      ]);
      // Look up the most recent Xero invoice link, if any
      const { db } = await import("./db");
      const { printXeroInvoices } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const xeroRows = await db.select().from(printXeroInvoices)
        .where(eq(printXeroInvoices.printOrderId, orderId))
        .orderBy(desc(printXeroInvoices.createdAt))
        .limit(1);
      const xeroInvoice = xeroRows[0] ? {
        id: xeroRows[0].xeroInvoiceId,
        number: xeroRows[0].xeroInvoiceNumber,
        status: xeroRows[0].status,
      } : null;
      res.json({ order, items, files, events, xeroInvoice });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/admin/print-materials/:id", requireAuth, async (req, res) => {
    try {
      await storage.deletePrintMaterial(parseInt(req.params.id));
      res.status(204).end();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Public-facing: list active materials by org (for the order page).
  // No auth — this is the public catalog.
  app.get("/api/print/materials", async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string) || 8;  // United Prints default
      const materials = await storage.getPrintMaterials(orgId, { activeOnly: true });
      res.json(materials);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/print/materials/:slug", async (req, res) => {
    try {
      const m = await storage.getPrintMaterialBySlug(req.params.slug);
      if (!m || !m.isActive) return res.status(404).json({ message: "Not found" });
      res.json(m);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Public order creation. Creates a print_order in `quote_sent` status with
  // a magic link token. Re-runs the pricing engine server-side so the
  // customer can never spoof the price. Day 3 wires this to Stripe.
  app.post("/api/print/orders", async (req, res) => {
    try {
      const { materialSlug, config, customer, delivery, artworkPath, customerNotes } = req.body;
      if (!materialSlug || !config || !customer) {
        return res.status(400).json({ message: "materialSlug, config, customer required" });
      }
      const material = await storage.getPrintMaterialBySlug(materialSlug);
      if (!material || !material.isActive) return res.status(404).json({ message: "Material not found" });

      const { quotePrintItem, quoteOrderTotals } = await import("./print-pricing");
      const itemQuote = quotePrintItem(material, config);
      if (!itemQuote.ok) return res.status(400).json({ message: itemQuote.message });

      const totals = quoteOrderTotals([itemQuote.subtotalCents]);

      const orgId = material.organizationId;
      const allOrders = await storage.getPrintOrdersByOrg(orgId);
      const year = new Date().getFullYear();
      const orderNumber = `UP-${year}-${String(allOrders.length + 1).padStart(4, "0")}`;
      const magicLinkToken = require("crypto").randomBytes(24).toString("hex");

      const pickupReady = new Date();
      let added = 0;
      while (added < itemQuote.turnaroundDays) {
        pickupReady.setDate(pickupReady.getDate() + 1);
        const day = pickupReady.getDay();
        if (day !== 0 && day !== 6) added++;
      }

      const order = await storage.createPrintOrder({
        organizationId: orgId,
        orderNumber,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerCompany: customer.company || null,
        title: material.name,
        description: null,
        status: "quote_sent",
        amount: String((totals.totalCents / 100).toFixed(2)),
        subtotalCents: totals.subtotalCents,
        gstCents: totals.gstCents,
        totalCents: totals.totalCents,
        paidCents: 0,
        deliveryMethod: delivery?.method ?? "pickup",
        deliveryAddress: delivery?.method === "delivery" ? delivery.address : null,
        deliveryQuoteCents: 0,
        pickupReadyDate: pickupReady.toISOString().split("T")[0],
        magicLinkToken,
        quoteExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        customerNotes: customerNotes || null,
        rushRequested: !!config.rush,
        notes: `Artwork path: ${artworkPath || "upload_now"}`,
      } as any);

      await storage.createPrintOrderItem({
        orderId: order.id,
        materialId: material.id,
        materialName: material.name,
        widthMm: config.widthMm ?? null,
        heightMm: config.heightMm ?? null,
        quantity: config.quantity ?? 1,
        sides: config.sides ?? 1,
        configJson: { ...config, artworkPath },
        unitPriceCents: itemQuote.unitPriceCents,
        qtyDiscountCents: itemQuote.qtyDiscountCents,
        addonsTotalCents: itemQuote.addonsTotalCents,
        subtotalCents: itemQuote.subtotalCents,
        estimatedCostCents: itemQuote.estimatedCostCents,
        breakdownJson: itemQuote.breakdown,
      } as any);

      await storage.createPrintOrderEvent({
        orderId: order.id,
        eventType: "created",
        notes: `Order placed online by ${customer.firstName} ${customer.lastName}`,
        metadataJson: { artworkPath, deliveryMethod: delivery?.method },
      } as any);

      res.status(201).json({
        id: order.id,
        orderNumber: order.orderNumber,
        magicLinkToken: order.magicLinkToken,
      });
    } catch (e: any) {
      console.error("Print order creation failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // Create a Stripe PaymentIntent for an existing print order. The order is
  // already in `quote_sent` after POST /api/print/orders, so the price has
  // been server-validated. We just authorise the charge.
  app.post("/api/print/orders/:token/payment-intent", async (req, res) => {
    try {
      const order = await storage.getPrintOrderByMagicLink(req.params.token);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status === "paid") return res.status(400).json({ message: "Order already paid" });
      if (order.status === "cancelled") return res.status(400).json({ message: "Order cancelled" });

      const { stripe } = await import("./stripe");
      const paymentIntent = await stripe.paymentIntents.create({
        amount: order.totalCents,
        currency: "nzd",
        receipt_email: order.customerEmail || undefined,
        description: `${order.orderNumber} — ${order.title}`,
        automatic_payment_methods: { enabled: true },
        metadata: {
          printOrderId: String(order.id),
          orderNumber: order.orderNumber || "",
          organizationId: String(order.organizationId),
        },
      });

      await storage.updatePrintOrder(order.id, {
        stripePaymentIntentId: paymentIntent.id,
      } as any);

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        totalCents: order.totalCents,
        orderNumber: order.orderNumber,
      });
    } catch (e: any) {
      console.error("[Print PI] Error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // Magic-link artwork upload. Token = the credential. We accept any
  // common print file format (PDF/AI/EPS/PNG/JPG/TIFF/ZIP) up to 100MB.
  // Files go to objectAcls (private) and a row gets written to
  // print_order_files. Status advances quote_sent → artwork_pending if
  // it was waiting on artwork.
  const PRINT_UPLOAD_MAX = 100 * 1024 * 1024;  // 100MB — print files can be huge
  const PRINT_ALLOWED_MIME = new Set([
    "application/pdf",
    "image/png", "image/jpeg", "image/tiff", "image/webp",
    "application/postscript",  // .ai .eps
    "application/illustrator",
    "application/zip", "application/x-zip-compressed",
    "image/svg+xml",
    "application/octet-stream",  // many systems mis-classify .ai as this
  ]);

  const printArtworkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PRINT_UPLOAD_MAX, files: 5 },
    fileFilter: (_req, file, cb) => {
      // Be permissive — accept based on extension when MIME is missing
      const ext = (file.originalname.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
      const okExt = new Set(["pdf", "ai", "eps", "png", "jpg", "jpeg", "tif", "tiff", "webp", "svg", "zip", "psd"]).has(ext || "");
      if (PRINT_ALLOWED_MIME.has(file.mimetype) || okExt) cb(null, true);
      else cb(new Error(`We don't accept .${ext || "this"} files. Try PDF, AI, EPS, PNG, JPG, or zip them up.`));
    },
  });

  app.post(
    "/api/print/orders/:token/upload",
    (req, res, next) => {
      printArtworkUpload.array("files", 5)(req, res, (err: any) => {
        if (err) {
          const msg = err?.code === "LIMIT_FILE_SIZE"
            ? `File too big — max ${Math.round(PRINT_UPLOAD_MAX / 1024 / 1024)}MB. Try compressing or zipping it.`
            : err?.message || "Upload rejected";
          return res.status(400).json({ message: msg });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        const order = await storage.getPrintOrderByMagicLink(req.params.token);
        if (!order) return res.status(404).json({ message: "Order not found" });

        const files = (req.files as Express.Multer.File[] | undefined) || [];
        if (files.length === 0) return res.status(400).json({ message: "No files uploaded" });

        const { ObjectStorageService } = await import("./replit_integrations/object_storage/objectStorage");
        const { setObjectAclPolicy } = await import("./replit_integrations/object_storage/objectAcl");
        const svc = new ObjectStorageService();
        const created: any[] = [];

        for (const file of files) {
          const ext = (file.originalname.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || "bin";
          const upload = await svc.uploadBufferToUploads(file.buffer, file.mimetype || "application/octet-stream", ext);
          await setObjectAclPolicy(upload.file, {
            owner: String(order.id),       // owner = order id (no real user account)
            visibility: "private",
          });
          const row = await storage.createPrintOrderFile({
            orderId: order.id,
            objectPath: upload.objectPath,
            filename: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            uploadedBy: "customer",
            fileType: "artwork",
          } as any);
          created.push(row);
        }

        // Log + advance status if it was waiting on artwork
        await storage.createPrintOrderEvent({
          orderId: order.id,
          eventType: "artwork_uploaded",
          notes: `${files.length} file${files.length > 1 ? "s" : ""} uploaded by customer`,
          metadataJson: { fileCount: files.length, fileNames: files.map(f => f.originalname) },
        } as any);

        if (order.status === "paid" || order.status === "artwork_pending") {
          await storage.updatePrintOrder(order.id, { status: "in_design" } as any);
        }

        res.status(201).json({ files: created });
      } catch (e: any) {
        console.error("[Print upload] failed:", e);
        res.status(500).json({ message: e.message || "Upload failed" });
      }
    }
  );

  app.get("/api/print/orders/:token/files", async (req, res) => {
    try {
      const order = await storage.getPrintOrderByMagicLink(req.params.token);
      if (!order) return res.status(404).json({ message: "Order not found" });
      const files = await storage.getPrintOrderFiles(order.id);
      res.json(files.map(f => ({
        id: f.id, filename: f.filename, fileSize: f.fileSize, mimeType: f.mimeType,
        uploadedBy: f.uploadedBy, fileType: f.fileType, uploadedAt: f.uploadedAt,
      })));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Look up an order by magic-link token. Token is the credential — no auth.
  app.get("/api/print/orders/by-token/:token", async (req, res) => {
    try {
      const order = await storage.getPrintOrderByMagicLink(req.params.token);
      if (!order) return res.status(404).json({ message: "Not found" });
      const [items, files, events] = await Promise.all([
        storage.getPrintOrderItems(order.id),
        storage.getPrintOrderFiles(order.id),
        storage.getPrintOrderEvents(order.id),
      ]);
      const item = items[0];
      const cfg = (item?.configJson as any) ?? {};
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      let prettyDate: string | null = null;
      if (order.pickupReadyDate) {
        const d = new Date(order.pickupReadyDate + "T00:00:00");
        prettyDate = `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
      }
      // Customer-safe event labels — no internal jargon
      const PUBLIC_EVENT_LABELS: Record<string, string> = {
        created: "Order placed",
        quote_sent: "Quote sent",
        paid: "Payment received",
        artwork_uploaded: "Artwork received",
        in_design: "Design started",
        in_proof: "Proof sent for approval",
        proof_approved: "Proof approved",
        in_production: "On the press",
        finishing: "Finishing",
        ready: "Ready for pickup",
        delivered: "Delivered",
        refunded: "Refunded",
      };
      const publicEvents = events
        .filter(e => PUBLIC_EVENT_LABELS[e.eventType])
        .map(e => ({
          type: e.eventType,
          label: PUBLIC_EVENT_LABELS[e.eventType],
          at: e.createdAt,
        }))
        .reverse();  // chronological order

      res.json({
        orderNumber: order.orderNumber,
        status: order.status,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        totalCents: order.totalCents,
        subtotalCents: order.subtotalCents,
        gstCents: order.gstCents,
        paidCents: order.paidCents,
        pickupReadyDate: prettyDate,
        deliveryMethod: order.deliveryMethod,
        materialName: item?.materialName ?? order.title,
        materialDetails: item ? {
          quantity: item.quantity,
          widthMm: item.widthMm,
          heightMm: item.heightMm,
          sides: item.sides,
        } : null,
        artworkPath: cfg.artworkPath ?? "upload_now",
        fileCount: files.length,
        events: publicEvents,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Public quote endpoint — runs the pricing engine. Used by the public
  // configurator on every input change. Does NOT create an order; only
  // returns the price breakdown. Server-side so the engine can never be
  // bypassed by the client.
  app.post("/api/print/quote", async (req, res) => {
    try {
      const { materialSlug, config } = req.body;
      if (!materialSlug || !config) return res.status(400).json({ message: "materialSlug + config required" });
      const material = await storage.getPrintMaterialBySlug(materialSlug);
      if (!material || !material.isActive) return res.status(404).json({ message: "Material not found" });
      const { quotePrintItem, quoteOrderTotals } = await import("./print-pricing");
      const itemQuote = quotePrintItem(material, config);
      if (!itemQuote.ok) {
        return res.json({ ok: false, reason: itemQuote.reason, message: itemQuote.message });
      }
      const totals = quoteOrderTotals([itemQuote.subtotalCents]);
      res.json({
        ok: true,
        item: itemQuote,
        totals,
        material: { name: material.name, slug: material.slug, turnaroundDays: itemQuote.turnaroundDays },
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/admin/print-analytics", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const orders = await storage.getPrintOrdersByOrg(orgId);
      const projects = await storage.getPrintProjectsByOrg(orgId);
      const contacts = await storage.getPrintContactsByOrg(orgId);

      const inProductionStatuses = new Set([
        "paid", "artwork_pending", "in_design", "in_proof", "proof_approved",
        "in_production", "finishing", "confirmed",
      ]);
      const finishedStatuses = new Set(["ready", "delivered"]);
      const paidStatuses = new Set([
        "paid", "in_design", "in_proof", "proof_approved", "in_production",
        "finishing", "ready", "delivered",
      ]);

      const now = Date.now();
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

      const ordersThisWeek = orders.filter(o => o.createdAt && new Date(o.createdAt).getTime() > weekAgo);
      const ordersThisMonth = orders.filter(o => o.createdAt && new Date(o.createdAt).getTime() > monthAgo);
      const paidOrders = orders.filter(o => paidStatuses.has(o.status));

      const revenueThisWeek = ordersThisWeek.filter(o => paidStatuses.has(o.status))
        .reduce((s, o) => s + (o.totalCents ?? 0), 0);
      const revenueThisMonth = ordersThisMonth.filter(o => paidStatuses.has(o.status))
        .reduce((s, o) => s + (o.totalCents ?? 0), 0);
      const revenueAllTime = paidOrders.reduce((s, o) => s + (o.totalCents ?? 0), 0);

      // Margin: estimated_cost on items vs subtotal (pre-GST)
      const allItems = (await Promise.all(paidOrders.map(o => storage.getPrintOrderItems(o.id)))).flat();
      const estimatedCost = allItems.reduce((s, it) => s + (it.estimatedCostCents ?? 0), 0);
      const revenuePreGst = paidOrders.reduce((s, o) => s + (o.subtotalCents ?? 0), 0);
      const grossMarginPct = revenuePreGst > 0
        ? Math.round(((revenuePreGst - estimatedCost) / revenuePreGst) * 100)
        : 0;

      const statusCounts: Record<string, number> = {};
      orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });

      const inProduction = orders.filter(o => inProductionStatuses.has(o.status)).length;
      const overdue = orders.filter(o => {
        if (finishedStatuses.has(o.status) || o.status === "cancelled") return false;
        if (!o.pickupReadyDate) return false;
        return new Date(o.pickupReadyDate + "T00:00:00").getTime() < now;
      }).length;

      // Top materials this month
      const monthItems = (await Promise.all(
        ordersThisMonth.filter(o => paidStatuses.has(o.status)).map(o => storage.getPrintOrderItems(o.id))
      )).flat();
      const materialRevenue: Record<string, number> = {};
      monthItems.forEach(it => {
        materialRevenue[it.materialName] = (materialRevenue[it.materialName] || 0) + (it.subtotalCents ?? 0);
      });
      const topMaterials = Object.entries(materialRevenue)
        .map(([name, cents]) => ({ name, cents }))
        .sort((a, b) => b.cents - a.cents)
        .slice(0, 5);

      const projectStatusCounts: Record<string, number> = {};
      projects.forEach(p => { projectStatusCounts[p.status] = (projectStatusCounts[p.status] || 0) + 1; });

      res.json({
        totalOrders: orders.length,
        totalProjects: projects.length,
        totalContacts: contacts.length,
        ordersByStatus: statusCounts,
        projectsByStatus: projectStatusCounts,
        ordersThisWeek: ordersThisWeek.length,
        ordersThisMonth: ordersThisMonth.length,
        revenueThisWeekCents: revenueThisWeek,
        revenueThisMonthCents: revenueThisMonth,
        revenueAllTimeCents: revenueAllTime,
        grossMarginPct,
        inProduction,
        overdue,
        topMaterials,
        recentOrders: orders.slice(0, 8),
        // Legacy field for back-compat with the old dashboard
        totalRevenue: revenueAllTime / 100,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Refund a paid order. Stripe refund + cancel the order. Doesn't credit
  // the Xero invoice automatically — Dima can do that in Xero with the
  // invoice already linked.
  app.post("/api/admin/print-orders/:id/refund", requireAuth, async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const reason = (req.body?.reason as string) || "requested_by_customer";
      const allOrders = await storage.getPrintOrdersByOrg(8);
      const order = allOrders.find(o => o.id === orderId);
      if (!order) return res.status(404).json({ message: "Not found" });
      if (!order.stripePaymentIntentId) return res.status(400).json({ message: "No Stripe payment to refund" });
      if (order.status === "cancelled") return res.status(400).json({ message: "Already cancelled" });

      const { stripe } = await import("./stripe");
      const refund = await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        reason: reason as any,
        metadata: { printOrderId: String(order.id), orderNumber: order.orderNumber || "" },
      });

      await storage.updatePrintOrder(orderId, { status: "cancelled" } as any);
      await storage.createPrintOrderEvent({
        orderId,
        eventType: "refunded",
        notes: `Stripe refund ${refund.id} (${reason})`,
        metadataJson: { stripeRefundId: refund.id, amountCents: refund.amount, reason },
        createdBy: req.session.userId,
      } as any);

      res.json({ ok: true, stripeRefundId: refund.id, amountCents: refund.amount });
    } catch (e: any) {
      console.error("[Refund] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // CSV export — Dima's accountant runs this monthly to reconcile against
  // Xero / Stripe. Optional from/to query params for a date range.
  app.get("/api/admin/print-orders/export.csv", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const orders = await storage.getPrintOrdersByOrg(orgId);
      const filtered = orders.filter(o => {
        if (!o.createdAt) return false;
        const t = new Date(o.createdAt).getTime();
        if (from && t < new Date(from).getTime()) return false;
        if (to && t > new Date(to).getTime()) return false;
        return true;
      });

      const escape = (v: any) => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["Order #", "Date", "Customer", "Email", "Phone", "Title", "Status", "Subtotal", "GST", "Total", "Paid", "Stripe PI"];
      const rows = filtered.map(o => [
        o.orderNumber || `#${o.id}`,
        o.createdAt ? new Date(o.createdAt).toISOString().split("T")[0] : "",
        o.customerName,
        o.customerEmail || "",
        o.customerPhone || "",
        o.title,
        o.status,
        ((o.subtotalCents ?? 0) / 100).toFixed(2),
        ((o.gstCents ?? 0) / 100).toFixed(2),
        ((o.totalCents ?? 0) / 100).toFixed(2),
        ((o.paidCents ?? 0) / 100).toFixed(2),
        o.stripePaymentIntentId || "",
      ].map(escape).join(","));
      const csv = [header.join(","), ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="united-prints-orders-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csv);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── PUBLIC LEAGUE API (Mini Football Leagues mobile app) ──────────────────
  // No auth required — fixtures/standings/results are public data so the app
  // works for fans + parents + curious onlookers. Locked to MFL org (id=3) for
  // safety so this can't accidentally expose other workspaces.
  const MFL_ORG_ID = 3;

  app.get("/api/public/league/competitions", async (req, res) => {
    try {
      const orgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : MFL_ORG_ID;
      const rows = await db.select().from(leagueCompetitions)
        .where(eq(leagueCompetitions.organizationId, orgId))
        .orderBy(desc(leagueCompetitions.startDate));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/public/league/competitions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [comp] = await db.select().from(leagueCompetitions).where(eq(leagueCompetitions.id, id));
      if (!comp) return res.status(404).json({ message: "Not found" });
      const divisions = await db.select().from(leagueDivisions)
        .where(eq(leagueDivisions.competitionId, id))
        .orderBy(asc(leagueDivisions.sortOrder), asc(leagueDivisions.name));
      const teams = await db.select().from(leagueTeams).where(eq(leagueTeams.competitionId, id));
      res.json({ ...comp, divisions, teams });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/public/league/competitions/:id/games", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const filters: any[] = [eq(leagueGames.competitionId, id)];
      if (req.query.divisionId) filters.push(eq(leagueGames.divisionId, parseInt(req.query.divisionId as string)));
      if (req.query.teamId) {
        const teamId = parseInt(req.query.teamId as string);
        const all = await db.select().from(leagueGames).where(and(...filters)).orderBy(asc(leagueGames.gameDate), asc(leagueGames.startTime));
        return res.json(all.filter(g => g.homeTeamId === teamId || g.awayTeamId === teamId));
      }
      const rows = await db.select().from(leagueGames)
        .where(and(...filters))
        .orderBy(asc(leagueGames.gameDate), asc(leagueGames.startTime));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Standings — computed from completed games (status = 'final').
  // 3 pts win, 1 pt draw. Returns ladder per division.
  app.get("/api/public/league/competitions/:id/standings", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const teams = await db.select().from(leagueTeams).where(eq(leagueTeams.competitionId, id));
      const games = await db.select().from(leagueGames)
        .where(and(eq(leagueGames.competitionId, id), eq(leagueGames.status, "final")));
      type Row = { teamId: number; teamName: string; divisionId: number | null; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; gd: number; pts: number };
      const map = new Map<number, Row>();
      for (const t of teams) map.set(t.id, { teamId: t.id, teamName: t.name, divisionId: t.divisionId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
      for (const g of games) {
        if (g.homeTeamId == null || g.awayTeamId == null) continue;
        const home = map.get(g.homeTeamId);
        const away = map.get(g.awayTeamId);
        if (!home || !away) continue;
        const hs = (g as any).homeScore ?? 0;
        const as = (g as any).awayScore ?? 0;
        home.played++; away.played++;
        home.gf += hs; home.ga += as;
        away.gf += as; away.ga += hs;
        if (hs > as)      { home.won++; home.pts += 3; away.lost++; }
        else if (hs < as) { away.won++; away.pts += 3; home.lost++; }
        else              { home.drawn++; home.pts += 1; away.drawn++; away.pts += 1; }
      }
      const standings = Array.from(map.values()).map(r => ({ ...r, gd: r.gf - r.ga }))
        .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.teamName.localeCompare(b.teamName));
      res.json(standings);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Single game with both teams attached — used by the referee scoring
  // screen and the fixtures-detail tap-through.
  app.get("/api/public/league/games/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [game] = await db.select().from(leagueGames).where(eq(leagueGames.id, id));
      if (!game) return res.status(404).json({ message: "Not found" });
      const teamIds = [game.homeTeamId, game.awayTeamId].filter((x): x is number => x != null);
      const teams = teamIds.length > 0
        ? await db.select().from(leagueTeams).where(inArray(leagueTeams.id, teamIds))
        : [];
      const byId = new Map(teams.map(t => [t.id, t]));
      res.json({
        ...game,
        homeTeam: game.homeTeamId ? byId.get(game.homeTeamId) ?? null : null,
        awayTeam: game.awayTeamId ? byId.get(game.awayTeamId) ?? null : null,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/public/league/teams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [team] = await db.select().from(leagueTeams).where(eq(leagueTeams.id, id));
      if (!team) return res.status(404).json({ message: "Not found" });
      // Don't leak contact info publicly — strip from response
      const { contactEmail, contactPhone, ...safe } = team as any;
      res.json(safe);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/public/league/announcements", async (req, res) => {
    try {
      const orgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : MFL_ORG_ID;
      const rows = await db.select().from(leagueAnnouncements)
        .where(eq(leagueAnnouncements.organizationId, orgId))
        .orderBy(desc(leagueAnnouncements.pinned), desc(leagueAnnouncements.publishedAt))
        .limit(50);
      const now = new Date();
      const live = rows.filter(r => !r.expiresAt || new Date(r.expiresAt) > now);
      res.json(live);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Score submission by an assigned referee. Auth-gated + checks the
  // requester is the assigned ref before accepting the score.
  app.post("/api/league/games/:id/score", requireAuth, async (req, res) => {
    try {
      const gameId = parseInt(req.params.id);
      const userId = req.session.userId!;
      const [assignment] = await db.select().from(leagueGameReferees)
        .where(and(eq(leagueGameReferees.gameId, gameId), eq(leagueGameReferees.userId, userId)));
      if (!assignment) {
        // Fall back to admin role check for in-house scoring
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
        if (!user || !["super_admin", "admin", "referee"].includes(user.role)) {
          return res.status(403).json({ message: "Not assigned to this game" });
        }
      }
      const homeScore = parseInt(req.body?.homeScore);
      const awayScore = parseInt(req.body?.awayScore);
      if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
        return res.status(400).json({ message: "homeScore + awayScore required (non-negative integers)" });
      }
      const status = req.body?.status || "final";
      const [updated] = await db.update(leagueGames)
        .set({ homeScore, awayScore, status } as any)
        .where(eq(leagueGames.id, gameId))
        .returning();
      res.json(updated);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  // Admin-only announcement composer endpoint. The MFL app's admin tab posts
  // here; same role check as the score endpoint's admin fallback.
  app.post("/api/league/announcements", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user || !["super_admin", "admin"].includes(user.role)) {
        return res.status(403).json({ message: "Admin role required" });
      }
      const title = String(req.body?.title ?? "").trim();
      const body = String(req.body?.body ?? "").trim();
      if (!title || !body) return res.status(400).json({ message: "title + body required" });
      const orgId = req.body?.organizationId ? parseInt(req.body.organizationId) : MFL_ORG_ID;
      const pinned = req.body?.pinned === true;
      const ctaLabel = req.body?.ctaLabel ? String(req.body.ctaLabel).slice(0, 80) : null;
      const ctaUrl = req.body?.ctaUrl ? String(req.body.ctaUrl).slice(0, 500) : null;
      const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
      const [row] = await db.insert(leagueAnnouncements).values({
        organizationId: orgId,
        title: title.slice(0, 200),
        body: body.slice(0, 4000),
        pinned,
        ctaLabel,
        ctaUrl,
        expiresAt,
        publishedAt: new Date(),
        createdBy: userId,
      } as any).returning();
      res.status(201).json(row);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // The user's "what's my involvement" payload — drives the home tab and
  // the referee mode. Ref assignments are joined with their game so the
  // client can render kickoff time, location, and home/away team names
  // without a second round-trip per game.
  app.get("/api/league/me", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const memberships = await db.select().from(leagueTeamMembers).where(eq(leagueTeamMembers.userId, userId));
      const teamIds = Array.from(new Set(memberships.map(m => m.teamId)));
      const teams = teamIds.length > 0
        ? await db.select().from(leagueTeams).where(inArray(leagueTeams.id, teamIds))
        : [];

      const refRows = await db.select().from(leagueGameReferees).where(eq(leagueGameReferees.userId, userId));
      let refAssignments: any[] = [];
      if (refRows.length > 0) {
        const gameIds = Array.from(new Set(refRows.map(r => r.gameId)));
        const games = await db.select().from(leagueGames).where(inArray(leagueGames.id, gameIds));
        const gameTeamIds = Array.from(new Set(games.flatMap(g => [g.homeTeamId, g.awayTeamId].filter((x): x is number => x != null))));
        const refTeams = gameTeamIds.length > 0
          ? await db.select().from(leagueTeams).where(inArray(leagueTeams.id, gameTeamIds))
          : [];
        const teamById = new Map(refTeams.map(t => [t.id, t]));
        const gameById = new Map(games.map(g => [g.id, g]));
        refAssignments = refRows.map(r => {
          const g = gameById.get(r.gameId);
          if (!g) return { ...r };
          return {
            id: r.id,
            gameId: g.id,
            competitionId: g.competitionId,
            divisionId: g.divisionId,
            gameNumber: g.gameNumber,
            gameDate: g.gameDate,
            startTime: g.startTime,
            endTime: g.endTime,
            location: g.location,
            surface: g.surface,
            status: g.status,
            homeScore: g.homeScore,
            awayScore: g.awayScore,
            homeTeam: g.homeTeamId ? teamById.get(g.homeTeamId) ?? null : null,
            awayTeam: g.awayTeamId ? teamById.get(g.awayTeamId) ?? null : null,
          };
        });
        // Upcoming first, then by date.
        refAssignments.sort((a, b) => {
          const ka = `${a.gameDate ?? "9999"}${a.startTime ?? ""}`;
          const kb = `${b.gameDate ?? "9999"}${b.startTime ?? ""}`;
          return ka.localeCompare(kb);
        });
      }

      res.json({ memberships, teams, refAssignments });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  return httpServer;
}

// Friendly memorable temp password — adjective-noun-NNN. Same format used
// in the AddMemberModal client-side; duplicated here so the server can
// generate fresh ones on reset/resend.
function generateTempPassword(): string {
  const adj = ["bright", "swift", "calm", "happy", "lucky", "kind", "bold", "warm"];
  const noun = ["fox", "owl", "wave", "hill", "tree", "lake", "cloud", "stone"];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${adj[Math.floor(Math.random() * adj.length)]}-${noun[Math.floor(Math.random() * noun.length)]}-${num}`;
}

// Welcome / invite email. Sent from a verified Resend domain (cufc.co.nz)
// — the previous unitedprints.co.nz sender silently failed because the
// domain isn't set up for outbound mail in Resend.
async function sendTeamInviteEmail(params: {
  email: string;
  firstName: string;
  password: string;
  orgNames: string[];
}): Promise<boolean> {
  const { sendEmail } = await import("./email");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px;border-radius:16px 16px 0 0;text-align:center;color:#fff">
        <h1 style="margin:0;font-size:22px">Welcome to ClubOS</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px">Christchurch United Football Club</p>
      </div>
      <div style="background:#f8fafc;padding:32px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px">
        <p style="font-size:16px;margin:0 0 16px">Hi ${params.firstName},</p>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px">
          You've been given access to ClubOS — the system Christchurch United uses to run its operations.
        </p>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 0 20px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Login</td><td style="padding:6px 0;text-align:right"><a href="https://app.usg.co.nz" style="color:#2563eb">app.usg.co.nz</a></td></tr>
            <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Email</td><td style="padding:6px 0;text-align:right;font-family:monospace">${params.email}</td></tr>
            <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Temp password</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600">${params.password}</td></tr>
          </table>
        </div>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px">
          You'll have access to: <strong>${params.orgNames.length > 0 ? params.orgNames.join(", ") : "(no workspaces yet — ask Daniel)"}</strong>
        </p>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0">
          Please change your password after your first login. If anything looks off, reply to this email.
        </p>
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:11px;margin:16px 0 0">Christchurch United Football Club Inc.</p>
    </div>
  `;
  return sendEmail({
    to: params.email,
    from: "ClubOS <noreply@cufc.co.nz>",
    replyTo: "info@cufc.co.nz",
    subject: "Your ClubOS login",
    html,
  });
}

// Password-reset email. Same shell, different framing.
async function sendPasswordResetEmail(params: {
  email: string;
  firstName: string;
  password: string;
  orgNames: string[];
}): Promise<boolean> {
  const { sendEmail } = await import("./email");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px;border-radius:16px 16px 0 0;text-align:center;color:#fff">
        <h1 style="margin:0;font-size:22px">Your ClubOS password was reset</h1>
      </div>
      <div style="background:#f8fafc;padding:32px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px">
        <p style="font-size:16px;margin:0 0 16px">Hi ${params.firstName},</p>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px">
          A super admin reset your password. Use the new credentials below to log in.
        </p>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 0 20px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Login</td><td style="padding:6px 0;text-align:right"><a href="https://app.usg.co.nz" style="color:#2563eb">app.usg.co.nz</a></td></tr>
            <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Email</td><td style="padding:6px 0;text-align:right;font-family:monospace">${params.email}</td></tr>
            <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">New password</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600">${params.password}</td></tr>
          </table>
        </div>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0">
          If you didn't expect this, reply immediately and we'll lock the account.
        </p>
      </div>
    </div>
  `;
  return sendEmail({
    to: params.email,
    from: "ClubOS <noreply@cufc.co.nz>",
    replyTo: "info@cufc.co.nz",
    subject: "Your ClubOS password was reset",
    html,
  });
}

async function handlePrintPaymentSuccess(orderId: number, paymentIntentId: string) {
  const order = await storage.getPrintOrder ? await (storage as any).getPrintOrder(orderId) : null;
  // Fall back to direct DB lookup if no helper exists yet
  let printOrder = order;
  if (!printOrder) {
    const allOrders = await storage.getPrintOrdersByOrg(8);
    printOrder = allOrders.find(o => o.id === orderId);
  }
  if (!printOrder) {
    console.warn(`[Print payment] Order ${orderId} not found`);
    return;
  }
  if (printOrder.status === "paid") return;  // already handled

  // Determine the next status: if customer chose to upload artwork later or
  // needs design help, go to artwork_pending. Otherwise straight to paid +
  // wait for them to upload.
  const items = await storage.getPrintOrderItems(orderId);
  const cfg = (items[0]?.configJson as any) ?? {};
  const artworkPath = cfg.artworkPath ?? "upload_now";
  const nextStatus = "paid";

  await storage.updatePrintOrder(orderId, {
    status: nextStatus,
    paidCents: printOrder.totalCents,
    stripePaymentIntentId: paymentIntentId,
  } as any);

  await storage.createPrintOrderEvent({
    orderId,
    eventType: "paid",
    notes: `Payment received via Stripe (${paymentIntentId})`,
    metadataJson: { paymentIntentId, amountCents: printOrder.totalCents },
  } as any);

  // Fire confirmation emails (fire-and-forget)
  try {
    const { emailOrderPlaced, emailDimaNewOrder } = await import("./print-email");
    const updatedOrder = { ...printOrder, status: nextStatus, paidCents: printOrder.totalCents };
    await emailOrderPlaced(updatedOrder, items[0], artworkPath);
    await emailDimaNewOrder(updatedOrder, items[0]);
  } catch (e) {
    console.error("[Print payment] email send failed:", e);
  }

  // Auto-push to Xero if connected (fire-and-forget — don't fail payment
  // flow if Xero is down or unconnected).
  try {
    const { getOrgIntegration, pushPaidOrderToXero } = await import("./xero");
    const xeroConn = await getOrgIntegration(printOrder.organizationId, "xero");
    if (xeroConn?.isActive) {
      const updatedOrder = { ...printOrder, status: "paid" as const, paidCents: printOrder.totalCents, stripePaymentIntentId: paymentIntentId };
      const result = await pushPaidOrderToXero(updatedOrder as any, items);
      await storage.createPrintOrderEvent({
        orderId,
        eventType: "xero_pushed",
        notes: `Auto-pushed to Xero on payment (invoice ${result.invoiceNumber})`,
        metadataJson: result,
      } as any);
      console.log(`[Print payment] Auto-pushed order ${orderId} to Xero as ${result.invoiceNumber}`);
    }
  } catch (e: any) {
    console.error("[Print payment] Xero push failed (order remains paid in our system):", e.message);
    // Log the failure on the order so Dima can retry manually
    try {
      await storage.createPrintOrderEvent({
        orderId,
        eventType: "xero_push_failed",
        notes: `Xero auto-push failed: ${e.message}. Manual retry available from order detail.`,
        metadataJson: { error: e.message },
      } as any);
    } catch {}
  }
}

async function handlePaymentSuccess(registrationId: number, stripeSessionId?: string, metadata?: Record<string, string>) {
  const reg = await storage.getRegistration(registrationId);
  if (!reg || reg.status === "confirmed") return;

  await storage.updateRegistration(registrationId, {
    status: "confirmed",
    amountPaid: ((reg.totalCents ?? 0) / 100).toFixed(2),
  });
  await storage.assignOrderNumber(registrationId);

  if ((reg as any).discountId && reg.discountCents && reg.discountCents > 0) {
    await storage.incrementDiscountUsage((reg as any).discountId, reg.discountCents);
  }

  // Class registrations have a different shape from camp registrations.
  // For camps the contact is the guardian and items list each day they
  // bought; for classes the contact is the child directly and there are
  // no day items (they're enrolled for the whole term).
  const isClassReg = metadata?.registrationType === "class";
  if (isClassReg) {
    const program = await storage.getProgram(reg.programId);
    const child = await storage.getContact(reg.contactId);
    const guardian = reg.guardianId ? await storage.getContact(reg.guardianId) : null;
    if (program && guardian && guardian.email) {
      try {
        const { sendEmail } = await import("./email");
        await sendEmail({
          to: guardian.email,
          from: "ClubOS <noreply@cufc.co.nz>",
          replyTo: "info@cufc.co.nz",
          subject: `${program.name} — registration confirmed`,
          html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111">
            <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px;border-radius:16px 16px 0 0;text-align:center;color:#fff">
              <h1 style="margin:0;font-size:22px">You're in!</h1>
              <p style="margin:6px 0 0;opacity:.85;font-size:14px">${program.name}</p>
            </div>
            <div style="background:#f8fafc;padding:32px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px">
              <p style="font-size:16px;margin:0 0 16px">Hi ${guardian.firstName},</p>
              <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px">
                ${child?.firstName ?? "Your child"} is registered for ${program.name}.
              </p>
              <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 0 20px">
                <table style="width:100%;border-collapse:collapse">
                  <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Order #</td><td style="padding:6px 0;text-align:right;font-family:monospace">${reg.orderNumber ?? registrationId}</td></tr>
                  <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Total paid</td><td style="padding:6px 0;text-align:right;font-weight:600">$${((reg.totalCents ?? 0) / 100).toFixed(2)} NZD</td></tr>
                  <tr><td style="color:#94a3b8;font-size:12px;text-transform:uppercase;padding:6px 0">Child</td><td style="padding:6px 0;text-align:right">${child?.firstName} ${child?.lastName}</td></tr>
                </table>
              </div>
              <p style="font-size:14px;line-height:1.6;color:#475569;margin:0">
                We'll be in touch with the first session details. Reply to this email if anything's wrong.
              </p>
            </div>
          </div>`,
          registrationId,
          campId: program.id,
        });
      } catch (e: any) {
        console.error("[Class confirmation email] failed:", e.message);
      }
    }
    return;
  }

  // Legacy camp path below — registrationItems-driven.
  const contact = await storage.getContact(reg.contactId);
  const program = await storage.getProgram(reg.programId);
  const items = await storage.getRegistrationItems(registrationId);

  if (!contact || !program) return;

  const childIds = [...new Set(items.map(i => i.childId))];
  const childrenNames: string[] = [];
  for (const childId of childIds) {
    const child = await storage.getChild(childId);
    if (child) childrenNames.push(`${child.firstName} ${child.lastName}`);
  }

  const dates = await storage.getCampDates(program.id);
  const dateLabels = dates.map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }));

  sendConfirmationEmail({
    registrationId,
    campId: program.id,
    parentEmail: contact.email || "",
    parentName: `${contact.firstName} ${contact.lastName}`,
    childrenNames,
    campName: program.name,
    campDates: dateLabels.join(", "),
    location: program.location || "TBD",
    totalPaid: `$${((reg.totalCents || 0) / 100).toFixed(2)} NZD`,
  }).catch(e => console.error("[Post-payment] Email error:", e));

  const eventId = `purchase_${registrationId}_${Date.now()}`;
  sendPurchaseEvent({
    registrationId,
    campId: program.id,
    totalCents: reg.totalCents || 0,
    currency: reg.currency || "NZD",
    email: contact.email || "",
    phone: contact.phone || undefined,
    firstName: contact.firstName,
    lastName: contact.lastName,
    fbp: metadata?.fbp || undefined,
    fbc: metadata?.fbc || undefined,
    userAgent: metadata?.userAgent || undefined,
    ipAddress: undefined,
    eventId,
  }).catch(e => console.error("[Post-payment] Meta CAPI error:", e));
}
