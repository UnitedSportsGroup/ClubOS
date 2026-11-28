import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { ArrowLeft, Film as FilmIcon } from "lucide-react";
import { FilmViewer, clock, type FilmFile, type FilmNote, type FilmPalette } from "@/components/performance/film-viewer";

// South Island United: the club's film library, opened by its one standing link
// (join.southislandunited.com/films/<token>). Daniel, 2026-11-28: "make sure they
// can see the training clips as well so we build this over time as a library".
// Every film staff leave "in the library" shows here, newest first; a film added
// later appears by itself. No sign-in: the random token is the key, and staff can
// turn it off or replace it from Performance → Video. Public route, plain fetch.
// The open film and clip live in the URL (?film=5&clip=2), so Back returns to the list.

const C = { bg: "#0B0B0B", card: "#141414", line: "rgba(255,255,255,0.10)", ink: "#F5F1E8", mute: "rgba(245,241,232,0.62)", gold: "#C59949" };
const PALETTE: FilmPalette = { card: C.card, line: C.line, ink: C.ink, mute: C.mute, accent: C.gold, onAccent: "#0B0B0B", soft: "#1c1c1c" };
const API = "/api/public/film-library";

interface Row { id: number; title: string; filmDate: string | null; kind: string; note: string | null; clips: number; seconds: number; posterUrl: string | null }
interface Film { id: number; title: string; filmDate: string | null; kind: string; note: string | null; files: FilmFile[]; notes: FilmNote[] }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// By parts, never new Date(iso): local time would shift the day.
function longDate(iso: string) { const [y, m, d] = iso.split("-").map(Number); return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`; }
function shortDate(iso: string) { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`; }
const KIND: Record<string, string> = { training: "Training", match: "Match", other: "Film" };
const FILTERS = [{ key: "all", label: "All" }, { key: "training", label: "Training" }, { key: "match", label: "Matches" }] as const;

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

export default function FilmLibrary() {
  useNoIndex();
  const { token } = useParams<{ token: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const filmId = Number(params.get("film")) || null;
  const clip = Number(params.get("clip")) || 1;
  const filter = (params.get("show") as "all" | "training" | "match") || "all";
  const base = `/films/${token}`;

  const [list, setList] = useState<{ kind: "loading" } | { kind: "gone" } | { kind: "error" } | { kind: "ok"; films: Row[] }>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API}/${encodeURIComponent(token || "")}`);
        if (!alive) return;
        if (res.status === 404) return setList({ kind: "gone" });
        if (!res.ok) return setList({ kind: "error" });
        setList({ kind: "ok", films: (await res.json()).films });
      } catch { if (alive) setList({ kind: "error" }); }
    })();
    return () => { alive = false; };
  }, [token]);

  const shown = useMemo(() => (list.kind === "ok" ? list.films.filter((f) => filter === "all" || f.kind === filter) : []), [list, filter]);
  const setFilter = (k: string) => navigate(k === "all" ? base : `${base}?show=${k}`, { replace: true });

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100dvh" }} className="w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-6xl px-4 pt-5 md:px-8 md:pt-8" style={{ paddingBottom: "calc(3rem + env(safe-area-inset-bottom))" }}>
        <header className="flex items-center gap-3">
          <img src="/logos/south-island-united.png" alt="South Island United" width={44} height={44} style={{ height: 44, width: "auto", objectFit: "contain" }} />
          <div className="min-w-0">
            <p className="text-xs uppercase" style={{ color: C.gold, letterSpacing: "0.14em" }}>South Island United · Film library</p>
            <h1 className="text-xl font-semibold leading-tight md:text-2xl" data-testid="library-title">{filmId ? "Film" : "Training and match film"}</h1>
          </div>
        </header>

        {list.kind === "gone" && (
          <div className="mt-6 rounded-lg p-4" style={{ background: C.card, border: `1px solid ${C.line}` }} data-testid="library-gone">
            <p className="font-medium">This link isn't active.</p>
            <p className="mt-1 text-sm" style={{ color: C.mute }}>It may have been switched off or replaced. Ask whoever sent it for the current link.</p>
          </div>
        )}
        {list.kind === "error" && (
          <div className="mt-6 rounded-lg p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <p className="font-medium">The library didn't load.</p>
            <button type="button" className="mt-3 inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium" style={{ background: C.gold, color: "#0B0B0B" }} onClick={() => window.location.reload()}>Try again</button>
          </div>
        )}

        {filmId ? (
          <FilmView token={token!} filmId={filmId} clip={clip}
            onBack={() => (window.history.length > 1 ? window.history.back() : navigate(base))}
            onClip={(c) => navigate(`${base}?film=${filmId}&clip=${c}`, { replace: true })} />
        ) : (
          <>
            {list.kind === "loading" && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading the library">
                {[0, 1, 2].map((i) => <div key={i} className="aspect-video animate-pulse rounded-lg" style={{ background: C.card }} />)}
              </div>
            )}
            {list.kind === "ok" && (
              <>
                <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Show">
                  {FILTERS.map((f) => {
                    const n = f.key === "all" ? list.films.length : list.films.filter((x) => x.kind === f.key).length;
                    const on = filter === f.key;
                    return (
                      <button key={f.key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(f.key)}
                        className="inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium md:min-h-[36px]"
                        style={on ? { background: C.gold, color: "#0B0B0B" } : { border: `1px solid ${C.line}`, color: C.ink }} data-testid={`library-filter-${f.key}`}>
                        {f.label} <span className="ml-1.5" style={{ opacity: 0.65 }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                {shown.length === 0 ? (
                  <p className="mt-6 text-sm" style={{ color: C.mute }}>{list.films.length === 0 ? "No film in the library yet." : "No film of this kind yet."}</p>
                ) : (
                  <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="library-films">
                    {shown.map((f) => (
                      <li key={f.id}>
                        <button type="button" onClick={() => navigate(`${base}?film=${f.id}`)} data-testid={`library-film-${f.id}`}
                          className="flex w-full flex-col justify-start overflow-hidden rounded-lg text-left outline-none transition-colors focus-visible:ring-2"
                          style={{ background: C.card, border: `1px solid ${C.line}` }}>
                          <div className="relative aspect-video w-full" style={{ background: "#000" }}>
                            {f.posterUrl ? <img src={f.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                              : <div className="flex h-full w-full items-center justify-center" style={{ color: C.mute }}><FilmIcon className="h-8 w-8" aria-hidden /></div>}
                            <span className="absolute left-2 top-2 rounded px-2 py-0.5 text-xs font-semibold" style={{ background: f.kind === "match" ? C.gold : "rgba(0,0,0,0.7)", color: f.kind === "match" ? "#0B0B0B" : C.ink }}>
                              {KIND[f.kind] ?? "Film"}
                            </span>
                            {f.seconds > 0 && <span className="absolute bottom-2 right-2 rounded px-1.5 py-0.5 text-xs tabular-nums" style={{ background: "rgba(0,0,0,0.75)", color: C.ink }}>{clock(f.seconds)}</span>}
                          </div>
                          <div className="p-3">
                            <div className="font-medium">{f.title}</div>
                            <div className="mt-0.5 text-xs" style={{ color: C.mute }}>
                              {[f.filmDate ? shortDate(f.filmDate) : "Date not recorded", f.clips > 1 ? `${f.clips} clips` : null].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
        <p className="mt-8 text-xs" style={{ color: C.mute }}>Private to South Island United staff. Please don't pass this link on outside the club.</p>
      </div>
    </div>
  );
}

function FilmView({ token, filmId, clip, onBack, onClip }: { token: string; filmId: number; clip: number; onBack: () => void; onClip: (c: number) => void }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "gone" } | { kind: "error" } | { kind: "ok"; film: Film }>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(`${API}/${encodeURIComponent(token)}/films/${filmId}`);
        if (!alive) return;
        if (res.status === 404) return setState({ kind: "gone" });
        if (!res.ok) return setState({ kind: "error" });
        const j = await res.json();
        document.title = `${j.film.title} · South Island United`;
        setState({ kind: "ok", film: j.film });
      } catch { if (alive) setState({ kind: "error" }); }
    })();
    return () => { alive = false; };
  }, [token, filmId]);

  const film = state.kind === "ok" ? state.film : null;
  const total = film ? film.files.filter((f) => f.role === "watch").reduce((n, f) => n + (f.seconds ?? 0), 0) : 0;
  const clips = film ? new Set(film.files.map((f) => f.clip)).size : 0;

  return (
    <div className="mt-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium" style={{ color: C.gold }} data-testid="library-back">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All films
      </button>
      {state.kind === "loading" && <div className="mt-4 aspect-video w-full animate-pulse rounded-lg" style={{ background: C.card }} />}
      {state.kind === "gone" && <p className="mt-4 text-sm" style={{ color: C.mute }}>This film isn't in the library any more.</p>}
      {state.kind === "error" && <p className="mt-4 text-sm" style={{ color: C.mute }}>The film didn't load. Go back and try again.</p>}
      {film && (
        <>
          <h2 className="mt-2 text-xl font-semibold md:text-2xl" data-testid="film-title">{film.title}</h2>
          <p className="mt-1 text-sm" style={{ color: C.mute }}>
            {[film.filmDate ? longDate(film.filmDate) : null, KIND[film.kind] ?? "Film", clips > 1 ? `${clips} clips` : null, total ? `${clock(total)} in total` : null].filter(Boolean).join(" · ")}
          </p>
          {film.note && <p className="mt-2 whitespace-pre-wrap text-sm">{film.note}</p>}
          <div className="mt-5">
            <FilmViewer key={film.id} files={film.files} notes={film.notes} palette={PALETTE} clip={clip} onClip={onClip} />
          </div>
        </>
      )}
    </div>
  );
}
