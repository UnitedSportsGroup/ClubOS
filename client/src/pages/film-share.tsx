import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { FilmViewer, clock, type FilmFile, type FilmNote, type FilmPalette } from "@/components/performance/film-viewer";

// South Island United: a session film opened by its share link
// (join.southislandunited.com/film/<token>). No sign-in: the random token in the
// address is the whole key, and staff can switch it off from Performance → Video.
// Public route, plain fetch, no workspace header.

const C = { bg: "#0B0B0B", card: "#141414", line: "rgba(255,255,255,0.10)", ink: "#F5F1E8", mute: "rgba(245,241,232,0.62)", gold: "#C59949" };
const PALETTE: FilmPalette = { card: C.card, line: C.line, ink: C.ink, mute: C.mute, accent: C.gold, onAccent: "#0B0B0B", soft: "#1c1c1c" };

interface Shared { title: string; filmDate: string | null; kind: string; note: string | null; files: FilmFile[]; notes: FilmNote[] }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// By parts, never new Date(iso): local time would shift the day.
function longDate(iso: string) { const [y, m, d] = iso.split("-").map(Number); return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`; }
const KIND: Record<string, string> = { training: "Training", match: "Match", other: "Film" };

export default function FilmShare() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "gone" } | { kind: "error" } | { kind: "ok"; film: Shared }>({ kind: "loading" });
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [clip, setClipState] = useState(Number(params.get("clip")) || 1);
  const startAt = params.get("t") != null && Number.isFinite(Number(params.get("t"))) ? Number(params.get("t")) : null;

  useEffect(() => {
    let alive = true;
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    (async () => {
      try {
        const res = await fetch(`/api/public/film/${encodeURIComponent(token || "")}`);
        if (!alive) return;
        if (res.status === 404) return setState({ kind: "gone" });
        if (!res.ok) return setState({ kind: "error" });
        const j = await res.json();
        document.title = `${j.film.title} · South Island United`;
        setState({ kind: "ok", film: j.film });
      } catch { if (alive) setState({ kind: "error" }); }
    })();
    return () => { alive = false; meta.remove(); };
  }, [token]);

  const setClip = (c: number) => {
    setClipState(c);
    const u = new URL(window.location.href);
    u.searchParams.set("clip", String(c)); u.searchParams.delete("t");
    window.history.replaceState(null, "", u.toString());
  };

  const film = state.kind === "ok" ? state.film : null;
  const total = film ? film.files.filter((f) => f.role === "watch").reduce((n, f) => n + (f.seconds ?? 0), 0) : 0;
  const clips = film ? new Set(film.files.map((f) => f.clip)).size : 0;

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100dvh" }} className="w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-5xl px-4 pt-5 md:px-8 md:pt-8" style={{ paddingBottom: "calc(3rem + env(safe-area-inset-bottom))" }}>
        <header className="flex items-center gap-3">
          <img src="/logos/south-island-united.png" alt="South Island United" width={44} height={44} style={{ height: 44, width: "auto", objectFit: "contain" }} />
          <div className="min-w-0">
            <p className="text-xs uppercase" style={{ color: C.gold, letterSpacing: "0.14em" }}>South Island United · Film</p>
            <h1 className="text-xl font-semibold leading-tight md:text-2xl" data-testid="film-title">{film ? film.title : state.kind === "loading" ? "Loading…" : "Film"}</h1>
          </div>
        </header>

        {state.kind === "loading" && <div className="mt-6 aspect-video w-full animate-pulse rounded-lg" style={{ background: C.card }} aria-label="Loading the film" />}
        {state.kind === "gone" && (
          <div className="mt-6 rounded-lg p-4" style={{ background: C.card, border: `1px solid ${C.line}` }} data-testid="film-gone">
            <p className="font-medium">This link isn't active.</p>
            <p className="mt-1 text-sm" style={{ color: C.mute }}>It may have been switched off or replaced. Ask whoever sent it for the current link.</p>
          </div>
        )}
        {state.kind === "error" && (
          <div className="mt-6 rounded-lg p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <p className="font-medium">The film didn't load.</p>
            <button type="button" className="mt-3 inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium" style={{ background: C.gold, color: "#0B0B0B" }} onClick={() => window.location.reload()}>Try again</button>
          </div>
        )}
        {film && (
          <>
            <p className="mt-2 text-sm" style={{ color: C.mute }}>
              {[film.filmDate ? longDate(film.filmDate) : null, KIND[film.kind] ?? "Film", clips > 1 ? `${clips} clips` : null, total ? `${clock(total)} in total` : null].filter(Boolean).join(" · ")}
            </p>
            {film.note && <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: C.ink }}>{film.note}</p>}
            <div className="mt-5">
              <FilmViewer files={film.files} notes={film.notes} palette={PALETTE} clip={clip} onClip={setClip} startAt={startAt} />
            </div>
            <p className="mt-6 text-xs" style={{ color: C.mute }}>Private to South Island United staff. Please don't pass this link on outside the club.</p>
          </>
        )}
      </div>
    </div>
  );
}
