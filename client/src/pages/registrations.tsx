import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardCheck, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertRegistrationSchema } from "@shared/schema";
import type { Registration, Contact, Program } from "@shared/schema";
import { z } from "zod";
import { Link } from "wouter";

const regFormSchema = insertRegistrationSchema.extend({
  programId: z.coerce.number().min(1, "Select a programme"),
  contactId: z.coerce.number().min(1, "Select a player"),
});

type RegFormValues = z.infer<typeof regFormSchema>;

function RegistrationForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: programs } = useQuery<Program[]>({ queryKey: ["/api/programs"] });
  const { data: contacts } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  const players = contacts?.filter((c) => c.type === "player") ?? [];

  const form = useForm<RegFormValues>({
    resolver: zodResolver(regFormSchema),
    defaultValues: {
      programId: 0,
      contactId: 0,
      guardianId: undefined,
      status: "pending",
      amountPaid: "0",
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: RegFormValues) => {
      const res = await apiRequest("POST", "/api/registrations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Registration created" });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="programId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Programme *</FormLabel>
              <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                <FormControl>
                  <SelectTrigger data-testid="select-reg-program">
                    <SelectValue placeholder="Select programme" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {programs?.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="contactId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Player *</FormLabel>
              <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                <FormControl>
                  <SelectTrigger data-testid="select-reg-player">
                    <SelectValue placeholder="Select player" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {players.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? "pending"}>
                <FormControl>
                  <SelectTrigger data-testid="select-reg-status">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="waitlisted">Waitlisted</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} data-testid="input-reg-notes" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-reg">
            {createMutation.isPending ? "Saving..." : "Register"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  waitlisted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  refunded: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

export default function RegistrationsPage() {
  const [showNewDialog, setShowNewDialog] = useState(false);

  const { data: registrations, isLoading } = useQuery<(Registration & { contact?: Contact; program?: Program })[]>({
    queryKey: ["/api/registrations"],
  });

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Registrations</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage programme registrations
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)} data-testid="button-new-registration">
          <Plus className="w-4 h-4 mr-2" />
          New Registration
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {[1, 2, 3].map((i) => (
                <div key={i} className="px-5 py-3">
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : registrations && registrations.length > 0 ? (
            <div className="divide-y">
              <div className="grid grid-cols-[1fr_1fr_120px_100px_120px] gap-3 px-5 py-2 text-xs font-medium text-muted-foreground border-b">
                <span>Player</span>
                <span>Programme</span>
                <span>Status</span>
                <span>Paid</span>
                <span>Date</span>
              </div>
              {registrations.map((reg) => (
                <div
                  key={reg.id}
                  className="grid grid-cols-[1fr_1fr_120px_100px_120px] gap-3 px-5 py-3 items-center"
                  data-testid={`row-registration-${reg.id}`}
                >
                  <Link href={`/contacts/${reg.contactId}`}>
                    <span className="text-sm font-medium text-primary cursor-pointer">
                      {reg.contact?.firstName} {reg.contact?.lastName}
                    </span>
                  </Link>
                  <Link href={`/programs/${reg.programId}`}>
                    <span className="text-sm text-primary cursor-pointer truncate">
                      {reg.program?.name}
                    </span>
                  </Link>
                  <Badge
                    className={`capitalize text-[10px] w-fit ${statusColors[reg.status] || ""}`}
                    variant="outline"
                  >
                    {reg.status}
                  </Badge>
                  <span className="text-sm">${reg.amountPaid || "0.00"}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(reg.registeredAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardCheck className="w-12 h-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No registrations yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Register a player for a programme to get started
              </p>
              <Button size="sm" onClick={() => setShowNewDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New Registration
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Registration</DialogTitle>
          </DialogHeader>
          <RegistrationForm onClose={() => setShowNewDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
