import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Check, Share, X, Loader2 } from "lucide-react";
import { answerText, liveQuestions, type Answers, type FormDef } from "@shared/perf-forms";
import { AnswerList, CheckInForm } from "@/components/performance/checkin-form";

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

const AVAIL: Record<string, string> = { available: "Available", modified: "Modified training", limited: "Modified training", injured: "Injured", unavailable: "Not available", ill: "Unwell", rehab: "Rehab" };


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
      <a href="/athlete?demo=1" className="mt-2 flex min-h-[44px] w-full items-center justify-center text-center text-sm underline" style={{ color: C.mute }}>See a demo (no sign-in, nothing saved)</a>
    </Shell>
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

// ─── The daily check-in form (Rowan's Smartabase form, editable by staff) ────
interface FormPayload { today: string; form: { id: number; version: number; definition: FormDef } | null; todays: Answers | null; history: { date: string; answers: Answers }[] }

function DailyCheckIn({ onSaved }: { onSaved?: () => void }) {
  const [data, setData] = useState<FormPayload | null>(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const load = useCallback(async () => {
    try { const r = await call("/form", "GET"); if (r.status === 200) { setData(r.data); setErr(false); } else setErr(true); }
    catch { setErr(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (err) return <Card title="Check-in"><p className="text-sm">Could not load today's check-in.</p><div className="mt-3"><Btn kind="ghost" onClick={load}>Try again</Btn></div></Card>;
  if (!data) return <Card title="Check-in"><div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div></Card>;
  if (!data.form) return <Card title="Check-in"><p className="text-sm" style={{ color: C.mute }}>There's no check-in set up yet.</p></Card>;
  const def = data.form.definition;
  if (data.todays && !editing) {
    return (
      <>
        <Card title={def.title}>
          <p className="flex items-center gap-2 font-medium" style={{ color: "#8FC99B" }}><Check size={18} /> Done for today. Thanks.</p>
          {justSaved && <Msg kind="ok">Saved.</Msg>}
          <div className="mt-3"><AnswerList def={def} answers={data.todays} /></div>
          <div className="mt-4"><Btn kind="ghost" onClick={() => { setJustSaved(false); setEditing(true); }}>Edit today's answers</Btn></div>
        </Card>
        <CheckInHistory def={def} history={data.history} />
      </>
    );
  }
  return (
    <>
      <h2 className="mt-5 text-lg font-semibold">{def.title}</h2>
      {def.intro && <p className="mt-1 text-sm" style={{ color: C.mute }}>{def.intro}</p>}
      <CheckInForm
        key={editing ? "edit" : "new"}
        def={def} initial={data.todays}
        submitLabel={data.todays ? "Save changes" : "Submit check-in"}
        onCancel={data.todays ? () => setEditing(false) : undefined}
        onSubmit={async (answers) => {
          const r = await call("/checkin", "POST", { answers });
          if (r.status !== 200) return { ok: false, message: r.data?.message, questionId: r.data?.questionId };
          setEditing(false); setJustSaved(true); await load(); onSaved?.(); window.scrollTo({ top: 0, behavior: "smooth" });
          return { ok: true };
        }} />
      <CheckInHistory def={def} history={data.history} />
    </>
  );
}

/** The player's own last four weeks: the first 0–10 scale on the form (Rowan's "How ready am I"). */
function CheckInHistory({ def, history }: { def: FormDef; history: { date: string; answers: Answers }[] }) {
  const scale = liveQuestions(def).find((q) => q.type === "scale");
  const sleep = liveQuestions(def).find((q) => q.type === "choice" && /sleep/i.test(q.label));
  return (
    <Card title="My last 4 weeks">
      {history.length === 0 ? <p className="text-sm" style={{ color: C.mute }}>No check-ins yet.</p> : (
        <ul>
          {history.slice(0, 28).map((h) => {
            const v = scale ? h.answers[scale.id] : undefined;
            const max = scale?.max ?? 10;
            return (
              <li key={h.date} className="flex items-center gap-3 border-b py-2 text-sm last:border-0" style={{ borderColor: C.line }}>
                <span className="w-16 shrink-0" style={{ color: C.mute }}>{shortDate(h.date)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <span className="block h-full rounded-full" style={{ width: `${typeof v === "number" ? Math.min(100, (v / max) * 100) : 0}%`, background: C.gold }} /></span>
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums">{typeof v === "number" ? `${v}/${max}` : "–"}</span>
                <span className="w-24 shrink-0 truncate text-right text-xs" style={{ color: C.mute }}>{sleep ? answerText(sleep, h.answers[sleep.id]) : ""}</span>
              </li>
            );
          })}
        </ul>
      )}
      {scale && <p className="mt-2 text-xs" style={{ color: C.mute }}>{scale.label}{sleep ? ` · ${sleep.label}` : ""}</p>}
    </Card>
  );
}

/** join.southislandunited.com/athlete?demo=1 — the real form, nothing saved, no sign-in. */
function AthleteDemo() {
  const [data, setData] = useState<{ today: string; form: { definition: FormDef } | null } | null>(null);
  const [err, setErr] = useState(false);
  const [sent, setSent] = useState<Answers | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => { call("/demo-form", "GET").then((r) => (r.status === 200 ? setData(r.data) : setErr(true))).catch(() => setErr(true)); }, []);
  const banner = (
    <div className="mt-4 rounded-2xl p-3 text-sm" style={{ background: C.pine, border: `1px solid ${C.gold}` }} data-testid="demo-banner">
      <strong>Demo.</strong> This is exactly what a player sees. Nothing you enter here is saved and no one is signed in.
    </div>
  );
  return (
    <Shell>
      <header className="flex items-center gap-3">
        <Crest size={44} />
        <div className="min-w-0"><h1 className="truncate text-xl font-semibold">Kia ora</h1>
          <p className="text-sm" style={{ color: C.mute }}>{data ? longDate(data.today) : "Player check-in"}</p></div>
      </header>
      {banner}
      {err && <Msg kind="err">Could not load the demo. Check your connection.</Msg>}
      {!data && !err && <div className="flex justify-center pt-16"><Loader2 className="animate-spin" /></div>}
      {data && !data.form && <Msg kind="err">There's no check-in form set up yet.</Msg>}
      {data?.form && (sent ? (
        <Card title="Done for today. Thanks.">
          <p className="mb-3 text-sm" style={{ color: C.mute }}>This is the screen a player sees after submitting. In the demo, nothing was saved.</p>
          <AnswerList def={data.form.definition} answers={sent} />
          <div className="mt-4"><Btn kind="ghost" onClick={() => { setSent(null); setRound((n) => n + 1); window.scrollTo({ top: 0 }); }}>Try it again</Btn></div>
        </Card>
      ) : (
        <>
          <h2 className="mt-5 text-lg font-semibold">{data.form.definition.title}</h2>
          {data.form.definition.intro && <p className="mt-1 text-sm" style={{ color: C.mute }}>{data.form.definition.intro}</p>}
          <CheckInForm key={round} def={data.form.definition} submitLabel="Submit check-in (demo, not saved)"
            onSubmit={async (answers) => { setSent(answers); window.scrollTo({ top: 0, behavior: "smooth" }); return { ok: true }; }} />
        </>
      ))}
    </Shell>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export function AthleteCheckIn() {
  const demo = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";
  return demo ? <AthleteDemo /> : <AthleteCheckInSignedIn />;
}

function AthleteCheckInSignedIn() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "out" | "in" | "error">("loading");
  const load = useCallback(async () => {
    try {
      const r = await call("/me", "GET");
      if (r.status === 200) { setMe(r.data); setState("in"); }
      else if (r.status === 401) { setMe(null); setState("out"); }
      else setState("error");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

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
      <DailyCheckIn onSaved={load} />
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
