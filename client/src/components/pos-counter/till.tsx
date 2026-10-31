// The counter reader as a TILL — staff build the whole sale on the S710.
//
// Daniel, 2026-10-31: "do the whole process off the eftpos machine and have it
// logged to ClubOS without needing phone or laptop or iPad … pick and search
// items on the touch screen and quickly choose existing player or type in and
// enter new player."
//
// Staff tap "Staff" on the idle screen, pick their name, type their PIN. The
// sale they build is theirs (served by). "Charge" hands the reader to the
// customer: the existing pay → thank-you screens take over, and "Next sale"
// brings staff back here.
//
// 🔴 Nothing here decides a price or a total. Every number is the server's,
// from the same handlers the laptop till runs (server/pos-counter-till.ts).
// 🔴 A shared screen at a public counter: no parent email or phone, no full
// date of birth is ever shown for an existing player. New-player details are
// typed by staff and leave the screen when the step is done.
// 🔴 Every control is ≥48px; the screen is ~360×640 CSS px, portrait.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { $, api, Keyboard, NumPad } from "./kit";
import { TILL_IDLE_MINUTES, TILL_PIN_LENGTH, type TillMe, type TillPerson, type TillSale, type TillStaff } from "@shared/pos-counter-till";
import { HDYHAU_OPTIONS } from "@shared/hdyhau";
import { IDENTITY_DEFER_REASONS } from "@shared/nzf-identity";

const T = "/api/public/pos/counter/till";

// ── Session ─────────────────────────────────────────────────────────────────
export type TillSession = ReturnType<typeof useTillSession>;

/** Who is unlocked on this reader, and the idle re-lock. Lives in the page so it survives screen changes. */
export function useTillSession() {
  const [view, setView] = useState<"closed" | "pick" | "open">("closed");
  const [me, setMe] = useState<TillMe | null>(null);
  const lastTouch = useRef(Date.now());

  const refresh = useCallback(async () => {
    try { const m = await api<TillMe>("GET", `${T}/me`); setMe(m); setView("open"); return m; }
    catch (e: any) { if (e?.status === 401) { setMe(null); setView((v) => (v === "open" ? "closed" : v)); } return null; }
  }, []);
  // A reload while unlocked resumes rather than asking for the PIN again.
  useEffect(() => { refresh(); }, [refresh]);

  const lock = useCallback(async (reason = "manual") => {
    setMe(null); setView("closed");
    try { await api("POST", `${T}/lock`, { reason }); } catch { /* the server expires it anyway */ }
  }, []);
  const unlock = useCallback(async (userId: number, pin: string) => {
    await api("POST", `${T}/unlock`, { userId, pin });
    lastTouch.current = Date.now();
    await refresh();
  }, [refresh]);
  const touch = useCallback(() => { lastTouch.current = Date.now(); }, []);

  // Re-lock after TILL_IDLE_MINUTES untouched — but never while the customer
  // is paying; the caller pauses it then.
  const paused = useRef(false);
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => {
      if (!paused.current && Date.now() - lastTouch.current > TILL_IDLE_MINUTES * 60_000) lock("idle");
    }, 5000);
    return () => clearInterval(t);
  }, [me, lock]);

  return { view, setView, me, unlock, lock, touch, refresh, paused };
}

// ── The way in, on the idle screen ──────────────────────────────────────────
export function TillStaffButton({ till }: { till: TillSession }) {
  return (
    <button onClick={() => till.setView("pick")} className="absolute left-4 top-4 z-30 flex h-12 items-center gap-2 rounded-full bg-white/[0.10] px-4 text-[14px] font-semibold text-white/80 ring-1 ring-white/15 active:bg-white/25" data-testid="till-staff">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
      Staff
    </button>
  );
}

/** While the customer pays: staff can take the payment back. */
export function TillPayActions({ till, saleId, paymentId }: { till: TillSession; saleId: number | null; paymentId: number }) {
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { till.paused.current = true; return () => { till.paused.current = false; till.touch(); }; }, []);
  if (!till.me || !saleId) return null;
  const cancel = async () => {
    try { await api("POST", `${T}/sale/payments/${paymentId}/cancel`, {}); setConfirm(false); }
    catch (e: any) { setErr(e?.message || "Couldn't cancel."); }
  };
  return (
    <div className="absolute right-3 top-3 z-40 flex flex-col items-end">
      {confirm ? (
        <div className="flex items-center gap-1.5 rounded-2xl bg-black/80 p-1.5 ring-1 ring-white/15">
          <button onClick={cancel} className="h-11 rounded-xl bg-red-500 px-3 text-[13px] font-bold text-white">Cancel payment</button>
          <button onClick={() => setConfirm(false)} className="h-11 rounded-xl px-3 text-[13px] text-white/70">Keep</button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)} className="h-11 rounded-full bg-white/[0.08] px-4 text-[12.5px] text-white/60 ring-1 ring-white/10">Staff · back to sale</button>
      )}
      {err && <div className="mt-1 max-w-[220px] text-right rounded-lg bg-red-500/20 px-2 py-1 text-[12px] text-red-200">{err}</div>}
    </div>
  );
}

/** After the thank-you: staff start the next sale. */
export function TillPaidActions({ till }: { till: TillSession }) {
  if (!till.me) return null;
  const next = async () => { try { await api("POST", `${T}/sale/next`, {}); } catch { /* the screen moves on regardless */ } till.touch(); };
  return (
    <button onClick={next} className="absolute right-3 top-3 z-40 h-11 rounded-full bg-white/[0.10] px-4 text-[13px] font-semibold text-white/80 ring-1 ring-white/15" data-testid="till-next">
      Next sale →
    </button>
  );
}

// ── The till ────────────────────────────────────────────────────────────────
interface Variant { id: number; size: string | null; sku: string | null; stock: number; priceCents: number }
interface Colour { id: number; name: string; swatchHex: string | null; image: string | null; variants: Variant[] }
interface Product { id: number; orgId: number; title: string; subtitle: string | null; type: string; priceCents: number; image: string | null; colours: Colour[] }
interface Programme { id: number; orgId: number; name: string; type: string; registrationOpen: boolean; options: { id: number; name: string; fullPriceCents: number }[] }

export function TillApp({ till }: { till: TillSession }) {
  if (till.view === "pick" || !till.me) return <Unlock till={till} />;
  return <Till till={till} me={till.me} />;
}

function Unlock({ till }: { till: TillSession }) {
  const [staff, setStaff] = useState<TillStaff[] | null>(null);
  const [who, setWho] = useState<TillStaff | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ staff: TillStaff[] }>("GET", `${T}/staff`).then((r) => setStaff(r.staff)).catch((e) => setErr(e?.message || "Couldn't load staff.")); }, []);
  useEffect(() => {
    if (!who || pin.length < TILL_PIN_LENGTH || busy) return;
    (async () => {
      setBusy(true); setErr(null);
      try { await till.unlock(who.id, pin); }
      catch (e: any) { setErr(e?.message || "That PIN isn't right."); setPin(""); }
      finally { setBusy(false); }
    })();
  }, [pin, who]);

  return (
    <div className="counter-in flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-6">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/45">Staff</div>
          <div className="mt-1 text-[24px] font-bold">{who ? `Kia ora, ${who.name.split(" ")[0]}` : "Who's serving?"}</div>
        </div>
        <button onClick={() => (who ? (setWho(null), setPin(""), setErr(null)) : till.setView("closed"))} className="h-12 rounded-full px-4 text-[14px] text-white/60 ring-1 ring-white/15">{who ? "Back" : "Close"}</button>
      </div>
      {!who ? (
        <div className="flex-1 overflow-y-auto px-4 pt-5">
          {!staff && !err && <div className="px-2 text-[14px] text-white/50">Loading…</div>}
          {staff?.length === 0 && (
            <div className="rounded-2xl bg-white/[0.05] p-4 text-[14px] leading-snug text-white/70 ring-1 ring-white/10">
              Nobody has a reader PIN yet. In ClubOS open <b className="text-white">Register → Card reader</b> and tap <b className="text-white">Set my reader PIN</b>.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            {staff?.map((s) => (
              <button key={s.id} onClick={() => { setWho(s); setPin(""); setErr(null); }} className="flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/[0.06] ring-1 ring-white/10 active:bg-white/15" data-testid={`till-staff-${s.id}`}>
                {s.photo ? <img src={s.photo} alt="" className="h-10 w-10 rounded-full object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[15px] font-bold text-black">{s.initials}</div>}
                <div className="max-w-full truncate px-2 text-[14px] font-semibold">{s.name}</div>
              </button>
            ))}
          </div>
          {err && <div className="mt-3 text-[13px] text-red-300">{err}</div>}
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="text-[14px] text-white/60">Enter your PIN</div>
            <div className="mt-4 flex gap-3" data-testid="till-pin-dots">
              {Array.from({ length: TILL_PIN_LENGTH }).map((_, i) => <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-white" : "bg-white/15"}`} />)}
            </div>
            <div className="mt-3 h-5 text-[13px] text-red-300">{busy ? <span className="text-white/50">Checking…</span> : err}</div>
          </div>
          <div className="pb-5"><NumPad value={pin} onChange={(v) => { setErr(null); setPin(v); }} max={TILL_PIN_LENGTH} /></div>
        </div>
      )}
    </div>
  );
}

function Till({ till, me }: { till: TillSession; me: TillMe }) {
  const [tab, setTab] = useState<"kit" | "programmes">("kit");
  const [q, setQ] = useState("");
  const [typing, setTyping] = useState(false);
  const [catalogue, setCatalogue] = useState<{ products: Product[]; programmes: Programme[] } | null>(null);
  const [sale, setSale] = useState<TillSale | null>(null);
  const [picked, setPicked] = useState<Product | null>(null);
  const [registering, setRegistering] = useState<Programme | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handle = useCallback((e: any) => {
    if (e?.status === 401) { till.lock("expired"); return; }
    setErr(e?.message || "Something went wrong.");
  }, [till]);

  useEffect(() => {
    api<{ products: Product[]; programmes: Programme[] }>("GET", `${T}/catalogue`).then(setCatalogue).catch(handle);
    api<{ sale: TillSale | null }>("GET", `${T}/sale`).then(async (r) => {
      // A paid sale left over from the last customer: start clean.
      if (r.sale && r.sale.status !== "open") { await api("POST", `${T}/sale/next`, {}).catch(() => {}); setSale(null); }
      else setSale(r.sale);
    }).catch(handle);
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2200); return () => clearTimeout(t); }, [toast]);

  const needle = q.trim().toLowerCase();
  const products = useMemo(() => (catalogue?.products ?? []).filter((p) => !needle || `${p.title} ${p.subtitle ?? ""} ${p.colours.flatMap((c) => c.variants.map((v) => v.sku ?? "")).join(" ")}`.toLowerCase().includes(needle)), [catalogue, needle]);
  const programmes = useMemo(() => (catalogue?.programmes ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle)), [catalogue, needle]);

  const addVariant = async (v: Variant, qty: number, label: string) => {
    setBusy("add"); setErr(null);
    try { const r = await api<{ sale: TillSale }>("POST", `${T}/sale/lines`, { variantId: v.id, qty }); setSale(r.sale); setPicked(null); setToast(`Added ${label}`); }
    catch (e) { handle(e); } finally { setBusy(null); }
  };
  const setQty = async (lineId: number, qty: number) => {
    setErr(null);
    try {
      const r = qty < 1 ? await api<{ sale: TillSale }>("DELETE", `${T}/sale/lines/${lineId}`) : await api<{ sale: TillSale }>("PATCH", `${T}/sale/lines/${lineId}`, { qty });
      setSale(r.sale);
    } catch (e) { handle(e); }
  };
  const clearSale = async () => {
    try { await api("POST", `${T}/sale/void`, {}); setSale(null); setCartOpen(false); } catch (e) { handle(e); }
  };
  const charge = async () => {
    setBusy("charge"); setErr(null);
    // The page's 1-second poll flips to the pay screen once the payment exists.
    try { await api("POST", `${T}/sale/charge`, {}); setCartOpen(false); }
    catch (e) { handle(e); } finally { setBusy(null); }
  };

  const count = sale?.lines.reduce((a, l) => a + l.qty, 0) ?? 0;

  if (registering) {
    return <RegisterFlow programme={registering} me={me} onCancel={() => setRegistering(null)} onDone={(s, note) => { setSale(s); setRegistering(null); setToast(note); }} onLocked={() => till.lock("expired")} />;
  }

  return (
    <div className="flex h-full flex-col" onPointerDown={till.touch}>
      {/* Top: who, search, tabs */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {me.user.photo ? <img src={me.user.photo} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[13px] font-bold text-black">{me.user.initials}</div>}
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{me.user.name}</div>
              <div className="text-[11.5px] text-white/45">{sale ? sale.number : "New sale"}</div>
            </div>
          </div>
          <button onClick={() => till.lock("manual")} className="h-11 shrink-0 rounded-full px-4 text-[13px] text-white/70 ring-1 ring-white/15" data-testid="till-lock">Lock</button>
        </div>
        <button onClick={() => setTyping(true)} className="mt-3 flex h-12 w-full items-center gap-2 rounded-2xl bg-white/[0.08] px-4 text-left text-[15px] ring-1 ring-white/10" data-testid="till-search">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-white/50" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className={`min-w-0 flex-1 truncate ${q ? "" : "text-white/40"}`}>{q || (tab === "kit" ? "Search kit, or scan a SKU" : "Search programmes")}</span>
          {q && <span onClick={(e) => { e.stopPropagation(); setQ(""); }} className="px-1 text-white/50">✕</span>}
        </button>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-white/[0.06] p-1">
          {(["kit", "programmes"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`h-10 rounded-xl text-[14px] font-semibold ${tab === t ? "bg-white text-black" : "text-white/65"}`} data-testid={`till-tab-${t}`}>
              {t === "kit" ? "Kit" : "Register a player"}
            </button>
          ))}
        </div>
      </div>

      {/* Middle: the catalogue */}
      <div className="mt-3 flex-1 overflow-y-auto px-4 pb-3">
        {!catalogue && !err && <div className="pt-6 text-center text-[14px] text-white/45">Loading…</div>}
        {tab === "kit" ? (
          <div className="grid grid-cols-2 gap-2.5">
            {products.map((p) => {
              const inStock = p.colours.some((c) => c.variants.some((v) => v.stock > 0));
              return (
                <button key={p.id} onClick={() => setPicked(p)} disabled={!inStock} className="overflow-hidden rounded-2xl bg-white/[0.05] text-left ring-1 ring-white/10 active:bg-white/15 disabled:opacity-40" data-testid="till-product">
                  <div className="aspect-square w-full bg-white">{p.image && <img src={p.image} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
                  <div className="p-2.5">
                    <div className="line-clamp-2 text-[13px] font-semibold leading-snug">{p.title}</div>
                    <div className="mt-0.5 text-[12.5px] text-white/60">{inStock ? $(p.priceCents) : "Out of stock"}</div>
                  </div>
                </button>
              );
            })}
            {catalogue && products.length === 0 && <div className="col-span-2 pt-6 text-center text-[14px] text-white/45">Nothing matches “{q}”.</div>}
          </div>
        ) : !me.canRegister ? (
          <div className="rounded-2xl bg-white/[0.05] p-4 text-[14px] leading-snug text-white/70 ring-1 ring-white/10">Registering a player needs Contacts access in ClubOS. You can still sell kit — or ask someone who has it.</div>
        ) : (
          <div className="space-y-2">
            {programmes.map((p) => (
              <button key={p.id} onClick={() => setRegistering(p)} className="flex min-h-[60px] w-full items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-left ring-1 ring-white/10 active:bg-white/15" data-testid="till-programme">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-snug">{p.name}</div>
                  {!p.registrationOpen && <div className="text-[12px] text-amber-300/80">Invite only</div>}
                </div>
                <div className="shrink-0 text-[13px] text-white/60">from {$(Math.min(...p.options.map((o) => o.fullPriceCents)))}</div>
              </button>
            ))}
            {catalogue && programmes.length === 0 && <div className="pt-6 text-center text-[14px] text-white/45">No term programmes match.</div>}
          </div>
        )}
      </div>

      {err && <div className="mx-4 mb-2 rounded-xl bg-red-500/15 px-3 py-2 text-[13px] text-red-200" onClick={() => setErr(null)}>{err}</div>}

      {/* Bottom: the sale */}
      <div className="border-t border-white/10 bg-[#0c0f14] px-4 pb-4 pt-3">
        {count === 0 ? (
          <div className="flex h-14 items-center justify-center text-[14px] text-white/40">Tap an item to start a sale</div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setCartOpen(true)} className="h-14 min-w-0 flex-1 rounded-2xl bg-white/[0.08] px-3 text-left ring-1 ring-white/10" data-testid="till-cart">
              <div className="text-[12px] text-white/55">{count} item{count === 1 ? "" : "s"} · view</div>
              <div className="text-[17px] font-bold tabular-nums">{$(sale!.remainingCents)}</div>
            </button>
            <button onClick={charge} disabled={busy === "charge"} className="h-14 flex-[1.3] rounded-2xl bg-emerald-400 text-[17px] font-bold text-black disabled:opacity-50" data-testid="till-charge">
              {busy === "charge" ? "Starting…" : `Charge ${$(sale!.remainingCents)}`}
            </button>
          </div>
        )}
      </div>

      {toast && <div className="counter-in pointer-events-none absolute inset-x-0 bottom-24 z-40 mx-auto w-fit rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black shadow-lg">{toast}</div>}

      {typing && (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#07090c]/95" onPointerDown={till.touch}>
          <div className="px-4 pt-5">
            <div className="flex min-h-[52px] items-center rounded-2xl bg-white px-4 text-[17px] font-medium text-black">
              {q || <span className="text-black/35">Type to search</span>}<span className="counter-pulse ml-0.5 inline-block h-5 w-[2px] bg-black" />
            </div>
            <div className="mt-2 text-[12.5px] text-white/50">{tab === "kit" ? `${products.length} item${products.length === 1 ? "" : "s"}` : `${programmes.length} programme${programmes.length === 1 ? "" : "s"}`}</div>
          </div>
          <div className="flex-1" />
          <Keyboard value={q} onChange={setQ} mode="text" max={60} />
          <div className="px-3 pb-4 pt-2"><button onClick={() => setTyping(false)} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black">Show results</button></div>
        </div>
      )}

      {picked && <ProductSheet product={picked} busy={busy === "add"} onClose={() => setPicked(null)} onAdd={addVariant} />}

      {cartOpen && sale && (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#07090c]" onPointerDown={till.touch}>
          <div className="flex items-center justify-between px-5 pt-6">
            <div className="text-[22px] font-bold">This sale</div>
            <button onClick={() => setCartOpen(false)} className="h-11 rounded-full px-4 text-[14px] text-white/70 ring-1 ring-white/15">Done</button>
          </div>
          <div className="mt-3 flex-1 space-y-2 overflow-y-auto px-4">
            {sale.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-2.5 ring-1 ring-white/10">
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
                  {l.image ? <img src={l.image} alt="" className="h-full w-full object-cover" /> : <div className="text-[16px] font-bold text-black/70">{l.title.slice(0, 1)}</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{l.title}</div>
                  {l.detail && <div className="truncate text-[12px] text-white/55">{l.detail}</div>}
                  <div className="text-[13px] font-semibold tabular-nums">{$(l.lineCents)}</div>
                </div>
                {l.kind === "registration" ? (
                  <button onClick={() => setQty(l.id, 0)} className="h-11 w-11 shrink-0 rounded-xl bg-white/[0.08] text-[16px]" aria-label="Remove">✕</button>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => setQty(l.id, l.qty - 1)} className="h-11 w-11 rounded-xl bg-white/[0.08] text-[20px]" aria-label="One fewer">−</button>
                    <div className="w-6 text-center text-[15px] font-semibold tabular-nums">{l.qty}</div>
                    <button onClick={() => setQty(l.id, l.qty + 1)} className="h-11 w-11 rounded-xl bg-white/[0.08] text-[20px]" aria-label="One more">+</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 px-4 pb-4 pt-3">
            <div className="flex items-end justify-between">
              <span className="text-[14px] text-white/60">Total · incl GST {$(sale.gstCents)}</span>
              <span className="text-[30px] font-bold tabular-nums">{$(sale.remainingCents)}</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={clearSale} className="h-14 flex-1 rounded-2xl text-[15px] text-red-300 ring-1 ring-red-400/30">Clear sale</button>
              <button onClick={charge} disabled={busy === "charge" || count === 0} className="h-14 flex-[1.6] rounded-2xl bg-emerald-400 text-[17px] font-bold text-black disabled:opacity-50">{busy === "charge" ? "Starting…" : `Charge ${$(sale.remainingCents)}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductSheet({ product, busy, onClose, onAdd }: { product: Product; busy: boolean; onClose: () => void; onAdd: (v: Variant, qty: number, label: string) => void }) {
  const colours = product.colours.filter((c) => c.variants.length > 0);
  const [colourId, setColourId] = useState<number>(colours.find((c) => c.variants.some((v) => v.stock > 0))?.id ?? colours[0]?.id);
  const colour = colours.find((c) => c.id === colourId) ?? colours[0];
  const [variantId, setVariantId] = useState<number | null>(colour?.variants.length === 1 && colour.variants[0].stock > 0 ? colour.variants[0].id : null);
  const [qty, setQty] = useState(1);
  const variant = colour?.variants.find((v) => v.id === variantId) ?? null;
  const img = colour?.image ?? product.image;
  const showColour = colours.length > 1 || (colours[0] && !/^default$/i.test(colours[0].name));
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#07090c]">
      <div className="relative h-[34%] shrink-0 bg-white">
        {img && <img src={img} alt="" className="h-full w-full object-contain" />}
        <button onClick={onClose} className="absolute left-3 top-3 h-11 rounded-full bg-black/70 px-4 text-[14px] font-semibold text-white">Back</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pt-4">
        <div className="text-[19px] font-bold leading-snug">{product.title}</div>
        <div className="mt-0.5 text-[16px] text-white/70">{$(variant?.priceCents ?? product.priceCents)}</div>
        {showColour && (
          <>
            <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">Colour</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {colours.map((c) => (
                <button key={c.id} onClick={() => { setColourId(c.id); setVariantId(c.variants.length === 1 ? c.variants[0].id : null); }} className={`flex h-11 items-center gap-2 rounded-xl px-3 text-[14px] ring-1 ${c.id === colour?.id ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`}>
                  {c.swatchHex && <span className="h-4 w-4 rounded-full ring-1 ring-black/20" style={{ background: c.swatchHex }} />}{c.name}
                </button>
              ))}
            </div>
          </>
        )}
        {colour && (colour.variants.length > 1 || colour.variants[0]?.size) && (
          <>
            <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">Size</div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {colour.variants.map((v) => (
                <button key={v.id} onClick={() => setVariantId(v.id)} disabled={v.stock <= 0} className={`flex h-14 flex-col items-center justify-center rounded-xl text-[15px] font-semibold ring-1 disabled:opacity-30 ${v.id === variantId ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`} data-testid="till-size">
                  {v.size || "One size"}
                  {v.stock > 0 && v.stock <= 3 && <span className={`text-[10.5px] font-medium ${v.id === variantId ? "text-black/60" : "text-amber-300"}`}>{v.stock} left</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="border-t border-white/10 px-4 pb-4 pt-3">
        <div className="flex gap-2">
          <div className="flex shrink-0 items-center gap-1 rounded-2xl bg-white/[0.06] px-1 ring-1 ring-white/10">
            <button onClick={() => setQty((n) => Math.max(1, n - 1))} className="h-12 w-11 text-[22px]" aria-label="One fewer">−</button>
            <div className="w-6 text-center text-[16px] font-semibold tabular-nums">{qty}</div>
            <button onClick={() => setQty((n) => Math.min(variant?.stock ?? 1, n + 1))} className="h-12 w-11 text-[22px]" aria-label="One more">+</button>
          </div>
          <button onClick={() => variant && onAdd(variant, qty, `${product.title}${variant.size ? ` · ${variant.size}` : ""}`)} disabled={!variant || busy} className="h-14 flex-1 rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-add">
            {busy ? "Adding…" : variant ? `Add · ${$(variant.priceCents * qty)}` : "Choose a size"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Register a player ───────────────────────────────────────────────────────
type NewPlayer = { pFirst: string; pLast: string; dob: string; gFirst: string; gLast: string; email: string; phone: string };
const NEW_FIELDS: { k: keyof NewPlayer; label: string; kind: "text" | "email" | "date" | "phone" }[] = [
  { k: "pFirst", label: "Player's first name", kind: "text" },
  { k: "pLast", label: "Player's last name", kind: "text" },
  { k: "dob", label: "Player's date of birth", kind: "date" },
  { k: "gFirst", label: "Parent's first name", kind: "text" },
  { k: "gLast", label: "Parent's last name", kind: "text" },
  { k: "email", label: "Parent's email", kind: "email" },
  { k: "phone", label: "Parent's mobile", kind: "phone" },
];
/** "17032015" → "2015-03-17", or null while incomplete or impossible. */
function dobIso(digits: string): string | null {
  if (!/^\d{8}$/.test(digits)) return null;
  const d = Number(digits.slice(0, 2)), m = Number(digits.slice(2, 4)), y = Number(digits.slice(4));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function dobShow(digits: string) {
  const s = digits.padEnd(8, "·");
  return `${s.slice(0, 2)} / ${s.slice(2, 4)} / ${s.slice(4)}`;
}

interface Quote {
  options: { id: number; name: string; fullPriceCents: number; scheduleText?: string | null }[];
  terms: { id: number; name: string; year: number; ended: boolean; totalCents: number | null; prorataCents: number | null; sessionsRemaining: number | null; sessionsTotal: number | null; isProgrammeTerm: boolean }[];
}

function RegisterFlow({ programme, me, onCancel, onDone, onLocked }: { programme: Programme; me: TillMe; onCancel: () => void; onDone: (s: TillSale, note: string) => void; onLocked: () => void }) {
  const [step, setStep] = useState<"who" | "search" | "new" | "price" | "confirm" | "ask">("who");
  const [person, setPerson] = useState<TillPerson | null>(null);
  const [np, setNp] = useState<NewPlayer>({ pFirst: "", pLast: "", dob: "", gFirst: "", gLast: "", email: "", phone: "" });
  const [field, setField] = useState(0);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TillPerson[] | null>(null);
  const [optionId, setOptionId] = useState<number | null>(programme.options.length === 1 ? programme.options[0].id : null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [termId, setTermId] = useState<number | null>(null);
  const [prorata, setProrata] = useState(false);
  const [policy, setPolicy] = useState(false);
  // Answers the server asked for, kept so a second ask carries the first answer.
  const [extra, setExtra] = useState<{ referralSource?: string; deferReason?: string; acknowledgeAgeWarning?: boolean }>({});
  const [ask, setAsk] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Player search, debounced.
  useEffect(() => {
    if (step !== "search") return;
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    const t = setTimeout(() => {
      api<{ people: TillPerson[] }>("GET", `${T}/people?q=${encodeURIComponent(term)}`).then((r) => setResults(r.people)).catch((e) => (e?.status === 401 ? onLocked() : setErr(e?.message)));
    }, 300);
    return () => clearTimeout(t);
  }, [q, step]);

  // Prices for the chosen option, every term, from the office's own quote.
  useEffect(() => {
    if (step !== "price" || !optionId) return;
    setQuote(null);
    api<Quote>("GET", `${T}/quote?programId=${programme.id}&programOptionId=${optionId}`).then((r) => {
      setQuote(r);
      const sellable = r.terms.filter((t) => !t.ended && t.totalCents != null);
      setTermId((cur) => cur ?? (sellable.find((t) => t.isProgrammeTerm) ?? sellable[0])?.id ?? null);
    }).catch((e) => (e?.status === 401 ? onLocked() : setErr(e?.message)));
  }, [step, optionId]);

  const term = quote?.terms.find((t) => t.id === termId) ?? null;
  const price = term ? (prorata && term.prorataCents != null ? term.prorataCents : term.totalCents) : null;
  const playerName = person ? person.name : `${np.pFirst} ${np.pLast}`.trim();

  const submit = async (more: typeof extra = extra) => {
    setBusy(true); setErr(null);
    const body: any = {
      programId: programme.id, programOptionId: optionId, termId, priceMode: prorata ? "prorata" : "full", policyAccepted: policy, ...more,
    };
    if (person) body.personKey = person.key;
    else body.player = { firstName: np.pFirst, lastName: np.pLast, dateOfBirth: dobIso(np.dob) }, body.guardian = { firstName: np.gFirst, lastName: np.gLast, email: np.email, phone: np.phone };
    try {
      const r = await api<{ sale: TillSale; nzfMissing: string[] }>("POST", `${T}/registrations`, body);
      onDone(r.sale, `${playerName} added${r.nzfMissing?.length ? " · NZF details to follow up" : ""}`);
    } catch (e: any) {
      if (e?.status === 401) return onLocked();
      const code = e?.data?.code;
      if (code === "hdyhau_required" || code === "nzf_incomplete" || code === "age_warning") { setAsk({ code, message: e.message }); setStep("ask"); }
      else if (code === "no_guardian") { setPerson(null); setStep("new"); setErr(e.message); }
      else setErr(e?.message || "That didn't save.");
    } finally { setBusy(false); }
  };
  const answer = (patch: typeof extra) => { const next = { ...extra, ...patch }; setExtra(next); setAsk(null); setStep("confirm"); void submit(next); };

  const head = (title: string, back: () => void) => (
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold uppercase tracking-[0.16em] text-white/45">{programme.name}</div>
        <div className="mt-0.5 text-[21px] font-bold leading-tight">{title}</div>
      </div>
      <button onClick={back} className="h-11 shrink-0 rounded-full px-4 text-[14px] text-white/70 ring-1 ring-white/15">Back</button>
    </div>
  );
  const errBox = err && <div className="mx-4 mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-[13px] text-red-200">{err}</div>;

  if (step === "who") {
    return (
      <div className="counter-in flex h-full flex-col">
        {head("Who is it for?", onCancel)}
        <div className="mt-6 space-y-3 px-4">
          <button onClick={() => { setStep("search"); setErr(null); }} className="flex h-20 w-full flex-col items-start justify-center rounded-2xl bg-white px-5 text-left text-black" data-testid="till-existing">
            <span className="text-[17px] font-bold">Existing player</span><span className="text-[13px] text-black/60">Search by name — parent details come with them</span>
          </button>
          <button onClick={() => { setPerson(null); setField(0); setStep("new"); setErr(null); }} className="flex h-20 w-full flex-col items-start justify-center rounded-2xl bg-white/[0.08] px-5 text-left ring-1 ring-white/15" data-testid="till-new">
            <span className="text-[17px] font-bold">New player</span><span className="text-[13px] text-white/55">Type the player's and parent's details</span>
          </button>
        </div>
        {errBox}
      </div>
    );
  }

  if (step === "search") {
    return (
      <div className="flex h-full flex-col">
        {head("Find the player", () => setStep("who"))}
        <div className="mx-4 mt-3 flex min-h-[52px] items-center rounded-2xl bg-white px-4 text-[17px] font-medium text-black">
          {q || <span className="text-black/35">Player's name</span>}<span className="counter-pulse ml-0.5 inline-block h-5 w-[2px] bg-black" />
        </div>
        <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-4">
          {results?.map((p) => (
            <button key={p.key} onClick={() => { setPerson(p); setStep(programme.options.length > 1 && !optionId ? "price" : "price"); }} className="w-full rounded-2xl bg-white/[0.06] px-4 py-3 text-left ring-1 ring-white/10 active:bg-white/15" data-testid="till-person">
              <div className="text-[15.5px] font-semibold">{p.name}</div>
              <div className="text-[12.5px] text-white/55">{[p.hint, p.parents.length ? `Parent: ${p.parents.join(", ")}` : "No parent linked"].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
          {results && results.length === 0 && <div className="pt-3 text-center text-[14px] text-white/50">Nobody by that name. Try another spelling, or go back and add a new player.</div>}
          {errBox}
        </div>
        <div className="pb-4 pt-2"><Keyboard value={q} onChange={setQ} mode="text" max={60} /></div>
      </div>
    );
  }

  if (step === "new") {
    const f = NEW_FIELDS[field];
    const value = np[f.k];
    const set = (v: string) => setNp((s) => ({ ...s, [f.k]: v }));
    const valid = (k: keyof NewPlayer) => k === "dob" ? !!dobIso(np.dob) : k === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(np.email) : k === "phone" ? np.phone.replace(/\D/g, "").length >= 8 : np[k].trim().length >= 1;
    const allValid = NEW_FIELDS.every((x) => valid(x.k));
    return (
      <div className="flex h-full flex-col">
        {head("New player", () => (field > 0 ? setField(field - 1) : setStep("who")))}
        <div className="mt-3 flex gap-1 px-5">{NEW_FIELDS.map((x, i) => <span key={x.k} onClick={() => setField(i)} className={`h-1.5 flex-1 rounded-full ${i === field ? "bg-white" : valid(x.k) ? "bg-emerald-400/70" : "bg-white/15"}`} />)}</div>
        <div className="px-4 pt-4">
          <div className="text-[13px] text-white/60">{f.label}</div>
          <div className="mt-1.5 flex min-h-[56px] items-center break-all rounded-2xl bg-white px-4 py-3 text-[19px] font-medium text-black" data-testid="till-field">
            {f.kind === "date" ? <span className={value ? "" : "text-black/35"}>{dobShow(value)}</span> : value || <span className="text-black/35">{f.kind === "phone" ? "021 …" : "Type here"}</span>}
            {f.kind !== "date" && <span className="counter-pulse ml-0.5 inline-block h-5 w-[2px] bg-black" />}
          </div>
          {f.kind === "date" && value.length === 8 && !dobIso(value) && <div className="mt-1.5 text-[13px] text-red-300">That isn't a real date — day, month, then year.</div>}
          {errBox}
        </div>
        <div className="flex-1" />
        <div className="pb-2">
          {f.kind === "date" || f.kind === "phone"
            ? <NumPad value={value} onChange={set} max={f.kind === "date" ? 8 : 13} />
            : <Keyboard value={value} onChange={set} mode={f.kind === "email" ? "email" : "text"} max={f.kind === "email" ? 120 : 60} autoCap={f.kind === "text"} />}
        </div>
        <div className="px-3 pb-4 pt-1">
          {field < NEW_FIELDS.length - 1
            ? <button onClick={() => setField(field + 1)} disabled={!valid(f.k)} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-next-field">Next</button>
            : <button onClick={() => setStep("price")} disabled={!allValid} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40">{allValid ? "Choose the term" : "Fill in every field"}</button>}
        </div>
      </div>
    );
  }

  if (step === "price") {
    const sellable = quote?.terms.filter((t) => !t.ended && t.totalCents != null) ?? [];
    return (
      <div className="flex h-full flex-col">
        {head(playerName || "Price", () => setStep(person ? "search" : "new"))}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {programme.options.length > 1 && (
            <>
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">Age group</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {programme.options.map((o) => (
                  <button key={o.id} onClick={() => { setOptionId(o.id); setTermId(null); }} className={`min-h-[52px] rounded-xl px-3 text-[14px] font-semibold ring-1 ${o.id === optionId ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`}>{o.name}</button>
                ))}
              </div>
            </>
          )}
          {optionId && (
            <>
              <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">Term</div>
              {!quote && <div className="mt-2 text-[14px] text-white/50">Pricing…</div>}
              <div className="mt-2 space-y-2">
                {sellable.map((t) => (
                  <button key={t.id} onClick={() => { setTermId(t.id); setProrata(false); }} className={`flex min-h-[56px] w-full items-center justify-between rounded-xl px-4 ring-1 ${t.id === termId ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`}>
                    <span className="text-[15px] font-semibold">{t.name} {t.year}</span>
                    <span className="text-[15px] font-semibold tabular-nums">{$(t.totalCents!)}</span>
                  </button>
                ))}
                {quote && sellable.length === 0 && <div className="text-[14px] text-white/55">No term of this programme is on sale right now.</div>}
              </div>
              {term && term.prorataCents != null && term.prorataCents < (term.totalCents ?? 0) && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={() => setProrata(false)} className={`min-h-[56px] rounded-xl px-2 text-[13.5px] font-semibold ring-1 ${!prorata ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`}>Full term<br /><span className="tabular-nums">{$(term.totalCents!)}</span></button>
                  <button onClick={() => setProrata(true)} className={`min-h-[56px] rounded-xl px-2 text-[13.5px] font-semibold ring-1 ${prorata ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`}>Pro rata<br /><span className="tabular-nums">{$(term.prorataCents)}</span>{term.sessionsRemaining != null && <span className="font-normal opacity-70"> · {term.sessionsRemaining} left</span>}</button>
                </div>
              )}
            </>
          )}
          {errBox}
        </div>
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <button onClick={() => setStep("confirm")} disabled={!termId || price == null} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-price-next">{price != null ? `Next · ${$(price)}` : "Choose a term"}</button>
        </div>
      </div>
    );
  }

  if (step === "ask" && ask) {
    return (
      <div className="flex h-full flex-col">
        {head(ask.code === "hdyhau_required" ? "How did they hear about us?" : ask.code === "nzf_incomplete" ? "NZ Football details" : "Check the age group", () => { setAsk(null); setStep("confirm"); })}
        <div className="mt-2 px-5 text-[13.5px] leading-snug text-white/65">{ask.code === "nzf_incomplete" ? "NZ Football needs country of birth, nationality, ethnicity and address. Fill them in later from the player's profile — pick why they're missing:" : ask.message}</div>
        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {ask.code === "hdyhau_required" && HDYHAU_OPTIONS.filter((o) => o.value !== "other" && o.value !== "returning").map((o) => (
            <button key={o.value} onClick={() => answer({ referralSource: o.value })} className="h-13 min-h-[52px] w-full rounded-xl bg-white/[0.06] px-4 text-left text-[15px] font-semibold ring-1 ring-white/15 active:bg-white/15">{o.label}</button>
          ))}
          {ask.code === "nzf_incomplete" && IDENTITY_DEFER_REASONS.filter((r) => r !== "Other").map((r) => (
            <button key={r} onClick={() => answer({ deferReason: r })} className="min-h-[52px] w-full rounded-xl bg-white/[0.06] px-4 py-2 text-left text-[15px] font-semibold ring-1 ring-white/15 active:bg-white/15">{r}</button>
          ))}
          {ask.code === "age_warning" && (
            <>
              <button onClick={() => answer({ acknowledgeAgeWarning: true })} className="h-14 w-full rounded-2xl bg-amber-400 text-[16px] font-bold text-black">Register them anyway</button>
              <button onClick={() => setStep("price")} className="h-14 w-full rounded-2xl text-[15px] text-white/70 ring-1 ring-white/15">Choose another age group</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // confirm
  return (
    <div className="flex h-full flex-col">
      {head("Add to the sale", () => setStep("price"))}
      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-4">
        <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
          <div className="text-[17px] font-bold">{playerName}</div>
          <div className="mt-0.5 text-[13px] text-white/60">{person ? [person.hint, person.parents.length ? `Parent: ${person.parents.join(", ")}` : null].filter(Boolean).join(" · ") : `Parent: ${np.gFirst} ${np.gLast}`}</div>
          <div className="mt-3 flex items-end justify-between">
            <div className="text-[13.5px] text-white/70">{programme.options.find((o) => o.id === optionId)?.name}{term ? ` · ${term.name} ${term.year}` : ""}{prorata ? " · pro rata" : ""}</div>
            <div className="text-[22px] font-bold tabular-nums">{price != null ? $(price) : "—"}</div>
          </div>
        </div>
        <button onClick={() => setPolicy((p) => !p)} className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-4 text-left ring-1 ring-white/10">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-2 ${policy ? "bg-emerald-400 ring-emerald-400 text-black" : "ring-white/30"}`}>{policy ? "✓" : ""}</span>
          <span className="text-[13.5px] leading-snug text-white/80">The parent has agreed to the club's registration policy and NZ Football consent</span>
        </button>
        {errBox}
      </div>
      <div className="border-t border-white/10 px-4 pb-4 pt-3">
        <button onClick={() => submit()} disabled={busy} className="h-14 w-full rounded-2xl bg-emerald-400 text-[16px] font-bold text-black disabled:opacity-50" data-testid="till-register">{busy ? "Saving…" : "Add to sale"}</button>
        <div className="mt-2 text-center text-[12px] text-white/45">Served by {me.user.name}. The place is confirmed when the sale is paid.</div>
      </div>
    </div>
  );
}
