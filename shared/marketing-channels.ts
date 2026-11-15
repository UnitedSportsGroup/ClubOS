/**
 * Marketing channels — Email, SMS, Paid ads and WhatsApp, each its own tab
 * under United Sports Group → Marketing.
 *
 * Daniel, 2026-11-10: "Build a tab for SMS … a tab for emails so we can track
 * all of that … a tab for paid ads, and also a tab for WhatsApp … the
 * foundational stuff, all built and mapped out."
 *
 * Each tab reports only what ClubOS really holds. Where a channel is not
 * connected yet, the tab says so and lists what a person has to do — it never
 * shows a zero that means "we cannot see".
 */
import type { DateRange } from "./dashboard";

export const EMAIL_TAB = "email-stats";
export const SMS_TAB = "sms-stats";
export const PAID_ADS_TAB = "paid-ads";
export const WHATSAPP_TAB = "whatsapp-stats";

/** Which brand an email was sent as, read off the sender's address. */
export const EMAIL_BRAND_BY_DOMAIN: Record<string, string> = {
  "cufc.co.nz": "Christchurch United",
  "southislandunited.com": "South Island United",
  "minifootball.co.nz": "Mini Football Leagues",
  "cicyouth.com": "Christchurch International Cup",
  "cic7s.com": "CIC 7's",
  "ethniccup.com": "Ethnic Cup",
  "cugc.co.nz": "United Gymnastics",
  "unitedprints.co.nz": "United Prints",
  "unitedsportscentre.com": "United Sports Centre",
};

export function emailDomain(from: string | null | undefined): string {
  const m = /@([a-z0-9.-]+)/i.exec(String(from ?? ""));
  return m ? m[1].toLowerCase() : "";
}

export type EmailCampaignRow = {
  id: number;
  subject: string;
  from: string;
  brand: string;
  status: string;
  /** NZ day it was sent (or created, if it never finished). */
  day: string;
  recipients: number;
  sent: number;
  failed: number;
  /** null = this send was before opens were recorded per person. */
  tracked: number | null;
  opened: number | null;
  clicked: number | null;
  /** Still marked "sending" hours later: it stopped part-way. */
  stalled: boolean;
};

export type EmailReport = {
  range: DateRange;
  totals: {
    campaigns: number;
    sent: number;
    failed: number;
    tracked: number;
    opened: number;
    clicked: number;
    /** Mailer sends to fewer than ten people: counted, never listed (subjects carry names). */
    oneToOne: number;
    /** Receipts, confirmations and other one-to-one emails ClubOS sent. */
    otherEmails: number;
    unsubscribes: number;
    bouncesPermanent: number;
    bouncesTemporary: number;
    complaints: number;
  };
  series: { date: string; sent: number }[];
  byBrand: { brand: string; campaigns: number; sent: number; opened: number; tracked: number }[];
  campaigns: EmailCampaignRow[];
  stalled: EmailCampaignRow[];
  automations: { id: number; name: string; status: string; sends: number }[];
};

export type SmsReport = {
  range: DateRange;
  /** The sender ClubOS is set to use; "dryrun" = nothing really sends. */
  provider: string;
  live: boolean;
  totals: { sent: number; delivered: number; failed: number; costCents: number; tests: number; replies: number };
  /** People who have said yes to texts, of everyone on the marketing list. */
  consent: { canText: number; profiles: number; withMobile: number };
  series: { date: string; sent: number }[];
  messages: { id: number; day: string; to: string; body: string; status: string; marketing: boolean; costCents: number | null; test: boolean }[];
};

export type WhatsAppReport = {
  range: DateRange;
  /** Presses on a WhatsApp link, on websites that record presses. */
  linkClicks: number;
  linkVisitors: number;
  links: { href: string; clicks: number }[];
  series: { date: string; clicks: number }[];
  /** True once a WhatsApp Business sender is configured on the server. */
  connected: boolean;
};
