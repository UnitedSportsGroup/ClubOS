import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Search, LogIn, LogOut, Phone, MessageSquare } from "lucide-react";

export default function AdminAttendance() {
  const { data: camps } = useQuery<any[]>({ queryKey: ["/api/admin/camps"] });
  const [selectedCamp, setSelectedCamp] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const campId = selectedCamp ? parseInt(selectedCamp) : null;
  const { data: dates } = useQuery<any[]>({
    queryKey: ["/api/admin/camps", campId, "dates"],
    queryFn: async () => {
      if (!campId) return [];
      const res = await fetch(`/api/admin/camps/${campId}/dates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dates");
      return res.json();
    },
    enabled: !!campId,
  });

  const campDateId = selectedDate ? parseInt(selectedDate) : null;
  const { data: attendance, isLoading: loadingAttendance } = useQuery<any[]>({
    queryKey: ["/api/admin/attendance", { campId, campDateId }],
    queryFn: async () => {
      if (!campId || !campDateId) return [];
      const res = await fetch(`/api/admin/attendance?campId=${campId}&campDateId=${campDateId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!campId && !!campDateId,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: string | null }) => {
      const res = await apiRequest("PATCH", `/api/admin/attendance/${id}`, { [field]: value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = attendance?.filter(r => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (r.child?.firstName?.toLowerCase().includes(s) ||
      r.child?.lastName?.toLowerCase().includes(s) ||
      r.parent?.firstName?.toLowerCase().includes(s) ||
      r.parent?.lastName?.toLowerCase().includes(s));
  });

  const handleCheckIn = (record: any) => {
    if (record.checkedInAt) {
      toggleMutation.mutate({ id: record.id, field: "checkedInAt", value: null });
    } else {
      toggleMutation.mutate({ id: record.id, field: "checkedInAt", value: new Date().toISOString() });
    }
  };

  const handleCheckOut = (record: any) => {
    if (record.checkedOutAt) {
      toggleMutation.mutate({ id: record.id, field: "checkedOutAt", value: null });
    } else {
      toggleMutation.mutate({ id: record.id, field: "checkedOutAt", value: new Date().toISOString() });
    }
  };

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Attendance</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">Check in and out for camp sessions</p>
      </div>

      <div className="flex gap-3 flex-wrap animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
        <select
          value={selectedCamp}
          onChange={e => { setSelectedCamp(e.target.value); setSelectedDate(""); }}
          className="h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
          data-testid="select-camp"
        >
          <option value="">Select Camp</option>
          {camps?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30 cursor-pointer"
          disabled={!dates}
          data-testid="select-date"
        >
          <option value="">Select Date</option>
          {dates?.map(d => <option key={d.id} value={d.id}>{d.date}</option>)}
        </select>
        {campId && campDateId && (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search child or parent..." className="pl-10 premium-input text-white/80 rounded-xl h-9" data-testid="input-search-attendance" />
          </div>
        )}
      </div>

      {!campId || !campDateId ? (
        <div className="flex flex-col items-center justify-center py-16 text-center glass-card rounded-2xl animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
          <ClipboardList className="w-12 h-12 text-blue-400/10 mb-4" />
          <h3 className="text-[15px] font-medium text-white/40 mb-1">Select a camp and date</h3>
          <p className="text-[12px] text-white/20">Choose a camp and session date to manage attendance</p>
        </div>
      ) : loadingAttendance ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl bg-blue-500/[0.04]" />)}
        </div>
      ) : filtered && filtered.length > 0 ? (
        <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
          <div className="divide-y divide-blue-500/[0.04]">
            {filtered.map((record: any) => (
              <div key={record.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 sm:px-5 py-3 row-hover" data-testid={`row-attendance-${record.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white/75">
                    {record.child?.firstName} {record.child?.lastName}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-white/30">
                      Parent: {record.parent?.firstName} {record.parent?.lastName}
                    </span>
                    {record.parent?.phone && (
                      <a href={`tel:${record.parent.phone}`} className="flex items-center gap-1 text-[11px] text-blue-400/50 hover:text-blue-400" data-testid={`link-call-${record.id}`}>
                        <Phone className="w-3 h-3" /> {record.parent.phone}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCheckIn(record)}
                    className={`rounded-xl h-8 text-[11px] transition-all ${
                      record.checkedInAt
                        ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20"
                        : "border-white/[0.08] text-white/40 hover:bg-emerald-500/10 hover:border-emerald-500/20 hover:text-emerald-400"
                    }`}
                    data-testid={`button-checkin-${record.id}`}
                  >
                    <LogIn className="w-3.5 h-3.5 mr-1" />
                    {record.checkedInAt ? "In ✓" : "Check In"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCheckOut(record)}
                    disabled={!record.checkedInAt}
                    className={`rounded-xl h-8 text-[11px] transition-all ${
                      record.checkedOutAt
                        ? "bg-blue-500/15 border-blue-500/25 text-blue-400 hover:bg-blue-500/20"
                        : "border-white/[0.08] text-white/40 hover:bg-blue-500/10 hover:border-blue-500/20 hover:text-blue-400"
                    }`}
                    data-testid={`button-checkout-${record.id}`}
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1" />
                    {record.checkedOutAt ? "Out ✓" : "Check Out"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-blue-500/[0.06] flex items-center justify-between">
            <span className="text-[12px] text-white/30">
              {filtered.filter((r: any) => r.checkedInAt).length} / {filtered.length} checked in
            </span>
            <span className="text-[12px] text-white/30">
              {filtered.filter((r: any) => r.checkedOutAt).length} / {filtered.length} checked out
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center glass-card rounded-2xl animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
          <ClipboardList className="w-12 h-12 text-blue-400/10 mb-4" />
          <h3 className="text-[15px] font-medium text-white/40 mb-1">No attendance records</h3>
          <p className="text-[12px] text-white/20">No children are registered for this date</p>
        </div>
      )}
    </div>
  );
}
