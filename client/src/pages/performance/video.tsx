import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DateField, Empty, Field, FormError, Loading, LoadError, PageHead, Panel, Pill, SaveButton, ToggleChip, niceDay, send, usePerfQuery, useOverview, useSaver, control,
} from "./ui";

interface Clip { id: number; title: string; url: string; source: string; clipDate: string | null; contactIds: number[]; tags: string[]; startSeconds: number | null; note: string | null }

export default function Video() {
  const q = usePerfQuery<{ media: Clip[] }>("media", "/media");
  const ov = useOverview();
  const squad = ov.data?.players ?? [];
  const [url, setUrl] = useState(""); const [title, setTitle] = useState(""); const [date, setDate] = useState("");
  const [ids, setIds] = useState<number[]>([]); const [tags, setTags] = useState(""); const [start, setStart] = useState(""); const [note, setNote] = useState("");
  const add = useSaver(); const del = useSaver();
  const d = q.data;
  const nameOf = (id: number) => squad.find((p) => p.contactId === id)?.name ?? "Player";

  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Video" blurb="Link clips from Spiideo, Veo, Hudl, Wyscout or YouTube and tag the players in them. The video stays where it is hosted." />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <Panel title="Clips">
          {d.media.length === 0 ? <Empty>No clips yet. Paste a link below.</Empty> : (
            <ul className="divide-y divide-border" data-testid="perf-clips">
              {d.media.map((m) => (
                <li key={m.id} className="py-3 flex flex-col md:flex-row md:items-center gap-2 md:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">{m.title} <Pill>{m.source}</Pill></div>
                    <div className="text-xs text-muted-foreground">{niceDay(m.clipDate, true)}{m.startSeconds != null ? ` · from ${m.startSeconds}s` : ""}{m.tags.length ? ` · ${m.tags.join(", ")}` : ""}</div>
                    {m.contactIds.length > 0 && <div className="text-xs mt-0.5">{m.contactIds.map(nameOf).join(", ")}</div>}
                    {m.note && <div className="text-xs text-muted-foreground mt-0.5">{m.note}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">Open <ExternalLink className="w-3.5 h-3.5" aria-hidden /></a>
                    <Button size="sm" variant="ghost" aria-label="Remove clip" disabled={del.busy} onClick={() => { if (window.confirm("Remove this clip from the list?")) del.run(async () => { await send("DELETE", `/media/${m.id}`); }); }}><Trash2 className="w-4 h-4" aria-hidden /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <FormError error={del.error} />
        </Panel>
      )}
      <Panel title="Add a clip">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Link (https://…)" className="md:col-span-2"><Input className={control} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
          <Field label="Title"><Input className={control} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Date"><DateField value={date} onChange={setDate} className="w-full" /></Field>
          <Field label="Tags (comma separated)"><Input className={control} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="goal, press, set piece" /></Field>
          <Field label="Start at (seconds)"><Input className={control} inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Players in the clip" className="md:col-span-2">
            <div className="flex flex-wrap gap-1.5">{squad.map((p) => <ToggleChip key={p.contactId} on={ids.includes(p.contactId)} onClick={() => setIds(ids.includes(p.contactId) ? ids.filter((x) => x !== p.contactId) : [...ids, p.contactId])}>{p.name}</ToggleChip>)}</div>
          </Field>
          <Field label="Note" className="md:col-span-2"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <SaveButton busy={add.busy} disabled={!url.trim() || !title.trim()} onClick={() => add.run(async () => {
            await send("POST", "/media", { url: url.trim(), title, clipDate: date || null, contactIds: ids, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), startSeconds: start.trim() === "" ? null : Number(start), note });
            setUrl(""); setTitle(""); setDate(""); setIds([]); setTags(""); setStart(""); setNote("");
            return "Clip added.";
          })}>Add clip</SaveButton>
          {add.done && <span className="text-sm text-emerald-700">{add.done}</span>}
        </div>
        <FormError error={add.error} />
      </Panel>
    </div>
  );
}
