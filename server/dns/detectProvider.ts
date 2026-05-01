import { promises as dns } from "dns";

export type DnsProvider =
  | "godaddy"
  | "cloudflare"
  | "namecheap"
  | "google"
  | "aws"
  | "azure"
  | "vercel"
  | "netlify"
  | "shopify"
  | "wix"
  | "squarespace"
  | "unknown";

export interface ProviderDetectionResult {
  provider: DnsProvider;
  providerLabel: string;
  nameservers: string[];
  apexDomain: string;
  isSubdomain: boolean;
  error?: string;
}

const PROVIDER_PATTERNS: { pattern: RegExp; provider: DnsProvider; label: string }[] = [
  { pattern: /\.domaincontrol\.com$/i, provider: "godaddy", label: "GoDaddy" },
  { pattern: /\.cloudflare\.com$/i, provider: "cloudflare", label: "Cloudflare" },
  { pattern: /\.registrar-servers\.com$/i, provider: "namecheap", label: "Namecheap" },
  { pattern: /\.googledomains\.com$|\.google\.com$/i, provider: "google", label: "Google Domains" },
  { pattern: /\.awsdns-/i, provider: "aws", label: "AWS Route 53" },
  { pattern: /\.azure-dns\./i, provider: "azure", label: "Azure DNS" },
  { pattern: /\.vercel-dns\.com$/i, provider: "vercel", label: "Vercel" },
  { pattern: /\.nsone\.net$/i, provider: "netlify", label: "Netlify" },
  { pattern: /shps\.io$|shopifydns\.com$/i, provider: "shopify", label: "Shopify" },
  { pattern: /\.wixdns\.net$/i, provider: "wix", label: "Wix" },
  { pattern: /\.squarespacedns\.com$/i, provider: "squarespace", label: "Squarespace" },
];

const COMPOUND_TLDS = /\.(co|net|org|ac|govt|gen|edu|gov)\.(nz|uk|au|za|in|jp|kr|sg)$|\.com\.(au|br|cn|mx|sg|tw)$/i;

export function getApexDomain(host: string): { apex: string; isSubdomain: boolean } {
  const cleaned = host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const parts = cleaned.split(".");
  if (parts.length < 2) return { apex: cleaned, isSubdomain: false };
  if (COMPOUND_TLDS.test(cleaned)) {
    if (parts.length === 3) return { apex: cleaned, isSubdomain: false };
    const apex = parts.slice(-3).join(".");
    return { apex, isSubdomain: cleaned !== apex };
  }
  if (parts.length === 2) return { apex: cleaned, isSubdomain: false };
  const apex = parts.slice(-2).join(".");
  return { apex, isSubdomain: cleaned !== apex };
}

export async function detectDnsProvider(host: string): Promise<ProviderDetectionResult> {
  const { apex, isSubdomain } = getApexDomain(host);
  try {
    const ns = await dns.resolveNs(apex);
    const lower = ns.map(n => n.toLowerCase());
    for (const p of PROVIDER_PATTERNS) {
      if (lower.some(n => p.pattern.test(n))) {
        return { provider: p.provider, providerLabel: p.label, nameservers: ns, apexDomain: apex, isSubdomain };
      }
    }
    return { provider: "unknown", providerLabel: "Unknown / other", nameservers: ns, apexDomain: apex, isSubdomain };
  } catch (err: any) {
    return {
      provider: "unknown",
      providerLabel: "Unknown / other",
      nameservers: [],
      apexDomain: apex,
      isSubdomain,
      error: err?.code || err?.message || "DNS lookup failed",
    };
  }
}

export function getCnameHost(fullHost: string): string {
  const { apex, isSubdomain } = getApexDomain(fullHost);
  if (!isSubdomain) return "@";
  const cleaned = fullHost.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  return cleaned.replace(new RegExp("\\." + apex.replace(/\./g, "\\.") + "$"), "");
}
