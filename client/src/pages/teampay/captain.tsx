/**
 * Team Pay — the captain's account.
 *
 * Three screens: sign in, set a password, and the list of your teams. Opening
 * one renders the SAME dashboard the emailed link renders — see
 * TeampayDashboardView — with the session deciding who you are instead of a
 * token in the URL.
 *
 * 🔴 The emailed links still work. This is a second door, not a replacement, so
 * nothing here may become the only way to reach a team.
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, LogOut, Users } from "lucide-react";
import { brandFor, DEFAULT_BRAND, TEAMPAY_BRANDS } from "@shared/teampay";
import { shortCompetitionName } from "@shared/league-captain";
import {
  Button, Card, Field, Loading, Notice, TeampayShell, inputStyle, money,
} from "./shell";
import { TeampayDashboardView } from "./dashboard";

const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.message || "Something went wrong.");
  return body;
};

const MIN_PASSWORD = 12;

/**
 * The sign-in and set-password screens have no team to take a palette from
 * yet. The brand rides in the URL (`?brand=cic7s`, which the emailed link
 * carries) or, failing that, comes from the HOST: join.minifootball.co.nz is
 * Mini Football, so a captain arriving from minifootball.co.nz lands on a
 * black-and-gold page and not a Cup one.
 */
function pageBrand() {
  const fromUrl = new URLSearchParams(window.location.search).get("brand");
  if (fromUrl && TEAMPAY_BRANDS[fromUrl]) return TEAMPAY_BRANDS[fromUrl];
  if (window.location.hostname.includes("minifootball")) return TEAMPAY_BRANDS.mfl;
  return DEFAULT_BRAND;
}

const isMflHost = () => window.location.hostname.includes("minifootball");

// ── sign in ──────────────────────────────────────────────────────────────────

export function CaptainSignInPage() {
  const brand = useMemo(pageBrand, []);
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [mode, setMode] = useState<"password" | "link">("password");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "password") {
        await api("/api/public/teampay/captain/sign-in", {
          method: "POST", body: JSON.stringify({ email, password }),
        });
        navigate("/captain/teams");
      } else {
        const r = await api("/api/public/teampay/captain/request-link", {
          method: "POST", body: JSON.stringify({ email }),
        });
        setSent(r.message);
      }
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (sent) {
    return (
      <TeampayShell brand={brand} eyebrow="Team login" title="Check your email">
        <Card brand={brand} className="p-6">
          <p className="text-[15px] leading-relaxed">{sent}</p>
          <p className="mt-3 text-[13px]" style={{ color: brand.mute }}>
            The link works once and expires in an hour.
          </p>
          <div className="mt-5">
            <Button brand={brand} variant="ghost" className="w-full"
                    onClick={() => { setSent(null); setMode("password"); }}>
              Back to sign in
            </Button>
          </div>
        </Card>
      </TeampayShell>
    );
  }

  return (
    <TeampayShell brand={brand} eyebrow="Team login" title="Manage your team">
      <Card brand={brand} className="p-5 sm:p-6">
        <form className="space-y-4" onSubmit={submit}>
          <Field brand={brand} label="Email"
                 hint="The address you used when you entered or registered your team.">
            <input required type="email" autoComplete="email" value={email}
                   onChange={(e) => setEmail(e.target.value)} style={inputStyle(brand)} />
          </Field>

          {mode === "password" && (
            <Field brand={brand} label="Password">
              <input required type="password" autoComplete="current-password" value={password}
                     onChange={(e) => setPassword(e.target.value)} style={inputStyle(brand)} />
            </Field>
          )}

          {error && <Notice brand={brand} tone="error">{error}</Notice>}

          <Button brand={brand} type="submit" disabled={busy} className="w-full">
            {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : null}
            {mode === "password" ? "Sign in" : "Email me a link"}
          </Button>
        </form>

        <div className="mt-5 border-t pt-4 text-center" style={{ borderColor: brand.line }}>
          <button
            className="text-[13px] underline underline-offset-2"
            style={{ color: brand.mute, minHeight: 44 }}
            onClick={() => { setMode(mode === "password" ? "link" : "password"); setError(null); }}
          >
            {mode === "password"
              ? "First time here, or forgotten your password?"
              : "I know my password"}
          </button>
        </div>
      </Card>

      <p className="mt-5 text-center text-[13px]" style={{ color: brand.mute }}>
        {isMflHost()
          ? "Registered a team for a Mini Football league? Sign in with the email you registered under to manage your squad, see how the fee is going and find fill-ins."
          : "Haven't entered a team yet? You don't need an account to enter one — an account just means you don't have to keep the email we send you."}
      </p>
    </TeampayShell>
  );
}

// ── set a password ───────────────────────────────────────────────────────────

export function CaptainSetPasswordPage() {
  const brand = useMemo(pageBrand, []);
  const [, navigate] = useLocation();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") || "", []);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = again.length > 0 && again !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError("Those two passwords don't match.");
    setBusy(true); setError(null);
    try {
      await api("/api/public/teampay/captain/set-password", {
        method: "POST", body: JSON.stringify({ token, password }),
      });
      navigate("/captain/teams");
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (!token) {
    return (
      <TeampayShell brand={brand} eyebrow="Team login" title="That link is incomplete">
        <Card brand={brand} className="p-6">
          <p className="text-[15px] leading-relaxed" style={{ color: brand.mute }}>
            Open the link from your email exactly as it was sent, or ask for a new one.
          </p>
          <div className="mt-5">
            <Button brand={brand} className="w-full" onClick={() => navigate("/captain")}>
              Ask for a new link
            </Button>
          </div>
        </Card>
      </TeampayShell>
    );
  }

  return (
    <TeampayShell brand={brand} eyebrow="Team login" title="Choose a password">
      <Card brand={brand} className="p-5 sm:p-6">
        <form className="space-y-4" onSubmit={submit}>
          <Field brand={brand} label="New password"
                 hint={`At least ${MIN_PASSWORD} characters. Length matters more than symbols — a few words you'll remember beats one word with a 3 in it.`}>
            <input required type="password" autoComplete="new-password" value={password}
                   onChange={(e) => setPassword(e.target.value)} style={inputStyle(brand)} />
          </Field>
          {tooShort && (
            <div className="text-[12px]" style={{ color: brand.mute }}>
              {MIN_PASSWORD - password.length} more character{MIN_PASSWORD - password.length === 1 ? "" : "s"} to go.
            </div>
          )}

          <Field brand={brand} label="Type it again">
            <input required type="password" autoComplete="new-password" value={again}
                   onChange={(e) => setAgain(e.target.value)} style={inputStyle(brand)} />
          </Field>
          {mismatch && (
            <div className="text-[12px]" style={{ color: "#FF6961" }}>Those don't match yet.</div>
          )}

          {error && <Notice brand={brand} tone="error">{error}</Notice>}

          <Button brand={brand} type="submit"
                  disabled={busy || password.length < MIN_PASSWORD || password !== again}
                  className="w-full">
            {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : null}
            Save and sign in
          </Button>
        </form>
      </Card>
    </TeampayShell>
  );
}

// ── my teams ─────────────────────────────────────────────────────────────────

/**
 * Three kinds of team can sit under one email, and they open three different
 * ways: a league team (MFL — squad, payments, fixtures, ladder), a team still
 * being paid for through Player Pay (a link to its share page and nothing
 * else, because it is not a team until it is paid), and a Team Pay entry (the
 * tournament dashboard). One list, grouped, this term first.
 */
export function CaptainTeamsPage() {
  const [, navigate] = useLocation();
  const me = useQuery<any>({
    queryKey: ["captain-me"],
    queryFn: () => api("/api/public/teampay/captain/me"),
    retry: false,
  });
  const league = useQuery<any>({
    queryKey: ["captain-league-mine"],
    queryFn: () => api("/api/public/teampay/captain/league/mine"),
    retry: false,
  });

  // 🔴 A 401 here means the session is gone or was revoked — send them to sign
  // in rather than rendering an empty shell that looks like they have no teams.
  useEffect(() => { if (me.isError) navigate("/captain"); }, [me.isError, navigate]);

  const fallback = useMemo(pageBrand, []);
  const teams: any[] = league.data?.teams ?? [];
  const pending: any[] = league.data?.pending ?? [];
  const entries: any[] = me.data?.entries ?? [];
  const brand = useMemo(() => {
    if (teams.length || pending.length) return TEAMPAY_BRANDS.mfl;
    if (entries[0]?.competition?.brand) return brandFor(entries[0].competition.brand);
    return fallback;
  }, [teams.length, pending.length, entries, fallback]);

  if (me.isLoading || league.isLoading) return <TeampayShell brand={fallback}><Loading brand={fallback} /></TeampayShell>;
  if (me.isError || !me.data) return <TeampayShell brand={fallback}><Loading brand={fallback} /></TeampayShell>;

  const { captain } = me.data;
  const current = teams.filter((t) => t.competition?.current);
  const past = teams.filter((t) => !t.competition?.current);
  const nothing = !teams.length && !pending.length && !entries.length;

  const Row = ({ onClick, href, title, sub, badge, badgeTone }: {
    onClick?: () => void; href?: string; title: string; sub: string;
    badge?: string | null; badgeTone?: "good" | "warn" | "mute";
  }) => {
    const tone = badgeTone === "good" ? { bg: "#34C75922", fg: "#34C759" }
      : badgeTone === "warn" ? { bg: "#FF9F0A22", fg: "#FF9F0A" }
      : { bg: brand.line, fg: brand.mute };
    const inner = (
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold" style={{ fontFamily: brand.fontHeading }}>{title}</div>
          <div className="mt-1 truncate text-[13px]" style={{ color: brand.mute }}>{sub}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {badge && (
            <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: tone.bg, color: tone.fg }}>
              {badge}
            </span>
          )}
          <ArrowRight size={18} style={{ color: brand.mute }} />
        </div>
      </div>
    );
    const cls = "block w-full rounded-[14px] p-5 text-left transition-colors";
    const style = { background: brand.card, border: `1px solid ${brand.line}`, minHeight: 72, color: brand.ink };
    return href
      ? <a href={href} className={cls} style={style}>{inner}</a>
      : <button onClick={onClick} className={cls} style={style}>{inner}</button>;
  };

  const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="mb-7">
      <div className="mb-2.5 text-[11px] font-semibold uppercase" style={{ color: brand.mute, letterSpacing: "0.14em" }}>{label}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );

  const leagueRow = (t: any) => (
    <Row key={`l${t.id}`}
         onClick={() => navigate(`/captain/league/${t.id}`)}
         title={t.name}
         sub={[t.division?.name, shortCompetitionName(t.competition?.name)].filter(Boolean).join(" · ")}
         badge={t.paymentStatus === "paid_in_full" ? "Paid up" : t.paymentMode === "deposit_weekly" ? "Weekly plan" : t.paymentMode === "split" ? "Player Pay" : null}
         badgeTone={t.paymentStatus === "paid_in_full" ? "good" : "mute"} />
  );

  return (
    <TeampayShell brand={brand} eyebrow={captain.email} title="Your teams">
      {nothing ? (
        <Card brand={brand} className="p-6">
          <p className="text-[15px] leading-relaxed">
            There's no team under <strong>{captain.email}</strong> yet.
          </p>
          <p className="mt-3 text-[14px]" style={{ color: brand.mute }}>
            If you entered a team with a different address, sign in with that one instead.
          </p>
        </Card>
      ) : (
        <>
          {current.length > 0 && <Group label="This term">{current.map(leagueRow)}</Group>}

          {pending.length > 0 && (
            <Group label="Still being paid for">
              {pending.map((p) => (
                <Row key={`p${p.registrationId}`}
                     href={p.shareUrl || undefined}
                     title={p.teamName || "Your team"}
                     sub={`${[p.divisionName, shortCompetitionName(p.programName)].filter(Boolean).join(" · ")} · ${p.paidCount} of ${p.targetCount ?? "?"} paid`}
                     badge="Player Pay open" badgeTone="warn" />
              ))}
              <p className="text-[12px] leading-relaxed" style={{ color: brand.mute }}>
                A team is confirmed once everyone has paid their share. Open one to copy the link and chase your squad.
              </p>
            </Group>
          )}

          {entries.length > 0 && (
            <Group label={current.length || pending.length ? "Tournaments" : "Your entries"}>
              {entries.map((e: any) => (
                <Row key={`e${e.id}`}
                     onClick={() => navigate(`/captain/teams/${e.id}`)}
                     title={e.teamName}
                     sub={[e.competition?.name, e.community, e.status === "withdrawn" ? "withdrawn" : null].filter(Boolean).join(" · ")}
                     badge={e.paidUpAt ? "Paid up" : null} badgeTone="good" />
              ))}
            </Group>
          )}

          {past.length > 0 && <Group label="Past terms">{past.map(leagueRow)}</Group>}
        </>
      )}

      <div className="mt-6 text-center">
        <button
          className="inline-flex items-center gap-2 text-[13px] underline underline-offset-2"
          style={{ color: brand.mute, minHeight: 44 }}
          onClick={async () => {
            await api("/api/public/teampay/captain/sign-out", { method: "POST" }).catch(() => {});
            navigate("/captain");
          }}
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </TeampayShell>
  );
}

// ── one team, through the session ────────────────────────────────────────────

export function CaptainTeamPage() {
  const [, params] = useRoute("/captain/teams/:id");
  const [, navigate] = useLocation();
  const id = params?.id || "";

  return (
    <TeampayDashboardView
      base={`/api/public/teampay/captain/entries/${id}`}
      header={
        <div className="mb-5 flex items-center justify-between gap-4">
          <button
            className="inline-flex items-center gap-2 text-[13px] underline underline-offset-2"
            style={{ color: DEFAULT_BRAND.mute, minHeight: 44 }}
            onClick={() => navigate("/captain/teams")}
          >
            <Users size={14} /> All your teams
          </button>
        </div>
      }
    />
  );
}
