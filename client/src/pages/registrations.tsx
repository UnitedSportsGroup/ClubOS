import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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

  const inputClass = "premium-input text-white/80 rounded-xl text-[13px]";
  const labelClass = "text-[12px] text-white/45 font-medium";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="programId"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={labelClass}>Programme *</FormLabel>
              <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                <FormControl>
                  <SelectTrigger data-testid="select-reg-program" className={inputClass}>
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
              <FormLabel className={labelClass}>Player *</FormLabel>
              <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                <FormControl>
                  <SelectTrigger data-testid="select-reg-player" className={inputClass}>
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
              <FormLabel className={labelClass}>Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? "pending"}>
                <FormControl>
                  <SelectTrigger data-testid="select-reg-status" className={inputClass}>
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
              <FormLabel className={labelClass}>Notes</FormLabel>
              <FormControl>
                <Textarea {...field} value={field.value ?? ""} data-testid="input-reg-notes" className={inputClass} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} data-testid="button-cancel" className="text-white/45 hover:text-white/60 transition-colors duration-300">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending}
            data-testid="button-save-reg"
            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn"
          >
            {createMutation.isPending ? "Saving..." : "Register"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

const statusColors: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  confirmed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  waitlisted: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  cancelled: "text-red-400 bg-red-500/10 border-red-500/20",
  refunded: "text-white/35 bg-blue-500/[0.04] border-blue-500/[0.08]",
};

export default function RegistrationsPage() {
  const [showNewDialog, setShowNewDialog] = useState(false);

  const { data: registrations, isLoading } = useQuery<(Registration & { contact?: Contact; program?: Program })[]>({
    queryKey: ["/api/registrations"],
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Registrations</h1>
          <p className="text-blue-400/35 text-[13px] mt-1">
            Manage programme registrations
          </p>
        </div>
        <Button
          onClick={() => setShowNewDialog(true)}
          data-testid="button-new-registration"
          className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-9 text-[13px] font-medium glow-btn"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Registration
        </Button>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        {isLoading ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-3">
                <Skeleton className="h-10 w-full bg-blue-500/[0.04]" />
              </div>
            ))}
          </div>
        ) : registrations && registrations.length > 0 ? (
          <div>
            <div className="grid grid-cols-[1fr_1fr_110px_90px_110px] gap-3 px-5 py-3 text-[10px] font-semibold text-blue-300/25 uppercase tracking-[0.15em] border-b border-blue-500/[0.08]">
              <span>Player</span>
              <span>Programme</span>
              <span>Status</span>
              <span>Paid</span>
              <span>Date</span>
            </div>
            <div className="divide-y divide-blue-500/[0.04]">
              {registrations.map((reg) => (
                <div
                  key={reg.id}
                  className="grid grid-cols-[1fr_1fr_110px_90px_110px] gap-3 px-5 py-3 items-center row-hover"
                  data-testid={`row-registration-${reg.id}`}
                >
                  <Link href={`/contacts/${reg.contactId}`}>
                    <span className="text-[13px] font-medium text-blue-400/70 cursor-pointer hover:text-blue-400 transition-colors duration-300">
                      {reg.contact?.firstName} {reg.contact?.lastName}
                    </span>
                  </Link>
                  <Link href={`/programs/${reg.programId}`}>
                    <span className="text-[13px] text-blue-400/70 cursor-pointer hover:text-blue-400 transition-colors duration-300 truncate">
                      {reg.program?.name}
                    </span>
                  </Link>
                  <span className={`text-[10px] font-medium capitalize px-2.5 py-0.5 rounded-lg border w-fit ${statusColors[reg.status] || ""}`}>
                    {reg.status}
                  </span>
                  <span className="text-[13px] text-white/40">${reg.amountPaid || "0.00"}</span>
                  <span className="text-[11px] text-white/25">
                    {new Date(reg.registeredAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/[0.04] border border-blue-500/[0.1] flex items-center justify-center mb-5">
              <ClipboardCheck className="w-6 h-6 text-blue-400/15" />
            </div>
            <p className="text-[14px] font-medium text-white/45">No registrations yet</p>
            <p className="text-[12px] text-white/25 mt-1.5 mb-5">
              Register a player for a programme to get started
            </p>
            <Button
              size="sm"
              onClick={() => setShowNewDialog(true)}
              className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl glow-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Registration
            </Button>
          </div>
        )}
      </div>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto border-blue-500/[0.15] rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(3,86,197,0.06) 0%, #02060E 100%)' }}>
          <DialogHeader>
            <DialogTitle className="text-white/85">New Registration</DialogTitle>
          </DialogHeader>
          <RegistrationForm onClose={() => setShowNewDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
