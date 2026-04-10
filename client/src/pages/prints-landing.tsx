import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, X, FileText, Trash2, Edit, Eye, Globe, ExternalLink } from "lucide-react";
import type { PrintLandingPage } from "@shared/schema";

export default function PrintsLanding() {
  const { currentOrg } = useWorkspace();
  const { toast } = useToast();
  const orgId = currentOrg?.id;
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PrintLandingPage | null>(null);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [headline, setHeadline] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [ctaText, setCtaText] = useState("Get a Quote");
  const [ctaUrl, setCtaUrl] = useState("");
  const [content, setContent] = useState("");
  const [published, setPublished] = useState(false);

  const { data: pages = [], isLoading } = useQuery<PrintLandingPage[]>({
    queryKey: ["/api/admin/print-landing-pages", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/print-landing-pages?orgId=${orgId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => { const r = await apiRequest("POST", "/api/admin/print-landing-pages", data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-landing-pages"] }); toast({ title: "Landing page created" }); closeModal(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => { const r = await apiRequest("PATCH", `/api/admin/print-landing-pages/${id}`, data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-landing-pages"] }); toast({ title: "Landing page updated" }); closeModal(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/admin/print-landing-pages/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/print-landing-pages"] }); toast({ title: "Landing page deleted" }); },
  });

  function openCreate() {
    setEditing(null); setTitle(""); setSlug(""); setHeadline(""); setSubheadline(""); setCtaText("Get a Quote"); setCtaUrl(""); setContent(""); setPublished(false);
    setShowModal(true);
  }

  function openEdit(p: PrintLandingPage) {
    setEditing(p); setTitle(p.title); setSlug(p.slug); setHeadline(p.headline || ""); setSubheadline(p.subheadline || ""); setCtaText(p.ctaText || "Get a Quote"); setCtaUrl(p.ctaUrl || ""); setContent(p.content || ""); setPublished(p.published);
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function handleSave() {
    const data = { title, slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), headline: headline || null, subheadline: subheadline || null, ctaText, ctaUrl: ctaUrl || null, content: content || null, published, organizationId: orgId };
    if (editing) updateMutation.mutate({ id: editing.id, ...data });
    else createMutation.mutate(data);
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="prints-landing">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center"><FileText className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">Landing Pages</h1>
            <p className="text-sm text-white/40">{pages.length} pages</p>
          </div>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2" data-testid="button-add-page"><Plus className="w-4 h-4" /> New Page</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full text-center py-12 text-white/30">Loading...</div>
        ) : pages.length === 0 ? (
          <div className="col-span-full text-center py-12 text-white/30">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No landing pages yet</p>
            <p className="text-xs mt-1">Create your first landing page to start generating leads</p>
          </div>
        ) : pages.map(page => (
          <div key={page.id} className="premium-card border border-white/[0.06] rounded-2xl p-5 hover:bg-white/[0.02] transition-colors" data-testid={`page-card-${page.id}`}>
            <div className="flex items-start justify-between mb-3">
              <Badge className={page.published ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/40"}>
                {page.published ? "Published" : "Draft"}
              </Badge>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(page)} className="h-6 w-6 text-white/30 hover:text-white/60" data-testid={`button-edit-page-${page.id}`}><Edit className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete?")) deleteMutation.mutate(page.id); }} className="h-6 w-6 text-red-400/40 hover:text-red-400"><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white/90 mb-1">{page.title}</h3>
            <div className="flex items-center gap-1 text-xs text-white/30 mb-2">
              <Globe className="w-3 h-3" />
              <span>/{page.slug}</span>
            </div>
            {page.headline && <p className="text-xs text-white/50 line-clamp-2 mb-2">{page.headline}</p>}
            <div className="flex items-center justify-between text-xs text-white/30 pt-2 border-t border-white/[0.04]">
              <div className="flex items-center gap-1"><Eye className="w-3 h-3" /><span>{page.views} views</span></div>
              <span className="text-[10px]">{page.ctaText}</span>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full max-w-lg premium-card border border-white/[0.08] rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="modal-landing-page">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Page" : "New Landing Page"}</h2>
              <Button variant="ghost" size="icon" onClick={closeModal} className="text-white/30 h-8 w-8"><X className="w-4 h-4" /></Button>
            </div>
            <Input placeholder="Page title *" value={title} onChange={e => { setTitle(e.target.value); if (!editing) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")); }} className="premium-input text-white/70 rounded-xl" data-testid="input-page-title" />
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-white/30 flex-shrink-0" />
              <Input placeholder="url-slug" value={slug} onChange={e => setSlug(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-page-slug" />
            </div>
            <Input placeholder="Headline" value={headline} onChange={e => setHeadline(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-page-headline" />
            <Input placeholder="Subheadline" value={subheadline} onChange={e => setSubheadline(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-page-subheadline" />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="CTA button text" value={ctaText} onChange={e => setCtaText(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-cta-text" />
              <Input placeholder="CTA link URL" value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} className="premium-input text-white/70 rounded-xl" data-testid="input-cta-url" />
            </div>
            <Textarea placeholder="Page content (supports basic formatting)" value={content} onChange={e => setContent(e.target.value)} className="premium-input text-white/70 rounded-xl min-h-[120px]" data-testid="input-page-content" />
            <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div>
                <p className="text-sm text-white/70">Published</p>
                <p className="text-xs text-white/30">Make this page publicly accessible</p>
              </div>
              <Switch checked={published} onCheckedChange={setPublished} data-testid="switch-published" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={!title.trim()} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex-1" data-testid="button-save-page">
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={closeModal} className="border-white/10 text-white/60 rounded-xl">Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
