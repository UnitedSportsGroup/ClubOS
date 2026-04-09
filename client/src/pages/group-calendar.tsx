import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Calendar as CalIcon,
  Eye, EyeOff, Trash2, Edit
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CalendarEvent } from "@shared/schema";

const CALENDAR_TYPES = [
  { id: "general", label: "General", color: "#3b82f6" },
  { id: "united", label: "United Events", color: "#6366f1" },
  { id: "south-island", label: "South Island United", color: "#8b5cf6" },
  { id: "gymnastics", label: "United Gymnastics", color: "#ec4899" },
  { id: "payments", label: "Payments & Finance", color: "#f59e0b" },
  { id: "training", label: "Training", color: "#22c55e" },
  { id: "meetings", label: "Meetings", color: "#06b6d4" },
  { id: "personal", label: "Personal", color: "#ef4444" },
];

type ViewMode = "month" | "week" | "day";

function getWeekDays(date: Date): Date[] {
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

function getMonthDays(date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days: Date[] = [];
  for (let i = -startOffset; i <= lastDay.getDate() + (6 - ((lastDay.getDay() + 6) % 7)) - 1; i++) {
    days.push(new Date(year, month, i + 1));
  }
  return days;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toLocalISO(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function GroupCalendar() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [visibleCalendars, setVisibleCalendars] = useState<Set<string>>(new Set(CALENDAR_TYPES.map(c => c.id)));

  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formAllDay, setFormAllDay] = useState(false);
  const [formCalType, setFormCalType] = useState("general");
  const [formColor, setFormColor] = useState("#3b82f6");

  const rangeStart = useMemo(() => {
    if (viewMode === "month") return new Date(currentDate.getFullYear(), currentDate.getMonth(), -6);
    if (viewMode === "week") { const d = getWeekDays(currentDate); return d[0]; }
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  }, [currentDate, viewMode]);

  const rangeEnd = useMemo(() => {
    if (viewMode === "month") return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 7);
    if (viewMode === "week") { const d = getWeekDays(currentDate); return new Date(d[6].getTime() + 86400000); }
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
  }, [currentDate, viewMode]);

  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/admin/calendar-events", rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: async () => {
      const r = await fetch(`/api/admin/calendar-events?startDate=${rangeStart.toISOString()}&endDate=${rangeEnd.toISOString()}`);
      if (!r.ok) throw new Error("Failed to load events");
      return r.json();
    },
  });

  const filteredEvents = events.filter(e => visibleCalendars.has(e.calendarType));

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/admin/calendar-events", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/calendar-events"] });
      toast({ title: "Event created" });
      closeModal();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => apiRequest("PATCH", `/api/admin/calendar-events/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/calendar-events"] });
      toast({ title: "Event updated" });
      closeModal();
      setSelectedEvent(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/calendar-events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/calendar-events"] });
      toast({ title: "Event deleted" });
      setSelectedEvent(null);
    },
  });

  function openCreateModal(date?: Date) {
    setEditingEvent(null);
    const d = date || new Date();
    const start = new Date(d);
    start.setHours(9, 0, 0, 0);
    const end = new Date(d);
    end.setHours(10, 0, 0, 0);
    setFormTitle("");
    setFormDesc("");
    setFormLocation("");
    setFormStart(toLocalISO(start));
    setFormEnd(toLocalISO(end));
    setFormAllDay(false);
    setFormCalType("general");
    setFormColor("#3b82f6");
    setShowModal(true);
  }

  function openEditModal(event: CalendarEvent) {
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDesc(event.description || "");
    setFormLocation(event.location || "");
    setFormStart(toLocalISO(new Date(event.startTime)));
    setFormEnd(toLocalISO(new Date(event.endTime)));
    setFormAllDay(event.allDay);
    setFormCalType(event.calendarType);
    setFormColor(event.color);
    setShowModal(true);
    setSelectedEvent(null);
  }

  function closeModal() {
    setShowModal(false);
    setEditingEvent(null);
  }

  function handleSave() {
    const data = {
      title: formTitle,
      description: formDesc || null,
      location: formLocation || null,
      startTime: new Date(formStart).toISOString(),
      endTime: new Date(formEnd).toISOString(),
      allDay: formAllDay,
      calendarType: formCalType,
      color: formColor,
    };
    if (editingEvent) {
      updateMutation.mutate({ id: editingEvent.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  }

  function navigate(dir: number) {
    const d = new Date(currentDate);
    if (viewMode === "month") d.setMonth(d.getMonth() + dir);
    else if (viewMode === "week") d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  function toggleCalendar(id: string) {
    setVisibleCalendars(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const headerLabel = viewMode === "month"
    ? currentDate.toLocaleString("default", { month: "long", year: "numeric" })
    : viewMode === "week"
      ? (() => {
          const days = getWeekDays(currentDate);
          const s = days[0]; const e = days[6];
          if (s.getMonth() === e.getMonth()) return `${s.toLocaleString("default", { month: "long" })} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
          return `${s.toLocaleString("default", { month: "short" })} ${s.getDate()} – ${e.toLocaleString("default", { month: "short" })} ${e.getDate()}, ${s.getFullYear()}`;
        })()
      : currentDate.toLocaleDateString("en-NZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const hours = Array.from({ length: 24 }, (_, i) => i);

  function getEventsForDay(day: Date) {
    return filteredEvents.filter(e => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      return isSameDay(start, day) || isSameDay(end, day) || (start < day && end > day);
    });
  }

  function getEventStyle(event: CalendarEvent, dayStart: Date) {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const dayBegin = new Date(dayStart);
    dayBegin.setHours(0, 0, 0, 0);
    const effectiveStart = start < dayBegin ? dayBegin : start;
    const dayEnd = new Date(dayBegin);
    dayEnd.setHours(23, 59, 59, 999);
    const effectiveEnd = end > dayEnd ? dayEnd : end;
    const topMinutes = effectiveStart.getHours() * 60 + effectiveStart.getMinutes();
    const durationMinutes = Math.max((effectiveEnd.getTime() - effectiveStart.getTime()) / 60000, 15);
    return {
      top: `${(topMinutes / 1440) * 100}%`,
      height: `${(durationMinutes / 1440) * 100}%`,
      minHeight: "20px",
    };
  }

  const today = new Date();

  return (
    <div className="flex h-full">
      <div className="w-56 flex-shrink-0 border-r border-white/[0.06] p-4 space-y-5 overflow-y-auto" style={{ background: 'rgba(2,6,14,0.5)' }}>
        <Button
          onClick={() => openCreateModal()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
          data-testid="button-create-event"
        >
          <Plus className="w-4 h-4" /> Create
        </Button>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-2">Mini Calendar</div>
          <MiniCalendar date={currentDate} onSelect={(d) => { setCurrentDate(d); if (viewMode === "month") setViewMode("day"); }} />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-2">Calendars</div>
          <div className="space-y-1">
            {CALENDAR_TYPES.map(cal => (
              <button
                key={cal.id}
                onClick={() => toggleCalendar(cal.id)}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                data-testid={`toggle-calendar-${cal.id}`}
              >
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: visibleCalendars.has(cal.id) ? cal.color : "transparent", border: `2px solid ${cal.color}` }}
                >
                  {visibleCalendars.has(cal.id) && <span className="text-white text-[8px]">✓</span>}
                </div>
                <span className="text-xs text-white/60">{cal.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]" style={{ background: 'rgba(2,6,14,0.5)' }}>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={goToday} className="border-white/10 text-white/60 text-xs rounded-xl h-8" data-testid="button-today">
              Today
            </Button>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-7 w-7 text-white/40 hover:text-white/60" data-testid="button-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => navigate(1)} className="h-7 w-7 text-white/40 hover:text-white/60" data-testid="button-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <h2 className="text-base font-medium text-white/80" data-testid="text-date-range">{headerLabel}</h2>
          </div>
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-xl p-0.5">
            {(["day", "week", "month"] as ViewMode[]).map(v => (
              <Button
                key={v}
                variant="ghost"
                size="sm"
                onClick={() => setViewMode(v)}
                className={`text-xs h-7 rounded-lg capitalize ${viewMode === v ? "bg-blue-600 text-white hover:bg-blue-600" : "text-white/40 hover:text-white/60"}`}
                data-testid={`button-view-${v}`}
              >
                {v}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {viewMode === "month" && (
            <MonthView
              days={getMonthDays(currentDate)}
              events={filteredEvents}
              currentDate={currentDate}
              today={today}
              onDayClick={(d) => { setCurrentDate(d); setViewMode("day"); }}
              onEventClick={setSelectedEvent}
              onCreateClick={openCreateModal}
            />
          )}
          {viewMode === "week" && (
            <WeekView
              days={getWeekDays(currentDate)}
              events={filteredEvents}
              today={today}
              hours={hours}
              getEventStyle={getEventStyle}
              onEventClick={setSelectedEvent}
              onTimeClick={(d) => openCreateModal(d)}
            />
          )}
          {viewMode === "day" && (
            <DayView
              day={currentDate}
              events={getEventsForDay(currentDate)}
              hours={hours}
              getEventStyle={getEventStyle}
              onEventClick={setSelectedEvent}
              onTimeClick={(d) => openCreateModal(d)}
            />
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full max-w-md premium-card border border-white/[0.08] rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()} data-testid="modal-event">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{editingEvent ? "Edit Event" : "New Event"}</h3>
              <Button variant="ghost" size="icon" onClick={closeModal} className="text-white/30 h-8 w-8">
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div>
              <Input
                placeholder="Add title"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                className="premium-input text-white/90 text-lg border-0 border-b border-white/10 rounded-none px-0 focus-visible:ring-0"
                data-testid="input-event-title"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-white/30" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={formStart}
                    onChange={e => setFormStart(e.target.value)}
                    className="premium-input text-white/70 text-xs rounded-xl flex-1"
                    data-testid="input-event-start"
                  />
                  <span className="text-white/30 text-xs">to</span>
                  <Input
                    type="datetime-local"
                    value={formEnd}
                    onChange={e => setFormEnd(e.target.value)}
                    className="premium-input text-white/70 text-xs rounded-xl flex-1"
                    data-testid="input-event-end"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={formAllDay} onCheckedChange={setFormAllDay} data-testid="switch-all-day" />
                  <span className="text-xs text-white/40">All day</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-white/30" />
              <Input
                placeholder="Add location"
                value={formLocation}
                onChange={e => setFormLocation(e.target.value)}
                className="premium-input text-white/70 text-sm rounded-xl flex-1"
                data-testid="input-event-location"
              />
            </div>

            <div className="flex items-center gap-3">
              <CalIcon className="w-4 h-4 text-white/30" />
              <Select value={formCalType} onValueChange={(v) => { setFormCalType(v); const c = CALENDAR_TYPES.find(t => t.id === v); if (c) setFormColor(c.color); }}>
                <SelectTrigger className="premium-input text-white/70 text-sm rounded-xl flex-1" data-testid="select-calendar-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALENDAR_TYPES.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                        {c.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Textarea
              placeholder="Add description"
              value={formDesc}
              onChange={e => setFormDesc(e.target.value)}
              className="premium-input text-white/70 text-sm rounded-xl min-h-[60px]"
              data-testid="input-event-description"
            />

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={!formTitle.trim() || createMutation.isPending || updateMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex-1"
                data-testid="button-save-event"
              >
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={closeModal} className="border-white/10 text-white/60 rounded-xl" data-testid="button-cancel-event">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
          <div className="w-full max-w-sm premium-card border border-white/[0.08] rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()} data-testid="modal-event-detail">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: selectedEvent.color }} />
                <Badge className="text-[10px]" style={{ backgroundColor: `${selectedEvent.color}20`, color: selectedEvent.color, borderColor: `${selectedEvent.color}30` }}>
                  {CALENDAR_TYPES.find(c => c.id === selectedEvent.calendarType)?.label || selectedEvent.calendarType}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedEvent(null)} className="text-white/30 h-7 w-7">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <h3 className="text-lg font-semibold text-white" data-testid="text-event-title">{selectedEvent.title}</h3>
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {new Date(selectedEvent.startTime).toLocaleDateString("en-NZ", { weekday: "short", month: "short", day: "numeric" })}
                {" "}
                {formatTime(new Date(selectedEvent.startTime))} – {formatTime(new Date(selectedEvent.endTime))}
              </span>
            </div>
            {selectedEvent.location && (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <MapPin className="w-3.5 h-3.5" />
                <span>{selectedEvent.location}</span>
              </div>
            )}
            {selectedEvent.description && (
              <p className="text-sm text-white/40">{selectedEvent.description}</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => openEditModal(selectedEvent)} className="border-white/10 text-white/60 rounded-xl gap-1.5 flex-1" data-testid="button-edit-event">
                <Edit className="w-3.5 h-3.5" /> Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { if (confirm("Delete this event?")) deleteMutation.mutate(selectedEvent.id); }}
                className="border-red-500/20 text-red-400 hover:bg-red-500/10 rounded-xl gap-1.5"
                data-testid="button-delete-event"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniCalendar({ date, onSelect }: { date: Date; onSelect: (d: Date) => void }) {
  const [viewDate, setViewDate] = useState(new Date(date));
  const days = getMonthDays(viewDate);
  const today = new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-white/60 font-medium">{viewDate.toLocaleString("default", { month: "short", year: "numeric" })}</span>
        <div className="flex gap-0.5">
          <button onClick={() => { const d = new Date(viewDate); d.setMonth(d.getMonth() - 1); setViewDate(d); }} className="text-white/30 hover:text-white/50 p-0.5"><ChevronLeft className="w-3 h-3" /></button>
          <button onClick={() => { const d = new Date(viewDate); d.setMonth(d.getMonth() + 1); setViewDate(d); }} className="text-white/30 hover:text-white/50 p-0.5"><ChevronRight className="w-3 h-3" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0">
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <div key={i} className="text-center text-[9px] text-white/20 py-1">{d}</div>
        ))}
        {days.map((d, i) => {
          const isCurrentMonth = d.getMonth() === viewDate.getMonth();
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, date);
          return (
            <button
              key={i}
              onClick={() => onSelect(d)}
              className={`text-center text-[10px] py-1 rounded transition-colors
                ${isCurrentMonth ? "text-white/50 hover:bg-white/[0.06]" : "text-white/15"}
                ${isToday ? "bg-blue-600 text-white hover:bg-blue-600" : ""}
                ${isSelected && !isToday ? "bg-white/[0.08] text-white" : ""}
              `}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({ days, events, currentDate, today, onDayClick, onEventClick, onCreateClick }: {
  days: Date[]; events: CalendarEvent[]; currentDate: Date; today: Date;
  onDayClick: (d: Date) => void; onEventClick: (e: CalendarEvent) => void; onCreateClick: (d: Date) => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => (
          <div key={d} className="text-center text-[10px] text-white/30 font-medium py-2 uppercase tracking-wider">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {days.map((day, i) => {
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = isSameDay(day, today);
          const dayEvents = events.filter(e => {
            const s = new Date(e.startTime);
            return isSameDay(s, day);
          });
          return (
            <div
              key={i}
              className={`border-b border-r border-white/[0.04] p-1 min-h-[80px] cursor-pointer hover:bg-white/[0.02] transition-colors ${!isCurrentMonth ? "opacity-30" : ""}`}
              onClick={() => onDayClick(day)}
              onDoubleClick={(e) => { e.stopPropagation(); onCreateClick(day); }}
            >
              <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-blue-600 text-white" : "text-white/50"}`}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map(event => (
                  <div
                    key={event.id}
                    onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                    className="text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: `${event.color}25`, color: event.color, borderLeft: `2px solid ${event.color}` }}
                    data-testid={`event-${event.id}`}
                  >
                    {event.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[9px] text-white/30 px-1">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ days, events, today, hours, getEventStyle, onEventClick, onTimeClick }: {
  days: Date[]; events: CalendarEvent[]; today: Date; hours: number[];
  getEventStyle: (e: CalendarEvent, d: Date) => any;
  onEventClick: (e: CalendarEvent) => void; onTimeClick: (d: Date) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-white/[0.06] sticky top-0 z-10" style={{ background: 'rgba(2,6,14,0.95)' }}>
        <div />
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={i} className="text-center py-2 border-l border-white/[0.04]">
              <div className="text-[10px] text-white/30 uppercase">{d.toLocaleString("default", { weekday: "short" })}</div>
              <div className={`text-lg font-medium ${isToday ? "w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto" : "text-white/60"}`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative" style={{ height: `${hours.length * 60}px` }}>
          <div>
            {hours.map(h => (
              <div key={h} className="h-[60px] flex items-start justify-end pr-2 pt-0">
                <span className="text-[10px] text-white/20 -mt-1.5">{h === 0 ? "" : `${h % 12 || 12}${h < 12 ? "am" : "pm"}`}</span>
              </div>
            ))}
          </div>
          {days.map((day, di) => {
            const dayEvents = events.filter(e => {
              const s = new Date(e.startTime);
              const en = new Date(e.endTime);
              return isSameDay(s, day) || isSameDay(en, day) || (s < day && en > new Date(day.getTime() + 86400000));
            });
            return (
              <div key={di} className="border-l border-white/[0.04] relative">
                {hours.map(h => (
                  <div
                    key={h}
                    className="h-[60px] border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => { const d = new Date(day); d.setHours(h, 0, 0, 0); onTimeClick(d); }}
                  />
                ))}
                {dayEvents.map(event => {
                  const style = getEventStyle(event, day);
                  return (
                    <div
                      key={event.id}
                      className="absolute left-0.5 right-1 rounded-lg px-1.5 py-0.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
                      style={{ ...style, backgroundColor: `${event.color}30`, borderLeft: `3px solid ${event.color}` }}
                      onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                      data-testid={`event-${event.id}`}
                    >
                      <div className="text-[11px] font-medium truncate" style={{ color: event.color }}>{event.title}</div>
                      <div className="text-[9px] opacity-70" style={{ color: event.color }}>
                        {formatTime(new Date(event.startTime))} – {formatTime(new Date(event.endTime))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayView({ day, events, hours, getEventStyle, onEventClick, onTimeClick }: {
  day: Date; events: CalendarEvent[]; hours: number[];
  getEventStyle: (e: CalendarEvent, d: Date) => any;
  onEventClick: (e: CalendarEvent) => void; onTimeClick: (d: Date) => void;
}) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-[60px_1fr] relative" style={{ height: `${hours.length * 60}px` }}>
        <div>
          {hours.map(h => (
            <div key={h} className="h-[60px] flex items-start justify-end pr-2">
              <span className="text-[10px] text-white/20 -mt-1.5">{h === 0 ? "" : `${h % 12 || 12}${h < 12 ? "am" : "pm"}`}</span>
            </div>
          ))}
        </div>
        <div className="relative border-l border-white/[0.04]">
          {hours.map(h => (
            <div
              key={h}
              className="h-[60px] border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer"
              onClick={() => { const d = new Date(day); d.setHours(h, 0, 0, 0); onTimeClick(d); }}
            />
          ))}
          {events.map(event => {
            const style = getEventStyle(event, day);
            return (
              <div
                key={event.id}
                className="absolute left-1 right-4 rounded-lg px-2 py-1 cursor-pointer hover:opacity-90 transition-opacity"
                style={{ ...style, backgroundColor: `${event.color}30`, borderLeft: `3px solid ${event.color}` }}
                onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                data-testid={`event-${event.id}`}
              >
                <div className="text-xs font-medium" style={{ color: event.color }}>{event.title}</div>
                <div className="text-[10px] opacity-70" style={{ color: event.color }}>
                  {formatTime(new Date(event.startTime))} – {formatTime(new Date(event.endTime))}
                </div>
                {event.location && <div className="text-[10px] opacity-50 mt-0.5" style={{ color: event.color }}>{event.location}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
