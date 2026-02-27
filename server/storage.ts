import { db } from "./db";
import { eq, desc, sql, and, ilike, or } from "drizzle-orm";
import {
  users, contacts, contactRelationships, programs,
  programSessions, registrations, auditLogs,
  type InsertUser, type User,
  type InsertContact, type Contact,
  type InsertRelationship, type ContactRelationship,
  type InsertProgram, type Program,
  type InsertSession, type ProgramSession,
  type InsertRegistration, type Registration,
  type InsertAuditLog, type AuditLog,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getContacts(): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: number, contact: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<void>;

  getRelationships(contactId: number): Promise<(ContactRelationship & { guardian?: Contact; player?: Contact })[]>;
  createRelationship(rel: InsertRelationship): Promise<ContactRelationship>;

  getPrograms(): Promise<Program[]>;
  getProgram(id: number): Promise<Program | undefined>;
  createProgram(program: InsertProgram): Promise<Program>;
  updateProgram(id: number, program: Partial<InsertProgram>): Promise<Program | undefined>;

  getRegistrations(): Promise<(Registration & { contact?: Contact; program?: Program })[]>;
  getRegistrationsByProgram(programId: number): Promise<(Registration & { contact?: Contact })[]>;
  createRegistration(reg: InsertRegistration): Promise<Registration>;

  getAuditLogs(): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;

  getStats(): Promise<{
    totalContacts: number;
    totalPlayers: number;
    totalGuardians: number;
    activePrograms: number;
    totalRegistrations: number;
    pendingRegistrations: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getContacts(): Promise<Contact[]> {
    return db.select().from(contacts).orderBy(contacts.firstName, contacts.lastName);
  }

  async getContact(id: number): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [created] = await db.insert(contacts).values(contact).returning();
    return created;
  }

  async updateContact(id: number, data: Partial<InsertContact>): Promise<Contact | undefined> {
    const [updated] = await db.update(contacts).set(data).where(eq(contacts.id, id)).returning();
    return updated;
  }

  async deleteContact(id: number): Promise<void> {
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  async getRelationships(contactId: number): Promise<(ContactRelationship & { guardian?: Contact; player?: Contact })[]> {
    const rels = await db
      .select()
      .from(contactRelationships)
      .where(
        or(
          eq(contactRelationships.guardianId, contactId),
          eq(contactRelationships.playerId, contactId)
        )
      );

    const enriched = await Promise.all(
      rels.map(async (rel) => {
        const [guardian] = await db.select().from(contacts).where(eq(contacts.id, rel.guardianId));
        const [player] = await db.select().from(contacts).where(eq(contacts.id, rel.playerId));
        return { ...rel, guardian, player };
      })
    );

    return enriched;
  }

  async createRelationship(rel: InsertRelationship): Promise<ContactRelationship> {
    const [created] = await db.insert(contactRelationships).values(rel).returning();
    return created;
  }

  async getPrograms(): Promise<Program[]> {
    return db.select().from(programs).orderBy(desc(programs.createdAt));
  }

  async getProgram(id: number): Promise<Program | undefined> {
    const [program] = await db.select().from(programs).where(eq(programs.id, id));
    return program;
  }

  async createProgram(program: InsertProgram): Promise<Program> {
    const [created] = await db.insert(programs).values(program).returning();
    return created;
  }

  async updateProgram(id: number, data: Partial<InsertProgram>): Promise<Program | undefined> {
    const [updated] = await db.update(programs).set(data).where(eq(programs.id, id)).returning();
    return updated;
  }

  async getRegistrations(): Promise<(Registration & { contact?: Contact; program?: Program })[]> {
    const regs = await db.select().from(registrations).orderBy(desc(registrations.registeredAt));
    const enriched = await Promise.all(
      regs.map(async (reg) => {
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, reg.contactId));
        const [program] = await db.select().from(programs).where(eq(programs.id, reg.programId));
        return { ...reg, contact, program };
      })
    );
    return enriched;
  }

  async getRegistrationsByProgram(programId: number): Promise<(Registration & { contact?: Contact })[]> {
    const regs = await db.select().from(registrations).where(eq(registrations.programId, programId));
    const enriched = await Promise.all(
      regs.map(async (reg) => {
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, reg.contactId));
        return { ...reg, contact };
      })
    );
    return enriched;
  }

  async createRegistration(reg: InsertRegistration): Promise<Registration> {
    const [created] = await db.insert(registrations).values(reg).returning();
    return created;
  }

  async getAuditLogs(): Promise<AuditLog[]> {
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200);
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }

  async getStats() {
    const [contactStats] = await db
      .select({
        total: sql<number>`count(*)`,
        players: sql<number>`count(*) filter (where ${contacts.type} = 'player')`,
        guardians: sql<number>`count(*) filter (where ${contacts.type} = 'guardian')`,
      })
      .from(contacts);

    const [programStats] = await db
      .select({
        active: sql<number>`count(*) filter (where ${programs.isActive} = true)`,
      })
      .from(programs);

    const [regStats] = await db
      .select({
        total: sql<number>`count(*)`,
        pending: sql<number>`count(*) filter (where ${registrations.status} = 'pending')`,
      })
      .from(registrations);

    return {
      totalContacts: Number(contactStats?.total ?? 0),
      totalPlayers: Number(contactStats?.players ?? 0),
      totalGuardians: Number(contactStats?.guardians ?? 0),
      activePrograms: Number(programStats?.active ?? 0),
      totalRegistrations: Number(regStats?.total ?? 0),
      pendingRegistrations: Number(regStats?.pending ?? 0),
    };
  }
}

export const storage = new DatabaseStorage();
