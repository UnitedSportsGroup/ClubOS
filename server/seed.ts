import { db } from "./db";
import { users, contacts, programs, registrations, contactRelationships, auditLogs, settings, campPricing, campDates, campSettings, programDiscounts, organizations, userOrganizations, facilities, leagueCompetitions, leagueDivisions, leagueTeams, leagueGames, tournaments, tournamentGroups, tournamentTeams, analyticsEvents, calendarEvents } from "@shared/schema";
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
    { name: "United Gymnastics", slug: "united-gymnastics", logoUrl: "/logos/united-gymnastics.png" },
    { name: "United Sports Group", slug: "united-sports-group", logoUrl: "/logos/united-sports-group.png" },
    { name: "United Prints", slug: "united-prints", logoUrl: null },
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

  const usgOrg = allOrgs.find(o => o.slug === "united-sports-group");
  if (usgOrg) {
    const [existingCalEvents] = await db.select({ count: sql<number>`count(*)` }).from(calendarEvents).where(eq(calendarEvents.organizationId, usgOrg.id));
    if (Number(existingCalEvents.count) === 0) {
      const danielUser = await db.select().from(users).where(eq(users.email, "daniel@cufc.co.nz"));
      const createdBy = danielUser[0]?.id || 1;
      const oid = usgOrg.id;
      const calEvents = [
        { title: "New Year's Day", description: "Public Holiday", startTime: new Date("2026-01-01T00:00:00"), endTime: new Date("2026-01-01T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "SIU vs South Melbourne", description: "SIU Game", startTime: new Date("2026-01-01T14:00:00"), endTime: new Date("2026-01-01T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Day After New Year's Day", description: "Public Holiday", startTime: new Date("2026-01-02T00:00:00"), endTime: new Date("2026-01-02T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "SIU vs Birkenhead", description: "SIU Game", startTime: new Date("2026-01-03T14:00:00"), endTime: new Date("2026-01-03T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs Eastern Suburbs", description: "SIU Game", startTime: new Date("2026-01-04T14:00:00"), endTime: new Date("2026-01-04T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs NPL Team", description: "SIU Game", startTime: new Date("2026-01-07T19:00:00"), endTime: new Date("2026-01-07T21:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Ferrymead Bays vs CUFC", description: "CUFC Home Game", startTime: new Date("2026-01-10T14:00:00"), endTime: new Date("2026-01-10T16:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "SIU vs Manukau United", description: "SIU Game", startTime: new Date("2026-01-11T14:00:00"), endTime: new Date("2026-01-11T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs Auckland FC", description: "SIU Game", startTime: new Date("2026-01-17T14:00:00"), endTime: new Date("2026-01-17T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Chinese New Year", description: "Cultural Event", startTime: new Date("2026-01-17T00:00:00"), endTime: new Date("2026-01-17T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "SIU vs Bulls FC", description: "SIU Game", startTime: new Date("2026-01-19T14:00:00"), endTime: new Date("2026-01-19T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Southland Anniversary Day", description: "Public Holiday (Regional)", startTime: new Date("2026-01-20T00:00:00"), endTime: new Date("2026-01-20T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Coastal Spirit vs CUFC", description: "Club Event", startTime: new Date("2026-01-21T19:00:00"), endTime: new Date("2026-01-21T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "CUFC vs Southern Roads", description: "CUFC Home Game", startTime: new Date("2026-01-22T19:00:00"), endTime: new Date("2026-01-22T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "SIU vs Mainland United", description: "SIU Game", startTime: new Date("2026-01-23T19:00:00"), endTime: new Date("2026-01-23T21:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs Auckland FC", description: "SIU Game", startTime: new Date("2026-01-24T14:00:00"), endTime: new Date("2026-01-24T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Term 1 Starts", description: "Term Start", startTime: new Date("2026-02-02T00:00:00"), endTime: new Date("2026-02-02T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "NI vs Birk FC", description: "Club Event", startTime: new Date("2026-02-03T19:00:00"), endTime: new Date("2026-02-03T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "SIU vs NPL Team", description: "SIU Game", startTime: new Date("2026-02-05T19:00:00"), endTime: new Date("2026-02-05T21:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Waitangi Day", description: "Public Holiday", startTime: new Date("2026-02-06T00:00:00"), endTime: new Date("2026-02-06T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "SIU vs NPL Team", description: "SIU Game", startTime: new Date("2026-02-07T14:00:00"), endTime: new Date("2026-02-07T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs NPL Team", description: "SIU Game", startTime: new Date("2026-02-08T14:00:00"), endTime: new Date("2026-02-08T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Valentine's Day", description: "Cultural Event", startTime: new Date("2026-02-14T00:00:00"), endTime: new Date("2026-02-14T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Canterbury Anniversary vs CUFC", description: "CUFC Home Game", startTime: new Date("2026-02-14T14:00:00"), endTime: new Date("2026-02-14T16:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "SIU vs Hills United", description: "SIU Game", startTime: new Date("2026-02-15T14:00:00"), endTime: new Date("2026-02-15T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs Mainland United", description: "SIU Game", startTime: new Date("2026-02-21T14:00:00"), endTime: new Date("2026-02-21T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs Auckland FC", description: "SIU Game", startTime: new Date("2026-02-28T14:00:00"), endTime: new Date("2026-02-28T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "International Women's Day", description: "Cultural Event", startTime: new Date("2026-03-08T00:00:00"), endTime: new Date("2026-03-08T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Nelson Suburbs vs CUFC", description: "Club Event", startTime: new Date("2026-03-09T14:00:00"), endTime: new Date("2026-03-09T16:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Otago Anniversary Day", description: "Public Holiday (Regional)", startTime: new Date("2026-03-23T00:00:00"), endTime: new Date("2026-03-23T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Good Friday", description: "Public Holiday", startTime: new Date("2026-04-03T00:00:00"), endTime: new Date("2026-04-03T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Canterbury Nomads vs CUFC", description: "Club Event", startTime: new Date("2026-04-04T14:00:00"), endTime: new Date("2026-04-04T16:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Easter Monday", description: "Public Holiday", startTime: new Date("2026-04-06T00:00:00"), endTime: new Date("2026-04-06T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Term 1 Ends", description: "Term End", startTime: new Date("2026-04-10T00:00:00"), endTime: new Date("2026-04-10T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "ANZAC Day", description: "Public Holiday", startTime: new Date("2026-04-25T00:00:00"), endTime: new Date("2026-04-25T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "ANZAC Day Monday", description: "Public Holiday (Observed)", startTime: new Date("2026-04-27T00:00:00"), endTime: new Date("2026-04-27T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Term 2 Starts", description: "Term Start", startTime: new Date("2026-05-04T00:00:00"), endTime: new Date("2026-05-04T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "Prix Slot Day", description: "Club Event", startTime: new Date("2026-05-15T00:00:00"), endTime: new Date("2026-05-15T23:59:59"), allDay: true, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "SIU vs Mainland United", description: "SIU Game", startTime: new Date("2026-05-16T14:00:00"), endTime: new Date("2026-05-16T16:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "SIU vs Bulls FC", description: "SIU Game", startTime: new Date("2026-05-19T19:00:00"), endTime: new Date("2026-05-19T21:00:00"), allDay: false, calendarType: "south-island", color: "#8b5cf6", organizationId: oid, createdBy },
        { title: "Sem 2 Starts", description: "Term Start", startTime: new Date("2026-05-21T00:00:00"), endTime: new Date("2026-05-21T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "King's Birthday", description: "Public Holiday", startTime: new Date("2026-06-01T00:00:00"), endTime: new Date("2026-06-01T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "CUFC vs Cashmere Technical", description: "CUFC Home Game", startTime: new Date("2026-06-03T19:00:00"), endTime: new Date("2026-06-03T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Dunedin City Royals vs CUFC", description: "Club Event", startTime: new Date("2026-06-06T14:00:00"), endTime: new Date("2026-06-06T16:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Matariki", description: "Public Holiday", startTime: new Date("2026-06-10T00:00:00"), endTime: new Date("2026-06-10T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "CUFC vs Bolton United", description: "CUFC Home Game", startTime: new Date("2026-06-21T14:00:00"), endTime: new Date("2026-06-21T16:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Term 2 Ends", description: "Term End", startTime: new Date("2026-07-03T00:00:00"), endTime: new Date("2026-07-03T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "CIC - U14 | Day 1", description: "CIC Tournament", startTime: new Date("2026-07-04T09:00:00"), endTime: new Date("2026-07-04T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 1", description: "Chatham Cup", startTime: new Date("2026-07-04T14:00:00"), endTime: new Date("2026-07-04T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "CIC - U14 | Day 2", description: "CIC Tournament", startTime: new Date("2026-07-05T09:00:00"), endTime: new Date("2026-07-05T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 1", description: "Chatham Cup", startTime: new Date("2026-07-05T14:00:00"), endTime: new Date("2026-07-05T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "CIC - U14 | Day 3", description: "CIC Tournament", startTime: new Date("2026-07-06T09:00:00"), endTime: new Date("2026-07-06T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U15 | Day 1", description: "CIC Tournament", startTime: new Date("2026-07-11T09:00:00"), endTime: new Date("2026-07-11T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U15 | Day 2", description: "CIC Tournament", startTime: new Date("2026-07-12T09:00:00"), endTime: new Date("2026-07-12T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U15 | Day 3", description: "CIC Tournament", startTime: new Date("2026-07-13T09:00:00"), endTime: new Date("2026-07-13T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "Wanaka FC vs CUFC", description: "Club Event", startTime: new Date("2026-07-18T14:00:00"), endTime: new Date("2026-07-18T16:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Term 3 Starts", description: "Term Start", startTime: new Date("2026-07-20T00:00:00"), endTime: new Date("2026-07-20T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "Commonwealth Games", description: "Major Event", startTime: new Date("2026-08-01T00:00:00"), endTime: new Date("2026-08-01T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Commonwealth Games", description: "Major Event", startTime: new Date("2026-08-02T00:00:00"), endTime: new Date("2026-08-02T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Commonwealth Games", description: "Major Event", startTime: new Date("2026-08-03T00:00:00"), endTime: new Date("2026-08-03T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 4", description: "Chatham Cup", startTime: new Date("2026-08-04T19:00:00"), endTime: new Date("2026-08-04T21:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 4", description: "Chatham Cup", startTime: new Date("2026-08-05T19:00:00"), endTime: new Date("2026-08-05T21:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 4", description: "Chatham Cup", startTime: new Date("2026-08-06T19:00:00"), endTime: new Date("2026-08-06T21:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "CUFC vs Ferrymead Bays", description: "CUFC Home Game", startTime: new Date("2026-08-11T19:00:00"), endTime: new Date("2026-08-11T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 5", description: "Chatham Cup", startTime: new Date("2026-08-12T19:00:00"), endTime: new Date("2026-08-12T21:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 5", description: "Chatham Cup", startTime: new Date("2026-08-13T19:00:00"), endTime: new Date("2026-08-13T21:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "CIC - U9-U11 | Day 1", description: "CIC Tournament", startTime: new Date("2026-08-14T09:00:00"), endTime: new Date("2026-08-14T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U9-U11 | Day 2", description: "CIC Tournament", startTime: new Date("2026-08-15T09:00:00"), endTime: new Date("2026-08-15T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U9-U11 | Day 3", description: "CIC Tournament", startTime: new Date("2026-08-16T09:00:00"), endTime: new Date("2026-08-16T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U12-U13 | Day 1", description: "CIC Tournament", startTime: new Date("2026-08-20T09:00:00"), endTime: new Date("2026-08-20T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U12-U13 | Day 2", description: "CIC Tournament", startTime: new Date("2026-08-21T09:00:00"), endTime: new Date("2026-08-21T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "CIC - U12-U13 | Day 3", description: "CIC Tournament", startTime: new Date("2026-08-22T09:00:00"), endTime: new Date("2026-08-22T17:00:00"), allDay: false, calendarType: "united", color: "#f59e0b", organizationId: oid, createdBy },
        { title: "Chatham Cup - Quarter Final", description: "Chatham Cup", startTime: new Date("2026-08-23T14:00:00"), endTime: new Date("2026-08-23T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Chatham Cup - Quarter Final", description: "Chatham Cup", startTime: new Date("2026-08-24T14:00:00"), endTime: new Date("2026-08-24T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Chatham Cup - Quarter Final", description: "Chatham Cup", startTime: new Date("2026-08-25T14:00:00"), endTime: new Date("2026-08-25T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Nomads United vs CUFC", description: "Club Event", startTime: new Date("2026-08-27T19:00:00"), endTime: new Date("2026-08-27T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Commonwealth Games", description: "Major Event", startTime: new Date("2026-08-27T00:00:00"), endTime: new Date("2026-08-27T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Commonwealth Games", description: "Major Event", startTime: new Date("2026-08-28T00:00:00"), endTime: new Date("2026-08-28T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 2", description: "Chatham Cup", startTime: new Date("2026-08-29T14:00:00"), endTime: new Date("2026-08-29T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Commonwealth Games", description: "Major Event", startTime: new Date("2026-08-29T00:00:00"), endTime: new Date("2026-08-29T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Chatham Cup - Round 3", description: "Chatham Cup", startTime: new Date("2026-08-30T14:00:00"), endTime: new Date("2026-08-30T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Commonwealth Games", description: "Major Event", startTime: new Date("2026-08-30T00:00:00"), endTime: new Date("2026-08-30T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Northern AFC vs CUFC", description: "Club Event", startTime: new Date("2026-08-31T19:00:00"), endTime: new Date("2026-08-31T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Chatham Cup - Final", description: "Chatham Cup Final", startTime: new Date("2026-09-05T14:00:00"), endTime: new Date("2026-09-05T16:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Father's Day (NZ)", description: "Cultural Event", startTime: new Date("2026-09-06T00:00:00"), endTime: new Date("2026-09-06T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Maori Language Day", description: "Cultural Event", startTime: new Date("2026-09-14T00:00:00"), endTime: new Date("2026-09-14T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Chatham Cup - Semi Final", description: "Chatham Cup", startTime: new Date("2026-09-15T19:00:00"), endTime: new Date("2026-09-15T21:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Chatham Cup - Semi Final", description: "Chatham Cup", startTime: new Date("2026-09-16T19:00:00"), endTime: new Date("2026-09-16T21:00:00"), allDay: false, calendarType: "united", color: "#1e40af", organizationId: oid, createdBy },
        { title: "Coastal Spirit vs CUFC", description: "Club Event", startTime: new Date("2026-09-22T19:00:00"), endTime: new Date("2026-09-22T21:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "CUPRA Business Hub", description: "Business Event", startTime: new Date("2026-09-23T09:00:00"), endTime: new Date("2026-09-23T17:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Term 3 Ends", description: "Term End", startTime: new Date("2026-09-25T00:00:00"), endTime: new Date("2026-09-25T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "South Canterbury Anniversary Day", description: "Public Holiday (Regional)", startTime: new Date("2026-09-28T00:00:00"), endTime: new Date("2026-09-28T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Term 4 Starts", description: "Term Start", startTime: new Date("2026-10-12T00:00:00"), endTime: new Date("2026-10-12T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "Canterbury Anniversary Day", description: "Public Holiday (Regional)", startTime: new Date("2026-10-13T00:00:00"), endTime: new Date("2026-10-13T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "CUPRA Business Hub", description: "Business Event", startTime: new Date("2026-10-15T09:00:00"), endTime: new Date("2026-10-15T17:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Term 4 Ends", description: "Term End", startTime: new Date("2026-10-21T00:00:00"), endTime: new Date("2026-10-21T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "Labour Day", description: "Public Holiday", startTime: new Date("2026-10-26T00:00:00"), endTime: new Date("2026-10-26T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Halloween", description: "Cultural Event", startTime: new Date("2026-10-31T00:00:00"), endTime: new Date("2026-10-31T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Marlborough Anniversary Day", description: "Public Holiday (Regional)", startTime: new Date("2026-11-02T00:00:00"), endTime: new Date("2026-11-02T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "West Coast Anniversary Day", description: "Public Holiday (Regional)", startTime: new Date("2026-11-09T00:00:00"), endTime: new Date("2026-11-09T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Canterbury Anniversary Day", description: "Public Holiday (Regional)", startTime: new Date("2026-11-13T00:00:00"), endTime: new Date("2026-11-13T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Term 5 Ends", description: "Term End", startTime: new Date("2026-11-27T00:00:00"), endTime: new Date("2026-11-27T23:59:59"), allDay: true, calendarType: "united", color: "#22c55e", organizationId: oid, createdBy },
        { title: "Black Friday", description: "Commercial Event", startTime: new Date("2026-11-27T00:00:00"), endTime: new Date("2026-11-27T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "Cyber Monday", description: "Commercial Event", startTime: new Date("2026-11-30T00:00:00"), endTime: new Date("2026-11-30T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
        { title: "CUPRA Business Hub", description: "Business Event", startTime: new Date("2026-12-07T09:00:00"), endTime: new Date("2026-12-07T17:00:00"), allDay: false, calendarType: "united", color: "#6366f1", organizationId: oid, createdBy },
        { title: "Christmas Day", description: "Public Holiday", startTime: new Date("2026-12-25T00:00:00"), endTime: new Date("2026-12-25T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "Boxing Day", description: "Public Holiday", startTime: new Date("2026-12-26T00:00:00"), endTime: new Date("2026-12-26T23:59:59"), allDay: true, calendarType: "general", color: "#ef4444", organizationId: oid, createdBy },
        { title: "New Year's Eve", description: "Cultural Event", startTime: new Date("2026-12-31T00:00:00"), endTime: new Date("2026-12-31T23:59:59"), allDay: true, calendarType: "general", color: "#3b82f6", organizationId: oid, createdBy },
      ];
      for (let i = 0; i < calEvents.length; i += 50) {
        await db.insert(calendarEvents).values(calEvents.slice(i, i + 50));
      }
      console.log(`Calendar events seeded: ${calEvents.length} events for United Sports Group`);
    }
  }

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

  const mflOrg = allOrgs.find(o => o.slug === "mini-football-leagues");
  if (mflOrg) {
    const [existingComps] = await db.select({ count: sql<number>`count(*)` }).from(leagueCompetitions).where(eq(leagueCompetitions.organizationId, mflOrg.id));
    if (Number(existingComps.count) === 0) {
      const [comp1] = await db.insert(leagueCompetitions).values({
        organizationId: mflOrg.id,
        name: "Saturday Morning Mini League",
        sport: "Soccer",
        startDate: "2026-03-07",
        endDate: "2026-06-27",
        registrationStatus: "open",
        youthLeague: true,
        enableRegistration: true,
        contactEmail: "leagues@cufc.co.nz",
        contactPhone: "021 446 212",
      }).returning();

      const [comp2] = await db.insert(leagueCompetitions).values({
        organizationId: mflOrg.id,
        name: "Friday Night Futsal",
        sport: "Futsal",
        startDate: "2026-04-03",
        endDate: "2026-07-31",
        registrationStatus: "closed",
        youthLeague: true,
        enableRegistration: true,
        contactEmail: "futsal@cufc.co.nz",
      }).returning();

      const [div1] = await db.insert(leagueDivisions).values({ competitionId: comp1.id, name: "Year 3-4 Mixed", ageGroup: "Year 3-4", gender: "Mixed", dayOfWeek: "Saturday", maxTeams: 12, sortOrder: 0 }).returning();
      const [div2] = await db.insert(leagueDivisions).values({ competitionId: comp1.id, name: "Year 5-6 Mixed", ageGroup: "Year 5-6", gender: "Mixed", dayOfWeek: "Saturday", maxTeams: 10, sortOrder: 1 }).returning();
      const [div3] = await db.insert(leagueDivisions).values({ competitionId: comp1.id, name: "Year 7-8 Boys", ageGroup: "Year 7-8", gender: "Boys", dayOfWeek: "Saturday", maxTeams: 8, sortOrder: 2 }).returning();
      const [div4] = await db.insert(leagueDivisions).values({ competitionId: comp2.id, name: "Year 5-6 Futsal", ageGroup: "Year 5-6", dayOfWeek: "Friday", maxTeams: 8, sortOrder: 0 }).returning();

      const teamNames34 = ["Christchurch United Blue", "Halswell United", "Burnside FC", "Cashmere Tech Gold", "Avon Rangers", "Ferrymead Bays Red", "Papanui FC", "Northern United"];
      const teamNames56 = ["CU Academy", "Cashmere Tech Blue", "Selwyn United", "Burnham FC", "Lincoln FC", "Darfield Rangers"];
      const teamNames78 = ["CU Development", "South Island Stars", "Port Hills United", "Waimak FC"];
      const futsalNames = ["CU Futsal A", "CU Futsal B", "Burnside Futsal", "Northern Futsal", "Cashmere Futsal", "Selwyn Futsal"];

      const allTeamData = [
        ...teamNames34.map(n => ({ organizationId: mflOrg.id, competitionId: comp1.id, divisionId: div1.id, name: n })),
        ...teamNames56.map(n => ({ organizationId: mflOrg.id, competitionId: comp1.id, divisionId: div2.id, name: n })),
        ...teamNames78.map(n => ({ organizationId: mflOrg.id, competitionId: comp1.id, divisionId: div3.id, name: n })),
        ...futsalNames.map(n => ({ organizationId: mflOrg.id, competitionId: comp2.id, divisionId: div4.id, name: n })),
      ];

      const insertedTeams = [];
      for (const t of allTeamData) {
        const [team] = await db.insert(leagueTeams).values(t).returning();
        insertedTeams.push(team);
      }

      const div1Teams = insertedTeams.filter(t => t.divisionId === div1.id);
      const gameData = [];
      let gameNum = 1;
      const startDate = new Date("2026-03-07");
      for (let week = 0; week < 4; week++) {
        const gameDate = new Date(startDate);
        gameDate.setDate(gameDate.getDate() + week * 7);
        const dateStr = gameDate.toISOString().split("T")[0];
        for (let i = 0; i < div1Teams.length - 1; i += 2) {
          gameData.push({
            competitionId: comp1.id,
            divisionId: div1.id,
            homeTeamId: div1Teams[i].id,
            awayTeamId: div1Teams[i + 1].id,
            gameNumber: gameNum++,
            gameDate: dateStr,
            startTime: `${9 + Math.floor(i / 2)}:00`,
            location: "Christchurch Football Centre",
            status: week < 2 ? "final" : "scheduled",
            homeScore: week < 2 ? Math.floor(Math.random() * 5) : null,
            awayScore: week < 2 ? Math.floor(Math.random() * 4) : null,
          });
        }
      }

      for (const g of gameData) {
        await db.insert(leagueGames).values(g);
      }

      console.log("MFL competitions, divisions, teams, and games seeded");
    }
  }

  const cicOrg = allOrgs.find(o => o.slug === "christchurch-international-cup");
  if (cicOrg) {
    const [existingTournaments] = await db.select({ count: sql<number>`count(*)` }).from(tournaments).where(eq(tournaments.organizationId, cicOrg.id));
    if (Number(existingTournaments.count) === 0) {
      const [t1] = await db.insert(tournaments).values({
        organizationId: cicOrg.id,
        name: "U10 Christchurch International Cup 2026",
        ageGroup: "U10",
        startDate: "2026-07-11",
        endDate: "2026-07-12",
        location: "Christchurch Football Centre",
        numGroups: 4,
        teamsPerGroup: 4,
        gameDurationMinutes: 15,
        breakBetweenMinutes: 5,
        pointsForWin: 3,
        pointsForDraw: 1,
        pointsForLoss: 0,
        status: "active",
        active: true,
        registrationStatus: "open",
      }).returning();

      const [t2] = await db.insert(tournaments).values({
        organizationId: cicOrg.id,
        name: "U12 Christchurch International Cup 2026",
        ageGroup: "U12",
        startDate: "2026-07-13",
        endDate: "2026-07-14",
        location: "Christchurch Football Centre",
        numGroups: 4,
        teamsPerGroup: 4,
        gameDurationMinutes: 20,
        breakBetweenMinutes: 5,
        status: "draft",
        active: true,
      }).returning();

      const [gA] = await db.insert(tournamentGroups).values({ tournamentId: t1.id, name: "Group A", sortOrder: 0 }).returning();
      const [gB] = await db.insert(tournamentGroups).values({ tournamentId: t1.id, name: "Group B", sortOrder: 1 }).returning();
      const [gC] = await db.insert(tournamentGroups).values({ tournamentId: t1.id, name: "Group C", sortOrder: 2 }).returning();
      const [gD] = await db.insert(tournamentGroups).values({ tournamentId: t1.id, name: "Group D", sortOrder: 3 }).returning();

      const teamData = [
        { name: "Christchurch United Blue", clubName: "Christchurch United FC", groupId: gA.id, primaryColor: "#22399B" },
        { name: "Canterbury FC Red", clubName: "Canterbury FC", groupId: gA.id, primaryColor: "#CC0000" },
        { name: "Wellington Phoenix Youth", clubName: "Wellington Phoenix", groupId: gA.id, primaryColor: "#FFC72C" },
        { name: "Auckland City Juniors", clubName: "Auckland City FC", groupId: gA.id, primaryColor: "#003366" },
        { name: "Cashmere Tech Gold", clubName: "Cashmere Technical FC", groupId: gB.id, primaryColor: "#D9B10F" },
        { name: "Nelson FC Blue", clubName: "Nelson FC", groupId: gB.id, primaryColor: "#0066CC" },
        { name: "Burnside FC Green", clubName: "Burnside FC", groupId: gB.id, primaryColor: "#228B22" },
        { name: "Halswell United White", clubName: "Halswell United", groupId: gB.id, primaryColor: "#888888" },
        { name: "Selwyn United Red", clubName: "Selwyn United", groupId: gC.id, primaryColor: "#990000" },
        { name: "Ferrymead Bays Blue", clubName: "Ferrymead Bays", groupId: gC.id, primaryColor: "#1E90FF" },
        { name: "Nomads United", clubName: "Nomads AFC", groupId: gC.id, primaryColor: "#333333" },
        { name: "Coastal Spirit Gold", clubName: "Coastal Spirit FC", groupId: gC.id, primaryColor: "#DAA520" },
        { name: "Rangiora FC", clubName: "Rangiora FC", groupId: gD.id, primaryColor: "#006400" },
        { name: "Papanui FC Orange", clubName: "Papanui FC", groupId: gD.id, primaryColor: "#FF8C00" },
        { name: "Northern United Black", clubName: "Northern United", groupId: gD.id, primaryColor: "#111111" },
        { name: "Southern Suburbs", clubName: "Southern Suburbs FC", groupId: gD.id, primaryColor: "#4B0082" },
      ];

      for (const td of teamData) {
        await db.insert(tournamentTeams).values({ tournamentId: t1.id, ...td });
      }

      console.log("CIC tournaments, groups, and teams seeded");
    }
  }

  await db.execute(sql`ALTER TABLE programs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE`);
  await db.execute(sql`UPDATE programs SET organization_id = 1 WHERE organization_id IS NULL`);
  await db.execute(sql`ALTER TABLE programs ADD COLUMN IF NOT EXISTS academy_section text`);
  await db.execute(sql`UPDATE programs SET academy_section = 'additional' WHERE type = 'academy' AND (slug LIKE 'technification%' OR slug LIKE 'gk-%' OR name ILIKE '%goalkeeper%' OR name ILIKE '%technification%') AND (academy_section IS NULL OR academy_section != 'additional')`);
  await db.execute(sql`UPDATE programs SET academy_section = 'core' WHERE type = 'academy' AND academy_section IS NULL`);

  await seedAnalyticsData();
}

async function seedAnalyticsData() {
  const [existing] = await db.select({ count: sql<number>`count(*)` }).from(analyticsEvents);
  if (Number(existing.count) >= 500) return;

  const campRows = await db.select({ slug: programs.slug }).from(programs).where(eq(programs.type, "holiday_camp"));
  if (campRows.length === 0) return;

  const slugs = campRows.map(c => c.slug);
  const devices = ["mobile", "desktop", "tablet"];
  const browsers = ["Chrome", "Safari", "Firefox", "Edge"];
  const sources = ["Direct", "Meta Ads", "Google Ads", "Organic Search", "Meta Organic", "Referral"];
  const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16); });

  const events: any[] = [];
  const now = Date.now();

  for (let day = 0; day < 30; day++) {
    const sessionsPerDay = 10 + Math.floor(Math.random() * 30);
    for (let s = 0; s < sessionsPerDay; s++) {
      const visitorId = uuid();
      const sessionId = uuid();
      const campSlug = slugs[Math.floor(Math.random() * slugs.length)];
      const device = devices[Math.floor(Math.random() * devices.length)];
      const browser = browsers[Math.floor(Math.random() * browsers.length)];
      const source = sources[Math.floor(Math.random() * sources.length)];
      const ts = new Date(now - day * 86400000 - Math.random() * 86400000);
      const isNew = Math.random() > 0.4;
      const screenW = device === "mobile" ? 375 : device === "tablet" ? 768 : 1440;
      const scrollPct = Math.floor(Math.random() * 100);
      const timeOnPage = 5 + Math.floor(Math.random() * 180);
      const bounced = Math.random() < 0.15 && timeOnPage < 10;

      const base = { visitorId, sessionId, page: `/${campSlug}`, referrer: null, utmSource: source.includes("Ads") ? source.toLowerCase().replace(" ", "_") : null, utmMedium: source.includes("Ads") ? "cpc" : null, utmCampaign: null, device, browser, screenWidth: screenW, campSlug };

      events.push({ ...base, eventType: "session_start", timestamp: ts, metadata: { trafficSource: source, isNewVisitor: isNew } });
      events.push({ ...base, eventType: "page_view", timestamp: new Date(ts.getTime() + 100), metadata: { trafficSource: source } });
      events.push({ ...base, eventType: "scroll_depth", timestamp: new Date(ts.getTime() + timeOnPage * 1000), metadata: { maxPercent: scrollPct } });
      events.push({ ...base, eventType: "time_on_page", timestamp: new Date(ts.getTime() + timeOnPage * 1000 + 100), metadata: { seconds: timeOnPage } });

      if (bounced) {
        events.push({ ...base, eventType: "bounce", timestamp: new Date(ts.getTime() + timeOnPage * 1000 + 200), metadata: {} });
      }

      if (Math.random() < 0.35) {
        events.push({ ...base, eventType: "cta_click", timestamp: new Date(ts.getTime() + Math.random() * timeOnPage * 1000), metadata: { element: "button", text: "Book Now", testid: "cta-book", href: `/${campSlug}/book`, x: Math.floor(Math.random() * screenW), y: Math.floor(Math.random() * 800) } });
      }

      if (Math.random() < 0.5) {
        const clickTime = new Date(ts.getTime() + Math.random() * timeOnPage * 1000);
        events.push({ ...base, eventType: "click", timestamp: clickTime, metadata: { element: "a", text: "Learn More", testid: "", href: "#", x: Math.floor(Math.random() * screenW), y: Math.floor(Math.random() * 1500), scrollY: Math.floor(Math.random() * 2000) } });
      }

      if (Math.random() < 0.25) {
        events.push({ ...base, eventType: "form_view", page: `/${campSlug}/book`, timestamp: new Date(ts.getTime() + 5000), metadata: {} });
        if (Math.random() < 0.6) {
          events.push({ ...base, eventType: "form_step", page: `/${campSlug}/book`, timestamp: new Date(ts.getTime() + 15000), metadata: { step: "1" } });
        }
        if (Math.random() < 0.3) {
          events.push({ ...base, eventType: "form_step", page: `/${campSlug}/book`, timestamp: new Date(ts.getTime() + 30000), metadata: { step: "2" } });
        }
      }
    }
  }

  for (let i = 0; i < events.length; i += 100) {
    await db.insert(analyticsEvents).values(events.slice(i, i + 100));
  }
  console.log(`Analytics seeded: ${events.length} events for ${slugs.length} camps`);
}
