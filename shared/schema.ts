import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, date, decimal, pgEnum, uniqueIndex, time } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role_type", ["super_admin", "admin", "team_member", "manager", "coach", "finance", "marketing", "registrar"]);
export const contactTypeEnum = pgEnum("contact_type", ["player", "guardian", "staff", "volunteer", "sponsor"]);
export const genderEnum = pgEnum("gender_type", ["male", "female", "other"]);
export const programTypeEnum = pgEnum("program_type", ["holiday_camp", "academy", "trials", "event", "open_training"]);
export const registrationStatusEnum = pgEnum("registration_status", ["pending", "confirmed", "waitlisted", "cancelled", "refunded"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "paid", "overdue", "refunded"]);
export const facilityTypeEnum = pgEnum("facility_type", ["field", "mini_pitch", "meeting_room", "changing_room", "futsal", "court", "other"]);
export const bookingStatusEnum = pgEnum("booking_status", ["confirmed", "paid", "pending", "cancelled"]);

export const organizations = pgTable("organizations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userOrganizations = pgTable("user_organizations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull().default("admin"),
});

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
  slug: text("slug").unique(),
  type: programTypeEnum("type").notNull(),
  description: text("description"),
  heroImage: text("hero_image"),
  location: text("location"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  bookingsOpenDate: date("bookings_open_date"),
  bookingsCloseDate: date("bookings_close_date"),
  includeWeekends: boolean("include_weekends").default(false),
  capacity: integer("capacity"),
  ageMin: integer("age_min"),
  ageMax: integer("age_max"),
  fee: decimal("fee", { precision: 10, scale: 2 }),
  fullDayCost: decimal("full_day_cost", { precision: 10, scale: 2 }),
  heroHeadline: text("hero_headline"),
  heroSubheadline: text("hero_subheadline"),
  descriptionShort: text("description_short"),
  descriptionLong: text("description_long"),
  whatToBring: text("what_to_bring"),
  inclusions: text("inclusions"),
  refundPolicy: text("refund_policy"),
  contactEmail: text("contact_email"),
  primaryCta: text("primary_cta").default("Book Now"),
  faqJson: text("faq_json"),
  pageContentJson: text("page_content_json"),
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
  rollTaker: text("roll_taker"),
  cost: decimal("cost", { precision: 10, scale: 2 }),
  capacity: integer("capacity"),
});

export const sessionBookings = pgTable("session_bookings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sessionId: integer("session_id").notNull().references(() => programSessions.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").notNull().references(() => contacts.id),
  attended: boolean("attended").default(false),
  paid: boolean("paid").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const programDiscounts = pgTable("program_discounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  programId: integer("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  minBookings: integer("min_bookings").notNull(),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).notNull(),
});

export const registrations = pgTable("registrations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orderNumber: integer("order_number"),
  programId: integer("program_id").notNull().references(() => programs.id),
  contactId: integer("contact_id").notNull().references(() => contacts.id),
  guardianId: integer("guardian_id").references(() => contacts.id),
  status: registrationStatusEnum("status").notNull().default("pending"),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).default("0"),
  notes: text("notes"),
  source: text("source"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  fbclid: text("fbclid"),
  gclid: text("gclid"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  subtotalCents: integer("subtotal_cents"),
  discountCents: integer("discount_cents").default(0),
  totalCents: integer("total_cents"),
  currency: text("currency").default("NZD"),
  registrationLocation: text("registration_location").default("online"),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
});

export const campPricing = pgTable("camp_pricing", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  campId: integer("camp_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  productType: text("product_type").notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("NZD"),
});

export const campDates = pgTable("camp_dates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  campId: integer("camp_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  capacityFullDay: integer("capacity_full_day"),
  capacityMorning: integer("capacity_morning"),
  capacityAfternoon: integer("capacity_afternoon"),
});

export const campSettings = pgTable("camp_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  campId: integer("camp_id").notNull().unique().references(() => programs.id, { onDelete: "cascade" }),
  confirmationEmailSubject: text("confirmation_email_subject"),
  confirmationEmailBody: text("confirmation_email_body"),
  fromEmail: text("from_email"),
  replyTo: text("reply_to"),
});

export const children = pgTable("children", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  parentId: integer("parent_id").notNull().references(() => contacts.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const childMedical = pgTable("child_medical", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  childId: integer("child_id").notNull().unique().references(() => children.id, { onDelete: "cascade" }),
  allergies: text("allergies"),
  epiPen: boolean("epi_pen").default(false),
  notes: text("notes"),
});

export const registrationItems = pgTable("registration_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  registrationId: integer("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
  childId: integer("child_id").notNull().references(() => children.id),
  campDateId: integer("camp_date_id").notNull().references(() => campDates.id),
  productType: text("product_type").notNull(),
});

export const attendance = pgTable("attendance", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  campId: integer("camp_id").notNull().references(() => programs.id),
  campDateId: integer("camp_date_id").notNull().references(() => campDates.id),
  childId: integer("child_id").notNull().references(() => children.id),
  checkedInAt: timestamp("checked_in_at"),
  checkedOutAt: timestamp("checked_out_at"),
  checkedInByUserId: integer("checked_in_by_user_id").references(() => users.id),
  checkedOutByUserId: integer("checked_out_by_user_id").references(() => users.id),
  note: text("note"),
});

export const emailLogs = pgTable("email_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  campId: integer("camp_id").references(() => programs.id),
  registrationId: integer("registration_id").references(() => registrations.id),
  toEmail: text("to_email").notNull(),
  subject: text("subject"),
  body: text("body"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  providerMessageId: text("provider_message_id"),
});

export const metaEventLogs = pgTable("meta_event_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  campId: integer("camp_id").references(() => programs.id),
  registrationId: integer("registration_id").references(() => registrations.id),
  eventName: text("event_name").notNull(),
  payloadJson: text("payload_json"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  success: boolean("success").default(false),
});

export const emailCampaigns = pgTable("email_campaigns", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  fromEmail: text("from_email").notNull(),
  replyTo: text("reply_to"),
  segmentType: text("segment_type").notNull(),
  segmentConfig: text("segment_config"),
  recipientCount: integer("recipient_count").default(0),
  sentCount: integer("sent_count").default(0),
  failedCount: integer("failed_count").default(0),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

export const facilities = pgTable("facilities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: facilityTypeEnum("type").notNull().default("field"),
  description: text("description"),
  imageUrl: text("image_url"),
  halfFull: boolean("half_full").default(false),
  floodlights: boolean("floodlights").default(false),
  bufferMinutes: integer("buffer_minutes").default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const facilityPricingRules = pgTable("facility_pricing_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dayOfWeek: integer("day_of_week"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  pricePerHour: decimal("price_per_hour", { precision: 10, scale: 2 }).notNull(),
  isDefault: boolean("is_default").default(false),
});

export const facilityBookings = pgTable("facility_bookings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  bookingDate: date("booking_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  gstAmount: decimal("gst_amount", { precision: 10, scale: 2 }),
  status: bookingStatusEnum("status").notNull().default("pending"),
  stripePaymentId: text("stripe_payment_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const facilityAddons = pgTable("facility_addons", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0"),
  unit: text("unit").notNull().default("per_hour"),
  appliesToAll: boolean("applies_to_all").default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leagueRegistrationStatusEnum = pgEnum("league_reg_status", ["open", "closed", "none"]);
export const gameStatusEnum = pgEnum("game_status", ["scheduled", "in_progress", "final", "cancelled", "forfeit"]);

export const leagueCompetitions = pgTable("league_competitions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sport: text("sport").notNull().default("Soccer"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  registrationStatus: text("registration_status").notNull().default("none"),
  youthLeague: boolean("youth_league").default(true),
  teamChat: boolean("team_chat").default(false),
  playoffCompetition: boolean("playoff_competition").default(false),
  enableRegistration: boolean("enable_registration").default(false),
  isPrivate: boolean("is_private").default(false),
  archived: boolean("archived").default(false),
  settingsJson: text("settings_json"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  contactWebsite: text("contact_website"),
  bannerImageUrl: text("banner_image_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leagueDivisions = pgTable("league_divisions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  competitionId: integer("competition_id").notNull().references(() => leagueCompetitions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  gender: text("gender"),
  ageGroup: text("age_group"),
  dayOfWeek: text("day_of_week"),
  maxTeams: integer("max_teams"),
  teamCostCents: integer("team_cost_cents").default(0),
  playerCostCents: integer("player_cost_cents").default(0),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leagueTeams = pgTable("league_teams", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  competitionId: integer("competition_id").notNull().references(() => leagueCompetitions.id, { onDelete: "cascade" }),
  divisionId: integer("division_id").references(() => leagueDivisions.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leagueGames = pgTable("league_games", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  competitionId: integer("competition_id").notNull().references(() => leagueCompetitions.id, { onDelete: "cascade" }),
  divisionId: integer("division_id").references(() => leagueDivisions.id, { onDelete: "set null" }),
  homeTeamId: integer("home_team_id").references(() => leagueTeams.id, { onDelete: "set null" }),
  awayTeamId: integer("away_team_id").references(() => leagueTeams.id, { onDelete: "set null" }),
  gameNumber: integer("game_number"),
  gameDate: date("game_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  location: text("location"),
  surface: text("surface"),
  status: text("status").notNull().default("scheduled"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leagueCoupons = pgTable("league_coupons", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  competitionId: integer("competition_id").notNull().references(() => leagueCompetitions.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  discountPercent: integer("discount_percent"),
  discountAmountCents: integer("discount_amount_cents"),
  maxUsage: integer("max_usage"),
  currentUsage: integer("current_usage").default(0),
  validUntil: date("valid_until"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tournaments = pgTable("tournaments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ageGroup: text("age_group"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  location: text("location"),
  numGroups: integer("num_groups").default(4),
  teamsPerGroup: integer("teams_per_group").default(4),
  groupStageFormat: text("group_stage_format").default("round_robin"),
  knockoutFormat: text("knockout_format").default("single_elimination"),
  gameDurationMinutes: integer("game_duration_minutes").default(20),
  breakBetweenMinutes: integer("break_between_minutes").default(5),
  pointsForWin: integer("points_for_win").default(3),
  pointsForDraw: integer("points_for_draw").default(1),
  pointsForLoss: integer("points_for_loss").default(0),
  registrationStatus: text("registration_status").default("none"),
  registrationFeeCents: integer("registration_fee_cents").default(0),
  status: text("status").notNull().default("draft"),
  active: boolean("active").notNull().default(true),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tournamentGroups = pgTable("tournament_groups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tournamentId: integer("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tournamentTeams = pgTable("tournament_teams", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tournamentId: integer("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => tournamentGroups.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  clubName: text("club_name"),
  logoUrl: text("logo_url"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  seedNumber: integer("seed_number"),
  registrationStatus: text("registration_status").default("registered"),
  paidAmountCents: integer("paid_amount_cents").default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tournamentPlayers = pgTable("tournament_players", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  teamId: integer("team_id").notNull().references(() => tournamentTeams.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  shirtNumber: integer("shirt_number"),
  dateOfBirth: date("date_of_birth"),
  idDocumentType: text("id_document_type"),
  idDocumentUrl: text("id_document_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tournamentStaff = pgTable("tournament_staff", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  teamId: integer("team_id").notNull().references(() => tournamentTeams.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tournamentGames = pgTable("tournament_games", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  tournamentId: integer("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => tournamentGroups.id, { onDelete: "set null" }),
  homeTeamId: integer("home_team_id").references(() => tournamentTeams.id, { onDelete: "set null" }),
  awayTeamId: integer("away_team_id").references(() => tournamentTeams.id, { onDelete: "set null" }),
  homeTeamPlaceholder: text("home_team_placeholder"),
  awayTeamPlaceholder: text("away_team_placeholder"),
  gameNumber: integer("game_number"),
  roundNumber: integer("round_number"),
  stage: text("stage").notNull().default("group"),
  stageDetail: text("stage_detail"),
  gameDate: date("game_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  field: text("field"),
  status: text("status").notNull().default("scheduled"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  homePenalties: integer("home_penalties"),
  awayPenalties: integer("away_penalties"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSettingSchema = createInsertSchema(settings).omit({ updatedAt: true });
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settings.$inferSelect;

export const insertFacilitySchema = createInsertSchema(facilities).omit({ id: true, createdAt: true });
export const insertFacilityPricingRuleSchema = createInsertSchema(facilityPricingRules).omit({ id: true });
export const insertFacilityBookingSchema = createInsertSchema(facilityBookings).omit({ id: true, createdAt: true });
export const insertFacilityAddonSchema = createInsertSchema(facilityAddons).omit({ id: true, createdAt: true });

export const insertTournamentSchema = createInsertSchema(tournaments).omit({ id: true, createdAt: true });
export const insertTournamentGroupSchema = createInsertSchema(tournamentGroups).omit({ id: true, createdAt: true });
export const insertTournamentTeamSchema = createInsertSchema(tournamentTeams).omit({ id: true, createdAt: true });
export const insertTournamentPlayerSchema = createInsertSchema(tournamentPlayers).omit({ id: true, createdAt: true });
export const insertTournamentStaffSchema = createInsertSchema(tournamentStaff).omit({ id: true, createdAt: true });
export const insertTournamentGameSchema = createInsertSchema(tournamentGames).omit({ id: true, createdAt: true });

export const insertLeagueCompetitionSchema = createInsertSchema(leagueCompetitions).omit({ id: true, createdAt: true });
export const insertLeagueDivisionSchema = createInsertSchema(leagueDivisions).omit({ id: true, createdAt: true });
export const insertLeagueTeamSchema = createInsertSchema(leagueTeams).omit({ id: true, createdAt: true });
export const insertLeagueGameSchema = createInsertSchema(leagueGames).omit({ id: true, createdAt: true });
export const insertLeagueCouponSchema = createInsertSchema(leagueCoupons).omit({ id: true, createdAt: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export const insertRelationshipSchema = createInsertSchema(contactRelationships).omit({ id: true });
export const insertProgramSchema = createInsertSchema(programs).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(programSessions).omit({ id: true });
export const insertSessionBookingSchema = createInsertSchema(sessionBookings).omit({ id: true, createdAt: true });
export const insertDiscountSchema = createInsertSchema(programDiscounts).omit({ id: true });
export const insertRegistrationSchema = createInsertSchema(registrations).omit({ id: true, registeredAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export const insertCampPricingSchema = createInsertSchema(campPricing).omit({ id: true });
export const insertCampDateSchema = createInsertSchema(campDates).omit({ id: true });
export const insertCampSettingsSchema = createInsertSchema(campSettings).omit({ id: true });
export const insertChildSchema = createInsertSchema(children).omit({ id: true, createdAt: true });
export const insertChildMedicalSchema = createInsertSchema(childMedical).omit({ id: true });
export const insertRegistrationItemSchema = createInsertSchema(registrationItems).omit({ id: true });
export const insertAttendanceSchema = createInsertSchema(attendance).omit({ id: true });
export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, sentAt: true });
export const insertMetaEventLogSchema = createInsertSchema(metaEventLogs).omit({ id: true, sentAt: true });
export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({ id: true, createdAt: true, sentAt: true });

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertUserOrganizationSchema = createInsertSchema(userOrganizations).omit({ id: true });

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;
export type InsertUserOrganization = z.infer<typeof insertUserOrganizationSchema>;
export type UserOrganization = typeof userOrganizations.$inferSelect;

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
export type InsertSessionBooking = z.infer<typeof insertSessionBookingSchema>;
export type SessionBooking = typeof sessionBookings.$inferSelect;
export type InsertDiscount = z.infer<typeof insertDiscountSchema>;
export type ProgramDiscount = typeof programDiscounts.$inferSelect;
export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type Registration = typeof registrations.$inferSelect;
export type InsertCampPricing = z.infer<typeof insertCampPricingSchema>;
export type CampPricing = typeof campPricing.$inferSelect;
export type InsertCampDate = z.infer<typeof insertCampDateSchema>;
export type CampDate = typeof campDates.$inferSelect;
export type InsertCampSettings = z.infer<typeof insertCampSettingsSchema>;
export type CampSettings = typeof campSettings.$inferSelect;
export type InsertChild = z.infer<typeof insertChildSchema>;
export type Child = typeof children.$inferSelect;
export type InsertChildMedical = z.infer<typeof insertChildMedicalSchema>;
export type ChildMedical = typeof childMedical.$inferSelect;
export type InsertRegistrationItem = z.infer<typeof insertRegistrationItemSchema>;
export type RegistrationItem = typeof registrationItems.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendance.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertMetaEventLog = z.infer<typeof insertMetaEventLogSchema>;
export type MetaEventLog = typeof metaEventLogs.$inferSelect;
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertFacility = z.infer<typeof insertFacilitySchema>;
export type Facility = typeof facilities.$inferSelect;
export type InsertFacilityPricingRule = z.infer<typeof insertFacilityPricingRuleSchema>;
export type FacilityPricingRule = typeof facilityPricingRules.$inferSelect;
export type InsertFacilityBooking = z.infer<typeof insertFacilityBookingSchema>;
export type FacilityBooking = typeof facilityBookings.$inferSelect;
export type InsertFacilityAddon = z.infer<typeof insertFacilityAddonSchema>;
export type FacilityAddon = typeof facilityAddons.$inferSelect;
export type InsertLeagueCompetition = z.infer<typeof insertLeagueCompetitionSchema>;
export type LeagueCompetition = typeof leagueCompetitions.$inferSelect;
export type InsertLeagueDivision = z.infer<typeof insertLeagueDivisionSchema>;
export type LeagueDivision = typeof leagueDivisions.$inferSelect;
export type InsertLeagueTeam = z.infer<typeof insertLeagueTeamSchema>;
export type LeagueTeam = typeof leagueTeams.$inferSelect;
export type InsertLeagueGame = z.infer<typeof insertLeagueGameSchema>;
export type LeagueGame = typeof leagueGames.$inferSelect;
export type InsertLeagueCoupon = z.infer<typeof insertLeagueCouponSchema>;
export type LeagueCoupon = typeof leagueCoupons.$inferSelect;
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournamentGroup = z.infer<typeof insertTournamentGroupSchema>;
export type TournamentGroup = typeof tournamentGroups.$inferSelect;
export type InsertTournamentTeam = z.infer<typeof insertTournamentTeamSchema>;
export type TournamentTeam = typeof tournamentTeams.$inferSelect;
export type InsertTournamentPlayer = z.infer<typeof insertTournamentPlayerSchema>;
export type TournamentPlayer = typeof tournamentPlayers.$inferSelect;
export type InsertTournamentStaff = z.infer<typeof insertTournamentStaffSchema>;
export type TournamentStaff = typeof tournamentStaff.$inferSelect;
export type InsertTournamentGame = z.infer<typeof insertTournamentGameSchema>;
export type TournamentGame = typeof tournamentGames.$inferSelect;
