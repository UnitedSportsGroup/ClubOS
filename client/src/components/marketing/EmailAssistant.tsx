// ── The Mailer's assistant — a chat box in the builder's right panel ─────────
//
// Daniel, 2026-10-26: "add an option to this builder to also make it agentic
// like chatbox type so i can prompt it to make it modern and easier and make it
// way faster to create what I want".
//
// Type what you want; the design on the canvas changes. Every answer that
// changed the design carries an Undo that puts back exactly what was there.
// The count under the box is real: each prompt is a paid API call, and the
// server refuses past the person's daily cap (set in Team).
//
// Rendered by EmailBuilder through a portal INTO the GrapesJS shell's Ask pane,
// so it sits beside Style / Settings / Layers and keeps its conversation while
// the person switches tabs.

import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceFetch } from "@/lib/queryClient";
import type { MailerAiFailure, MailerAiReply } from "@shared/mailer-ai";

interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** The design before this answer changed it — present only when it did. */
  before?: string;
  /** The design this answer produced. */
  after?: string;
  undone?: boolean;
  error?: boolean;
}

interface UsageInfo {
  used: number;
  limit: number;
  model: string;
  enabled: boolean;
  people?: { userId: number | null; label: string; prompts: number; changes: number; cents: number }[];
}

export interface EmailAssistantProps {
  brandKey: string;
  /** The design as MJML right now (text edits finished). */
  getMjml: () => Promise<string>;
  /** Put this MJML on the canvas. */
  applyMjml: (mjml: string) => void;
}

const STARTERS = [
  "Make it look more modern",
  "Tighten the copy and make it warmer",
  "Add a Register now button under the photo",
  "Make the headline bigger and the photo full width",
];

let nextId = 1;

export default function EmailAssistant({ brandKey, getMjml, applyMjml }: EmailAssistantProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  const refreshUsage = useCallback(async () => {
    try {
      const r = await workspaceFetch("/api/admin/mailer/ai/usage");
      if (r.ok) setUsage((await r.json()) as UsageInfo);
    } catch { /* the count is a courtesy */ }
  }, []);
  useEffect(() => { void refreshUsage(); }, [refreshUsage]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const capped = !!usage && usage.used >= usage.limit;
  const off = !!usage && !usage.enabled;

  const send = useCallback(
    async (text: string) => {
      const instruction = text.trim();
      if (!instruction || busy) return;
      setInput("");
      setBusy(true);
      const userTurn: Turn = { id: nextId++, role: "user", text: instruction };
      setTurns((t) => [...t, userTurn]);
      let before = "";
      try {
        before = await getMjml();
        const history = turns
          .filter((t) => !t.error)
          .slice(-8)
          .map((t) => ({ role: t.role, content: t.text }));
        const r = await workspaceFetch("/api/admin/mailer/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandKey, mjml: before, instruction, history }),
        });
        // The server keeps the line open with whitespace while it waits —
        // JSON.parse skips it.
        const raw = (await r.text()).trim();
        let data: MailerAiReply | MailerAiFailure | { message?: string };
        try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 200) || `HTTP ${r.status}` }; }
        if ("ok" in data && data.ok) {
          if (data.changed && data.mjml) applyMjml(data.mjml);
          setTurns((t) => [
            ...t,
            { id: nextId++, role: "assistant", text: data.reply, ...(data.changed && data.mjml ? { before, after: data.mjml } : {}) },
          ]);
          setUsage((u) => (u ? { ...u, used: data.usage.used, limit: data.usage.limit } : u));
        } else {
          const msg = (data as any).message || "Rambo couldn't answer that.";
          setTurns((t) => [...t, { id: nextId++, role: "assistant", text: msg, error: true }]);
          const u = (data as any).usage;
          if (u) setUsage((prev) => (prev ? { ...prev, used: u.used, limit: u.limit } : prev));
        }
      } catch (e) {
        setTurns((t) => [...t, { id: nextId++, role: "assistant", text: e instanceof Error ? e.message : "Something went wrong.", error: true }]);
      } finally {
        setBusy(false);
        setTimeout(() => boxRef.current?.focus(), 0);
      }
    },
    [applyMjml, brandKey, busy, getMjml, turns],
  );

  const undo = useCallback(
    (turn: Turn) => {
      if (!turn.before) return;
      applyMjml(turn.before);
      setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, undone: true } : x)));
    },
    [applyMjml],
  );
  const redo = useCallback(
    (turn: Turn) => {
      if (!turn.after) return;
      applyMjml(turn.after);
      setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, undone: false } : x)));
    },
    [applyMjml],
  );

  const disabled = busy || capped || off;

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]" data-testid="mailer-assistant">
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-semibold">
            <img src="/mailer/rambo.png" alt="" className="h-6 w-6 object-contain" />
            Rambo
          </p>
          {usage && (
            <span className="text-[11px] text-muted-foreground" data-testid="mailer-assistant-usage">
              {usage.used} of {usage.limit} today
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          Tell Rambo what to change and it changes on the canvas. Every change has an Undo.
        </p>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="mailer-assistant-turns">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Try one of these</p>
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => void send(s)}
                className="block w-full rounded-lg border bg-background px-3 py-2 text-left text-[13px] hover:bg-muted disabled:opacity-50"
                data-testid="mailer-assistant-starter"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-3">
          {turns.map((t) =>
            t.role === "user" ? (
              <div key={t.id} className="ml-6 rounded-xl bg-primary px-3 py-2 text-primary-foreground" data-testid="mailer-assistant-user">
                {t.text}
              </div>
            ) : (
              <div
                key={t.id}
                className={`mr-6 rounded-xl border px-3 py-2 ${t.error ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-background"}`}
                data-testid={t.error ? "mailer-assistant-error" : "mailer-assistant-reply"}
              >
                <p className="whitespace-pre-wrap leading-snug">{t.text}</p>
                {t.before && (
                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    <span className={`rounded-full px-2 py-0.5 ${t.undone ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-800"}`}>
                      {t.undone ? "Undone" : "Changed the design"}
                    </span>
                    {t.undone ? (
                      <button type="button" className="font-medium underline" onClick={() => redo(t)} data-testid="mailer-assistant-redo">
                        Put it back
                      </button>
                    ) : (
                      <button type="button" className="font-medium underline" onClick={() => undo(t)} data-testid="mailer-assistant-undo">
                        Undo
                      </button>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
          {busy && (
            <div className="mr-6 rounded-xl border bg-background px-3 py-2 text-muted-foreground" data-testid="mailer-assistant-busy">
              <span className="inline-block animate-pulse">Working on it…</span>
              <span className="ml-1 text-[11px]">a big change can take up to a minute</span>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t px-3 py-2">
        {off && (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">
            Rambo isn't switched on for this server yet.
          </p>
        )}
        {capped && !off && (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900" data-testid="mailer-assistant-capped">
            {usage!.limit === 0
              ? "Rambo is switched off for your account. A super admin can turn it on in Team."
              : `You've used today's ${usage!.limit} prompt${usage!.limit === 1 ? "" : "s"}. It resets at midnight, or a super admin can raise your limit in Team.`}
          </p>
        )}
        <textarea
          ref={boxRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={3}
          disabled={disabled}
          placeholder={disabled ? "" : "e.g. Put the CUGC crest beside ours in the header and make both a bit bigger"}
          className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          data-testid="mailer-assistant-input"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            Enter to send · Shift+Enter for a new line
            {usage?.people && (
              <>
                {" · "}
                <button type="button" className="underline" onClick={() => setShowPeople((v) => !v)} data-testid="mailer-assistant-people-toggle">
                  {showPeople ? "Hide usage" : "Usage this month"}
                </button>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={disabled || !input.trim()}
            className="h-9 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            data-testid="mailer-assistant-send"
          >
            {busy ? "Working…" : "Send"}
          </button>
        </div>
        {showPeople && usage?.people && (
          <div className="mt-2 rounded-lg border bg-muted/30 p-2 text-[11px]" data-testid="mailer-assistant-people">
            <p className="mb-1 font-semibold">This month, this workspace ({usage.model})</p>
            {usage.people.length === 0 ? (
              <p className="text-muted-foreground">Nobody has used it yet.</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {usage.people.map((p) => (
                    <tr key={`${p.userId}-${p.label}`}>
                      <td className="py-0.5 pr-2">{p.label}</td>
                      <td className="py-0.5 pr-2 text-right tabular-nums">{p.prompts} prompt{p.prompts === 1 ? "" : "s"}</td>
                      <td className="py-0.5 text-right tabular-nums text-muted-foreground">US${(p.cents / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
