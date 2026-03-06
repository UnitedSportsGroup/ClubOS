import { storage } from "./storage";

const META_PIXEL_ID = process.env.META_PIXEL_ID || "";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";
const META_API_VERSION = "v19.0";

interface ServerEvent {
  eventName: string;
  eventId: string;
  eventTime: number;
  userAgent?: string;
  sourceUrl?: string;
  ipAddress?: string;
  fbp?: string;
  fbc?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  customData?: Record<string, any>;
  campId?: number;
  registrationId?: number;
}

function hashSha256(value: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export async function sendServerEvent(event: ServerEvent): Promise<boolean> {
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    console.log("[Meta CAPI] Skipping — META_PIXEL_ID or META_ACCESS_TOKEN not configured");
    return false;
  }

  const userData: Record<string, any> = {};
  if (event.email) userData.em = [hashSha256(event.email)];
  if (event.phone) userData.ph = [hashSha256(event.phone)];
  if (event.firstName) userData.fn = [hashSha256(event.firstName)];
  if (event.lastName) userData.ln = [hashSha256(event.lastName)];
  if (event.fbp) userData.fbp = event.fbp;
  if (event.fbc) userData.fbc = event.fbc;
  if (event.ipAddress) userData.client_ip_address = event.ipAddress;
  if (event.userAgent) userData.client_user_agent = event.userAgent;

  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        event_source_url: event.sourceUrl,
        action_source: "website",
        user_data: userData,
        custom_data: event.customData || {},
      },
    ],
  };

  try {
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    const success = res.ok;

    try {
      await storage.createMetaEventLog({
        campId: event.campId || null,
        registrationId: event.registrationId || null,
        eventName: event.eventName,
        payloadJson: JSON.stringify(payload),
        success,
      });
    } catch (e) {
      console.error("[Meta CAPI] Failed to log event:", e);
    }

    if (!success) {
      console.error("[Meta CAPI] API error:", JSON.stringify(result));
    }

    return success;
  } catch (error) {
    console.error("[Meta CAPI] Request failed:", error);
    return false;
  }
}

export async function sendPurchaseEvent(params: {
  registrationId: number;
  campId: number;
  totalCents: number;
  currency: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  fbp?: string;
  fbc?: string;
  userAgent?: string;
  ipAddress?: string;
  sourceUrl?: string;
  eventId: string;
}): Promise<boolean> {
  return sendServerEvent({
    eventName: "Purchase",
    eventId: params.eventId,
    eventTime: Math.floor(Date.now() / 1000),
    email: params.email,
    phone: params.phone,
    firstName: params.firstName,
    lastName: params.lastName,
    fbp: params.fbp,
    fbc: params.fbc,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    sourceUrl: params.sourceUrl,
    campId: params.campId,
    registrationId: params.registrationId,
    customData: {
      value: params.totalCents / 100,
      currency: params.currency,
      content_type: "product",
      content_ids: [String(params.campId)],
    },
  });
}
