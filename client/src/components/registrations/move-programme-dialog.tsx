/**
 * Move a registration to the programme it should have been on.
 *
 * Daniel, 2026-09-21: "if 10 year old signed up for u4-u8 fundamentals on
 * accident and he can just move them like transfer them for sake of rolls and
 * accurate numbers etc… and rego numbers." And on 2026-09-22, from a player's
 * profile: "Still can't really see this move to another program." It had only
 * been on the Registrations page, inside an expanded row — the profile is
 * where he actually stands when a parent asks, so it lives here now and both
 * pages use this ONE dialog.
 *
 * 🔴 IT NEVER MOVES MONEY, and says so on the screen. Moving a child is an
 * administrative correction; what a family paid is a separate decision with its
 * own permission and its own Stripe call.
 *
 * 🔴 WHEN A BOOKED DAY HAS NO EQUIVALENT, THE SERVER REFUSES and names the
 * days. The person then chooses to drop them deliberately — a transfer that
 * silently discarded a booked day would take a child off a roll nobody checks.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProgrammeOption = { id: number; name: string };

export function MoveProgrammeDialog({ registrationId, programId, programName, personName, onClose, onMoved }: {
  registrationId: number;
  programId: number;
  programName?: string | null;
  personName?: string | null;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { toast } = useToast();
  // The same list the Registrations filter uses — /api/admin/programmes does not exist.
  const { data: programmes } = useQuery<ProgrammeOption[]>({ queryKey: ["/api/admin/registration-programmes"] });
  const [toProgramId, setToProgramId] = useState<string>("");
  const [unmatched, setUnmatched] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const move = async (dropUnmatchedDays: boolean) => {
    if (!toProgramId) { toast({ title: "Pick a programme", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const res = await workspaceFetch(`/api/admin/registrations/${registrationId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toProgramId: Number(toProgramId), dropUnmatchedDays }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.needsConfirmation) { setUnmatched(body.unmatched ?? []); return; }
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      toast({
        title: `Moved to ${body.movedTo?.name ?? "the new programme"}`,
        description: body.daysDropped
          ? `${body.daysRemapped} day(s) carried over, ${body.daysDropped} dropped. The amount paid was not changed.`
          : "The amount paid was not changed.",
      });
      onMoved();
    } catch (e: any) {
      toast({ title: "Could not move them", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const options = (programmes ?? []).filter((p) => p.id !== programId);

  return (
    <Dialog open onOpenChange={(v: boolean) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-move-programme">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Move to another programme</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            {personName ?? "This registration"} is on{" "}
            <span className="text-foreground/85">{programName ?? `programme ${programId}`}</span>.
          </p>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Move to</label>
            {/* 🔴 Drawn by us, not the browser — a native <select> changes shape
                per browser and per OS. */}
            <Select value={toProgramId} onValueChange={(v) => { setToProgramId(v); setUnmatched(null); }}>
              <SelectTrigger className="premium-input w-full h-9 mt-1 text-[13px]" data-testid="select-move-programme">
                <SelectValue placeholder="Choose a programme…" />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {unmatched && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 space-y-1.5">
              <p className="text-[12px] text-amber-700 dark:text-amber-200/90">
                That programme has no session on {unmatched.length === 1 ? "this day" : "these days"}:
              </p>
              <p className="text-[12px] text-foreground/70">{unmatched.join(", ")}</p>
              <p className="text-[11px] text-muted-foreground">
                Moving them anyway removes {unmatched.length === 1 ? "that day" : "those days"} from the booking.
              </p>
            </div>
          )}

          {/* 🔴 Said out loud, because it is the thing somebody will assume. */}
          <p className="text-[11px] text-muted-foreground">
            This does not change what they paid. If the two programmes cost
            different amounts, sort the difference separately.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="text-[12px] text-muted-foreground hover:text-foreground px-2 py-2 cursor-pointer">Cancel</button>
            {unmatched ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => move(true)}
                className="h-8 rounded-lg text-[12px]" data-testid="button-move-confirm-drop">
                {busy ? "Moving…" : `Move and drop ${unmatched.length} day${unmatched.length === 1 ? "" : "s"}`}
              </Button>
            ) : (
              <Button size="sm" disabled={busy || !toProgramId} onClick={() => move(false)}
                className="h-8 rounded-lg text-[12px]" data-testid="button-move-confirm">
                {busy ? "Moving…" : "Move"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
