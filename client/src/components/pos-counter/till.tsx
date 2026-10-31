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
interface Programme {
  id: number; orgId: number; name: string; type: string; registrationOpen: boolean;
  options: { id: number; name: string; fullPriceCents: number }[];
  kind: "academy" | "camp"; fromCents: number; firstDate?: string; lastDate?: string;
}
/** The family the last registration was for, so the next child is two taps. */
export interface TillFamily { key?: string; guardian?: { firstName: string; lastName: string; email: string; phone: string }; name: string }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-12-21" → "Mon 21 Dec" — from the y-m-d parts, never through local time. */
function dayLabel(iso: string, withDay = true) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withDay ? `${wd} ` : ""}${d} ${MONTHS[m - 1]}`;
}
const PRODUCT_LABEL: Record<string, string> = { FULL_DAY: "Full day", MORNING: "Morning", AFTERNOON: "Afternoon", HALF_DAY: "Half day" };
const productLabel = (t: string) => PRODUCT_LABEL[t] ?? t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

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
  const [family, setFamily] = useState<TillFamily | null>(null);
  const [payOther, setPayOther] = useState(false);
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
    try { await api("POST", `${T}/sale/void`, {}); setSale(null); setCartOpen(false); setFamily(null); } catch (e) { handle(e); }
  };
  const charge = async () => {
    setBusy("charge"); setErr(null);
    // The page's 1-second poll flips to the pay screen once the payment exists.
    try { await api("POST", `${T}/sale/charge`, {}); setCartOpen(false); }
    catch (e) { handle(e); } finally { setBusy(null); }
  };

  const count = sale?.lines.reduce((a, l) => a + l.qty, 0) ?? 0;

  if (registering) {
    const done = (s: TillSale, note: string, fam: TillFamily | null) => { setSale(s); setRegistering(null); setToast(note); if (fam) { setFamily(fam); setTab("programmes"); } };
    const props = { programme: registering, me, family, onCancel: () => setRegistering(null), onDone: done, onLocked: () => till.lock("expired") };
    return registering.kind === "camp" ? <CampFlow {...props} /> : <RegisterFlow {...props} />;
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
            {family && (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-emerald-400/10 px-4 py-2.5 ring-1 ring-emerald-400/30" data-testid="till-family">
                <div className="min-w-0 text-[13px] leading-snug text-emerald-100">Next one for <b>{family.name}</b>? Pick a programme — their details carry over.</div>
                <button onClick={() => setFamily(null)} className="h-10 shrink-0 rounded-xl px-3 text-[12.5px] text-white/70 ring-1 ring-white/15">Someone else</button>
              </div>
            )}
            {programmes.map((p) => (
              <button key={p.id} onClick={() => setRegistering(p)} className="flex min-h-[60px] w-full items-center justify-between gap-3 rounded-2xl bg-white/[0.05] px-4 py-3 text-left ring-1 ring-white/10 active:bg-white/15" data-testid="till-programme">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-snug">{p.name}</div>
                  {p.kind === "camp" && p.firstDate && <div className="text-[12px] text-white/50">Holiday camp · {dayLabel(p.firstDate, false)} – {dayLabel(p.lastDate ?? p.firstDate, false)}</div>}
                  {p.kind === "academy" && !p.registrationOpen && <div className="text-[12px] text-amber-300/80">Invite only</div>}
                </div>
                <div className="shrink-0 text-[13px] text-white/60">from {$(p.fromCents)}{p.kind === "camp" ? "/day" : ""}</div>
              </button>
            ))}
            {catalogue && programmes.length === 0 && <div className="pt-6 text-center text-[14px] text-white/45">No programmes match.</div>}
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

      {payOther && sale && <PayOtherSheet sale={sale} handlesCash={me.handlesCash} onClose={() => setPayOther(false)} onPaid={() => { setPayOther(false); setCartOpen(false); setFamily(null); }} onLocked={() => till.lock("expired")} />}

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
            <button onClick={() => setPayOther(true)} className="mt-3 h-12 w-full rounded-2xl text-[14.5px] text-white/80 ring-1 ring-white/15" data-testid="till-pay-other">Paid another way — EFTPOS terminal, bank transfer…</button>
            <div className="mt-2 flex gap-2">
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
type Typed = { pFirst: string; pLast: string; dob: string; gFirst: string; gLast: string; email: string; phone: string };
const EMPTY: Typed = { pFirst: "", pLast: "", dob: "", gFirst: "", gLast: "", email: "", phone: "" };
type FieldDef = { k: keyof Typed; label: string; kind: "text" | "email" | "date" | "phone" };
const CHILD_FIELDS: FieldDef[] = [
  { k: "pFirst", label: "Child's first name", kind: "text" },
  { k: "pLast", label: "Child's last name", kind: "text" },
  { k: "dob", label: "Child's date of birth", kind: "date" },
];
const PARENT_FIELDS: FieldDef[] = [
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
  if (y < 1990 || `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` > new Date().toISOString().slice(0, 10)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const dobShow = (digits: string) => { const s = digits.padEnd(8, "·"); return `${s.slice(0, 2)} / ${s.slice(2, 4)} / ${s.slice(4)}`; };
const fieldValid = (t: Typed, k: keyof Typed) => k === "dob" ? !!dobIso(t.dob) : k === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t.email) : k === "phone" ? t.phone.replace(/\D/g, "").length >= 8 : t[k].trim().length >= 1;

function Head({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold uppercase tracking-[0.16em] text-white/45">{eyebrow}</div>
        <div className="mt-0.5 text-[21px] font-bold leading-tight">{title}</div>
      </div>
      <button onClick={onBack} className="h-11 shrink-0 rounded-full px-4 text-[14px] text-white/70 ring-1 ring-white/15">Back</button>
    </div>
  );
}
const ErrBox = ({ err }: { err: string | null }) => err ? <div className="mx-4 mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-[13px] text-red-200">{err}</div> : null;

/** One field at a time, with our own keyboard or number pad. */
function TypedFields({ eyebrow, title, fields, value, onChange, onBack, onFinish, finishLabel }: {
  eyebrow: string; title: string; fields: FieldDef[]; value: Typed; onChange: (t: Typed) => void; onBack: () => void; onFinish: () => void; finishLabel: string;
}) {
  const [i, setI] = useState(0);
  const f = fields[i];
  const v = value[f.k];
  const set = (x: string) => onChange({ ...value, [f.k]: x });
  const all = fields.every((x) => fieldValid(value, x.k));
  return (
    <div className="flex h-full flex-col">
      <Head eyebrow={eyebrow} title={title} onBack={() => (i > 0 ? setI(i - 1) : onBack())} />
      <div className="mt-3 flex gap-1 px-5">{fields.map((x, j) => <span key={x.k} onClick={() => setI(j)} className={`h-1.5 flex-1 rounded-full ${j === i ? "bg-white" : fieldValid(value, x.k) ? "bg-emerald-400/70" : "bg-white/15"}`} />)}</div>
      <div className="px-4 pt-4">
        <div className="text-[13px] text-white/60">{f.label}</div>
        <div className="mt-1.5 flex min-h-[56px] items-center break-all rounded-2xl bg-white px-4 py-3 text-[19px] font-medium text-black" data-testid="till-field">
          {f.kind === "date" ? <span className={v ? "" : "text-black/35"}>{dobShow(v)}</span> : v || <span className="text-black/35">{f.kind === "phone" ? "021 …" : "Type here"}</span>}
          {f.kind !== "date" && <span className="counter-pulse ml-0.5 inline-block h-5 w-[2px] bg-black" />}
        </div>
        {f.kind === "date" && v.length === 8 && !dobIso(v) && <div className="mt-1.5 text-[13px] text-red-300">That isn't a real date — day, month, then year.</div>}
      </div>
      <div className="flex-1" />
      <div className="pb-2">
        {f.kind === "date" || f.kind === "phone"
          ? <NumPad value={v} onChange={set} max={f.kind === "date" ? 8 : 13} />
          : <Keyboard value={v} onChange={set} mode={f.kind === "email" ? "email" : "text"} max={f.kind === "email" ? 120 : 60} autoCap={f.kind === "text"} />}
      </div>
      <div className="px-3 pb-4 pt-1">
        {i < fields.length - 1
          ? <button onClick={() => setI(i + 1)} disabled={!fieldValid(value, f.k)} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-next-field">Next</button>
          : <button onClick={onFinish} disabled={!all} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-fields-done">{all ? finishLabel : "Fill in every field"}</button>}
      </div>
    </div>
  );
}

/** Search a player by name. */
function PlayerSearch({ eyebrow, onBack, onPick, onLocked }: { eyebrow: string; onBack: () => void; onPick: (p: TillPerson) => void; onLocked: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TillPerson[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    const t = setTimeout(() => {
      api<{ people: TillPerson[] }>("GET", `${T}/people?q=${encodeURIComponent(term)}`).then((r) => setResults(r.people)).catch((e) => (e?.status === 401 ? onLocked() : setErr(e?.message)));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="flex h-full flex-col">
      <Head eyebrow={eyebrow} title="Find the player" onBack={onBack} />
      <div className="mx-4 mt-3 flex min-h-[52px] items-center rounded-2xl bg-white px-4 text-[17px] font-medium text-black">
        {q || <span className="text-black/35">Player's name</span>}<span className="counter-pulse ml-0.5 inline-block h-5 w-[2px] bg-black" />
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-4">
        {results?.map((p) => (
          <button key={p.key} onClick={() => onPick(p)} className="w-full rounded-2xl bg-white/[0.06] px-4 py-3 text-left ring-1 ring-white/10 active:bg-white/15" data-testid="till-person">
            <div className="text-[15.5px] font-semibold">{p.name}</div>
            <div className="text-[12.5px] text-white/55">{[p.hint, p.parents.length ? `Parent: ${p.parents.join(", ")}` : "No parent linked"].filter(Boolean).join(" · ")}</div>
          </button>
        ))}
        {results && results.length === 0 && <div className="pt-3 text-center text-[14px] text-white/50">Nobody by that name. Try another spelling, or go back and add them as new.</div>}
        <ErrBox err={err} />
      </div>
      <div className="pb-4 pt-2"><Keyboard value={q} onChange={setQ} mode="text" max={60} autoCap={false} /></div>
    </div>
  );
}

/** The server asked one more question. Answer it, and the registration is sent again. */
function AskScreen({ eyebrow, ask, onAnswer, onBack }: { eyebrow: string; ask: { code: string; message: string }; onAnswer: (patch: Record<string, unknown>) => void; onBack: () => void }) {
  const title = ask.code === "hdyhau_required" ? "How did they hear about us?" : ask.code === "nzf_incomplete" ? "NZ Football details" : ask.code === "already_registered" ? "Already booked" : "Check the age group";
  const row = "min-h-[52px] w-full rounded-xl bg-white/[0.06] px-4 py-2 text-left text-[15px] font-semibold ring-1 ring-white/15 active:bg-white/15";
  return (
    <div className="flex h-full flex-col">
      <Head eyebrow={eyebrow} title={title} onBack={onBack} />
      <div className="mt-2 px-5 text-[13.5px] leading-snug text-white/65">{ask.code === "nzf_incomplete" ? "NZ Football needs country of birth, nationality, ethnicity and address. Fill them in later from the player's profile — pick why they're missing:" : ask.code === "hdyhau_required" ? "A new family — ask them:" : ask.message}</div>
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {ask.code === "hdyhau_required" && HDYHAU_OPTIONS.filter((o) => o.value !== "other" && o.value !== "returning").map((o) => (
          <button key={o.value} onClick={() => onAnswer({ referralSource: o.value })} className={row}>{o.label}</button>
        ))}
        {ask.code === "nzf_incomplete" && IDENTITY_DEFER_REASONS.filter((r) => r !== "Other").map((r) => (
          <button key={r} onClick={() => onAnswer({ deferReason: r })} className={row}>{r}</button>
        ))}
        {ask.code === "age_warning" && (
          <>
            <button onClick={() => onAnswer({ acknowledgeAgeWarning: true })} className="h-14 w-full rounded-2xl bg-amber-400 text-[16px] font-bold text-black">Register them anyway</button>
            <button onClick={onBack} className="h-14 w-full rounded-2xl text-[15px] text-white/70 ring-1 ring-white/15">Go back and change it</button>
          </>
        )}
        {ask.code === "already_registered" && (
          <>
            <div className="rounded-2xl bg-amber-400/10 p-3 text-[13.5px] leading-snug text-amber-100">Check with the parent before taking money twice. Only go ahead if they really mean to book again.</div>
            <button onClick={onBack} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black">Go back</button>
            <button onClick={() => onAnswer({ acknowledgeDuplicate: true })} className="h-14 w-full rounded-2xl text-[15px] text-amber-200 ring-1 ring-amber-400/40">Book it again anyway</button>
          </>
        )}
      </div>
    </div>
  );
}

function PolicyTick({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-4 text-left ring-1 ring-white/10">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-2 ${on ? "bg-emerald-400 text-black ring-emerald-400" : "ring-white/30"}`}>{on ? "✓" : ""}</span>
      <span className="text-[13.5px] leading-snug text-white/80">The parent has agreed to the club's registration policy</span>
    </button>
  );
}

/** Send a registration; on a "needs one more answer" code, ask, then send again with the answers so far. */
function useRegistrationSubmit(onLocked: () => void) {
  const [ask, setAsk] = useState<{ code: string; message: string } | null>(null);
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (body: Record<string, unknown>, more = extra): Promise<{ sale: TillSale; nzfMissing: string[]; guardian?: { name: string } } | null> => {
    setBusy(true); setErr(null);
    try { return await api("POST", `${T}/registrations`, { ...body, ...more }); }
    catch (e: any) {
      if (e?.status === 401) { onLocked(); return null; }
      const code = e?.data?.code;
      if (["hdyhau_required", "nzf_incomplete", "age_warning", "already_registered"].includes(code)) setAsk({ code, message: e.message });
      else setErr(e?.message || "That didn't save.");
      return null;
    } finally { setBusy(false); }
  };
  const answer = (patch: Record<string, unknown>) => { const next = { ...extra, ...patch }; setExtra(next); setAsk(null); return next; };
  return { ask, setAsk, extra, busy, err, setErr, send, answer };
}

type FlowProps = { programme: Programme; me: TillMe; family: TillFamily | null; onCancel: () => void; onDone: (s: TillSale, note: string, family: TillFamily | null) => void; onLocked: () => void };

/** The family's children, from a person key — to pick a sibling. */
function useFamilyChildren(key: string | undefined) {
  const [kids, setKids] = useState<TillPerson[] | null>(null);
  useEffect(() => {
    if (!key) { setKids(null); return; }
    api<{ children: TillPerson[] }>("GET", `${T}/family/${encodeURIComponent(key)}`).then((r) => setKids(r.children)).catch(() => setKids([]));
  }, [key]);
  return kids;
}

// ── A term programme: one child per registration ────────────────────────────
interface Quote {
  options: { id: number; name: string; fullPriceCents: number }[];
  terms: { id: number; name: string; year: number; ended: boolean; totalCents: number | null; prorataCents: number | null; sessionsRemaining: number | null; isProgrammeTerm: boolean }[];
}

function RegisterFlow({ programme, me, family, onCancel, onDone, onLocked }: FlowProps) {
  const [step, setStep] = useState<"who" | "search" | "child" | "parent" | "price" | "confirm">("who");
  const [person, setPerson] = useState<TillPerson | null>(null);
  const [typed, setTyped] = useState<Typed>(EMPTY);
  // The family this child belongs to: the one carried over, or none (new family).
  const [fam, setFam] = useState<TillFamily | null>(family);
  const [optionId, setOptionId] = useState<number | null>(programme.options.length === 1 ? programme.options[0].id : null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [termId, setTermId] = useState<number | null>(null);
  const [prorata, setProrata] = useState(false);
  const [policy, setPolicy] = useState(false);
  const sub = useRegistrationSubmit(onLocked);
  const siblings = useFamilyChildren(fam?.key);

  useEffect(() => {
    if (step !== "price" || !optionId) return;
    setQuote(null);
    api<Quote>("GET", `${T}/quote?programId=${programme.id}&programOptionId=${optionId}`).then((r) => {
      setQuote(r);
      const sellable = r.terms.filter((t) => !t.ended && t.totalCents != null);
      setTermId((cur) => (cur && sellable.some((t) => t.id === cur) ? cur : (sellable.find((t) => t.isProgrammeTerm) ?? sellable[0])?.id ?? null));
    }).catch((e) => (e?.status === 401 ? onLocked() : sub.setErr(e?.message)));
  }, [step, optionId]);

  const term = quote?.terms.find((t) => t.id === termId) ?? null;
  const price = term ? (prorata && term.prorataCents != null ? term.prorataCents : term.totalCents) : null;
  const childName = person ? person.name : `${typed.pFirst} ${typed.pLast}`.trim();
  const parentName = fam ? fam.name : person ? person.parents[0] ?? "" : `${typed.gFirst} ${typed.gLast}`.trim();

  const body = () => {
    const b: Record<string, unknown> = { programId: programme.id, programOptionId: optionId, termId, priceMode: prorata ? "prorata" : "full", policyAccepted: policy };
    if (person) b.personKey = person.key;
    else b.player = { firstName: typed.pFirst, lastName: typed.pLast, dateOfBirth: dobIso(typed.dob) };
    if (fam?.key) b.guardianFromKey = fam.key;
    else if (fam?.guardian) b.guardian = fam.guardian;
    else if (!person) b.guardian = { firstName: typed.gFirst, lastName: typed.gLast, email: typed.email, phone: typed.phone };
    return b;
  };
  const submit = async (more?: Record<string, unknown>) => {
    const r = await sub.send(body(), more ?? sub.extra);
    if (!r) return;
    const next: TillFamily = fam ?? (person ? { key: person.key, name: person.parents[0] ?? r.guardian?.name ?? "the same family" } : { guardian: { firstName: typed.gFirst, lastName: typed.gLast, email: typed.email, phone: typed.phone }, name: `${typed.gFirst} ${typed.gLast}`.trim() });
    onDone(r.sale, `${childName} added${r.nzfMissing?.length ? " · NZF details to follow up" : ""}`, next);
  };

  const eyebrow = programme.name;
  if (sub.ask) return <AskScreen eyebrow={eyebrow} ask={sub.ask} onBack={() => { sub.setAsk(null); setStep(sub.ask?.code === "age_warning" ? "price" : "confirm"); }} onAnswer={(p) => { setStep("confirm"); void submit(sub.answer(p)); }} />;

  if (step === "who") {
    const big = "flex min-h-[76px] w-full flex-col items-start justify-center rounded-2xl px-5 py-3 text-left";
    return (
      <div className="counter-in flex h-full flex-col">
        <Head eyebrow={eyebrow} title="Who is it for?" onBack={onCancel} />
        <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {fam && (
            <>
              <div className="px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">{fam.name}'s family</div>
              {(siblings ?? []).map((c) => (
                <button key={c.key} onClick={() => { setPerson(c); setStep("price"); }} className={`${big} bg-white/[0.08] ring-1 ring-white/15`} data-testid="till-sibling">
                  <span className="text-[16px] font-bold">{c.name}</span>{c.hint && <span className="text-[12.5px] text-white/55">{c.hint}</span>}
                </button>
              ))}
              <button onClick={() => { setPerson(null); setTyped({ ...EMPTY }); setStep("child"); }} className={`${big} bg-white text-black`} data-testid="till-new-sibling">
                <span className="text-[16px] font-bold">A new child for {fam.name.split(" ")[0]}</span><span className="text-[12.5px] text-black/60">Just the child's name and birthday</span>
              </button>
              <button onClick={() => setFam(null)} className="h-12 w-full rounded-2xl text-[14px] text-white/60 ring-1 ring-white/15">Someone else</button>
            </>
          )}
          {!fam && (
            <>
              <button onClick={() => setStep("search")} className={`${big} bg-white text-black`} data-testid="till-existing">
                <span className="text-[17px] font-bold">Existing player</span><span className="text-[13px] text-black/60">Search by name — parent details come with them</span>
              </button>
              <button onClick={() => { setPerson(null); setTyped({ ...EMPTY }); setStep("child"); }} className={`${big} bg-white/[0.08] ring-1 ring-white/15`} data-testid="till-new">
                <span className="text-[17px] font-bold">New player</span><span className="text-[13px] text-white/55">Type the child's and parent's details</span>
              </button>
            </>
          )}
        </div>
        <ErrBox err={sub.err} />
      </div>
    );
  }
  if (step === "search") return <PlayerSearch eyebrow={eyebrow} onBack={() => setStep("who")} onLocked={onLocked} onPick={(p) => { setPerson(p); setStep("price"); }} />;
  if (step === "child") return <TypedFields key="child" eyebrow={eyebrow} title={fam ? `New child · ${fam.name}` : "New player"} fields={CHILD_FIELDS} value={typed} onChange={setTyped} onBack={() => setStep("who")} onFinish={() => setStep(fam ? "price" : "parent")} finishLabel={fam ? "Choose the term" : "Next: the parent"} />;
  if (step === "parent") return <TypedFields key="parent" eyebrow={eyebrow} title="The parent" fields={PARENT_FIELDS} value={typed} onChange={setTyped} onBack={() => setStep("child")} onFinish={() => setStep("price")} finishLabel="Choose the term" />;

  if (step === "price") {
    const sellable = quote?.terms.filter((t) => !t.ended && t.totalCents != null) ?? [];
    const chip = (on: boolean) => `ring-1 ${on ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`;
    return (
      <div className="flex h-full flex-col">
        <Head eyebrow={eyebrow} title={childName || "Price"} onBack={() => setStep(person ? (fam ? "who" : "search") : fam ? "child" : "parent")} />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {programme.options.length > 1 && (
            <>
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">Age group</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {programme.options.map((o) => <button key={o.id} onClick={() => { setOptionId(o.id); setProrata(false); }} className={`min-h-[52px] rounded-xl px-3 text-[14px] font-semibold ${chip(o.id === optionId)}`}>{o.name}</button>)}
              </div>
            </>
          )}
          {optionId && (
            <>
              <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">Term</div>
              {!quote && <div className="mt-2 text-[14px] text-white/50">Pricing…</div>}
              <div className="mt-2 space-y-2">
                {sellable.map((t) => (
                  <button key={t.id} onClick={() => { setTermId(t.id); setProrata(false); }} className={`flex min-h-[56px] w-full items-center justify-between rounded-xl px-4 ${chip(t.id === termId)}`}>
                    <span className="text-[15px] font-semibold">{t.name} {t.year}</span><span className="text-[15px] font-semibold tabular-nums">{$(t.totalCents!)}</span>
                  </button>
                ))}
                {quote && sellable.length === 0 && <div className="text-[14px] text-white/55">No term of this programme is on sale right now.</div>}
              </div>
              {term && term.prorataCents != null && term.prorataCents < (term.totalCents ?? 0) && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={() => setProrata(false)} className={`min-h-[56px] rounded-xl px-2 text-[13.5px] font-semibold ${chip(!prorata)}`}>Full term<br /><span className="tabular-nums">{$(term.totalCents!)}</span></button>
                  <button onClick={() => setProrata(true)} className={`min-h-[56px] rounded-xl px-2 text-[13.5px] font-semibold ${chip(prorata)}`}>Pro rata<br /><span className="tabular-nums">{$(term.prorataCents)}</span>{term.sessionsRemaining != null && <span className="font-normal opacity-70"> · {term.sessionsRemaining} left</span>}</button>
                </div>
              )}
            </>
          )}
          <ErrBox err={sub.err} />
        </div>
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <button onClick={() => setStep("confirm")} disabled={!termId || price == null} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-price-next">{price != null ? `Next · ${$(price)}` : "Choose a term"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Head eyebrow={eyebrow} title="Add to the sale" onBack={() => setStep("price")} />
      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-4">
        <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
          <div className="text-[17px] font-bold">{childName}</div>
          <div className="mt-0.5 text-[13px] text-white/60">{[person?.hint, parentName ? `Parent: ${parentName}` : null].filter(Boolean).join(" · ")}</div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-[13.5px] text-white/70">{programme.options.find((o) => o.id === optionId)?.name}{term ? ` · ${term.name} ${term.year}` : ""}{prorata ? " · pro rata" : ""}</div>
            <div className="text-[22px] font-bold tabular-nums">{price != null ? $(price) : "—"}</div>
          </div>
        </div>
        <PolicyTick on={policy} onToggle={() => setPolicy((p) => !p)} />
        <ErrBox err={sub.err} />
      </div>
      <div className="border-t border-white/10 px-4 pb-4 pt-3">
        <button onClick={() => submit()} disabled={sub.busy} className="h-14 w-full rounded-2xl bg-emerald-400 text-[16px] font-bold text-black disabled:opacity-50" data-testid="till-register">{sub.busy ? "Saving…" : "Add to sale"}</button>
        <div className="mt-2 text-center text-[12px] text-white/45">Served by {me.user.name}. The place is confirmed when the sale is paid.</div>
      </div>
    </div>
  );
}

// ── A holiday camp: one parent, one or more children, the days ──────────────
interface CampInfo { name: string; pricing: { productType: string; priceCents: number }[]; dates: { id: number; date: string; name: string | null }[]; discounts: { minBookings: number; discountPercent: number }[] }
type CampChild = { key?: string; name: string; firstName?: string; lastName?: string; dateOfBirth?: string };

function CampFlow({ programme, me, family, onCancel, onDone, onLocked }: FlowProps) {
  const [step, setStep] = useState<"who" | "search" | "kids" | "child" | "parent" | "days" | "confirm">(family ? "kids" : "who");
  const [fam, setFam] = useState<TillFamily | null>(family);
  const [kids, setKids] = useState<CampChild[]>([]);
  const [typed, setTyped] = useState<Typed>(EMPTY);
  const [camp, setCamp] = useState<CampInfo | null>(null);
  const [days, setDays] = useState<Record<number, string>>({});
  const [medical, setMedical] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState(false);
  const sub = useRegistrationSubmit(onLocked);
  const known = useFamilyChildren(fam?.key);

  useEffect(() => { api<CampInfo>("GET", `${T}/camp/${programme.id}`).then(setCamp).catch((e) => (e?.status === 401 ? onLocked() : sub.setErr(e?.message))); }, []);

  const eyebrow = programme.name;
  const dayCount = Object.keys(days).length;
  const perChild = Object.values(days).reduce((a, t) => a + (camp?.pricing.find((p) => p.productType === t)?.priceCents ?? 0), 0);
  const bookings = dayCount * kids.length;
  const disc = (camp?.discounts ?? []).filter((x) => bookings >= x.minBookings).sort((a, b) => b.discountPercent - a.discountPercent)[0];
  const estimate = Math.round(perChild * kids.length * (1 - (disc?.discountPercent ?? 0) / 100));
  const newKids = kids.some((k) => !k.key);
  const parentName = fam?.name ?? `${typed.gFirst} ${typed.gLast}`.trim();
  const toggleKid = (c: TillPerson) => setKids((ks) => ks.some((k) => k.key === c.key) ? ks.filter((k) => k.key !== c.key) : [...ks, { key: c.key, name: c.name }]);

  const submit = async (more?: Record<string, unknown>) => {
    const body: Record<string, unknown> = {
      programId: programme.id, policyAccepted: policy, medicalToFollow: medical === true,
      days: Object.entries(days).map(([id, t]) => ({ campDateId: Number(id), productType: t })),
      children: kids.map((k) => (k.key ? { key: k.key } : { firstName: k.firstName, lastName: k.lastName, dateOfBirth: k.dateOfBirth })),
    };
    if (fam?.key) body.guardianFromKey = fam.key;
    else if (fam?.guardian) body.guardian = fam.guardian;
    else body.guardian = { firstName: typed.gFirst, lastName: typed.gLast, email: typed.email, phone: typed.phone };
    const r = await sub.send(body, more ?? sub.extra);
    if (!r) return;
    const next: TillFamily = fam ?? { guardian: { firstName: typed.gFirst, lastName: typed.gLast, email: typed.email, phone: typed.phone }, name: parentName };
    onDone(r.sale, `${kids.map((k) => k.name.split(" ")[0]).join(" + ")} booked · ${dayCount} day${dayCount === 1 ? "" : "s"}`, next);
  };

  if (sub.ask) return <AskScreen eyebrow={eyebrow} ask={sub.ask} onBack={() => { sub.setAsk(null); setStep(sub.ask?.code === "already_registered" ? "days" : "confirm"); }} onAnswer={(p) => { setStep("confirm"); void submit(sub.answer(p)); }} />;

  if (step === "who") {
    return (
      <div className="counter-in flex h-full flex-col">
        <Head eyebrow={eyebrow} title="Who's coming?" onBack={onCancel} />
        <div className="mt-5 space-y-3 px-4">
          <button onClick={() => setStep("search")} className="flex min-h-[76px] w-full flex-col items-start justify-center rounded-2xl bg-white px-5 text-left text-black" data-testid="till-existing">
            <span className="text-[17px] font-bold">A family we know</span><span className="text-[13px] text-black/60">Search one child — brothers and sisters come with them</span>
          </button>
          <button onClick={() => { setKids([]); setTyped({ ...EMPTY }); setStep("parent"); }} className="flex min-h-[76px] w-full flex-col items-start justify-center rounded-2xl bg-white/[0.08] px-5 text-left ring-1 ring-white/15" data-testid="till-new">
            <span className="text-[17px] font-bold">New family</span><span className="text-[13px] text-white/55">Type the parent, then each child</span>
          </button>
        </div>
        <ErrBox err={sub.err} />
      </div>
    );
  }
  if (step === "search") return <PlayerSearch eyebrow={eyebrow} onBack={() => setStep("who")} onLocked={onLocked} onPick={(p) => { setFam({ key: p.key, name: p.parents[0] ?? "this family" }); setKids([{ key: p.key, name: p.name }]); setStep("kids"); }} />;
  if (step === "parent") return <TypedFields key="camp-parent" eyebrow={eyebrow} title="The parent" fields={PARENT_FIELDS} value={typed} onChange={setTyped} onBack={() => setStep("who")} onFinish={() => { setFam(null); setTyped((t) => ({ ...t, pFirst: "", pLast: t.gLast, dob: "" })); setStep("child"); }} finishLabel="Next: the first child" />;
  if (step === "child") {
    return <TypedFields key={`camp-child-${kids.length}`} eyebrow={eyebrow} title={`Child ${kids.length + 1}`} fields={CHILD_FIELDS} value={typed} onChange={setTyped} onBack={() => setStep(kids.length ? "kids" : fam ? "kids" : "parent")} finishLabel="Add this child"
      onFinish={() => { setKids((k) => [...k, { name: `${typed.pFirst} ${typed.pLast}`.trim(), firstName: typed.pFirst, lastName: typed.pLast, dateOfBirth: dobIso(typed.dob)! }]); setTyped((t) => ({ ...t, pFirst: "", pLast: typed.pLast, dob: "" })); setStep("kids"); }} />;
  }

  if (step === "kids") {
    const tick = (on: boolean) => <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-2 ${on ? "bg-emerald-400 text-black ring-emerald-400" : "ring-white/30"}`}>{on ? "✓" : ""}</span>;
    return (
      <div className="flex h-full flex-col">
        <Head eyebrow={eyebrow} title="Which children?" onBack={() => (fam?.key && !family ? setStep("search") : family ? onCancel() : setStep("parent"))} />
        {parentName && <div className="mt-1 px-5 text-[13px] text-white/55">Parent: {parentName}</div>}
        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto px-4">
          {(known ?? []).map((c) => {
            const on = kids.some((k) => k.key === c.key);
            return (
              <button key={c.key} onClick={() => toggleKid(c)} className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 text-left ring-1 ring-white/10" data-testid="till-kid">
                {tick(on)}<div className="min-w-0"><div className="text-[15.5px] font-semibold">{c.name}</div>{c.hint && <div className="text-[12.5px] text-white/55">{c.hint}</div>}</div>
              </button>
            );
          })}
          {kids.filter((k) => !k.key).map((k, i) => (
            <div key={`n${i}`} className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 ring-1 ring-white/10">
              {tick(true)}<div className="min-w-0 flex-1"><div className="text-[15.5px] font-semibold">{k.name}</div><div className="text-[12.5px] text-white/55">New · born {k.dateOfBirth?.slice(0, 4)}</div></div>
              <button onClick={() => setKids((ks) => ks.filter((x) => x !== k))} className="h-10 w-10 rounded-xl bg-white/[0.08]" aria-label="Remove">✕</button>
            </div>
          ))}
          <button onClick={() => { setTyped((t) => ({ ...t, pFirst: "", pLast: kids.find((k) => !k.key)?.lastName ?? (fam ? "" : t.gLast), dob: "" })); setStep("child"); }} className="h-14 w-full rounded-2xl text-[15px] font-semibold text-white/85 border border-dashed border-white/25" data-testid="till-add-child">+ Add {kids.length ? "another" : "a"} child</button>
        </div>
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <button onClick={() => setStep("days")} disabled={!kids.length} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-kids-next">{kids.length ? `Choose days · ${kids.length} child${kids.length === 1 ? "" : "ren"}` : "Pick at least one child"}</button>
        </div>
      </div>
    );
  }

  if (step === "days") {
    const types = camp?.pricing ?? [];
    const allSame = (t: string) => setDays(Object.fromEntries((camp?.dates ?? []).map((d) => [d.id, t])));
    return (
      <div className="flex h-full flex-col">
        <Head eyebrow={eyebrow} title="Which days?" onBack={() => setStep("kids")} />
        <div className="mt-1 px-5 text-[13px] text-white/55">The same days for {kids.length === 1 ? kids[0].name.split(" ")[0] : `all ${kids.length} children`}.</div>
        {!camp && <div className="px-5 pt-4 text-[14px] text-white/50">Loading days…</div>}
        {camp && (
          <div className="mt-3 flex gap-2 px-4">
            {types.map((t) => <button key={t.productType} onClick={() => allSame(t.productType)} className="h-11 flex-1 rounded-xl bg-white/[0.08] text-[13px] font-semibold ring-1 ring-white/15">Every day · {productLabel(t.productType)}</button>)}
            {dayCount > 0 && <button onClick={() => setDays({})} className="h-11 shrink-0 rounded-xl px-3 text-[13px] text-white/60 ring-1 ring-white/15">Clear</button>}
          </div>
        )}
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3">
          {camp?.dates.map((d) => (
            <div key={d.id} className="rounded-2xl bg-white/[0.04] p-2.5 ring-1 ring-white/10">
              <div className="px-1 pb-2 text-[14px] font-semibold">{dayLabel(d.date)}{d.name ? <span className="font-normal text-white/50"> · {d.name}</span> : null}</div>
              <div className="flex gap-2">
                {types.map((t) => {
                  const on = days[d.id] === t.productType;
                  return (
                    <button key={t.productType} onClick={() => setDays((x) => { const n = { ...x }; if (on) delete n[d.id]; else n[d.id] = t.productType; return n; })}
                      className={`h-12 flex-1 rounded-xl text-[13.5px] font-semibold ring-1 ${on ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`} data-testid="till-day">
                      {productLabel(t.productType)} · {$(t.priceCents)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {camp && camp.dates.length === 0 && <div className="text-[14px] text-white/55">This camp has no days left.</div>}
          <ErrBox err={sub.err} />
        </div>
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <button onClick={() => setStep("confirm")} disabled={!dayCount} className="h-14 w-full rounded-2xl bg-white text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-days-next">{dayCount ? `Next · ${dayCount} day${dayCount === 1 ? "" : "s"} · about ${$(estimate)}` : "Pick at least one day"}</button>
        </div>
      </div>
    );
  }

  // confirm
  return (
    <div className="flex h-full flex-col">
      <Head eyebrow={eyebrow} title="Add to the sale" onBack={() => setStep("days")} />
      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-4">
        <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
          <div className="text-[17px] font-bold">{kids.map((k) => k.name).join(", ")}</div>
          <div className="mt-0.5 text-[13px] text-white/60">Parent: {parentName}</div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-[13.5px] text-white/70">{dayCount} day{dayCount === 1 ? "" : "s"} × {kids.length} child{kids.length === 1 ? "" : "ren"}{disc ? ` · ${disc.discountPercent}% multi-day` : ""}</div>
            <div className="text-[22px] font-bold tabular-nums">{$(estimate)}</div>
          </div>
          <div className="mt-1 text-[11.5px] text-white/40">The sale shows the exact amount ClubOS charges.</div>
        </div>
        {newKids && (
          <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
            <div className="text-[13.5px] text-white/80">Any allergies or medical needs for the new {kids.filter((k) => !k.key).length === 1 ? "child" : "children"}?</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => setMedical(false)} className={`h-12 rounded-xl text-[14px] font-semibold ring-1 ${medical === false ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`}>None</button>
              <button onClick={() => setMedical(true)} className={`h-12 rounded-xl text-[14px] font-semibold ring-1 ${medical === true ? "bg-amber-400 text-black ring-amber-400" : "bg-white/[0.06] ring-white/15"}`}>Yes — follow up</button>
            </div>
            {medical === true && <div className="mt-2 text-[12px] leading-snug text-amber-200/90">Not typed on this screen. The booking is flagged so the details are added to the child's profile before the camp.</div>}
          </div>
        )}
        <PolicyTick on={policy} onToggle={() => setPolicy((p) => !p)} />
        <ErrBox err={sub.err} />
      </div>
      <div className="border-t border-white/10 px-4 pb-4 pt-3">
        <button onClick={() => submit()} disabled={sub.busy || (newKids && medical === null)} className="h-14 w-full rounded-2xl bg-emerald-400 text-[16px] font-bold text-black disabled:opacity-50" data-testid="till-register">{sub.busy ? "Saving…" : newKids && medical === null ? "Answer the medical question" : "Add to sale"}</button>
        <div className="mt-2 text-center text-[12px] text-white/45">Served by {me.user.name}. The booking is confirmed when the sale is paid.</div>
      </div>
    </div>
  );
}

// ── Paid another way ────────────────────────────────────────────────────────
// An eftpos-only card the reader cannot take (Stripe doesn't run on NZ's
// domestic eftpos rails): the customer pays on the bank's EFTPOS terminal and
// staff record the slip number here. Cash only where the register takes it.
function PayOtherSheet({ sale, handlesCash, onClose, onPaid, onLocked }: { sale: TillSale; handlesCash: boolean; onClose: () => void; onPaid: () => void; onLocked: () => void }) {
  const methods = [
    { value: "eftpos", label: "EFTPOS terminal", ref: "Slip number" },
    { value: "bank_transfer", label: "Bank transfer", ref: "Transfer reference" },
    ...(handlesCash ? [{ value: "cash", label: "Cash", ref: "" }] : []),
    { value: "other", label: "Other", ref: "What it was" },
  ];
  const [method, setMethod] = useState("eftpos");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = methods.find((x) => x.value === method)!;
  const numeric = method === "eftpos";
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api("POST", `${T}/sale/pay-other`, { method, reference: ref }); onPaid(); }
    catch (e: any) { if (e?.status === 401) onLocked(); else setErr(e?.message || "Couldn't record that."); }
    finally { setBusy(false); }
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#07090c]">
      {/* 🔴 Sized for the S710's 640px: a two-line title and two rows of
          choices pushed the Record button under the number pad. */}
      <Head eyebrow={`${sale.number} · ${$(sale.remainingCents)}`} title="Paid another way" onBack={onClose} />
      <div className={`mt-3 grid gap-1.5 px-4 ${methods.length > 3 ? "grid-cols-4" : "grid-cols-3"}`}>
        {methods.map((x) => <button key={x.value} onClick={() => { setMethod(x.value); setRef(""); }} className={`h-11 rounded-xl px-1 text-[12.5px] font-semibold leading-tight ring-1 ${x.value === method ? "bg-white text-black ring-white" : "bg-white/[0.06] ring-white/15"}`}>{x.value === "eftpos" ? "EFTPOS" : x.label}</button>)}
      </div>
      {method === "eftpos" && <div className="mx-4 mt-2 text-[12px] leading-snug text-white/55">Key {$(sale.remainingCents)} into the bank's EFTPOS terminal, wait for APPROVED, then type the slip number.</div>}
      {m.ref && (
        <div className="px-4 pt-2">
          <div className="flex min-h-[48px] items-center break-all rounded-2xl bg-white px-4 text-[18px] font-medium text-black">{ref || <span className="text-black/35">{m.ref}</span>}</div>
        </div>
      )}
      <ErrBox err={err} />
      <div className="flex-1" />
      {m.ref && <div className="pb-2">{numeric ? <NumPad value={ref} onChange={setRef} max={20} /> : <Keyboard value={ref} onChange={setRef} mode="text" max={60} />}</div>}
      <div className="px-3 pb-4 pt-1">
        <button onClick={save} disabled={busy || (!!m.ref && method !== "other" && !ref.trim())} className="h-14 w-full rounded-2xl bg-emerald-400 text-[16px] font-bold text-black disabled:opacity-40" data-testid="till-pay-other-save">{busy ? "Saving…" : `Record ${$(sale.remainingCents)} paid`}</button>
      </div>
    </div>
  );
}
