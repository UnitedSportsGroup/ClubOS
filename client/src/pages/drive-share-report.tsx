// The sponsor's one-page report, shown on their share page (/share/{token}?tab=report).
// A snapshot, not an essay: what was posted with them in it, how many times it
// was seen, where, and the posts that did best. Prints to one A4 page as a PDF.
import { useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";

interface Report {
  sponsor: string; available: boolean; logoUrl?: string | null; logoGround?: "light" | "dark" | null;
  period: string; periodLabel?: string; periods: { key: string; label: string }[]; today?: string;
  totals?: { posts: number; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; engagements: number | null; collabPosts: number; collabViews: number | null };
  byPlatform?: { platform: string; posts: number; views: number | null }[];
  byMonth?: { month: string; posts: number; views: number | null }[];
  topPosts?: { id: number; platform: string; kind: string; views: number | null; day: string; permalink: string | null }[];
}
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-NZ"));
const PLATFORM: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", x: "X" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const dayName = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const INK = "#0f172a";

export function ShareReport({ token, period, onPeriod }: { token: string; period: string; onPeriod: (p: string) => void }) {
  const base = `/api/public/drive-share/${token}`;
  const [data, setData] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true; setState("loading");
    fetch(`${base}/report?period=${encodeURIComponent(period)}`).then(async (r) => { if (!alive) return; if (!r.ok) return setState("error"); setData(await r.json()); setState("ready"); }).catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [base, period]);

  if (state === "loading" && !data) return <div className="grid place-items-center py-24 text-slate-500" data-testid="report-loading"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (state === "error" || !data) return <p className="py-16 text-center text-slate-600" data-testid="report-error">The report did not load. Try again.</p>;
  if (!data.available || !data.totals) return <p className="py-16 text-center text-slate-600" data-testid="report-none">There is no report for this folder yet.</p>;
  const t = data.totals; const maxMonth = Math.max(1, ...(data.byMonth ?? []).map((m) => m.views ?? 0)); const maxPlat = Math.max(1, ...(data.byPlatform ?? []).map((p) => p.views ?? 0));
  const tiles: [string, string, string][] = [
    ["Posts you appear in", num(t.posts), "report-posts"],
    ["Times they were seen", num(t.views), "report-views"],
    ["Likes, comments, shares and saves", num(t.engagements), "report-engagements"],
    ["Seen per post, on average", t.posts && t.views !== null ? num(Math.round(t.views / t.posts)) : "—", "report-average"],
  ];

  return (
    <div data-testid="report">
      <style>{`@media print { @page { size: A4; margin: 10mm; } [data-noprint] { display: none !important; } body { background: #fff !important; } .report-sheet { box-shadow: none !important; border: 0 !important; padding: 0 !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="mb-4 flex flex-wrap items-center gap-2" data-noprint>
        {data.periods.map((p) => (
          <button key={p.key} onClick={() => onPeriod(p.key)} data-testid={`report-period-${p.key}`}
            className="min-h-[44px] rounded-lg border px-3 text-sm font-medium"
            style={{ color: p.key === data.period ? "#ffffff" : INK, background: p.key === data.period ? INK : "#ffffff", borderColor: p.key === data.period ? INK : "#cbd5e1" }}>{p.label}</button>
        ))}
        <button onClick={() => window.print()} className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-100" style={{ color: INK }} data-testid="report-pdf">
          <Printer className="h-4 w-4" /> Save as PDF
        </button>
      </div>

      <div className="report-sheet rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 pb-5">
          <img src="/logos/south-island-united.png" alt="South Island United" className="h-14 w-14 object-contain" />
          <span className="text-2xl font-light text-slate-400">×</span>
          {data.logoUrl
            ? <span className="grid h-14 min-w-[56px] place-items-center rounded-lg px-3" style={{ background: data.logoGround === "dark" ? "#0b1a3a" : "#ffffff", border: data.logoGround === "dark" ? "0" : "1px solid #e2e8f0" }}><img src={data.logoUrl} alt={data.sponsor} className="max-h-9 max-w-[140px] object-contain" /></span>
            : <span className="text-xl font-semibold" style={{ color: INK }}>{data.sponsor}</span>}
          <div className="min-w-0 flex-1 sm:text-right">
            <p className="text-lg font-semibold" style={{ color: INK }} data-testid="report-title">{data.sponsor} on South Island United's channels</p>
            <p className="text-sm text-slate-600" data-testid="report-period">{data.periodLabel}{data.today ? ` · as at ${dayName(data.today)}` : ""}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(([label, value, id]) => (
            <div key={id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-3xl font-semibold tabular-nums" style={{ color: INK }} data-testid={id}>{value}</p>
              <p className="mt-1 text-xs leading-snug text-slate-600">{label}</p>
            </div>
          ))}
        </div>

        {t.posts === 0 ? (
          <p className="py-10 text-center text-sm text-slate-600" data-testid="report-empty">No posts with you in them in this period. Try a longer time frame.</p>
        ) : (
          <>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold" style={{ color: INK }}>Where it was seen</p>
                <div className="space-y-2">
                  {(data.byPlatform ?? []).map((p) => (
                    <div key={p.platform} data-testid="report-platform">
                      <div className="flex justify-between text-sm text-slate-700"><span>{PLATFORM[p.platform] ?? p.platform} · {p.posts} {p.posts === 1 ? "post" : "posts"}</span><span className="font-semibold tabular-nums" style={{ color: INK }}>{num(p.views)}</span></div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${Math.max(2, ((p.views ?? 0) / maxPlat) * 100)}%`, background: "#c59949" }} /></div>
                    </div>
                  ))}
                </div>
                {t.collabPosts > 0 && <p className="mt-3 text-xs text-slate-600">{t.collabPosts} of these {t.collabPosts === 1 ? "was a shared post" : "were shared posts"} with another account ({num(t.collabViews)} views).</p>}
                <p className="mt-3 text-xs text-slate-600">Likes {num(t.likes)} · Comments {num(t.comments)} · Shares {num(t.shares)} · Saves {num(t.saves)}</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold" style={{ color: INK }}>Views by month</p>
                <div className="flex h-32 items-end gap-1.5" data-testid="report-months">
                  {(data.byMonth ?? []).map((m) => (
                    <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${monthName(m.month)}: ${num(m.views)} views, ${m.posts} posts`}>
                      <span className="text-[10px] tabular-nums text-slate-600">{m.views === null ? "—" : m.views >= 1000 ? `${Math.round(m.views / 1000)}k` : m.views}</span>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(3, ((m.views ?? 0) / maxMonth) * 88)}px`, background: INK }} />
                      <span className="text-[10px] text-slate-600">{monthName(m.month).slice(0, 3)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {(data.topPosts ?? []).length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-semibold" style={{ color: INK }}>Most seen posts</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {data.topPosts!.map((p) => (
                    <a key={p.id} href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="block" data-testid="report-top-post">
                      <div className="aspect-[4/5] overflow-hidden rounded-lg bg-slate-200"><img src={`${base}/post/${p.id}/picture`} alt="" loading="lazy" className="h-full w-full object-cover" /></div>
                      <p className="mt-1 text-xs font-semibold tabular-nums" style={{ color: INK }}>{num(p.views)} views</p>
                      <p className="text-[11px] text-slate-600">{PLATFORM[p.platform] ?? p.platform} · {dayName(p.day)}</p>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="mt-6 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500">
          Counts South Island United's own posts in which your brand was checked by a person and can be seen, or that were made with you. Views are the numbers Instagram and Facebook report for each post. This page always shows the latest figures.
        </p>
      </div>
    </div>
  );
}
