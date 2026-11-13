// CUGC — Programs (Gymnastics workspace → Programs tab).
//
// Drawn the SAME WAY as the CUFC Academy page (admin-academy.tsx): heading,
// Programs | Term Dates tabs, a search box, and glass-card sections holding one
// table row per programme. Daniel, 2026-11-14: "make clubos cugc programs show
// same as cufc to keep the software uniform across the board — remove photos
// for now." The photo cards are gone; the columns are CUFC's.
//
// The DATA is still the live cugc.co.nz lineup — served from the same server
// config (server/cugc-pricing.ts) that prices the website's enrol flow, so this
// page can never drift from the site. Names/prices/times change in that config.
//
// 🔴 Registrations = PAID only ("if you ain't paid you ain't registered"), and
// for a term programme only the rows stamped with the term shown — a
// registration knows which term it is for; the term being sold moves.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, Sparkles, Search, Users, ChevronRight, ExternalLink } from "lucide-react";

const SITE = "https://cugc.co.nz";

interface Registration {
  id: number;
  programSlug: string;
  status: string;
  term: string | null;
}
interface CugcProgram {
  slug: string; title: string; ages: string;
  annual?: boolean; inviteOnly?: boolean;
  options: { label: string; price: number; times: string[] }[];
}
interface ProgramConfig {
  term: { name: string; start: string; end: string; weeks: number };
  programs: CugcProgram[];
}

function formatDateRange(startIso: string, endIso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Read the y-m-d parts directly — never put a bare ISO date through local time.
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  if (!sy || !ey) return "—";
  const dd = (n: number) => String(n).padStart(2, "0");
  if (sm === em && sy === ey) return `${dd(sd)} – ${dd(ed)} ${months[em - 1]} ${ey}`;
  return `${dd(sd)} ${months[sm - 1]} – ${dd(ed)} ${months[em - 1]} ${ey}`;
}

function priceLabel(p: CugcProgram): string {
  const prices = p.options.map((o) => o.price).filter((n) => n > 0);
  if (prices.length === 0) return "";
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return lo === hi ? `$${lo} / term` : `$${lo}–$${hi} / term`;
}

function ProgramTable({ programs, period, countFor, onOpen, emptyMessage }: {
  programs: CugcProgram[];
  period: (p: CugcProgram) => string;
  countFor: (p: CugcProgram) => number;
  onOpen: (p: CugcProgram) => void;
  emptyMessage: string;
}) {
  if (programs.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-[12px] text-white/20">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[500px]" data-testid="table-cugc-programs">
        <thead>
          <tr className="border-b border-blue-500/[0.08]">
            <th className="text-left px-5 py-3 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Program</th>
            <th className="text-left px-5 py-3 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold hidden md:table-cell">Period</th>
            <th className="text-left px-5 py-3 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold hidden lg:table-cell">Ages</th>
            <th className="text-center px-5 py-3 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Status</th>
            <th className="text-center px-5 py-3 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Registrations</th>
            <th className="w-10 px-3 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {programs.map((p, idx) => {
            const price = priceLabel(p);
            return (
              <tr
                key={p.slug}
                onClick={() => onOpen(p)}
                className={`group cursor-pointer transition-colors duration-200 hover:bg-blue-500/[0.04] ${idx < programs.length - 1 ? "border-b border-blue-500/[0.05]" : ""}`}
                data-testid={`program-${p.slug}`}
              >
                <td className="px-5 py-3.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-white/80">{p.title}</span>
                    <span className="text-[11px] text-blue-400/30">/{p.slug}{price ? ` · ${price}` : ""}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 hidden md:table-cell">
                  <span className="text-[12px] text-white/40">{period(p)}</span>
                </td>
                <td className="px-5 py-3.5 hidden lg:table-cell">
                  <span className="text-[12px] text-white/40">{p.ages || "—"}</span>
                </td>
                <td className="px-5 py-3.5 text-center">
                  {p.inviteOnly ? (
                    <Badge variant="outline" className="text-[9px] text-amber-400/70 border-amber-500/15 bg-amber-500/10 uppercase tracking-wider no-default-hover-elevate no-default-active-elevate">
                      By invitation
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] text-emerald-400/70 border-emerald-500/15 bg-emerald-500/10 uppercase tracking-wider no-default-hover-elevate no-default-active-elevate">
                      Active
                    </Badge>
                  )}
                </td>
                <td className="px-5 py-3.5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-blue-400/30" />
                    <span className="text-[13px] text-white/60 font-medium">{countFor(p)}</span>
                  </div>
                </td>
                <td className="px-3 py-3.5 text-right">
                  <ChevronRight className="w-4 h-4 text-white/15 group-hover:text-blue-400/50 transition-colors duration-200" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CugcPrograms() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState("");
  const { data: cfg, isLoading } = useQuery<ProgramConfig>({ queryKey: ["/api/admin/cugc/programs"] });
  const { data: regos = [] } = useQuery<Registration[]>({ queryKey: ["/api/admin/cugc/registrations"] });

  const termName = cfg?.term.name ?? "";
  const countFor = (p: CugcProgram) =>
    regos.filter((r) => r.programSlug === p.slug && r.status === "paid" && (p.annual || r.term === termName)).length;
  const period = (p: CugcProgram) =>
    p.annual ? "Annual program" : cfg ? formatDateRange(cfg.term.start, cfg.term.end) : "—";
  // The roster for a programme, on the term shown here (an annual one has no term to pin).
  const onOpen = (p: CugcProgram) => {
    const q = new URLSearchParams({ program: p.slug });
    if (!p.annual && termName) q.set("term", termName);
    navigate(`/admin/cugc-registrations?${q.toString()}`);
  };

  const needle = filter.trim().toLowerCase();
  const filtered = (cfg?.programs ?? []).filter((p) =>
    !needle || p.title.toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle));
  const termPrograms = filtered.filter((p) => !p.inviteOnly && !p.annual);
  const competitivePrograms = filtered.filter((p) => p.inviteOnly || p.annual);

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Programs</h1>
          <p className="text-blue-400/35 text-[13px] mt-1">
            {termName ? `${termName} · ` : ""}The live cugc.co.nz lineup — enrolments land in Registrations automatically
          </p>
        </div>
        <a
          href={`${SITE}/programs`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border border-blue-500/20 text-blue-400 hover:bg-blue-500/10 text-[13px] font-medium transition-colors"
        >
          View on cugc.co.nz <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="flex items-center gap-1 border-b border-white/5 animate-fade-in-up" style={{ animationDelay: "90ms", opacity: 0 }}>
        <button className="px-4 py-2.5 text-sm font-medium text-white border-b-2 border-blue-500 -mb-px">
          Programs
        </button>
        <button
          onClick={() => navigate("/admin/terms")}
          className="px-4 py-2.5 text-sm font-medium text-white/50 hover:text-white/80 border-b-2 border-transparent -mb-px"
          data-testid="tab-cugc-term-dates"
        >
          Term Dates
        </button>
      </div>

      <div className="relative animate-fade-in-up" style={{ animationDelay: "100ms", opacity: 0 }}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search programs..." className="pl-10 premium-input text-white/80 rounded-xl h-10" data-testid="input-search-cugc-programs" />
      </div>

      <div className="space-y-6 animate-fade-in-up" style={{ animationDelay: "150ms", opacity: 0 }}>
        {isLoading || !cfg ? (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl bg-blue-500/[0.04]" />)}
            </div>
          </div>
        ) : (
          <>
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-blue-500/[0.08] flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-blue-400/40" />
                <h2 className="text-[13px] font-semibold text-white/60">Term Programs</h2>
                <Badge variant="outline" className="text-[9px] text-blue-400/50 border-blue-500/15 bg-blue-500/5 ml-auto no-default-hover-elevate no-default-active-elevate">
                  {termPrograms.length}
                </Badge>
              </div>
              <ProgramTable programs={termPrograms} period={period} countFor={countFor} onOpen={onOpen} emptyMessage="No term programs match." />
            </div>

            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-blue-500/[0.08] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400/40" />
                <h2 className="text-[13px] font-semibold text-white/60">Competitive Programs</h2>
                <Badge variant="outline" className="text-[9px] text-amber-400/50 border-amber-500/15 bg-amber-500/5 ml-auto no-default-hover-elevate no-default-active-elevate">
                  {competitivePrograms.length}
                </Badge>
              </div>
              <ProgramTable programs={competitivePrograms} period={period} countFor={countFor} onOpen={onOpen} emptyMessage="No competitive programs match." />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
