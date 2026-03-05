import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

export default function BookingCancel() {
  const [, params] = useRoute("/:slug/cancel");
  const slug = params?.slug || "";

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#02060E' }}>
      <div className="max-w-md mx-4 text-center animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <div className="w-20 h-20 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-10 h-10 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight mb-2" data-testid="text-cancel-title">Booking Cancelled</h1>
        <p className="text-[14px] text-white/40 mb-6">
          Your booking was not completed. No charges have been made.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href={`/${slug}/book`}>
            <Button className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-10 text-[13px] glow-btn" data-testid="button-try-again">
              Try Again
            </Button>
          </Link>
          <Link href="/">
            <Button variant="outline" className="rounded-xl h-10 text-[13px] border-white/[0.08] text-white/50" data-testid="button-back-home">
              Back to Camps
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
