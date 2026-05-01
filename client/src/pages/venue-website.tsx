import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe, ExternalLink, Copy, Plus, Trash2, AlertCircle, CheckCircle2, Clock,
  Palette, Shield, Puzzle, Settings, ArrowRight, Eye, Info,
} from "lucide-react";
import type { CustomDomain, VenueSettings } from "@shared/schema";
import {
  DetectionInlineBadge,
  AutoConfigureButton,
  GoDaddyConnectionCard,
  GoDaddyVerifiedRecord,
} from "@/components/GoDaddyDomainHelper";

export default function VenueWebsitePage() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const orgSlug = currentOrg?.slug;
  const { toast } = useToast();
  const [newDomain, setNewDomain] = useState("");

  const { data: settings } = useQuery<VenueSettings>({
    queryKey: ["/api/admin/venue/settings", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/venue/settings?orgId=${orgId}`);
      if (!r.ok) throw new Error("Failed to load site settings");
      return r.json();
    },
    enabled: !!orgId,
  });

  const { data: domains, isLoading: domainsLoading, isError: domainsError, refetch: refetchDomains } = useQuery<CustomDomain[]>({
    queryKey: ["/api/admin/domains", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/domains?organizationId=${orgId}`);
      if (!r.ok) throw new Error("Failed to load domains");
      return r.json();
    },
    enabled: !!orgId,
  });

  const addDomain = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/domains", {
      organizationId: orgId,
      domain: newDomain.trim().toLowerCase(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domains"] });
      toast({ title: "Domain added", description: "Now configure your DNS to finish the connection." });
      setNewDomain("");
    },
    onError: (e: any) => toast({ title: "Couldn't add domain", description: e.message, variant: "destructive" }),
  });

  const removeDomain = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/domains/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domains"] });
      toast({ title: "Domain removed" });
    },
    onError: (e: any) => toast({ title: "Couldn't remove domain", description: e?.message, variant: "destructive" }),
  });

  const replitOrigin = window.location.origin;
  const previewUrl = `${replitOrigin}/book?slug=${orgSlug || ""}`;

  const { data: deployInfo } = useQuery<{ cnameTarget: string | null }>({
    queryKey: ["/api/admin/deployment-info"],
  });
  const cnameTarget = deployInfo?.cnameTarget
    || (window.location.hostname.endsWith(".replit.app") ? window.location.hostname : null);

  const statusBadge = (d: CustomDomain) => {
    if (d.verified) {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px]" data-testid={`badge-status-${d.id}`}>
          <CheckCircle2 className="w-3 h-3 mr-1" /> Live
        </Badge>
      );
    }
    if (d.status === "active") {
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px]" data-testid={`badge-status-${d.id}`}>
          <Clock className="w-3 h-3 mr-1" /> Awaiting DNS
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[10px]" data-testid={`badge-status-${d.id}`}>
        <AlertCircle className="w-3 h-3 mr-1" /> {d.status}
      </Badge>
    );
  };

  const editCards = [
    {
      icon: Palette,
      title: "Branding & content",
      description: "Site name, intro text, brand colour, contact details, footer, payment policy.",
      href: "/admin/venue-settings",
      testid: "card-edit-branding",
    },
    {
      icon: Shield,
      title: "Facilities",
      description: "Add or update fields, courts and rooms — descriptions, photos, base prices.",
      href: "/admin/facilities",
      testid: "card-edit-facilities",
    },
    {
      icon: Puzzle,
      title: "Add-ons",
      description: "Optional extras customers can choose at checkout (lights, equipment, etc.).",
      href: "/admin/addons",
      testid: "card-edit-addons",
    },
    {
      icon: Settings,
      title: "Booking rules",
      description: "Opening hours, slot length, minimum booking duration, advance booking window.",
      href: "/admin/venue-settings",
      testid: "card-edit-rules",
    },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Website</h1>
        <p className="text-sm text-white/40 mt-1">
          Edit your booking site, preview changes, and connect your own domain.
        </p>
      </div>

      {/* Live site card */}
      <Card className="premium-card border-white/[0.06]" data-testid="card-live-site">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">
                <Globe className="w-3 h-3" /> Your live booking site
              </div>
              <div className="text-lg font-semibold text-white truncate" data-testid="text-site-title">
                {settings?.siteTitle || currentOrg?.name || "Booking site"}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono text-white/50 truncate" data-testid="text-preview-url">{previewUrl}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(previewUrl); toast({ title: "Link copied" }); }}
                  className="text-white/30 hover:text-white/60"
                  data-testid="button-copy-url"
                  aria-label="Copy URL"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => window.open(previewUrl, "_blank")}
                className="border-white/10 text-white/70 rounded-xl gap-2"
                data-testid="button-preview-site"
              >
                <Eye className="w-4 h-4" /> Preview
              </Button>
              <Button
                onClick={() => window.open(previewUrl, "_blank")}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
                data-testid="button-open-site"
              >
                <ExternalLink className="w-4 h-4" /> Open site
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick edit grid */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-3">Edit your site</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {editCards.map(card => {
            const Icon = card.icon;
            return (
              <Link key={card.href + card.title} href={card.href} data-testid={card.testid}>
                <Card className="premium-card border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02] transition-colors cursor-pointer h-full">
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-white/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white/90">{card.title}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-white/30" />
                      </div>
                      <p className="text-xs text-white/40 mt-1">{card.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Custom domain card */}
      <Card className="premium-card border-white/[0.06]" data-testid="card-custom-domain">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-white/80 flex items-center gap-2">
            <Globe className="w-4 h-4 text-white/40" /> Custom domain
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-white/50">
            Show your booking site on your own domain (for example <span className="font-mono text-white/70">book.unitedsportscentre.co.nz</span>) instead of the default Replit URL.
          </p>

          {/* GoDaddy connection status */}
          <GoDaddyConnectionCard />

          {/* Add domain input */}
          <div className="space-y-1.5">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="book.yourdomain.co.nz"
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newDomain.trim()) addDomain.mutate(); }}
                className="premium-input text-white/90 text-sm rounded-xl flex-1"
                data-testid="input-new-domain"
              />
              <Button
                onClick={() => addDomain.mutate()}
                disabled={!newDomain.trim() || !orgId || addDomain.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
                data-testid="button-add-domain"
              >
                <Plus className="w-4 h-4" />
                {addDomain.isPending ? "Adding..." : "Add domain"}
              </Button>
            </div>
            <DetectionInlineBadge domain={newDomain} />
          </div>

          {/* Connected domains list */}
          {domainsLoading ? (
            <div className="py-4 text-center text-white/30 text-sm">Loading…</div>
          ) : domainsError ? (
            <div
              className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex items-center justify-between gap-3"
              data-testid="text-domains-error"
            >
              <div className="flex items-center gap-2 text-sm text-red-300/80">
                <AlertCircle className="w-4 h-4 text-red-400" />
                Couldn't load your domains.
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchDomains()}
                className="border-red-500/30 text-red-300/80 hover:bg-red-500/10 rounded-lg h-7 text-xs"
                data-testid="button-retry-domains"
              >
                Retry
              </Button>
            </div>
          ) : domains && domains.length > 0 ? (
            <div className="space-y-2">
              {domains.map(d => (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]"
                  data-testid={`row-domain-${d.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                      <Globe className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-white/80 truncate" data-testid={`text-domain-${d.id}`}>{d.domain}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {statusBadge(d)}
                        <GoDaddyVerifiedRecord domainId={d.id} fullDomain={d.domain} cnameTarget={cnameTarget} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <AutoConfigureButton domainId={d.id} fullDomain={d.domain} cnameTarget={cnameTarget} />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => window.open(`https://${d.domain}`, "_blank")}
                      className="text-white/30 hover:text-white/60 h-8 w-8"
                      data-testid={`button-visit-${d.id}`}
                      title="Visit"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { if (confirm(`Remove ${d.domain}?`)) removeDomain.mutate(d.id); }}
                      className="text-white/30 hover:text-red-400 h-8 w-8"
                      data-testid={`button-remove-${d.id}`}
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-white/30 text-xs">No custom domain connected yet.</div>
          )}

          {/* DNS Setup instructions */}
          <div className="border-t border-white/[0.06] pt-4 space-y-3">
            <div className="text-xs font-semibold text-white/60">How to connect your domain</div>

            {(() => {
              const firstDomain = domains?.[0]?.domain;
              const COMPOUND_TLDS = /\.(co|net|org|ac|govt|gen)\.(nz|uk|au|za|in|jp|kr)$|\.com\.(au|br|cn|mx|sg|tw)$/i;
              const isRootDomain = firstDomain && (
                firstDomain.split(".").length <= 2
                || (firstDomain.split(".").length === 3 && COMPOUND_TLDS.test(firstDomain))
              );
              const hostPart = firstDomain ? firstDomain.split(".")[0] : "book";
              return (
                <>
                  {isRootDomain && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex gap-2" data-testid="callout-root-domain-warning">
                      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-red-300/80 leading-relaxed">
                        <span className="font-medium">Root domains can't use CNAME records.</span>{" "}
                        You've added <span className="font-mono font-medium">{firstDomain}</span> which is a root domain.
                        Most DNS providers (GoDaddy, Namecheap) don't allow CNAME records on the root.
                        You should use a subdomain instead — for example{" "}
                        <span className="font-mono font-medium">book.{firstDomain}</span>.
                        Remove the current entry above, then add the subdomain version.
                      </div>
                    </div>
                  )}

                  <ol className="space-y-3 text-sm text-white/60">
                    <li className="flex gap-3">
                      <span className="w-5 h-5 rounded-full bg-white/[0.06] text-white/70 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                      <div className="flex-1">
                        <div className="text-white/80">Add your domain above</div>
                        <div className="text-xs text-white/40 mt-0.5">
                          Use a <span className="font-medium text-white/60">subdomain</span> like{" "}
                          <span className="font-mono">book.yourdomain.co.nz</span> — not the bare root domain.
                        </div>
                      </div>
                    </li>

                    <li className="flex gap-3">
                      <span className="w-5 h-5 rounded-full bg-white/[0.06] text-white/70 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                      <div className="flex-1">
                        <div className="text-white/80">Add the domain in Replit Deployments</div>
                        <div className="text-xs text-white/40 mt-0.5">
                          In your Replit project, go to the
                          <span className="font-medium text-white/60"> Deployments</span> tab (near the top of the sidebar), then
                          <span className="font-medium text-white/60"> Settings → Custom Domains</span> and add the same domain.
                          Replit will show you the <span className="font-medium text-white/60">CNAME target</span> to use
                          and will automatically issue an SSL certificate.
                        </div>
                      </div>
                    </li>

                    <li className="flex gap-3">
                      <span className="w-5 h-5 rounded-full bg-white/[0.06] text-white/70 text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                      <div className="flex-1">
                        <div className="text-white/80">Add a CNAME record in your DNS provider</div>
                        <div className="text-xs text-white/40 mt-0.5">
                          In GoDaddy (or your registrar), go to <span className="font-medium text-white/60">DNS Management</span> and add this record:
                        </div>
                        <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 font-mono text-xs">
                          <div className="grid grid-cols-3 gap-3 text-white/30 mb-1.5">
                            <span>Type</span>
                            <span>Name / Host</span>
                            <span>Value / Target</span>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-white/80">
                            <span>CNAME</span>
                            <span data-testid="text-cname-host">{hostPart}</span>
                            <span className="break-all flex items-center gap-1.5" data-testid="text-cname-target">
                              {cnameTarget || <span className="text-white/40 italic">shown in Replit Deployments</span>}
                              {cnameTarget && (
                                <button
                                  onClick={() => { navigator.clipboard.writeText(cnameTarget); toast({ title: "Copied" }); }}
                                  className="text-white/30 hover:text-white/60"
                                  aria-label="Copy CNAME target"
                                  data-testid="button-copy-cname"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="text-[10px] text-white/30 mt-1.5">
                          The "Name" is just the part before the first dot in your domain.
                          The "Value / Target" is the address Replit gives you when you add the domain in step 2.
                        </div>
                      </div>
                    </li>
                  </ol>

                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex gap-2" data-testid="callout-dns-info">
                    <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-300/70 leading-relaxed">
                      DNS changes can take a few minutes to 24 hours to propagate. Once propagated,
                      the status above will switch from <span className="font-medium">Awaiting DNS</span> to <span className="font-medium">Live</span> automatically.
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
