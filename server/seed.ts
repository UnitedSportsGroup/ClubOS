import { db } from "./db";
import { users, contacts, programs, registrations, contactRelationships, auditLogs, settings, campPricing, campDates, campSettings, programDiscounts, organizations, userOrganizations, facilities } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { hashPassword } from "./auth";

export async function seedDatabase() {
  await db.execute(sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'super_admin' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'role_type')) THEN ALTER TYPE role_type ADD VALUE 'super_admin'; END IF; END $$`);
  await db.execute(sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'team_member' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'role_type')) THEN ALTER TYPE role_type ADD VALUE 'team_member'; END IF; END $$`);

  const [existingUsers] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const hashedPw = await hashPassword(process.env.ADMIN_SEED_PASSWORD || "Growth2020!");
  if (Number(existingUsers.count) === 0) {
    await db.insert(users).values({
      email: process.env.ADMIN_SEED_EMAIL || "daniel@cufc.co.nz",
      firstName: "Daniel",
      lastName: "Admin",
      password: hashedPw,
      role: "super_admin",
      active: true,
    });
    console.log(`Super Admin user seeded: ${process.env.ADMIN_SEED_EMAIL || "daniel@cufc.co.nz"}`);
  }

  await db.execute(sql`UPDATE users SET role = 'super_admin' WHERE email = 'daniel@cufc.co.nz'`);
  console.log("Daniel role set to super_admin");

  const staffAccounts = [
    { email: "grassroots@cufc.co.nz", firstName: "Grassroots", lastName: "Staff" },
    { email: "marketing@cufc.co.nz", firstName: "Marketing", lastName: "Staff" },
  ];
  for (const acct of staffAccounts) {
    const [exists] = await db.select({ count: sql<number>`count(*)` }).from(users).where(sql`email = ${acct.email}`);
    if (Number(exists.count) === 0) {
      await db.insert(users).values({
        email: acct.email,
        firstName: acct.firstName,
        lastName: acct.lastName,
        password: hashedPw,
        role: "admin",
        active: true,
      });
      console.log(`Staff user seeded: ${acct.email}`);
    } else {
      await db.execute(sql`UPDATE users SET password = ${hashedPw}, role = 'admin' WHERE email = ${acct.email}`);
      console.log(`Staff user password reset: ${acct.email}`);
    }
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

  await db.execute(sql`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS order_number integer`);
  await db.execute(sql`
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY registered_at ASC, id ASC) as rn
      FROM registrations
      WHERE status = 'confirmed' AND order_number IS NULL
    )
    UPDATE registrations SET order_number = numbered.rn + COALESCE((SELECT MAX(order_number) FROM registrations WHERE order_number IS NOT NULL), 0)
    FROM numbered WHERE registrations.id = numbered.id
  `);

  await seedOrganizations();

  const [existingCamps] = await db.select({ count: sql<number>`count(*)` }).from(programs);

  if (Number(existingCamps.count) > 0) {
    await db.execute(sql`UPDATE programs SET slug = 'fundamentals-camp' WHERE slug = 'fundamentals'`);
    return;
  }

  console.log("Seeding holiday camps...");

  const [camp1] = await db.insert(programs).values({
    name: "FUNdamentals Holiday Camp",
    slug: "fundamentals-camp",
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

export async function migrateScheduleData() {
  const newSchedule = [
    { time: "9:00 AM", label: "Drop Off & Welcome Games" },
    { time: "9:30 AM", label: "Skill Activities & Ball Mastery" },
    { time: "10:15 AM", label: "Fun Challenges & Small Games" },
    { time: "11:00 AM", label: "Match Play & Themed Games" },
    { time: "11:30 AM", label: "Morning Session Pick Up" },
    { time: "12:00 PM", label: "Afternoon Session Begins" },
    { time: "12:30 PM", label: "Skill Challenges & Competitions" },
    { time: "1:30 PM", label: "Team Games & Mini Tournaments" },
    { time: "2:30 PM", label: "Cool Down & Awards" },
    { time: "3:00 PM", label: "Full Day Pick Up" },
  ];
  const result = await db.execute(sql`
    UPDATE programs
    SET page_content_json = jsonb_set(
      page_content_json::jsonb,
      '{schedule}',
      ${JSON.stringify(newSchedule)}::jsonb
    )::text
    WHERE page_content_json IS NOT NULL
      AND page_content_json::jsonb->'schedule' @> '[{"time":"5:00 PM"}]'::jsonb
  `);
  console.log("Schedule migration: updated camps with old 5pm schedule");
}

async function seedOrganizations() {
  const orgData = [
    { name: "Christchurch United", slug: "christchurch-united", logoUrl: "/logos/christchurch-united.png" },
    { name: "South Island United", slug: "south-island-united", logoUrl: "/logos/south-island-united.png" },
    { name: "Mini Football Leagues", slug: "mini-football-leagues", logoUrl: "/logos/mini-football-leagues.png" },
    { name: "United Sports Centre", slug: "united-sports-centre", logoUrl: null },
    { name: "Christchurch International Cup", slug: "christchurch-international-cup", logoUrl: "/logos/christchurch-international-cup.png" },
  ];

  for (const org of orgData) {
    const [existing] = await db.select().from(organizations).where(eq(organizations.slug, org.slug));
    if (!existing) {
      await db.insert(organizations).values(org);
    }
  }

  const allOrgs = await db.select().from(organizations);
  const allUsers2 = await db.select().from(users);

  for (const u of allUsers2) {
    if (u.role === "super_admin") {
      for (const org of allOrgs) {
        const [existing] = await db.select().from(userOrganizations)
          .where(sql`user_id = ${u.id} AND organization_id = ${org.id}`);
        if (!existing) {
          await db.insert(userOrganizations).values({ userId: u.id, organizationId: org.id, role: "super_admin" });
        }
      }
    } else {
      const cuOrg = allOrgs.find(o => o.slug === "christchurch-united");
      if (cuOrg) {
        const [existing] = await db.select().from(userOrganizations)
          .where(sql`user_id = ${u.id} AND organization_id = ${cuOrg.id}`);
        if (!existing) {
          await db.insert(userOrganizations).values({ userId: u.id, organizationId: cuOrg.id, role: u.role });
        }
      }
    }
  }
  console.log("Organizations seeded");

  const uscOrg = allOrgs.find(o => o.slug === "united-sports-centre");
  if (uscOrg) {
    const [existingFacilities] = await db.select({ count: sql<number>`count(*)` }).from(facilities);
    if (Number(existingFacilities.count) === 0) {
      const facilityData = [
        { organizationId: uscOrg.id, name: "S1 (Field 1)", type: "field" as const, halfFull: true, floodlights: true },
        { organizationId: uscOrg.id, name: "S2 (Field 2)", type: "field" as const, halfFull: true, floodlights: true },
        { organizationId: uscOrg.id, name: "Mini Pitch 1", type: "mini_pitch" as const, floodlights: true },
        { organizationId: uscOrg.id, name: "Mini Pitch 2", type: "mini_pitch" as const, floodlights: true },
        { organizationId: uscOrg.id, name: "Meeting Room", type: "meeting_room" as const },
        { organizationId: uscOrg.id, name: "Changing Room 1", type: "changing_room" as const },
        { organizationId: uscOrg.id, name: "Changing Room 2", type: "changing_room" as const },
        { organizationId: uscOrg.id, name: "Changing Room 3", type: "changing_room" as const },
        { organizationId: uscOrg.id, name: "Futsal Court", type: "futsal" as const, floodlights: true },
      ];
      for (const f of facilityData) {
        await db.insert(facilities).values(f);
      }
      console.log("USC facilities seeded");
    }
  }
}
