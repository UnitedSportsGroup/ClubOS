// ─────────────────────────────────────────────────────────────────────────────
// Funnels — every funnel of every campaign on one page.
// United Sports Group → Marketing → Funnels.
//
// Daniel, 2026-11-14: "alongside campaigns, maybe underneath it, is funnels …
// within a campaign there could actually be multiple funnels."
//
// A funnel belongs to a campaign and is made and edited on the campaign's
// Funnels tab; this page is the place to compare them side by side.
// ─────────────────────────────────────────────────────────────────────────────
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { FunnelCard } from "@/components/campaigns/funnels";
import type { FunnelView } from "@shared/funnels";

type Payload = { today: string; funnels: FunnelView[]; campaigns: { id: number; name: string; status: string }[] };

export default function FunnelsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery<Payload>({ queryKey: ["/api/admin/campaigns/funnels"], staleTime: 30_000 });
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Funnels</h1>
        <p className="text-sm text-muted-foreground mt-1">From seeing the ad to paying: how many people reach each step, and the share that goes on.</p>
      </div>
      {isLoading && <Loading rows={4} />}
      {isError && <LoadError error={error} onRetry={refetch} />}
      {data && data.funnels.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3" data-testid="funnels-empty">
          <p className="text-base font-medium text-foreground">No funnels yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            A funnel lives inside a campaign. Open a campaign, go to its Funnels tab and add one for each way people come in: the ads, an email, everyone.
          </p>
          <Link href="/admin/campaigns" className="inline-flex items-center h-11 md:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">
            <Target className="w-4 h-4 mr-1.5" aria-hidden />
            Go to Campaigns
          </Link>
        </div>
      )}
      {data?.funnels.map((f) => (
        <FunnelCard key={f.id} funnel={f} campaignLink={`/admin/campaigns/${f.campaignId}?tab=funnels&from=/admin/funnels`} />
      ))}
    </div>
  );
}
