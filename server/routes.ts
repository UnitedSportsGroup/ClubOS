import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertProgramSchema, insertRegistrationSchema, insertRelationshipSchema } from "@shared/schema";

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

  app.get("/api/audit-logs", async (_req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
