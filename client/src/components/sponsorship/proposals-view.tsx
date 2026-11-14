/**
 * USG → Sponsorship → Prospects → Proposals & contracts (2026-11-14).
 *
 * Build a sponsor's proposal from a form, send them the page, and when they
 * accept, send the Sponsorship Agreement for signature. Signing it makes the
 * Partner and its contract.
 *
 * Data: /api/admin/sponsorship/proposals (server/sponsor-proposals.ts).
 * Rules: shared/sponsor-proposals.ts — what a proposal may hold, what stops it
 * being sent, where it is up to (worked out, never stored).
 * The contract itself is made by e-Sign's own from-template route.
 *
 * The open proposal lives in the URL (#prospects-proposals/<id>), so Back
 * returns to the list and a proposal can be linked to.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { centsToDollarInput, dollarInputToCents } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle, Archive, ArrowLeft, Check, CheckCircle2, Copy, ExternalLink, Eye, FileSignature, Loader2, Plus, Send, Trash2, Upload,
} from "lucide-react";
import {
  PROPOSAL_BRANDS, STAGE_LABEL, audienceFor, dollars, longDay, proposalHeadline,
  type AudienceStat, type ProposalAsset, type ProposalBrandKey, type ProposalRow, type ProposalStage,
} from "@shared/sponsor-proposals";

const API = "/api/admin/sponsorship/proposals";
const HASH = "#prospects-proposals";

type Board = {
  today: string;
  proposals: ProposalRow[];
  audience: AudienceStat[];
  standardBenefits: string[];
  templates: Record<string, { id: number; name: string; published: boolean } | null>;
};

type Form = {
  brand: ProposalBrandKey;
  sponsorCompany: string;
  sponsorLegalName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  logoUrl: string | null;
  logoGround: "light" | "dark" | null;
  partnershipTitle: string;
  seasonLabel: string;
  intro: string;
  assets: { name: string; detail: string; price: string }[];
  benefits: string[];
  audienceKeys: string[];
  termStart: string;
  termEnd: string;
  fee: string;
  paymentTerms: string;
  contra: string;
  specialConditions: string;
};

const formOf = (p: ProposalRow): Form => ({
  brand: p.brand,
  sponsorCompany: p.sponsorCompany,
  sponsorLegalName: p.sponsorLegalName ?? "",
  contactName: p.contactName ?? "",
  contactEmail: p.contactEmail ?? "",
  contactPhone: p.contactPhone ?? "",
  logoUrl: p.logoUrl,
  logoGround: p.logoGround,
  partnershipTitle: p.partnershipTitle,
  seasonLabel: p.seasonLabel ?? "",
  intro: p.intro ?? "",
  assets: p.assets.map((a) => ({ name: a.name, detail: a.detail, price: a.priceCents == null ? "" : centsToDollarInput(a.priceCents) })),
  benefits: p.benefits,
  audienceKeys: p.audienceKeys,
  termStart: p.termStart ?? "",
  termEnd: p.termEnd ?? "",
  fee: p.feeCents == null ? "" : centsToDollarInput(p.feeCents),
  paymentTerms: p.paymentTerms ?? "",
  contra: p.contra ?? "",
  specialConditions: p.specialConditions ?? "",
});

const bodyOf = (f: Form) => ({
  ...f,
  assets: f.assets.map((a): ProposalAsset => ({ name: a.name, detail: a.detail, priceCents: a.price.trim() === "" ? null : dollarInputToCents(a.price) })),
  feeCents: f.fee.trim() === "" ? null : dollarInputToCents(f.fee),
});

const STAGE_TONE: Record<ProposalStage, string> = {
  draft: "bg-white/[0.06] text-white/70 border-white/[0.12]",
  sent: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  opened: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  accepted: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  contract_out: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  signed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  withdrawn: "bg-white/[0.06] text-white/50 border-white/[0.12]",
  archived: "bg-white/[0.06] text-white/50 border-white/[0.12]",
};

function StageBadge({ stage }: { stage: ProposalStage }) {
  return <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${STAGE_TONE[stage]}`} data-testid="proposal-stage">{STAGE_LABEL[stage]}</span>;
}

function LogoTile({ company, logoUrl, ground, big }: { company: string; logoUrl: string | null; ground: "light" | "dark" | null; big?: boolean }) {
  const dim = big ? "w-20 h-20 rounded-xl p-2" : "w-10 h-10 rounded-lg p-1";
  const initials = company.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  if (!logoUrl) return <span className={`${dim} shrink-0 bg-amber-500/10 text-amber-300 font-semibold flex items-center justify-center ${big ? "text-lg" : "text-[11px]"}`} title="No logo yet">{initials || "?"}</span>;
  // The navy tile is the blue-900 TOKEN: the light-theme generator turns a dark hex into a white panel.
  return <img src={logoUrl} alt={`${company} logo`} className={`${dim} shrink-0 object-contain ${ground === "dark" ? "bg-blue-900" : "bg-white border border-black/10"}`} />;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "Pacific/Auckland" }) : "");

async function send(method: string, url: string, body?: unknown) {
  const r = await workspaceFetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.message || `Could not save (${r.status})`), { problems: j?.problems as string[] | undefined });
  return j;
}

const openIdFromHash = (): number | null => {
  const m = /^#prospects-proposals\/(\d+)/.exec(typeof window === "undefined" ? "" : window.location.hash);
  return m ? Number(m[1]) : null;
};

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-[12px] font-semibold text-white/70 mb-1">
      {children}{hint && <span className="font-normal text-white/40"> · {hint}</span>}
    </label>
  );
}

function Section({ title, sub, children, testid }: { title: string; sub?: string; children: React.ReactNode; testid?: string }) {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5 min-w-0" data-testid={testid}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {sub && <p className="text-[12.5px] text-white/50 mt-0.5">{sub}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

// ── New proposal ────────────────────────────────────────────────────────────

function NewDialog({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: (p: ProposalRow) => void }) {
  const { toast } = useToast();
  const [company, setCompany] = useState("");
  const [brand, setBrand] = useState<ProposalBrandKey>("siu");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCompany(""); setBrand("siu"); } }, [open]);
  const make = async () => {
    setBusy(true);
    try { onMade(await send("POST", API, { sponsorCompany: company, brand })); }
    catch (e: any) { toast({ title: "Could not create it", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="proposal-new-dialog">
        <DialogHeader>
          <DialogTitle>New proposal</DialogTitle>
          <DialogDescription>Start with who it is for and which club. Everything else is filled in on the next screen.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 min-w-0">
          <div>
            <Label>Sponsor</Label>
            <Input className="h-11" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Business name" autoFocus data-testid="proposal-new-company" />
          </div>
          <div>
            <Label>Club</Label>
            <Select value={brand} onValueChange={(v) => setBrand(v as ProposalBrandKey)}>
              <SelectTrigger className="h-11" data-testid="proposal-new-brand"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(PROPOSAL_BRANDS).map((b) => <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={make} disabled={busy || company.trim().length < 2} data-testid="proposal-new-create">{busy ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Send the contract ───────────────────────────────────────────────────────

type ContractPlan = {
  template: { id: number; name: string; published: boolean } | null;
  variables: Record<string, string>;
  signerName: string;
  signerEmail: string;
  acceptedEmail: string | null;
  problems: string[];
  summary: { sponsor: string; term: string; fee: string };
};

function ContractDialog({ proposal, onClose, onSent }: { proposal: ProposalRow | null; onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<ContractPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const id = proposal?.id ?? null;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setPlan(null); setError(null);
    send("GET", `${API}/${id}/contract`).then((p: ContractPlan) => { if (alive) { setPlan(p); setName(p.signerName); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  const go = async () => {
    if (!plan?.template || !proposal) return;
    setBusy(true);
    try {
      // e-Sign makes the agreement from its own template and emails the first signer (us).
      const doc = await send("POST", "/api/admin/esign/from-template", {
        templateId: plan.template.id, variables: plan.variables, signerName: name.trim() || plan.signerName, signerEmail: plan.signerEmail, send: true,
      });
      try { await send("POST", `${API}/${proposal.id}/contract`, { esignDocumentId: doc.id }); }
      catch (e: any) { throw new Error(`The agreement was created in e-Sign (document ${doc.id}) but could not be linked here: ${e.message}`); }
      toast({ title: "Agreement sent for signature", description: "Check your email: you sign first, then it goes to the sponsor." });
      onSent();
    } catch (e: any) {
      toast({ title: "Could not send the agreement", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={Boolean(proposal)} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg" data-testid="proposal-contract-dialog">
        <DialogHeader>
          <DialogTitle>Send the Sponsorship Agreement</DialogTitle>
          <DialogDescription>The club's standard agreement, filled in from this proposal. You sign first; the sponsor gets it once you have.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 overflow-hidden space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!plan && !error && <Skeleton className="h-32 w-full" />}
          {plan && (
            <>
              <dl className="rounded-lg border border-white/[0.08] divide-y divide-white/[0.06] text-sm">
                {[["Sponsor", plan.summary.sponsor], ["Term", plan.summary.term || "Not set"], ["Fee", plan.summary.fee || "Not set"], ["Paid", plan.variables.payment_schedule || "Not set"], ["Goes to", plan.signerEmail || "No email yet"]].map(([k, v]) => (
                  <div key={k} className="flex gap-3 px-3 py-2">
                    <dt className="w-20 shrink-0 text-white/50">{k}</dt>
                    <dd className="min-w-0 break-words text-white">{v}</dd>
                  </div>
                ))}
              </dl>
              {plan.acceptedEmail && plan.signerEmail && plan.acceptedEmail !== plan.signerEmail && (
                <p className="text-[12.5px] text-amber-400 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>The person who accepted typed <strong>{plan.acceptedEmail}</strong>. The agreement goes to the contact email on the proposal, {plan.signerEmail}.</span></p>
              )}
              <div>
                <Label>Name of the person signing for the sponsor</Label>
                <Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} data-testid="proposal-contract-signer" />
              </div>
              {plan.problems.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3" data-testid="proposal-contract-problems">
                  <p className="text-sm font-semibold text-amber-400">Before this can be sent</p>
                  <ul className="mt-1.5 space-y-1 text-[13px] text-white/80 list-disc pl-5">{plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={go} disabled={busy || !plan || plan.problems.length > 0} data-testid="proposal-contract-send">
            {busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</> : <><FileSignature className="w-4 h-4 mr-1.5" />Create and send for signature</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── One proposal ────────────────────────────────────────────────────────────

function Editor({ proposal, board, onBack, refresh }: { proposal: ProposalRow; board: Board; onBack: () => void; refresh: () => Promise<unknown> }) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => formOf(proposal));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [contractFor, setContractFor] = useState<ProposalRow | null>(null);
  const [newBenefit, setNewBenefit] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const latest = useRef(form);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  const locked = Boolean(proposal.acceptedAt) || Boolean(proposal.esignDocumentId) || proposal.stage === "archived";
  const brand = PROPOSAL_BRANDS[form.brand];
  const audience = useMemo(() => audienceFor(form.brand), [form.brand]);

  const save = async () => {
    if (!dirty.current || locked) return;
    dirty.current = false;
    setSaveState("saving");
    try {
      await send("PATCH", `${API}/${proposal.id}`, bodyOf(latest.current));
      setSaveState("saved"); setSaveError(null);
      await refresh();
    } catch (e: any) {
      dirty.current = true;
      setSaveState("error"); setSaveError([e.message, ...(e.problems ?? [])].join(" "));
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Saves as you go, and once more on the way out, so a click away loses nothing.
  const change = (patch: Partial<Form>) => {
    if (locked) return;
    setForm((f) => { const next = { ...f, ...patch }; latest.current = next; return next; });
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void saveRef.current(); }, 800);
  };
  useEffect(() => {
    const flush = () => { if (timer.current) window.clearTimeout(timer.current); void saveRef.current(); };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      if (timer.current) window.clearTimeout(timer.current);
      await saveRef.current();
      await fn();
      await refresh();
      if (done) toast({ title: done });
    } catch (e: any) {
      toast({ title: "That did not work", description: [e.message, ...(e.problems ?? [])].join(" "), variant: "destructive" });
    } finally { setBusy(null); }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setBusy("logo");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await workspaceFetch(`${API}/logo`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || "Upload failed");
      change({ logoUrl: j.url, logoGround: form.logoGround ?? "light" });
    } catch (e: any) {
      toast({ title: "Could not use that picture", description: e.message, variant: "destructive" });
    } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(proposal.url); toast({ title: "Link copied" }); }
    catch { toast({ title: "Copy it from here", description: proposal.url }); }
  };

  const head = proposalHeadline({ partnershipTitle: form.partnershipTitle, brand: form.brand });
  const live = Boolean(proposal.publishedAt) && !proposal.withdrawnAt && proposal.stage !== "archived";
  const previewUrl = `/proposal/${proposal.token}?preview=1`;
  const template = board.templates[form.brand];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto" data-testid="proposal-editor">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white min-h-[44px]" data-testid="proposal-back">
        <ArrowLeft className="w-4 h-4" />Proposals &amp; contracts
      </button>

      <div className="mt-2 flex items-start gap-4 flex-wrap">
        <LogoTile company={form.sponsorCompany} logoUrl={form.logoUrl} ground={form.logoGround} big />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-white break-words">{form.sponsorCompany || "New proposal"}</h2>
          <p className="text-sm text-white/55 break-words">{head.before} {head.key} {head.after}</p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <StageBadge stage={proposal.stage} />
            <span className="text-[12px] text-white/45" data-testid="proposal-save-state">
              {locked ? "Locked" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : "Saves as you type"}
            </span>
          </div>
        </div>
      </div>
      {saveState === "error" && saveError && <p className="mt-3 text-sm text-red-400" data-testid="proposal-save-error">{saveError}</p>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* What to do next sits first on a phone. */}
        <div className="space-y-4 lg:order-2 min-w-0">
          <Section title="Send it" testid="proposal-send">
            {proposal.publishProblems.length > 0 && !live && (
              <ul className="text-[13px] text-amber-400 space-y-1" data-testid="proposal-publish-problems">
                {proposal.publishProblems.map((p) => <li key={p} className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{p}</span></li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="min-h-[40px]">
                <a href={previewUrl} target="_blank" rel="noreferrer" data-testid="proposal-preview"><Eye className="w-4 h-4 mr-1.5" />Preview</a>
              </Button>
              {!live && proposal.stage !== "archived" && (
                <Button size="sm" className="min-h-[40px]" disabled={busy !== null || proposal.publishProblems.length > 0} onClick={() => act("publish", () => send("POST", `${API}/${proposal.id}/publish`), "The link is live")} data-testid="proposal-publish">
                  <Send className="w-4 h-4 mr-1.5" />{proposal.publishedAt ? "Make the link live again" : "Make the link live"}
                </Button>
              )}
              {live && (
                <Button size="sm" className="min-h-[40px]" onClick={copyLink} data-testid="proposal-copy"><Copy className="w-4 h-4 mr-1.5" />Copy link</Button>
              )}
            </div>
            {live ? (
              <>
                <p className="text-[12.5px] text-white/55 break-all" data-testid="proposal-url">{proposal.url}</p>
                <p className="text-[12.5px] text-white/50">Send this link to {form.contactName || "the sponsor"} yourself, by email or message. Only people with the link can open it.</p>
                <p className="text-[12.5px] text-white/70" data-testid="proposal-opens">
                  {proposal.opens ? `Opened ${proposal.opens} time${proposal.opens === 1 ? "" : "s"} by ${proposal.visitors} ${proposal.visitors === 1 ? "person" : "people"}, last on ${when(proposal.lastOpenedAt)}.` : "Not opened yet."}
                  <span className="text-white/40"> Staff looking at it are not counted.</span>
                </p>
                {!proposal.acceptedAt && !proposal.esignDocumentId && (
                  <button type="button" className="text-[12.5px] text-white/50 underline min-h-[32px]" disabled={busy !== null} onClick={() => act("withdraw", () => send("POST", `${API}/${proposal.id}/withdraw`), "The link is switched off")} data-testid="proposal-withdraw">Switch the link off</button>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-white/50">{proposal.withdrawnAt ? "The link is switched off. Anyone opening it sees that it is not available." : "Nobody outside the club can open it until you make the link live."}</p>
            )}
          </Section>

          <Section title="Contract" testid="proposal-contract">
            {proposal.acceptedAt ? (
              <p className="text-[13px] text-white/80 flex gap-2" data-testid="proposal-accepted">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                <span><strong>{proposal.acceptedName}</strong>{proposal.acceptedRole ? `, ${proposal.acceptedRole},` : ""} accepted on {when(proposal.acceptedAt)} ({proposal.acceptedEmail}).</span>
              </p>
            ) : (
              <p className="text-[12.5px] text-white/50">Not accepted on the page yet. If they said yes another way, you can still send the contract.</p>
            )}
            {proposal.acceptedHeld && <p className="text-[12.5px] text-amber-400 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>This acceptance looked automated, so nobody was emailed about it. Check with the sponsor before sending a contract.</span></p>}

            {proposal.stage === "signed" ? (
              <div className="space-y-2">
                <p className="text-[13px] text-emerald-400 font-semibold flex gap-2"><Check className="w-4 h-4 shrink-0 mt-0.5" />Signed by both parties.</p>
                <div className="flex flex-wrap gap-2">
                  {proposal.partnerId && <Button asChild size="sm" variant="outline" className="min-h-[40px]"><a href={`#partners/${proposal.partnerId}`} data-testid="proposal-open-partner">Open the partner</a></Button>}
                  <Button asChild size="sm" variant="outline" className="min-h-[40px]"><a href={`/api/admin/esign/${proposal.esignDocumentId}/signed.pdf`} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4 mr-1.5" />Signed PDF</a></Button>
                </div>
              </div>
            ) : proposal.esignDocumentId ? (
              <div className="space-y-2">
                <p className="text-[13px] text-white/80">The agreement is out for signature. You sign first from the email e-Sign sent you; the sponsor is emailed once you have.</p>
                <Button asChild size="sm" variant="outline" className="min-h-[40px]"><a href="/admin/esign" data-testid="proposal-open-esign"><FileSignature className="w-4 h-4 mr-1.5" />Open e-Sign</a></Button>
              </div>
            ) : (
              <>
                <Button size="sm" className="min-h-[40px]" disabled={busy !== null || proposal.stage === "archived"} onClick={() => act("contract", async () => setContractFor(proposal))} data-testid="proposal-send-contract">
                  <FileSignature className="w-4 h-4 mr-1.5" />Send contract
                </Button>
                {!template && <p className="text-[12.5px] text-amber-400">There is no {brand.name} Sponsorship Agreement in e-Sign yet.</p>}
              </>
            )}
          </Section>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-h-[40px]" disabled={busy !== null} onClick={() => act("copy", async () => { const p: ProposalRow = await send("POST", `${API}/${proposal.id}/duplicate`); window.location.hash = `${HASH}/${p.id}`; }, "Copy made")} data-testid="proposal-duplicate">
              <Copy className="w-4 h-4 mr-1.5" />Make a copy
            </Button>
            {proposal.stage === "archived" ? (
              <Button size="sm" variant="outline" className="min-h-[40px]" disabled={busy !== null} onClick={() => act("restore", () => send("POST", `${API}/${proposal.id}/restore`), "Restored")}>Restore</Button>
            ) : (
              <Button size="sm" variant="outline" className="min-h-[40px]" disabled={busy !== null} onClick={() => act("archive", () => send("POST", `${API}/${proposal.id}/archive`), "Archived")} data-testid="proposal-archive">
                <Archive className="w-4 h-4 mr-1.5" />Archive
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:order-1 min-w-0">
          {locked && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-white/85" data-testid="proposal-locked">
              {proposal.stage === "archived" ? "This proposal is archived." : "This version has been accepted, so it cannot be changed."} Use Make a copy to change the terms.
            </p>
          )}

          <Section title="Who it is for">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Sponsor</Label><Input className="h-11" value={form.sponsorCompany} disabled={locked} onChange={(e) => change({ sponsorCompany: e.target.value })} data-testid="proposal-company" /></div>
              <div><Label hint="if different">Name on the contract</Label><Input className="h-11" value={form.sponsorLegalName} disabled={locked} onChange={(e) => change({ sponsorLegalName: e.target.value })} placeholder="e.g. Absolute Home Services Limited" /></div>
              <div><Label>Contact name</Label><Input className="h-11" value={form.contactName} disabled={locked} onChange={(e) => change({ contactName: e.target.value })} data-testid="proposal-contact-name" /></div>
              <div><Label hint="the contract goes here">Contact email</Label><Input className="h-11" type="email" inputMode="email" value={form.contactEmail} disabled={locked} onChange={(e) => change({ contactEmail: e.target.value })} data-testid="proposal-contact-email" /></div>
              <div><Label>Contact phone</Label><Input className="h-11" type="tel" inputMode="tel" value={form.contactPhone} disabled={locked} onChange={(e) => change({ contactPhone: e.target.value })} /></div>
              <div>
                <Label>Club</Label>
                <Select value={form.brand} disabled={locked} onValueChange={(v) => change({ brand: v as ProposalBrandKey, audienceKeys: [] })}>
                  <SelectTrigger className="h-11" data-testid="proposal-brand"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.values(PROPOSAL_BRANDS).map((b) => <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label hint="PNG with a clear background works best">Their logo</Label>
              <div className="flex items-center gap-3 flex-wrap">
                <LogoTile company={form.sponsorCompany} logoUrl={form.logoUrl} ground={form.logoGround} />
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => uploadLogo(e.target.files?.[0])} data-testid="proposal-logo-file" />
                <Button type="button" size="sm" variant="outline" className="min-h-[40px]" disabled={locked || busy === "logo"} onClick={() => fileRef.current?.click()}>
                  {busy === "logo" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}{form.logoUrl ? "Replace" : "Upload"}
                </Button>
                {form.logoUrl && (
                  <>
                    <div className="inline-flex rounded-lg border border-white/[0.1] overflow-hidden" role="group" aria-label="Logo artwork">
                      {([["light", "Dark or colour logo"], ["dark", "White logo"]] as const).map(([k, l]) => (
                        <button key={k} type="button" disabled={locked} onClick={() => change({ logoGround: k })} aria-pressed={form.logoGround === k}
                          className={`px-3 min-h-[40px] text-[12.5px] font-medium ${form.logoGround === k ? "bg-blue-600 text-white" : "text-white/70"}`} data-testid={`proposal-logo-ground-${k}`}>{l}</button>
                      ))}
                    </div>
                    <button type="button" disabled={locked} onClick={() => change({ logoUrl: null, logoGround: null })} className="text-[12.5px] text-white/50 underline min-h-[40px]">Remove</button>
                  </>
                )}
              </div>
            </div>
          </Section>

          <Section title="The offer" sub="The headline on their page is written from the partnership title.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Partnership title</Label><Input className="h-11" value={form.partnershipTitle} disabled={locked} onChange={(e) => change({ partnershipTitle: e.target.value })} placeholder="e.g. Official Shorts Partner" data-testid="proposal-title" /></div>
              <div><Label hint="optional">Season</Label><Input className="h-11" value={form.seasonLabel} disabled={locked} onChange={(e) => change({ seasonLabel: e.target.value })} placeholder="e.g. OFC Pro League · Season 2027" /></div>
            </div>
            <p className="rounded-lg border border-white/[0.08] px-3 py-2.5 text-[13px] text-white/75" data-testid="proposal-headline">
              Headline: {head.before} <strong className="text-white">{head.key}</strong> {head.after}
            </p>
            <div>
              <Label hint="optional, one or two plain sentences">Opening paragraph</Label>
              <Textarea rows={3} value={form.intro} disabled={locked} onChange={(e) => change({ intro: e.target.value })} placeholder="What is being proposed, in plain words." data-testid="proposal-intro" />
            </div>
            <div>
              <Label>What they are being offered</Label>
              <div className="space-y-3">
                {form.assets.map((a, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.08] p-3 space-y-2" data-testid="proposal-asset">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_44px]">
                      <Input className="h-11" value={a.name} disabled={locked} placeholder="e.g. Back of shorts, home and away kits" onChange={(e) => change({ assets: form.assets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} data-testid="proposal-asset-name" />
                      <MoneyInput className="h-11" value={a.price} disabled={locked} placeholder="Price (optional)" onChange={(v) => change({ assets: form.assets.map((x, j) => (j === i ? { ...x, price: v } : x)) })} />
                      <Button type="button" size="icon" variant="outline" className="h-11 w-11" disabled={locked} aria-label="Remove" onClick={() => change({ assets: form.assets.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                    <Textarea rows={2} value={a.detail} disabled={locked} placeholder="Detail: where it appears, on which kits, for how long." onChange={(e) => change({ assets: form.assets.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })} />
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" className="min-h-[40px]" disabled={locked || form.assets.length >= 12} onClick={() => change({ assets: [...form.assets, { name: "", detail: "", price: "" }] })} data-testid="proposal-asset-add"><Plus className="w-4 h-4 mr-1.5" />Add</Button>
              </div>
            </div>
          </Section>

          <Section title="What is included" sub="These go on their page and into Schedule A of the contract.">
            <div className="flex flex-wrap gap-2" data-testid="proposal-standard-benefits">
              {board.standardBenefits.map((b) => {
                const on = form.benefits.includes(b);
                return (
                  <button key={b} type="button" disabled={locked} aria-pressed={on} onClick={() => change({ benefits: on ? form.benefits.filter((x) => x !== b) : [...form.benefits, b] })}
                    className={`text-left text-[12.5px] px-3 py-2 min-h-[40px] rounded-lg border ${on ? "border-blue-500/50 bg-blue-500/10 text-white" : "border-white/[0.1] text-white/70"}`}>
                    {on && <Check className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}{b}
                  </button>
                );
              })}
            </div>
            {form.benefits.filter((b) => !board.standardBenefits.includes(b)).map((b) => (
              <div key={b} className="flex items-start gap-2 text-[13px] text-white/85">
                <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" /><span className="min-w-0 flex-1 break-words">{b}</span>
                <button type="button" disabled={locked} className="text-white/45 underline text-[12px] min-h-[32px]" onClick={() => change({ benefits: form.benefits.filter((x) => x !== b) })}>Remove</button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input className="h-11" value={newBenefit} disabled={locked} onChange={(e) => setNewBenefit(e.target.value)} placeholder="Something specific to this sponsor" data-testid="proposal-benefit-new"
                onKeyDown={(e) => { if (e.key === "Enter" && newBenefit.trim()) { e.preventDefault(); change({ benefits: [...form.benefits, newBenefit.trim()] }); setNewBenefit(""); } }} />
              <Button type="button" variant="outline" className="h-11" disabled={locked || !newBenefit.trim()} onClick={() => { change({ benefits: [...form.benefits, newBenefit.trim()] }); setNewBenefit(""); }}>Add</Button>
            </div>
          </Section>

          <Section title="Audience figures" sub="Tick the ones to show. Each comes with its source, and nothing else can be typed in here.">
            <div className="grid gap-2 sm:grid-cols-2" data-testid="proposal-audience">
              {audience.map((s) => {
                const on = form.audienceKeys.includes(s.key);
                return (
                  <button key={s.key} type="button" disabled={locked || (!on && form.audienceKeys.length >= 9)} aria-pressed={on}
                    onClick={() => change({ audienceKeys: on ? form.audienceKeys.filter((k) => k !== s.key) : [...form.audienceKeys, s.key] })}
                    className={`text-left px-3 py-2.5 rounded-lg border min-h-[56px] ${on ? "border-blue-500/50 bg-blue-500/10" : "border-white/[0.1]"}`} data-testid={`proposal-audience-${s.key}`}>
                    <span className="block text-sm font-semibold text-white">{s.value}</span>
                    <span className="block text-[12px] text-white/60">{s.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-white/45">Source shown on the page: {audience[0]?.source}.</p>
          </Section>

          <Section title="Terms" sub="Shown on their page as proposed terms, and used to fill in the contract.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>First day</Label><DatePickerInput className="h-11" value={form.termStart} disabled={locked} onChange={(e) => change({ termStart: e.target.value })} data-testid="proposal-term-start" /></div>
              <div><Label>Last day</Label><DatePickerInput className="h-11" value={form.termEnd} disabled={locked} min={form.termStart || undefined} onChange={(e) => change({ termEnd: e.target.value })} data-testid="proposal-term-end" /></div>
              <div><Label hint="excluding GST">Fee</Label><MoneyInput className="h-11" value={form.fee} disabled={locked} onChange={(v) => change({ fee: v })} data-testid="proposal-fee" /></div>
              <div><Label>When it is paid</Label><Input className="h-11" value={form.paymentTerms} disabled={locked} onChange={(e) => change({ paymentTerms: e.target.value })} placeholder="e.g. One payment on 20 January 2027" data-testid="proposal-payment" /></div>
            </div>
            <div><Label hint="optional">Contra</Label><Textarea rows={2} value={form.contra} disabled={locked} onChange={(e) => change({ contra: e.target.value })} placeholder="Goods or services instead of cash, if any." /></div>
            <div><Label hint="optional">Special conditions</Label><Textarea rows={2} value={form.specialConditions} disabled={locked} onChange={(e) => change({ specialConditions: e.target.value })} /></div>
            {form.termStart && form.termEnd && form.fee && (
              <p className="text-[12.5px] text-white/60" data-testid="proposal-terms-line">{longDay(form.termStart)} to {longDay(form.termEnd)} · {dollars(dollarInputToCents(form.fee))} plus GST</p>
            )}
          </Section>
        </div>
      </div>

      <ContractDialog proposal={contractFor} onClose={() => setContractFor(null)} onSent={async () => { setContractFor(null); await refresh(); }} />
    </div>
  );
}

// ── The list ────────────────────────────────────────────────────────────────

export function ProposalsView() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(() => openIdFromHash());
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onHash = () => setOpenId(openIdFromHash());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("popstate", onHash); };
  }, []);

  const { data, isLoading, error } = useQuery<Board>({
    queryKey: [API],
    queryFn: async () => {
      const r = await workspaceFetch(API);
      if (!r.ok) throw new Error(r.status === 404 ? "Proposals live in the United Sports Group workspace." : `Could not load (${r.status})`);
      return r.json();
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: [API] });

  // Opening pushes a history entry, so the browser's Back returns to the list.
  const open = (id: number) => { window.location.hash = `${HASH}/${id}`; };
  const back = () => { window.location.hash = HASH; };

  if (isLoading) return <div className="p-4 sm:p-6 space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (error || !data) return <div className="p-6 text-sm text-red-400" data-testid="proposals-error">{(error as Error)?.message || "Could not load proposals."}</div>;

  const current = openId ? data.proposals.find((p) => p.id === openId) : null;
  if (openId && current) return <Editor key={current.id} proposal={current} board={data} onBack={back} refresh={refresh} />;

  const rows = data.proposals.filter((p) => showArchived || p.stage !== "archived");
  const archived = data.proposals.length - data.proposals.filter((p) => p.stage !== "archived").length;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto" data-testid="proposals-view">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Proposals &amp; contracts</h2>
          <p className="text-sm text-white/55">Build a sponsor's proposal page, send the link, then send the agreement for signature.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="min-h-[44px]" data-testid="proposal-new"><Plus className="w-4 h-4 mr-1.5" />New proposal</Button>
      </div>

      {openId && !current && <p className="mt-4 text-sm text-amber-400">That proposal could not be found.</p>}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center" data-testid="proposals-empty">
          <p className="text-sm font-semibold text-white">No proposals yet</p>
          <p className="mt-1 text-sm text-white/55 max-w-md mx-auto">Create one for the next sponsor. You fill in who it is for, what they get and the price; ClubOS builds the page in the club's brand.</p>
          <Button onClick={() => setCreating(true)} className="mt-4 min-h-[44px]"><Plus className="w-4 h-4 mr-1.5" />New proposal</Button>
        </div>
      ) : (
        <ul className="mt-5 space-y-2" data-testid="proposals-list">
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => open(p.id)} className="w-full text-left rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] p-3 sm:p-4 flex items-center gap-3 min-w-0" data-testid={`proposal-row-${p.id}`}>
                <LogoTile company={p.sponsorCompany} logoUrl={p.logoUrl} ground={p.logoGround} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white break-words">{p.sponsorCompany}</span>
                  <span className="block text-[12.5px] text-white/55 break-words">
                    {PROPOSAL_BRANDS[p.brand].name}{p.partnershipTitle ? ` · ${p.partnershipTitle}` : ""}{p.feeCents != null ? ` · ${dollars(p.feeCents)} plus GST` : ""}
                  </span>
                  <span className="block text-[12px] text-white/40">
                    {p.acceptedAt ? `Accepted by ${p.acceptedName} on ${when(p.acceptedAt)}` : p.publishedAt ? (p.opens ? `Opened ${p.opens} time${p.opens === 1 ? "" : "s"}, last ${when(p.lastOpenedAt)}` : "Not opened yet") : `Started ${when(p.createdAt)}${p.createdByName ? ` by ${p.createdByName}` : ""}`}
                  </span>
                </span>
                <StageBadge stage={p.stage} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {archived > 0 && (
        <button type="button" onClick={() => setShowArchived((v) => !v)} className="mt-4 text-[12.5px] text-white/50 underline min-h-[40px]" data-testid="proposals-archived-toggle">
          {showArchived ? "Hide archived" : `Show archived (${archived})`}
        </button>
      )}

      <NewDialog open={creating} onClose={() => setCreating(false)} onMade={async (p) => { setCreating(false); await refresh(); open(p.id); }} />
    </div>
  );
}
