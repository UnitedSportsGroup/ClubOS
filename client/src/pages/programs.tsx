import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProgramSchema } from "@shared/schema";
import type { Program, Registration, Contact } from "@shared/schema";
import { z } from "zod";

const programFormSchema = insertProgramSchema.extend({
  name: z.string().min(1, "Programme name is required"),
  type: z.enum(["holiday_camp", "academy", "trials", "event"]),
});

type ProgramFormValues = z.infer<typeof programFormSchema>;

function ProgramForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const form = useForm<ProgramFormValues>({
    resolver: zodResolver(programFormSchema),
    defaultValues: {
      name: "",
      type: "holiday_camp",
      description: "",
      location: "",
      startDate: "",
      endDate: "",
      capacity: undefined,
      ageMin: undefined,
      ageMax: undefined,
      fee: "",
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ProgramFormValues) => {
      const cleaned = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, v === "" ? null : v])
      );
      const res = await apiRequest("POST", "/api/programs", cleaned);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Programme created successfully" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error creating programme", description: error.message, variant: "destructive" });
    },
  });

  const inputClass = "bg-white/[0.04] border-white/[0.08] text-white/80 placeholder:text-white/25 focus:border-blue-500/40 focus:bg-white/[0.06] rounded-lg text-[13px]";
  const labelClass = "text-[12px] text-white/50 font-medium";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Programme Name *</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-program-name" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-program-type" className={inputClass}>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="holiday_camp">Holiday Camp</SelectItem>
                    <SelectItem value="academy">Academy</SelectItem>
                    <SelectItem value="trials">Trials</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fee"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Fee ($)</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="number" step="0.01" data-testid="input-fee" className={inputClass} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Description</FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} data-testid="input-description" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Location</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} data-testid="input-location" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Start Date</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="date" data-testid="input-start-date" className={inputClass} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>End Date</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="date" data-testid="input-end-date" className={inputClass} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField
            control={form.control}
            name="capacity"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Capacity</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    data-testid="input-capacity"
                    className={inputClass}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ageMin"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Min Age</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    data-testid="input-age-min"
                    className={inputClass}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ageMax"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={labelClass}>Max Age</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    data-testid="input-age-max"
                    className={inputClass}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} data-testid="button-cancel" className="text-white/50">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending}
            data-testid="button-save-program"
            className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg shadow-lg shadow-blue-500/20"
          >
            {createMutation.isPending ? "Saving..." : "Save Programme"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ProgramDetail({ id }: { id: string }) {
  const [, setLocation] = useLocation();

  const { data: program, isLoading } = useQuery<Program>({
    queryKey: ["/api/programs", id],
  });

  const { data: registrations } = useQuery<(Registration & { contact?: Contact })[]>({
    queryKey: ["/api/programs", id, "registrations"],
  });

  if (isLoading) {
    return (
      <div className="p-8 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-64 bg-white/[0.04]" />
        <Skeleton className="h-48 w-full bg-white/[0.04]" />
      </div>
    );
  }

  if (!program) {
    return (
      <div className="p-8 text-center">
        <p className="text-white/40">Programme not found</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/programs")} data-testid="button-back" className="text-white/40 hover:text-white/60">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-white" data-testid="text-program-name">{program.name}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] text-white/40 capitalize px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
              {program.type.replace("_", " ")}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-md border ${
              program.isActive 
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                : "text-white/30 bg-white/[0.04] border-white/[0.06]"
            }`}>
              {program.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-[11px] text-white/30">Dates</p>
              <p className="text-[13px] font-medium text-white/70">
                {program.startDate && program.endDate ? `${program.startDate} — ${program.endDate}` : "TBD"}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Users className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-[11px] text-white/30">Capacity</p>
              <p className="text-[13px] font-medium text-white/70">
                {registrations?.length ?? 0} / {program.capacity ?? "Unlimited"}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-[11px] text-white/30">Fee</p>
              <p className="text-[13px] font-medium text-white/70">
                {program.fee ? `$${program.fee}` : "Free"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {program.description && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-[13px] font-semibold text-white/70">Description</h3>
          </div>
          <div className="p-5">
            <p className="text-[13px] text-white/60 whitespace-pre-wrap">{program.description}</p>
          </div>
        </div>
      )}

      {program.location && (
        <div className="flex items-center gap-2 text-[13px] text-white/40">
          <MapPin className="w-4 h-4" />
          <span>{program.location}</span>
        </div>
      )}

      {(program.ageMin !== null || program.ageMax !== null) && (
        <p className="text-[13px] text-white/40">
          Age range: {program.ageMin ?? 0} — {program.ageMax ?? "No limit"}
        </p>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[14px] font-semibold text-white/80">
            Registered Players ({registrations?.length ?? 0})
          </h3>
        </div>
        {registrations && registrations.length > 0 ? (
          <div className="divide-y divide-white/[0.04]">
            {registrations.map((reg) => (
              <div
                key={reg.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                data-testid={`row-registration-${reg.id}`}
              >
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <span className="text-blue-400 text-[11px] font-semibold">
                    {reg.contact?.firstName?.[0]}{reg.contact?.lastName?.[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white/70">
                    {reg.contact?.firstName} {reg.contact?.lastName}
                  </p>
                  <p className="text-[11px] text-white/30">
                    Registered {new Date(reg.registeredAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-[10px] font-medium capitalize px-2 py-0.5 rounded-md border ${
                  reg.status === "confirmed" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                  : reg.status === "pending" ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                  : "text-white/40 bg-white/[0.04] border-white/[0.06]"
                }`}>
                  {reg.status}
                </span>
                {reg.amountPaid && (
                  <span className="text-[13px] text-white/40">${reg.amountPaid}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-4">
              <ClipboardCheck className="w-5 h-5 text-white/15" />
            </div>
            <p className="text-[13px] text-white/40">No registrations yet</p>
          </div>
        )}
      </div>
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Programmes</h1>
          <p className="text-white/40 text-[13px] mt-1">
            Manage holiday camps, academies, trials, and events
          </p>
        </div>
        <Button
          onClick={() => setShowNewDialog(true)}
          data-testid="button-new-program"
          className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg h-9 text-[13px] font-medium shadow-lg shadow-blue-500/20"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Programme
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <Skeleton className="h-28 w-full bg-white/[0.04]" />
            </div>
          ))}
        </div>
      ) : programs && programs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {programs.map((program) => (
            <Link key={program.id} href={`/programs/${program.id}`}>
              <div
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 cursor-pointer hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-200 h-full group"
                data-testid={`card-program-${program.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <GraduationCap className="w-4 h-4 text-blue-400" />
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md border ${
                    program.isActive
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                      : "text-white/30 bg-white/[0.04] border-white/[0.06]"
                  }`}>
                    {program.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <h3 className="font-semibold text-[14px] text-white/80 mb-1.5 line-clamp-2 group-hover:text-white transition-colors">{program.name}</h3>
                <span className="text-[10px] text-white/30 capitalize px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] inline-block mb-3">
                  {program.type.replace("_", " ")}
                </span>
                <div className="space-y-2 mt-2">
                  {program.startDate && (
                    <div className="flex items-center gap-2 text-[12px] text-white/35">
                      <Calendar className="w-3 h-3" />
                      <span>{program.startDate} — {program.endDate}</span>
                    </div>
                  )}
                  {program.location && (
                    <div className="flex items-center gap-2 text-[12px] text-white/35">
                      <MapPin className="w-3 h-3" />
                      <span>{program.location}</span>
                    </div>
                  )}
                  {program.fee && (
                    <div className="flex items-center gap-2 text-[12px] text-white/35">
                      <DollarSign className="w-3 h-3" />
                      <span>${program.fee}</span>
                    </div>
                  )}
                  {program.capacity && (
                    <div className="flex items-center gap-2 text-[12px] text-white/35">
                      <Users className="w-3 h-3" />
                      <span>Capacity: {program.capacity}</span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-5">
              <GraduationCap className="w-6 h-6 text-white/20" />
            </div>
            <p className="text-[14px] font-medium text-white/50">No programmes yet</p>
            <p className="text-[12px] text-white/25 mt-1.5 mb-5">
              Create your first programme to start taking registrations
            </p>
            <Button
              size="sm"
              onClick={() => setShowNewDialog(true)}
              className="bg-blue-500 hover:bg-blue-600 text-white border-0 rounded-lg"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Programme
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-[hsl(225,14%,9%)] border-white/[0.08]">
          <DialogHeader>
            <DialogTitle className="text-white/90">New Programme</DialogTitle>
          </DialogHeader>
          <ProgramForm onClose={() => setShowNewDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
