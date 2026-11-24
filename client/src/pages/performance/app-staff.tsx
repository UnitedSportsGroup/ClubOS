import { useState } from "react";
import { Field, FormError, Panel, Pick, Pill, SaveButton, TableWrap, control, niceDay, send, td, th, usePerfQuery, useSaver } from "./ui";

// Who has a STAFF login to the SIU Performance app (coach, physio, performance).
// They sign in with their email and see the squad, never the check-in form.
interface StaffRow { id: number; name: string; email: string; role: string; notify: boolean; state: "invited" | "active" | "disabled"; lastSignIn: string | null; phones: number }
const ROLE_WORD: Record<string, string> = { coach: "Coach", physio: "Physio", performance: "Performance staff" };
const input = `${control} w-full rounded-md border border-border bg-background px-3 text-sm`;

export function AppStaffPanel() {
  const q = usePerfQuery<{ staff: StaffRow[] }>("app-staff", "/app-staff");
  const save = useSaver();
  const [first, setFirst] = useState(""); const [last, setLast] = useState(""); const [email, setEmail] = useState("");
  const [role, setRole] = useState("coach"); const [notify, setNotify] = useState(true);
  const add = () => save.run(async () => {
    const r = await send("POST", "/app-staff", { firstName: first, lastName: last, email, role, notify });
    setFirst(""); setLast(""); setEmail("");
    return r.emailed ? "Added. We've emailed them a link to set a password." : "Added, but the email did not send. Use Send link again.";
  });
  const patch = (id: number, body: Record<string, unknown>) => save.run(async () => { await send("PATCH", `/app-staff/${id}`, body); });
  const staff = q.data?.staff ?? [];
  return (
    <Panel title="Staff with the app" note="Coaches and medical staff sign in to the SIU Performance app with their email and see the squad. They never fill in a check-in.">
      {staff.length === 0 ? <p className="text-sm text-muted-foreground">No staff logins yet. Add the first one below.</p> : (
        <TableWrap>
          <table className="w-full" data-testid="perf-app-staff">
            <thead><tr>{["Name", "Role", "Login", "Told when a player reports something", "Last sign-in", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className={td}><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.email}</div></td>
                  <td className={td}>{ROLE_WORD[s.role] ?? s.role}</td>
                  <td className={td}><Pill tone={s.state === "active" ? "green" : s.state === "invited" ? "amber" : "red"}>{s.state === "active" ? "Active" : s.state === "invited" ? "Invited, no password yet" : "Disabled"}</Pill></td>
                  <td className={td}>
                    <label className="inline-flex items-center gap-2 min-h-[44px] md:min-h-0 text-sm">
                      <input type="checkbox" className="h-4 w-4" checked={s.notify} disabled={save.busy || s.state === "disabled"} onChange={(e) => patch(s.id, { notify: e.target.checked })} />
                      {s.notify ? `Email${s.phones ? " and phone" : ""}` : "Off"}
                    </label>
                  </td>
                  <td className={td}><span className="text-xs text-muted-foreground">{s.lastSignIn ? niceDay(String(s.lastSignIn).slice(0, 10), true) : "—"}</span></td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-2">
                      {s.state !== "disabled" && <button type="button" disabled={save.busy} className={`${control} px-3 rounded-md border border-border text-sm`}
                        onClick={() => save.run(async () => { const r = await send("POST", `/app-staff/${s.id}/invite`); return r.emailed ? "Link sent." : "The email did not send."; })}>Send link again</button>}
                      <button type="button" disabled={save.busy} className={`${control} px-3 rounded-md border border-border text-sm`} onClick={() => patch(s.id, { disabled: s.state !== "disabled" })}>{s.state === "disabled" ? "Turn back on" : "Turn off"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <Field label="First name"><input className={input} value={first} onChange={(e) => setFirst(e.target.value)} data-testid="staff-first" /></Field>
        <Field label="Last name"><input className={input} value={last} onChange={(e) => setLast(e.target.value)} /></Field>
        <Field label="Email"><input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="staff-email" /></Field>
        <Field label="Role"><Pick value={role} onChange={setRole} options={Object.entries(ROLE_WORD).map(([value, label]) => ({ value, label }))} /></Field>
        <SaveButton busy={save.busy} onClick={add} disabled={!first.trim() || !email.trim()}>Add and email a link</SaveButton>
      </div>
      <label className="mt-3 inline-flex items-center gap-2 min-h-[44px] md:min-h-0 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Tell them by email (and on their phone) when a player reports an illness, a sore area or anything else
      </label>
      <FormError error={save.error} />
      {save.done && <p className="mt-2 text-sm text-emerald-700">{save.done}</p>}
    </Panel>
  );
}
