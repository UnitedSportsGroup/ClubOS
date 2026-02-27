import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GraduationCap,
  Users,
  ChevronRight,
  ArrowLeft,
  TrendingUp,
  DollarSign,
  UserCheck,
  Clock,
} from "lucide-react";

type ProgramStat = {
  id: number;
  name: string;
  ageMin: number | null;
  ageMax: number | null;
  capacity: number | null;
  fee: string | null;
  totalRegistrations: number;
  confirmedRegistrations: number;
  pendingRegistrations: number;
  revenue: number;
};

type Tier = {
  key: string;
  label: string;
  ageRange: string;
  programs: ProgramStat[];
  totalRegistrations: number;
  confirmedRegistrations: number;
  pendingRegistrations: number;
  totalCapacity: number;
  totalRevenue: number;
};

type AcademyStats = {
  tiers: Tier[];
};

const tierColors: Record<string, { accent: string; bg: string; border: string; icon: string; bar: string }> = {
  "u4-u8": {
    accent: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    icon: "text-emerald-400",
    bar: "bg-emerald-500",
  },
  "u9-u12": {
    accent: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    icon: "text-amber-400",
    bar: "bg-amber-500",
  },
  "u13-u20": {
    accent: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    icon: "text-blue-400",
    bar: "bg-blue-500",
  },
};

function TierCard({ tier, onClick, delay }: { tier: Tier; onClick: () => void; delay: number }) {
  const colors = tierColors[tier.key] || tierColors["u13-u20"];
  const fillPercent = tier.totalCapacity > 0 ? Math.round((tier.totalRegistrations / tier.totalCapacity) * 100) : 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl glass-card p-5 transition-all duration-300 hover:border-blue-500/25 hover:scale-[1.01] group animate-fade-in-up cursor-pointer"
      style={{ animationDelay: `${delay}ms`, opacity: 0 }}
      data-testid={`tier-card-${tier.key}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center`}>
            <GraduationCap className={`w-5 h-5 ${colors.icon}`} />
          </div>
          <div>
            <h4 className="text-[14px] font-semibold text-white/85">{tier.label}</h4>
            <p className="text-[11px] text-white/30">{tier.ageRange}</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/15 group-hover:text-blue-400/50 group-hover:translate-x-0.5 transition-all duration-300" />
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <span className="text-3xl font-bold text-white tracking-tight">{tier.totalRegistrations}</span>
          <span className="text-[11px] text-white/30 ml-1.5">registered</span>
        </div>
        <div className="text-right">
          <span className={`text-[13px] font-semibold ${colors.accent}`}>{fillPercent}%</span>
          <p className="text-[10px] text-white/25">capacity</p>
        </div>
      </div>

      <div className="w-full h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className={`h-full rounded-full ${colors.bar} transition-all duration-700`}
          style={{ width: `${Math.min(fillPercent, 100)}%` }}
        />
      </div>

      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-white/35">{tier.confirmedRegistrations} confirmed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-[10px] text-white/35">{tier.pendingRegistrations} pending</span>
        </div>
        <div className="ml-auto">
          <span className="text-[10px] text-white/25">{tier.programs.length} programme{tier.programs.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </button>
  );
}

function TierDetail({ tier, onBack }: { tier: Tier; onBack: () => void }) {
  const colors = tierColors[tier.key] || tierColors["u13-u20"];

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[12px] text-blue-400/60 hover:text-blue-400 transition-colors duration-200 mb-4 cursor-pointer"
        data-testid="button-back-to-overview"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Overview
      </button>

      <div className="flex items-center gap-3 mb-5">
        <div className={`w-10 h-10 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center`}>
          <GraduationCap className={`w-5 h-5 ${colors.icon}`} />
        </div>
        <div>
          <h4 className="text-[16px] font-semibold text-white/90">{tier.label}</h4>
          <p className="text-[11px] text-white/30">{tier.ageRange} · {tier.programs.length} programme{tier.programs.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center">
          <Users className="w-4 h-4 text-blue-400/50 mx-auto mb-1.5" />
          <span className="text-[18px] font-bold text-white block">{tier.totalRegistrations}</span>
          <span className="text-[9px] text-white/30 uppercase tracking-wider">Total</span>
        </div>
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center">
          <UserCheck className="w-4 h-4 text-emerald-400/50 mx-auto mb-1.5" />
          <span className="text-[18px] font-bold text-white block">{tier.confirmedRegistrations}</span>
          <span className="text-[9px] text-white/30 uppercase tracking-wider">Confirmed</span>
        </div>
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center">
          <Clock className="w-4 h-4 text-amber-400/50 mx-auto mb-1.5" />
          <span className="text-[18px] font-bold text-white block">{tier.pendingRegistrations}</span>
          <span className="text-[9px] text-white/30 uppercase tracking-wider">Pending</span>
        </div>
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center">
          <DollarSign className="w-4 h-4 text-violet-400/50 mx-auto mb-1.5" />
          <span className="text-[18px] font-bold text-white block">${tier.totalRevenue.toLocaleString()}</span>
          <span className="text-[9px] text-white/30 uppercase tracking-wider">Revenue</span>
        </div>
      </div>

      <div className="space-y-2">
        {tier.programs.map((program, i) => {
          const fillPercent = program.capacity ? Math.round((program.totalRegistrations / program.capacity) * 100) : 0;

          return (
            <div
              key={program.id}
              className="rounded-xl bg-white/[0.015] border border-white/[0.04] p-4 hover:border-blue-500/15 transition-all duration-300 animate-fade-in-up"
              style={{ animationDelay: `${(i + 1) * 60}ms`, opacity: 0 }}
              data-testid={`program-detail-${program.id}`}
            >
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <h5 className="text-[13px] font-medium text-white/80">{program.name}</h5>
                  <p className="text-[10px] text-white/25">
                    Ages {program.ageMin}–{program.ageMax} · {program.fee ? `$${program.fee}/player` : "Free"}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[18px] font-bold text-white">{program.totalRegistrations}</span>
                  <span className="text-[11px] text-white/25">/{program.capacity ?? "∞"}</span>
                </div>
              </div>

              <div className="w-full h-1.5 rounded-full bg-white/[0.04] overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full ${colors.bar} transition-all duration-700`}
                  style={{ width: `${Math.min(fillPercent, 100)}%` }}
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-white/35">{program.confirmedRegistrations} confirmed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[10px] text-white/35">{program.pendingRegistrations} pending</span>
                </div>
                <div className="ml-auto">
                  <span className="text-[10px] text-white/25">${program.revenue.toLocaleString()} collected</span>
                </div>
              </div>
            </div>
          );
        })}

        {tier.programs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <GraduationCap className="w-8 h-8 text-blue-400/10 mb-2" />
            <p className="text-[12px] text-white/25">No programmes in this tier yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcademyProgramsBlock() {
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  const { data, isLoading } = useQuery<AcademyStats>({
    queryKey: ["/api/academy-stats"],
  });

  const totalRegistrations = data?.tiers.reduce((s, t) => s + t.totalRegistrations, 0) ?? 0;
  const activeTier = data?.tiers.find((t) => t.key === selectedTier);

  return (
    <div className="rounded-2xl glass-card overflow-hidden" data-testid="block-academy-programs">
      <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-white/80">Academy Programmes</h3>
            <p className="text-[10px] text-white/25">{totalRegistrations} total registrations across all tiers</p>
          </div>
        </div>
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl glass-card p-5">
                <Skeleton className="h-32 w-full bg-blue-500/[0.04]" />
              </div>
            ))}
          </div>
        ) : activeTier ? (
          <TierDetail tier={activeTier} onBack={() => setSelectedTier(null)} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data?.tiers.map((tier, i) => (
              <TierCard
                key={tier.key}
                tier={tier}
                onClick={() => setSelectedTier(tier.key)}
                delay={50 + i * 80}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
