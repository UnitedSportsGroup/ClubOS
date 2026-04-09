import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertProgramSchema, insertRegistrationSchema, emailCampaigns, analyticsEvents, splitTests, splitTestVariants, apiKeys, customDomains, organizations, programs as programsTable } from "@shared/schema";
import { db } from "./db";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireSuperAdmin, verifyPassword, hashPassword } from "./auth";
import { createPaymentIntent, retrievePaymentIntent, constructWebhookEvent } from "./stripe";
import { sendPurchaseEvent } from "./meta-capi";
import { sendConfirmationEmail } from "./email";
import crypto from "crypto";

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
      const data = { ...req.body, type: "holiday_camp" };
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

  app.get("/api/admin/venue/facilities", requireAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.query.orgId as string);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
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
      const facility = await storage.createFacility(req.body);
      res.json(facility);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/venue/facilities/:id", requireAuth, async (req, res) => {
    try {
      const facility = await storage.updateFacility(parseInt(req.params.id), req.body);
      if (!facility) return res.status(404).json({ message: "Not found" });
      res.json(facility);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/facilities/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteFacility(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/admin/venue/facilities/:id/pricing", requireAuth, async (req, res) => {
    try {
      const rules = await storage.getFacilityPricingRules(parseInt(req.params.id));
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/venue/facilities/:id/pricing", requireAuth, async (req, res) => {
    try {
      const rule = await storage.createFacilityPricingRule({ ...req.body, facilityId: parseInt(req.params.id) });
      res.json(rule);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/pricing/:id", requireAuth, async (req, res) => {
    try {
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
      const bookings = await storage.getFacilityBookings(orgId);
      res.json(bookings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/venue/bookings", requireAuth, async (req, res) => {
    try {
      const booking = await storage.createFacilityBooking(req.body);
      res.json(booking);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/venue/bookings/:id", requireAuth, async (req, res) => {
    try {
      const booking = await storage.updateFacilityBooking(parseInt(req.params.id), req.body);
      if (!booking) return res.status(404).json({ message: "Not found" });
      res.json(booking);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/bookings/:id", requireAuth, async (req, res) => {
    try {
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
      const addons = await storage.getFacilityAddons(orgId);
      res.json(addons);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/venue/addons", requireAuth, async (req, res) => {
    try {
      const addon = await storage.createFacilityAddon(req.body);
      res.json(addon);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/admin/venue/addons/:id", requireAuth, async (req, res) => {
    try {
      const addon = await storage.updateFacilityAddon(parseInt(req.params.id), req.body);
      if (!addon) return res.status(404).json({ message: "Not found" });
      res.json(addon);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/admin/venue/addons/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteFacilityAddon(parseInt(req.params.id));
      res.json({ ok: true });
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
      const numGroups = groups.length;
      if (numGroups >= 2) {
        const knockoutPairs: { homePlace: string; awayPlace: string; stage: string; stageDetail: string }[] = [];
        if (numGroups === 4) {
          knockoutPairs.push(
            { homePlace: "A1", awayPlace: "B2", stage: "knockout", stageDetail: "QF 1 CUP" },
            { homePlace: "B1", awayPlace: "A2", stage: "knockout", stageDetail: "QF 2 CUP" },
            { homePlace: "C1", awayPlace: "D2", stage: "knockout", stageDetail: "QF 3 CUP" },
            { homePlace: "D1", awayPlace: "C2", stage: "knockout", stageDetail: "QF 4 CUP" },
            { homePlace: "A3", awayPlace: "B4", stage: "knockout", stageDetail: "QF 1 PLATE" },
            { homePlace: "B3", awayPlace: "A4", stage: "knockout", stageDetail: "QF 2 PLATE" },
            { homePlace: "C3", awayPlace: "D4", stage: "knockout", stageDetail: "QF 3 PLATE" },
            { homePlace: "D3", awayPlace: "C4", stage: "knockout", stageDetail: "QF 4 PLATE" },
          );
          knockoutPairs.push(
            { homePlace: "W QF1 CUP", awayPlace: "W QF4 CUP", stage: "knockout", stageDetail: "SF 1 CUP" },
            { homePlace: "W QF2 CUP", awayPlace: "W QF3 CUP", stage: "knockout", stageDetail: "SF 2 CUP" },
            { homePlace: "W QF1 PLATE", awayPlace: "W QF4 PLATE", stage: "knockout", stageDetail: "SF 1 PLATE" },
            { homePlace: "W QF2 PLATE", awayPlace: "W QF3 PLATE", stage: "knockout", stageDetail: "SF 2 PLATE" },
          );
          knockoutPairs.push(
            { homePlace: "L SF1 CUP", awayPlace: "L SF2 CUP", stage: "knockout", stageDetail: "3rd Place" },
            { homePlace: "W SF1 CUP", awayPlace: "W SF2 CUP", stage: "final", stageDetail: "CUP FINAL" },
            { homePlace: "L SF1 PLATE", awayPlace: "L SF2 PLATE", stage: "knockout", stageDetail: "PLATE 3rd" },
            { homePlace: "W SF1 PLATE", awayPlace: "W SF2 PLATE", stage: "final", stageDetail: "PLATE FINAL" },
          );
        } else if (numGroups === 2) {
          knockoutPairs.push(
            { homePlace: "A1", awayPlace: "B2", stage: "knockout", stageDetail: "SF 1" },
            { homePlace: "B1", awayPlace: "A2", stage: "knockout", stageDetail: "SF 2" },
            { homePlace: "L SF1", awayPlace: "L SF2", stage: "knockout", stageDetail: "3rd Place" },
            { homePlace: "W SF1", awayPlace: "W SF2", stage: "final", stageDetail: "FINAL" },
          );
        }
        for (const pair of knockoutPairs) {
          const g = await storage.createTournamentGame({
            tournamentId,
            groupId: null,
            homeTeamId: null,
            awayTeamId: null,
            homeTeamPlaceholder: pair.homePlace,
            awayTeamPlaceholder: pair.awayPlace,
            gameNumber: gameNumber++,
            roundNumber: null,
            stage: pair.stage,
            stageDetail: pair.stageDetail,
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
      res.json({ camp, pricing, dates, discounts, splitTests: activeSplitTests });
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

  return httpServer;
}

async function handlePaymentSuccess(registrationId: number, stripeSessionId?: string, metadata?: Record<string, string>) {
  const reg = await storage.getRegistration(registrationId);
  if (!reg || reg.status === "confirmed") return;

  await storage.updateRegistration(registrationId, {
    status: "confirmed",
  });
  await storage.assignOrderNumber(registrationId);

  if ((reg as any).discountId && reg.discountCents && reg.discountCents > 0) {
    await storage.incrementDiscountUsage((reg as any).discountId, reg.discountCents);
  }

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
