// The team manager's page for a CIC 2027 package booking:
// join.cicyouth.com/cic-package/<token>. Before the deposit: the frozen quote,
// the 14-day hold and the deposit. After: the balance, the three instalments,
// the players' join link and who has registered and paid.
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Copy, Loader2, MessageCircle, Users } from "lucide-react";
import { Button, Card, Loading, NotFoundPage, Notice, Progress, TeampayShell } from "../teampay/shell";
import { API, CardPay, Row, api, brand, money, nzDate } from "./common";

type Kind = "deposit" | "instalment" | "balance";

export default function CicPackageTeamPage() {
  const [, params] = useRoute("/cic-package/:token");
  const token = params?.token || "";
  const { data, isLoading, error, refetch } = useQuery<any>({
    queryKey: ["cic-pkg-booking", token],
    queryFn: () => api(`${API}/booking/${token}`),
    retry: false,
  });
  const [paying, setPaying] = useState<{ kind: Kind; clientSecret: string; amountCents: number; paymentId: number } | null>(null);
  const [starting, setStarting] = useState<Kind | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (isLoading) return <TeampayShell brand={brand}><Loading brand={brand} /></TeampayShell>;
  if ((error as any)?.notFound || !data) return <NotFoundPage brand={brand} />;
  const b = data;

  const start = async (kind: Kind) => {
    setStarting(kind); setPayError(null);
    try { setPaying({ kind, ...(await api(`${API}/booking/${token}/pay`, { method: "POST", body: JSON.stringify({ kind }) })) }); }
    catch (e: any) { setPayError(e.message); }
    setStarting(null);
  };
  const onPaid = () => { setPaying(null); refetch(); };
  const pct = b.invoiceCents ? Math.round((b.paidTowardCents / b.invoiceCents) * 100) : 0;
  const share = async () => {
    try { await navigator.clipboard.writeText(b.joinUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  const waText = encodeURIComponent(`CIC 2027 (${b.ageGroup}): register for our team here, pay your share and add any extras: ${b.joinUrl}`);

  return (
    <TeampayShell brand={brand} eyebrow={`CIC 2027 · ${b.packageName} · ${b.ageGroup}`} title={b.teamName || b.clubName}>
      <div className="space-y-5">
        {b.status === "cancelled" && <Notice brand={brand} tone="error">This booking was cancelled. If that's a surprise, email info@cicyouth.com.</Notice>}
        {b.status === "expired" && (
          <Notice brand={brand} tone="warn">
            This quote's 14-day hold ended on {nzDate(b.expiresAt)} without a deposit. Build your trip again at{" "}
            <a href="https://packages.cicyouth.com" className="underline">packages.cicyouth.com</a> for today's price.
          </Notice>
        )}

        {/* the trip */}
        <Card brand={brand} className="p-5 sm:p-6">
          <div className="text-[13px]" style={{ color: brand.mute }}>
            {b.clubName} · {b.origin} · plays {b.dates} 2027 · {b.players} players, {b.staff} staff{b.adults ? `, ${b.adults} adults` : ""}{b.nights ? ` · ${b.nights} nights` : ""}
          </div>
          <div className="mt-3 divide-y" style={{ borderColor: brand.line }}>
            {(b.lines || []).map((l: any) => (
              <div key={l.label} className="flex justify-between gap-3 py-2 text-[14px]" style={{ borderColor: brand.line }}>
                <span className="min-w-0">{l.label}<span className="block text-[12px]" style={{ color: brand.mute }}>{l.detail}</span></span>
                <span className="shrink-0 tabular-nums">{l.amount === null ? "TBC" : money(Math.round(l.amount * 100))}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t pt-3" style={{ borderColor: brand.line }}>
            <Row label="Per player" value={money(b.perPlayerCents)} />
            {b.adults > 0 && <Row label="Per extra adult" value={money(b.perAdultCents)} />}
            {b.flightsCents > 0 && <Row label="Flights (you book these)" value={money(b.flightsCents)} />}
            <Row label="Our invoice" value={money(b.invoiceCents)} strong sub="NZD, GST included" />
          </div>
        </Card>

        {/* before the deposit */}
        {b.status === "held" && (
          <Card brand={brand} className="p-5 sm:p-6" style={{ borderColor: brand.accent }}>
            <div className="text-[12px] font-semibold uppercase" style={{ color: brand.accent, letterSpacing: "0.14em" }}>Confirm your place</div>
            <Row label="10% deposit today" value={money(b.depositCents)} strong sub="Non-refundable, unless CIC cancels the tournament" />
            <div className="mt-2 flex items-start gap-2 text-[13px]" style={{ color: brand.mute }}>
              <Clock size={15} className="mt-0.5 shrink-0" style={{ color: brand.accent }} />
              <span>Held until <b style={{ color: brand.ink }}>{nzDate(b.expiresAt, true)}</b>. After that the price can change.</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {b.schedule.map((s: any, i: number) => (
                <div key={s.label} className="rounded-xl px-2 py-2 text-center" style={{ background: brand.bg }}>
                  <div className="text-[11px]" style={{ color: brand.mute }}>{s.label.split(" ")[0]}</div>
                  <div className="text-[14px] font-semibold tabular-nums">{money(s.dueCumulativeCents - (i === 0 ? b.depositCents : b.schedule[i - 1].dueCumulativeCents))}</div>
                </div>
              ))}
            </div>
            {!paying && (
              <div className="mt-5">
                <Button brand={brand} className="w-full" onClick={() => start("deposit")} disabled={starting !== null}>
                  {starting === "deposit" && <Loader2 size={16} className="mr-2 animate-spin" />} Pay {money(b.depositCents)} deposit
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* after the deposit */}
        {b.status === "booked" && (
          <>
            <Notice brand={brand} tone="good">
              <CheckCircle2 size={16} className="mr-1.5 inline" style={{ color: "#34C759" }} />
              Booked. Deposit paid {nzDate(b.depositPaidAt)}.
            </Notice>

            <Card brand={brand} className="p-5 sm:p-6">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px]" style={{ color: brand.mute }}>Paid so far</span>
                <span className="tabular-nums text-[15px]"><b>{money(b.paidTowardCents)}</b> <span style={{ color: brand.mute }}>of {money(b.invoiceCents)}</span></span>
              </div>
              <div className="mt-2"><Progress brand={brand} percent={pct} /></div>
              <div className="mt-4 space-y-1">
                {b.schedule.map((s: any) => (
                  <Row key={s.label} label={s.label} value={s.settled ? "Paid" : `${money(s.remainingCents)} to go`} />
                ))}
              </div>
              {b.outstandingCents > 0 && !paying && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {b.next && (
                    <Button brand={brand} className="flex-1" onClick={() => start("instalment")} disabled={starting !== null}>
                      {starting === "instalment" && <Loader2 size={16} className="mr-2 animate-spin" />} Pay {b.next.label.split(" ")[0]} ({money(b.next.remainingCents)})
                    </Button>
                  )}
                  <Button brand={brand} variant="ghost" className="flex-1" onClick={() => start("balance")} disabled={starting !== null}>
                    {starting === "balance" && <Loader2 size={16} className="mr-2 animate-spin" />} Pay the whole {money(b.outstandingCents)}
                  </Button>
                </div>
              )}
              {b.outstandingCents === 0 && <div className="mt-3"><Notice brand={brand} tone="good">All paid. Thank you!</Notice></div>}
            </Card>

            <Card brand={brand} className="p-5 sm:p-6">
              <div className="flex items-center gap-2 text-[15px] font-semibold"><Users size={17} style={{ color: brand.accent }} /> Your players</div>
              <p className="mt-1 text-[13px]" style={{ color: brand.mute }}>
                Send this link to your squad. Each player registers, pays their share ({money(b.playerShareCents)}) and can add extras: a merch pack, more Victoria Foods meals and Christchurch attractions. What they pay comes off your balance.
              </p>
              <div className="mt-3 break-all rounded-xl px-3 py-3 text-[13px]" style={{ background: brand.bg, border: `1px solid ${brand.line}` }}>{b.joinUrl}</div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button brand={brand} className="flex-1" onClick={share}><Copy size={15} className="mr-2" />{copied ? "Copied" : "Copy link"}</Button>
                <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer" className="flex-1">
                  <Button brand={brand} variant="ghost" className="w-full"><MessageCircle size={15} className="mr-2" />Share on WhatsApp</Button>
                </a>
              </div>
              <div className="mt-5 text-[13px]" style={{ color: brand.mute }}>{b.roster.length} of {b.players} registered</div>
              <div className="mt-2 divide-y" style={{ borderColor: brand.line }}>
                {b.roster.length === 0 && <p className="py-3 text-[14px]" style={{ color: brand.mute }}>Nobody has registered yet.</p>}
                {(b.roster as any[]).map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-2.5 text-[14px]" style={{ borderColor: brand.line }}>
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="shrink-0 text-[12px] font-semibold" style={{ color: p.paidCents >= b.playerShareCents ? "#34C759" : p.paidCents > 0 ? "#FF9F0A" : brand.mute }}>
                      {p.paidCents >= b.playerShareCents ? "Share paid" : p.paidCents > 0 ? `${money(p.paidCents)} paid` : "Registered"}
                      {p.extrasCents > 0 ? ` · extras ${money(p.extrasCents)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {payError && <Notice brand={brand} tone="error">{payError}</Notice>}
        {paying && (
          <div>
            <div className="mb-2 text-[13px]" style={{ color: brand.mute }}>
              {paying.kind === "deposit" ? "10% deposit (non-refundable)" : paying.kind === "balance" ? "The whole balance" : "Next instalment"}
            </div>
            <CardPay clientSecret={paying.clientSecret} amountCents={paying.amountCents} paymentId={paying.paymentId}
              confirmUrl={`${API}/booking/${token}/confirm`} onPaid={onPaid} />
            <div className="mt-2 text-center"><Button brand={brand} variant="quiet" onClick={() => setPaying(null)}>Cancel</Button></div>
          </div>
        )}

        <p className="text-center text-[12px]" style={{ color: brand.mute }}>
          Keep this page's link: it's how you pay and see your players. Questions: info@cicyouth.com
        </p>
      </div>
    </TeampayShell>
  );
}
