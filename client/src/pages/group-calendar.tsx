import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Calendar as CalIcon,
  Trash2, Edit, Repeat, DollarSign
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

type ViewMode = "month" | "week" | "day" | "year";

interface DraftEvent {
  day: Date;
  startMinutes: number;
  endMinutes: number;
  columnIndex: number;
}

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

function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h < 12 ? "am" : "pm";
  const hh = h % 12 || 12;
  return mm === 0 ? `${hh}${ampm}` : `${hh}:${String(mm).padStart(2, "0")}${ampm}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toLocalDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function toLocalTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minutesToTime(minutes: number): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function buildDate(dateStr: string, timeStr: string): Date {
  if (!dateStr) return new Date(NaN);
  if (!timeStr) return new Date(dateStr + "T00:00:00");
  return new Date(`${dateStr}T${timeStr}:00`);
}

function snapToGrid(minutes: number, gridSize: number = 15): number {
  return Math.round(minutes / gridSize) * gridSize;
}

const HOUR_HEIGHT = 60;

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
  const [formStartDate, setFormStartDate] = useState("");
  const [formStartTime, setFormStartTime] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formEndTime, setFormEndTime] = useState("");
  const [formAllDay, setFormAllDay] = useState(false);
  const [formCalType, setFormCalType] = useState("general");
  const [formColor, setFormColor] = useState("#3b82f6");
  const [formRepeatType, setFormRepeatType] = useState<"none"|"daily"|"weekly"|"monthly"|"yearly"|"custom">("none");
  const [formRepeatInterval, setFormRepeatInterval] = useState(1);
  const [formRepeatFreq, setFormRepeatFreq] = useState<"daily"|"weekly"|"monthly"|"yearly">("weekly");
  const [formRepeatUntil, setFormRepeatUntil] = useState("");
  const [showCustomRepeat, setShowCustomRepeat] = useState(false);
  const [formAmount, setFormAmount] = useState("");

  const [draftEvent, setDraftEvent] = useState<DraftEvent | null>(null);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const quickTitleRef = useRef<HTMLInputElement>(null);

  const rangeStart = useMemo(() => {
    if (viewMode === "year") return new Date(currentDate.getFullYear(), 0, 1);
    if (viewMode === "month") return new Date(currentDate.getFullYear(), currentDate.getMonth(), -6);
    if (viewMode === "week") { const d = getWeekDays(currentDate); return d[0]; }
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  }, [currentDate, viewMode]);

  const rangeEnd = useMemo(() => {
    if (viewMode === "year") return new Date(currentDate.getFullYear(), 11, 31, 23, 59, 59);
    if (viewMode === "month") return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 7);
    if (viewMode === "week") { const d = getWeekDays(currentDate); return new Date(d[6].getTime() + 86400000); }
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
  }, [currentDate, viewMode]);

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/admin/calendar-events", rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: async () => {
      const r = await fetch(`/api/admin/calendar-events?startDate=${rangeStart.toISOString()}&endDate=${rangeEnd.toISOString()}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load events");
      return r.json();
    },
  });

  const filteredEvents = events.filter(e => visibleCalendars.has(e.calendarType));

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/calendar-events", data);
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/calendar-events"] });
      if (result?.created && result.created > 1) {
        toast({ title: `${result.created} events created` });
      } else {
        toast({ title: "Event created" });
      }
      closeModal();
      closeDraft();
    },
    onError: (e: any) => toast({ title: "Error creating event", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/admin/calendar-events/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/calendar-events"] });
      toast({ title: "Event updated" });
      closeModal();
      setSelectedEvent(null);
    },
    onError: (e: any) => toast({ title: "Error updating event", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/calendar-events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/calendar-events"] });
      toast({ title: "Event deleted" });
      setSelectedEvent(null);
    },
  });

  function closeDraft() {
    setDraftEvent(null);
    setShowQuickCreate(false);
  }

  function handleDraftCreated(day: Date, startMinutes: number, endMinutes: number, columnIndex: number) {
    setSelectedEvent(null);
    setDraftEvent({ day, startMinutes, endMinutes, columnIndex });
    setShowQuickCreate(true);
    setTimeout(() => quickTitleRef.current?.focus(), 50);
  }

  function handleDraftResize(endMinutes: number) {
    if (!draftEvent) return;
    setDraftEvent({ ...draftEvent, endMinutes: Math.max(endMinutes, draftEvent.startMinutes + 15) });
  }

  function handleQuickSave(title: string) {
    if (!draftEvent || !title.trim()) return;
    const startDate = new Date(draftEvent.day);
    startDate.setHours(0, 0, 0, 0);
    const startTime = new Date(startDate.getTime() + draftEvent.startMinutes * 60000);
    const endTime = new Date(startDate.getTime() + draftEvent.endMinutes * 60000);
    createMutation.mutate({
      title: title.trim(),
      description: null,
      location: null,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      allDay: false,
      calendarType: "general",
      color: "#3b82f6",
    });
  }

  function handleQuickMoreOptions() {
    if (!draftEvent) return;
    const startDate = new Date(draftEvent.day);
    startDate.setHours(0, 0, 0, 0);
    const start = new Date(startDate.getTime() + draftEvent.startMinutes * 60000);
    const end = new Date(startDate.getTime() + draftEvent.endMinutes * 60000);
    setEditingEvent(null);
    setFormTitle((quickTitleRef.current?.value || "").trim());
    setFormDesc("");
    setFormLocation("");
    setFormStartDate(toLocalDate(start));
    setFormStartTime(toLocalTime(start));
    setFormEndDate(toLocalDate(end));
    setFormEndTime(toLocalTime(end));
    setFormAllDay(false);
    setFormCalType("general");
    setFormColor("#3b82f6");
    closeDraft();
    setShowModal(true);
  }

  function openCreateModal(date?: Date) {
    setEditingEvent(null);
    const d = date || new Date();
    const start = new Date(d);
    if (start.getHours() === 0 && start.getMinutes() === 0) start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    setFormTitle("");
    setFormDesc("");
    setFormLocation("");
    setFormStartDate(toLocalDate(start));
    setFormStartTime(toLocalTime(start));
    setFormEndDate(toLocalDate(end));
    setFormEndTime(toLocalTime(end));
    setFormAllDay(false);
    setFormCalType("general");
    setFormColor("#3b82f6");
    setFormRepeatType("none");
    setFormRepeatInterval(1);
    setFormRepeatFreq("weekly");
    setFormRepeatUntil("");
    setShowCustomRepeat(false);
    setFormAmount("");
    setShowModal(true);
  }

  function openEditModal(event: CalendarEvent) {
    setEditingEvent(event);
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    setFormTitle(event.title);
    setFormDesc(event.description || "");
    setFormLocation(event.location || "");
    setFormStartDate(toLocalDate(start));
    setFormStartTime(toLocalTime(start));
    setFormEndDate(toLocalDate(end));
    setFormEndTime(toLocalTime(end));
    setFormAllDay(event.allDay);
    setFormCalType(event.calendarType);
    setFormColor(event.color);
    setFormRepeatType("none");
    setFormRepeatInterval(1);
    setFormRepeatFreq("weekly");
    setFormRepeatUntil("");
    setShowCustomRepeat(false);
    setFormAmount(event.amount ? String(event.amount) : "");
    setShowModal(true);
    setSelectedEvent(null);
  }

  function closeModal() {
    setShowModal(false);
    setEditingEvent(null);
  }

  function handleSave() {
    if (!formTitle.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    if (!formStartDate) { toast({ title: "Start date required", variant: "destructive" }); return; }
    if (!formEndDate) { toast({ title: "End date required", variant: "destructive" }); return; }

    let startTime: Date;
    let endTime: Date;

    if (formAllDay) {
      startTime = new Date(formStartDate + "T00:00:00");
      endTime = new Date(formEndDate + "T23:59:59");
    } else {
      if (!formStartTime || !formEndTime) { toast({ title: "Please set both start and end times", variant: "destructive" }); return; }
      startTime = buildDate(formStartDate, formStartTime);
      endTime = buildDate(formEndDate, formEndTime);
    }

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) { toast({ title: "Invalid date or time", variant: "destructive" }); return; }
    if (endTime <= startTime) { toast({ title: "End time must be after start time", variant: "destructive" }); return; }

    const data = {
      title: formTitle.trim(),
      description: formDesc || null,
      location: formLocation || null,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      allDay: formAllDay,
      calendarType: formCalType,
      color: formColor,
      amount: formCalType === "payments" && formAmount ? formAmount : null,
    };

    let repeatRule: any = null;
    if (formRepeatType !== "none") {
      if (formRepeatType === "custom") {
        repeatRule = { type: formRepeatFreq, interval: formRepeatInterval, until: formRepeatUntil || null };
      } else {
        repeatRule = { type: formRepeatType, interval: 1, until: formRepeatUntil || null };
      }
    }

    if (editingEvent) {
      updateMutation.mutate({ id: editingEvent.id, ...data });
    } else {
      createMutation.mutate({ ...data, repeatRule });
    }
  }

  function navigate(dir: number) {
    const d = new Date(currentDate);
    if (viewMode === "year") d.setFullYear(d.getFullYear() + dir);
    else if (viewMode === "month") d.setMonth(d.getMonth() + dir);
    else if (viewMode === "week") d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  }

  function goToday() { setCurrentDate(new Date()); }

  function toggleCalendar(id: string) {
    setVisibleCalendars(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const headerLabel = viewMode === "year"
    ? String(currentDate.getFullYear())
    : viewMode === "month"
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

  function getTimedEvents(dayEvents: CalendarEvent[]) { return dayEvents.filter(e => !e.allDay); }
  function getAllDayEvents(dayEvents: CalendarEvent[]) { return dayEvents.filter(e => e.allDay); }

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
    <div className="flex h-full" onClick={() => { if (showQuickCreate && !draftEvent) closeDraft(); }}>
      <div className="w-56 flex-shrink-0 border-r border-white/[0.06] p-4 space-y-5 overflow-y-auto" style={{ background: 'rgba(2,6,14,0.5)' }}>
        <Button onClick={() => openCreateModal()} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2" data-testid="button-create-event">
          <Plus className="w-4 h-4" /> Create
        </Button>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-2">Mini Calendar</div>
          <MiniCalendar date={currentDate} onSelect={(d) => { setCurrentDate(d); }} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-2">Calendars</div>
          <div className="space-y-1">
            {CALENDAR_TYPES.map(cal => (
              <button key={cal.id} onClick={() => toggleCalendar(cal.id)} className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors" data-testid={`toggle-calendar-${cal.id}`}>
                <div className="w-3 h-3 rounded-sm flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: visibleCalendars.has(cal.id) ? cal.color : "transparent", border: `2px solid ${cal.color}` }}>
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
            <Button variant="outline" size="sm" onClick={goToday} className="border-white/10 text-white/60 text-xs rounded-xl h-8" data-testid="button-today">Today</Button>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-7 w-7 text-white/40 hover:text-white/60" data-testid="button-prev"><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => navigate(1)} className="h-7 w-7 text-white/40 hover:text-white/60" data-testid="button-next"><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <h2 className="text-base font-medium text-white/80" data-testid="text-date-range">{headerLabel}</h2>
          </div>
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-xl p-0.5">
            {(["day", "week", "month", "year"] as ViewMode[]).map(v => (
              <Button key={v} variant="ghost" size="sm" onClick={() => setViewMode(v)} className={`text-xs h-7 rounded-lg capitalize ${viewMode === v ? "bg-blue-600 text-white hover:bg-blue-600" : "text-white/40 hover:text-white/60"}`} data-testid={`button-view-${v}`}>{v}</Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {viewMode === "year" && (
            <YearView year={currentDate.getFullYear()} events={filteredEvents} today={today} onDayClick={(d) => { openCreateModal(d); }} onEventClick={setSelectedEvent} />
          )}
          {viewMode === "month" && (
            <MonthView days={getMonthDays(currentDate)} events={filteredEvents} currentDate={currentDate} today={today} onDayClick={(d) => { openCreateModal(d); }} onEventClick={setSelectedEvent} />
          )}
          {viewMode === "week" && (
            <TimeGridView
              mode="week"
              days={getWeekDays(currentDate)}
              events={filteredEvents}
              today={today}
              hours={hours}
              getEventStyle={getEventStyle}
              getTimedEvents={getTimedEvents}
              getAllDayEvents={getAllDayEvents}
              onEventClick={setSelectedEvent}
              draftEvent={draftEvent}
              showQuickCreate={showQuickCreate}
              onDraftCreated={handleDraftCreated}
              onDraftResize={handleDraftResize}
              onQuickSave={handleQuickSave}
              onQuickMoreOptions={handleQuickMoreOptions}
              onQuickClose={closeDraft}
              quickTitleRef={quickTitleRef}
              createPending={createMutation.isPending}
            />
          )}
          {viewMode === "day" && (
            <TimeGridView
              mode="day"
              days={[currentDate]}
              events={getEventsForDay(currentDate)}
              today={today}
              hours={hours}
              getEventStyle={getEventStyle}
              getTimedEvents={getTimedEvents}
              getAllDayEvents={getAllDayEvents}
              onEventClick={setSelectedEvent}
              draftEvent={draftEvent}
              showQuickCreate={showQuickCreate}
              onDraftCreated={handleDraftCreated}
              onDraftResize={handleDraftResize}
              onQuickSave={handleQuickSave}
              onQuickMoreOptions={handleQuickMoreOptions}
              onQuickClose={closeDraft}
              quickTitleRef={quickTitleRef}
              createPending={createMutation.isPending}
            />
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full max-w-md premium-card border border-white/[0.08] rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()} data-testid="modal-event">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{editingEvent ? "Edit Event" : "New Event"}</h3>
              <Button variant="ghost" size="icon" onClick={closeModal} className="text-white/30 h-8 w-8"><X className="w-4 h-4" /></Button>
            </div>
            <div>
              <Input placeholder="Add title" value={formTitle} onChange={e => setFormTitle(e.target.value)} className="premium-input text-white/90 text-lg border-0 border-b border-white/10 rounded-none px-0 focus-visible:ring-0" data-testid="input-event-title" autoFocus />
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={formAllDay} onCheckedChange={setFormAllDay} data-testid="switch-all-day" />
                <span className="text-xs text-white/40">All day / no fixed time</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-white/30 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input type="date" value={formStartDate} onChange={e => { setFormStartDate(e.target.value); if (!formEndDate || e.target.value > formEndDate) setFormEndDate(e.target.value); }} className="premium-input text-white/70 text-xs rounded-xl flex-1" data-testid="input-event-start-date" />
                    {!formAllDay && <Input type="time" value={formStartTime} onChange={e => setFormStartTime(e.target.value)} className="premium-input text-white/70 text-xs rounded-xl w-[120px]" data-testid="input-event-start-time" />}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)} className="premium-input text-white/70 text-xs rounded-xl flex-1" data-testid="input-event-end-date" />
                    {!formAllDay && <Input type="time" value={formEndTime} onChange={e => setFormEndTime(e.target.value)} className="premium-input text-white/70 text-xs rounded-xl w-[120px]" data-testid="input-event-end-time" />}
                  </div>
                </div>
              </div>
            </div>

            {!editingEvent && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Repeat className="w-4 h-4 text-white/30" />
                  <Select value={formRepeatType} onValueChange={(v: any) => { setFormRepeatType(v); if (v === "custom") setShowCustomRepeat(true); else setShowCustomRepeat(false); }}>
                    <SelectTrigger className="premium-input text-white/70 text-sm rounded-xl flex-1" data-testid="select-repeat-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Does not repeat</SelectItem>
                      <SelectItem value="daily">Repeats daily</SelectItem>
                      <SelectItem value="weekly">Repeats weekly</SelectItem>
                      <SelectItem value="monthly">Repeats monthly</SelectItem>
                      <SelectItem value="yearly">Repeats yearly</SelectItem>
                      <SelectItem value="custom">Custom...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formRepeatType === "custom" && (
                  <div className="ml-7 space-y-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/40 w-16">Repeat every</span>
                      <Input type="number" min={1} max={99} value={formRepeatInterval} onChange={e => setFormRepeatInterval(Math.max(1, parseInt(e.target.value) || 1))} className="premium-input text-white/70 text-xs rounded-lg w-16 h-8 text-center" data-testid="input-repeat-interval" />
                      <Select value={formRepeatFreq} onValueChange={(v: any) => setFormRepeatFreq(v)}>
                        <SelectTrigger className="premium-input text-white/70 text-xs rounded-lg h-8 w-[100px]" data-testid="select-repeat-freq"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">{formRepeatInterval > 1 ? "days" : "day"}</SelectItem>
                          <SelectItem value="weekly">{formRepeatInterval > 1 ? "weeks" : "week"}</SelectItem>
                          <SelectItem value="monthly">{formRepeatInterval > 1 ? "months" : "month"}</SelectItem>
                          <SelectItem value="yearly">{formRepeatInterval > 1 ? "years" : "year"}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {formRepeatType !== "none" && (
                  <div className="ml-7 flex items-center gap-2">
                    <span className="text-xs text-white/40">Until</span>
                    <Input type="date" value={formRepeatUntil} onChange={e => setFormRepeatUntil(e.target.value)} className="premium-input text-white/70 text-xs rounded-xl flex-1 h-8" data-testid="input-repeat-until" placeholder="No end date" />
                    {formRepeatUntil && (
                      <button onClick={() => setFormRepeatUntil("")} className="text-white/30 hover:text-white/50"><X className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-white/30" />
              <Input placeholder="Add location" value={formLocation} onChange={e => setFormLocation(e.target.value)} className="premium-input text-white/70 text-sm rounded-xl flex-1" data-testid="input-event-location" />
            </div>
            <div className="flex items-center gap-3">
              <CalIcon className="w-4 h-4 text-white/30" />
              <Select value={formCalType} onValueChange={(v) => { setFormCalType(v); const c = CALENDAR_TYPES.find(t => t.id === v); if (c) setFormColor(c.color); }}>
                <SelectTrigger className="premium-input text-white/70 text-sm rounded-xl flex-1" data-testid="select-calendar-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CALENDAR_TYPES.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.color }} />{c.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formCalType === "payments" && (
              <div className="flex items-center gap-3">
                <DollarSign className="w-4 h-4 text-amber-400/60" />
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={formAmount}
                    onChange={e => setFormAmount(e.target.value)}
                    className="premium-input text-white/70 text-sm rounded-xl pl-7"
                    data-testid="input-event-amount"
                  />
                </div>
              </div>
            )}

            <Textarea placeholder="Add description" value={formDesc} onChange={e => setFormDesc(e.target.value)} className="premium-input text-white/70 text-sm rounded-xl min-h-[60px]" data-testid="input-event-description" />
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={!formTitle.trim() || createMutation.isPending || updateMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex-1" data-testid="button-save-event">
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={closeModal} className="border-white/10 text-white/60 rounded-xl" data-testid="button-cancel-event">Cancel</Button>
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
              <Button variant="ghost" size="icon" onClick={() => setSelectedEvent(null)} className="text-white/30 h-7 w-7"><X className="w-3.5 h-3.5" /></Button>
            </div>
            <h3 className="text-lg font-semibold text-white" data-testid="text-event-title">{selectedEvent.title}</h3>
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {selectedEvent.allDay ? (
                  isSameDay(new Date(selectedEvent.startTime), new Date(selectedEvent.endTime))
                    ? new Date(selectedEvent.startTime).toLocaleDateString("en-NZ", { weekday: "short", month: "short", day: "numeric" }) + " (All day)"
                    : new Date(selectedEvent.startTime).toLocaleDateString("en-NZ", { month: "short", day: "numeric" }) + " – " + new Date(selectedEvent.endTime).toLocaleDateString("en-NZ", { month: "short", day: "numeric" }) + " (All day)"
                ) : (
                  <>{new Date(selectedEvent.startTime).toLocaleDateString("en-NZ", { weekday: "short", month: "short", day: "numeric" })} {formatTime(new Date(selectedEvent.startTime))} – {formatTime(new Date(selectedEvent.endTime))}</>
                )}
              </span>
            </div>
            {selectedEvent.location && <div className="flex items-center gap-2 text-sm text-white/50"><MapPin className="w-3.5 h-3.5" /><span>{selectedEvent.location}</span></div>}
            {selectedEvent.amount && (
              <div className="flex items-center gap-2 text-sm text-amber-400/80" data-testid="text-event-amount">
                <DollarSign className="w-3.5 h-3.5" />
                <span className="font-medium">${parseFloat(selectedEvent.amount).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            {selectedEvent.description && <p className="text-sm text-white/40">{selectedEvent.description}</p>}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => openEditModal(selectedEvent)} className="border-white/10 text-white/60 rounded-xl gap-1.5 flex-1" data-testid="button-edit-event"><Edit className="w-3.5 h-3.5" /> Edit</Button>
              <Button variant="outline" size="sm" onClick={() => { if (confirm("Delete this event?")) deleteMutation.mutate(selectedEvent.id); }} className="border-red-500/20 text-red-400 hover:bg-red-500/10 rounded-xl gap-1.5" data-testid="button-delete-event"><Trash2 className="w-3.5 h-3.5" /> Delete</Button>
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
        {["M","T","W","T","F","S","S"].map((d, i) => <div key={i} className="text-center text-[9px] text-white/20 py-1">{d}</div>)}
        {days.map((d, i) => {
          const isCurrentMonth = d.getMonth() === viewDate.getMonth();
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, date);
          return (
            <button key={i} onClick={() => onSelect(d)} className={`text-center text-[10px] py-1 rounded transition-colors ${isCurrentMonth ? "text-white/50 hover:bg-white/[0.06]" : "text-white/15"} ${isToday ? "bg-blue-600 text-white hover:bg-blue-600" : ""} ${isSelected && !isToday ? "bg-white/[0.08] text-white" : ""}`}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AllDayBanner({ events, onEventClick }: { events: CalendarEvent[]; onEventClick: (e: CalendarEvent) => void }) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-0.5 py-1 px-1">
      {events.map(event => (
        <div key={event.id} onClick={(e) => { e.stopPropagation(); onEventClick(event); }} className="text-[10px] px-1.5 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity truncate" style={{ backgroundColor: `${event.color}25`, color: event.color, borderLeft: `2px solid ${event.color}` }} data-testid={`event-allday-${event.id}`}>
          {event.title}
        </div>
      ))}
    </div>
  );
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT_DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function YearView({ year, events, today, onDayClick, onEventClick }: {
  year: number; events: CalendarEvent[]; today: Date;
  onDayClick: (d: Date) => void; onEventClick: (e: CalendarEvent) => void;
}) {
  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach(e => {
      const key = new Date(e.startTime).toISOString().split("T")[0];
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return map;
  }, [events]);

  return (
    <div className="h-full overflow-auto" data-testid="year-view">
      <table className="w-full border-collapse table-fixed min-w-[1200px]">
        <thead className="sticky top-0 z-10" style={{ background: 'rgba(2,6,14,0.95)' }}>
          <tr className="border-b border-white/[0.06]">
            <th className="w-[48px] py-2 px-1 text-center text-[10px] text-white/20 font-medium" />
            {MONTH_NAMES.map(m => (
              <th key={m} className="py-2 px-1 text-center text-[11px] text-white/50 font-semibold uppercase tracking-wider">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 31 }, (_, row) => {
            const dayNum = row + 1;
            return (
              <tr key={dayNum} className="border-b border-white/[0.03]">
                <td className="w-[48px] py-1 px-1 text-center text-[11px] text-white/25 font-medium align-top pt-1.5">{dayNum}</td>
                {Array.from({ length: 12 }, (_, monthIdx) => {
                  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
                  if (dayNum > daysInMonth) return <td key={monthIdx} className="border-r border-white/[0.02] bg-white/[0.01]" />;
                  const date = new Date(year, monthIdx, dayNum);
                  const dateKey = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                  const dayOfWeek = date.getDay();
                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                  const isToday = isSameDay(date, today);
                  const dayEvents = eventsByDay[dateKey] || [];

                  return (
                    <td
                      key={monthIdx}
                      className={`border-r border-white/[0.03] px-1 py-0.5 min-h-[28px] cursor-pointer hover:bg-white/[0.04] transition-colors overflow-hidden align-top ${isWeekend ? "bg-white/[0.015]" : ""} ${isToday ? "ring-1 ring-inset ring-blue-500/40 bg-blue-500/[0.06]" : ""}`}
                      onClick={() => onDayClick(date)}
                      data-testid={`year-cell-${dateKey}`}
                    >
                      <div className="overflow-hidden">
                        <div className="flex items-start gap-1">
                          <span className={`text-[9px] flex-shrink-0 w-6 ${isWeekend ? "text-white/20" : "text-white/30"} ${isToday ? "text-blue-400 font-semibold" : ""}`}>
                            {SHORT_DAY_NAMES[dayOfWeek]}
                          </span>
                          <div className="flex-1 min-w-0 space-y-px overflow-hidden">
                            {dayEvents.slice(0, 3).map(event => (
                              <div
                                key={event.id}
                                onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                                className="text-[9px] leading-tight px-1 py-px rounded truncate cursor-pointer hover:opacity-80 transition-opacity font-medium"
                                style={{ backgroundColor: `${event.color}25`, color: event.color }}
                                data-testid={`year-event-${event.id}`}
                              >
                                {event.title}
                                {event.amount && <span className="ml-0.5 text-amber-400/70">${parseFloat(event.amount).toLocaleString("en-NZ", { minimumFractionDigits: 0 })}</span>}
                              </div>
                            ))}
                            {dayEvents.length > 3 && <div className="text-[8px] text-white/25 px-1">+{dayEvents.length - 3}</div>}
                          </div>
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthView({ days, events, currentDate, today, onDayClick, onEventClick }: {
  days: Date[]; events: CalendarEvent[]; currentDate: Date; today: Date;
  onDayClick: (d: Date) => void; onEventClick: (e: CalendarEvent) => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => <div key={d} className="text-center text-[10px] text-white/30 font-medium py-2 uppercase tracking-wider">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {days.map((day, i) => {
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = isSameDay(day, today);
          const dayEvents = events.filter(e => isSameDay(new Date(e.startTime), day));
          const allDayEvts = dayEvents.filter(e => e.allDay);
          const timedEvts = dayEvents.filter(e => !e.allDay);
          return (
            <div key={i} className={`border-b border-r border-white/[0.04] p-1 min-h-[80px] cursor-pointer hover:bg-white/[0.02] transition-colors overflow-hidden ${!isCurrentMonth ? "opacity-30" : ""}`} onClick={() => onDayClick(day)}>
              <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-blue-600 text-white" : "text-white/50"}`}>{day.getDate()}</div>
              <div className="space-y-0.5 overflow-hidden">
                {allDayEvts.map(event => (
                  <div key={event.id} onClick={(e) => { e.stopPropagation(); onEventClick(event); }} className="text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity font-medium" style={{ backgroundColor: `${event.color}30`, color: event.color }} data-testid={`event-${event.id}`}>{event.title}{event.amount && <span className="ml-1 text-amber-400/80">${parseFloat(event.amount).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}</span>}</div>
                ))}
                {timedEvts.slice(0, 3).map(event => (
                  <div key={event.id} onClick={(e) => { e.stopPropagation(); onEventClick(event); }} className="text-[10px] px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity" style={{ backgroundColor: `${event.color}25`, color: event.color, borderLeft: `2px solid ${event.color}` }} data-testid={`event-${event.id}`}>
                    {formatTime(new Date(event.startTime))} {event.title}
                  </div>
                ))}
                {timedEvts.length > 3 && <div className="text-[9px] text-white/30 px-1">+{timedEvts.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface QuickCreateProps {
  draft: DraftEvent;
  onSave: (title: string) => void;
  onMoreOptions: () => void;
  onClose: () => void;
  titleRef: React.RefObject<HTMLInputElement | null>;
  isPending: boolean;
  columnIndex: number;
  mode: "week" | "day";
}

function QuickCreatePopover({ draft, onSave, onMoreOptions, onClose, titleRef, isPending, columnIndex, mode }: QuickCreateProps) {
  const [title, setTitle] = useState("");

  const leftPercent = mode === "week"
    ? ((columnIndex + 1) / 8) * 100
    : (1 / 2) * 100;

  const popoverStyle: any = {
    position: "absolute" as const,
    top: `${(draft.startMinutes / 1440) * 24 * HOUR_HEIGHT}px`,
    zIndex: 40,
    left: mode === "week" ? `calc(${leftPercent}% + 8px)` : "50%",
    transform: mode === "day" ? "translateX(-50%)" : undefined,
  };

  return (
    <div style={popoverStyle} className="w-[280px]" onClick={e => e.stopPropagation()} data-testid="popover-quick-create">
      <div className="premium-card border border-white/[0.12] rounded-xl p-3 space-y-2.5 shadow-2xl shadow-black/50">
        <Input
          ref={titleRef}
          placeholder="Add title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && title.trim()) onSave(title); if (e.key === "Escape") onClose(); }}
          className="premium-input text-white/90 text-sm border-0 border-b border-white/10 rounded-none px-0 focus-visible:ring-0 h-8"
          data-testid="input-quick-title"
          autoFocus
        />
        <div className="text-[11px] text-white/40 flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {formatMinutes(draft.startMinutes)} – {formatMinutes(draft.endMinutes)}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { if (title.trim()) onSave(title); }} disabled={!title.trim() || isPending} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs h-7 flex-1" data-testid="button-quick-save">
            {isPending ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={onMoreOptions} className="border-white/10 text-white/50 rounded-lg text-xs h-7" data-testid="button-quick-more">
            More options
          </Button>
        </div>
      </div>
    </div>
  );
}

function TimeGridView({ mode, days, events, today, hours, getEventStyle, getTimedEvents, getAllDayEvents, onEventClick, draftEvent, showQuickCreate, onDraftCreated, onDraftResize, onQuickSave, onQuickMoreOptions, onQuickClose, quickTitleRef, createPending }: {
  mode: "week" | "day";
  days: Date[]; events: CalendarEvent[]; today: Date; hours: number[];
  getEventStyle: (e: CalendarEvent, d: Date) => any;
  getTimedEvents: (events: CalendarEvent[]) => CalendarEvent[];
  getAllDayEvents: (events: CalendarEvent[]) => CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
  draftEvent: DraftEvent | null;
  showQuickCreate: boolean;
  onDraftCreated: (day: Date, startMinutes: number, endMinutes: number, colIndex: number) => void;
  onDraftResize: (endMinutes: number) => void;
  onQuickSave: (title: string) => void;
  onQuickMoreOptions: () => void;
  onQuickClose: () => void;
  quickTitleRef: React.RefObject<HTMLInputElement | null>;
  createPending: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragColIndex = useRef(0);
  const dragStartMinutes = useRef(0);

  const colCount = mode === "week" ? 7 : 1;

  const dayEventsMap = useMemo(() => {
    return days.map(day => {
      const dayEvents = events.filter(e => {
        const s = new Date(e.startTime);
        const en = new Date(e.endTime);
        return isSameDay(s, day) || isSameDay(en, day) || (s < day && en > new Date(day.getTime() + 86400000));
      });
      return { timed: getTimedEvents(dayEvents), allDay: getAllDayEvents(dayEvents) };
    });
  }, [days, events, getTimedEvents, getAllDayEvents]);

  const hasAnyAllDay = dayEventsMap.some(d => d.allDay.length > 0);

  const getMinutesFromY = useCallback((clientY: number): number => {
    if (!gridRef.current) return 0;
    const rect = gridRef.current.getBoundingClientRect();
    const y = clientY - rect.top;
    const totalHeight = hours.length * HOUR_HEIGHT;
    const minutes = (y / totalHeight) * 1440;
    return snapToGrid(Math.max(0, Math.min(1425, minutes)));
  }, [hours]);

  const getColFromX = useCallback((clientX: number): number => {
    if (!gridRef.current) return 0;
    const rect = gridRef.current.getBoundingClientRect();
    const gutterWidth = 60;
    const x = clientX - rect.left - gutterWidth;
    const colWidth = (rect.width - gutterWidth) / colCount;
    return Math.max(0, Math.min(colCount - 1, Math.floor(x / colWidth)));
  }, [colCount]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-event-block]') || (e.target as HTMLElement).closest('[data-testid^="popover-"]')) return;
    const minutes = getMinutesFromY(e.clientY);
    const col = getColFromX(e.clientX);
    isDragging.current = true;
    dragColIndex.current = col;
    dragStartMinutes.current = minutes;
    onDraftCreated(days[col], minutes, minutes + 30, col);
    e.preventDefault();
  }, [days, getMinutesFromY, getColFromX, onDraftCreated]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const minutes = getMinutesFromY(e.clientY);
    const end = Math.max(minutes, dragStartMinutes.current + 15);
    onDraftResize(end);
  }, [getMinutesFromY, onDraftResize]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    const handleGlobalUp = () => { isDragging.current = false; };
    window.addEventListener("mouseup", handleGlobalUp);
    return () => window.removeEventListener("mouseup", handleGlobalUp);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className={`grid border-b border-white/[0.06] sticky top-0 z-10`} style={{ background: 'rgba(2,6,14,0.95)', gridTemplateColumns: `60px repeat(${colCount}, 1fr)` }}>
        <div />
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={i} className="text-center py-2 border-l border-white/[0.04]">
              <div className="text-[10px] text-white/30 uppercase">{d.toLocaleString("default", { weekday: "short" })}</div>
              <div className={`text-lg font-medium ${isToday ? "w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto" : "text-white/60"}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {hasAnyAllDay && (
        <div className={`grid border-b border-white/[0.06] sticky z-[9]`} style={{ background: 'rgba(2,6,14,0.9)', top: '68px', gridTemplateColumns: `60px repeat(${colCount}, 1fr)` }}>
          <div className="flex items-center justify-end pr-2"><span className="text-[9px] text-white/20 uppercase">all day</span></div>
          {days.map((_, i) => (
            <div key={i} className="border-l border-white/[0.04] min-h-[28px] overflow-hidden">
              <AllDayBanner events={dayEventsMap[i].allDay} onEventClick={onEventClick} />
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div
          ref={gridRef}
          className={`grid relative select-none`}
          style={{ height: `${hours.length * HOUR_HEIGHT}px`, gridTemplateColumns: `60px repeat(${colCount}, 1fr)` }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <div>
            {hours.map(h => (
              <div key={h} className="h-[60px] flex items-start justify-end pr-2 pt-0">
                <span className="text-[10px] text-white/20 -mt-1.5">{h === 0 ? "" : `${h % 12 || 12}${h < 12 ? "am" : "pm"}`}</span>
              </div>
            ))}
          </div>
          {days.map((day, di) => (
            <div key={di} className="border-l border-white/[0.04] relative overflow-hidden">
              {hours.map(h => (
                <div key={h} className="h-[60px] border-b border-white/[0.03]" />
              ))}

              {dayEventsMap[di].timed.map(event => {
                const style = getEventStyle(event, day);
                return (
                  <div
                    key={event.id}
                    data-event-block
                    className="absolute left-0.5 right-1 rounded-lg px-1.5 py-0.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
                    style={{ ...style, backgroundColor: `${event.color}30`, borderLeft: `3px solid ${event.color}`, zIndex: 10 }}
                    onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                    data-testid={`event-${event.id}`}
                  >
                    <div className="text-[11px] font-medium truncate" style={{ color: event.color }}>
                      {event.title}
                      {event.amount && <span className="ml-1 text-amber-400/80">${parseFloat(event.amount).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}</span>}
                    </div>
                    <div className="text-[9px] opacity-70" style={{ color: event.color }}>
                      {formatTime(new Date(event.startTime))} – {formatTime(new Date(event.endTime))}
                    </div>
                  </div>
                );
              })}

              {draftEvent && draftEvent.columnIndex === di && (
                <DraftEventBlock draft={draftEvent} onResize={onDraftResize} gridRef={gridRef} hours={hours} />
              )}
            </div>
          ))}

          {showQuickCreate && draftEvent && (
            <QuickCreatePopover
              draft={draftEvent}
              onSave={onQuickSave}
              onMoreOptions={onQuickMoreOptions}
              onClose={onQuickClose}
              titleRef={quickTitleRef}
              isPending={createPending}
              columnIndex={draftEvent.columnIndex}
              mode={mode}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DraftEventBlock({ draft, onResize, gridRef, hours }: {
  draft: DraftEvent;
  onResize: (endMinutes: number) => void;
  gridRef: React.RefObject<HTMLDivElement | null>;
  hours: number[];
}) {
  const topPx = (draft.startMinutes / 60) * HOUR_HEIGHT;
  const heightPx = Math.max(((draft.endMinutes - draft.startMinutes) / 60) * HOUR_HEIGHT, 20);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const handleMove = (me: MouseEvent) => {
      if (!gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      const y = me.clientY - rect.top;
      const totalHeight = hours.length * HOUR_HEIGHT;
      const minutes = snapToGrid(Math.max(draft.startMinutes + 15, Math.min(1440, (y / totalHeight) * 1440)));
      onResize(minutes);
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [draft.startMinutes, gridRef, hours, onResize]);

  return (
    <div
      data-event-block
      className="absolute left-0.5 right-1 rounded-lg overflow-hidden cursor-default"
      style={{ top: `${topPx}px`, height: `${heightPx}px`, backgroundColor: "rgba(59,130,246,0.3)", borderLeft: "3px solid #3b82f6", zIndex: 20 }}
      onClick={e => e.stopPropagation()}
      data-testid="draft-event-block"
    >
      <div className="px-1.5 py-0.5">
        <div className="text-[11px] font-medium text-blue-300">(No title)</div>
        <div className="text-[9px] text-blue-300/70">
          {formatMinutes(draft.startMinutes)} – {formatMinutes(draft.endMinutes)}
        </div>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize hover:bg-blue-400/30 transition-colors"
        onMouseDown={handleResizeMouseDown}
        data-testid="draft-resize-handle"
      />
    </div>
  );
}
