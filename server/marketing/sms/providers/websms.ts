// Marketing Suite — WebSMS (NZ) provider adapter, on the CONNEXUS API.
//
// websms.co.nz is the club's chosen SMS provider (decision 30 Sep 2026,
// outputs/sms/2026-09-30-sms-provider-decision.md): ~10c NZD a segment, no monthly fee,
// a free shared short code, STOP handled at their end.
//
// 🔴 This replaced an adapter written in July against websms's LEGACY send.php API
// (username + password in a GET query string), which was never run against a live account
// and could not even read the sender's number off an inbound reply. Connexus is what websms
// recommends for new integrations and what this workspace has PROVEN live: the Katerina's
// Beauty adapter (apps/katerinas-beauty/api/_lib/sms.ts) has sent real texts through it since
// 17 Sep 2026. Everything that adapter learned the hard way is kept here:
//
//   • OAUTH2, NOT A STATIC KEY. client id + secret → POST /auth/token → a bearer good for 24h.
//     Cached per process, refreshed a minute early; a 401 drops it and retries ONCE.
//   • THE VERDICT IS PER MESSAGE, AT HTTP 200. An account with no credit answers
//     {"success":false,"message":"Insufficient funds"} with a 200. Only `success !== false`
//     on the response (and on messages[0] when present) counts as accepted.
//   • websms HOLDS any message containing a URL for manual approval unless the domain is
//     whitelisted in the members area. Whitelist the club domains before a campaign links out.
//   • NZ has NO alphanumeric sender IDs on this route: texts arrive from a shared short code,
//     so the body must name the club.
//
// Connexus reference (fetched 1 Oct 2026): https://api.websms.co.nz/api/connexus/
//   POST /sms/out  { to, body, messageClass: "transactional"|"marketing", from?, messageId? (≤36),
//                    sandbox? }  →  { success, status, message_id, parts, ... }
//   DLR webhook    POST JSON { type:"dlr", messageId, status, statusCode, timestamp, customerMessageId }
//                  statusCode 1 DELIVRD · 2/16 UNDELIV · 4 QUEUED · 8 ACCEPTD · -1 BLOCKED
//   Inbound        POST JSON { type:"SMS", messageId, from:"+64…", body, timestamp, replyTo… }
//   Webhooks are configured in the members area (not per send), no signature scheme.
//
// Env: WEBSMS_CLIENT_ID · WEBSMS_CLIENT_SECRET · optional WEBSMS_FROM (a dedicated code, later)
//      · optional WEBSMS_SANDBOX=1 (websms accepts and bills nothing) · WEBSMS_API_BASE_URL.

import type {
  ProviderRequest,
  SmsDeliveryReceipt,
  SmsDeliveryStatus,
  SmsInboundMessage,
  SmsProvider,
  SmsSendInput,
  SmsSendResult,
} from "../types";
import { analyzeSms, estimateCost } from "../encoding";

const DEFAULT_BASE_URL = "https://api.websms.co.nz/api/connexus";

function readCentsPerSegment(): number {
  const raw = process.env.SMS_COST_CENTS_PER_SEGMENT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

/** Connexus examples use dialling format without the '+' ("6421234567"). */
function toNzDiallingFormat(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

/** Inbound `from` arrives as "+64…"; make sure it is E.164 either way so STOP joins the right profile. */
function toE164(raw: string): string {
  const s = raw.trim();
  return s.startsWith("+") ? s : `+${s.replace(/^0+/, "")}`;
}

/**
 * Connexus DLR status codes → our terminal statuses. ACCEPTD (8) is in-flight, so null:
 * the caller waits for the terminal receipt rather than recording a fake one. QUEUED (4) is
 * documented as "expired/queued"; it is only terminal when the carrier gave up, so it maps
 * to expired. BLOCKED (-1) is websms refusing an unsubscribed or invalid number itself.
 */
export function mapConnexusStatus(code: number): SmsDeliveryStatus | null {
  switch (code) {
    case 1: return "delivered";
    case 2:
    case 16:
    case -1: return "failed";
    case 4: return "expired";
    default: return null; // 8 = ACCEPTD, anything new = not terminal
  }
}

function readParams(req: ProviderRequest): Record<string, any> | null {
  if (typeof req.body === "object" && req.body !== null && Object.keys(req.body as object).length) {
    return req.body as Record<string, any>;
  }
  if (req.query && Object.keys(req.query).length) return req.query;
  return null;
}

/** Unix seconds (Connexus) or ms → Date; falls back to now. */
function toDate(ts: unknown): Date {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n);
}

// One token per process. Prod runs two Fly machines; each fetches its own, which is fine.
let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

export class WebSmsProvider implements SmsProvider {
  readonly name = "websms";
  private warnedNoSignature = false;

  private get clientId(): string {
    const v = process.env.WEBSMS_CLIENT_ID;
    if (!v) throw new Error("[sms/websms] WEBSMS_CLIENT_ID is not set — create an API key in the websms members area (see sms/README.md).");
    return v;
  }

  private get clientSecret(): string {
    const v = process.env.WEBSMS_CLIENT_SECRET;
    if (!v) throw new Error("[sms/websms] WEBSMS_CLIENT_SECRET is not set (shown once when the API key is created; rotate it if lost).");
    return v;
  }

  private get baseUrl(): string {
    return (process.env.WEBSMS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async token(force = false): Promise<string> {
    const key = this.clientId; // a rotated id invalidates the cache
    if (!force && cachedToken && cachedToken.key === key && Date.now() < cachedToken.expiresAt) return cachedToken.value;
    const res = await fetch(`${this.baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: key, client_secret: this.clientSecret }),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !j.access_token) throw new Error(`[sms/websms] auth failed (HTTP ${res.status})`);
    cachedToken = { value: j.access_token, key, expiresAt: Date.now() + ((j.expires_in ?? 86400) - 60) * 1000 };
    return cachedToken.value;
  }

  private post(token: string, payload: Record<string, unknown>) {
    return fetch(`${this.baseUrl}/sms/out`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async send(msg: SmsSendInput): Promise<SmsSendResult> {
    const analysis = analyzeSms(msg.body);
    const from = msg.senderId || process.env.WEBSMS_FROM;
    const payload: Record<string, unknown> = {
      to: toNzDiallingFormat(msg.to),
      body: msg.body,
      // Routes the text onto the right shared short code. Default MARKETING: a promotional
      // text sent as "transactional" is a misclassification websms can act on; the reverse
      // only costs a STOP line the caller already adds for marketing.
      messageClass: msg.messageClass ?? "marketing",
      ...(from ? { from } : {}),
      // Our own reference comes back on the DLR as customerMessageId. Connexus caps it at 36
      // characters, so a longer ref is left off rather than truncated into a collision.
      ...(msg.clientRef && msg.clientRef.length <= 36 ? { messageId: msg.clientRef } : {}),
      ...(process.env.WEBSMS_SANDBOX === "1" ? { sandbox: true } : {}),
    };

    let token = await this.token();
    let res = await this.post(token, payload);
    if (res.status === 401) {
      token = await this.token(true);
      res = await this.post(token, payload);
    }
    const j = (await res.json().catch(() => ({}))) as {
      success?: boolean; status?: string; message?: string; error?: string;
      message_id?: string | number; parts?: number;
      messages?: { success?: boolean; message?: string; error?: string; message_id?: string | number; parts?: number }[];
    };
    const m = j.messages?.[0] ?? j;
    if (!res.ok || j.success === false || m.success === false) {
      throw new Error(`[sms/websms] send refused: ${m.message ?? m.error ?? j.message ?? `HTTP ${res.status}`}`);
    }
    const providerMessageId = m.message_id != null ? String(m.message_id) : "";
    if (!providerMessageId) throw new Error(`[sms/websms] accepted but no message_id in response: ${JSON.stringify(j).slice(0, 200)}`);

    // Bill on what websms says it split the message into, falling back to our own count.
    const segments = typeof m.parts === "number" && m.parts > 0 ? m.parts : analysis.segments;
    return {
      providerMessageId,
      segments,
      costCentsEstimate: estimateCost(segments, 1, readCentsPerSegment()),
    };
  }

  parseDeliveryReceipt(req: ProviderRequest): SmsDeliveryReceipt | null {
    const p = readParams(req);
    if (!p) return null;
    if (String(p.type ?? "").toLowerCase() !== "dlr") return null;
    const id = p.messageId ?? p.message_id;
    const code = Number(p.statusCode);
    if (id == null || !Number.isFinite(code)) return null;
    const status = mapConnexusStatus(code);
    if (!status) return null;
    return { providerMessageId: String(id), status, at: toDate(p.timestamp) };
  }

  parseInbound(req: ProviderRequest): SmsInboundMessage | null {
    const p = readParams(req);
    if (!p) return null;
    if (String(p.type ?? "").toUpperCase() !== "SMS") return null;
    if (!p.from || p.body == null) return null;
    return {
      from: toE164(String(p.from)),
      body: String(p.body),
      providerMessageId: p.messageId != null ? String(p.messageId) : undefined,
      at: toDate(p.timestamp),
    };
  }

  verifyWebhook(_req: ProviderRequest): boolean {
    // Connexus documents no signature scheme. Per the SmsProvider contract: accept, but say so
    // once, loudly. Mitigation: configure the webhook URLs in the members area with an
    // unguessable path token (see sms/README.md) so the URL itself is the shared secret.
    if (!this.warnedNoSignature) {
      this.warnedNoSignature = true;
      console.warn("[sms/websms] verifyWebhook: Connexus webhooks are unsigned — accepting UNVERIFIED.");
    }
    return true;
  }
}
