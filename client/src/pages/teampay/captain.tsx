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
import { brandFor, DEFAULT_BRAND } from "@shared/teampay";
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

// ── sign in ──────────────────────────────────────────────────────────────────

export function CaptainSignInPage() {
  const brand = DEFAULT_BRAND;
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
                 hint="The address you used when you entered your team.">
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
        Haven't entered a team yet? You don't need an account to enter one —
        an account just means you don't have to keep the email we send you.
      </p>
    </TeampayShell>
  );
}

// ── set a password ───────────────────────────────────────────────────────────

export function CaptainSetPasswordPage() {
  const brand = DEFAULT_BRAND;
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

export function CaptainTeamsPage() {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ["captain-me"],
    queryFn: () => api("/api/public/teampay/captain/me"),
    retry: false,
  });

  // 🔴 A 401 here means the session is gone or was revoked — send them to sign
  // in rather than rendering an empty shell that looks like they have no teams.
  useEffect(() => { if (isError) navigate("/captain"); }, [isError, navigate]);

  const brand = useMemo(
    () => brandFor(data?.entries?.[0]?.competition?.brand), [data]);

  if (isLoading) return <TeampayShell brand={DEFAULT_BRAND}><Loading brand={DEFAULT_BRAND} /></TeampayShell>;
  if (isError || !data) return <TeampayShell brand={DEFAULT_BRAND}><Loading brand={DEFAULT_BRAND} /></TeampayShell>;

  const { captain, entries } = data;

  return (
    <TeampayShell brand={brand} eyebrow={captain.email} title="Your teams">
      {entries.length === 0 ? (
        <Card brand={brand} className="p-6">
          <p className="text-[15px] leading-relaxed">
            There's no team under <strong>{captain.email}</strong> yet.
          </p>
          <p className="mt-3 text-[14px]" style={{ color: brand.mute }}>
            If you entered a team with a different address, sign in with that one instead.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((e: any) => (
            <button
              key={e.id}
              onClick={() => navigate(`/captain/teams/${e.id}`)}
              className="block w-full rounded-[14px] p-5 text-left transition-colors"
              style={{ background: brand.card, border: `1px solid ${brand.line}`, minHeight: 72 }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-[17px] font-semibold"
                       style={{ fontFamily: brand.fontHeading }}>
                    {e.teamName}
                  </div>
                  <div className="mt-1 truncate text-[13px]" style={{ color: brand.mute }}>
                    {e.competition?.name}
                    {e.community ? ` · ${e.community}` : ""}
                    {e.status === "withdrawn" ? " · withdrawn" : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {e.paidUpAt && (
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{ background: "#34C75922", color: "#34C759" }}>
                      Paid up
                    </span>
                  )}
                  <ArrowRight size={18} style={{ color: brand.mute }} />
                </div>
              </div>
            </button>
          ))}
        </div>
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
