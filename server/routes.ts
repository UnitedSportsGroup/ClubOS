import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertProgramSchema, insertRegistrationSchema, insertRelationshipSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/contacts", async (_req, res) => {
    try {
      const contacts = await storage.getContacts();
      res.json(contacts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/contacts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid contact ID" });
      const contact = await storage.getContact(id);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      res.json(contact);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/contacts/:id/relationships", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const relationships = await storage.getRelationships(id);
      res.json(relationships);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    try {
      const parsed = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(parsed);
      await storage.createAuditLog({
        action: "create",
        entity: "contact",
        entityId: contact.id,
        details: `Created ${contact.type}: ${contact.firstName} ${contact.lastName}`,
      });
      res.status(201).json(contact);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/contacts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const contact = await storage.updateContact(id, req.body);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      await storage.createAuditLog({
        action: "update",
        entity: "contact",
        entityId: contact.id,
        details: `Updated contact: ${contact.firstName} ${contact.lastName}`,
      });
      res.json(contact);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteContact(id);
      await storage.createAuditLog({
        action: "delete",
        entity: "contact",
        entityId: id,
        details: `Deleted contact ID ${id}`,
      });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/relationships", async (req, res) => {
    try {
      const parsed = insertRelationshipSchema.parse(req.body);
      const rel = await storage.createRelationship(parsed);
      res.status(201).json(rel);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/programs", async (_req, res) => {
    try {
      const programs = await storage.getPrograms();
      res.json(programs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/programs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const program = await storage.getProgram(id);
      if (!program) return res.status(404).json({ message: "Programme not found" });
      res.json(program);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/programs/:id/registrations", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const regs = await storage.getRegistrationsByProgram(id);
      res.json(regs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/programs", async (req, res) => {
    try {
      const parsed = insertProgramSchema.parse(req.body);
      const program = await storage.createProgram(parsed);
      await storage.createAuditLog({
        action: "create",
        entity: "program",
        entityId: program.id,
        details: `Created programme: ${program.name}`,
      });
      res.status(201).json(program);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/registrations", async (_req, res) => {
    try {
      const regs = await storage.getRegistrations();
      res.json(regs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/registrations", async (req, res) => {
    try {
      const parsed = insertRegistrationSchema.parse(req.body);
      const reg = await storage.createRegistration(parsed);
      await storage.createAuditLog({
        action: "create",
        entity: "registration",
        entityId: reg.id,
        details: `Registration for programme ${reg.programId}, contact ${reg.contactId}`,
      });
      res.status(201).json(reg);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      const allSettings = await storage.getSettings();
      res.json(allSettings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const entries = Object.entries(req.body).map(([key, value]) => ({
        key,
        value: String(value ?? ""),
      }));
      await storage.upsertSettings(entries);
      await storage.createAuditLog({
        action: "update",
        entity: "settings",
        details: `Updated settings: ${entries.map(e => e.key).join(", ")}`,
      });
      const updated = await storage.getSettings();
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/academy-stats", async (_req, res) => {
    try {
      const stats = await storage.getAcademyStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/audit-logs", async (_req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/programs/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const program = await storage.getProgramBySlug(slug);
      if (!program || !program.isActive) {
        return res.status(404).json({ message: "Programme not found" });
      }
      const allSettings = await storage.getSettings();
      res.json({
        program,
        club: {
          name: allSettings.club_name || "Christchurch United Football Club",
          shortName: allSettings.club_short_name || "CUFC",
          email: allSettings.club_email || "",
          phone: allSettings.club_phone || "",
          website: allSettings.club_website || "",
          fbPixelId: allSettings.tracking_fb_pixel_id || "",
          gadsConversionId: allSettings.tracking_gads_conversion_id || "",
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/public/programs", async (_req, res) => {
    try {
      const allPrograms = await storage.getPrograms();
      const active = allPrograms.filter((p) => p.isActive && p.slug);
      const allSettings = await storage.getSettings();
      res.json({
        programs: active.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          type: p.type,
          description: p.description,
          location: p.location,
          startDate: p.startDate,
          endDate: p.endDate,
          capacity: p.capacity,
          ageMin: p.ageMin,
          ageMax: p.ageMax,
          fee: p.fee,
        })),
        club: {
          name: allSettings.club_name || "Christchurch United Football Club",
          shortName: allSettings.club_short_name || "CUFC",
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const publicRegistrationSchema = z.object({
    programId: z.number(),
    playerFirstName: z.string().min(1),
    playerLastName: z.string().min(1),
    playerDateOfBirth: z.string().min(1),
    playerGender: z.enum(["male", "female", "other"]),
    guardianFirstName: z.string().min(1),
    guardianLastName: z.string().min(1),
    guardianEmail: z.string().email(),
    guardianPhone: z.string().min(1),
    address: z.string().optional(),
    school: z.string().optional(),
    medicalNotes: z.string().optional(),
    allergies: z.string().optional(),
    emergencyContact: z.string().optional(),
    emergencyPhone: z.string().optional(),
    photoConsent: z.boolean().default(false),
    medicalConsent: z.boolean().default(false),
    newsletterConsent: z.boolean().default(true),
    notes: z.string().optional(),
    source: z.string().optional(),
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional(),
    utmContent: z.string().optional(),
    fbclid: z.string().optional(),
    gclid: z.string().optional(),
  });

  app.post("/api/public/register", async (req, res) => {
    try {
      const parsed = publicRegistrationSchema.parse(req.body);

      const program = await storage.getProgram(parsed.programId);
      if (!program || !program.isActive) {
        return res.status(404).json({ message: "Programme not found or inactive" });
      }

      let guardian = await storage.findContactByEmail(parsed.guardianEmail);
      if (!guardian) {
        guardian = await storage.createContact({
          type: "guardian",
          firstName: parsed.guardianFirstName,
          lastName: parsed.guardianLastName,
          email: parsed.guardianEmail,
          phone: parsed.guardianPhone,
          address: parsed.address || null,
          newsletterConsent: parsed.newsletterConsent,
        });
      }

      const player = await storage.createContact({
        type: "player",
        firstName: parsed.playerFirstName,
        lastName: parsed.playerLastName,
        dateOfBirth: parsed.playerDateOfBirth,
        gender: parsed.playerGender,
        school: parsed.school || null,
        medicalNotes: parsed.medicalNotes || null,
        allergies: parsed.allergies || null,
        emergencyContact: parsed.emergencyContact || null,
        emergencyPhone: parsed.emergencyPhone || null,
        photoConsent: parsed.photoConsent,
        medicalConsent: parsed.medicalConsent,
      });

      await storage.createRelationship({
        guardianId: guardian.id,
        playerId: player.id,
        relationship: "parent",
        isPrimaryContact: true,
      });

      const registration = await storage.createRegistration({
        programId: parsed.programId,
        contactId: player.id,
        guardianId: guardian.id,
        status: "pending",
        notes: parsed.notes || null,
        source: parsed.source || "landing_page",
        utmSource: parsed.utmSource || null,
        utmMedium: parsed.utmMedium || null,
        utmCampaign: parsed.utmCampaign || null,
        utmContent: parsed.utmContent || null,
        fbclid: parsed.fbclid || null,
        gclid: parsed.gclid || null,
      });

      await storage.createAuditLog({
        action: "create",
        entity: "registration",
        entityId: registration.id,
        details: `Public registration: ${parsed.playerFirstName} ${parsed.playerLastName} for ${program.name} (source: ${parsed.source || "landing_page"})`,
      });

      res.status(201).json({
        success: true,
        registrationId: registration.id,
        message: "Registration successful",
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
