import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Programme Name *</FormLabel>
              <FormControl>
                <Input {...field} data-testid="input-program-name" />
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
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-program-type">
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
                <FormLabel>Fee ($)</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="number" step="0.01" data-testid="input-fee" />
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
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} data-testid="input-description" />
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
              <FormLabel>Location</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} data-testid="input-location" />
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
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="date" data-testid="input-start-date" />
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
                <FormLabel>End Date</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} type="date" data-testid="input-end-date" />
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
                <FormLabel>Capacity</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    data-testid="input-capacity"
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
                <FormLabel>Min Age</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    data-testid="input-age-min"
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
                <FormLabel>Max Age</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    data-testid="input-age-max"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-program">
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
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!program) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Programme not found</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/programs")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold" data-testid="text-program-name">{program.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="secondary" className="capitalize">
              {program.type.replace("_", " ")}
            </Badge>
            <Badge variant={program.isActive ? "default" : "secondary"}>
              {program.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Calendar className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dates</p>
                <p className="text-sm font-medium">
                  {program.startDate && program.endDate
                    ? `${program.startDate} — ${program.endDate}`
                    : "TBD"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-emerald-100 dark:bg-emerald-900/30">
                <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Capacity</p>
                <p className="text-sm font-medium">
                  {registrations?.length ?? 0} / {program.capacity ?? "Unlimited"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-gold/20">
                <DollarSign className="w-4 h-4 text-gold" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fee</p>
                <p className="text-sm font-medium">
                  {program.fee ? `$${program.fee}` : "Free"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {program.description && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{program.description}</p>
          </CardContent>
        </Card>
      )}

      {program.location && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4" />
          <span>{program.location}</span>
        </div>
      )}

      {program.ageMin !== null || program.ageMax !== null ? (
        <p className="text-sm text-muted-foreground">
          Age range: {program.ageMin ?? 0} — {program.ageMax ?? "No limit"}
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 pb-3">
          <CardTitle className="text-sm font-semibold">
            Registered Players ({registrations?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {registrations && registrations.length > 0 ? (
            <div className="divide-y">
              {registrations.map((reg) => (
                <div
                  key={reg.id}
                  className="flex items-center gap-3 px-5 py-3"
                  data-testid={`row-registration-${reg.id}`}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-primary text-xs font-semibold">
                      {reg.contact?.firstName?.[0]}{reg.contact?.lastName?.[0]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {reg.contact?.firstName} {reg.contact?.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Registered {new Date(reg.registeredAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant={reg.status === "confirmed" ? "default" : "secondary"}
                    className="capitalize text-[10px]"
                  >
                    {reg.status}
                  </Badge>
                  {reg.amountPaid && (
                    <span className="text-sm text-muted-foreground">${reg.amountPaid}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <ClipboardCheck className="w-10 h-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No registrations yet</p>
            </div>
          )}
        </CardContent>
      </Card>
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
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Programmes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage holiday camps, academies, trials, and events
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)} data-testid="button-new-program">
          <Plus className="w-4 h-4 mr-2" />
          New Programme
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : programs && programs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {programs.map((program) => (
            <Link key={program.id} href={`/programs/${program.id}`}>
              <Card className="cursor-pointer hover-elevate h-full" data-testid={`card-program-${program.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <GraduationCap className="w-5 h-5 text-primary" />
                    </div>
                    <Badge variant={program.isActive ? "default" : "secondary"} className="text-[10px]">
                      {program.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <h3 className="font-semibold text-sm mb-1 line-clamp-2">{program.name}</h3>
                  <Badge variant="outline" className="capitalize text-[10px] mb-3">
                    {program.type.replace("_", " ")}
                  </Badge>
                  <div className="space-y-1.5 mt-3">
                    {program.startDate && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        <span>{program.startDate} — {program.endDate}</span>
                      </div>
                    )}
                    {program.location && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        <span>{program.location}</span>
                      </div>
                    )}
                    {program.fee && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <DollarSign className="w-3 h-3" />
                        <span>${program.fee}</span>
                      </div>
                    )}
                    {program.capacity && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="w-3 h-3" />
                        <span>Capacity: {program.capacity}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <GraduationCap className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">No programmes yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Create your first programme to start taking registrations
            </p>
            <Button size="sm" onClick={() => setShowNewDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Programme
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Programme</DialogTitle>
          </DialogHeader>
          <ProgramForm onClose={() => setShowNewDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
