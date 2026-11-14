// /share/{token} — a Club Drive folder shared with someone outside the club.
// Read-only: look, open, download one file, download everything. The token in
// the address is the whole key; there is no sign-in. Light page, not indexed.
import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Download, FileText, Film, Loader2, X, ChevronLeft, ChevronRight } from "lucide-react";

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
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone" | "error">("loading");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const m = document.createElement("meta"); m.name = "robots"; m.content = "noindex, nofollow"; document.head.appendChild(m);
    return () => { document.head.removeChild(m); };
  }, []);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(base).then(async (r) => {
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
  const pictures = useMemo(() => (data?.files ?? []).filter((f) => f.kind === "image"), [data]);
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
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-5 sm:px-6">
          <img src="/logos/south-island-united.png" alt="" className="h-12 w-12 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Content from South Island United</p>
            <h1 className="truncate text-2xl font-semibold" data-testid="share-title">{data.title}</h1>
            <p className="mt-0.5 text-sm text-slate-600" data-testid="share-count">{data.files.length} file{data.files.length === 1 ? "" : "s"}{total ? ` · ${size(total)}` : ""}</p>
          </div>
          <a href={`${base}/zip`} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700" data-testid="share-zip-all">
            <Download className="h-4 w-4" /> Download everything
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {data.files.length === 0 && <p className="py-16 text-center text-slate-600" data-testid="share-empty">Nothing has been added to this folder yet.</p>}
        {groups.map(([folder, files]) => {
          const imgs = files.filter((f) => f.kind === "image"); const rest = files.filter((f) => f.kind !== "image");
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
                    <button key={f.id} onClick={() => setOpen(pictures.findIndex((p) => p.id === f.id))} className="group relative aspect-[4/5] overflow-hidden rounded-lg bg-slate-200" data-testid="share-picture" aria-label={`Open ${f.name}`}>
                      <img src={`${base}/thumb/${f.id}`} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                    </button>
                  ))}
                </div>
              )}
              {rest.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {rest.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-3 py-2" data-testid="share-file">
                      {f.kind === "video" ? <Film className="h-5 w-5 shrink-0 text-slate-500" /> : <FileText className="h-5 w-5 shrink-0 text-slate-500" />}
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
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" data-testid="share-viewer" onClick={() => setOpen(null)}>
          <div className="flex items-center gap-2 p-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 flex-1 truncate text-sm">{current.name}</span>
            <a href={`${base}/file/${current.id}?dl=1`} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-slate-900" data-testid="share-viewer-download"><Download className="h-4 w-4" /> Download</a>
            <button onClick={() => setOpen(null)} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4" onClick={(e) => e.stopPropagation()}>
            <img src={`${base}/file/${current.id}`} alt={current.name} className="max-h-full max-w-full object-contain" />
            {open! > 0 && <button onClick={() => setOpen(open! - 1)} className="absolute left-2 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/30" aria-label="Previous"><ChevronLeft className="h-6 w-6" /></button>}
            {open! < pictures.length - 1 && <button onClick={() => setOpen(open! + 1)} className="absolute right-2 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/30" aria-label="Next"><ChevronRight className="h-6 w-6" /></button>}
          </div>
        </div>
      )}
    </div>
  );
}
