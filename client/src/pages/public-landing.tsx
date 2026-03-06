import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tent, MapPin, Calendar, Users, ArrowRight, DollarSign } from "lucide-react";

export default function PublicLanding() {
  const { data: camps, isLoading } = useQuery<any[]>({
    queryKey: ["/api/public/camps"],
  });

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-white border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-xs">CU</span>
            </div>
            <div>
              <span className="font-semibold text-[14px] text-slate-900 tracking-tight" data-testid="text-brand">Christchurch United FC</span>
              <span className="text-[10px] text-slate-400 tracking-wider uppercase block">Holiday Camps</span>
            </div>
          </div>
          <div />
        </div>
      </header>

      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59,130,246,0.3) 0%, transparent 70%)' }} />
        <div className="relative max-w-5xl mx-auto px-6 py-20 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-4" data-testid="text-hero-title">
            Holiday Football
            <span className="bg-gradient-to-r from-blue-400 to-blue-500 bg-clip-text text-transparent"> Camps</span>
          </h1>
          <p className="text-[16px] text-slate-300 max-w-lg mx-auto leading-relaxed mb-2">
            Fun, engaging football camps for players of all ages at Christchurch Football Centre.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="space-y-4">
          {isLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-48 w-full rounded-2xl bg-slate-100" />)
          ) : camps && camps.length > 0 ? (
            camps.map((camp: any) => (
              <Link key={camp.id} href={`/${camp.slug}`}>
                <div className="group rounded-2xl border border-slate-200 bg-white p-6 cursor-pointer hover:border-blue-300 hover:shadow-lg transition-all duration-300" data-testid={`card-camp-${camp.slug}`}>
                  <div className="flex flex-col md:flex-row gap-5">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200/50 flex items-center justify-center flex-shrink-0">
                      <Tent className="w-7 h-7 text-blue-600" />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{camp.name}</h2>
                        <p className="text-[14px] text-slate-500 mt-1 line-clamp-2">{camp.descriptionShort || camp.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-4">
                        {camp.startDate && camp.endDate && (
                          <div className="flex items-center gap-1.5 text-[13px] text-slate-400">
                            <Calendar className="w-3.5 h-3.5 text-blue-500" />
                            {new Date(camp.startDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} — {new Date(camp.endDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                          </div>
                        )}
                        {camp.location && (
                          <div className="flex items-center gap-1.5 text-[13px] text-slate-400">
                            <MapPin className="w-3.5 h-3.5 text-blue-500" />
                            {camp.location}
                          </div>
                        )}
                        {camp.ageMin && camp.ageMax && (
                          <div className="flex items-center gap-1.5 text-[13px] text-slate-400">
                            <Users className="w-3.5 h-3.5 text-blue-500" />
                            Ages {camp.ageMin}–{camp.ageMax}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200/50 flex items-center justify-center group-hover:bg-blue-600 group-hover:border-blue-600 transition-all duration-300">
                        <ArrowRight className="w-5 h-5 text-blue-600 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="text-center py-16">
              <Tent className="w-16 h-16 text-slate-200 mx-auto mb-4" />
              <h3 className="text-[16px] text-slate-600 font-medium">No camps available</h3>
              <p className="text-[13px] text-slate-400 mt-1">Check back soon for upcoming holiday camps</p>
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-slate-100 py-8">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-[12px] text-slate-400">© {new Date().getFullYear()} Christchurch United Football Club. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
