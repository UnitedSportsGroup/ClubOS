import { useState, useEffect, useMemo } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
import type { PrintMaterial } from "@shared/schema";

interface Addon { id: string; name: string; formula: string; unitPriceCents: number; default?: boolean; }
interface FinishingDefault { id: string; name: string; included: boolean; }
interface SizeTier { id: string; label: string; w?: number; h?: number; priceCents: number; }

interface QuoteResponse {
  ok: boolean;
  reason?: string;
  message?: string;
  item?: {
    unitPriceCents: number;
    qtyDiscountCents: number;
    addonsTotalCents: number;
    rushFeeCents: number;
    subtotalCents: number;
    breakdown: Array<{ label: string; cents: number }>;
    turnaroundDays: number;
  };
  totals?: { subtotalCents: number; gstCents: number; totalCents: number };
  material?: { name: string; turnaroundDays: number };
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function readyDateLabel(turnaroundDays: number): string {
  const d = new Date();
  let added = 0;
  while (added < turnaroundDays) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const weekday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  return `${weekday} ${d.getDate()} ${months[d.getMonth()]}`;
}

function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function PrintConfigure() {
  const [, params] = useRoute("/print/configure/:slug");
  const [, setLocation] = useLocation();
  const slug = params?.slug;

  const { data: material, isLoading } = useQuery<PrintMaterial>({
    queryKey: ["/api/print/materials", slug],
    queryFn: () => fetch(`/api/print/materials/${slug}`).then(r => {
      if (!r.ok) throw new Error("Material not found");
      return r.json();
    }),
    enabled: !!slug,
  });

  // Form state
  const [widthMm, setWidthMm] = useState<number>(2000);
  const [heightMm, setHeightMm] = useState<number>(1000);
  const [quantity, setQuantity] = useState<number>(1);
  const [sides, setSides] = useState<number>(1);
  const [tierId, setTierId] = useState<string>("");
  const [garmentColours, setGarmentColours] = useState<number>(1);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [rush, setRush] = useState<boolean>(false);

  // Init defaults once material loads
  useEffect(() => {
    if (!material) return;
    const addons = (material.addonsJson as Addon[]) ?? [];
    setSelectedAddons(addons.filter(a => a.default).map(a => a.id));
    if (material.pricingMethod === "per_piece_tiered" || material.pricingMethod === "bundle") {
      const tiers = (material.sizeTiersJson as SizeTier[]) ?? [];
      if (tiers[0]) setTierId(tiers[0].id);
    }
    if (material.sizeMinWMm) setWidthMm(Math.max(material.sizeMinWMm, 2000));
    if (material.sizeMinHMm) setHeightMm(Math.max(material.sizeMinHMm, 1000));
  }, [material]);

  const config = useMemo(() => {
    const c: any = { quantity, sides, selectedAddonIds: selectedAddons, rush };
    if (material?.pricingMethod === "per_m2" || material?.pricingMethod === "vinyl_decal" as any) {
      c.widthMm = widthMm;
      c.heightMm = heightMm;
    }
    if (material?.pricingMethod === "per_piece_tiered" || material?.pricingMethod === "bundle") {
      c.extra = { tierId };
      // Custom-size fallback for tiered products
      if (!tierId || tierId === "custom") {
        c.widthMm = widthMm;
        c.heightMm = heightMm;
      }
    }
    if (material?.pricingMethod === "garment_decoration") {
      c.extra = { colours: garmentColours };
    }
    return c;
  }, [material, widthMm, heightMm, quantity, sides, tierId, garmentColours, selectedAddons, rush]);

  const debouncedConfig = useDebounce(config, 200);

  const { data: quote, isFetching: quoting } = useQuery<QuoteResponse>({
    queryKey: ["/api/print/quote", slug, debouncedConfig],
    queryFn: () => fetch("/api/print/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialSlug: slug, config: debouncedConfig }),
    }).then(r => r.json()),
    enabled: !!material,
  });

  if (isLoading) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-zinc-500">Loading...</div>;
  }
  if (!material) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Material not found</h2>
          <button onClick={() => setLocation("/print")} className="text-blue-600 underline">Back to all products</button>
        </div>
      </div>
    );
  }

  const addons = (material.addonsJson as Addon[]) ?? [];
  const finishingDefault = (material.finishingDefaultJson as FinishingDefault[]) ?? [];
  const sizeTiers = (material.sizeTiersJson as SizeTier[]) ?? [];
  const usesDimensions = material.pricingMethod === "per_m2" ||
    (material.pricingMethod === "per_piece_tiered" && (!tierId || tierId === "custom"));
  const isGarment = material.pricingMethod === "garment_decoration";

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setLocation("/print")}
            className="flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900"
          >
            <ArrowLeft className="w-4 h-4" /> Back to products
          </button>
          <a href="tel:0800800199" className="text-sm font-medium hover:text-zinc-600">0800 800 199</a>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-10">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">
            {material.category.replace("_", " ")}
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">{material.name}</h1>
          <p className="text-zinc-600 mb-8 max-w-xl">{material.description}</p>

          <div className="space-y-6">
            {/* Stock-size selector for tiered products */}
            {sizeTiers.length > 0 && (
              <div>
                <label className="block text-sm font-semibold mb-3">Pick a size</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {sizeTiers.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTierId(t.id)}
                      className={`p-3 rounded-lg border text-left text-sm transition ${
                        tierId === t.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 hover:border-zinc-400"
                      }`}
                    >
                      <div className="font-semibold">{t.label}</div>
                      <div className={`text-xs mt-0.5 ${tierId === t.id ? "text-zinc-300" : "text-zinc-500"}`}>
                        {money(t.priceCents)}
                      </div>
                    </button>
                  ))}
                  <button
                    onClick={() => setTierId("custom")}
                    className={`p-3 rounded-lg border text-left text-sm transition ${
                      tierId === "custom" ? "border-zinc-900 bg-zinc-900 text-white" : "border-dashed border-zinc-300 hover:border-zinc-500"
                    }`}
                  >
                    <div className="font-semibold">Custom size</div>
                    <div className={`text-xs mt-0.5 ${tierId === "custom" ? "text-zinc-300" : "text-zinc-500"}`}>
                      Priced per m²
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Dimensions */}
            {usesDimensions && (
              <div>
                <label className="block text-sm font-semibold mb-2">Size (mm)</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Width</div>
                    <input
                      type="number"
                      value={widthMm}
                      onChange={(e) => setWidthMm(parseInt(e.target.value) || 0)}
                      min={material.sizeMinWMm ?? 0}
                      max={material.sizeMaxWMm ?? 9999}
                      className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Height</div>
                    <input
                      type="number"
                      value={heightMm}
                      onChange={(e) => setHeightMm(parseInt(e.target.value) || 0)}
                      min={material.sizeMinHMm ?? 0}
                      max={material.sizeMaxHMm ?? 9999}
                      className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none"
                    />
                  </div>
                </div>
                {(material.sizeMaxWMm || material.sizeMaxHMm) && (
                  <div className="text-xs text-zinc-500 mt-2">
                    Max size: {material.sizeMaxWMm ?? "—"}mm × {material.sizeMaxHMm ?? "—"}mm. Bigger? <a href="mailto:orders@unitedprints.co.nz" className="underline">Custom quote</a>.
                  </div>
                )}
              </div>
            )}

            {/* Quantity */}
            <div>
              <label className="block text-sm font-semibold mb-2">Quantity</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-lg border border-zinc-300 hover:border-zinc-900 font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  className="w-24 text-center px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 rounded-lg border border-zinc-300 hover:border-zinc-900 font-semibold"
                >
                  +
                </button>
                <div className="ml-3 text-xs text-zinc-500">Bigger discounts at 5, 10, 25, 50…</div>
              </div>
            </div>

            {/* Sides for banners + ACM */}
            {(material.pricingMethod === "per_m2" || material.pricingMethod === "per_piece_tiered") && material.category !== "vinyl_decal" && (
              <div>
                <label className="block text-sm font-semibold mb-2">Print sides</label>
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2].map((n) => (
                    <button
                      key={n}
                      onClick={() => setSides(n)}
                      className={`p-3 rounded-lg border text-sm font-medium transition ${
                        sides === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 hover:border-zinc-400"
                      }`}
                    >
                      {n === 1 ? "Single-sided" : "Double-sided (×1.7)"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Garment-specific: colours */}
            {isGarment && quantity >= 20 && (
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Number of ink colours
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setGarmentColours(n)}
                      className={`p-3 rounded-lg border text-sm font-medium transition ${
                        garmentColours === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 hover:border-zinc-400"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-zinc-500 mt-2">
                  Each colour adds a screen setup ($45). Quantity 20+ uses screen print; under 20 uses DTG (no setup).
                </div>
              </div>
            )}

            {/* Default finishing (informational) */}
            {finishingDefault.length > 0 && (
              <div>
                <label className="block text-sm font-semibold mb-2">Included</label>
                <div className="space-y-1.5">
                  {finishingDefault.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 text-sm text-zinc-600">
                      <Check className="w-4 h-4 text-green-600" />
                      {f.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add-ons */}
            {addons.length > 0 && (
              <div>
                <label className="block text-sm font-semibold mb-2">Add-ons</label>
                <div className="space-y-2">
                  {addons.map((a) => (
                    <label
                      key={a.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                        selectedAddons.includes(a.id)
                          ? "border-zinc-900 bg-zinc-50"
                          : "border-zinc-200 hover:border-zinc-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedAddons.includes(a.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAddons([...selectedAddons, a.id]);
                          } else {
                            setSelectedAddons(selectedAddons.filter(id => id !== a.id));
                          }
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-sm">{a.name}</div>
                        {a.unitPriceCents > 0 && (
                          <div className="text-xs text-zinc-500 mt-0.5">
                            +{money(a.unitPriceCents)}
                            {a.formula === "per_perimeter_m" ? "/m" : a.formula === "per_corner" ? " each corner" : ""}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Rush */}
            {material.rushAvailable && (
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                  rush ? "border-orange-500 bg-orange-50" : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={rush}
                  onChange={(e) => setRush(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                    Rush — ready in 2 days
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    +30% on the subtotal. We'll bump you to the front of the queue.
                  </div>
                </div>
              </label>
            )}
          </div>
        </div>

        {/* Sticky price rail */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">
              Your quote
            </div>

            {quote?.ok && quote.totals ? (
              <>
                <div className="text-4xl font-black tracking-tight">{money(quote.totals.totalCents)}</div>
                <div className="text-xs text-zinc-500 mt-1">
                  incl GST — ready by {readyDateLabel(quote.material?.turnaroundDays ?? material.turnaroundDays)}
                </div>

                {quote.item?.breakdown && quote.item.breakdown.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-zinc-200 space-y-1.5 text-xs">
                    {quote.item.breakdown.map((line, i) => (
                      <div key={i} className="flex justify-between gap-3">
                        <span className="text-zinc-600 truncate">{line.label}</span>
                        <span className={`font-mono ${line.cents < 0 ? "text-green-600" : "text-zinc-900"}`}>
                          {line.cents < 0 ? "−" : ""}{money(Math.abs(line.cents))}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1.5 border-t border-zinc-200 font-semibold">
                      <span>Subtotal</span>
                      <span className="font-mono">{money(quote.totals.subtotalCents)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>GST 15%</span>
                      <span className="font-mono">{money(quote.totals.gstCents)}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    sessionStorage.setItem("printOrderConfig", JSON.stringify({
                      materialSlug: slug, config: debouncedConfig, quote,
                    }));
                    setLocation("/print/checkout");
                  }}
                  className="w-full mt-6 py-3.5 rounded-xl bg-zinc-900 text-white font-semibold hover:bg-zinc-800 transition"
                >
                  Continue to checkout →
                </button>
              </>
            ) : quote?.ok === false ? (
              <div className="py-2">
                <div className="text-sm font-semibold text-amber-700 mb-2">Custom quote needed</div>
                <p className="text-sm text-zinc-700 mb-4">{quote.message}</p>
                <a
                  href={`mailto:orders@unitedprints.co.nz?subject=Custom quote — ${material.name}&body=Material: ${material.name}%0DSize: ${widthMm}×${heightMm}mm%0DQty: ${quantity}`}
                  className="block w-full py-3 rounded-xl bg-zinc-900 text-white font-semibold text-center hover:bg-zinc-800 transition"
                >
                  Email orders@unitedprints.co.nz
                </a>
              </div>
            ) : (
              <div className="text-3xl font-black tracking-tight text-zinc-300">
                {quoting ? "Calculating..." : "—"}
              </div>
            )}
          </div>

          <div className="mt-4 text-[11px] text-zinc-500 px-2">
            Live price updates as you type. Pay securely on the next step. Pickup from 466 Yaldhurst Rd, or delivered.
          </div>
        </aside>
      </div>
    </div>
  );
}
