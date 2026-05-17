import { useMemo, useState, useRef, Fragment } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Trash2, User, Lock, ChevronRight, ChevronDown, Paperclip, Upload, X, FileText, GripVertical, Calendar } from "lucide-react";
import { DndContext, pointerWithin, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, DragOverlay, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { MonthlyPhasingDialog } from "@/components/budget/MonthlyPhasingDialog";

interface BudgetLine {
  id: number;
  costCentreId: number;
  parentLineId: number | null;
  kind: "income" | "expense";
  lineType: "simple" | "computed";
  section: string | null;
  name: string;
  amountCents: number;
  monthlyPhasing: number[] | null;
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

type TreeNode = { line: BudgetLine; children: TreeNode[] };
type OverInfo = { kind: "nest"; rowId: number } | { kind: "gap"; parentKey: string; index: number } | null;
type ReorderUpdate = { id: number; displayOrder: number; parentLineId?: number | null };

const fmtMoney = (cents: number) => `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const parseCurrency = (s: string): number => {
  const cleaned = s.replace(/[$,]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const PARENT_KEY = (parentId: number | null) => (parentId == null ? "root" : String(parentId));
const parseGapId = (id: string): { parentKey: string; index: number } | null => {
  // gap-<parentKey>-<index>
  const m = /^gap-(.+)-(\d+)$/.exec(id);
  if (!m) return null;
  return { parentKey: m[1], index: Number(m[2]) };
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
  const reorder = useMutation({
    mutationFn: async (updates: ReorderUpdate[]) => (await apiRequest("POST", "/api/admin/budget/lines/reorder", { updates })).json(),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Reorder failed", description: e.message, variant: "destructive" }),
  });

  // Build full tree from flat lines list. Section grouping happens at the
  // top level only — once you nest a row, its section is inherited visually
  // (the data still carries the original section but the renderer ignores it
  // when the row is a descendant).
  const sections = useMemo(() => {
    if (!data) return [] as { section: string; nodes: TreeNode[] }[];
    const byParent = new Map<number | null, BudgetLine[]>();
    for (const l of data.lines) {
      const arr = byParent.get(l.parentLineId) ?? [];
      arr.push(l);
      byParent.set(l.parentLineId, arr);
    }
    const build = (parentId: number | null): TreeNode[] => {
      const kids = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
      return kids.map(line => ({ line, children: build(line.id) }));
    };
    const topNodes = build(null);
    const sections = new Map<string, TreeNode[]>();
    for (const node of topNodes) {
      const section = node.line.section ?? "(no section)";
      const arr = sections.get(section) ?? [];
      arr.push(node);
      sections.set(section, arr);
    }
    return Array.from(sections.entries()).map(([section, nodes]) => ({ section, nodes }));
  }, [data]);

  const total = useMemo(() => {
    if (!data) return 0;
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
        {sections.map(s => (
          <SectionBlock
            key={s.section}
            section={s.section}
            nodes={s.nodes}
            centre={centre}
            canEdit={canEdit}
            allLines={data.lines}
            onUpdateLine={(id, updates) => updateLine.mutate({ id, updates })}
            onDeleteLine={(id) => deleteLine.mutate(id)}
            onCreateLine={(d) => createLine.mutate(d)}
            onReorder={(updates) => reorder.mutate(updates)}
          />
        ))}
        {canEdit && (
          <section className="rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.01] p-4">
            <NewSectionRow onAdd={(section, name, amount) => createLine.mutate({ costCentreId: centre.id, kind: "expense", section: section || null, name, amountCents: amount })} />
          </section>
        )}
      </div>
    </div>
  );
}

// ── Section block — single DnD context covering ALL depths ─────────────────

function SectionBlock({
  section, nodes, centre, canEdit, allLines,
  onUpdateLine, onDeleteLine, onCreateLine, onReorder,
}: {
  section: string;
  nodes: TreeNode[];
  centre: CostCentre;
  canEdit: boolean;
  allLines: BudgetLine[];
  onUpdateLine: (id: number, updates: Partial<BudgetLine>) => void;
  onDeleteLine: (id: number) => void;
  onCreateLine: (data: Partial<BudgetLine> & { costCentreId: number; kind: "income" | "expense"; name: string }) => void;
  onReorder: (updates: ReorderUpdate[]) => void;
}) {
  const subtotal = nodes.reduce((sum, t) => sum + t.line.amountCents, 0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [activeId, setActiveId] = useState<number | null>(null);
  const [overInfo, setOverInfo] = useState<OverInfo>(null);

  // Pre-compute the set of ids that descend from `activeId` — these can't
  // be nest targets (cycle prevention) and their gaps are also disabled.
  const descendants = useMemo(() => {
    if (!activeId) return new Set<number>();
    const byParent = new Map<number | null, BudgetLine[]>();
    for (const l of allLines) {
      const arr = byParent.get(l.parentLineId) ?? [];
      arr.push(l); byParent.set(l.parentLineId, arr);
    }
    const out = new Set<number>();
    const walk = (id: number) => {
      out.add(id);
      for (const c of (byParent.get(id) ?? [])) walk(c.id);
    };
    walk(activeId);
    return out;
  }, [activeId, allLines]);

  const activeLine = activeId != null ? allLines.find(l => l.id === activeId) ?? null : null;

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(Number(e.active.id));
    setOverInfo(null);
  };
  const onDragOver = (e: DragOverEvent) => {
    if (!e.over) { setOverInfo(null); return; }
    const overId = String(e.over.id);
    if (overId.startsWith("nest-")) {
      const rowId = Number(overId.slice(5));
      if (rowId === activeId || descendants.has(rowId)) { setOverInfo(null); return; }
      setOverInfo({ kind: "nest", rowId });
    } else if (overId.startsWith("gap-")) {
      const gap = parseGapId(overId);
      if (!gap) { setOverInfo(null); return; }
      setOverInfo({ kind: "gap", parentKey: gap.parentKey, index: gap.index });
    } else {
      setOverInfo(null);
    }
  };

  const onDragEnd = (_e: DragEndEvent) => {
    const draggedId = activeId;
    const info = overInfo;
    setActiveId(null);
    setOverInfo(null);
    if (!draggedId || !info) return;

    if (info.kind === "nest") {
      if (info.rowId === draggedId || descendants.has(info.rowId)) return;
      // Place at end of target row's existing children.
      const existing = allLines.filter(l => l.parentLineId === info.rowId).sort((a, b) => a.displayOrder - b.displayOrder);
      const maxOrder = existing.length ? Math.max(...existing.map(c => c.displayOrder)) : 0;
      onReorder([{ id: draggedId, displayOrder: maxOrder + 10, parentLineId: info.rowId }]);
      return;
    }

    // Gap drop. Compute the new sibling order for that parent.
    const newParentId: number | null = info.parentKey === "root" ? null : Number(info.parentKey);
    const siblings = allLines.filter(l => l.parentLineId === newParentId).sort((a, b) => a.displayOrder - b.displayOrder);
    // Remove the dragged row from the sibling list (it might or might not already be a sibling).
    const filtered = siblings.filter(s => s.id !== draggedId);
    // Clamp insert index.
    const insertIndex = Math.max(0, Math.min(info.index, filtered.length));
    const reordered = [...filtered];
    // Insert a placeholder for the dragged row by id; we don't have the full row but only need the id for ordering.
    reordered.splice(insertIndex, 0, { id: draggedId } as BudgetLine);
    const updates: ReorderUpdate[] = reordered.map((s, i) => {
      const update: ReorderUpdate = { id: s.id, displayOrder: (i + 1) * 10 };
      if (s.id === draggedId) update.parentLineId = newParentId;
      return update;
    });
    onReorder(updates);
  };

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
        <h2 className="text-sm font-semibold text-white/90">{section}</h2>
        <span className="text-xs text-white/40 tabular-nums">{fmtMoney(subtotal)}</span>
      </div>
      <div>
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <Gap parentKey="root" index={0} highlighted={overInfo?.kind === "gap" && overInfo.parentKey === "root" && overInfo.index === 0} dragging={activeId != null} />
          {nodes.map((node, i) => (
            <Fragment key={node.line.id}>
              <TreeRow
                node={node}
                depth={0}
                parentKey="root"
                canEdit={canEdit}
                anyDragging={activeId != null}
                activeId={activeId}
                descendants={descendants}
                nestTargetId={overInfo?.kind === "nest" ? overInfo.rowId : null}
                overInfo={overInfo}
                centre={centre}
                onUpdate={onUpdateLine}
                onDelete={onDeleteLine}
                onCreate={onCreateLine}
              />
              <Gap parentKey="root" index={i + 1} highlighted={overInfo?.kind === "gap" && overInfo.parentKey === "root" && overInfo.index === i + 1} dragging={activeId != null} />
            </Fragment>
          ))}
          <DragOverlay dropAnimation={null}>
            {activeLine && (
              <DragChip line={activeLine} childCount={Math.max(0, descendants.size - 1)} />
            )}
          </DragOverlay>
        </DndContext>
        {canEdit && (
          <AddTopLineRow
            section={section === "(no section)" ? null : section}
            onAdd={(name, amount) => onCreateLine({ costCentreId: centre.id, kind: "expense", section: section === "(no section)" ? null : section, name, amountCents: amount })}
          />
        )}
      </div>
    </section>
  );
}

function DragChip({ line, childCount }: { line: BudgetLine; childCount: number }) {
  return (
    <div className="rounded-lg bg-blue-500/[0.18] border border-blue-400/60 shadow-xl px-4 py-2 text-sm text-white inline-flex items-center gap-3 backdrop-blur-md">
      <GripVertical className="w-3.5 h-3.5 text-white/60" />
      <span className="font-medium">{line.name}</span>
      <span className="text-white/60 tabular-nums">{fmtMoney(line.amountCents)}</span>
      {childCount > 0 && (
        <span className="text-[10px] uppercase tracking-wider text-blue-200/80 bg-blue-500/20 rounded px-1.5 py-0.5">
          +{childCount} sub-line{childCount === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

// ── Gap (reorder slot between rows / at top + bottom of children list) ─────

function Gap({ parentKey, index, highlighted, dragging }: { parentKey: string; index: number; highlighted: boolean; dragging: boolean }) {
  const { setNodeRef } = useDroppable({ id: `gap-${parentKey}-${index}` });
  // Compact at rest; expanded during drag so users have a real target.
  const height = dragging ? "h-3.5" : "h-0";
  return (
    <div ref={setNodeRef} className={`relative ${height} transition-[height] duration-100`}>
      {highlighted && (
        <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.7)]" />
      )}
    </div>
  );
}

// ── Recursive tree row — handles arbitrary depth ───────────────────────────

function TreeRow({
  node, depth, parentKey, canEdit, anyDragging, activeId, descendants, nestTargetId, overInfo, centre,
  onUpdate, onDelete, onCreate,
}: {
  node: TreeNode;
  depth: number;
  parentKey: string;
  canEdit: boolean;
  anyDragging: boolean;
  activeId: number | null;
  descendants: Set<number>;
  nestTargetId: number | null;
  overInfo: OverInfo;
  centre: CostCentre;
  onUpdate: (id: number, updates: Partial<BudgetLine>) => void;
  onDelete: (id: number) => void;
  onCreate: (data: Partial<BudgetLine> & { costCentreId: number; kind: "income" | "expense"; name: string }) => void;
}) {
  const { line } = node;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(hasChildren);
  const [showAttachments, setShowAttachments] = useState(false);
  const [phasingOpen, setPhasingOpen] = useState(false);

  const isInDraggedSubtree = activeId === line.id || (activeId != null && descendants.has(line.id));
  const draggable = useDraggable({ id: line.id, disabled: !canEdit });
  // Nest droppable disabled while this row is itself being dragged or is a
  // descendant of the dragged row (cycle prevention).
  const nestDrop = useDroppable({ id: `nest-${line.id}`, disabled: !canEdit || isInDraggedSubtree });

  const rowStyle: React.CSSProperties = {
    opacity: activeId === line.id ? 0.35 : 1,
  };
  const isNestTarget = nestTargetId === line.id;
  const nestClass = isNestTarget
    ? "ring-2 ring-blue-400 bg-blue-500/[0.22] shadow-[0_0_24px_rgba(96,165,250,0.55)]"
    : "";

  // Each level steps in by 24px. Depth 0 is flush with section padding.
  const indentPx = depth * 24;
  const childrenKey = String(line.id);

  return (
    <div ref={draggable.setNodeRef} style={rowStyle}>
      <div ref={nestDrop.setNodeRef} className={`relative rounded-md transition-colors ${nestClass}`} style={{ paddingLeft: indentPx }}>
        <LineRow
          line={line}
          canEdit={canEdit}
          isChild={depth > 0}
          amountIsAuto={hasChildren}
          dragHandleProps={canEdit ? { ...draggable.attributes, ...draggable.listeners } : undefined}
          chevron={
            <button
              onClick={() => setExpanded(e => !e)}
              className={`w-5 h-5 inline-flex items-center justify-center rounded ${(hasChildren || canEdit) ? "text-white/40 hover:text-white/70" : "text-transparent"}`}
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          }
          onUpdate={(u) => onUpdate(line.id, u)}
          onDelete={() => onDelete(line.id)}
          onToggleAttachments={() => setShowAttachments(s => !s)}
          attachmentsOpen={showAttachments}
          onTogglePhasing={!hasChildren && canEdit ? () => setPhasingOpen(true) : undefined}
          phased={!!line.monthlyPhasing}
        />
      </div>
      {showAttachments && <AttachmentsPanel lineId={line.id} canEdit={canEdit} indentPx={indentPx + 24} />}
      {phasingOpen && (
        <MonthlyPhasingDialog
          open={phasingOpen}
          onClose={() => setPhasingOpen(false)}
          lineId={line.id}
          lineName={line.name}
          amountCents={line.amountCents}
          initialPhasing={line.monthlyPhasing}
          onSaved={() => {}}
        />
      )}
      {expanded && (
        <div className="bg-black/15">
          <Gap parentKey={childrenKey} index={0} highlighted={overInfo?.kind === "gap" && overInfo.parentKey === childrenKey && overInfo.index === 0} dragging={anyDragging} />
          {node.children.map((child, i) => (
            <Fragment key={child.line.id}>
              <TreeRow
                node={child}
                depth={depth + 1}
                parentKey={childrenKey}
                canEdit={canEdit}
                anyDragging={anyDragging}
                activeId={activeId}
                descendants={descendants}
                nestTargetId={nestTargetId}
                overInfo={overInfo}
                centre={centre}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onCreate={onCreate}
              />
              <Gap parentKey={childrenKey} index={i + 1} highlighted={overInfo?.kind === "gap" && overInfo.parentKey === childrenKey && overInfo.index === i + 1} dragging={anyDragging} />
            </Fragment>
          ))}
          {canEdit && (
            <AddChildRow
              indentPx={indentPx + 24}
              onAdd={(name, amount) => onCreate({ costCentreId: centre.id, kind: "expense", section: line.section, parentLineId: line.id, name, amountCents: amount })}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Pure presentational row ────────────────────────────────────────────────

function LineRow({ line, canEdit, isChild, amountIsAuto, chevron, dragHandleProps, onUpdate, onDelete, onToggleAttachments, attachmentsOpen, onTogglePhasing, phased }: {
  line: BudgetLine;
  canEdit: boolean;
  isChild: boolean;
  amountIsAuto?: boolean;
  chevron?: React.ReactNode;
  dragHandleProps?: any;
  onUpdate: (u: Partial<BudgetLine>) => void;
  onDelete: () => void;
  onToggleAttachments?: () => void;
  attachmentsOpen?: boolean;
  onTogglePhasing?: () => void;
  phased?: boolean;
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
  return (
    <div className="grid grid-cols-[20px_20px_1fr_140px_1fr_96px] gap-2 items-center pl-1 pr-4 py-1.5 hover:bg-white/[0.015] group/row">
      <button
        {...dragHandleProps}
        className={`w-5 h-5 inline-flex items-center justify-center rounded text-white/15 hover:text-white/70 ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"} opacity-0 group-hover/row:opacity-100 transition-opacity`}
        title="Drag this row — drop on another row to nest, drop in a gap to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <div>{chevron}</div>
      <Input
        value={name}
        disabled={!canEdit}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={`bg-transparent border-transparent hover:border-white/[0.08] h-8 px-2 ${isChild ? "text-white/75 text-xs" : "text-white/90"}`}
      />
      <Input
        value={amount}
        disabled={!canEdit || amountIsAuto}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        title={amountIsAuto ? "Auto-summed from sub-lines" : undefined}
        className={`bg-transparent border-transparent hover:border-white/[0.08] text-right tabular-nums h-8 px-2 ${amountIsAuto ? "text-white/50" : isChild ? "text-white/75 text-xs" : "text-white/90"}`}
      />
      <Input
        value={notes}
        disabled={!canEdit}
        placeholder={canEdit ? "Notes…" : ""}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={save}
        className={`bg-transparent border-transparent hover:border-white/[0.08] text-xs h-8 px-2 ${isChild ? "text-white/40" : "text-white/60"}`}
      />
      <div className="flex items-center justify-end gap-1.5">
        {onTogglePhasing && (
          <button onClick={onTogglePhasing} className={`p-1 rounded ${phased ? "text-blue-300" : "text-white/30 hover:text-white/70"}`} title={phased ? "Monthly phasing set — click to edit" : "Spread this line across the year"}>
            <Calendar className="w-3.5 h-3.5" />
          </button>
        )}
        {onToggleAttachments && (
          <button onClick={onToggleAttachments} className={`p-1 rounded ${attachmentsOpen ? "text-blue-300" : "text-white/30 hover:text-white/70"}`} title="Receipts / invoices">
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
    <div className="grid grid-cols-[20px_20px_1fr_140px_1fr_96px] gap-2 items-center pl-1 pr-4 py-1.5 border-t border-white/[0.04] bg-white/[0.01]">
      <div />
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

function AddChildRow({ indentPx, onAdd }: { indentPx: number; onAdd: (name: string, amountCents: number) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n, parseCurrency(amount));
    setName(""); setAmount("");
  };
  return (
    <div className="grid grid-cols-[20px_20px_1fr_140px_1fr_96px] gap-2 items-center pr-4 py-1.5 border-t border-white/[0.02] bg-black/10" style={{ paddingLeft: indentPx }}>
      <div />
      <div className="text-white/15"><Plus className="w-3 h-3" /></div>
      <Input value={name} placeholder="Add a sub-line…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="bg-transparent border-transparent hover:border-white/[0.08] text-white/75 text-xs h-7 px-2" />
      <Input value={amount} placeholder="$0" onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} className="bg-transparent border-transparent hover:border-white/[0.08] text-right tabular-nums text-white/75 text-xs h-7 px-2" />
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

function AttachmentsPanel({ lineId, canEdit, indentPx = 24 }: { lineId: number; canEdit: boolean; indentPx?: number }) {
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
    <div className="pr-4 py-3 bg-black/30 border-t border-white/[0.04] space-y-2" style={{ paddingLeft: indentPx }}>
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
