import { Badge } from "@/components/ui/badge";
import { ExternalLink, CreditCard, BarChart3, Mail, Target, ShoppingBag, Globe } from "lucide-react";

const integrations = [
  { name: "Stripe", description: "Payment processing for registrations and invoices", status: "Not configured", icon: CreditCard, color: "from-violet-500/15" },
  { name: "Xero", description: "Accounting sync for invoices and contacts", status: "Not configured", icon: BarChart3, color: "from-blue-500/15" },
  { name: "Klaviyo", description: "Email marketing and contact sync", status: "Not configured", icon: Mail, color: "from-emerald-500/15" },
  { name: "Meta CAPI", description: "Server-side conversion tracking", status: "Not configured", icon: Target, color: "from-sky-500/15" },
  { name: "Shopify", description: "Merchandise store customer matching", status: "Not configured", icon: ShoppingBag, color: "from-green-500/15" },
  { name: "COMET (NZF)", description: "New Zealand Football registration system", status: "Stub ready", icon: Globe, color: "from-amber-500/15" },
];

export default function SettingsPage() {
  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">
          System configuration and integrations
        </p>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
        <div className="px-5 py-4 border-b border-blue-500/[0.08]">
          <h3 className="text-[14px] font-semibold text-white/75">Integrations</h3>
        </div>
        <div className="divide-y divide-blue-500/[0.04]">
          {integrations.map((integration, index) => (
            <div
              key={integration.name}
              className="flex items-center gap-4 px-5 py-4 row-hover"
              data-testid={`integration-${integration.name.toLowerCase().replace(/[^a-z]/g, "-")}`}
            >
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${integration.color} to-transparent border border-blue-500/[0.08] flex items-center justify-center`}>
                <integration.icon className="w-4 h-4 text-white/45" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-white/75">{integration.name}</p>
                <p className="text-[11px] text-white/25">{integration.description}</p>
              </div>
              <span className={`text-[10px] px-2.5 py-1 rounded-lg border ${
                integration.status === "Stub ready"
                  ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                  : "text-white/25 bg-blue-500/[0.04] border-blue-500/[0.08]"
              }`}>
                {integration.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '150ms', opacity: 0 }}>
        <div className="px-5 py-4 border-b border-blue-500/[0.08]">
          <h3 className="text-[14px] font-semibold text-white/75">Club Information</h3>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] text-blue-300/25 uppercase tracking-wider mb-1">Club Name</p>
              <p className="text-[13px] font-medium text-white/65">Christchurch United Football Club</p>
            </div>
            <div>
              <p className="text-[10px] text-blue-300/25 uppercase tracking-wider mb-1">Platform</p>
              <p className="text-[13px] font-medium text-white/65">CUFC ClubOS v1.0</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
