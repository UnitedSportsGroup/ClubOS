import { storage } from "./storage";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

export interface EmailAttachment {
  filename: string;
  content: string;       // base64-encoded
  contentType?: string;  // e.g. "text/calendar; charset=utf-8; method=REQUEST"
}

interface EmailParams {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  campId?: number;
  registrationId?: number;
  attachments?: EmailAttachment[];
}

// Strip HTML to a plain-text approximation. Used as a fallback when callers
// don't supply their own `text`. Mailbox providers downgrade reputation for
// HTML-only mail (a common spam signal), so always sending both raises
// deliverability scores into the 9.5+ range.
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log("[Email] Skipping — RESEND_API_KEY not configured. Would have sent to:", params.to);
    console.log("[Email] Subject:", params.subject);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        reply_to: params.replyTo || undefined,
        subject: params.subject,
        html: params.html,
        text: params.text ?? htmlToText(params.html),
        attachments: params.attachments?.map(a => ({
          filename: a.filename,
          content: a.content,
          content_type: a.contentType,
        })),
      }),
    });

    const result = await res.json();
    const success = res.ok;

    try {
      await storage.createEmailLog({
        campId: params.campId || null,
        registrationId: params.registrationId || null,
        toEmail: params.to,
        subject: params.subject,
        body: params.html,
        providerMessageId: result.id || null,
      });
    } catch (e) {
      console.error("[Email] Failed to log email:", e);
    }

    if (!success) {
      console.error("[Email] API error:", JSON.stringify(result));
    }

    return success;
  } catch (error) {
    console.error("[Email] Request failed:", error);
    return false;
  }
}

function substituteVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

export async function sendConfirmationEmail(params: {
  registrationId: number;
  campId: number;
  parentEmail: string;
  parentName: string;
  childrenNames: string[];
  campName: string;
  campDates: string;
  location: string;
  totalPaid: string;
}): Promise<boolean> {
  const existing = await storage.getEmailLogByRegistration(params.registrationId);
  if (existing) {
    console.log("[Email] Confirmation already sent for registration", params.registrationId);
    return true;
  }

  const settings = await storage.getCampSettings(params.campId);

  const defaultFrom = "CUFC Camps <noreply@cufc.co.nz>";
  const defaultSubject = "Booking Confirmed — {{campName}}";
  const defaultBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3a5f, #2563eb); padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Booking Confirmed!</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">{{campName}}</p>
      </div>
      <div style="background: #f8fafc; padding: 32px; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 16px 16px;">
        <p style="color: #334155; font-size: 16px; margin: 0 0 16px;">Hi {{parentName}},</p>
        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
          Thank you for booking! Here are your details:
        </p>
        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 0 0 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 0;">Children</td><td style="color: #1e293b; font-size: 14px; padding: 6px 0; text-align: right;">{{childrenList}}</td></tr>
            <tr><td style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 0;">Dates</td><td style="color: #1e293b; font-size: 14px; padding: 6px 0; text-align: right;">{{campDates}}</td></tr>
            <tr><td style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 0;">Location</td><td style="color: #1e293b; font-size: 14px; padding: 6px 0; text-align: right;">{{location}}</td></tr>
            <tr style="border-top: 1px solid #e2e8f0;"><td style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0 6px;">Total Paid</td><td style="color: #1e293b; font-size: 16px; font-weight: 600; padding: 10px 0 6px; text-align: right;">{{totalPaid}}</td></tr>
          </table>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">
          If you have any questions, reply to this email or contact us at info@cufc.co.nz
        </p>
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 11px; margin: 16px 0 0;">Christchurch United Football Club</p>
    </div>
  `;

  const vars = {
    campName: params.campName,
    parentName: params.parentName,
    childrenList: params.childrenNames.join(", "),
    campDates: params.campDates,
    location: params.location,
    totalPaid: params.totalPaid,
  };

  const from = settings?.fromEmail || defaultFrom;
  const subject = substituteVars(settings?.confirmationEmailSubject || defaultSubject, vars);
  const html = substituteVars(settings?.confirmationEmailBody || defaultBody, vars);
  const replyTo = settings?.replyTo || "info@cufc.co.nz";

  return sendEmail({
    to: params.parentEmail,
    from,
    replyTo,
    subject,
    html,
    campId: params.campId,
    registrationId: params.registrationId,
  });
}
