import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertProgramSchema, insertRegistrationSchema, emailCampaigns } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, verifyPassword } from "./auth";
import { createPaymentIntent, retrievePaymentIntent, constructWebhookEvent } from "./stripe";
import { sendPurchaseEvent } from "./meta-capi";
import { sendConfirmationEmail } from "./email";

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
    res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role });
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

      await storage.replaceRegistrationItems(regId, items.map((i: any) => ({
        registrationId: regId,
        childId: i.childId,
        campDateId: i.campDateId,
        productType: i.productType,
      })));

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

  app.get("/api/admin/audit-logs", requireAuth, async (_req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
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
      res.json({ camp, pricing, dates, discounts });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/public/book", async (req, res) => {
    try {
      const { parent, children: childrenData, items, campSlug, utmSource, utmMedium, utmCampaign, fbclid, fbp, fbc, userAgent } = req.body;

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
      const totalItems = registrationItems.length;
      const applicableDiscount = discounts
        .filter(d => totalItems >= d.minBookings)
        .sort((a, b) => Number(b.discountPercent) - Number(a.discountPercent))[0];
      if (applicableDiscount) {
        discountCents = Math.round(subtotalCents * Number(applicableDiscount.discountPercent) / 100);
      }

      const totalCents = subtotalCents - discountCents;

      const registration = await storage.createRegistration({
        programId: camp.id,
        contactId: parentContact.id,
        guardianId: parentContact.id,
        status: "pending",
        subtotalCents,
        discountCents,
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
          discountApplied: applicableDiscount ? `${applicableDiscount.discountPercent}%` : null,
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
          discountApplied: applicableDiscount ? `${applicableDiscount.discountPercent}%` : null,
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

  return httpServer;
}

async function handlePaymentSuccess(registrationId: number, stripeSessionId?: string, metadata?: Record<string, string>) {
  const reg = await storage.getRegistration(registrationId);
  if (!reg || reg.status === "confirmed") return;

  await storage.updateRegistration(registrationId, {
    status: "confirmed",
  });

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
