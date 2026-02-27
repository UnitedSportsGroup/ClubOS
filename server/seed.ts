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

  const [guardian4] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Mike",
    lastName: "Chen",
    email: "mikechen@outlook.com",
    phone: "027 332 1188",
    address: "22 Papanui Road, Christchurch 8014",
    newsletterConsent: true,
  }).returning();

  const [guardian5] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Lisa",
    lastName: "Walker",
    email: "lisa.walker@gmail.com",
    phone: "021 990 5543",
    address: "7 Bealey Avenue, Christchurch 8013",
    newsletterConsent: true,
  }).returning();

  const [guardian6] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "James",
    lastName: "Kato",
    email: "jameskato@yahoo.com",
    phone: "022 187 4412",
    address: "33 Marshland Road, Christchurch 8083",
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

  const [player6] = await db.insert(contacts).values({
    type: "player",
    firstName: "Lucas",
    lastName: "Chen",
    gender: "male",
    dateOfBirth: "2015-04-18",
    school: "Papanui Primary",
    schoolYear: "6",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "Mike Chen",
    emergencyPhone: "027 332 1188",
  }).returning();

  const [player7] = await db.insert(contacts).values({
    type: "player",
    firstName: "Mia",
    lastName: "Chen",
    gender: "female",
    dateOfBirth: "2016-09-22",
    school: "Papanui Primary",
    schoolYear: "5",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "Mike Chen",
    emergencyPhone: "027 332 1188",
  }).returning();

  const [player8] = await db.insert(contacts).values({
    type: "player",
    firstName: "Ethan",
    lastName: "Walker",
    gender: "male",
    dateOfBirth: "2014-02-11",
    school: "Christchurch Boys' High",
    schoolYear: "7",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "Lisa Walker",
    emergencyPhone: "021 990 5543",
    previousClub: "Cashmere Technical",
  }).returning();

  const [player9] = await db.insert(contacts).values({
    type: "player",
    firstName: "Sophie",
    lastName: "Walker",
    gender: "female",
    dateOfBirth: "2012-07-03",
    school: "Burnside High School",
    schoolYear: "9",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "Lisa Walker",
    emergencyPhone: "021 990 5543",
  }).returning();

  const [player10] = await db.insert(contacts).values({
    type: "player",
    firstName: "Kenji",
    lastName: "Kato",
    gender: "male",
    dateOfBirth: "2011-01-28",
    school: "Shirley Boys' High",
    schoolYear: "10",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "James Kato",
    emergencyPhone: "022 187 4412",
    previousClub: "Halswell United",
  }).returning();

  const [player11] = await db.insert(contacts).values({
    type: "player",
    firstName: "Riku",
    lastName: "Kato",
    gender: "male",
    dateOfBirth: "2013-05-15",
    school: "Shirley Intermediate",
    schoolYear: "8",
    photoConsent: true,
    medicalConsent: true,
    emergencyContact: "James Kato",
    emergencyPhone: "022 187 4412",
  }).returning();

  const [player12] = await db.insert(contacts).values({
    type: "player",
    firstName: "Olivia",
    lastName: "Brown",
    gender: "female",
    dateOfBirth: "2010-11-20",
    school: "Christchurch Girls' High",
    schoolYear: "11",
    photoConsent: true,
    medicalConsent: true,
  }).returning();

  const [player13] = await db.insert(contacts).values({
    type: "player",
    firstName: "Noah",
    lastName: "Singh",
    gender: "male",
    dateOfBirth: "2009-03-09",
    school: "St Andrew's College",
    schoolYear: "12",
    photoConsent: true,
    medicalConsent: true,
    previousClub: "Selwyn United",
  }).returning();

  const [player14] = await db.insert(contacts).values({
    type: "player",
    firstName: "Isla",
    lastName: "Thompson",
    gender: "female",
    dateOfBirth: "2007-08-14",
    school: "Christchurch Girls' High",
    schoolYear: "13",
    photoConsent: true,
    medicalConsent: true,
  }).returning();

  const [player15] = await db.insert(contacts).values({
    type: "player",
    firstName: "Liam",
    lastName: "O'Brien",
    gender: "male",
    dateOfBirth: "2015-12-01",
    school: "Heaton Normal",
    schoolYear: "6",
    photoConsent: true,
    medicalConsent: true,
  }).returning();

  const [player16] = await db.insert(contacts).values({
    type: "player",
    firstName: "Yuki",
    lastName: "Tanaka",
    gender: "female",
    dateOfBirth: "2016-06-25",
    school: "Fendalton Open Air School",
    schoolYear: "5",
    photoConsent: true,
    medicalConsent: true,
  }).returning();

  const [player17] = await db.insert(contacts).values({
    type: "player",
    firstName: "Marcus",
    lastName: "Williams",
    gender: "male",
    dateOfBirth: "2012-10-08",
    school: "Burnside High School",
    schoolYear: "9",
    photoConsent: true,
    medicalConsent: true,
    previousClub: "Ferrymead Bays",
  }).returning();

  const [player18] = await db.insert(contacts).values({
    type: "player",
    firstName: "Charlotte",
    lastName: "Davis",
    gender: "female",
    dateOfBirth: "2011-04-17",
    school: "Rangi Ruru Girls' School",
    schoolYear: "10",
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
    { guardianId: guardian4.id, playerId: player6.id, relationship: "father", isPrimaryContact: true },
    { guardianId: guardian4.id, playerId: player7.id, relationship: "father", isPrimaryContact: true },
    { guardianId: guardian5.id, playerId: player8.id, relationship: "mother", isPrimaryContact: true },
    { guardianId: guardian5.id, playerId: player9.id, relationship: "mother", isPrimaryContact: true },
    { guardianId: guardian6.id, playerId: player10.id, relationship: "father", isPrimaryContact: true },
    { guardianId: guardian6.id, playerId: player11.id, relationship: "father", isPrimaryContact: true },
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

  const [prog4] = await db.insert(programs).values({
    name: "Pre-Academy: U11-U12",
    type: "academy",
    description: "Pre-Academy development programme for U11-U12 players. Focus on technical skills, tactical awareness and game understanding.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-06-30",
    capacity: 40,
    ageMin: 11,
    ageMax: 12,
    fee: "220.00",
    isActive: true,
  }).returning();

  const [prog5] = await db.insert(programs).values({
    name: "Academy: U13",
    type: "academy",
    description: "Academy programme for U13 age group. Intensive training, match play and player development pathway.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-11-30",
    capacity: 22,
    ageMin: 13,
    ageMax: 13,
    fee: "350.00",
    isActive: true,
  }).returning();

  const [prog6] = await db.insert(programs).values({
    name: "Academy: U14",
    type: "academy",
    description: "Academy programme for U14 age group.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-11-30",
    capacity: 22,
    ageMin: 14,
    ageMax: 14,
    fee: "350.00",
    isActive: true,
  }).returning();

  const [prog7] = await db.insert(programs).values({
    name: "Academy: U15",
    type: "academy",
    description: "Academy programme for U15 age group.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-11-30",
    capacity: 22,
    ageMin: 15,
    ageMax: 15,
    fee: "350.00",
    isActive: true,
  }).returning();

  const [prog8] = await db.insert(programs).values({
    name: "Academy: U17",
    type: "academy",
    description: "Academy programme for U17 age group. Senior academy pathway.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-11-30",
    capacity: 22,
    ageMin: 16,
    ageMax: 17,
    fee: "400.00",
    isActive: true,
  }).returning();

  const [prog9] = await db.insert(programs).values({
    name: "Academy: U20",
    type: "academy",
    description: "Academy programme for U20 age group. Pathway to senior football.",
    location: "Christchurch Football Centre",
    startDate: "2026-02-01",
    endDate: "2026-11-30",
    capacity: 22,
    ageMin: 18,
    ageMax: 20,
    fee: "400.00",
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

    { programId: prog3.id, contactId: player6.id, guardianId: guardian4.id, status: "confirmed", amountPaid: "180.00" },
    { programId: prog3.id, contactId: player7.id, guardianId: guardian4.id, status: "confirmed", amountPaid: "180.00" },
    { programId: prog3.id, contactId: player15.id, status: "confirmed", amountPaid: "180.00" },
    { programId: prog3.id, contactId: player16.id, status: "pending", amountPaid: "0" },

    { programId: prog4.id, contactId: player8.id, guardianId: guardian5.id, status: "confirmed", amountPaid: "220.00" },
    { programId: prog4.id, contactId: player11.id, guardianId: guardian6.id, status: "confirmed", amountPaid: "220.00" },
    { programId: prog4.id, contactId: player15.id, status: "pending", amountPaid: "0" },

    { programId: prog5.id, contactId: player9.id, guardianId: guardian5.id, status: "confirmed", amountPaid: "350.00" },
    { programId: prog5.id, contactId: player11.id, guardianId: guardian6.id, status: "confirmed", amountPaid: "350.00" },
    { programId: prog5.id, contactId: player17.id, status: "confirmed", amountPaid: "350.00" },

    { programId: prog6.id, contactId: player10.id, guardianId: guardian6.id, status: "confirmed", amountPaid: "350.00" },
    { programId: prog6.id, contactId: player18.id, status: "confirmed", amountPaid: "350.00" },

    { programId: prog7.id, contactId: player12.id, status: "confirmed", amountPaid: "350.00" },
    { programId: prog7.id, contactId: player10.id, guardianId: guardian6.id, status: "pending", amountPaid: "0" },

    { programId: prog8.id, contactId: player13.id, status: "confirmed", amountPaid: "400.00" },
    { programId: prog8.id, contactId: player14.id, status: "confirmed", amountPaid: "400.00" },

    { programId: prog9.id, contactId: player14.id, status: "pending", amountPaid: "0" },
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
