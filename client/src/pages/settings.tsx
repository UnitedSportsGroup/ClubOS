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
      <div>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-white/40 text-[13px] mt-1">
          System configuration and integrations
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[14px] font-semibold text-white/80">Integrations</h3>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {integrations.map((integration) => (
            <div
              key={integration.name}
              className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors"
              data-testid={`integration-${integration.name.toLowerCase().replace(/[^a-z]/g, "-")}`}
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${integration.color} to-transparent border border-white/[0.06] flex items-center justify-center`}>
                <integration.icon className="w-4 h-4 text-white/50" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-white/80">{integration.name}</p>
                <p className="text-[11px] text-white/30">{integration.description}</p>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded-md border ${
                integration.status === "Stub ready" 
                  ? "text-amber-400 bg-amber-500/10 border-amber-500/20" 
                  : "text-white/30 bg-white/[0.03] border-white/[0.06]"
              }`}>
                {integration.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[14px] font-semibold text-white/80">Club Information</h3>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[11px] text-white/30 mb-1">Club Name</p>
              <p className="text-[13px] font-medium text-white/70">Christchurch United Football Club</p>
            </div>
            <div>
              <p className="text-[11px] text-white/30 mb-1">Platform</p>
              <p className="text-[13px] font-medium text-white/70">CUFC ClubOS v1.0</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
