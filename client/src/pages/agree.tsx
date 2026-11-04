// Public: a template's OPEN LINK (/agree/:token). One link shared with a group —
// players, vendors, volunteers — where each person starts their OWN agreement.
// They give their name and email here, then land on the normal signing page
// (/sign/:token), already signed by the club, to fill in their details and sign
// with a finger, mouse or their typed name. Server: /api/public/agree/:token.
//
// 🔴 Nothing is emailed to the address typed here until they have signed.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ForceDarkSurface } from "@/lib/theme-provider";

interface AgreeInfo { name: string; description: string | null; docTitle: string; primarySignerRole: string; brand: { orgLabel: string; logoUrl: string; bg: string; panel: string; border: string; accent: string; paper: string; ink: string } }

export default function AgreePage() {
  const [, params] = useRoute("/agree/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<AgreeInfo>({
    queryKey: ["agree", token],
    queryFn: async () => {
      const r = await fetch(`/api/public/agree/${encodeURIComponent(token)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "This link isn't open.");
      return j;
    },
    retry: false,
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const start = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/public/agree/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, website }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Something went wrong. Try again.");
      if (j.token) navigate(`/sign/${j.token}`);
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  const b = data?.brand;
  const bg = b?.bg ?? "#0b1330", accent = b?.accent ?? "#C9A43E";
  return (
    <div className="min-h-screen flex flex-col" style={{ background: bg, color: "#fff", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <ForceDarkSurface />
      <header className="px-5 py-5 flex items-center gap-3 max-w-xl w-full mx-auto">
        {b?.logoUrl && <img src={b.logoUrl} alt="" className="h-10 w-auto" />}
        <span className="text-[13px] tracking-wide text-white/70">{b?.orgLabel ?? ""}</span>
      </header>
      <main className="flex-1 px-4 pb-10 max-w-xl w-full mx-auto">
        {isLoading ? <div className="text-white/40 text-center py-20">Loading…</div> : error || !data ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: b?.panel ?? "#121c40" }} data-testid="agree-closed">
            <div className="text-lg font-semibold">This link isn't open</div>
            <p className="text-white/60 text-sm mt-2">{(error as Error)?.message || "Ask the club for a new link."}</p>
          </div>
        ) : (
          <div className="rounded-2xl p-6 space-y-5" style={{ background: b?.panel, border: `1px solid ${b?.border}` }} data-testid="agree-form">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: accent }}>Agreement</div>
              <h1 className="text-2xl font-semibold mt-1 leading-tight">{data.docTitle}</h1>
              {data.description && <p className="text-white/60 text-[14px] mt-2">{data.description}</p>}
            </div>
            <p className="text-white/70 text-[14px]">Start with your name and email. Next you'll read the agreement, add your details and sign. Your signed copy is emailed to you.</p>
            <label className="block space-y-1.5">
              <span className="text-[13px] text-white/70">Full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="w-full h-12 rounded-xl px-4 text-[16px] text-black bg-white outline-none" data-testid="agree-name" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] text-white/70">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" className="w-full h-12 rounded-xl px-4 text-[16px] text-black bg-white outline-none" data-testid="agree-email" />
            </label>
            {/* Honeypot — hidden from people, filled by bots. */}
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
            {msg && <p className="text-[13px] text-red-300" role="alert">{msg}</p>}
            <button onClick={start} disabled={busy || name.trim().length < 2 || !email.includes("@")}
              className="w-full h-[52px] rounded-xl font-semibold text-[16px] disabled:opacity-40" style={{ background: accent, color: "#111" }} data-testid="agree-start">
              {busy ? "Opening…" : "Continue to the agreement"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
