// A club's CIC 2027 booking for SEVERAL age groups: join.cicyouth.com/cic-package-group/<token>.
// Before the deposit: every team's frozen quote, the club total and ONE 10% deposit.
// After: each team's own page (instalments, players) and players' link.
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ExternalLink, Loader2 } from "lucide-react";
import { Button, Card, Loading, NotFoundPage, Notice, TeampayShell } from "../teampay/shell";
import { API, CardPay, Row, api, brand, money, nzDate } from "./common";

export default function CicPackageGroupPage() {
  const [, params] = useRoute("/cic-package-group/:token");
  const token = params?.token || "";
  const { data, isLoading, error, refetch } = useQuery<any>({
    queryKey: ["cic-pkg-group", token],
    queryFn: () => api(`${API}/group/${token}`),
    retry: false,
  });
  const [paying, setPaying] = useState<{ clientSecret: string; amountCents: number; paymentId: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  if (isLoading) return <TeampayShell brand={brand}><Loading brand={brand} /></TeampayShell>;
  if ((error as any)?.notFound || !data) return <NotFoundPage brand={brand} />;
  const g = data;
  const ages = (g.teams as any[]).map((t) => t.ageGroup).join(" + ");

  const start = async () => {
    setStarting(true); setPayError(null);
    try { setPaying(await api(`${API}/group/${token}/pay`, { method: "POST", body: "{}" })); }
    catch (e: any) { setPayError(e.message); }
    setStarting(false);
  };

  return (
    <TeampayShell brand={brand} eyebrow={`CIC 2027 · ${g.teams.length} teams · ${ages}`} title={g.clubName}>
      <div className="space-y-5">
        {g.status === "cancelled" && <Notice brand={brand} tone="error">One of these teams was cancelled. Email info@cicyouth.com and we'll sort it.</Notice>}
        {g.status === "expired" && (
          <Notice brand={brand} tone="warn">
            This quote's 14-day hold ended on {nzDate(g.expiresAt)} without a deposit. Build your trip again at{" "}
            <a href="https://packages.cicyouth.com" className="underline">packages.cicyouth.com</a> for today's price.
          </Notice>
        )}
        {g.status === "booked" && (
          <Notice brand={brand} tone="good">
            <CheckCircle2 size={16} className="mr-1.5 inline" style={{ color: "#34C759" }} />
            Booked. Deposit paid {nzDate(g.depositPaidAt)}. Each team now has its own page for instalments and its own players' link.
          </Notice>
        )}

        {(g.teams as any[]).map((t) => (
          <Card key={t.ageGroup} brand={brand} className="p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[16px] font-semibold">{t.ageGroup} <span className="text-[13px] font-normal" style={{ color: brand.mute }}>· {t.packageName} · plays {t.dates} 2027</span></div>
            </div>
            <div className="mt-1 text-[13px]" style={{ color: brand.mute }}>
              {t.origin} · {t.players} players, {t.staff} staff{t.nights ? ` · ${t.nights} nights` : ""}
            </div>
            <div className="mt-3 divide-y" style={{ borderColor: brand.line }}>
              {(t.lines || []).map((l: any) => (
                <div key={l.label} className="flex justify-between gap-3 py-2 text-[14px]" style={{ borderColor: brand.line }}>
                  <span className="min-w-0">{l.label}<span className="block text-[12px]" style={{ color: brand.mute }}>{l.detail}</span></span>
                  <span className="shrink-0 tabular-nums">{l.amount === null ? "TBC" : money(Math.round(l.amount * 100))}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t pt-3" style={{ borderColor: brand.line }}>
              <Row label="Per player" value={money(t.perPlayerCents)} />
              {t.flightsCents > 0 && <Row label="Flights (you book these)" value={money(t.flightsCents)} />}
              <Row label="Our invoice" value={money(t.invoiceCents)} strong />
            </div>
            {g.status === "booked" && (
              <a href={t.teamUrl} className="mt-4 block">
                <Button brand={brand} variant="ghost" className="w-full"><ExternalLink size={15} className="mr-2" />Open the {t.ageGroup} team page</Button>
              </a>
            )}
          </Card>
        ))}

        <Card brand={brand} className="p-5 sm:p-6" style={g.status === "held" ? { borderColor: brand.accent } : undefined}>
          <Row label={`All ${g.teams.length} teams`} value={money(g.invoiceCents)} strong sub="Our invoice, NZD, GST included" />
          {g.flightsCents > 0 && <Row label="Plus flights you book" value={money(g.flightsCents)} />}
          {g.status === "held" && (
            <>
              <div className="mt-3"><Row label="10% deposit today, all teams" value={money(g.depositCents)} strong sub="Non-refundable, unless CIC cancels the tournament" /></div>
              <div className="mt-2 flex items-start gap-2 text-[13px]" style={{ color: brand.mute }}>
                <Clock size={15} className="mt-0.5 shrink-0" style={{ color: brand.accent }} />
                <span>Held until <b style={{ color: brand.ink }}>{nzDate(g.expiresAt, true)}</b>. After that the price can change.</span>
              </div>
              <p className="mt-2 text-[13px]" style={{ color: brand.mute }}>
                Each team's balance is then paid in January, March and April, by your club or by that team's players.
              </p>
              {!paying && (
                <div className="mt-5">
                  <Button brand={brand} className="w-full" onClick={start} disabled={starting}>
                    {starting && <Loader2 size={16} className="mr-2 animate-spin" />} Pay {money(g.depositCents)} deposit
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>

        {payError && <Notice brand={brand} tone="error">{payError}</Notice>}
        {paying && (
          <div>
            <div className="mb-2 text-[13px]" style={{ color: brand.mute }}>10% deposit for {ages} (non-refundable)</div>
            <CardPay clientSecret={paying.clientSecret} amountCents={paying.amountCents} paymentId={paying.paymentId}
              confirmUrl={`${API}/group/${token}/confirm`} onPaid={() => { setPaying(null); refetch(); }} />
            <div className="mt-2 text-center"><Button brand={brand} variant="quiet" onClick={() => setPaying(null)}>Cancel</Button></div>
          </div>
        )}

        <p className="text-center text-[12px]" style={{ color: brand.mute }}>
          Keep this page's link: it has all your teams. Questions: info@cicyouth.com
        </p>
      </div>
    </TeampayShell>
  );
}
