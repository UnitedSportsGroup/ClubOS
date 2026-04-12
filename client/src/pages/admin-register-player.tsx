import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  X, ChevronRight, ChevronLeft, User, Baby, Calendar, CheckCircle,
  Plus, Trash2, Loader2, Building2, CreditCard,
} from "lucide-react";

interface ChildData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  allergies: string;
  epiPen: boolean;
  medicalNotes: string;
}

interface BookingItem {
  childIndex: number;
  campDateId: number;
  productType: string;
}

const STEPS = ["Camp", "Parent", "Children", "Sessions", "Confirm"];

function formatDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
}

function formatProductType(pt: string) {
  if (pt === "FULL_DAY") return "Full Day";
  if (pt === "MORNING") return "Morning";
  if (pt === "AFTERNOON") return "Afternoon";
  return pt;
}

export function RegisterPlayerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);

  const [selectedCampId, setSelectedCampId] = useState<number | null>(null);
  const [parentFirst, setParentFirst] = useState("");
  const [parentLast, setParentLast] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  const [children, setChildren] = useState<ChildData[]>([
    { firstName: "", lastName: "", dateOfBirth: "", allergies: "", epiPen: false, medicalNotes: "" },
  ]);

  const [items, setItems] = useState<BookingItem[]>([]);
  const [isPaid, setIsPaid] = useState(false);

  const { data: camps } = useQuery<any[]>({ queryKey: ["/api/admin/camps"] });

  const { data: campData } = useQuery<{ camp: any; pricing: any[]; dates: any[]; discounts: any[] }>({
    queryKey: ["/api/public/camps", selectedCampId],
    queryFn: async () => {
      const camp = camps?.find((c: any) => c.id === selectedCampId);
      if (!camp?.slug) return null;
      const res = await fetch(`/api/public/camps/${camp.slug}`);
      if (!res.ok) throw new Error("Camp not found");
      return res.json();
    },
    enabled: !!selectedCampId && !!camps,
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const validChildren = children.filter(c => c.firstName.trim());
      const expandedItems: BookingItem[] = [];
      for (let ci = 0; ci < validChildren.length; ci++) {
        for (const item of items) {
          expandedItems.push({ childIndex: ci, campDateId: item.campDateId, productType: item.productType });
        }
      }

      const res = await apiRequest("POST", "/api/admin/registrations/manual", {
        campId: selectedCampId,
        parent: {
          firstName: parentFirst,
          lastName: parentLast,
          email: parentEmail,
          phone: parentPhone,
          emergencyContact,
          emergencyPhone,
        },
        children: validChildren,
        items: expandedItems,
        isPaid,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps/registration-counts"] });
      toast({
        title: "Registration created",
        description: `Registration #${data.registrationId} — ${formatCurrency(data.totalCents, { fromCents: true })} — ${data.status}`,
      });
      resetForm();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setStep(0);
    setSelectedCampId(null);
    setParentFirst("");
    setParentLast("");
    setParentEmail("");
    setParentPhone("");
    setEmergencyContact("");
    setEmergencyPhone("");
    setChildren([{ firstName: "", lastName: "", dateOfBirth: "", allergies: "", epiPen: false, medicalNotes: "" }]);
    setItems([]);
    setIsPaid(false);
  };

  const addChild = () => {
    setChildren([...children, { firstName: "", lastName: "", dateOfBirth: "", allergies: "", epiPen: false, medicalNotes: "" }]);
  };

  const removeChild = (idx: number) => {
    if (children.length <= 1) return;
    setChildren(children.filter((_, i) => i !== idx));
  };

  const updateChild = (idx: number, field: keyof ChildData, value: string | boolean) => {
    setChildren(children.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const toggleItem = (campDateId: number, productType: string) => {
    const exists = items.find(i => i.campDateId === campDateId && i.productType === productType);
    if (exists) {
      setItems(items.filter(i => !(i.campDateId === campDateId && i.productType === productType)));
    } else {
      const filtered = items.filter(i => i.campDateId !== campDateId);
      filtered.push({ childIndex: 0, campDateId, productType });
      setItems(filtered);
    }
  };

  const pricing = campData?.pricing || [];
  const dates = campData?.dates || [];
  const validChildren = children.filter(c => c.firstName.trim());

  const totalItems = validChildren.length * items.length;
  const subtotalCents = useMemo(() => {
    let total = 0;
    for (const item of items) {
      const price = pricing.find((p: any) => p.productType === item.productType);
      if (price) total += price.priceCents * validChildren.length;
    }
    return total;
  }, [items, pricing, validChildren.length]);

  const discounts = campData?.discounts || [];
  const applicableDiscount = discounts
    .filter((d: any) => totalItems >= d.minBookings)
    .sort((a: any, b: any) => Number(b.discountPercent) - Number(a.discountPercent))[0];
  const discountCents = applicableDiscount ? Math.round(subtotalCents * Number(applicableDiscount.discountPercent) / 100) : 0;
  const totalCents = subtotalCents - discountCents;

  const canNextStep = () => {
    if (step === 0) return !!selectedCampId;
    if (step === 1) return parentFirst.trim() && parentLast.trim();
    if (step === 2) return validChildren.length > 0;
    if (step === 3) return items.length > 0;
    return true;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { resetForm(); onClose(); }} />
      <div className="relative w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col rounded-2xl border border-blue-500/[0.15] overflow-hidden animate-fade-in-up" style={{ background: "linear-gradient(135deg, rgba(3,86,197,0.06) 0%, #02060E 100%)", animationDelay: "0ms", opacity: 0 }} data-testid="modal-register-player">
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08] flex-shrink-0">
          <h3 className="text-[14px] font-semibold text-white/80">Register Player</h3>
          <button onClick={() => { resetForm(); onClose(); }} className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors cursor-pointer" data-testid="button-close-register">
            <X className="w-3.5 h-3.5 text-white/40" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 py-3 border-b border-blue-500/[0.06] flex-shrink-0 overflow-x-auto">
          {STEPS.map((label, i) => (
            <Fragment key={label}>
              {i > 0 && <ChevronRight className="w-3 h-3 text-white/15 flex-shrink-0" />}
              <button
                onClick={() => i <= step ? setStep(i) : undefined}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex-shrink-0 ${
                  i === step
                    ? "bg-blue-500/15 text-blue-400 border border-blue-500/25"
                    : i < step
                    ? "text-white/50 cursor-pointer hover:text-white/70"
                    : "text-white/20 cursor-default"
                }`}
                data-testid={`button-step-${label.toLowerCase()}`}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                  i < step ? "bg-green-500/20 text-green-400" : i === step ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-white/20"
                }`}>
                  {i < step ? "✓" : i + 1}
                </span>
                {label}
              </button>
            </Fragment>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Select Camp</p>
              <div className="grid grid-cols-1 gap-2">
                {camps?.filter((c: any) => c.isActive).map((camp: any) => (
                  <button
                    key={camp.id}
                    onClick={() => { setSelectedCampId(camp.id); setItems([]); }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedCampId === camp.id
                        ? "bg-blue-500/10 border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.1)]"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    }`}
                    data-testid={`button-select-camp-${camp.id}`}
                  >
                    <div className={`text-[13px] font-medium ${selectedCampId === camp.id ? "text-blue-400" : "text-white/70"}`}>{camp.name}</div>
                    <div className="text-[11px] text-white/25 mt-0.5">{camp.location || "No location"}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <User className="w-3 h-3" /> Parent / Guardian Details
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/30">First Name *</label>
                  <Input value={parentFirst} onChange={e => setParentFirst(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-first" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/30">Last Name *</label>
                  <Input value={parentLast} onChange={e => setParentLast(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-last" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/30">Email</label>
                  <Input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-email" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/30">Phone</label>
                  <Input value={parentPhone} onChange={e => setParentPhone(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-phone" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/30">Emergency Contact</label>
                  <Input value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-emergency-contact" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/30">Emergency Phone</label>
                  <Input value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-emergency-phone" />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <Baby className="w-3 h-3" /> Children
                </p>
                <Button onClick={addChild} variant="outline" size="sm" className="border-blue-500/20 text-blue-400 hover:bg-blue-500/10 text-[11px] h-7 px-2" data-testid="button-add-child">
                  <Plus className="w-3 h-3 mr-1" /> Add Child
                </Button>
              </div>
              {children.map((child, ci) => (
                <div key={ci} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-white/50 font-medium">Child {ci + 1}</span>
                    {children.length > 1 && (
                      <button onClick={() => removeChild(ci)} className="text-red-400/50 hover:text-red-400 transition-colors" data-testid={`button-remove-child-${ci}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-white/25">First Name *</label>
                      <Input value={child.firstName} onChange={e => updateChild(ci, "firstName", e.target.value)} className="premium-input text-white/80 rounded-xl h-9 text-[13px]" data-testid={`input-child-first-${ci}`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-white/25">Last Name *</label>
                      <Input value={child.lastName} onChange={e => updateChild(ci, "lastName", e.target.value)} className="premium-input text-white/80 rounded-xl h-9 text-[13px]" data-testid={`input-child-last-${ci}`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-white/25">Date of Birth</label>
                      <Input type="date" value={child.dateOfBirth} onChange={e => updateChild(ci, "dateOfBirth", e.target.value)} className="premium-input text-white/80 rounded-xl h-9 text-[13px]" data-testid={`input-child-dob-${ci}`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-white/25">Allergies</label>
                      <Input value={child.allergies} onChange={e => updateChild(ci, "allergies", e.target.value)} placeholder="None" className="premium-input text-white/80 rounded-xl h-9 text-[13px]" data-testid={`input-child-allergies-${ci}`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={child.epiPen} onChange={e => updateChild(ci, "epiPen", e.target.checked)} className="accent-blue-500" data-testid={`checkbox-epipen-${ci}`} />
                      <span className="text-[11px] text-white/40">Carries EpiPen</span>
                    </label>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/25">Medical Notes</label>
                    <textarea value={child.medicalNotes} onChange={e => updateChild(ci, "medicalNotes", e.target.value)} placeholder="Any medical conditions or notes..." className="w-full h-16 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[12px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/30 resize-none" data-testid={`input-child-medical-${ci}`} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Calendar className="w-3 h-3" /> Select Sessions
              </p>
              <p className="text-[11px] text-white/30">Choose which days and sessions to book for each date. Sessions apply to all children.</p>
              {dates.length === 0 ? (
                <div className="text-center py-8 text-white/30 text-[13px]">No camp dates configured yet</div>
              ) : (
                <div className="space-y-2">
                  {dates.map((d: any) => {
                    const selectedForDate = items.find(i => i.campDateId === d.id);
                    return (
                      <div key={d.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
                        <div className="text-[12px] text-white/50 font-medium mb-2">{formatDate(d.date)}</div>
                        <div className="flex gap-2 flex-wrap">
                          {pricing.map((p: any) => {
                            const isSelected = selectedForDate?.productType === p.productType;
                            return (
                              <button
                                key={p.productType}
                                onClick={() => toggleItem(d.id, p.productType)}
                                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                                  isSelected
                                    ? "bg-blue-500/15 border-blue-500/30 text-blue-400"
                                    : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
                                }`}
                                data-testid={`button-session-${d.id}-${p.productType}`}
                              >
                                {formatProductType(p.productType)} — ${(p.priceCents / 100).toFixed(0)}
                              </button>
                            );
                          })}
                          {selectedForDate && (
                            <button
                              onClick={() => setItems(items.filter(i => i.campDateId !== d.id))}
                              className="px-2 py-1 text-[10px] text-red-400/50 hover:text-red-400"
                              data-testid={`button-clear-date-${d.id}`}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <CheckCircle className="w-3 h-3" /> Review & Confirm
              </p>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Camp</p>
                <p className="text-[13px] text-white/70" data-testid="text-confirm-camp">{camps?.find((c: any) => c.id === selectedCampId)?.name}</p>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Parent / Guardian</p>
                <p className="text-[13px] text-white/70" data-testid="text-confirm-parent">{parentFirst} {parentLast}</p>
                {parentEmail && <p className="text-[12px] text-white/40">{parentEmail}</p>}
                {parentPhone && <p className="text-[12px] text-white/40">{parentPhone}</p>}
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Children ({validChildren.length})</p>
                {validChildren.map((c, i) => (
                  <p key={i} className="text-[13px] text-white/70" data-testid={`text-confirm-child-${i}`}>
                    {c.firstName} {c.lastName}
                    {c.dateOfBirth && <span className="text-white/30 ml-1">(DOB: {c.dateOfBirth})</span>}
                  </p>
                ))}
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Sessions ({totalItems} total)</p>
                {items.map((item, i) => {
                  const date = dates.find((d: any) => d.id === item.campDateId);
                  return (
                    <div key={i} className="flex items-center gap-2 text-[12px]">
                      <Calendar className="w-3 h-3 text-white/15" />
                      <span className="text-white/45">{date ? formatDate(date.date) : "?"}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${
                        item.productType === "FULL_DAY"
                          ? "border-blue-500/20 text-blue-400/70 bg-blue-500/5"
                          : item.productType === "MORNING"
                          ? "border-amber-500/20 text-amber-400/70 bg-amber-500/5"
                          : "border-purple-500/20 text-purple-400/70 bg-purple-500/5"
                      }`}>
                        {formatProductType(item.productType)}
                      </Badge>
                      <span className="text-white/25">× {validChildren.length} child{validChildren.length !== 1 ? "ren" : ""}</span>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <CreditCard className="w-3 h-3" /> Pricing
                </p>
                <p className="text-[12px] text-white/40">Subtotal: {formatCurrency(subtotalCents, { fromCents: true })}</p>
                {discountCents > 0 && <p className="text-[12px] text-emerald-400/60">Discount: -{formatCurrency(discountCents, { fromCents: true })}</p>}
                <p className="text-[14px] text-white/80 font-semibold">Total: {formatCurrency(totalCents, { fromCents: true })} NZD</p>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
                <p className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  <Building2 className="w-3 h-3" /> Payment
                </p>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPaid}
                    onChange={e => setIsPaid(e.target.checked)}
                    className="w-4 h-4 accent-green-500 cursor-pointer"
                    data-testid="checkbox-is-paid"
                  />
                  <span className="text-[13px] text-white/60">Payment received (EFTPOS / Cash at CUFC Office)</span>
                </label>
                <p className="text-[10px] text-white/25">
                  {isPaid
                    ? "Registration will be marked as CONFIRMED"
                    : "Registration will be marked as PENDING until payment is received"}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-blue-500/[0.08] flex-shrink-0">
          {step > 0 ? (
            <Button onClick={() => setStep(step - 1)} variant="outline" className="border-white/10 text-white/60 hover:bg-white/5 h-9 text-[12px]" data-testid="button-back-step">
              <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Back
            </Button>
          ) : (
            <div />
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNextStep()} className="bg-blue-600 hover:bg-blue-700 text-white h-9 text-[12px]" data-testid="button-next-step">
              Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={() => registerMutation.mutate()}
              disabled={registerMutation.isPending}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white h-9 text-[12px] px-5"
              data-testid="button-confirm-register"
            >
              {registerMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Registering...</>
              ) : (
                <><CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Register Player</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
