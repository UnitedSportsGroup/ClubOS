/**
 * A vehicle's history as one continuous ledger, and the condition photographs
 * that sit inside it.
 *
 * Daniel, 2026-09-21: "be able to see like for example travis had car from 20th
 * july 2026 to 12th september 2026 and then we assign new person from start to
 * end date and any dates not clicked are shown as blank, no one had car at this
 * time and it was parked at United Sports Centre."
 *
 * 🔴 THE PAGE DRAWS WHAT THE SERVER DERIVED. The gaps are computed by
 * @shared/occupancy-timeline — shared with the residency — so a handover that
 * leaves no clear day produces no gap, and the page never has to decide that.
 *
 * 🔴 A PHOTO SITS UNDER THE PERSON WHO HELD IT THAT DAY, matched by the date it
 * was TAKEN, not the date it was uploaded. That is the whole point: it answers
 * "who had the van when this dent appeared".
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Camera, MapPin, Upload, Trash2, FileText, Download, AlertTriangle, User } from "lucide-react";

type Segment =
  | {
      kind: "held"; id: number; assignmentId: number; holderName: string;
      from: string; to: string | null; open: boolean; days: number | null;
      odometerStartKm: number | null; odometerEndKm: number | null; purpose: string | null;
    }
  | { kind: "empty"; from: string; to: string | null; open: boolean; days: number | null; parkedLocation: string | null };

type Media = {
  id: number; takenOn: string; uploadedAt: string; uploadedByName: string | null;
  fileName: string | null; contentType: string | null; caption: string | null;
};

interface HistoryResponse {
  todayIso: string;
  parkedLocation: string | null;
  segments: Segment[];
  media: Media[];
}

/** `2026-07-20` → `20 Jul 2026`. Never through a JS Date: a bare ISO date
 *  parsed as one reads a day early in NZ all evening. */
function niceDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[m - 1] ?? "?"} ${y}`;
}

function spanLabel(from: string, to: string | null, open: boolean, todayIso: string): string {
  if (open) return `${niceDate(from)} — present`;
  return `${niceDate(from)} — ${niceDate(to)}`;
}

function daysLabel(days: number | null): string {
  if (days == null) return "";
  if (days === 1) return "1 day";
  if (days < 14) return `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks < 9 ? `${weeks} weeks` : `${Math.round(days / 30.4)} months`;
}

const isVideo = (ct: string | null) => !!ct && ct.startsWith("video/");

export function VehicleHistoryTab({ vehicleId }: { vehicleId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [`/api/admin/vehicles/${vehicleId}/history`];
  const { data, isLoading } = useQuery<HistoryResponse>({ queryKey: key });

  const fileRef = useRef<HTMLInputElement>(null);
  const [takenOn, setTakenOn] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  // Each photo belongs to the segment whose span contains the day it was taken.
  // Derived here so a corrected assignment date moves the photo with it.
  const mediaBySegment = useMemo(() => {
    const map = new Map<string, Media[]>();
    for (const m of data?.media ?? []) {
      const seg = (data?.segments ?? []).find(
        (s) => m.takenOn >= s.from && (s.to === null || m.takenOn <= s.to),
      );
      const k = seg ? `${seg.kind}-${seg.from}` : "unplaced";
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    return map;
  }, [data]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast({ title: "Choose a photo or video first", variant: "destructive" }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) {
      toast({ title: "When was it taken?", description: "A date is needed so the photo lands under the right person.", variant: "destructive" });
      return;
    }
    const body = new FormData();
    body.append("file", file);
    body.append("takenOn", takenOn);
    if (caption.trim()) body.append("caption", caption.trim());
    setBusy(true);
    try {
      const res = await workspaceFetch(`/api/admin/vehicles/${vehicleId}/condition-media`, { method: "POST", body });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
      if (fileRef.current) fileRef.current.value = "";
      setCaption("");
      qc.invalidateQueries({ queryKey: key });
      toast({ title: "Added to the history" });
    } catch (e: any) {
      toast({ title: "Could not add it", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const removeMedia = useMutation({
    mutationFn: async (id: number) => {
      const res = await workspaceFetch(`/api/admin/vehicles/${vehicleId}/condition-media/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: "Removed" }); },
    onError: (e: Error) => toast({ title: "Could not remove it", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="text-white/30 text-sm py-8 text-center">Loading…</div>;

  const unplaced = mediaBySegment.get("unplaced") ?? [];

  return (
    <div className="space-y-4">
      {/* ── Add a condition photo ───────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40 font-semibold">
          <Camera className="w-3.5 h-3.5" /> Photo or video of its condition
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*,video/*"
            className="text-[12px] text-white/50 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-500/15 file:px-2.5 file:py-1 file:text-[11px] file:text-blue-300"
            data-testid="input-condition-file" />
          {/* 🔴 The day it was TAKEN, which is not the day it was uploaded — the
              server keeps both, and this is the one that places it in history. */}
          <DatePickerInput value={takenOn} onChange={(e) => setTakenOn(e.target.value)}
            className="premium-input h-8 w-[150px] text-[12px]" title="The day the photo shows"
            data-testid="input-condition-date" />
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Note (optional)"
            className="premium-input h-8 flex-1 min-w-[140px] text-[12px]" data-testid="input-condition-caption" />
          <Button size="sm" onClick={upload} disabled={busy}
            className="h-8 rounded-lg text-[12px]" data-testid="button-condition-upload">
            <Upload className="w-3.5 h-3.5 mr-1.5" />{busy ? "Adding…" : "Add"}
          </Button>
        </div>
        <p className="text-[11px] text-white/25">
          It files itself under whoever held the vehicle that day.
        </p>
      </div>

      {/* ── The ledger ──────────────────────────────────────────────────── */}
      {data.segments.length === 0 ? (
        <p className="text-white/30 text-[13px] py-6 text-center">
          No history yet — record who has the vehicle on the Assignments tab.
        </p>
      ) : (
        <div className="space-y-2" data-testid="vehicle-timeline">
          {[...data.segments].reverse().map((s, i) => {
            const media = mediaBySegment.get(`${s.kind}-${s.from}`) ?? [];
            if (s.kind === "held") {
              return (
                <div key={`h-${s.assignmentId}`} className="rounded-xl border border-blue-500/15 bg-blue-500/[0.04] p-3"
                  data-testid={`segment-held-${s.assignmentId}`}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <User className="w-3.5 h-3.5 text-blue-400/60 self-center" />
                    <span className="text-[13px] font-medium text-white/85">{s.holderName}</span>
                    <span className="text-[12px] text-white/45">{spanLabel(s.from, s.to, s.open, data.todayIso)}</span>
                    {s.days != null && <span className="text-[11px] text-white/25">· {daysLabel(s.days)}</span>}
                    {s.open && <span className="text-[10px] uppercase tracking-wider text-emerald-400/80 ml-auto">has it now</span>}
                  </div>
                  {(s.odometerStartKm != null || s.odometerEndKm != null) && (
                    <p className="text-[11px] text-white/25 mt-1">
                      {s.odometerStartKm != null ? `${s.odometerStartKm.toLocaleString()} km` : "—"}
                      {" → "}
                      {s.odometerEndKm != null ? `${s.odometerEndKm.toLocaleString()} km` : "—"}
                    </p>
                  )}
                  <MediaStrip vehicleId={vehicleId} media={media} onRemove={(id) => removeMedia.mutate(id)} />
                </div>
              );
            }
            return (
              <div key={`e-${s.from}-${i}`} className="rounded-xl border border-dashed border-white/[0.10] bg-white/[0.015] p-3"
                data-testid={`segment-empty-${s.from}`}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <MapPin className="w-3.5 h-3.5 text-white/25 self-center" />
                  <span className="text-[13px] text-white/45">Nobody had it</span>
                  <span className="text-[12px] text-white/35">{spanLabel(s.from, s.to, s.open, data.todayIso)}</span>
                  {s.days != null && <span className="text-[11px] text-white/20">· {daysLabel(s.days)}</span>}
                </div>
                {/* 🔴 Never a guessed address. Nobody has said is its own answer. */}
                <p className="text-[11px] text-white/30 mt-1">
                  {s.parkedLocation
                    ? <>Parked at <span className="text-white/50">{s.parkedLocation}</span></>
                    : <span className="text-amber-300/60">Parking place not recorded — set one on the Overview tab</span>}
                </p>
                <MediaStrip vehicleId={vehicleId} media={media} onRemove={(id) => removeMedia.mutate(id)} />
              </div>
            );
          })}
        </div>
      )}

      {/* A photo whose date falls outside every stint — usually a typo. Shown
          rather than silently dropped, so somebody can fix the date. */}
      {unplaced.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-300/70 mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {unplaced.length} photo{unplaced.length === 1 ? "" : "s"} dated outside every recorded stint
          </div>
          <MediaStrip vehicleId={vehicleId} media={unplaced} onRemove={(id) => removeMedia.mutate(id)} />
        </div>
      )}
    </div>
  );
}

function MediaStrip({ vehicleId, media, onRemove }: {
  vehicleId: number; media: Media[]; onRemove: (id: number) => void;
}) {
  if (media.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2.5">
      {media.map((m) => (
        <div key={m.id} className="rounded-lg border border-white/[0.08] bg-black/20 p-1.5 w-[132px]"
          data-testid={`media-${m.id}`}>
          <a href={`/api/admin/vehicles/${vehicleId}/condition-media/${m.id}`} target="_blank" rel="noopener noreferrer"
            className="block text-[11px] text-blue-300/80 hover:text-blue-300 truncate">
            {isVideo(m.contentType) ? "▶ " : "🖼 "}{m.fileName ?? "file"}
          </a>
          <p className="text-[10px] text-white/35 mt-0.5">{niceDate(m.takenOn)}</p>
          {/* 🔴 Who added it and when — a different fact from when it was taken. */}
          <p className="text-[10px] text-white/25 truncate" title={new Date(m.uploadedAt).toLocaleString("en-NZ")}>
            {m.uploadedByName ?? "unknown"} · added {new Date(m.uploadedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}
          </p>
          {m.caption && <p className="text-[10px] text-white/40 mt-0.5 line-clamp-2">{m.caption}</p>}
          <button onClick={() => onRemove(m.id)}
            className="mt-1 text-[10px] text-red-400/60 hover:text-red-400 inline-flex items-center gap-1"
            data-testid={`button-remove-media-${m.id}`}>
            <Trash2 className="w-3 h-3" /> remove
          </button>
        </div>
      ))}
    </div>
  );
}
