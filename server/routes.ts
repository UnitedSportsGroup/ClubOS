import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertProgramSchema, insertRegistrationSchema } from "@shared/schema";
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
        return { ...r, items };
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

  app.patch("/api/admin/attendance/:id", requireAuth, async (req, res) => {
    try {
      const record = await storage.updateAttendance(parseInt(req.params.id), req.body);
      if (!record) return res.status(404).json({ message: "Attendance record not found" });
      res.json(record);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
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
