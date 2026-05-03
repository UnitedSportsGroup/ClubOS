import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Shield, Upload, Trash2, Save, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Club, TournamentTeam } from "@shared/schema";

function avifSiblingFor(webpUrl: string): string | null {
  return /\.webp(\?|$)/i.test(webpUrl) ? webpUrl.replace(/\.webp(\?|$)/i, ".avif$1") : null;
}

function ClubCrest({ club, size = 96 }: { club: Club; size?: number }) {
  if (club.logoUrl) {
    const avif = avifSiblingFor(club.logoUrl);
    return (
      <picture>
        {avif && <source srcSet={avif} type="image/avif" />}
        <img
          src={club.logoUrl}
          alt={`${club.name} logo`}
          width={size}
          height={size}
          className="rounded-2xl object-cover bg-white/[0.03]"
          style={{ width: size, height: size }}
        />
      </picture>
    );
  }
  return (
    <div
      className="rounded-2xl flex items-center justify-center bg-white/[0.03] border border-white/5"
      style={{ width: size, height: size }}
    >
      <Shield className="w-1/2 h-1/2 text-white/20" />
    </div>
  );
}

function LogoUploader({ club }: { club: Club }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/clubs/${club.id}/logo`, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Upload failed (${res.status})`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs", club.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs"] });
      toast({ title: "Logo updated" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/admin/clubs/${club.id}/logo`);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs", club.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs"] });
      toast({ title: "Logo removed" });
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
      />
      <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy} className="text-xs">
        {busy ? "Uploading…" : <><Upload className="w-3 h-3 mr-1" />{club.logoUrl ? "Replace" : "Upload"}</>}
      </Button>
      {club.logoUrl && !busy && (
        <Button size="sm" variant="ghost" onClick={remove} className="text-xs text-white/40 hover:text-red-400">
          <Trash2 className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

export default function ClubDetail() {
  const [, params] = useRoute("/admin/clubs/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ? parseInt(params.id) : 0;
  const { toast } = useToast();

  const { data: club, isLoading } = useQuery<Club>({
    queryKey: ["/api/admin/clubs", id],
    queryFn: () => fetch(`/api/admin/clubs/${id}`).then(r => r.json()),
    enabled: !!id,
  });

  const { data: teams = [] } = useQuery<TournamentTeam[]>({
    queryKey: ["/api/admin/clubs", id, "teams"],
    queryFn: () => fetch(`/api/admin/clubs/${id}/teams`).then(r => r.json()),
    enabled: !!id,
  });

  const [form, setForm] = useState({
    name: "", shortName: "", contactName: "", contactEmail: "", contactPhone: "",
    primaryColor: "", secondaryColor: "", website: "", notes: "",
  });
  const [dirty, setDirty] = useState(false);

  // Hydrate form when club loads
  useEffect(() => {
    if (club) {
      setForm({
        name: club.name,
        shortName: club.shortName ?? "",
        contactName: club.contactName ?? "",
        contactEmail: club.contactEmail ?? "",
        contactPhone: club.contactPhone ?? "",
        primaryColor: club.primaryColor ?? "",
        secondaryColor: club.secondaryColor ?? "",
        website: club.website ?? "",
        notes: club.notes ?? "",
      });
      setDirty(false);
    }
  }, [club]);

  const saveMut = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/admin/clubs/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs"] });
      toast({ title: "Saved" });
      setDirty(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/clubs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/clubs"] });
      toast({ title: "Club deleted" });
      setLocation("/admin/clubs");
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !club) {
    return <div className="p-6"><div className="h-32 rounded-2xl bg-white/[0.02] animate-pulse" /></div>;
  }

  const onChange = (k: keyof typeof form, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    setDirty(true);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setLocation("/admin/clubs")}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 text-white/30"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold text-white">{club.name}</h1>
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 flex items-start gap-6">
        <ClubCrest club={club} size={96} />
        <div className="flex-1 space-y-3">
          <div>
            <div className="text-xs text-white/40 uppercase tracking-wide">Club logo</div>
            <p className="text-sm text-white/60 mt-1">
              This logo appears on the app for every team this club enters, unless a specific team uploads its own.
            </p>
          </div>
          <LogoUploader club={club} />
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/70">Club details</h2>
          {dirty && (
            <Button size="sm" onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
              <Save className="w-3 h-3 mr-1" /> Save
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={e => onChange("name", e.target.value)} />
          </Field>
          <Field label="Short name">
            <Input value={form.shortName} onChange={e => onChange("shortName", e.target.value)} placeholder="e.g. CUFC" />
          </Field>
          <Field label="Primary contact name">
            <Input value={form.contactName} onChange={e => onChange("contactName", e.target.value)} />
          </Field>
          <Field label="Contact email">
            <Input type="email" value={form.contactEmail} onChange={e => onChange("contactEmail", e.target.value)} />
          </Field>
          <Field label="Contact phone">
            <Input value={form.contactPhone} onChange={e => onChange("contactPhone", e.target.value)} />
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={e => onChange("website", e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Primary color">
            <div className="flex items-center gap-2">
              <Input value={form.primaryColor} onChange={e => onChange("primaryColor", e.target.value)} placeholder="#22399B" />
              {form.primaryColor && <div className="w-8 h-8 rounded border border-white/10" style={{ background: form.primaryColor }} />}
            </div>
          </Field>
          <Field label="Secondary color">
            <div className="flex items-center gap-2">
              <Input value={form.secondaryColor} onChange={e => onChange("secondaryColor", e.target.value)} placeholder="#FFFFFF" />
              {form.secondaryColor && <div className="w-8 h-8 rounded border border-white/10" style={{ background: form.secondaryColor }} />}
            </div>
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={e => onChange("notes", e.target.value)}
            rows={3}
            className="w-full rounded-md bg-white/[0.02] border border-white/10 text-white text-sm px-3 py-2 resize-none"
            placeholder="Anything Isaac or future tournament directors should know."
          />
        </Field>
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-white/40" />
          <h2 className="text-sm font-semibold text-white/70">Teams ({teams.length})</h2>
        </div>
        {teams.length === 0 ? (
          <p className="text-xs text-white/40">No teams linked to this club yet. Link from a tournament's Teams tab.</p>
        ) : (
          <div className="space-y-2">
            {teams.map(t => (
              <button
                key={t.id}
                onClick={() => setLocation(`/admin/tournaments/${t.tournamentId}/teams/${t.id}`)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 text-left"
              >
                <div className="text-sm text-white">{t.name}</div>
                <div className="text-xs text-white/40">Tournament #{t.tournamentId}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-white/5">
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm(`Delete "${club.name}"? Teams already linked to this club will lose the link but stay in their tournaments.`)) {
              deleteMut.mutate();
            }
          }}
          className="text-red-400 hover:text-red-300 text-xs"
        >
          <Trash2 className="w-3 h-3 mr-1" /> Delete club
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/40 block mb-1">{label}</label>
      {children}
    </div>
  );
}
