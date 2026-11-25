/**
 * USG → Sponsorship → Partners → By asset.
 * Daniel, 2026-11-25: "make us be able to sort sponsors by asset like here view"
 * — the budget sheet's Sponsorship tab: CLUB → Kit / Digital & programme /
 * Physical → each position, who holds it, the staff member, target, contra,
 * actual. A position nobody holds reads "Available" (inventory still to sell).
 * Data: /api/admin/sponsorship/assets (server/sponsorship-partners.ts).
 * Grouping, order and totals: shared/sponsorship-assets.ts — only DISPLAYED here.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Copy } from "lucide-react";
import {
  ASSET_CLUBS, ASSET_GROUPS, assetTotals, clubLabel, compareAssets, groupLabel, isHeld, type AssetTotals,
} from "@shared/sponsorship-assets";

interface Asset {
  id: number; seasonYear: number; club: string; assetGroup: string; name: string; displayOrder: number;
  partnerId: number | null; businessName: string | null; staffName: string | null;
  targetCents: number | null; contraCents: number | null; actualCents: number | null; comments: string | null; source: string | null;
}
interface PartnerLite { id: number; company: string; logoUrl: string | null; logoGround: "light" | "dark" | null; archived: boolean }
interface AssetsResp { season: number; seasons: number[]; assets: Asset[]; partners: PartnerLite[]; unplaced: { id: number; company: string }[] }

const fmt = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`);
const toCents = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, ""); if (!t) return null;
  const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const toDollars = (c: number | null | undefined) => (c == null ? "" : String(c / 100));

async function readError(r: Response, fallback: string): Promise<string> {
  try { const j = await r.json(); return j?.message || fallback; } catch { return fallback; }
}

function TotalsLine({ t }: { t: AssetTotals }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55 tabular-nums">
      <span><span className="text-white font-semibold">{t.held}</span> of {t.positions} held</span>
      <span>Target <span className="text-white font-semibold">{fmt(t.targetCents)}</span></span>
      <span>Contra <span className="text-white font-semibold">{fmt(t.contraCents)}</span></span>
      <span>Actual <span className="text-emerald-400 font-semibold">{fmt(t.actualCents)}</span></span>
    </div>
  );
}

export function AssetsBoard({ onOpenPartner, search }: { onOpenPartner: (id: number) => void; search: string }) {
  const [season, setSeason] = useState<number | null>(() => {
    const v = Number(new URLSearchParams(window.location.search).get("season")); return Number.isInteger(v) && v > 0 ? v : null;
  });
  const [club, setClub] = useState<string>(() => new URLSearchParams(window.location.search).get("club") || "all");
  const [editing, setEditing] = useState<Asset | "new" | null>(null);
  const { toast } = useToast();

  const setUrl = (k: string, v: string | null) => {
    const u = new URL(window.location.href);
    if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v);
    try { window.history.replaceState(null, "", u.pathname + u.search + u.hash); } catch { /* ignore */ }
  };

  const { data, isLoading, error } = useQuery<AssetsResp>({
    queryKey: ["/api/admin/sponsorship/assets", { season }],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/sponsorship/assets${season ? `?season=${season}` : ""}`);
      if (!r.ok) throw new Error(await readError(r, `Could not load assets (${r.status})`));
      return r.json();
    },
  });

  const partnerById = useMemo(() => new Map((data?.partners ?? []).map(p => [p.id, p])), [data]);
  const holderName = (a: Asset) => (a.partnerId ? partnerById.get(a.partnerId)?.company ?? a.businessName : a.businessName) ?? "";

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.assets ?? []).filter(a => {
      if (club !== "all" && a.club !== club) return false;
      if (q && ![a.name, holderName(a), a.staffName, a.comments].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
      return true;
    }).sort(compareAssets);
  }, [data, club, search, partnerById]);

  const clubsPresent = useMemo(() => ASSET_CLUBS.filter(c => (data?.assets ?? []).some(a => a.club === c.key)), [data]);
  const byClub = useMemo(() => {
    const out: { club: string; groups: { group: string; rows: Asset[] }[]; all: Asset[] }[] = [];
    for (const a of visible) {
      let c = out.find(x => x.club === a.club); if (!c) { c = { club: a.club, groups: [], all: [] }; out.push(c); }
      let g = c.groups.find(x => x.group === a.assetGroup); if (!g) { g = { group: a.assetGroup, rows: [] }; c.groups.push(g); }
      g.rows.push(a); c.all.push(a);
    }
    return out;
  }, [visible]);

  const shownSeason = data?.season ?? season;
  const latest = data?.seasons?.[0] ?? null;
  const copy = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/admin/sponsorship/assets/copy-season", { from: latest, to: (latest ?? 0) + 1 });
      return r.json();
    },
    onSuccess: (res: any) => {
      toast({ title: `${res.copied} positions copied into ${res.season}`, description: "Same positions and targets, nobody holding them yet." });
      setSeason(res.season); setUrl("season", String(res.season));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/assets"] });
    },
    onError: (e: any) => toast({ title: "Could not copy", description: e.message, variant: "destructive" }),
  });

  const Holder = ({ a }: { a: Asset }) => {
    if (a.partnerId) {
      const p = partnerById.get(a.partnerId);
      return (
        <button onClick={() => onOpenPartner(a.partnerId!)} className="text-left font-semibold text-blue-400 hover:underline break-words min-h-[44px] md:min-h-0" data-testid={`asset-partner-${a.id}`}>
          {p?.company ?? a.businessName ?? "Partner"}
          {a.businessName && p && a.businessName !== p.company && <span className="block text-[11px] font-normal text-white/45">Sheet: {a.businessName}</span>}
        </button>
      );
    }
    if (a.businessName) return <div><div className="text-white/90 break-words">{a.businessName}</div><div className="text-[11px] text-amber-400">Not a signed partner here</div></div>;
    return <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">Available</span>;
  };

  return (
    <div className="space-y-4" data-testid="assets-board">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={shownSeason ? String(shownSeason) : ""} onValueChange={v => { setSeason(Number(v)); setUrl("season", v); }}>
          <SelectTrigger className="h-11 md:h-9 w-[120px]" data-testid="assets-season"><SelectValue placeholder="Season" /></SelectTrigger>
          <SelectContent>{(data?.seasons ?? []).map(y => <SelectItem key={y} value={String(y)}>{y} season</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex flex-wrap gap-1.5">
          {[{ key: "all", label: "All clubs" }, ...clubsPresent.map(c => ({ key: c.key, label: c.key.toUpperCase() }))].map(c => (
            <button key={c.key} onClick={() => { setClub(c.key); setUrl("club", c.key === "all" ? null : c.key); }} data-testid={`assets-club-${c.key}`}
              className={`text-xs font-semibold px-3 py-2 md:py-1.5 min-h-[44px] md:min-h-[32px] rounded-md border transition ${club === c.key ? "bg-blue-600 border-blue-600 text-white" : "border-white/10 text-white/60 hover:text-white bg-white/[0.02]"}`}>{c.label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {latest != null && shownSeason === latest && (
            <Button variant="outline" onClick={() => copy.mutate()} disabled={copy.isPending} className="min-h-[44px] md:min-h-0" data-testid="assets-copy-season">
              <Copy className="w-4 h-4 mr-1.5" />Start {latest + 1} from {latest}
            </Button>
          )}
          <Button onClick={() => setEditing("new")} className="bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-0" data-testid="assets-new"><Plus className="w-4 h-4 mr-1.5" />Add position</Button>
        </div>
      </div>

      {isLoading && <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
      {error && <div className="text-sm text-red-400 rounded-lg border border-red-500/30 bg-red-500/10 p-3">{(error as Error).message}</div>}
      {!isLoading && !error && data && byClub.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-white/50" data-testid="assets-empty">
          {data.assets.length === 0 ? "No positions for this season yet. Add position, or start it from last season." : "No positions match."}
        </div>
      )}

      {byClub.map(c => (
        <section key={c.club} className="rounded-xl border border-white/[0.08] overflow-hidden" data-testid={`assets-club-section-${c.club}`}>
          <div className="px-3 sm:px-4 py-3 bg-blue-600/10 border-b border-white/[0.06] flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">{clubLabel(c.club)}</h3>
            <TotalsLine t={assetTotals(c.all)} />
          </div>
          {c.groups.map(g => (
            <div key={g.group} className="border-b border-white/[0.06] last:border-b-0">
              <div className="px-3 sm:px-4 pt-3 pb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-blue-400">{groupLabel(g.group)}</h4>
                <TotalsLine t={assetTotals(g.rows)} />
              </div>
              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.06]">
                      {["Position", "Sponsor", "Staff", "Target", "Contra", "Actual", "Comments", ""].map(h => <th key={h} className="px-3 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(a => (
                      <tr key={a.id} className="border-b border-white/[0.04] last:border-b-0 align-top" data-testid={`asset-row-${a.id}`}>
                        <td className="px-3 py-2 text-white/90 min-w-[170px]">{a.name}</td>
                        <td className="px-3 py-2 min-w-[170px]"><Holder a={a} /></td>
                        <td className="px-3 py-2 text-white/70 whitespace-nowrap">{a.staffName || "—"}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap text-white/80">{fmt(a.targetCents)}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap text-white/80">{fmt(a.contraCents)}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap text-emerald-400 font-semibold">{fmt(a.actualCents)}</td>
                        <td className="px-3 py-2 text-[12px] text-white/55 max-w-[260px] break-words">{a.comments || ""}</td>
                        <td className="px-2 py-1.5 text-right"><Button size="icon" variant="ghost" onClick={() => setEditing(a)} title="Edit position" data-testid={`asset-edit-${a.id}`}><Pencil className="w-4 h-4" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Phone */}
              <div className="md:hidden px-3 pb-3 space-y-2">
                {g.rows.map(a => (
                  <div key={a.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3" data-testid={`asset-card-${a.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] text-white/50">{a.name}</div>
                        <Holder a={a} />
                      </div>
                      <Button size="icon" variant="ghost" className="h-11 w-11 flex-shrink-0" onClick={() => setEditing(a)} title="Edit position"><Pencil className="w-4 h-4" /></Button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-white/55 tabular-nums">
                      {a.staffName && <span>{a.staffName}</span>}
                      {a.targetCents != null && <span>Target {fmt(a.targetCents)}</span>}
                      {a.contraCents != null && <span>Contra {fmt(a.contraCents)}</span>}
                      {a.actualCents != null && <span className="text-emerald-400">Actual {fmt(a.actualCents)}</span>}
                    </div>
                    {a.comments && <div className="mt-1 text-[11px] text-white/45 break-words">{a.comments}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {data && club === "all" && !search.trim() && data.unplaced.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] p-3 sm:p-4" data-testid="assets-unplaced">
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-2">Signed partners with no position in {shownSeason}</div>
          <div className="flex flex-wrap gap-1.5">
            {data.unplaced.map(p => (
              <button key={p.id} onClick={() => onOpenPartner(p.id)} className="text-xs px-2.5 py-1.5 min-h-[44px] md:min-h-0 rounded-md border border-white/10 text-white/75 hover:text-white">{p.company}</button>
            ))}
          </div>
        </div>
      )}

      {editing && data && (
        <AssetDialog
          asset={editing === "new" ? null : editing}
          season={shownSeason ?? new Date().getFullYear()}
          defaultClub={club !== "all" ? club : "cufc"}
          partners={data.partners}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AssetDialog({ asset, season, defaultClub, partners, onClose }: { asset: Asset | null; season: number; defaultClub: string; partners: PartnerLite[]; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    club: asset?.club ?? defaultClub, assetGroup: asset?.assetGroup ?? "kit", name: asset?.name ?? "",
    partnerId: asset?.partnerId ? String(asset.partnerId) : "none", businessName: asset?.businessName ?? "", staffName: asset?.staffName ?? "",
    target: toDollars(asset?.targetCents), contra: toDollars(asset?.contraCents), actual: toDollars(asset?.actualCents), comments: asset?.comments ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/assets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sponsorship/partners"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        club: f.club, assetGroup: f.assetGroup, name: f.name, seasonYear: asset?.seasonYear ?? season,
        partnerId: f.partnerId === "none" ? null : Number(f.partnerId), businessName: f.businessName, staffName: f.staffName,
        targetCents: toCents(f.target), contraCents: toCents(f.contra), actualCents: toCents(f.actual), comments: f.comments,
      };
      const r = asset ? await apiRequest("PATCH", `/api/admin/sponsorship/assets/${asset.id}`, body) : await apiRequest("POST", "/api/admin/sponsorship/assets", body);
      return r.json();
    },
    onSuccess: () => { toast({ title: asset ? "Position saved" : "Position added" }); done(); },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/admin/sponsorship/assets/${asset!.id}`)).json(),
    onSuccess: () => { toast({ title: "Position removed" }); done(); },
    onError: (e: any) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });
  const live = partners.filter(p => !p.archived || String(p.id) === f.partnerId);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="asset-dialog">
        <DialogHeader><DialogTitle>{asset ? "Edit position" : "Add position"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Club</Label>
            <Select value={f.club} onValueChange={v => set("club", v)}>
              <SelectTrigger className="h-11 md:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{ASSET_CLUBS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Group</Label>
            <Select value={f.assetGroup} onValueChange={v => set("assetGroup", v)}>
              <SelectTrigger className="h-11 md:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{ASSET_GROUPS.map(g => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Position</Label>
            <Input value={f.name} onChange={e => set("name", e.target.value)} placeholder="Front of Shirt Home" className="h-11 md:h-9" data-testid="asset-name" />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Signed partner</Label>
            <Select value={f.partnerId} onValueChange={v => set("partnerId", v)}>
              <SelectTrigger className="h-11 md:h-9" data-testid="asset-partner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No partner (available, or a prospect below)</SelectItem>
                {live.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.company}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Business (as written)</Label>
            <Input value={f.businessName} onChange={e => set("businessName", e.target.value)} placeholder="If not a partner yet" className="h-11 md:h-9" />
          </div>
          <div className="space-y-1.5">
            <Label>Staff member</Label>
            <Input value={f.staffName} onChange={e => set("staffName", e.target.value)} className="h-11 md:h-9" />
          </div>
          <div className="space-y-1.5"><Label>Target ($)</Label><Input inputMode="decimal" value={f.target} onChange={e => set("target", e.target.value)} className="h-11 md:h-9" /></div>
          <div className="space-y-1.5"><Label>Contra ($)</Label><Input inputMode="decimal" value={f.contra} onChange={e => set("contra", e.target.value)} className="h-11 md:h-9" /></div>
          <div className="space-y-1.5"><Label>Actual income ($)</Label><Input inputMode="decimal" value={f.actual} onChange={e => set("actual", e.target.value)} className="h-11 md:h-9" /></div>
          <div className="space-y-1.5 col-span-2"><Label>Comments</Label><Textarea value={f.comments} onChange={e => set("comments", e.target.value)} rows={2} /></div>
          {asset?.source && <p className="col-span-2 text-[11px] text-white/40">Source: {asset.source}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {asset ? <Button variant="outline" className="text-red-400 min-h-[44px] md:min-h-0" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="min-h-[44px] md:min-h-0">Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()} className="bg-blue-600 hover:bg-blue-700 text-white min-h-[44px] md:min-h-0" data-testid="asset-save">Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
