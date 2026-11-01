// Content Studio — the video piece: upload clips, ask Rambo to edit them,
// watch the cut, change any caption or card word (Words tab), render again.
//
// Clips go straight from the browser into the club's private footage store;
// the finished video plays back through ClubOS (private files).

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { upload } from "@vercel/blob/client";
import { Download, Film, Loader2, RotateCcw, Trash2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, workspaceFetch } from "@/lib/queryClient";
import { RamboWorking } from "@/components/rambo-working";
import { DarkChip } from "@/components/studio/dark-chip";
import { VIDEO_CLIP_MAX_BYTES, VIDEO_CLIPS_MAX } from "@shared/studio-video";
import type { VideoDoc } from "@shared/studio";

interface Job { id: number; kind: "plan" | "render"; status: "queued" | "running" | "done" | "failed"; stage: string | null; error: string | null; createdAt: string; claimedAt: string | null; finishedAt: string | null; costCents: number | null }

const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

export function VideoEditor({ pieceId, video, canEdit, wordsDirty }: { pieceId: number; video: VideoDoc; canEdit: boolean; wordsDirty: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const jobKey = ["/api/admin/content-studio/pieces", pieceId, "video-job"];
  const { data } = useQuery<{ job: Job | null; queued: number; version: number }>({
    queryKey: jobKey,
    queryFn: async () => (await workspaceFetch(`/api/admin/content-studio/pieces/${pieceId}/video-job`)).json(),
    refetchInterval: (q) => { const s = (q.state.data as any)?.job?.status; return s === "queued" || s === "running" ? 4000 : false; },
  });
  const job = data?.job ?? null;
  const live = job?.status === "queued" || job?.status === "running";

  // When a job finishes, the piece has a new version: reload it.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (lastStatus.current && (lastStatus.current === "queued" || lastStatus.current === "running") && job && !live) {
      qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pieces", pieceId] });
      if (job.status === "done") toast({ title: "Your video is ready", description: job.kind === "plan" ? "Watch it, then change any word in the Words tab." : "Rendered again with your words." });
    }
    lastStatus.current = job?.status ?? null;
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const clips = video.clips ?? [];
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(0, VIDEO_CLIPS_MAX - clips.length));
    for (const f of list) {
      if (!f.type.startsWith("video/")) { toast({ title: `${f.name} isn't a video`, variant: "destructive" }); continue; }
      if (f.size > VIDEO_CLIP_MAX_BYTES) { toast({ title: `${f.name} is over 2 GB`, description: "Trim it or export a smaller copy first.", variant: "destructive" }); continue; }
      setUploads((u) => [...u, { name: f.name, pct: 0 }]);
      try {
        const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "clip.mp4";
        const blob = await upload(`studio/${pieceId}/clips/${safe}`, f, {
          access: "private",
          handleUploadUrl: "/api/admin/content-studio/footage/upload",
          clientPayload: JSON.stringify({ pieceId }),
          multipart: f.size > 64 * 1024 * 1024,
          onUploadProgress: (p) => setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, pct: Math.round(p.percentage) } : x))),
        });
        const r = await apiRequest("POST", `/api/admin/content-studio/pieces/${pieceId}/clips`, { url: blob.url, name: f.name, bytes: f.size });
        const j = await r.json();
        if (!j.ok) throw new Error(j.message);
        qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pieces", pieceId] });
      } catch (e: any) {
        toast({ title: `Couldn't upload ${f.name}`, description: e?.message, variant: "destructive" });
      } finally {
        setUploads((u) => u.filter((x) => x.name !== f.name));
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const removeClip = async (i: number) => {
    if (video.edl && !window.confirm("Taking a clip away clears the current edit (you can ask Rambo to edit it again). Carry on?")) return;
    await apiRequest("DELETE", `/api/admin/content-studio/pieces/${pieceId}/clips/${i}`);
    qc.invalidateQueries({ queryKey: ["/api/admin/content-studio/pieces", pieceId] });
  };
  const start = async (kind: "plan" | "render") => {
    try {
      const r = await apiRequest("POST", `/api/admin/content-studio/pieces/${pieceId}/video-job`, { kind });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message);
      qc.setQueryData(jobKey, (d: any) => ({ ...(d ?? {}), job: j.job }));
      qc.invalidateQueries({ queryKey: jobKey });
    } catch (e: any) { toast({ title: "Rambo", description: e?.message, variant: "destructive" }); }
  };

  // Honest about where the editor runs: a job nobody has picked up says so.
  const waitedSec = job?.status === "queued" ? (Date.now() - new Date(job.createdAt).getTime()) / 1000 : 0;
  const stage = job?.status === "queued"
    ? (waitedSec > 120 ? "Waiting for the editing computer to come online" : (data?.queued ?? 0) > 1 ? `Waiting in line (${(data?.queued ?? 1) - 1} ahead)` : "Waiting for the editor")
    : job?.stage ?? null;
  const media = (which: "video" | "poster", dl = false) => `/api/admin/content-studio/pieces/${pieceId}/media/${which}?v=${data?.version ?? 0}${dl ? "&download=1" : ""}`;

  return (
    <div className="space-y-4 text-sm text-foreground" data-testid="studio-video-editor">
      <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{video.brief}</p>

      {video.videoUrl ? (
        <div className="space-y-2">
          <DarkChip className="flex justify-center rounded-xl p-2">
            <video key={data?.version} controls playsInline preload="metadata" poster={video.posterUrl ? media("poster") : undefined} src={media("video")} className="max-h-[70vh] max-w-full rounded-lg" data-testid="studio-video-player" />
          </DarkChip>
          <div className="flex flex-wrap items-center gap-2">
            <a href={media("video", true)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 min-h-11 md:min-h-9 text-xs font-medium hover:bg-muted" data-testid="studio-video-download"><Download className="w-4 h-4" />Download MP4</a>
            {video.seconds ? <span className="text-xs text-muted-foreground">{Math.round(video.seconds)}s</span> : null}
          </div>
          {video.editNote && <p className="rounded-xl bg-muted px-3 py-2 text-[13px]"><span className="font-semibold">Rambo: </span>{video.editNote}</p>}
        </div>
      ) : !live && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
          <Film className="mx-auto mb-2 h-8 w-8 opacity-50" />
          {clips.length ? "Your clips are in. Press Edit it with Rambo." : "Upload your clips — phone videos are fine. Rambo cuts them into one video in the brand's style."}
        </div>
      )}

      {live && <RamboWorking stage={stage} expect={job?.kind === "render" ? "usually 2–4 min" : "usually 6–12 min"} expectSeconds={job?.kind === "render" ? 180 : 540} />}
      {job?.status === "failed" && !live && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800" data-testid="studio-video-error">{job.error}</p>}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Footage ({clips.length}/{VIDEO_CLIPS_MAX})</div>
          {canEdit && (
            <>
              <input ref={fileRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} data-testid="studio-video-upload-input" />
              <Button variant="outline" disabled={live || uploads.length > 0 || clips.length >= VIDEO_CLIPS_MAX} onClick={() => fileRef.current?.click()} className="h-11 md:h-9 border-border" data-testid="studio-video-upload"><Upload className="w-4 h-4 mr-2" />Upload clips</Button>
            </>
          )}
        </div>
        {uploads.map((u) => (
          <div key={u.name} className="rounded-lg border border-border px-3 py-2">
            <div className="flex justify-between text-xs"><span className="truncate">{u.name}</span><span className="tabular-nums">{u.pct}%</span></div>
            <div className="mt-1 h-1 rounded-full bg-muted"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${u.pct}%` }} /></div>
          </div>
        ))}
        {clips.map((c, i) => (
          <div key={c.url} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs" data-testid="studio-video-clip">
            <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{i + 1}. {c.name}</span>
            <span className="shrink-0 text-muted-foreground">{mb(c.bytes)}{c.seconds ? ` · ${Math.round(c.seconds)}s` : ""}</span>
            {canEdit && !live && <button type="button" onClick={() => void removeClip(i)} className="shrink-0 p-2 text-muted-foreground hover:text-red-600" aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void start("plan")} disabled={live || !clips.length || uploads.length > 0} className="h-11 md:h-9 bg-blue-600 hover:bg-blue-700 text-white" data-testid="studio-video-edit">
            {live && job?.kind === "plan" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}{video.edl ? "Edit it again from scratch" : "Edit it with Rambo"}
          </Button>
          {video.edl && (
            <Button variant="outline" onClick={() => void start("render")} disabled={live || wordsDirty} className="h-11 md:h-9 border-border" data-testid="studio-video-render" title={wordsDirty ? "Save your words first" : undefined}>
              <RotateCcw className="w-4 h-4 mr-2" />Render again with my words
            </Button>
          )}
          <span className="text-xs text-muted-foreground">{video.edl ? "Change captions and card words in the Words tab, save, then render again — no new prompt." : "One prompt from today's allowance. Rambo transcribes, picks the best takes, captions it on-brand, watches it back and fixes it."}</span>
        </div>
      )}
    </div>
  );
}
