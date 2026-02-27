import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  GraduationCap,
  Plus,
  Calendar,
  MapPin,
  Users,
  DollarSign,
  ArrowLeft,
  ClipboardCheck,
  Clock,
  UserCheck,
  Percent,
  Search,
  Download,
  Trash2,
  Pencil,
  Eye,
  CalendarPlus,
  BarChart3,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProgramSchema } from "@shared/schema";
import type { Program, ProgramSession, Contact, Registration, SessionBooking, ProgramDiscount } from "@shared/schema";
import { z } from "zod";

const programFormSchema = insertProgramSchema.extend({
  name: z.string().min(1, "Programme name is required"),
  type: z.enum(["holiday_camp", "academy", "trials", "event", "open_training"]),
});

type ProgramFormValues = z.infer<typeof programFormSchema>;

const inputClass = "premium-input text-white/80 rounded-xl text-[13px]";
const labelClass = "text-[12px] text-white/45 font-medium";

function ProgramForm({ onClose, editProgram }: { onClose: () => void; editProgram?: Program }) {
  const { toast } = useToast();
  const form = useForm<ProgramFormValues>({
    resolver: zodResolver(programFormSchema),
    defaultValues: editProgram ? {
      name: editProgram.name,
      type: editProgram.type as any,
      description: editProgram.description ?? "",
      location: editProgram.location ?? "",
      startDate: editProgram.startDate ?? "",
      endDate: editProgram.endDate ?? "",
      bookingsOpenDate: editProgram.bookingsOpenDate ?? "",
      bookingsCloseDate: editProgram.bookingsCloseDate ?? "",
      includeWeekends: editProgram.includeWeekends ?? false,
      capacity: editProgram.capacity ?? undefined,
      ageMin: editProgram.ageMin ?? undefined,
      ageMax: editProgram.ageMax ?? undefined,
      fee: editProgram.fee ?? "",
      fullDayCost: editProgram.fullDayCost ?? "",
      isActive: editProgram.isActive,
    } : {
      name: "",
      type: "holiday_camp",
      description: "",
      location: "",
      startDate: "",
      endDate: "",
      bookingsOpenDate: "",
      bookingsCloseDate: "",
      includeWeekends: false,
      capacity: undefined,
      ageMin: undefined,
      ageMax: undefined,
      fee: "",
      fullDayCost: "",
      isActive: true,
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: ProgramFormValues) => {
      const cleaned = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, v === "" ? null : v])
      );
      if (editProgram) {
        const res = await apiRequest("PATCH", `/api/programs/${editProgram.id}`, cleaned);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/programs", cleaned);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: editProgram ? "Programme updated" : "Programme created successfully" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error saving programme", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel className={labelClass}>Programme Name *</FormLabel>
            <FormControl><Input {...field} data-testid="input-program-name" className={inputClass} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="type" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-program-type" className={inputClass}><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="holiday_camp">Holiday Camp</SelectItem>
                  <SelectItem value="academy">Academy</SelectItem>
                  <SelectItem value="trials">Trials</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                  <SelectItem value="open_training">Open Training</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="fee" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Session Fee ($)</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} type="number" step="0.01" data-testid="input-fee" className={inputClass} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="fullDayCost" render={({ field }) => (
          <FormItem>
            <FormLabel className={labelClass}>Full Day Cost ($)</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} type="number" step="0.01" data-testid="input-full-day-cost" className={inputClass} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel className={labelClass}>Description</FormLabel>
            <FormControl><Textarea {...field} value={field.value ?? ""} data-testid="input-description" className={inputClass} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="location" render={({ field }) => (
          <FormItem>
            <FormLabel className={labelClass}>Location</FormLabel>
            <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-location" className={inputClass} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="startDate" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Session Start Date</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} type="date" data-testid="input-start-date" className={inputClass} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="endDate" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Session End Date</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} type="date" data-testid="input-end-date" className={inputClass} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="bookingsOpenDate" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Bookings Open</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} type="date" data-testid="input-bookings-open" className={inputClass} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="bookingsCloseDate" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Bookings Close</FormLabel>
              <FormControl><Input {...field} value={field.value ?? ""} type="date" data-testid="input-bookings-close" className={inputClass} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField control={form.control} name="capacity" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Capacity</FormLabel>
              <FormControl>
                <Input type="number" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)} data-testid="input-capacity" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="ageMin" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Min Age</FormLabel>
              <FormControl>
                <Input type="number" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)} data-testid="input-age-min" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="ageMax" render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Max Age</FormLabel>
              <FormControl>
                <Input type="number" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)} data-testid="input-age-max" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="includeWeekends" render={({ field }) => (
          <FormItem className="flex items-center gap-3 space-y-0">
            <FormControl>
              <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} data-testid="checkbox-include-weekends" />
            </FormControl>
            <FormLabel className={labelClass}>Include weekends in session dates</FormLabel>
          </FormItem>
        )} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} data-testid="button-cancel" className="text-white/45 hover:text-white/60 transition-colors duration-300">Cancel</Button>
          <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-program" className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn">
            {saveMutation.isPending ? "Saving..." : editProgram ? "Update Programme" : "Save Programme"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
}

function formatDateFull(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function getWeekNumber(dateStr: string, startDate: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const s = new Date(startDate + "T00:00:00");
  const diff = Math.floor((d.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return Math.floor(diff / 7) + 1;
}

function AddDateModal({ programId, existingDates, sessionTemplates, onClose }: {
  programId: number;
  existingDates: string[];
  sessionTemplates: { name: string; startTime: string; endTime: string; venue: string; rollTaker: string; cost: string; capacity: number | null }[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState("");

  const addDateMutation = useMutation({
    mutationFn: async () => {
      if (selectedDates.length === 0) throw new Error("Select at least one date");
      const sessionsToCreate = selectedDates.flatMap(date =>
        sessionTemplates.length > 0
          ? sessionTemplates.map(t => ({
              name: t.name,
              date,
              startTime: t.startTime || null,
              endTime: t.endTime || null,
              venue: t.venue || null,
              rollTaker: t.rollTaker || null,
              cost: t.cost || null,
              capacity: t.capacity,
            }))
          : [{ name: "Morning", date, startTime: "09:00", endTime: "12:00", venue: null, rollTaker: null, cost: null, capacity: null },
             { name: "Afternoon", date, startTime: "13:00", endTime: "16:00", venue: null, rollTaker: null, cost: null, capacity: null }]
      );
      await apiRequest("POST", `/api/programs/${programId}/sessions`, sessionsToCreate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", String(programId), "sessions"] });
      toast({ title: `Added ${selectedDates.length} date(s)` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addDate = () => {
    if (newDate && !selectedDates.includes(newDate) && !existingDates.includes(newDate)) {
      setSelectedDates(prev => [...prev, newDate].sort());
      setNewDate("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} data-testid="input-add-date" className={inputClass + " flex-1"} />
        <Button type="button" onClick={addDate} data-testid="button-add-date-pick" className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 rounded-xl text-[13px]">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {selectedDates.length > 0 && (
        <div className="space-y-1">
          {selectedDates.map(d => (
            <div key={d} className="flex items-center justify-between px-3 py-2 rounded-xl bg-blue-500/[0.06] border border-blue-500/[0.1]">
              <span className="text-[13px] text-white/65">{formatDateFull(d)}</span>
              <Button variant="ghost" size="icon" onClick={() => setSelectedDates(prev => prev.filter(x => x !== d))} className="h-6 w-6 text-white/25 hover:text-red-400">
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-white/30">
        {sessionTemplates.length > 0
          ? `Each date will get ${sessionTemplates.length} session(s): ${sessionTemplates.map(t => t.name).join(", ")}`
          : "Each date will get Morning + Afternoon sessions by default"}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} className="text-white/45 hover:text-white/60">Cancel</Button>
        <Button onClick={() => addDateMutation.mutate()} disabled={addDateMutation.isPending || selectedDates.length === 0} data-testid="button-confirm-add-dates" className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn">
          {addDateMutation.isPending ? "Adding..." : `Add ${selectedDates.length} Date(s)`}
        </Button>
      </div>
    </div>
  );
}

function EditSessionsModal({ programId, sessions, onClose }: {
  programId: number;
  sessions: ProgramSession[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const uniqueNames = [...new Set(sessions.map(s => s.name))];
  const [templates, setTemplates] = useState(
    uniqueNames.map(name => {
      const sample = sessions.find(s => s.name === name)!;
      return {
        name,
        startTime: sample.startTime ?? "",
        endTime: sample.endTime ?? "",
        venue: sample.venue ?? "",
        rollTaker: sample.rollTaker ?? "",
        cost: sample.cost ?? "",
        capacity: sample.capacity,
      };
    })
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = templates.flatMap(t => {
        const matching = sessions.filter(s => s.name === t.name);
        return matching.map(s =>
          apiRequest("PATCH", `/api/sessions/${s.id}`, {
            name: t.name,
            startTime: t.startTime || null,
            endTime: t.endTime || null,
            venue: t.venue || null,
            rollTaker: t.rollTaker || null,
            cost: t.cost || null,
            capacity: t.capacity,
          })
        );
      });
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", String(programId), "sessions"] });
      toast({ title: "Sessions updated" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateTemplate = (idx: number, field: string, value: any) => {
    setTemplates(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  };

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {templates.map((t, idx) => (
        <div key={idx} className="rounded-xl border border-blue-500/[0.1] bg-blue-500/[0.03] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Session Name</label>
              <Input value={t.name} onChange={e => updateTemplate(idx, "name", e.target.value)} className={inputClass} data-testid={`input-session-name-${idx}`} />
            </div>
            <div>
              <label className={labelClass}>Cost ($)</label>
              <Input value={t.cost} onChange={e => updateTemplate(idx, "cost", e.target.value)} type="number" step="0.01" className={inputClass} data-testid={`input-session-cost-${idx}`} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Start Time</label>
              <Input value={t.startTime} onChange={e => updateTemplate(idx, "startTime", e.target.value)} type="time" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>End Time</label>
              <Input value={t.endTime} onChange={e => updateTemplate(idx, "endTime", e.target.value)} type="time" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Venue</label>
              <Input value={t.venue} onChange={e => updateTemplate(idx, "venue", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Roll Taker</label>
              <Input value={t.rollTaker} onChange={e => updateTemplate(idx, "rollTaker", e.target.value)} className={inputClass} />
            </div>
          </div>
          <div className="w-1/3">
            <label className={labelClass}>Capacity</label>
            <Input value={t.capacity ?? ""} onChange={e => updateTemplate(idx, "capacity", e.target.value ? parseInt(e.target.value) : null)} type="number" className={inputClass} />
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} className="text-white/45 hover:text-white/60">Cancel</Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-sessions" className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn">
          {saveMutation.isPending ? "Saving..." : "Save All Sessions"}
        </Button>
      </div>
    </div>
  );
}

function DiscountsModal({ programId, onClose }: { programId: number; onClose: () => void }) {
  const { toast } = useToast();
  const { data: discounts } = useQuery<ProgramDiscount[]>({
    queryKey: ["/api/programs", String(programId), "discounts"],
  });

  const [rows, setRows] = useState<{ minBookings: string; discountPercent: string }[] | null>(null);

  const activeRows = rows ?? (discounts && discounts.length > 0
    ? discounts.map(d => ({ minBookings: String(d.minBookings), discountPercent: d.discountPercent }))
    : []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = activeRows
        .filter(r => r.minBookings && r.discountPercent)
        .map(r => ({ minBookings: parseInt(r.minBookings), discountPercent: r.discountPercent }));
      await apiRequest("PUT", `/api/programs/${programId}/discounts`, parsed);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", String(programId), "discounts"] });
      toast({ title: "Discounts saved" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateRow = (idx: number, field: string, value: string) => {
    setRows(activeRows.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-white/35">Set multi-booking discounts. Players booking multiple sessions will automatically receive the discount.</p>
      {activeRows.map((r, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div className="flex-1">
            <label className={labelClass}>Min Bookings</label>
            <Input value={r.minBookings} onChange={e => updateRow(idx, "minBookings", e.target.value)} type="number" className={inputClass} data-testid={`input-discount-min-${idx}`} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Discount %</label>
            <Input value={r.discountPercent} onChange={e => updateRow(idx, "discountPercent", e.target.value)} type="number" step="0.01" className={inputClass} data-testid={`input-discount-pct-${idx}`} />
          </div>
          <Button variant="ghost" size="icon" onClick={() => setRows(activeRows.filter((_, i) => i !== idx))} className="mt-5 text-white/25 hover:text-red-400 h-8 w-8">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" onClick={() => setRows([...activeRows, { minBookings: "", discountPercent: "" }])} data-testid="button-add-discount-row" className="text-blue-400 text-[12px]">
        <Plus className="w-3.5 h-3.5 mr-1" /> Add Discount Tier
      </Button>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} className="text-white/45 hover:text-white/60">Cancel</Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-discounts" className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn">
          {saveMutation.isPending ? "Saving..." : "Save Discounts"}
        </Button>
      </div>
    </div>
  );
}

function BookAttendeeModal({ programId, sessions, onClose }: {
  programId: number;
  sessions: ProgramSession[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<number>>(new Set());

  const { data: contacts } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: existingBookings } = useQuery<(SessionBooking & { contact?: Contact; session?: ProgramSession })[]>({
    queryKey: ["/api/programs", String(programId), "bookings"],
  });

  const players = useMemo(() => {
    if (!contacts) return [];
    return contacts.filter(c => c.type === "player");
  }, [contacts]);

  const filtered = useMemo(() => {
    if (!searchTerm) return players.slice(0, 20);
    const term = searchTerm.toLowerCase();
    return players.filter(c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(term)
    ).slice(0, 20);
  }, [players, searchTerm]);

  const selectedContact = players.find(c => c.id === selectedContactId);

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, ProgramSession[]>();
    sessions.forEach(s => {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sessions]);

  const bookingCountBySession = useMemo(() => {
    const map = new Map<number, number>();
    existingBookings?.forEach(b => {
      map.set(b.sessionId, (map.get(b.sessionId) ?? 0) + 1);
    });
    return map;
  }, [existingBookings]);

  const alreadyBooked = useMemo(() => {
    if (!selectedContactId || !existingBookings) return new Set<number>();
    return new Set(existingBookings.filter(b => b.contactId === selectedContactId).map(b => b.sessionId));
  }, [selectedContactId, existingBookings]);

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!selectedContactId || selectedSessions.size === 0) throw new Error("Select a player and sessions");
      const bookings = Array.from(selectedSessions).map(sessionId => ({
        sessionId,
        contactId: selectedContactId,
      }));
      await apiRequest("POST", "/api/session-bookings", bookings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", String(programId), "bookings"] });
      sessions.forEach(s => queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(s.id), "bookings"] }));
      toast({ title: `Booked ${selectedSessions.size} session(s)` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleSession = (id: number) => {
    setSelectedSessions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400/30" />
        <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search players..." data-testid="input-search-players" className={inputClass + " pl-9"} />
      </div>

      {!selectedContactId ? (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {filtered.map(c => (
            <button key={c.id} onClick={() => { setSelectedContactId(c.id); setSelectedSessions(new Set()); }} data-testid={`button-select-player-${c.id}`} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-blue-500/[0.08] transition-colors text-left">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <span className="text-blue-400/70 text-[10px] font-semibold">{c.firstName[0]}{c.lastName[0]}</span>
              </div>
              <div>
                <p className="text-[13px] text-white/65 font-medium">{c.firstName} {c.lastName}</p>
                {c.dateOfBirth && <p className="text-[10px] text-white/25">DOB: {c.dateOfBirth}</p>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-[12px] text-white/25 text-center py-4">No players found</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-blue-500/[0.06] border border-blue-500/[0.1]">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <span className="text-blue-400/70 text-[10px] font-semibold">{selectedContact?.firstName[0]}{selectedContact?.lastName[0]}</span>
            </div>
            <p className="text-[13px] text-white/65 font-medium flex-1">{selectedContact?.firstName} {selectedContact?.lastName}</p>
            <Button variant="ghost" size="icon" onClick={() => { setSelectedContactId(null); setSelectedSessions(new Set()); }} className="h-6 w-6 text-white/25 hover:text-white/50">
              <X className="w-3 h-3" />
            </Button>
          </div>

          <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-medium">Select Sessions</p>
          <div className="space-y-3">
            {sessionsByDate.map(([date, dateSessions]) => (
              <div key={date} className="rounded-xl border border-blue-500/[0.08] overflow-hidden">
                <div className="px-3 py-2 bg-blue-500/[0.04] border-b border-blue-500/[0.06]">
                  <span className="text-[12px] font-medium text-white/50">{formatDate(date)}</span>
                </div>
                <div className="divide-y divide-blue-500/[0.04]">
                  {dateSessions.map(s => {
                    const booked = alreadyBooked.has(s.id);
                    const count = bookingCountBySession.get(s.id) ?? 0;
                    const full = s.capacity ? count >= s.capacity : false;
                    const disabled = booked || full;
                    const checked = selectedSessions.has(s.id);
                    return (
                      <label key={s.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${disabled ? "opacity-40" : "hover:bg-blue-500/[0.04]"}`}>
                        <Checkbox checked={checked} onCheckedChange={() => !disabled && toggleSession(s.id)} disabled={disabled} data-testid={`checkbox-session-${s.id}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-white/60">{s.name}</p>
                          <p className="text-[10px] text-white/25">{s.startTime}–{s.endTime} {s.venue && `· ${s.venue}`}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-white/30">{count}/{s.capacity ?? "∞"}</p>
                          {booked && <p className="text-[9px] text-amber-400">Already booked</p>}
                          {full && !booked && <p className="text-[9px] text-red-400">Full</p>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} className="text-white/45 hover:text-white/60">Cancel</Button>
        <Button onClick={() => bookMutation.mutate()} disabled={bookMutation.isPending || !selectedContactId || selectedSessions.size === 0} data-testid="button-confirm-booking" className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn">
          {bookMutation.isPending ? "Booking..." : `Book ${selectedSessions.size} Session(s)`}
        </Button>
      </div>
    </div>
  );
}

function AttendanceRow({ booking, sessionId, programId }: {
  booking: SessionBooking & { contact?: Contact };
  sessionId: number;
  programId: string;
}) {
  const { toast } = useToast();
  const [localNotes, setLocalNotes] = useState(booking.notes ?? "");
  const notesTimerRef = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PATCH", `/api/session-bookings/${booking.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "bookings"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/session-bookings/${booking.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/programs", programId, "bookings"] });
      toast({ title: "Booking removed" });
    },
  });

  const handleNotesChange = (value: string) => {
    setLocalNotes(value);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      updateMutation.mutate({ notes: value });
    }, 600);
  };

  return (
    <div className="flex items-center gap-3 px-5 py-2.5" data-testid={`row-attendance-${booking.id}`}>
      <div className="w-7 h-7 rounded-lg bg-blue-500/8 border border-blue-500/15 flex items-center justify-center">
        <span className="text-blue-400/70 text-[10px] font-semibold">{booking.contact?.firstName?.[0]}{booking.contact?.lastName?.[0]}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-white/65">{booking.contact?.firstName} {booking.contact?.lastName}</p>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <Checkbox checked={booking.paid ?? false} onCheckedChange={(v) => updateMutation.mutate({ paid: v })} data-testid={`checkbox-paid-${booking.id}`} />
          <span className="text-[11px] text-white/35">Paid</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <Checkbox checked={booking.attended ?? false} onCheckedChange={(v) => updateMutation.mutate({ attended: v })} data-testid={`checkbox-attended-${booking.id}`} />
          <span className="text-[11px] text-white/35">Attended</span>
        </label>
        <Input
          value={localNotes}
          placeholder="Notes"
          onChange={e => handleNotesChange(e.target.value)}
          className="premium-input text-white/60 rounded-lg text-[11px] w-32 h-7"
          data-testid={`input-notes-${booking.id}`}
        />
        <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate()} className="h-6 w-6 text-white/20 hover:text-red-400">
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function SessionAttendance({ session, programId }: { session: ProgramSession; programId: string }) {
  const { data: bookings, isLoading } = useQuery<(SessionBooking & { contact?: Contact })[]>({
    queryKey: ["/api/sessions", String(session.id), "bookings"],
  });

  if (isLoading) return <Skeleton className="h-20 w-full bg-blue-500/[0.04]" />;

  return (
    <div className="rounded-2xl glass-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-blue-500/[0.08]">
        <div>
          <h4 className="text-[13px] font-semibold text-white/65">{session.name}</h4>
          <p className="text-[11px] text-white/25">{session.startTime}–{session.endTime} {session.venue && `· ${session.venue}`} {session.rollTaker && `· Roll: ${session.rollTaker}`}</p>
        </div>
        <span className="text-[10px] text-white/30 px-2 py-0.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.08]">
          {bookings?.length ?? 0}/{session.capacity ?? "∞"}
        </span>
      </div>
      {bookings && bookings.length > 0 ? (
        <div className="divide-y divide-blue-500/[0.04]">
          {bookings.map(b => (
            <AttendanceRow key={b.id} booking={b} sessionId={session.id} programId={programId} />
          ))}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-[12px] text-white/25">No bookings for this session</p>
        </div>
      )}
    </div>
  );
}

function ProgramReport({ programId, onBack }: { programId: string; onBack: () => void }) {
  const [sessionFilter, setSessionFilter] = useState<string>("");

  const { data: report, isLoading } = useQuery<any>({
    queryKey: ["/api/programs", programId, "report", sessionFilter],
    queryFn: async () => {
      const url = sessionFilter
        ? `/api/programs/${programId}/report?sessionId=${sessionFilter}`
        : `/api/programs/${programId}/report`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const downloadCSV = () => {
    if (!report) return;
    const headers = ["Name", "Email", "Phone", "Total Bookings", "Attended", "Sessions"];
    const rows = report.attendees.map((a: any) => [
      `${a.contact.firstName} ${a.contact.lastName}`,
      a.contact.email ?? "",
      a.contact.phone ?? "",
      a.totalBookings,
      a.attended,
      a.sessions.map((s: any) => `${s.sessionName} (${s.sessionDate})`).join("; "),
    ]);
    const csv = [headers.join(","), ...rows.map((r: any[]) => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.program.name}_report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="p-8"><Skeleton className="h-48 w-full bg-blue-500/[0.04]" /></div>;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-report-back" className="text-white/30 hover:text-white/50 transition-colors duration-300 rounded-xl">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-white">Programme Report</h2>
          <p className="text-[12px] text-white/35">{report?.program?.name}</p>
        </div>
        <Button onClick={downloadCSV} data-testid="button-download-csv" className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 rounded-xl text-[13px]">
          <Download className="w-4 h-4 mr-2" /> Export CSV
        </Button>
      </div>

      <div className="flex items-center gap-3 animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
        <label className={labelClass}>Filter by session:</label>
        <Select value={sessionFilter} onValueChange={v => setSessionFilter(v === "all" ? "" : v)}>
          <SelectTrigger className={inputClass + " w-64"} data-testid="select-report-session">
            <SelectValue placeholder="All sessions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sessions</SelectItem>
            {report?.sessions?.map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name} — {formatDate(s.date)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-4 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        <div className="rounded-2xl glass-card p-4">
          <p className="text-[10px] text-blue-300/25 uppercase tracking-wider">Total Attendees</p>
          <p className="text-xl font-semibold text-white/75 mt-1">{report?.attendees?.length ?? 0}</p>
        </div>
        <div className="rounded-2xl glass-card p-4">
          <p className="text-[10px] text-blue-300/25 uppercase tracking-wider">Total Bookings</p>
          <p className="text-xl font-semibold text-white/75 mt-1">{report?.totalBookings ?? 0}</p>
        </div>
        <div className="rounded-2xl glass-card p-4">
          <p className="text-[10px] text-blue-300/25 uppercase tracking-wider">Registrations</p>
          <p className="text-xl font-semibold text-white/75 mt-1">{report?.totalRegistrations ?? 0}</p>
        </div>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '150ms', opacity: 0 }}>
        <div className="px-5 py-3 border-b border-blue-500/[0.08]">
          <h3 className="text-[13px] font-semibold text-white/65">Attendees</h3>
        </div>
        {report?.attendees?.length > 0 ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {report.attendees.map((a: any, idx: number) => (
              <div key={idx} className="flex items-center gap-3 px-5 py-3" data-testid={`row-report-attendee-${idx}`}>
                <div className="w-8 h-8 rounded-xl bg-blue-500/8 border border-blue-500/15 flex items-center justify-center">
                  <span className="text-blue-400/70 text-[11px] font-semibold">{a.contact.firstName[0]}{a.contact.lastName[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white/65">{a.contact.firstName} {a.contact.lastName}</p>
                  <p className="text-[11px] text-white/25">{a.contact.email} {a.contact.phone && `· ${a.contact.phone}`}</p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-white/50">{a.attended}/{a.totalBookings} attended</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-10 text-center">
            <p className="text-[13px] text-white/25">No attendees to show</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgramDetail({ id }: { id: string }) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"sessions" | "attendance" | "registrations">("sessions");
  const [showAddDate, setShowAddDate] = useState(false);
  const [showEditSessions, setShowEditSessions] = useState(false);
  const [showBookAttendee, setShowBookAttendee] = useState(false);
  const [showDiscounts, setShowDiscounts] = useState(false);
  const [showEditProgram, setShowEditProgram] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [attendanceDate, setAttendanceDate] = useState<string | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set([1]));

  const { data: program, isLoading } = useQuery<Program>({
    queryKey: ["/api/programs", id],
  });

  const { data: sessions } = useQuery<ProgramSession[]>({
    queryKey: ["/api/programs", id, "sessions"],
  });

  const { data: registrations } = useQuery<(Registration & { contact?: Contact })[]>({
    queryKey: ["/api/programs", id, "registrations"],
  });

  const { data: allBookings } = useQuery<(SessionBooking & { contact?: Contact; session?: ProgramSession })[]>({
    queryKey: ["/api/programs", id, "bookings"],
  });

  const { toast } = useToast();

  const sessionsByDate = useMemo(() => {
    if (!sessions) return [];
    const map = new Map<string, ProgramSession[]>();
    sessions.forEach(s => {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sessions]);

  const sessionTemplates = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const names = [...new Set(sessions.map(s => s.name))];
    return names.map(name => {
      const sample = sessions.find(s => s.name === name)!;
      return {
        name,
        startTime: sample.startTime ?? "",
        endTime: sample.endTime ?? "",
        venue: sample.venue ?? "",
        rollTaker: sample.rollTaker ?? "",
        cost: sample.cost ?? "",
        capacity: sample.capacity,
      };
    });
  }, [sessions]);

  const weekGroups = useMemo(() => {
    if (sessionsByDate.length === 0) return [];
    const firstDate = sessionsByDate[0][0];
    const groups = new Map<number, [string, ProgramSession[]][]>();
    sessionsByDate.forEach(entry => {
      const week = getWeekNumber(entry[0], firstDate);
      if (!groups.has(week)) groups.set(week, []);
      groups.get(week)!.push(entry);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [sessionsByDate]);

  const bookingCountBySession = useMemo(() => {
    const map = new Map<number, number>();
    allBookings?.forEach(b => {
      map.set(b.sessionId, (map.get(b.sessionId) ?? 0) + 1);
    });
    return map;
  }, [allBookings]);

  const deleteDateMutation = useMutation({
    mutationFn: async (date: string) => {
      await apiRequest("DELETE", `/api/programs/${id}/sessions/date/${date}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs", id, "sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/programs", id, "bookings"] });
      toast({ title: "Date removed" });
    },
  });

  const toggleWeek = (week: number) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week); else next.add(week);
      return next;
    });
  };

  if (showReport) {
    return <ProgramReport programId={id} onBack={() => setShowReport(false)} />;
  }

  if (isLoading) {
    return (
      <div className="p-8 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64 bg-blue-500/[0.04]" />
        <Skeleton className="h-48 w-full bg-blue-500/[0.04]" />
      </div>
    );
  }

  if (!program) {
    return (
      <div className="p-8 text-center">
        <p className="text-white/35">Programme not found</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <Button variant="ghost" size="icon" onClick={() => setLocation("/programs")} data-testid="button-back" className="text-white/30 hover:text-white/50 transition-colors duration-300 rounded-xl">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-white" data-testid="text-program-name">{program.name}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] text-white/35 capitalize px-2.5 py-0.5 rounded-lg bg-blue-500/[0.04] border border-blue-500/[0.08]">
              {program.type.replace("_", " ")}
            </span>
            <span className={`text-[10px] px-2.5 py-0.5 rounded-lg border ${
              program.isActive
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.08)]"
                : "text-white/25 bg-blue-500/[0.04] border-blue-500/[0.08]"
            }`}>
              {program.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setShowEditProgram(true)} data-testid="button-edit-program" className="text-white/30 hover:text-white/50 rounded-xl h-8 w-8">
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button onClick={() => setShowReport(true)} data-testid="button-view-report" className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 rounded-xl text-[12px] h-8">
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl glass-card p-4 animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-[0_0_10px_rgba(3,86,197,0.08)]">
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-[10px] text-blue-300/25 uppercase tracking-wider">Dates</p>
              <p className="text-[13px] font-medium text-white/65">{program.startDate && program.endDate ? `${formatDate(program.startDate)} — ${formatDate(program.endDate)}` : "TBD"}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl glass-card p-4 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.08)]">
              <Users className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] text-blue-300/25 uppercase tracking-wider">Sessions</p>
              <p className="text-[13px] font-medium text-white/65">{sessions?.length ?? 0} sessions</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl glass-card p-4 animate-fade-in-up" style={{ animationDelay: '150ms', opacity: 0 }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-[0_0_10px_rgba(245,158,11,0.08)]">
              <DollarSign className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-[10px] text-blue-300/25 uppercase tracking-wider">Fee</p>
              <p className="text-[13px] font-medium text-white/65">{program.fee ? `$${program.fee}` : "Free"}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl glass-card p-4 animate-fade-in-up" style={{ animationDelay: '200ms', opacity: 0 }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shadow-[0_0_10px_rgba(139,92,246,0.08)]">
              <UserCheck className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-[10px] text-blue-300/25 uppercase tracking-wider">Bookings</p>
              <p className="text-[13px] font-medium text-white/65">{allBookings?.length ?? 0} bookings</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-blue-500/[0.08] animate-fade-in-up" style={{ animationDelay: '250ms', opacity: 0 }}>
        {(["sessions", "attendance", "registrations"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} data-testid={`tab-${tab}`} className={`px-4 py-2.5 text-[13px] font-medium capitalize transition-colors border-b-2 ${
            activeTab === tab
              ? "text-blue-400 border-blue-400"
              : "text-white/35 border-transparent hover:text-white/50"
          }`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "sessions" && (
        <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '300ms', opacity: 0 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => setShowAddDate(true)} data-testid="button-add-date" className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-8 text-[12px] glow-btn">
              <CalendarPlus className="w-3.5 h-3.5 mr-1.5" /> Add Date
            </Button>
            {sessions && sessions.length > 0 && (
              <>
                <Button onClick={() => setShowEditSessions(true)} data-testid="button-edit-sessions" className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 rounded-xl h-8 text-[12px]">
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit Sessions
                </Button>
                <Button onClick={() => setShowBookAttendee(true)} data-testid="button-book-attendee" className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 rounded-xl h-8 text-[12px]">
                  <UserCheck className="w-3.5 h-3.5 mr-1.5" /> Book Attendee
                </Button>
                <Button onClick={() => setShowDiscounts(true)} data-testid="button-discounts" className="bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 rounded-xl h-8 text-[12px]">
                  <Percent className="w-3.5 h-3.5 mr-1.5" /> Discounts
                </Button>
              </>
            )}
          </div>

          {weekGroups.length > 0 ? (
            <div className="space-y-3">
              {weekGroups.map(([week, dates]) => (
                <div key={week} className="rounded-2xl glass-card overflow-hidden">
                  <button onClick={() => toggleWeek(week)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-blue-500/[0.04] transition-colors" data-testid={`button-toggle-week-${week}`}>
                    <span className="text-[13px] font-semibold text-white/55">Week {week}</span>
                    {expandedWeeks.has(week) ? <ChevronDown className="w-4 h-4 text-white/25" /> : <ChevronRight className="w-4 h-4 text-white/25" />}
                  </button>
                  {expandedWeeks.has(week) && (
                    <div className="border-t border-blue-500/[0.06]">
                      {dates.map(([date, dateSessions]) => (
                        <div key={date} className="border-b border-blue-500/[0.04] last:border-0">
                          <div className="flex items-center justify-between px-5 py-2.5 bg-blue-500/[0.02]">
                            <span className="text-[12px] font-medium text-white/45">{formatDateFull(date)}</span>
                            <Button variant="ghost" size="icon" onClick={() => deleteDateMutation.mutate(date)} data-testid={`button-delete-date-${date}`} className="h-6 w-6 text-white/15 hover:text-red-400">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                          <div className="divide-y divide-blue-500/[0.04]">
                            {dateSessions.map(s => {
                              const count = bookingCountBySession.get(s.id) ?? 0;
                              return (
                                <div key={s.id} className="flex items-center gap-4 px-5 py-2.5 pl-8 row-hover" data-testid={`row-session-${s.id}`}>
                                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/15 flex items-center justify-center">
                                    <Clock className="w-3.5 h-3.5 text-blue-400/50" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium text-white/60">{s.name}</p>
                                    <p className="text-[11px] text-white/25">
                                      {s.startTime}–{s.endTime}
                                      {s.venue && ` · ${s.venue}`}
                                      {s.rollTaker && ` · Roll: ${s.rollTaker}`}
                                    </p>
                                  </div>
                                  {s.cost && <span className="text-[12px] text-amber-400/60">${s.cost}</span>}
                                  <span className={`text-[11px] px-2 py-0.5 rounded-lg border ${
                                    s.capacity && count >= s.capacity
                                      ? "text-red-400 bg-red-500/10 border-red-500/20"
                                      : "text-white/30 bg-blue-500/[0.04] border-blue-500/[0.08]"
                                  }`}>
                                    {count}/{s.capacity ?? "∞"}
                                  </span>
                                  <Button variant="ghost" size="sm" onClick={() => { setActiveTab("attendance"); setAttendanceDate(date); }} data-testid={`button-view-attendance-${s.id}`} className="text-[11px] text-blue-400/60 hover:text-blue-400 h-7">
                                    <Eye className="w-3 h-3 mr-1" /> Roll
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl glass-card py-14 text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-500/[0.04] border border-blue-500/[0.1] flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-5 h-5 text-blue-400/15" />
              </div>
              <p className="text-[13px] text-white/35">No sessions yet</p>
              <p className="text-[11px] text-white/20 mt-1">Add dates to create session slots</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "attendance" && (
        <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '300ms', opacity: 0 }}>
          <div className="flex items-center gap-3">
            <label className={labelClass}>Date:</label>
            <Select value={attendanceDate ?? ""} onValueChange={v => setAttendanceDate(v)}>
              <SelectTrigger className={inputClass + " w-64"} data-testid="select-attendance-date">
                <SelectValue placeholder="Select date" />
              </SelectTrigger>
              <SelectContent>
                {sessionsByDate.map(([date]) => (
                  <SelectItem key={date} value={date}>{formatDateFull(date)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {attendanceDate ? (
            <div className="space-y-4">
              {(sessions ?? []).filter(s => s.date === attendanceDate).map(s => (
                <SessionAttendance key={s.id} session={s} programId={id} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl glass-card py-14 text-center">
              <p className="text-[13px] text-white/35">Select a date to view attendance</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "registrations" && (
        <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '300ms', opacity: 0 }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
            <h3 className="text-[14px] font-semibold text-white/75">
              Registered Players ({registrations?.length ?? 0})
            </h3>
          </div>
          {registrations && registrations.length > 0 ? (
            <div className="divide-y divide-blue-500/[0.04]">
              {registrations.map((reg) => (
                <div key={reg.id} className="flex items-center gap-3 px-5 py-3 row-hover" data-testid={`row-registration-${reg.id}`}>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/8 border border-blue-500/15 flex items-center justify-center">
                    <span className="text-blue-400/70 text-[11px] font-semibold">{reg.contact?.firstName?.[0]}{reg.contact?.lastName?.[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/65">{reg.contact?.firstName} {reg.contact?.lastName}</p>
                    <p className="text-[11px] text-white/25">Registered {new Date(reg.registeredAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-[10px] font-medium capitalize px-2.5 py-0.5 rounded-lg border ${
                    reg.status === "confirmed" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                    : reg.status === "pending" ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                    : "text-white/35 bg-blue-500/[0.04] border-blue-500/[0.08]"
                  }`}>
                    {reg.status}
                  </span>
                  {reg.amountPaid && <span className="text-[13px] text-white/35">${reg.amountPaid}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-500/[0.04] border border-blue-500/[0.1] flex items-center justify-center mb-4">
                <ClipboardCheck className="w-5 h-5 text-blue-400/15" />
              </div>
              <p className="text-[13px] text-white/35">No registrations yet</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={showAddDate} onOpenChange={setShowAddDate}>
        <DialogContent className="glass-card border-blue-500/20 max-w-md">
          <DialogHeader><DialogTitle className="text-white/80">Add Dates</DialogTitle></DialogHeader>
          <AddDateModal
            programId={parseInt(id)}
            existingDates={sessionsByDate.map(([d]) => d)}
            sessionTemplates={sessionTemplates}
            onClose={() => setShowAddDate(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showEditSessions} onOpenChange={setShowEditSessions}>
        <DialogContent className="glass-card border-blue-500/20 max-w-lg">
          <DialogHeader><DialogTitle className="text-white/80">Edit Sessions</DialogTitle></DialogHeader>
          {sessions && <EditSessionsModal programId={parseInt(id)} sessions={sessions} onClose={() => setShowEditSessions(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={showBookAttendee} onOpenChange={setShowBookAttendee}>
        <DialogContent className="glass-card border-blue-500/20 max-w-lg">
          <DialogHeader><DialogTitle className="text-white/80">Book Attendee</DialogTitle></DialogHeader>
          {sessions && <BookAttendeeModal programId={parseInt(id)} sessions={sessions} onClose={() => setShowBookAttendee(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={showDiscounts} onOpenChange={setShowDiscounts}>
        <DialogContent className="glass-card border-blue-500/20 max-w-md">
          <DialogHeader><DialogTitle className="text-white/80">Multi-Booking Discounts</DialogTitle></DialogHeader>
          <DiscountsModal programId={parseInt(id)} onClose={() => setShowDiscounts(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showEditProgram} onOpenChange={setShowEditProgram}>
        <DialogContent className="glass-card border-blue-500/20 max-w-lg">
          <DialogHeader><DialogTitle className="text-white/80">Edit Programme</DialogTitle></DialogHeader>
          <ProgramForm onClose={() => { setShowEditProgram(false); queryClient.invalidateQueries({ queryKey: ["/api/programs", id] }); }} editProgram={program} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ProgramsPage() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [, params] = useRoute("/programs/:id");

  const { data: programs, isLoading } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
  });

  if (params?.id) {
    return <ProgramDetail id={params.id} />;
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Programmes</h1>
          <p className="text-blue-400/35 text-[13px] mt-1">Manage holiday camps, academies, trials, and events</p>
        </div>
        <Button onClick={() => setShowNewDialog(true)} data-testid="button-new-program" className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-9 text-[13px] font-medium glow-btn">
          <Plus className="w-4 h-4 mr-2" /> New Programme
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl glass-card p-5"><Skeleton className="h-28 w-full bg-blue-500/[0.04]" /></div>
          ))}
        </div>
      ) : programs && programs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {programs.map((program, index) => (
            <Link key={program.id} href={`/programs/${program.id}`}>
              <div className="rounded-2xl glass-card p-5 cursor-pointer hover:border-blue-500/25 transition-all duration-300 h-full group hover:scale-[1.01] animate-fade-in-up" data-testid={`card-program-${program.id}`} style={{ animationDelay: `${50 + index * 50}ms`, opacity: 0 }}>
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:shadow-[0_0_12px_rgba(3,86,197,0.15)] transition-shadow duration-300">
                    <GraduationCap className="w-4 h-4 text-blue-400" />
                  </div>
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-lg border ${
                    program.isActive
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                      : "text-white/25 bg-blue-500/[0.04] border-blue-500/[0.08]"
                  }`}>
                    {program.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <h3 className="font-semibold text-[14px] text-white/75 mb-1.5 line-clamp-2 group-hover:text-white transition-colors duration-300">{program.name}</h3>
                <span className="text-[10px] text-blue-300/30 capitalize px-2 py-0.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.08] inline-block mb-3">
                  {program.type.replace("_", " ")}
                </span>
                <div className="space-y-2 mt-2">
                  {program.startDate && (
                    <div className="flex items-center gap-2 text-[12px] text-white/30">
                      <Calendar className="w-3 h-3 text-blue-400/30" />
                      <span>{program.startDate} — {program.endDate}</span>
                    </div>
                  )}
                  {program.bookingsOpenDate && (
                    <div className="flex items-center gap-2 text-[12px] text-white/30">
                      <UserCheck className="w-3 h-3 text-emerald-400/30" />
                      <span>Bookings: {program.bookingsOpenDate}</span>
                    </div>
                  )}
                  {program.location && (
                    <div className="flex items-center gap-2 text-[12px] text-white/30">
                      <MapPin className="w-3 h-3 text-blue-400/30" />
                      <span>{program.location}</span>
                    </div>
                  )}
                  {program.fee && (
                    <div className="flex items-center gap-2 text-[12px] text-white/30">
                      <DollarSign className="w-3 h-3 text-blue-400/30" />
                      <span>${program.fee}</span>
                    </div>
                  )}
                  {program.capacity && (
                    <div className="flex items-center gap-2 text-[12px] text-white/30">
                      <Users className="w-3 h-3 text-blue-400/30" />
                      <span>Capacity: {program.capacity}</span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl glass-card">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/[0.04] border border-blue-500/[0.1] flex items-center justify-center mb-5">
              <GraduationCap className="w-6 h-6 text-blue-400/15" />
            </div>
            <p className="text-[14px] font-medium text-white/45">No programmes yet</p>
            <p className="text-[12px] text-white/25 mt-1.5 mb-5">Create your first programme to start taking registrations</p>
            <Button size="sm" onClick={() => setShowNewDialog(true)} className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn">
              <Plus className="w-4 h-4 mr-2" /> Create Programme
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="glass-card border-blue-500/20 max-w-lg">
          <DialogHeader><DialogTitle className="text-white/80">New Programme</DialogTitle></DialogHeader>
          <ProgramForm onClose={() => setShowNewDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
