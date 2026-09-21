/**
 * Move a child to the programme they should have been on.
 *
 * Daniel, 2026-09-21: "if 10 year old signed up for u4-u8 fundamentals on
 * accident and he can just move them like transfer them for sake of rolls and
 * accurate numbers etc… and rego numbers." Then 2026-09-22, on Jack Zhu's
 * profile, where one $600 payment covered Jack AND his sister: "when you click
 * Move on that specific player page, the player just comes up… show the
 * sessions… 'Move all across all sessions'… confirming, 'Yep, I want to
 * move'… showing the shift from these sessions to these sessions in World
 * Cup."
 *
 * So the dialog is about a CHILD, not a registration row: their name, every
 * day they are booked, the matching day on the new programme beside each,
 * one confirm, then the shift it made. The profile passes the child; the
 * Registrations page passes none and the dialog asks who is moving when a
 * booking covers more than one child.
 *
 * 🔴 IT NEVER MOVES MONEY, and says so on the screen. When only one of two
 * children moves, the server SPLITS the booking — the mover's days and share
 * go to a new registration, the sibling's stay — and the amounts are shown
 * here before anything is written (shared/registration-split.ts decides them,
 * the same function the server writes with).
 *
 * 🔴 WHEN A BOOKED DAY HAS NO EQUIVALENT the server refuses unless told to
 * drop it. The preview shows those days first, so the person drops them
 * deliberately — a transfer that silently discarded a booked day would take a
 * child off a roll nobody checks.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProgrammeOption = { id: number; name: string };
type Session = {
  itemId: number; date: string; startTime: string | null; name: string | null; productType: string;
  priceCents: number; refundedCents: number;
  target: { dateId: number; date: string; startTime: string | null; name: string | null } | null;
};
type PlannedChild = { childId: number | null; name: string; moving: boolean; sessions: Session[] };
type Side = { totalCents: number; amountPaidCents: number; refundedCents: number; status: string };
type Plan = {
  registration: { id: number; programName: string; totalCents: number; amountPaidCents: number; refundedCents: number };
  to: { id: number; name: string } | null;
  children: PlannedChild[];
  movingNames: string[]; stayingNames: string[];
  unmatched: string[];
  split: { moving: Side; staying: Side } | null;
};
type Result = {
  movedTo: { id: number; name: string };
  moved: { names: string[]; registrationId: number };
  stayed: { names: string[]; registrationId: number } | null;
  sessions: { child: string; from: { date: string; startTime: string | null }; to: { date: string; startTime: string | null } | null }[];
  daysRemapped: number; daysDropped: number;
  money: { moving: Side; staying: Side } | null;
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const SLOT: Record<string, string> = { MORNING: "Morning", AFTERNOON: "Afternoon", FULL_DAY: "Full day" };
// A bare ISO date is a calendar day, not an instant — pin it to local midnight
// or the 28th reads as the 27th in New Zealand.
const day = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
};
const slot = (s: { startTime: string | null; productType?: string; name?: string | null }) =>
  s.name || (s.productType && SLOT[s.productType]) || s.startTime || "";
const names = (list: string[]) => list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

export function MoveProgrammeDialog({ registrationId, programId, programName, personName, childId, onClose, onMoved }: {
  registrationId: number;
  programId: number;
  programName?: string | null;
  personName?: string | null;
  /** The child this move is about — from a player's profile. Absent on the Registrations page. */
  childId?: number | null;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { toast } = useToast();
  // The same list the Registrations filter uses — /api/admin/programmes does not exist.
  const { data: programmes } = useQuery<ProgrammeOption[]>({ queryKey: ["/api/admin/registration-programmes"] });
  const [toProgramId, setToProgramId] = useState<string>("");
  // "everyone" or a single child id, as a string — only asked when nobody was named and the booking covers several.
  const [who, setWho] = useState<string>(childId ? String(childId) : "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const childIdsParam = who && who !== "everyone" ? who : "";
  const previewUrl = `/api/admin/registrations/${registrationId}/transfer-preview?toProgramId=${toProgramId}&childIds=${childIdsParam}`;
  const { data: plan, error: planError, isLoading } = useQuery<Plan>({
    queryKey: [previewUrl],
    queryFn: async () => {
      const res = await workspaceFetch(previewUrl);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      return body;
    },
    enabled: !result,
  });

  // A booking with one child needs no question; with several and nobody named, ask.
  const multi = (plan?.children.length ?? 0) > 1;
  useEffect(() => {
    if (plan && !multi && !who) setWho("everyone");
  }, [plan, multi, who]);
  const needsWho = multi && !who;

  const moving = plan?.children.filter((c) => c.moving) ?? [];
  const sessionCount = moving.reduce((n, c) => n + c.sessions.length, 0);
  const unmatched = plan?.unmatched ?? [];
  const academyShape = plan ? plan.children.every((c) => c.childId === null) : false;

  const move = async () => {
    if (!toProgramId) { toast({ title: "Pick a programme", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const res = await workspaceFetch(`/api/admin/registrations/${registrationId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toProgramId: Number(toProgramId),
          childIds: childIdsParam ? [Number(childIdsParam)] : undefined,
          // Only ever true when the preview has already shown which days go.
          dropUnmatchedDays: unmatched.length > 0,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      setResult(body);
      toast({ title: `Moved ${names(body.moved?.names ?? [])} to ${body.movedTo?.name ?? "the new programme"}` });
    } catch (e: any) {
      toast({ title: "Could not move them", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const options = (programmes ?? []).filter((p) => p.id !== programId);
  const fromName = plan?.registration.programName ?? programName ?? `programme ${programId}`;
  const subject = plan ? names(plan.movingNames) : (personName ?? "This registration");

  return (
    <Dialog open onOpenChange={(v: boolean) => { if (!v) (result ? onMoved : onClose)(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-move-programme">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {result ? `Moved to ${result.movedTo.name}` : "Move to another programme"}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-3" data-testid="move-result">
            <p className="text-[13px] text-foreground/85">
              <span className="font-medium">{names(result.moved.names)}</span>
              <span className="text-muted-foreground"> · {fromName}</span>
              <ArrowRight className="inline w-3.5 h-3.5 mx-1.5 text-muted-foreground" />
              <span className="font-medium">{result.movedTo.name}</span>
            </p>
            <SessionShift rows={result.sessions.map((s) => ({ ...s, key: `${s.child}-${s.from.date}-${s.from.startTime ?? ""}` }))} toName={result.movedTo.name} />
            <p className="text-[11px] text-muted-foreground">
              {result.daysRemapped} session{result.daysRemapped === 1 ? "" : "s"} carried across
              {result.daysDropped ? `, ${result.daysDropped} dropped (no session that day)` : ""}.
            </p>
            {result.money && result.stayed && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[12px] space-y-1" data-testid="move-result-money">
                <p>
                  <span className="text-foreground/85">{names(result.moved.names)}</span>: {money(result.money.moving.totalCents)}
                  {result.money.moving.refundedCents ? ` (incl. ${money(result.money.moving.refundedCents)} already refunded)` : ""} now on registration #{result.moved.registrationId}.
                </p>
                <p>
                  <span className="text-foreground/85">{names(result.stayed.names)}</span>: {money(result.money.staying.totalCents)}
                  {result.money.staying.refundedCents ? ` (incl. ${money(result.money.staying.refundedCents)} already refunded)` : ""} stays on #{result.stayed.registrationId}, still on {fromName}.
                </p>
                <p className="text-muted-foreground">Nothing was charged or refunded — one payment, now filed under two registrations.</p>
              </div>
            )}
            {!result.money && <p className="text-[11px] text-muted-foreground">The amount paid was not changed.</p>}
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={onMoved} className="h-8 rounded-lg text-[12px]" data-testid="button-move-done">Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {planError && <p className="text-[12px] text-destructive">{(planError as Error).message}</p>}
            {isLoading && !plan && <p className="text-[12px] text-muted-foreground">Loading their sessions…</p>}

            {plan && (
              <p className="text-[12px] text-muted-foreground">
                <span className="text-foreground/85 font-medium">{needsWho ? names(plan.children.map((c) => c.name)) : subject}</span>
                {needsWho ? " are" : (plan.movingNames.length > 1 ? " are" : " is")} on <span className="text-foreground/85">{fromName}</span>
                {plan.registration.totalCents ? <> · {money(plan.registration.totalCents)} booking</> : null}.
              </p>
            )}

            {/* Who is moving — only when a booking covers several children and nobody was named. */}
            {plan && multi && !childId && (
              <div>
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Who is moving?</label>
                <div className="mt-1 flex flex-wrap gap-1.5" data-testid="move-who">
                  {plan.children.map((c) => (
                    <button key={String(c.childId)} type="button" onClick={() => setWho(String(c.childId))}
                      className={`text-[12px] rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${who === String(c.childId) ? "border-blue-500/50 bg-blue-500/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                      data-testid={`move-who-${c.childId}`}>
                      {c.name} <span className="opacity-60">· {c.sessions.length} session{c.sessions.length === 1 ? "" : "s"}</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setWho("everyone")}
                    className={`text-[12px] rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${who === "everyone" ? "border-blue-500/50 bg-blue-500/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                    data-testid="move-who-everyone">
                    Everyone
                  </button>
                </div>
              </div>
            )}

            {/* The sessions this child is booked on — with the matching day on the new programme once one is chosen. */}
            {plan && !needsWho && !academyShape && (
              <div data-testid="move-sessions">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {sessionCount} session{sessionCount === 1 ? "" : "s"}{plan.to ? ` · ${fromName} → ${plan.to.name}` : ""}
                </label>
                <SessionShift
                  rows={moving.flatMap((c) => c.sessions.map((s) => ({
                    key: String(s.itemId), child: moving.length > 1 ? c.name : "",
                    from: { date: s.date, startTime: s.startTime, productType: s.productType, name: s.name },
                    to: plan.to ? (s.target ? { date: s.target.date, startTime: s.target.startTime, name: s.target.name, productType: s.productType } : null) : undefined,
                    refunded: s.refundedCents > 0,
                  })))}
                  toName={plan.to?.name ?? null}
                />
              </div>
            )}

            {plan && multi && !needsWho && plan.stayingNames.length > 0 && (
              <p className="text-[12px] text-muted-foreground" data-testid="move-sibling-note">
                This booking also covers <span className="text-foreground/85">{names(plan.stayingNames)}</span>, who
                {plan.stayingNames.length === 1 ? " stays" : " stay"} on {fromName}. Only {names(plan.movingNames)} moves.
              </p>
            )}

            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Move to</label>
              {/* 🔴 Drawn by us, not the browser — a native <select> changes shape per browser and per OS. */}
              <Select value={toProgramId} onValueChange={(v) => setToProgramId(v)}>
                <SelectTrigger className="premium-input w-full h-9 mt-1 text-[13px]" data-testid="select-move-programme">
                  <SelectValue placeholder="Choose a programme…" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {plan?.to && unmatched.length > 0 && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 space-y-1" data-testid="move-unmatched">
                <p className="text-[12px] text-amber-700 dark:text-amber-200/90">
                  {plan.to.name} has no session on {unmatched.length === 1 ? "this day" : "these days"}: {unmatched.map((u) => day(u)).join(", ")}.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Moving anyway removes {unmatched.length === 1 ? "that day" : "those days"} from the booking.
                </p>
              </div>
            )}

            {/* 🔴 The money, said out loud before anything is written. */}
            {plan?.to && plan.split && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[12px] space-y-1" data-testid="move-split-money">
                <p>
                  <span className="text-foreground/85">{names(plan.movingNames)}</span>'s share, {money(plan.split.moving.totalCents)}
                  {plan.split.moving.refundedCents ? ` (incl. ${money(plan.split.moving.refundedCents)} already refunded)` : ""}, goes with {plan.movingNames.length === 1 ? "them" : "them"} to a registration of {plan.movingNames.length === 1 ? "their" : "their"} own.
                </p>
                <p>
                  <span className="text-foreground/85">{names(plan.stayingNames)}</span>'s {money(plan.split.staying.totalCents)}
                  {plan.split.staying.refundedCents ? ` (incl. ${money(plan.split.staying.refundedCents)} already refunded)` : ""} stays on this one.
                </p>
                <p className="text-muted-foreground">Nothing is charged or refunded — the one payment is filed under two registrations that add back to {money(plan.registration.totalCents)}.</p>
              </div>
            )}
            {plan?.to && !plan.split && (
              <p className="text-[11px] text-muted-foreground">
                This does not change what they paid. If the two programmes cost different amounts, sort the difference separately.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="text-[12px] text-muted-foreground hover:text-foreground px-2 py-2 cursor-pointer">Cancel</button>
              <Button size="sm" variant={unmatched.length ? "destructive" : "default"}
                disabled={busy || !toProgramId || !plan || needsWho || !plan.to}
                onClick={move} className="h-8 rounded-lg text-[12px]"
                data-testid={unmatched.length ? "button-move-confirm-drop" : "button-move-confirm"}>
                {busy ? "Moving…"
                  : unmatched.length ? `Move and drop ${unmatched.length} day${unmatched.length === 1 ? "" : "s"}`
                  : plan && !academyShape && sessionCount ? `Move ${subject} — all ${sessionCount} session${sessionCount === 1 ? "" : "s"}`
                  : plan ? `Move ${subject}` : "Move"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** From-day → to-day, one line per booked session. `to` undefined = no target chosen yet; null = no session that day. */
function SessionShift({ rows, toName }: {
  rows: { key: string; child?: string; from: { date: string; startTime: string | null; productType?: string; name?: string | null }; to?: { date: string; startTime: string | null; productType?: string; name?: string | null } | null; refunded?: boolean }[];
  toName: string | null;
}) {
  return (
    <ul className="mt-1 rounded-lg border border-border/60 divide-y divide-border/40 max-h-56 overflow-y-auto">
      {rows.map((r) => (
        <li key={r.key} className={`flex items-center gap-2 px-2.5 py-1.5 text-[12px] ${r.refunded ? "opacity-50" : ""}`} data-testid="move-session-row">
          <span className="flex-1 min-w-0 truncate">
            {r.child ? <span className="text-muted-foreground">{r.child} · </span> : null}
            {day(r.from.date)}{slot(r.from) ? <span className="text-muted-foreground"> · {slot(r.from)}</span> : null}
            {r.refunded ? <span className="text-muted-foreground"> · refunded</span> : null}
          </span>
          {r.to !== undefined && (
            <>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {r.to ? <>{day(r.to.date)}{slot(r.to) ? <span className="text-muted-foreground"> · {slot(r.to)}</span> : null}</>
                  : <span className="text-amber-700 dark:text-amber-300/90">no session{toName ? ` on ${toName}` : ""}</span>}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
