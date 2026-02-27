import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  MapPin,
  Calendar,
  Users,
  DollarSign,
  ChevronRight,
  Shield,
  Loader2,
  GraduationCap,
} from "lucide-react";
import type { Program } from "@shared/schema";

interface PublicProgramsData {
  programs: (Pick<Program, "id" | "name" | "slug" | "type" | "description" | "location" | "startDate" | "endDate" | "capacity" | "ageMin" | "ageMax" | "fee">)[];
  club: { name: string; shortName: string };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
}

function formatFee(fee: string | null) {
  if (!fee || fee === "0") return "Free";
  return `$${parseFloat(fee).toFixed(2)}`;
}

function tierColor(ageMin: number | null) {
  const min = ageMin || 0;
  if (min <= 8) return { bg: "from-emerald-500/15 to-emerald-600/5", border: "border-emerald-500/15", text: "text-emerald-400", glow: "hover:shadow-emerald-500/10" };
  if (min <= 12) return { bg: "from-amber-500/15 to-amber-600/5", border: "border-amber-500/15", text: "text-amber-400", glow: "hover:shadow-amber-500/10" };
  return { bg: "from-blue-500/15 to-blue-600/5", border: "border-blue-500/15", text: "text-blue-400", glow: "hover:shadow-blue-500/10" };
}

function typeLabel(type: string) {
  if (type === "academy") return "Academy";
  if (type === "holiday_camp") return "Holiday Camp";
  if (type === "trials") return "Trials";
  if (type === "open_training") return "Open Training";
  return "Event";
}

export default function RegisterIndexPage() {
  const { data, isLoading } = useQuery<PublicProgramsData>({
    queryKey: ["/api/public/programs"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#02060E" }}>
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  const programs = data?.programs || [];
  const club = data?.club || { name: "Christchurch United Football Club", shortName: "CUFC" };

  return (
    <div className="min-h-screen" style={{ background: "#02060E" }}>
      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at 30% 0%, rgba(3,86,197,0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 100%, rgba(3,86,197,0.05) 0%, transparent 60%)",
      }} />

      <header className="relative z-10 border-b border-white/[0.04] backdrop-blur-xl" style={{ background: "rgba(2,6,14,0.8)" }}>
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/25 to-blue-600/10 border border-blue-500/15 flex items-center justify-center">
              <span className="text-[11px] font-bold text-blue-400">{club.shortName}</span>
            </div>
            <div>
              <p className="text-[13px] font-medium text-white/70" data-testid="text-club-name">{club.name}</p>
              <p className="text-[10px] text-white/25">Registration Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/60">
            <Shield className="w-3 h-3" />
            <span>Secure</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-10">
        <div className="text-center mb-10 animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
          <h1 className="text-2xl font-semibold text-white tracking-tight mb-2" data-testid="text-page-title">Programme Registration</h1>
          <p className="text-[14px] text-white/35 max-w-md mx-auto">Choose a programme below to register your child for the upcoming season.</p>
        </div>

        {programs.length === 0 ? (
          <div className="text-center py-16 animate-fade-in-up" style={{ animationDelay: "50ms", opacity: 0 }}>
            <GraduationCap className="w-12 h-12 text-white/10 mx-auto mb-3" />
            <p className="text-white/30 text-sm">No programmes currently accepting registrations.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {programs.map((program, i) => {
              const colors = tierColor(program.ageMin);
              return (
                <Link
                  key={program.id}
                  href={`/register/${program.slug}`}
                  className={`block rounded-2xl bg-gradient-to-br ${colors.bg} border ${colors.border} p-5 transition-all duration-300 hover:shadow-xl ${colors.glow} hover:scale-[1.01] cursor-pointer group animate-fade-in-up`}
                  style={{ animationDelay: `${50 + i * 50}ms`, opacity: 0 }}
                  data-testid={`card-program-${program.slug}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className={`text-[10px] ${colors.text} uppercase tracking-wider font-medium mb-1.5`}>
                        {typeLabel(program.type)}
                        {program.ageMin && <span className="ml-2 text-white/20">Ages {program.ageMin}–{program.ageMax}</span>}
                      </div>
                      <h3 className="text-[15px] font-medium text-white/80 mb-2 group-hover:text-white transition-colors">{program.name}</h3>
                      <div className="flex flex-wrap gap-3">
                        {program.location && (
                          <span className="flex items-center gap-1 text-[11px] text-white/25">
                            <MapPin className="w-3 h-3" />{program.location}
                          </span>
                        )}
                        {program.startDate && (
                          <span className="flex items-center gap-1 text-[11px] text-white/25">
                            <Calendar className="w-3 h-3" />{formatDate(program.startDate)}
                          </span>
                        )}
                        {program.fee && (
                          <span className="flex items-center gap-1 text-[11px] text-white/25">
                            <DollarSign className="w-3 h-3" />{formatFee(program.fee)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-white/15 group-hover:text-white/40 transition-colors shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-10 text-center animate-fade-in-up" style={{ animationDelay: "200ms", opacity: 0 }}>
          <p className="text-[10px] text-white/15">
            Powered by <span className="text-white/25 font-medium">ClubOS</span> · {club.name}
          </p>
        </div>
      </main>
    </div>
  );
}
