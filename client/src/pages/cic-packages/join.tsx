// A player joins their team's CIC 2027 package: join.cicyouth.com/cic-join/<token>.
// One link for the whole squad; registering gives each player their OWN page
// (cic-player/<token>) where they pay their share and add extras.
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { DobInput } from "@/components/ui/dob-input";
import { Button, Card, Field, Loading, NotFoundPage, Notice, TeampayShell, inputStyle } from "../teampay/shell";
import { API, api, brand, money } from "./common";

export default function CicPackageJoinPage() {
  const [, params] = useRoute("/cic-join/:token");
  const token = params?.token || "";
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["cic-pkg-join", token], queryFn: () => api(`${API}/join/${token}`), retry: false,
  });
  const [f, setF] = useState({ firstName: "", lastName: "", dateOfBirth: "", guardianName: "", guardianEmail: "", guardianPhone: "", medical: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isLoading) return <TeampayShell brand={brand}><Loading brand={brand} /></TeampayShell>;
  if ((error as any)?.notFound || !data) return <NotFoundPage brand={brand} />;
  const j = data;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ready = f.firstName.trim() && f.lastName.trim() && f.dateOfBirth && f.guardianName.trim() && /.+@.+\..+/.test(f.guardianEmail) && f.guardianPhone.trim().length >= 6;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api(`${API}/join/${token}`, { method: "POST", body: JSON.stringify(f) });
      window.location.href = r.url;
    } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  const inp = inputStyle(brand);

  return (
    <TeampayShell brand={brand} eyebrow={`CIC 2027 · ${j.ageGroup} · ${j.dates}`} title={`Join ${j.teamName || j.clubName}`}>
      <div className="space-y-5">
        <Card brand={brand} className="p-5 text-[14px] leading-relaxed" style={{ color: brand.mute }}>
          Your team is booked for the Christchurch International Cup ({j.packageName}). Register below, then you can pay your share
          {j.playerShareCents > 0 ? ` (${money(j.playerShareCents)})` : ""} and add extras like a merch pack, more Victoria Foods meals and Christchurch attractions.
          {j.spotsLeft <= 3 && j.spotsLeft > 0 && <span className="mt-2 block" style={{ color: brand.ink }}>{j.spotsLeft} of {j.squad} places left.</span>}
        </Card>
        {j.spotsLeft === 0 ? (
          <Notice brand={brand} tone="warn">Every place in this squad is taken. Ask your team manager.</Notice>
        ) : (
          <form onSubmit={submit}>
            <Card brand={brand} className="space-y-4 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field brand={brand} label="Player's first name"><input style={inp} value={f.firstName} onChange={set("firstName")} autoComplete="given-name" required /></Field>
                <Field brand={brand} label="Player's last name"><input style={inp} value={f.lastName} onChange={set("lastName")} autoComplete="family-name" required /></Field>
              </div>
              <Field brand={brand} label="Player's date of birth">
                <DobInput value={f.dateOfBirth} onChange={set("dateOfBirth")} tone="dark" unstyled inputStyle={inp}
                  labelStyle={{ color: brand.mute, fontSize: 12 }} />
              </Field>
              <Field brand={brand} label="Parent or guardian"><input style={inp} value={f.guardianName} onChange={set("guardianName")} autoComplete="name" required /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field brand={brand} label="Their email"><input style={inp} type="email" inputMode="email" value={f.guardianEmail} onChange={set("guardianEmail")} autoComplete="email" required /></Field>
                <Field brand={brand} label="Their mobile"><input style={inp} type="tel" inputMode="tel" value={f.guardianPhone} onChange={set("guardianPhone")} autoComplete="tel" required /></Field>
              </div>
              <Field brand={brand} label="Allergies or medical notes" hint="Optional. Shared only with the team manager and tournament staff.">
                <textarea style={{ ...inp, minHeight: 88 }} value={f.medical} onChange={set("medical")} />
              </Field>
              {err && <Notice brand={brand} tone="error">{err}</Notice>}
              <Button brand={brand} type="submit" className="w-full" disabled={!ready || busy}>
                {busy && <Loader2 size={16} className="mr-2 animate-spin" />} Register
              </Button>
            </Card>
          </form>
        )}
      </div>
    </TeampayShell>
  );
}
