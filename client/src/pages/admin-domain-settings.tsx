import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Globe, Plus, Trash2, ExternalLink, Copy, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CustomDomain } from "@shared/schema";

export default function AdminDomainSettings() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const { toast } = useToast();
  const [newDomain, setNewDomain] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: domains, isLoading } = useQuery<CustomDomain[]>({
    queryKey: ["/api/admin/domains", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/domains?organizationId=${orgId}`);
      if (!r.ok) throw new Error("Failed to load domains");
      return r.json();
    },
    enabled: !!orgId,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/domains", {
        organizationId: orgId,
        domain: newDomain.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domains"] });
      toast({ title: "Domain added" });
      setNewDomain("");
      setShowAdd(false);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/admin/domains/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domains"] });
      toast({ title: "Domain removed" });
    },
  });

  const statusBadge = (domain: CustomDomain) => {
    if (domain.verified) {
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" /> Verified</Badge>;
    }
    if (domain.status === "active") {
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px]"><Clock className="w-3 h-3 mr-1" /> Pending verification</Badge>;
    }
    return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[10px]"><AlertCircle className="w-3 h-3 mr-1" /> {domain.status}</Badge>;
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Custom Domains</h1>
          <p className="text-sm text-white/40 mt-1">Connect custom domains to this workspace for branded landing pages and registration</p>
        </div>
        <Button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
          data-testid="button-add-domain"
        >
          <Plus className="w-4 h-4" />
          Add domain
        </Button>
      </div>

      {showAdd && (
        <Card className="premium-card border-white/[0.06]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-white/80">Add Custom Domain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs text-white/40 font-medium block mb-1.5">Domain</label>
              <Input
                value={newDomain}
                onChange={e => setNewDomain(e.target.value.toLowerCase())}
                placeholder="e.g. join.minifootball.co.nz"
                className="premium-input text-white/80 rounded-xl font-mono"
                onKeyDown={e => { if (e.key === "Enter") addMutation.mutate(); }}
                data-testid="input-domain"
              />
              <p className="text-xs text-white/30 mt-1.5">
                Enter a domain or subdomain. You'll need to add a CNAME record pointing to your ClubOS app.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => addMutation.mutate()}
                disabled={!newDomain.trim() || addMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
                data-testid="button-save-domain"
              >
                {addMutation.isPending ? "Adding..." : "Add domain"}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setShowAdd(false); setNewDomain(""); }}
                className="border-white/10 text-white/60 rounded-xl"
                data-testid="button-cancel-domain"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="premium-card border-white/[0.06]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-white/80 flex items-center gap-2">
            <Globe className="w-4 h-4 text-white/40" />
            Connected Domains
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-white/30 text-sm">Loading domains...</div>
          ) : !domains?.length ? (
            <div className="py-8 text-center">
              <Globe className="w-8 h-8 text-white/10 mx-auto mb-3" />
              <p className="text-white/40 text-sm">No custom domains connected</p>
              <p className="text-white/25 text-xs mt-1">Add a custom domain to create branded landing pages</p>
            </div>
          ) : (
            <div className="space-y-3">
              {domains.map(domain => (
                <div
                  key={domain.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                  data-testid={`domain-row-${domain.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Globe className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-white/80" data-testid={`text-domain-${domain.id}`}>{domain.domain}</span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(domain.domain); toast({ title: "Copied!" }); }}
                          className="text-white/20 hover:text-white/40"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {statusBadge(domain)}
                        {domain.isPrimary && (
                          <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-[10px]">Primary</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => window.open(`https://${domain.domain}`, "_blank")}
                      className="text-white/30 hover:text-white/50 h-8 w-8"
                      data-testid={`button-visit-${domain.id}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { if (confirm("Remove this domain?")) deleteMutation.mutate(domain.id); }}
                      className="text-white/30 hover:text-red-400 h-8 w-8"
                      data-testid={`button-delete-${domain.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="premium-card border-white/[0.06]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-white/80">How to connect a domain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="space-y-2.5 text-sm text-white/50 list-none">
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-white/[0.06] text-white/70 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
              <span>
                Add a <span className="font-medium text-white/70">subdomain</span> above (e.g. <span className="font-mono text-white/70">join.yourdomain.co.nz</span>).
                Don't use a bare root domain — CNAME records don't work on roots.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-white/[0.06] text-white/70 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
              <span>
                In your Replit project, go to <span className="font-medium text-white/70">Deployments → Settings → Custom Domains</span> and add the same domain.
                Replit will show you the CNAME target and handle the SSL certificate.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-white/[0.06] text-white/70 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
              <span>
                In your DNS provider (GoDaddy, Cloudflare, etc.) add a <span className="font-medium text-white/70">CNAME record</span>:
                Name = the subdomain part (e.g. <span className="font-mono text-white/70">join</span>),
                Value = the target from step 2.
              </span>
            </li>
          </ol>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/60">
                DNS changes can take a few minutes to 24 hours to propagate.
                The status above will update automatically once the domain is verified.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
