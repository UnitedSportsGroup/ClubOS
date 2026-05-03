import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useWorkspace } from "@/lib/workspace-context";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Shield, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Club } from "@shared/schema";

function avifSiblingFor(webpUrl: string): string | null {
  return /\.webp(\?|$)/i.test(webpUrl) ? webpUrl.replace(/\.webp(\?|$)/i, ".avif$1") : null;
}

function ClubCrest({ club, size = 40 }: { club: Club; size?: number }) {
  if (club.logoUrl) {
    const avif = avifSiblingFor(club.logoUrl);
    return (
      <picture>
        {avif && <source srcSet={avif} type="image/avif" />}
        <img src={club.logoUrl} alt={`${club.name} logo`} width={size} height={size}
             className="rounded-xl object-cover bg-white/[0.03]"
             style={{ width: size, height: size }} />
      </picture>
    );
  }
  return (
    <div
      className="rounded-xl flex items-center justify-center font-bold text-white/70"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: club.primaryColor ? `${club.primaryColor}30` : "rgba(255,255,255,0.05)",
      }}
    >
      <Shield className="w-1/2 h-1/2 text-white/40" />
    </div>
  );
}

export default function ClubsList() {
  const { currentOrg } = useWorkspace();
  const orgId = currentOrg?.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newClub, setNewClub] = useState({ name: "", shortName: "", contactName: "", contactEmail: "", contactPhone: "" });

  const { data: clubs = [], isLoading } = useQuery<Club[]>({
    queryKey: ["/api/admin/clubs", { orgId }],
    queryFn: () => fetch(`/api/admin/clubs?orgId=${orgId}`).then(r => r.json()),
    enabled: !!orgId,
  });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/clubs", data),
    onSuccess: async (res) => {
      const created = await (res as any).json?.() ?? res;
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs"] });
      toast({ title: "Club created" });
      setShowNew(false);
      setNewClub({ name: "", shortName: "", contactName: "", contactEmail: "", contactPhone: "" });
      if (created?.id) setLocation(`/admin/clubs/${created.id}`);
    },
    onError: (e: any) => toast({ title: "Couldn't create club", description: e.message, variant: "destructive" }),
  });

  const filtered = clubs.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.shortName?.toLowerCase().includes(search.toLowerCase()) ?? false)
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-white/40" />
            <h1 className="text-2xl font-bold text-white">Clubs</h1>
          </div>
          <p className="text-sm text-white/40 mt-1">Participating clubs across all tournaments in this organisation.</p>
        </div>
        <Button onClick={() => setShowNew(true)} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-new-club">
          <Plus className="w-4 h-4 mr-1" /> New Club
        </Button>
      </div>

      <Input
        type="text"
        placeholder="Search clubs…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="bg-white/[0.02] border-white/10 text-white"
        data-testid="input-club-search"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-white/[0.02] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-12 text-center">
          <Shield className="w-10 h-10 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/50">
            {clubs.length === 0 ? "No clubs yet — create your first." : "No clubs match your search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => setLocation(`/admin/clubs/${c.id}`)}
              className="flex items-center gap-3 p-4 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition text-left"
              data-testid={`club-card-${c.id}`}
            >
              <ClubCrest club={c} size={48} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white truncate">{c.name}</div>
                <div className="text-xs text-white/40 truncate">
                  {c.contactName || c.contactEmail || c.shortName || "No contact yet"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="rounded-2xl bg-[#0c0c0e] border border-white/10 max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">New Club</h2>
              <button onClick={() => setShowNew(false)} className="text-white/40 hover:text-white/70"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/40">Club name</label>
                <Input value={newClub.name} onChange={e => setNewClub({ ...newClub, name: e.target.value })} placeholder="Christchurch United FC" data-testid="input-new-club-name" />
              </div>
              <div>
                <label className="text-xs text-white/40">Short name (optional)</label>
                <Input value={newClub.shortName} onChange={e => setNewClub({ ...newClub, shortName: e.target.value })} placeholder="CUFC" />
              </div>
              <div>
                <label className="text-xs text-white/40">Primary contact name</label>
                <Input value={newClub.contactName} onChange={e => setNewClub({ ...newClub, contactName: e.target.value })} placeholder="Jane Smith" />
              </div>
              <div>
                <label className="text-xs text-white/40">Contact email</label>
                <Input type="email" value={newClub.contactEmail} onChange={e => setNewClub({ ...newClub, contactEmail: e.target.value })} placeholder="manager@cufc.co.nz" />
              </div>
              <div>
                <label className="text-xs text-white/40">Contact phone</label>
                <Input value={newClub.contactPhone} onChange={e => setNewClub({ ...newClub, contactPhone: e.target.value })} placeholder="021 123 4567" />
              </div>
            </div>
            <Button
              onClick={() => createMut.mutate({ ...newClub, organizationId: orgId })}
              disabled={!newClub.name || createMut.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-save-new-club"
            >
              {createMut.isPending ? "Creating…" : "Create Club"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
