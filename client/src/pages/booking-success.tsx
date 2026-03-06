import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Calendar, Mail, ArrowRight, Home } from "lucide-react";
import { trackEvent, generateEventId } from "@/lib/meta-pixel";

export default function BookingSuccess() {
  const [, params] = useRoute("/:slug/success");
  const slug = params?.slug || "";
  const urlParams = new URLSearchParams(window.location.search);
  const registrationId = urlParams.get("registrationId");
  const sessionId = urlParams.get("session_id");
  const [confirmed, setConfirmed] = useState(false);

  const { data: registration, isLoading } = useQuery<any>({
    queryKey: ["/api/public/registrations", registrationId],
    queryFn: async () => {
      const res = await fetch(`/api/public/registrations/${registrationId}`);
      if (!res.ok) throw new Error("Registration not found");
      return res.json();
    },
    enabled: !!registrationId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "confirmed" || confirmed) return false;
      return 2000;
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/public/confirm-payment", {
        registrationId: parseInt(registrationId || "0"),
        sessionId: sessionId || undefined,
      });
      return res.json();
    },
    onSuccess: () => setConfirmed(true),
  });

  useEffect(() => {
    if (sessionId && registrationId && !confirmed) {
      confirmMutation.mutate();
    }
  }, [sessionId, registrationId]);

  useEffect(() => {
    if (registration && (registration.status === "confirmed" || confirmed)) {
      const pixelId = (import.meta as any).env?.VITE_META_PIXEL_ID;
      if (pixelId) {
        const eventId = generateEventId();
        trackEvent("Purchase", {
          content_name: registration.campName,
          content_category: "Holiday Camp",
          value: (registration.totalCents || 0) / 100,
          currency: registration.currency || "NZD",
          content_ids: [registration.campSlug],
          num_items: registration.itemCount,
        }, eventId);
      }
    }
  }, [registration, confirmed]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="max-w-md mx-auto px-6 py-16 space-y-6 text-center">
          <Skeleton className="h-16 w-16 rounded-full bg-slate-100 mx-auto" />
          <Skeleton className="h-8 w-64 bg-slate-100 mx-auto" />
          <Skeleton className="h-32 w-full rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  const isConfirmed = registration?.status === "confirmed" || confirmed;
  const isPending = registration?.status === "pending" && !confirmed;

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-white border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
              <span className="text-white font-bold text-[9px]">CU</span>
            </div>
            <span className="text-[12px] text-slate-400 font-medium">Christchurch United FC</span>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 py-16 text-center">
        {isConfirmed ? (
          <div className="space-y-6">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="w-10 h-10 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight" data-testid="text-success-title">Booking Confirmed!</h1>
              <p className="text-[15px] text-slate-500 mt-2">Thank you for booking with Christchurch United FC</p>
            </div>

            {registration && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-left space-y-3" data-testid="card-booking-summary">
                <h3 className="text-[13px] text-slate-400 font-medium uppercase tracking-wider">Booking Summary</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-[14px]">
                    <span className="text-slate-500">Camp</span>
                    <span className="text-slate-800 font-medium">{registration.campName}</span>
                  </div>
                  <div className="flex justify-between text-[14px]">
                    <span className="text-slate-500">Booking</span>
                    <span className="text-slate-800 font-medium">#{registration.id}</span>
                  </div>
                  <div className="flex justify-between text-[14px]">
                    <span className="text-slate-500">Sessions</span>
                    <span className="text-slate-800 font-medium">{registration.itemCount} booked</span>
                  </div>
                  {registration.totalCents > 0 && (
                    <div className="flex justify-between text-[16px] font-semibold pt-2 border-t border-slate-200">
                      <span className="text-slate-600">Total Paid</span>
                      <span className="text-slate-900">${(registration.totalCents / 100).toFixed(2)} {registration.currency}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-left">
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[14px] font-medium text-blue-800">Confirmation email sent</p>
                  <p className="text-[13px] text-blue-600 mt-0.5">
                    We've sent a confirmation to {registration?.parentEmail || "your email"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <Link href={`/${slug}`}>
                <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white border-0 rounded-xl h-12 text-[15px] font-semibold shadow-sm" data-testid="button-back-to-camp">
                  <ArrowRight className="w-4 h-4 mr-1.5" /> View Camp Details
                </Button>
              </Link>
              <Link href="/">
                <Button variant="outline" className="w-full rounded-xl h-12 text-[14px] border-slate-200 text-slate-600" data-testid="button-home">
                  <Home className="w-4 h-4 mr-1.5" /> All Camps
                </Button>
              </Link>
            </div>
          </div>
        ) : isPending ? (
          <div className="space-y-6">
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <Calendar className="w-10 h-10 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight" data-testid="text-pending-title">Booking Pending</h1>
              <p className="text-[15px] text-slate-500 mt-2">
                {confirmMutation.isPending ? "Confirming your payment..." : "Your booking is awaiting payment confirmation."}
              </p>
            </div>
            <Link href={`/${slug}`}>
              <Button variant="outline" className="rounded-xl h-12 text-[14px] border-slate-200 text-slate-600">
                Back to Camp
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
              <Calendar className="w-10 h-10 text-slate-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Booking Not Found</h1>
              <p className="text-[15px] text-slate-500 mt-2">We couldn't find this booking. Please try again.</p>
            </div>
            <Link href="/">
              <Button variant="outline" className="rounded-xl h-12 text-[14px] border-slate-200 text-slate-600">
                Back to Camps
              </Button>
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
