/**
 * The MFL captain's team page.
 *
 * Daniel, 2026-09-18: the Ethnic Cup captain dashboard, for Mini Football.
 * One screen: how the team fee is going, the squad list (numbers optional),
 * fixtures and the ladder, and fill-ins — for the rest of the term or for one
 * night the side is short.
 *
 * 🔴 This page never works out a price and never takes a card. The team's
 * money sits on its registration and moves through the pages that already
 * exist: the weekly plan's payoff page and the Player Pay hub. This page
 * DESCRIBES the position (from the server) and LINKS out. That is what keeps
 * the MFL money rules with one owner.
 *
 * Deliberately NOT TeampayDashboardView: that component is about shares on a
 * teampay entry. A league team is a different object with different money and
 * a ladder, and dressing it as a tournament squad would mean lying about the
 * shares. Same shell, same brand tokens, same 44px rule.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, Check, Copy, ExternalLink, Loader2, Pencil, Plus, Search, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { brandFor, TEAMPAY_BRANDS, type TeampayBrand } from "@shared/teampay";
import { MFL_DAYS, SQUAD_POSITIONS, nzDateLabel, shortCompetitionName } from "@shared/league-captain";
import {
  Button, Card, Field, Loading, NotFoundPage, Notice, Progress, Select, TeampayShell, inputStyle, money,
} from "./shell";

class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body?.message || "Something went wrong.", r.status);
  return body;
};

const MFL = TEAMPAY_BRANDS.mfl;

export default function LeagueTeamPage() {
  const [, params] = useRoute("/captain/league/:id");
  const [, navigate] = useLocation();
  const id = params?.id || "";
  const base = `/api/public/teampay/captain/league/${id}`;

  const { data, isLoading, error, refetch } = useQuery<any, ApiError>({
    queryKey: ["league-team", base],
    queryFn: () => api(base),
    enabled: !!id,
    retry: false,
  });

  // Signed out (or the session was revoked) → the sign-in page, not a 404.
  useEffect(() => { if (error?.status === 401) navigate("/captain"); }, [error, navigate]);

  const [flash, setFlash] = useState<{ tone: "good" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  const brand = useMemo(() => brandFor(data?.competition?.brand) || MFL, [data?.competition?.brand]);

  if (isLoading) return <TeampayShell brand={MFL}><Loading brand={MFL} /></TeampayShell>;
  if (error || !data) return <NotFoundPage brand={MFL} />;

  const { competition, team, payment, links, squad, unlisted, fixtures, standings, fillins } = data;

  return (
    <Body
      brand={brand} base={base} data={data} refetch={refetch} flash={flash} setFlash={setFlash}
      competition={competition} team={team} payment={payment} links={links} squad={squad}
      unlisted={unlisted} fixtures={fixtures} standings={standings} fillins={fillins}
      onBack={() => navigate("/captain/teams")}
    />
  );
}

/**
 * The page body, split out so every hook above sits above every early return.
 * A `useState` below `if (isLoading) return` is #310 "Rendered more hooks than
 * during the previous render" — it white-screened the person page on v499.
 */
function Body(p: any) {
  const { brand, base, refetch, flash, setFlash, competition, team, payment, links, squad, unlisted, fixtures, standings, fillins, onBack } = p;
  const [showAdd, setShowAdd] = useState(false);
  const [showFillins, setShowFillins] = useState<{ kind: "season" | "game"; date?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      await refetch();
      if (ok) setFlash({ tone: "good", text: ok });
    } catch (e: any) {
      setFlash({ tone: "error", text: e.message });
    } finally { setBusy(null); }
  };

  const sub = [team.divisionName, shortCompetitionName(competition.name)].filter(Boolean).join(" · ");

  return (
    <TeampayShell brand={brand} wide eyebrow={sub} title={team.name}>
      <div className="mb-5 flex items-center justify-between gap-4">
        <button className="inline-flex items-center gap-2 text-[13px] underline underline-offset-2"
                style={{ color: brand.mute, minHeight: 44 }} onClick={onBack}>
          <Users size={14} /> All your teams
        </button>
      </div>

      {flash && <div className="mb-5"><Notice brand={brand} tone={flash.tone}>{flash.text}</Notice></div>}

      <PaymentCard brand={brand} payment={payment} links={links} />

      {/* ── the squad ─────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap gap-2.5">
        <Button brand={brand} onClick={() => setShowAdd((v: boolean) => !v)}>
          <UserPlus size={16} className="mr-2" /> Add players
        </Button>
        {fillins.open && (
          <Button brand={brand} variant="ghost" onClick={() => setShowFillins({ kind: "season" })}>
            <Search size={16} className="mr-2" /> Find a fill-in
          </Button>
        )}
      </div>

      {showAdd && (
        <AddPlayers brand={brand} base={base}
          onDone={(m: string) => { setShowAdd(false); setFlash({ tone: "good", text: m }); refetch(); }}
          onError={(m: string) => setFlash({ tone: "error", text: m })}
          onClose={() => setShowAdd(false)} />
      )}

      <SquadCard brand={brand} base={base} squad={squad} unlisted={unlisted} payment={payment}
                 busy={busy} run={run} />

      <FixturesCard brand={brand} fixtures={fixtures} team={team} competition={competition}
                    canAsk={fillins.open}
                    onAsk={(date: string) => setShowFillins({ kind: "game", date })} />

      <LadderCard brand={brand} standings={standings} />

      <FillinsCard brand={brand} base={base} fillins={fillins} busy={busy} run={run}
                   onOpen={() => setShowFillins({ kind: "season" })} />

      {showFillins && (
        <FillinDrawer brand={brand} base={base} nights={fillins.nights} initial={showFillins}
                      onClose={() => { setShowFillins(null); refetch(); }}
                      onFlash={(tone, text) => setFlash({ tone, text })} />
      )}
    </TeampayShell>
  );
}

// ── money ────────────────────────────────────────────────────────────────────

function LinkButton({ brand, href, children, variant = "solid" }: { brand: TeampayBrand; href: string; children: React.ReactNode; variant?: "solid" | "ghost" }) {
  const style: React.CSSProperties = variant === "solid"
    ? { background: brand.accent, color: brand.onAccent, minHeight: 44, padding: "0 22px" }
    : { background: "transparent", color: brand.ink, border: `1px solid ${brand.line}`, minHeight: 44, padding: "0 18px" };
  return (
    <a href={href} className="inline-flex items-center justify-center rounded-full font-semibold" style={style}>
      {children}
    </a>
  );
}

function PaymentCard({ brand, payment, links }: { brand: TeampayBrand; payment: any; links: any }) {
  if (!payment) {
    return (
      <Card brand={brand} className="mb-5 p-5">
        <div className="text-[13px]" style={{ color: brand.mute }}>Team fee</div>
        <p className="mt-1 text-[14px]">This team was added by the league office, so there's no payment to show here.</p>
      </Card>
    );
  }
  const w = payment.weekly;
  const s = payment.split;
  const inst = payment.installment;
  return (
    <Card brand={brand} className="mb-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <div className="text-[13px]" style={{ color: brand.mute }}>Team fee · {payment.label}</div>
          <div className="text-[26px] font-bold" style={{ fontFamily: brand.fontHeading }}>{money(payment.totalCents)}</div>
        </div>
        <div className="text-right">
          <div className="text-[13px]" style={{ color: brand.mute }}>
            {w ? `${money(w.depositCents)} deposit, then ${w.weeksTotal} × ` : s ? `${s.targetCount ?? "?"} players · each pays` : "Paid"}
          </div>
          <div className="text-[26px] font-bold" style={{ fontFamily: brand.fontHeading, color: brand.accent }}>
            {w ? money(w.weeklyAmountCents) : s ? money(s.shareCents) : money(payment.paidCents)}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Progress brand={brand} percent={payment.percentPaid} />
        <div className="mt-2.5 flex flex-wrap justify-between gap-x-4 text-[13px]" style={{ color: brand.mute }}>
          <span>
            <strong style={{ color: brand.ink }}>{money(payment.paidCents)}</strong> in
            {w && <>{" · "}{w.weeksPaid} of {w.weeksTotal} weekly payments</>}
            {s && <>{" · "}{s.paidCount} of {s.targetCount ?? "?"} paid</>}
          </span>
          <span>{money(payment.outstandingCents)} to go</span>
        </div>
      </div>

      {payment.isPaidUp ? (
        <div className="mt-4"><Notice brand={brand} tone="good"><strong>You're paid up.</strong> Nothing left to chase.</Notice></div>
      ) : w ? (
        <div className="mt-4 space-y-3">
          {w.missedCount > 0 ? (
            <Notice brand={brand} tone="warn">
              <strong>{w.missedCount} weekly payment{w.missedCount === 1 ? "" : "s"} behind</strong> ({money(w.missedCents)}).
              The card on file is retried automatically; you can also clear what's left in one go.
            </Notice>
          ) : w.nextChargeDate ? (
            <div className="text-[13px]" style={{ color: brand.mute }}>
              Next weekly payment of <strong style={{ color: brand.ink }}>{money(w.weeklyAmountCents)}</strong> comes off the card on file on {nzDateLabel(w.nextChargeDate)}.
            </div>
          ) : null}
          {links?.payoff && (
            <LinkButton brand={brand} href={links.payoff} variant={w.missedCount > 0 ? "solid" : "ghost"}>
              Pay the rest now ({money(w.payoffCents)}) <ExternalLink size={14} className="ml-2" />
            </LinkButton>
          )}
        </div>
      ) : s ? (
        <div className="mt-4 space-y-3">
          <div className="text-[13px] leading-relaxed" style={{ color: brand.mute }}>
            Everyone pays their own {money(s.shareCents)} on the Player Pay page. Send the link to anyone who hasn't yet — paid players are ticked on your squad list below.
          </div>
          {links?.splitHub && (
            <div className="flex flex-wrap gap-2.5">
              <CopyButton brand={brand} text={links.splitHub} label="Copy the Player Pay link" />
              <LinkButton brand={brand} href={links.splitHub} variant="ghost">Open it <ExternalLink size={14} className="ml-2" /></LinkButton>
            </div>
          )}
        </div>
      ) : inst ? (
        <div className="mt-4 space-y-3">
          <div className="text-[13px]" style={{ color: brand.mute }}>
            {money(inst.depositCents)} deposit paid. The {money(inst.balanceCents)} balance
            {inst.balanceDueDate ? ` is due ${nzDateLabel(inst.balanceDueDate)}` : " comes off the card on file"}
            {inst.balanceStatus === "failed" ? " — the last attempt failed, so pay it below." : "."}
          </div>
          {links?.payoff && (
            <LinkButton brand={brand} href={links.payoff} variant={inst.balanceStatus === "failed" ? "solid" : "ghost"}>
              Pay the balance <ExternalLink size={14} className="ml-2" />
            </LinkButton>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function CopyButton({ brand, text, label }: { brand: TeampayBrand; text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button brand={brand} onClick={async () => {
      try { await navigator.clipboard.writeText(text); } catch { window.prompt("Copy this link", text); }
      setDone(true); setTimeout(() => setDone(false), 1600);
    }}>
      {done ? <Check size={15} className="mr-2" /> : <Copy size={15} className="mr-2" />}
      {done ? "Copied" : label}
    </Button>
  );
}

// ── the squad list ───────────────────────────────────────────────────────────

function Shirt({ brand, n }: { brand: TeampayBrand; n: number | null }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
          style={{ width: 36, height: 36, background: n == null ? "transparent" : brand.accent,
                   color: n == null ? brand.mute : brand.onAccent, border: `1px solid ${n == null ? brand.line : brand.accent}`,
                   fontFamily: brand.fontHeading }}
          title={n == null ? "No number yet" : `Number ${n}`}>
      {n == null ? "—" : n}
    </span>
  );
}

function PaidPill({ brand, p, payment }: { brand: TeampayBrand; p: any; payment: any }) {
  if (p.paid) {
    return <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                 style={{ background: "rgba(52,199,89,0.14)", color: "#34C759", border: "1px solid rgba(52,199,89,0.35)" }}>
      Paid {money(p.paid.cents)}
    </span>;
  }
  if (payment?.split && !payment.split.settled && !p.isCaptain) {
    return <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                 style={{ background: "rgba(255,159,10,0.14)", color: "#FF9F0A", border: "1px solid rgba(255,159,10,0.35)" }}>
      Not paid yet
    </span>;
  }
  return null;
}

function SquadCard({ brand, base, squad, unlisted, payment, busy, run }: any) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <Card brand={brand} className="mb-5 overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: brand.line }}>
        <h2 className="text-[15px] font-semibold"><Users size={15} className="mr-2 inline align-[-2px]" />Your squad</h2>
        <span className="text-[12px]" style={{ color: brand.mute }}>{squad.length} player{squad.length === 1 ? "" : "s"}</span>
      </div>

      {squad.length === 0 ? (
        <div className="px-5 py-12 text-center text-[14px]" style={{ color: brand.mute }}>
          Nobody on your list yet. Add your players — numbers are optional.
        </div>
      ) : (
        <ul>
          {squad.map((p: any) => (
            <li key={p.id} className="border-b px-4 py-3.5 last:border-b-0 sm:px-5" style={{ borderColor: brand.line }}>
              {editing === p.id ? (
                <EditRow brand={brand} base={base} player={p}
                         onDone={(msg: string) => { setEditing(null); run(`e${p.id}`, async () => {}, msg); }}
                         onError={(msg: string) => run(`e${p.id}`, async () => { throw new Error(msg); })}
                         onClose={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                  <Shirt brand={brand} n={p.shirtNumber} />
                  {/* w-full on a phone, flex-1 from sm up — the name must never share
                      120px with three icon buttons at 390px. */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-[15px] font-medium">{p.name}</span>
                      {p.isCaptain && <Tag brand={brand}>Captain</Tag>}
                      {p.source === "fillin" && <Tag brand={brand}>Fill-in</Tag>}
                      {p.position && <span className="text-[12px]" style={{ color: brand.accent }}>{p.position}</span>}
                    </div>
                    <div className="mt-0.5 break-words text-[12px]" style={{ color: brand.mute }}>
                      {[p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"}
                    </div>
                  </div>
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <div className="flex-1 sm:flex-none"><PaidPill brand={brand} p={p} payment={payment} /></div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button brand={brand} variant="ghost" className="!px-3" title={`Edit ${p.name}`}
                              onClick={() => setEditing(p.id)}>
                        <Pencil size={15} />
                      </Button>
                      {!p.isCaptain && (
                        <Button brand={brand} variant="ghost" className="!px-3" title={`Remove ${p.name}`}
                                disabled={busy === `r${p.id}`}
                                onClick={() => run(`r${p.id}`, () => api(`${base}/squad/${p.id}`, { method: "DELETE" }), `${p.name} removed.`)}>
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {unlisted?.length > 0 && (
        <div className="border-t px-5 py-4" style={{ borderColor: brand.line, background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[13px] font-semibold">Paid through Player Pay, not on your list yet</div>
          <ul className="mt-2 space-y-2">
            {unlisted.map((u: any) => (
              <li key={u.splitMemberId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px]">{u.name || u.email} <span className="text-[12px]" style={{ color: "#34C759" }}>· paid {money(u.chargedCents)}</span></span>
                <Button brand={brand} variant="ghost" className="!px-3" disabled={busy === `a${u.splitMemberId}`}
                        onClick={() => run(`a${u.splitMemberId}`, () => api(`${base}/squad/adopt/${u.splitMemberId}`, { method: "POST" }), `${u.name || u.email} added to your squad.`)}>
                  <Plus size={14} className="mr-1.5" /> Add to squad
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Tag({ brand, children }: { brand: TeampayBrand; children: React.ReactNode }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
          style={{ background: brand.line, color: brand.mute, letterSpacing: ".08em" }}>{children}</span>
  );
}

function EditRow({ brand, base, player, onDone, onError, onClose }: any) {
  const [f, setF] = useState({
    name: player.name ?? "", email: player.email ?? "", phone: player.phone ?? "",
    shirtNumber: player.shirtNumber == null ? "" : String(player.shirtNumber), position: player.position ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-2.5">
      <div className="grid gap-2 sm:grid-cols-[84px_1.2fr_1.3fr_1fr]">
        <input inputMode="numeric" placeholder="No." value={f.shirtNumber} onChange={(e) => set("shirtNumber", e.target.value)} style={inputStyle(brand)} />
        <input placeholder="Name" value={f.name} onChange={(e) => set("name", e.target.value)} style={inputStyle(brand)} />
        <input type="email" placeholder="Email" value={f.email} onChange={(e) => set("email", e.target.value)} style={inputStyle(brand)} />
        <input type="tel" placeholder="Mobile" value={f.phone} onChange={(e) => set("phone", e.target.value)} style={inputStyle(brand)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Select brand={brand} value={f.position} onChange={(v) => set("position", v)} options={SQUAD_POSITIONS} placeholder="Position (optional)" />
        <Button brand={brand} disabled={saving} onClick={async () => {
          setSaving(true);
          try {
            await api(`${base}/squad/${player.id}`, { method: "PATCH", body: JSON.stringify(f) });
            onDone("Saved.");
          } catch (e: any) { onError(e.message); }
          finally { setSaving(false); }
        }}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : "Save"}
        </Button>
        <Button brand={brand} variant="quiet" onClick={onClose}><X size={16} /></Button>
      </div>
    </div>
  );
}

function AddPlayers({ brand, base, onDone, onError, onClose }: any) {
  const blank = { name: "", shirtNumber: "", email: "", phone: "" };
  const [rows, setRows] = useState([{ ...blank }]);
  const [saving, setSaving] = useState(false);
  const set = (i: number, k: string, v: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  return (
    <Card brand={brand} className="mb-5 p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold">Add players</h3>
          <p className="mt-1 text-[13px]" style={{ color: brand.mute }}>
            A name is enough. Numbers, email and mobile are optional — add them if you want to reach people from here.
          </p>
        </div>
        <Button brand={brand} variant="quiet" className="!px-2" onClick={onClose}><X size={18} /></Button>
      </div>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[84px_1.2fr_1.3fr_1fr]">
            <input inputMode="numeric" placeholder="No." value={row.shirtNumber} onChange={(e) => set(i, "shirtNumber", e.target.value)} style={inputStyle(brand)} autoComplete="off" />
            <input placeholder="Name" value={row.name} onChange={(e) => set(i, "name", e.target.value)} style={inputStyle(brand)} autoComplete="off" />
            <input type="email" placeholder="Email (optional)" value={row.email} onChange={(e) => set(i, "email", e.target.value)} style={inputStyle(brand)} autoComplete="off" />
            <input type="tel" placeholder="Mobile (optional)" value={row.phone} onChange={(e) => set(i, "phone", e.target.value)} style={inputStyle(brand)} autoComplete="off" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button brand={brand} variant="ghost" onClick={() => setRows((r) => [...r, { ...blank }])}>
          <Plus size={15} className="mr-1.5" /> Another
        </Button>
        <Button brand={brand} disabled={saving || rows.every((r) => !r.name.trim())}
          onClick={async () => {
            setSaving(true);
            try {
              const r = await api(`${base}/squad`, { method: "POST", body: JSON.stringify({ players: rows.filter((x) => x.name.trim()) }) });
              // Partial success is the normal case — say which player and why.
              if (r.added && !r.rejected.length) onDone(`${r.added} player${r.added === 1 ? "" : "s"} added.`);
              else if (r.added) onDone(`${r.added} added. Not added: ${r.rejected.map((x: any) => `${x.name} (${x.reason})`).join(", ")}`);
              else onError(r.rejected.map((x: any) => `${x.name}: ${x.reason}`).join(" · ") || "Nothing added.");
              setRows([{ ...blank }]);
            } catch (e: any) { onError(e.message); }
            finally { setSaving(false); }
          }}>
          {saving ? <Loader2 size={15} className="mr-2 animate-spin" /> : null}
          Add to squad
        </Button>
      </div>
    </Card>
  );
}

// ── fixtures and the ladder ──────────────────────────────────────────────────

function ResultPill({ r }: { r: "W" | "D" | "L" | null }) {
  if (!r) return null;
  const tone = r === "W" ? "#34C759" : r === "L" ? "#FF6961" : "#FF9F0A";
  return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold"
               style={{ background: `${tone}22`, color: tone }}>{r}</span>;
}

function FixturesCard({ brand, fixtures, team, competition, canAsk, onAsk }: any) {
  const next = fixtures.next;
  return (
    <Card brand={brand} className="mb-5 overflow-hidden">
      <div className="border-b px-5 py-4" style={{ borderColor: brand.line }}>
        <h2 className="text-[15px] font-semibold">Fixtures</h2>
      </div>

      {!fixtures.drawn ? (
        <div className="px-5 py-6 text-[14px] leading-relaxed" style={{ color: brand.mute }}>
          The draw hasn't been published yet.
          {team.dayOfWeek ? ` You play ${team.dayOfWeek}s.` : ""}
          {competition.startDate && competition.endDate ? ` The term runs ${nzDateLabel(competition.startDate)} to ${nzDateLabel(competition.endDate)}.` : ""}
          {canAsk && " Short a player for a night already? You can still ask a fill-in for it below."}
        </div>
      ) : (
        <>
          {next && (
            <div className="border-b px-5 py-5" style={{ borderColor: brand.line }}>
              <div className="text-[11px] font-semibold uppercase" style={{ color: brand.accent, letterSpacing: ".14em" }}>Next game</div>
              <div className="mt-1.5 text-[22px] font-bold" style={{ fontFamily: brand.fontHeading }}>
                v {next.opponent}
              </div>
              <div className="mt-1 text-[13px]" style={{ color: brand.mute }}>
                {next.dateLabel}{next.timeLabel ? `, ${next.timeLabel}` : ""}{next.location ? ` · ${next.location}` : ""}
              </div>
              {canAsk && (
                <div className="mt-3">
                  <Button brand={brand} variant="ghost" onClick={() => onAsk(next.date)}>
                    <Search size={15} className="mr-2" /> Short for this game? Find a fill-in
                  </Button>
                </div>
              )}
            </div>
          )}
          {fixtures.upcoming.length > (next ? 1 : 0) && (
            <ul>
              {fixtures.upcoming.slice(next ? 1 : 0).map((g: any) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3 last:border-b-0" style={{ borderColor: brand.line }}>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">v {g.opponent}</div>
                    <div className="text-[12px]" style={{ color: brand.mute }}>{g.dateLabel}{g.timeLabel ? `, ${g.timeLabel}` : ""}</div>
                  </div>
                  {canAsk && (
                    <button className="text-[12px] underline underline-offset-2" style={{ color: brand.mute, minHeight: 44 }} onClick={() => onAsk(g.date)}>
                      Ask a fill-in
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {fixtures.results.length > 0 && (
            <div className="border-t" style={{ borderColor: brand.line }}>
              <div className="px-5 pt-4 text-[11px] font-semibold uppercase" style={{ color: brand.mute, letterSpacing: ".14em" }}>Results</div>
              <ul>
                {fixtures.results.map((g: any) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ResultPill r={g.result} />
                      <div className="min-w-0">
                        <div className="truncate text-[14px]">v {g.opponent}</div>
                        <div className="text-[12px]" style={{ color: brand.mute }}>{g.dateLabel}</div>
                      </div>
                    </div>
                    <div className="text-[16px] font-bold" style={{ fontFamily: brand.fontHeading }}>{g.score}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fixtures.upcoming.length === 0 && fixtures.results.length === 0 && (
            <div className="px-5 py-6 text-[14px]" style={{ color: brand.mute }}>No games for your team in the draw yet.</div>
          )}
        </>
      )}
    </Card>
  );
}

function LadderCard({ brand, standings }: any) {
  const rows: any[] = standings.rows ?? [];
  const played = rows.some((r) => r.played > 0);
  return (
    <Card brand={brand} className="mb-5 overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: brand.line }}>
        <h2 className="text-[15px] font-semibold">{standings.division ? `${standings.division} table` : "Table"}</h2>
        {standings.position && played && (
          <span className="text-[12px]" style={{ color: brand.mute }}>You're {ordinal(standings.position)}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-6 text-[14px]" style={{ color: brand.mute }}>No teams in your division yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: brand.mute }}>
                <th className="px-3 py-2.5 text-left font-medium sm:px-5">#</th>
                <th className="py-2.5 text-left font-medium">Team</th>
                <th className="px-2 py-2.5 text-right font-medium">P</th>
                <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">W</th>
                <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">D</th>
                <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">L</th>
                <th className="px-2 py-2.5 text-right font-medium">GD</th>
                <th className="px-3 py-2.5 text-right font-medium sm:px-5">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.teamId} style={{ background: r.you ? `${brand.accent}18` : "transparent", color: r.you ? brand.accent : brand.ink, fontWeight: r.you ? 600 : 400 }}>
                  <td className="px-3 py-2.5 sm:px-5">{i + 1}</td>
                  <td className="max-w-[160px] truncate py-2.5 sm:max-w-none">{r.teamName}</td>
                  <td className="px-2 py-2.5 text-right">{r.played}</td>
                  <td className="hidden px-2 py-2.5 text-right sm:table-cell">{r.won}</td>
                  <td className="hidden px-2 py-2.5 text-right sm:table-cell">{r.drawn}</td>
                  <td className="hidden px-2 py-2.5 text-right sm:table-cell">{r.lost}</td>
                  <td className="px-2 py-2.5 text-right">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                  <td className="px-3 py-2.5 text-right font-bold sm:px-5">{r.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!played && (
            <div className="px-5 py-3 text-[12px]" style={{ color: brand.mute }}>The table fills in as games are played.</div>
          )}
        </div>
      )}
    </Card>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── fill-ins ─────────────────────────────────────────────────────────────────

function FillinsCard({ brand, base, fillins, busy, run, onOpen }: any) {
  const asks: any[] = fillins.asks ?? [];
  return (
    <Card brand={brand} className="mb-5 overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: brand.line }}>
        <h2 className="text-[15px] font-semibold">Fill-ins</h2>
        {fillins.open && (
          <button className="text-[12px] underline underline-offset-2" style={{ color: brand.mute, minHeight: 44 }} onClick={onOpen}>
            Browse the list
          </button>
        )}
      </div>
      {!fillins.open ? (
        <div className="px-5 py-6 text-[14px] leading-relaxed" style={{ color: brand.mute }}>
          The fill-in list isn't open for this term yet. When it is, you'll be able to ask a player to join for the term or just cover a night you're short.
        </div>
      ) : asks.length === 0 ? (
        <div className="px-5 py-6 text-[14px] leading-relaxed" style={{ color: brand.mute }}>
          Nobody asked yet. Short a player? Browse the list and ask someone — for the rest of the term, or for one night.
        </div>
      ) : (
        <ul>
          {asks.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5 last:border-b-0" style={{ borderColor: brand.line }}>
              <div className="min-w-0">
                <div className="text-[14px] font-medium">
                  {a.name}
                  <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={a.state === "accepted"
                          ? { background: "rgba(52,199,89,0.14)", color: "#34C759" }
                          : { background: "rgba(255,159,10,0.14)", color: "#FF9F0A" }}>
                    {a.state === "accepted" ? "Said yes" : "Waiting"}
                  </span>
                </div>
                <div className="text-[12px]" style={{ color: brand.mute }}>
                  Asked {a.label}{a.state === "accepted" && (a.email || a.phone) ? ` · ${[a.email, a.phone].filter(Boolean).join(" · ")}` : ""}
                </div>
              </div>
              {a.state === "active" && (
                <Button brand={brand} variant="ghost" className="!px-3" disabled={busy === `c${a.id}`} title="Withdraw this ask"
                        onClick={() => run(`c${a.id}`, () => api(`${base}/asks/${a.id}/cancel`, { method: "POST" }), `Ask to ${a.firstName} withdrawn.`)}>
                  <X size={15} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FillinDrawer({ brand, base, nights, initial, onClose, onFlash }: {
  brand: TeampayBrand; base: string; nights: any[]; initial: { kind: "season" | "game"; date?: string };
  onClose: () => void; onFlash: (t: "good" | "error", m: string) => void;
}) {
  const [kind, setKind] = useState<"season" | "game">(initial.kind);
  const [date, setDate] = useState<string>(initial.date || nights[0]?.date || "");
  const [asking, setAsking] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [openNote, setOpenNote] = useState<number | null>(null);

  const gameDate = kind === "game" ? date : "";
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["league-fillins", base, gameDate],
    queryFn: () => api(`${base}/fill-ins${gameDate ? `?gameDate=${gameDate}` : ""}`),
    retry: false,
  });
  const fillins: any[] = data?.fillins ?? [];
  const nightLabel = nights.find((n) => n.date === date)?.label || "";
  const day = date ? MFL_DAYS[(new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: "rgba(0,0,0,0.72)" }} onClick={onClose}>
      <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl sm:max-w-2xl sm:rounded-2xl"
           style={{ background: brand.card, border: `1px solid ${brand.line}` }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 border-b px-5 py-4" style={{ background: brand.card, borderColor: brand.line }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[16px] font-semibold" style={{ color: brand.ink }}>Players looking for a game</h3>
              <p className="mt-1 text-[13px]" style={{ color: brand.mute }}>
                Ask one and we'll email them your team's details. You get their contact details when they say yes.
              </p>
            </div>
            <Button brand={brand} variant="quiet" className="!px-2" onClick={onClose}><X size={18} /></Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["season", "game"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                      className="rounded-full px-3.5 text-[13px] font-semibold"
                      style={{ minHeight: 44, border: `1px solid ${kind === k ? brand.accent : brand.line}`,
                               background: kind === k ? `${brand.accent}22` : "transparent", color: kind === k ? brand.accent : brand.ink }}>
                {k === "season" ? "Join for the rest of the term" : "Cover one night"}
              </button>
            ))}
          </div>
          {kind === "game" && (
            <div className="mt-3">
              {nights.length === 0 ? (
                <Notice brand={brand} tone="warn">No upcoming nights to pick from yet.</Notice>
              ) : (
                <Select brand={brand} value={nightLabel} onChange={(v) => setDate(nights.find((n) => n.label === v)?.date || "")}
                        options={nights.map((n) => n.label)} placeholder="Which night?" />
              )}
            </div>
          )}
        </div>

        <div className="p-5">
          {typeof data?.asksLeft === "number" && data.asksLeft === 0 && (
            <div className="mb-4"><Notice brand={brand} tone="warn">You've got as many asks out as you can at once. Wait for one to answer.</Notice></div>
          )}
          {isLoading ? <Loading brand={brand} /> : fillins.length === 0 ? (
            <p className="py-10 text-center text-[14px]" style={{ color: brand.mute }}>
              Nobody on the list {kind === "game" ? "for that night" : "right now"}. Check back — players join it all the time.
            </p>
          ) : (
            <ul className="space-y-3">
              {fillins.map((f) => (
                <li key={f.id} className="rounded-xl p-4" style={{ border: `1px solid ${brand.line}` }}>
                  <div className="flex gap-3.5">
                    {f.photoUrl && (
                      <img src={f.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer"
                           style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: `1px solid ${brand.line}` }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className="text-[15px] font-semibold" style={{ color: brand.ink }}>{f.firstName}</span>
                        {f.position && <span className="text-[13px]" style={{ color: brand.accent }}>{f.position}</span>}
                        {f.ability && <span className="text-[12px]" style={{ color: brand.mute }}>· {f.ability}</span>}
                      </div>
                      {Array.isArray(f.availableDays) && f.availableDays.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {MFL_DAYS.filter((d) => f.availableDays.includes(d)).map((d) => (
                            <span key={d} className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                                  style={{ background: d === day ? `${brand.accent}33` : brand.line, color: d === day ? brand.accent : brand.mute, letterSpacing: ".06em" }}>
                              {d.slice(0, 3)}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1.5 space-y-0.5 text-[13px]" style={{ color: brand.mute }}>
                        {f.highestLevel && <div>Highest level: {f.highestLevel}</div>}
                        {f.fromWhere && <div>From: {f.fromWhere}</div>}
                        {f.motivation && <div>Wants to: {String(f.motivation).toLowerCase()}</div>}
                        {f.note && <div className="italic" style={{ color: brand.ink }}>“{f.note}”</div>}
                      </div>
                      {f.highlight && (
                        <a href={f.highlight.url} target="_blank" rel="noopener noreferrer nofollow"
                           className="mt-2 inline-flex items-center gap-1.5 text-[13px] underline underline-offset-2"
                           style={{ color: brand.accent, minHeight: 44 }}>
                          Watch highlights <span style={{ color: brand.mute }}>({f.highlight.host})</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {openNote === f.id ? (
                    <div className="mt-3 space-y-2.5">
                      <textarea placeholder={kind === "game" ? "Where to meet, what to bring, what position you need…" : "What nights you play, what position you need…"}
                                value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                                style={{ ...inputStyle(brand), minHeight: 80, resize: "vertical" }} />
                      <div className="flex gap-2">
                        <Button brand={brand} disabled={asking === f.id || (kind === "game" && !date)}
                          onClick={async () => {
                            setAsking(f.id);
                            try {
                              await api(`${base}/fill-ins/${f.id}/ask`, { method: "POST", body: JSON.stringify({ kind, gameDate: kind === "game" ? date : undefined, note }) });
                              onFlash("good", `Asked ${f.firstName}${kind === "game" ? ` for ${nightLabel}` : ""}. They've got 48 hours to answer.`);
                              setOpenNote(null); setNote(""); refetch();
                            } catch (e: any) { onFlash("error", e.message); refetch(); }
                            finally { setAsking(null); }
                          }}>
                          {asking === f.id ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Bell size={15} className="mr-2" />}
                          Send the ask
                        </Button>
                        <Button brand={brand} variant="quiet" onClick={() => setOpenNote(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Button brand={brand} variant="ghost" disabled={data?.asksLeft === 0} onClick={() => { setOpenNote(f.id); setNote(""); }}>
                        Ask {f.firstName} {kind === "game" ? `for ${date ? nzDateLabel(date) : "that night"}` : "to join"}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
