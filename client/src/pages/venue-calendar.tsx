import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FacilityBooking, Facility } from "@shared/schema";

type BookingWithFacility = FacilityBooking & { facility?: Facility };

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const statusColors: Record<string, string> = {
  confirmed: "bg-green-500/20 border-green-500/30 text-green-400",
  paid: "bg-blue-500/20 border-blue-500/30 text-blue-400",
  pending: "bg-yellow-500/20 border-yellow-500/30 text-yellow-400",
  cancelled: "bg-red-500/20 border-red-500/30 text-red-400",
};

function getWeekDates(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd;
  });
}

function formatDateRange(dates: Date[]) {
  const start = dates[0];
  const end = dates[6];
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${start.toLocaleDateString("en-NZ", opts)} - ${end.toLocaleDateString("en-NZ", opts)} ${end.getFullYear()}`;
}

export default function VenueCalendar() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"Day" | "Week" | "Month" | "Year" | "List" | "Planner">("Week");
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [newBooking, setNewBooking] = useState({ customerName: "", customerEmail: "", facilityId: "", bookingDate: "", startTime: "", endTime: "", totalAmount: "0" });

  const weekDates = getWeekDates(currentDate);

  const { data: bookings = [] } = useQuery<BookingWithFacility[]>({
    queryKey: ["/api/admin/venue/bookings", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/bookings?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const { data: facs = [] } = useQuery<Facility[]>({
    queryKey: ["/api/admin/venue/facilities", { orgId }],
    queryFn: () => fetch(`/api/admin/venue/facilities?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/venue/bookings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/bookings"] });
      setShowNewBooking(false);
      setNewBooking({ customerName: "", customerEmail: "", facilityId: "", bookingDate: "", startTime: "", endTime: "", totalAmount: "0" });
      toast({ title: "Booking created" });
    },
  });

  const weekDateStrs = weekDates.map(d => d.toISOString().split("T")[0]);
  const weekBookings = bookings.filter(b => weekDateStrs.includes(b.bookingDate) && b.status !== "cancelled");

  const getBookingsForSlot = (dayIdx: number, hour: number) => {
    const dateStr = weekDateStrs[dayIdx];
    return weekBookings.filter(b => {
      if (b.bookingDate !== dateStr) return false;
      const startH = parseInt(b.startTime.split(":")[0]);
      return startH === hour;
    });
  };

  const prev = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(d);
  };

  const next = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(d);
  };

  const today = new Date();
  const todayIdx = weekDates.findIndex(d => d.toISOString().split("T")[0] === today.toISOString().split("T")[0]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <CalIcon className="w-6 h-6 text-white/40" />
            <h1 className="text-2xl font-bold text-white" data-testid="text-venue-calendar-title">Bookings Calendar</h1>
          </div>
          <p className="text-sm text-white/40 mt-1">View and manage all bookings</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowNewBooking(true)} className="bg-white/10 hover:bg-white/15 text-white border border-white/10" data-testid="button-new-booking">
            <Plus className="w-4 h-4 mr-1" /> New Booking
          </Button>
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {(["Day", "Week", "Month", "Year", "List", "Planner"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === v ? "bg-white/15 text-white" : "text-white/30 hover:text-white/50"}`}
                data-testid={`button-view-${v.toLowerCase()}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center text-white/40 hover:text-white/60 hover:bg-white/5" data-testid="button-prev-week">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={next} className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center text-white/40 hover:text-white/60 hover:bg-white/5" data-testid="button-next-week">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white/70 hover:bg-white/5" data-testid="button-today">
            Today
          </button>
        </div>
        <h2 className="text-lg font-semibold text-white" data-testid="text-date-range">{formatDateRange(weekDates)}</h2>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Confirmed</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Paid</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Pending</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Cancelled</span>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden">
        <div className="grid grid-cols-[60px_repeat(7,1fr)]">
          <div className="border-b border-r border-white/5 h-10" />
          {DAYS.map((day, i) => (
            <div key={day} className={`border-b border-r border-white/5 h-10 flex items-center justify-center ${todayIdx === i ? "bg-blue-500/10" : ""}`}>
              <span className="text-xs font-medium text-white/50">{day}</span>
              <span className={`text-xs font-semibold ml-2 ${todayIdx === i ? "text-blue-400" : "text-white/30"}`}>{weekDates[i].getDate()}</span>
            </div>
          ))}
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {HOURS.map(hour => (
            <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] min-h-[50px]">
              <div className="border-r border-b border-white/5 flex items-start justify-end pr-2 pt-1">
                <span className="text-[10px] text-white/20">{String(hour).padStart(2, "0")}:00</span>
              </div>
              {Array.from({ length: 7 }, (_, dayIdx) => {
                const slotBookings = getBookingsForSlot(dayIdx, hour);
                return (
                  <div key={dayIdx} className={`border-r border-b border-white/5 p-0.5 ${todayIdx === dayIdx ? "bg-blue-500/[0.03]" : ""}`}>
                    {slotBookings.map(b => (
                      <div key={b.id} className={`rounded px-1.5 py-0.5 text-[10px] font-medium border truncate ${statusColors[b.status]}`} data-testid={`calendar-booking-${b.id}`}>
                        {b.facility?.name || "Booking"}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {showNewBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowNewBooking(false)}>
          <div className="bg-[#0f1423] border border-white/10 rounded-2xl p-6 w-[450px] max-w-[95vw] space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">New Booking</h3>
              <button onClick={() => setShowNewBooking(false)} className="text-white/30 hover:text-white/60"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/40 mb-1 block">Customer Name</label>
                <Input value={newBooking.customerName} onChange={e => setNewBooking({ ...newBooking, customerName: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-booking-name" />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Email</label>
                <Input value={newBooking.customerEmail} onChange={e => setNewBooking({ ...newBooking, customerEmail: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-booking-email" />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Facility</label>
                <Select value={newBooking.facilityId} onValueChange={v => setNewBooking({ ...newBooking, facilityId: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-booking-facility"><SelectValue placeholder="Select facility" /></SelectTrigger>
                  <SelectContent>{facs.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Date</label>
                  <Input type="date" value={newBooking.bookingDate} onChange={e => setNewBooking({ ...newBooking, bookingDate: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-booking-date" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Start</label>
                  <Input type="time" value={newBooking.startTime} onChange={e => setNewBooking({ ...newBooking, startTime: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-booking-start" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">End</label>
                  <Input type="time" value={newBooking.endTime} onChange={e => setNewBooking({ ...newBooking, endTime: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-booking-end" />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1 block">Amount (inc GST)</label>
                <Input type="number" step="0.01" value={newBooking.totalAmount} onChange={e => setNewBooking({ ...newBooking, totalAmount: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-booking-amount" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowNewBooking(false)} className="text-white/50">Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({
                  ...newBooking,
                  organizationId: orgId,
                  facilityId: parseInt(newBooking.facilityId),
                  gstAmount: String(Number(newBooking.totalAmount) * 3 / 23),
                })}
                disabled={!newBooking.customerName || !newBooking.facilityId || !newBooking.bookingDate || createMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="button-create-booking"
              >
                {createMutation.isPending ? "Creating..." : "Create Booking"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
