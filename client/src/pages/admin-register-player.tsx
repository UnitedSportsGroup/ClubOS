import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { formatCurrency, centsToDollarInput, dollarInputToCents } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { OFFICE_PAYMENT_METHODS } from "@shared/payments";
import { agreedPriceError } from "@shared/office-price";
import { GENDERS } from "@shared/academy";
import { NZF_COUNTRIES, NZF_ETHNICITY_GROUPS } from "@shared/nzf-vocabulary";
import {
  NzfIdentityFields,
  NzfAddressFields,
  EMPTY_NZF_IDENTITY,
  EMPTY_NZF_ADDRESS,
  type NzfIdentityValue,
  type NzfAddressValue,
} from "@/components/nzf-identity-fields";
import { NZ_REGIONS, IDENTITY_DEFER_REASONS } from "@shared/nzf-identity";
import {
  X, ChevronRight, ChevronLeft, User, Baby, Calendar, CheckCircle,
  Plus, Trash2, Loader2, Building2, CreditCard, Banknote, AlertTriangle, Lock, Search, Pencil,
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

interface StaffMember { id: number; firstName: string; lastName: string }

interface ProgrammeRow {
  id: number;
  name: string;
  slug: string;
  type: string;
  isActive?: boolean;
  registrationOpen?: boolean;
}

interface AcademyQuote {
  programme: {
    id: number; name: string; section: string; registrationOpen: boolean;
    seasonYear: number; ageMin: number | null; ageMax: number | null;
  };
  term: { id: number; year: number; name: string; termNumber: number | null; startDate: string; endDate: string } | null;
  /**
   * Every term this workspace has, each priced in its OWN right — the term
   * running now costs its remaining sessions, a future one costs the full fee.
   * `totalCents: null` means there is nothing left to sell in that term.
   */
  terms: {
    id: number; year: number; name: string; termNumber: number | null;
    startDate: string; endDate: string; isProgrammeTerm: boolean;
    /** A fact about the TERM, true whether or not an option has been chosen. */
    ended: boolean;
    /** null = not priced yet (no option chosen) or the term has ended — `ended` says which. */
    totalCents: number | null; sessionsRemaining: number | null; sessionsTotal: number | null;
  }[];
  allowFullYear: boolean;
  options: { id: number; name: string; fullPriceCents: number; scheduleText?: string | null }[];
  quote: {
    plan: string; subtotalCents: number; discountCents: number; totalCents: number;
    reason?: string; sessionsRemaining?: number | null; totalSessions?: number | null;
  } | null;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
}

function formatProductType(pt: string) {
  if (pt === "FULL_DAY") return "Full Day";
  if (pt === "MORNING") return "Morning";
  if (pt === "AFTERNOON") return "Afternoon";
  return pt;
}

// Contrast deliberately higher than the rest of the admin: this form gets used
// at a counter with a parent waiting, often on a laptop screen at an angle.
// 🔴 Real inputs, not translucent lifts. `bg-white/[0.06]` was a 6% white
// panel on near-black; on a white modal it maps to a 4% dark tint, which
// reads as no box at all — and this is the counter form Olga types a walk-up
// registration into. Tokens give an opaque field with a visible edge.
// Olga, 2026-08-18: "сделай пожалуйста саму форму больше размером, чтобы буквы
// были чуть больше." She enters these at a counter with a parent waiting, often
// reading off a phone screen held up to her — 11px uppercase was too small to
// scan. Labels 11→12.5px, inputs 14→15px, and the card is wider.
const FIELD = "bg-background border-input text-foreground placeholder:text-muted-foreground text-[15px] h-11";
const LABEL = "text-[12.5px] uppercase tracking-wide text-foreground/75 mb-1.5 block font-medium";
const SECTION = "text-[14px] font-semibold text-foreground/90";

// Theme for the shared NZF pickers, matched to this admin surface.
const NZF_THEME = {
  gold: "#D4AF37",
  goldBright: "#E8CF6B",
  line: "rgba(255,255,255,0.14)",
  mute: "rgba(255,255,255,0.5)",
  fieldCls: `w-full rounded-md px-3 py-2 text-sm border outline-none ${FIELD}`,
  fieldStyle: {} as React.CSSProperties,
  labelCls: LABEL,
};

// NZ calendar day, not toISOString() — that reports UTC and reads a day behind
// here from midday on, which would let staff pick "tomorrow" as a birthday.
function nzTodayIso() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const nzToday = nzTodayIso();
const thisYear = Number(nzToday.slice(0, 4));


/**
 * Find a player the club already knows, and bring their parent with them.
 *
 * Daniel, 2026-09-21: "if select new player it's the current flow with all form
 * fields that gets filled out which is longer and slower but required and
 * necessary and if existing player goes to an option of searching our existing
 * player contacts, if select player and can automatically connect parent
 * details."
 *
 * 🔴 It reads `/api/admin/people?filter=players`, which ALREADY returns each
 * player with their parents attached — the resolver built for the Families
 * view, which unions the three ways a parent and child can be linked. A second
 * search would drift from it.
 *
 * 🔴 It FILLS THE SAME FIELDS the long form writes, and leaves them editable.
 * Nothing is hidden and nothing is posted that a person has not seen: the
 * server still validates every one of them, and a detail that has changed since
 * last term is corrected in place rather than silently carried forward.
 *
 * 🔴 It never invents a parent. A player on file with no parent linked fills
 * the child's half and says so, rather than leaving the operator to wonder why
 * the email box is empty.
 */
function ExistingPersonSearch({ onPick }: {
  /** The person KEY and a display label. The caller fetches the full record —
   *  this list carries a name and a parent's NAME only. */
  onPick: (key: string, label: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = q.trim();

  const { data, isFetching } = useQuery<{ people: any[] }>({
    queryKey: ["/api/admin/people", { q: term, filter: "players" }],
    queryFn: async () => {
      const res = await workspaceFetch(`/api/admin/people?filter=players&limit=8&q=${encodeURIComponent(term)}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    // Two characters is where a name search stops returning the whole club.
    enabled: term.length >= 2,
  });

  const people = data?.people ?? [];

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-3 space-y-2" data-testid="existing-person-search">
      <div className="flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-blue-400/60" />
        <span className="text-[12.5px] font-medium text-foreground/80">Already registered with us?</span>
      </div>
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder="Search a player by name, or their parent's email"
        className={FIELD}
        data-testid="input-person-search"
      />
      {term.length >= 2 && open && (
        <div className="rounded-lg border border-border bg-background max-h-[220px] overflow-y-auto">
          {isFetching && <p className="text-[12px] text-muted-foreground px-3 py-2">Searching…</p>}
          {!isFetching && people.length === 0 && (
            <p className="text-[12px] text-muted-foreground px-3 py-2">
              Nobody matches — fill the form below and they'll be created.
            </p>
          )}
          {people.map((p: any) => {
            // `parents` is a list of NAMES here, not records — the full parent
            // comes with the person record once picked.
            const parent: string | null = (p.parents ?? [])[0] ?? null;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  onPick(p.key, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim());
                  setOpen(false);
                  setQ("");
                }}
                className="w-full text-left px-3 py-2 hover:bg-muted/60 border-b border-border/50 last:border-0 cursor-pointer"
                data-testid={`person-result-${p.key}`}
              >
                <div className="text-[13px] text-foreground/90">
                  {p.firstName} {p.lastName}
                  {p.dateOfBirth && <span className="text-muted-foreground text-[11.5px] ml-2">{p.dateOfBirth}</span>}
                </div>
                <div className="text-[11.5px] text-muted-foreground">
                  {parent
                    ? <>Parent: {parent}</>
                    : <span className="text-amber-600 dark:text-amber-400">No parent linked — you'll need to add one</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Picking someone fills the form below. Check it — anything that has
        changed since last time gets corrected here.
      </p>
    </div>
  );
}

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: any; hint?: string }) {
  return (
    <div className="min-w-0">
      <label className={LABEL}>
        {label}{required && <span className="text-blue-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-white/50 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

/**
 * `scope` decides which programmes the picker offers.
 *
 * Opened from the Academy page it must show academy programmes — showing a
 * "Select camp" list there is just wrong, and on this workspace both camps are
 * inactive so the list came up empty. Opened from Camps it shows camps. Opened
 * from Registrations (which covers the whole workspace) it shows both.
 */
export function RegisterPlayerModal({
  open,
  onClose,
  scope = "all",
  posSaleId,
  onRegistered,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  scope?: "academy" | "camp" | "all";
  /**
   * Opened from the ClubOS register (2026-09-09): the registration is created
   * PENDING and linked to this sale, and the register takes the money — so the
   * payment step here is fixed to "not paid yet" and cannot be flipped.
   */
  posSaleId?: number;
  onRegistered?: (data: { registrationId: number; totalCents: number; status: string }) => void;
  /**
   * Opened from a person's profile (2026-09-21): "if you just search parent or
   * player contact in clubos there is like an add registration button on their
   * profile, then all details already automatically filled in". The "first
   * time with us?" step is skipped — we already know who they are.
   */
  prefill?: { personKey: string };
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const fromRegister = typeof posSaleId === "number" && posSaleId > 0;

  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);

  // ── Camp shape ────────────────────────────────────────────────────────────
  // 🔴 ONE VISIT, SEVERAL REGISTRATIONS. Daniel, 2026-09-21: "someone comes in
  // and wants holiday camps and technification and pay in eftpos at the same
  // time". Each programme stays its own registration — they price, roll and
  // refund separately — and this id is what says they were one transaction at
  // the counter. Minted once and carried across every line of the visit.
  const [groupId, setGroupId] = useState<string | null>(null);
  // Whether the operator said there is another programme to add for this family.
  const [addAnother, setAddAnother] = useState(false);
  const [linesDone, setLinesDone] = useState<{ id: number; programme: string; totalCents: number }[]>([]);
  // ── Who: first time with us? ──────────────────────────────────────────────
  const [whoChoice, setWhoChoice] = useState<"existing" | "new" | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [pickedLabel, setPickedLabel] = useState("");
  const [prefillApplied, setPrefillApplied] = useState(false);
  // After a pick the details are shown as a read-only card. The pencil flips
  // it into the form — the fields are there the whole time, just not in the
  // way. Daniel, 2026-09-21: "non editable preview but with a pencil icon to
  // edit if need be."
  const [editingDetails, setEditingDetails] = useState(false);
  /** The id every registration of this visit shares. Minted on the first save
   *  and kept until the operator closes the dialog, so a second programme for
   *  the same family joins the same transaction — including a line retried
   *  after a failure. */
  const visitGroupId = () => {
    if (groupId) return groupId;
    const id = (globalThis.crypto?.randomUUID?.() ?? `v${Date.now()}${Math.random().toString(36).slice(2)}`)
      .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    setGroupId(id);
    return id;
  };

  const [parentFirst, setParentFirst] = useState("");
  const [parentLast, setParentLast] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  // Set when Next is pressed with something missing (item 5), and when a stray
  // click on the backdrop would have thrown the form away (item 7).
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Item 6: an agreed price for this family, and why. Blank = the list price.
  const [priceOverride, setPriceOverride] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [editingPrice, setEditingPrice] = useState(false);
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [children, setChildren] = useState<ChildData[]>([
    { firstName: "", lastName: "", dateOfBirth: "", allergies: "", epiPen: false, medicalNotes: "" },
  ]);
  const [items, setItems] = useState<BookingItem[]>([]);

  // ── Academy shape ─────────────────────────────────────────────────────────
  const [optionId, setOptionId] = useState<number | null>(null);
  // WHICH TERM the counter is selling. null = the programme's own current term,
  // which is what every caller did before the picker existed.
  const [termId, setTermId] = useState<number | null>(null);
  const [plan, setPlan] = useState<"term" | "year">("term");
  const [playerFirst, setPlayerFirst] = useState("");
  const [playerLast, setPlayerLast] = useState("");
  const [playerDob, setPlayerDob] = useState("");
  const [playerGender, setPlayerGender] = useState("");
  const [playerSchool, setPlayerSchool] = useState("");
  // Structured, exactly as the public form captures it — so a walk-up
  // registration is as registerable as an online one. Still OPTIONAL here: a
  // parent at the counter with a queue behind them should not be blocked, and a
  // recorded gap is honest where a guessed ethnicity is not.
  const [identity, setIdentity] = useState<NzfIdentityValue>(EMPTY_NZF_IDENTITY);
  const [nzfAddress, setNzfAddress] = useState<NzfAddressValue>({ ...EMPTY_NZF_ADDRESS, country: "NZL" });
  // The documented skip. Required by default; deferring is deliberate, needs a
  // reason, and puts the child on the follow-up list — so a gap is a decision
  // someone made rather than something that quietly happened.
  const [deferIdentity, setDeferIdentity] = useState(false);
  const [deferReason, setDeferReason] = useState("");
  const [deferNote, setDeferNote] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [relationship, setRelationship] = useState("parent");
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [ackAgeWarning, setAckAgeWarning] = useState(false);

  // ── Payment (both shapes) ─────────────────────────────────────────────────
  const [isPaid, setIsPaid] = useState(true);
  useEffect(() => { if (open && fromRegister) setIsPaid(false); }, [open, fromRegister]);
  const [method, setMethod] = useState<string>("eftpos");
  const [amountDollars, setAmountDollars] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [reference, setReference] = useState("");
  const [servedById, setServedById] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const { data: me } = useQuery<{ id: number; firstName: string; lastName: string }>({ queryKey: ["/api/auth/me"] });
  const { data: staff } = useQuery<StaffMember[]>({ queryKey: ["/api/admin/staff-directory"] });
  const { data: camps } = useQuery<ProgrammeRow[]>({ queryKey: ["/api/admin/camps"] });
  const { data: academy } = useQuery<ProgrammeRow[]>({ queryKey: ["/api/admin/academy"] });

  // Default "served by" to whoever is logged in — usually the person at the
  // counter — but leave it changeable, because Olga may be typing up what
  // Travis took an hour ago.
  useEffect(() => {
    if (me?.id && servedById === null) setServedById(me.id);
  }, [me?.id, servedById]);

  const programmes: ProgrammeRow[] = useMemo(() => {
    const a = scope === "camp" ? [] : (academy || []).map((p) => ({ ...p, type: "academy" }));
    const c = scope === "academy" ? [] : (camps || []).map((p) => ({ ...p, type: "holiday_camp" }));
    return [...a, ...c];
  }, [academy, camps, scope]);

  const noun = scope === "academy" ? "programme" : scope === "camp" ? "camp" : "programme";

  const programme = programmes.find((p) => p.id === selectedProgramId) || null;
  const shape: "academy" | "camp" | null =
    programme ? (programme.type === "academy" ? "academy" : "camp") : null;

  const STEP_ONE = scope === "camp" ? "Camp" : "Programme";
  // Before a programme is picked there is no shape yet, so fall back to what
  // the page can possibly offer. Without this the Academy page showed a
  // "Parent › Children › Sessions" rail — the camp journey — until you clicked.
  const assumedShape = shape ?? (scope === "academy" ? "academy" : scope === "camp" ? "camp" : null);
  // "Who" sits right after the programme, because that is where the counter
  // conversation goes next. Skipped when opened from a profile — we know who.
  const WHO: string[] = prefill ? [] : ["Who"];
  const STEPS = assumedShape === "academy"
    ? [STEP_ONE, ...WHO, "Family", "Payment", "Confirm"]
    : [STEP_ONE, ...WHO, "Parent", "Children", "Sessions", "Payment", "Confirm"];

  // ── Academy pricing: quoted by the server, never computed here ────────────
  const { data: academyData, isFetching: quoting } = useQuery<AcademyQuote>({
    queryKey: ["/api/admin/registrations/manual/quote", selectedProgramId, optionId, plan, termId],
    queryFn: async () => {
      const qs = new URLSearchParams({ programId: String(selectedProgramId), plan });
      if (optionId) qs.set("programOptionId", String(optionId));
      if (termId) qs.set("termId", String(termId));
      // 🔴 workspaceFetch, never a bare fetch(). This endpoint is tab-gated, and
      // requireTab() demands X-Workspace-Slug of everyone — a bare fetch prices
      // the programme for a super admin and answers 400 for the office.
      const res = await workspaceFetch(`/api/admin/registrations/manual/quote?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not price this programme");
      return res.json();
    },
    enabled: shape === "academy" && !!selectedProgramId,
  });

  // One sellable option → choose it automatically, same as the public checkout.
  useEffect(() => {
    if (shape !== "academy") return;
    const opts = academyData?.options || [];
    if (opts.length === 1 && optionId !== opts[0].id) setOptionId(opts[0].id);
  }, [academyData, shape, optionId]);

  // ── Camp pricing (unchanged) ──────────────────────────────────────────────
  const { data: campData } = useQuery<{ camp: any; pricing: any[]; dates: any[]; discounts: any[] }>({
    queryKey: ["/api/public/camps", selectedProgramId],
    queryFn: async () => {
      if (!programme?.slug) return null;
      const res = await fetch(`/api/public/camps/${programme.slug}`);
      if (!res.ok) throw new Error("Camp not found");
      return res.json();
    },
    enabled: shape === "camp" && !!selectedProgramId,
  });

  const pricing = campData?.pricing || [];
  const dates = campData?.dates || [];
  const validChildren = children.filter((c) => c.firstName.trim());

  const campTotals = useMemo(() => {
    let subtotal = 0;
    for (const item of items) {
      const price = pricing.find((p: any) => p.productType === item.productType);
      if (price) subtotal += price.priceCents * validChildren.length;
    }
    const totalItems = validChildren.length * items.length;
    const discounts = campData?.discounts || [];
    const applicable = discounts
      .filter((d: any) => totalItems >= d.minBookings)
      .sort((a: any, b: any) => Number(b.discountPercent) - Number(a.discountPercent))[0];
    const discount = applicable ? Math.round(subtotal * Number(applicable.discountPercent) / 100) : 0;
    return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount };
  }, [items, pricing, validChildren.length, campData]);

  // What the programme quotes for this family today — the pro-rated figure for
  // an academy term, the summed sessions for a camp.
  const listTotalCents = shape === "academy"
    ? academyData?.quote?.totalCents ?? 0
    : campTotals.totalCents;

  // 🔴 The CEILING is the programme's published fee, which is NOT the quote. On
  // 15 September a $150 Technification term quoted $30 because two sessions
  // were left, and Olga — recording a family settling up for a term they had
  // already trained — could not enter the $135 they actually owed. The old test
  // measured against `listTotalCents` and silently discarded anything above it.
  const priceCeilingCents = shape === "academy"
    ? academyData?.quote?.subtotalCents ?? 0
    : campTotals.subtotalCents;

  // The agreed price for THIS family, if one has been typed. null = none, so a
  // blank box means "charge the list price" rather than "charge nothing" — the
  // distinction MoneyInput cannot make for us.
  const agreedCents = priceOverride.trim() === "" ? null : dollarInputToCents(priceOverride);

  // 🔴 Same function the server uses (@shared/office-price), so a price this
  // form accepts is a price the server accepts. null = fine.
  const priceProblem = agreedPriceError({
    agreedCents,
    listSubtotalCents: priceCeilingCents,
    reason: priceReason,
  });

  // What they actually owe. An override that cannot be applied NEVER falls back
  // silently — `missingForStep` blocks the submit and names the problem.
  const priceApplies = agreedCents != null && !priceProblem;
  const totalCents = priceApplies ? agreedCents! : listTotalCents;

  // Keep the amount box in step with the price until the user edits it — a
  // part-payment is deliberate, never a stale number left behind by a change
  // of option.
  useEffect(() => {
    if (!amountTouched) setAmountDollars(totalCents > 0 ? centsToDollarInput(totalCents) : "");
  }, [totalCents, amountTouched]);

  const paidCents = isPaid ? dollarInputToCents(amountDollars) : 0;
  const isShortPayment = isPaid && paidCents > 0 && paidCents < totalCents;

  const registerMutation = useMutation({
    mutationFn: async () => {
      const payment = {
        isPaid: fromRegister ? false : isPaid,
        method: !fromRegister && isPaid ? method : null,
        reference: reference.trim() || null,
        amountPaidCents: !fromRegister && isPaid ? paidCents : 0,
      };
      const posLink = fromRegister ? { posSaleId } : {};

      if (shape === "academy") {
        const res = await apiRequest("POST", "/api/admin/registrations/manual", {
          registrationGroupId: visitGroupId(),
          programId: selectedProgramId,
          programOptionId: optionId,
          paymentPlan: plan,
          // Which term they paid for. Omitted = the programme's own current
          // term, which the server resolves; it re-prices either way.
          termId: plan === "term" ? termId : null,
          guardian: {
            firstName: parentFirst, lastName: parentLast,
            email: parentEmail, phone: parentPhone, relationship,
          },
          player: {
            firstName: playerFirst, lastName: playerLast, dateOfBirth: playerDob,
            gender: playerGender, school: playerSchool,
            countryOfBirthCode: identity.countryOfBirthCode || undefined,
            nationalityCode: identity.nationalityCode || undefined,
            ethnicityGroupId: identity.ethnicityGroupId ?? undefined,
            ethnicitySelectionIds: identity.ethnicityGroupId ? identity.ethnicitySelectionIds : undefined,
            ethnicity2GroupId: identity.ethnicity2GroupId ?? undefined,
            ethnicity2SelectionIds: identity.ethnicity2GroupId ? identity.ethnicity2SelectionIds : undefined,
            addressParts: deferIdentity ? undefined : {
              street: nzfAddress.street.trim(), suburb: nzfAddress.suburb.trim(),
              city: nzfAddress.city.trim(), region: nzfAddress.region.trim(),
              postcode: nzfAddress.postcode.trim(), country: nzfAddress.country,
            },
            deferIdentity: deferIdentity || undefined,
            deferReason: deferIdentity ? deferReason : undefined,
            deferNote: deferIdentity ? deferNote.trim() || undefined : undefined,
            allergies, medicalNotes,
          },
          emergency: { name: emergencyContact, phone: emergencyPhone },
          // Also sent at the TOP level. It has always ridden inside `player`
          // while the server read it from here, so the skip tick never worked;
          // the server now accepts either, and sending both means neither end
          // can quietly become the only one that is right again.
          deferIdentity: deferIdentity || undefined,
          deferReason: deferIdentity ? deferReason : undefined,
          deferNote: deferIdentity ? deferNote.trim() || undefined : undefined,
          policyAccepted,
          acknowledgeAgeWarning: ackAgeWarning,
          notes: notes.trim() || null,
          // Only sent when it is a real, reasoned reduction — the server
          // re-validates both, so a half-typed box can never undercharge.
          priceOverrideCents: priceApplies ? agreedCents : undefined,
          priceOverrideReason: priceApplies ? priceReason.trim() : undefined,
          payment,
          servedByUserId: servedById,
          ...posLink,
        });
        return res.json();
      }

      const expandedItems: BookingItem[] = [];
      for (let ci = 0; ci < validChildren.length; ci++) {
        for (const item of items) {
          expandedItems.push({ childIndex: ci, campDateId: item.campDateId, productType: item.productType });
        }
      }
      const res = await apiRequest("POST", "/api/admin/registrations/manual", {
        registrationGroupId: visitGroupId(),
        programId: selectedProgramId,
        parent: {
          firstName: parentFirst, lastName: parentLast, email: parentEmail,
          phone: parentPhone, emergencyContact, emergencyPhone,
        },
        children: validChildren,
        items: expandedItems,
        // The camp branch ignored an agreed price entirely until 2026-09-15,
        // so a discounted walk-up was written at full price and the money taken
        // read as a short payment — leaving the family `pending` and therefore
        // invisible under the unpaid-is-not-registered rule.
        priceOverrideCents: priceApplies ? agreedCents : undefined,
        priceOverrideReason: priceApplies ? priceReason.trim() : undefined,
        payment,
        servedByUserId: servedById,
        ...posLink,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/camps/registration-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academy/registration-counts"] });

      const paidLabel = isPaid
        ? `${OFFICE_PAYMENT_METHODS.find((m) => m.value === method)?.label ?? "Paid"} ${formatCurrency(paidCents, { fromCents: true })}`
        : "Not paid";
      toast({
        title: `Registration #${data.registrationId} created`,
        description: `${formatCurrency(data.totalCents, { fromCents: true })} — ${paidLabel} — ${data.status}`,
      });
      if (data.nzfMissing?.length) {
        toast({
          title: "NZ Football details still needed",
          description: `Missing: ${data.nzfMissing.join(", ")}. Add them on the player's contact record before the audit.`,
        });
      }
      if (fromRegister && onRegistered) onRegistered({ registrationId: data.registrationId, totalCents: data.totalCents, status: data.status });

      // 🔴 ANOTHER PROGRAMME FOR THE SAME FAMILY, same visit. Daniel,
      // 2026-09-21: "allow to make multiple programs in one rego… someone comes
      // in and wants holiday camps and technification and pay in eftpos at the
      // same time." Rather than a second trip through the whole form, the
      // family and the group id are KEPT and only the programme-specific parts
      // are cleared. Each line is still its own registration on the proven
      // creation path — nothing about how a registration is made changed.
      if (addAnother) {
        setLinesDone((prev) => [...prev, {
          id: data.registrationId,
          programme: programmes?.find((p: any) => p.id === selectedProgramId)?.name ?? `Programme ${selectedProgramId}`,
          totalCents: data.totalCents,
        }]);
        resetProgrammeOnly();
        toast({
          title: "Saved — add the next programme",
          description: "Their details are kept. Everything from this visit is recorded as one transaction.",
        });
        return;
      }

      resetForm();
      onClose();
    },
    onError: (e: any) => {
      // The server refuses an out-of-band age unless it's explicitly accepted.
      if (typeof e?.message === "string" && e.message.toLowerCase().includes("age")) {
        setAckAgeWarning(true);
      }
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    },
  });

  /**
   * Fill the whole form from a person we already know.
   *
   * 🔴 Reads the SAME record the profile page shows — /api/admin/people/:key,
   * the Families resolver — never the search row, which carries a name and a
   * parent's NAME only. That is the bug this replaces: the first cut wrote the
   * parent from the search result and got empty strings.
   *
   * 🔴 Fills, never hides. Every field stays visible and the server still
   * validates all of them; what changed since last term is corrected in place.
   * Nothing here invents a value — a blank on file stays blank.
   */
  const applyFamily = (fam: any, label: string) => {
    const person = fam?.person ?? {};
    const isPlayerRecord = person.kind === "child" || person.type === "player";
    const g = (fam?.guardians ?? [])[0];
    const kids: any[] = fam?.children ?? [];

    const fillParent = (src: any) => {
      if (!src) return;
      setParentFirst(src.firstName ?? "");
      setParentLast(src.lastName ?? "");
      setParentEmail(src.email ?? "");
      setParentPhone(src.phone ?? "");
    };
    const fillPlayer = (src: any) => {
      if (!src) return;
      setPlayerFirst(src.firstName ?? "");
      setPlayerLast(src.lastName ?? "");
      if (src.dateOfBirth) setPlayerDob(String(src.dateOfBirth).slice(0, 10));
      if (src.gender) setPlayerGender(String(src.gender));
      setPlayerSchool(src.school ?? "");
      setAllergies(src.allergies ?? "");
      setMedicalNotes(src.medicalNotes ?? "");
      if (src.emergencyContact) setEmergencyContact(src.emergencyContact);
      if (src.emergencyPhone) setEmergencyPhone(src.emergencyPhone);
      // NZ Football identity — the machine values the form itself writes.
      const hasIdentity = !!(src.countryOfBirthCode || src.nationalityCode || src.ethnicityGroupId);
      if (hasIdentity) {
        setIdentity({
          countryOfBirthCode: src.countryOfBirthCode ?? "",
          nationalityCode: src.nationalityCode ?? "",
          ethnicityGroupId: src.ethnicityGroupId ?? null,
          ethnicitySelectionIds: Array.isArray(src.ethnicitySelectionIds) ? src.ethnicitySelectionIds : [],
          ethnicity2GroupId: src.ethnicity2GroupId ?? null,
          ethnicity2SelectionIds: Array.isArray(src.ethnicity2SelectionIds) ? src.ethnicity2SelectionIds : [],
        });
        setDeferIdentity(false);
      }
      if (src.addressStreet || src.addressCity) {
        setNzfAddress({
          street: src.addressStreet ?? "", suburb: src.addressSuburb ?? "", city: src.addressCity ?? "",
          region: src.addressRegion ?? "", postcode: src.addressPostcode ?? "", country: src.addressCountry ?? "NZL",
        });
      }
    };
    const childRow = (c: any) => ({
      firstName: c.firstName ?? "", lastName: c.lastName ?? "",
      dateOfBirth: c.dateOfBirth ? String(c.dateOfBirth).slice(0, 10) : "",
      allergies: c.allergies ?? "", epiPen: !!c.epiPen, medicalNotes: c.medicalNotes ?? "",
    });

    if (isPlayerRecord) {
      fillPlayer(person);
      fillParent(g);
      // A camp books children, so the player becomes the child row.
      setChildren([childRow(person)]);
    } else {
      // A parent's profile: the parent, and every child they have on file —
      // all of them for a camp, the first for an academy enrolment.
      fillParent(person);
      if (kids.length) {
        setChildren(kids.map(childRow));
        fillPlayer(kids[0]);
      }
    }
    setPickedLabel(label);
    toast({
      title: `${label} filled in`,
      description: g || !isPlayerRecord
        ? "Check the details — anything that changed since last time gets corrected here."
        : "No parent is linked to them, so add one on the next step.",
    });
  };

  const loadAndApply = async (key: string, label: string) => {
    try {
      const res = await workspaceFetch(`/api/admin/people/${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
      const fam = await res.json();
      applyFamily(fam, label);
      setPickedKey(key);
    } catch (e: any) {
      toast({ title: "Could not load them", description: e.message, variant: "destructive" });
    }
  };

  // Opened from a profile: fill once, and stand on the programme step.
  useEffect(() => {
    if (!open || !prefill || prefillApplied) return;
    setPrefillApplied(true);
    setWhoChoice("existing");
    void loadAndApply(prefill.personKey, "This person");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.personKey]);

  const showPreview = !!pickedKey && !editingDetails;

  /**
   * What was pulled in, as a card. Rendered FROM THE FORM STATE, never from the
   * fetched record, so it is always exactly what will be posted — an edit made
   * behind the pencil shows here too.
   *
   * 🔴 A blank reads "—", never a guess. And the NZ Football codes are shown
   * as the names people recognise; the codes stay in state untouched.
   */
  const detailsPreview = (opts: { onEdit: () => void; editLabel?: string }) => {
    const dash = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : "—");
    const nice = (iso: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
      if (!m) return dash(iso);
      const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${Number(m[3])} ${M[Number(m[2]) - 1]} ${m[1]}`;
    };
    const country = (code: string) => NZF_COUNTRIES.find((c) => c.code === code)?.name ?? dash(code);
    const group = (id: number | null) => NZF_ETHNICITY_GROUPS.find((g) => g.id === id)?.name ?? "—";
    const address = [nzfAddress.street, nzfAddress.suburb, nzfAddress.city, nzfAddress.region, nzfAddress.postcode]
      .filter((x) => x && x.trim()).join(", ");
    const kids = children.filter((c) => c.firstName.trim() || c.lastName.trim());
    return (
      <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] overflow-hidden" data-testid="picked-preview">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-emerald-500/15">
          <span className="text-[12px] uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-300">
            On file — check it's still right
          </span>
          <button
            type="button"
            onClick={opts.onEdit}
            className="inline-flex items-center gap-1.5 text-[12px] text-blue-600 hover:underline cursor-pointer"
            data-testid="button-edit-picked"
          >
            <Pencil className="w-3.5 h-3.5" /> {opts.editLabel ?? "Edit"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-4 py-3">
          <div className="space-y-1.5 min-w-0">
            <p className={SECTION}>Player</p>
            {assumedShape === "academy" || kids.length === 0 ? (
              <>
                <Row label="Name" value={`${dash(playerFirst)} ${dash(playerLast)}`} strong />
                <Row label="Date of birth" value={nice(playerDob)} />
                <Row label="Gender" value={dash(playerGender)} />
                <Row label="School" value={dash(playerSchool)} />
                <Row label="Allergies" value={dash(allergies)} />
                <Row label="Medical notes" value={dash(medicalNotes)} />
              </>
            ) : (
              kids.map((c, i) => (
                <div key={i} className="space-y-1">
                  <Row label={kids.length > 1 ? `Child ${i + 1}` : "Name"} value={`${c.firstName} ${c.lastName}`.trim()} strong />
                  <Row label="Date of birth" value={nice(c.dateOfBirth)} />
                  <Row label="Allergies" value={dash(c.allergies)} />
                </div>
              ))
            )}
          </div>
          <div className="space-y-1.5 min-w-0 mt-3 sm:mt-0">
            <p className={SECTION}>Parent / guardian</p>
            <Row label="Name" value={`${dash(parentFirst)} ${dash(parentLast)}`} strong />
            <Row label="Email" value={dash(parentEmail)} />
            <Row label="Phone" value={dash(parentPhone)} />
            <Row label="Emergency" value={emergencyContact ? `${emergencyContact}${emergencyPhone ? ` · ${emergencyPhone}` : ""}` : "—"} />
            {assumedShape === "academy" && (
              <>
                <p className={`${SECTION} pt-2`}>NZ Football</p>
                <Row label="Born in" value={identity.countryOfBirthCode ? country(identity.countryOfBirthCode) : "—"} />
                <Row label="Nationality" value={identity.nationalityCode ? country(identity.nationalityCode) : "—"} />
                <Row label="Ethnicity" value={group(identity.ethnicityGroupId)} />
                <Row label="Address" value={address || "—"} />
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  /** Clear ONLY what belongs to the programme just saved. The family, the
   *  emergency contact, the NZF identity and the visit's group id all stay —
   *  they are facts about the people, not about the thing they bought. */
  const resetProgrammeOnly = () => {
    setStep(0);
    setSelectedProgramId(null);
    setOptionId(null); setPlan("term");
    setItems([]);
    setPriceOverride(""); setPriceReason(""); setEditingPrice(false);
    setAckAgeWarning(false);
  };

  const resetForm = () => {
    setStep(0);
    setSelectedProgramId(null);
    setGroupId(null); setAddAnother(false); setLinesDone([]);
    setWhoChoice(null); setPickedKey(null); setPickedLabel(""); setPrefillApplied(false);
    setEditingDetails(false);
    setParentFirst(""); setParentLast(""); setParentEmail(""); setParentPhone("");
    setEmergencyContact(""); setEmergencyPhone("");
    setPriceOverride(""); setPriceReason(""); setEditingPrice(false);
    setChildren([{ firstName: "", lastName: "", dateOfBirth: "", allergies: "", epiPen: false, medicalNotes: "" }]);
    setItems([]);
    setOptionId(null); setPlan("term");
    setPlayerFirst(""); setPlayerLast(""); setPlayerDob(""); setPlayerGender(""); setPlayerSchool("");
    setIdentity(EMPTY_NZF_IDENTITY); setNzfAddress({ ...EMPTY_NZF_ADDRESS, country: "NZL" });
    setDeferIdentity(false); setDeferReason(""); setDeferNote("");
    setAllergies(""); setMedicalNotes(""); setRelationship("parent");
    setPolicyAccepted(false); setAckAgeWarning(false);
    setIsPaid(true); setMethod("eftpos"); setAmountDollars(""); setAmountTouched(false);
    setReference(""); setNotes("");
    setServedById(me?.id ?? null);
  };

  // Anything typed at all counts. Deliberately generous: the cost of asking
  // once too often is a click, the cost of asking too rarely is the whole form.
  const isDirty = !!(
    selectedProgramId || parentFirst || parentLast || parentEmail || parentPhone ||
    playerFirst || playerLast || playerDob || playerSchool || allergies || medicalNotes ||
    emergencyContact || emergencyPhone || reference || notes ||
    identity.countryOfBirthCode || identity.nationalityCode || nzfAddress.street ||
    children.some((c) => c.firstName || c.lastName || c.dateOfBirth) || items.length > 0
  );

  const close = () => { resetForm(); setShowErrors(false); setConfirmDiscard(false); onClose(); };

  const addChild = () => setChildren([...children, { firstName: "", lastName: "", dateOfBirth: "", allergies: "", epiPen: false, medicalNotes: "" }]);
  const removeChild = (idx: number) => { if (children.length > 1) setChildren(children.filter((_, i) => i !== idx)); };
  const updateChild = (idx: number, field: keyof ChildData, value: string | boolean) =>
    setChildren(children.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));

  const toggleItem = (campDateId: number, productType: string) => {
    const exists = items.find((i) => i.campDateId === campDateId && i.productType === productType);
    if (exists) {
      setItems(items.filter((i) => !(i.campDateId === campDateId && i.productType === productType)));
    } else {
      const filtered = items.filter((i) => i.campDateId !== campDateId);
      filtered.push({ childIndex: 0, campDateId, productType });
      setItems(filtered);
    }
  };

  // Olga, 2026-08-18, item 3: "26 Aug 2015 can you please change 26/08/2015
  // age 10(11) — 10 is right now, 11 will be by end of current year."
  //
  // Both numbers matter and they are different questions. The age TODAY is who
  // is standing at the counter; the age by 31 December is the NZF age grade
  // (season year minus birth year), which is what the child actually plays in.
  // Showing one without the other is how a nine-year-old gets put in the wrong
  // group. Parsed as calendar parts — `new Date("2015-08-26")` is UTC and reads
  // a day early in NZ.
  const dobHint = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(playerDob);
    if (!m) return "Sets their age grade (season year minus birth year).";
    const [, y, mo, d] = m;
    const [ty, tm, td] = nzToday.split("-").map(Number);
    const by = Number(y), bm = Number(mo), bd = Number(d);
    let ageNow = ty - by;
    if (tm < bm || (tm === bm && td < bd)) ageNow -= 1;
    const ageAtYearEnd = ty - by;                        // NZF grade age
    if (ageNow < 0) return "That date is in the future.";
    return ageAtYearEnd === ageNow
      ? `${d}/${mo}/${y} · age ${ageNow}`
      : `${d}/${mo}/${y} · age ${ageNow} (${ageAtYearEnd} by the end of ${ty})`;
  })();

  const stepName = STEPS[step];

  // NZ Football data is required to move on — unless it's been deliberately
  // deferred with a reason. The server enforces the same rule; this only stops
  // staff walking into a rejection at the end of the flow.
  const nzfGroup = NZF_ETHNICITY_GROUPS.find((g) => g.id === identity.ethnicityGroupId);
  const nzfIdentityOk =
    !!identity.countryOfBirthCode &&
    !!identity.nationalityCode &&
    !!nzfGroup &&
    (nzfGroup.maxSelections === 0
      ? identity.ethnicitySelectionIds.length === 0
      : identity.ethnicitySelectionIds.length >= nzfGroup.minSelections &&
        identity.ethnicitySelectionIds.length <= nzfGroup.maxSelections);
  const nzfAddressOk =
    !!nzfAddress.street.trim() && !!nzfAddress.suburb.trim() && !!nzfAddress.city.trim() &&
    !!nzfAddress.region.trim() && !!nzfAddress.postcode.trim() && !!nzfAddress.country;
  const deferralOk = !!deferReason && (deferReason !== "Other" || !!deferNote.trim());
  const nzfStepOk = deferIdentity ? deferralOk : (nzfIdentityOk && nzfAddressOk);

  // Olga, 2026-08-18, item 5: "If you are skipping some fields by mistake, and
  // try to go to next page, it doesn't work but doesn't show where is mistake,
  // unfilled gap."
  //
  // The Next button was simply `disabled`, which tells a person nothing — least
  // of all on a long form where the missing box has scrolled off. This names
  // every field still needed, in the order they appear, and the button now
  // always CLICKS: pressing it either advances or reveals the list.
  const missingForStep = (): string[] => {
    const out: string[] = [];
    const need = (ok: boolean, label: string) => { if (!ok) out.push(label); };
    if (stepName === "Who") {
      need(!!whoChoice, "whether they're new or already with us");
      if (whoChoice === "existing") need(!!pickedKey, "the player to register");
    }
    if (stepName === STEP_ONE) {
      need(!!selectedProgramId, scope === "camp" ? "a camp" : "a programme");
      if (shape === "academy" && selectedProgramId) {
        need(!!optionId, "an age group / option");
        need(!!academyData?.quote, "a price for that option");
      }
    }
    if (stepName === "Family") {
      need(!!playerFirst.trim(), "Player first name");
      need(!!playerLast.trim(), "Player last name");
      need(/^\d{4}-\d{2}-\d{2}$/.test(playerDob), "Player date of birth");
      need(!!parentFirst.trim(), "Parent first name");
      need(!!parentLast.trim(), "Parent last name");
      need(parentEmail.trim().includes("@"), "Parent email");
      need(!!parentPhone.trim(), "Parent phone");
      if (deferIdentity) {
        need(!!deferReason, "a reason for skipping the NZ Football details");
        if (deferReason === "Other") need(!!deferNote.trim(), "a note for that reason");
      } else {
        need(!!identity.countryOfBirthCode, "Country of birth");
        need(!!identity.nationalityCode, "Nationality");
        need(!!nzfGroup, "Ethnic group");
        if (nzfGroup && nzfGroup.maxSelections > 0)
          need(identity.ethnicitySelectionIds.length >= nzfGroup.minSelections, `an ethnicity under ${nzfGroup.name}`);
        need(!!nzfAddress.street.trim(), "Street address");
        need(!!nzfAddress.suburb.trim(), "Suburb");
        need(!!nzfAddress.city.trim(), "City or town");
        need(!!nzfAddress.region.trim(), "Region");
        need(!!nzfAddress.postcode.trim(), "Postcode");
        need(!!nzfAddress.country, "Country");
      }
    }
    if (stepName === "Parent") {
      need(!!parentFirst.trim(), "Parent first name");
      need(!!parentLast.trim(), "Parent last name");
      need(!!parentPhone.trim(), "Parent phone");
    }
    if (stepName === "Children") need(validChildren.length > 0, "at least one child with a first name");
    if (stepName === "Sessions") need(items.length > 0, "at least one session");
    if (stepName === "Payment") {
      // 🔴 A typed price that cannot be applied is NEVER ignored. This is the
      // exact failure Olga hit: she entered $135, Apply accepted it, and the
      // registration was written at $30 with nothing said.
      if (agreedCents != null && priceProblem) out.push(priceProblem);
      if (isPaid) {
        need(!!method, "how they paid");
        need(paidCents > 0, "the amount taken");
      }
    }
    return out;
  };

  const canNextStep = () => {
    if (stepName === "Who") return whoChoice === "new" || (whoChoice === "existing" && !!pickedKey);
    if (stepName === STEP_ONE) {
      if (!selectedProgramId) return false;
      if (shape === "academy") return !!optionId && !!academyData?.quote;
      return true;
    }
    if (stepName === "Family") {
      const basics = !!(parentFirst.trim() && parentLast.trim() && parentEmail.trim().includes("@") &&
        parentPhone.trim() && playerFirst.trim() && playerLast.trim() && /^\d{4}-\d{2}-\d{2}$/.test(playerDob));
      return basics && nzfStepOk;
    }
    if (stepName === "Parent") return !!(parentFirst.trim() && parentLast.trim() && parentPhone.trim());
    if (stepName === "Children") return validChildren.length > 0;
    if (stepName === "Sessions") return items.length > 0;
    if (stepName === "Payment") {
      // A price that cannot be applied blocks the save whether or not money
      // changed hands — the number on the registration has to be the number
      // the person at the counter meant.
      if (agreedCents != null && priceProblem) return false;
      if (!isPaid) return true;
      return !!method && paidCents > 0;
    }
    return true;
  };

  if (!open) return null;

  const staffName = (id: number | null) => {
    const s = (staff || []).find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "—";
  };

  return (
    // Overlay scrolls and the card is m-auto: centred when it fits, top-anchored
    // when it doesn't. `items-center` would clip the top of a tall form off a
    // 1366×768 laptop, unreachably — which is exactly how the UP Management
    // modal broke on Dima's Windows machine.
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex p-3 sm:p-4 overflow-y-auto"
      onClick={() => {
        // Olga, 2026-08-18, item 7: "If you click outside the form by accident,
        // you are losing everything." It did — the backdrop called close(),
        // which calls resetForm(). A half-filled walk-up registration is five
        // minutes of a parent's time standing at the counter.
        if (isDirty) setConfirmDiscard(true); else close();
      }}
      data-testid="modal-register-player"
    >
      {/* NO overflow-hidden on this card. It would become the containing block
          for the sticky footer below, which then sticks to the bottom of the
          CARD instead of the scrollport — putting the primary action off-screen
          on any viewport shorter than the form. Corners are rounded on the
          header and footer instead, exactly as ModalShell does it. */}
      <div
        className="relative w-full max-w-3xl m-auto flex flex-col rounded-2xl border border-blue-500/[0.15]"
        style={{ background: "linear-gradient(135deg, hsl(214 60% 97%) 0%, hsl(var(--card)) 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {confirmDiscard && (
          <div
            className="absolute inset-0 z-30 rounded-2xl flex items-center justify-center p-6"
            style={{ background: "hsl(var(--background) / 0.92)" }}
            onClick={(e) => e.stopPropagation()}
            data-testid="confirm-discard"
          >
            <div className="max-w-sm text-center">
              <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto mb-3" />
              <p className="text-[15px] font-semibold text-foreground/90">Throw this registration away?</p>
              <p className="text-[13px] text-foreground/60 mt-1.5 leading-snug">
                You've entered details that haven't been saved. Closing now loses all of them.
              </p>
              <div className="flex gap-2 justify-center mt-4">
                <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)} data-testid="button-keep-editing">
                  Keep editing
                </Button>
                <Button size="sm" onClick={close} className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-discard">
                  Discard it
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-500/[0.08] sticky top-0 z-10 rounded-t-2xl" style={{ background: "hsl(var(--background))" }}>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-white/80">Register at the office</h3>
            <p className="text-[11px] text-white/55 mt-0.5">Walk-up registration — records how they paid and who served them</p>
          </div>
          <button onClick={() => { if (isDirty) setConfirmDiscard(true); else close(); }} className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors shrink-0" data-testid="button-close-register">
            <X className="w-3.5 h-3.5 text-white/40" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 py-3 border-b border-blue-500/[0.06] overflow-x-auto">
          {STEPS.map((label, i) => (
            <Fragment key={label}>
              {i > 0 && <ChevronRight className="w-3 h-3 text-white/15 shrink-0" />}
              <span className={`text-[11px] whitespace-nowrap px-2 py-1 rounded-md transition-colors ${
                i === step ? "text-white bg-blue-500/25 border border-blue-500/40 font-medium"
                : i < step ? "text-white/65" : "text-white/40"
              }`}>{label}</span>
            </Fragment>
          ))}
        </div>

        <div className="px-5 py-5 space-y-4 min-w-0">
          {/* ── Who: first time with us? ─────────────────────────────────── */}
          {stepName === "Who" && (
            <div className="space-y-4" data-testid="step-who">
              <p className="text-[13px] text-foreground/70">
                Is this their first time with us?
              </p>
              {/* 🔴 Two big buttons, in the order the conversation at the counter
                  actually goes. Daniel, 2026-09-21: "they come in and say would
                  like to register they select program/programs first then next
                  step is 'is this your first time with us' then select with big
                  buttons existing player or new player." */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setWhoChoice("existing"); }}
                  className={`text-left rounded-2xl border p-4 transition-colors cursor-pointer ${
                    whoChoice === "existing"
                      ? "border-blue-500/60 bg-blue-500/10"
                      : "border-border bg-muted/30 hover:bg-muted/60"}`}
                  data-testid="button-who-existing"
                >
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-blue-500" />
                    <span className="text-[15px] font-semibold text-foreground/90">Existing player</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    They've been with us before. Find them and everything fills in.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => { setWhoChoice("new"); setPickedKey(null); setStep(step + 1); }}
                  className={`text-left rounded-2xl border p-4 transition-colors cursor-pointer ${
                    whoChoice === "new"
                      ? "border-blue-500/60 bg-blue-500/10"
                      : "border-border bg-muted/30 hover:bg-muted/60"}`}
                  data-testid="button-who-new"
                >
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-500" />
                    <span className="text-[15px] font-semibold text-foreground/90">New player</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    First time here. The full form — longer, but it's what NZ Football needs.
                  </p>
                </button>
              </div>

              {whoChoice === "existing" && (
                <ExistingPersonSearch
                  onPick={(key, label) => {
                    // The full record, not the search row: the list carries a
                    // name and a parent's NAME only. Everything else — gender,
                    // school, allergies, the parent's email and phone, the NZF
                    // identity — comes from the person endpoint.
                    loadAndApply(key, label);
                  }}
                />
              )}
              {whoChoice === "existing" && pickedKey && (
                <>
                  <p className="text-[12px] text-emerald-600 dark:text-emerald-400" data-testid="text-who-picked">
                    ✓ {pickedLabel} filled in.
                  </p>
                  {detailsPreview({
                    onEdit: () => { setEditingDetails(true); setStep(step + 1); },
                    editLabel: "Edit details",
                  })}
                </>
              )}
            </div>
          )}

          {/* ── Programme ────────────────────────────────────────────────── */}
          {stepName === STEP_ONE && (
            <div className="space-y-4">
              <div className="space-y-2">
                {programmes.length === 0 && (
                  <div className="px-4 py-6 rounded-xl bg-muted/40 border border-border text-center">
                    <p className="text-[13px] text-white/70">
                      {scope === "camp"
                        ? "No holiday camps are set up in this workspace yet."
                        : scope === "academy"
                          ? "No academy programmes in this workspace yet."
                          : "No programmes in this workspace yet."}
                    </p>
                    <p className="text-[11.5px] text-white/45 mt-1">
                      {scope === "camp"
                        ? "Create a camp first, then register players against it."
                        : "Create one first, then register players against it."}
                    </p>
                  </div>
                )}
                {programmes.map((p) => (
                  <button
                    key={`${p.type}-${p.id}`}
                    onClick={() => { setSelectedProgramId(p.id); setOptionId(null); setTermId(null); setItems([]); setAmountTouched(false); }}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors min-w-0 ${
                      selectedProgramId === p.id
                        ? "bg-blue-500/10 border-blue-500/30"
                        : "bg-background border-input hover:bg-muted"
                    }`}
                    data-testid={`option-programme-${p.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-[13.5px] text-white/95 break-words min-w-0 font-medium">{p.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="text-[10px] border-white/20 text-white/65">
                          {p.type === "academy" ? "Academy" : "Camp"}
                        </Badge>
                        {p.type === "academy" && p.registrationOpen === false && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/25 text-amber-300/70 gap-1">
                            <Lock className="w-2.5 h-2.5" />Invite only
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {shape === "academy" && (
                <div className="space-y-3 pt-1">
                  {quoting && <p className="text-[12px] text-white/40 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Pricing…</p>}

                  {academyData?.programme.registrationOpen === false && (
                    <div className="flex gap-2 px-3 py-2.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/20">
                      <Lock className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
                      <p className="text-[11.5px] text-amber-200/70 leading-snug min-w-0">
                        This programme is invite-only — it isn't sold on the website. Registering here is deliberate.
                      </p>
                    </div>
                  )}

                  {(academyData?.options.length ?? 0) > 0 && (
                    <Field label="Age group / option" required>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {academyData!.options.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => { setOptionId(o.id); setAmountTouched(false); }}
                            className={`px-3 py-2.5 rounded-lg border text-left transition-colors min-w-0 ${
                              optionId === o.id ? "bg-blue-500/10 border-blue-500/30" : "bg-background border-input hover:bg-muted"
                            }`}
                            data-testid={`option-academy-${o.id}`}
                          >
                            <div className="text-[13px] text-white/95 break-words font-medium">{o.name}</div>
                            <div className="text-[12px] text-white/65 mt-0.5">{formatCurrency(o.fullPriceCents, { fromCents: true })} / term</div>
                          </button>
                        ))}
                      </div>
                    </Field>
                  )}

                  {/* ── Which term ───────────────────────────────────────────
                      Daniel, 2026-09-10: "make sure here in register at office
                      manual rego it shows the term 4 full price or the term 3
                      pro rata what's remaining price so that the guys in the
                      office can still track those too."

                      Today Term 3 is running past its full-price weeks (so it
                      costs its remaining sessions) and Term 4 is open at the
                      full fee. Both are real sales at the counter, and the one
                      chosen is STORED on the registration — otherwise the roll
                      cannot tell this term's players from next term's.

                      🔴 Every price here comes from the server, priced by the
                      same function as the public checkout. The browser never
                      works one out. */}
                  {plan === "term" && (academyData?.terms?.length ?? 0) > 0 && (
                    <Field label="Which term" required>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {academyData!.terms.map((t) => {
                          const selected = (termId ?? academyData!.term?.id ?? null) === t.id;
                          // 🔴 Finished is the TERM's own state, never "we have
                          // no price". Technification sells two age groups, so
                          // nothing prices until one is picked — and reading
                          // that as finished told the counter Term 4 was over
                          // three weeks before it started.
                          const finished = t.ended;
                          return (
                            <button
                              key={t.id}
                              disabled={finished}
                              onClick={() => { if (!finished) { setTermId(t.id); setAmountTouched(false); } }}
                              className={`px-3 py-2.5 rounded-lg border text-left transition-colors min-w-0 ${
                                finished
                                  ? "bg-muted/30 border-input opacity-55 cursor-not-allowed"
                                  : selected
                                    ? "bg-blue-500/10 border-blue-500/30"
                                    : "bg-background border-input hover:bg-muted"
                              }`}
                              data-testid={`option-term-${t.id}`}
                            >
                              <div className="flex items-center justify-between gap-2 min-w-0">
                                <span className="text-[13px] text-white/95 font-medium break-words min-w-0">
                                  {t.name} {t.year}
                                </span>
                                {t.isProgrammeTerm && (
                                  <Badge variant="outline" className="text-[9.5px] shrink-0 border-blue-400/25 text-blue-200/70">
                                    Now selling
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-white/45 mt-0.5">
                                {formatDate(t.startDate)} – {formatDate(t.endDate)}
                              </div>
                              <div className="text-[12px] mt-1 min-w-0">
                                {finished ? (
                                  <span className="text-white/40">Finished — nothing left to sell</span>
                                ) : t.totalCents == null ? (
                                  <span className="text-white/45">Pick an age group above to price this term</span>
                                ) : (
                                  <>
                                    <span className="text-white/85 font-medium">
                                      {formatCurrency(t.totalCents, { fromCents: true })}
                                    </span>
                                    {t.sessionsRemaining != null && t.sessionsTotal != null && (
                                      <span className="text-white/45">
                                        {" · "}
                                        {t.sessionsRemaining === t.sessionsTotal
                                          ? `full term, ${t.sessionsTotal} sessions`
                                          : `pro rata · ${t.sessionsRemaining} of ${t.sessionsTotal} sessions left`}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  )}

                  {academyData?.allowFullYear && (
                    <Field label="Payment plan">
                      <div className="flex gap-2">
                        {(["term", "year"] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => { setPlan(p); setAmountTouched(false); }}
                            className={`px-3 py-2 rounded-lg border text-[12px] transition-colors ${
                              plan === p ? "bg-blue-500/10 border-blue-500/30 text-white/85" : "bg-background border-input text-foreground"
                            }`}
                          >
                            {p === "term" ? "This term" : "Full year (5% off)"}
                          </button>
                        ))}
                      </div>
                    </Field>
                  )}

                  {academyData?.quote && (
                    <div className="px-4 py-3 rounded-xl bg-muted/40 border border-border space-y-1.5">
                      {academyData.quote.discountCents > 0 && (
                        <>
                          <div className="flex justify-between text-[12px] text-white/45">
                            <span>Full {plan === "year" ? "year" : "term"}</span>
                            <span>{formatCurrency(academyData.quote.subtotalCents, { fromCents: true })}</span>
                          </div>
                          <div className="flex justify-between text-[12px] text-emerald-300/70">
                            <span className="min-w-0 break-words pr-2">{academyData.quote.reason || "Discount"}</span>
                            <span className="shrink-0">−{formatCurrency(academyData.quote.discountCents, { fromCents: true })}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between text-[14px] font-semibold text-white/90 pt-1 border-t border-white/[0.06]">
                        <span>Owing today</span>
                        <span>{formatCurrency(academyData.quote.totalCents, { fromCents: true })}</span>
                      </div>
                      {academyData.term && (
                        <p className="text-[11px] text-white/50 pt-0.5">
                          {academyData.term.name} {academyData.term.year} · {formatDate(academyData.term.startDate)} – {formatDate(academyData.term.endDate)}
                          {academyData.quote.sessionsRemaining != null && academyData.quote.totalSessions != null &&
                            ` · ${academyData.quote.sessionsRemaining} of ${academyData.quote.totalSessions} sessions left`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Academy: family ──────────────────────────────────────────── */}
          {stepName === "Family" && (
            <>
              {showPreview && detailsPreview({ onEdit: () => setEditingDetails(true) })}
              {/* The form stays mounted underneath — its state IS the preview —
                  so validation keeps running and the pencil simply reveals it. */}
            <div className={showPreview ? "hidden" : "space-y-6"}>
              {/* Olga, 2026-08-18, items 1 + 2: "change player and guardian
                  (because it's player profile)" and "organize all fields in a
                  more logical way. Player: name, DOB, gender....etc. then
                  parent, emergency/second parent/guardian details."

                  So: the PLAYER leads — this record is a player's profile and
                  the person in front of her is registering a child. The parent
                  follows. Emergency contact was sitting INSIDE the player block
                  between School and Allergies, which is why she asked what it
                  even meant; it is a second adult, so it is now its own group
                  and says so. */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Baby className="w-4 h-4 text-blue-400/70" />
                  <span className={SECTION}>Player</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="First name" required>
                    <Input value={playerFirst} onChange={(e) => setPlayerFirst(e.target.value)} className={FIELD} data-testid="input-player-first" />
                  </Field>
                  <Field label="Last name" required>
                    <Input value={playerLast} onChange={(e) => setPlayerLast(e.target.value)} className={FIELD} data-testid="input-player-last" />
                  </Field>
                  <Field label="Date of birth" required hint={dobHint}>
                    {/* fromYear/toYear switch the calendar caption to year +
                        month dropdowns. Without them the picker only has
                        month arrows, so entering a six-year-old's birthday
                        means ~70 clicks — hopeless with a parent waiting. */}
                    <DatePickerInput
                      value={playerDob}
                      onChange={(e) => setPlayerDob(e.target.value)}
                      max={nzToday}
                      fromYear={thisYear - 25}
                      toYear={thisYear}
                      placeholder="Pick the player's date of birth"
                      className={FIELD}
                      data-testid="input-player-dob"
                    />
                  </Field>
                  <Field label="Gender">
                    {/* shadcn, not a bare <select>: the standing rule is that
                        every control is drawn by us. A native select paints its
                        options with the OS panel, which is what made the NZF
                        pickers read as empty on Olga's Windows machine. */}
                    <Select value={playerGender || "—"} onValueChange={(v) => setPlayerGender(v === "—" ? "" : v)}>
                      <SelectTrigger className={FIELD} data-testid="select-player-gender">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="—">—</SelectItem>
                        {GENDERS.map((g) => <SelectItem key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="School">
                    <Input value={playerSchool} onChange={(e) => setPlayerSchool(e.target.value)} className={FIELD} />
                  </Field>
                  <Field label="Allergies">
                    <Input value={allergies} onChange={(e) => setAllergies(e.target.value)} className={FIELD} />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Medical notes">
                    <Input value={medicalNotes} onChange={(e) => setMedicalNotes(e.target.value)} className={FIELD} />
                  </Field>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <User className="w-4 h-4 text-blue-400/70" />
                  <span className={SECTION}>Parent / guardian</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="First name" required>
                    <Input value={parentFirst} onChange={(e) => setParentFirst(e.target.value)} className={FIELD} data-testid="input-parent-first" />
                  </Field>
                  <Field label="Last name" required>
                    <Input value={parentLast} onChange={(e) => setParentLast(e.target.value)} className={FIELD} data-testid="input-parent-last" />
                  </Field>
                  <Field label="Email" required hint="How we match them to a family already on file — without it we create a duplicate parent.">
                    <Input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} className={FIELD} data-testid="input-parent-email" />
                  </Field>
                  <Field label="Phone" required>
                    <Input type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className={FIELD} data-testid="input-parent-phone" />
                  </Field>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-4 h-4 text-blue-400/70" />
                  <span className={SECTION}>Emergency contact</span>
                </div>
                <p className="text-[12px] text-foreground/55 mb-3 leading-snug">
                  A second adult to ring if the parent above can't be reached — the other parent, a grandparent, whoever they nominate.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Name">
                    <Input value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} className={FIELD} data-testid="input-emergency-contact" />
                  </Field>
                  <Field label="Phone">
                    <Input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={FIELD} data-testid="input-emergency-phone" />
                  </Field>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={SECTION}>New Zealand Football details</span>
                </div>
                <p className="text-[11px] text-white/50 mb-3 leading-snug">
                  New Zealand Football needs all of these to register the player. Ask the parent now if you can —
                  if they can't answer, tick the skip below and we'll follow up. Never guess an answer.
                </p>

                {!deferIdentity && (
                  <div className="space-y-4">
                    <NzfIdentityFields
                      value={identity}
                      onChange={setIdentity}
                      countries={NZF_COUNTRIES as any}
                      groups={NZF_ETHNICITY_GROUPS as any}
                      theme={NZF_THEME}
                    />
                    <NzfAddressFields
                      value={nzfAddress}
                      onChange={setNzfAddress}
                      countries={NZF_COUNTRIES as any}
                      regions={NZ_REGIONS}
                      theme={NZF_THEME}
                    />
                  </div>
                )}

                <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deferIdentity}
                    onChange={(e) => setDeferIdentity(e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 rounded"
                    data-testid="checkbox-defer-nzf"
                  />
                  <span className="text-[12px] text-white/75 leading-snug">
                    The parent can't give these right now — skip and follow up.
                    <span className="block text-white/45">Payment still goes through. The player goes on the NZF follow-up list.</span>
                  </span>
                </label>

                {deferIdentity && (
                  <div className="mt-3 space-y-3 rounded-md p-3" style={{ background: "rgba(255,193,7,0.06)", border: "1px solid rgba(255,193,7,0.25)" }}>
                    <Field label="Why" required>
                      {/* shadcn, not a bare <select> — the same standing rule the
                          Gender picker above already follows, and the same reason:
                          a native select paints its options with the OS panel, so
                          this control looks different on Olga's Windows machine
                          from everyone's Mac. It was the last bare select left in
                          the form staff use every day. */}
                      <Select value={deferReason || undefined} onValueChange={setDeferReason}>
                        <SelectTrigger className={FIELD} data-testid="select-defer-reason">
                          <SelectValue placeholder="Choose a reason…" />
                        </SelectTrigger>
                        <SelectContent>
                          {IDENTITY_DEFER_REASONS.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={deferReason === "Other" ? "Note (required)" : "Note (optional)"}>
                      <Input
                        value={deferNote}
                        onChange={(e) => setDeferNote(e.target.value)}
                        placeholder="Anything that helps whoever follows up"
                        className={FIELD}
                        data-testid="input-defer-note"
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>
            </>
          )}

          {/* ── Camp: parent ─────────────────────────────────────────────── */}
          {stepName === "Parent" && (
            <>
              {showPreview && detailsPreview({ onEdit: () => setEditingDetails(true) })}
              {/* The form stays mounted underneath — its state IS the preview —
                  so validation keeps running and the pencil simply reveals it. */}
            <div className={showPreview ? "hidden" : "space-y-3"}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="First name" required><Input value={parentFirst} onChange={(e) => setParentFirst(e.target.value)} className={FIELD} data-testid="input-parent-first" /></Field>
              <Field label="Last name" required><Input value={parentLast} onChange={(e) => setParentLast(e.target.value)} className={FIELD} data-testid="input-parent-last" /></Field>
              <Field label="Email"><Input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} className={FIELD} data-testid="input-parent-email" /></Field>
              <Field label="Phone" required><Input type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className={FIELD} data-testid="input-parent-phone" /></Field>
              <Field label="Emergency contact"><Input value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} className={FIELD} /></Field>
              <Field label="Emergency phone"><Input type="tel" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={FIELD} /></Field>
            </div>
            </div>
            </>
          )}

          {/* ── Camp: children ───────────────────────────────────────────── */}
          {stepName === "Children" && (
            <div className="space-y-3">
              {children.map((c, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.10] space-y-3 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] text-white/65">Child {idx + 1}</span>
                    {children.length > 1 && (
                      <button onClick={() => removeChild(idx)} className="text-white/30 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="First name" required><Input value={c.firstName} onChange={(e) => updateChild(idx, "firstName", e.target.value)} className={FIELD} /></Field>
                    <Field label="Last name"><Input value={c.lastName} onChange={(e) => updateChild(idx, "lastName", e.target.value)} className={FIELD} /></Field>
                    <Field label="Date of birth">
                      <DatePickerInput
                        value={c.dateOfBirth}
                        onChange={(e) => updateChild(idx, "dateOfBirth", e.target.value)}
                        max={nzToday}
                        fromYear={thisYear - 25}
                        toYear={thisYear}
                        className={FIELD}
                        data-testid={`input-child-dob-${idx}`}
                      />
                    </Field>
                    <Field label="Allergies"><Input value={c.allergies} onChange={(e) => updateChild(idx, "allergies", e.target.value)} className={FIELD} /></Field>
                  </div>
                  <label className="flex items-center gap-2 text-[12px] text-white/60">
                    <input type="checkbox" checked={c.epiPen} onChange={(e) => updateChild(idx, "epiPen", e.target.checked)} className="accent-blue-500" />
                    Carries an EpiPen
                  </label>
                  <Field label="Medical notes"><Input value={c.medicalNotes} onChange={(e) => updateChild(idx, "medicalNotes", e.target.value)} className={FIELD} /></Field>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={addChild} className="text-white/60"><Plus className="w-3.5 h-3.5 mr-1" />Add another child</Button>
            </div>
          )}

          {/* ── Camp: sessions ───────────────────────────────────────────── */}
          {stepName === "Sessions" && (
            <div className="space-y-2">
              {dates.length === 0 && <p className="text-[12px] text-white/40">This camp has no dates set up yet.</p>}
              {dates.map((d: any) => (
                <div key={d.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.10] min-w-0">
                  <div className="text-[12.5px] text-white/85 mb-2 font-medium">{formatDate(d.date)}</div>
                  <div className="flex flex-wrap gap-2">
                    {pricing.map((p: any) => {
                      const active = items.some((i) => i.campDateId === d.id && i.productType === p.productType);
                      return (
                        <button
                          key={p.productType}
                          onClick={() => toggleItem(d.id, p.productType)}
                          className={`px-3 py-1.5 rounded-lg border text-[11.5px] transition-colors ${
                            active ? "bg-blue-500/15 border-blue-500/30 text-white/85" : "bg-background border-input text-foreground"
                          }`}
                        >
                          {formatProductType(p.productType)} · {formatCurrency(p.priceCents, { fromCents: true })}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Payment ──────────────────────────────────────────────────── */}
          {stepName === "Payment" && (
            <div className="space-y-4">
              <div className="px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.10]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-foreground/70">Total owing</span>
                  <div className="flex items-center gap-2">
                    {/* Only strike the quote out when the agreed price REPLACED
                        it. Keyed on `priceApplies`, not on the typed value —
                        otherwise an unusable entry struck out a price that was
                        still the one being charged. */}
                    {priceApplies && agreedCents !== listTotalCents && (
                      <span className="text-[13px] text-foreground/45 line-through">
                        {formatCurrency(listTotalCents, { fromCents: true })}
                      </span>
                    )}
                    <span className="text-[17px] font-semibold text-foreground/90" data-testid="text-total-owing">
                      {formatCurrency(totalCents, { fromCents: true })}
                    </span>
                  </div>
                </div>
                {/* Olga, item 6: "Payment page. I don't have option to change
                    price." A reason is required — that reason is what answers
                    "why is this one $135" months later. 🔴 The ceiling is the
                    programme's PUBLISHED fee, not today's pro-rated quote:
                    measuring against the quote is what silently threw away the
                    $135 she typed on 15 September. */}
                {!editingPrice ? (
                  <button
                    onClick={() => setEditingPrice(true)}
                    className="text-[12.5px] text-blue-600 hover:underline mt-1"
                    data-testid="button-adjust-price"
                  >
                    {agreedCents != null ? "Change the agreed price" : "Agree a different price"}
                  </button>
                ) : (
                  <div className="mt-3 pt-3 border-t border-white/[0.10] grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label="Agreed price"
                      hint={
                        priceCeilingCents !== listTotalCents
                          ? `This term quotes ${formatCurrency(listTotalCents, { fromCents: true })} (pro-rated). You can charge anything up to the programme's full fee of ${formatCurrency(priceCeilingCents, { fromCents: true })}.`
                          : `The programme's fee is ${formatCurrency(priceCeilingCents, { fromCents: true })}. You can't go above it.`
                      }
                    >
                      <MoneyInput value={priceOverride} onChange={setPriceOverride} className={FIELD} data-testid="input-agreed-price" />
                    </Field>
                    <Field label="Why" required hint="Goes on the registration so the figure can be explained later.">
                      <Input value={priceReason} onChange={(e) => setPriceReason(e.target.value)} className={FIELD} placeholder="Sibling discount, hardship, part term…" data-testid="input-price-reason" />
                    </Field>
                    <div className="sm:col-span-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setPriceOverride(""); setPriceReason(""); setEditingPrice(false); }} data-testid="button-price-cancel">
                        Use the programme's price
                      </Button>
                      {/* 🔴 Apply is refused while the price cannot be used. It
                          used to accept anything and then collapse the panel,
                          taking the warning with it and leaving the quote in
                          place — which is how a $135 registration was written
                          at $30 with nobody told. */}
                      <Button
                        size="sm"
                        onClick={() => setEditingPrice(false)}
                        disabled={agreedCents == null || !!priceProblem}
                        data-testid="button-price-apply"
                      >
                        Apply
                      </Button>
                    </div>
                    {agreedCents != null && priceProblem && (
                      <p className="sm:col-span-2 text-[12.5px] text-red-600" data-testid="text-price-problem">
                        {priceProblem}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {fromRegister && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px]" data-testid="pos-paid-at-register">
                  Payment is taken at the register once this is saved — the registration is created unpaid and confirmed when the sale is paid.
                </div>
              )}
              <div className={`flex gap-2 ${fromRegister ? "hidden" : ""}`}>
                <button
                  onClick={() => setIsPaid(true)}
                  className={`flex-1 px-3 py-2.5 rounded-lg border text-[12px] transition-colors ${isPaid ? "bg-emerald-500/10 border-emerald-500/30 text-white/85" : "bg-background border-input text-foreground"}`}
                  data-testid="button-paid-yes"
                >Paid now</button>
                <button
                  onClick={() => setIsPaid(false)}
                  className={`flex-1 px-3 py-2.5 rounded-lg border text-[12px] transition-colors ${!isPaid ? "bg-amber-500/10 border-amber-500/30 text-white/85" : "bg-background border-input text-foreground"}`}
                  data-testid="button-paid-no"
                >Not paid yet</button>
              </div>

              {isPaid ? (
                <>
                  <Field label="How did they pay?" required>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {OFFICE_PAYMENT_METHODS.map((m) => (
                        <button
                          key={m.value}
                          onClick={() => setMethod(m.value)}
                          className={`px-2 py-2.5 rounded-lg border text-[12px] transition-colors min-w-0 break-words ${
                            method === m.value ? "bg-blue-500/10 border-blue-500/30 text-white/85" : "bg-background border-input text-foreground"
                          }`}
                          data-testid={`button-method-${m.value}`}
                        >{m.label}</button>
                      ))}
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Amount taken" required>
                      <MoneyInput
                        value={amountDollars}
                        onChange={(v) => { setAmountDollars(v); setAmountTouched(true); }}
                        className={FIELD}
                        data-testid="input-amount-paid"
                      />
                    </Field>
                    <Field label="Reference" hint="EFTPOS terminal ref, receipt number, bank particulars — whatever you'll match this against.">
                      <Input value={reference} onChange={(e) => setReference(e.target.value)} className={FIELD} data-testid="input-payment-reference" />
                    </Field>
                  </div>

                  {isShortPayment && (
                    <div className="flex gap-2 px-3 py-2.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
                      <p className="text-[11.5px] text-amber-200/70 leading-snug min-w-0">
                        That's {formatCurrency(totalCents - paidCents, { fromCents: true })} short of the total. The registration
                        will be saved as <strong>pending</strong> until the balance is paid.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-white/60 leading-snug">
                  Saved as pending — no money recorded. Come back and mark it paid when they settle up.
                </p>
              )}

              <Field label="Served by" hint="Who took this registration at the counter.">
                <select
                  value={servedById ?? ""}
                  onChange={(e) => setServedById(e.target.value ? Number(e.target.value) : null)}
                  className={`w-full h-10 rounded-md px-3 text-sm ${FIELD} border`}
                  data-testid="select-served-by"
                >
                  <option value="">— not recorded —</option>
                  {(staff || []).map((s) => (
                    <option key={s.id} value={s.id} className="bg-background text-foreground">{s.firstName} {s.lastName}</option>
                  ))}
                </select>
              </Field>

              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this one" className={FIELD} />
              </Field>

              {shape === "academy" && (
                <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] cursor-pointer">
                  <input type="checkbox" checked={policyAccepted} onChange={(e) => setPolicyAccepted(e.target.checked)} className="accent-blue-500 mt-0.5" data-testid="checkbox-policy" />
                  <span className="text-[12px] text-white/75 leading-snug min-w-0">
                    The parent confirmed they accept the academy policy and NZF registration terms.
                    Leave unticked if they haven't — it's recorded as evidence, so it must be true.
                  </span>
                </label>
              )}
            </div>
          )}

          {/* ── Confirm ──────────────────────────────────────────────────── */}
          {stepName === "Confirm" && (
            <div className="space-y-3">
              {/* What this visit has already put through, so the counter can see
                  the whole transaction rather than the line in front of them. */}
              {linesDone.length > 0 && (
                <div className="px-4 py-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 space-y-1" data-testid="visit-lines">
                  <p className="text-[12px] uppercase tracking-wide text-emerald-300/70 font-semibold">
                    Already saved this visit
                  </p>
                  {linesDone.map((l) => (
                    <p key={l.id} className="text-[12.5px] text-foreground/75">
                      #{l.id} · {l.programme} · {formatCurrency(l.totalCents, { fromCents: true })}
                    </p>
                  ))}
                  <p className="text-[11.5px] text-muted-foreground pt-0.5">
                    All recorded as one transaction with what you're about to save.
                  </p>
                </div>
              )}

              {/* 🔴 The multi-programme path. Ticking this keeps the family and
                  the visit's transaction and returns to the programme picker,
                  instead of making the operator re-enter a family who is
                  standing at the counter. */}
              <label className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-blue-500/[0.05] border border-blue-500/20 cursor-pointer" data-testid="label-add-another">
                <input
                  type="checkbox"
                  checked={addAnother}
                  onChange={(e) => setAddAnother(e.target.checked)}
                  className="mt-0.5 cursor-pointer"
                  data-testid="checkbox-add-another"
                />
                <span className="min-w-0">
                  <span className="text-[13px] text-foreground/85 block">They're signing up for another programme too</span>
                  <span className="text-[11.5px] text-muted-foreground block">
                    Saves this one, keeps their details, and goes back to pick the next.
                  </span>
                </span>
              </label>

              <div className="px-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.10] space-y-2.5 min-w-0">
                <Row label="Programme" value={programme?.name ?? "—"} />
                {shape === "academy" && (
                  <>
                    <Row label="Option" value={academyData?.options.find((o) => o.id === optionId)?.name ?? "—"} />
                    <Row label="Player" value={`${playerFirst} ${playerLast}`.trim() || "—"} />
                    <Row label="Parent" value={`${parentFirst} ${parentLast}`.trim() || "—"} />
                  </>
                )}
                {shape === "camp" && (
                  <>
                    <Row label="Parent" value={`${parentFirst} ${parentLast}`.trim() || "—"} />
                    <Row label="Children" value={validChildren.map((c) => c.firstName).join(", ") || "—"} />
                    <Row label="Sessions" value={`${items.length} per child`} />
                  </>
                )}
                <div className="pt-2 border-t border-white/[0.06] space-y-2.5">
                  <Row label="Total" value={formatCurrency(totalCents, { fromCents: true })} strong />
                  <Row
                    label="Payment"
                    value={isPaid
                      ? `${OFFICE_PAYMENT_METHODS.find((m) => m.value === method)?.label} — ${formatCurrency(paidCents, { fromCents: true })}`
                      : "Not paid yet"}
                  />
                  {reference && <Row label="Reference" value={reference} />}
                  <Row label="Served by" value={staffName(servedById)} />
                  <Row
                    label="Status"
                    value={isPaid && paidCents >= totalCents && totalCents > 0 ? "Confirmed" : "Pending"}
                  />
                </div>
              </div>

              {ackAgeWarning && (
                <div className="flex gap-2 px-3 py-2.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
                  <p className="text-[11.5px] text-amber-200/70 leading-snug min-w-0">
                    This player's age sits outside the programme's advertised band. Saving again will register them anyway.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky so Save is always reachable on a short laptop screen. */}
        <div className="sticky bottom-0 z-10 rounded-b-2xl" style={{ background: "hsl(var(--background))" }}>
          {/* 🔴 IN THE FLOW, not `absolute bottom-full`.
              It used to float above the footer over the scrolling form, and at
              10% opacity you read it and the form underneath at the same time —
              on the NZF step, where the list runs to a dozen field names and
              wraps to three lines, it landed straight on top of the "skip and
              follow up" checkbox and both were unreadable. Daniel: "I think the
              transparency is causing readability issues here." The transparency
              was the symptom; overlapping was the cause. Now it sits inside the
              sticky block, so the footer grows and the form scrolls clear of it,
              and it is opaque so nothing can bleed through regardless. */}
          {showErrors && missingForStep().length > 0 && (
            <div
              className="mx-5 mt-3 px-3 py-2.5 rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/40"
              data-testid="banner-missing-fields"
            >
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[13px] text-foreground leading-snug min-w-0">
                  Still needed before you can go on:{" "}
                  <span className="font-medium">{missingForStep().join(", ")}</span>
                </p>
              </div>
            </div>
          )}
          <div className="px-5 py-4 border-t border-blue-500/[0.08] flex items-center justify-between gap-2">
          <Button
            size="sm" variant="ghost"
            onClick={() => (step === 0 ? (isDirty ? setConfirmDiscard(true) : close()) : setStep(step - 1))}
            className="text-white/50"
            data-testid="button-back"
          >
            {step === 0 ? "Cancel" : <><ChevronLeft className="w-3.5 h-3.5 mr-1" />Back</>}
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              size="sm"
              onClick={() => {
                // Never silently dead. Either it moves, or it tells her why not.
                if (canNextStep()) { setShowErrors(false); setStep(step + 1); }
                else setShowErrors(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-next"
            >
              Next<ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => registerMutation.mutate()}
              disabled={registerMutation.isPending || totalCents <= 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-submit-registration"
            >
              {registerMutation.isPending
                ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Saving…</>
                : <><CheckCircle className="w-3.5 h-3.5 mr-1" />Create registration</>}
            </Button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-[11.5px] text-white/40 shrink-0">{label}</span>
      <span className={`text-[12.5px] text-right break-words min-w-0 ${strong ? "font-semibold text-white/90" : "text-white/75"}`}>{value}</span>
    </div>
  );
}
