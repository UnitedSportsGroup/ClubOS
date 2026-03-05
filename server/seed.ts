import { db } from "./db";
import { users, contacts, programs, registrations, contactRelationships, auditLogs, settings, campPricing, campDates, campSettings, programDiscounts } from "@shared/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./auth";

export async function seedDatabase() {
  const [existingUsers] = await db.select({ count: sql<number>`count(*)` }).from(users);
  if (Number(existingUsers.count) === 0) {
    const hashedPw = await hashPassword(process.env.ADMIN_SEED_PASSWORD || "admin123");
    await db.insert(users).values({
      email: process.env.ADMIN_SEED_EMAIL || "admin@cufc.co.nz",
      firstName: "Daniel",
      lastName: "Admin",
      password: hashedPw,
      role: "admin",
      active: true,
    });
    console.log(`Admin user seeded: ${process.env.ADMIN_SEED_EMAIL || "admin@cufc.co.nz"}`);
  }

  const [existingSettings] = await db.select({ count: sql<number>`count(*)` }).from(settings);
  if (Number(existingSettings.count) === 0) {
    await db.insert(settings).values([
      { key: "club_name", value: "Christchurch United Football Club" },
      { key: "club_short_name", value: "CUFC" },
      { key: "club_email", value: "info@cufc.co.nz" },
      { key: "club_phone", value: "021 446 212" },
      { key: "club_website", value: "https://cufc.co.nz" },
      { key: "club_address", value: "Christchurch Football Centre, 250 Westminster Street, Christchurch 8011" },
      { key: "club_timezone", value: "Pacific/Auckland" },
    ]);
    console.log("Settings seeded.");
  }

  const [existingCamps] = await db.select({ count: sql<number>`count(*)` }).from(programs);
  if (Number(existingCamps.count) > 0) return;

  console.log("Seeding holiday camps...");

  const [camp1] = await db.insert(programs).values({
    name: "FUNdamentals Holiday Camp",
    slug: "fundamentals",
    type: "holiday_camp",
    description: "Our signature holiday camp for young players aged 3-8. Fun, engaging sessions focused on motor skills, ball mastery, and the love of football. Morning and afternoon sessions available, with full-day options including supervised lunch break.",
    location: "Christchurch Football Centre, 250 Westminster St",
    startDate: "2026-04-13",
    endDate: "2026-04-17",
    capacity: 60,
    ageMin: 3,
    ageMax: 8,
    isActive: true,
  }).returning();

  const [camp2] = await db.insert(programs).values({
    name: "World Cup Holiday Camp",
    slug: "world-cup",
    type: "holiday_camp",
    description: "An exciting World Cup-themed holiday camp for players aged 8-14. Teams represent different countries, competing in mini tournaments, skills challenges, and tactical sessions. Full immersion football experience.",
    location: "Christchurch Football Centre, 250 Westminster St",
    startDate: "2026-04-20",
    endDate: "2026-04-24",
    capacity: 40,
    ageMin: 8,
    ageMax: 14,
    isActive: true,
  }).returning();

  await db.insert(campPricing).values([
    { campId: camp1.id, productType: "FULL_DAY", priceCents: 7500, currency: "NZD" },
    { campId: camp1.id, productType: "MORNING", priceCents: 4500, currency: "NZD" },
    { campId: camp1.id, productType: "AFTERNOON", priceCents: 4500, currency: "NZD" },
    { campId: camp2.id, productType: "FULL_DAY", priceCents: 8500, currency: "NZD" },
    { campId: camp2.id, productType: "MORNING", priceCents: 5000, currency: "NZD" },
    { campId: camp2.id, productType: "AFTERNOON", priceCents: 5000, currency: "NZD" },
  ]);

  const camp1Dates = [];
  for (let d = 13; d <= 17; d++) {
    camp1Dates.push({ campId: camp1.id, date: `2026-04-${d}`, capacityFullDay: 30, capacityMorning: 30, capacityAfternoon: 30 });
  }
  await db.insert(campDates).values(camp1Dates);

  const camp2Dates = [];
  for (let d = 20; d <= 24; d++) {
    camp2Dates.push({ campId: camp2.id, date: `2026-04-${d}`, capacityFullDay: 20, capacityMorning: 20, capacityAfternoon: 20 });
  }
  await db.insert(campDates).values(camp2Dates);

  await db.insert(programDiscounts).values([
    { programId: camp1.id, minBookings: 4, discountPercent: "10.00" },
    { programId: camp1.id, minBookings: 8, discountPercent: "15.00" },
    { programId: camp2.id, minBookings: 4, discountPercent: "10.00" },
  ]);

  await db.insert(campSettings).values([
    {
      campId: camp1.id,
      confirmationEmailSubject: "Booking Confirmed - {{campName}}",
      confirmationEmailBody: "Hi {{parentName}},\n\nThank you for booking {{childrenList}} into {{campName}}.\n\nDates: {{campDates}}\nLocation: {{location}}\nTotal Paid: {{totalPaid}}\n\nWe look forward to seeing you there!\n\nCheers,\nChristchurch United FC",
      fromEmail: "info@cufc.co.nz",
      replyTo: "info@cufc.co.nz",
    },
    {
      campId: camp2.id,
      confirmationEmailSubject: "Booking Confirmed - {{campName}}",
      confirmationEmailBody: "Hi {{parentName}},\n\nThank you for booking {{childrenList}} into {{campName}}.\n\nDates: {{campDates}}\nLocation: {{location}}\nTotal Paid: {{totalPaid}}\n\nWe look forward to seeing you there!\n\nCheers,\nChristchurch United FC",
      fromEmail: "info@cufc.co.nz",
      replyTo: "info@cufc.co.nz",
    },
  ]);

  const [parent1] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Ram",
    lastName: "Neupane",
    email: "rambo367@gmail.com",
    phone: "021 184 2879",
    address: "42 Riccarton Road, Christchurch 8041",
    newsletterConsent: true,
  }).returning();

  const [parent2] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Sarah",
    lastName: "Patterson",
    email: "kezarchdesign@gmail.com",
    phone: "027 451 6664",
    address: "15 Fendalton Road, Christchurch 8052",
    newsletterConsent: true,
  }).returning();

  const [parent3] = await db.insert(contacts).values({
    type: "guardian",
    firstName: "Mike",
    lastName: "Chen",
    email: "mikechen@outlook.com",
    phone: "027 332 1188",
    address: "22 Papanui Road, Christchurch 8014",
    newsletterConsent: true,
  }).returning();

  await db.insert(auditLogs).values([
    { action: "create", entity: "camp", entityId: camp1.id, details: `Created camp: ${camp1.name}` },
    { action: "create", entity: "camp", entityId: camp2.id, details: `Created camp: ${camp2.name}` },
  ]);

  console.log("Holiday camps seeded successfully.");
}
