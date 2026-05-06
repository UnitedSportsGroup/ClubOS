// Toolbar button that generates a full landing-page draft from a single
// brief. One Claude call returns a structured object — hero, CTAs,
// section titles, FAQs. User previews the draft and clicks Apply All to
// fill every field on the page in one shot.
//
// Used by the camp/program edit page. Designed to be the fastest path
// from "blank page" to "launchable page" — type a paragraph, hit
// generate, review, apply, ship.

import { useState } from "react";
import { Wand2, Loader2, Check, X, AlertCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface PageDraft {
  heroHeadline?: string;
  heroSubheadline?: string;
  primaryCta?: string;
  trustBadge?: string;
  reviewsSectionTitle?: string;
  reviewsSectionSub?: string;
  keyInfoTitle?: string;
  scheduleTitle?: string;
  scheduleSub?: string;
  experienceTitle?: string;
  faqs?: { q: string; a: string }[];
}

interface Props {
  programName?: string;
  programType?: string;
  onApply: (draft: PageDraft) => void;
}

export function AiPageBriefButton({ programName, programType, onApply }: Props) {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<PageDraft | null>(null);

  const generate = async () => {
    if (!brief.trim()) return;
    setGenerating(true);
    setDraft(null);
    try {
      const res = await apiRequest("POST", "/api/admin/ai/generate-page", {
        brief: brief.trim(),
        audience: audience.trim() || undefined,
        orgSlug: currentOrg?.slug,
        programName,
        programType,
      });
      const data = await res.json();
      setDraft(data.draft);
    } catch (e: any) {
      toast({
        title: e.message?.includes("not configured") ? "AI not configured" : "Generation failed",
        description: e.message?.includes("not configured")
          ? "Set ANTHROPIC_API_KEY in Fly secrets and redeploy."
          : (e.message || "Try a shorter brief"),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const apply = () => {
    if (!draft) return;
    onApply(draft);
    toast({ title: "Applied — review the page and Save Changes." });
    setOpen(false);
    setDraft(null);
    setBrief("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gradient-to-r from-violet-500/15 to-blue-500/15 border border-violet-500/30 text-[11px] font-semibold text-violet-200 hover:from-violet-500/25 hover:to-blue-500/25 transition"
          data-testid="ai-page-brief"
        >
          <Wand2 className="w-3.5 h-3.5" /> Generate from brief
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[480px] p-0 bg-[#02060E] border border-violet-500/30 rounded-xl shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-white">Generate page from brief</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {!draft ? (
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
                Audience (optional but useful)
              </label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. parents of 5-12yo girls in South Christchurch"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-violet-500/40"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
                Brief — what's this page selling?
              </label>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate(); }}
                placeholder={`e.g. Recreational gymnastics class for kids 5-12. Once a week, Saturdays 9:30-10:30am at Hornby. $200/term, pro-rated mid-term. Speak to parents whose kids are bouncing off the walls or shy at school. Anti-elite framing.`}
                className="w-full min-h-[120px] px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-violet-500/40 resize-none"
              />
            </div>
            <div className="p-2.5 rounded-md bg-blue-500/[0.06] border border-blue-500/[0.15] text-[11px] text-blue-200/80 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Generates: hero headline + sub, primary CTA, trust badge, reviews + key info + schedule + experience section titles, plus 4 FAQs. ~5 seconds.
            </div>
            <Button
              onClick={generate}
              disabled={!brief.trim() || generating}
              className="w-full bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white text-sm h-10"
            >
              {generating
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Writing draft…</>
                : <><Wand2 className="w-4 h-4 mr-1.5" /> Generate draft</>}
            </Button>
          </div>
        ) : (
          <div className="p-4 space-y-3 max-h-[60vh] overflow-auto">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Draft ready — preview below</div>

            {draft.heroHeadline && (
              <DraftField label="Hero headline" value={draft.heroHeadline} />
            )}
            {draft.heroSubheadline && (
              <DraftField label="Hero subheadline" value={draft.heroSubheadline} />
            )}
            {draft.primaryCta && <DraftField label="Primary CTA" value={draft.primaryCta} />}
            {draft.trustBadge && <DraftField label="Trust badge" value={draft.trustBadge} />}
            {draft.reviewsSectionTitle && <DraftField label="Reviews title" value={draft.reviewsSectionTitle} />}
            {draft.reviewsSectionSub && <DraftField label="Reviews sub" value={draft.reviewsSectionSub} />}
            {draft.keyInfoTitle && <DraftField label="Key info title" value={draft.keyInfoTitle} />}
            {draft.scheduleTitle && <DraftField label="Schedule title" value={draft.scheduleTitle} />}
            {draft.scheduleSub && <DraftField label="Schedule sub" value={draft.scheduleSub} />}
            {draft.experienceTitle && <DraftField label="Experience title" value={draft.experienceTitle} />}

            {draft.faqs && draft.faqs.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1.5">FAQs ({draft.faqs.length})</div>
                <div className="space-y-2">
                  {draft.faqs.map((f, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5">
                      <div className="text-[12px] font-semibold text-white/90">{f.q}</div>
                      <div className="text-[11px] text-white/50 mt-0.5 leading-relaxed">{f.a}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <Button onClick={apply} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Check className="w-4 h-4 mr-1.5" /> Apply all to page
              </Button>
              <Button onClick={generate} disabled={generating} variant="outline" className="border-white/10 text-white/70 hover:bg-white/[0.04]">
                Try again
              </Button>
              <Button onClick={() => setDraft(null)} variant="ghost" className="text-white/50 hover:text-white">
                Edit brief
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DraftField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1">{label}</div>
      <div className="px-3 py-2 rounded-lg bg-emerald-500/[0.05] border border-emerald-500/15 text-[13px] text-white whitespace-pre-wrap">{value}</div>
    </div>
  );
}
