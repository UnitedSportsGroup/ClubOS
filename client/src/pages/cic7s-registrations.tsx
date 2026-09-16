// CIC 7's — Registrations of Interest, by edition.
// Lives in the Tournament workspace under the "CIC 7's" view (toggled via the
// Youth/7's switcher in the sidebar). Internal-only — session + tab permission.
//
// Isaac asked (via Daniel, 2026-09-16) to see last year's list separately from
// this year's. 🔴 The chosen year lives in the URL, not in component state, so
// the tiles and the list read ONE value, Back steps between years, and "the 2026
// list" is a link somebody can send. That is the same fix the Players tab needed
// when its tiles said 151 while the list under them showed 5.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ClipboardCheck, Mail, Phone, MapPin, Inbox, Users } from "lucide-react";
import { CIC7S_ENTRY_PAYMENT_LABEL, type Cic7sEntryPayment } from "@shared/cic7s";
// 🔴 workspaceFetch, never a bare fetch(): this endpoint is requireTab-gated and
// a bare call sends no X-Workspace-Slug, which answers 400 for staff.
import { workspaceFetch } from "@/lib/queryClient";

interface Registration {
  id: number;
  firstName: string;
  lastName: string | null;
  email: string;
  location: string | null;
  phone: string | null;
  category: string | null;
  sourceUrl: string | null;
  status: string;
  editionYear: number | null;
  teamName: string | null;
  entryPayment: Cic7sEntryPayment | null;
  notes: string | null;
  /** Set when the sales page on cic7s.com turned this interest into a Team Pay entry. */
  teampayEntryId: number | null;
  createdAt: string;
}
interface Payload { registrations: Registration[]; editions: { year: number | null; count: number }[] }

// 🔴 Both vocabularies. 2026 ran Men's, Masters and Social; 2027 dropped Masters
// and renamed Men's to Open. Normalising them would erase a real product change.
const CATEGORY_STYLE: Record<string, string> = {
  Open: "text-sky-300 bg-sky-400/10 border-sky-400/25",
  Mens: "text-sky-300 bg-sky-400/10 border-sky-400/25",
  Masters: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  Social: "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
  "Social + Masters": "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
  "Social / Mens": "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
};
const PAYMENT_STYLE: Record<Cic7sEntryPayment, string> = {
  paid: "text-lime-300 bg-lime-400/10 border-lime-400/25",
  part_paid: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  unpaid: "text-white/50 bg-white/[0.04] border-white/10",
  refunded: "text-rose-300 bg-rose-400/10 border-rose-400/25",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

/** The chosen year, read from and written to the URL. */
function useYearParam(): [number | null, (y: number | null) => void] {
  const read = () => {
    const raw = new URLSearchParams(window.location.search).get("year");
    if (raw == null || raw === "" || raw === "all") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const [year, setYearState] = useState<number | null>(read);
  useEffect(() => {
    const onPop = () => setYearState(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const setYear = (y: number | null) => {
    const url = new URL(window.location.href);
    if (y == null) url.searchParams.delete("year"); else url.searchParams.set("year", String(y));
    // pushState so Back steps between years rather than leaving the page.
    window.history.pushState({}, "", url);
    setYearState(y);
  };
  return [year, setYear];
}

export default function Cic7sRegistrations() {
  const [year, setYear] = useYearParam();
  const { data, isLoading } = useQuery<Payload>({
    queryKey: ["/api/admin/cic7s/registrations", year ?? "all"],
    queryFn: async () => {
      const qs = year == null ? "" : `?year=${year}`;
      const res = await workspaceFetch(`/api/admin/cic7s/registrations${qs}`);
      if (!res.ok) throw new Error("Could not load registrations");
      return res.json();
    },
  });
  const regos = data?.registrations ?? [];
  const editions = data?.editions ?? [];

  const teams = regos.filter((r) => r.teamName);
  const counts = regos.reduce((acc, r) => {
    const c = r.category || "";
    if (c) acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white/90 flex items-center gap-2.5">
            <ClipboardCheck className="w-6 h-6 text-blue-400" />
            CIC 7's — Registrations of Interest
          </h1>
          <p className="text-sm text-white/40 mt-1">
            Interest from the cic7s.com form, and the teams that went on to enter.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
          <span className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white/70" data-testid="text-total">
            {regos.length} {year == null ? "in total" : `in ${year}`}
          </span>
          {teams.length > 0 && (
            <span className="px-3 py-1.5 rounded-lg border text-lime-300 bg-lime-400/10 border-lime-400/25" data-testid="text-teams">
              {teams.length} entered a team
            </span>
          )}
          {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <span key={c} className={`px-3 py-1.5 rounded-lg border ${CATEGORY_STYLE[c] || "text-white/60 bg-white/5 border-white/10"}`}>
              {n} {c}
            </span>
          ))}
        </div>
      </div>

      {/* The year picker. Rendered from the editions that actually have rows. */}
      {editions.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="picker-edition">
          {editions.map((e) => (
            <button
              key={String(e.year)}
              onClick={() => setYear(e.year)}
              data-testid={`button-year-${e.year ?? "none"}`}
              className={`px-3.5 py-2 rounded-lg border text-[12.5px] transition-colors ${
                year === e.year
                  ? "bg-blue-500/15 border-blue-500/35 text-white/90"
                  : "bg-white/[0.03] border-white/10 text-white/55 hover:bg-white/[0.06]"
              }`}
            >
              {e.year == null ? "Not recorded" : e.year}
              <span className="ml-1.5 text-white/35">{e.count}</span>
            </button>
          ))}
          <button
            onClick={() => setYear(null)}
            data-testid="button-year-all"
            className={`px-3.5 py-2 rounded-lg border text-[12.5px] transition-colors ${
              year == null
                ? "bg-blue-500/15 border-blue-500/35 text-white/90"
                : "bg-white/[0.03] border-white/10 text-white/55 hover:bg-white/[0.06]"
            }`}
          >
            Every year
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-white/40 text-sm py-16 text-center">Loading registrations…</div>
      ) : regos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox className="w-10 h-10 text-white/20 mb-3" />
          <p className="text-white/60 font-medium">Nothing here{year == null ? "" : ` for ${year}`}</p>
          <p className="text-white/35 text-sm mt-1">New interest from cic7s.com appears here as it comes in.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-white/35 border-b border-white/[0.06]">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Location</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Team</th>
                {year == null && <th className="px-4 py-3 font-semibold">Year</th>}
                <th className="px-4 py-3 font-semibold">Received</th>
              </tr>
            </thead>
            <tbody>
              {regos.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors" data-testid={`row-rego-${r.id}`}>
                  <td className="px-4 py-3 text-white/90 font-medium whitespace-nowrap">
                    {r.firstName}{r.lastName ? ` ${r.lastName}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {r.email ? (
                        <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 text-white/70 hover:text-blue-300 transition-colors">
                          <Mail className="w-3.5 h-3.5 text-white/30" /> {r.email}
                        </a>
                      ) : (
                        /* 🔴 Four 2026 teams have no email on file at all. Saying so
                           is the point — a blank cell reads like a bug. */
                        <span className="text-white/25 text-xs">no email on file</span>
                      )}
                      {r.phone && (
                        <a href={`tel:${r.phone}`} className="flex items-center gap-1.5 text-white/50 hover:text-blue-300 transition-colors">
                          <Phone className="w-3.5 h-3.5 text-white/30" /> {r.phone}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/60">
                    {r.location ? (
                      <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-white/30" /> {r.location}</span>
                    ) : <span className="text-white/25">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.category ? (
                      <span className={`px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap ${CATEGORY_STYLE[r.category] || "text-white/60 bg-white/5 border-white/10"}`}>
                        {r.category}
                      </span>
                    ) : <span className="text-white/25">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.teamName ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 text-white/85">
                          <Users className="w-3.5 h-3.5 text-white/30" /> {r.teamName}
                        </span>
                        {r.entryPayment && (
                          <span className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${PAYMENT_STYLE[r.entryPayment]}`}>
                            {CIC7S_ENTRY_PAYMENT_LABEL[r.entryPayment]}
                          </span>
                        )}
                      </div>
                    ) : r.teampayEntryId ? (
                      <a href="/admin/team-entries" className="px-2.5 py-1 rounded-md border text-xs font-medium text-lime-300 bg-lime-400/10 border-lime-400/25 hover:bg-lime-400/20 transition-colors">
                        Entry #{r.teampayEntryId}
                      </a>
                    ) : <span className="text-white/25">interest only</span>}
                  </td>
                  {year == null && (
                    <td className="px-4 py-3 text-white/45 whitespace-nowrap">
                      {r.editionYear ?? <span className="text-white/25">not recorded</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-white/45 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
