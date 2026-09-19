// Football Fest — the 14-15 November 2026 festival at United Sports Centre,
// the weekend the All Whites play India at One New Zealand Stadium.
//
// Lives in the CIC workspace under the "Ethnic" view (the Youth / 7's / Ethnic
// switcher in the sidebar), beside the Ethnic Cup that shares the weekend.
// Internal-only — session + tab permission.
//
// Today this page is one section: registrations of interest from the "Ask about
// a stall" form on footballfest.co.nz. It is laid out to take more (the
// programme, the day-by-day times) without moving anything.
//
// 🔴 No price is shown or asked for anywhere. The public page used to print
// "$200 a day" for a stall; nobody had agreed that with the businesses it was
// aimed at, so a human quotes and this board is where the conversation starts.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Mail, Phone, CalendarDays, ShieldAlert, Inbox, StickyNote } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Registration {
  id: number;
  kind: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  days: string | null;
  about: string | null;
  message: string | null;
  sourceUrl: string | null;
  status: string;
  notes: string | null;
  /** The form guard's verdict at the time it was taken. NULL = not recorded. */
  held: boolean | null;
  heldReasons: string[] | null;
  createdAt: string;
}
interface Payload {
  rows: Registration[];
  counts: Record<string, number>;
  statuses: string[];
}

const STATUS_STYLE: Record<string, string> = {
  new: "text-sky-300 bg-sky-400/10 border-sky-400/25",
  contacted: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  confirmed: "text-emerald-300 bg-emerald-400/10 border-emerald-400/25",
  declined: "text-white/40 bg-white/5 border-white/10",
  archived: "text-white/40 bg-white/5 border-white/10",
};

const KIND_LABEL: Record<string, string> = {
  expo: "Business expo",
  food_truck: "Food truck",
  sponsor: "Sponsor",
  other: "Other",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function FootballFest() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [openNotes, setOpenNotes] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const { data, isLoading } = useQuery<Payload>({ queryKey: ["/api/admin/football-fest/registrations"] });

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/admin/football-fest/registrations/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/football-fest/registrations"] }),
  });

  const rows = data?.rows ?? [];
  const shown = filter === "all" ? rows : filter === "held" ? rows.filter((r) => r.held) : rows.filter((r) => r.status === filter);
  const statuses = data?.statuses ?? [];

  return (
    <div className="p-6 space-y-6" data-testid="page-football-fest">
      <div>
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <Store className="h-6 w-6 text-amber-300" />
          Football Fest
        </h1>
        <p className="mt-1 text-sm text-white/50">
          14–15 November 2026 · United Sports Centre · the weekend the All Whites play India.
          Public page:{" "}
          <a href="https://footballfest.co.nz" target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline">
            footballfest.co.nz
          </a>
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b border-white/10 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Registrations of interest</h2>
            <p className="mt-0.5 text-sm text-white/45">
              Businesses asking about a stall at the festival. No price is quoted on the website —
              someone here replies with one.
            </p>
          </div>
          <span className="shrink-0 text-sm text-white/40">{rows.length} total</span>
        </div>

        {/* Counts are derived server-side from the rows, never stored. */}
        <div className="flex flex-wrap gap-2">
          {["all", ...statuses, "held"].map((s) => {
            const n = s === "all" ? (data?.counts?.total ?? 0) : (data?.counts?.[s] ?? 0);
            const isHeld = s === "held";
            if (isHeld && n === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                data-testid={`filter-${s}`}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  filter === s
                    ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
                    : isHeld
                      ? "border-orange-400/25 bg-orange-400/5 text-orange-300/70 hover:text-orange-200"
                      : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/70"
                }`}
              >
                {isHeld ? "needs a look" : s} <span className="ml-1 opacity-70">{n}</span>
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-white/40">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] py-14 text-center">
            <Inbox className="mx-auto h-8 w-8 text-white/20" />
            <p className="mt-3 text-sm text-white/50">
              {rows.length === 0 ? "No enquiries yet." : "Nothing with that status."}
            </p>
            {rows.length === 0 && (
              <p className="mt-1 text-xs text-white/30">
                They arrive from the “Ask about a stall” form on footballfest.co.nz.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((r) => (
              <article
                key={r.id}
                data-testid={`registration-${r.id}`}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{r.businessName}</h3>
                      <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </span>
                      {r.held && (
                        <span
                          title={(r.heldReasons ?? []).join(", ")}
                          className="inline-flex items-center gap-1 rounded-md border border-orange-400/25 bg-orange-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange-300"
                        >
                          <ShieldAlert className="h-3 w-3" /> needs a look
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-white/60">{r.contactName}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/45">
                      <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1.5 hover:text-white/70">
                        <Mail className="h-3.5 w-3.5" /> {r.email}
                      </a>
                      {r.phone && (
                        <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 hover:text-white/70">
                          <Phone className="h-3.5 w-3.5" /> {r.phone}
                        </a>
                      )}
                      {r.days && (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5" /> {r.days}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-white/30">{fmtDate(r.createdAt)}</span>
                    <select
                      value={r.status}
                      onChange={(e) => patch.mutate({ id: r.id, body: { status: e.target.value } })}
                      data-testid={`status-${r.id}`}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                        STATUS_STYLE[r.status] ?? "text-white/50 bg-white/5 border-white/10"
                      }`}
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s} className="bg-neutral-900 text-white">
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {(r.about || r.message) && (
                  <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3 text-sm text-white/55">
                    {r.about && <p><span className="text-white/35">What they do: </span>{r.about}</p>}
                    {r.message && <p>{r.message}</p>}
                  </div>
                )}

                <div className="mt-3 border-t border-white/5 pt-3">
                  {openNotes === r.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        autoFocus
                        placeholder="Staff notes — never shown to them"
                        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-amber-400/40 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            patch.mutate({ id: r.id, body: { notes: draft } });
                            setOpenNotes(null);
                          }}
                          className="rounded-lg border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-200"
                        >
                          Save note
                        </button>
                        <button
                          onClick={() => setOpenNotes(null)}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/50 hover:text-white/70"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setOpenNotes(r.id);
                        setDraft(r.notes ?? "");
                      }}
                      data-testid={`notes-${r.id}`}
                      className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70"
                    >
                      <StickyNote className="h-3.5 w-3.5" />
                      {r.notes ? r.notes : "Add a note"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
