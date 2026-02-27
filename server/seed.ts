import { db } from "./db";
import { contacts, programs, registrations, contactRelationships, auditLogs } from "@shared/schema";
import { sql } from "drizzle-orm";

export async function seedDatabase() {
  const [existing] = await db.select({ count: sql<number>`count(*)` }).from(contacts);
  if (Number(existing.count) > 0) return;

  console.log("Seeding database with demo data...");

  const [guardian1] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Ram",
    lastName: "Neupane",
    email: "rambo367@gmail.com",
    phone: "021 184 2879",
    alternatePhone: "020 406 382 87",
    address: "42 Riccarton Road, Christchurch 8041",
    newsletterConsent: true,
  }).returning();

  const [guardian2] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Sarah",
    lastName: "Patterson",
    email: "kezarchdesign@gmail.com",
    phone: "027 451 6664",
    address: "15 Fendalton Road, Christchurch 8052",
    newsletterConsent: true,
  }).returning();

  const [guardian3] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Fabinho",
    lastName: "Huertas",
    email: "fabinhohuertas@gmail.com",
    phone: "02904318840",
    address: "88 Colombo Street, Christchurch 8011",
    newsletterConsent: true,
  }).returning();

  const [player1] = await db.insert(contacts).values({
    type: "player",
    firstName: "Aarav",
    lastName: "Neupane",
    gender: "male",
    dateOfBirth: "2019-11-09",
    school: "Riccarton Primary",
    schoolYear: "2",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "Ram Neupane",
    emergencyPhone: "021 184 2879",
    phone: "021 184 2879",
  }).returning();

  const [player2] = await db.insert(contacts).values({
    type: "player",
    firstName: "Archer",
    lastName: "Patterson",
    gender: "male",
    dateOfBirth: "2018-03-22",
    school: "Fendalton Primary",
    schoolYear: "3",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "Sarah Patterson",
    emergencyPhone: "027 451 6664",
    phone: "027 451 6664",
    email: "kezarchdesign@gmail.com",
  }).returning();

  const [player3] = await db.insert(contacts).values({
    type: "player",
    firstName: "Benjamin",
    lastName: "Huertas Porto",
    gender: "male",
    dateOfBirth: "2017-06-15",
    school: "St Albans School",
    schoolYear: "4",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "Fabinho Huertas",
    emergencyPhone: "02904318840",
    phone: "02904318840",
    email: "fabinhohuertas@gmail.com",
    previousClub: "Nomads United AFC",
  }).returning();

  const [player4] = await db.insert(contacts).values({
    type: "player",
    firstName: "Abbas",
    lastName: "Ahmadi",
    gender: "male",
    dateOfBirth: "2019-01-14",
    phone: "0273249366",
    photoConsent: true,
    medicalConsent: true,
  }).returning();

  const [player5] = await db.insert(contacts).values({
    type: "player",
    firstName: "Aiden",
    lastName: "Eum",
    gender: "male",
    dateOfBirth: "2018-08-30",
    phone: "0210569432",
    email: "helen84j@hotmail.com",
    school: "Burnside Primary",
    schoolYear: "3",
    photoConsent: true,
    medicalConsent: true,
  }).returning();

  await db.insert(contacts).values({
    type: "staff",
    firstName: "Zachary",
    lastName: "Bennett",
    email: "zach@cufc.co.nz",
    phone: "021 555 1234",
    notes: "Head coach - FUNdamentals programme",
  });

  await db.insert(contacts).values({
    type: "volunteer",
    firstName: "Cameron",
    lastName: "Pearce",
    email: "cameron@gmail.com",
    phone: "027 555 9876",
    notes: "Weekend volunteer coach",
  });

  await db.insert(contactRelationships).values([
    { guardianId: guardian1.id, playerId: player1.id, relationship: "father", isPrimaryContact: true },
    { guardianId: guardian2.id, playerId: player2.id, relationship: "mother", isPrimaryContact: true },
    { guardianId: guardian3.id, playerId: player3.id, relationship: "father", isPrimaryContact: true },
  ]);

  const [prog1] = await db.insert(programs).values({
    name: "U4-8 FUNino Fun Football",
    type: "academy",
    description: "Our introductory programme to the beautiful game. Our unique programme can't be found in any other club in New Zealand or Australia. Monday-Friday 4:30pm-5:15pm, Saturday sessions available.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-04-30",
    capacity: 200,
    ageMin: 4,
    ageMax: 8,
    fee: "160.00",
    isActive: true,
  }).returning();

  const [prog2] = await db.insert(programs).values({
    name: "FUNdamentals Holiday Camp Test",
    type: "holiday_camp",
    description: "Holiday camp programme for ages 3-8. Morning and afternoon sessions available.",
    location: "CFC",
    startDate: "2026-04-06",
    endDate: "2026-04-17",
    capacity: 200,
    ageMin: 3,
    ageMax: 8,
    fee: "50.00",
    isActive: true,
  }).returning();

  const [prog3] = await db.insert(programs).values({
    name: "Technification: U9-U10 Mondays",
    type: "academy",
    description: "Advanced skills development for U9-U10 players. Monday sessions.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-06-30",
    capacity: 30,
    ageMin: 9,
    ageMax: 10,
    fee: "180.00",
    isActive: true,
  }).returning();

  await db.insert(programs).values({
    name: "Open Trainings: 4-8 Years",
    type: "event",
    description: "Open training sessions for young players aged 4-8.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-06-30",
    ageMin: 4,
    ageMax: 8,
    isActive: true,
  });

  await db.insert(registrations).values([
    { programId: prog1.id, contactId: player1.id, guardianId: guardian1.id, status: "confirmed", amountPaid: "160.00" },
    { programId: prog1.id, contactId: player2.id, guardianId: guardian2.id, status: "confirmed", amountPaid: "160.00" },
    { programId: prog1.id, contactId: player3.id, guardianId: guardian3.id, status: "confirmed", amountPaid: "160.00" },
    { programId: prog1.id, contactId: player4.id, status: "confirmed", amountPaid: "160.00" },
    { programId: prog1.id, contactId: player5.id, status: "pending", amountPaid: "0" },
    { programId: prog2.id, contactId: player1.id, guardianId: guardian1.id, status: "confirmed", amountPaid: "50.00" },
    { programId: prog2.id, contactId: player3.id, guardianId: guardian3.id, status: "pending", amountPaid: "0" },
  ]);

  await db.insert(auditLogs).values([
    { action: "create", entity: "program", entityId: prog1.id, details: "Created programme: U4-8 FUNino Fun Football" },
    { action: "create", entity: "program", entityId: prog2.id, details: "Created programme: FUNdamentals Holiday Camp Test" },
    { action: "create", entity: "contact", entityId: player1.id, details: "Created player: Aarav Neupane" },
    { action: "create", entity: "contact", entityId: guardian1.id, details: "Created guardian: Ram Neupane" },
    { action: "create", entity: "registration", entityId: 1, details: "Registration for U4-8 FUNino Fun Football" },
  ]);

  console.log("Database seeded successfully.");
}
