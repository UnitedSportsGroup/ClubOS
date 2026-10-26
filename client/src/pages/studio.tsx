// Content Studio — every manager makes their own on-brand graphics, landing
// pages and video requests from one prompt; Rambo makes it, they own it.
//
// Daniel, 2026-10-27: "empower all of our staff to actually be building it in
// here … one-shot landing pages, one-shot graphics … it all comes on our
// subdomains … nobody deleting or overriding other people's content."
//
// This file is the front door (make something · everyone's pieces); the
// piece editor is studio-piece.tsx. One route, /admin/studio[/<id>].
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Image as ImageIcon, LayoutTemplate, Clapperboard, Mail, Loader2, ChevronRight, Globe, Clock, FileImage } from "lucide-react";
import { GRAPHIC_SIZES, studioKindLabel, type StudioKind } from "@shared/studio";
import { StudioPiece } from "./studio-piece";

const FACE = "/mailer/rambo.png";

export interface PieceSummary {
  id: number; brand: string; kind: StudioKind; title: string; slug: string | null; size: string | null; status: string; unlisted: boolean;
  doc: any; version: number; brief: string | null; createdByUserId: number; createdAt: string; updatedAt: string; publishedAt: string | null;
  publicViews: number; publicUrl: string | null; ownerName: string | null; canEdit: boolean; renderUrl: string | null;
}
export interface StudioUsage { used: number; limit: number; model: string; editModel: string; enabled: boolean; brand: { key: string; name: string; host: string }; firstName: string; isSuperAdmin: boolean }

export function whenLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

export default function StudioRoute() {
  const [location] = useLocation();
  const m = /^\/admin\/studio\/(\d+)/.exec(location);
  if (m) return <StudioPiece id={Number(m[1])} />;
  return <StudioHome />;
}

function StudioHome() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: usage } = useQuery<StudioUsage>({ queryKey: ["/api/admin/studio/usage"], queryFn: async () => (await workspaceFetch("/api/admin/studio/usage")).json() });
  const { data: list, isLoading } = useQuery<{ pieces: PieceSummary[] }>({ queryKey: ["/api/admin/studio/pieces"], queryFn: async () => (await workspaceFetch("/api/admin/studio/pieces")).json() });
  const [filter, setFilter] = useState<"all" | "mine" | StudioKind>("all");
  const [composer, setComposer] = useState<StudioKind | null>(null);
  const [brief, setBrief] = useState("");
  const [size, setSize] = useState("square");
  const [footage, setFootage] = useState("");
  const [format, setFormat] = useState<"landscape" | "vertical" | "both">("landscape");
  const [length, setLength] = useState(60);
  const { data: me } = useQuery<{ id?: number }>({ queryKey: ["/api/auth/me"] });

  const make = useMutation({
    mutationFn: async () => {
      if (composer === "video") {
        const res = await apiRequest("POST", "/api/admin/studio/video", { brief, footage: footage.split(/\n+/).map((s) => s.trim()).filter(Boolean), format, lengthSeconds: length });
        return res.json();
      }
      const res = await apiRequest("POST", "/api/admin/studio/generate", { kind: composer, brief, size: composer === "graphic" ? size : undefined });
      const j = JSON.parse((await res.text()).trim());
      if (!j.ok) throw new Error(j.message || "Rambo couldn't make that.");
      return j;
    },
    onSuccess: (j: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/studio/pieces"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/studio/usage"] });
      setBrief(""); setFootage("");
      if (j.reply) toast({ title: "Rambo", description: j.reply });
      navigate(`/admin/studio/${j.piece.id}`);
    },
    onError: (e: any) => toast({ title: "Couldn't make it", description: e?.message, variant: "destructive" }),
  });

  const pieces = useMemo(() => {
    const all = list?.pieces ?? [];
    if (filter === "all") return all;
    if (filter === "mine") return all.filter((p) => p.createdByUserId === me?.id);
    return all.filter((p) => p.kind === filter);
  }, [list, filter, me?.id]);

  const capped = usage ? usage.used >= usage.limit : false;
  const canMake = !!composer && brief.trim().length > 8 && !make.isPending && !capped && (composer !== "video" || footage.trim().length > 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <img src={FACE} alt="" className="w-11 h-11 rounded-xl shrink-0" />
          <div>
            <h1 className="text-xl font-semibold text-foreground" data-testid="studio-title">Content Studio</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Rambo makes it, you own it. Graphics, landing pages and video requests, on {usage?.brand.name ?? "your brand"}'s look and on the club's own site.</p>
          </div>
        </div>
        {usage && (
          <div className="text-xs text-muted-foreground text-right" data-testid="studio-usage">
            <div><span className="font-semibold text-foreground">{usage.used} of {usage.limit}</span> today</div>
            <div>shared with Rambo and the Mailer</div>
          </div>
        )}
      </div>

      {/* Make something */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="studio-make">
        {([
          ["graphic", ImageIcon, "A graphic", "A post, a story, an event card, a big number or a chart. Square, portrait, story or landscape."],
          ["page", LayoutTemplate, "A landing page", `Built from a brief with the real dates, prices and booking links, published at ${usage?.brand.host ?? "the club's site"}/p/…`],
          ["video", Clapperboard, "A video", "From real footage — your phone clips or the Drive. Give the brief and the footage; it's cut and delivered back here."],
        ] as const).map(([kind, Icon, title, blurb]) => (
          <button key={kind} type="button" onClick={() => setComposer(composer === kind ? null : kind)}
            className={`text-left rounded-2xl border p-4 transition-colors ${composer === kind ? "border-blue-500/50 bg-blue-500/[0.06]" : "border-border bg-card hover:border-blue-500/30"}`}
            data-testid={`studio-make-${kind}`}>
            <span className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center mb-3"><Icon className="w-5 h-5" /></span>
            <div className="font-semibold text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{blurb}</div>
          </button>
        ))}
        <a href="/admin/mailer" className="text-left rounded-2xl border border-border bg-card p-4 hover:border-blue-500/30 transition-colors" data-testid="studio-make-email">
          <span className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-600 flex items-center justify-center mb-3"><Mail className="w-5 h-5" /></span>
          <div className="font-semibold text-foreground">An email</div>
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed">The Mailer, with Rambo in the builder. It knows the programmes and the brand's voice.</div>
        </a>
      </div>

      {composer && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3" data-testid="studio-composer">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><img src={FACE} alt="" className="w-6 h-6 rounded-md" />{composer === "video" ? "Request a video" : `Tell Rambo what you want — ${studioKindLabel(composer).toLowerCase()}`}</div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder={composer === "graphic"
              ? "e.g. A square post for the October holiday camp, U4–U8, last spots, book at cufc.co.nz/camps. Or: a chart of U4–U8 sign-ups by term: T1 140, T2 155, T3 149, T4 162."
              : composer === "page"
                ? "e.g. A landing page for Football in Schools: what a term looks like, who it's for, the price per term and the starter kit, how a school books a free session."
                : "What the video is for, who it's for, what it should show, and the feel. e.g. 45 seconds of the gymnastics holiday programme for Facebook, upbeat, ends on the free session."}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[15px] leading-relaxed text-foreground"
            data-testid="studio-brief"
          />
          {composer === "graphic" && (
            <div className="flex flex-wrap gap-2" data-testid="studio-sizes">
              {GRAPHIC_SIZES.map((s) => (
                <button key={s.key} type="button" onClick={() => setSize(s.key)} title={s.use}
                  className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${size === s.key ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}
                  data-testid={`studio-size-${s.key}`}>
                  {s.label} <span className="opacity-60">{s.width}×{s.height}</span>
                </button>
              ))}
            </div>
          )}
          {composer === "video" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Where the footage is (one link per line)</span>
                <textarea value={footage} onChange={(e) => setFootage(e.target.value)} rows={3} placeholder={"https://app.usg.co.nz/admin/drive/…\nor a NAS path, or a Google Drive link"} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[13px] font-mono text-foreground" data-testid="studio-footage" />
              </label>
              <div className="space-y-3">
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Format</span>
                  <div className="flex flex-wrap gap-2">
                    {(["landscape", "vertical", "both"] as const).map((f) => (
                      <button key={f} type="button" onClick={() => setFormat(f)} className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium capitalize ${format === f ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}>{f}</button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">About how long (seconds)</span>
                  <Input type="number" min={10} max={600} value={length} onChange={(e) => setLength(Number(e.target.value) || 60)} className="h-11 md:h-9 w-32" data-testid="studio-length" />
                </label>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {composer === "video"
                ? "No model runs here. The request goes to the editing queue and the finished cut comes back to this piece."
                : capped ? "You've used today's prompts. It resets at midnight, or a super admin can raise your limit in Team."
                  : `One prompt. Rambo uses the live programme facts and ${usage?.brand.name ?? "the brand"}'s own pictures; every word can be changed afterwards without re-prompting.`}
            </p>
            <Button onClick={() => make.mutate()} disabled={!canMake} className="h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white px-5" data-testid="studio-make-go">
              {make.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{composer === "page" ? "Building the page…" : "Making it…"}</> : composer === "video" ? "Send the request" : "Make it"}
            </Button>
          </div>
        </div>
      )}

      {/* Everyone's pieces */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {([["all", "All"], ["mine", "Mine"], ["graphic", "Graphics"], ["page", "Pages"], ["video", "Videos"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${filter === k ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid={`studio-filter-${k}`}>{label}</button>
          ))}
        </div>
        {isLoading ? (
          <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : pieces.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="studio-empty">Nothing here yet. Pick a card above and tell Rambo what you want.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="studio-pieces">
            {pieces.map((p) => <PieceCard key={p.id} piece={p} onOpen={() => navigate(`/admin/studio/${p.id}`)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PieceCard({ piece: p, onOpen }: { piece: PieceSummary; onOpen: () => void }) {
  const status = p.kind === "video" ? (p.doc?.status === "delivered" ? "Delivered" : p.doc?.status === "in_progress" ? "Being cut" : "Requested") : p.status === "published" ? "Published" : "Draft";
  const tone = status === "Published" || status === "Delivered" ? "bg-emerald-500/10 text-emerald-700" : status === "Being cut" ? "bg-amber-500/10 text-amber-700" : "bg-muted text-muted-foreground";
  const headline = p.kind === "graphic" ? p.doc?.headline : p.kind === "page" ? p.doc?.blocks?.[0]?.headline : p.doc?.brief;
  return (
    <button type="button" onClick={onOpen} className="text-left rounded-2xl border border-border bg-card overflow-hidden hover:border-blue-500/30 transition-colors" data-testid={`studio-piece-${p.id}`}>
      <div className="aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
        {p.kind === "graphic" && p.renderUrl ? (
          <img src={p.renderUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="p-4 text-center">
            {p.kind === "graphic" ? <FileImage className="w-8 h-8 mx-auto text-muted-foreground/60" /> : p.kind === "page" ? <Globe className="w-8 h-8 mx-auto text-muted-foreground/60" /> : <Clapperboard className="w-8 h-8 mx-auto text-muted-foreground/60" />}
            <div className="mt-2 text-[13px] font-semibold text-foreground/80 line-clamp-2">{headline || p.title}</div>
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[14px] font-semibold text-foreground truncate">{p.title}</div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${tone}`}>{status}</span>
        </div>
        <div className="text-[12px] text-muted-foreground mt-1 flex items-center gap-1.5 truncate">
          <span>{studioKindLabel(p.kind)}</span>·<span>{p.ownerName || "someone"}</span>·<Clock className="w-3 h-3" /><span>{whenLabel(p.updatedAt)}</span>
          {p.canEdit ? null : <span className="ml-auto text-[10px] text-muted-foreground/80">view · duplicate</span>}
        </div>
      </div>
      <div className="sr-only"><ChevronRight /></div>
    </button>
  );
}
