import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, Zap, Globe, ShieldAlert } from "lucide-react";
import { SiGodaddy } from "react-icons/si";

export interface DetectionResult {
  provider: string;
  providerLabel: string;
  nameservers: string[];
  apexDomain: string;
  isSubdomain: boolean;
  cnameHost: string;
  error?: string;
  godaddy: {
    configured: boolean;
    canAutoConfigure: boolean;
    ownershipError?: string;
  };
}

export interface GoDaddyStatus {
  configured: boolean;
  valid: boolean;
  error?: string;
  domainCount?: number;
}

export function useGoDaddyStatus() {
  return useQuery<GoDaddyStatus>({
    queryKey: ["/api/admin/dns/godaddy/status"],
    staleTime: 60_000,
  });
}

export function useDomainDetection(domain: string, enabled = true) {
  const trimmed = domain.trim().toLowerCase();
  return useQuery<DetectionResult>({
    queryKey: ["/api/admin/dns/detect", trimmed],
    queryFn: async () => {
      const r = await fetch(`/api/admin/dns/detect?domain=${encodeURIComponent(trimmed)}`);
      if (!r.ok) throw new Error("Detection failed");
      return r.json();
    },
    enabled: enabled && trimmed.length > 3 && trimmed.includes("."),
    staleTime: 30_000,
    retry: false,
  });
}

export function useDebounced<T>(value: T, ms = 600): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function DetectionInlineBadge({ domain, enabled = true }: { domain: string; enabled?: boolean }) {
  const debounced = useDebounced(domain, 700);
  const { data, isFetching } = useDomainDetection(debounced, enabled);
  if (!enabled || debounced.length < 4 || !debounced.includes(".")) return null;
  if (isFetching) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-white/40" data-testid="detection-loading">
        <Loader2 className="w-3 h-3 animate-spin" /> Checking nameservers…
      </div>
    );
  }
  if (!data) return null;
  if (data.error) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-white/40" data-testid="detection-error">
        <AlertCircle className="w-3 h-3" /> Couldn't look up nameservers (domain may not be registered yet).
      </div>
    );
  }
  if (data.provider === "godaddy") {
    if (data.godaddy.canAutoConfigure) {
      const isApex = data.cnameHost === "@";
      return (
        <div className="flex items-center gap-1.5 text-xs text-emerald-400" data-testid="detection-godaddy-ready">
          <SiGodaddy className="w-3 h-3" />
          <span>
            {isApex
              ? `Detected: GoDaddy (root domain). One-click setup will CNAME www.${data.apexDomain} and forward ${data.apexDomain} → www.`
              : "Detected: GoDaddy. We can configure DNS for you in one click after adding."}
          </span>
        </div>
      );
    }
    if (data.godaddy.configured) {
      return (
        <div className="flex items-center gap-1.5 text-xs text-amber-400" data-testid="detection-godaddy-ownership">
          <SiGodaddy className="w-3 h-3" />
          <span>Detected: GoDaddy, but {data.apexDomain} isn't in your connected account.</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-xs text-blue-400" data-testid="detection-godaddy-unconfigured">
        <SiGodaddy className="w-3 h-3" />
        <span>Detected: GoDaddy. Connect your GoDaddy account below to enable one-click DNS setup.</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-white/50" data-testid={`detection-${data.provider}`}>
      <Globe className="w-3 h-3" /> Detected: {data.providerLabel}
      {data.provider !== "unknown" && <span className="text-white/30"> · auto-config not available for this provider yet</span>}
    </div>
  );
}

export function AutoConfigureButton({
  domainId,
  fullDomain,
  cnameTarget,
  onConfigured,
}: {
  domainId: number;
  fullDomain: string;
  cnameTarget: string | null;
  onConfigured?: () => void;
}) {
  const { toast } = useToast();
  const { data: detection } = useDomainDetection(fullDomain);
  const { data: status } = useGoDaddyStatus();

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/admin/domains/${domainId}/auto-configure`, { cnameTarget });
      return await r.json();
    },
    onSuccess: (result: any) => {
      // Server may return success=false with partialSuccess=true (e.g. CNAME set but apex
      //   forwarding rejected by GoDaddy). Surface that distinctly so the user knows what's
      //   left to do manually.
      if (result?.partialSuccess) {
        toast({
          title: "Partly done — manual step needed",
          description: result.note || "CNAME is set, but apex forwarding needs to be added manually in GoDaddy.",
          variant: "destructive",
        });
      } else if (result?.apexForwarding) {
        toast({
          title: "DNS configured in GoDaddy",
          description: `CNAME set on www.${result.apex}, and ${result.apex} now forwards (301) to ${result.apexForwarding.to}. Both usually go live within a few minutes.`,
        });
      } else {
        toast({
          title: "DNS configured in GoDaddy",
          description: "The CNAME record is in place. It usually goes live within a few minutes.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domains"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/domains", domainId, "dns-status"] });
      onConfigured?.();
    },
    onError: (e: any) => {
      toast({ title: "Auto-configure failed", description: e?.message || String(e), variant: "destructive" });
    },
  });

  if (!detection || detection.provider !== "godaddy") return null;
  if (!status?.configured) return null;
  if (!detection.godaddy.canAutoConfigure) {
    if (detection.godaddy.ownershipError) {
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] gap-1" data-testid={`badge-not-in-account-${domainId}`}>
          <ShieldAlert className="w-3 h-3" /> Not in GoDaddy account
        </Badge>
      );
    }
    return null;
  }
  if (!cnameTarget) {
    return (
      <Badge className="bg-white/[0.04] text-white/40 border-white/[0.06] text-[10px]" data-testid={`badge-no-target-${domainId}`}>
        Add to Replit Deployments first
      </Badge>
    );
  }

  return (
    <Button
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-lg gap-1.5 h-7 text-xs px-2.5"
      data-testid={`button-auto-configure-${domainId}`}
    >
      {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
      {mutation.isPending ? "Configuring…" : "Auto-configure DNS"}
    </Button>
  );
}

export function GoDaddyConnectionCard() {
  const { data, isLoading, refetch, isFetching } = useGoDaddyStatus();
  if (isLoading) return null;
  const configured = data?.configured;
  const valid = data?.valid;

  if (configured && valid) {
    return (
      <div
        className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-center justify-between gap-3"
        data-testid="card-godaddy-connected"
      >
        <div className="flex items-center gap-2.5">
          <SiGodaddy className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-xs font-medium text-emerald-300">GoDaddy account connected</div>
            <div className="text-[11px] text-emerald-300/60 mt-0.5">
              Domains in this account get one-click DNS setup automatically.
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-emerald-300/70 hover:text-emerald-300 hover:bg-emerald-500/10 h-7 text-[11px]"
          data-testid="button-recheck-godaddy"
        >
          {isFetching ? "Checking…" : "Recheck"}
        </Button>
      </div>
    );
  }

  if (configured && !valid) {
    return (
      <div
        className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2.5"
        data-testid="card-godaddy-invalid"
      >
        <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-xs font-medium text-red-300">GoDaddy credentials are set but not working</div>
          <div className="text-[11px] text-red-300/70 mt-0.5">{data?.error || "Check the API key and secret."}</div>
          <div className="text-[11px] text-red-300/50 mt-1">
            Generate a fresh production key at developer.godaddy.com/keys and update the GODADDY_API_KEY and GODADDY_API_SECRET environment secrets.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-2.5"
      data-testid="card-godaddy-not-configured"
    >
      <SiGodaddy className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="text-xs font-medium text-blue-300">Connect your GoDaddy account for one-click DNS</div>
        <div className="text-[11px] text-blue-300/70 mt-0.5 leading-relaxed">
          Add your GoDaddy <span className="font-mono">API key</span> and <span className="font-mono">secret</span> as environment secrets
          (<span className="font-mono">GODADDY_API_KEY</span>, <span className="font-mono">GODADDY_API_SECRET</span>).
          Generate a production key at <span className="font-mono">developer.godaddy.com/keys</span> — you only do this once and every domain in
          your account becomes one-click connectable.
        </div>
      </div>
    </div>
  );
}

export function GoDaddyVerifiedRecord({ domainId, fullDomain, cnameTarget }: { domainId: number; fullDomain: string; cnameTarget: string | null }) {
  const { data: detection } = useDomainDetection(fullDomain);
  const { data } = useQuery<{ configuredTarget: string | null; cnameHost: string; apex: string; isApex?: boolean; apexForwardingTo?: string | null }>({
    queryKey: ["/api/admin/domains", domainId, "dns-status"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/domains/${domainId}/dns-status`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!detection && detection.provider === "godaddy" && detection.godaddy.canAutoConfigure,
    refetchInterval: 30_000,
  });
  if (!data?.configuredTarget) return null;
  const matches = !!cnameTarget && data.configuredTarget.toLowerCase() === cnameTarget.toLowerCase();
  if (data.isApex) {
    const expectedFwd = `https://www.${data.apex}`;
    const fwdMatches = data.apexForwardingTo?.toLowerCase() === expectedFwd.toLowerCase();
    return (
      <div className="flex flex-wrap gap-1.5" data-testid={`badge-godaddy-record-${domainId}`}>
        <Badge
          className={matches
            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px] gap-1"
            : "bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] gap-1"}
        >
          <CheckCircle2 className="w-3 h-3" />
          {matches ? `CNAME www → ${cnameTarget}` : "www CNAME mismatch"}
        </Badge>
        <Badge
          className={fwdMatches
            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px] gap-1"
            : "bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] gap-1"}
        >
          <CheckCircle2 className="w-3 h-3" />
          {fwdMatches ? `Forward ${data.apex} → www` : data.apexForwardingTo ? "Forward set to wrong URL" : "Apex forward missing"}
        </Badge>
      </div>
    );
  }
  return (
    <Badge
      className={
        matches
          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px] gap-1"
          : "bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] gap-1"
      }
      data-testid={`badge-godaddy-record-${domainId}`}
    >
      <CheckCircle2 className="w-3 h-3" />
      {matches ? "CNAME live in GoDaddy" : "CNAME mismatch"}
    </Badge>
  );
}
