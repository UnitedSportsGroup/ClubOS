// Scheduled jobs for the print MIS. Currently:
//  - Upload reminder: 24h after a paid order with no artwork uploaded,
//    email the customer a magic-link nudge. One reminder per order
//    (tracked via a 'upload_reminder_sent' event so we don't spam).

import { db } from "./db";
import { printOrders, printOrderEvents, printOrderFiles } from "@shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { storage } from "./storage";
import { emailUploadReminder } from "./print-email";

// Statuses where the customer still owes us artwork.
const NEEDS_ARTWORK_STATUSES = ["paid", "artwork_pending"];

export async function runUploadReminderSweep(): Promise<void> {
  try {
    const cutoffNew = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cutoffOld = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);  // don't bother with very stale orders

    const candidates = await db.select().from(printOrders)
      .where(and(
        sql`${printOrders.status} = ANY(ARRAY['paid','artwork_pending']::print_order_status[])`,
        lte(printOrders.createdAt, cutoffNew),
        gte(printOrders.createdAt, cutoffOld),
      ));

    let sent = 0;
    for (const order of candidates) {
      // Skip if files already uploaded
      const files = await storage.getPrintOrderFiles(order.id);
      if (files.length > 0) continue;

      // Skip if reminder already sent (event check)
      const events = await storage.getPrintOrderEvents(order.id);
      if (events.some(e => e.eventType === "upload_reminder_sent")) continue;

      // Skip if no email or no token
      if (!order.customerEmail || !order.magicLinkToken) continue;

      try {
        await emailUploadReminder(order);
        await storage.createPrintOrderEvent({
          orderId: order.id,
          eventType: "upload_reminder_sent",
          notes: "Automated 24hr nudge — customer still owes artwork",
          metadataJson: { sweptAt: new Date().toISOString() },
        } as any);
        sent++;
      } catch (e: any) {
        console.error(`[PrintCron] reminder for order ${order.id} failed:`, e.message);
      }
    }

    if (sent > 0) console.log(`[PrintCron] Upload reminders sent: ${sent}`);
  } catch (e: any) {
    console.error("[PrintCron] sweep failed:", e.message);
  }
}

// Hook this into the existing setInterval pattern in server/index.ts.
// Runs every 4 hours — frequent enough to catch the 24-hour cutoff
// reasonably tightly, infrequent enough to avoid hammering the DB.
export function startPrintCron(): void {
  setInterval(runUploadReminderSweep, 4 * 60 * 60 * 1000);
  // First run 5 min after server boot so we don't block startup.
  setTimeout(runUploadReminderSweep, 5 * 60 * 1000);
  console.log("[PrintCron] Upload-reminder sweep scheduled (every 4h)");
}
