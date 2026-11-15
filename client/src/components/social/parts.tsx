// Social media — the shared pieces: platform marks, a post tile, the post
// sheet, and the two small forms (connect an account, type in followers).
import { useEffect, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Eye, Facebook, Heart, Instagram, Linkedin, MessageCircle, Bookmark, Share2, Users, Youtube, ImageOff, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  POST_KIND_LABEL,
  SOCIAL_BRANDS,
  SOCIAL_PLATFORMS,
  socialBrand,
  socialPlatform,
  type SocialAccount,
  type SocialPlatformKey,
  type SocialPost,
} from "@shared/social";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-04" → "4 Nov 2026", by splitting the string (never through a Date). */
export function longDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export function count(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("en-NZ");
}

export function compactCount(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  return v.toLocaleString("en-NZ");
}

export function refreshSocial() {
  return queryClient.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === "string" && (query.queryKey[0] as string).startsWith("/api/admin/social"),
  });
}

export function PlatformIcon({ platform, className }: { platform: SocialPlatformKey; className?: string }) {
  const cls = cn("w-4 h-4 shrink-0", className);
  if (platform === "instagram") return <Instagram className={cls} aria-hidden />;
  if (platform === "facebook") return <Facebook className={cls} aria-hidden />;
  if (platform === "youtube") return <Youtube className={cls} aria-hidden />;
  if (platform === "linkedin") return <Linkedin className={cls} aria-hidden />;
  if (platform === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
        <path d="M16.6 2h-3.1v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .8.1V9.4a6 6 0 1 0 5.2 6V8.6a7.3 7.3 0 0 0 4.3 1.4V6.9a4.3 4.3 0 0 1-4.3-4.3V2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
      <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.2-8.3L1.8 3h6.400l4.400 5.800L17.800 3Zm-1.100 16.200h1.700L7.200 4.700H5.400l11.300 14.500Z" />
    </svg>
  );
}

// ── A post tile ─────────────────────────────────────────────────────────────

function Thumb({ post, className }: { post: SocialPost; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [post.thumb]);
  if (!post.thumb || failed) {
    return (
      <div className={cn("bg-muted flex items-center justify-center p-3 text-center", className)}>
        {post.caption ? (
          <p className="text-xs text-muted-foreground line-clamp-5 break-words">{post.caption}</p>
        ) : (
          <ImageOff className="w-5 h-5 text-muted-foreground" aria-hidden />
        )}
      </div>
    );
  }
  return (
    <img
      src={post.thumb}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("object-cover bg-muted", className)}
    />
  );
}

function Metric({ icon, value, label }: { icon: ReactNode; value: number | null; label: string }) {
  if (value == null) return null;
  return (
    <span className="inline-flex items-center gap-1" title={label}>
      {icon}
      <span className="tabular-nums">{compactCount(value)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PostCard({ post, onOpen, showAccount }: { post: SocialPost; onOpen: (p: SocialPost) => void; showAccount: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      data-testid="social-post"
      className="group text-left rounded-xl border border-border bg-card overflow-hidden hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors min-w-0"
    >
      <div className="relative">
        <Thumb post={post} className="w-full aspect-square" />
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/90 border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground">
          <PlatformIcon platform={post.platform} className="w-3 h-3" />
          {POST_KIND_LABEL[post.kind] ?? post.kind}
        </span>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">{longDay(post.day)}</span>
          {showAccount && <span className="truncate min-w-0 hidden sm:inline">{/^\d+$/.test(post.handle) ? "" : `@${post.handle}`}</span>}
        </div>
        <p className="text-[13px] text-foreground line-clamp-2 break-words min-h-[2.4em]">{post.caption || "No caption"}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Metric icon={<Heart className="w-3.5 h-3.5" aria-hidden />} value={post.likes} label="likes" />
          <Metric icon={<MessageCircle className="w-3.5 h-3.5" aria-hidden />} value={post.comments} label="comments" />
          <Metric icon={<Eye className="w-3.5 h-3.5" aria-hidden />} value={post.views} label="views" />
          <Metric icon={<Users className="w-3.5 h-3.5" aria-hidden />} value={post.reach} label="people reached" />
        </div>
      </div>
    </button>
  );
}

// ── The post sheet ──────────────────────────────────────────────────────────

export function PostDialog({ post, onClose }: { post: SocialPost | null; onClose: () => void }) {
  const rows: { label: string; value: number | null; icon: ReactNode }[] = post
    ? [
        { label: "Likes", value: post.likes, icon: <Heart className="w-4 h-4" aria-hidden /> },
        { label: "Comments", value: post.comments, icon: <MessageCircle className="w-4 h-4" aria-hidden /> },
        { label: "Shares", value: post.shares, icon: <Share2 className="w-4 h-4" aria-hidden /> },
        { label: "Saves", value: post.saves, icon: <Bookmark className="w-4 h-4" aria-hidden /> },
        { label: "Views", value: post.views, icon: <Eye className="w-4 h-4" aria-hidden /> },
        { label: "People reached", value: post.reach, icon: <Users className="w-4 h-4" aria-hidden /> },
        { label: "Clicks", value: post.clicks, icon: <MousePointerClick className="w-4 h-4" aria-hidden /> },
      ]
    : [];
  const given = rows.filter((r) => r.value != null);
  return (
    <Dialog open={!!post} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {post && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <PlatformIcon platform={post.platform} />
                @{post.handle}
              </DialogTitle>
              <DialogDescription>
                {POST_KIND_LABEL[post.kind] ?? post.kind} · {longDay(post.day)}
                {socialBrand(post.brand) ? ` · ${socialBrand(post.brand)!.name}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2 min-w-0">
              <Thumb post={post} className="w-full aspect-square rounded-lg" />
              <div className="space-y-4 min-w-0">
                <dl className="grid grid-cols-2 gap-2">
                  {given.map((r) => (
                    <div key={r.label} className="rounded-lg border border-border p-2.5">
                      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {r.icon}
                        {r.label}
                      </dt>
                      <dd className="text-lg font-semibold tabular-nums text-foreground">{count(r.value)}</dd>
                    </div>
                  ))}
                </dl>
                {given.length === 0 && <p className="text-sm text-muted-foreground">The platform gave no numbers for this post.</p>}
                {post.permalink && (
                  <Button asChild variant="outline" className="w-full h-11 md:h-9">
                    <a href={post.permalink} target="_blank" rel="noreferrer">
                      Open on {socialPlatform(post.platform).label}
                      <ExternalLink className="w-4 h-4 ml-2" aria-hidden />
                    </a>
                  </Button>
                )}
              </div>
            </div>
            {post.caption && <p className="text-sm text-foreground whitespace-pre-wrap break-words">{post.caption}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Connect an account ──────────────────────────────────────────────────────

export function ConnectDialog({
  open,
  onClose,
  defaultBrand,
  defaultPlatform,
}: {
  open: boolean;
  onClose: () => void;
  defaultBrand: string | null;
  defaultPlatform: SocialPlatformKey | null;
}) {
  const [platform, setPlatform] = useState<SocialPlatformKey>("youtube");
  const [brand, setBrand] = useState<string>("");
  const [profile, setProfile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlatform(defaultPlatform ?? "youtube");
    setBrand(defaultBrand ?? "");
    setProfile("");
    setError(null);
    setNote(null);
  }, [open, defaultBrand, defaultPlatform]);

  const def = socialPlatform(platform);
  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/social/accounts", { platform, brand: brand || null, profile });
      return (await res.json()) as { note: string | null };
    },
    onSuccess: async (r) => {
      await refreshSocial();
      if (r.note) setNote(r.note);
      else onClose();
    },
    onError: (e: any) => setError(String(e?.message ?? "Could not save.").replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect an account</DialogTitle>
          <DialogDescription>Paste the profile link. Instagram and Facebook are found automatically.</DialogDescription>
        </DialogHeader>
        {note ? (
          <>
            <p className="text-sm text-foreground">{note}</p>
            <DialogFooter>
              <Button className="h-11 md:h-9" onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={(v) => setPlatform(v as SocialPlatformKey)}>
                  <SelectTrigger className="h-11 md:h-9" data-testid="connect-platform"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOCIAL_PLATFORMS.filter((p) => p.mode !== "auto").map((p) => (
                      <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Brand</Label>
                <Select value={brand || "none"} onValueChange={(v) => setBrand(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-11 md:h-9" data-testid="connect-brand"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Pick a brand</SelectItem>
                    {SOCIAL_BRANDS.map((b) => (
                      <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="social-profile">Profile link or @name</Label>
              <Input
                id="social-profile"
                className="h-11 md:h-9"
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                placeholder={platform === "linkedin" ? "linkedin.com/company/…" : `@name or the ${def.label} link`}
                autoComplete="off"
              />
            </div>
            {def.setup && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                {def.setup.map((s) => (
                  <p key={s}>{s}</p>
                ))}
              </div>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="h-11 md:h-9" disabled={save.isPending || !profile.trim() || !brand}>
                {save.isPending ? "Saving…" : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Type in today's followers (accounts ClubOS cannot read) ─────────────────

export function FollowersDialog({ account, onClose }: { account: SocialAccount | null; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(account?.followers != null ? String(account.followers) : "");
    setError(null);
  }, [account]);
  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/social/accounts/${account!.id}/followers`, { followers: Number(value.replace(/[,\s]/g, "")) });
    },
    onSuccess: async () => {
      await refreshSocial();
      onClose();
    },
    onError: () => setError("Type the follower count as a whole number."),
  });
  const word = account ? socialPlatform(account.platform).audience : "followers";
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Today's {word}</DialogTitle>
          <DialogDescription>
            {account ? `${socialPlatform(account.platform).label} can't be read automatically yet, so type what @${account.handle} shows today.` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <Input
            inputMode="numeric"
            className="h-11 md:h-9"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 1,250"
            aria-label={`Today's ${word}`}
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="h-11 md:h-9" disabled={save.isPending || !value.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
