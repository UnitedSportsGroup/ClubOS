// e-Sign → Templates: staff build their own agreements (and Rambo drafts them).
//
// Daniel, 2026-11-04: "I'm the bottleneck … they should be able to build the
// stuff they need to do the work day to day." A template is words, the details
// a signer fills in, the details the sender sets, and a brand. The signing page,
// the PDF and the audit trail stay ours. Rules: shared/esign-template.ts.
//
// 🔴 Components are module-scope (never defined inside another component — a
// remount per keystroke interleaves typed letters).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SignaturePad } from "@/components/signature-pad";
import {
  Plus, ArrowLeft, Sparkles, FileText, Eye, Trash2, ChevronUp, ChevronDown, Copy, Link2, Archive, CheckCircle2, AlertTriangle, Loader2, Undo2,
} from "lucide-react";
import { ESIGN_FORM_TYPES, ESIGN_VARIABLE_TYPES } from "@shared/esign-template";

type Item = { kind: "p" | "bullet" | "numbered"; text: string };
type Section = { heading: string; items: Item[] };
type FormField = { key: string; label: string; type: string; required: boolean; placeholder?: string };
type Variable = { key: string; label: string; type: string; required: boolean; default?: string; options?: string[] };
export interface TemplateDraft {
  id?: number;
  name: string;
  description: string | null;
  brandKey: string;
  content: { docTitle: string; partiesIntro: string[]; sections: Section[]; signAck?: string };
  form: FormField[];
  variables: Variable[];
  settings: Record<string, any>;
  published?: boolean;
  openLink?: { enabled: boolean; url: string; clubSignedBy: string | null; clubSignedAt: string | null } | null;
}
interface LibraryRow extends TemplateDraft { id: number; used: number; signed: number; slug: string }
interface Library { defaultBrandKey: string; brands: { key: string; label: string }[]; templates: LibraryRow[] }

const FORM_TYPE_LABEL: Record<string, string> = { text: "Text", date: "Date", dob: "Date of birth", phone: "Phone", email: "Email", bank: "Bank account", address: "Address" };
const VAR_TYPE_LABEL: Record<string, string> = { text: "Text", select: "Choice", date: "Date", money: "Amount ($)" };

async function send(method: string, url: string, body?: unknown) {
  const res = await workspaceFetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const err: any = new Error(data?.message || `Request failed (${res.status})`);
    err.problems = data?.problems ?? [];
    throw err;
  }
  return data;
}

// ── Section text ⇄ items ───────────────────────────────────────────────────
// One box per section. A blank line separates paragraphs; "- " makes a bullet,
// "# " a numbered point. Clause numbers like "2.1" are just typed.
export function itemsToText(items: Item[]): string {
  return items.map((i) => (i.kind === "bullet" ? `- ${i.text}` : i.kind === "numbered" ? `# ${i.text}` : i.text)).join("\n\n");
}
export function textToItems(text: string): Item[] {
  return text.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).map((b) =>
    /^[-*•]\s+/.test(b) ? { kind: "bullet" as const, text: b.replace(/^[-*•]\s+/, "") }
      : /^#\s+/.test(b) ? { kind: "numbered" as const, text: b.replace(/^#\s+/, "") }
        : { kind: "p" as const, text: b });
}

function blankTemplate(brandKey: string): TemplateDraft {
  return {
    name: "", description: "", brandKey,
    content: { docTitle: "", partiesIntro: [], sections: [{ heading: "The Deal at a Glance", items: [] }], signAck: "" },
    form: [{ key: "full_name", label: "Full name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
    variables: [],
    settings: { counterSignerRole: "The Club", primarySignerRole: "The Signer", detailsHeading: "Your details", guardianUnder18: false, clubSignsFirst: true },
  };
}

function toPayload(t: TemplateDraft, published?: boolean) {
  return { name: t.name, description: t.description, brandKey: t.brandKey, content: t.content, form: t.form, variables: t.variables, settings: { ...t.settings, published: published ?? t.published ?? false } };
}

// ── Library ────────────────────────────────────────────────────────────────
export function TemplatesPanel({ openId, onOpen }: { openId: number | null; onOpen: (id: number | null) => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Library>({ queryKey: ["/api/admin/esign/templates/library"] });
  const [ramboOpen, setRamboOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (openId != null) return <TemplateEditor id={openId} library={data} onBack={() => onOpen(null)} />;

  const createBlank = async () => {
    setBusy(true);
    try {
      const t = blankTemplate(data?.defaultBrandKey ?? "usg");
      const row = await send("POST", "/api/admin/esign/templates", { ...toPayload(t), name: "Untitled agreement" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/esign/templates/library"] });
      onOpen(row.id);
    } catch (e: any) { toast({ title: "Couldn't create it", description: e.message, variant: "destructive" }); }
    setBusy(false);
  };

  const rows = data?.templates ?? [];
  return (
    <div className="space-y-4" data-testid="esign-templates">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-white/50 max-w-2xl">
          Agreements anyone in this workspace can send: player agreements, letters of offer, sponsorship, hire, volunteers. Write one yourself or ask Rambo for a first draft, check it, then publish.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={createBlank} disabled={busy} className="gap-1.5" data-testid="button-template-blank"><Plus className="w-4 h-4" /> Blank</Button>
          <Button onClick={() => setRamboOpen(true)} className="gap-1.5" data-testid="button-template-rambo"><Sparkles className="w-4 h-4" /> Draft with Rambo</Button>
        </div>
      </div>

      {isLoading ? <div className="text-center text-white/30 py-12">Loading…</div> : rows.length === 0 ? (
        <div className="text-center text-white/40 py-12 border border-dashed border-white/10 rounded-2xl">No templates here yet. Ask Rambo for a first draft.</div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {rows.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.id)} className="text-left bg-white/[0.03] border border-white/5 rounded-2xl p-4 hover:bg-white/[0.05] transition-colors" data-testid={`template-card-${t.id}`}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-400/10 text-amber-400 flex items-center justify-center shrink-0"><FileText className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-white font-medium truncate">{t.name}</div>
                  <div className="text-white/40 text-xs mt-0.5 line-clamp-2">{t.description || "No description"}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {t.published
                      ? <span className="text-[10px] px-2 py-0.5 rounded-full border text-emerald-300 bg-emerald-400/10 border-emerald-400/25">Published</span>
                      : <span className="text-[10px] px-2 py-0.5 rounded-full border text-amber-300 bg-amber-400/10 border-amber-400/25">Draft</span>}
                    {t.openLink?.enabled && <span className="text-[10px] px-2 py-0.5 rounded-full border text-sky-300 bg-sky-400/10 border-sky-400/25">Open link</span>}
                    <span className="text-[11px] text-white/35">{t.used} sent · {t.signed} signed</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {ramboOpen && <RamboStart library={data} onClose={() => setRamboOpen(false)} onCreated={(id) => { setRamboOpen(false); onOpen(id); }} />}
    </div>
  );
}

function BrandSelect({ library, value, onChange }: { library?: Library; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10" data-testid="select-template-brand"><SelectValue placeholder="Brand" /></SelectTrigger>
      <SelectContent>{(library?.brands ?? []).map((b) => <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function RamboStart({ library, onClose, onCreated }: { library?: Library; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [brandKey, setBrandKey] = useState(library?.defaultBrandKey ?? "usg");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const d = await send("POST", "/api/admin/esign/templates/rambo", { prompt, brandKey });
      const row = await send("POST", "/api/admin/esign/templates", { ...d.template, brandKey: d.brandKey, settings: { ...d.template.settings, published: false } });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/esign/templates/library"] });
      if (d.reply) toast({ title: "Rambo's draft is ready", description: d.reply });
      onCreated(row.id);
    } catch (e: any) { toast({ title: "Rambo couldn't draft it", description: e.message, variant: "destructive" }); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className="w-full sm:max-w-xl bg-[#0c1222] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()} data-testid="dialog-template-rambo">
        <div className="flex items-center gap-2 text-white font-semibold"><img src="/mailer/rambo.png" alt="" className="w-7 h-7 rounded-full" /> Draft an agreement with Rambo</div>
        <div className="space-y-1.5">
          <label className="text-xs text-white/50">What is it for? The more you say, the better the draft.</label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder="e.g. A letter of offer for a South Island United first-team player for the 2027 OFC season: weekly payment, start and end date, accommodation if provided, what we expect of them, and what happens if they leave early." data-testid="input-rambo-prompt" />
        </div>
        <div className="space-y-1.5"><label className="text-xs text-white/50">Brand</label><BrandSelect library={library} value={brandKey} onChange={setBrandKey} /></div>
        <p className="text-[11px] text-white/35">Rambo writes a draft only. It won't make up amounts or dates: those become details you fill in when sending. A person checks it before it's published.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={go} disabled={busy || prompt.trim().length < 8} className="gap-1.5" data-testid="button-rambo-draft">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Drafting… (about a minute)</> : <><Sparkles className="w-4 h-4" /> Draft it</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────
function TemplateEditor({ id, library, onBack }: { id: number; library?: Library; onBack: () => void }) {
  const { toast } = useToast();
  const { data: loaded, isLoading } = useQuery<TemplateDraft & { problems: string[] }>({ queryKey: [`/api/admin/esign/templates/${id}/full`] });
  const [t, setT] = useState<TemplateDraft | null>(null);
  const [undo, setUndo] = useState<TemplateDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [sectionText, setSectionText] = useState<string[]>([]);

  useEffect(() => {
    if (!loaded) return;
    const d: TemplateDraft = { ...loaded, brandKey: (loaded as any).brandKey ?? library?.defaultBrandKey ?? "usg" };
    setT(d);
    setSectionText(d.content.sections.map((s) => itemsToText(s.items)));
    setProblems(loaded.problems ?? []);
    setDirty(false);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const withSections = (d: TemplateDraft, texts: string[]): TemplateDraft => ({ ...d, content: { ...d.content, sections: d.content.sections.map((s, i) => ({ ...s, items: textToItems(texts[i] ?? "") })) } });
  const current = useMemo(() => (t ? withSections(t, sectionText) : null), [t, sectionText]);

  if (isLoading || !t || !current) return <div className="text-center text-white/30 py-16">Loading…</div>;

  const patch = (p: Partial<TemplateDraft>) => { setT({ ...t, ...p }); setDirty(true); };
  const patchContent = (p: Partial<TemplateDraft["content"]>) => patch({ content: { ...t.content, ...p } });
  const patchSettings = (p: Record<string, any>) => patch({ settings: { ...t.settings, ...p } });

  const save = async (published?: boolean) => {
    setSaving(true);
    try {
      const row = await send("PUT", `/api/admin/esign/templates/${id}`, toPayload(current, published));
      setProblems(row.problems ?? []);
      setT({ ...current, published: row.published, openLink: row.openLink });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/esign/templates/library"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/esign/templates"] });
      toast({ title: published === true ? "Published — staff can send it now" : published === false ? "Moved back to draft" : "Saved" });
    } catch (e: any) {
      if (e.problems?.length) setProblems(e.problems);
      toast({ title: e.message, description: e.problems?.join(" "), variant: "destructive" });
    }
    setSaving(false);
  };

  const preview = async () => {
    try {
      const res = await workspaceFetch("/api/admin/esign/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(current)) });
      if (!res.ok) throw new Error("Couldn't build the preview");
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  };

  const askRambo = async () => {
    setAsking(true);
    try {
      const d = await send("POST", "/api/admin/esign/templates/rambo", { prompt: ask, brandKey: t.brandKey, template: toPayload(current) });
      setUndo(current);
      const next: TemplateDraft = { ...t, ...d.template, brandKey: d.brandKey, id: t.id, published: t.published, openLink: t.openLink, settings: { ...t.settings, ...d.template.settings, published: t.published } };
      setT(next);
      setSectionText(next.content.sections.map((s) => itemsToText(s.items)));
      setProblems(d.problems ?? []);
      setDirty(true);
      setAsk("");
      toast({ title: "Rambo changed the draft", description: d.reply || "Check it, then save." });
    } catch (e: any) { toast({ title: "Rambo couldn't do that", description: e.message, variant: "destructive" }); }
    setAsking(false);
  };

  const action = async (path: string, done: string) => {
    try {
      const row = await send("POST", `/api/admin/esign/templates/${id}/${path}`);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/esign/templates/library"] });
      toast({ title: done });
      if (path === "archive") onBack();
      return row;
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  };

  const moveSection = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= t.content.sections.length) return;
    const secs = [...current.content.sections]; [secs[i], secs[j]] = [secs[j], secs[i]];
    const txt = [...sectionText]; [txt[i], txt[j]] = [txt[j], txt[i]];
    setT({ ...t, content: { ...t.content, sections: secs } }); setSectionText(txt); setDirty(true);
  };

  return (
    <div className="space-y-5 pb-28" data-testid="template-editor">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onBack} className="text-sm text-white/50 hover:text-white flex items-center gap-1.5" data-testid="button-template-back"><ArrowLeft className="w-4 h-4" /> Templates</button>
        <div className="flex items-center gap-2 flex-wrap">
          {t.published
            ? <span className="text-[11px] px-2.5 py-1 rounded-full border text-emerald-300 bg-emerald-400/10 border-emerald-400/25">Published</span>
            : <span className="text-[11px] px-2.5 py-1 rounded-full border text-amber-300 bg-amber-400/10 border-amber-400/25">Draft — nobody can sign it yet</span>}
          <Button variant="outline" onClick={preview} className="gap-1.5" data-testid="button-template-preview"><Eye className="w-4 h-4" /> Preview PDF</Button>
          <Button variant="outline" onClick={() => action("duplicate", "Copied — the copy is a draft")} className="gap-1.5"><Copy className="w-4 h-4" /> Copy</Button>
          <Button variant="outline" onClick={() => { if (window.confirm("Archive this template? Agreements already sent are kept.")) action("archive", "Archived"); }} className="gap-1.5"><Archive className="w-4 h-4" /> Archive</Button>
        </div>
      </div>

      {/* Rambo */}
      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-white/80 font-medium"><img src="/mailer/rambo.png" alt="" className="w-6 h-6 rounded-full" /> Ask Rambo to change it</div>
        <div className="flex gap-2 flex-col sm:flex-row">
          <Input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Add a clause about media and image rights, and a weekly accommodation contribution" data-testid="input-rambo-change" />
          <Button onClick={askRambo} disabled={asking || ask.trim().length < 8} className="gap-1.5 shrink-0">{asking ? <><Loader2 className="w-4 h-4 animate-spin" /> Working…</> : <><Sparkles className="w-4 h-4" /> Change it</>}</Button>
          {undo && <Button variant="outline" onClick={() => { setT(undo); setSectionText(undo.content.sections.map((s) => itemsToText(s.items))); setUndo(null); setDirty(true); }} className="gap-1.5 shrink-0"><Undo2 className="w-4 h-4" /> Undo</Button>}
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] p-4" data-testid="template-problems">
          <div className="flex items-center gap-2 text-sm text-amber-300 font-medium mb-1.5"><AlertTriangle className="w-4 h-4" /> Before it can be published</div>
          <ul className="list-disc pl-5 text-[13px] text-white/70 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <Card title="Basics">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name (what staff see)"><Input value={t.name} onChange={(e) => patch({ name: e.target.value })} data-testid="input-template-name" /></Field>
          <Field label="Brand"><BrandSelect library={library} value={t.brandKey} onChange={(v) => patch({ brandKey: v })} /></Field>
          <Field label="Title printed on the agreement"><Input value={t.content.docTitle} onChange={(e) => patchContent({ docTitle: e.target.value })} /></Field>
          <Field label="Short description"><Input value={t.description ?? ""} onChange={(e) => patch({ description: e.target.value })} /></Field>
          <Field label="The club signs as"><Input value={t.settings.counterSignerRole ?? ""} onChange={(e) => patchSettings({ counterSignerRole: e.target.value })} placeholder="The Club" /></Field>
          <Field label="The other person signs as"><Input value={t.settings.primarySignerRole ?? ""} onChange={(e) => patchSettings({ primarySignerRole: e.target.value })} placeholder="The Player" /></Field>
          <Field label="Heading over their details"><Input value={t.settings.detailsHeading ?? ""} onChange={(e) => patchSettings({ detailsHeading: e.target.value })} placeholder="Player Details" /></Field>
          <label className="flex items-center gap-2 text-[13px] text-white/70 mt-6"><input type="checkbox" checked={!!t.settings.guardianUnder18} onChange={(e) => patchSettings({ guardianUnder18: e.target.checked })} className="w-4 h-4" /> A parent co-signs when the signer is under 18 (needs a date-of-birth field)</label>
        </div>
      </Card>

      <Card title="Details they fill in when signing" hint="Their name, date of birth, address, bank account… The first text field is their full name.">
        <FieldRows rows={t.form} types={ESIGN_FORM_TYPES as readonly string[]} typeLabel={FORM_TYPE_LABEL} onChange={(rows) => patch({ form: rows as FormField[] })} kind="form" />
      </Card>

      <Card title="Details you set when sending" hint="The fee, start date, end date, season… Use {{key}} in the text to place them. For an open link, each needs a default.">
        <FieldRows rows={t.variables} types={ESIGN_VARIABLE_TYPES as readonly string[]} typeLabel={VAR_TYPE_LABEL} onChange={(rows) => patch({ variables: rows as Variable[] })} kind="variable" />
      </Card>

      <Card title="The agreement" hint={`Blank line = new paragraph. Start a line with "- " for a bullet or "# " for a numbered point. Placeholders: ${[...t.form, ...t.variables].map((f) => `{{${f.key}}}`).join("  ") || "add fields first"}`}>
        <Field label="Who it's between (one line each)">
          <Textarea rows={4} value={t.content.partiesIntro.join("\n")} onChange={(e) => patchContent({ partiesIntro: e.target.value.split("\n") })} />
        </Field>
        <div className="space-y-3 mt-3">
          {t.content.sections.map((s, i) => (
            <div key={i} className="rounded-xl border border-white/10 p-3 space-y-2" data-testid={`template-section-${i}`}>
              <div className="flex items-center gap-2">
                <Input value={s.heading} onChange={(e) => { const secs = [...t.content.sections]; secs[i] = { ...secs[i], heading: e.target.value }; patchContent({ sections: secs }); }} className="font-medium" placeholder="Section heading" />
                <IconBtn onClick={() => moveSection(i, -1)} label="Move up"><ChevronUp className="w-4 h-4" /></IconBtn>
                <IconBtn onClick={() => moveSection(i, 1)} label="Move down"><ChevronDown className="w-4 h-4" /></IconBtn>
                <IconBtn onClick={() => { const secs = t.content.sections.filter((_, k) => k !== i); setT({ ...t, content: { ...t.content, sections: secs } }); setSectionText(sectionText.filter((_, k) => k !== i)); setDirty(true); }} label="Remove section"><Trash2 className="w-4 h-4" /></IconBtn>
              </div>
              <Textarea rows={Math.min(14, Math.max(4, (sectionText[i] ?? "").split("\n").length + 1))} value={sectionText[i] ?? ""} onChange={(e) => { const txt = [...sectionText]; txt[i] = e.target.value; setSectionText(txt); setDirty(true); }} />
            </div>
          ))}
          <Button variant="outline" onClick={() => { setT({ ...t, content: { ...t.content, sections: [...t.content.sections, { heading: "", items: [] }] } }); setSectionText([...sectionText, ""]); setDirty(true); }} className="gap-1.5"><Plus className="w-4 h-4" /> Add section</Button>
        </div>
        <Field label="What they agree to when they sign (one sentence)">
          <Input value={t.content.signAck ?? ""} onChange={(e) => patchContent({ signAck: e.target.value })} placeholder="I have read and agree to this agreement." />
        </Field>
      </Card>

      {t.published && <OpenLinkCard id={id} openLink={t.openLink ?? null} dirty={dirty} onChanged={(ol) => setT({ ...t, openLink: ol })} />}

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 md:left-[15rem] z-40 border-t border-white/10 bg-[#0a0f1c]/95 backdrop-blur px-4 py-3 flex items-center justify-end gap-2 flex-wrap" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <span className="text-[12px] text-white/40 mr-auto">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <Button variant="outline" onClick={() => save()} disabled={saving} data-testid="button-template-save">{saving ? "Saving…" : "Save draft"}</Button>
        {t.published
          ? <Button variant="outline" onClick={() => save(false)} disabled={saving}>Unpublish</Button>
          : <Button onClick={() => save(true)} disabled={saving} className="gap-1.5" data-testid="button-template-publish"><CheckCircle2 className="w-4 h-4" /> Publish</Button>}
        {t.published && dirty && <Button onClick={() => save(true)} disabled={saving}>Save & keep published</Button>}
      </div>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div><div className="text-sm font-semibold text-white">{title}</div>{hint && <div className="text-[12px] text-white/40 mt-0.5 break-words">{hint}</div>}</div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><div className="text-[12px] text-white/50">{label}</div>{children}</div>;
}
function IconBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="w-9 h-9 shrink-0 rounded-lg border border-white/10 text-white/50 hover:text-white flex items-center justify-center">{children}</button>;
}

function FieldRows({ rows, types, typeLabel, onChange, kind }: { rows: (FormField | Variable)[]; types: readonly string[]; typeLabel: Record<string, string>; onChange: (rows: (FormField | Variable)[]) => void; kind: "form" | "variable" }) {
  const set = (i: number, p: Record<string, any>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const keyFrom = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return (
    <div className="space-y-2">
      {rows.length === 0 && <div className="text-[12px] text-white/35">None yet.</div>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-xl border border-white/10 p-2.5 grid gap-2 md:grid-cols-[1fr_170px_auto_auto] items-center" data-testid={`${kind}-row-${i}`}>
          <div className="min-w-0">
            <Input value={r.label} onChange={(e) => set(i, { label: e.target.value, key: r.key && r.key !== keyFrom(r.label) ? r.key : keyFrom(e.target.value) })} placeholder="Label, e.g. Date of birth" />
            <div className="text-[11px] text-white/30 mt-1 font-mono truncate">{`{{${r.key || keyFrom(r.label) || "…"}}}`}</div>
          </div>
          <Select value={r.type} onValueChange={(v) => set(i, { type: v })}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>{types.map((ty) => <SelectItem key={ty} value={ty}>{typeLabel[ty] ?? ty}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-[12px] text-white/60 whitespace-nowrap"><input type="checkbox" checked={r.required} onChange={(e) => set(i, { required: e.target.checked })} className="w-4 h-4" /> Required</label>
          <IconBtn onClick={() => onChange(rows.filter((_, k) => k !== i))} label="Remove"><Trash2 className="w-4 h-4" /></IconBtn>
          {kind === "variable" && (
            <div className="md:col-span-4 grid gap-2 md:grid-cols-2">
              <Input value={(r as Variable).default ?? ""} onChange={(e) => set(i, { default: e.target.value })} placeholder={r.type === "date" ? "Default, e.g. 2027-01-15" : "Default value (optional)"} />
              {r.type === "select" && <Input value={((r as Variable).options ?? []).join(", ")} onChange={(e) => set(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Choices, separated by commas" />}
            </div>
          )}
        </div>
      ))}
      <Button variant="outline" onClick={() => onChange([...rows, { key: "", label: "", type: "text", required: true }])} className="gap-1.5"><Plus className="w-4 h-4" /> Add</Button>
    </div>
  );
}

function OpenLinkCard({ id, openLink, dirty, onChanged }: { id: number; openLink: TemplateDraft["openLink"]; dirty: boolean; onChanged: (ol: TemplateDraft["openLink"]) => void }) {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const row = await send("POST", `/api/admin/esign/templates/${id}/open-link`, enabled ? { enabled, signatureName: name, signatureImage: sig, consent } : { enabled });
      onChanged(row.openLink); setOpening(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/esign/templates/library"] });
      toast({ title: enabled ? "The link is open" : "The link is closed" });
    } catch (e: any) { toast({ title: e.message, description: e.problems?.join(" "), variant: "destructive" }); }
    setBusy(false);
  };
  return (
    <Card title="Open link" hint="One link you can share with a group (players, vendors, volunteers). Each person fills in their own details and signs. Every agreement opens already signed by the club, so theirs completes it.">
      {openLink?.enabled ? (
        <div className="space-y-2" data-testid="open-link-on">
          <div className="flex gap-2 flex-col sm:flex-row">
            <Input readOnly value={openLink.url} className="font-mono text-[12px]" data-testid="open-link-url" />
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(openLink.url); toast({ title: "Link copied" }); }} className="gap-1.5 shrink-0"><Link2 className="w-4 h-4" /> Copy</Button>
            <Button variant="outline" onClick={() => toggle(false)} disabled={busy} className="shrink-0">Close link</Button>
          </div>
          <div className="text-[12px] text-white/40">Signed for the club by {openLink.clubSignedBy}{openLink.clubSignedAt ? ` on ${new Date(openLink.clubSignedAt).toLocaleDateString("en-NZ", { dateStyle: "medium" })}` : ""}.</div>
        </div>
      ) : !opening ? (
        <Button onClick={() => setOpening(true)} disabled={dirty} className="gap-1.5" data-testid="button-open-link">{dirty ? "Save first, then open a link" : <><Link2 className="w-4 h-4" /> Open a link</>}</Button>
      ) : (
        <div className="space-y-3">
          <Field label="Your full name (you sign for the club)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="rounded-xl bg-white p-1"><SignaturePad onChange={setSig} height={130} /></div>
          <label className="flex items-start gap-2 text-[12px] text-white/70"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="w-4 h-4 mt-0.5" /> I'm authorised to sign for the club, and I agree that this signature is applied to every agreement made from this link until I close it.</label>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setOpening(false)}>Cancel</Button><Button onClick={() => toggle(true)} disabled={busy || !name.trim() || !consent}>Sign & open the link</Button></div>
        </div>
      )}
    </Card>
  );
}
