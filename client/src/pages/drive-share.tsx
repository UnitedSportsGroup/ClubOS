// /share/{token} — a Club Drive folder shared with someone outside the club.
// Read-only: look, open, download one file, download everything. The token in
// the address is the whole key; there is no sign-in. Light page, not indexed.
import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Download, FileText, Loader2, X, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { ShareReport } from "./drive-share-report";

interface SharedFile { id: number; name: string; folder: string; kind: "image" | "video" | "file"; sizeBytes: number | null }
interface Payload { title: string; files: SharedFile[] }

const size = (n: number | null) => {
  if (n === null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export default function DriveShare() {
  const [, params] = useRoute("/share/:token");
  const token = params?.token ?? "";
  const base = `/api/public/drive-share/${token}`;
  // Opened from inside ClubOS: `?from=` is where the staff member came from, so
  // the page offers the way back there and the look is not counted as the sponsor's.
  const from = useMemo(() => { const f = new URLSearchParams(window.location.search).get("from") || ""; return /^\/admin[\/?#]/.test(f) || f === "/admin" ? f : null; }, []);
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone" | "error">("loading");
  const [open, setOpen] = useState<number | null>(null);
  // Which half of the page is showing, and the report's time frame, live in the address.
  const read = () => { const q = new URLSearchParams(window.location.search); return { tab: q.get("tab") === "report" ? "report" : "content", period: q.get("period") || "ytd" }; };
  const [nav, setNav] = useState(read);
  const go = (next: Partial<{ tab: string; period: string }>) => {
    const n = { ...nav, ...next }; const q = new URLSearchParams(window.location.search);
    if (n.tab === "report") { q.set("tab", "report"); q.set("period", n.period); } else { q.delete("tab"); q.delete("period"); }
    window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? "?" + q.toString() : ""}`); setNav(n as any);
  };

  useEffect(() => {
    const m = document.createElement("meta"); m.name = "robots"; m.content = "noindex, nofollow"; document.head.appendChild(m);
    return () => { document.head.removeChild(m); };
  }, []);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(from ? `${base}?preview=1` : base).then(async (r) => {
      if (!alive) return;
      if (r.status === 404) return setState("gone");
      if (!r.ok) return setState("error");
      const j = (await r.json()) as Payload;
      setData(j); setState("ready"); document.title = `${j.title} · South Island United`;
    }).catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [base]);

  const groups = useMemo(() => {
    const m = new Map<string, SharedFile[]>();
    for (const f of data?.files ?? []) { const k = f.folder || "Files"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(f); }
    return Array.from(m.entries());
  }, [data]);
  // Everything that opens in the viewer: pictures and videos, in page order.
  const pictures = useMemo(() => (data?.files ?? []).filter((f) => f.kind !== "file"), [data]);
  const total = useMemo(() => (data?.files ?? []).reduce((n, f) => n + (f.sizeBytes ?? 0), 0), [data]);
  const current = open === null ? null : pictures[open] ?? null;

  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : Math.min(pictures.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, pictures.length]);

  if (state === "loading") return <div className="grid min-h-screen place-items-center bg-white text-slate-500" data-testid="share-loading"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (state !== "ready" || !data) return (
    <div className="grid min-h-screen place-items-center bg-white px-6 text-center" data-testid="share-gone">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{state === "gone" ? "This link is not available" : "This page did not load"}</h1>
        <p className="mt-2 text-sm text-slate-600">{state === "gone" ? "It may have been switched off. Ask your contact at the club for a new link." : "Check your connection and try again."}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" data-testid="share-page">
      {from && (
        <div className="border-b border-slate-200 bg-slate-100" data-testid="share-staff-bar" data-noprint>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
            <a href={from} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-slate-800 hover:underline" data-testid="share-back"><ChevronLeft className="h-4 w-4" /> Back to ClubOS</a>
            <span className="text-xs text-slate-600">You are seeing what the sponsor sees.</span>
            <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/share/${token}`)} className="ml-auto inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50" data-testid="share-copy">Copy the sponsor's link</button>
          </div>
        </div>
      )}
      <header className="border-b border-slate-200 bg-white" data-noprint>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-5 sm:px-6">
          <img src="/logos/south-island-united.png" alt="" className="h-12 w-12 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Content from South Island United</p>
            <h1 className="truncate text-2xl font-semibold" data-testid="share-title">{data.title}</h1>
            <p className="mt-0.5 text-sm text-slate-600" data-testid="share-count">{data.files.length} file{data.files.length === 1 ? "" : "s"}{total ? ` · ${size(total)}` : ""}</p>
          </div>
          {nav.tab === "content" && (
            <a href={`${base}/zip`} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90" style={{ color: "#ffffff", background: "#0f172a" }} data-testid="share-zip-all">
              <Download className="h-4 w-4" /> Download everything
            </a>
          )}
        </div>
        <div className="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6" data-noprint>
          {([["content", "Your content"], ["report", "Your report"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => go({ tab: k })} data-testid={`share-tab-${k}`}
              className="min-h-[44px] border-b-2 px-3 text-sm font-semibold" style={{ borderColor: nav.tab === k ? "#0f172a" : "transparent", color: nav.tab === k ? "#0f172a" : "#64748b" }}>{label}</button>
          ))}
        </div>
      </header>

      {nav.tab === "report" && (
        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <ShareReport token={token} period={nav.period} onPeriod={(p) => go({ period: p })} />
        </main>
      )}
      <main className={`mx-auto max-w-6xl px-4 py-6 sm:px-6 ${nav.tab === "report" ? "hidden" : ""}`}>
        {data.files.length === 0 && <p className="py-16 text-center text-slate-600" data-testid="share-empty">Nothing has been added to this folder yet.</p>}
        {groups.map(([folder, files]) => {
          const imgs = files.filter((f) => f.kind !== "file"); const rest = files.filter((f) => f.kind === "file");
          return (
            <section key={folder} className="mb-10" data-testid="share-group">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">{folder}</h2>
                <span className="text-sm text-slate-500">{files.length}</span>
                {folder !== "Files" && (
                  <a href={`${base}/zip?folder=${encodeURIComponent(folder)}`} className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
                    <Download className="h-4 w-4" /> Download this folder
                  </a>
                )}
              </div>
              {imgs.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {imgs.map((f) => (
                    <button key={f.id} onClick={() => setOpen(pictures.findIndex((p) => p.id === f.id))} className="group relative aspect-[4/5] overflow-hidden rounded-lg bg-slate-200" data-testid={f.kind === "video" ? "share-video" : "share-picture"} aria-label={`Open ${f.name}`}>
                      {f.kind === "video" ? (
                        <>
                          {/* The first frame stands in as the cover; the video itself plays in the viewer. */}
                          <video src={`${base}/file/${f.id}#t=0.5`} preload="metadata" muted playsInline className="pointer-events-none h-full w-full object-cover" />
                          <span className="absolute inset-0 grid place-items-center">
                            <span className="grid h-14 w-14 place-items-center rounded-full bg-white shadow-lg" style={{ color: "#0f172a" }}><Play className="h-6 w-6 translate-x-[2px]" fill="currentColor" /></span>
                          </span>
                          <span className="absolute bottom-2 left-2 rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: "#0f172a" }}>Video · {size(f.sizeBytes)}</span>
                        </>
                      ) : (
                        <img src={`${base}/thumb/${f.id}`} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              {rest.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {rest.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-3 py-2" data-testid="share-file">
                      <FileText className="h-5 w-5 shrink-0 text-slate-500" />
                      <a href={`${base}/file/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:underline">{f.name}</a>
                      <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">{size(f.sizeBytes)}</span>
                      <a href={`${base}/file/${f.id}?dl=1`} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100" aria-label={`Download ${f.name}`}><Download className="h-4 w-4" /></a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <p className="mt-4 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
          Shared by South Island United for your own channels. Please credit South Island United when you post. Questions: talk to your contact at the club.
        </p>
      </main>

      {current && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "rgba(0,0,0,0.92)" }} data-testid="share-viewer" onClick={() => setOpen(null)}>
          {/* A white bar, so Close and Download are always readable over a dark picture. */}
          <div className="flex items-center gap-2 bg-white px-3 py-2" style={{ color: "#0f172a" }} onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{current.name}</span>
            <a href={`${base}/file/${current.id}?dl=1`} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-100" style={{ color: "#0f172a" }} data-testid="share-viewer-download"><Download className="h-4 w-4" /> Download</a>
            <button onClick={() => setOpen(null)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold hover:opacity-90" style={{ color: "#ffffff", background: "#0f172a" }} data-testid="share-viewer-close" aria-label="Close"><X className="h-5 w-5" /> Close</button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 py-3" onClick={() => setOpen(null)}>
            {current.kind === "video" ? (
              <video key={current.id} src={`${base}/file/${current.id}`} controls autoPlay playsInline className="max-h-full max-w-full" style={{ background: "#000" }} onClick={(e) => e.stopPropagation()} data-testid="share-viewer-video" />
            ) : (
              <img src={`${base}/file/${current.id}`} alt={current.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
            )}
            {open! > 0 && <button onClick={(e) => { e.stopPropagation(); setOpen(open! - 1); }} className="absolute left-2 grid h-11 w-11 place-items-center rounded-full bg-white shadow-lg hover:bg-slate-100" style={{ color: "#0f172a" }} aria-label="Previous"><ChevronLeft className="h-6 w-6" /></button>}
            {open! < pictures.length - 1 && <button onClick={(e) => { e.stopPropagation(); setOpen(open! + 1); }} className="absolute right-2 grid h-11 w-11 place-items-center rounded-full bg-white shadow-lg hover:bg-slate-100" style={{ color: "#0f172a" }} aria-label="Next"><ChevronRight className="h-6 w-6" /></button>}
          </div>
        </div>
      )}
    </div>
  );
}
