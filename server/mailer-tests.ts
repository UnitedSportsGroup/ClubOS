/**
 * A/B tests in the Mailer, click tracking, and "preview as a person" — the
 * server half. The rules (what a link is, how the list is split, who wins)
 * are pure and live in shared/mailer-tests.ts; this file owns the database,
 * the signatures and the clock.
 *
 * Daniel, 2026-10-27: "add the subject line A/B test, that's super important …
 * an A/B test on calls to action … see which one gets more clicks."
 *
 * How a tested send runs:
 *   1. The send route writes EVERY recipient as a 'queued' row first (the test
 *      sample with its letter, the rest with none), records the email's links,
 *      and the test row with decide_at = now + the wait.
 *   2. The sample goes out now through the broadcast queue, each person's
 *      subject/body for their letter, every link wrapped in a redirect that
 *      carries the campaign, the recipient's id and a signature — never their
 *      address. The campaign ends that phase as 'testing'.
 *   3. Every minute `tickMailerTests` claims any test whose time has come
 *      (one machine wins the claim — two Fly machines must never both send the
 *      rest), reads opens or clicks per letter, stamps the verdict, and sends
 *      the winner to everyone still queued. A human can call it early.
 *
 * 🔴 The redirect only ever sends a person to a URL stored at send time for
 *    that campaign. A URL in the request would be an open redirect wearing a
 *    club domain, and phishing kits look for exactly that.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
import { emailCampaignClicks, emailCampaignLinks, emailCampaignRecipients, emailCampaignTests, emailCampaigns } from "@shared/schema";
import {
  chooseWinner, extractEmailLinks, isSuspectedBotUserAgent, MAILER_CLICK_SWEEP_SECONDS, replaceLinkText,
  trackEmailLinks, type EmailLink, type MailerTestPlan, type MailerVariant,
} from "@shared/mailer-tests";
import { instrumentUrl } from "@shared/email-attribution";
import { renderForRecipient, applyMergeTagsText, type RecipientContext } from "./mailer-render";
import { lookupMailerRecipient, resolveMailerAudience } from "./mailer-audience";
import { sendEmail } from "./email";
import { emailClickToken } from "./email-token";
import { readMailerAttachments } from "./mailer-attachments";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

// Same secret the unsubscribe and open-pixel tokens use — one secret, one
// place to rotate. The fallback matches routes.ts so a missing env never
// splits the two halves of the app onto different keys.
const CLICK_SECRET = process.env.SESSION_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "mfl-unsub-secret-v1";
export const MAILER_PUBLIC_HOST = process.env.MAILER_PUBLIC_HOST || "app.usg.co.nz";

export function clickSignature(campaignId: number, recipientId: number, idx: number): string {
  return crypto.createHmac("sha256", CLICK_SECRET).update(`click:${campaignId}:${recipientId}:${idx}`).digest("hex").slice(0, 24);
}

export function clickUrl(campaignId: number, recipientId: number, idx: number, host = MAILER_PUBLIC_HOST): string {
  return `https://${host}/e/c/${campaignId}/${recipientId}/${idx}/${clickSignature(campaignId, recipientId, idx)}`;
}

// ── The pieces the send route and the tick share ────────────────────────────

/** The links in a campaign's body, written once; a resumed send reads the
 *  rows it wrote. The idx is the anchor's position in the HTML, so the same
 *  body always yields the same idx for the same link. */
export async function recordCampaignLinks(campaignId: number, html: string): Promise<EmailLink[]> {
  const links = extractEmailLinks(html);
  if (links.length === 0) return [];
  await db.insert(emailCampaignLinks)
    .values(links.map((l) => ({ campaignId, idx: l.idx, url: l.href, label: l.text.slice(0, 500), kind: l.kind })))
    .onConflictDoNothing();
  return links;
}

/** Write everyone as 'queued' before anything is sent, returning id by
 *  address. ON CONFLICT keeps an earlier row (a resumed send) and its id. */
export async function queueRecipients(
  campaignId: number,
  people: ReadonlyArray<{ email: string; variant: MailerVariant | null; inTest: boolean }>,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (let i = 0; i < people.length; i += 500) {
    const chunk = people.slice(i, i + 500);
    await db.insert(emailCampaignRecipients)
      .values(chunk.map((p) => ({ campaignId, email: p.email.trim().toLowerCase(), status: "queued", variant: p.variant, inTest: p.inTest })))
      .onConflictDoNothing();
  }
  const rows = await db.select({ id: emailCampaignRecipients.id, email: emailCampaignRecipients.email })
    .from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaignId));
  for (const r of rows) ids.set(String(r.email).toLowerCase(), r.id);
  return ids;
}

export function subjectForVariant(plan: Pick<MailerTestPlan, "kind" | "variantB"> | null, subject: string, variant: MailerVariant | null): string {
  return plan && plan.kind === "subject" && variant === "B" ? plan.variantB : subject;
}

export function bodyForVariant(plan: Pick<MailerTestPlan, "kind" | "variantA" | "variantB"> | null, body: string, variant: MailerVariant | null): string {
  return plan && plan.kind === "link" && variant === "B" ? replaceLinkText(body, plan.variantA, plan.variantB).html : body;
}

/** The HTML one person gets: their letter's words, every link wrapped in their
 *  own tracked redirect, then merge tags, the unsubscribe footer and the pixel
 *  through the one renderer every email passes through. */
export function renderTrackedForRecipient(opts: {
  campaignId: number; recipientId: number; body: string; links: ReadonlyArray<EmailLink>;
  plan: Pick<MailerTestPlan, "kind" | "variantA" | "variantB"> | null; variant: MailerVariant | null; ctx: RecipientContext;
}): string {
  const html = bodyForVariant(opts.plan, opts.body, opts.variant);
  // Variant B of a link test changed the wording, so its anchors are matched
  // by the NEW words; the link row (and its idx) is the original's.
  const links = opts.plan && opts.plan.kind === "link" && opts.variant === "B"
    ? opts.links.map((l) => (l.text === opts.plan!.variantA ? { ...l, text: opts.plan!.variantB } : l))
    : opts.links;
  const tracked = trackEmailLinks(html, links, (l) => clickUrl(opts.campaignId, opts.recipientId, l.idx));
  return renderForRecipient(tracked, opts.ctx);
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface VariantResult { sent: number; opened: number; clicked: number; targetClicked: number }

export interface CampaignResults {
  test: null | {
    kind: string; metric: string; variantA: string; variantB: string; samplePct: number; waitMinutes: number;
    aCount: number; bCount: number; restCount: number; decideAt: string | null; decidedAt: string | null;
    winner: MailerVariant | null; decidedBy: string | null; restSentAt: string | null;
    /** The verdict the numbers give RIGHT NOW (the stamped one once decided). */
    leading: MailerVariant; leadingReason: string; aRate: number; bRate: number;
  };
  variants: { A: VariantResult; B: VariantResult; rest: VariantResult } | null;
  links: { id: number; idx: number; url: string; label: string; kind: string; clicks: number; people: number; isTarget: boolean }[];
  clickedCount: number;
  queuedCount: number;
}

export async function campaignResults(campaignId: number): Promise<CampaignResults> {
  const [t] = await db.select().from(emailCampaignTests).where(eq(emailCampaignTests.campaignId, campaignId));
  const linkRows = await db.select().from(emailCampaignLinks).where(eq(emailCampaignLinks.campaignId, campaignId)).orderBy(emailCampaignLinks.idx);
  const clickRows = rowsOf(await db.execute(sql`
    SELECT link_id, count(*)::int AS clicks, count(DISTINCT recipient_id)::int AS people
    FROM email_campaign_clicks WHERE campaign_id = ${campaignId} AND suspected_bot = false GROUP BY link_id`));
  const byLink = new Map<number, { clicks: number; people: number }>(clickRows.map((r) => [Number(r.link_id), { clicks: Number(r.clicks), people: Number(r.people) }]));
  const order: Record<string, number> = { button: 0, link: 1, image: 2 };
  const links = linkRows
    .map((l) => ({ id: l.id, idx: l.idx, url: l.url, label: l.label, kind: l.kind, clicks: byLink.get(l.id)?.clicks ?? 0, people: byLink.get(l.id)?.people ?? 0, isTarget: !!t && t.kind === "link" && l.label === t.variantA }))
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || b.people - a.people || a.idx - b.idx);
  const counts = rowsOf(await db.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued,
           count(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS clicked
    FROM email_campaign_recipients WHERE campaign_id = ${campaignId}`))[0] ?? { queued: 0, clicked: 0 };
  if (!t) return { test: null, variants: null, links, clickedCount: Number(counts.clicked), queuedCount: Number(counts.queued) };

  const targetIds = links.filter((l) => l.isTarget).map((l) => l.id);
  const vr = rowsOf(await db.execute(sql`
    SELECT CASE WHEN r.in_test THEN r.variant ELSE 'rest' END AS grp,
           count(*) FILTER (WHERE r.status = 'sent')::int AS sent,
           count(*) FILTER (WHERE r.status = 'sent' AND r.first_opened_at IS NOT NULL)::int AS opened,
           count(*) FILTER (WHERE r.status = 'sent' AND r.first_clicked_at IS NOT NULL)::int AS clicked,
           count(*) FILTER (WHERE r.status = 'sent' AND EXISTS (
             SELECT 1 FROM email_campaign_clicks k WHERE k.recipient_id = r.id AND k.suspected_bot = false
               AND k.link_id = ANY(${sql.raw(`ARRAY[${targetIds.length ? targetIds.join(",") : "0"}]::int[]`)})))::int AS target_clicked
    FROM email_campaign_recipients r WHERE r.campaign_id = ${campaignId} GROUP BY 1`));
  const pick = (g: string): VariantResult => {
    const r = vr.find((x) => String(x.grp) === g);
    return { sent: Number(r?.sent ?? 0), opened: Number(r?.opened ?? 0), clicked: Number(r?.clicked ?? 0), targetClicked: Number(r?.target_clicked ?? 0) };
  };
  const variants = { A: pick("A"), B: pick("B"), rest: pick("rest") };
  const hits = (v: VariantResult) => (t.metric === "opens" ? v.opened : (t.kind === "link" ? v.targetClicked : v.clicked));
  const verdict = chooseWinner({ sent: variants.A.sent, hits: hits(variants.A) }, { sent: variants.B.sent, hits: hits(variants.B) }, t.metric as "opens" | "clicks");
  return {
    test: {
      kind: t.kind, metric: t.metric, variantA: t.variantA, variantB: t.variantB, samplePct: t.samplePct, waitMinutes: t.waitMinutes,
      aCount: t.aCount, bCount: t.bCount, restCount: t.restCount,
      decideAt: t.decideAt ? t.decideAt.toISOString() : null, decidedAt: t.decidedAt ? t.decidedAt.toISOString() : null,
      winner: (t.winner as MailerVariant | null) ?? null, decidedBy: t.decidedBy ?? null, restSentAt: t.restSentAt ? t.restSentAt.toISOString() : null,
      leading: (t.winner as MailerVariant | null) ?? verdict.winner, leadingReason: t.decidedBy ?? verdict.reason, aRate: verdict.aRate, bRate: verdict.bRate,
    },
    variants, links, clickedCount: Number(counts.clicked), queuedCount: Number(counts.queued),
  };
}

// ── Deciding, and sending the rest ──────────────────────────────────────────

type BroadcastQueue = (
  campaignId: number, recipients: string[], sendOne: (email: string, pixelUrl: string) => Promise<boolean>,
  opts?: { pixelHost?: string; finalStatus?: string },
) => Promise<void>;

export interface MailerTestDeps {
  runBroadcastQueue: BroadcastQueue;
  cufcUnsubUrl: (orgId: number, email: string) => string;
  predictorOrgId: () => Promise<number>;
  getUnsubscribedEmails: (orgId: number) => Promise<Set<string>>;
}

/** Stamp the verdict: by the numbers so far, or by hand. A test already
 *  decided keeps its verdict (two machines, or a human and the tick). */
export async function stampVerdict(
  campaignId: number,
  by: { winner?: MailerVariant; userId?: number | null } = {},
): Promise<{ winner: MailerVariant; reason: string }> {
  const [t] = await db.select().from(emailCampaignTests).where(eq(emailCampaignTests.campaignId, campaignId));
  if (!t) throw new Error("This campaign did not run a test.");
  if (t.winner) return { winner: t.winner as MailerVariant, reason: t.decidedBy ?? "" };
  let winner: MailerVariant;
  let reason: string;
  if (by.winner === "A" || by.winner === "B") {
    winner = by.winner; reason = "hand";
  } else {
    const r = await campaignResults(campaignId);
    winner = r.test!.leading; reason = r.test!.leadingReason;
  }
  const stamped = await db.update(emailCampaignTests)
    .set({ winner, decidedBy: reason, decidedAt: new Date(), decidedByUserId: reason === "hand" ? by.userId ?? null : null })
    .where(and(eq(emailCampaignTests.id, t.id), isNull(emailCampaignTests.decidedAt)))
    .returning({ id: emailCampaignTests.id });
  if (stamped.length === 0) {
    const [again] = await db.select().from(emailCampaignTests).where(eq(emailCampaignTests.id, t.id));
    return { winner: (again?.winner as MailerVariant) ?? winner, reason: again?.decidedBy ?? reason };
  }
  return { winner, reason };
}

/** Pick the winner (by the numbers, or by hand) and send it to everyone still
 *  waiting. Safe to call twice: a decided test keeps its verdict, and the
 *  broadcast queue never re-sends a person already marked sent. */
export async function decideCampaignTest(
  campaignId: number,
  deps: MailerTestDeps,
  by: { winner?: MailerVariant; userId?: number | null } = {},
): Promise<{ winner: MailerVariant; reason: string; restSent: number }> {
  const [t] = await db.select().from(emailCampaignTests).where(eq(emailCampaignTests.campaignId, campaignId));
  if (!t) throw new Error("This campaign did not run a test.");
  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId));
  if (!campaign) throw new Error("Campaign not found.");
  const { winner, reason } = await stampVerdict(campaignId, by);

  // Everyone still waiting gets the winner. Re-resolved from the audience so
  // names ride on it, re-checked against the opt-out list so a family that
  // unsubscribed during the wait is left alone.
  const waiting = await db.select({ id: emailCampaignRecipients.id, email: emailCampaignRecipients.email })
    .from(emailCampaignRecipients)
    .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, "queued")));
  if (waiting.length === 0) {
    await db.update(emailCampaignTests).set({ restSentAt: t.restSentAt ?? new Date(), decidingAt: null }).where(eq(emailCampaignTests.id, t.id));
    if (campaign.status === "testing") await db.update(emailCampaigns).set({ status: "sent" }).where(eq(emailCampaigns.id, campaignId));
    return { winner, reason, restSent: 0 };
  }
  await db.update(emailCampaignRecipients).set({ variant: winner })
    .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, "queued")));
  await db.update(emailCampaigns).set({ status: "sending" }).where(eq(emailCampaigns.id, campaignId));

  const orgId = await deps.predictorOrgId();
  const unsubscribed = await deps.getUnsubscribedEmails(orgId);
  const emails = waiting.map((w) => String(w.email).toLowerCase()).filter((e) => !unsubscribed.has(e));
  const skipped = waiting.length - emails.length;
  if (skipped > 0) {
    // Marked failed with no attempt, so the row is not left 'queued' for ever.
    const gone = waiting.filter((w) => unsubscribed.has(String(w.email).toLowerCase())).map((w) => w.id);
    for (const id of gone) await db.update(emailCampaignRecipients).set({ status: "failed" }).where(eq(emailCampaignRecipients.id, id));
  }
  const idByEmail = new Map(waiting.map((w) => [String(w.email).toLowerCase(), w.id]));
  let cfg: any = {};
  try { cfg = JSON.parse(campaign.segmentConfig || "{}"); } catch { cfg = {}; }
  const audience = await resolveMailerAudience(campaign.segmentType, cfg, Array.isArray(cfg?.emails) ? cfg.emails : undefined);
  const links = await db.select().from(emailCampaignLinks).where(eq(emailCampaignLinks.campaignId, campaignId));
  const linkList: EmailLink[] = links.map((l) => ({ idx: l.idx, href: l.url, text: l.label, kind: l.kind as EmailLink["kind"], count: 1 }));
  const plan = { kind: t.kind as MailerTestPlan["kind"], variantA: t.variantA, variantB: t.variantB };
  const att = readMailerAttachments(t.attachments);
  const files = att.ok ? att.files : [];
  const finalWinner = winner;

  await deps.runBroadcastQueue(campaignId, emails, async (email, pixelUrl) => {
    const who = audience.byEmail.get(email);
    const ctx: RecipientContext = {
      email, firstName: who?.firstName ?? null, lastName: who?.lastName ?? null, players: who?.players ?? [],
      unsubscribeUrl: deps.cufcUnsubUrl(orgId, email), pixelUrl,
    };
    const recipientId = idByEmail.get(email);
    const html = recipientId
      ? renderTrackedForRecipient({ campaignId, recipientId, body: campaign.body, links: linkList, plan, variant: finalWinner, ctx })
      : renderForRecipient(bodyForVariant(plan, campaign.body, finalWinner), ctx);
    return sendEmail({
      to: email, from: campaign.fromEmail, replyTo: campaign.replyTo || undefined,
      subject: applyMergeTagsText(subjectForVariant(plan, campaign.subject, finalWinner), ctx),
      html, attachments: files.length ? files : undefined,
    });
  }, { finalStatus: "sent" });

  await db.update(emailCampaignTests).set({ restSentAt: new Date(), decidingAt: null, attachments: null }).where(eq(emailCampaignTests.id, t.id));
  return { winner, reason, restSent: emails.length };
}

let ticking = false;
/** Every minute: claim any test whose wait is over, decide it, send the rest.
 *  A claim older than 30 minutes is treated as a dead machine's and retaken;
 *  the queue's never-re-send rule makes a retake safe. */
export async function tickMailerTests(deps: MailerTestDeps): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = rowsOf(await db.execute(sql`
      UPDATE email_campaign_tests SET deciding_at = now()
      WHERE campaign_id IN (
        SELECT campaign_id FROM email_campaign_tests
        WHERE rest_sent_at IS NULL AND rest_count > 0
          AND (deciding_at IS NULL OR deciding_at < now() - interval '30 minutes')
          AND (decided_at IS NOT NULL OR (decide_at IS NOT NULL AND decide_at <= now()))
        ORDER BY decide_at LIMIT 3)
      RETURNING campaign_id`));
    for (const row of due) {
      const id = Number(row.campaign_id);
      try {
        const r = await decideCampaignTest(id, deps);
        console.log(`[mailer tests] campaign ${id}: ${r.winner} won (${r.reason}), rest sent to ${r.restSent}`);
      } catch (e) {
        console.error(`[mailer tests] campaign ${id} failed:`, e);
        await db.update(emailCampaignTests).set({ decidingAt: null }).where(eq(emailCampaignTests.campaignId, id)).catch(() => {});
      }
    }
  } finally {
    ticking = false;
  }
}

export function startMailerTests(deps: MailerTestDeps): void {
  if (process.env.MAILER_TESTS === "0") { console.log("[mailer tests] disabled by MAILER_TESTS=0"); return; }
  setInterval(() => void tickMailerTests(deps).catch((e) => console.error("[mailer tests] tick error:", e)), 60_000);
  setTimeout(() => void tickMailerTests(deps).catch(() => {}), 20_000);
}

// ── Routes ──────────────────────────────────────────────────────────────────

const ONE_PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export function registerMailerTestRoutes(app: Express, deps: MailerTestDeps) {
  /** The tracked link. Logs the click, flags a scanner, sends the person on. */
  app.get("/e/c/:campaignId/:recipientId/:idx/:sig", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    const campaignId = parseInt(String(req.params.campaignId), 10);
    const recipientId = parseInt(String(req.params.recipientId), 10);
    const idx = parseInt(String(req.params.idx), 10);
    const sig = String(req.params.sig || "");
    if (![campaignId, recipientId, idx].every(Number.isFinite) || clickSignature(campaignId, recipientId, idx) !== sig) {
      return res.status(404).send("This link has expired.");
    }
    try {
      const [link] = await db.select().from(emailCampaignLinks)
        .where(and(eq(emailCampaignLinks.campaignId, campaignId), eq(emailCampaignLinks.idx, idx)));
      const [rcpt] = await db.select().from(emailCampaignRecipients)
        .where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.campaignId, campaignId)));
      if (!link || !rcpt) return res.status(404).send("This link has expired.");

      const ua = String(req.headers["user-agent"] || "");
      let bot = req.method === "HEAD" || isSuspectedBotUserAgent(ua);
      // A sweep: this person "clicked" a DIFFERENT link seconds ago. A reader
      // does not do that; a scanner walking every link does. Flag both.
      if (!bot) {
        const recent = rowsOf(await db.execute(sql`
          SELECT id FROM email_campaign_clicks WHERE recipient_id = ${recipientId} AND link_id <> ${link.id}
            AND clicked_at > now() - make_interval(secs => ${MAILER_CLICK_SWEEP_SECONDS}) LIMIT 5`));
        if (recent.length > 0) {
          bot = true;
          for (const r of recent) await db.update(emailCampaignClicks).set({ suspectedBot: true }).where(eq(emailCampaignClicks.id, Number(r.id)));
          await db.execute(sql`UPDATE email_campaign_recipients SET click_count = GREATEST(0, click_count - ${recent.length}) WHERE id = ${recipientId}`);
        }
      }
      await db.insert(emailCampaignClicks).values({ campaignId, linkId: link.id, recipientId, variant: rcpt.variant ?? null, userAgent: ua.slice(0, 500) || null, suspectedBot: bot });
      if (!bot) {
        await db.update(emailCampaignRecipients).set({
          firstClickedAt: sql`coalesce(${emailCampaignRecipients.firstClickedAt}, now())`,
          clickCount: sql`${emailCampaignRecipients.clickCount} + 1`,
          // A click is proof of an open even when the pixel never loaded.
          firstOpenedAt: sql`coalesce(${emailCampaignRecipients.firstOpenedAt}, now())`,
        }).where(eq(emailCampaignRecipients.id, recipientId));
      }

      // On to the real page, carrying attribution for our own sites (the same
      // utm + ci every broadcast link would have carried before tracking).
      let dest = link.url;
      try {
        const ci = emailClickToken(await deps.predictorOrgId(), campaignId, rcpt.email);
        dest = instrumentUrl(link.url, { medium: "broadcast", campaign: `mailer-${campaignId}`, ci });
      } catch { dest = link.url; }
      return res.redirect(302, dest);
    } catch (e) {
      console.error("[mailer click] error:", e);
      return res.status(404).send("This link has expired.");
    }
  });

  /** A transparent pixel for a HEAD probe on the click path — some scanners
   *  ask for one; answering keeps them from retrying with GET. */
  app.head("/e/c/:campaignId/:recipientId/:idx/:sig", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Length", String(ONE_PIXEL.length));
    res.status(200).end();
  });

  /** The email exactly as ONE person would get it — their names in the tags,
   *  the subject resolved, the unsubscribe footer — without sending anything. */
  app.post("/api/admin/mailer/preview-as", requireAuth, async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const subject = String(req.body?.subject ?? "");
      const body = String(req.body?.body ?? "");
      const variant: MailerVariant = req.body?.variant === "B" ? "B" : "A";
      const planRaw = req.body?.test;
      const plan = planRaw && typeof planRaw === "object" && (planRaw.kind === "subject" || planRaw.kind === "link")
        ? { kind: planRaw.kind as MailerTestPlan["kind"], variantA: String(planRaw.variantA ?? planRaw.target ?? ""), variantB: String(planRaw.variantB ?? planRaw.b ?? "") }
        : null;
      if (!email.includes("@")) return res.status(400).json({ message: "Pick a person to preview as." });
      const who = await lookupMailerRecipient(email);
      const orgId = await deps.predictorOrgId();
      const ctx: RecipientContext = { email, firstName: who.firstName, lastName: who.lastName, players: who.players, unsubscribeUrl: deps.cufcUnsubUrl(orgId, email) };
      res.json({
        email,
        name: [who.firstName, who.lastName].filter(Boolean).join(" ") || null,
        players: who.players.map((p) => `${p.firstName} ${p.lastName ?? ""}`.trim()),
        subject: applyMergeTagsText(subjectForVariant(plan, subject, variant), ctx),
        html: renderForRecipient(bodyForVariant(plan, body, variant), ctx),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** The tests still running (the Mailer shows a strip; the deploy canary). */
  app.get("/api/admin/mailer/tests", requireAuth, async (_req: Request, res: Response) => {
    try {
      const rows = rowsOf(await db.execute(sql`
        SELECT t.campaign_id, c.subject, t.kind, t.metric, t.variant_a, t.variant_b, t.a_count, t.b_count, t.rest_count, t.decide_at, t.decided_at, t.winner, t.rest_sent_at, c.status
        FROM email_campaign_tests t JOIN email_campaigns c ON c.id = t.campaign_id
        WHERE t.rest_sent_at IS NULL AND t.rest_count > 0 ORDER BY t.decide_at ASC LIMIT 20`));
      res.json({ tests: rows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** The results of one campaign: the test (if any), each version's numbers,
   *  every link and its clicks. */
  app.get("/api/admin/mailer/campaigns/:id/results", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid campaign id" });
      res.json(await campaignResults(id));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** Pick the winner now — by the numbers so far, or by hand ("B", whatever
   *  the numbers say) — and send it to everyone waiting. */
  app.post("/api/admin/mailer/campaigns/:id/test/decide", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid campaign id" });
      const [t] = await db.select().from(emailCampaignTests).where(eq(emailCampaignTests.campaignId, id));
      if (!t) return res.status(404).json({ message: "This campaign did not run a test." });
      if (t.restSentAt) return res.status(409).json({ message: "The winner has already gone to everyone." });
      if (t.restCount === 0) return res.status(409).json({ message: "Everyone was in this test — there is nobody waiting for a winner." });
      const winner = req.body?.winner === "A" || req.body?.winner === "B" ? (req.body.winner as MailerVariant) : undefined;
      // Claim it the way the tick does, so the tick cannot start the same send.
      const claimed = await db.update(emailCampaignTests).set({ decidingAt: new Date() })
        .where(and(eq(emailCampaignTests.id, t.id), sql`(${emailCampaignTests.decidingAt} IS NULL OR ${emailCampaignTests.decidingAt} < now() - interval '30 minutes')`))
        .returning({ id: emailCampaignTests.id });
      if (claimed.length === 0) return res.status(409).json({ message: "The winner is being sent right now." });
      // The verdict is stamped before the reply; the send runs on after it
      // (3,000 people is half an hour at the queue's pace).
      const verdict = await stampVerdict(id, { winner, userId: (req.session as any)?.userId ?? null });
      decideCampaignTest(id, deps).catch(async (e) => {
        console.error(`[mailer tests] hand decision for ${id} failed:`, e);
        await db.update(emailCampaignTests).set({ decidingAt: null }).where(eq(emailCampaignTests.id, t.id)).catch(() => {});
      });
      res.json({ ok: true, winner: verdict.winner, decidedBy: verdict.reason, sending: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
