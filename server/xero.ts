// Xero integration. OAuth2 connect + invoice push for paid print orders.
//
// Setup (one time per environment):
//   1. Create a Xero app at https://developer.xero.com/app/manage
//   2. Set redirect URI: https://app.usg.co.nz/api/integrations/xero/callback
//   3. Required scopes: openid profile email accounting.transactions
//      accounting.contacts offline_access
//   4. Set XERO_CLIENT_ID + XERO_CLIENT_SECRET in env
//
// Token lifetime: access tokens are 30 minutes, refresh tokens 60 days.
// We refresh on every API call where the access token is within 5 min of
// expiry. If the refresh token expires (60 days idle), the user has to
// reconnect.

import { XeroClient, type Invoice, type LineItem, type Phone, type Contact } from "xero-node";
import { db } from "./db";
import { orgIntegrations, printXeroInvoices, type OrgIntegration, type PrintOrder, type PrintOrderItem } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const REDIRECT_URI = process.env.XERO_REDIRECT_URI || "https://app.usg.co.nz/api/integrations/xero/callback";
const SCOPES = [
  "openid", "profile", "email",
  "accounting.transactions", "accounting.contacts",
  "offline_access",
];

function buildClient(): XeroClient {
  if (!process.env.XERO_CLIENT_ID || !process.env.XERO_CLIENT_SECRET) {
    throw new Error("XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set");
  }
  return new XeroClient({
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUris: [REDIRECT_URI],
    scopes: SCOPES,
  });
}

// Step 1: Build the Xero authorization URL. State carries the org id so we
// can attribute the connection on callback.
export async function buildAuthUrl(orgId: number): Promise<string> {
  const xero = buildClient();
  const state = Buffer.from(JSON.stringify({ orgId, ts: Date.now() })).toString("base64url");
  // The Xero SDK builds the consent URL. We attach state by replacing the
  // query string param after the fact, since buildConsentUrl doesn't expose it.
  const consentUrl = await xero.buildConsentUrl();
  const url = new URL(consentUrl);
  url.searchParams.set("state", state);
  return url.toString();
}

// Step 2: Handle the callback — exchange the code for tokens, save against
// the org. Returns the connected tenant name for confirmation UI.
export async function handleCallback(callbackUrl: string, state: string): Promise<{ orgId: number; tenantName: string }> {
  const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
  const orgId = decoded.orgId as number;
  if (!orgId) throw new Error("Invalid state");

  const xero = buildClient();
  const tokenSet = await xero.apiCallback(callbackUrl);
  await xero.updateTenants(false);
  const tenants = xero.tenants;
  if (!tenants || tenants.length === 0) {
    throw new Error("No Xero organisations granted access");
  }
  // For multi-tenant Xero accounts we just take the first granted tenant.
  // A future v2 could let the user pick.
  const tenant = tenants[0];

  await db.insert(orgIntegrations)
    .values({
      organizationId: orgId,
      provider: "xero",
      isActive: true,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      tokenExpiresAt: new Date(Date.now() + (tokenSet.expires_in ?? 1800) * 1000),
      externalId: tenant.tenantId,
      externalName: tenant.tenantName,
      configJson: { tenantType: tenant.tenantType },
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [orgIntegrations.organizationId, orgIntegrations.provider],
      set: {
        isActive: true,
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token,
        tokenExpiresAt: new Date(Date.now() + (tokenSet.expires_in ?? 1800) * 1000),
        externalId: tenant.tenantId,
        externalName: tenant.tenantName,
        connectedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return { orgId, tenantName: tenant.tenantName ?? "Xero" };
}

// Returns an authenticated Xero client for the given org, refreshing the
// access token if it's about to expire. Throws if no connection exists.
export async function getXeroForOrg(orgId: number): Promise<{ xero: XeroClient; tenantId: string }> {
  const [conn] = await db.select().from(orgIntegrations)
    .where(and(eq(orgIntegrations.organizationId, orgId), eq(orgIntegrations.provider, "xero"), eq(orgIntegrations.isActive, true)));
  if (!conn || !conn.accessToken || !conn.refreshToken || !conn.externalId) {
    throw new Error("Xero not connected for this organisation");
  }

  const xero = buildClient();
  await xero.setTokenSet({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken,
    token_type: "Bearer",
    expires_at: conn.tokenExpiresAt ? Math.floor(conn.tokenExpiresAt.getTime() / 1000) : undefined,
  });

  // Refresh if expiring within 5 minutes
  const expiresIn = conn.tokenExpiresAt ? conn.tokenExpiresAt.getTime() - Date.now() : 0;
  if (expiresIn < 5 * 60 * 1000) {
    const newTokenSet = await xero.refreshToken();
    await db.update(orgIntegrations)
      .set({
        accessToken: newTokenSet.access_token,
        refreshToken: newTokenSet.refresh_token ?? conn.refreshToken,
        tokenExpiresAt: new Date(Date.now() + (newTokenSet.expires_in ?? 1800) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(orgIntegrations.id, conn.id));
  }

  return { xero, tenantId: conn.externalId };
}

export async function getOrgIntegration(orgId: number, provider: "xero" | "stripe"): Promise<OrgIntegration | null> {
  const [row] = await db.select().from(orgIntegrations)
    .where(and(eq(orgIntegrations.organizationId, orgId), eq(orgIntegrations.provider, provider)));
  return row ?? null;
}

export async function disconnectIntegration(orgId: number, provider: "xero" | "stripe"): Promise<void> {
  await db.update(orgIntegrations)
    .set({ isActive: false, accessToken: null, refreshToken: null, updatedAt: new Date() })
    .where(and(eq(orgIntegrations.organizationId, orgId), eq(orgIntegrations.provider, provider)));
}

// ── Push a paid print order to Xero ─────────────────────────────────────
// Creates a Xero invoice (status AUTHORISED — sent), then attaches a
// payment record marking it paid. Returns the Xero invoice number for
// reference.
export async function pushPaidOrderToXero(order: PrintOrder, items: PrintOrderItem[]): Promise<{ invoiceId: string; invoiceNumber: string }> {
  if (!order.organizationId) throw new Error("Order has no organization");
  const { xero, tenantId } = await getXeroForOrg(order.organizationId);

  // Build/find the contact
  const contactName = order.customerCompany || order.customerName;
  const contactEmail = order.customerEmail ?? undefined;
  const contactPhone = order.customerPhone ?? undefined;

  const phones: Phone[] = contactPhone
    ? [{ phoneType: "MOBILE" as any, phoneNumber: contactPhone }]
    : [];

  const contact: Contact = {
    name: contactName,
    emailAddress: contactEmail,
    phones: phones.length ? phones : undefined,
  };

  // Build line items — each print_order_item becomes one Xero line.
  // Subtotals are pre-GST (Tax Type INPUT2 = NZ GST 15% on Income).
  const lineItems: LineItem[] = items.map(it => {
    const description = it.widthMm
      ? `${it.materialName} — ${it.widthMm}×${it.heightMm}mm × ${it.quantity}${it.sides === 2 ? " (double-sided)" : ""}`
      : `${it.materialName} × ${it.quantity}`;
    return {
      description,
      quantity: 1,                           // We bundle qty into the unit amount via subtotal
      unitAmount: it.subtotalCents / 100,
      accountCode: "200",                    // Default sales account — Dima can re-map later in Xero
      taxType: "OUTPUT2",                    // NZ GST 15% on outgoing income
    };
  });

  const invoice: Invoice = {
    type: "ACCREC" as any,                   // Accounts receivable
    contact,
    date: new Date().toISOString().split("T")[0],
    dueDate: new Date().toISOString().split("T")[0],
    invoiceNumber: order.orderNumber ?? undefined,
    reference: order.orderNumber ?? undefined,
    lineItems,
    status: "AUTHORISED" as any,
    lineAmountTypes: "Exclusive" as any,
  };

  const invoicesRes = await xero.accountingApi.createInvoices(tenantId, { invoices: [invoice] });
  const created = invoicesRes.body.invoices?.[0];
  if (!created || !created.invoiceID) throw new Error("Xero did not return an invoice ID");

  // Attach a Payment so the invoice shows as paid (Stripe is the actual
  // payment account — we'll use a generic Bank account code, Dima can
  // re-map after first push).
  const paymentAmount = order.totalCents / 100;
  if (paymentAmount > 0 && order.status === "paid") {
    try {
      await xero.accountingApi.createPayments(tenantId, {
        payments: [{
          invoice: { invoiceID: created.invoiceID },
          // Account: Stripe clearing account. If the user hasn't set one up,
          // fall back to default bank account "090". They can re-classify
          // in Xero post-fact.
          account: { code: "090" },
          date: new Date().toISOString().split("T")[0],
          amount: paymentAmount,
          reference: `Stripe ${order.stripePaymentIntentId ?? ""}`,
        }],
      });
    } catch (e: any) {
      // Don't fail the whole push if just the payment attachment fails —
      // the invoice itself is in Xero, Dima can mark it paid manually.
      console.warn(`[Xero] Invoice ${created.invoiceNumber} created but payment record failed: ${e.message}`);
    }
  }

  // Persist the link
  await db.insert(printXeroInvoices).values({
    printOrderId: order.id,
    xeroInvoiceId: created.invoiceID,
    xeroInvoiceNumber: created.invoiceNumber,
    status: order.status === "paid" ? "paid" : "sent",
    pushedAt: new Date(),
    paidAt: order.status === "paid" ? new Date() : null,
  } as any);

  await db.update(orgIntegrations)
    .set({ lastSyncedAt: new Date() })
    .where(and(eq(orgIntegrations.organizationId, order.organizationId), eq(orgIntegrations.provider, "xero")));

  return { invoiceId: created.invoiceID, invoiceNumber: created.invoiceNumber ?? "" };
}
