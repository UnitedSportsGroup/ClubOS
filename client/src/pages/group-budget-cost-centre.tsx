import { useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Trash2, User, Lock } from "lucide-react";

interface BudgetLine {
  id: number;
  costCentreId: number;
  kind: "income" | "expense";
  lineType: "simple" | "computed";
  section: string | null;
  name: string;
  amountCents: number;
  notes: string | null;
  displayOrder: number;
}

interface CostCentre {
  id: number;
  slug: string;
  name: string;
  bucket: string;
  ownerName: string | null;
  ownerId: number | null;
  year: number;
  isVirtual: boolean;
}

interface Resp {
  centre: CostCentre;
  lines: BudgetLine[];
  canEdit: boolean;
}

const fmtMoney = (cents: number) => `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const parseCurrency = (s: string): number => {
  const cleaned = s.replace(/[$,]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export default function GroupBudgetCostCentrePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const year = new Date().getFullYear();
  const { toast } = useToast();
  const queryKey = ["/api/admin/budget/cost-centres", slug, `?year=${year}`];

  const { data, isLoading, error } = useQuery<Resp>({
    queryKey,
    queryFn: async () => {
      const r = await fetch(`/api/admin/budget/cost-centres/${slug}?year=${year}`, {
        credentials: "include",
        headers: { "X-Workspace-Slug": "united-sports-group" },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const updateLine = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<BudgetLine> }) => {
      const res = await apiRequest("PATCH", `/api/admin/budget/lines/${id}`, updates);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const createLine = useMutation({
    mutationFn: async (data: Partial<BudgetLine> & { costCentreId: number; kind: "income" | "expense"; name: string }) => {
      const res = await apiRequest("POST", "/api/admin/budget/lines", { lineType: "simple", ...data });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast({ title: "Add line failed", description: e.message, variant: "destructive" }),
  });

  const deleteLine = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/budget/lines/${id}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const sections = useMemo(() => {
    if (!data) return [] as { section: string; lines: BudgetLine[] }[];
    const map = new Map<string, BudgetLine[]>();
    for (const l of data.lines) {
      const key = l.section ?? "(no section)";
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([section, lines]) => ({
      section,
      lines: lines.sort((a, b) => a.displayOrder - b.displayOrder),
    }));
  }, [data]);

  const total = useMemo(() => data?.lines.reduce((s, l) => s + l.amountCents, 0) ?? 0, [data]);

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 p-4 text-sm">
          Failed to load cost centre: {(error as Error).message}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { centre, canEdit } = data;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/admin/budget" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to budget overview
      </Link>

      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">{centre.name}</h1>
          <p className="text-sm text-white/50 mt-1 flex items-center gap-3">
            <span>{centre.year}</span>
            <span>·</span>
            {centre.ownerName ? (
              <span className="inline-flex items-center gap-1.5"><User className="w-3 h-3" />{centre.ownerName}</span>
            ) : (
              <span className="text-amber-400/70">No owner assigned</span>
            )}
            {!canEdit && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-white/40"><Lock className="w-3 h-3" />Read-only</span>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Total budgeted</div>
          <div className="text-xl font-semibold text-white tabular-nums mt-0.5">{fmtMoney(total)}</div>
        </div>
      </div>

      <div className="space-y-6">
        {sections.map(s => {
          const subtotal = s.lines.reduce((sum, l) => sum + l.amountCents, 0);
          return (
            <section key={s.section} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                <h2 className="text-sm font-semibold text-white/90">{s.section}</h2>
                <span className="text-xs text-white/40 tabular-nums">{fmtMoney(subtotal)}</span>
              </div>
              <div>
                {s.lines.map(line => (
                  <LineRow
                    key={line.id}
                    line={line}
                    canEdit={canEdit}
                    onUpdate={(updates) => updateLine.mutate({ id: line.id, updates })}
                    onDelete={() => deleteLine.mutate(line.id)}
                  />
                ))}
                {canEdit && (
                  <AddLineRow
                    section={s.section === "(no section)" ? null : s.section}
                    onAdd={(name, amount) => createLine.mutate({ costCentreId: centre.id, kind: "expense", section: s.section === "(no section)" ? null : s.section, name, amountCents: amount })}
                  />
                )}
              </div>
            </section>
          );
        })}

        {canEdit && (
          <section className="rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.01] p-4">
            <NewSectionRow
              onAdd={(section, name, amount) => createLine.mutate({ costCentreId: centre.id, kind: "expense", section: section || null, name, amountCents: amount })}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function LineRow({ line, canEdit, onUpdate, onDelete }: { line: BudgetLine; canEdit: boolean; onUpdate: (u: Partial<BudgetLine>) => void; onDelete: () => void }) {
  const [name, setName] = useState(line.name);
  const [amount, setAmount] = useState(fmtMoney(line.amountCents));
  const [notes, setNotes] = useState(line.notes ?? "");
  const dirty = name !== line.name || amount !== fmtMoney(line.amountCents) || (notes !== (line.notes ?? ""));
  const save = () => {
    if (!dirty) return;
    onUpdate({ name: name.trim() || line.name, amountCents: parseCurrency(amount), notes: notes.trim() || null });
  };
  return (
    <div className="grid grid-cols-[1fr_140px_1fr_36px] gap-2 items-center px-4 py-2 border-b border-white/[0.02] hover:bg-white/[0.01]">
      <Input
        value={name}
        disabled={!canEdit}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        className="bg-transparent border-transparent hover:border-white/[0.08] text-white/90 h-8 px-2"
      />
      <Input
        value={amount}
        disabled={!canEdit}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={save}
        className="bg-transparent border-transparent hover:border-white/[0.08] text-right tabular-nums text-white/90 h-8 px-2"
      />
      <Input
        value={notes}
        disabled={!canEdit}
        placeholder={canEdit ? "Notes…" : ""}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={save}
        className="bg-transparent border-transparent hover:border-white/[0.08] text-white/60 text-xs h-8 px-2"
      />
      {canEdit ? (
        <button onClick={() => { if (confirm(`Delete "${line.name}"?`)) onDelete(); }} className="text-white/20 hover:text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ) : <div />}
    </div>
  );
}

function AddLineRow({ section, onAdd }: { section: string | null; onAdd: (name: string, amountCents: number) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n, parseCurrency(amount));
    setName(""); setAmount("");
  };
  return (
    <div className="grid grid-cols-[1fr_140px_1fr_36px] gap-2 items-center px-4 py-2 border-t border-white/[0.04] bg-white/[0.01]">
      <Input
        value={name}
        placeholder="Add a new line…"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        className="bg-transparent border-transparent hover:border-white/[0.08] text-white/90 h-8 px-2"
      />
      <Input
        value={amount}
        placeholder="$0"
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        className="bg-transparent border-transparent hover:border-white/[0.08] text-right tabular-nums text-white/90 h-8 px-2"
      />
      <div className="text-xs text-white/30 px-2">{section ?? "no section"}</div>
      <button onClick={submit} disabled={!name.trim()} className="text-white/30 hover:text-emerald-400 disabled:opacity-30 transition-colors">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function NewSectionRow({ onAdd }: { onAdd: (section: string, name: string, amountCents: number) => void }) {
  const [section, setSection] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(section.trim(), n, parseCurrency(amount));
    setSection(""); setName(""); setAmount("");
  };
  return (
    <div className="grid grid-cols-[1fr_1fr_140px_auto] gap-2 items-center">
      <Input value={section} placeholder="New section name (e.g. Equipment)" onChange={(e) => setSection(e.target.value)} className="bg-white/[0.04] border-white/10 text-white/90 h-9" />
      <Input value={name} placeholder="First line in this section" onChange={(e) => setName(e.target.value)} className="bg-white/[0.04] border-white/10 text-white/90 h-9" />
      <Input value={amount} placeholder="$0" onChange={(e) => setAmount(e.target.value)} className="bg-white/[0.04] border-white/10 text-right tabular-nums text-white/90 h-9" />
      <Button onClick={submit} disabled={!name.trim()} size="sm" className="bg-blue-600 hover:bg-blue-500 text-white">
        <Plus className="w-3.5 h-3.5 mr-1" />Add
      </Button>
    </div>
  );
}
