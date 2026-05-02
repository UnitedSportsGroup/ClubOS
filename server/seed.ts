import { db } from "./db";
import { users, settings } from "@shared/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./auth";

// Boot-time setup. Three jobs only:
//   1. Idempotent schema migrations (ALTER TYPE, ADD COLUMN IF NOT EXISTS, etc.)
//   2. Zero-state fallback: seed Daniel as super_admin if the users table is
//      genuinely empty. Prevents a fresh install from being locked out.
//   3. Default settings if the settings table is empty.
//
// Anything that creates demo data (fake camps, fake calendar events, fake
// MFL teams, etc.) or force-overwrites prod data (resetting staff passwords
// every boot) was removed on 2026-05-03 after a botched migration showed how
// easy it is for the seed to corrupt prod data.
export async function seedDatabase() {
  await db.execute(sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'super_admin' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'role_type')) THEN ALTER TYPE role_type ADD VALUE 'super_admin'; END IF; END $$`);
  await db.execute(sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'team_member' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'role_type')) THEN ALTER TYPE role_type ADD VALUE 'team_member'; END IF; END $$`);

  const [existingUsers] = await db.select({ count: sql<number>`count(*)` }).from(users);
  if (Number(existingUsers.count) === 0) {
    const seedEmail = process.env.ADMIN_SEED_EMAIL || "daniel@cufc.co.nz";
    const seedPassword = process.env.ADMIN_SEED_PASSWORD || "Growth2020!";
    const hashedPw = await hashPassword(seedPassword);
    await db.insert(users).values({
      email: seedEmail,
      firstName: "Daniel",
      lastName: "Admin",
      password: hashedPw,
      role: "super_admin",
      active: true,
    });
    console.log(`Zero-state: seeded super admin ${seedEmail}`);
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
    console.log("Zero-state: seeded default settings");
  }

  // Real, one-shot data migrations that only touch existing programs.
  await db.execute(sql`UPDATE programs SET slug = 'fundamentals-camp' WHERE slug = 'fundamentals'`);

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

  await db.execute(sql`ALTER TABLE programs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE`);
  await db.execute(sql`UPDATE programs SET organization_id = 1 WHERE organization_id IS NULL`);
  await db.execute(sql`ALTER TABLE programs ADD COLUMN IF NOT EXISTS academy_section text`);
  await db.execute(sql`UPDATE programs SET academy_section = 'additional' WHERE type = 'academy' AND (slug LIKE 'technification%' OR slug LIKE 'gk-%' OR name ILIKE '%goalkeeper%' OR name ILIKE '%technification%') AND (academy_section IS NULL OR academy_section != 'additional')`);
  await db.execute(sql`UPDATE programs SET academy_section = 'core' WHERE type = 'academy' AND academy_section IS NULL`);
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
  await db.execute(sql`
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
