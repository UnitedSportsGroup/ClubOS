import { Card, CardContent } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

export default function FeesPage() {
  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Fees & Invoicing</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage fees, payments, and invoices
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <DollarSign className="w-12 h-12 text-muted-foreground/20 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">Fee management coming soon</p>
          <p className="text-xs text-muted-foreground mt-1">
            This module will include Stripe integration, invoicing, and payment tracking
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
