// Type a name, get the address that actually reaches them.
//
// Daniel, 2026-09-10, relaying Olga: "she don't know parents or kids emails and
// sometimes only knows player name, so needs to be able to easily search and as
// she's typing it's showing what we have, as well the option to just enter a
// completely new custom email too."
//
// 🔴 ONE COMPONENT, used in both places. The Mailer had two identical
// email-entry blocks — one for the "custom" audience and one for "additional
// manual emails" — and a fix applied to one of them would have silently left
// the other behind.
//
// 🔴 IT ALWAYS SAYS WHOSE MAILBOX IT IS. Searching "Beauden Whittle" gives
// mirrenleigh7@gmail.com, which belongs to Mirren Harvey. Olga has to be able
// to see that before she sends, or she cannot tell a right answer from a wrong
// one.
//
// 🔴 A ROW SAYS WHO THE PERSON IS, NOT JUST THEIR TYPE (Daniel, 2026-10-25:
// "it comes up with a little badge called Guardian, and it has the email, but
// that doesn't really tell me a lot … what if people have the same name?").
// A parent is shown with their children and each child's age group; a player
// with their age group and parent; a sponsor with the company and its logo.
// Each kind has its own colour so the eye finds it before reading.
//
// 🔴 EVERY ROW IS THE SAME HEIGHT: two lines, never three (Daniel, 2026-10-25:
// "anything with an extra element has to go side by side, as opposed to just
// stacking"). Line one is the name, the badge and whatever says who they are
// (children, age group, company) in ONE non-wrapping strip that clips with a
// "+N" chip; line two is the address. Holds at every width because nothing in
// a row is allowed to wrap.
//
// 🔴 THE LIST IS RENDERED THROUGH A PORTAL. The Mailer's cards carry
// `backdrop-filter`, which makes each card its own stacking context — an
// absolutely-positioned list inside the Recipients card drew UNDER the Sender
// Details card below it, whatever z-index it carried. Portalled to <body> and
// positioned from the input's rect, nothing on the page can sit on top of it.
//
// 🔴 FINISHING THE ADDRESS FOR THEM (Daniel, 2026-10-25: "if no options
// already exist in our database, it comes up with the common ones to help
// speed up that process"). When nobody in ClubOS matches what is typed, the
// list offers the typed text at the mailboxes NZ families actually use —
// "dannyboy362@gmail.com", "@hotmail.com", … — and narrows as they type past
// the @. One tap or Enter completes it. It never guesses a domain on its own:
// a typed address that is already complete is added exactly as typed.
//
// 🔴 TYPING A WHOLE ADDRESS STILL WORKS. Enter adds it as-is — the search is an
// addition to free entry, never a replacement for it.
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X, Search, Loader2, UserX } from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";

type PersonChild = { name: string; ageGroup: string | null; programme: string | null };

type PersonHit = {
  key: string; contactId: number; name: string; type: string;
  email: string | null; emailOwner: string | null; unreachable: string | null; detail: string | null;
  ageGroup?: string | null;
  parentName?: string | null;
  children?: PersonChild[];
  company?: string | null;
  role?: string | null;
  logoUrl?: string | null;
  logoGround?: "light" | "dark" | null;
  bounce?: { kind: string; label: string } | null;
};

// The mailboxes NZ families use, most common first. Kept short on purpose:
// a long list is noise, and anything else they type in full.
const COMMON_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "xtra.co.nz"];

/** "dannyboy362" → every common domain · "dannyboy362@g" → gmail.com only ·
 *  "dannyboy362@gmail.com" (complete) → nothing. */
function completionsFor(typed: string): string[] {
  const t = typed.trim().toLowerCase();
  if (!t || /\s/.test(t) || t.length < 2) return [];
  const at = t.indexOf("@");
  const local = at === -1 ? t : t.slice(0, at);
  const domainTyped = at === -1 ? "" : t.slice(at + 1);
  if (!local || local.includes("@")) return [];
  if (domainTyped.includes(".") && COMMON_DOMAINS.includes(domainTyped)) return [];   // already complete
  return COMMON_DOMAINS.filter((d) => d.startsWith(domainTyped)).slice(0, 5).map((d) => `${local}@${d}`);
}

// One colour per kind of person, so a sponsor never looks like a parent.
const KIND: Record<string, { label: string; badge: string; dot: string }> = {
  guardian: { label: "Parent",  badge: "border-blue-500/30 text-blue-300 bg-blue-500/10",       dot: "bg-blue-400" },
  player:   { label: "Player",  badge: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10", dot: "bg-emerald-400" },
  staff:    { label: "Staff",   badge: "border-violet-500/30 text-violet-300 bg-violet-500/10",  dot: "bg-violet-400" },
  sponsor:  { label: "Sponsor", badge: "border-amber-500/30 text-amber-300 bg-amber-500/10",    dot: "bg-amber-400" },
};
const kindOf = (t: string) => KIND[t] ?? { label: t, badge: "border-white/10 text-white/40 bg-white/5", dot: "bg-white/30" };

// The children strip: at most three named, the rest counted, and the whole
// thing clips rather than wraps so the row keeps its height on a phone.
function ChildChips({ children }: { children: PersonChild[] }) {
  const shown = children.slice(0, 3);
  const more = children.length - shown.length;
  return (
    <span className="flex items-center gap-1 min-w-0 overflow-hidden shrink">
      {shown.map(c => (
        <span key={c.name} className="text-[10px] px-1.5 h-4 rounded-full bg-white/[0.06] text-white/60 flex items-center gap-1 shrink-0" title={c.programme ?? undefined}>
          {c.name}{c.ageGroup && <span className="text-emerald-300/80">{c.ageGroup}</span>}
        </span>
      ))}
      {more > 0 && <span className="text-[10px] px-1.5 h-4 rounded-full bg-white/[0.06] text-white/45 flex items-center shrink-0">+{more}</span>}
    </span>
  );
}

function SponsorMark({ company, logoUrl, ground }: { company: string; logoUrl: string | null; ground?: "light" | "dark" | null }) {
  const initials = company.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
  // White artwork sits on the club navy; colour artwork on white — the same
  // tile the Partners tab draws, so a sponsor looks the same everywhere.
  return logoUrl ? (
    <img src={logoUrl} alt="" className={`w-7 h-7 rounded-md object-contain p-0.5 shrink-0 ${ground === "dark" ? "bg-blue-900" : "bg-white"}`} />
  ) : (
    <span className="w-7 h-7 rounded-md bg-amber-500/15 text-amber-300 text-[10px] font-semibold flex items-center justify-center shrink-0">
      {initials || "S"}
    </span>
  );
}

export function RecipientSearch({
  emails, onAdd, onRemove, label, placeholder,
}: {
  emails: string[];
  onAdd: (email: string) => void;
  onRemove: (email: string) => void;
  label: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // Debounced, and every in-flight answer is discarded if a newer keystroke has
  // happened — otherwise a slow "ta" lands after a fast "tahlae" and the list
  // shows results for something the user has stopped typing.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setBusy(false); return; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await workspaceFetch(`/api/admin/mailer/search-people?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (!cancelled) { setHits(data.people ?? []); setActive(0); setOpen(true); }
      } catch { if (!cancelled) setHits([]); }
      finally { if (!cancelled) setBusy(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  // The list lives in <body>, so "clicked away" has to check both boxes.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  // Position from the input's rect; follow scroll and resize while open.
  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
  }, [open, measure]);

  // A typed address is checked the moment it is added — syntax, a slip of a
  // common domain (gmial.com), a domain that takes no mail. It FLAGS the chip
  // and offers the fix; it never refuses the address (the check can be
  // wrong, the person adding it is right there to decide).
  type Flag = { status: string; reason: string | null; suggestion: string | null; bounce?: { kind: string; label: string; dead: boolean } | null };
  const [flags, setFlags] = useState<Record<string, Flag>>({});
  const checkTyped = useCallback(async (e: string) => {
    try {
      const res = await workspaceFetch("/api/admin/mailer/check-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e }) });
      const f: Flag = await res.json();
      if ((f.status !== "ok" && f.status !== "unchecked") || f.bounce) setFlags(prev => ({ ...prev, [e]: f }));
    } catch { /* a failed check says nothing */ }
  }, []);

  const addRaw = useCallback(() => {
    const e = q.trim().toLowerCase();
    if (e.includes("@") && !emails.includes(e)) { onAdd(e); setQ(""); setHits([]); setOpen(false); void checkTyped(e); }
  }, [q, emails, onAdd, checkTyped]);

  const pick = useCallback((p: PersonHit) => {
    if (!p.email) return;                       // unreachable rows are not selectable
    const e = p.email.toLowerCase();
    if (!emails.includes(e)) onAdd(e);
    // A known bounce rides onto the chip, so it is still visible after the pick.
    if (p.bounce) setFlags(prev => ({ ...prev, [e]: { status: "ok", reason: null, suggestion: null, bounce: { ...p.bounce!, dead: p.bounce!.kind !== "transient" } } }));
    setQ(""); setHits([]); setOpen(false);
  }, [emails, onAdd]);

  // Domain completions show only when nobody in ClubOS matches — a real
  // family on file always comes first.
  const completions = hits.length === 0 && !busy ? completionsFor(q) : [];
  const rowCount = hits.length + completions.length;
  const complete = useCallback((address: string) => {
    const e = address.toLowerCase();
    if (!emails.includes(e)) onAdd(e);
    setQ(""); setHits([]); setOpen(false);
    void checkTyped(e);
  }, [emails, onAdd, checkTyped]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || rowCount === 0) {
      if (e.key === "Enter") { e.preventDefault(); addRaw(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, rowCount - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const p = hits[active];
      const c = completions[active - hits.length];
      // A complete typed address wins over anything highlighted — if it
      // looks like an email, that is what they meant. An unfinished one
      // ("dannyboy362" or "dannyboy362@g") takes the highlighted completion.
      const typedComplete = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q.trim());
      if (typedComplete) addRaw();
      else if (p) pick(p);
      else if (c) complete(c);
      else addRaw();
    }
  };

  const showList = open && (hits.length > 0 || (!busy && q.trim().length >= 2));
  const maxH = rect ? Math.max(160, Math.min(360, window.innerHeight - rect.top - 16)) : 320;

  const list = showList && rect ? createPortal(
    <div
      ref={listRef}
      style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, maxHeight: maxH }}
      className="z-[120] overflow-y-auto rounded-xl border border-blue-500/20 bg-[#0d1220] shadow-2xl"
      data-testid="list-recipient-results"
    >
      {hits.length === 0 && completions.length > 0 && (
        <div data-testid="list-domain-completions">
          <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-white/30">
            Nobody on file for “{q.trim()}” — finish the address
          </div>
          {completions.map((c, i) => {
            const at = c.indexOf("@");
            return (
              <button
                key={c}
                onMouseEnter={() => setActive(hits.length + i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => complete(c)}
                className={`w-full text-left px-3 py-2 text-[13px] border-b border-white/[0.04] last:border-0 transition-colors ${
                  hits.length + i === active ? "bg-blue-500/10" : "hover:bg-white/[0.03]"}`}
                data-testid={`option-complete-${c}`}
              >
                <span className="text-white/60">{c.slice(0, at)}</span>
                <span className="text-blue-300">{c.slice(at)}</span>
              </button>
            );
          })}
        </div>
      )}
      {hits.length === 0 && completions.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-white/35">
          Nobody found for “{q.trim()}”.
          {q.includes("@") && <> Press Enter to add it as a new address.</>}
        </div>
      ) : hits.map((p, i) => {
        const already = p.email && emails.includes(p.email.toLowerCase());
        const kind = kindOf(p.type);
        const title = p.name || (p.type === "sponsor" ? p.company : null) || p.email || "(no name)";
        return (
          <button
            key={p.key}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(p)}
            disabled={!p.email}
            className={`w-full text-left px-3 py-2 border-b border-white/[0.04] last:border-0 transition-colors ${
              !p.email ? "opacity-45 cursor-not-allowed"
                : i === active ? "bg-blue-500/10" : "hover:bg-white/[0.03]"}`}
            data-testid={`option-person-${p.contactId}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {p.type === "sponsor"
                ? <SponsorMark company={p.company ?? title} logoUrl={p.logoUrl ?? null} ground={p.logoGround} />
                : <span className={`w-2 h-2 rounded-full shrink-0 ${kind.dot}`} />}
              <div className="min-w-0 flex-1">
                {/* Line one: who they are. One strip, no wrapping, clipped. */}
                <div className="flex items-center gap-2 min-w-0 overflow-hidden whitespace-nowrap h-5">
                  <span className="text-[13px] text-white/90 truncate shrink min-w-[4rem]">{title}</span>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 shrink-0 ${kind.badge}`}>{kind.label}</Badge>
                  {p.type === "player" && p.ageGroup && (
                    <span className="text-[10px] px-1.5 h-4 rounded-full bg-emerald-500/10 text-emerald-300/90 shrink-0 flex items-center">{p.ageGroup}</span>
                  )}
                  {p.type === "sponsor" && p.company && p.name && (
                    <span className="text-[11px] text-amber-200/70 truncate">{p.company}{p.role ? ` · ${p.role}` : ""}</span>
                  )}
                  {p.type === "guardian" && p.children && p.children.length > 0 && (
                    <ChildChips children={p.children} />
                  )}
                  {already && <span className="text-[10px] text-emerald-400/70 shrink-0">added</span>}
                </div>
                {/* Line two: the address and whose it is. */}
                <div className="text-[11px] mt-0.5 min-w-0 truncate h-4 leading-4">
                  {p.email ? (
                    <>
                      <span className="text-blue-300/70">{p.email}</span>
                      {/* 🔴 Whose mailbox it is. A child's address is their parent's. */}
                      {p.emailOwner && <span className="text-white/35"> · via {p.emailOwner}</span>}
                      {p.type === "player" && !p.emailOwner && p.parentName && <span className="text-white/35"> · parent {p.parentName}</span>}
                      {p.bounce && <span className={p.bounce.kind === "transient" ? "text-amber-300/80" : "text-red-300/80"}> · {p.bounce.label}</span>}
                    </>
                  ) : (
                    <span className="text-amber-300/60 inline-flex items-center gap-1">
                      <UserX className="w-3 h-3" />{p.unreachable}
                    </span>
                  )}
                  {p.detail && <span className="text-white/25"> · {p.detail}</span>}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="space-y-3">
      <label className="text-xs text-white/40 uppercase tracking-wider">{label}</label>
      <div className="relative" ref={boxRef}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              onFocus={() => hits.length && setOpen(true)}
              onKeyDown={onKey}
              placeholder={placeholder ?? "Search a player, parent or sponsor, or type an email…"}
              className="premium-input text-white/80 w-full pl-9"
              data-testid="input-recipient-search"
              autoComplete="off"
            />
            {busy && <Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-white/30 animate-spin" />}
          </div>
          <Button onClick={addRaw} variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10" data-testid="button-add-email">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {list}
      </div>

      {emails.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {emails.map(email => {
            const f = flags[email];
            const bad = f && (f.status === "no_domain" || f.status === "bad_syntax" || f.bounce?.dead);
            const note = f?.bounce ? f.bounce.label : f?.reason;
            return (
              <Badge
                key={email}
                variant="outline"
                title={note ?? undefined}
                className={`gap-1 pr-1 ${bad ? "border-red-500/30 text-red-300 bg-red-500/5" : f ? "border-amber-500/30 text-amber-300 bg-amber-500/5" : "border-blue-500/20 text-blue-400 bg-blue-500/5"}`}
                data-testid={`chip-email-${email}`}
              >
                {email}
                {note && <span className="text-[10px] opacity-80 font-normal">· {f?.bounce ? note : bad ? "can't receive mail" : note}</span>}
                {f?.suggestion && (
                  <button
                    onClick={() => { onRemove(email); onAdd(f.suggestion!); setFlags(prev => { const n = { ...prev }; delete n[email]; return n; }); }}
                    className="ml-1 text-[10px] underline underline-offset-2 hover:text-white"
                    data-testid={`button-fix-${email}`}
                  >
                    Use it
                  </button>
                )}
                <button onClick={() => onRemove(email)} className="ml-1 hover:text-red-400" data-testid={`button-remove-${email}`}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
