import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tent, MapPin, Calendar, Users, DollarSign, ArrowLeft, Percent, Clock } from "lucide-react";

export default function CampPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";

  const { data, isLoading, error } = useQuery<{
    camp: any;
    pricing: any[];
    dates: any[];
    discounts: any[];
  }>({
    queryKey: ["/api/public/camps", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/camps/${slug}`);
      if (!res.ok) throw new Error("Camp not found");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ background: '#02060E' }}>
        <div className="max-w-3xl mx-auto px-6 py-16 space-y-6">
          <Skeleton className="h-10 w-64 bg-blue-500/[0.04]" />
          <Skeleton className="h-40 w-full rounded-2xl bg-blue-500/[0.04]" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#02060E' }}>
        <div className="text-center">
          <Tent className="w-16 h-16 text-blue-400/10 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white/60 mb-2">Camp not found</h2>
          <Link href="/">
            <Button variant="ghost" className="text-blue-400/60 rounded-xl">Back to camps</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { camp, pricing, dates, discounts } = data;

  const sessionTypes: Record<string, { label: string; icon: any; timeLabel: string }> = {
    MORNING: { label: "Morning Session", icon: Clock, timeLabel: "9:00am – 12:00pm" },
    AFTERNOON: { label: "Afternoon Session", icon: Clock, timeLabel: "1:00pm – 4:00pm" },
    FULL_DAY: { label: "Full Day", icon: Clock, timeLabel: "9:00am – 4:00pm" },
  };

  return (
    <div className="min-h-screen" style={{ background: '#02060E' }}>
      <header className="border-b border-blue-500/[0.08] backdrop-blur-2xl sticky top-0 z-10" style={{ background: 'rgba(2,6,14,0.85)' }}>
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <button className="flex items-center gap-2 text-white/40 hover:text-white/60 transition-colors cursor-pointer" data-testid="link-back">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[13px]">All Camps</span>
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <span className="text-white font-bold text-[9px]">CU</span>
            </div>
            <span className="text-[12px] text-white/40">CUFC</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
          <h1 className="text-3xl font-bold text-white tracking-tight" data-testid="text-camp-name">{camp.name}</h1>
          <div className="flex flex-wrap gap-4 mt-4">
            {camp.startDate && camp.endDate && (
              <div className="flex items-center gap-1.5 text-[13px] text-white/40">
                <Calendar className="w-4 h-4 text-blue-400/50" />
                {camp.startDate} — {camp.endDate}
              </div>
            )}
            {camp.location && (
              <div className="flex items-center gap-1.5 text-[13px] text-white/40">
                <MapPin className="w-4 h-4 text-blue-400/50" />
                {camp.location}
              </div>
            )}
            {camp.ageMin && camp.ageMax && (
              <div className="flex items-center gap-1.5 text-[13px] text-white/40">
                <Users className="w-4 h-4 text-blue-400/50" />
                Ages {camp.ageMin}–{camp.ageMax}
              </div>
            )}
          </div>
        </div>

        {camp.description && (
          <div className="rounded-2xl glass-card p-6 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
            <p className="text-[14px] text-white/50 leading-relaxed whitespace-pre-line" data-testid="text-description">{camp.description}</p>
          </div>
        )}

        <div className="rounded-2xl glass-card p-6 animate-fade-in-up" style={{ animationDelay: '150ms', opacity: 0 }}>
          <h3 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold mb-4">Camp Dates</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {dates.map((d: any) => (
              <div key={d.id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center" data-testid={`date-${d.id}`}>
                <p className="text-[13px] text-white/70 font-medium">{new Date(d.date + 'T12:00:00').toLocaleDateString('en-NZ', { weekday: 'short' })}</p>
                <p className="text-[11px] text-white/30 mt-0.5">{new Date(d.date + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</p>
              </div>
            ))}
          </div>
        </div>

        {pricing.length > 0 && (
          <div className="rounded-2xl glass-card p-6 animate-fade-in-up" style={{ animationDelay: '200ms', opacity: 0 }}>
            <h3 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold mb-4">Pricing (per day)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {pricing.map((p: any) => {
                const info = sessionTypes[p.productType] || { label: p.productType, icon: DollarSign, timeLabel: "" };
                return (
                  <div key={p.productType} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 text-center hover:border-blue-500/20 transition-colors" data-testid={`price-${p.productType}`}>
                    <info.icon className="w-5 h-5 text-blue-400/50 mx-auto mb-2" />
                    <p className="text-[13px] font-medium text-white/70">{info.label}</p>
                    <p className="text-[11px] text-white/25 mt-0.5">{info.timeLabel}</p>
                    <p className="text-xl font-bold text-white mt-2">${(p.priceCents / 100).toFixed(2)}</p>
                    <p className="text-[10px] text-white/20">NZD</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {discounts.length > 0 && (
          <div className="rounded-2xl glass-card p-6 animate-fade-in-up" style={{ animationDelay: '250ms', opacity: 0 }}>
            <h3 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold mb-3">Volume Discounts</h3>
            <div className="space-y-2">
              {discounts.map((d: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[13px]">
                  <Percent className="w-4 h-4 text-emerald-400/50" />
                  <span className="text-white/50">Book {d.minBookings}+ sessions and save</span>
                  <span className="text-emerald-400/80 font-medium">{d.discountPercent}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="animate-fade-in-up" style={{ animationDelay: '300ms', opacity: 0 }}>
          <Link href={`/${slug}/book`}>
            <Button className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-2xl h-14 text-[15px] font-semibold glow-btn shadow-lg shadow-blue-500/20" data-testid="button-book-now">
              Book Now
            </Button>
          </Link>
        </div>
      </main>

      <footer className="border-t border-blue-500/[0.06] py-8 mt-8">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <p className="text-[12px] text-white/15">© {new Date().getFullYear()} Christchurch United Football Club</p>
        </div>
      </footer>
    </div>
  );
}
