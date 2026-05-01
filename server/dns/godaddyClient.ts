const API_BASE = "https://api.godaddy.com/v1";

export interface GoDaddyDnsRecord {
  type: string;
  name: string;
  data: string;
  ttl?: number;
}

export interface GoDaddyClientStatus {
  configured: boolean;
  valid: boolean;
  error?: string;
  domainCount?: number;
}

function getCreds(): { key: string; secret: string } | null {
  const key = process.env.GODADDY_API_KEY;
  const secret = process.env.GODADDY_API_SECRET;
  if (!key || !secret) return null;
  return { key, secret };
}

function authHeader(): string | null {
  const c = getCreds();
  if (!c) return null;
  return `sso-key ${c.key}:${c.secret}`;
}

export function isGoDaddyConfigured(): boolean {
  return getCreds() !== null;
}

async function request<T>(path: string, method: "GET" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const auth = authHeader();
  if (!auth) throw new Error("GoDaddy API credentials not configured");
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.message || parsed?.code || text;
    } catch {}
    if (r.status === 401 || r.status === 403) {
      throw new Error(`GoDaddy auth failed (${r.status}): ${message || "check API key & secret"}`);
    }
    if (r.status === 404) {
      throw new Error(`GoDaddy API: domain not found in this account (${message || "check ownership"})`);
    }
    if (r.status === 422) {
      throw new Error(`GoDaddy API rejected the request (${message || "validation error"})`);
    }
    throw new Error(`GoDaddy API ${r.status}: ${message}`);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

export async function checkConnection(): Promise<GoDaddyClientStatus> {
  if (!isGoDaddyConfigured()) {
    return { configured: false, valid: false, error: "GoDaddy API key & secret not set" };
  }
  try {
    const list = await request<Array<{ domain: string }>>("/domains?statuses=ACTIVE&limit=1", "GET");
    return { configured: true, valid: true, domainCount: Array.isArray(list) ? list.length : undefined };
  } catch (err: any) {
    return { configured: true, valid: false, error: err?.message || "Connection check failed" };
  }
}

export async function listDomains(): Promise<string[]> {
  const list = await request<Array<{ domain: string }>>("/domains?statuses=ACTIVE&limit=1000", "GET");
  return Array.isArray(list) ? list.map(d => d.domain.toLowerCase()) : [];
}

export async function getRecords(apex: string, type: string, name: string): Promise<GoDaddyDnsRecord[]> {
  const safeName = encodeURIComponent(name);
  return request<GoDaddyDnsRecord[]>(`/domains/${encodeURIComponent(apex)}/records/${type}/${safeName}`, "GET");
}

export async function setCnameRecord(apex: string, name: string, target: string, ttl = 600): Promise<void> {
  const cleanTarget = target.replace(/\.$/, "");
  await request<void>(
    `/domains/${encodeURIComponent(apex)}/records/CNAME/${encodeURIComponent(name)}`,
    "PUT",
    [{ data: cleanTarget, ttl }],
  );
}

// --- Domain Forwarding (used for apex → www redirects) ---
// GoDaddy's /forwards endpoint sets up an HTTP 301/302 redirect at the registrar level.
// This is how we work around the DNS rule that forbids CNAME records at the apex.

export interface GoDaddyForwarding {
  type: "REDIRECT_PERMANENT" | "REDIRECT_TEMPORARY";
  url: string;
  masking?: boolean;
  title?: string;
}

export async function setForwarding(apex: string, fqdn: string, targetUrl: string): Promise<void> {
  await request<void>(
    `/domains/${encodeURIComponent(apex)}/forwards/${encodeURIComponent(fqdn)}`,
    "PUT",
    {
      type: "REDIRECT_PERMANENT",
      url: targetUrl,
      masking: false,
    },
  );
}

export async function getForwarding(apex: string, fqdn: string): Promise<GoDaddyForwarding | null> {
  try {
    const all = await request<GoDaddyForwarding[] | GoDaddyForwarding>(
      `/domains/${encodeURIComponent(apex)}/forwards/${encodeURIComponent(fqdn)}`,
      "GET",
    );
    if (Array.isArray(all)) return all[0] || null;
    return all || null;
  } catch (err: any) {
    if (typeof err?.message === "string" && (err.message.includes("not found") || err.message.includes("404"))) return null;
    return null;
  }
}

export async function ownsDomain(apex: string): Promise<boolean> {
  try {
    await request<{ domain: string }>(`/domains/${encodeURIComponent(apex)}`, "GET");
    return true;
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.includes("not found")) return false;
    throw err;
  }
}
