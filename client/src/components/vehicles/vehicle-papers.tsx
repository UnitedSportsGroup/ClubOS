/**
 * The paperwork behind a vehicle: the agreement whoever drives it signed, and
 * the fines it has collected.
 *
 * Daniel, 2026-09-21: "probably also needs tab where we can see their vehicle
 * agreement with the club and easily be able to access it here as well" — and
 * "fit fines into vehicles as you didn't understand me the first time we built
 * that and just put it into separate tab."
 *
 * 🔴 The Fines tab is unchanged and remains where fines are MANAGED. This is
 * the same rows read where somebody is already looking at the vehicle — not a
 * second place to edit them, which would be two screens disagreeing about
 * whether a fine was paid.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Upload, Trash2, ExternalLink, AlertTriangle } from "lucide-react";

function niceDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${M[m - 1] ?? "?"} ${y}`;
}
const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

// ── Agreements ──────────────────────────────────────────────────────────────
type Agreement = {
  id: number; holderName: string; signedOn: string | null; expiresOn: string | null;
  fileName: string | null; hasFile: boolean; notes: string | null;
};

export function VehicleAgreementsTab({ vehicleId }: { vehicleId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [`/api/admin/vehicles/${vehicleId}/agreements`];
  const { data, isLoading } = useQuery<{ rows: Agreement[]; todayIso: string }>({ queryKey: key });

  const fileRef = useRef<HTMLInputElement>(null);
  const [holderName, setHolderName] = useState("");
  const [signedOn, setSignedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!holderName.trim()) { toast({ title: "Who signed it?", variant: "destructive" }); return; }
    const file = fileRef.current?.files?.[0];
    if (!file && !notes.trim()) {
      toast({ title: "Attach it, or say where it is",
        description: "A record that is neither a document nor a note says nothing.", variant: "destructive" });
      return;
    }
    const body = new FormData();
    if (file) body.append("file", file);
    body.append("holderName", holderName.trim());
    if (signedOn) body.append("signedOn", signedOn);
    if (expiresOn) body.append("expiresOn", expiresOn);
    if (notes.trim()) body.append("notes", notes.trim());
    setBusy(true);
    try {
      const res = await workspaceFetch(`/api/admin/vehicles/${vehicleId}/agreements`, { method: "POST", body });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
      if (fileRef.current) fileRef.current.value = "";
      setHolderName(""); setSignedOn(""); setExpiresOn(""); setNotes("");
      qc.invalidateQueries({ queryKey: key });
      toast({ title: "Agreement recorded" });
    } catch (e: any) {
      toast({ title: "Could not save it", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await workspaceFetch(`/api/admin/vehicles/${vehicleId}/agreements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: "Removed" }); },
  });

  if (isLoading || !data) return <div className="text-white/30 text-sm py-8 text-center">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">Record an agreement</div>
        <div className="flex flex-wrap gap-2">
          <Input value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Who signed it"
            className="premium-input h-8 w-[170px] text-[12px]" data-testid="input-agreement-holder" />
          <Input type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)}
            className="premium-input h-8 w-[145px] text-[12px]" title="Signed on" data-testid="input-agreement-signed" />
          <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)}
            className="premium-input h-8 w-[145px] text-[12px]" title="Expires (optional)" data-testid="input-agreement-expires" />
          <input ref={fileRef} type="file" accept="application/pdf,image/*"
            className="text-[12px] text-white/50 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-500/15 file:px-2.5 file:py-1 file:text-[11px] file:text-blue-300"
            data-testid="input-agreement-file" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Or a note — e.g. signed hard copy held in the office"
            className="premium-input h-8 flex-1 min-w-[200px] text-[12px]" data-testid="input-agreement-notes" />
          <Button size="sm" onClick={add} disabled={busy} className="h-8 rounded-lg text-[12px]"
            data-testid="button-agreement-add">
            <Upload className="w-3.5 h-3.5 mr-1.5" />{busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="text-white/30 text-[13px] py-6 text-center">
          No agreement on file for this vehicle.
        </p>
      ) : (
        <div className="space-y-2">
          {data.rows.map((a) => {
            // Expiry is DERIVED against the server's NZ today, like every other
            // status in this tab — nothing stores "expired".
            const expired = !!a.expiresOn && String(a.expiresOn).slice(0, 10) < data.todayIso;
            return (
              <div key={a.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                data-testid={`agreement-${a.id}`}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <FileText className="w-3.5 h-3.5 text-white/35 self-center" />
                  <span className="text-[13px] text-white/85">{a.holderName}</span>
                  <span className="text-[12px] text-white/40">signed {niceDate(a.signedOn)}</span>
                  {a.expiresOn && (
                    <span className={`text-[11px] ${expired ? "text-red-400/80" : "text-white/30"}`}>
                      · {expired ? "expired" : "expires"} {niceDate(a.expiresOn)}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {a.hasFile && (
                      <a href={`/api/admin/vehicles/${vehicleId}/agreements/${a.id}/file`} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-blue-300/80 hover:text-blue-300 inline-flex items-center gap-1"
                        data-testid={`link-agreement-${a.id}`}>
                        <ExternalLink className="w-3 h-3" /> open
                      </a>
                    )}
                    <button onClick={() => remove.mutate(a.id)}
                      className="text-[11px] text-red-400/60 hover:text-red-400 inline-flex items-center gap-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {!a.hasFile && (
                  <p className="text-[11px] text-amber-300/60 mt-1 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> No document attached
                  </p>
                )}
                {a.notes && <p className="text-[11px] text-white/40 mt-1">{a.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Fines ───────────────────────────────────────────────────────────────────
type Fine = {
  id: number; direction: string; category: string | null; reference: string | null;
  counterparty: string | null; description: string | null; amountCents: number;
  offenceOn: string | null; dueOn: string | null; paidOn: string | null; waivedOn: string | null;
};

export function VehicleFinesTab({ vehicleId }: { vehicleId: number }) {
  const key = [`/api/admin/vehicles/${vehicleId}/fines`];
  const { data, isLoading } = useQuery<{ rows: Fine[]; attachments: any[]; todayIso: string }>({ queryKey: key });
  if (isLoading || !data) return <div className="text-white/30 text-sm py-8 text-center">Loading…</div>;

  if (data.rows.length === 0) {
    return (
      <div className="py-6 text-center space-y-1">
        <p className="text-white/30 text-[13px]">No fines recorded against this vehicle.</p>
        <p className="text-white/20 text-[11px]">Fines are added in the Fines tab and appear here automatically.</p>
      </div>
    );
  }

  // 🔴 Totals are never netted — a fine the club owes and one owed to the club
  // point opposite ways, and "$220 net" would hide an overdue council notice
  // behind somebody's unpaid one. Same rule as the Fines tab itself.
  const outstanding = data.rows.filter((f) => !f.paidOn && !f.waivedOn);
  const owedTotal = outstanding.reduce((n, f) => n + f.amountCents, 0);

  return (
    <div className="space-y-3">
      {outstanding.length > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-[12px] text-white/70">
          <span className="text-red-300/90 font-semibold">{money(owedTotal)}</span> unpaid
          across {outstanding.length} fine{outstanding.length === 1 ? "" : "s"}
        </div>
      )}
      {data.rows.map((f) => {
        const atts = data.attachments.filter((a) => a.fineId === f.id);
        // Overdue is a calculation, never a stored flag: a fine paid late reads
        // PAID, which is the truth about it today.
        const overdue = !f.paidOn && !f.waivedOn && !!f.dueOn && String(f.dueOn).slice(0, 10) < data.todayIso;
        return (
          <div key={f.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3" data-testid={`vehicle-fine-${f.id}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[13px] text-white/85">{money(f.amountCents)}</span>
              <span className="text-[12px] text-white/45">{f.counterparty ?? f.category ?? "Fine"}</span>
              {f.reference && <span className="text-[11px] font-mono text-white/25">{f.reference}</span>}
              <span className="ml-auto text-[10px] uppercase tracking-wider">
                {f.paidOn ? <span className="text-emerald-400/80">paid</span>
                  : f.waivedOn ? <span className="text-white/35">waived</span>
                  : overdue ? <span className="text-red-400/80">overdue</span>
                  : <span className="text-amber-300/70">unpaid</span>}
              </span>
            </div>
            <p className="text-[11px] text-white/30 mt-1">
              Offence {niceDate(f.offenceOn)}{f.dueOn ? ` · due ${niceDate(f.dueOn)}` : ""}
            </p>
            {f.description && <p className="text-[11px] text-white/40 mt-1">{f.description}</p>}
            {atts.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {atts.map((a) => (
                  <a key={a.id} href={`/api/admin/fines/${f.id}/attachments/${a.id}`} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-blue-300/80 hover:text-blue-300 inline-flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> {a.filename ?? a.kind}
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
