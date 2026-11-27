import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";

// The film player shared by the staff page (Performance → Video) and the
// share-link page (/film/<token>). Colours come in as a palette so the same
// markup sits on the light admin and on SIU's black page.

export interface FilmFile {
  id: number; clip: number; role: "watch" | "original"; label: string; bytes: number; seconds: number | null;
  width: number | null; height: number | null; downloadName: string; videoUrl: string; downloadUrl: string; posterUrl: string | null;
}
export interface FilmNote { id: number; clip: number; atSeconds: number; body: string; author?: string | null }
export interface FilmPalette { card: string; line: string; ink: string; mute: string; accent: string; onAccent: string; soft: string }

export const LIGHT_FILM: FilmPalette = {
  card: "hsl(var(--card))", line: "hsl(var(--border))", ink: "hsl(var(--foreground))", mute: "hsl(var(--muted-foreground))",
  accent: "hsl(var(--primary))", onAccent: "hsl(var(--primary-foreground))", soft: "hsl(var(--muted))",
};

export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
export function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
const quality = (f: FilmFile) => (f.height ? (f.height >= 2160 ? "4K" : `${f.height}p`) : null);

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const FRAME = 1 / 30;

export function FilmViewer({ files, notes, palette: P, clip, onClip, startAt, onAddNote, onDeleteNote }: {
  files: FilmFile[]; notes: FilmNote[]; palette: FilmPalette; clip: number; onClip: (clip: number) => void; startAt?: number | null;
  onAddNote?: (clip: number, atSeconds: number, body: string) => Promise<void>; onDeleteNote?: (id: number) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState(1);
  const [now, setNow] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = useRef<number | null>(startAt ?? null);

  const clips = useMemo(() => Array.from(new Set(files.map((f) => f.clip))).sort((a, b) => a - b), [files]);
  const current = clips.includes(clip) ? clip : clips[0];
  const playing = files.find((f) => f.clip === current && f.role === "watch") ?? files.find((f) => f.clip === current);
  const clipNotes = notes.filter((n) => n.clip === current);

  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, playing?.id]);

  const seek = (t: number, play = false) => {
    const v = video.current;
    if (!v) return;
    if (v.readyState < 1) { pending.current = t; return; }
    v.currentTime = Math.max(0, Math.min(t, Number.isFinite(v.duration) ? v.duration : t));
    if (play) void v.play().catch(() => {});
  };
  const step = (by: number) => { const v = video.current; if (!v) return; v.pause(); seek(v.currentTime + by); };

  const btn = "inline-flex items-center justify-center rounded-md px-3 text-sm font-medium min-h-[44px] md:min-h-[36px] whitespace-nowrap";
  const ghost = { border: `1px solid ${P.line}`, color: P.ink, background: "transparent" } as const;
  const solid = { background: P.accent, color: P.onAccent, border: `1px solid ${P.accent}` } as const;

  if (!playing) return <p className="text-sm" style={{ color: P.mute }}>No clips on this film yet.</p>;

  return (
    <div className="min-w-0 space-y-3" data-testid="film-viewer">
      {clips.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Clips">
          {clips.map((c) => {
            const f = files.find((x) => x.clip === c && x.role === "watch") ?? files.find((x) => x.clip === c)!;
            return (
              <button key={c} type="button" role="tab" aria-selected={c === current} data-testid={`film-clip-${c}`} className={btn} style={c === current ? solid : ghost}
                onClick={() => { pending.current = null; setNow(0); onClip(c); }}>
                Clip {c}{f.seconds ? ` · ${clock(f.seconds)}` : ""}
              </button>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-lg" style={{ background: "#000", border: `1px solid ${P.line}` }}>
        <video key={playing.id} ref={video} src={playing.videoUrl} poster={playing.posterUrl ?? undefined} controls playsInline preload="metadata"
          className="block w-full" style={{ aspectRatio: playing.width && playing.height ? `${playing.width} / ${playing.height}` : "16 / 9", background: "#000" }}
          data-testid="film-video"
          onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speed; if (pending.current != null) { e.currentTarget.currentTime = pending.current; pending.current = null; } }}
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" style={{ color: P.mute }}>Speed</span>
        {SPEEDS.map((s) => (
          <button key={s} type="button" className={btn} style={s === speed ? solid : ghost} aria-pressed={s === speed} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
        <span className="mx-1 hidden h-5 w-px md:block" style={{ background: P.line }} aria-hidden />
        <button type="button" className={btn} style={ghost} onClick={() => step(-5)}>−5s</button>
        <button type="button" className={btn} style={ghost} onClick={() => step(-FRAME)} aria-label="Back one frame">−1 frame</button>
        <button type="button" className={btn} style={ghost} onClick={() => step(FRAME)} aria-label="Forward one frame">+1 frame</button>
        <button type="button" className={btn} style={ghost} onClick={() => step(5)}>+5s</button>
      </div>

      <section className="rounded-lg p-3" style={{ background: P.card, border: `1px solid ${P.line}` }}>
        <h3 className="text-sm font-semibold" style={{ color: P.ink }}>Download</h3>
        <ul className="mt-2 space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 text-sm" style={{ color: P.ink }}>
                <span className="font-medium">{f.label}</span>
                <span style={{ color: P.mute }}> · {[quality(f), f.seconds ? clock(f.seconds) : null, size(f.bytes)].filter(Boolean).join(" · ")}</span>
                <div className="text-xs" style={{ color: P.mute }}>{f.role === "original" ? "Straight off the camera. Big file, best for editing or zooming in." : "Smaller copy, the same one that plays above. Best for a laptop or phone."}</div>
              </div>
              <a href={f.downloadUrl} download={f.downloadName} className={`${btn} gap-2 shrink-0`} style={f.role === "watch" ? solid : ghost} data-testid={`film-download-${f.id}`}>
                <Download className="h-4 w-4" aria-hidden /> Download {size(f.bytes)}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {(clipNotes.length > 0 || onAddNote) && (
        <section className="rounded-lg p-3" style={{ background: P.card, border: `1px solid ${P.line}` }}>
          <h3 className="text-sm font-semibold" style={{ color: P.ink }}>Notes{clips.length > 1 ? ` · clip ${current}` : ""}</h3>
          {clipNotes.length === 0 ? <p className="mt-1 text-sm" style={{ color: P.mute }}>No notes on this clip yet.</p> : (
            <ul className="mt-2 divide-y" style={{ borderColor: P.line }} data-testid="film-notes">
              {clipNotes.map((n) => (
                <li key={n.id} className="flex items-start gap-3 py-2" style={{ borderColor: P.line }}>
                  <button type="button" className={`${btn} shrink-0 tabular-nums`} style={ghost} onClick={() => seek(n.atSeconds, true)} aria-label={`Play from ${clock(n.atSeconds)}`}>{clock(n.atSeconds)}</button>
                  <div className="min-w-0 flex-1 text-sm" style={{ color: P.ink }}>
                    <p className="whitespace-pre-wrap break-words">{n.body}</p>
                    {n.author && <p className="text-xs" style={{ color: P.mute }}>{n.author}</p>}
                  </div>
                  {onDeleteNote && (
                    <button type="button" className={`${btn} shrink-0`} style={ghost} aria-label="Remove note" disabled={busy}
                      onClick={async () => { if (!window.confirm("Remove this note?")) return; setBusy(true); setErr(null); try { await onDeleteNote(n.id); } catch (e: any) { setErr(e?.message || "Could not remove the note."); } finally { setBusy(false); } }}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {onAddNote && (
            <form className="mt-3 flex flex-col gap-2 md:flex-row" onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              setBusy(true); setErr(null);
              try { await onAddNote(current, video.current?.currentTime ?? now, draft.trim()); setDraft(""); } catch (x: any) { setErr(x?.message || "Could not save the note."); } finally { setBusy(false); }
            }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder={`Note at ${clock(now)}`} aria-label="Note"
                className="premium-input min-h-[44px] flex-1 rounded-md px-3 text-sm md:min-h-[36px]" data-testid="film-note-input" />
              <button type="submit" className={btn} style={solid} disabled={busy || !draft.trim()} data-testid="film-note-add">Add note at {clock(now)}</button>
            </form>
          )}
          {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        </section>
      )}
    </div>
  );
}
