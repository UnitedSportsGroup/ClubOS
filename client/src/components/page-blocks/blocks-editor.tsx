// Inline block editor — renders below the existing fixed page template in
// the admin editor. Lets the admin add / remove / drag-reorder custom blocks
// and edit their content. Each block also gets a ✨ AI generate button
// that fills the block's content from a single prompt.

import { useState } from "react";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Sparkles, X, Loader2, GripVertical,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  type PageBlock, type BlockType,
  type StatsBlockProps, type FeaturesBlockProps, type CtaBlockProps,
  type ImageTextBlockProps, type VideoBlockProps, type TestimonialsBlockProps, type LogosBlockProps,
  type CoachesBlockProps, type MapBlockProps, type CustomHtmlBlockProps,
  BLOCK_PALETTE, createDefaultBlock,
} from "@/lib/page-blocks";
import { PublicBlock } from "./public-block";
import { ImagePicker } from "@/components/ui/image-picker";

interface Props {
  blocks: PageBlock[];
  onChange: (blocks: PageBlock[]) => void;
}

export function BlocksEditor({ blocks, onChange }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const update = (index: number, props: any) => {
    const next = [...blocks];
    next[index] = { ...next[index], props: { ...next[index].props, ...props } };
    onChange(next);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    onChange(arrayMove(blocks, index, target));
  };
  const remove = (index: number) => {
    if (!confirm("Remove this section?")) return;
    onChange(blocks.filter((_, i) => i !== index));
  };
  const add = (type: BlockType) => {
    onChange([...blocks, createDefaultBlock(type)]);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex(b => b.id === active.id);
    const newIndex = blocks.findIndex(b => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(blocks, oldIndex, newIndex));
  };

  return (
    <section className="py-10 bg-slate-900/40 border-t-2 border-dashed border-blue-500/15">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] font-semibold text-blue-300/40 mb-1">CUSTOM SECTIONS</div>
            <div className="text-sm text-white/70">Anything you add here renders between the FAQ and the footer on the live page. <span className="text-blue-300/50">Drag the handle to reorder.</span></div>
          </div>
          <AddBlockButton onPick={add} />
        </div>

        {blocks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-blue-500/15 bg-white/[0.01] p-10 text-center">
            <div className="text-sm text-white/40 mb-3">No custom sections yet.</div>
            <AddBlockButton onPick={add} large />
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {blocks.map((block, i) => (
                  <SortableBlock
                    key={block.id}
                    block={block}
                    index={i}
                    total={blocks.length}
                    onMove={(dir) => move(i, dir)}
                    onRemove={() => remove(i)}
                    onUpdate={(props) => update(i, props)}
                  />
                ))}
                <div className="flex justify-center pt-2">
                  <AddBlockButton onPick={add} large />
                </div>
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}

function SortableBlock({
  block, index, total, onMove, onRemove, onUpdate,
}: {
  block: PageBlock;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onUpdate: (props: any) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto" as const,
  };
  return (
    <div ref={setNodeRef} style={style} className="rounded-2xl border border-blue-500/20 bg-white/[0.02] overflow-hidden group/block">
      {/* Block toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-blue-500/[0.05] border-b border-blue-500/10">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-300/70 flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="w-6 h-6 rounded-md hover:bg-white/[0.06] cursor-grab active:cursor-grabbing flex items-center justify-center text-white/50 hover:text-white"
            title="Drag to reorder"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <span>{BLOCK_PALETTE.find(p => p.type === block.type)?.icon}</span>
          {BLOCK_PALETTE.find(p => p.type === block.type)?.label}
        </div>
        <div className="flex items-center gap-1">
          <BlockAiButton block={block} onApply={(props) => onUpdate(props)} />
          <button onClick={() => onMove(-1)} disabled={index === 0} className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 flex items-center justify-center text-white/60">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30 flex items-center justify-center text-white/60">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} className="w-7 h-7 rounded-md bg-white/[0.04] hover:bg-red-500/20 flex items-center justify-center text-red-400/70 hover:text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Block edit form */}
      <BlockForm block={block} onChange={onUpdate} />
      {/* Block live preview */}
      <div className="border-t border-blue-500/10">
        <PublicBlock block={block} />
      </div>
    </div>
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
      <PopoverContent align="end" className="w-[360px] p-0 bg-[#02060E] border border-blue-500/30 rounded-xl max-h-[70vh] overflow-y-auto">
        <div className="px-4 py-3 border-b border-white/5 text-sm font-semibold text-white sticky top-0 bg-[#02060E]">Pick a section type</div>
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
  if (block.type === "image_text") return <ImageTextForm props={block.props as ImageTextBlockProps} onChange={onChange} />;
  if (block.type === "video") return <VideoForm props={block.props as VideoBlockProps} onChange={onChange} />;
  if (block.type === "testimonials") return <TestimonialsForm props={block.props as TestimonialsBlockProps} onChange={onChange} />;
  if (block.type === "logos") return <LogosForm props={block.props as LogosBlockProps} onChange={onChange} />;
  if (block.type === "coaches") return <CoachesForm props={block.props as CoachesBlockProps} onChange={onChange} />;
  if (block.type === "map") return <MapForm props={block.props as MapBlockProps} onChange={onChange} />;
  if (block.type === "custom_html") return <CustomHtmlForm props={block.props as CustomHtmlBlockProps} onChange={onChange} />;
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

function ImageTextForm({ props, onChange }: { props: ImageTextBlockProps; onChange: (p: any) => void }) {
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/[0.01]">
      <div className="sm:col-span-2">
        <ImagePicker label="Image" value={props.imageUrl} onChange={(url) => onChange({ imageUrl: url })} />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/40">Image position</label>
        <div className="grid grid-cols-2 gap-2">
          {["left", "right"].map(pos => (
            <button
              key={pos}
              type="button"
              onClick={() => onChange({ imagePosition: pos })}
              className={`p-2 rounded-md text-xs font-medium ${(props.imagePosition ?? "right") === pos ? "bg-blue-600 text-white" : "bg-white/[0.04] text-white/60"}`}
            >
              {pos === "left" ? "← Image left" : "Image right →"}
            </button>
          ))}
        </div>
      </div>
      <FieldInput label="Eyebrow" value={props.eyebrow ?? ""} onChange={(v) => onChange({ eyebrow: v })} />
      <FieldInput label="Title" value={props.title ?? ""} onChange={(v) => onChange({ title: v })} className="sm:col-span-2" />
      <div className="sm:col-span-2 space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/40">Body</label>
        <textarea
          value={props.body ?? ""}
          onChange={e => onChange({ body: e.target.value })}
          rows={4}
          className="w-full bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/40 resize-y"
        />
      </div>
      <FieldInput label="Button text" value={props.buttonText ?? ""} onChange={(v) => onChange({ buttonText: v })} />
      <FieldInput label="Button URL (blank = page CTA)" value={props.buttonHref ?? ""} onChange={(v) => onChange({ buttonHref: v })} />
    </div>
  );
}

function VideoForm({ props, onChange }: { props: VideoBlockProps; onChange: (p: any) => void }) {
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/[0.01]">
      <FieldInput label="Wistia ID" value={props.wistiaId ?? ""} onChange={(v) => onChange({ wistiaId: v.trim() })} />
      <FieldInput label="OR YouTube URL" value={props.youtubeUrl ?? ""} onChange={(v) => onChange({ youtubeUrl: v.trim() })} />
      <FieldInput label="Caption (optional)" value={props.caption ?? ""} onChange={(v) => onChange({ caption: v })} className="sm:col-span-2" />
    </div>
  );
}

function TestimonialsForm({ props, onChange }: { props: TestimonialsBlockProps; onChange: (p: any) => void }) {
  const updateItem = (i: number, field: keyof TestimonialsBlockProps["items"][number], v: string) => {
    const items = [...(props.items ?? [])];
    items[i] = { ...items[i], [field]: v };
    onChange({ items });
  };
  const addItem = () => onChange({ items: [...(props.items ?? []), { quote: "", name: "", role: "" }] });
  const removeItem = (i: number) => onChange({ items: (props.items ?? []).filter((_, idx) => idx !== i) });
  return (
    <div className="p-4 space-y-3 bg-white/[0.01]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldInput label="Eyebrow" value={props.eyebrow ?? ""} onChange={(v) => onChange({ eyebrow: v })} />
        <FieldInput label="Title" value={props.title ?? ""} onChange={(v) => onChange({ title: v })} />
      </div>
      <div className="space-y-2">
        {(props.items ?? []).map((item, i) => (
          <div key={i} className="rounded-lg bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-start justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/40">Testimonial {i + 1}</span>
              <button onClick={() => removeItem(i)} className="text-red-400/60 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              value={item.quote}
              onChange={e => updateItem(i, "quote", e.target.value)}
              placeholder="The quote — keep it short, real, parent voice"
              rows={2}
              className="w-full bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/40 resize-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input value={item.name} onChange={e => updateItem(i, "name", e.target.value)} placeholder="Name" className="bg-white/[0.03] border-white/10 text-white text-sm" />
              <Input value={item.role ?? ""} onChange={e => updateItem(i, "role", e.target.value)} placeholder="Role / context" className="bg-white/[0.03] border-white/10 text-white text-sm" />
            </div>
            <ImagePicker label="Avatar (optional)" value={item.avatarUrl} onChange={(url) => updateItem(i, "avatarUrl", url)} />
          </div>
        ))}
        <button onClick={addItem} className="text-xs text-blue-400/70 hover:text-blue-400 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add testimonial
        </button>
      </div>
    </div>
  );
}

function LogosForm({ props, onChange }: { props: LogosBlockProps; onChange: (p: any) => void }) {
  const updateItem = (i: number, field: "src" | "alt" | "href", v: string) => {
    const items = [...(props.items ?? [])];
    items[i] = { ...items[i], [field]: v };
    onChange({ items });
  };
  const addItem = () => onChange({ items: [...(props.items ?? []), { src: "", alt: "" }] });
  const removeItem = (i: number) => onChange({ items: (props.items ?? []).filter((_, idx) => idx !== i) });
  return (
    <div className="p-4 space-y-3 bg-white/[0.01]">
      <FieldInput label="Eyebrow" value={props.eyebrow ?? ""} onChange={(v) => onChange({ eyebrow: v })} />
      <div className="space-y-2">
        {(props.items ?? []).map((item, i) => (
          <div key={i} className="rounded-lg bg-white/[0.02] p-3 grid grid-cols-1 sm:grid-cols-[1fr,1fr,auto] gap-2 items-start">
            <ImagePicker label={`Logo ${i + 1}`} value={item.src} onChange={(url) => updateItem(i, "src", url)} />
            <div className="space-y-1.5">
              <Input value={item.alt ?? ""} onChange={e => updateItem(i, "alt", e.target.value)} placeholder="Alt text" className="bg-white/[0.03] border-white/10 text-white text-sm" />
              <Input value={item.href ?? ""} onChange={e => updateItem(i, "href", e.target.value)} placeholder="Optional link URL" className="bg-white/[0.03] border-white/10 text-white text-sm" />
            </div>
            <button onClick={() => removeItem(i)} className="text-red-400/60 hover:text-red-400 p-1.5 self-center">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button onClick={addItem} className="text-xs text-blue-400/70 hover:text-blue-400 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add logo
        </button>
      </div>
    </div>
  );
}

function CoachesForm({ props, onChange }: { props: CoachesBlockProps; onChange: (p: any) => void }) {
  const updateItem = (i: number, field: "name" | "role" | "bio" | "photoUrl", v: string) => {
    const items = [...(props.items ?? [])];
    items[i] = { ...items[i], [field]: v };
    onChange({ items });
  };
  const addItem = () => onChange({ items: [...(props.items ?? []), { name: "Coach Name", role: "", bio: "", photoUrl: "" }] });
  const removeItem = (i: number) => onChange({ items: (props.items ?? []).filter((_, idx) => idx !== i) });
  return (
    <div className="p-4 space-y-3 bg-white/[0.01]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldInput label="Eyebrow" value={props.eyebrow ?? ""} onChange={(v) => onChange({ eyebrow: v })} />
        <FieldInput label="Title" value={props.title ?? ""} onChange={(v) => onChange({ title: v })} />
        <FieldInput label="Subtitle" value={props.subtitle ?? ""} onChange={(v) => onChange({ subtitle: v })} className="sm:col-span-2" />
      </div>
      <div className="space-y-2">
        {(props.items ?? []).map((coach, i) => (
          <div key={i} className="rounded-lg bg-white/[0.02] p-3 grid grid-cols-1 sm:grid-cols-[180px,1fr,auto] gap-3 items-start">
            <ImagePicker label={`Coach ${i + 1} photo`} value={coach.photoUrl} onChange={(url) => updateItem(i, "photoUrl", url)} />
            <div className="space-y-2">
              <Input value={coach.name} onChange={e => updateItem(i, "name", e.target.value)} placeholder="Name" className="bg-white/[0.03] border-white/10 text-white text-sm" />
              <Input value={coach.role ?? ""} onChange={e => updateItem(i, "role", e.target.value)} placeholder="Role (e.g. Head Coach — Recreational)" className="bg-white/[0.03] border-white/10 text-white text-sm" />
              <textarea
                value={coach.bio ?? ""}
                onChange={e => updateItem(i, "bio", e.target.value)}
                placeholder="1-2 sentence bio — qualifications, vibe, what they're known for"
                rows={3}
                className="w-full bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/40 resize-none"
              />
            </div>
            <button onClick={() => removeItem(i)} className="text-red-400/60 hover:text-red-400 p-1.5 self-start">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button onClick={addItem} className="text-xs text-blue-400/70 hover:text-blue-400 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add coach
        </button>
      </div>
    </div>
  );
}

function MapForm({ props, onChange }: { props: MapBlockProps; onChange: (p: any) => void }) {
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/[0.01]">
      <FieldInput label="Title" value={props.title ?? ""} onChange={(v) => onChange({ title: v })} />
      <FieldInput label="Address (shown below title)" value={props.address ?? ""} onChange={(v) => onChange({ address: v })} />
      <div className="sm:col-span-2 space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/40">Embed URL <span className="normal-case text-white/30">— or paste a Google Maps {"<iframe>"} snippet (we'll extract the src). Leave blank to use the address above.</span></label>
        <textarea
          value={props.embedUrl ?? ""}
          onChange={e => onChange({ embedUrl: e.target.value })}
          rows={3}
          placeholder={'https://www.google.com/maps/embed?pb=…  or  <iframe src="…" …></iframe>'}
          className="w-full bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500/40 resize-y"
        />
        <p className="text-[10px] text-white/30">In Google Maps: Share → Embed a map → Copy HTML.</p>
      </div>
      <div className="sm:col-span-2 space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/40">Map height (px)</label>
        <Input
          type="number"
          value={String(props.height ?? 360)}
          onChange={e => onChange({ height: parseInt(e.target.value) || 360 })}
          min={200}
          max={800}
          className="bg-white/[0.03] border-white/10 text-white w-32"
        />
      </div>
    </div>
  );
}

function CustomHtmlForm({ props, onChange }: { props: CustomHtmlBlockProps; onChange: (p: any) => void }) {
  return (
    <div className="p-4 space-y-3 bg-white/[0.01]">
      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-200/80">
        ⚠️ Advanced — anything you paste here renders as raw HTML on the live page. Don't paste anything you don't trust.
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/40">Max width</label>
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {(["narrow", "wide", "full"] as const).map(w => (
            <button
              key={w}
              type="button"
              onClick={() => onChange({ maxWidth: w })}
              className={`p-2 rounded-md text-xs font-medium ${(props.maxWidth ?? "wide") === w ? "bg-blue-600 text-white" : "bg-white/[0.04] text-white/60"}`}
            >
              {w === "narrow" ? "Narrow" : w === "wide" ? "Wide" : "Full"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/40">HTML</label>
        <textarea
          value={props.html ?? ""}
          onChange={e => onChange({ html: e.target.value })}
          rows={10}
          placeholder="<div>Your HTML…</div>"
          className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-xs text-white/90 font-mono focus:outline-none focus:border-blue-500/40 resize-y"
        />
      </div>
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
        maxTokens: 1400,
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

  // Custom-HTML: AI doesn't help here, hide the button
  if (block.type === "custom_html") return null;

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
  if (type === "image_text") {
    return `{ "eyebrow": "all-caps", "title": "section title", "body": "2-3 sentences narrative", "buttonText": "verb phrase" }`;
  }
  if (type === "testimonials") {
    return `{ "eyebrow": "all-caps", "title": "section heading", "items": [{"quote":"Short real-feeling parent quote","name":"First name only","role":"mum of [child], age"}, {"quote":"...","name":"...","role":"..."}, {"quote":"...","name":"...","role":"..."}] }`;
  }
  if (type === "logos") {
    return `{ "eyebrow": "all-caps line — what these logos represent" }`;
  }
  if (type === "video") {
    return `{ "caption": "1 short sentence below the video — what they're about to see" }`;
  }
  if (type === "coaches") {
    return `{ "eyebrow": "all-caps", "title": "section heading", "subtitle": "1 sentence", "items": [{"name":"First Last","role":"Role title","bio":"1-2 sentence bio with credential + vibe","photoUrl":""}, {"name":"...","role":"...","bio":"...","photoUrl":""}, {"name":"...","role":"...","bio":"...","photoUrl":""}] }`;
  }
  if (type === "map") {
    return `{ "title": "Find us / Visit / similar", "address": "1-line address" }`;
  }
  return "{}";
}

function examplePromptFor(type: BlockType): string {
  if (type === "stats") return "Stats for the Recreational program — credibility numbers parents care about.";
  if (type === "features") return "4 features that differentiate us from Olympia and Delta — anti-elite framing.";
  if (type === "cta") return "Final CTA pushing for a free trial booking before term 2 fills up.";
  if (type === "image_text") return "Story about how the club started in 2020 as part of CUFC's multi-sport hub.";
  if (type === "testimonials") return "3 realistic-sounding parent testimonials — Hornby mums, mix of rec and pathway, specific kid moments.";
  if (type === "logos") return "Eyebrow line for a logo strip showing CUFC parent brands.";
  if (type === "video") return "1-sentence caption for a hero video — what parents will see in 30 seconds.";
  if (type === "coaches") return "3 coach bios for the recreational program — friendly, credentialed, photo placeholders empty.";
  if (type === "map") return "Title + address for the Hornby venue at United Sports Centre.";
  return "";
}
