import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Calendar, DollarSign, Settings, Percent, Tent, ExternalLink, Trash2, Plus, X, Save } from "lucide-react";

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
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Camp Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-camp-name" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full h-24 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" data-testid="input-camp-description" />
        </div>
        <div className="col-span-2 space-y-1.5">
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
        <div className="rounded-xl border border-blue-500/[0.08] overflow-hidden">
          <table className="w-full">
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">From Email</label>
          <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-from-email" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Reply-To</label>
          <Input value={replyTo} onChange={e => setReplyTo(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-reply-to" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Subject</label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-email-subject" />
        </div>
        <div className="col-span-2 space-y-1.5">
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

export default function AdminCampDetail() {
  const [, params] = useRoute("/admin/camps/:id");
  const campId = parseInt(params?.id || "0");
  const [tab, setTab] = useState("overview");
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
    { key: "overview", label: "Overview", icon: Tent },
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
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <Link href="/admin/camps">
          <button className="w-8 h-8 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 text-white/40" />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-white tracking-tight" data-testid="text-camp-name">{camp.name}</h1>
          <p className="text-[12px] text-blue-400/35">/{camp.slug}</p>
        </div>
        {camp.slug && (
          <Button variant="outline" asChild className="rounded-xl h-8 text-[12px] border-blue-500/20 text-blue-400/60 hover:bg-blue-500/5">
            <a href={`/${camp.slug}`} target="_blank" rel="noopener noreferrer" data-testid="link-public-page">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Public Page
            </a>
          </Button>
        )}
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.04] animate-fade-in-up" style={{ animationDelay: '50ms', opacity: 0 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all cursor-pointer ${
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

      <div className="rounded-2xl glass-card p-5 animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        {tab === "overview" && <OverviewTab camp={camp} onUpdate={(data) => updateMutation.mutate(data)} />}
        {tab === "dates" && <DatesTab campId={campId} />}
        {tab === "pricing" && <PricingTab campId={campId} />}
        {tab === "discounts" && <DiscountsTab campId={campId} />}
        {tab === "email" && <EmailTab campId={campId} />}
      </div>
    </div>
  );
}
