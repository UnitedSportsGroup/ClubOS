// A player's own CIC 2027 page: join.cicyouth.com/cic-player/<token>.
// Pay their share of the team balance and add extras (merch, Victoria Foods
// meals, Christchurch attractions). The server prices everything; this page
// only names what was chosen.
import { useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Check, CheckCircle2, Loader2, Minus, Plus } from "lucide-react";
import { Button, Card, Loading, NotFoundPage, Notice, Select, TeampayShell } from "../teampay/shell";
import { API, CardPay, Row, api, brand, money } from "./common";

const CATEGORY_LABEL: Record<string, string> = {
  promo: "Packs & promotions", merch: "Merch", meal: "Victoria Foods meals", experience: "Christchurch attractions",
};
const ORDER = ["promo", "merch", "meal", "experience"];

type Pick = { qty: number; option: string };

export default function CicPackagePlayerPage() {
  const [, params] = useRoute("/cic-player/:token");
  const token = params?.token || "";
  const { data, isLoading, error, refetch } = useQuery<any>({
    queryKey: ["cic-pkg-player", token], queryFn: () => api(`${API}/player/${token}`), retry: false,
  });
  const [payShare, setPayShare] = useState(true);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [paying, setPaying] = useState<{ clientSecret: string; amountCents: number; paymentId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const extrasTotal = useMemo(() => {
    if (!data) return 0;
    return (data.extras as any[]).reduce((s, x) => s + (picks[x.id]?.qty ?? 0) * x.priceCents, 0);
  }, [picks, data]);

  if (isLoading) return <TeampayShell brand={brand}><Loading brand={brand} /></TeampayShell>;
  if ((error as any)?.notFound || !data) return <NotFoundPage brand={brand} />;
  const p = data;
  const share = payShare ? p.shareDueCents : 0;
  const total = share + extrasTotal;
  const grouped = ORDER.map((cat) => ({ cat, items: (p.extras as any[]).filter((x) => x.category === cat) })).filter((g) => g.items.length);

  const setQty = (x: any, qty: number) => setPicks((prev) => {
    const next = { ...prev };
    if (qty <= 0) delete next[x.id];
    else next[x.id] = { qty: Math.min(10, qty), option: prev[x.id]?.option ?? "" };
    return next;
  });
  const setOption = (x: any, option: string) => setPicks((prev) => ({ ...prev, [x.id]: { qty: prev[x.id]?.qty ?? 1, option } }));

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const items = Object.entries(picks).map(([id, v]) => ({ extraId: Number(id), qty: v.qty, option: v.option }));
      setPaying(await api(`${API}/player/${token}/pay`, { method: "POST", body: JSON.stringify({ payShare: payShare && p.shareDueCents > 0, items }) }));
    } catch (x: any) { setErr(x.message); }
    setBusy(false);
  };
  const onPaid = () => { setPaying(null); setPicks({}); setDone(true); refetch(); };

  return (
    <TeampayShell brand={brand} eyebrow={`CIC 2027 · ${p.ageGroup} · ${p.dates}`} title={`${p.firstName} ${p.lastName}`}>
      <div className="space-y-5">
        <Notice brand={brand} tone="good">
          <CheckCircle2 size={16} className="mr-1.5 inline" style={{ color: "#34C759" }} />
          Registered with {p.teamName || p.clubName}. Keep this page's link to come back.
        </Notice>
        {done && <Notice brand={brand} tone="good">Payment received. A receipt is on its way by email.</Notice>}

        {/* share */}
        <Card brand={brand} className="p-5 sm:p-6">
          <div className="text-[15px] font-semibold">Your share of the trip</div>
          <Row label="Your share" value={money(p.playerShareCents)} sub="After the 10% deposit your club paid" />
          <Row label="Paid" value={money(p.sharePaidCents)} />
          {p.shareDueCents > 0 ? (
            <button type="button" role="switch" aria-checked={payShare} onClick={() => setPayShare(!payShare)}
              className="mt-3 flex w-full items-center gap-3 rounded-xl p-3 text-left" style={{ minHeight: 44, border: `1px solid ${payShare ? brand.accent : brand.line}` }}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ background: payShare ? brand.accent : "transparent", border: `1px solid ${payShare ? brand.accent : brand.line}`, color: brand.onAccent }}>
                {payShare && <Check size={15} />}
              </span>
              <span className="flex-1 text-[14px]">Pay my share now <span style={{ color: brand.mute }}>({money(p.shareDueCents)})</span></span>
            </button>
          ) : (
            <p className="mt-2 text-[13px]" style={{ color: "#34C759" }}>{p.teamBalanceCleared && p.sharePaidCents < p.playerShareCents ? "Your club has paid the team balance." : "Your share is paid."}</p>
          )}
        </Card>

        {/* extras */}
        {grouped.length > 0 && (
          <Card brand={brand} className="p-5 sm:p-6">
            <div className="text-[15px] font-semibold">Add extras</div>
            <p className="mt-1 text-[13px]" style={{ color: brand.mute }}>Optional. We book attractions with your team on a free day around your games.</p>
            {grouped.map((g) => (
              <div key={g.cat} className="mt-5">
                <div className="text-[11px] font-semibold uppercase" style={{ color: brand.accent, letterSpacing: "0.14em" }}>{CATEGORY_LABEL[g.cat] ?? g.cat}</div>
                <div className="mt-2 space-y-2">
                  {g.items.map((x) => {
                    const pick = picks[x.id];
                    return (
                      <div key={x.id} className="rounded-xl p-3" style={{ border: `1px solid ${pick ? brand.accent : brand.line}` }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[14px] font-semibold">{x.name}</div>
                            {x.description && <div className="mt-0.5 text-[12px] leading-relaxed" style={{ color: brand.mute }}>{x.description}</div>}
                            <div className="mt-1 text-[13px] tabular-nums">{money(x.priceCents)}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" aria-label={`Fewer ${x.name}`} disabled={!pick} onClick={() => setQty(x, (pick?.qty ?? 0) - 1)}
                              className="grid h-11 w-11 place-items-center rounded-full disabled:opacity-30" style={{ border: `1px solid ${brand.line}` }}><Minus size={15} /></button>
                            <span className="w-6 text-center tabular-nums">{pick?.qty ?? 0}</span>
                            <button type="button" aria-label={`More ${x.name}`} onClick={() => setQty(x, (pick?.qty ?? 0) + 1)}
                              className="grid h-11 w-11 place-items-center rounded-full" style={{ border: `1px solid ${brand.line}` }}><Plus size={15} /></button>
                          </div>
                        </div>
                        {pick && x.options.length > 0 && (
                          <div className="mt-3"><Select brand={brand} value={pick.option} onChange={(v) => setOption(x, v)} options={x.options} placeholder="Choose a size" /></div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        )}

        {p.bought?.length > 0 && (
          <Card brand={brand} className="p-5">
            <div className="text-[13px] font-semibold">Already bought</div>
            {(p.bought as any[]).map((it, i) => (
              <Row key={i} label={`${it.qty} × ${it.name}${it.option ? ` (${it.option})` : ""}`} value={money(it.priceCents * it.qty)} />
            ))}
          </Card>
        )}

        {!paying && total > 0 && (
          <Card brand={brand} className="p-5 sm:p-6" style={{ borderColor: brand.accent }}>
            {share > 0 && <Row label="Your share" value={money(share)} />}
            {extrasTotal > 0 && <Row label="Extras" value={money(extrasTotal)} />}
            <Row label="Total" value={money(total)} strong />
            {err && <div className="mt-3"><Notice brand={brand} tone="error">{err}</Notice></div>}
            <Button brand={brand} className="mt-4 w-full" onClick={start} disabled={busy}>
              {busy && <Loader2 size={16} className="mr-2 animate-spin" />} Continue to pay {money(total)}
            </Button>
          </Card>
        )}
        {paying && (
          <div>
            <CardPay clientSecret={paying.clientSecret} amountCents={paying.amountCents} paymentId={paying.paymentId}
              confirmUrl={`${API}/player/${token}/confirm`} onPaid={onPaid} />
            <div className="mt-2 text-center"><Button brand={brand} variant="quiet" onClick={() => setPaying(null)}>Change my order</Button></div>
          </div>
        )}
        <p className="text-center text-[12px]" style={{ color: brand.mute }}>Questions: info@cicyouth.com</p>
      </div>
    </TeampayShell>
  );
}
