import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, X, ChevronRight, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Program } from "@shared/schema";

function formatDateRange(startDate: string | null, endDate: string | null): string {
  if (!startDate || !endDate) return "No dates set";
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const startDay = String(start.getDate()).padStart(2, "0");
  const endDay = String(end.getDate()).padStart(2, "0");
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${startDay} – ${endDay} ${months[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${startDay} ${months[start.getMonth()]} – ${endDay} ${months[end.getMonth()]} ${end.getFullYear()}`;
}

const PROGRAM_TYPES: { value: string; label: string }[] = [
  { value: "open_training", label: "Class / Training" },
  { value: "holiday_camp", label: "Holiday Camp / Workshop" },
  { value: "academy", label: "Academy" },
  { value: "event", label: "Event" },
  { value: "trials", label: "Trials" },
];

function CreateProgramModal({ open, onClose, orgId }: { open: boolean; onClose: () => void; orgId: number | undefined }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({
    name: "", slug: "", description: "", location: "United Sports Centre",
    startDate: "", endDate: "", ageMin: "", ageMax: "", type: "open_training",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Organisation not loaded yet");
      const res = await apiRequest("POST", "/api/admin/programs", {
        organizationId: orgId,
        type: form.type,
        name: form.name,
        slug: form.slug,
        description: form.description,
        location: form.location,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        ageMin: form.ageMin ? parseInt(form.ageMin) : null,
        ageMax: form.ageMax ? parseInt(form.ageMax) : null,
        isActive: true,
      });
      return res.json();
    },
    onSuccess: (program: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/programs"] });
      toast({ title: "Program created" });
      onClose();
      // Reuse the camp detail page — it operates on a program id and works
      // for any program type. Same with the landing-page editor.
      setLocation(`/admin/camps/${program.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't create program", description: e.message, variant: "destructive" }),
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-blue-500/[0.15] overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(3,86,197,0.06) 0%, #02060E 100%)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
          <h3 className="text-[14px] font-semibold text-white/80">Create program</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors cursor-pointer">
            <X className="w-3.5 h-3.5 text-white/40" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full premium-input text-white/80 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-sm"
              >
                {PROGRAM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Name</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Beginner Recreational Class" className="premium-input text-white/80 rounded-xl" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">URL Slug</label>
              <Input
                value={form.slug}
                onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                placeholder="beginner-recreational"
                className="premium-input text-white/80 rounded-xl"
              />
              <p className="text-[10px] text-white/30">
                Public URL: {form.slug ? `app.usg.co.nz/${form.slug}` : "set the slug to see the URL"}
              </p>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Short summary that appears on the landing page hero..." className="w-full h-20 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Location</label>
              <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="premium-input text-white/80 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Start Date</label>
              <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className="premium-input text-white/80 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">End Date</label>
              <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className="premium-input text-white/80 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Min Age</label>
              <Input type="number" value={form.ageMin} onChange={e => setForm({ ...form, ageMin: e.target.value })} placeholder="3" className="premium-input text-white/80 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Max Age</label>
              <Input type="number" value={form.ageMax} onChange={e => setForm({ ...form, ageMax: e.target.value })} placeholder="12" className="premium-input text-white/80 rounded-xl" />
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-blue-500/[0.08] flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!form.name || !form.slug || createMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {createMutation.isPending ? "Creating…" : "Create program"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function GymnasticsPrograms() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: programs = [], isLoading } = useQuery<Program[]>({
    queryKey: ["/api/admin/programs", { orgId }],
    queryFn: () => fetch(`/api/admin/programs?orgId=${orgId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!orgId,
  });

  const filtered = programs.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.slug?.toLowerCase().includes(search.toLowerCase()) ?? false)
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Programs</h1>
          <p className="text-sm text-white/40 mt-1">Classes, camps, workshops, and the term calendar they run against.</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          disabled={!orgId}
        >
          <Plus className="w-4 h-4 mr-1" /> New Program
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-white/5">
        <button
          onClick={() => setLocation("/admin/programs")}
          className="px-4 py-2.5 text-sm font-medium text-white border-b-2 border-blue-500 -mb-px"
        >
          All Programs
        </button>
        <button
          onClick={() => setLocation("/admin/terms")}
          className="px-4 py-2.5 text-sm font-medium text-white/50 hover:text-white/80 border-b-2 border-transparent -mb-px"
        >
          Term Dates
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <Input
          type="text"
          placeholder="Search programs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10 bg-white/[0.02] border-white/10 text-white"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-white/[0.02]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-12 text-center">
          <GraduationCap className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/50 mb-1">
            {programs.length === 0 ? "No programs yet — create your first." : "No programs match your search."}
          </p>
          {programs.length === 0 && (
            <p className="text-xs text-white/30">
              Each program gets a public landing page parents can register through.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => setLocation(`/admin/camps/${p.id}`)}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white truncate">{p.name}</span>
                  {!p.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/40">draft</span>}
                </div>
                <div className="text-xs text-white/40 truncate">
                  {formatDateRange(p.startDate, p.endDate)} · /{p.slug}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-white/20" />
            </button>
          ))}
        </div>
      )}

      <CreateProgramModal open={showCreate} onClose={() => setShowCreate(false)} orgId={orgId} />
    </div>
  );
}
