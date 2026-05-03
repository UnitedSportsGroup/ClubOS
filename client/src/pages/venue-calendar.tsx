import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Plus, X, Trash2 } from "lucide-react";
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

// Color swatches for booking color tagging — picked to be visually distinct against dark UI.
const COLOR_SWATCHES = [
  { label: "Blue",   hex: "#3b82f6" },
  { label: "Green",  hex: "#10b981" },
  { label: "Amber",  hex: "#f59e0b" },
  { label: "Red",    hex: "#ef4444" },
  { label: "Purple", hex: "#8b5cf6" },
  { label: "Pink",   hex: "#ec4899" },
  { label: "Teal",   hex: "#14b8a6" },
  { label: "Slate",  hex: "#64748b" },
];

const WEEKDAY_BUTTONS = [
  { n: 1, label: "M" }, { n: 2, label: "T" }, { n: 3, label: "W" },
  { n: 4, label: "T" }, { n: 5, label: "F" }, { n: 6, label: "S" }, { n: 0, label: "S" },
];

type RepeatFreq = "none" | "daily" | "weekly" | "weekdays" | "custom";

const emptyForm = {
  customerName: "",
  customerEmail: "",
  facilityId: "",
  additionalFacilityIds: [] as string[],
  bookingDate: "",
  startTime: "",
  endTime: "",
  totalAmount: "0",
  color: "" as string,
  repeatFreq: "none" as RepeatFreq,
  repeatByDay: [] as number[],
  repeatUntil: "",
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

function ymd(d: Date): string {
  // Local-time YYYY-MM-DD (avoid UTC shift that toISOString causes around midnight).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthGrid(date: Date): Date[] {
  // 6×7 grid starting on the Monday of the week containing the 1st of the month.
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const day = first.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const start = new Date(first);
  start.setDate(first.getDate() + offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function getMonthDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export default function VenueCalendar() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"Day" | "Week" | "Month" | "Year" | "List" | "Planner">("Week");
  // Facility filter — "all" shows everything, otherwise the string is a
  // facility id. Applies across every view (Day, Week, Month, Year, List,
  // Planner) by narrowing `activeBookings` below before any other slicing.
  const [facilityFilter, setFacilityFilter] = useState<string>("all");
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [newBooking, setNewBooking] = useState({ ...emptyForm });

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
    mutationFn: async (data: any) => {
      const r = await apiRequest("POST", "/api/admin/venue/bookings", data);
      return await r.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/venue/bookings"] });
      setShowNewBooking(false);
      setNewBooking({ ...emptyForm });
      const count = result?.count;
      toast({
        title: count && count > 1 ? `${count} bookings created` : "Booking created",
        description: count && count > 1 ? "All occurrences are linked and can be cancelled together." : undefined,
      });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't create booking", description: e?.message || String(e), variant: "destructive" });
    },
  });

  const weekDateStrs = weekDates.map(d => ymd(d));
  const facilityFilterId = facilityFilter === "all" ? null : Number(facilityFilter);
  const activeBookings = bookings.filter(b =>
    b.status !== "cancelled" &&
    (facilityFilterId === null || b.facilityId === facilityFilterId)
  );
  const weekBookings = activeBookings.filter(b => weekDateStrs.includes(b.bookingDate));

  const getBookingsForSlot = (dayIdx: number, hour: number) => {
    const dateStr = weekDateStrs[dayIdx];
    return weekBookings.filter(b => {
      if (b.bookingDate !== dateStr) return false;
      const startH = parseInt(b.startTime.split(":")[0]);
      return startH === hour;
    });
  };

  // Navigation step depends on the active view so that prev/next "feels right".
  // For Month/Year, build the target date from year+month explicitly (with day=1) to
  // avoid JS Date.setMonth overflow when the current day-of-month doesn't exist in
  // the target month (e.g. Jan 31 + 1 month would otherwise jump to Mar 3).
  const stepDate = (delta: number): Date => {
    const d = new Date(currentDate);
    if (view === "Day" || view === "Planner") {
      d.setDate(d.getDate() + delta);
      return d;
    }
    if (view === "Month") return new Date(d.getFullYear(), d.getMonth() + delta, 1);
    if (view === "Year") return new Date(d.getFullYear() + delta, 0, 1);
    d.setDate(d.getDate() + delta * 7); // Week, List
    return d;
  };

  const prev = () => setCurrentDate(stepDate(-1));
  const next = () => setCurrentDate(stepDate(1));

  const today = new Date();
  const todayStr = ymd(today);
  const todayIdx = weekDates.findIndex(d => ymd(d) === todayStr);

  // Title shown above the grid — adapts per view.
  const headerTitle = (() => {
    if (view === "Day" || view === "Planner") {
      return currentDate.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }
    if (view === "Month") {
      return currentDate.toLocaleDateString("en-NZ", { month: "long", year: "numeric" });
    }
    if (view === "Year") return String(currentDate.getFullYear());
    if (view === "List") return "Upcoming bookings";
    return formatDateRange(weekDates);
  })();

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

      <div className="flex items-center justify-between flex-wrap gap-3">
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
          {facs.length > 0 && (
            <Select value={facilityFilter} onValueChange={setFacilityFilter}>
              <SelectTrigger className="h-8 w-[180px] bg-white/5 border-white/10 text-white/70 text-xs" data-testid="select-facility-filter">
                <SelectValue placeholder="All facilities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All facilities</SelectItem>
                {facs
                  .slice()
                  .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name))
                  .map(f => (
                    <SelectItem key={f.id} value={String(f.id)} data-testid={`select-facility-${f.id}`}>
                      {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <h2 className="text-lg font-semibold text-white" data-testid="text-date-range">{headerTitle}</h2>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Confirmed</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Paid</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Pending</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Cancelled</span>
        </div>
      </div>

      {view === "Week" && (
        <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden" data-testid="calendar-week">
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
                      {slotBookings.map(b => {
                        // If the booking has a custom color, render with that; otherwise fall
                        // back to the status-based color scheme for backwards compatibility.
                        const inline = b.color
                          ? { backgroundColor: `${b.color}33`, borderColor: `${b.color}55`, color: b.color }
                          : undefined;
                        return (
                          <div
                            key={b.id}
                            style={inline}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium border truncate ${b.color ? "" : statusColors[b.status]}`}
                            data-testid={`calendar-booking-${b.id}`}
                          >
                            {b.facility?.name || "Booking"}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "Day" && (() => {
        const dayStr = ymd(currentDate);
        const isToday = dayStr === todayStr;
        const dayBookings = activeBookings
          .filter(b => b.bookingDate === dayStr)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden" data-testid="calendar-day">
            <div className="grid grid-cols-[60px_1fr]">
              <div className="border-b border-r border-white/5 h-10" />
              <div className={`border-b border-r border-white/5 h-10 flex items-center justify-center ${isToday ? "bg-blue-500/10" : ""}`}>
                <span className="text-xs font-medium text-white/50">{currentDate.toLocaleDateString("en-NZ", { weekday: "long" })}</span>
                <span className={`text-xs font-semibold ml-2 ${isToday ? "text-blue-400" : "text-white/30"}`}>{currentDate.getDate()}</span>
              </div>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {HOURS.map(hour => {
                const hourBookings = dayBookings.filter(b => parseInt(b.startTime.split(":")[0]) === hour);
                return (
                  <div key={hour} className="grid grid-cols-[60px_1fr] min-h-[50px]">
                    <div className="border-r border-b border-white/5 flex items-start justify-end pr-2 pt-1">
                      <span className="text-[10px] text-white/20">{String(hour).padStart(2, "0")}:00</span>
                    </div>
                    <div className={`border-r border-b border-white/5 p-1 ${isToday ? "bg-blue-500/[0.03]" : ""}`}>
                      {hourBookings.map(b => {
                        const inline = b.color
                          ? { backgroundColor: `${b.color}33`, borderColor: `${b.color}55`, color: b.color }
                          : undefined;
                        return (
                          <div
                            key={b.id}
                            style={inline}
                            className={`rounded px-2 py-1 text-xs font-medium border mb-0.5 ${b.color ? "" : statusColors[b.status]}`}
                            data-testid={`calendar-booking-${b.id}`}
                          >
                            <span className="opacity-70 mr-2">{b.startTime}–{b.endTime}</span>
                            {b.facility?.name || "Booking"}
                            {b.customerName && <span className="opacity-60 ml-2">· {b.customerName}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {view === "Month" && (() => {
        const cells = getMonthGrid(currentDate);
        const monthIdx = currentDate.getMonth();
        const byDate = new Map<string, BookingWithFacility[]>();
        for (const b of activeBookings) {
          const arr = byDate.get(b.bookingDate) || [];
          arr.push(b);
          byDate.set(b.bookingDate, arr);
        }
        return (
          <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden" data-testid="calendar-month">
            <div className="grid grid-cols-7">
              {DAYS.map(d => (
                <div key={d} className="border-b border-r border-white/5 h-9 flex items-center justify-center text-xs font-medium text-white/50">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((d, i) => {
                const dStr = ymd(d);
                const inMonth = d.getMonth() === monthIdx;
                const isToday = dStr === todayStr;
                const dayB = (byDate.get(dStr) || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
                return (
                  <button
                    key={i}
                    onClick={() => { setCurrentDate(new Date(d)); setView("Day"); }}
                    className={`border-r border-b border-white/5 min-h-[90px] p-1.5 text-left transition-colors hover:bg-white/[0.04] ${isToday ? "bg-blue-500/[0.06]" : ""} ${inMonth ? "" : "opacity-40"}`}
                    data-testid={`day-cell-${dStr}`}
                  >
                    <div className={`text-xs font-semibold mb-1 ${isToday ? "text-blue-400" : "text-white/60"}`}>{d.getDate()}</div>
                    <div className="space-y-0.5">
                      {dayB.slice(0, 3).map(b => {
                        const inline = b.color ? { backgroundColor: `${b.color}33`, borderColor: `${b.color}55`, color: b.color } : undefined;
                        return (
                          <div
                            key={b.id}
                            style={inline}
                            className={`rounded px-1 py-0.5 text-[9px] font-medium border truncate ${b.color ? "" : statusColors[b.status]}`}
                            data-testid={`calendar-booking-${b.id}`}
                          >
                            {b.facility?.name || "Booking"}
                          </div>
                        );
                      })}
                      {dayB.length > 3 && (
                        <div className="text-[9px] text-white/40 px-1">+{dayB.length - 3} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {view === "Year" && (() => {
        const year = currentDate.getFullYear();
        const bookedDates = new Set(activeBookings.map(b => b.bookingDate));
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="calendar-year">
            {Array.from({ length: 12 }, (_, m) => {
              const monthDays = getMonthDays(year, m);
              // Pad the start so day 1 lines up with its weekday column (Mon-first).
              const firstDow = monthDays[0].getDay();
              const padStart = firstDow === 0 ? 6 : firstDow - 1;
              return (
                <div key={m} className="rounded-xl border border-blue-500/10 bg-white/[0.02] p-3" data-testid={`year-month-${m}`}>
                  <div className="text-xs font-semibold text-white/70 mb-2">
                    {new Date(year, m, 1).toLocaleDateString("en-NZ", { month: "long" })}
                  </div>
                  <div className="grid grid-cols-7 gap-y-0.5 text-center">
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                      <div key={i} className="text-[9px] text-white/30 mb-0.5">{d}</div>
                    ))}
                    {Array.from({ length: padStart }).map((_, i) => <div key={`p${i}`} />)}
                    {monthDays.map(d => {
                      const dStr = ymd(d);
                      const isToday = dStr === todayStr;
                      const hasBooking = bookedDates.has(dStr);
                      return (
                        <button
                          key={dStr}
                          onClick={() => { setCurrentDate(new Date(d)); setView("Day"); }}
                          className={`relative w-7 h-7 rounded-md text-[10px] font-medium transition-colors ${isToday ? "bg-blue-500/30 text-blue-100" : "text-white/50 hover:bg-white/10"}`}
                          data-testid={`year-day-${dStr}`}
                        >
                          {d.getDate()}
                          {hasBooking && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {view === "List" && (() => {
        const upcoming = activeBookings
          .filter(b => b.bookingDate >= todayStr)
          .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.startTime.localeCompare(b.startTime));
        const past = activeBookings
          .filter(b => b.bookingDate < todayStr)
          .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate) || b.startTime.localeCompare(a.startTime));
        const renderRow = (b: BookingWithFacility) => {
          const dot = b.color || "#3b82f6";
          return (
            <div key={b.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 hover:bg-white/[0.03]" data-testid={`list-booking-${b.id}`}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
              <div className="w-32 text-xs text-white/60 flex-shrink-0">
                {new Date(b.bookingDate + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" })}
              </div>
              <div className="w-24 text-xs text-white/40 flex-shrink-0">{b.startTime}–{b.endTime}</div>
              <div className="flex-1 text-xs text-white truncate">{b.facility?.name || "Booking"}</div>
              <div className="text-xs text-white/40 truncate">{b.customerName}</div>
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${statusColors[b.status]}`}>{b.status}</span>
            </div>
          );
        };
        return (
          <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden" data-testid="calendar-list">
            <div className="px-4 py-2 border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
              Upcoming ({upcoming.length})
            </div>
            {upcoming.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/30">No upcoming bookings.</div>
            ) : upcoming.map(renderRow)}
            {past.length > 0 && (
              <>
                <div className="px-4 py-2 border-b border-t border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                  Past ({past.length})
                </div>
                {past.slice(0, 50).map(renderRow)}
              </>
            )}
          </div>
        );
      })()}

      {view === "Planner" && (() => {
        // Facilities × hours grid for a single day.
        const dayStr = ymd(currentDate);
        const isToday = dayStr === todayStr;
        const dayBookings = activeBookings.filter(b => b.bookingDate === dayStr);
        return (
          <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] overflow-hidden" data-testid="calendar-planner">
            <div className="grid" style={{ gridTemplateColumns: `160px repeat(${HOURS.length}, minmax(48px, 1fr))` }}>
              <div className={`border-b border-r border-white/5 h-10 flex items-center px-3 ${isToday ? "bg-blue-500/10" : ""}`}>
                <span className="text-xs font-medium text-white/60">Facility</span>
              </div>
              {HOURS.map(h => (
                <div key={h} className={`border-b border-r border-white/5 h-10 flex items-center justify-center ${isToday ? "bg-blue-500/10" : ""}`}>
                  <span className="text-[10px] text-white/40">{String(h).padStart(2, "0")}</span>
                </div>
              ))}
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {facs.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-white/30">No facilities yet.</div>
              ) : facs.map(f => {
                const fb = dayBookings.filter(b => b.facilityId === f.id);
                return (
                  <div key={f.id} className="grid relative" style={{ gridTemplateColumns: `160px repeat(${HOURS.length}, minmax(48px, 1fr))` }}>
                    <div className="border-r border-b border-white/5 px-3 py-2 text-xs text-white/70 truncate">{f.name}</div>
                    {HOURS.map(h => (
                      <div key={h} className="border-r border-b border-white/5 min-h-[44px]" />
                    ))}
                    {fb.map(b => {
                      const startH = parseInt(b.startTime.split(":")[0]) + parseInt(b.startTime.split(":")[1]) / 60;
                      const endH = parseInt(b.endTime.split(":")[0]) + parseInt(b.endTime.split(":")[1]) / 60;
                      // Clip the booking to the visible HOURS window so a booking that
                      // starts at 05:30 (before the window) or ends at 23:30 (after) is
                      // still rendered, just clipped — instead of being silently hidden.
                      const windowStart = HOURS[0];
                      const windowEnd = HOURS[HOURS.length - 1] + 1;
                      const visStart = Math.max(startH, windowStart);
                      const visEnd = Math.min(endH, windowEnd);
                      if (visEnd <= visStart) return null;
                      const startCol = visStart - windowStart;
                      const span = Math.max(0.25, visEnd - visStart);
                      const inline = b.color
                        ? { backgroundColor: `${b.color}33`, borderColor: `${b.color}55`, color: b.color }
                        : undefined;
                      return (
                        <div
                          key={b.id}
                          style={{
                            position: "absolute",
                            left: `calc(160px + ${startCol} * ((100% - 160px) / ${HOURS.length}))`,
                            width: `calc(${span} * ((100% - 160px) / ${HOURS.length}))`,
                            top: 4,
                            bottom: 4,
                            ...inline,
                          }}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium border truncate flex items-center ${b.color ? "" : statusColors[b.status]}`}
                          data-testid={`planner-booking-${b.id}`}
                        >
                          <span className="opacity-70 mr-1.5">{b.startTime}</span>
                          {b.customerName || b.facility?.name || "Booking"}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {showNewBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowNewBooking(false)}>
          <div className="bg-[#0f1423] border border-white/10 rounded-2xl p-6 w-[520px] max-w-[95vw] max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">New Booking</h3>
              <button onClick={() => setShowNewBooking(false)} className="text-white/30 hover:text-white/60" data-testid="button-close-modal"><X className="w-5 h-5" /></button>
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

              {/* Facility (primary + optional additional) */}
              <div>
                <label className="text-xs text-white/40 mb-1 block">Facility</label>
                <Select value={newBooking.facilityId} onValueChange={v => setNewBooking({ ...newBooking, facilityId: v })}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-booking-facility"><SelectValue placeholder="Select facility" /></SelectTrigger>
                  <SelectContent>
                    {facs
                      .filter(f => !newBooking.additionalFacilityIds.includes(String(f.id)))
                      .map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>

                {newBooking.additionalFacilityIds.map((extraId, idx) => (
                  <div key={idx} className="flex items-center gap-2 mt-2">
                    <Select
                      value={extraId}
                      onValueChange={v => {
                        const next = [...newBooking.additionalFacilityIds];
                        next[idx] = v;
                        setNewBooking({ ...newBooking, additionalFacilityIds: next });
                      }}
                    >
                      <SelectTrigger className="bg-white/5 border-white/10 text-white flex-1" data-testid={`select-additional-facility-${idx}`}>
                        <SelectValue placeholder="Select facility" />
                      </SelectTrigger>
                      <SelectContent>
                        {facs
                          .filter(f => String(f.id) !== newBooking.facilityId && (String(f.id) === extraId || !newBooking.additionalFacilityIds.includes(String(f.id))))
                          .map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => setNewBooking({
                        ...newBooking,
                        additionalFacilityIds: newBooking.additionalFacilityIds.filter((_, i) => i !== idx),
                      })}
                      className="text-white/30 hover:text-red-400 p-2"
                      data-testid={`button-remove-additional-facility-${idx}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setNewBooking({ ...newBooking, additionalFacilityIds: [...newBooking.additionalFacilityIds, ""] })}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  data-testid="button-add-additional-facility"
                >
                  <Plus className="w-3 h-3" /> Add another facility
                </button>
              </div>

              {/* Date / Start / End */}
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

              {/* Repeat */}
              <div>
                <label className="text-xs text-white/40 mb-1 block">Repeat</label>
                <Select
                  value={newBooking.repeatFreq}
                  onValueChange={(v: RepeatFreq) => setNewBooking({ ...newBooking, repeatFreq: v, repeatByDay: [] })}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-repeat-freq">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Does not repeat</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly (same day each week)</SelectItem>
                    <SelectItem value="weekdays">Every weekday (Mon–Fri)</SelectItem>
                    <SelectItem value="custom">Custom — pick days</SelectItem>
                  </SelectContent>
                </Select>

                {newBooking.repeatFreq === "custom" && (
                  <div className="mt-2 flex items-center gap-1.5" data-testid="weekday-picker">
                    {WEEKDAY_BUTTONS.map(d => {
                      const active = newBooking.repeatByDay.includes(d.n);
                      return (
                        <button
                          key={d.n}
                          type="button"
                          onClick={() => setNewBooking({
                            ...newBooking,
                            repeatByDay: active
                              ? newBooking.repeatByDay.filter(x => x !== d.n)
                              : [...newBooking.repeatByDay, d.n],
                          })}
                          className={`w-8 h-8 rounded-full text-xs font-medium border transition-colors ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"}`}
                          data-testid={`button-weekday-${d.n}`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {newBooking.repeatFreq !== "none" && (
                  <div className="mt-2">
                    <label className="text-xs text-white/40 mb-1 block">Repeat until</label>
                    <Input
                      type="date"
                      value={newBooking.repeatUntil}
                      onChange={e => setNewBooking({ ...newBooking, repeatUntil: e.target.value })}
                      className="bg-white/5 border-white/10 text-white"
                      data-testid="input-repeat-until"
                    />
                  </div>
                )}
              </div>

              {/* Color */}
              <div>
                <label className="text-xs text-white/40 mb-1 block">Color</label>
                <div className="flex items-center gap-2 flex-wrap" data-testid="color-picker">
                  <button
                    type="button"
                    onClick={() => setNewBooking({ ...newBooking, color: "" })}
                    className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] text-white/50 ${newBooking.color === "" ? "border-white" : "border-white/20"}`}
                    title="No color (use status color)"
                    data-testid="button-color-none"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {COLOR_SWATCHES.map(s => (
                    <button
                      key={s.hex}
                      type="button"
                      onClick={() => setNewBooking({ ...newBooking, color: s.hex })}
                      style={{ backgroundColor: s.hex }}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${newBooking.color === s.hex ? "border-white scale-110" : "border-transparent hover:scale-105"}`}
                      title={s.label}
                      data-testid={`button-color-${s.label.toLowerCase()}`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-white/40 mb-1 block">Amount (inc GST)</label>
                <Input type="number" step="0.01" value={newBooking.totalAmount} onChange={e => setNewBooking({ ...newBooking, totalAmount: e.target.value })} className="bg-white/5 border-white/10 text-white" data-testid="input-booking-amount" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowNewBooking(false)} className="text-white/50">Cancel</Button>
              <Button
                onClick={() => {
                  // Filter out any blank "Add another facility" rows the user didn't fill in
                  const cleanedAdditional = newBooking.additionalFacilityIds
                    .filter(s => s && s !== newBooking.facilityId)
                    .map(s => parseInt(s));
                  const repeatPayload = newBooking.repeatFreq === "none"
                    ? undefined
                    : {
                        freq: newBooking.repeatFreq,
                        byDay: newBooking.repeatFreq === "custom" ? newBooking.repeatByDay : undefined,
                        until: newBooking.repeatUntil,
                      };
                  createMutation.mutate({
                    customerName: newBooking.customerName,
                    customerEmail: newBooking.customerEmail,
                    bookingDate: newBooking.bookingDate,
                    startTime: newBooking.startTime,
                    endTime: newBooking.endTime,
                    totalAmount: newBooking.totalAmount,
                    organizationId: orgId,
                    facilityId: parseInt(newBooking.facilityId),
                    additionalFacilityIds: cleanedAdditional,
                    color: newBooking.color || undefined,
                    repeat: repeatPayload,
                    gstAmount: String(Number(newBooking.totalAmount) * 3 / 23),
                  });
                }}
                disabled={
                  !newBooking.customerName ||
                  !newBooking.facilityId ||
                  !newBooking.bookingDate ||
                  !newBooking.startTime ||
                  !newBooking.endTime ||
                  (newBooking.repeatFreq !== "none" && !newBooking.repeatUntil) ||
                  (newBooking.repeatFreq === "custom" && newBooking.repeatByDay.length === 0) ||
                  createMutation.isPending
                }
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
