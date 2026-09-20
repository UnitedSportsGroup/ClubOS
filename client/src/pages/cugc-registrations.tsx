// CUGC — Gymnastics Enrolments.
// Lives in the Gymnastics workspace → Registrations tab. Lists enrolments from
// the cugc.co.nz enrol form. A row is 'pending_payment' until the CUGC Stripe
// webhook confirms it 'paid'. Internal-only — session + tab permission.
import { useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ClipboardCheck, Mail, Phone, Inbox, X, CalendarDays } from "lucide-react";

interface Registration {
  id: number;
  programSlug: string;
  programName: string;
  optionLabel: string;
  sessionTime: string | null;
  priceCents: number;
  fullPriceCents: number;
  term: string | null;
  gymnastName: string;
  gymnastDob: string | null;
  parentName: string;
  email: string;
  phone: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  medical: string | null;
  photoConsent: string | null;
  heardVia: string | null;
  status: string;
  stripeSessionId: string | null;
  stripePaymentIntent: string | null;
  paidAt: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  paid: "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
  pending_payment: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  cancelled: "text-white/40 bg-white/[0.04] border-white/10",
};
const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  pending_payment: "Pending",
  cancelled: "Cancelled",
};

interface TermCfg {
  id: string; name: string; start: string; end: string; weeks: number;
  enrolmentOpen: boolean; status: "upcoming" | "active" | "ended"; sellable: boolean; window: string;
}
interface ProgramConfig {
  term: { name: string; start: string; end: string; weeks: number };
  terms?: TermCfg[];
  programs: { slug: string; title: string; ages: string; options: { label: string; price: number }[] }[];
}

// A registration whose term was never recorded. Shown as its own chip rather
// than folded into a real term — an unanswered question, not a guess.
const NO_TERM = "__none__";

function money(cents: number): string {
  const dollars = (cents || 0) / 100;
  return dollars % 1 === 0
    ? `$${dollars.toLocaleString("en-NZ")}`
    : `$${dollars.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function CugcRegistrations() {
  const { data: regos = [], isLoading } = useQuery<Registration[]>({ queryKey: ["/api/admin/cugc/registrations"] });
  const { data: cfg } = useQuery<ProgramConfig>({ queryKey: ["/api/admin/cugc/programs"] });
  const search = useSearch(); // supports deep links from the Programs tab (?program=gymplay)
  const [filter, setFilter] = useState<"all" | "paid" | "pending_payment" | "cancelled">("all");
  const [progFilter, setProgFilter] = useState<string>(() => new URLSearchParams(search).get("program") || "all");
  const [selected, setSelected] = useState<Registration | null>(null);

  // 🔴 WHICH TERM. Daniel, 2026-09-20: "separate out term 3 and term 4 regos".
  // Before this, 35 enrolments across two terms were one pile and one total.
  //
  // It lives in the URL, not in component state, for three reasons the academy
  // learned the hard way: browser Back returns you to the term you were on, a
  // term can be linked to, and — most of all — the TILES AND THE LIST READ THE
  // SAME VALUE. The academy's Players tab once showed 5 people under tiles
  // reading 151. `replaceState`, not push: flicking between two terms must not
  // bury the page you arrived from.
  const [termFilter, setTermFilterState] = useState<string>(() => new URLSearchParams(search).get("term") || "");
  const setTermFilter = (t: string) => {
    setTermFilterState(t);
    const q = new URLSearchParams(window.location.search);
    t ? q.set("term", t) : q.delete("term");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };

  // Every term that actually appears in the data, plus every term ClubOS knows
  // about — so a term with no sign-ups yet is still selectable and reads zero
  // rather than vanishing.
  const termNames = Array.from(new Set([
    ...(cfg?.terms ?? []).map((t) => t.name),
    ...regos.map((r) => r.term).filter((t): t is string => !!t),
  ]));
  const hasUnrecorded = regos.some((r) => !r.term);

  // Default to the term being SOLD, but only once we know what that is.
  const effectiveTerm = termFilter || cfg?.term.name || "all";

  const inTerm = effectiveTerm === "all" ? regos
    : effectiveTerm === NO_TERM ? regos.filter((r) => !r.term)
    : regos.filter((r) => r.term === effectiveTerm);

  const inProgram = progFilter === "all" ? inTerm : inTerm.filter((r) => r.programSlug === progFilter);
  const counts = {
    all: inProgram.length,
    paid: inProgram.filter((r) => r.status === "paid").length,
    pending_payment: inProgram.filter((r) => r.status === "pending_payment").length,
    cancelled: inProgram.filter((r) => r.status === "cancelled").length,
  };
  const shown = filter === "all" ? inProgram : inProgram.filter((r) => r.status === filter);

  // Reads `inTerm`, NOT every row — otherwise the cards above the list would
  // count a different population from the list itself.
  const statsFor = (slug: string | "all") => {
    const rows = slug === "all" ? inTerm : inTerm.filter((r) => r.programSlug === slug);
    return {
      paid: rows.filter((r) => r.status === "paid").length,
      pending: rows.filter((r) => r.status === "pending_payment").length,
      revenue: rows.filter((r) => r.status === "paid").reduce((sum, r) => sum + (r.priceCents || 0), 0),
    };
  };

  const termStats = (name: string) => {
    const rows = name === "all" ? regos
      : name === NO_TERM ? regos.filter((r) => !r.term)
      : regos.filter((r) => r.term === name);
    return {
      count: rows.length,
      revenue: rows.filter((r) => r.status === "paid").reduce((sum, r) => sum + (r.priceCents || 0), 0),
    };
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white/90 flex items-center gap-2.5">
            <ClipboardCheck className="w-6 h-6 text-blue-400" />
            CUGC — Enrolments{effectiveTerm && effectiveTerm !== "all" && effectiveTerm !== NO_TERM ? ` · ${effectiveTerm}` : ""}
          </h1>
          <p className="text-sm text-white/40 mt-1">Enrolments from the cugc.co.nz enrol form. Paid via CUGC's Stripe account. Pick a program to see its roster.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {([
            ["all", "All"],
            ["paid", "Paid"],
            ["pending_payment", "Pending"],
            ["cancelled", "Cancelled"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${
                filter === key ? "bg-blue-500/15 border-blue-400/40 text-blue-200" : "bg-white/[0.04] border-white/10 text-white/60 hover:text-white/90"
              }`}
            >
              {label} · {counts[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Which term. Each chip carries its OWN count and money, so the numbers
          can never be read as the club's whole history. */}
      {(termNames.length > 1 || hasUnrecorded) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-white/35 inline-flex items-center gap-1.5 pr-1">
            <CalendarDays className="w-3.5 h-3.5" /> Term
          </span>
          {termNames.map((name) => {
            const st = termStats(name);
            const on = effectiveTerm === name;
            const meta = (cfg?.terms ?? []).find((t) => t.name === name);
            return (
              <button
                key={name}
                onClick={() => setTermFilter(name)}
                data-testid={`chip-term-${name.replace(/\s+/g, "-").toLowerCase()}`}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  on ? "bg-blue-500/15 border-blue-400/40 text-blue-200" : "bg-white/[0.04] border-white/10 text-white/60 hover:text-white/90"
                }`}
                title={meta ? `${meta.window}${meta.status === "ended" ? " · finished" : meta.status === "upcoming" ? " · not started" : " · running now"}` : undefined}
              >
                {name} · {st.count}
                {st.revenue > 0 && <span className="text-emerald-300/70"> · {money(st.revenue)}</span>}
              </button>
            );
          })}
          {hasUnrecorded && (
            <button
              onClick={() => setTermFilter(NO_TERM)}
              className={`px-3 py-1.5 rounded-lg border transition-colors ${
                effectiveTerm === NO_TERM ? "bg-amber-500/15 border-amber-400/40 text-amber-200" : "bg-white/[0.04] border-white/10 text-white/60 hover:text-white/90"
              }`}
            >
              Term not recorded · {termStats(NO_TERM).count}
            </button>
          )}
          <button
            onClick={() => setTermFilter("all")}
            data-testid="chip-term-all"
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              effectiveTerm === "all" ? "bg-blue-500/15 border-blue-400/40 text-blue-200" : "bg-white/[0.04] border-white/10 text-white/60 hover:text-white/90"
            }`}
          >
            All terms · {regos.length}
          </button>
        </div>
      )}

      {/* Program dashboard cards — mirror the live cugc.co.nz program structure */}
      {cfg && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[{ slug: "all", title: "All programs", ages: "" }, ...cfg.programs].map((p) => {
            const s = statsFor(p.slug as string);
            const active = progFilter === p.slug;
            return (
              <button
                key={p.slug}
                onClick={() => setProgFilter(p.slug)}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  active ? "bg-blue-500/15 border-blue-400/40" : "bg-white/[0.03] border-white/[0.08] hover:border-white/20"
                }`}
                data-testid={`card-program-${p.slug}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`text-sm font-semibold truncate ${active ? "text-blue-200" : "text-white/85"}`}>{p.title}</p>
                  {p.ages && <p className="text-[11px] text-white/35 whitespace-nowrap">{p.ages}</p>}
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-white/90">{s.paid}</span>
                  <span className="text-xs text-white/40">enrolled</span>
                  {s.pending > 0 && <span className="text-xs text-amber-300/80">+{s.pending} pending</span>}
                </div>
                <p className="mt-1 text-xs text-emerald-300/80">{money(s.revenue)} paid</p>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="text-white/40 text-sm py-16 text-center">Loading enrolments…</div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox className="w-10 h-10 text-white/20 mb-3" />
          <p className="text-white/60 font-medium">No enrolments {filter === "all" && progFilter === "all" && effectiveTerm === "all" ? "yet" : "in this view"}</p>
          <p className="text-white/35 text-sm mt-1">New enrolments from cugc.co.nz will appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-white/35 border-b border-white/[0.06]">
                <th className="px-4 py-3 font-semibold">Gymnast</th>
                <th className="px-4 py-3 font-semibold">Program</th>
                <th className="px-4 py-3 font-semibold">Session</th>
                <th className="px-4 py-3 font-semibold">Parent</th>
                <th className="px-4 py-3 font-semibold">Price</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Received</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                  data-testid={`row-rego-${r.id}`}
                >
                  <td className="px-4 py-3 text-white/90 font-medium whitespace-nowrap">{r.gymnastName}</td>
                  <td className="px-4 py-3 text-white/70">
                    <div className="flex flex-col">
                      <span>{r.programName}</span>
                      <span className="text-white/40 text-xs">{r.optionLabel}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/60 whitespace-nowrap">{r.sessionTime || <span className="text-white/25">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-white/80">{r.parentName}</span>
                      <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-white/50 hover:text-blue-300 transition-colors text-xs">
                        <Mail className="w-3 h-3 text-white/30" /> {r.email}
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/80 font-medium whitespace-nowrap">{money(r.priceCents)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-1 rounded-md border text-xs font-medium ${STATUS_STYLE[r.status] || STATUS_STYLE.cancelled}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/45 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DetailModal reg={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DetailModal({ reg, onClose }: { reg: Registration; onClose: () => void }) {
  const setStatus = useMutation({
    mutationFn: (status: string) => apiRequest("POST", `/api/admin/cugc/registrations/${reg.id}/status`, { status }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cugc/registrations"] });
      onClose();
    },
  });

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-white/35">{label}</p>
      <p className="text-sm text-white/85 mt-0.5">{value || <span className="text-white/25">—</span>}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white/90">{reg.gymnastName}</h2>
            <p className="text-xs text-white/40 mt-0.5">{reg.programName} · {reg.optionLabel}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/90"><X className="w-5 h-5" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            {field("Status", <span className={`px-2 py-0.5 rounded-md border text-xs font-medium ${STATUS_STYLE[reg.status] || STATUS_STYLE.cancelled}`}>{STATUS_LABEL[reg.status] || reg.status}</span>)}
            {field("Price paid", `${money(reg.priceCents)}${reg.priceCents !== reg.fullPriceCents ? ` (full ${money(reg.fullPriceCents)})` : ""}`)}
            {field("Term", reg.term)}
            {field("Session time", reg.sessionTime)}
            {field("Date of birth", reg.gymnastDob)}
            {field("Enrolled", fmtDate(reg.createdAt))}
          </div>

          <div className="border-t border-white/[0.06] pt-4 grid grid-cols-2 gap-4">
            {field("Parent / caregiver", reg.parentName)}
            {field("Phone", reg.phone ? <a href={`tel:${reg.phone}`} className="hover:text-blue-300 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-white/30" />{reg.phone}</a> : null)}
            {field("Email", <a href={`mailto:${reg.email}`} className="hover:text-blue-300 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-white/30" />{reg.email}</a>)}
            {field("How they heard", reg.heardVia)}
            {field("Emergency contact", reg.emergencyName)}
            {field("Emergency phone", reg.emergencyPhone)}
          </div>

          <div className="border-t border-white/[0.06] pt-4 space-y-4">
            {field("Medical / health notes", reg.medical)}
            {field("Photo/video consent", reg.photoConsent)}
            {field("Stripe payment", reg.stripePaymentIntent || reg.stripeSessionId)}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
          {reg.status !== "paid" && (
            <button disabled={setStatus.isPending} onClick={() => setStatus.mutate("paid")} className="px-3 py-1.5 rounded-lg text-sm border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50">Mark paid</button>
          )}
          {reg.status !== "pending_payment" && (
            <button disabled={setStatus.isPending} onClick={() => setStatus.mutate("pending_payment")} className="px-3 py-1.5 rounded-lg text-sm border border-amber-400/30 text-amber-300 hover:bg-amber-400/10 disabled:opacity-50">Mark pending</button>
          )}
          {reg.status !== "cancelled" && (
            <button disabled={setStatus.isPending} onClick={() => setStatus.mutate("cancelled")} className="px-3 py-1.5 rounded-lg text-sm border border-white/15 text-white/60 hover:bg-white/[0.06] disabled:opacity-50">Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}
