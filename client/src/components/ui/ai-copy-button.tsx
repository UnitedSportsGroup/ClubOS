// AI copy generator button. Drops in next to any text input / textarea.
// Click → opens a popover → user types a brief → button calls Claude →
// generated text replaces the field's value (or appears as a 'Use this'
// suggestion if you want a soft-confirm flow).
//
// Brand voice is picked server-side from the orgSlug — the client just
// passes context, doesn't think about voice.

import { useState, useRef, useEffect } from "react";
import { Sparkles, Loader2, Check, X, RefreshCw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AiCopyButtonProps {
  // What field this button is generating for — drives the prompt context
  fieldName: string;
  fieldHint?: string;                // 'Hero headline (1 sentence)'
  currentValue?: string;             // Existing copy, sent so model can rewrite
  onGenerated: (text: string) => void;
  // Optional: a one-line example brief to seed the prompt placeholder
  examplePrompt?: string;
  // Optional: max tokens. Headlines should be tight (<=120), bios ~600.
  maxTokens?: number;
  className?: string;
  size?: "sm" | "xs";
}

export function AiCopyButton({
  fieldName,
  fieldHint,
  currentValue,
  onGenerated,
  examplePrompt,
  maxTokens,
  className,
  size = "sm",
}: AiCopyButtonProps) {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/ai/generate-copy", {
        prompt: prompt.trim(),
        fieldName,
        fieldHint,
        currentValue,
        orgSlug: currentOrg?.slug,
        maxTokens,
      });
      const data = await res.json();
      setResult(data.text);
    } catch (e: any) {
      const msg = e.message || "Generation failed";
      toast({
        title: msg.includes("not configured") ? "AI not configured" : "AI generation failed",
        description: msg.includes("not configured")
          ? "Set ANTHROPIC_API_KEY in Fly secrets and redeploy."
          : msg,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const accept = () => {
    if (result) {
      onGenerated(result);
      setOpen(false);
      setResult(null);
      setPrompt("");
    }
  };

  const sizeClass = size === "xs" ? "h-6 w-6" : "h-7 w-7";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center ${sizeClass} rounded-md bg-gradient-to-br from-violet-500/15 to-blue-500/15 border border-violet-500/25 text-violet-300 hover:from-violet-500/25 hover:to-blue-500/25 hover:text-violet-200 transition flex-shrink-0 ${className ?? ""}`}
          title="Generate with AI"
          data-testid={`ai-button-${fieldName}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[420px] p-0 bg-[#02060E] border border-violet-500/25 rounded-xl shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs font-semibold text-white">AI write</span>
            {fieldHint && <span className="text-[10px] text-white/40">— {fieldHint}</span>}
          </div>
          <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
            }}
            placeholder={examplePrompt ?? "Tell me what to write…"}
            className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-violet-500/40 resize-none"
          />
          {currentValue && (
            <div className="text-[10px] text-white/30">
              The model will see your current copy as context to rewrite or build on.
            </div>
          )}
          {!result && (
            <Button
              onClick={generate}
              disabled={!prompt.trim() || generating}
              className="w-full bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white text-sm h-9"
            >
              {generating
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Writing…</>
                : <><Sparkles className="w-4 h-4 mr-1.5" /> Generate</>}
            </Button>
          )}
          {result && (
            <div className="space-y-2">
              <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-sm text-white whitespace-pre-wrap leading-relaxed">
                {result}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={accept} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm h-8">
                  <Check className="w-4 h-4 mr-1" /> Use this
                </Button>
                <Button onClick={() => { setResult(null); generate(); }} disabled={generating} variant="outline" className="border-white/10 text-white/70 hover:bg-white/[0.04] text-sm h-8">
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Try again
                </Button>
                <Button onClick={() => setResult(null)} variant="ghost" className="text-white/50 hover:text-white text-sm h-8">
                  Edit prompt
                </Button>
              </div>
            </div>
          )}
          <div className="text-[10px] text-white/30 pt-1 border-t border-white/5">
            Tip: <kbd className="px-1 rounded bg-white/[0.06] text-white/60">⌘+↵</kbd> to generate. Brand voice + personas auto-loaded.
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
