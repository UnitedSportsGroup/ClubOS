import { useState, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useRoute, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, DollarSign, Settings, Percent, Tent, ExternalLink, Trash2, Plus, X, Save, FileText, BarChart3, Users, TrendingUp, ChevronDown, ChevronRight, UserCheck, UserX, AlertTriangle, Phone, Mail, Clock, User } from "lucide-react";

function OverviewTab({ camp, onUpdate }: { camp: any; onUpdate: (data: any) => void }) {
  const [name, setName] = useState(camp.name);
  const [description, setDescription] = useState(camp.description || "");
  const [location, setLocation] = useState(camp.location || "");
  const [startDate, setStartDate] = useState(camp.startDate || "");
  const [endDate, setEndDate] = useState(camp.endDate || "");
  const [ageMin, setAgeMin] = useState(String(camp.ageMin || ""));
  const [ageMax, setAgeMax] = useState(String(camp.ageMax || ""));
  const [capacity, setCapacity] = useState(String(camp.capacity || ""));
  const [isActive, setIsActive] = useState(camp.isActive);

  const handleSave = () => {
    onUpdate({ name, description, location, startDate: startDate || null, endDate: endDate || null, ageMin: parseInt(ageMin) || null, ageMax: parseInt(ageMax) || null, capacity: parseInt(capacity) || null, isActive });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Camp Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-name" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full h-24 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" data-testid="input-camp-description" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Location</label>
          <Input value={location} onChange={e => setLocation(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-location" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Start Date</label>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-start" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">End Date</label>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-end" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Min Age</label>
          <Input type="number" value={ageMin} onChange={e => setAgeMin(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-age-min" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Max Age</label>
          <Input type="number" value={ageMax} onChange={e => setAgeMax(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-age-max" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Total Capacity</label>
          <Input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-capacity" />
        </div>
        <div className="space-y-1.5 flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 rounded" data-testid="input-camp-active" />
            <span className="text-[13px] text-white/60">Active</span>
          </label>
        </div>
      </div>
      <Button onClick={handleSave} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn" data-testid="button-save-overview">
        <Save className="w-4 h-4 mr-1.5" /> Save Changes
      </Button>
    </div>
  );
}

function DatesTab({ campId }: { campId: number }) {
  const { data: dates, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/camps", campId, "dates"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/dates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dates");
      return res.json();
    },
  });
  const { toast } = useToast();
  const [newDate, setNewDate] = useState("");
  const [capFull, setCapFull] = useState("30");
  const [capMorn, setCapMorn] = useState("30");
  const [capAfter, setCapAfter] = useState("30");

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/camps/${campId}/dates`, {
        date: newDate,
        capacityFullDay: parseInt(capFull),
        capacityMorning: parseInt(capMorn),
        capacityAfternoon: parseInt(capAfter),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId, "dates"] });
      setNewDate("");
      toast({ title: "Date added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/camp-dates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId, "dates"] });
      toast({ title: "Date removed" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Date</label>
          <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="premium-input text-white/80 rounded-xl w-44" data-testid="input-new-date" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Full Day Cap</label>
          <Input type="number" value={capFull} onChange={e => setCapFull(e.target.value)} className="premium-input text-white/80 rounded-xl w-24" data-testid="input-cap-full" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">AM Cap</label>
          <Input type="number" value={capMorn} onChange={e => setCapMorn(e.target.value)} className="premium-input text-white/80 rounded-xl w-24" data-testid="input-cap-morning" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">PM Cap</label>
          <Input type="number" value={capAfter} onChange={e => setCapAfter(e.target.value)} className="premium-input text-white/80 rounded-xl w-24" data-testid="input-cap-afternoon" />
        </div>
        <Button onClick={() => addMutation.mutate()} disabled={!newDate || addMutation.isPending} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn" data-testid="button-add-date">
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl bg-blue-500/[0.04]" />
      ) : dates && dates.length > 0 ? (
        <div className="rounded-xl border border-blue-500/[0.08] overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="border-b border-blue-500/[0.06]">
                <th className="text-left px-4 py-2.5 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Date</th>
                <th className="text-center px-4 py-2.5 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Full Day</th>
                <th className="text-center px-4 py-2.5 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Morning</th>
                <th className="text-center px-4 py-2.5 text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Afternoon</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d: any) => (
                <tr key={d.id} className="border-b border-blue-500/[0.04] row-hover" data-testid={`row-date-${d.id}`}>
                  <td className="px-4 py-2.5 text-[13px] text-white/70">{d.date}</td>
                  <td className="text-center px-4 py-2.5 text-[13px] text-white/50">{d.capacityFullDay}</td>
                  <td className="text-center px-4 py-2.5 text-[13px] text-white/50">{d.capacityMorning}</td>
                  <td className="text-center px-4 py-2.5 text-[13px] text-white/50">{d.capacityAfternoon}</td>
                  <td className="px-2">
                    <button onClick={() => deleteMutation.mutate(d.id)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer" data-testid={`button-delete-date-${d.id}`}>
                      <Trash2 className="w-3.5 h-3.5 text-white/20 hover:text-red-400" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-white/25 text-center py-8">No dates added yet</p>
      )}
    </div>
  );
}

function PricingTab({ campId }: { campId: number }) {
  const { data: pricing, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/camps", campId, "pricing"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/pricing`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load pricing");
      return res.json();
    },
  });
  const { toast } = useToast();
  const [fullDay, setFullDay] = useState("");
  const [morning, setMorning] = useState("");
  const [afternoon, setAfternoon] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = [
        { productType: "FULL_DAY", priceCents: Math.round(parseFloat(fullDay) * 100), currency: "NZD" },
        { productType: "MORNING", priceCents: Math.round(parseFloat(morning) * 100), currency: "NZD" },
        { productType: "AFTERNOON", priceCents: Math.round(parseFloat(afternoon) * 100), currency: "NZD" },
      ].filter(p => !isNaN(p.priceCents) && p.priceCents > 0);
      await apiRequest("PUT", `/api/admin/camps/${campId}/pricing`, items);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId, "pricing"] });
      toast({ title: "Pricing saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const loaded = pricing && !isLoading;
  if (loaded && !fullDay && !morning && !afternoon) {
    const fd = pricing.find((p: any) => p.productType === "FULL_DAY");
    const am = pricing.find((p: any) => p.productType === "MORNING");
    const pm = pricing.find((p: any) => p.productType === "AFTERNOON");
    if (fd) setTimeout(() => setFullDay((fd.priceCents / 100).toFixed(2)), 0);
    if (am) setTimeout(() => setMorning((am.priceCents / 100).toFixed(2)), 0);
    if (pm) setTimeout(() => setAfternoon((pm.priceCents / 100).toFixed(2)), 0);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Full Day (NZD)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <Input type="number" step="0.01" value={fullDay} onChange={e => setFullDay(e.target.value)} placeholder="75.00" className="pl-9 premium-input text-white/80 rounded-xl" data-testid="input-price-full-day" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Morning (NZD)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <Input type="number" step="0.01" value={morning} onChange={e => setMorning(e.target.value)} placeholder="45.00" className="pl-9 premium-input text-white/80 rounded-xl" data-testid="input-price-morning" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Afternoon (NZD)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <Input type="number" step="0.01" value={afternoon} onChange={e => setAfternoon(e.target.value)} placeholder="45.00" className="pl-9 premium-input text-white/80 rounded-xl" data-testid="input-price-afternoon" />
          </div>
        </div>
      </div>
      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn" data-testid="button-save-pricing">
        <Save className="w-4 h-4 mr-1.5" /> Save Pricing
      </Button>
    </div>
  );
}

function DiscountsTab({ campId }: { campId: number }) {
  const { data: discounts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/camps", campId, "discounts"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/discounts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load discounts");
      return res.json();
    },
  });
  const { toast } = useToast();
  const [items, setItems] = useState<{ minBookings: string; discountPercent: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  if (discounts && !isLoading && !loaded) {
    setItems(discounts.map((d: any) => ({ minBookings: String(d.minBookings), discountPercent: String(d.discountPercent) })));
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = items.filter(i => parseInt(i.minBookings) > 0 && parseFloat(i.discountPercent) > 0).map(i => ({
        minBookings: parseInt(i.minBookings),
        discountPercent: i.discountPercent,
      }));
      await apiRequest("PUT", `/api/admin/camps/${campId}/discounts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId, "discounts"] });
      toast({ title: "Discounts saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-white/30">Volume discounts based on total session bookings per registration</p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">Min Bookings</label>
              <Input type="number" value={item.minBookings} onChange={e => { const n = [...items]; n[i].minBookings = e.target.value; setItems(n); }} className="premium-input text-white/80 rounded-xl w-28" data-testid={`input-discount-min-${i}`} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">Discount %</label>
              <Input type="number" step="0.01" value={item.discountPercent} onChange={e => { const n = [...items]; n[i].discountPercent = e.target.value; setItems(n); }} className="premium-input text-white/80 rounded-xl w-28" data-testid={`input-discount-pct-${i}`} />
            </div>
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="mt-5 w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer">
              <X className="w-3.5 h-3.5 text-white/20" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => setItems([...items, { minBookings: "", discountPercent: "" }])} className="rounded-xl h-8 text-[12px] border-blue-500/20 text-blue-400/60 hover:bg-blue-500/5" data-testid="button-add-discount">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Tier
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-8 text-[12px] glow-btn" data-testid="button-save-discounts">
          <Save className="w-3.5 h-3.5 mr-1" /> Save
        </Button>
      </div>
    </div>
  );
}

function ContentTab({ camp, onUpdate }: { camp: any; onUpdate: (data: any) => void }) {
  const [heroHeadline, setHeroHeadline] = useState(camp.heroHeadline || "");
  const [heroSubheadline, setHeroSubheadline] = useState(camp.heroSubheadline || "");
  const [descriptionShort, setDescriptionShort] = useState(camp.descriptionShort || "");
  const [descriptionLong, setDescriptionLong] = useState(camp.descriptionLong || "");
  const [whatToBring, setWhatToBring] = useState(camp.whatToBring || "");
  const [inclusions, setInclusions] = useState(camp.inclusions || "");
  const [refundPolicy, setRefundPolicy] = useState(camp.refundPolicy || "");
  const [contactEmail, setContactEmail] = useState(camp.contactEmail || "");
  const [primaryCta, setPrimaryCta] = useState(camp.primaryCta || "Book Now");
  const [faqItems, setFaqItems] = useState<{q: string; a: string}[]>(() => {
    try { return camp.faqJson ? JSON.parse(camp.faqJson) : []; } catch { return []; }
  });

  const handleSave = () => {
    onUpdate({
      heroHeadline: heroHeadline || null,
      heroSubheadline: heroSubheadline || null,
      descriptionShort: descriptionShort || null,
      descriptionLong: descriptionLong || null,
      whatToBring: whatToBring || null,
      inclusions: inclusions || null,
      refundPolicy: refundPolicy || null,
      contactEmail: contactEmail || null,
      primaryCta: primaryCta || "Book Now",
      faqJson: faqItems.length > 0 ? JSON.stringify(faqItems.filter(f => f.q)) : null,
    });
  };

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-white/30">These fields control the public landing page for this camp</p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Hero Headline</label>
          <Input value={heroHeadline} onChange={e => setHeroHeadline(e.target.value)} placeholder="Give Your Child the Best School Holiday Experience" className="premium-input text-white/80 rounded-xl" data-testid="input-hero-headline" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Hero Subheadline</label>
          <Input value={heroSubheadline} onChange={e => setHeroSubheadline(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-hero-subheadline" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">CTA Button Text</label>
            <Input value={primaryCta} onChange={e => setPrimaryCta(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-primary-cta" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Contact Email</label>
            <Input value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-contact-email" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Short Description</label>
          <textarea value={descriptionShort} onChange={e => setDescriptionShort(e.target.value)} className="w-full h-16 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" placeholder="One-liner for camp listing cards" data-testid="input-description-short" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Long Description</label>
          <textarea value={descriptionLong} onChange={e => setDescriptionLong(e.target.value)} className="w-full h-28 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" placeholder="Detailed description for the About section" data-testid="input-description-long" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">What's Included (one per line)</label>
          <textarea value={inclusions} onChange={e => setInclusions(e.target.value)} className="w-full h-24 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" data-testid="input-inclusions" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">What to Bring (one per line)</label>
          <textarea value={whatToBring} onChange={e => setWhatToBring(e.target.value)} className="w-full h-24 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" data-testid="input-what-to-bring" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Refund Policy</label>
          <textarea value={refundPolicy} onChange={e => setRefundPolicy(e.target.value)} className="w-full h-16 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" data-testid="input-refund-policy" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">FAQ Items</label>
          <Button variant="outline" onClick={() => setFaqItems([...faqItems, { q: "", a: "" }])} className="rounded-lg h-7 text-[11px] border-blue-500/20 text-blue-400/60 hover:bg-blue-500/5" data-testid="button-add-faq">
            <Plus className="w-3 h-3 mr-1" /> Add FAQ
          </Button>
        </div>
        {faqItems.map((item, i) => (
          <div key={i} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <Input value={item.q} onChange={e => { const n = [...faqItems]; n[i].q = e.target.value; setFaqItems(n); }} placeholder="Question" className="premium-input text-white/80 rounded-lg text-[12px]" data-testid={`input-faq-q-${i}`} />
                <textarea value={item.a} onChange={e => { const n = [...faqItems]; n[i].a = e.target.value; setFaqItems(n); }} placeholder="Answer" className="w-full h-14 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" data-testid={`input-faq-a-${i}`} />
              </div>
              <button onClick={() => setFaqItems(faqItems.filter((_, j) => j !== i))} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer mt-1">
                <X className="w-3 h-3 text-white/20" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Button onClick={handleSave} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn" data-testid="button-save-content">
        <Save className="w-4 h-4 mr-1.5" /> Save Content
      </Button>
    </div>
  );
}

function EmailTab({ campId }: { campId: number }) {
  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/camps", campId, "settings"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/settings`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [loaded, setLoaded] = useState(false);

  if (settings && !isLoading && !loaded && settings.id) {
    setSubject(settings.confirmationEmailSubject || "");
    setBody(settings.confirmationEmailBody || "");
    setFromEmail(settings.fromEmail || "");
    setReplyTo(settings.replyTo || "");
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/admin/camps/${campId}/settings`, {
      confirmationEmailSubject: subject,
      confirmationEmailBody: body,
      fromEmail,
      replyTo,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId, "settings"] });
      toast({ title: "Email template saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-white/30">Variables: {"{{campName}}, {{parentName}}, {{childrenList}}, {{campDates}}, {{location}}, {{totalPaid}}"}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">From Email</label>
          <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-from-email" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Reply-To</label>
          <Input value={replyTo} onChange={e => setReplyTo(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-reply-to" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Subject</label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-email-subject" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Body</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} className="w-full h-40 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none font-mono" data-testid="input-email-body" />
        </div>
      </div>
      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-9 text-[13px] glow-btn" data-testid="button-save-email">
        <Save className="w-4 h-4 mr-1.5" /> Save Template
      </Button>
    </div>
  );
}

type SessionSummary = { campDateId: number; date: string; productType: string; bookedCount: number; capacity: number };
type CampStats = { totalRegistrations: number; confirmedRegistrations: number; totalRevenueCents: number; totalSessions: number };

function StatsHeader({ campId }: { campId: number }) {
  const { data: stats, isLoading } = useQuery<CampStats>({
    queryKey: ["/api/admin/camps", campId, "stats"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
  });

  const { data: sessions } = useQuery<SessionSummary[]>({
    queryKey: ["/api/admin/camps", campId, "sessions-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/sessions-summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  const avgOccupancy = sessions && sessions.length > 0
    ? Math.round(sessions.filter(s => s.capacity > 0).reduce((sum, s) => sum + (s.bookedCount / s.capacity) * 100, 0) / (sessions.filter(s => s.capacity > 0).length || 1))
    : 0;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[72px] rounded-xl bg-blue-500/[0.04]" />)}
      </div>
    );
  }

  const statItems = [
    { label: "Total Registrations", value: stats?.totalRegistrations || 0, icon: Users, color: "text-blue-400" },
    { label: "Confirmed", value: stats?.confirmedRegistrations || 0, icon: TrendingUp, color: "text-emerald-400" },
    { label: "Revenue", value: `$${((stats?.totalRevenueCents || 0) / 100).toFixed(0)}`, icon: DollarSign, color: "text-amber-400" },
    { label: "Avg Occupancy", value: `${avgOccupancy}%`, icon: BarChart3, color: "text-purple-400" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="stats-header">
      {statItems.map((s) => (
        <div key={s.label} className="rounded-xl border border-blue-500/[0.08] bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <s.icon className={`w-3.5 h-3.5 ${s.color} opacity-50`} />
            <span className="text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">{s.label}</span>
          </div>
          <p className={`text-lg font-semibold ${s.color}/80`} data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${day} ${dd}/${mm}`;
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const startOfWeek = new Date(d);
  startOfWeek.setDate(d.getDate() - d.getDay() + 1);
  const dd = String(startOfWeek.getDate()).padStart(2, "0");
  const mm = String(startOfWeek.getMonth() + 1).padStart(2, "0");
  return `Week of ${dd}/${mm}`;
}

type RollPlayer = {
  child: { id: number; firstName: string; lastName: string; dateOfBirth?: string | null; gender?: string | null; parentId: number; medical?: { allergies?: string | null; epiPen?: boolean; notes?: string | null } };
  parent: { id: number; firstName: string; lastName: string; email?: string | null; phone?: string | null };
  attendance?: { id: number; checkedInAt?: string | null; checkedOutAt?: string | null; note?: string | null };
  productType: string;
};

function formatAge(dob: string | null | undefined): string {
  if (!dob) return "—";
  const birth = new Date(dob + "T00:00:00");
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return `${age}y`;
}

function formatDob(dob: string | null | undefined): string {
  if (!dob) return "—";
  const d = new Date(dob + "T00:00:00");
  return d.toLocaleDateString("en-NZ", { day: "2-digit", month: "short", year: "numeric" });
}

function PlayerProfileModal({ player, onClose }: { player: RollPlayer; onClose: () => void }) {
  const c = player.child;
  const p = player.parent;
  const med = c.medical;
  const hasAllergies = med?.allergies && med.allergies.trim().length > 0;
  const hasEpiPen = med?.epiPen;
  const hasMedNotes = med?.notes && med.notes.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 rounded-2xl border border-blue-500/[0.15] overflow-hidden animate-fade-in-up" style={{ background: "linear-gradient(135deg, rgba(3,86,197,0.06) 0%, #02060E 100%)", animationDelay: "0ms", opacity: 0 }} data-testid="modal-player-profile">
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
              <User className="w-4 h-4 text-blue-400/70" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-white/80" data-testid="text-player-name">{c.firstName} {c.lastName}</h3>
              <p className="text-[11px] text-blue-400/35">{formatAge(c.dateOfBirth)} old · {c.gender || "—"}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors cursor-pointer" data-testid="button-close-profile">
            <X className="w-3.5 h-3.5 text-white/40" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <label className="text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">Player Details</label>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-[12px] text-white/40">Date of Birth</span>
                <span className="text-[12px] text-white/70" data-testid="text-player-dob">{formatDob(c.dateOfBirth)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-white/40">Gender</span>
                <span className="text-[12px] text-white/70">{c.gender || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-white/40">Session Type</span>
                <span className="text-[12px] text-white/70">{player.productType === "FULL_DAY" ? "Full Day" : player.productType === "MORNING" ? "Morning" : "Afternoon"}</span>
              </div>
            </div>
          </div>

          {(hasAllergies || hasEpiPen || hasMedNotes) && (
            <div className="space-y-2">
              <label className="text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400/50" /> Medical Info
              </label>
              <div className="rounded-xl bg-amber-500/[0.04] border border-amber-500/[0.12] p-3 space-y-2">
                {hasAllergies && (
                  <div>
                    <span className="text-[11px] text-amber-400/50 font-medium">Allergies</span>
                    <p className="text-[12px] text-white/70 mt-0.5" data-testid="text-player-allergies">{med!.allergies}</p>
                  </div>
                )}
                {hasEpiPen && (
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] text-red-400/80 border-red-500/20 bg-red-500/10 uppercase tracking-wider no-default-hover-elevate no-default-active-elevate" data-testid="badge-epipen">EpiPen Required</Badge>
                  </div>
                )}
                {hasMedNotes && (
                  <div>
                    <span className="text-[11px] text-amber-400/50 font-medium">Medical Notes</span>
                    <p className="text-[12px] text-white/70 mt-0.5" data-testid="text-player-medical-notes">{med!.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">Parent / Guardian</label>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[12px] text-white/40">Name</span>
                <span className="text-[12px] text-white/70 font-medium" data-testid="text-parent-name">{p.firstName} {p.lastName}</span>
              </div>
              {p.email && (
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-white/40 flex items-center gap-1"><Mail className="w-3 h-3" /> Email</span>
                  <a href={`mailto:${p.email}`} className="text-[12px] text-blue-400/70 hover:text-blue-400 transition-colors" data-testid="text-parent-email">{p.email}</a>
                </div>
              )}
              {p.phone && (
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-white/40 flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</span>
                  <a href={`tel:${p.phone}`} className="text-[12px] text-blue-400/70 hover:text-blue-400 transition-colors" data-testid="text-parent-phone">{p.phone}</a>
                </div>
              )}
            </div>
          </div>

          {player.attendance && (
            <div className="space-y-2">
              <label className="text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">Attendance</label>
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[12px] text-white/40">Signed In</span>
                  <span className="text-[12px] text-white/70">{player.attendance.checkedInAt ? new Date(player.attendance.checkedInAt).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12px] text-white/40">Signed Out</span>
                  <span className="text-[12px] text-white/70">{player.attendance.checkedOutAt ? new Date(player.attendance.checkedOutAt).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                </div>
                {player.attendance.note && (
                  <div>
                    <span className="text-[12px] text-white/40">Note</span>
                    <p className="text-[12px] text-white/70 mt-0.5">{player.attendance.note}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionRollPanel({ campId, campDateId, sessionType, date }: { campId: number; campDateId: number; sessionType: string; date: string }) {
  const { toast } = useToast();
  const [selectedPlayer, setSelectedPlayer] = useState<RollPlayer | null>(null);

  const { data: roll, isLoading } = useQuery<RollPlayer[]>({
    queryKey: ["/api/admin/camps", campId, "session-roll", campDateId, sessionType],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/session-roll?campDateId=${campDateId}&sessionType=${sessionType}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load roll");
      return res.json();
    },
  });

  const checkInMutation = useMutation({
    mutationFn: async ({ attendanceId, action }: { attendanceId: number; action: "in" | "out" }) => {
      const body = action === "in"
        ? { checkedInAt: new Date().toISOString() }
        : { checkedOutAt: new Date().toISOString() };
      await apiRequest("PATCH", `/api/admin/attendance/${attendanceId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId, "session-roll", campDateId, sessionType] });
      toast({ title: "Attendance updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={4} className="px-4 py-3">
          <Skeleton className="h-16 w-full rounded-lg bg-blue-500/[0.04]" />
        </td>
      </tr>
    );
  }

  if (!roll || roll.length === 0) {
    return (
      <tr>
        <td colSpan={4} className="px-6 py-4">
          <p className="text-[12px] text-white/25 text-center">No players registered for this session</p>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <td colSpan={4} className="p-0">
          <div className="mx-3 mb-2 rounded-lg border border-blue-500/[0.08] overflow-hidden bg-blue-500/[0.02]">
            <div className="px-3 py-1.5 bg-blue-500/[0.04] border-b border-blue-500/[0.06] flex items-center justify-between">
              <span className="text-[10px] text-blue-300/30 uppercase tracking-wider font-semibold">
                {getDayLabel(date)} · {sessionType === "MORNING" ? "Morning" : "Afternoon"} Roll — {roll.length} player{roll.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-emerald-400/40">
                  {roll.filter(p => p.attendance?.checkedInAt).length} signed in
                </span>
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-blue-500/[0.05]">
                  <th className="text-left px-3 py-1.5 text-[9px] text-blue-300/20 uppercase tracking-wider font-semibold">Player</th>
                  <th className="text-left px-3 py-1.5 text-[9px] text-blue-300/20 uppercase tracking-wider font-semibold hidden sm:table-cell">Age</th>
                  <th className="text-center px-3 py-1.5 text-[9px] text-blue-300/20 uppercase tracking-wider font-semibold">Status</th>
                  <th className="text-right px-3 py-1.5 text-[9px] text-blue-300/20 uppercase tracking-wider font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roll.map((player) => {
                  const isIn = !!player.attendance?.checkedInAt;
                  const isOut = !!player.attendance?.checkedOutAt;
                  const hasMedical = player.child.medical?.allergies || player.child.medical?.epiPen;

                  return (
                    <tr
                      key={player.child.id}
                      className="border-b border-blue-500/[0.03] hover:bg-blue-500/[0.03] transition-colors group"
                      data-testid={`row-player-${player.child.id}`}
                    >
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setSelectedPlayer(player)}
                          className="flex items-center gap-2 text-left cursor-pointer hover:opacity-80 transition-opacity"
                          data-testid={`button-player-profile-${player.child.id}`}
                        >
                          <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-semibold text-blue-400/60">
                              {player.child.firstName[0]}{player.child.lastName[0]}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-white/75 truncate">{player.child.firstName} {player.child.lastName}</p>
                            <p className="text-[10px] text-white/25 truncate">{player.parent.firstName} {player.parent.lastName}</p>
                          </div>
                          {hasMedical && (
                            <AlertTriangle className="w-3 h-3 text-amber-400/60 flex-shrink-0" title="Has medical info" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <span className="text-[11px] text-white/40">{formatAge(player.child.dateOfBirth)}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isOut ? (
                          <Badge variant="outline" className="text-[8px] text-blue-400/60 border-blue-500/15 bg-blue-500/8 uppercase tracking-wider no-default-hover-elevate no-default-active-elevate" data-testid={`badge-status-${player.child.id}`}>Signed Out</Badge>
                        ) : isIn ? (
                          <Badge variant="outline" className="text-[8px] text-emerald-400/70 border-emerald-500/15 bg-emerald-500/10 uppercase tracking-wider no-default-hover-elevate no-default-active-elevate" data-testid={`badge-status-${player.child.id}`}>Signed In</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[8px] text-white/25 border-white/8 bg-white/[0.02] uppercase tracking-wider no-default-hover-elevate no-default-active-elevate" data-testid={`badge-status-${player.child.id}`}>Not Arrived</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isIn && player.attendance && (
                            <button
                              onClick={() => checkInMutation.mutate({ attendanceId: player.attendance!.id, action: "in" })}
                              disabled={checkInMutation.isPending}
                              className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400/70 font-medium hover:bg-emerald-500/20 transition-colors cursor-pointer"
                              data-testid={`button-signin-${player.child.id}`}
                            >
                              <UserCheck className="w-3 h-3" /> In
                            </button>
                          )}
                          {isIn && !isOut && player.attendance && (
                            <button
                              onClick={() => checkInMutation.mutate({ attendanceId: player.attendance!.id, action: "out" })}
                              disabled={checkInMutation.isPending}
                              className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400/70 font-medium hover:bg-blue-500/20 transition-colors cursor-pointer"
                              data-testid={`button-signout-${player.child.id}`}
                            >
                              <UserX className="w-3 h-3" /> Out
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
      {selectedPlayer && <PlayerProfileModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
    </>
  );
}

function SessionsTab({ campId }: { campId: number }) {
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const { data: sessions, isLoading } = useQuery<SessionSummary[]>({
    queryKey: ["/api/admin/camps", campId, "sessions-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}/sessions-summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl bg-blue-500/[0.04]" />;
  }

  if (!sessions || sessions.length === 0) {
    return <p className="text-[13px] text-white/25 text-center py-8">No sessions available. Add dates first.</p>;
  }

  const uniqueDates = [...new Set(sessions.map(s => s.date))].sort();
  const weeks: Record<string, string[]> = {};
  uniqueDates.forEach(d => {
    const wk = getWeekKey(d);
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push(d);
  });

  const toggleSession = (key: string) => {
    setExpandedSession(prev => prev === key ? null : key);
  };

  return (
    <div className="space-y-4">
      {Object.entries(weeks).map(([weekLabel, dates]) => {
        let weekBooked = 0;
        let weekCapacity = 0;
        dates.forEach(d => {
          sessions.filter(s => s.date === d).forEach(s => {
            weekBooked += s.bookedCount;
            weekCapacity += s.capacity;
          });
        });

        return (
          <div key={weekLabel} className="rounded-xl border border-blue-500/[0.08] overflow-hidden">
            <div className="px-4 py-2.5 bg-blue-500/[0.04] border-b border-blue-500/[0.06]">
              <span className="text-[11px] text-blue-300/40 uppercase tracking-wider font-semibold">{weekLabel}</span>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]" data-testid={`table-sessions-${weekLabel}`}>
              <thead>
                <tr className="border-b border-blue-500/[0.06]">
                  <th className="text-left px-4 py-2 text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">Session</th>
                  <th className="text-left px-4 py-2 text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold hidden sm:table-cell">Type</th>
                  <th className="text-center px-4 py-2 text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold">Booked / Limit</th>
                  <th className="text-left px-4 py-2 text-[10px] text-blue-300/25 uppercase tracking-wider font-semibold w-32 hidden md:table-cell">Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {dates.map(date =>
                  ["MORNING", "AFTERNOON"].map(pt => {
                    const s = sessions.find(x => x.date === date && x.productType === pt);
                    if (!s || s.capacity === 0) return null;
                    const sessionKey = `${date}-${pt}`;
                    const isExpanded = expandedSession === sessionKey;
                    const pct = s.capacity > 0 ? Math.round((s.bookedCount / s.capacity) * 100) : 0;
                    const barColor = pct >= 90 ? "bg-red-400" : pct >= 60 ? "bg-amber-400" : (pt === "MORNING" ? "bg-amber-400" : "bg-orange-400");
                    return (
                      <Fragment key={sessionKey}>
                        <tr
                          onClick={() => toggleSession(sessionKey)}
                          className={`border-b border-blue-500/[0.03] hover:bg-blue-500/[0.04] transition-colors cursor-pointer ${isExpanded ? "bg-blue-500/[0.04]" : ""}`}
                          data-testid={`row-session-${s.campDateId}-${pt}`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-blue-400/40" /> : <ChevronRight className="w-3.5 h-3.5 text-white/20" />}
                              <span className="text-[13px] text-white/70 font-medium">{getDayLabel(date)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">
                            <span className={`text-[11px] font-medium ${pt === "MORNING" ? "text-amber-400/60" : "text-orange-400/60"}`}>
                              {pt === "MORNING" ? "Morning" : "Afternoon"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="text-[13px] text-white/60">
                              <span className="font-semibold text-white/80">{s.bookedCount}</span>
                              <span className="text-white/25 mx-1">/</span>
                              <span>{s.capacity}</span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <span className="text-[10px] text-white/30 w-8 text-right">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && <SessionRollPanel campId={campId} campDateId={s.campDateId} sessionType={pt} date={date} />}
                      </Fragment>
                    );
                  })
                )}
                <tr className="bg-blue-500/[0.03]">
                  <td className="px-4 py-2 text-[11px] text-blue-300/30 font-semibold uppercase tracking-wider" colSpan={2}>Week Total</td>
                  <td className="px-4 py-2 text-center">
                    <span className="text-[12px] text-white/50 font-medium">{weekBooked} / {weekCapacity}</span>
                  </td>
                  <td className="px-4 py-2 hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full bg-blue-400/60 transition-all duration-500" style={{ width: `${weekCapacity > 0 ? Math.min(Math.round((weekBooked / weekCapacity) * 100), 100) : 0}%` }} />
                      </div>
                      <span className="text-[10px] text-white/30 w-8 text-right">{weekCapacity > 0 ? Math.round((weekBooked / weekCapacity) * 100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminCampDetail() {
  const [, params] = useRoute("/admin/camps/:id");
  const campId = parseInt(params?.id || "0");
  const [tab, setTab] = useState("sessions");
  const [showEditModal, setShowEditModal] = useState(false);
  const { toast } = useToast();

  const { data: camp, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/camps", campId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load camp");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/admin/camps/${campId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps"] });
      toast({ title: "Camp updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const tabs = [
    { key: "sessions", label: "Sessions", icon: BarChart3 },
    { key: "content", label: "Content", icon: FileText },
    { key: "dates", label: "Dates & Capacity", icon: Calendar },
    { key: "pricing", label: "Pricing", icon: DollarSign },
    { key: "discounts", label: "Discounts", icon: Percent },
    { key: "email", label: "Email Template", icon: Settings },
  ];

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64 bg-blue-500/[0.04]" />
        <Skeleton className="h-[400px] w-full rounded-2xl bg-blue-500/[0.04]" />
      </div>
    );
  }

  if (!camp) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <p className="text-white/40">Camp not found</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start sm:items-center gap-3 animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <Link href="/admin/camps">
          <button className="w-8 h-8 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer flex-shrink-0 mt-0.5 sm:mt-0" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 text-white/40" />
          </button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-white tracking-tight truncate" data-testid="text-camp-name">{camp.name}</h1>
          <p className="text-[12px] text-blue-400/35 truncate">/{camp.slug}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            onClick={() => setShowEditModal(true)}
            className="rounded-xl h-8 text-[12px] border-blue-500/20 text-blue-400/60 hover:bg-blue-500/5 cursor-pointer"
            data-testid="button-edit-camp"
          >
            <Settings className="w-3.5 h-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Edit</span>
          </Button>
          {camp.slug && (
            <Button variant="outline" asChild className="rounded-xl h-8 text-[12px] border-blue-500/20 text-blue-400/60 hover:bg-blue-500/5">
              <a href={`/${camp.slug}`} target="_blank" rel="noopener noreferrer" data-testid="link-public-page">
                <ExternalLink className="w-3.5 h-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Public Page</span>
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 animate-fade-in-up scrollbar-hide" style={{ animationDelay: '50ms', opacity: 0 }}>
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.04] w-max sm:w-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                tab === t.key
                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/25"
                  : "text-white/35 hover:text-white/55 border border-transparent"
              }`}
              data-testid={`tab-${t.key}`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="animate-fade-in-up" style={{ animationDelay: '75ms', opacity: 0 }}>
        <StatsHeader campId={campId} />
      </div>

      <div className="rounded-2xl glass-card p-3 sm:p-5 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        {tab === "sessions" && <SessionsTab campId={campId} />}
        {tab === "content" && <ContentTab camp={camp} onUpdate={(data) => updateMutation.mutate(data)} />}
        {tab === "dates" && <DatesTab campId={campId} />}
        {tab === "pricing" && <PricingTab campId={campId} />}
        {tab === "discounts" && <DiscountsTab campId={campId} />}
        {tab === "email" && <EmailTab campId={campId} />}
      </div>

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowEditModal(false)} />
          <div
            className="relative w-full max-w-2xl mx-4 max-h-[85vh] rounded-2xl border border-blue-500/[0.15] overflow-hidden flex flex-col animate-fade-in-up"
            style={{ background: "linear-gradient(135deg, rgba(3,86,197,0.06) 0%, #02060E 100%)", animationDelay: "0ms", opacity: 0 }}
            data-testid="modal-edit-camp"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-500/[0.08] flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                  <Settings className="w-4 h-4 text-blue-400/70" />
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-white/80">Edit Camp</h3>
                  <p className="text-[11px] text-blue-400/35">Update camp settings</p>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors cursor-pointer"
                data-testid="button-close-edit"
              >
                <X className="w-3.5 h-3.5 text-white/40" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-6">
              <OverviewTab camp={camp} onUpdate={(data) => { updateMutation.mutate(data, { onSuccess: () => setShowEditModal(false) }); }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
