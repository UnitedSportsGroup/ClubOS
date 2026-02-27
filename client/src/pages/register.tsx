import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  MapPin,
  Calendar,
  Users,
  DollarSign,
  ChevronRight,
  CheckCircle2,
  Shield,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { Program } from "@shared/schema";

interface ProgramData {
  program: Program;
  club: {
    name: string;
    shortName: string;
    email: string;
    phone: string;
    website: string;
    fbPixelId?: string;
    gadsConversionId?: string;
  };
}

function useTrackingPixels(club: ProgramData["club"] | undefined) {
  useEffect(() => {
    if (!club?.fbPixelId) return;
    if ((window as any).fbq) return;
    const script = document.createElement("script");
    script.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${club.fbPixelId}');fbq('track','PageView');`;
    document.head.appendChild(script);
    const noscript = document.createElement("noscript");
    noscript.innerHTML = `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${club.fbPixelId}&ev=PageView&noscript=1"/>`;
    document.head.appendChild(noscript);
    return () => {
      document.head.removeChild(script);
      document.head.removeChild(noscript);
    };
  }, [club?.fbPixelId]);
}

function useUtmParams() {
  const [params, setParams] = useState<Record<string, string>>({});
  useEffect(() => {
    const url = new URL(window.location.href);
    const utm: Record<string, string> = {};
    for (const [key, val] of url.searchParams.entries()) {
      if (["utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid", "gclid"].includes(key)) {
        utm[key] = val;
      }
    }
    setParams(utm);
  }, []);
  return params;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
}

function formatFee(fee: string | null) {
  if (!fee || fee === "0") return "Free";
  return `$${parseFloat(fee).toFixed(2)}`;
}

function tierColor(program: Program) {
  const min = program.ageMin || 0;
  if (min <= 8) return { bg: "from-emerald-500/20 to-emerald-600/5", border: "border-emerald-500/20", text: "text-emerald-400", glow: "shadow-emerald-500/10" };
  if (min <= 12) return { bg: "from-amber-500/20 to-amber-600/5", border: "border-amber-500/20", text: "text-amber-400", glow: "shadow-amber-500/10" };
  return { bg: "from-blue-500/20 to-blue-600/5", border: "border-blue-500/20", text: "text-blue-400", glow: "shadow-blue-500/10" };
}

function ProgramNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#02060E" }}>
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2" data-testid="text-not-found">Programme Not Found</h1>
        <p className="text-white/40 text-sm mb-6">This registration link may have expired or the programme is no longer available.</p>
        <a href="https://cufc.co.nz" className="text-blue-400 hover:text-blue-300 text-sm transition-colors" data-testid="link-back-website">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          Back to CUFC website
        </a>
      </div>
    </div>
  );
}

function SuccessScreen({ program, club }: { program: Program; club: ProgramData["club"] }) {
  const colors = tierColor(program);
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#02060E" }}>
      <div className="w-full max-w-lg text-center animate-fade-in-up" style={{ animationDelay: "0ms", opacity: 0 }}>
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/10">
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold text-white mb-2" data-testid="text-success-title">Registration Submitted!</h1>
        <p className="text-white/50 text-sm mb-8 max-w-sm mx-auto" data-testid="text-success-message">
          Thank you for registering for <span className="text-white/80 font-medium">{program.name}</span>.
          We'll be in touch shortly to confirm your spot.
        </p>

        <div className={`rounded-2xl bg-gradient-to-br ${colors.bg} border ${colors.border} p-5 mb-6 text-left`}>
          <h3 className="text-sm font-medium text-white/80 mb-3">What happens next?</h3>
          <div className="space-y-3">
            {[
              "You'll receive a confirmation email shortly",
              "Our team will review your registration",
              "Payment details will be sent once confirmed",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full ${colors.bg} border ${colors.border} flex items-center justify-center shrink-0 mt-0.5`}>
                  <span className={`text-[10px] font-bold ${colors.text}`}>{i + 1}</span>
                </div>
                <p className="text-[13px] text-white/50">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-white/25">
          Questions? Contact us at{" "}
          <a href={`mailto:${club.email}`} className="text-blue-400/60 hover:text-blue-400 transition-colors">
            {club.email}
          </a>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const [, params] = useRoute("/register/:slug");
  const slug = params?.slug;
  const utmParams = useUtmParams();
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    playerFirstName: "",
    playerLastName: "",
    playerDateOfBirth: "",
    playerGender: "male" as "male" | "female" | "other",
    guardianFirstName: "",
    guardianLastName: "",
    guardianEmail: "",
    guardianPhone: "",
    address: "",
    school: "",
    medicalNotes: "",
    allergies: "",
    emergencyContact: "",
    emergencyPhone: "",
    photoConsent: false,
    medicalConsent: false,
    newsletterConsent: true,
    notes: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);

  const { data, isLoading, error } = useQuery<ProgramData>({
    queryKey: ["/api/public/programs", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/programs/${slug}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    enabled: !!slug,
  });

  useTrackingPixels(data?.club);

  const submitMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/public/register", payload);
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      if (typeof window !== "undefined" && (window as any).fbq) {
        (window as any).fbq("track", "CompleteRegistration", {
          content_name: data?.program.name,
          value: data?.program.fee ? parseFloat(data.program.fee) : 0,
          currency: "NZD",
        });
      }
      if (typeof window !== "undefined" && (window as any).gtag && data?.club) {
        const club = data.club as any;
        if (club.gadsConversionId) {
          (window as any).gtag("event", "conversion", {
            send_to: club.gadsConversionId,
            value: data?.program.fee ? parseFloat(data.program.fee) : 0,
            currency: "NZD",
          });
        }
      }
    },
  });

  const updateField = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const validateStep = (step: number): boolean => {
    const errs: Record<string, string> = {};

    if (step === 0) {
      if (!form.playerFirstName.trim()) errs.playerFirstName = "Required";
      if (!form.playerLastName.trim()) errs.playerLastName = "Required";
      if (!form.playerDateOfBirth) errs.playerDateOfBirth = "Required";
    }
    if (step === 1) {
      if (!form.guardianFirstName.trim()) errs.guardianFirstName = "Required";
      if (!form.guardianLastName.trim()) errs.guardianLastName = "Required";
      if (!form.guardianEmail.trim()) errs.guardianEmail = "Required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.guardianEmail)) errs.guardianEmail = "Invalid email";
      if (!form.guardianPhone.trim()) errs.guardianPhone = "Required";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleSubmit = () => {
    if (!validateStep(currentStep)) return;
    if (!data) return;

    submitMutation.mutate({
      programId: data.program.id,
      ...form,
      source: "landing_page",
      utmSource: utmParams.utm_source,
      utmMedium: utmParams.utm_medium,
      utmCampaign: utmParams.utm_campaign,
      utmContent: utmParams.utm_content,
      fbclid: utmParams.fbclid,
      gclid: utmParams.gclid,
    });
  };

  if (!slug) return <ProgramNotFound />;
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#02060E" }}>
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }
  if (error || !data) return <ProgramNotFound />;
  if (submitted) return <SuccessScreen program={data.program} club={data.club} />;

  const { program, club } = data;
  const colors = tierColor(program);
  const steps = ["Player Details", "Parent / Guardian", "Additional Info"];

  return (
    <div className="min-h-screen" style={{ background: "#02060E" }}>
      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at 30% 0%, rgba(3,86,197,0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 100%, rgba(3,86,197,0.05) 0%, transparent 60%)",
      }} />

      <header className="relative z-10 border-b border-white/[0.04] backdrop-blur-xl" style={{ background: "rgba(2,6,14,0.8)" }}>
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/25 to-blue-600/10 border border-blue-500/15 flex items-center justify-center">
              <span className="text-[11px] font-bold text-blue-400">{club.shortName}</span>
            </div>
            <div>
              <p className="text-[13px] font-medium text-white/70" data-testid="text-club-name">{club.name}</p>
              <p className="text-[10px] text-white/25">Registration Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/60">
            <Shield className="w-3 h-3" />
            <span>Secure</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-8">
        <div className={`rounded-2xl bg-gradient-to-br ${colors.bg} border ${colors.border} p-6 mb-6 animate-fade-in-up shadow-xl ${colors.glow}`} style={{ animationDelay: "0ms", opacity: 0 }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className={`text-[10px] ${colors.text} uppercase tracking-wider font-medium mb-2`}>
                {program.type === "academy" ? "Academy Programme" : program.type === "holiday_camp" ? "Holiday Camp" : program.type === "trials" ? "Trials" : program.type === "open_training" ? "Open Training" : "Event"}
              </div>
              <h1 className="text-xl font-semibold text-white mb-3 tracking-tight" data-testid="text-program-name">{program.name}</h1>
              {program.description && (
                <p className="text-[13px] text-white/40 leading-relaxed mb-4" data-testid="text-program-description">{program.description}</p>
              )}
              <div className="flex flex-wrap gap-4">
                {program.location && (
                  <div className="flex items-center gap-1.5 text-[12px] text-white/35" data-testid="text-location">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{program.location}</span>
                  </div>
                )}
                {program.startDate && (
                  <div className="flex items-center gap-1.5 text-[12px] text-white/35" data-testid="text-dates">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(program.startDate)}{program.endDate ? ` – ${formatDate(program.endDate)}` : ""}</span>
                  </div>
                )}
                {program.ageMin && (
                  <div className="flex items-center gap-1.5 text-[12px] text-white/35" data-testid="text-ages">
                    <Users className="w-3.5 h-3.5" />
                    <span>Ages {program.ageMin}–{program.ageMax}</span>
                  </div>
                )}
                {program.fee && (
                  <div className="flex items-center gap-1.5 text-[12px] text-white/35" data-testid="text-fee">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>{formatFee(program.fee)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 animate-fade-in-up" style={{ animationDelay: "50ms", opacity: 0 }}>
          <div className="flex items-center gap-2">
            {steps.map((step, i) => (
              <div key={step} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-2 flex-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all duration-300 ${
                    i < currentStep
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : i === currentStep
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-lg shadow-blue-500/10"
                        : "bg-white/[0.03] text-white/20 border border-white/[0.06]"
                  }`} data-testid={`step-indicator-${i}`}>
                    {i < currentStep ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-[11px] font-medium hidden sm:block ${
                    i === currentStep ? "text-white/60" : "text-white/20"
                  }`}>{step}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`w-8 h-px ${i < currentStep ? "bg-emerald-500/30" : "bg-white/[0.06]"}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] backdrop-blur-xl p-6 animate-fade-in-up shadow-2xl" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(3,86,197,0.04) 100%)", animationDelay: "100ms", opacity: 0 }}>

          {currentStep === 0 && (
            <div className="space-y-5" data-testid="step-player">
              <div>
                <h2 className="text-[15px] font-medium text-white/80 mb-1">Player Details</h2>
                <p className="text-[11px] text-white/25">Information about the player being registered</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FieldInput label="First Name" value={form.playerFirstName} onChange={(v) => updateField("playerFirstName", v)} error={errors.playerFirstName} testId="input-player-first-name" />
                <FieldInput label="Last Name" value={form.playerLastName} onChange={(v) => updateField("playerLastName", v)} error={errors.playerLastName} testId="input-player-last-name" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FieldInput label="Date of Birth" type="date" value={form.playerDateOfBirth} onChange={(v) => updateField("playerDateOfBirth", v)} error={errors.playerDateOfBirth} testId="input-player-dob" />
                <div>
                  <label className="block text-[11px] text-white/30 uppercase tracking-wider font-medium mb-2">Gender</label>
                  <select
                    value={form.playerGender}
                    onChange={(e) => updateField("playerGender", e.target.value)}
                    className="w-full h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/70 text-[13px] px-3 focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20 transition-all"
                    data-testid="select-player-gender"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <FieldInput label="School" value={form.school} onChange={(v) => updateField("school", v)} testId="input-school" />
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-5" data-testid="step-guardian">
              <div>
                <h2 className="text-[15px] font-medium text-white/80 mb-1">Parent / Guardian</h2>
                <p className="text-[11px] text-white/25">Primary contact for communications and account management</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FieldInput label="First Name" value={form.guardianFirstName} onChange={(v) => updateField("guardianFirstName", v)} error={errors.guardianFirstName} testId="input-guardian-first-name" />
                <FieldInput label="Last Name" value={form.guardianLastName} onChange={(v) => updateField("guardianLastName", v)} error={errors.guardianLastName} testId="input-guardian-last-name" />
              </div>
              <FieldInput label="Email" type="email" value={form.guardianEmail} onChange={(v) => updateField("guardianEmail", v)} error={errors.guardianEmail} testId="input-guardian-email" />
              <FieldInput label="Phone" type="tel" value={form.guardianPhone} onChange={(v) => updateField("guardianPhone", v)} error={errors.guardianPhone} testId="input-guardian-phone" />
              <FieldInput label="Address" value={form.address} onChange={(v) => updateField("address", v)} testId="input-address" />
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-5" data-testid="step-additional">
              <div>
                <h2 className="text-[15px] font-medium text-white/80 mb-1">Additional Information</h2>
                <p className="text-[11px] text-white/25">Medical, emergency, and consent details</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FieldInput label="Emergency Contact Name" value={form.emergencyContact} onChange={(v) => updateField("emergencyContact", v)} testId="input-emergency-contact" />
                <FieldInput label="Emergency Phone" type="tel" value={form.emergencyPhone} onChange={(v) => updateField("emergencyPhone", v)} testId="input-emergency-phone" />
              </div>
              <FieldInput label="Medical Notes" value={form.medicalNotes} onChange={(v) => updateField("medicalNotes", v)} testId="input-medical-notes" />
              <FieldInput label="Allergies" value={form.allergies} onChange={(v) => updateField("allergies", v)} testId="input-allergies" />
              <FieldInput label="Additional Notes" value={form.notes} onChange={(v) => updateField("notes", v)} testId="input-notes" />

              <div className="pt-2 space-y-4 border-t border-white/[0.04]">
                <h3 className="text-[11px] text-white/30 uppercase tracking-wider font-medium">Consents</h3>
                <ConsentToggle
                  label="Photo & Video Consent"
                  description="I consent to photos and videos of my child being used for club promotional purposes."
                  checked={form.photoConsent}
                  onChange={(v) => updateField("photoConsent", v)}
                  testId="switch-photo-consent"
                />
                <ConsentToggle
                  label="Medical Consent"
                  description="I authorise the club to seek medical attention for my child if required during activities."
                  checked={form.medicalConsent}
                  onChange={(v) => updateField("medicalConsent", v)}
                  testId="switch-medical-consent"
                />
                <ConsentToggle
                  label="Newsletter & Communications"
                  description="I would like to receive updates, newsletters, and marketing from the club."
                  checked={form.newsletterConsent}
                  onChange={(v) => updateField("newsletterConsent", v)}
                  testId="switch-newsletter-consent"
                />
              </div>
            </div>
          )}

          {submitMutation.isError && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[12px] text-red-400 flex items-center gap-2" data-testid="text-error">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Something went wrong. Please try again or contact {club.email}.</span>
            </div>
          )}

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/[0.04]">
            {currentStep > 0 ? (
              <Button
                variant="ghost"
                onClick={handleBack}
                className="text-white/40 hover:text-white/60 text-[13px] h-10 px-4 rounded-xl transition-colors"
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Back
              </Button>
            ) : (
              <div />
            )}
            {currentStep < steps.length - 1 ? (
              <Button
                onClick={handleNext}
                className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white border-0 rounded-xl h-10 px-6 text-[13px] font-medium shadow-lg shadow-blue-500/20 transition-all"
                data-testid="button-next"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={submitMutation.isPending}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white border-0 rounded-xl h-10 px-6 text-[13px] font-medium shadow-lg shadow-emerald-500/20 transition-all"
                data-testid="button-submit"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                    Complete Registration
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 text-center animate-fade-in-up" style={{ animationDelay: "150ms", opacity: 0 }}>
          <p className="text-[10px] text-white/15">
            Powered by <span className="text-white/25 font-medium">ClubOS</span> · {club.name}
          </p>
        </div>
      </main>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  error,
  testId,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  type?: string;
  error?: string;
  testId: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-white/30 uppercase tracking-wider font-medium mb-2">{label}</label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 rounded-xl bg-white/[0.04] border text-white/70 text-[13px] px-3 focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/20 transition-all placeholder:text-white/15 ${
          error ? "border-red-500/40" : "border-white/[0.08]"
        }`}
        data-testid={testId}
      />
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function ConsentToggle({
  label,
  description,
  checked,
  onChange,
  testId,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 data-[state=checked]:bg-blue-500"
        data-testid={testId}
      />
      <div className="flex-1">
        <p className="text-[12px] text-white/55 font-medium">{label}</p>
        <p className="text-[10px] text-white/25 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
