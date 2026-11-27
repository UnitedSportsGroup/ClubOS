import { useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { upload } from "@vercel/blob/client";
import { ArrowLeft, Copy, Film, Link2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveWorkspaceSlug } from "@/lib/workspace-slug";
import { FilmViewer, LIGHT_FILM, clock, size, type FilmFile, type FilmNote } from "@/components/performance/film-viewer";
import {
  BASE, DateField, Empty, Field, FormError, Loading, LoadError, PageHead, Panel, Pick, Pill, SaveButton, control, niceDay, refresh, send, usePerfQuery, useSaver,
} from "./ui";

// Performance → Video → session film the club hosts itself.
// The open film and clip live in the URL (?film=3&clip=2) so Back and a pasted link both work.

interface FilmRow { id: number; title: string; filmDate: string | null; kind: string; note: string | null; clips: number; seconds: number; bytes: number; notes: number; shared: boolean; posterUrl: string | null }
interface FilmDetail {
  id: number; title: string; filmDate: string | null; kind: string; note: string | null;
  share: { on: boolean; url: string | null; createdAt: string | null }; files: FilmFile[]; notes: FilmNote[];
}
const KINDS = [{ value: "training", label: "Training" }, { value: "match", label: "Match" }, { value: "other", label: "Other" }];
const kindWord = (k: string) => KINDS.find((x) => x.value === k)?.label ?? "Film";
const PATH = "/admin/performance/video";

export function useOpenFilm() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const p = new URLSearchParams(search);
  const film = Number(p.get("film")) || null;
  const clip = Number(p.get("clip")) || 1;
  return {
    film, clip,
    open: (id: number) => navigate(`${PATH}?film=${id}`),
    close: () => navigate(PATH),
    setClip: (c: number) => navigate(`${PATH}?film=${film}&clip=${c}`, { replace: true }),
  };
}

/** The list of films and the "add a film" form. */
export function FilmList({ onOpen }: { onOpen: (id: number) => void }) {
  const q = usePerfQuery<{ films: FilmRow[]; storageOn: boolean }>("films", "/films");
  const [title, setTitle] = useState(""); const [date, setDate] = useState(""); const [kind, setKind] = useState("training");
  const add = useSaver();
  const d = q.data;
  return (
    <>
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <Panel title="Session film" note="Film the club hosts itself: watch it here, add notes at a moment, download it, and share it by link with a coach who has no ClubOS login.">
          {!d.storageOn && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Film storage isn't switched on yet, so films can't be played or uploaded.</p>}
          {d.films.length === 0 ? <Empty>No film yet. Add one below, then upload its clips.</Empty> : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="perf-films">
              {d.films.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => onOpen(f.id)} data-testid={`perf-film-${f.id}`}
                    className="flex w-full flex-col justify-start overflow-hidden rounded-lg border border-border bg-card text-left hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <div className="aspect-video w-full bg-muted">
                      {f.posterUrl ? <img src={f.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-8 w-8" aria-hidden /></div>}
                    </div>
                    <div className="p-3">
                      <div className="font-medium text-foreground">{f.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[niceDay(f.filmDate, true) || "Date not recorded", kindWord(f.kind), `${f.clips} clip${f.clips === 1 ? "" : "s"}`, f.seconds ? clock(f.seconds) : null, f.bytes ? size(f.bytes) : null].filter(Boolean).join(" · ")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {f.shared && <Pill tone="green">Shared by link</Pill>}
                        {f.notes > 0 && <Pill>{f.notes} note{f.notes === 1 ? "" : "s"}</Pill>}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <Panel title="Add a film" note="One film per session or match. You add its clips on the next screen.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Title"><Input className={control} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Training, drone" data-testid="film-new-title" /></Field>
          <Field label="Date filmed"><DateField value={date} onChange={setDate} className="w-full" /></Field>
          <Field label="What it is"><Pick value={kind} onChange={setKind} options={KINDS} className="w-full" /></Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SaveButton busy={add.busy} disabled={!title.trim()} onClick={() => add.run(async () => {
            const r = await send("POST", "/films", { title, filmDate: date || null, kind });
            setTitle(""); setDate(""); onOpen(r.id);
          })}>Add film</SaveButton>
        </div>
        <FormError error={add.error} />
      </Panel>
    </>
  );
}

/** Read a video file's length and frame size in the browser before it uploads. */
function probe(file: File): Promise<{ seconds: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (r: { seconds: number | null; width: number | null; height: number | null }) => { URL.revokeObjectURL(url); resolve(r); };
    v.preload = "metadata";
    v.onloadedmetadata = () => done({ seconds: Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : null, width: v.videoWidth || null, height: v.videoHeight || null });
    v.onerror = () => done({ seconds: null, width: null, height: null });
    setTimeout(() => done({ seconds: null, width: null, height: null }), 8000);
    v.src = url;
  });
}

/** One open film: the player, the share link, and adding clips. */
export function FilmPage({ id, clip, onClip, onBack }: { id: number; clip: number; onClip: (c: number) => void; onBack: () => void }) {
  const q = usePerfQuery<{ film: FilmDetail }>(`film-${id}`, `/films/${id}`);
  const share = useSaver(); const remove = useSaver();
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState("watch");
  const [clipNo, setClipNo] = useState("new");
  const [up, setUp] = useState<{ name: string; pct: number } | null>(null);
  const [upErr, setUpErr] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const film = q.data?.film;

  const clips = film ? Array.from(new Set(film.files.map((f) => f.clip))).sort((a, b) => a - b) : [];

  async function sendFile(file: File) {
    setUpErr(null); setUp({ name: file.name, pct: 0 });
    try {
      const meta = await probe(file);
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "clip.mp4";
      const slug = getActiveWorkspaceSlug() ?? localStorage.getItem("clubos_workspace") ?? "";
      const blob = await upload(`siu/film-${id}/${safe}`, file, {
        access: "private" as any, handleUploadUrl: `${BASE}/films/upload`, clientPayload: JSON.stringify({ filmId: id }),
        headers: { "X-Workspace-Slug": slug }, multipart: file.size > 32 * 1024 * 1024,
        onUploadProgress: (p: { percentage: number }) => setUp({ name: file.name, pct: Math.round(p.percentage) }),
      } as any);
      await send("POST", `/films/${id}/files`, {
        url: blob.url, name: file.name, bytes: file.size, contentType: file.type || "video/mp4", role,
        clip: clipNo === "new" ? null : Number(clipNo), ...meta,
      });
      await refresh();
    } catch (e: any) {
      setUpErr(String(e?.message || "The upload didn't finish.").replace(/^\d+:\s*/, ""));
    } finally { setUp(null); if (picker.current) picker.current.value = ""; }
  }

  return (
    <div className="space-y-5 min-w-0">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-primary hover:underline md:min-h-0" data-testid="film-back">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Video
      </button>
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {film && (
        <>
          <PageHead title={film.title} blurb={[niceDay(film.filmDate, true) || "Date not recorded", kindWord(film.kind)].join(" · ")} />

          <Panel title="Share" note="Anyone with the link can watch and download this film without signing in. Staff notes show on it. Turn it off and the link stops working straight away.">
            {film.share.on && film.share.url ? (
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input readOnly value={film.share.url} className={`${control} flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} data-testid="film-share-url" />
                <Button className={control} onClick={async () => { await navigator.clipboard.writeText(film.share.url!); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
                  <Copy className="mr-2 h-4 w-4" aria-hidden />{copied ? "Copied" : "Copy link"}
                </Button>
                <Button variant="outline" className={control} disabled={share.busy} onClick={() => share.run(async () => { await send("POST", `/films/${id}/share`, { on: false }); })}>Turn off</Button>
                <Button variant="ghost" className={control} disabled={share.busy}
                  onClick={() => { if (window.confirm("Make a new link? The old one stops working for everyone who has it.")) share.run(async () => { await send("POST", `/films/${id}/share`, { renew: true }); }); }}>New link</Button>
              </div>
            ) : (
              <Button className={control} disabled={share.busy || film.files.length === 0} onClick={() => share.run(async () => { await send("POST", `/films/${id}/share`, { on: true }); })} data-testid="film-share-on">
                <Link2 className="mr-2 h-4 w-4" aria-hidden />{film.share.url ? "Turn the link back on" : "Create a share link"}
              </Button>
            )}
            <FormError error={share.error} />
          </Panel>

          <FilmViewer files={film.files} notes={film.notes} palette={LIGHT_FILM} clip={clip} onClip={onClip}
            onAddNote={async (c, at, body) => { await send("POST", `/films/${id}/notes`, { clip: c, atSeconds: at, body }); await refresh(); }}
            onDeleteNote={async (noteId) => { await send("DELETE", `/films/${id}/notes/${noteId}`); await refresh(); }} />

          <Panel title="Add a clip" note="A watching copy is the one that plays on this page: export it at 1080p so it loads quickly. An original is the camera's own file, kept for download only.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="This file is"><Pick value={role} onChange={setRole} options={[{ value: "watch", label: "A watching copy (plays here)" }, { value: "original", label: "The camera original (download only)" }]} className="w-full" /></Field>
              <Field label="For"><Pick value={clipNo} onChange={setClipNo} className="w-full"
                options={[{ value: "new", label: "A new clip" }, ...clips.map((c) => ({ value: String(c), label: `Clip ${c}` }))]} /></Field>
              <div className="flex items-end">
                <input ref={picker} type="file" accept="video/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendFile(f); }} />
                <Button className={`${control} w-full`} disabled={!!up} onClick={() => picker.current?.click()} data-testid="film-upload">
                  <Upload className="mr-2 h-4 w-4" aria-hidden />{up ? `Uploading ${up.pct}%` : "Choose a video file"}
                </Button>
              </div>
            </div>
            {up && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${up.pct}%` }} /></div>
                <p className="mt-1 text-xs text-muted-foreground">{up.name}. Keep this page open until it finishes.</p>
              </div>
            )}
            <FormError error={upErr} />
            {film.files.length > 0 && (
              <ul className="mt-4 divide-y divide-border text-sm">
                {film.files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{f.label} <span className="text-muted-foreground">· {size(f.bytes)}</span></span>
                    <Button size="sm" variant="ghost" className="shrink-0" disabled={remove.busy}
                      onClick={() => { if (window.confirm(`Take "${f.label}" off this film?`)) remove.run(async () => { await send("DELETE", `/films/${id}/files/${f.id}`); }); }}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
            <FormError error={remove.error} />
          </Panel>

          <div>
            <Button variant="ghost" className="text-red-700" disabled={remove.busy}
              onClick={() => { if (window.confirm("Remove this film from the list? Its share link stops working.")) remove.run(async () => { await send("DELETE", `/films/${id}`); onBack(); }); }}>Remove this film</Button>
          </div>
        </>
      )}
    </div>
  );
}
