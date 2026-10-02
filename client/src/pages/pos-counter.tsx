// The COUNTER SCREEN — what the customer sees on the Stripe S710 at the office.
//
// This page is the whole screen of apps/clubos-counter (our Apps on Devices
// app). The native shell adds one thing a web page cannot do — take a card —
// through window.ClubOSCounter. In an ordinary browser the page still runs, so
// it can be looked at and tested; it just says the card part needs the reader.
//
// Screens, all decided by the server (GET /api/public/pos/counter/state):
//   pair  — a 6-character code a staff member types into the till
//   idle  — the club: crests, kit with photographs, what's open
//   cart  — the sale as the till builds it, with photos, live
//   pay   — the card prompt (Stripe's own screen takes over on top of us)
//   paid  — thank you, and a receipt by email on our own keyboard
//
// 🔴 The page decides nothing about money. It shows what the server sends, and
// it can only claim a card prompt for a payment the TILL created.
// 🔴 The S700/S710 screen is ~360×640 CSS px, portrait. Every control here is
// at least 56px tall: a customer is standing, often with a child on one arm.
// 🔴 No input asks for a card number or PIN, ever — Stripe's review rule, and
// the reason the card step belongs to Stripe's own screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CounterState } from "@shared/pos-counter";

// ── The native bridge (present only inside apps/clubos-counter) ─────────────
interface NativeBridge {
  info(): string;
  collect(paymentId: string, clientSecret: string): void;
  cancelCollect(): void;
  openSettings(): void;
  setToken(token: string): void;
  reload(): void;
}
const nativeBridge = (): NativeBridge | null => (typeof window !== "undefined" && (window as any).ClubOSCounter) || null;
interface NativeInfo { nativeVersion?: string; readerId?: string; readerStatus?: string; collecting?: string | null }
function readNativeInfo(): NativeInfo {
  try { const n = nativeBridge(); return n ? JSON.parse(n.info()) : {}; } catch { return {}; }
}
const APP_VERSION = "web-1";

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
const $whole = (c: number) => (c % 100 === 0 ? `$${c / 100}` : $(c));

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "include", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data?.message || `HTTP ${res.status}`), { status: res.status, data });
  return data as T;
}
function remoteLog(level: string, message: string, meta?: unknown) {
  fetch("/api/public/pos/counter/log", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level, message, meta }) }).catch(() => {});
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function PosCounter() {
  const [state, setState] = useState<CounterState | null>(null);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const hasNative = !!nativeBridge();
  const startedRef = useRef(false);

  // Start (or resume) — mints this screen's identity the first time.
  const start = useCallback(async () => {
    try {
      const s = await api<CounterState>("POST", "/api/public/pos/counter/start", {});
      if (s.token) { try { nativeBridge()?.setToken(s.token); } catch { /* old shell */ } }
      setState(s); setFatal(null);
    } catch (e: any) {
      setFatal(e?.message || "Can't reach ClubOS.");
    }
  }, []);
  useEffect(() => { if (!startedRef.current) { startedRef.current = true; start(); } }, [start]);

  // Poll. Once a second is plenty for one screen; the till's own updates are
  // debounced at 350ms so the customer sees an item land almost at once.
  useEffect(() => {
    if (!state) return;
    let stop = false;
    const tick = async () => {
      const ni = readNativeInfo();
      const qs = new URLSearchParams({ v: APP_VERSION });
      if (ni.nativeVersion) qs.set("nv", ni.nativeVersion);
      if (ni.readerId) qs.set("reader", ni.readerId);
      if (ni.readerStatus) qs.set("rs", ni.readerStatus);
      try {
        const s = await api<CounterState>("GET", `/api/public/pos/counter/state?${qs}`);
        if (stop) return;
        setState(s); setOfflineSince(null);
      } catch (e: any) {
        if (stop) return;
        if (e?.status === 401) { startedRef.current = false; start(); return; }
        setOfflineSince((t) => t ?? Date.now());
      }
    };
    const t = setInterval(tick, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [!!state, start]);

  // Native → page: the card prompt ended. The native shell has ALREADY told the
  // server (so a page reload mid-payment loses nothing); this only updates us.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      if (d.type === "card_result") setCollecting(null);
    };
    window.addEventListener("clubos-counter", on);
    return () => window.removeEventListener("clubos-counter", on);
  }, []);

  // The till asked for a card: claim the prompt and hand it to the reader.
  const charge = state?.screen === "pay" ? state.charge : null;
  const claim = useCallback(async (retry: boolean) => {
    if (!charge || !hasNative) return;
    setClaimError(null);
    try {
      const r = await api<{ paymentId: number; clientSecret: string }>("POST", `/api/public/pos/counter/payments/${charge.paymentId}/claim`, { retry });
      setCollecting(r.paymentId);
      nativeBridge()!.collect(String(r.paymentId), r.clientSecret);
    } catch (e: any) {
      if (e?.data?.code !== "COUNTER_CLAIMED") { setClaimError(e?.message || "Couldn't start the card payment."); remoteLog("error", `claim failed: ${e?.message}`, { paymentId: charge.paymentId }); }
    }
  }, [charge?.paymentId, hasNative]);
  useEffect(() => {
    if (charge && !charge.claimed && !charge.lastError && collecting !== charge.paymentId && hasNative) claim(false);
  }, [charge?.paymentId, charge?.claimed, charge?.lastError]);
  // Staff cancelled at the till while the prompt was up: take it down.
  useEffect(() => {
    if (collecting && (!charge || charge.paymentId !== collecting)) {
      try { nativeBridge()?.cancelCollect(); } catch { /* ignore */ }
      setCollecting(null);
    }
  }, [charge?.paymentId, collecting]);

  // Hidden door to the reader's own settings (Wi-Fi, updates): five taps in the
  // top-right corner within three seconds. The reader asks for its admin PIN.
  const taps = useRef<number[]>([]);
  const cornerTap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) { taps.current = []; try { nativeBridge()?.openSettings(); } catch { /* browser */ } }
  };

  const offline = offlineSince != null && Date.now() - offlineSince > 4000;

  return (
    <div className="counter-root fixed inset-0 overflow-hidden select-none bg-[#07090c] text-white" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", WebkitTapHighlightColor: "transparent" }} data-testid="pos-counter">
      <style>{COUNTER_CSS}</style>
      <button aria-label="Reader settings" onClick={cornerTap} className="absolute right-0 top-0 z-50 h-16 w-16 opacity-0" />
      {fatal && !state ? <Problem message={fatal} onRetry={start} />
        : !state ? <Boot />
        : state.screen === "pair" ? <PairScreen state={state} hasNative={hasNative} />
        : state.screen === "cart" ? <CartScreen state={state} />
        : state.screen === "pay" ? <PayScreen state={state} hasNative={hasNative} collecting={collecting === state.charge?.paymentId} claimError={claimError} onRetry={() => claim(true)} />
        : state.screen === "paid" ? <PaidScreen key={state.sale?.id} state={state} />
        : <IdleScreen state={state} />}
      {offline && (
        <div className="absolute inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 bg-amber-500 py-2 text-[13px] font-semibold text-black">
          <span className="counter-pulse inline-block h-2 w-2 rounded-full bg-black" /> Reconnecting to ClubOS…
        </div>
      )}
    </div>
  );
}

const COUNTER_CSS = `
.counter-root * { box-sizing: border-box; }
@keyframes counterFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.counter-in { animation: counterFade .35s cubic-bezier(.2,.7,.2,1) both; }
@keyframes counterPulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
.counter-pulse { animation: counterPulse 1.2s ease-in-out infinite; }
@keyframes counterSpin { to { transform: rotate(360deg) } }
.counter-spin { animation: counterSpin 1s linear infinite; }
@keyframes counterPop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
.counter-pop { animation: counterPop .5s cubic-bezier(.2,.8,.2,1) both; }
@keyframes counterKen { from { transform: scale(1.04) } to { transform: scale(1.12) } }
.counter-ken { animation: counterKen 7s ease-out both; }
`;

// ── Pieces ──────────────────────────────────────────────────────────────────
function Boot() {
  return <div className="flex h-full items-center justify-center"><div className="counter-spin h-8 w-8 rounded-full border-2 border-white/20 border-t-white" /></div>;
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="text-[22px] font-semibold">Can't reach ClubOS</div>
      <div className="text-[15px] text-white/60">{message}</div>
      <button onClick={onRetry} className="h-14 rounded-2xl bg-white px-8 text-[16px] font-semibold text-black">Try again</button>
      <button onClick={() => { try { nativeBridge()?.openSettings(); } catch { /* */ } }} className="h-14 rounded-2xl border border-white/20 px-8 text-[15px] text-white/80">Reader settings (Wi-Fi)</button>
    </div>
  );
}

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-6 pt-7">
      <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/45">{sub ?? "United Sports Group"}</div>
      <div className="mt-1 text-[26px] font-bold leading-tight tracking-tight">{title}</div>
    </div>
  );
}

function PairScreen({ state, hasNative }: { state: CounterState; hasNative: boolean }) {
  const code = state.code ?? "······";
  return (
    <div className="counter-in flex h-full flex-col">
      <Header title="Link this screen" sub="ClubOS counter" />
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="text-[14px] text-white/60">Enter this code at the till</div>
        <div className="mt-4 flex gap-1.5" data-testid="pair-code">
          {code.split("").map((ch, i) => (
            <div key={i} className="flex h-[64px] w-[46px] items-center justify-center rounded-xl bg-white/[0.08] text-[34px] font-bold tabular-nums ring-1 ring-white/10">{ch}</div>
          ))}
        </div>
        <ol className="mt-8 w-full space-y-2.5 text-[14px] leading-snug text-white/70">
          <li><span className="mr-2 font-semibold text-white">1</span>Open the Register in ClubOS on the laptop.</li>
          <li><span className="mr-2 font-semibold text-white">2</span>Tap <b className="text-white">Card reader</b>, then <b className="text-white">Link counter screen</b>.</li>
          <li><span className="mr-2 font-semibold text-white">3</span>Type the code. This screen switches over by itself.</li>
        </ol>
        {!hasNative && <div className="mt-8 rounded-xl bg-amber-400/10 px-4 py-3 text-[12px] text-amber-200">Opened in a browser — card payments only work on the reader.</div>}
      </div>
      {hasNative && (
        <div className="px-6 pb-6">
          <button onClick={() => { try { nativeBridge()?.openSettings(); } catch { /* */ } }} className="h-14 w-full rounded-2xl border border-white/15 text-[15px] text-white/75">Reader settings</button>
        </div>
      )}
    </div>
  );
}

/** Crests, kit with real photographs, and what's open — one slide at a time. */
function IdleScreen({ state }: { state: CounterState }) {
  const idle = state.idle;
  const slides = useMemo(() => {
    const out: ({ kind: "crests" } | { kind: "product"; p: NonNullable<CounterState["idle"]>["products"][number] } | { kind: "programmes" })[] = [{ kind: "crests" }];
    const prods = idle?.products ?? [];
    prods.forEach((p, i) => { out.push({ kind: "product", p }); if (i === 3 && idle?.programmes.length) out.push({ kind: "programmes" }); });
    if (prods.length <= 3 && idle?.programmes.length) out.push({ kind: "programmes" });
    return out;
  }, [idle]);
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % Math.max(1, slides.length)), 6500); return () => clearInterval(t); }, [slides.length]);
  const slide = slides[i % Math.max(1, slides.length)];

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 overflow-hidden">
        {slide?.kind === "product" ? (
          <div key={`p${i}`} className="counter-in absolute inset-0">
            <img src={slide.p.image} alt="" className="counter-ken absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#07090c] via-[#07090c]/30 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 px-6 pb-6">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/60">{slide.p.brand}</div>
              <div className="mt-1 text-[24px] font-bold leading-tight">{slide.p.title}</div>
              <div className="mt-1.5 text-[18px] font-semibold text-white/85">{$whole(slide.p.priceCents)}</div>
              <div className="mt-2 text-[13px] text-white/55">Ask at the counter</div>
            </div>
          </div>
        ) : slide?.kind === "programmes" ? (
          <div key={`g${i}`} className="counter-in absolute inset-0 flex flex-col justify-center px-6">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50">Registrations open</div>
            <div className="mt-1 text-[26px] font-bold leading-tight">Sign up today</div>
            <div className="mt-5 space-y-2.5">
              {(idle?.programmes ?? []).slice(0, 6).map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{p.name}</div>
                    <div className="truncate text-[12px] text-white/50">{p.brand}</div>
                  </div>
                  {p.fromCents != null && <div className="shrink-0 text-[13px] text-white/75">from {$whole(p.fromCents)}</div>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div key={`c${i}`} className="counter-in absolute inset-0 flex flex-col justify-center px-6">
            <div className="text-[30px] font-bold leading-[1.1] tracking-tight">Kia ora.<br />Welcome to the club.</div>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {(idle?.brands ?? []).slice(0, 9).map((b) => (
                <div key={b.name} className="flex aspect-square items-center justify-center rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
                  <img src={b.logo} alt={b.name} className="max-h-full max-w-full object-contain" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-6 pb-5 pt-3 text-[12px] text-white/40">
        <span>{state.register?.name ?? "Counter"}</span>
        <span className="flex gap-1">{slides.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i % slides.length ? "w-4 bg-white/70" : "w-1.5 bg-white/20"}`} />)}</span>
      </div>
    </div>
  );
}

function Lines({ sale }: { sale: NonNullable<CounterState["sale"]> }) {
  const endRef = useRef<HTMLDivElement>(null);
  const key = sale.lines.map((l) => `${l.id}x${l.qty}`).join(",");
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [key]);
  return (
    <div className="flex-1 overflow-y-auto px-4">
      <div className="space-y-2.5 pb-3">
        {sale.lines.map((l) => (
          <div key={l.id} className="counter-in flex items-center gap-3 rounded-2xl bg-white/[0.05] p-2.5 ring-1 ring-white/10">
            <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
              {l.image ? <img src={l.image} alt="" className="h-full w-full object-cover" />
                : l.brandLogo ? <img src={l.brandLogo} alt="" className="h-[70%] w-[70%] object-contain" />
                : <div className="text-[18px] font-bold text-black/70">{l.title.slice(0, 1)}</div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{l.title}</div>
              {l.detail && <div className="truncate text-[12.5px] text-white/55">{l.detail}</div>}
              <div className="text-[12px] text-white/45">{l.qty > 1 ? `${l.qty} × ${$(l.unitCents)}` : l.brand}</div>
            </div>
            <div className="shrink-0 text-[15px] font-semibold tabular-nums">{$(l.lineCents)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Totals({ sale, label = "Total" }: { sale: NonNullable<CounterState["sale"]>; label?: string }) {
  return (
    <div className="border-t border-white/10 bg-[#0c0f14] px-6 pb-6 pt-4">
      {sale.discountCents > 0 && (
        <>
          <div className="flex justify-between text-[14px] text-white/60"><span>Subtotal</span><span className="tabular-nums">{$(sale.subtotalCents)}</span></div>
          <div className="mt-1 flex justify-between text-[14px] text-emerald-300"><span>Discount</span><span className="tabular-nums">−{$(sale.discountCents)}</span></div>
        </>
      )}
      {sale.paidCents > 0 && sale.status === "open" && (
        <div className="mt-1 flex justify-between text-[14px] text-white/60"><span>Already paid</span><span className="tabular-nums">−{$(sale.paidCents)}</span></div>
      )}
      <div className="mt-1 flex items-end justify-between">
        <span className="text-[16px] font-semibold text-white/80">{label}</span>
        <span className="text-[38px] font-bold leading-none tracking-tight tabular-nums" data-testid="counter-total">{$(sale.status === "open" ? sale.remainingCents : sale.totalCents)}</span>
      </div>
      <div className="mt-1.5 text-right text-[12px] text-white/45">Includes GST of {$(sale.gstCents)}</div>
    </div>
  );
}

function CartScreen({ state }: { state: CounterState }) {
  const sale = state.sale!;
  const count = sale.lines.reduce((a, l) => a + l.qty, 0);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between px-6 pb-3 pt-7">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/45">Your order</div>
          <div className="mt-1 text-[22px] font-bold">{count} item{count === 1 ? "" : "s"}</div>
        </div>
        <div className="text-[12px] text-white/40">{sale.number}</div>
      </div>
      <Lines sale={sale} />
      <Totals sale={sale} />
    </div>
  );
}

function PayScreen({ state, hasNative, collecting, claimError, onRetry }: { state: CounterState; hasNative: boolean; collecting: boolean; claimError: string | null; onRetry: () => void }) {
  const sale = state.sale!;
  const charge = state.charge!;
  const failed = !!charge.lastError && !collecting && !charge.claimed;
  return (
    <div className="flex h-full flex-col">
      <Header title={failed ? "Payment didn't go through" : "Ready to pay"} sub={sale.number} />
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="text-[15px] text-white/60">Amount to pay</div>
        <div className="mt-1 text-[52px] font-bold tracking-tight tabular-nums">{$(charge.amountCents)}</div>
        {!hasNative ? (
          <div className="mt-6 rounded-2xl bg-amber-400/10 px-5 py-4 text-[14px] text-amber-100">Pay on the card reader at the counter.</div>
        ) : failed ? (
          <>
            <div className="mt-6 rounded-2xl bg-red-500/10 px-5 py-4 text-[15px] text-red-200">{charge.lastError}</div>
            <button onClick={onRetry} className="mt-6 h-16 w-full rounded-2xl bg-white text-[18px] font-bold text-black" data-testid="counter-retry">Try again</button>
            <div className="mt-3 text-[13px] text-white/50">Or use another card — or ask at the counter.</div>
          </>
        ) : claimError ? (
          <>
            <div className="mt-6 rounded-2xl bg-red-500/10 px-5 py-4 text-[15px] text-red-200">{claimError}</div>
            <button onClick={onRetry} className="mt-6 h-16 w-full rounded-2xl bg-white text-[18px] font-bold text-black">Try again</button>
          </>
        ) : (
          <div className="mt-8 flex items-center gap-3 text-[15px] text-white/70">
            <div className="counter-spin h-5 w-5 rounded-full border-2 border-white/20 border-t-white" />
            {collecting || charge.claimed ? "Tap, insert or swipe your card" : "Getting the reader ready…"}
          </div>
        )}
      </div>
      <Totals sale={sale} label="Total due" />
    </div>
  );
}

function PaidScreen({ state }: { state: CounterState }) {
  const sale = state.sale!;
  const [mode, setMode] = useState<"thanks" | "email" | "sent">(sale.receiptSentTo ? "sent" : "thanks");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(sale.receiptSentTo);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ sent: boolean; to: string }>("POST", `/api/public/pos/counter/sales/${sale.id}/receipt`, { email });
      if (r.sent) { setSentTo(r.to); setMode("sent"); } else setErr("The receipt didn't send. Ask at the counter.");
    } catch (e: any) { setErr(e?.message || "The receipt didn't send."); } finally { setBusy(false); }
  };

  if (mode === "email") {
    return (
      <div className="counter-in flex h-full flex-col">
        <div className="px-6 pt-7">
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/45">Email receipt</div>
          <div className="mt-3 flex min-h-[56px] items-center break-all rounded-2xl bg-white px-4 py-3 text-[18px] font-medium text-black" data-testid="counter-email">
            {email || <span className="text-black/35">you@example.com</span>}<span className="counter-pulse ml-0.5 inline-block h-6 w-[2px] bg-black" />
          </div>
          {err && <div className="mt-2 text-[13px] text-red-300">{err}</div>}
          <div className="mt-2 text-[12px] text-white/45">Only used to send this receipt. You won't be added to any mailing list.</div>
        </div>
        <div className="flex-1" />
        <Keyboard value={email} onChange={setEmail} />
        <div className="grid grid-cols-2 gap-2 px-3 pb-4 pt-2">
          <button onClick={() => setMode("thanks")} className="h-14 rounded-2xl border border-white/15 text-[16px] text-white/80">Back</button>
          <button onClick={send} disabled={!valid || busy} className="h-14 rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="counter-send">{busy ? "Sending…" : "Send"}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="counter-in flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="counter-pop flex h-24 w-24 items-center justify-center rounded-full bg-emerald-400 text-black">
        <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <div className="mt-6 text-[30px] font-bold">Thank you!</div>
      <div className="mt-2 text-[16px] text-white/70">{$(sale.totalCents)} paid{sale.paidBy.length ? ` · ${Array.from(new Set(sale.paidBy)).join(" + ")}` : ""}</div>
      <div className="mt-1 text-[13px] text-white/40">{sale.number}</div>
      {mode === "sent" ? (
        <div className="mt-10 rounded-2xl bg-white/[0.06] px-5 py-4 text-[15px] text-white/80 ring-1 ring-white/10">Receipt sent to {sentTo}</div>
      ) : (
        <button onClick={() => setMode("email")} className="mt-10 h-16 w-full rounded-2xl bg-white text-[18px] font-bold text-black" data-testid="counter-receipt">Email me a receipt</button>
      )}
      <div className="mt-6 text-[13px] text-white/45">Ngā mihi — see you at the club.</div>
    </div>
  );
}

/** Our own keyboard: the same on every reader, no reliance on Android's. */
function Keyboard({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [shift, setShift] = useState(false);
  const [nums, setNums] = useState(false);
  const rows = nums
    ? [["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], ["-", "_", ".", "+", "'", "!", "#", "$", "%", "&"], ["*", "/", "=", "?", "^", "{", "}", "|", "~"]]
    : [["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], ["a", "s", "d", "f", "g", "h", "j", "k", "l"], ["z", "x", "c", "v", "b", "n", "m"]];
  const add = (k: string) => { if (value.length < 120) onChange(value + (shift ? k.toUpperCase() : k)); if (shift) setShift(false); };
  const key = "flex h-12 flex-1 items-center justify-center rounded-lg bg-white/[0.12] text-[18px] font-medium active:bg-white/30";
  return (
    <div className="space-y-1.5 px-1.5">
      {rows.map((r, ri) => (
        <div key={ri} className="flex gap-1">
          {ri === 2 && !nums && <button onClick={() => setShift((s) => !s)} className={`${key} max-w-[44px] ${shift ? "bg-white text-black" : ""}`}>⇧</button>}
          {r.map((k) => <button key={k} onClick={() => add(k)} className={key}>{shift ? k.toUpperCase() : k}</button>)}
          {ri === 2 && <button onClick={() => onChange(value.slice(0, -1))} className={`${key} max-w-[52px]`} aria-label="Delete">⌫</button>}
        </div>
      ))}
      <div className="flex gap-1">
        <button onClick={() => setNums((n) => !n)} className={`${key} max-w-[60px] text-[14px]`}>{nums ? "abc" : "123"}</button>
        <button onClick={() => add("@")} className={`${key} max-w-[52px]`}>@</button>
        <button onClick={() => add(".")} className={`${key} max-w-[44px]`}>.</button>
        <button onClick={() => onChange(value + "gmail.com")} className={`${key} text-[13px]`}>gmail.com</button>
        <button onClick={() => onChange(value + ".co.nz")} className={`${key} text-[13px]`}>.co.nz</button>
        <button onClick={() => onChange(value + ".com")} className={`${key} max-w-[56px] text-[13px]`}>.com</button>
      </div>
    </div>
  );
}
