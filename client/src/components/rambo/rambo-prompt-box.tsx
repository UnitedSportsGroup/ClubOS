// ── The home dashboard's Rambo box — Shopify's Sidekick, ours ────────────────
//
// Daniel, 2026-10-26 (night), with Shopify's home open: "I'm on the home page,
// and I can instantly be like, 'Hey, hey, Rambo … tell me how many under-4 to
// 8s I have right now.' … Keep the dashboard we have now in terms of the stats
// … but also add this component to that homepage."
//
// Type (or dictate) a question here and you land on Rambo's page with the
// answer. Recents lists your last chats. The stats stay below, untouched.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { useWorkspace } from "@/lib/workspace-context";
import { RAMBO_STARTERS } from "@shared/rambo-chat";

const FACE = "/mailer/rambo.png";

interface Thread { id: number; title: string; updatedAt: string }

function speechRecognition(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function RamboPromptBox() {
  const [, navigate] = useLocation();
  const { currentOrg } = useWorkspace();
  const [text, setText] = useState("");
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const usage = useQuery<{ firstName?: string; enabled: boolean; used: number; limit: number }>({
    queryKey: ["/api/admin/rambo/usage"],
    queryFn: async () => { const r = await workspaceFetch("/api/admin/rambo/usage"); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
    staleTime: 60_000,
  });
  const threads = useQuery<{ threads: Thread[] }>({
    queryKey: ["/api/admin/rambo/threads"],
    queryFn: async () => { const r = await workspaceFetch("/api/admin/rambo/threads"); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!recentsOpen) return;
    const close = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setRecentsOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [recentsOpen]);

  const go = useCallback((q: string) => {
    const question = q.trim();
    if (!question) return;
    navigate(`/admin/rambo?q=${encodeURIComponent(question)}`);
  }, [navigate]);

  const toggleMic = useCallback(() => {
    const SR = speechRecognition();
    if (!SR) return;
    if (recRef.current) { recRef.current.stop(); recRef.current = null; setListening(false); return; }
    const rec = new SR();
    rec.lang = "en-NZ";
    rec.onresult = (ev: any) => {
      const said = Array.from(ev.results).map((r: any) => r[0]?.transcript ?? "").join(" ").trim();
      if (said) setText((v) => (v ? `${v} ${said}` : said));
    };
    rec.onend = () => { recRef.current = null; setListening(false); };
    rec.onerror = () => { recRef.current = null; setListening(false); };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { recRef.current = null; setListening(false); }
  }, []);

  const firstName = usage.data?.firstName || "";
  const recents = (threads.data?.threads ?? []).slice(0, 6);
  const micAvailable = !!speechRecognition();

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/[0.06] via-background to-background p-5 sm:p-6" data-testid="rambo-home-prompt">
      <div className="mb-3 flex items-center gap-3">
        <img src={FACE} alt="" className="h-10 w-10 object-contain" />
        <div>
          <p className="text-[17px] font-semibold tracking-tight">{firstName ? `Hey ${firstName}.` : "Hey there."} What do you want to know?</p>
          <p className="text-[12.5px] text-muted-foreground">Ask Rambo about {currentOrg?.name ?? "the club"} — registrations, who has paid, ages, camps, or how we do things.</p>
        </div>
      </div>
      <form
        ref={wrapRef as any}
        onSubmit={(e) => { e.preventDefault(); go(text); }}
        className="relative flex items-center gap-2 rounded-xl border bg-background p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-primary/30"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. How many U4–U8 players do we have this term?"
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[14px] focus:outline-none"
          aria-label="Ask Rambo"
          data-testid="rambo-home-input"
        />
        {recents.length > 0 && (
          <div className="relative">
            <button type="button" onClick={() => setRecentsOpen((v) => !v)} className="hidden h-11 items-center gap-1 rounded-lg px-3 text-[12.5px] text-muted-foreground hover:bg-muted sm:inline-flex" data-testid="rambo-home-recents">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              Recents
            </button>
            {recentsOpen && (
              <div className="absolute right-0 top-12 z-20 w-72 rounded-xl border bg-background p-1.5 shadow-lg" data-testid="rambo-home-recents-list">
                {recents.map((t) => (
                  <button key={t.id} type="button" onClick={() => navigate(`/admin/rambo/${t.id}`)} className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-muted">{t.title}</button>
                ))}
                <button type="button" onClick={() => navigate("/admin/rambo")} className="mt-1 block w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-muted-foreground hover:bg-muted">All chats →</button>
              </div>
            )}
          </div>
        )}
        {micAvailable && (
          <button type="button" onClick={toggleMic} title={listening ? "Stop listening" : "Say it instead"} aria-label="Dictate" className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${listening ? "bg-red-600 text-white" : "text-muted-foreground hover:bg-muted"}`} data-testid="rambo-home-mic">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
          </button>
        )}
        <button type="submit" disabled={!text.trim()} className="inline-flex h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50" data-testid="rambo-home-send">
          Ask
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {RAMBO_STARTERS.slice(0, 4).map((s) => (
          <button key={s} type="button" onClick={() => go(s)} className="rounded-full border bg-background px-3 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="rambo-home-starter">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
