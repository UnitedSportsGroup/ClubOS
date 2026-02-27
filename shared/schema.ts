import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, date, decimal, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role_type", ["admin", "manager", "coach", "finance", "marketing", "registrar"]);
export const contactTypeEnum = pgEnum("contact_type", ["player", "guardian", "staff", "volunteer", "sponsor"]);
export const genderEnum = pgEnum("gender_type", ["male", "female", "other"]);
export const programTypeEnum = pgEnum("program_type", ["holiday_camp", "academy", "trials", "event"]);
export const registrationStatusEnum = pgEnum("registration_status", ["pending", "confirmed", "waitlisted", "cancelled", "refunded"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "paid", "overdue", "refunded"]);

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  password: text("password").notNull(),
  role: roleEnum("role").notNull().default("coach"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contacts = pgTable("contacts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  type: contactTypeEnum("type").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  alternatePhone: text("alternate_phone"),
  gender: genderEnum("gender"),
  dateOfBirth: date("date_of_birth"),
  address: text("address"),
  nationality: text("nationality"),
  school: text("school"),
  schoolYear: text("school_year"),
  medicalNotes: text("medical_notes"),
  allergies: text("allergies"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  photoConsent: boolean("photo_consent").default(false),
  medicalConsent: boolean("medical_consent").default(false),
  newsletterConsent: boolean("newsletter_consent").default(true),
  previousClub: text("previous_club"),
  teamName: text("team_name"),
  tags: text("tags"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contactRelationships = pgTable("contact_relationships", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  guardianId: integer("guardian_id").notNull().references(() => contacts.id),
  playerId: integer("player_id").notNull().references(() => contacts.id),
  relationship: text("relationship").notNull().default("parent"),
  isPrimaryContact: boolean("is_primary_contact").default(true),
});

export const programs = pgTable("programs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  type: programTypeEnum("type").notNull(),
  description: text("description"),
  location: text("location"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  capacity: integer("capacity"),
  ageMin: integer("age_min"),
  ageMax: integer("age_max"),
  fee: decimal("fee", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const programSessions = pgTable("program_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  programId: integer("program_id").notNull().references(() => programs.id),
  name: text("name").notNull(),
  date: date("date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  venue: text("venue"),
  capacity: integer("capacity"),
});

export const registrations = pgTable("registrations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  programId: integer("program_id").notNull().references(() => programs.id),
  contactId: integer("contact_id").notNull().references(() => contacts.id),
  guardianId: integer("guardian_id").references(() => contacts.id),
  status: registrationStatusEnum("status").notNull().default("pending"),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).default("0"),
  notes: text("notes"),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSettingSchema = createInsertSchema(settings).omit({ updatedAt: true });
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settings.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export const insertRelationshipSchema = createInsertSchema(contactRelationships).omit({ id: true });
export const insertProgramSchema = createInsertSchema(programs).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(programSessions).omit({ id: true });
export const insertRegistrationSchema = createInsertSchema(registrations).omit({ id: true, registeredAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertRelationship = z.infer<typeof insertRelationshipSchema>;
export type ContactRelationship = typeof contactRelationships.$inferSelect;
export type InsertProgram = z.infer<typeof insertProgramSchema>;
export type Program = typeof programs.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type ProgramSession = typeof programSessions.$inferSelect;
export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type Registration = typeof registrations.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
