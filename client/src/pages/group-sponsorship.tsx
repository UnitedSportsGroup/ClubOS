import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Handshake } from "lucide-react";

export default function GroupSponsorship() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Sponsorship</h1>
        <p className="text-sm text-white/40 mt-1">Manage sponsor relationships, contracts, and deliverables</p>
      </div>

      <Card className="premium-card border-white/[0.06]">
        <CardContent className="py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
            <Handshake className="w-8 h-8 text-blue-400/40" />
          </div>
          <h2 className="text-lg font-medium text-white/60 mb-2">Coming Soon</h2>
          <p className="text-sm text-white/30 max-w-md mx-auto">
            The sponsorship module will allow you to track sponsors, manage contracts, 
            deliverables, and revenue across all United Sports Group entities.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
