import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, FolderKanban, Trash2, Edit, DollarSign } from "lucide-react";
import type { PrintProject } from "@shared/schema";

const STATUSES = ["planning", "active", "on_hold", "completed", "archived"] as const;

const statusColors: Record<string, string> = {
  planning: "bg-blue-500/20 text-blue-400",
  active: "bg-emerald-500/20 text-emerald-400",
  on_hold: "bg-amber-500/20 text-amber-400",
  completed: "bg-green-500/20 text-green-400",
  archived: "bg-white/10 text-white/40",
};

export default function PrintsProjects() {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const orgId = currentOrg?.id;
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PrintProject | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("planning");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: projects = [], isLoading } = useQuery<PrintProject[]>({
    queryKey: ["/api/admin/print-projects", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/print-projects?orgId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => { const r = await apiRequest("POST", "/api/admin/print-projects", data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-projects"] }); toast({ title: "Project created" }); closeModal(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => { const r = await apiRequest("PATCH", `/api/admin/print-projects/${id}`, data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-projects"] }); toast({ title: "Project updated" }); closeModal(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/admin/print-projects/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-projects"] }); toast({ title: "Project deleted" }); },
  });

  function openCreate() {
    setEditing(null); setName(""); setClientName(""); setClientEmail(""); setDescription(""); setStatus("planning"); setBudget(""); setStartDate(""); setEndDate(""); setNotes("");
    setShowModal(true);
  }

  function openEdit(p: PrintProject) {
    setEditing(p); setName(p.name); setClientName(p.clientName); setClientEmail(p.clientEmail || ""); setDescription(p.description || ""); setStatus(p.status); setBudget(p.budget || ""); setStartDate(p.startDate || ""); setEndDate(p.endDate || ""); setNotes(p.notes || "");
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSave() {
    const data = { name, clientName, clientEmail: clientEmail || null, description: description || null, status, budget: budget || null, startDate: startDate || null, endDate: endDate || null, notes: notes || null, organizationId: orgId };
    if (editing) updateMutation.mutate({ id: editing.id, ...data });
    else createMutation.mutate(data);
  }

  const filtered = projects.filter(p => filterStatus === "all" || p.status === filterStatus);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="prints-projects">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center"><FolderKanban className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">Projects</h1>
            <p className="text-sm text-white/40">{projects.length} total projects</p>
          </div>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2" data-testid="button-add-project"><Plus className="w-4 h-4" /> New Project</Button>
      </div>

      <div className="flex gap-1 bg-white/[0.04] rounded-xl p-0.5">
        <Button variant="ghost" size="sm" onClick={() => setFilterStatus("all")} className={`text-xs h-7 rounded-lg ${filterStatus === "all" ? "bg-blue-600 text-white" : "text-white/40"}`}>All</Button>
        {STATUSES.map(s => (
          <Button key={s} variant="ghost" size="sm" onClick={() => setFilterStatus(s)} className={`text-xs h-7 rounded-lg capitalize ${filterStatus === s ? "bg-blue-600 text-white" : "text-white/40"}`}>{s.replace(/_/g, " ")}</Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full text-center py-12 text-white/30">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-12 text-white/30">No projects found</div>
        ) : filtered.map(project => (
          <div key={project.id} className="premium-card border border-white/[0.06] rounded-2xl p-5 hover:bg-white/[0.02] transition-colors" data-testid={`project-card-${project.id}`}>
            <div className="flex items-start justify-between mb-3">
              <Badge className={`text-[10px] capitalize ${statusColors[project.status]}`}>{project.status.replace(/_/g, " ")}</Badge>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(project)} className="h-6 w-6 text-white/30 hover:text-white/60" data-testid={`button-edit-project-${project.id}`}><Edit className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete?")) deleteMutation.mutate(project.id); }} className="h-6 w-6 text-red-400/40 hover:text-red-400"><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white/90 mb-1">{project.name}</h3>
            <p className="text-xs text-white/40 mb-2">{project.clientName}{project.clientEmail ? ` · ${project.clientEmail}` : ""}</p>
            {project.description && <p className="text-xs text-white/30 line-clamp-2 mb-3">{project.description}</p>}
            <div className="flex items-center justify-between text-xs text-white/30 pt-2 border-t border-white/[0.04]">
              {project.budget && <span className="text-emerald-400 font-medium">${parseFloat(project.budget).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}</span>}
              <div className="flex gap-2">
                {project.startDate && <span>{project.startDate}</span>}
                {project.startDate && project.endDate && <span>→</span>}
                {project.endDate && <span>{project.endDate}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full max-w-lg premium-card border border-white/[0.08] rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="modal-project">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Project" : "New Project"}</h2>
              <Button variant="ghost" size="icon" onClick={closeModal} className="text-white/30 h-8 w-8"><X className="w-4 h-4" /></Button>
            </div>
            <Input placeholder="Project name *" value={name} onChange={e => setName(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-project-name" />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Client name *" value={clientName} onChange={e => setClientName(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-client-name" />
              <Input placeholder="Client email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-client-email" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="premium-input text-white/70 rounded-xl" data-testid="select-project-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s}><span className="capitalize">{s.replace(/_/g, " ")}</span></SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <Input type="number" placeholder="Budget" value={budget} onChange={e => setBudget(e.target.value)} className="premium-input text-white/70 rounded-xl pl-9" data-testid="input-project-budget" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Start Date</label>
                <DatePickerInput value={startDate} onChange={e => setStartDate(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-start-date" />
              </div>
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">End Date</label>
                <DatePickerInput value={endDate} onChange={e => setEndDate(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-end-date" />
              </div>
            </div>
            <Textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="premium-input text-white/70 rounded-xl min-h-[60px]" data-testid="input-project-description" />
            <Textarea placeholder="Internal notes" value={notes} onChange={e => setNotes(e.target.value)} className="premium-input text-white/70 rounded-xl min-h-[40px]" data-testid="input-project-notes" />
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={!name.trim() || !clientName.trim()} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex-1" data-testid="button-save-project">
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={closeModal} className="border-white/10 text-white/60 rounded-xl">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
