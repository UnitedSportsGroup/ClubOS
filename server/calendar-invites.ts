// Calendar invitation + reminder service.
//
// Generates RFC 5545 .ics files (so events drop into Google / Apple / Outlook
// calendars on click), sends invitation emails with the .ics attached + RSVP
// links, and dispatches reminder emails N minutes before each event.
//
// The reminder cron is a single setInterval that runs every 60 seconds —
// any reminder whose (event.startTime - offsetMinutes) has passed and which
// hasn't been sent yet gets dispatched. Idempotent: marks sent_at after.

import crypto from "crypto";
import { db } from "./db";
import { eq, and, isNull, lte, sql } from "drizzle-orm";
import { calendarEvents, eventInvitees, eventReminders, users, organizations } from "@shared/schema";
import { sendEmail } from "./email";

const PUBLIC_BASE_URL = process.env.PUBLIC_APP_URL || "https://clubos.fly.dev";
const FROM = "ClubOS <noreply@cufc.co.nz>";

// ── ICS generator ────────────────────────────────────────────────────────────

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function toIcsDate(d: Date, allDay: boolean): string {
  if (allDay) {
    // VALUE=DATE form, midnight-aligned, no Z suffix
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  }
  // UTC datetime with Z suffix
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// RFC 5545 escapes: \, ;, , and newlines
function icsEscape(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Fold long lines per RFC (75 octets). Crude byte-length approximation — fine
// for our text since it's mostly ASCII.
function foldLines(lines: string[]): string {
  return lines.map(line => {
    if (line.length <= 75) return line;
    const parts: string[] = [];
    let i = 0;
    while (i < line.length) {
      parts.push((i === 0 ? "" : " ") + line.substring(i, Math.min(i + 75, line.length)));
      i += 75;
    }
    return parts.join("\r\n");
  }).join("\r\n");
}

interface IcsEventInput {
  uid: string;                  // stable unique id (e.g. clubos-event-{eventId}@cufc.co.nz)
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  organizerEmail: string;
  organizerName: string;
  attendees: Array<{ email: string; name: string | null; rsvp?: "ACCEPTED" | "DECLINED" | "TENTATIVE" | "NEEDS-ACTION" }>;
  url?: string;                 // public link back to ClubOS event
}

export function buildIcs(e: IcsEventInput): string {
  const dtPrefix = e.allDay ? ";VALUE=DATE" : "";
  const dtStart = `DTSTART${dtPrefix}:${toIcsDate(e.startTime, e.allDay)}`;
  const dtEnd = `DTEND${dtPrefix}:${toIcsDate(e.endTime, e.allDay)}`;
  const stamp = toIcsDate(new Date(), false);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClubOS//CUFC Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp}`,
    dtStart,
    dtEnd,
    `SUMMARY:${icsEscape(e.title)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`ORGANIZER;CN=${icsEscape(e.organizerName)}:mailto:${e.organizerEmail}`);
  for (const a of e.attendees) {
    const partstat = a.rsvp || "NEEDS-ACTION";
    const cn = a.name ? `;CN=${icsEscape(a.name)}` : "";
    lines.push(`ATTENDEE${cn};RSVP=TRUE;PARTSTAT=${partstat}:mailto:${a.email}`);
  }
  lines.push("STATUS:CONFIRMED", "SEQUENCE:0", "END:VEVENT", "END:VCALENDAR");
  return foldLines(lines) + "\r\n";
}

// ── Token / link helpers ─────────────────────────────────────────────────────

export function generateRsvpToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function rsvpLink(token: string, status: "accepted" | "tentative" | "declined"): string {
  return `${PUBLIC_BASE_URL}/calendar/rsvp/${token}?status=${status}`;
}

function eventLink(eventId: number): string {
  return `${PUBLIC_BASE_URL}/admin/calendar?event=${eventId}`;
}

// ── Time formatting for emails ───────────────────────────────────────────────

function formatEventTime(start: Date, end: Date, allDay: boolean): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Pacific/Auckland",
  };
  if (allDay) return new Intl.DateTimeFormat("en-NZ", opts).format(start) + " (all day)";
  const startStr = new Intl.DateTimeFormat("en-NZ", { ...opts, hour: "numeric", minute: "2-digit", hour12: true }).format(start);
  const endStr = new Intl.DateTimeFormat("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Pacific/Auckland" }).format(end);
  return `${startStr} – ${endStr}`;
}

// ── Email templates ──────────────────────────────────────────────────────────

function inviteHtml(opts: {
  eventTitle: string;
  eventTimeStr: string;
  eventLocation: string | null;
  eventDescription: string | null;
  organizerName: string;
  inviteeName: string | null;
  acceptUrl: string;
  tentativeUrl: string;
  declineUrl: string;
  eventUrl: string;
}): string {
  const greeting = opts.inviteeName ? `Hi ${opts.inviteeName.split(" ")[0]},` : "Hi,";
  const locationLine = opts.eventLocation ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:80px;vertical-align:top">📍 Where</td><td style="padding:6px 0;color:#0f172a;font-size:14px">${opts.eventLocation}</td></tr>` : "";
  const descBlock = opts.eventDescription ? `<div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border-radius:8px;border-left:3px solid #cbd5e1;font-size:13px;line-height:1.55;color:#334155">${opts.eventDescription.replace(/\n/g, "<br>")}</div>` : "";
  return `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#0f172a">
    <div style="background:linear-gradient(135deg,#0356c5 0%,#1e88e5 100%);color:white;padding:28px;border-radius:14px 14px 0 0">
      <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;opacity:0.85;font-weight:600">You're invited</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;letter-spacing:-0.01em">${opts.eventTitle}</h1>
    </div>
    <div style="background:white;border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 14px 14px">
      <p style="font-size:15px;line-height:1.55;margin:0 0 18px">${greeting}</p>
      <p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#475569"><b style="color:#0f172a">${opts.organizerName}</b> has invited you to a ClubOS calendar event.</p>
      <table style="width:100%;border-collapse:collapse;margin:8px 0 16px">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:80px;vertical-align:top">🕐 When</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:500">${opts.eventTimeStr}</td></tr>
        ${locationLine}
      </table>
      ${descBlock}
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f1f5f9">
        <p style="font-size:13px;color:#64748b;margin:0 0 12px;font-weight:500">Will you attend?</p>
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:8px"><a href="${opts.acceptUrl}" style="display:inline-block;background:#10b981;color:white;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:500">✓ Yes</a></td>
            <td style="padding-right:8px"><a href="${opts.tentativeUrl}" style="display:inline-block;background:#f59e0b;color:white;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:500">Maybe</a></td>
            <td><a href="${opts.declineUrl}" style="display:inline-block;background:#ef4444;color:white;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:500">✗ No</a></td>
          </tr>
        </table>
      </div>
      <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;line-height:1.55">
        The .ics file attached to this email lets you add this event to Google Calendar, Apple Calendar, or Outlook in one click.
        <br><a href="${opts.eventUrl}" style="color:#0356c5;text-decoration:none">Open in ClubOS →</a>
      </p>
    </div>
  </div>`;
}

function reminderHtml(opts: {
  eventTitle: string;
  eventTimeStr: string;
  eventLocation: string | null;
  inviteeName: string | null;
  offsetMinutes: number;
  eventUrl: string;
}): string {
  const greeting = opts.inviteeName ? `Hi ${opts.inviteeName.split(" ")[0]},` : "Hi,";
  const whenLabel = formatOffset(opts.offsetMinutes);
  const locationLine = opts.eventLocation ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:80px;vertical-align:top">📍 Where</td><td style="padding:6px 0;color:#0f172a;font-size:14px">${opts.eventLocation}</td></tr>` : "";
  return `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#0f172a">
    <div style="background:linear-gradient(135deg,#f59e0b 0%,#ea580c 100%);color:white;padding:24px 28px;border-radius:14px 14px 0 0">
      <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;opacity:0.85;font-weight:600">⏰ Reminder · in ${whenLabel}</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;letter-spacing:-0.01em">${opts.eventTitle}</h1>
    </div>
    <div style="background:white;border:1px solid #e2e8f0;border-top:none;padding:28px;border-radius:0 0 14px 14px">
      <p style="font-size:15px;line-height:1.55;margin:0 0 18px">${greeting}</p>
      <p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#475569">Quick reminder — your upcoming event starts soon.</p>
      <table style="width:100%;border-collapse:collapse;margin:8px 0 16px">
        <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:80px;vertical-align:top">🕐 When</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:500">${opts.eventTimeStr}</td></tr>
        ${locationLine}
      </table>
      <p style="margin:24px 0 0"><a href="${opts.eventUrl}" style="display:inline-block;color:#0356c5;text-decoration:none;font-size:13px;font-weight:500">Open in ClubOS →</a></p>
    </div>
  </div>`;
}

function formatOffset(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 1440) {
    const h = Math.round(min / 60);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  if (min < 10080) {
    const d = Math.round(min / 1440);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  const w = Math.round(min / 10080);
  return `${w} week${w === 1 ? "" : "s"}`;
}

// ── Public functions ─────────────────────────────────────────────────────────

export async function sendInvitationEmail(eventId: number, inviteeId: number): Promise<boolean> {
  const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
  if (!event) return false;
  const [invitee] = await db.select().from(eventInvitees).where(eq(eventInvitees.id, inviteeId));
  if (!invitee) return false;

  const [organizer] = event.createdBy
    ? await db.select().from(users).where(eq(users.id, event.createdBy))
    : [];
  const orgName = organizer ? `${organizer.firstName} ${organizer.lastName}` : "ClubOS";
  const orgEmail = organizer?.email || "noreply@cufc.co.nz";

  const startTime = new Date(event.startTime);
  const endTime = new Date(event.endTime);
  const timeStr = formatEventTime(startTime, endTime, event.allDay);

  // ICS with this single attendee marked NEEDS-ACTION
  const ics = buildIcs({
    uid: `clubos-event-${event.id}@cufc.co.nz`,
    title: event.title,
    description: event.description,
    location: event.location,
    startTime,
    endTime,
    allDay: event.allDay,
    organizerEmail: orgEmail,
    organizerName: orgName,
    attendees: [{ email: invitee.email, name: invitee.name, rsvp: "NEEDS-ACTION" }],
    url: eventLink(event.id),
  });
  const icsB64 = Buffer.from(ics, "utf-8").toString("base64");

  const ok = await sendEmail({
    to: invitee.email,
    from: FROM,
    replyTo: orgEmail,
    subject: `Invitation: ${event.title}`,
    html: inviteHtml({
      eventTitle: event.title,
      eventTimeStr: timeStr,
      eventLocation: event.location,
      eventDescription: event.description,
      organizerName: orgName,
      inviteeName: invitee.name,
      acceptUrl: rsvpLink(invitee.rsvpToken, "accepted"),
      tentativeUrl: rsvpLink(invitee.rsvpToken, "tentative"),
      declineUrl: rsvpLink(invitee.rsvpToken, "declined"),
      eventUrl: eventLink(event.id),
    }),
    attachments: [{
      filename: "invite.ics",
      content: icsB64,
      contentType: "text/calendar; charset=utf-8; method=REQUEST",
    }],
  });

  if (ok) {
    await db.update(eventInvitees).set({ inviteEmailSentAt: new Date() }).where(eq(eventInvitees.id, inviteeId));
  }
  return ok;
}

async function sendReminderEmail(eventId: number, reminderId: number, offsetMinutes: number): Promise<void> {
  const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
  if (!event) return;
  // Reminder goes to every accepted/tentative/pending invitee. Declined skipped.
  const invitees = await db.select().from(eventInvitees)
    .where(and(eq(eventInvitees.eventId, eventId), sql`rsvp_status != 'declined'`));
  if (invitees.length === 0) return;

  const startTime = new Date(event.startTime);
  const endTime = new Date(event.endTime);
  const timeStr = formatEventTime(startTime, endTime, event.allDay);

  for (const inv of invitees) {
    await sendEmail({
      to: inv.email,
      from: FROM,
      subject: `Reminder: ${event.title} in ${formatOffset(offsetMinutes)}`,
      html: reminderHtml({
        eventTitle: event.title,
        eventTimeStr: timeStr,
        eventLocation: event.location,
        inviteeName: inv.name,
        offsetMinutes,
        eventUrl: eventLink(event.id),
      }),
    });
  }
}

// ── Reminder cron ────────────────────────────────────────────────────────────

let cronRunning = false;
async function reminderSweep() {
  if (cronRunning) return;
  cronRunning = true;
  try {
    // A reminder is due when: (event.startTime - offsetMinutes * 60s) <= now AND sentAt IS NULL
    // We also skip reminders for events already in the past (no point sending a "10 min before"
    // reminder for an event that started yesterday).
    const now = new Date();
    const due = await db.execute(sql`
      SELECT r.id AS reminder_id, r.event_id, r.offset_minutes
      FROM event_reminders r
      JOIN calendar_events e ON e.id = r.event_id
      WHERE r.sent_at IS NULL
        AND e.start_time > ${now}
        AND (e.start_time - (r.offset_minutes || ' minutes')::interval) <= ${now}
      LIMIT 100
    `);
    for (const row of (due as any).rows) {
      try {
        await sendReminderEmail(row.event_id, row.reminder_id, row.offset_minutes);
        await db.update(eventReminders).set({ sentAt: new Date() }).where(eq(eventReminders.id, row.reminder_id));
      } catch (err: any) {
        console.error(`[CalendarCron] Reminder ${row.reminder_id} failed:`, err?.message);
      }
    }
  } catch (err: any) {
    console.error("[CalendarCron] Sweep failed:", err?.message);
  } finally {
    cronRunning = false;
  }
}

export function startReminderCron() {
  setInterval(reminderSweep, 60 * 1000);                  // every 60s
  setTimeout(reminderSweep, 30 * 1000);                   // first run 30s after boot
  console.log("[CalendarCron] Reminder sweeper scheduled (every 60s)");
}
