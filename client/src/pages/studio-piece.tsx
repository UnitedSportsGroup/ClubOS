// One piece: the preview on the left, and on the right the words (edit any
// field, save — no re-prompt), Rambo (ask for a change), the pictures,
// versions, and the piece's settings (download the PNG · publish the page ·
// duplicate · archive). Owner-only edits; everyone else sees it and can
// duplicate it (Daniel: "nobody deleting or overriding other people's content").
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, Download, Link as LinkIcon, Check, Loader2, Globe, EyeOff, CopyPlus, Trash2, History, Settings2, Type, Image as ImageIcon, Upload, ExternalLink } from "lucide-react";
import { applyField, graphicFields, graphicSize, GRAPHIC_SIZES, pageFields, readField, studioKindLabel, type GraphicDoc, type PageDoc, type TextField, type VideoDoc } from "@shared/studio";
import { renderPage } from "@shared/studio-render";
import { GraphicArtboard, exportArtboardPng } from "@/components/studio/artboard";
import { FieldList } from "@/components/studio/fields";
import { whenLabel, type PieceSummary, type StudioUsage } from "./studio";

const FACE = "/mailer/rambo.png";
type Tab = "words" | "rambo" | "pictures" | "versions" | "settings";

interface Detail { piece: PieceSummary; versions: { version: number; how: string; note: string | null; createdAt: string; by: string | null }[]; renders: { version: number; url: string; width: number; height: number }[] }

export function StudioPiece({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/content-studio/pieces", id];
  const { data, isLoading, error } = useQuery<Detail>({ queryKey: key, queryFn: async () => { const r = await workspaceFetch(`/api/admin/content-studio/pieces/${id}`); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Not found"); return r.json(); } });
  const { data: usage } = useQuery<StudioUsage>({ queryKey: ["/api/admin/content-studio/usage"], queryFn: async () => (await workspaceFetch("/api/admin/content-studio/usage")).json() });
  const piece = data?.piece;
  const [tab, setTab] = useState<Tab>("words");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const artboardNode = useRef<HTMLElement | null>(null);
  useEffect(() => { setEdits({}); setRenderUrl(data?.piece.renderUrl ?? null); }, [data?.piece.version, data?.piece.renderUrl]);

  const canEdit = !!piece?.canEdit;
  const doc = piece?.doc;
  // The document as it reads with the unsaved edits applied — the preview follows every keystroke.
  const liveDoc = useMemo(() => {
    if (!doc) return doc;
    let d: any = doc;
    for (const [path, v] of Object.entries(edits)) d = applyField(d, path, v);
    return d;
  }, [doc, edits]);
  const fields: TextField[] = useMemo(() => {
    if (!piece || !liveDoc) return [];
    if (piece.kind === "graphic") return graphicFields(liveDoc as GraphicDoc);
    if (piece.kind === "page") return pageFields(liveDoc as PageDoc);
    const v = liveDoc as VideoDoc;
    return [
      { path: "brief", label: "The brief", value: v.brief, multiline: true },
      ...v.footage.map((f, i) => ({ path: `footage.${i}`, label: `Footage ${i + 1}`, value: f, href: true })),
      { path: "notes", label: "Notes", value: v.notes ?? "", multiline: true },
    ];
  }, [piece, liveDoc]);
  const dirty = Object.keys(edits).length > 0;

  const invalidate = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pieces"] }); qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/usage"] }); };
  const patch = useMutation({
    mutationFn: async (body: any) => { const r = await apiRequest("PATCH", `/api/admin/content-studio/pieces/${id}`, body); return r.json(); },
    onSuccess: () => invalidate(),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const saveWords = () => patch.mutate({ doc: liveDoc, note: `${Object.keys(edits).length} field${Object.keys(edits).length === 1 ? "" : "s"} edited` }, { onSuccess: () => { setEdits({}); toast({ title: "Saved", description: "The words are updated. A new version was kept." }); } });

  const askRambo = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/admin/content-studio/pieces/${id}/ask`, { instruction: ask, history: chat });
      const j = JSON.parse((await r.text()).trim());
      if (!j.ok) throw new Error(j.message || "Rambo couldn't make that change.");
      return j;
    },
    onSuccess: (j: any) => { setChat((c) => [...c, { role: "user", content: ask }, { role: "assistant", content: j.reply }]); setAsk(""); setEdits({}); invalidate(); if (!j.changed) toast({ title: "Rambo", description: j.reply }); },
    onError: (e: any) => toast({ title: "Rambo", description: e?.message, variant: "destructive" }),
  });
  const publish = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("POST", `/api/admin/content-studio/pieces/${id}/${on ? "publish" : "unpublish"}`, {})).json(),
    onSuccess: (j: any) => { invalidate(); toast({ title: j.url ? "Published" : "Taken down", description: j.url ?? "The page is a draft again." }); },
    onError: (e: any) => toast({ title: "Couldn't publish", description: e?.message, variant: "destructive" }),
  });
  const duplicate = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/content-studio/pieces/${id}/duplicate`, {})).json(),
    onSuccess: (j: any) => { qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pieces"] }); navigate(`/admin/content-studio/${j.piece.id}`); toast({ title: "Your copy", description: "Edit it as you like — the original is untouched." }); },
  });
  const archive = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/admin/content-studio/pieces/${id}`)).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pieces"] }); navigate("/admin/content-studio"); toast({ title: "Removed", description: "Its versions are kept." }); },
  });
  const restore = useMutation({
    mutationFn: async (version: number) => { const r = await workspaceFetch(`/api/admin/content-studio/pieces/${id}/versions/${version}`); const v = await r.json(); return patch.mutateAsync({ doc: v.doc, note: `put back version ${version}` }); },
    onSuccess: () => toast({ title: "Put back", description: "That version is the current one again (as a new version)." }),
  });

  const [exporting, setExporting] = useState(false);
  const downloadPng = async () => {
    if (!piece || !artboardNode.current) return;
    const size = graphicSize(piece.size);
    setExporting(true);
    try {
      const blob = await exportArtboardPng(artboardNode.current, size.width, size.height);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${piece.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${size.width}x${size.height}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const fd = new FormData();
      fd.append("file", blob, "graphic.png");
      const r = await workspaceFetch(`/api/admin/content-studio/pieces/${id}/render`, { method: "POST", body: fd });
      const j = await r.json();
      if (j.ok) { setRenderUrl(j.url); qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pieces"] }); }
    } catch (e: any) {
      toast({ title: "Couldn't export", description: e?.message, variant: "destructive" });
    } finally { setExporting(false); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast({ title: "Copy this", description: text }); } };

  if (isLoading) return <div className="p-10 flex justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (error || !piece || !liveDoc) return <div className="p-6 text-sm text-muted-foreground">That piece isn't here. <button className="underline" onClick={() => navigate("/admin/content-studio")}>Back to Studio</button></div>;

  const pageHtml = piece.kind === "page" ? renderPage(liveDoc as PageDoc, piece.brand, { noindex: true, url: piece.publicUrl ?? undefined, draftNote: piece.status === "published" ? undefined : "Draft preview — publish to put it on the club's site." }) : "";
  const video = piece.kind === "video" ? (liveDoc as VideoDoc) : null;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="outline" onClick={() => navigate("/admin/content-studio")} className="h-11 md:h-9 border-border" data-testid="studio-back"><ChevronLeft className="w-4 h-4 mr-1" />Studio</Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground truncate" data-testid="studio-piece-title">{piece.title}</h1>
            <div className="text-xs text-muted-foreground">{studioKindLabel(piece.kind)} · {piece.ownerName || "someone"} · v{piece.version} · {whenLabel(piece.updatedAt)}{!canEdit ? " · someone else's — duplicate to edit" : ""}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {piece.kind === "graphic" && (
            <Button onClick={downloadPng} disabled={exporting} className="h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white" data-testid="studio-download">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}Download PNG
            </Button>
          )}
          {piece.kind === "graphic" && renderUrl && (
            <Button variant="outline" onClick={() => copy(renderUrl)} className="h-11 md:h-9 border-border" data-testid="studio-copy-link">{copied ? <Check className="w-4 h-4 mr-2" /> : <LinkIcon className="w-4 h-4 mr-2" />}Copy link</Button>
          )}
          {piece.kind === "page" && canEdit && piece.status !== "published" && (
            <Button onClick={() => publish.mutate(true)} disabled={publish.isPending || dirty} title={dirty ? "Save the words first" : undefined} className="h-11 md:h-9 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="studio-publish"><Globe className="w-4 h-4 mr-2" />Publish</Button>
          )}
          {piece.kind === "page" && piece.status === "published" && piece.publicUrl && (
            <>
              <a href={piece.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center h-11 md:h-9 px-3 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted" data-testid="studio-open-page"><ExternalLink className="w-4 h-4 mr-2" />Open</a>
              <Button variant="outline" onClick={() => copy(piece.publicUrl!)} className="h-11 md:h-9 border-border" data-testid="studio-copy-link">{copied ? <Check className="w-4 h-4 mr-2" /> : <LinkIcon className="w-4 h-4 mr-2" />}Copy link</Button>
            </>
          )}
          {!canEdit && <Button variant="outline" onClick={() => duplicate.mutate()} className="h-11 md:h-9 border-border" data-testid="studio-duplicate"><CopyPlus className="w-4 h-4 mr-2" />Duplicate to edit</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4">
        {/* Preview */}
        <div className="rounded-2xl border border-border bg-muted/40 p-4 min-w-0" data-testid="studio-preview">
          {piece.kind === "graphic" && (
            <div className="flex justify-center"><GraphicArtboard doc={liveDoc as GraphicDoc} sizeKey={piece.size ?? "square"} brand={piece.brand} maxWidth={640} onNode={(n) => { artboardNode.current = n; }} /></div>
          )}
          {piece.kind === "page" && (
            <iframe title="Page preview" srcDoc={pageHtml} sandbox="" className="w-full bg-white rounded-xl border border-border" style={{ height: 720 }} data-testid="studio-page-preview" />
          )}
          {video && (
            <div className="space-y-3 text-sm text-foreground">
              <div className="flex items-center gap-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${video.status === "delivered" ? "bg-emerald-500/10 text-emerald-700" : video.status === "in_progress" ? "bg-amber-500/10 text-amber-700" : "bg-muted text-muted-foreground"}`} data-testid="studio-video-status">{video.status === "delivered" ? "Delivered" : video.status === "in_progress" ? "Being cut" : "Requested"}</span><span className="text-xs text-muted-foreground">{video.format} · about {video.lengthSeconds}s</span></div>
              <p className="leading-relaxed whitespace-pre-wrap">{video.brief}</p>
              {video.footage.length > 0 && <div className="text-xs text-muted-foreground space-y-1"><div className="font-semibold uppercase tracking-wider text-[10px]">Footage</div>{video.footage.map((f, i) => <div key={i} className="font-mono break-all">{f}</div>)}</div>}
              {video.deliveredUrl ? <a href={video.deliveredUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-600 underline" data-testid="studio-video-delivered"><ExternalLink className="w-4 h-4" />Watch the finished cut</a> : <p className="text-xs text-muted-foreground">No model runs for a video — it is cut from your footage by the editing kit and the link lands here when it's done.</p>}
            </div>
          )}
        </div>

        {/* Panel */}
        <div className="rounded-2xl border border-border bg-card min-w-0 flex flex-col">
          <div className="flex border-b border-border overflow-x-auto" data-testid="studio-tabs">
            {([["words", Type, "Words"], ["rambo", null, "Rambo"], ["pictures", ImageIcon, "Pictures"], ["versions", History, "Versions"], ["settings", Settings2, "Settings"]] as const)
              .filter(([k]) => !(piece.kind === "video" && (k === "rambo" || k === "pictures")))
              .map(([k, Icon, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 min-h-11 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px ${tab === k ? "border-blue-600 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`studio-tab-${k}`}>
                  {Icon ? <Icon className="w-4 h-4" /> : <img src={FACE} alt="" className="w-4 h-4 rounded" />}{label}
                </button>
              ))}
          </div>
          <div className="p-4 overflow-y-auto max-h-[70vh]">
            {tab === "words" && (
              <div className="space-y-3">
                {/* The save bar sits on TOP, sticky: twenty fields on a phone
                    must never bury the one button that matters. */}
                {canEdit && (
                  <div className="sticky -top-4 z-10 -mx-4 px-4 py-2 bg-card border-b border-border flex items-center gap-2" data-testid="studio-save-bar">
                    <Button onClick={saveWords} disabled={!dirty || patch.isPending} className="h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white" data-testid="studio-save-words">{patch.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}Save words</Button>
                    {dirty && <button type="button" className="text-xs text-muted-foreground underline min-h-11 md:min-h-9" onClick={() => setEdits({})}>Discard</button>}
                    {!dirty && <span className="text-xs text-muted-foreground">Change any box and save. No re-prompt, no wait.</span>}
                  </div>
                )}
                <FieldList fields={fields} values={edits} onChange={(path, v) => setEdits((e) => ({ ...e, [path]: v }))} disabled={!canEdit} />
              </div>
            )}
            {tab === "rambo" && (
              <div className="space-y-3">
                <div className="space-y-2 max-h-72 overflow-y-auto" data-testid="studio-chat">
                  {chat.length === 0 && <p className="text-xs text-muted-foreground">Ask for a change in plain words: "make the headline punchier", "use the podium photo", "add a section about what to bring", "turn it into a story size". Each ask is one prompt against today's allowance.</p>}
                  {chat.map((m, i) => (
                    <div key={i} className={`text-[13px] rounded-xl px-3 py-2 ${m.role === "user" ? "bg-blue-600 text-white ml-6" : "bg-muted text-foreground mr-6"}`}>{m.content}</div>
                  ))}
                </div>
                <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={3} disabled={!canEdit} placeholder={canEdit ? "What should change?" : "Duplicate this piece to ask Rambo to change your copy."} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[14px] text-foreground" data-testid="studio-ask" />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{usage ? `${usage.used} of ${usage.limit} today` : ""}</span>
                  <Button onClick={() => askRambo.mutate()} disabled={!canEdit || ask.trim().length < 3 || askRambo.isPending} className="h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white" data-testid="studio-ask-go">{askRambo.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Working…</> : "Ask Rambo"}</Button>
                </div>
              </div>
            )}
            {tab === "pictures" && <PicturePicker piece={piece} liveDoc={liveDoc} canEdit={canEdit} onPick={(path, url) => setEdits((e) => ({ ...e, [path]: url }))} />}
            {tab === "versions" && (
              <div className="space-y-2" data-testid="studio-versions">
                {data!.versions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between gap-2 text-[13px] border-b border-border pb-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">v{v.version} · {v.how === "made" ? "made by Rambo" : v.how === "asked" ? "Rambo changed it" : v.how === "edited" ? "words edited" : "duplicated"}</div>
                      <div className="text-xs text-muted-foreground truncate">{v.note || ""} · {v.by || "someone"} · {whenLabel(v.createdAt)}</div>
                    </div>
                    {canEdit && v.version !== piece.version && <Button size="sm" variant="outline" onClick={() => restore.mutate(v.version)} disabled={restore.isPending} className="h-9 border-border shrink-0">Put back</Button>}
                  </div>
                ))}
              </div>
            )}
            {tab === "settings" && (
              <div className="space-y-4" data-testid="studio-settings">
                <label className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Name</span>
                  <Input defaultValue={piece.title} disabled={!canEdit} onBlur={(e) => { const t = e.target.value.trim(); if (canEdit && t && t !== piece.title) patch.mutate({ title: t }); }} className="h-11 md:h-10" data-testid="studio-settings-title" />
                </label>
                {piece.kind === "graphic" && (
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Size</span>
                    <div className="flex flex-wrap gap-2">
                      {GRAPHIC_SIZES.map((s) => (
                        <button key={s.key} type="button" disabled={!canEdit} onClick={() => patch.mutate({ size: s.key })} className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${piece.size === s.key ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid={`studio-settings-size-${s.key}`}>{s.label}</button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">The same words, re-laid for the size. Download again after changing it.</p>
                  </div>
                )}
                {piece.kind === "page" && (
                  <>
                    <label className="block">
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Address — {usage?.brand.host ?? "the club's site"}/p/…</span>
                      <Input defaultValue={piece.slug ?? ""} disabled={!canEdit} placeholder="football-in-schools" onBlur={(e) => { const s = e.target.value.trim(); if (canEdit && s && s !== piece.slug) patch.mutate({ slug: s }); }} className="h-11 md:h-10 font-mono text-[13px]" data-testid="studio-settings-slug" />
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={!piece.unlisted} disabled={!canEdit} onChange={(e) => patch.mutate({ unlisted: !e.target.checked })} className="mt-1 w-5 h-5 accent-blue-600" data-testid="studio-settings-listed" />
                      <span className="text-[13px] text-foreground">Let search engines find it<span className="block text-xs text-muted-foreground">Off = the page works for anyone with the link and stays out of Google. Most pages want this off.</span></span>
                    </label>
                    {piece.status === "published" && canEdit && <Button variant="outline" onClick={() => publish.mutate(false)} className="h-11 md:h-9 border-border" data-testid="studio-unpublish"><EyeOff className="w-4 h-4 mr-2" />Take it down</Button>}
                    {piece.status === "published" && <p className="text-xs text-muted-foreground">{piece.publicViews.toLocaleString()} views since it went up.</p>}
                  </>
                )}
                {video && usage?.isSuperAdmin && (
                  <div className="space-y-2 rounded-xl border border-border p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Editing queue (super admin)</div>
                    <div className="flex flex-wrap gap-2">
                      {(["requested", "in_progress", "delivered"] as const).map((s) => (
                        <button key={s} type="button" onClick={() => patch.mutate({ status: s })} className={`rounded-full border px-3 min-h-9 text-xs font-medium ${video.status === s ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground"}`}>{s === "in_progress" ? "being cut" : s}</button>
                      ))}
                    </div>
                    <Input defaultValue={video.deliveredUrl ?? ""} placeholder="https://… the finished video" onBlur={(e) => patch.mutate({ status: "delivered", deliveredUrl: e.target.value.trim() })} className="h-11 md:h-10 font-mono text-[12px]" data-testid="studio-video-delivered-url" />
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button variant="outline" onClick={() => duplicate.mutate()} className="h-11 md:h-9 border-border" data-testid="studio-settings-duplicate"><CopyPlus className="w-4 h-4 mr-2" />Duplicate</Button>
                  {canEdit && <Button variant="outline" onClick={() => { if (window.confirm("Remove this piece? Its versions are kept and nothing published elsewhere is touched.")) archive.mutate(); }} className="h-11 md:h-9 border-border text-red-600" data-testid="studio-archive"><Trash2 className="w-4 h-4 mr-2" />Remove</Button>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PicturePicker({ piece, liveDoc, canEdit, onPick }: { piece: PieceSummary; liveDoc: any; canEdit: boolean; onPick: (path: string, url: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<{ pictures: { src: string; caption: string; brand: string }[] }>({ queryKey: ["/api/admin/content-studio/pictures", piece.brand], queryFn: async () => (await workspaceFetch(`/api/admin/content-studio/pictures?brand=${piece.brand}`)).json() });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  // Where a picture goes: a graphic's photo, or a page's hero / photo blocks / cards.
  const slots: { path: string; label: string; current: string | null }[] = piece.kind === "graphic"
    ? [{ path: "photo", label: "The photo", current: liveDoc.photo ?? null }]
    : (liveDoc.blocks as any[]).flatMap((b, i) => b.type === "hero" ? [{ path: `blocks.${i}.photo`, label: `${i + 1}. Hero photo`, current: b.photo ?? null }]
      : b.type === "photo" ? [{ path: `blocks.${i}.src`, label: `${i + 1}. Photo`, current: b.src ?? null }]
      : b.type === "cards" ? (b.items as any[]).map((c, j) => ({ path: `blocks.${i}.items.${j}.photo`, label: `${i + 1}. Card ${j + 1} photo`, current: c.photo ?? null })) : []);
  const [slot, setSlot] = useState(0);
  const upload = async (f: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await workspaceFetch("/api/admin/content-studio/pictures", { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message);
      qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pictures", piece.brand] });
      if (slots[slot]) onPick(slots[slot].path, j.url);
      toast({ title: "Uploaded", description: `${j.width}×${j.height}, ${Math.round(j.bytes / 1024)}KB, hosted by ClubOS.` });
    } catch (e: any) { toast({ title: "Couldn't upload", description: e?.message, variant: "destructive" }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  if (slots.length === 0) return <p className="text-xs text-muted-foreground">This layout has no picture. Ask Rambo for the "photo" layout, or add a photo block.</p>;
  return (
    <div className="space-y-3" data-testid="studio-pictures">
      <div className="flex flex-wrap gap-2">
        {slots.map((s, i) => <button key={s.path} type="button" onClick={() => setSlot(i)} className={`rounded-full border px-3 min-h-9 text-xs font-medium ${slot === i ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground"}`}>{s.label}</button>)}
      </div>
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} data-testid="studio-picture-upload" />
        <Button variant="outline" disabled={!canEdit || uploading} onClick={() => fileRef.current?.click()} className="h-11 md:h-9 border-border">{uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}Upload a picture</Button>
        {slots[slot]?.current && canEdit && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onPick(slots[slot].path, "")}>Remove the picture</button>}
      </div>
      <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
        {(data?.pictures ?? []).map((p) => (
          <button key={p.src} type="button" disabled={!canEdit} title={p.caption} onClick={() => onPick(slots[slot].path, p.src)} className={`rounded-lg overflow-hidden border ${slots[slot]?.current === p.src ? "border-blue-600 ring-2 ring-blue-500/30" : "border-border"} disabled:opacity-60`} data-testid="studio-picture">
            <img src={p.src} alt={p.caption} loading="lazy" className="w-full aspect-[3/2] object-cover" />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Pick a picture, then Save words. Captions tell Rambo who is in each one; hover to read.</p>
    </div>
  );
}
