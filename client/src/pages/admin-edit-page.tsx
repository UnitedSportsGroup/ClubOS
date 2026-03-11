import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Save, Loader2, Star, ChevronDown, ChevronUp, ArrowRight,
  MapPin, Calendar, Users, DollarSign, Clock, Shield, Sparkles, Heart,
  Zap, Gamepad2, UserPlus, ChevronRight, ChevronLeft, Pencil, Check, X,
} from "lucide-react";
import cuFcLogoPath from "@assets/CUFC_LOGO_1772823768518.png";

const BRAND = {
  blue: "#22399B",
  white: "#FBFBFC",
  gold: "#D9B10F",
  darkBlue: "#221F7A",
};

interface EditableFieldProps {
  value: string;
  onChange: (val: string) => void;
  tag?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  style?: Record<string, any>;
  multiline?: boolean;
  "data-testid"?: string;
}

function EditableField({ value, onChange, tag = "p", className = "", style = {}, multiline = false, ...props }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const commit = () => {
    onChange(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="relative inline-flex items-center gap-1 w-full">
        {multiline ? (
          <textarea
            ref={inputRef as any}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") cancel(); }}
            className="w-full bg-white/10 border-2 border-blue-400 rounded-lg px-3 py-2 text-inherit resize-none focus:outline-none"
            style={{ ...style, minHeight: 80 }}
            rows={3}
            data-testid={props["data-testid"] ? `${props["data-testid"]}-input` : undefined}
          />
        ) : (
          <input
            ref={inputRef as any}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className="w-full bg-white/10 border-2 border-blue-400 rounded-lg px-3 py-1.5 text-inherit focus:outline-none"
            style={style}
            data-testid={props["data-testid"] ? `${props["data-testid"]}-input` : undefined}
          />
        )}
        <button onClick={commit} className="flex-shrink-0 w-7 h-7 rounded-full bg-green-500 flex items-center justify-center cursor-pointer hover:bg-green-400 transition-colors" data-testid="button-confirm-edit">
          <Check className="w-3.5 h-3.5 text-white" />
        </button>
        <button onClick={cancel} className="flex-shrink-0 w-7 h-7 rounded-full bg-red-500/80 flex items-center justify-center cursor-pointer hover:bg-red-500 transition-colors" data-testid="button-cancel-edit">
          <X className="w-3.5 h-3.5 text-white" />
        </button>
      </div>
    );
  }

  const Tag = tag;
  return (
    <Tag
      className={`${className} group cursor-pointer relative`}
      style={style}
      onClick={() => setEditing(true)}
      data-testid={props["data-testid"]}
    >
      {value || "(click to edit)"}
      <span className="absolute -right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Pencil className="w-3.5 h-3.5 text-blue-400" />
      </span>
    </Tag>
  );
}

export default function AdminEditPage() {
  const [, params] = useRoute("/admin/camps/:id/edit-page");
  const campId = params?.id ? parseInt(params.id) : 0;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: camp, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/camps", campId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/camps/${campId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Camp not found");
      return res.json();
    },
    enabled: campId > 0,
  });

  const [fields, setFields] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (camp) {
      setFields({
        heroHeadline: camp.heroHeadline || camp.name || "",
        heroSubheadline: camp.heroSubheadline || camp.descriptionShort || "",
        primaryCta: camp.primaryCta || "Book Now",
        descriptionShort: camp.descriptionShort || "",
        descriptionLong: camp.descriptionLong || "",
        whatToBring: camp.whatToBring || "",
        inclusions: camp.inclusions || "",
        refundPolicy: camp.refundPolicy || "",
        contactEmail: camp.contactEmail || "info@cufc.co.nz",
        faqJson: camp.faqJson || "",
      });
      setHasChanges(false);
    }
  }, [camp]);

  const updateField = useCallback((key: string, val: string) => {
    setFields(prev => ({ ...prev, [key]: val }));
    setHasChanges(true);
  }, []);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/admin/camps/${campId}`, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps", campId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps"] });
      setHasChanges(false);
      toast({ title: "Page updated", description: "Your changes have been saved." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  let faqItems: { q: string; a: string }[] = [];
  try { faqItems = fields.faqJson ? JSON.parse(fields.faqJson) : []; } catch { faqItems = []; }
  if (faqItems.length === 0) {
    faqItems = [
      { q: "Does my child need football experience?", a: "Not at all! Our camps are designed for all skill levels." },
      { q: "What should they bring?", a: "Comfortable sports clothing, shin pads, boots or trainers, a water bottle, and sunscreen." },
      { q: "What happens if it rains?", a: "Our camps run rain or shine! We have access to covered and indoor facilities." },
      { q: "Can I book multiple days?", a: "Absolutely! You can pick and choose individual days or book the full week." },
      { q: "Does my child need to be a CUFC player?", a: "No — our holiday camps are open to all children in the community." },
    ];
  }

  const updateFaq = (index: number, field: "q" | "a", val: string) => {
    const updated = [...faqItems];
    updated[index] = { ...updated[index], [field]: val };
    updateField("faqJson", JSON.stringify(updated));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BRAND.white }}>
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!camp) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BRAND.white }}>
        <p className="text-slate-500">Camp not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
      <div className="fixed top-0 left-0 right-0 z-[60] bg-slate-900/95 backdrop-blur-lg border-b border-white/10 shadow-lg">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => navigate(`/admin/camps/${campId}`)}
            className="flex items-center gap-2 text-white/70 hover:text-white text-[13px] font-medium transition-colors cursor-pointer"
            data-testid="button-back-admin"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Camp
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-white/30">
              {hasChanges ? "Unsaved changes" : "All changes saved"}
            </span>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!hasChanges || saveMutation.isPending}
              className={`h-8 px-4 rounded-lg text-[12px] font-semibold transition-all ${
                hasChanges
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-white/5 text-white/30 cursor-default"
              }`}
              data-testid="button-save-page"
            >
              {saveMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Saving</>
              ) : (
                <><Save className="w-3.5 h-3.5 mr-1.5" /> Save Changes</>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="pt-14">
        <section className="relative overflow-hidden" style={{ background: `linear-gradient(180deg, ${BRAND.darkBlue} 0%, ${BRAND.blue} 100%)` }}>
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-[0.07] rounded-full" style={{ background: `radial-gradient(ellipse, ${BRAND.gold} 0%, transparent 70%)` }} />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 pt-8 pb-10 md:pt-10 md:pb-12">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4">
                <img src={cuFcLogoPath} alt="Christchurch United FC" className="w-14 h-14 md:w-18 md:h-18 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]" />
              </div>
              <div className="w-full max-w-2xl mb-3">
                <EditableField
                  value={fields.heroHeadline || ""}
                  onChange={v => updateField("heroHeadline", v)}
                  tag="h1"
                  className="text-[28px] sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.08]"
                  style={{ color: BRAND.white }}
                  data-testid="edit-hero-headline"
                />
              </div>
              <div className="w-full max-w-xl mb-6">
                <EditableField
                  value={fields.heroSubheadline || ""}
                  onChange={v => updateField("heroSubheadline", v)}
                  tag="p"
                  className="text-[14px] sm:text-[16px] md:text-[18px] leading-relaxed"
                  style={{ color: "rgba(251,251,252,0.55)" }}
                  multiline
                  data-testid="edit-hero-sub"
                />
              </div>
              <div className="mb-6">
                <EditableField
                  value={fields.primaryCta || "Book Now"}
                  onChange={v => updateField("primaryCta", v)}
                  tag="span"
                  className="inline-flex items-center gap-2 px-10 py-3.5 text-[15px] font-bold rounded-full"
                  style={{ background: BRAND.white, color: BRAND.blue, boxShadow: "0 4px 24px rgba(34,57,155,0.3)" }}
                  data-testid="edit-primary-cta"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 md:py-16 overflow-hidden" style={{ background: BRAND.darkBlue }}>
          <div className="max-w-6xl mx-auto px-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white mb-2">What Parents Are Saying</h2>
            <p className="text-[13px] mb-6" style={{ color: "rgba(251,251,252,0.45)" }}>Real reviews from real families</p>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-6 px-6">
              {[
                { highlight: "Best Holiday Camp in Canterbury", name: "Sarah Mitchell", role: "Parent of 2" },
                { highlight: "My Son's Confidence Has Skyrocketed", name: "James Crawford", role: "Parent" },
                { highlight: "Worth Every Single Dollar", name: "Michelle Thompson", role: "Parent of 3" },
              ].map((r, i) => (
                <div key={i} className="min-w-[300px] bg-white rounded-2xl border border-slate-100 p-6 flex flex-col gap-3 shadow-sm opacity-60">
                  <div className="flex gap-0.5">{Array.from({ length: 5 }).map((_, j) => <Star key={j} className="w-3.5 h-3.5 fill-[#D9B10F] text-[#D9B10F]" />)}</div>
                  <h4 className="text-[16px] font-bold text-slate-900">{r.highlight}</h4>
                  <p className="text-[12px] text-slate-400">(Reviews are managed separately)</p>
                  <div className="flex items-center gap-3 pt-3 border-t border-slate-50">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold" style={{ background: BRAND.blue }}>{r.name.split(" ").map(n => n[0]).join("")}</div>
                    <div>
                      <p className="text-[13px] font-semibold text-slate-800">{r.name}</p>
                      <p className="text-[11px] text-slate-400">{r.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative py-14 md:py-20" style={{ background: BRAND.white }}>
          <div className="relative max-w-5xl mx-auto px-6">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-center mb-12" style={{ color: BRAND.darkBlue }}>Key Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {[
                { icon: Users, label: "Age", text: `${camp.ageMin || 3}–${camp.ageMax || 8} Years` },
                { icon: Calendar, label: "Dates", text: camp.startDate && camp.endDate ? `${new Date(camp.startDate + "T12:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" })} – ${new Date(camp.endDate + "T12:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}` : "TBD" },
                { icon: MapPin, label: "Location", text: camp.location || "TBD" },
                { icon: Clock, label: "Sessions", text: "Morning · Afternoon · Full Day" },
                { icon: DollarSign, label: "Price", text: "From $30/session" },
              ].map((card, i) => (
                <div key={i} className="group relative rounded-2xl p-[1px]" style={{ background: `linear-gradient(135deg, rgba(34,57,155,0.4) 0%, rgba(34,31,122,0.6) 50%, rgba(34,57,155,0.4) 100%)` }}>
                  <div className="rounded-2xl p-5 text-center h-full" style={{ background: BRAND.darkBlue }}>
                    <card.icon className="w-5 h-5 mx-auto mb-2.5" style={{ color: BRAND.white }} />
                    <p className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-1.5" style={{ color: "rgba(251,251,252,0.5)" }}>{card.label}</p>
                    <p className="text-[13px] font-bold" style={{ color: BRAND.white }}>{card.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-slate-400 mt-4">(Key info cards are populated from camp settings — edit via the camp detail page)</p>
          </div>
        </section>

        <section className="py-12 md:py-16" style={{ background: BRAND.blue }}>
          <div className="max-w-2xl mx-auto px-6">
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight mb-2 text-center" style={{ color: BRAND.gold }}>What a Day Looks Like</h2>
            <p className="text-[14px] mb-10 text-center" style={{ color: BRAND.white }}>Morning, afternoon, and full-day options available</p>
            <p className="text-center text-[11px] text-white/40">(Schedule timeline is a fixed template)</p>
          </div>
        </section>

        <section className="py-12 md:py-16" style={{ background: BRAND.darkBlue }}>
          <div className="max-w-4xl mx-auto px-6 text-center">
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight mb-2" style={{ color: BRAND.white }}>What Your Child Will Experience</h2>
            <p className="text-[14px] mb-10 max-w-lg mx-auto" style={{ color: "rgba(251,251,252,0.55)" }}>A safe, fun environment where every child builds confidence and falls in love with football</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: Gamepad2, title: "Fun Skill Games", desc: "Age-appropriate drills that feel like play" },
                { icon: UserPlus, title: "Make New Friends", desc: "Social environment for connection" },
                { icon: Sparkles, title: "Build Confidence", desc: "Every child is celebrated" },
                { icon: Zap, title: "Learn Through Play", desc: "Real skills through engagement" },
              ].map((item, i) => (
                <div key={i} className="rounded-xl p-5 text-center" style={{ background: BRAND.blue, border: "1px solid rgba(217,177,15,0.2)" }}>
                  <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(217,177,15,0.1)" }}>
                    <item.icon className="w-5 h-5" style={{ color: BRAND.gold }} />
                  </div>
                  <h3 className="text-[14px] font-bold mb-1" style={{ color: BRAND.white }}>{item.title}</h3>
                  <p className="text-[12px] leading-relaxed" style={{ color: "rgba(251,251,252,0.5)" }}>{item.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-white/30 mt-4">(Experience cards are a fixed template)</p>
          </div>
        </section>

        <section className="py-12 md:py-16" style={{ background: "#f8f9fb" }}>
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mb-2 text-center">Why Families Choose Christchurch United</h2>
            <p className="text-[14px] text-slate-400 mb-10 text-center">A club and community you can trust</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { icon: Shield, title: "Trusted Since 2014", desc: "Canterbury families have relied on CUFC for over a decade" },
                { icon: Heart, title: "Safe & Supervised", desc: "Proper check-in procedures with qualified, vetted coaches" },
                { icon: Zap, title: "Professional Facilities", desc: "Christchurch Football Centre — purpose-built for football" },
                { icon: Sparkles, title: "Fun First, Skills Second", desc: "Every child leaves smiling, confident, and wanting to come back" },
              ].map((item, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-100 p-5 flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: `${BRAND.blue}0A` }}>
                    <item.icon className="w-5 h-5" style={{ color: BRAND.blue }} />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-slate-800 mb-0.5">{item.title}</h3>
                    <p className="text-[12px] text-slate-400 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-slate-400 mt-4">(Trust section is a fixed template)</p>
          </div>
        </section>

        <section className="py-12 md:py-16" style={{ background: BRAND.darkBlue }}>
          <div className="max-w-2xl mx-auto px-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-6 text-center" style={{ color: BRAND.gold }}>Frequently Asked Questions</h2>
            <div className="rounded-2xl px-5 sm:px-6 space-y-0" style={{ background: BRAND.blue, border: "1px solid rgba(34,57,155,0.5)" }}>
              {faqItems.map((item, i) => (
                <div key={i} className="py-4 last:border-0" style={{ borderBottom: "1px solid rgba(34,57,155,0.3)" }}>
                  <div className="mb-2">
                    <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "rgba(251,251,252,0.25)" }}>Question {i + 1}</label>
                    <EditableField
                      value={item.q}
                      onChange={v => updateFaq(i, "q", v)}
                      tag="p"
                      className="text-[14px] sm:text-[15px] font-semibold"
                      style={{ color: BRAND.white }}
                      data-testid={`edit-faq-q-${i}`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "rgba(251,251,252,0.15)" }}>Answer</label>
                    <EditableField
                      value={item.a}
                      onChange={v => updateFaq(i, "a", v)}
                      tag="p"
                      className="text-[13px] leading-relaxed"
                      style={{ color: "rgba(251,251,252,0.6)" }}
                      multiline
                      data-testid={`edit-faq-a-${i}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-16 md:py-20" style={{ background: `linear-gradient(135deg, ${BRAND.darkBlue} 0%, ${BRAND.blue} 100%)` }}>
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] opacity-[0.06] rounded-full" style={{ background: `radial-gradient(circle, ${BRAND.gold} 0%, transparent 70%)` }} />
          </div>
          <div className="relative max-w-2xl mx-auto px-6 text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3" style={{ color: BRAND.white }}>
              Give Your Child a Holiday They'll Love
            </h2>
            <p className="text-[14px] sm:text-[16px] mb-8" style={{ color: "rgba(251,251,252,0.55)" }}>
              Limited places available. Fun, safe environment. Easy online booking.
            </p>
            <span className="inline-flex items-center gap-2 px-10 py-3.5 text-[15px] font-bold rounded-full" style={{ background: BRAND.white, color: BRAND.blue, boxShadow: "0 4px 24px rgba(0,0,0,0.2)" }}>
              {fields.primaryCta || "Book Now"}
              <ArrowRight className="w-4 h-4" />
            </span>
          </div>
        </section>

        <footer style={{ background: BRAND.darkBlue }}>
          <div className="max-w-4xl mx-auto px-6 py-8">
            <div className="flex flex-col items-center text-center">
              <img src={cuFcLogoPath} alt="Christchurch United FC" className="w-10 h-10 object-contain opacity-50 mb-3" />
              <p className="text-[12px] font-semibold mb-4" style={{ color: "rgba(251,251,252,0.35)" }}>Christchurch United Football Club</p>
              <p className="text-[11px]" style={{ color: "rgba(251,251,252,0.2)" }}>
                &copy; {new Date().getFullYear()} Christchurch United FC. All Rights Reserved.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
