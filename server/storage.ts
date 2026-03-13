import { db } from "./db";
import { eq, desc, sql, and, ilike, or, inArray, asc, isNull } from "drizzle-orm";
import {
  users, contacts, contactRelationships, programs,
  programSessions, registrations, auditLogs, settings,
  sessionBookings, programDiscounts,
  campPricing, campDates, campSettings,
  children, childMedical, registrationItems,
  attendance, emailLogs, metaEventLogs, emailCampaigns,
  type InsertUser, type User,
  type InsertContact, type Contact,
  type InsertRelationship, type ContactRelationship,
  type InsertProgram, type Program,
  type InsertSession, type ProgramSession,
  type InsertSessionBooking, type SessionBooking,
  type InsertDiscount, type ProgramDiscount,
  type InsertRegistration, type Registration,
  type InsertCampPricing, type CampPricing,
  type InsertCampDate, type CampDate,
  type InsertCampSettings, type CampSettings,
  type InsertChild, type Child,
  type InsertChildMedical, type ChildMedical,
  type InsertRegistrationItem, type RegistrationItem,
  type InsertAttendance, type Attendance,
  type InsertEmailLog, type EmailLog,
  type InsertMetaEventLog, type MetaEventLog,
  type InsertEmailCampaign, type EmailCampaign,
  type InsertAuditLog, type AuditLog,
  type Setting,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<void>;

  getContacts(): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  findContactByEmail(email: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: number, contact: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<void>;

  getRelationships(contactId: number): Promise<(ContactRelationship & { guardian?: Contact; player?: Contact })[]>;
  createRelationship(rel: InsertRelationship): Promise<ContactRelationship>;

  getPrograms(): Promise<Program[]>;
  getProgram(id: number): Promise<Program | undefined>;
  getProgramBySlug(slug: string): Promise<Program | undefined>;
  createProgram(program: InsertProgram): Promise<Program>;
  updateProgram(id: number, program: Partial<InsertProgram>): Promise<Program | undefined>;
  deleteProgram(id: number): Promise<void>;

  getSessionsByProgram(programId: number): Promise<ProgramSession[]>;
  getSession(id: number): Promise<ProgramSession | undefined>;
  createSession(session: InsertSession): Promise<ProgramSession>;
  createSessions(sessions: InsertSession[]): Promise<ProgramSession[]>;
  updateSession(id: number, data: Partial<InsertSession>): Promise<ProgramSession | undefined>;
  deleteSession(id: number): Promise<void>;
  deleteSessionsByProgramAndDate(programId: number, date: string): Promise<void>;

  getSessionBookings(sessionId: number): Promise<(SessionBooking & { contact?: Contact })[]>;
  getSessionBookingsByProgram(programId: number): Promise<(SessionBooking & { contact?: Contact; session?: ProgramSession })[]>;
  createSessionBooking(booking: InsertSessionBooking): Promise<SessionBooking>;
  createSessionBookings(bookings: InsertSessionBooking[]): Promise<SessionBooking[]>;
  updateSessionBooking(id: number, data: Partial<InsertSessionBooking>): Promise<SessionBooking | undefined>;
  deleteSessionBooking(id: number): Promise<void>;

  getProgramDiscounts(programId: number): Promise<ProgramDiscount[]>;
  setProgramDiscounts(programId: number, discounts: { minBookings: number; discountPercent: string }[]): Promise<ProgramDiscount[]>;

  getRegistrations(): Promise<(Registration & { contact?: Contact; program?: Program })[]>;
  getRegistrationsByProgram(programId: number): Promise<(Registration & { contact?: Contact })[]>;
  getRegistration(id: number): Promise<Registration | undefined>;
  createRegistration(reg: InsertRegistration): Promise<Registration>;
  updateRegistration(id: number, data: Partial<InsertRegistration>): Promise<Registration | undefined>;
  assignOrderNumber(id: number): Promise<number>;
  deleteRegistration(id: number): Promise<void>;

  getCampPricing(campId: number): Promise<CampPricing[]>;
  setCampPricing(campId: number, pricing: InsertCampPricing[]): Promise<CampPricing[]>;

  getCampDates(campId: number): Promise<CampDate[]>;
  getCampDate(id: number): Promise<CampDate | undefined>;
  createCampDate(d: InsertCampDate): Promise<CampDate>;
  updateCampDate(id: number, data: Partial<InsertCampDate>): Promise<CampDate | undefined>;
  deleteCampDate(id: number): Promise<void>;

  getCampSettings(campId: number): Promise<CampSettings | undefined>;
  upsertCampSettings(campId: number, data: Partial<InsertCampSettings>): Promise<CampSettings>;

  getSessionsSummary(campId: number): Promise<{ campDateId: number; date: string; productType: string; bookedCount: number; capacity: number }[]>;
  getCampRegistrationStats(campId: number): Promise<{ totalRegistrations: number; confirmedRegistrations: number; totalRevenueCents: number; totalSessions: number }>;
  getCampRegistrationCounts(): Promise<Record<number, number>>;
  getSessionRoll(campId: number, campDateId: number, sessionType: string): Promise<{ child: Child & { medical?: ChildMedical }; parent: Contact; attendance?: Attendance; productType: string }[]>;

  getAllChildren(): Promise<(Child & { medical?: ChildMedical })[]>;
  getChildren(parentId: number): Promise<(Child & { medical?: ChildMedical })[]>;
  getChild(id: number): Promise<Child | undefined>;
  createChild(c: InsertChild): Promise<Child>;
  updateChild(id: number, data: Partial<InsertChild>): Promise<Child | undefined>;

  getChildMedical(childId: number): Promise<ChildMedical | undefined>;
  upsertChildMedical(childId: number, data: Partial<InsertChildMedical>): Promise<ChildMedical>;

  getRegistrationItems(registrationId: number): Promise<(RegistrationItem & { child?: Child; campDate?: CampDate })[]>;
  createRegistrationItems(items: InsertRegistrationItem[]): Promise<RegistrationItem[]>;
  replaceRegistrationItems(registrationId: number, items: InsertRegistrationItem[]): Promise<RegistrationItem[]>;

  getAttendanceByDate(campId: number, campDateId: number): Promise<(Attendance & { child?: Child & { medical?: ChildMedical }; parent?: Contact })[]>;
  createAttendance(a: InsertAttendance): Promise<Attendance>;
  createAttendanceBulk(items: InsertAttendance[]): Promise<Attendance[]>;
  updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance | undefined>;
  deleteAttendanceIfUnused(campId: number, campDateId: number, childId: number): Promise<void>;

  createEmailLog(log: InsertEmailLog): Promise<EmailLog>;
  getEmailLogByRegistration(registrationId: number): Promise<EmailLog | undefined>;
  createMetaEventLog(log: InsertMetaEventLog): Promise<MetaEventLog>;

  getEmailCampaigns(): Promise<EmailCampaign[]>;
  getEmailCampaign(id: number): Promise<EmailCampaign | undefined>;
  createEmailCampaign(campaign: InsertEmailCampaign): Promise<EmailCampaign>;
  updateEmailCampaign(id: number, data: Partial<InsertEmailCampaign>): Promise<EmailCampaign | undefined>;

  getMailerSegmentEmails(segmentType: string, segmentConfig?: any): Promise<string[]>;

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

  getCampStats(): Promise<{
    totalParents: number;
    activeCamps: number;
    totalRegistrations: number;
    paidRegistrations: number;
    totalRevenueCents: number;
  }>;

  getSettings(): Promise<Record<string, string>>;
  getSetting(key: string): Promise<string | null>;
  upsertSettings(entries: { key: string; value: string }[]): Promise<void>;
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

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.firstName));
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getContacts(): Promise<Contact[]> {
    return db.select().from(contacts).orderBy(asc(contacts.firstName));
  }

  async getContact(id: number): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }

  async findContactByEmail(email: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.email, email));
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
    const rels = await db.select().from(contactRelationships)
      .where(or(eq(contactRelationships.guardianId, contactId), eq(contactRelationships.playerId, contactId)));

    const enriched = await Promise.all(rels.map(async (rel) => {
      const [guardian] = await db.select().from(contacts).where(eq(contacts.id, rel.guardianId));
      const [player] = await db.select().from(contacts).where(eq(contacts.id, rel.playerId));
      return { ...rel, guardian, player };
    }));

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

  async getProgramBySlug(slug: string): Promise<Program | undefined> {
    const [program] = await db.select().from(programs).where(eq(programs.slug, slug));
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

  async deleteProgram(id: number): Promise<void> {
    await db.execute(sql`DELETE FROM attendance WHERE camp_id = ${id}`);
    await db.execute(sql`DELETE FROM email_logs WHERE camp_id = ${id}`);
    await db.execute(sql`DELETE FROM meta_event_logs WHERE camp_id = ${id}`);
    await db.execute(sql`DELETE FROM session_bookings WHERE session_id IN (SELECT id FROM program_sessions WHERE program_id = ${id})`);
    await db.execute(sql`DELETE FROM registration_items WHERE registration_id IN (SELECT id FROM registrations WHERE program_id = ${id})`);
    await db.delete(registrations).where(eq(registrations.programId, id));
    await db.delete(programSessions).where(eq(programSessions.programId, id));
    await db.delete(programDiscounts).where(eq(programDiscounts.programId, id));
    await db.delete(programs).where(eq(programs.id, id));
  }

  async getSessionsByProgram(programId: number): Promise<ProgramSession[]> {
    return db.select().from(programSessions)
      .where(eq(programSessions.programId, programId))
      .orderBy(asc(programSessions.date), asc(programSessions.startTime));
  }

  async getSession(id: number): Promise<ProgramSession | undefined> {
    const [session] = await db.select().from(programSessions).where(eq(programSessions.id, id));
    return session;
  }

  async createSession(session: InsertSession): Promise<ProgramSession> {
    const [created] = await db.insert(programSessions).values(session).returning();
    return created;
  }

  async createSessions(sessions: InsertSession[]): Promise<ProgramSession[]> {
    if (sessions.length === 0) return [];
    return db.insert(programSessions).values(sessions).returning();
  }

  async updateSession(id: number, data: Partial<InsertSession>): Promise<ProgramSession | undefined> {
    const [updated] = await db.update(programSessions).set(data).where(eq(programSessions.id, id)).returning();
    return updated;
  }

  async deleteSession(id: number): Promise<void> {
    await db.delete(programSessions).where(eq(programSessions.id, id));
  }

  async deleteSessionsByProgramAndDate(programId: number, date: string): Promise<void> {
    await db.delete(programSessions)
      .where(and(eq(programSessions.programId, programId), eq(programSessions.date, date)));
  }

  async getSessionBookings(sessionId: number): Promise<(SessionBooking & { contact?: Contact })[]> {
    const bookings = await db.select().from(sessionBookings).where(eq(sessionBookings.sessionId, sessionId));
    return Promise.all(bookings.map(async (b) => {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, b.contactId));
      return { ...b, contact };
    }));
  }

  async getSessionBookingsByProgram(programId: number): Promise<(SessionBooking & { contact?: Contact; session?: ProgramSession })[]> {
    const sessions = await this.getSessionsByProgram(programId);
    const sessionIds = sessions.map(s => s.id);
    if (sessionIds.length === 0) return [];
    const bookings = await db.select().from(sessionBookings).where(inArray(sessionBookings.sessionId, sessionIds));
    return Promise.all(bookings.map(async (b) => {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, b.contactId));
      const session = sessions.find(s => s.id === b.sessionId);
      return { ...b, contact, session };
    }));
  }

  async createSessionBooking(booking: InsertSessionBooking): Promise<SessionBooking> {
    const [created] = await db.insert(sessionBookings).values(booking).returning();
    return created;
  }

  async createSessionBookings(bookings: InsertSessionBooking[]): Promise<SessionBooking[]> {
    if (bookings.length === 0) return [];
    return db.insert(sessionBookings).values(bookings).returning();
  }

  async updateSessionBooking(id: number, data: Partial<InsertSessionBooking>): Promise<SessionBooking | undefined> {
    const [updated] = await db.update(sessionBookings).set(data).where(eq(sessionBookings.id, id)).returning();
    return updated;
  }

  async deleteSessionBooking(id: number): Promise<void> {
    await db.delete(sessionBookings).where(eq(sessionBookings.id, id));
  }

  async getProgramDiscounts(programId: number): Promise<ProgramDiscount[]> {
    return db.select().from(programDiscounts)
      .where(eq(programDiscounts.programId, programId))
      .orderBy(asc(programDiscounts.minBookings));
  }

  async setProgramDiscounts(programId: number, discounts: { minBookings: number; discountPercent: string }[]): Promise<ProgramDiscount[]> {
    await db.delete(programDiscounts).where(eq(programDiscounts.programId, programId));
    if (discounts.length === 0) return [];
    return db.insert(programDiscounts).values(discounts.map(d => ({ ...d, programId }))).returning();
  }

  async getRegistrations(): Promise<(Registration & { contact?: Contact; program?: Program })[]> {
    const regs = await db.select().from(registrations).where(eq(registrations.status, "confirmed")).orderBy(desc(registrations.orderNumber), desc(registrations.registeredAt));
    return Promise.all(regs.map(async (r) => {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
      const [program] = await db.select().from(programs).where(eq(programs.id, r.programId));
      return { ...r, contact, program };
    }));
  }

  async getRegistrationsByProgram(programId: number): Promise<(Registration & { contact?: Contact })[]> {
    const regs = await db.select().from(registrations).where(and(eq(registrations.programId, programId), eq(registrations.status, "confirmed")));
    return Promise.all(regs.map(async (r) => {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
      return { ...r, contact };
    }));
  }

  async getRegistration(id: number): Promise<Registration | undefined> {
    const [reg] = await db.select().from(registrations).where(eq(registrations.id, id));
    return reg;
  }

  async createRegistration(reg: InsertRegistration): Promise<Registration> {
    const [created] = await db.insert(registrations).values(reg).returning();
    return created;
  }

  async updateRegistration(id: number, data: Partial<InsertRegistration>): Promise<Registration | undefined> {
    const [updated] = await db.update(registrations).set(data).where(eq(registrations.id, id)).returning();
    return updated;
  }

  async assignOrderNumber(id: number): Promise<number> {
    const result = await db.execute(sql`
      UPDATE registrations 
      SET order_number = (SELECT COALESCE(MAX(order_number), 0) + 1 FROM registrations)
      WHERE id = ${id} AND order_number IS NULL
      RETURNING order_number
    `);
    const rows = result.rows as any[];
    if (rows.length > 0) return rows[0].order_number;
    const [reg] = await db.select({ orderNumber: registrations.orderNumber }).from(registrations).where(eq(registrations.id, id));
    return reg?.orderNumber || 0;
  }

  async deleteRegistration(id: number): Promise<void> {
    await db.execute(sql`DELETE FROM email_logs WHERE registration_id = ${id}`);
    await db.execute(sql`DELETE FROM meta_event_logs WHERE registration_id = ${id}`);
    await db.execute(sql`DELETE FROM registration_items WHERE registration_id = ${id}`);
    await db.delete(registrations).where(eq(registrations.id, id));
  }

  async getCampPricing(campId: number): Promise<CampPricing[]> {
    return db.select().from(campPricing).where(eq(campPricing.campId, campId));
  }

  async setCampPricing(campId: number, pricing: InsertCampPricing[]): Promise<CampPricing[]> {
    await db.delete(campPricing).where(eq(campPricing.campId, campId));
    if (pricing.length === 0) return [];
    return db.insert(campPricing).values(pricing).returning();
  }

  async getCampDates(campId: number): Promise<CampDate[]> {
    return db.select().from(campDates).where(eq(campDates.campId, campId)).orderBy(asc(campDates.date));
  }

  async getCampDate(id: number): Promise<CampDate | undefined> {
    const [d] = await db.select().from(campDates).where(eq(campDates.id, id));
    return d;
  }

  async createCampDate(d: InsertCampDate): Promise<CampDate> {
    const [created] = await db.insert(campDates).values(d).returning();
    return created;
  }

  async updateCampDate(id: number, data: Partial<InsertCampDate>): Promise<CampDate | undefined> {
    const [updated] = await db.update(campDates).set(data).where(eq(campDates.id, id)).returning();
    return updated;
  }

  async deleteCampDate(id: number): Promise<void> {
    await db.execute(sql`DELETE FROM attendance WHERE camp_date_id = ${id}`);
    await db.execute(sql`DELETE FROM registration_items WHERE camp_date_id = ${id}`);
    await db.delete(campDates).where(eq(campDates.id, id));
  }

  async getCampSettings(campId: number): Promise<CampSettings | undefined> {
    const [s] = await db.select().from(campSettings).where(eq(campSettings.campId, campId));
    return s;
  }

  async upsertCampSettings(campId: number, data: Partial<InsertCampSettings>): Promise<CampSettings> {
    const existing = await this.getCampSettings(campId);
    if (existing) {
      const [updated] = await db.update(campSettings).set(data).where(eq(campSettings.campId, campId)).returning();
      return updated;
    }
    const [created] = await db.insert(campSettings).values({ ...data, campId }).returning();
    return created;
  }

  async getAllChildren(): Promise<(Child & { medical?: ChildMedical })[]> {
    const kids = await db.select().from(children).orderBy(asc(children.firstName), asc(children.lastName));
    return Promise.all(kids.map(async (c) => {
      const [med] = await db.select().from(childMedical).where(eq(childMedical.childId, c.id));
      return { ...c, medical: med || undefined };
    }));
  }

  async getChildren(parentId: number): Promise<(Child & { medical?: ChildMedical })[]> {
    const kids = await db.select().from(children).where(eq(children.parentId, parentId));
    return Promise.all(kids.map(async (c) => {
      const [med] = await db.select().from(childMedical).where(eq(childMedical.childId, c.id));
      return { ...c, medical: med || undefined };
    }));
  }

  async getChild(id: number): Promise<Child | undefined> {
    const [c] = await db.select().from(children).where(eq(children.id, id));
    return c;
  }

  async createChild(c: InsertChild): Promise<Child> {
    const [created] = await db.insert(children).values(c).returning();
    return created;
  }

  async updateChild(id: number, data: Partial<InsertChild>): Promise<Child | undefined> {
    const [updated] = await db.update(children).set(data).where(eq(children.id, id)).returning();
    return updated;
  }

  async getChildMedical(childId: number): Promise<ChildMedical | undefined> {
    const [med] = await db.select().from(childMedical).where(eq(childMedical.childId, childId));
    return med;
  }

  async upsertChildMedical(childId: number, data: Partial<InsertChildMedical>): Promise<ChildMedical> {
    const existing = await this.getChildMedical(childId);
    if (existing) {
      const [updated] = await db.update(childMedical).set(data).where(eq(childMedical.childId, childId)).returning();
      return updated;
    }
    const [created] = await db.insert(childMedical).values({ ...data, childId }).returning();
    return created;
  }

  async getSessionsSummary(campId: number): Promise<{ campDateId: number; date: string; productType: string; bookedCount: number; capacity: number }[]> {
    const dates = await this.getCampDates(campId);
    if (dates.length === 0) return [];

    const dateIds = dates.map(d => d.id);
    const items = await db.select({
      campDateId: registrationItems.campDateId,
      productType: registrationItems.productType,
      count: sql<number>`count(*)::int`,
    })
    .from(registrationItems)
    .innerJoin(registrations, eq(registrationItems.registrationId, registrations.id))
    .where(and(
      inArray(registrationItems.campDateId, dateIds),
      eq(registrations.programId, campId),
      eq(registrations.status, "confirmed"),
    ))
    .groupBy(registrationItems.campDateId, registrationItems.productType);

    const results: { campDateId: number; date: string; productType: string; bookedCount: number; capacity: number }[] = [];
    for (const d of dates) {
      const fullDayCount = items.find(i => i.campDateId === d.id && i.productType === "FULL_DAY")?.count || 0;
      for (const pt of ["MORNING", "AFTERNOON"]) {
        const match = items.find(i => i.campDateId === d.id && i.productType === pt);
        const cap = pt === "MORNING" ? (d.capacityMorning || 0) : (d.capacityAfternoon || 0);
        results.push({
          campDateId: d.id,
          date: d.date,
          productType: pt,
          bookedCount: (match?.count || 0) + fullDayCount,
          capacity: cap,
        });
      }
    }
    return results;
  }

  async getCampRegistrationStats(campId: number): Promise<{ totalRegistrations: number; confirmedRegistrations: number; totalRevenueCents: number; totalSessions: number }> {
    const regs = await db.select().from(registrations).where(eq(registrations.programId, campId));
    const totalRegistrations = regs.length;
    const confirmedRegistrations = regs.filter(r => r.status === "confirmed").length;
    const totalRevenueCents = regs.filter(r => r.status === "confirmed").reduce((sum, r) => sum + (r.totalCents || 0), 0);

    const dates = await this.getCampDates(campId);
    const dateIds = dates.map(d => d.id);
    let totalSessions = 0;
    if (dateIds.length > 0) {
      const [result] = await db.select({ count: sql<number>`count(*)::int` })
        .from(registrationItems)
        .innerJoin(registrations, eq(registrationItems.registrationId, registrations.id))
        .where(and(
          inArray(registrationItems.campDateId, dateIds),
          eq(registrations.programId, campId),
          eq(registrations.status, "confirmed"),
        ));
      totalSessions = result?.count || 0;
    }

    return { totalRegistrations, confirmedRegistrations, totalRevenueCents, totalSessions };
  }

  async getSessionRoll(campId: number, campDateId: number, sessionType: string): Promise<{ child: Child & { medical?: ChildMedical }; parent: Contact; attendance?: Attendance; productType: string }[]> {
    const productTypes = sessionType === "MORNING" ? ["MORNING", "FULL_DAY"] :
                         sessionType === "AFTERNOON" ? ["AFTERNOON", "FULL_DAY"] :
                         [sessionType];

    const items = await db.select()
      .from(registrationItems)
      .innerJoin(registrations, eq(registrationItems.registrationId, registrations.id))
      .where(and(
        eq(registrationItems.campDateId, campDateId),
        eq(registrations.programId, campId),
        eq(registrations.status, "confirmed"),
        inArray(registrationItems.productType, productTypes),
      ));

    const results: { child: Child & { medical?: ChildMedical }; parent: Contact; attendance?: Attendance; productType: string }[] = [];
    const seenChildIds = new Set<number>();

    for (const item of items) {
      const childId = item.registration_items.childId;
      if (seenChildIds.has(childId)) continue;
      seenChildIds.add(childId);

      const [child] = await db.select().from(children).where(eq(children.id, childId));
      if (!child) continue;

      const [parent] = await db.select().from(contacts).where(eq(contacts.id, child.parentId));
      const [med] = await db.select().from(childMedical).where(eq(childMedical.childId, childId));

      let attendanceRecords = await db.select().from(attendance)
        .where(and(
          eq(attendance.campId, campId),
          eq(attendance.campDateId, campDateId),
          eq(attendance.childId, childId),
        ));
      let att = attendanceRecords[0];

      if (!att) {
        try {
          const [created] = await db.insert(attendance).values({ campId, campDateId, childId }).returning();
          att = created;
        } catch (e) {
          // retry fetch in case of race condition
          const [existing] = await db.select().from(attendance).where(and(
            eq(attendance.campId, campId), eq(attendance.campDateId, campDateId), eq(attendance.childId, childId),
          ));
          att = existing;
        }
      }

      results.push({
        child: { ...child, medical: med || undefined },
        parent: parent!,
        attendance: att || undefined,
        productType: item.registration_items.productType,
      });
    }

    return results.sort((a, b) => a.child.lastName.localeCompare(b.child.lastName));
  }

  async getCampRegistrationCounts(): Promise<Record<number, number>> {
    const rows = await db.select({
      programId: registrations.programId,
      count: sql<number>`count(*)::int`,
    }).from(registrations)
      .where(eq(registrations.status, "confirmed"))
      .groupBy(registrations.programId);
    const result: Record<number, number> = {};
    for (const row of rows) {
      result[row.programId] = row.count;
    }
    return result;
  }

  async getRegistrationItems(registrationId: number): Promise<(RegistrationItem & { child?: Child; campDate?: CampDate })[]> {
    const items = await db.select().from(registrationItems).where(eq(registrationItems.registrationId, registrationId));
    return Promise.all(items.map(async (item) => {
      const [child] = await db.select().from(children).where(eq(children.id, item.childId));
      const [campDate] = await db.select().from(campDates).where(eq(campDates.id, item.campDateId));
      return { ...item, child, campDate };
    }));
  }

  async createRegistrationItems(items: InsertRegistrationItem[]): Promise<RegistrationItem[]> {
    if (items.length === 0) return [];
    return db.insert(registrationItems).values(items).returning();
  }

  async replaceRegistrationItems(registrationId: number, items: InsertRegistrationItem[]): Promise<RegistrationItem[]> {
    return db.transaction(async (tx) => {
      await tx.delete(registrationItems).where(eq(registrationItems.registrationId, registrationId));
      if (items.length === 0) return [];
      return tx.insert(registrationItems).values(items.map(i => ({ ...i, registrationId }))).returning();
    });
  }

  async getAttendanceByDate(campId: number, campDateId: number): Promise<(Attendance & { child?: Child & { medical?: ChildMedical }; parent?: Contact })[]> {
    const records = await db.select().from(attendance)
      .where(and(eq(attendance.campId, campId), eq(attendance.campDateId, campDateId)));

    return Promise.all(records.map(async (a) => {
      const [child] = await db.select().from(children).where(eq(children.id, a.childId));
      let parent: Contact | undefined;
      let med: ChildMedical | undefined;
      if (child) {
        const [p] = await db.select().from(contacts).where(eq(contacts.id, child.parentId));
        parent = p;
        const [m] = await db.select().from(childMedical).where(eq(childMedical.childId, child.id));
        med = m || undefined;
      }
      return { ...a, child: child ? { ...child, medical: med } : undefined, parent };
    }));
  }

  async createAttendance(a: InsertAttendance): Promise<Attendance> {
    const [created] = await db.insert(attendance).values(a).returning();
    return created;
  }

  async createAttendanceBulk(items: InsertAttendance[]): Promise<Attendance[]> {
    if (items.length === 0) return [];
    return db.insert(attendance).values(items).returning();
  }

  async deleteAttendanceIfUnused(campId: number, campDateId: number, childId: number): Promise<void> {
    await db.delete(attendance).where(and(
      eq(attendance.campId, campId),
      eq(attendance.campDateId, campDateId),
      eq(attendance.childId, childId),
      isNull(attendance.checkedInAt),
    ));
  }

  async updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance | undefined> {
    const [updated] = await db.update(attendance).set(data).where(eq(attendance.id, id)).returning();
    return updated;
  }

  async createEmailLog(log: InsertEmailLog): Promise<EmailLog> {
    const [created] = await db.insert(emailLogs).values(log).returning();
    return created;
  }

  async getEmailLogByRegistration(registrationId: number): Promise<EmailLog | undefined> {
    const [log] = await db.select().from(emailLogs).where(eq(emailLogs.registrationId, registrationId)).limit(1);
    return log;
  }

  async createMetaEventLog(log: InsertMetaEventLog): Promise<MetaEventLog> {
    const [created] = await db.insert(metaEventLogs).values(log).returning();
    return created;
  }

  async getAuditLogs(): Promise<AuditLog[]> {
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200);
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }

  async getStats(): Promise<{
    totalContacts: number;
    totalPlayers: number;
    totalGuardians: number;
    activePrograms: number;
    totalRegistrations: number;
    pendingRegistrations: number;
  }> {
    const [tc] = await db.select({ count: sql<number>`count(*)` }).from(contacts);
    const [tp] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.type, "player"));
    const [tg] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.type, "guardian"));
    const [ap] = await db.select({ count: sql<number>`count(*)` }).from(programs).where(eq(programs.isActive, true));
    const [tr] = await db.select({ count: sql<number>`count(*)` }).from(registrations);
    const [pr] = await db.select({ count: sql<number>`count(*)` }).from(registrations).where(eq(registrations.status, "pending"));
    return {
      totalContacts: Number(tc.count),
      totalPlayers: Number(tp.count),
      totalGuardians: Number(tg.count),
      activePrograms: Number(ap.count),
      totalRegistrations: Number(tr.count),
      pendingRegistrations: Number(pr.count),
    };
  }

  async getCampStats(): Promise<{
    totalParents: number;
    activeCamps: number;
    totalRegistrations: number;
    paidRegistrations: number;
    totalRevenueCents: number;
  }> {
    const [tp] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.type, "guardian"));
    const [ac] = await db.select({ count: sql<number>`count(*)` }).from(programs)
      .where(and(eq(programs.isActive, true), eq(programs.type, "holiday_camp")));
    const campIds = await db.select({ id: programs.id }).from(programs).where(eq(programs.type, "holiday_camp"));
    const ids = campIds.map(c => c.id);
    let totalRegs = 0, paidRegs = 0, totalRev = 0;
    if (ids.length > 0) {
      const [tr] = await db.select({ count: sql<number>`count(*)` }).from(registrations).where(inArray(registrations.programId, ids));
      const [pr] = await db.select({ count: sql<number>`count(*)` }).from(registrations)
        .where(and(inArray(registrations.programId, ids), eq(registrations.status, "confirmed")));
      const [rev] = await db.select({ total: sql<number>`COALESCE(SUM(total_cents), 0)` }).from(registrations)
        .where(and(inArray(registrations.programId, ids), eq(registrations.status, "confirmed")));
      totalRegs = Number(tr.count);
      paidRegs = Number(pr.count);
      totalRev = Number(rev.total);
    }
    return {
      totalParents: Number(tp.count),
      activeCamps: Number(ac.count),
      totalRegistrations: totalRegs,
      paidRegistrations: paidRegs,
      totalRevenueCents: totalRev,
    };
  }

  async getSettings(): Promise<Record<string, string>> {
    const rows = await db.select().from(settings);
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value ?? "";
    }
    return result;
  }

  async getSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(settings).where(eq(settings.key, key));
    return row?.value ?? null;
  }

  async upsertSettings(entries: { key: string; value: string }[]): Promise<void> {
    for (const entry of entries) {
      await db.insert(settings).values({ key: entry.key, value: entry.value })
        .onConflictDoUpdate({ target: settings.key, set: { value: entry.value, updatedAt: new Date() } });
    }
  }

  async getEmailCampaigns(): Promise<EmailCampaign[]> {
    return db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt));
  }

  async getEmailCampaign(id: number): Promise<EmailCampaign | undefined> {
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
    return row;
  }

  async createEmailCampaign(campaign: InsertEmailCampaign): Promise<EmailCampaign> {
    const [row] = await db.insert(emailCampaigns).values(campaign).returning();
    return row;
  }

  async updateEmailCampaign(id: number, data: Partial<InsertEmailCampaign>): Promise<EmailCampaign | undefined> {
    const [row] = await db.update(emailCampaigns).set(data).where(eq(emailCampaigns.id, id)).returning();
    return row;
  }

  async getMailerSegmentEmails(segmentType: string, segmentConfig?: any): Promise<string[]> {
    const config = segmentConfig ? (typeof segmentConfig === 'string' ? JSON.parse(segmentConfig) : segmentConfig) : {};

    if (segmentType === 'all') {
      const rows = await db.select({ email: contacts.email }).from(contacts)
        .where(and(eq(contacts.type, 'guardian'), sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`));
      return [...new Set(rows.map(r => r.email!).filter(Boolean))];
    }

    if (segmentType === 'camp' && config.campId) {
      const regs = await db.select({ contactId: registrations.contactId })
        .from(registrations)
        .where(and(eq(registrations.programId, config.campId), eq(registrations.status, 'confirmed')));
      const contactIds = [...new Set(regs.map(r => r.contactId))];
      if (!contactIds.length) return [];
      const rows = await db.select({ email: contacts.email }).from(contacts)
        .where(and(inArray(contacts.id, contactIds), sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`));
      return [...new Set(rows.map(r => r.email!).filter(Boolean))];
    }

    if (segmentType === 'day' && config.campId && config.campDateId) {
      const items = await db.select({ registrationId: registrationItems.registrationId })
        .from(registrationItems)
        .where(eq(registrationItems.campDateId, config.campDateId));
      const regIds = [...new Set(items.map(i => i.registrationId))];
      if (!regIds.length) return [];
      const regs = await db.select({ contactId: registrations.contactId })
        .from(registrations)
        .where(and(inArray(registrations.id, regIds), eq(registrations.status, 'confirmed')));
      const contactIds = [...new Set(regs.map(r => r.contactId))];
      if (!contactIds.length) return [];
      const rows = await db.select({ email: contacts.email }).from(contacts)
        .where(and(inArray(contacts.id, contactIds), sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`));
      return [...new Set(rows.map(r => r.email!).filter(Boolean))];
    }

    if (segmentType === 'session' && config.campId && config.campDateId && config.sessionType) {
      const normalizedType = config.sessionType.toUpperCase();
      const items = await db.select({ registrationId: registrationItems.registrationId })
        .from(registrationItems)
        .where(and(
          eq(registrationItems.campDateId, config.campDateId),
          eq(registrationItems.productType, normalizedType)
        ));
      const regIds = [...new Set(items.map(i => i.registrationId))];
      if (!regIds.length) return [];
      const regs = await db.select({ contactId: registrations.contactId })
        .from(registrations)
        .where(and(inArray(registrations.id, regIds), eq(registrations.status, 'confirmed')));
      const contactIds = [...new Set(regs.map(r => r.contactId))];
      if (!contactIds.length) return [];
      const rows = await db.select({ email: contacts.email }).from(contacts)
        .where(and(inArray(contacts.id, contactIds), sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`));
      return [...new Set(rows.map(r => r.email!).filter(Boolean))];
    }

    if (segmentType === 'custom' && config.emails) {
      return config.emails;
    }

    return [];
  }
}

export const storage = new DatabaseStorage();
