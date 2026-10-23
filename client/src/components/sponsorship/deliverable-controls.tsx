/**
 * Shared tick / undo / status / proof controls for a partner deliverable.
 * Used by the Deliverables tab (group-sponsorship.tsx) and the partner sheet
 * (partners-view.tsx) so the two can never behave differently.
 * 🔴 A ticked item STAYS in the list, crossed out, with Undo. Done is a status,
 * never a disappearance. The server stamps / clears deliveredAt.
 */
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Check, ExternalLink, Link as LinkIcon, Loader2, MoreHorizontal, Paperclip, X } from "lucide-react";
import { fmtDateNz } from "@shared/sponsorship-partners";

export type ProofView = { url: string; name: string; isFile: boolean } | null | undefined;

export function invalidateDeliverableCaches() {
  queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/partners/deliverables"] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/partners"] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/deliverables-all"] });
}

export const isDone = (status: string) => status === "delivered" || status === "waived";

/** y-m-d part of an ISO timestamp, in NZ time. */
function nzDay(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function useDeliverableStatus() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (v: { id: number; body: Record<string, unknown> }) =>
      (await apiRequest("PATCH", `/api/admin/sponsorship/deliverables/${v.id}`, v.body)).json(),
    onSuccess: () => invalidateDeliverableCaches(),
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
}

/** Round check control. Checked = delivered. */
export function TickButton({ id, status, busy, onToggle }: { id: number; status: string; busy?: boolean; onToggle: () => void }) {
  const done = isDone(status);
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggle(); }}
      disabled={busy}
      aria-pressed={done}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      title={done ? "Done — tap to undo" : "Tap to mark done"}
      data-testid={`deliverable-tick-${id}`}
      className="flex-shrink-0 w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full"
    >
      <span className={`w-7 h-7 md:w-6 md:h-6 rounded-full border-2 flex items-center justify-center transition ${done ? "bg-green-500 border-green-500 text-white" : "border-slate-400 text-transparent hover:border-green-500"}`}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" /> : <Check className="w-4 h-4" strokeWidth={3} />}
      </span>
    </button>
  );
}

/** "Done 8 Nov 2026" / "Waived" stamp plus Undo. Renders nothing for an open item. */
export function DoneStamp({ status, deliveredAt, onUndo }: { status: string; deliveredAt: string | null | undefined; onUndo: () => void }) {
  if (!isDone(status)) return null;
  const day = nzDay(deliveredAt);
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-white/50">
      <span>{status === "waived" ? "Waived" : `Done${day ? ` ${fmtDateNz(day)}` : ""}`}</span>
      <button type="button" onClick={e => { e.stopPropagation(); onUndo(); }} className="underline hover:text-white min-h-[44px] md:min-h-0 px-1" data-testid="deliverable-undo">Undo</button>
    </span>
  );
}

/** Small menu for the two states the tick does not cover. */
export function StatusMenu({ id, status, onSet }: { id: number; status: string; onSet: (s: "pending" | "in_progress" | "waived") => void }) {
  const label = status === "in_progress" ? "In progress" : status === "waived" ? "Waived" : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] text-white/50 hover:text-white min-h-[44px] md:min-h-0 px-1.5 rounded" data-testid={`deliverable-status-${id}`} aria-label="More statuses">
          {label && <span className="font-semibold text-blue-500">{label}</span>}
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onSet("pending")}>Pending</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSet("in_progress")}>In progress</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSet("waived")}>Waived</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Proof chip, or Attach proof + Link when there is none. */
export function ProofControls({ id, proof, proofUrl }: { id: number; proof?: ProofView; proofUrl?: string | null }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Fall back to the raw proofUrl if the row carries no derived `proof`.
  let shown: ProofView = proof;
  if (!shown && proofUrl) {
    let host = proofUrl; try { host = new URL(proofUrl).hostname; } catch { /* keep */ }
    shown = { url: proofUrl, name: host, isFile: false };
  }

  const save = useMutation({
    mutationFn: async (url: string) => (await apiRequest("PATCH", `/api/admin/sponsorship/deliverables/${id}`, { proofUrl: url })).json(),
    onSuccess: (_r, url) => { invalidateDeliverableCaches(); setLinkOpen(false); setLink(""); setConfirmRemove(false); toast({ title: url ? "Proof link saved" : "Proof removed" }); },
    onError: (e: any) => toast({ title: "Couldn't save proof", description: e.message, variant: "destructive" }),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await workspaceFetch(`/api/admin/sponsorship/partners/deliverables/${id}/proof`, { method: "POST", body: fd });
      if (!r.ok) { let m = "Upload failed"; try { m = (await r.json()).message || m; } catch { /* keep */ } throw new Error(m); }
      return r.json();
    },
    onSuccess: () => { invalidateDeliverableCaches(); toast({ title: "Proof attached" }); },
    onError: (e: any) => toast({ title: "Couldn't attach proof", description: e.message, variant: "destructive" }),
    onSettled: () => { if (fileRef.current) fileRef.current.value = ""; },
  });

  if (shown) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] max-w-full" data-testid={`deliverable-proof-${id}`}>
        <a href={shown.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-blue-500 hover:underline min-h-[44px] md:min-h-0 min-w-0">
          {shown.isFile ? <Paperclip className="w-3 h-3 flex-shrink-0" /> : <ExternalLink className="w-3 h-3 flex-shrink-0" />}
          <span className="truncate max-w-[180px]">{shown.name}</span>
        </a>
        {confirmRemove ? (
          <span className="inline-flex items-center gap-1">
            <button type="button" className="text-red-500 underline min-h-[44px] md:min-h-0 px-1" onClick={e => { e.stopPropagation(); save.mutate(""); }} disabled={save.isPending}>Remove?</button>
            <button type="button" className="text-white/50 underline min-h-[44px] md:min-h-0 px-1" onClick={e => { e.stopPropagation(); setConfirmRemove(false); }}>Keep</button>
          </span>
        ) : (
          <button type="button" aria-label="Remove proof" title="Remove proof" className="w-11 h-11 md:w-6 md:h-6 flex items-center justify-center text-white/40 hover:text-red-500" onClick={e => { e.stopPropagation(); setConfirmRemove(true); }}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
      <input ref={fileRef} type="file" accept="application/pdf,image/*,video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
      <Button type="button" size="sm" variant="outline" className="min-h-[44px] md:min-h-0 md:h-7 text-[11px]" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid={`deliverable-attach-${id}`}>
        {upload.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Paperclip className="w-3 h-3 mr-1" />}
        {upload.isPending ? "Uploading…" : "Attach proof"}
      </Button>
      {linkOpen ? (
        <span className="inline-flex items-center gap-1">
          <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" className="h-11 md:h-7 w-[160px] text-[11px]" autoFocus />
          <Button type="button" size="sm" className="min-h-[44px] md:min-h-0 md:h-7 text-[11px]" disabled={!link.trim() || save.isPending} onClick={() => save.mutate(link.trim())}>Save</Button>
          <button type="button" aria-label="Cancel" className="w-11 h-11 md:w-6 md:h-6 flex items-center justify-center text-white/40" onClick={() => setLinkOpen(false)}><X className="w-3.5 h-3.5" /></button>
        </span>
      ) : (
        <button type="button" className="inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-white underline min-h-[44px] md:min-h-0 px-1" onClick={() => setLinkOpen(true)}>
          <LinkIcon className="w-3 h-3" />Link
        </button>
      )}
    </span>
  );
}
