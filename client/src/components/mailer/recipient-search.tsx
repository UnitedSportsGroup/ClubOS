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
// 🔴 TYPING A WHOLE ADDRESS STILL WORKS. Enter adds it as-is — the search is an
// addition to free entry, never a replacement for it.
import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X, Search, Loader2, UserX } from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";

type PersonHit = {
  key: string; contactId: number; name: string; type: string;
  email: string | null; emailOwner: string | null; unreachable: string | null; detail: string | null;
};

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

  useEffect(() => {
    const away = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const addRaw = useCallback(() => {
    const e = q.trim().toLowerCase();
    if (e.includes("@") && !emails.includes(e)) { onAdd(e); setQ(""); setHits([]); setOpen(false); }
  }, [q, emails, onAdd]);

  const pick = useCallback((p: PersonHit) => {
    if (!p.email) return;                       // unreachable rows are not selectable
    const e = p.email.toLowerCase();
    if (!emails.includes(e)) onAdd(e);
    setQ(""); setHits([]); setOpen(false);
  }, [emails, onAdd]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || hits.length === 0) {
      if (e.key === "Enter") { e.preventDefault(); addRaw(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const p = hits[active];
      // A typed address wins over a highlighted person — if it looks like an
      // email, that is what they meant.
      if (q.includes("@")) addRaw();
      else if (p) pick(p);
    }
  };

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
              placeholder={placeholder ?? "Search a player or parent, or type an email…"}
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

        {open && (hits.length > 0 || (!busy && q.trim().length >= 2)) && (
          <div className="absolute z-50 mt-1 w-full max-h-[320px] overflow-y-auto rounded-xl border border-blue-500/20 bg-[#0d1220] shadow-xl" data-testid="list-recipient-results">
            {hits.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-white/35">
                Nobody found for “{q.trim()}”.
                {q.includes("@") && <> Press Enter to add it as a new address.</>}
              </div>
            ) : hits.map((p, i) => {
              const already = p.email && emails.includes(p.email.toLowerCase());
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
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] text-white/90 truncate">{p.name}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-white/10 text-white/35 shrink-0 capitalize">{p.type}</Badge>
                    {already && <span className="text-[10px] text-emerald-400/70 shrink-0">added</span>}
                  </div>
                  <div className="text-[11px] mt-0.5 min-w-0 truncate">
                    {p.email ? (
                      <>
                        <span className="text-blue-300/70">{p.email}</span>
                        {/* 🔴 Whose mailbox it is. A child's address is their parent's. */}
                        {p.emailOwner && <span className="text-white/35"> · via {p.emailOwner}</span>}
                      </>
                    ) : (
                      <span className="text-amber-300/60 flex items-center gap-1">
                        <UserX className="w-3 h-3" />{p.unreachable}
                      </span>
                    )}
                    {p.detail && <span className="text-white/25"> · {p.detail}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {emails.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {emails.map(email => (
            <Badge key={email} variant="outline" className="border-blue-500/20 text-blue-400 bg-blue-500/5 gap-1 pr-1">
              {email}
              <button onClick={() => onRemove(email)} className="ml-1 hover:text-red-400" data-testid={`button-remove-${email}`}>
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
