import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  GraduationCap,
  DollarSign,
  ClipboardCheck,
  UserPlus,
  ArrowRight,
  Calendar,
  Activity,
  Search,
  Plus,
  X,
  LayoutGrid,
  TrendingUp,
  GripVertical,
} from "lucide-react";
import { Link } from "wouter";
import type { Contact, Program } from "@shared/schema";
import AcademyProgramsBlock from "@/components/dashboard/academy-programs-block";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  accentColor,
  testId,
  delay,
}: {
  title: string;
  value: string | number;
  icon: any;
  description?: string;
  accentColor: string;
  testId: string;
  delay: number;
}) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-500/15 to-blue-600/5 border-blue-500/20 shadow-[0_0_20px_rgba(3,86,197,0.08)]",
    emerald: "from-emerald-500/12 to-emerald-600/3 border-emerald-500/15 shadow-[0_0_20px_rgba(16,185,129,0.06)]",
    amber: "from-amber-500/12 to-amber-600/3 border-amber-500/15 shadow-[0_0_20px_rgba(245,158,11,0.06)]",
    violet: "from-violet-500/12 to-violet-600/3 border-violet-500/15 shadow-[0_0_20px_rgba(139,92,246,0.06)]",
  };
  const iconColorMap: Record<string, string> = {
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  };

  return (
    <div
      className={`stat-glow relative rounded-2xl border bg-gradient-to-br p-5 animate-fade-in-up transition-all duration-500 hover:scale-[1.02] ${colorMap[accentColor]}`}
      data-testid={testId}
      style={{ animationDelay: `${delay}ms` , opacity: 0 }}
    >
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[12px] text-white/45 font-medium uppercase tracking-wider">{title}</span>
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${iconColorMap[accentColor]}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <span className="text-3xl font-bold text-white tracking-tight" data-testid={`${testId}-value`}>
          {value}
        </span>
        {description && (
          <p className="text-[11px] text-white/35 mt-2">{description}</p>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  title,
  description,
  icon: Icon,
  href,
  testId,
}: {
  title: string;
  description: string;
  icon: any;
  href: string;
  testId: string;
}) {
  return (
    <Link href={href}>
      <div
        className="flex items-center gap-4 p-3.5 rounded-xl cursor-pointer glass-card hover:border-blue-500/25 transition-all duration-300 group"
        data-testid={testId}
      >
        <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:shadow-[0_0_12px_rgba(3,86,197,0.15)] transition-shadow duration-300">
          <Icon className="w-4 h-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[13px] text-white/75">{title}</p>
          <p className="text-[11px] text-white/30">{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-white/15 group-hover:text-blue-400/50 group-hover:translate-x-0.5 transition-all duration-300" />
      </div>
    </Link>
  );
}

type BlockDefinition = {
  id: string;
  name: string;
  description: string;
  icon: any;
  category: string;
  width: "full" | "half";
};

const AVAILABLE_BLOCKS: BlockDefinition[] = [
  { id: "academy-programs", name: "Academy Programmes", description: "Registration numbers across U4-U8, U9-U12 Pre-Academy and U13-U20 Academy tiers with drill-down analytics", icon: GraduationCap, category: "Programmes", width: "full" },
  { id: "recent-contacts", name: "Recent Contacts", description: "Latest contacts added to the system", icon: Users, category: "People", width: "half" },
  { id: "active-programs", name: "Active Programmes", description: "Currently active programmes with registration counts", icon: GraduationCap, category: "Programmes", width: "half" },
  { id: "quick-actions", name: "Quick Actions", description: "Shortcuts to common tasks like adding contacts and creating programmes", icon: Activity, category: "General", width: "half" },
];

const DEFAULT_BLOCK_IDS = ["academy-programs", "recent-contacts", "active-programs", "quick-actions"];

function useBlockLayout() {
  const [blockIds, setBlockIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("cufc-dashboard-blocks");
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_BLOCK_IDS;
  });

  const saveBlocks = (ids: string[]) => {
    setBlockIds(ids);
    localStorage.setItem("cufc-dashboard-blocks", JSON.stringify(ids));
  };

  const addBlock = (id: string) => {
    if (!blockIds.includes(id)) {
      saveBlocks([...blockIds, id]);
    }
  };

  const removeBlock = (id: string) => {
    saveBlocks(blockIds.filter((b) => b !== id));
  };

  const moveBlock = (fromIndex: number, toIndex: number) => {
    const newIds = [...blockIds];
    const [moved] = newIds.splice(fromIndex, 1);
    newIds.splice(toIndex, 0, moved);
    saveBlocks(newIds);
  };

  return { blockIds, addBlock, removeBlock, moveBlock };
}

function BlockSearchModal({ open, onClose, onAdd, existingIds }: { open: boolean; onClose: () => void; onAdd: (id: string) => void; existingIds: string[] }) {
  const [search, setSearch] = useState("");

  if (!open) return null;

  const filtered = AVAILABLE_BLOCKS.filter(
    (b) =>
      !existingIds.includes(b.id) &&
      (b.name.toLowerCase().includes(search.toLowerCase()) ||
        b.description.toLowerCase().includes(search.toLowerCase()) ||
        b.category.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl border border-blue-500/[0.15] overflow-hidden animate-fade-in-up"
        style={{ background: "linear-gradient(135deg, rgba(3,86,197,0.06) 0%, #02060E 100%)", animationDelay: "0ms", opacity: 0 }}
        data-testid="modal-add-block"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
          <div className="flex items-center gap-2.5">
            <LayoutGrid className="w-4 h-4 text-blue-400" />
            <h3 className="text-[14px] font-semibold text-white/80">Add Dashboard Block</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors cursor-pointer" data-testid="button-close-modal">
            <X className="w-3.5 h-3.5 text-white/40" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <input
              type="text"
              placeholder="Search blocks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20 transition-all"
              data-testid="input-search-blocks"
              autoFocus
            />
          </div>

          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map((block) => (
                <button
                  key={block.id}
                  onClick={() => { onAdd(block.id); onClose(); }}
                  className="w-full text-left flex items-center gap-3.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-blue-500/20 hover:bg-white/[0.04] transition-all duration-200 group cursor-pointer"
                  data-testid={`add-block-${block.id}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <block.icon className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/75">{block.name}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">{block.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[9px] text-blue-300/30 px-2 py-0.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.08] uppercase tracking-wider">{block.category}</span>
                    <Plus className="w-4 h-4 text-white/10 group-hover:text-blue-400/50 transition-colors" />
                  </div>
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Search className="w-8 h-8 text-blue-400/10 mb-2" />
                <p className="text-[12px] text-white/25">
                  {existingIds.length === AVAILABLE_BLOCKS.length
                    ? "All blocks are already on your dashboard"
                    : "No matching blocks found"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentContactsBlock() {
  const { data: allContacts } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const recentContacts = allContacts?.slice(0, 5);

  return (
    <div className="rounded-2xl glass-card overflow-hidden" data-testid="block-recent-contacts">
      <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
        <h3 className="text-[14px] font-semibold text-white/75">Recent Contacts</h3>
        <Button variant="ghost" size="sm" asChild data-testid="link-view-all-contacts" className="text-blue-400/60 hover:text-blue-400 text-[12px] h-7 transition-colors duration-300">
          <Link href="/contacts">View all</Link>
        </Button>
      </div>
      <div>
        {recentContacts && recentContacts.length > 0 ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {recentContacts.map((contact) => (
              <Link key={contact.id} href={`/contacts/${contact.id}`}>
                <div className="flex items-center gap-3 px-5 py-3 row-hover cursor-pointer" data-testid={`row-contact-${contact.id}`}>
                  <div className="w-8 h-8 rounded-xl bg-blue-500/8 border border-blue-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-400/70 text-[11px] font-semibold">
                      {contact.firstName[0]}{contact.lastName[0]}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/75 truncate">{contact.firstName} {contact.lastName}</p>
                    <p className="text-[11px] text-white/25 truncate">{contact.email || contact.phone || "No contact info"}</p>
                  </div>
                  <span className="text-[10px] text-blue-300/30 capitalize px-2 py-0.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.08]">{contact.type}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Users className="w-10 h-10 text-blue-400/10 mb-3" />
            <p className="text-[13px] text-white/25">No contacts yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ActiveProgramsBlock() {
  const { data: allPrograms } = useQuery<Program[]>({ queryKey: ["/api/programs"] });
  const activePrograms = allPrograms?.filter((p) => p.isActive);

  return (
    <div className="rounded-2xl glass-card overflow-hidden" data-testid="block-active-programs">
      <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
        <h3 className="text-[14px] font-semibold text-white/75">Active Programmes</h3>
        <Button variant="ghost" size="sm" asChild data-testid="link-view-all-programs" className="text-blue-400/60 hover:text-blue-400 text-[12px] h-7 transition-colors duration-300">
          <Link href="/programs">View all</Link>
        </Button>
      </div>
      <div>
        {activePrograms && activePrograms.length > 0 ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {activePrograms.map((program) => (
              <Link key={program.id} href={`/programs/${program.id}`}>
                <div className="flex items-center gap-3 px-5 py-3 row-hover cursor-pointer" data-testid={`row-program-${program.id}`}>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/8 border border-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="w-4 h-4 text-emerald-400/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/75 truncate">{program.name}</p>
                    <p className="text-[11px] text-white/25">
                      {program.startDate && program.endDate ? `${program.startDate} — ${program.endDate}` : "Dates TBD"}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    {program.fee && <span className="text-[13px] font-medium text-white/50">${program.fee}</span>}
                    <span className="text-[10px] text-blue-300/30 capitalize px-2 py-0.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.08]">{program.type.replace("_", " ")}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <GraduationCap className="w-10 h-10 text-blue-400/10 mb-3" />
            <p className="text-[13px] text-white/25">No active programmes</p>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickActionsBlock() {
  return (
    <div className="rounded-2xl glass-card overflow-hidden" data-testid="block-quick-actions">
      <div className="px-5 py-4 border-b border-blue-500/[0.08]">
        <h3 className="text-[14px] font-semibold text-white/75">Quick Actions</h3>
      </div>
      <div className="p-3 space-y-2">
        <QuickAction title="Register Player" description="Add a new player to a programme" icon={UserPlus} href="/contacts?action=new&type=player" testId="action-register-player" />
        <QuickAction title="New Programme" description="Create a holiday camp or academy" icon={GraduationCap} href="/programs?action=new" testId="action-new-program" />
        <QuickAction title="View Calendar" description="See upcoming events & sessions" icon={Calendar} href="/events" testId="action-view-calendar" />
        <QuickAction title="View Audit Log" description="Track recent activity" icon={Activity} href="/audit-log" testId="action-view-audit" />
      </div>
    </div>
  );
}

function DashboardBlock({
  id,
  index,
  onRemove,
  dragState,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  id: string;
  index: number;
  onRemove: () => void;
  dragState: { dragging: number | null; over: number | null };
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
}) {
  const blockDef = AVAILABLE_BLOCKS.find((b) => b.id === id);
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragHandle = useRef(false);

  if (!blockDef) return null;

  const blockComponent = (() => {
    switch (id) {
      case "academy-programs": return <AcademyProgramsBlock />;
      case "recent-contacts": return <RecentContactsBlock />;
      case "active-programs": return <ActiveProgramsBlock />;
      case "quick-actions": return <QuickActionsBlock />;
      default: return null;
    }
  })();

  const isDragging = dragState.dragging === index;
  const isOver = dragState.over === index && dragState.dragging !== index;
  const showDropBefore = isOver && dragState.dragging !== null && dragState.dragging > index;
  const showDropAfter = isOver && dragState.dragging !== null && dragState.dragging < index;

  return (
    <div
      className={`relative group transition-all duration-200 ${blockDef.width === "full" ? "lg:col-span-3" : ""} ${isDragging ? "opacity-40 scale-[0.98]" : ""}`}
      draggable
      onDragStart={(e) => {
        if (!isDragHandle.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        onDragStart(index);
      }}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={() => {
        isDragHandle.current = false;
        onDragEnd();
      }}
      onDrop={(e) => onDrop(e, index)}
      data-testid={`draggable-block-${id}`}
    >
      {showDropBefore && (
        <div className="absolute -top-3 left-0 right-0 h-1 rounded-full bg-blue-500/60 shadow-[0_0_12px_rgba(3,86,197,0.4)] z-30 animate-pulse" />
      )}

      <div className="absolute top-3 left-3 z-10 flex items-center gap-1">
        <div
          ref={handleRef}
          onMouseDown={() => { isDragHandle.current = true; }}
          onMouseUp={() => { isDragHandle.current = false; }}
          className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-grab active:cursor-grabbing hover:bg-white/[0.08] hover:border-blue-500/20"
          data-testid={`drag-handle-${id}`}
        >
          <GripVertical className="w-3.5 h-3.5 text-white/30" />
        </div>
      </div>

      <button
        onClick={onRemove}
        className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-red-500/40 cursor-pointer"
        data-testid={`remove-block-${id}`}
        title="Remove block"
      >
        <X className="w-3 h-3 text-red-400" />
      </button>
      {blockComponent}

      {showDropAfter && (
        <div className="absolute -bottom-3 left-0 right-0 h-1 rounded-full bg-blue-500/60 shadow-[0_0_12px_rgba(3,86,197,0.4)] z-30 animate-pulse" />
      )}
    </div>
  );
}

export default function Dashboard() {
  const [showAddBlock, setShowAddBlock] = useState(false);
  const { blockIds, addBlock, removeBlock, moveBlock } = useBlockLayout();

  const [dragState, setDragState] = useState<{ dragging: number | null; over: number | null }>({
    dragging: null,
    over: null,
  });

  const handleDragStart = useCallback((index: number) => {
    setDragState({ dragging: index, over: null });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragState((prev) => ({ ...prev, over: index }));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = dragState.dragging;
      if (fromIndex !== null && fromIndex !== toIndex) {
        moveBlock(fromIndex, toIndex);
      }
      setDragState({ dragging: null, over: null });
    },
    [dragState.dragging, moveBlock]
  );

  const handleDragEnd = useCallback(() => {
    setDragState({ dragging: null, over: null });
  }, []);

  const { data: stats, isLoading } = useQuery<{
    totalContacts: number;
    totalPlayers: number;
    totalGuardians: number;
    activePrograms: number;
    totalRegistrations: number;
    pendingRegistrations: number;
  }>({
    queryKey: ["/api/stats"],
  });

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">
            Welcome to ClubOS
          </h1>
          <p className="text-blue-400/35 text-[13px] mt-1">
            Christchurch United Football Club
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowAddBlock(true)}
            data-testid="button-add-block"
            variant="outline"
            className="border-blue-500/15 bg-blue-500/[0.04] text-blue-400/70 hover:bg-blue-500/[0.08] hover:text-blue-400 hover:border-blue-500/25 rounded-xl h-9 text-[13px] font-medium transition-all duration-300"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Block
          </Button>
          <Button
            asChild
            data-testid="button-add-contact"
            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-9 text-[13px] font-medium glow-btn"
          >
            <Link href="/contacts?action=new">
              <UserPlus className="w-4 h-4 mr-2" />
              Add Contact
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-2xl glass-card p-5">
                <Skeleton className="h-20 w-full bg-blue-500/[0.04]" />
              </div>
            ))}
          </>
        ) : (
          <>
            <StatCard
              title="Total Members"
              value={stats?.totalContacts ?? 0}
              icon={Users}
              description={`${stats?.totalPlayers ?? 0} players · ${stats?.totalGuardians ?? 0} guardians`}
              accentColor="blue"
              testId="stat-total-members"
              delay={50}
            />
            <StatCard
              title="Active Programmes"
              value={stats?.activePrograms ?? 0}
              icon={GraduationCap}
              accentColor="emerald"
              testId="stat-active-programs"
              delay={100}
            />
            <StatCard
              title="Registrations"
              value={stats?.totalRegistrations ?? 0}
              icon={ClipboardCheck}
              description={`${stats?.pendingRegistrations ?? 0} pending`}
              accentColor="amber"
              testId="stat-registrations"
              delay={150}
            />
            <StatCard
              title="This Month"
              value="$0.00"
              icon={DollarSign}
              description="Revenue collected"
              accentColor="violet"
              testId="stat-revenue"
              delay={200}
            />
          </>
        )}
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        onDragOver={(e) => e.preventDefault()}
      >
        {blockIds.map((id, i) => (
          <DashboardBlock
            key={id}
            id={id}
            index={i}
            onRemove={() => removeBlock(id)}
            dragState={dragState}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
          />
        ))}

        {blockIds.length === 0 && (
          <div className="lg:col-span-3 flex flex-col items-center justify-center py-16 text-center glass-card rounded-2xl animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
            <LayoutGrid className="w-12 h-12 text-blue-400/10 mb-4" />
            <h3 className="text-[15px] font-medium text-white/40 mb-1">No dashboard blocks</h3>
            <p className="text-[12px] text-white/20 mb-4">Add blocks to customise your dashboard</p>
            <Button
              onClick={() => setShowAddBlock(true)}
              variant="outline"
              className="border-blue-500/15 bg-blue-500/[0.04] text-blue-400/70 hover:bg-blue-500/[0.08] hover:text-blue-400 rounded-xl h-9 text-[13px]"
              data-testid="button-add-block-empty"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Block
            </Button>
          </div>
        )}
      </div>

      <BlockSearchModal
        open={showAddBlock}
        onClose={() => setShowAddBlock(false)}
        onAdd={addBlock}
        existingIds={blockIds}
      />
    </div>
  );
}
