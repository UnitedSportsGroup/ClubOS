import { useMemo, useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Trash2, User, Lock, ChevronRight, ChevronDown, Paperclip, Upload, X, FileText } from "lucide-react";

interface BudgetLine {
  id: number;
  costCentreId: number;
  parentLineId: number | null;
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

interface Attachment {
  id: number;
  lineId: number;
  kind: string;
  originalFilename: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
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

  const { toast } = useToast();
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const updateLine = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<BudgetLine> }) => (await apiRequest("PATCH", `/api/admin/budget/lines/${id}`, updates)).json(),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
  const createLine = useMutation({
    mutationFn: async (data: Partial<BudgetLine> & { costCentreId: number; kind: "income" | "expense"; name: string }) => (await apiRequest("POST", "/api/admin/budget/lines", { lineType: "simple", ...data })).json(),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Add line failed", description: e.message, variant: "destructive" }),
  });
  const deleteLine = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/admin/budget/lines/${id}`)).json(),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // Group lines by (section → top-level → children).
  const sections = useMemo(() => {
    if (!data) return [] as { section: string; tops: { top: BudgetLine; children: BudgetLine[] }[] }[];
    const tops = data.lines.filter(l => l.parentLineId == null);
    const kidsByParent = new Map<number, BudgetLine[]>();
    for (const l of data.lines) {
      if (l.parentLineId == null) continue;
      const arr = kidsByParent.get(l.parentLineId) ?? [];
      arr.push(l);
      kidsByParent.set(l.parentLineId, arr);
    }
    const bySection = new Map<string, { top: BudgetLine; children: BudgetLine[] }[]>();
    for (const t of tops) {
      const section = t.section ?? "(no section)";
      const arr = bySection.get(section) ?? [];
      arr.push({ top: t, children: (kidsByParent.get(t.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder) });
      bySection.set(section, arr);
    }
    return Array.from(bySection.entries()).map(([section, tops]) => ({
      section,
      tops: tops.sort((a, b) => a.top.displayOrder - b.top.displayOrder),
    }));
  }, [data]);

  const total = useMemo(() => {
    if (!data) return 0;
    // Sum only top-level lines (children roll up into parents).
    return data.lines.filter(l => l.parentLineId == null).reduce((s, l) => s + l.amountCents, 0);
  }, [data]);

  if (isLoading) return <div className="p-6 max-w-5xl mx-auto"><Skeleton className="h-8 w-64 mb-6" /><Skeleton className="h-96 w-full" /></div>;
  if (error) return <div className="p-6 max-w-5xl mx-auto"><div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 p-4 text-sm">Failed to load: {(error as Error).message}</div></div>;
  if (!data) return null;

  const { centre, canEdit } = data;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/admin/budget" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" />Back to budget overview
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
            {!canEdit && (<><span>·</span><span className="inline-flex items-center gap-1 text-white/40"><Lock className="w-3 h-3" />Read-only</span></>)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Total budgeted</div>
          <div className="text-xl font-semibold text-white tabular-nums mt-0.5">{fmtMoney(total)}</div>
        </div>
      </div>

      <div className="space-y-6">
        {sections.map(s => {
          const subtotal = s.tops.reduce((sum, t) => sum + t.top.amountCents, 0);
          return (
            <section key={s.section} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                <h2 className="text-sm font-semibold text-white/90">{s.section}</h2>
                <span className="text-xs text-white/40 tabular-nums">{fmtMoney(subtotal)}</span>
              </div>
              <div>
                {s.tops.map(({ top, children }) => (
                  <ParentRow
                    key={top.id}
                    line={top}
                    children={children}
                    canEdit={canEdit}
                    onUpdate={(updates) => updateLine.mutate({ id: top.id, updates })}
                    onDelete={() => deleteLine.mutate(top.id)}
                    onAddChild={(name, amount) => createLine.mutate({ costCentreId: centre.id, kind: "expense", section: top.section, parentLineId: top.id, name, amountCents: amount })}
                    onUpdateChild={(id, updates) => updateLine.mutate({ id, updates })}
                    onDeleteChild={(id) => deleteLine.mutate(id)}
                  />
                ))}
                {canEdit && (
                  <AddTopLineRow
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

function ParentRow({ line, children, canEdit, onUpdate, onDelete, onAddChild, onUpdateChild, onDeleteChild }: {
  line: BudgetLine;
  children: BudgetLine[];
  canEdit: boolean;
  onUpdate: (u: Partial<BudgetLine>) => void;
  onDelete: () => void;
  onAddChild: (name: string, amountCents: number) => void;
  onUpdateChild: (id: number, updates: Partial<BudgetLine>) => void;
  onDeleteChild: (id: number) => void;
}) {
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = useState(hasChildren);
  const [showAttachments, setShowAttachments] = useState(false);
  return (
    <div className="border-b border-white/[0.02]">
      <LineRow
        line={line}
        canEdit={canEdit}
        depth={0}
        amountIsAuto={hasChildren}
        leadingIcon={
          <button
            onClick={() => setExpanded(e => !e)}
            className={`w-5 h-5 inline-flex items-center justify-center rounded ${hasChildren || canEdit ? "text-white/40 hover:text-white/70" : "text-transparent"}`}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        }
        onUpdate={onUpdate}
        onDelete={onDelete}
        onToggleAttachments={() => setShowAttachments(s => !s)}
        attachmentsOpen={showAttachments}
      />
      {showAttachments && <AttachmentsPanel lineId={line.id} canEdit={canEdit} />}
      {expanded && (
        <div className="bg-black/20">
          {children.map(c => (
            <LineRow
              key={c.id}
              line={c}
              canEdit={canEdit}
              depth={1}
              onUpdate={(u) => onUpdateChild(c.id, u)}
              onDelete={() => onDeleteChild(c.id)}
            />
          ))}
          {canEdit && (
            <AddChildRow onAdd={onAddChild} />
          )}
        </div>
      )}
    </div>
  );
}

function LineRow({ line, canEdit, depth, amountIsAuto, leadingIcon, onUpdate, onDelete, onToggleAttachments, attachmentsOpen }: {
  line: BudgetLine;
  canEdit: boolean;
  depth: 0 | 1;
  amountIsAuto?: boolean;
  leadingIcon?: React.ReactNode;
  onUpdate: (u: Partial<BudgetLine>) => void;
  onDelete: () => void;
  onToggleAttachments?: () => void;
  attachmentsOpen?: boolean;
}) {
  const [name, setName] = useState(line.name);
  const [amount, setAmount] = useState(fmtMoney(line.amountCents));
  const [notes, setNotes] = useState(line.notes ?? "");
  const dirty = name !== line.name || amount !== fmtMoney(line.amountCents) || (notes !== (line.notes ?? ""));
  const save = () => {
    if (!dirty) return;
    const u: Partial<BudgetLine> = { name: name.trim() || line.name, notes: notes.trim() || null };
    if (!amountIsAuto) u.amountCents = parseCurrency(amount);
    onUpdate(u);
  };
  const indentClass = depth === 1 ? "pl-10" : "pl-4";
  return (
    <div className={`grid grid-cols-[20px_1fr_140px_1fr_80px] gap-2 items-center pr-4 py-1.5 ${indentClass} hover:bg-white/[0.015]`}>
      <div>{leadingIcon}</div>
      <Input
        value={name}
        disabled={!canEdit}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={`bg-transparent border-transparent hover:border-white/[0.08] h-8 px-2 ${depth === 1 ? "text-white/70 text-xs" : "text-white/90"}`}
      />
      <Input
        value={amount}
        disabled={!canEdit || amountIsAuto}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        title={amountIsAuto ? "Auto-summed from sub-lines" : undefined}
        className={`bg-transparent border-transparent hover:border-white/[0.08] text-right tabular-nums h-8 px-2 ${amountIsAuto ? "text-white/50" : depth === 1 ? "text-white/70 text-xs" : "text-white/90"}`}
      />
      <Input
        value={notes}
        disabled={!canEdit}
        placeholder={canEdit ? "Notes…" : ""}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={save}
        className={`bg-transparent border-transparent hover:border-white/[0.08] text-xs h-8 px-2 ${depth === 1 ? "text-white/40" : "text-white/60"}`}
      />
      <div className="flex items-center justify-end gap-1.5">
        {onToggleAttachments && (
          <button
            onClick={onToggleAttachments}
            className={`p-1 rounded ${attachmentsOpen ? "text-blue-300" : "text-white/30 hover:text-white/70"}`}
            title="Receipts / invoices"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
        )}
        {canEdit && (
          <button onClick={() => { if (confirm(`Delete "${line.name}"${line.parentLineId == null ? " and any sub-lines" : ""}?`)) onDelete(); }} className="p-1 text-white/20 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function AddTopLineRow({ section, onAdd }: { section: string | null; onAdd: (name: string, amountCents: number) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n, parseCurrency(amount));
    setName(""); setAmount("");
  };
  return (
    <div className="grid grid-cols-[20px_1fr_140px_1fr_80px] gap-2 items-center pl-4 pr-4 py-1.5 border-t border-white/[0.04] bg-white/[0.01]">
      <div className="text-white/20"><Plus className="w-3.5 h-3.5" /></div>
      <Input value={name} placeholder="Add a new line…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="bg-transparent border-transparent hover:border-white/[0.08] text-white/90 h-8 px-2" />
      <Input value={amount} placeholder="$0" onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="bg-transparent border-transparent hover:border-white/[0.08] text-right tabular-nums text-white/90 h-8 px-2" />
      <div className="text-xs text-white/25 px-2">{section ?? "no section"}</div>
      <div className="flex justify-end">
        <button onClick={submit} disabled={!name.trim()} className="text-white/30 hover:text-emerald-400 disabled:opacity-30">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function AddChildRow({ onAdd }: { onAdd: (name: string, amountCents: number) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n, parseCurrency(amount));
    setName(""); setAmount("");
  };
  return (
    <div className="grid grid-cols-[20px_1fr_140px_1fr_80px] gap-2 items-center pl-10 pr-4 py-1.5 border-t border-white/[0.02] bg-black/10">
      <div className="text-white/15"><Plus className="w-3 h-3" /></div>
      <Input value={name} placeholder="Add a sub-line…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="bg-transparent border-transparent hover:border-white/[0.08] text-white/70 text-xs h-7 px-2" />
      <Input value={amount} placeholder="$0" onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="bg-transparent border-transparent hover:border-white/[0.08] text-right tabular-nums text-white/70 text-xs h-7 px-2" />
      <div className="text-xs text-white/20 px-2">child</div>
      <div className="flex justify-end">
        <button onClick={submit} disabled={!name.trim()} className="text-white/30 hover:text-emerald-400 disabled:opacity-30">
          <Plus className="w-3 h-3" />
        </button>
      </div>
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
      <Button onClick={submit} disabled={!name.trim()} size="sm" className="bg-blue-600 hover:bg-blue-500 text-white"><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
    </div>
  );
}

// ── Attachments panel ──────────────────────────────────────────────────────

function AttachmentsPanel({ lineId, canEdit }: { lineId: number; canEdit: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qk = ["/api/admin/budget/lines", lineId, "attachments"];

  const { data: attachments } = useQuery<Attachment[]>({
    queryKey: qk,
    queryFn: async () => {
      const r = await fetch(`/api/admin/budget/lines/${lineId}/attachments`, {
        credentials: "include",
        headers: { "X-Workspace-Slug": "united-sports-group" },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/admin/budget/lines/${lineId}/attachments`, {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: { "X-Workspace-Slug": "united-sports-group" },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/admin/budget/attachments/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
  });

  const openSigned = async (id: number) => {
    const r = await fetch(`/api/admin/budget/attachments/${id}/url`, {
      credentials: "include",
      headers: { "X-Workspace-Slug": "united-sports-group" },
    });
    if (!r.ok) { toast({ title: "Could not open", variant: "destructive" }); return; }
    const { url } = await r.json();
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="pl-10 pr-4 py-3 bg-black/30 border-t border-white/[0.04] space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-white/40">Receipts & invoices</div>
        {canEdit && (
          <button
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
            className="inline-flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {upload.isPending ? "Uploading…" : "Add file"}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
      </div>
      {(attachments?.length ?? 0) === 0 ? (
        <div className="text-xs text-white/30 italic">No files yet.</div>
      ) : (
        <div className="space-y-1">
          {attachments!.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-xs">
              <FileText className="w-3.5 h-3.5 text-white/40" />
              <button onClick={() => openSigned(a.id)} className="text-blue-300 hover:underline truncate flex-1 text-left">
                {a.originalFilename}
              </button>
              <span className="text-white/30 text-[10px]">{a.sizeBytes ? `${Math.round(a.sizeBytes / 1024)} KB` : ""}</span>
              {canEdit && (
                <button onClick={() => { if (confirm(`Delete ${a.originalFilename}?`)) remove.mutate(a.id); }} className="text-white/20 hover:text-red-400">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
