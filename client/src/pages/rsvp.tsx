// Public RSVP page — landed on by guests clicking the Yes / Maybe / No
// buttons in the invitation email. No auth required; the rsvpToken from the
// URL identifies the invitation. URL pattern: /calendar/rsvp/:token?status=accepted
// Auto-submits if a status query param is present (the email-button case),
// otherwise renders the event details + manual buttons.

import { useEffect, useState } from "react";
import { useParams, useSearch } from "wouter";

interface EventDetails {
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  location: string | null;
  allDay: boolean;
}

interface RsvpData {
  currentStatus: "pending" | "accepted" | "tentative" | "declined";
  inviteeName: string | null;
  inviteeEmail: string;
  event: EventDetails;
}

export default function RsvpPage() {
  const params = useParams<{ token: string }>();
  const search = useSearch();
  const token = params.token;

  const [data, setData] = useState<RsvpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<null | "accepted" | "tentative" | "declined">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/calendar/rsvp/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("Invitation not found")))
      .then((d: RsvpData) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [token]);

  // Auto-submit if ?status= present (email-button click)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const status = params.get("status");
    if (data && !submitted && (status === "accepted" || status === "tentative" || status === "declined")) {
      submitRsvp(status);
    }
  }, [data, search]);

  async function submitRsvp(status: "accepted" | "tentative" | "declined") {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/calendar/rsvp/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Couldn't record your response");
      setSubmitted(status);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-white/60">Loading…</div>;
  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="text-3xl mb-4">😕</div>
        <h1 className="text-xl font-semibold mb-2">Invitation not found</h1>
        <p className="text-sm text-white/60">{error}</p>
      </div>
    </div>
  );
  if (!data) return null;

  const start = new Date(data.event.startTime);
  const end = new Date(data.event.endTime);
  const timeStr = data.event.allDay
    ? start.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " (all day)"
    : `${start.toLocaleString("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} – ${end.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true })}`;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10">
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-7 py-6 text-white">
            <p className="text-[11px] uppercase tracking-[0.12em] opacity-80 font-semibold">Calendar invitation</p>
            <h1 className="text-2xl font-semibold mt-1.5 tracking-tight">{data.event.title}</h1>
          </div>
          <div className="bg-card text-card-foreground p-7 space-y-5">
            {data.inviteeName && (
              <p className="text-sm text-white/70">Hi {data.inviteeName.split(" ")[0]},</p>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex gap-3">
                <span className="text-white/40 w-16">When</span>
                <span className="font-medium">{timeStr}</span>
              </div>
              {data.event.location && (
                <div className="flex gap-3">
                  <span className="text-white/40 w-16">Where</span>
                  <span>{data.event.location}</span>
                </div>
              )}
            </div>
            {data.event.description && (
              <div className="text-sm leading-relaxed text-white/70 whitespace-pre-wrap pt-2 border-t border-white/[0.06]">
                {data.event.description}
              </div>
            )}

            <div className="pt-4 border-t border-white/[0.06]">
              {submitted ? (
                <div className="text-center py-4">
                  <div className="text-3xl mb-2">{submitted === "accepted" ? "✅" : submitted === "tentative" ? "🤔" : "🚫"}</div>
                  <p className="text-sm font-medium mb-1">
                    {submitted === "accepted" && "You're going!"}
                    {submitted === "tentative" && "Marked as tentative"}
                    {submitted === "declined" && "You've declined"}
                  </p>
                  <p className="text-[11px] text-white/40">The organiser has been notified. You can change your response anytime by clicking another option.</p>
                  <div className="flex gap-2 justify-center mt-4">
                    {submitted !== "accepted" && <button onClick={() => submitRsvp("accepted")} disabled={submitting} className="text-[11px] px-3 py-1.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25">Going</button>}
                    {submitted !== "tentative" && <button onClick={() => submitRsvp("tentative")} disabled={submitting} className="text-[11px] px-3 py-1.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25">Maybe</button>}
                    {submitted !== "declined" && <button onClick={() => submitRsvp("declined")} disabled={submitting} className="text-[11px] px-3 py-1.5 rounded-md bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25">Decline</button>}
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs font-medium text-white/60 mb-3">Will you attend?</p>
                  <div className="flex gap-2">
                    <button onClick={() => submitRsvp("accepted")} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">✓ Yes</button>
                    <button onClick={() => submitRsvp("tentative")} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50">Maybe</button>
                    <button onClick={() => submitRsvp("declined")} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50">✗ No</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <p className="text-center text-[10px] text-white/30 mt-4">ClubOS · Christchurch United FC</p>
      </div>
    </div>
  );
}
