import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

export default function BookingSuccess() {
  const [, params] = useRoute("/:slug/success");
  const slug = params?.slug || "";
  const urlParams = new URLSearchParams(window.location.search);
  const total = parseInt(urlParams.get("total") || "0");
  const registrationId = urlParams.get("registrationId");

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#02060E' }}>
      <div className="max-w-md mx-4 text-center animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-10 h-10 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight mb-2" data-testid="text-success-title">Booking Confirmed!</h1>
        <p className="text-[14px] text-white/40 mb-6">
          Thank you for your booking. A confirmation email will be sent shortly.
        </p>
        {registrationId && (
          <p className="text-[12px] text-white/25 mb-2">Reference: #{registrationId}</p>
        )}
        {total > 0 && (
          <p className="text-[14px] text-white/50 font-medium mb-6" data-testid="text-total-paid">
            Total: ${(total / 100).toFixed(2)} NZD
          </p>
        )}
        <Link href="/">
          <Button className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-10 text-[13px] glow-btn" data-testid="button-back-home">
            Back to Camps
          </Button>
        </Link>
      </div>
    </div>
  );
}
