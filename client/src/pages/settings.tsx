import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, ExternalLink } from "lucide-react";

const integrations = [
  { name: "Stripe", description: "Payment processing for registrations and invoices", status: "Not configured" },
  { name: "Xero", description: "Accounting sync for invoices and contacts", status: "Not configured" },
  { name: "Klaviyo", description: "Email marketing and contact sync", status: "Not configured" },
  { name: "Meta CAPI", description: "Server-side conversion tracking", status: "Not configured" },
  { name: "Shopify", description: "Merchandise store customer matching", status: "Not configured" },
  { name: "COMET (NZF)", description: "New Zealand Football registration system", status: "Stub ready" },
];

export default function SettingsPage() {
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          System configuration and integrations
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Integrations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {integrations.map((integration) => (
              <div
                key={integration.name}
                className="flex items-center gap-4 px-5 py-4"
                data-testid={`integration-${integration.name.toLowerCase().replace(/[^a-z]/g, "-")}`}
              >
                <div className="p-2 rounded-md bg-muted">
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{integration.name}</p>
                  <p className="text-xs text-muted-foreground">{integration.description}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">{integration.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Club Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Club Name</p>
              <p className="text-sm font-medium">Christchurch United Football Club</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Platform</p>
              <p className="text-sm font-medium">CUFC ClubOS v1.0</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
