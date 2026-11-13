import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Check, Minus, Plus, Share, X, Loader2 } from "lucide-react";
import { WELLNESS_ITEMS, SORE_AREAS } from "@shared/performance";

// SIU Performance Hub, the player's phone. Public routes, cookie session.
// Plain fetch with credentials: these are NOT admin routes, no workspace header.

const API = "/api/public/athlete";
const C = { bg: "#0B0B0B", card: "#141414", line: "rgba(255,255,255,0.08)", ink: "#F5F1E8", mute: "rgba(245,241,232,0.6)", gold: "#C59949", pine: "#1F3D2B" };

interface CheckIn { date: string; sleep: number | null; fatigue: number | null; soreness: number | null; stress: number | null; mood: number | null; sleepHours: number | null; medicalFlag: boolean | null; note: string | null; soreAreas: string[] }
interface Me {
  today: string; firstName: string; lastName: string; position: string | null; availability: string;
  todayCheckIn: CheckIn | null; history: { date: string; score: number | null; sleepHours: number | null }[];
  rpe: { date: string; kind: string; rpe: number; minutes: number | null }[]; streak: number;
}

async function call(path: string, method: "GET" | "POST", body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    method, credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

// ISO helpers by parts. Never new Date(iso) (local time shifts the day).
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function parts(iso: string) { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; }
function longDate(iso: string) { const { y, m, d } = parts(iso); return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`; }
function shortDate(iso: string) { const { m, d } = parts(iso); return `${d} ${MONTHS[m - 1].slice(0, 3)}`; }
function dayBefore(iso: string) { const { y, m, d } = parts(iso); return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10); }

const AVAIL: Record<string, string> = { available: "Available", modified: "Modified training", limited: "Modified training", injured: "Injured", unavailable: "Not available", ill: "Unwell", rehab: "Rehab" };

const CR10: Record<number, string> = { 0: "Rest", 1: "Very easy", 2: "Easy", 3: "Moderate", 4: "Somewhat hard", 5: "Hard", 6: "", 7: "Very hard", 8: "", 9: "Very very hard", 10: "Maximal" };
const KINDS = [["training", "Training"], ["match", "Match"], ["gym", "Gym"], ["other", "Other"]] as const;
const SCALE_TINT = ["#C0504D", "#C98A4B", "#C59949", "#8FA85A", "#4F9A66"];

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100dvh" }} className="w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-md px-4 pt-6" style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>{children}</div>
    </div>
  );
}
function Crest({ size = 56 }: { size?: number }) {
  return <img src="/logos/south-island-united.png" alt="South Island United" width={size} height={size} style={{ height: size, width: "auto", objectFit: "contain" }} />;
}
function Card({ title, children, innerRef }: { title: string; children: ReactNode; innerRef?: React.Ref<HTMLElement> }) {
  return (
    <section ref={innerRef} className="mt-4 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Btn({ children, onClick, disabled, kind = "primary", type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: "primary" | "ghost"; type?: "button" | "submit" }) {
  const primary = kind === "primary";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold disabled:opacity-50"
      style={primary ? { background: C.gold, color: "#0B0B0B" } : { background: "transparent", color: C.ink, border: `1px solid ${C.line}` }}>
      {children}
    </button>
  );
}
const Msg = ({ kind, children }: { kind: "ok" | "err"; children: ReactNode }) => (
  <p role={kind === "err" ? "alert" : "status"} className="mt-3 rounded-lg px-3 py-2 text-sm"
    style={kind === "ok" ? { background: C.pine, color: C.ink } : { background: "rgba(192,80,77,0.18)", color: "#F2B8B5" }}>{children}</p>
);
const inputStyle = { background: "#0B0B0B", border: `1px solid ${C.line}`, color: C.ink, minHeight: 48 } as const;
const inputCls = "w-full rounded-xl px-3 text-base outline-none focus:ring-2 focus:ring-[#C59949]";

function Stepper({ value, onChange, min, max, step, label, unit }: { value: number; onChange: (n: number) => void; min: number; max: number; step: number; label: string; unit?: string }) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n * 10) / 10)));
  const b = "flex h-12 w-12 items-center justify-center rounded-xl";
  return (
    <div className="flex items-center justify-between gap-3">
      <button type="button" aria-label={`Less ${label}`} className={b} style={{ border: `1px solid ${C.line}`, background: "#0B0B0B" }} onClick={() => set(value - step)}><Minus size={20} /></button>
      <div className="text-center text-2xl font-semibold tabular-nums">{value}<span className="ml-1 text-sm font-normal" style={{ color: C.mute }}>{unit}</span></div>
      <button type="button" aria-label={`More ${label}`} className={b} style={{ border: `1px solid ${C.line}`, background: "#0B0B0B" }} onClick={() => set(value + step)}><Plus size={20} /></button>
    </div>
  );
}
function Chip({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="min-h-[44px] rounded-full px-4 text-sm font-medium"
      style={on ? { background: C.gold, color: "#0B0B0B", border: `1px solid ${C.gold}` } : { background: "#0B0B0B", color: C.ink, border: `1px solid ${C.line}` }}>{children}</button>
  );
}

// ─── Sign in ────────────────────────────────────────────────────────────────
function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await call("/sign-in", "POST", { email, password });
      if (r.status === 200) onDone(); else setErr(r.data?.message ?? "Could not sign in. Try again.");
    } catch { setErr("No connection. Try again."); }
    setBusy(false);
  };
  const link = async () => {
    if (!email.trim()) { setErr("Type your email first."); return; }
    setBusy(true); setErr(null); setInfo(null);
    try { const r = await call("/request-link", "POST", { email }); setInfo(r.data?.message ?? "If that email is on our list, a link is on its way."); }
    catch { setErr("No connection. Try again."); }
    setBusy(false);
  };
  return (
    <Shell>
      <div className="flex flex-col items-center pt-8 text-center"><Crest size={84} /><h1 className="mt-4 text-2xl font-semibold">Player check-in</h1>
        <p className="mt-1 text-sm" style={{ color: C.mute }}>Takes 30 seconds. Only SIU performance staff see your answers.</p></div>
      <form onSubmit={submit} className="mt-6 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
        <label className="block text-sm" style={{ color: C.mute }}>Email
          <input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} style={inputStyle} /></label>
        <label className="mt-3 block text-sm" style={{ color: C.mute }}>Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputCls} mt-1`} style={inputStyle} /></label>
        <div className="mt-4"><Btn type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18} /> : null}Sign in</Btn></div>
        {err && <Msg kind="err">{err}</Msg>}{info && <Msg kind="ok">{info}</Msg>}
      </form>
      <button type="button" onClick={link} disabled={busy} className="mt-4 min-h-[44px] w-full text-center text-sm underline" style={{ color: C.gold }}>
        Forgot password or first time? Email me a link</button>
    </Shell>
  );
}

// ─── Morning check-in form ──────────────────────────────────────────────────
type Answers = Record<string, number | null>;
function WellnessCard({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const done = me.todayCheckIn;
  const [editing, setEditing] = useState(false);
  const [ans, setAns] = useState<Answers>({});
  const [hours, setHours] = useState(8);
  const [hoursSet, setHoursSet] = useState(false);
  const [sore, setSore] = useState<string[]>([]);
  const [flag, setFlag] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false);

  const startEdit = () => {
    if (done) {
      setAns({ sleep: done.sleep, fatigue: done.fatigue, soreness: done.soreness, stress: done.stress, mood: done.mood });
      setHours(done.sleepHours ?? 8); setHoursSet(done.sleepHours != null); setSore(done.soreAreas ?? []); setFlag(!!done.medicalFlag); setNote(done.note ?? "");
    }
    setOk(false); setEditing(true);
  };
  const submit = async () => {
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = { soreAreas: sore, medicalFlag: flag, note: note.trim() || undefined };
    for (const i of WELLNESS_ITEMS) if (ans[i.key] != null) body[i.key] = ans[i.key];
    if (hoursSet) body.sleepHours = hours;
    try {
      const r = await call("/wellness", "POST", body);
      if (r.status === 200) { setEditing(false); setOk(true); await onSaved(); } else setErr(r.data?.message ?? "Could not save. Try again.");
    } catch { setErr("No connection. Try again."); }
    setBusy(false);
  };

  if (done && !editing) {
    return (
      <Card title="Morning check-in">
        <p className="flex items-center gap-2 font-medium" style={{ color: "#8FC99B" }}><Check size={18} /> Done. Thanks.</p>
        {ok && <Msg kind="ok">Saved.</Msg>}
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          {WELLNESS_ITEMS.map((i) => (<div key={i.key} className="flex justify-between"><dt style={{ color: C.mute }}>{i.label}</dt><dd className="font-semibold tabular-nums">{done[i.key] ?? "–"}</dd></div>))}
          <div className="flex justify-between"><dt style={{ color: C.mute }}>Sleep</dt><dd className="font-semibold">{done.sleepHours != null ? `${done.sleepHours} h` : "–"}</dd></div>
        </dl>
        {done.soreAreas?.length > 0 && <p className="mt-2 text-sm" style={{ color: C.mute }}>Sore: {done.soreAreas.join(", ")}</p>}
        <div className="mt-4"><Btn kind="ghost" onClick={startEdit}>Edit</Btn></div>
      </Card>
    );
  }
  return (
    <Card title="Morning check-in">
      <p className="mb-3 text-sm" style={{ color: C.mute }}>Tap one number for each. 5 is best. You can skip any.</p>
      {WELLNESS_ITEMS.map((i) => (
        <div key={i.key} className="mb-4">
          <p className="mb-1.5 text-sm font-medium">{i.label}</p>
          <div className="grid grid-cols-5 gap-2" role="group" aria-label={i.label}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = ans[i.key] === n;
              return (
                <button key={n} type="button" aria-pressed={on} onClick={() => setAns((a) => ({ ...a, [i.key]: on ? null : n }))}
                  className="min-h-[52px] rounded-xl text-lg font-semibold tabular-nums"
                  style={on ? { background: SCALE_TINT[n - 1], color: "#0B0B0B", border: `2px solid ${C.ink}` } : { background: "#0B0B0B", color: C.ink, border: `1px solid ${C.line}`, borderBottom: `3px solid ${SCALE_TINT[n - 1]}` }}>{n}</button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-xs" style={{ color: C.mute }}><span>1 {i.low}</span><span>5 {i.high}</span></div>
        </div>
      ))}
      <p className="mb-1.5 text-sm font-medium">Hours of sleep</p>
      <div onClick={() => setHoursSet(true)}><Stepper value={hours} onChange={(n) => { setHours(n); setHoursSet(true); }} min={0} max={16} step={0.5} label="sleep" unit="h" /></div>
      {!hoursSet && <p className="mt-1 text-xs" style={{ color: C.mute }}>Tap + or − to add your sleep hours.</p>}
      <p className="mb-1.5 mt-5 text-sm font-medium">Anything sore?</p>
      <div className="flex flex-wrap gap-2">{SORE_AREAS.map((a) => <Chip key={a} on={sore.includes(a)} onClick={() => setSore((s) => s.includes(a) ? s.filter((x) => x !== a) : [...s, a])}>{a}</Chip>)}</div>
      <button type="button" role="switch" aria-checked={flag} onClick={() => setFlag((f) => !f)} className="mt-5 flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm"
        style={{ background: "#0B0B0B", border: `1px solid ${flag ? C.gold : C.line}` }}>
        <span>I have pain or an injury the physio should know about</span>
        <span className="flex h-7 w-12 shrink-0 items-center rounded-full px-0.5" style={{ background: flag ? C.gold : "rgba(255,255,255,0.15)" }}>
          <span className="h-6 w-6 rounded-full bg-white transition-transform" style={{ transform: flag ? "translateX(20px)" : "none" }} /></span>
      </button>
      <label className="mt-4 block text-sm" style={{ color: C.mute }}>Note for the physio (only medical staff see this)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={`${inputCls} mt-1 py-2`} style={{ ...inputStyle, minHeight: 80 }} /></label>
      {err && <Msg kind="err">{err}</Msg>}
      <div className="mt-4 space-y-2"><Btn onClick={submit} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18} /> : null}{done ? "Save changes" : "Submit check-in"}</Btn>
        {done && <Btn kind="ghost" onClick={() => setEditing(false)}>Cancel</Btn>}</div>
    </Card>
  );
}

// ─── After training ─────────────────────────────────────────────────────────
function RpeCard({ me, onSaved, innerRef }: { me: Me; onSaved: () => Promise<void>; innerRef?: React.Ref<HTMLElement> }) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [kind, setKind] = useState<string>("training");
  const [minutes, setMinutes] = useState(75);
  const [yesterday, setYesterday] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false);
  const pick = (k: string) => { setKind(k); setMinutes(k === "match" ? 90 : 75); };
  const todays = me.rpe.filter((r) => r.date === me.today);
  const submit = async () => {
    if (rpe == null) { setErr("Pick how hard it was."); return; }
    setBusy(true); setErr(null); setOk(false);
    try {
      const r = await call("/rpe", "POST", { rpe, kind, minutes, ...(yesterday ? { date: dayBefore(me.today) } : {}) });
      if (r.status === 200) { setOk(true); setRpe(null); setYesterday(false); await onSaved(); } else setErr(r.data?.message ?? "Could not save. Try again.");
    } catch { setErr("No connection. Try again."); }
    setBusy(false);
  };
  return (
    <Card title="After training" innerRef={innerRef}>
      {todays.length > 0 && <div className="mb-3 text-sm" style={{ color: C.mute }}>Today so far: {todays.map((r, i) => <span key={i} className="mr-2">{r.kind} {r.rpe}/10{r.minutes ? `, ${r.minutes} min` : ""}</span>)}</div>}
      <p className="mb-1.5 text-sm font-medium">How hard was today?</p>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 11 }, (_, n) => {
          const on = rpe === n;
          return (
            <button key={n} type="button" aria-pressed={on} onClick={() => setRpe(n)} className="min-h-[56px] rounded-xl px-1 py-1.5"
              style={on ? { background: C.gold, color: "#0B0B0B", border: `2px solid ${C.ink}` } : { background: "#0B0B0B", color: C.ink, border: `1px solid ${C.line}` }}>
              <span className="block text-lg font-semibold leading-tight tabular-nums">{n}</span>
              <span className="block text-[10px] leading-tight" style={{ opacity: 0.8 }}>{CR10[n]}</span>
            </button>
          );
        })}
      </div>
      <p className="mb-1.5 mt-4 text-sm font-medium">What was it?</p>
      <div className="flex flex-wrap gap-2">{KINDS.map(([k, l]) => <Chip key={k} on={kind === k} onClick={() => pick(k)}>{l}</Chip>)}</div>
      <p className="mb-1.5 mt-4 text-sm font-medium">How many minutes?</p>
      <Stepper value={minutes} onChange={setMinutes} min={1} max={300} step={5} label="minutes" unit="min" />
      <button type="button" role="switch" aria-checked={yesterday} onClick={() => setYesterday((y) => !y)} className="mt-4 flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm"
        style={{ background: "#0B0B0B", border: `1px solid ${yesterday ? C.gold : C.line}` }}>
        <span>This was yesterday ({shortDate(dayBefore(me.today))})</span>
        <span className="flex h-7 w-12 shrink-0 items-center rounded-full px-0.5" style={{ background: yesterday ? C.gold : "rgba(255,255,255,0.15)" }}>
          <span className="h-6 w-6 rounded-full bg-white transition-transform" style={{ transform: yesterday ? "translateX(20px)" : "none" }} /></span>
      </button>
      {err && <Msg kind="err">{err}</Msg>}{ok && <Msg kind="ok">Saved. Thanks.</Msg>}
      <div className="mt-4"><Btn onClick={submit} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18} /> : null}Submit effort</Btn></div>
    </Card>
  );
}

function HistoryCard({ me }: { me: Me }) {
  const rows = me.history.slice(0, 28);
  return (
    <Card title="My last 4 weeks">
      {rows.length === 0 ? <p className="text-sm" style={{ color: C.mute }}>No check-ins yet.</p> : (
        <ul className="divide-y" style={{ borderColor: C.line }}>
          {rows.map((h) => (
            <li key={h.date} className="flex items-center gap-3 py-2 text-sm" style={{ borderColor: C.line }}>
              <span className="w-16 shrink-0" style={{ color: C.mute }}>{shortDate(h.date)}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, ((h.score ?? 0) / 25) * 100)}%`, background: C.gold }} /></span>
              <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{h.score != null ? `${h.score}/25` : "–"}</span>
              <span className="w-12 shrink-0 text-right tabular-nums" style={{ color: C.mute }}>{h.sleepHours != null ? `${h.sleepHours} h` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HomeHint() {
  const key = "siu-athlete-a2hs";
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = (navigator as any).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
      if (ios && !standalone && !localStorage.getItem(key)) setShow(true);
    } catch { /* storage blocked: stay hidden */ }
  }, []);
  if (!show) return null;
  const close = () => { setShow(false); try { localStorage.setItem(key, "1"); } catch { /* ignore */ } };
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl p-3 text-sm" style={{ background: C.card, border: `1px solid ${C.gold}` }}>
      <Share size={18} className="mt-0.5 shrink-0" style={{ color: C.gold }} />
      <p className="flex-1">Add this to your Home Screen: tap Share, then Add to Home Screen.</p>
      <button type="button" aria-label="Dismiss" onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center"><X size={18} /></button>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export function AthleteCheckIn() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "out" | "in" | "error">("loading");
  const rpeRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await call("/me", "GET");
      if (r.status === 200) { setMe(r.data); setState("in"); }
      else if (r.status === 401) { setMe(null); setState("out"); }
      else setState("error");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const afterWellness = async () => { await load(); setTimeout(() => rpeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const afterRpe = async () => { await load(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const signOut = async () => { try { await call("/sign-out", "POST"); } catch { /* ignore */ } setMe(null); setState("out"); };

  if (state === "loading") return <Shell><div className="flex justify-center pt-32"><Loader2 className="animate-spin" /></div></Shell>;
  if (state === "error") return <Shell><div className="pt-24 text-center"><Crest /><p className="mt-4">Could not load. Check your connection.</p><div className="mt-4"><Btn onClick={() => { setState("loading"); load(); }}>Try again</Btn></div></div></Shell>;
  if (state === "out" || !me) return <SignIn onDone={load} />;

  const avail = me.availability && me.availability !== "available" ? (AVAIL[me.availability] ?? me.availability) : null;
  return (
    <Shell>
      <header className="flex items-center gap-3">
        <Crest size={44} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">Kia ora {me.firstName}</h1>
          <p className="text-sm" style={{ color: C.mute }}>{longDate(me.today)}</p>
        </div>
      </header>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {me.streak > 0 && <span className="rounded-full px-3 py-1" style={{ background: C.pine }}>{me.streak} {me.streak === 1 ? "day" : "days"} in a row</span>}
        {avail && <span className="rounded-full px-3 py-1" style={{ border: `1px solid ${C.gold}`, color: C.gold }}>{avail}</span>}
      </div>
      <p className="mt-3 text-xs" style={{ color: C.mute }}>Takes 30 seconds. Only SIU performance staff see your answers.</p>
      <HomeHint />
      <WellnessCard me={me} onSaved={afterWellness} />
      <RpeCard me={me} onSaved={afterRpe} innerRef={rpeRef} />
      <HistoryCard me={me} />
      <button type="button" onClick={signOut} className="mt-6 min-h-[44px] w-full text-center text-sm underline" style={{ color: C.mute }}>Sign out</button>
    </Shell>
  );
}

export function AthleteSetPassword() {
  const [, nav] = useLocation();
  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : "";
  const [p1, setP1] = useState(""); const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (p1.length < 10) { setErr("Your password needs at least 10 characters."); return; }
    if (p1 !== p2) { setErr("The two passwords do not match."); return; }
    setBusy(true);
    try {
      const r = await call("/set-password", "POST", { token, password: p1 });
      if (r.status === 200) { nav("/athlete"); return; }
      setErr(r.data?.message ?? "Could not set your password. Try again.");
    } catch { setErr("No connection. Try again."); }
    setBusy(false);
  };
  return (
    <Shell>
      <div className="flex flex-col items-center pt-8 text-center"><Crest size={84} /><h1 className="mt-4 text-2xl font-semibold">Set your password</h1>
        <p className="mt-1 text-sm" style={{ color: C.mute }}>Use at least 10 characters.</p></div>
      <form onSubmit={submit} className="mt-6 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
        <label className="block text-sm" style={{ color: C.mute }}>New password
          <input type="password" autoComplete="new-password" minLength={10} required value={p1} onChange={(e) => setP1(e.target.value)} className={`${inputCls} mt-1`} style={inputStyle} /></label>
        <label className="mt-3 block text-sm" style={{ color: C.mute }}>Type it again
          <input type="password" autoComplete="new-password" minLength={10} required value={p2} onChange={(e) => setP2(e.target.value)} className={`${inputCls} mt-1`} style={inputStyle} /></label>
        <div className="mt-4"><Btn type="submit" disabled={busy || !token}>{busy ? <Loader2 className="animate-spin" size={18} /> : null}Save password</Btn></div>
        {!token && <Msg kind="err">This link is missing its code. Ask for a new one.</Msg>}
        {err && <Msg kind="err">{err}</Msg>}
        {(err || !token) && <button type="button" onClick={() => nav("/athlete")} className="mt-3 min-h-[44px] w-full text-center text-sm underline" style={{ color: C.gold }}>Back to sign in to get a new link</button>}
      </form>
    </Shell>
  );
}
