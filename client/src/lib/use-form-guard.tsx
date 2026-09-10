// Anti-spam companion to a public ClubOS form's POST. The gate itself lives
// server-side (server/form-guard.ts) — this only supplies the two things it
// looks for on the request body: a signed form token (proves the page was
// open long enough for a person to fill it in) and an untouched honeypot
// field. Deliberately fail-soft: if the token request fails, the form still
// submits — the server holds a tokenless submission for review rather than
// refusing it, so a guest on a flaky connection never loses their enquiry.

import { useCallback, useEffect, useId, useRef, useState } from "react";

export function useFormGuard() {
  const [token, setToken] = useState<string | null>(null);
  const pot = useRef<HTMLInputElement | null>(null);
  const potId = useId();

  useEffect(() => {
    let live = true;
    fetch("/api/public/form-token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { token?: string } | null) => {
        if (live && d?.token) setToken(d.token);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // 🔴 The honeypot value is READ, not assumed empty. Defaulting to "" here
  // would hand every bot a pass — exactly the bug this field exists to catch.
  const payload = useCallback(
    () => ({ formToken: token, website: pot.current?.value ?? "" }),
    [token],
  );

  /* The honeypot. Not `display:none` — some bots skip hidden inputs. Off-screen,
   * untabbable, hidden from assistive tech, autocomplete off so a browser never
   * fills it in for a real person. */
  const Fields = (
    <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
      <label htmlFor={potId}>Leave this field empty</label>
      <input ref={pot} id={potId} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );

  return { payload, Fields };
}
