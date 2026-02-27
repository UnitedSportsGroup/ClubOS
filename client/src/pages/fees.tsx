import { DollarSign } from "lucide-react";

export default function FeesPage() {
  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Fees & Invoicing</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">
          Manage fees, payments, and invoices
        </p>
      </div>
      <div className="rounded-2xl glass-card animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/[0.04] border border-blue-500/[0.1] flex items-center justify-center mb-5 animate-pulse-glow">
            <DollarSign className="w-6 h-6 text-blue-400/15" />
          </div>
          <p className="text-[14px] font-medium text-white/45">Fee management coming soon</p>
          <p className="text-[12px] text-white/30 mt-1.5 max-w-sm">
            This module will include Stripe integration, invoicing, and payment tracking
          </p>
        </div>
      </div>
    </div>
  );
}
