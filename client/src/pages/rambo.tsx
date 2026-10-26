// ── Rambo — the club's own assistant, on his own page ────────────────────────
//
// Daniel, 2026-10-26 (night): "I want to make Rambo a separate thing on the
// side. It's at the top of every single workspace … I want that to look exactly
// like ChatGPT and Claude, where it has your different chats. You can have
// separate chats for different topics, you can label those chats."
//
// Left: your chats (new, search, rename, delete). Right: the conversation.
// Phone: the list is a drawer. A chat belongs to the person and follows them
// across workspaces; it remembers the workspace it was started in, so the
// club-data tools answer about the right organisation. Every question is one
// paid call against the person's daily allowance (set in Team), shown as
// "N of M today". /admin/rambo?q=… starts a chat with that question — the
// home dashboard's prompt box lands here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient, workspaceFetch } from "@/lib/queryClient";
import { useWorkspace } from "@/lib/workspace-context";
import { RAMBO_STARTERS } from "@shared/rambo-chat";
import { RamboMarkdown } from "@/components/rambo/markdown";

export const RAMBO_FACE = "/mailer/rambo.png";

interface Thread {
  id: number;
  title: string;
  workspaceSlug: string | null;
  brand: string;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
  messages?: number;
}
interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  sources?: { id: number; title: string; brand: string }[];
  createdAt: string;
  pending?: boolean;
  error?: boolean;
}
interface Usage {
  used: number;
  limit: number;
  model: string;
  enabled: boolean;
  name: string;
  firstName: string;
  canSee: { name: string; title: string }[];
  cannotSee: { name: string; title: string; requiredTab: string | null }[];
  people?: { userId: number | null; label: string; prompts: number; cents: number }[];
}

const THREADS_KEY = ["/api/admin/rambo/threads"] as const;
const USAGE_KEY = ["/api/admin/rambo/usage"] as const;

function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay) return d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

function speechRecognition(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

interface ThreadRowProps {
  t: Thread;
  active: boolean;
  otherWorkspace: boolean;
  renaming: boolean;
  renameText: string;
  confirmDelete: boolean;
  onOpen: () => void;
  onRenameText: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameStart: () => void;
  onDeleteAsk: () => void;
  onDeleteKeep: () => void;
  onDeleteYes: () => void;
}

/** One chat in the list. 🔴 Top-level on purpose: defined inside the page it
 *  was a new component every render, so the rename box remounted on each
 *  keystroke and typed letters landed out of order. */
function ThreadRow(p: ThreadRowProps) {
  const { t, active, otherWorkspace, renaming, renameText, confirmDelete } = p;
  return (
    <div className={`group relative rounded-lg ${active ? "bg-primary/10" : "hover:bg-muted"}`} data-testid="rambo-thread" data-active={active ? "1" : "0"}>
      {renaming ? (
        <form className="p-1.5" onSubmit={(e) => { e.preventDefault(); p.onRenameCommit(); }}>
          <input
            autoFocus
            value={renameText}
            onChange={(e) => p.onRenameText(e.target.value)}
            onBlur={p.onRenameCommit}
            onKeyDown={(e) => { if (e.key === "Escape") p.onRenameCancel(); }}
            className="w-full rounded-md border bg-background px-2 py-1 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            maxLength={80}
            aria-label="Chat name"
            data-testid="rambo-rename-input"
          />
        </form>
      ) : (
        <button type="button" onClick={p.onOpen} className="block w-full py-2 pl-2.5 pr-14 text-left" title={t.preview || t.title}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" data-testid="rambo-thread-title">{t.title}</span>
            <span className="shrink-0 text-[10.5px] text-muted-foreground">{when(t.updatedAt)}</span>
          </div>
          {(t.preview || otherWorkspace) && (
            <div className="mt-0.5 flex items-center gap-1.5">
              {otherWorkspace && <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t.workspaceSlug}</span>}
              <span className="truncate text-[11.5px] text-muted-foreground">{t.preview}</span>
            </div>
          )}
        </button>
      )}
      {!renaming && (
        <div className={`absolute right-1 top-1 flex gap-0.5 ${active ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
          {confirmDelete ? (
            <>
              <button type="button" className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white" onClick={p.onDeleteYes} data-testid="rambo-thread-delete-yes">Delete</button>
              <button type="button" className="rounded bg-muted px-1.5 py-0.5 text-[11px]" onClick={p.onDeleteKeep}>Keep</button>
            </>
          ) : (
            <>
              <button type="button" title="Rename" aria-label="Rename chat" className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={p.onRenameStart} data-testid="rambo-thread-menu-rename">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
              <button type="button" title="Delete" aria-label="Delete chat" className="rounded p-1 text-muted-foreground hover:bg-background hover:text-red-600" onClick={p.onDeleteAsk} data-testid="rambo-thread-menu-delete">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function RamboPage() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { currentOrg } = useWorkspace();
  const threadId = useMemo(() => {
    const m = /^\/admin\/rambo\/(\d+)/.exec(location);
    return m ? Number(m[1]) : null;
  }, [location]);
  const startWith = useMemo(() => new URLSearchParams(search).get("q")?.trim() || "", [search]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [showScopes, setShowScopes] = useState(false);
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const recRef = useRef<any>(null);
  const startedRef = useRef<string>("");

  const threadsQ = useQuery<{ threads: Thread[] }>({
    queryKey: THREADS_KEY,
    queryFn: async () => { const r = await workspaceFetch("/api/admin/rambo/threads"); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
  });
  const usageQ = useQuery<Usage>({
    queryKey: USAGE_KEY,
    queryFn: async () => { const r = await workspaceFetch("/api/admin/rambo/usage"); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
  });
  const threadQ = useQuery<{ thread: Thread; messages: Message[] }>({
    queryKey: ["/api/admin/rambo/threads", threadId],
    enabled: threadId != null,
    queryFn: async () => { const r = await workspaceFetch(`/api/admin/rambo/threads/${threadId}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
  });
  const threads = threadsQ.data?.threads ?? [];
  const usage = usageQ.data;
  const thread = threadQ.data?.thread ?? threads.find((t) => t.id === threadId) ?? null;

  // The server's messages are the truth once they load; anything optimistic
  // on top (a question in flight) is kept until the answer lands.
  useEffect(() => {
    if (threadId == null) { setMessages([]); return; }
    if (threadQ.data) setMessages((cur) => {
      const pending = cur.filter((m) => m.pending || m.error);
      return [...threadQ.data!.messages, ...pending.filter((p) => !threadQ.data!.messages.some((m) => m.role === p.role && m.content === p.content))];
    });
  }, [threadId, threadQ.data]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const capped = !!usage && usage.used >= usage.limit;
  const off = !!usage && !usage.enabled;
  const disabled = busy || capped || off;

  const toolTitle = useCallback((name: string) => {
    const all = [...(usage?.canSee ?? []), ...(usage?.cannotSee ?? [])];
    return all.find((t) => t.name === name)?.title ?? name;
  }, [usage]);

  const createThread = useCallback(async (): Promise<number> => {
    const r = await workspaceFetch("/api/admin/rambo/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!r.ok) throw new Error(`Couldn't start a chat (HTTP ${r.status}).`);
    const data = await r.json();
    queryClient.invalidateQueries({ queryKey: THREADS_KEY });
    return Number(data.thread.id);
  }, []);

  const ask = useCallback(async (text: string, intoThread?: number | null) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    let id = intoThread ?? threadId;
    try {
      if (id == null) {
        id = await createThread();
        navigate(`/admin/rambo/${id}`, { replace: true });
      }
      setMessages((m) => [...m, { id: -Date.now(), role: "user", content: question, createdAt: new Date().toISOString(), pending: true }]);
      const r = await workspaceFetch(`/api/admin/rambo/threads/${id}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const raw = (await r.text()).trim();
      let data: any;
      try { data = JSON.parse(raw); } catch { data = { ok: false, message: raw.slice(0, 200) || `HTTP ${r.status}` }; }
      if (data?.ok) {
        setMessages((m) => [...m.map((x) => ({ ...x, pending: false })), { ...data.message, createdAt: data.message.createdAt ?? new Date().toISOString() }]);
        queryClient.setQueryData(USAGE_KEY, (u: any) => (u ? { ...u, used: data.usage.used, limit: data.usage.limit } : u));
      } else {
        setMessages((m) => [...m.map((x) => ({ ...x, pending: false })), { id: -Date.now() - 1, role: "assistant", content: data?.message || "Rambo couldn't answer that.", createdAt: new Date().toISOString(), error: true }]);
        if (data?.usage) queryClient.setQueryData(USAGE_KEY, (u: any) => (u ? { ...u, used: data.usage.used, limit: data.usage.limit } : u));
      }
      queryClient.invalidateQueries({ queryKey: THREADS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rambo/threads", id] });
    } catch (e) {
      setMessages((m) => [...m, { id: -Date.now() - 2, role: "assistant", content: e instanceof Error ? e.message : "Something went wrong.", createdAt: new Date().toISOString(), error: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => boxRef.current?.focus(), 0);
    }
  }, [busy, createThread, navigate, threadId]);

  // /admin/rambo?q=… — the home dashboard's box lands here with a question.
  useEffect(() => {
    if (!startWith || startedRef.current === startWith || threadId != null) return;
    startedRef.current = startWith;
    void ask(startWith, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith, threadId]);

  const newChat = useCallback(() => {
    setMessages([]);
    setListOpen(false);
    navigate("/admin/rambo");
    setTimeout(() => boxRef.current?.focus(), 0);
  }, [navigate]);

  const rename = useCallback(async (id: number, title: string) => {
    setRenaming(null);
    const r = await workspaceFetch(`/api/admin/rambo/threads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (r.ok) {
      queryClient.invalidateQueries({ queryKey: THREADS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rambo/threads", id] });
    }
  }, []);

  const remove = useCallback(async (id: number) => {
    setConfirmDelete(null);
    const r = await workspaceFetch(`/api/admin/rambo/threads/${id}`, { method: "DELETE" });
    if (r.ok) {
      queryClient.invalidateQueries({ queryKey: THREADS_KEY });
      if (id === threadId) newChat();
    }
  }, [newChat, threadId]);

  const toggleMic = useCallback(() => {
    const SR = speechRecognition();
    if (!SR) return;
    if (recRef.current) { recRef.current.stop(); recRef.current = null; setListening(false); return; }
    const rec = new SR();
    rec.lang = "en-NZ";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev: any) => {
      const said = Array.from(ev.results).map((r: any) => r[0]?.transcript ?? "").join(" ").trim();
      if (said) setInput((v) => (v ? `${v} ${said}` : said));
    };
    rec.onend = () => { recRef.current = null; setListening(false); boxRef.current?.focus(); };
    rec.onerror = () => { recRef.current = null; setListening(false); };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { recRef.current = null; setListening(false); }
  }, []);

  const visibleThreads = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? threads.filter((t) => (t.title || "").toLowerCase().includes(f) || (t.preview || "").toLowerCase().includes(f)) : threads;
  }, [threads, filter]);

  const groups = useMemo(() => {
    const now = new Date();
    const key = (iso: string) => {
      const d = new Date(iso);
      if (d.toDateString() === now.toDateString()) return "Today";
      const y = new Date(now); y.setDate(now.getDate() - 1);
      if (d.toDateString() === y.toDateString()) return "Yesterday";
      if (now.getTime() - d.getTime() < 7 * 86400000) return "This week";
      return "Earlier";
    };
    const out: { label: string; items: Thread[] }[] = [];
    for (const t of visibleThreads) {
      const k = key(t.updatedAt);
      let g = out.find((x) => x.label === k);
      if (!g) { g = { label: k, items: [] }; out.push(g); }
      g.items.push(t);
    }
    return out;
  }, [visibleThreads]);

  const firstName = usage?.firstName || "";
  const micAvailable = !!speechRecognition();

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 p-3">
        <button
          type="button"
          onClick={newChat}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
          data-testid="rambo-new-chat"
        >
          <span className="text-lg leading-none">+</span> New chat
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search your chats"
          className="h-9 w-full rounded-lg border bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          aria-label="Search chats"
          data-testid="rambo-thread-filter"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-testid="rambo-thread-list">
        {threadsQ.isLoading ? (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">Loading your chats…</p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">{filter ? "No chat matches that." : "No chats yet. Ask Rambo something and it will appear here."}</p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
              <div className="space-y-0.5">
                {g.items.map((t) => (
                  <ThreadRow
                    key={t.id}
                    t={t}
                    active={t.id === threadId}
                    otherWorkspace={!!(t.workspaceSlug && currentOrg?.slug && t.workspaceSlug !== currentOrg.slug)}
                    renaming={renaming === t.id}
                    renameText={renameText}
                    confirmDelete={confirmDelete === t.id}
                    onOpen={() => { navigate(`/admin/rambo/${t.id}`); setListOpen(false); }}
                    onRenameText={setRenameText}
                    onRenameCommit={() => void rename(t.id, renameText)}
                    onRenameCancel={() => setRenaming(null)}
                    onRenameStart={() => { setRenaming(t.id); setRenameText(t.title); }}
                    onDeleteAsk={() => setConfirmDelete(t.id)}
                    onDeleteKeep={() => setConfirmDelete(null)}
                    onDeleteYes={() => void remove(t.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] w-full overflow-hidden" data-testid="rambo-page">
      {/* Chats — a column on a laptop, a drawer on a phone. */}
      <aside className="hidden w-[280px] shrink-0 border-r bg-muted/30 md:block">{list}</aside>
      {listOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="h-full w-[82vw] max-w-[320px] bg-background shadow-xl" data-testid="rambo-thread-drawer">{list}</div>
          <button type="button" className="flex-1 bg-black/30" aria-label="Close chats" onClick={() => setListOpen(false)} />
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:px-5">
          <button type="button" className="mr-1 inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted md:hidden" aria-label="Your chats" onClick={() => setListOpen(true)} data-testid="rambo-chats-toggle">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <img src={RAMBO_FACE} alt="" className="h-8 w-8 object-contain" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">
              Rambo{thread ? <span className="font-normal text-muted-foreground"> · {thread.title}</span> : null}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">The club's own assistant{currentOrg?.name ? ` · ${currentOrg.name}` : ""}</p>
          </div>
          {usage && (
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground" title="Questions you've asked Rambo today, across the Mailer and here" data-testid="rambo-usage">
              {usage.used} of {usage.limit} today
            </span>
          )}
          <button type="button" onClick={() => setShowScopes((v) => !v)} className="hidden shrink-0 text-[11px] text-muted-foreground underline sm:inline" data-testid="rambo-cansee-toggle">
            What can Rambo see?
          </button>
        </header>

        {showScopes && usage && (
          <div className="shrink-0 border-b bg-muted/30 px-5 py-3 text-[12px]" data-testid="rambo-cansee">
            <p className="mb-1 text-muted-foreground">Rambo can only tell you what you could already find yourself in ClubOS. Your access decides this.</p>
            <p><span className="font-medium">Can see:</span> {usage.canSee.map((t) => t.title).join(" · ")}</p>
            {usage.cannotSee.length > 0 && <p className="text-muted-foreground"><span className="font-medium">Can't see for you:</span> {usage.cannotSee.map((t) => t.title).join(" · ")}</p>}
            {usage.people && (
              <details className="mt-2">
                <summary className="cursor-pointer font-medium">Usage this month, everyone ({usage.model})</summary>
                <table className="mt-1 w-full max-w-md">
                  <tbody>
                    {usage.people.map((p) => (
                      <tr key={`${p.userId}-${p.label}`}><td className="py-0.5 pr-3">{p.label}</td><td className="py-0.5 pr-3 text-right tabular-nums">{p.prompts} prompt{p.prompts === 1 ? "" : "s"}</td><td className="py-0.5 text-right tabular-nums text-muted-foreground">US${(p.cents / 100).toFixed(2)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" data-testid="rambo-messages">
          {messages.length === 0 && !busy ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center pt-6 text-center sm:pt-14">
              <img src={RAMBO_FACE} alt="" className="h-20 w-20 object-contain" />
              <h2 className="mt-3 text-xl font-semibold tracking-tight">{firstName ? `Hi ${firstName}. ` : ""}What do you want to know?</h2>
              <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
                Rambo answers from the club's own records and the knowledge base. Numbers come straight from ClubOS; paid and confirmed only.
              </p>
              <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                {RAMBO_STARTERS.map((s) => (
                  <button key={s} type="button" disabled={disabled} onClick={() => void ask(s)} className="rounded-xl border bg-background px-3 py-2.5 text-left text-[13px] hover:bg-muted disabled:opacity-50" data-testid="rambo-starter">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14px] text-primary-foreground" data-testid="rambo-message-user">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-3">
                    <img src={RAMBO_FACE} alt="" className="mt-0.5 h-7 w-7 shrink-0 object-contain" />
                    <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-md border px-4 py-3 ${m.error ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-background"}`} data-testid={m.error ? "rambo-error" : "rambo-message-assistant"}>
                      <RamboMarkdown text={m.content} />
                      {((m.sources?.length ?? 0) > 0 || (m.toolsUsed?.length ?? 0) > 0) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {(m.toolsUsed?.length ?? 0) > 0 && <span>Looked at: {Array.from(new Set(m.toolsUsed!)).map(toolTitle).join(", ")}</span>}
                          {(m.sources ?? []).slice(0, 4).map((s) => (
                            <a key={s.id} href={`/admin/knowledge-base?article=${s.id}`} className="rounded-full border px-2 py-0.5 hover:bg-muted">{s.title}</a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
              {busy && (
                <div className="flex gap-3" data-testid="rambo-busy">
                  <img src={RAMBO_FACE} alt="" className="mt-0.5 h-7 w-7 shrink-0 animate-pulse object-contain" />
                  <div className="rounded-2xl rounded-tl-md border bg-background px-4 py-3 text-[13px] text-muted-foreground">
                    <span className="animate-pulse">Rambo is looking…</span> <span className="text-[11px]">a numbers question can take a few seconds</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-background px-3 py-3 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {off && <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">Rambo isn't switched on for this server yet.</p>}
            {capped && !off && (
              <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-testid="rambo-capped">
                {usage!.limit === 0
                  ? "Rambo is switched off for your account. A super admin can turn it on in Team."
                  : `You've used today's ${usage!.limit} prompt${usage!.limit === 1 ? "" : "s"}. It resets at midnight, or a super admin can raise your limit in Team.`}
              </p>
            )}
            <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/30">
              <textarea
                ref={boxRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
                rows={Math.min(6, Math.max(1, input.split("\n").length))}
                disabled={disabled}
                placeholder={disabled ? "" : "Ask Rambo anything about the club…"}
                className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[14px] focus:outline-none disabled:opacity-60"
                aria-label="Ask Rambo"
                data-testid="rambo-input"
              />
              {micAvailable && (
                <button type="button" onClick={toggleMic} disabled={disabled} title={listening ? "Stop listening" : "Say it instead"} aria-label="Dictate" className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${listening ? "bg-red-600 text-white" : "text-muted-foreground hover:bg-muted"}`} data-testid="rambo-mic">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
                </button>
              )}
              <button type="button" onClick={() => void ask(input)} disabled={disabled || !input.trim()} className="inline-flex h-11 shrink-0 items-center rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50" data-testid="rambo-send">
                {busy ? "Working…" : "Send"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line{micAvailable ? " · the mic dictates into the box" : ""} · each question is a small paid call on the club's account</p>
          </div>
        </div>
      </section>
    </div>
  );
}
