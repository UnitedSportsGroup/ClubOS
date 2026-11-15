import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AvailBadge, DateField, Empty, Field, FormError, Loading, LoadError, PageHead, Panel, Pick, SaveButton, TableWrap, td, th, niceDay, send,
  usePerfQuery, useOverview, useSaver, control,
} from "./ui";

interface Spell { id: number; contactId: number; status: string; startedOn: string; endedOn: string | null; expectedReturn: string | null; reason: string | null; bodyArea: string | null; notes?: string | null; hasNotes: boolean; recordedBy: string | null; player: string | null }
interface Data { today: string; medical: boolean; spells: Spell[]; daysLost: { contactId: number; name: string; days: number }[] }

const STATUSES = [
  { value: "injured", label: "Injured" }, { value: "ill", label: "Ill" }, { value: "modified", label: "Modified training" }, { value: "unavailable", label: "Unavailable" },
];

export default function Availability() {
  const q = usePerfQuery<Data>("availability", "/availability");
  const ov = useOverview();
  const d = q.data;
  const squad = ov.data?.players ?? [];
  const [player, setPlayer] = useState("");
  const [status, setStatus] = useState("injured");
  const [started, setStarted] = useState("");
  const [expected, setExpected] = useState("");
  const [area, setArea] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const add = useSaver();
  const act = useSaver();
  const [edit, setEdit] = useState<Spell | null>(null);

  const today = d?.today ?? "";
  const isOpen = (s: Spell) => s.startedOn <= today && (s.endedOn == null || s.endedOn >= today);
  const current = (d?.spells ?? []).filter(isOpen);
  const history = (d?.spells ?? []).filter((s) => !isOpen(s));

  const row = (s: Spell, closable: boolean) => (
    <tr key={s.id}>
      <td className={`${td} font-medium`}>{s.player ?? "—"}</td>
      <td className={td}><AvailBadge state={s.status} /></td>
      <td className={td}>{niceDay(s.startedOn, true)}</td>
      <td className={td}>{s.endedOn ? niceDay(s.endedOn, true) : "Ongoing"}</td>
      <td className={td}>{niceDay(s.expectedReturn)}</td>
      <td className={td}>{s.bodyArea ?? "—"}</td>
      <td className={`${td} max-w-xs`}>{s.reason ?? "—"}</td>
      {d?.medical && <td className={`${td} max-w-xs text-xs`}>{s.notes ?? "—"}</td>}
      <td className={td}>
        <div className="flex gap-1.5">
          {closable && <Button size="sm" variant="outline" disabled={act.busy} onClick={() => act.run(async () => { await send("PATCH", `/availability/${s.id}`, { endedOn: today }); })}>Back today</Button>}
          <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEdit(s)}><Pencil className="w-4 h-4" aria-hidden /></Button>
        </div>
      </td>
    </tr>
  );
  const heads = ["Player", "Status", "From", "To", "Expected back", "Area", "Reason", ...(d?.medical ? ["Clinical notes"] : []), ""];

  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Availability" blurb="Who is injured, ill or on modified training, and how many days each player has lost." />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <FormError error={act.error} />
          <Panel title="Out now" note={current.length ? `${current.length} player${current.length === 1 ? "" : "s"} not in full training.` : undefined}>
            {current.length === 0 ? <Empty>Nobody is out. Everyone is available.</Empty> : (
              <TableWrap><table className="w-full" data-testid="perf-out"><thead><tr>{heads.map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead><tbody>{current.map((s) => row(s, true))}</tbody></table></TableWrap>
            )}
          </Panel>

          <Panel title="Log injury or illness">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Player"><Pick value={player} onChange={setPlayer} options={squad.map((p) => ({ value: String(p.contactId), label: p.name }))} testId="perf-av-player" /></Field>
              <Field label="Status"><Pick value={status} onChange={setStatus} options={STATUSES} /></Field>
              <Field label="Started"><DateField value={started || today} onChange={setStarted} className="w-full" /></Field>
              <Field label="Expected back (optional)"><DateField value={expected} onChange={setExpected} className="w-full" /></Field>
              <Field label="Body area"><Input className={control} placeholder="e.g. Hamstring" value={area} onChange={(e) => setArea(e.target.value)} /></Field>
              <Field label="Reason"><Input className={control} placeholder="e.g. Tight in warm-up" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              {d.medical && <Field label="Clinical notes (medical staff only)" className="md:col-span-3"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}
            </div>
            <div className="flex items-center gap-3 mt-4">
              <SaveButton busy={add.busy} disabled={!player} onClick={() => add.run(async () => {
                await send("POST", "/availability", { contactId: Number(player), status, startedOn: started || today, expectedReturn: expected || null, bodyArea: area, reason, ...(d.medical && notes.trim() ? { notes } : {}) });
                setPlayer(""); setExpected(""); setArea(""); setReason(""); setNotes(""); setStarted("");
                return "Saved.";
              })}>Save</SaveButton>
              {add.done && <span className="text-sm text-emerald-700">{add.done}</span>}
            </div>
            <FormError error={add.error} />
          </Panel>

          <Panel title="Days lost" note="Days out of full training, all recorded spells. Modified training counts.">
            {d.daysLost.length === 0 ? <Empty>No days lost recorded yet.</Empty> : (
              <ol className="space-y-1">{d.daysLost.map((x, i) => (
                <li key={x.contactId} className="flex items-center justify-between text-sm border-b border-border/60 py-1.5"><span>{i + 1}. {x.name}</span><span className="tabular-nums font-medium">{x.days} day{x.days === 1 ? "" : "s"}</span></li>
              ))}</ol>
            )}
          </Panel>

          <Panel title="History">
            {history.length === 0 ? <Empty>No past spells yet.</Empty> : (
              <TableWrap><table className="w-full"><thead><tr>{heads.map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead><tbody>{history.map((s) => row(s, false))}</tbody></table></TableWrap>
            )}
          </Panel>
        </>
      )}
      {d && edit && <EditSpell key={edit.id} spell={edit} medical={d.medical} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditSpell({ spell, medical, onClose }: { spell: Spell; medical: boolean; onClose: () => void }) {
  const [status, setStatus] = useState(spell.status);
  const [ended, setEnded] = useState(spell.endedOn ?? "");
  const [expected, setExpected] = useState(spell.expectedReturn ?? "");
  const [area, setArea] = useState(spell.bodyArea ?? "");
  const [reason, setReason] = useState(spell.reason ?? "");
  const [notes, setNotes] = useState(spell.notes ?? "");
  const s = useSaver();
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit: {spell.player}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Status"><Pick value={status} onChange={setStatus} options={STATUSES} /></Field>
          <Field label="Ended (blank = ongoing)"><DateField value={ended} onChange={setEnded} className="w-full" /></Field>
          <Field label="Expected back"><DateField value={expected} onChange={setExpected} className="w-full" /></Field>
          <Field label="Body area"><Input className={control} value={area} onChange={(e) => setArea(e.target.value)} /></Field>
          <Field label="Reason" className="md:col-span-2"><Input className={control} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {medical && <Field label="Clinical notes" className="md:col-span-2"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}
        </div>
        <FormError error={s.error} />
        <DialogFooter>
          <Button variant="outline" className={control} onClick={onClose}>Cancel</Button>
          <SaveButton busy={s.busy} onClick={async () => {
            const ok = await s.run(async () => {
              await send("PATCH", `/availability/${spell.id}`, { status, endedOn: ended || null, expectedReturn: expected || null, bodyArea: area, reason, ...(medical ? { notes } : {}) });
            });
            if (ok) onClose();
          }}>Save</SaveButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
