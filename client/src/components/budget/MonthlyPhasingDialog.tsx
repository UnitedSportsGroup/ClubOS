import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar, RotateCcw } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtMoney = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const parseCurrency = (s: string): number => {
  const cleaned = String(s).replace(/[$,]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// Distribute `total` cents across 12 months, pushing the remainder to early
// months so the sum exactly equals total (works for negatives too).
function evenSplit(total: number): number[] {
  const base = Math.floor(total / 12);
  let remainder = total - base * 12;
  const out = new Array(12).fill(base);
  const step = remainder >= 0 ? 1 : -1;
  remainder = Math.abs(remainder);
  for (let i = 0; i < remainder; i++) out[i] += step;
  return out;
}

// Tournament template — weight Jan (planning) / Mar (registrations) / Jul
// (event month). Mirrors the spend curve for CIC and Holiday Camps.
function tournamentSplit(total: number): number[] {
  const weights = [0.15, 0, 0.20, 0, 0, 0, 0.55, 0.10, 0, 0, 0, 0];
  return distributeByWeights(total, weights);
}

// Term-aligned — 4 NZ school terms. Roughly 25% each, distributed across
// months in the term (Feb–Apr, May–Jul, Aug–Oct, Nov–Dec).
function termAlignedSplit(total: number): number[] {
  const weights = [
    0,        // Jan (holidays)
    0.083, 0.083, 0.083,   // Term 1: Feb–Apr
    0.083, 0.083, 0.083,   // Term 2: May–Jul
    0.083, 0.083, 0.083,   // Term 3: Aug–Oct
    0.125, 0.125,          // Term 4: Nov–Dec
  ];
  return distributeByWeights(total, weights);
}

function distributeByWeights(total: number, weights: number[]): number[] {
  // Compute weighted shares as integers, then fix rounding drift on Jan.
  const out = weights.map(w => Math.round(total * w));
  const drift = total - out.reduce((s, n) => s + n, 0);
  if (drift !== 0) {
    const firstNonZero = out.findIndex(n => n !== 0);
    out[firstNonZero === -1 ? 0 : firstNonZero] += drift;
  }
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  lineId: number;
  lineName: string;
  amountCents: number;
  initialPhasing: number[] | null;
  onSaved: () => void;
}

export function MonthlyPhasingDialog({ open, onClose, lineId, lineName, amountCents, initialPhasing, onSaved }: Props) {
  const { toast } = useToast();
  const initial = useMemo(
    () => (initialPhasing && initialPhasing.length === 12 ? initialPhasing : evenSplit(amountCents)),
    [initialPhasing, amountCents],
  );
  const [values, setValues] = useState<string[]>(initial.map(c => fmtMoney(c)));

  useEffect(() => {
    if (open) setValues(initial.map(c => fmtMoney(c)));
  }, [open, initial]);

  const cents = values.map(parseCurrency);
  const sum = cents.reduce((s, n) => s + n, 0);
  const matches = sum === amountCents;
  const diff = sum - amountCents;

  const applyTemplate = (template: number[]) => {
    setValues(template.map(c => fmtMoney(c)));
  };

  const save = useMutation({
    mutationFn: async (payload: { monthlyPhasing: number[] | null }) =>
      (await apiRequest("PATCH", `/api/admin/budget/lines/${lineId}`, payload)).json(),
    onSuccess: () => {
      // Match by prefix so both the cost-centre detail and rollup queries
      // refresh — they share the /api/admin/budget root.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/budget/cost-centres"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/budget/rollup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/budget/rollup-monthly"] });
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-300" /> Monthly phasing — {lineName}
          </DialogTitle>
          <p className="text-xs text-white/50 mt-1">
            Split <span className="tabular-nums text-white/80">{fmtMoney(amountCents)}</span> across the 12 months of the year. The sum must match the line total exactly.
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-white/40 mr-1">Templates:</span>
          <Button variant="outline" size="sm" onClick={() => applyTemplate(evenSplit(amountCents))}>Even</Button>
          <Button variant="outline" size="sm" onClick={() => applyTemplate(tournamentSplit(amountCents))}>Tournament</Button>
          <Button variant="outline" size="sm" onClick={() => applyTemplate(termAlignedSplit(amountCents))}>Term-aligned</Button>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-4">
          {MONTHS.map((m, i) => (
            <div key={m} className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wider text-white/40 mb-1">{m}</label>
              <Input
                value={values[i]}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setValues(next);
                }}
                onBlur={(e) => {
                  const next = [...values];
                  next[i] = fmtMoney(parseCurrency(e.target.value));
                  setValues(next);
                }}
                className="bg-white/[0.03] border-white/[0.08] text-right tabular-nums h-8"
              />
            </div>
          ))}
        </div>

        <div className={`mt-4 rounded-lg p-3 text-sm flex items-center justify-between ${matches ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
          <span>
            Sum: <span className="tabular-nums font-semibold">{fmtMoney(sum)}</span>
            <span className="text-white/40 mx-2">/</span>
            <span className="tabular-nums">{fmtMoney(amountCents)}</span>
          </span>
          {!matches && (
            <span className="text-xs">
              {diff > 0 ? "Over" : "Under"} by <span className="tabular-nums font-semibold">{fmtMoney(Math.abs(diff))}</span>
            </span>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2">
          {initialPhasing != null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => save.mutate({ monthlyPhasing: null })}
              disabled={save.isPending}
              className="mr-auto text-white/60"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to even split
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            onClick={() => save.mutate({ monthlyPhasing: cents })}
            disabled={!matches || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save phasing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
