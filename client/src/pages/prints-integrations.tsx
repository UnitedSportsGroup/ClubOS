import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, ExternalLink, AlertCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface IntegrationsState {
  xero: {
    isActive: boolean;
    tenantName: string;
    tenantId: string;
    connectedAt: string;
    lastSyncedAt: string | null;
    tokenExpiresAt: string | null;
  } | null;
  stripe: {
    isActive: boolean;
    mode: "live" | "test";
    webhookConfigured: boolean;
  } | null;
}

export default function PrintsIntegrations() {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const orgId = currentOrg?.id;
  const [connecting, setConnecting] = useState(false);

  const { data, isLoading } = useQuery<IntegrationsState>({
    queryKey: ["/api/admin/integrations", { orgId }],
    queryFn: () => fetch(`/api/admin/integrations?orgId=${orgId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!orgId,
  });

  // Show success/error from OAuth callback
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("xero") === "connected") {
      toast({ title: "Xero connected", description: `Linked to ${sp.get("tenant")}` });
      window.history.replaceState({}, "", window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations"] });
    }
    if (sp.get("xero") === "error") {
      toast({ title: "Xero connection failed", description: sp.get("message") ?? "", variant: "destructive" });
    }
  }, [toast]);

  const connectXero = async () => {
    if (!orgId) return;
    setConnecting(true);
    try {
      const res = await fetch(`/api/admin/integrations/xero/connect?orgId=${orgId}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      window.location.href = data.url;
    } catch (e: any) {
      toast({ title: "Couldn't start Xero connect", description: e.message, variant: "destructive" });
      setConnecting(false);
    }
  };

  const disconnectXero = async () => {
    if (!orgId) return;
    if (!confirm("Disconnect Xero? Future invoices won't push automatically.")) return;
    try {
      await apiRequest("POST", "/api/admin/integrations/xero/disconnect", { orgId });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations"] });
      toast({ title: "Xero disconnected" });
    } catch (e: any) {
      toast({ title: "Couldn't disconnect", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Integrations</h1>
        <p className="text-sm text-white/40 mt-1">Connect United Prints to the tools you already use. Payments via Stripe, accounting via Xero.</p>
      </div>

      {isLoading ? (
        <div className="text-white/40 text-sm">Loading...</div>
      ) : (
        <div className="space-y-4">
          {/* Stripe card */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#635BFF] flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-lg">S</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-bold text-white">Stripe</h2>
                    {data?.stripe?.isActive ? (
                      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                        <CheckCircle className="w-3 h-3" /> Connected · {data.stripe.mode}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-500/15 text-zinc-400">
                        <XCircle className="w-3 h-3" /> Not configured
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/60">
                    Card payments on the public order page. Apple Pay + Google Pay supported. NZD only for now.
                  </p>
                  {data?.stripe?.isActive && !data.stripe.webhookConfigured && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong>Webhook not configured.</strong> Add STRIPE_WEBHOOK_SECRET to env so paid orders auto-advance.
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <a
                href="https://dashboard.stripe.com/payments"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/50 hover:text-white flex items-center gap-1 flex-shrink-0"
              >
                Open dashboard <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Xero card */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#13B5EA] flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-lg">X</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-bold text-white">Xero</h2>
                    {data?.xero?.isActive ? (
                      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                        <CheckCircle className="w-3 h-3" /> Connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-500/15 text-zinc-400">
                        <XCircle className="w-3 h-3" /> Not connected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white/60 mb-3">
                    Auto-push paid orders to Xero as invoices, with payment records attached. Manual push button available on every order if Xero is offline.
                  </p>
                  {data?.xero?.isActive ? (
                    <div className="text-xs text-white/50 space-y-0.5">
                      <div>Connected to <strong className="text-white/80">{data.xero.tenantName}</strong></div>
                      <div>Connected {new Date(data.xero.connectedAt).toLocaleDateString("en-NZ")}</div>
                      {data.xero.lastSyncedAt && (
                        <div>Last invoice push: {new Date(data.xero.lastSyncedAt).toLocaleString("en-NZ")}</div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-white/50">
                      You'll be redirected to Xero to authorise. We need permission to create invoices and contacts in your nominated organisation.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0">
                {data?.xero?.isActive ? (
                  <>
                    <a
                      href={`https://go.xero.com/Dashboard/${data.xero.tenantId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-white/50 hover:text-white flex items-center gap-1"
                    >
                      Open in Xero <ExternalLink className="w-3 h-3" />
                    </a>
                    <Button
                      onClick={disconnectXero}
                      variant="outline"
                      size="sm"
                      className="border-red-500/20 text-red-400 hover:bg-red-500/10"
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={connectXero}
                    disabled={connecting}
                    className="bg-[#13B5EA] hover:bg-[#0a8fc4] text-white"
                  >
                    <Plug className="w-4 h-4 mr-1.5" />
                    {connecting ? "Connecting..." : "Connect Xero"}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Coming soon */}
          <div className="rounded-2xl border border-dashed border-white/5 bg-transparent p-6 text-center text-white/30 text-sm">
            More integrations coming — MYOB, QuickBooks, Mailchimp, Klaviyo. Tell us what you need.
          </div>
        </div>
      )}
    </div>
  );
}
