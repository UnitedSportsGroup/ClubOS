// Every sponsor's content folder, as cards: open the sponsor's page, copy the
// link to send them, or open the folder in Club Drive to add files.
// Used in Sponsorship → Partners → Content and Marketing → Social media → Labels.
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, ExternalLink, FolderOpen, Images } from "lucide-react";

interface SponsorContent {
  nodeId: number; name: string; files: number; pictures: number; videos: number; sizeBytes: number; covers: number[];
  link: { token: string; url: string; views: number; downloads: number; lastViewedAt: string | null } | null;
}

export function SponsorContentGrid({ heading }: { heading?: string }) {
  const { toast } = useToast();
  const q = useQuery<{ rootId: number | null; sponsors: SponsorContent[] }>({
    queryKey: ["/api/admin/sponsor-content"],
    queryFn: async () => {
      const r = await workspaceFetch("/api/admin/sponsor-content");
      if (!r.ok) throw new Error("Couldn't load the sponsor content");
      return r.json();
    },
  });
  // Where the sponsor's page should send the person back to.
  const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (q.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>;
  if (q.isError) return <p className="rounded-xl border border-border p-4 text-sm text-foreground" data-testid="sponsor-content-error">The sponsor content did not load. Try again.</p>;
  const list = q.data?.sponsors ?? [];
  // In Marketing the block simply is not drawn for someone who cannot open the folder.
  if (!list.length && heading) return null;
  if (!list.length) return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center" data-testid="sponsor-content-empty">
      <p className="text-sm font-medium text-foreground">No sponsor content folders yet</p>
      <p className="mt-1 text-sm text-muted-foreground">They live in Club Drive under “Sponsor Content”. You need the Sponsorship tab in United Sports Group to see them.</p>
    </div>
  );

  return (
    <section className="space-y-3" data-testid="sponsor-content">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{heading ?? "Content for each sponsor"}</h2>
          <p className="text-sm text-muted-foreground">Pictures and videos each sponsor appears in. Open a sponsor's page to see what they see, or copy their link to send it.</p>
        </div>
        {q.data?.rootId && (
          <Button variant="outline" className="h-11 md:h-9" asChild>
            <a href={`/admin/drive?folder=${q.data.rootId}`} data-testid="sponsor-content-drive"><FolderOpen className="mr-1.5 h-4 w-4" aria-hidden />All folders in Club Drive</a>
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <div key={s.nodeId} className="overflow-hidden rounded-xl border border-border bg-card" data-testid="sponsor-content-card">
            <a href={s.link ? `/share/${s.link.token}?from=${encodeURIComponent(here())}` : `/admin/drive?folder=${s.nodeId}`} className="block" aria-label={`Open ${s.name}`}>
              <div className="grid h-32 grid-cols-3 gap-px bg-muted">
                {s.link && s.covers.length > 0
                  ? s.covers.map((id) => <img key={id} src={`/api/public/drive-share/${s.link!.token}/thumb/${id}`} alt="" loading="lazy" className="h-32 w-full object-cover" />)
                  : <div className="col-span-3 grid place-items-center text-muted-foreground"><Images className="h-7 w-7" aria-hidden /></div>}
              </div>
            </a>
            <div className="space-y-2 p-3">
              <div>
                <p className="font-semibold text-foreground" data-testid="sponsor-content-name">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.pictures} {s.pictures === 1 ? "picture" : "pictures"} · {s.videos} {s.videos === 1 ? "video" : "videos"}
                  {s.link ? ` · sponsor opened it ${s.link.views} ${s.link.views === 1 ? "time" : "times"}, ${s.link.downloads} ${s.link.downloads === 1 ? "download" : "downloads"}` : " · no link yet"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {s.link ? (
                  <>
                    <Button className="h-11 md:h-9" asChild>
                      <a href={`/share/${s.link.token}?from=${encodeURIComponent(here())}`} data-testid="sponsor-content-open"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />Open</a>
                    </Button>
                    <Button variant="outline" className="h-11 md:h-9" data-testid="sponsor-content-copy"
                      onClick={() => { navigator.clipboard.writeText(s.link!.url); toast({ title: `Link for ${s.name} copied` }); }}>
                      <Copy className="mr-1.5 h-4 w-4" aria-hidden />Copy link
                    </Button>
                  </>
                ) : null}
                <Button variant="outline" className="h-11 md:h-9" asChild>
                  <a href={`/admin/drive?folder=${s.nodeId}`}><FolderOpen className="mr-1.5 h-4 w-4" aria-hidden />{s.link ? "Add files" : "Open in Drive"}</a>
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
