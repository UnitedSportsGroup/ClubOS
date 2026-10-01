// The customer's private artwork page — shop.unitedprints.co.nz/print/artwork/<quote token>.
//
// Daniel, 2026-10-01: "the image files not coming through is a disaster… real
// money… we need a way of taking them even if it's a large file." Quotes sent
// before uploads worked lost their file for good; Dima's "Ask for artwork"
// button sends this link. Any size (split in the browser, parts straight to
// storage — see lib/artwork-upload.ts). Shows only their first name and the
// lines of their own quote.
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { UpShell, upBtn, upDisplay } from "@/components/up-shell";
import { uploadArtwork, fileSizeLabel } from "@/lib/artwork-upload";

interface Line {
  id: number; designName: string | null; material: string | null; sizeLabel: string | null; quantity: number;
  files: { filename: string; sizeBytes: number }[]; uploadPath: string;
}
type Job = { id: string; name: string; size: number; pct: number; state: "sending" | "done" | "failed"; message?: string };

export default function PrintArtworkPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ firstName: string | null; items: Line[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [jobs, setJobs] = useState<Record<number, Job[]>>({});

  useEffect(() => {
    fetch(`/api/public/unitedprints/quote-artwork/${token}`)
      .then(async (r) => { if (!r.ok) throw new Error(); setData(await r.json()); })
      .catch(() => setFailed(true));
  }, [token]);

  const send = async (line: Line, files: FileList | null) => {
    if (!files?.length) return;
    // 🔴 Each file is tracked by its own id — an index read from state inside this
    // async loop is stale, and two files picked together overwrote one row.
    const list = Array.from(files);
    const key = line.id;
    const queued = list.map((file) => ({ file, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }));
    setJobs((j) => ({ ...j, [key]: [...(j[key] ?? []), ...queued.map(({ file, id }) => ({ id, name: file.name, size: file.size, pct: 0, state: "sending" as const }))] }));
    for (const { file, id } of queued) {
      const set = (patch: Partial<Job>) => setJobs((j) => ({ ...j, [key]: (j[key] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      const r = await uploadArtwork(window.location.origin, line.uploadPath, file, (pct) => set({ pct }));
      set(r.ok ? { state: "done", pct: 100 } : { state: "failed", message: r.message });
    }
  };

  if (failed) {
    return (
      <UpShell>
        <div className="mx-auto max-w-lg px-5 py-24 text-center">
          <h1 className={`${upDisplay} text-3xl text-[#012583]`}>That link doesn't work</h1>
          <p className="mt-3 text-[15px]">Email your artwork to <a className="underline" href="mailto:orders@unitedprints.co.nz">orders@unitedprints.co.nz</a> and we'll attach it to your quote.</p>
        </div>
      </UpShell>
    );
  }
  if (!data) return <UpShell><p className="py-32 text-center text-[15px]">Loading…</p></UpShell>;

  return (
    <UpShell>
      <div className="mx-auto max-w-2xl px-5 py-16 sm:py-24">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#043bcb]">Your quote</p>
        <h1 className={`${upDisplay} mt-2 text-4xl text-[#012583] sm:text-5xl`}>Send us your <span className="text-[#33cc00]">artwork</span></h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#4a5265]">
          {data.firstName ? `Kia ora ${data.firstName}. ` : ""}Upload the design for each item below — any size is fine. PNG, JPG, PDF,
          SVG or AI all work, and a ChatGPT image is fine too: we check every file before anything is printed.
        </p>
        <div className="mt-8 space-y-4">
          {data.items.map((line) => (
            <div key={line.id} className="rounded-2xl border border-[#cbd1de] bg-white p-5" data-testid={`artwork-line-${line.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-[#012583]">{line.designName || "Your design"}</div>
                  <div className="text-[13px] text-[#4a5265]">{[line.material, line.sizeLabel, `×${line.quantity}`].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              {[...line.files.map((f, i) => ({ id: `saved-${i}`, name: f.filename, size: f.sizeBytes, pct: 100, state: "done" as const })), ...(jobs[line.id] ?? [])].map((j) => (
                <div key={j.id} data-testid="artwork-job" data-state={j.state} className="mt-3 rounded-xl bg-[#f7faff] px-3 py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[#012583]">{j.name}</span>
                    <span className={j.state === "failed" ? "text-red-600" : j.state === "done" ? "text-[#2a9d00] font-semibold" : "text-[#4a5265]"}>
                      {j.state === "done" ? `✓ Received · ${fileSizeLabel(j.size)}` : j.state === "failed" ? "Didn't upload" : `${j.pct}% of ${fileSizeLabel(j.size)}`}
                    </span>
                  </div>
                  {j.state === "sending" && <div className="mt-1.5 h-1.5 rounded-full bg-[#cbd1de]/50"><div className="h-full rounded-full bg-[#043bcb] transition-all" style={{ width: `${j.pct}%` }} /></div>}
                  {j.state === "failed" && <p className="mt-1 text-[12px] text-red-600">{(j as Job).message}</p>}
                </div>
              ))}
              <label className={`${upBtn.white} mt-4 w-full cursor-pointer`}>
                Choose file{line.files.length || jobs[line.id]?.length ? "s to add" : ""}
                <input type="file" multiple className="hidden" data-testid={`artwork-input-${line.id}`}
                  accept=".pdf,.ai,.eps,.ps,.psd,.svg,.png,.jpg,.jpeg,.tif,.tiff,.webp,.heic,.gif,.zip,.cdr,.indd,.idml,.afdesign,.pptx,.docx"
                  onChange={(e) => { send(line, e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[13px] text-[#4a5265]">That's it — once a file shows ✓ Received, our team has it. Questions? Email <a className="underline" href="mailto:orders@unitedprints.co.nz">orders@unitedprints.co.nz</a>.</p>
      </div>
    </UpShell>
  );
}
