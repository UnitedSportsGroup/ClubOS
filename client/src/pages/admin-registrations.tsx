import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardCheck, Search, ChevronDown, ChevronUp, User, Phone, Mail } from "lucide-react";

export default function AdminRegistrations() {
  const { data: camps } = useQuery<any[]>({ queryKey: ["/api/admin/camps"] });
  const [selectedCamp, setSelectedCamp] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: registrations, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/registrations", selectedCamp],
    queryFn: async () => {
      const url = selectedCamp ? `/api/admin/registrations?campId=${selectedCamp}` : "/api/admin/registrations";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const filtered = registrations?.filter(r => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (r.contact?.firstName?.toLowerCase().includes(s) ||
      r.contact?.lastName?.toLowerCase().includes(s) ||
      r.contact?.email?.toLowerCase().includes(s) ||
      String(r.id).includes(s));
  });

  const statusColors: Record<string, string> = {
    pending: "text-amber-400/70 bg-amber-500/10 border-amber-500/15",
    confirmed: "text-emerald-400/70 bg-emerald-500/10 border-emerald-500/15",
    paid: "text-emerald-400/70 bg-emerald-500/10 border-emerald-500/15",
    cancelled: "text-red-400/70 bg-red-500/10 border-red-500/15",
  };

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Registrations</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">View and manage bookings</p>
      </div>

      <div className="flex gap-3 flex-wrap animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
        <select
          value={selectedCamp}
          onChange={e => setSelectedCamp(e.target.value)}
          className="h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
          data-testid="select-camp-filter"
        >
          <option value="">All Camps</option>
          {camps?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
          <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search by name or email..." className="pl-10 premium-input text-white/80 rounded-xl h-9" data-testid="input-search-registrations" />
        </div>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl bg-blue-500/[0.04]" />)}
          </div>
        ) : filtered && filtered.length > 0 ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {filtered.map((reg: any) => (
              <div key={reg.id}>
                <div
                  className="flex items-center gap-4 px-5 py-3 row-hover cursor-pointer"
                  onClick={() => setExpandedId(expandedId === reg.id ? null : reg.id)}
                  data-testid={`row-registration-${reg.id}`}
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-500/8 border border-blue-500/15 flex items-center justify-center flex-shrink-0">
                    <ClipboardCheck className="w-4 h-4 text-blue-400/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/75">
                      #{reg.id} — {reg.contact?.firstName} {reg.contact?.lastName}
                    </p>
                    <p className="text-[11px] text-white/25">
                      {reg.program?.name || `Camp #${reg.programId}`}
                      {reg.items?.length ? ` · ${reg.items.length} sessions` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-medium text-white/60">
                      ${((reg.totalCents || 0) / 100).toFixed(2)}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md border uppercase tracking-wider ${statusColors[reg.status] || statusColors.pending}`}>
                      {reg.status}
                    </span>
                    {expandedId === reg.id ? <ChevronUp className="w-4 h-4 text-white/20" /> : <ChevronDown className="w-4 h-4 text-white/20" />}
                  </div>
                </div>
                {expandedId === reg.id && (
                  <div className="px-5 pb-4 space-y-3 animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <User className="w-4 h-4 text-white/20" />
                        <span className="text-[13px] text-white/60">{reg.contact?.firstName} {reg.contact?.lastName}</span>
                      </div>
                      {reg.contact?.email && (
                        <div className="flex items-center gap-3">
                          <Mail className="w-4 h-4 text-white/20" />
                          <a href={`mailto:${reg.contact.email}`} className="text-[13px] text-blue-400/60 hover:text-blue-400">{reg.contact.email}</a>
                        </div>
                      )}
                      {reg.contact?.phone && (
                        <div className="flex items-center gap-3">
                          <Phone className="w-4 h-4 text-white/20" />
                          <a href={`tel:${reg.contact.phone}`} className="text-[13px] text-blue-400/60 hover:text-blue-400">{reg.contact.phone}</a>
                        </div>
                      )}
                      <div className="pt-2 border-t border-white/[0.04] space-y-1">
                        <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Pricing</p>
                        <p className="text-[12px] text-white/40">Subtotal: ${((reg.subtotalCents || 0) / 100).toFixed(2)}</p>
                        {reg.discountCents > 0 && <p className="text-[12px] text-emerald-400/60">Discount: -${((reg.discountCents) / 100).toFixed(2)}</p>}
                        <p className="text-[13px] text-white/70 font-medium">Total: ${((reg.totalCents || 0) / 100).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardCheck className="w-12 h-12 text-blue-400/10 mb-4" />
            <h3 className="text-[15px] font-medium text-white/40 mb-1">No registrations</h3>
            <p className="text-[12px] text-white/20">Bookings will appear here once parents register</p>
          </div>
        )}
      </div>
    </div>
  );
}
