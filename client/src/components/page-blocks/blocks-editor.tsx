// Inline block editor — renders below the existing fixed page template in
// the admin editor. Lets the admin add / remove / reorder custom blocks
// and edit their content. Each block also gets a ✨ AI generate button
// that fills the block's content from a single prompt.

import { useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, Sparkles, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  type PageBlock, type BlockType,
  type StatsBlockProps, type FeaturesBlockProps, type CtaBlockProps,
  BLOCK_PALETTE, createDefaultBlock,
} from "@/lib/page-blocks";
import { PublicBlock } from "./public-block";

interface Props {
  blocks: PageBlock[];
  onChange: (blocks: PageBlock[]) => void;
}

export function BlocksEditor({ blocks, onChange }: Props) {
  const update = (index: number, props: any) => {
    const next = [...blocks];
    next[index] = { ...next[index], props: { ...next[index].props, ...props } };
    onChange(next);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const remove = (index: number) => {
    if (!confirm("Remove this section?")) return;
    onChange(blocks.filter((_, i) => i !== index));
  };
  const add = (type: BlockType) => {
    onChange([...blocks, createDefaultBlock(type)]);
  };

  return (
    <section className="py-10 bg-slate-900/40 border-t-2 border-dashed border-blue-500/15">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] font-semibold text-blue-300/40 mb-1">CUSTOM SECTIONS</div>
            <div className="text-sm text-white/70">Anything you add here renders between the FAQ and the footer on the live page.</div>
          </div>
          <AddBlockButton onPick={add} />
        </div>

        {blocks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-blue-500/15 bg-white/[0.01] p-10 text-center">
            <div className="text-sm text-white/40 mb-3">No custom sections yet.</div>
            <AddBlockButton onPick={add} large />
          </div>
        ) : (
          <div className="space-y-4">
            {blocks.map((block, i) => (
              <div key={block.id} className="rounded-2xl border border-blue-500/20 bg-white/[0.02] overflow-hidden group/block">
                {/* Block toolbar */}
                <div className="flex items-center justify-between px-4 py-2 bg-blue-500/[0.05] border-b border-blue-500/10">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-300/70 flex items-center gap-2">
                    <span>{BLOCK_PALETTE.find(p => p.type === block.type)?.icon}</span>
                    {BLOCK_PALETTE.find(p => p.type === block.type)?.label}
                  </div>
                  <div className="flex items-center gap-1">
                    <BlockAiButton block={block} onApply={(props) => update(i, props)} />
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 flex items-center justify-center text-white/60">
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 flex items-center justify-center text-white/60">
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(i)} className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-red-500/20 flex items-center justify-center text-red-400/70 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* Block edit form */}
                <BlockForm block={block} onChange={(props) => update(i, props)} />
                {/* Block live preview */}
                <div className="border-t border-blue-500/10">
                  <PublicBlock block={block} />
                </div>
              </div>
            ))}
            <div className="flex justify-center pt-2">
              <AddBlockButton onPick={add} large />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function AddBlockButton({ onPick, large }: { onPick: (type: BlockType) => void; large?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={
            large
              ? "inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
              : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
          }
        >
          <Plus className="w-4 h-4" /> Add section
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0 bg-[#02060E] border border-blue-500/30 rounded-xl">
        <div className="px-4 py-3 border-b border-white/5 text-sm font-semibold text-white">Pick a section type</div>
        <div className="p-2">
          {BLOCK_PALETTE.map(p => (
            <button
              key={p.type}
              onClick={() => { onPick(p.type); setOpen(false); }}
              className="w-full text-left p-3 rounded-lg hover:bg-white/[0.04] transition flex items-start gap-3"
            >
              <span className="text-xl flex-shrink-0">{p.icon}</span>
              <div>
                <div className="text-sm font-semibold text-white">{p.label}</div>
                <div className="text-xs text-white/50 mt-0.5">{p.description}</div>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BlockForm({ block, onChange }: { block: PageBlock; onChange: (props: any) => void }) {
  if (block.type === "stats") return <StatsForm props={block.props as StatsBlockProps} onChange={onChange} />;
  if (block.type === "features") return <FeaturesForm props={block.props as FeaturesBlockProps} onChange={onChange} />;
  if (block.type === "cta") return <CtaForm props={block.props as CtaBlockProps} onChange={onChange} />;
  return null;
}

function StatsForm({ props, onChange }: { props: StatsBlockProps; onChange: (p: any) => void }) {
  const updateItem = (i: number, field: "value" | "label", v: string) => {
    const items = [...(props.items ?? [])];
    items[i] = { ...items[i], [field]: v };
    onChange({ items });
  };
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/[0.01]">
      <FieldInput label="Eyebrow" value={props.eyebrow ?? ""} onChange={(v) => onChange({ eyebrow: v })} className="sm:col-span-2" />
      <FieldInput label="Title (optional)" value={props.title ?? ""} onChange={(v) => onChange({ title: v })} className="sm:col-span-2" />
      <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(props.items ?? []).map((item, i) => (
          <div key={i} className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-white/40">Stat {i + 1}</label>
            <Input value={item.value} onChange={e => updateItem(i, "value", e.target.value)} placeholder="200+" className="bg-white/[0.03] border-white/10 text-white" />
            <Input value={item.label} onChange={e => updateItem(i, "label", e.target.value)} placeholder="Hornby families" className="bg-white/[0.03] border-white/10 text-white text-xs" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturesForm({ props, onChange }: { props: FeaturesBlockProps; onChange: (p: any) => void }) {
  const updateItem = (i: number, field: "title" | "body", v: string) => {
    const items = [...(props.items ?? [])];
    items[i] = { ...items[i], [field]: v };
    onChange({ items });
  };
  const addItem = () => onChange({ items: [...(props.items ?? []), { title: "New feature", body: "" }] });
  const removeItem = (i: number) => onChange({ items: (props.items ?? []).filter((_, idx) => idx !== i) });
  return (
    <div className="p-4 space-y-3 bg-white/[0.01]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldInput label="Eyebrow" value={props.eyebrow ?? ""} onChange={(v) => onChange({ eyebrow: v })} />
        <FieldInput label="Title" value={props.title ?? ""} onChange={(v) => onChange({ title: v })} />
        <FieldInput label="Subtitle" value={props.subtitle ?? ""} onChange={(v) => onChange({ subtitle: v })} className="sm:col-span-2" />
      </div>
      <div className="space-y-2">
        {(props.items ?? []).map((item, i) => (
          <div key={i} className="grid grid-cols-[1fr,2fr,auto] gap-2 items-start p-2 rounded-lg bg-white/[0.02]">
            <Input value={item.title} onChange={e => updateItem(i, "title", e.target.value)} placeholder="Feature title" className="bg-white/[0.03] border-white/10 text-white text-sm" />
            <textarea value={item.body} onChange={e => updateItem(i, "body", e.target.value)} placeholder="One-sentence description" rows={2} className="bg-white/[0.03] border border-white/10 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500/40 resize-none" />
            <button onClick={() => removeItem(i)} className="text-red-400/60 hover:text-red-400 p-1.5">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button onClick={addItem} className="text-xs text-blue-400/70 hover:text-blue-400 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add feature
        </button>
      </div>
    </div>
  );
}

function CtaForm({ props, onChange }: { props: CtaBlockProps; onChange: (p: any) => void }) {
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/[0.01]">
      <FieldInput label="Headline" value={props.headline} onChange={(v) => onChange({ headline: v })} className="sm:col-span-2" />
      <FieldInput label="Subheadline (optional)" value={props.subheadline ?? ""} onChange={(v) => onChange({ subheadline: v })} className="sm:col-span-2" />
      <FieldInput label="Button text" value={props.buttonText ?? ""} onChange={(v) => onChange({ buttonText: v })} />
      <FieldInput label="Button URL (blank = uses page CTA)" value={props.buttonHref ?? ""} onChange={(v) => onChange({ buttonHref: v })} />
    </div>
  );
}

function FieldInput({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <label className="text-[10px] uppercase tracking-wider text-white/40">{label}</label>
      <Input value={value} onChange={e => onChange(e.target.value)} className="bg-white/[0.03] border-white/10 text-white" />
    </div>
  );
}

// ── Per-block AI generate ────────────────────────────────────────────────
function BlockAiButton({ block, onApply }: { block: PageBlock; onApply: (props: any) => void }) {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      // Each block type asks for a different JSON shape
      const fieldHint = `Generate content for a ${block.type} block. Return ONLY a JSON object matching this shape: ${shapeFor(block.type)}`;
      const res = await apiRequest("POST", "/api/admin/ai/generate-copy", {
        prompt: `${prompt.trim()}\n\nReturn ONLY valid JSON — no markdown, no preamble, no code fences. Shape: ${shapeFor(block.type)}`,
        fieldName: `block-${block.type}`,
        fieldHint,
        orgSlug: currentOrg?.slug,
        maxTokens: 1200,
      });
      const data = await res.json();
      let raw = (data.text as string).trim();
      raw = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```\s*$/, "").trim();
      const parsed = JSON.parse(raw);
      onApply(parsed);
      toast({ title: "Block generated" });
      setOpen(false);
      setPrompt("");
    } catch (e: any) {
      toast({ title: "AI generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-violet-500/15 to-blue-500/15 border border-violet-500/25 text-violet-300 hover:from-violet-500/25 hover:to-blue-500/25 transition"
          title="Generate this section with AI"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] p-0 bg-[#02060E] border border-violet-500/30 rounded-xl">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs font-semibold text-white">Generate this section</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate(); }}
            placeholder={examplePromptFor(block.type)}
            className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-violet-500/40 resize-none"
          />
          <Button
            onClick={generate}
            disabled={!prompt.trim() || generating}
            className="w-full bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white text-sm h-9"
          >
            {generating
              ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Writing…</>
              : <><Sparkles className="w-4 h-4 mr-1.5" /> Generate</>}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function shapeFor(type: BlockType): string {
  if (type === "stats") {
    return `{ "eyebrow": "all-caps short line", "title": "optional heading", "items": [{"value":"50","label":"years"},{"value":"200+","label":"families"},{"value":"5","label":"coaches"},{"value":"10","label":"sessions"}] }`;
  }
  if (type === "features") {
    return `{ "eyebrow": "all-caps short", "title": "section heading", "subtitle": "1 sentence", "items": [{"title":"Short title","body":"1 sentence body"}, {"title":"...","body":"..."}, {"title":"...","body":"..."}, {"title":"...","body":"..."}] }`;
  }
  if (type === "cta") {
    return `{ "headline": "1 sentence call to action", "subheadline": "1 sentence support", "buttonText": "2-4 word verb phrase" }`;
  }
  return "{}";
}

function examplePromptFor(type: BlockType): string {
  if (type === "stats") return "Stats for the Recreational program — credibility numbers parents care about.";
  if (type === "features") return "4 features that differentiate us from Olympia and Delta — anti-elite framing.";
  if (type === "cta") return "Final CTA pushing for a free trial booking before term 2 fills up.";
  return "";
}
