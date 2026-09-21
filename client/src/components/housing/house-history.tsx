/**
 * A property's history: who was in each room and when, the stretches it sat
 * empty, and what staff saw on their walk-throughs.
 *
 * Daniel, 2026-09-21: "same thing for accommodation we need a history… when
 * travis or someone else from club staff does inspection say once or twice a
 * month they come through take photos/videos upload them and could even label
 * each photo for what room/house it's for and same thing seeing history of like
 * [a player] was in Room 2 main house from January 10th–May 31st and it sat
 * empty from 1st June to July 15th and then [another] moved in on July 16th –
 * present." (His examples were illustrative, not real tenancies.)
 *
 * 🔴 SAME ALGORITHM AS THE VEHICLES. The empty stretches come from
 * @shared/occupancy-timeline via the server — nothing stores them, so
 * correcting a tenancy date corrects the history with it.
 *
 * 🔴 AN INSPECTION IS THE PHOTOS TAKEN ON ONE DAY. There is no inspection
 * record to create first; grouping by date is derived and cannot drift from the
 * photos it claims to contain.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Camera, Upload, Trash2, Home, DoorOpen, User, ExternalLink } from "lucide-react";

type Segment =
  | { kind: "held"; id: number; holderName: string; from: string; to: string | null; open: boolean; days: number | null; meta: Record<string, unknown> }
  | { kind: "empty"; from: string; to: string | null; open: boolean; days: number | null };

type Media = {
  id: number; houseId: number; roomId: number | null; takenOn: string;
  uploadedAt: string; uploadedByName: string | null; fileName: string | null;
  contentType: string | null; caption: string | null;
};

type House = { id: number; name: string; address: string | null; rooms?: { id: number; name: string }[] };

function niceDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${M[m - 1] ?? "?"} ${y}`;
}
function daysLabel(days: number | null): string {
  if (days == null) return "";
  if (days === 1) return "1 day";
  if (days < 14) return `${days} days`;
  const w = Math.round(days / 7);
  return w < 9 ? `${w} weeks` : `${Math.round(days / 30.4)} months`;
}

export function HouseHistoryTab() {
  const { data: houses } = useQuery<House[]>({ queryKey: ["/api/admin/housing/houses"] });
  const [houseId, setHouseId] = useState<number | null>(null);
  const chosen = houses?.find((h) => h.id === houseId) ?? houses?.[0] ?? null;

  if (!houses) return <div className="text-white/30 text-sm py-8 text-center">Loading…</div>;
  if (houses.length === 0) return <div className="text-white/30 text-sm py-8 text-center">No properties yet.</div>;

  return (
    <div className="space-y-4 pt-3">
      <div className="flex flex-wrap gap-1.5" data-testid="house-picker">
        {houses.map((h) => (
          <button key={h.id} onClick={() => setHouseId(h.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${
              chosen?.id === h.id ? "bg-blue-500/15 text-blue-400 border-blue-500/25"
                                  : "text-white/45 border-white/[0.08] hover:text-white/70"}`}
            data-testid={`house-${h.id}`}>
            <Home className="w-3 h-3 inline mr-1.5 -mt-0.5" />{h.name}
          </button>
        ))}
      </div>
      {chosen && <HouseDetail house={chosen} />}
    </div>
  );
}

function HouseDetail({ house }: { house: House }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = [`/api/admin/housing/houses/${house.id}/inspections`];
  const { data } = useQuery<{ rows: Media[]; rooms: { id: number; name: string }[]; todayIso: string }>({ queryKey: key });

  const fileRef = useRef<HTMLInputElement>(null);
  const [takenOn, setTakenOn] = useState("");
  const [roomId, setRoomId] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  // An inspection IS the photos taken on one day — grouped here, never stored.
  const byDate = useMemo(() => {
    const m = new Map<string, Media[]>();
    for (const r of data?.rows ?? []) {
      const d = String(r.takenOn).slice(0, 10);
      m.set(d, [...(m.get(d) ?? []), r]);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast({ title: "Choose a photo or video first", variant: "destructive" }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) {
      toast({ title: "When was the walk-through?", variant: "destructive" }); return;
    }
    const body = new FormData();
    body.append("file", file);
    body.append("takenOn", takenOn);
    if (roomId) body.append("roomId", roomId);
    if (caption.trim()) body.append("caption", caption.trim());
    setBusy(true);
    try {
      const res = await workspaceFetch(`/api/admin/housing/houses/${house.id}/inspections`, { method: "POST", body });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
      if (fileRef.current) fileRef.current.value = "";
      setCaption("");
      qc.invalidateQueries({ queryKey: key });
      toast({ title: "Added to the property's history" });
    } catch (e: any) {
      toast({ title: "Could not add it", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await workspaceFetch(`/api/admin/housing/inspections/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: "Removed" }); },
  });

  const rooms = data?.rooms ?? house.rooms ?? [];

  return (
    <div className="space-y-5">
      {/* ── Walk-through ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40 font-semibold">
          <Camera className="w-3.5 h-3.5" /> Inspection photo or video
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*,video/*"
            className="text-[12px] text-white/50 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-500/15 file:px-2.5 file:py-1 file:text-[11px] file:text-blue-300"
            data-testid="input-inspection-file" />
          <DatePickerInput value={takenOn} onChange={(e) => setTakenOn(e.target.value)}
            className="premium-input h-8 w-[150px] text-[12px]" title="Day of the walk-through"
            data-testid="input-inspection-date" />
          {/* 🔴 The room is OPTIONAL — a photo of the kitchen, the roof or the
              driveway belongs to the property and to no room. */}
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}
            className="premium-input h-8 text-[12px] rounded-lg bg-transparent border border-white/[0.08] px-2 text-white/70"
            data-testid="select-inspection-room">
            <option value="">Whole property</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Note (optional)"
            className="premium-input h-8 flex-1 min-w-[140px] text-[12px]" data-testid="input-inspection-caption" />
          <Button size="sm" onClick={upload} disabled={busy} className="h-8 rounded-lg text-[12px]"
            data-testid="button-inspection-upload">
            <Upload className="w-3.5 h-3.5 mr-1.5" />{busy ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>

      {byDate.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-white/35 font-semibold">Walk-throughs</div>
          {byDate.map(([day, items]) => (
            <div key={day} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3" data-testid={`inspection-${day}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] text-white/80">{niceDate(day)}</span>
                <span className="text-[11px] text-white/30">{items.length} item{items.length === 1 ? "" : "s"}</span>
                <span className="text-[11px] text-white/25 ml-auto">
                  {items[0]?.uploadedByName ?? "unknown"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {items.map((m: Media) => (
                  <div key={m.id} className="rounded-lg border border-white/[0.08] bg-black/20 p-1.5 w-[136px]">
                    <a href={`/api/admin/housing/inspections/${m.id}/file`} target="_blank" rel="noopener noreferrer"
                      className="block text-[11px] text-blue-300/80 hover:text-blue-300 truncate">
                      <ExternalLink className="w-3 h-3 inline mr-1 -mt-0.5" />{m.fileName ?? "file"}
                    </a>
                    <p className="text-[10px] text-white/40 mt-0.5">
                      {m.roomId ? (rooms.find((r) => r.id === m.roomId)?.name ?? "room") : "Whole property"}
                    </p>
                    {m.caption && <p className="text-[10px] text-white/35 line-clamp-2">{m.caption}</p>}
                    <button onClick={() => remove.mutate(m.id)}
                      className="mt-1 text-[10px] text-red-400/60 hover:text-red-400 inline-flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Who was in each room ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-white/35 font-semibold">Room history</div>
        {rooms.length === 0
          ? <p className="text-white/30 text-[13px]">No rooms recorded for this property.</p>
          : rooms.map((r) => <RoomTimeline key={r.id} roomId={r.id} roomName={r.name} />)}
      </div>
    </div>
  );
}

function RoomTimeline({ roomId, roomName }: { roomId: number; roomName: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<{ segments: Segment[]; todayIso: string; media: Media[] }>({
    queryKey: [`/api/admin/housing/rooms/${roomId}/history`],
    enabled: open,
  });

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02]" data-testid={`room-${roomId}`}>
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer"
        data-testid={`button-room-history-${roomId}`}>
        <DoorOpen className="w-3.5 h-3.5 text-white/35" />
        <span className="text-[13px] text-white/80">{roomName}</span>
        <span className="ml-auto text-[11px] text-white/25">{open ? "hide" : "history"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {!data ? <p className="text-[12px] text-white/25">Loading…</p>
            : data.segments.length === 0
              ? <p className="text-[12px] text-white/25">No tenancies recorded for this room.</p>
              : [...data.segments].reverse().map((s, i) => s.kind === "held" ? (
                  <div key={`h-${s.id}`} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-blue-500/15 bg-blue-500/[0.04] px-2.5 py-1.5">
                    <User className="w-3 h-3 text-blue-400/60 self-center" />
                    <span className="text-[12.5px] text-white/85">{s.holderName}</span>
                    <span className="text-[12px] text-white/45">
                      {niceDate(s.from)} — {s.open ? "present" : niceDate(s.to)}
                    </span>
                    {s.days != null && <span className="text-[11px] text-white/25">· {daysLabel(s.days)}</span>}
                  </div>
                ) : (
                  <div key={`e-${s.from}-${i}`} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-dashed border-white/[0.10] px-2.5 py-1.5">
                    <span className="text-[12.5px] text-white/40">Empty</span>
                    <span className="text-[12px] text-white/30">
                      {niceDate(s.from)} — {s.open ? "present" : niceDate(s.to)}
                    </span>
                    {s.days != null && <span className="text-[11px] text-white/20">· {daysLabel(s.days)}</span>}
                  </div>
                ))}
        </div>
      )}
    </div>
  );
}
