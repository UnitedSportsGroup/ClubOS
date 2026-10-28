// Remove a registration entered by mistake — and the trail of who removed what
// (Daniel, 2026-10-28). Rules: @shared/registration-removal (the server enforces
// the same ones). Nothing here deletes anything: a removed registration is kept,
// stamped with the person, the time and the reason, and can be put back.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2, RotateCcw, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { removalBlocker, reasonProblem, REMOVAL_REASONS } from "@shared/registration-removal";

type Removable = {
  id: number;
  status: string;
  stripePaymentIntentId?: string | null;
  posSaleId?: number | null;
  totalCents?: number | null;
  refundedAmountCents?: number | null;
};

function invalidate() {
  queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations/removed"] });
}

/** The button at the foot of an expanded registration. */
export function RemoveRegistrationControl({ reg, onRemoved }: { reg: Removable; onRemoved?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const blocker = removalBlocker(reg);
  const problem = reasonProblem(reason);

  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/registrations/${reg.id}`, { reason: reason.trim() }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setReason("");
      toast({ title: "Registration removed", description: "It is kept in Removed entries with your name on it, and can be put back." });
      onRemoved?.();
    },
    onError: (e: Error) => toast({ title: "Not removed", description: e.message, variant: "destructive" }),
  });

  if (blocker) {
    return <p className="text-[11px] text-white/35 max-w-md text-right" data-testid={`text-remove-blocked-${reg.id}`}>{blocker}</p>;
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="flex items-center gap-1 text-[11px] text-red-400/60 hover:text-red-400 transition-colors cursor-pointer min-h-[32px]"
        data-testid={`button-delete-reg-${reg.id}`}
      >
        <Trash2 className="w-3 h-3" /> Remove registration
      </button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-2" onClick={(e) => e.stopPropagation()} data-testid={`panel-remove-reg-${reg.id}`}>
      <p className="text-[12px] text-white/70">Why is this being removed? Your name and the reason are recorded.</p>
      <div className="flex flex-wrap gap-1.5">
        {REMOVAL_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${reason === r ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-white/10 text-white/55 hover:bg-white/5"}`}
            data-testid={`chip-remove-reason-${r.split(" ")[0].toLowerCase()}`}
          >
            {r}
          </button>
        ))}
      </div>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Or write the reason"
        className="h-9 text-[13px]"
        data-testid={`input-remove-reason-${reg.id}`}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => { setOpen(false); setReason(""); }} className="h-8 text-[12px]" data-testid={`button-cancel-delete-reg-${reg.id}`}>
          Cancel
        </Button>
        <Button
          onClick={() => remove.mutate()}
          disabled={!!problem || remove.isPending}
          className="h-8 text-[12px] bg-red-600 hover:bg-red-700 text-white"
          data-testid={`button-confirm-delete-reg-${reg.id}`}
        >
          {remove.isPending ? "Removing…" : "Remove registration"}
        </Button>
      </div>
    </div>
  );
}

type RemovalEvent = {
  id: number;
  registration_id: number;
  action: "removed" | "restored";
  reason: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  still_removed: boolean;
  snapshot: {
    order_number?: number | null; program_name?: string | null; term_name?: string | null;
    child_name?: string | null; guardian_name?: string | null; total_cents?: number | null;
    payment_method?: string | null; payment_reference?: string | null; served_by_name?: string | null;
  };
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Header button + dialog: every removal and restore, who did it, and Restore. */
export function RemovedEntriesButton() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data: events, isLoading, error } = useQuery<RemovalEvent[]>({
    queryKey: ["/api/admin/registrations/removed"],
    queryFn: async () => {
      const r = await workspaceFetch("/api/admin/registrations/removed");
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "Could not load removed entries");
      return r.json();
    },
  });
  const restore = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/registrations/${id}/restore`, {}),
    onSuccess: () => { invalidate(); toast({ title: "Registration put back" }); },
    onError: (e: Error) => toast({ title: "Not restored", description: e.message, variant: "destructive" }),
  });
  const stillRemoved = new Set((events ?? []).filter((e) => e.still_removed).map((e) => e.registration_id)).size;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="shrink-0" data-testid="button-open-removed-entries">
        <History className="w-3.5 h-3.5 mr-1" />Removed{stillRemoved ? ` (${stillRemoved})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto min-w-0">
          <DialogHeader>
            <DialogTitle>Removed entries</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground -mt-2">
            Every registration removed or put back, with who did it and when. Nothing here is ever deleted.
          </p>
          {isLoading ? (
            <p className="text-[13px] text-muted-foreground py-6">Loading…</p>
          ) : error ? (
            <p className="text-[13px] text-red-500 py-6">{(error as Error).message}</p>
          ) : !events?.length ? (
            <p className="text-[13px] text-muted-foreground py-6" data-testid="text-removed-empty">No registration has been removed.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="list-removed-entries">
              {events.map((e) => {
                const s = e.snapshot ?? {};
                const latestForReg = events.find((x) => x.registration_id === e.registration_id)?.id === e.id;
                return (
                  <li key={e.id} className="py-3 flex items-start justify-between gap-3" data-testid={`row-removal-${e.id}`}>
                    <div className="min-w-0 text-[13px]">
                      <p className="font-medium break-words">
                        {s.child_name || "Unknown child"} · {s.program_name || "Programme"}{s.term_name ? ` · ${s.term_name}` : ""}
                      </p>
                      <p className="text-muted-foreground text-[12px] break-words">
                        #{s.order_number ?? e.registration_id} · {formatCurrency((s.total_cents ?? 0) / 100)}
                        {s.payment_method ? ` · ${s.payment_method.toUpperCase()}` : ""}
                        {s.payment_reference ? ` ref ${s.payment_reference}` : ""}
                        {s.served_by_name ? ` · taken by ${s.served_by_name}` : ""}
                      </p>
                      <p className="text-[12px] mt-1">
                        <span className={e.action === "removed" ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>
                          {e.action === "removed" ? "Removed" : "Put back"}
                        </span>{" "}
                        by <span className="font-medium">{e.user_name || e.user_email || "unknown"}</span> · {when(e.created_at)}
                      </p>
                      {e.reason && <p className="text-[12px] text-muted-foreground italic break-words">“{e.reason}”</p>}
                    </div>
                    {e.action === "removed" && e.still_removed && latestForReg && (
                      <Button
                        size="sm" variant="outline" className="shrink-0 h-8 text-[12px]"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(e.registration_id)}
                        data-testid={`button-restore-reg-${e.registration_id}`}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />Put back
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
