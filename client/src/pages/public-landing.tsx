import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tent, MapPin, Calendar, Users, ArrowRight } from "lucide-react";

export default function PublicLanding() {
  const { data: camps, isLoading } = useQuery<any[]>({
    queryKey: ["/api/public/camps"],
  });

  return (
    <div className="min-h-screen" style={{ background: '#02060E' }}>
      <header className="border-b border-blue-500/[0.08] backdrop-blur-2xl" style={{ background: 'rgba(2,6,14,0.8)' }}>
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/25">
              <span className="text-white font-bold text-xs">CU</span>
            </div>
            <div>
              <span className="font-semibold text-[14px] text-white/90 tracking-tight" data-testid="text-brand">Christchurch United FC</span>
              <span className="text-[10px] text-blue-400/40 tracking-wider uppercase block">Holiday Camps</span>
            </div>
          </div>
          <div />
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight" data-testid="text-hero-title">
            Holiday Football
            <span className="bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent"> Camps</span>
          </h1>
          <p className="text-[15px] text-white/40 max-w-lg mx-auto mt-4 leading-relaxed">
            Fun, engaging football camps for players of all ages at Christchurch Football Centre. Book your spot today.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="space-y-4">
          {isLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl bg-blue-500/[0.04]" />)
          ) : camps && camps.length > 0 ? (
            camps.map((camp: any, index: number) => (
              <Link key={camp.id} href={`/${camp.slug}`}>
                <div
                  className="group rounded-2xl border border-blue-500/[0.1] p-6 cursor-pointer hover:border-blue-500/25 transition-all duration-500 animate-fade-in-up"
                  style={{ background: 'linear-gradient(135deg, rgba(3,86,197,0.05) 0%, rgba(2,6,14,0.95) 100%)', animationDelay: `${100 + index * 100}ms`, opacity: 0 }}
                  data-testid={`card-camp-${camp.slug}`}
                >
                  <div className="flex flex-col md:flex-row gap-5">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/15 to-emerald-500/10 border border-blue-500/15 flex items-center justify-center flex-shrink-0">
                      <Tent className="w-7 h-7 text-blue-400/70" />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <h2 className="text-lg font-semibold text-white/85 group-hover:text-white transition-colors">{camp.name}</h2>
                        <p className="text-[13px] text-white/35 mt-1 line-clamp-2">{camp.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-4">
                        {camp.startDate && camp.endDate && (
                          <div className="flex items-center gap-1.5 text-[12px] text-white/30">
                            <Calendar className="w-3.5 h-3.5 text-blue-400/40" />
                            {camp.startDate} — {camp.endDate}
                          </div>
                        )}
                        {camp.location && (
                          <div className="flex items-center gap-1.5 text-[12px] text-white/30">
                            <MapPin className="w-3.5 h-3.5 text-blue-400/40" />
                            {camp.location}
                          </div>
                        )}
                        {camp.ageMin && camp.ageMax && (
                          <div className="flex items-center gap-1.5 text-[12px] text-white/30">
                            <Users className="w-3.5 h-3.5 text-blue-400/40" />
                            Ages {camp.ageMin}–{camp.ageMax}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20 group-hover:shadow-[0_0_16px_rgba(3,86,197,0.15)] transition-all duration-500">
                        <ArrowRight className="w-5 h-5 text-blue-400 group-hover:translate-x-0.5 transition-transform duration-300" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="text-center py-16">
              <Tent className="w-16 h-16 text-blue-400/10 mx-auto mb-4" />
              <h3 className="text-[16px] text-white/40 font-medium">No camps available</h3>
              <p className="text-[13px] text-white/20 mt-1">Check back soon for upcoming holiday camps</p>
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-blue-500/[0.06] py-8">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-[12px] text-white/15">© {new Date().getFullYear()} Christchurch United Football Club</p>
        </div>
      </footer>
    </div>
  );
}
