/**
 * Send the REAL CUGC free-session confirmation email (the same function the live booking
 * form calls) to named staff addresses, clearly marked as a test. Written 30 Oct 2026 after
 * every confirmation named the day before the class.
 *
 * It does NOT book anything: no cugc_free_sessions row, no staff heads-up, no Meta lead event.
 *
 *   npx tsx --env-file=.env script/_send-cugc-free-session-test.ts info@cugc.co.nz daniel@cufc.co.nz
 */
import { sendCugcFreeSessionConfirmation, cugcSessionDateLabel } from "../server/email";

const to = process.argv.slice(2);
if (!to.length) { console.error("usage: … <email> [email…]"); process.exit(1); }

// The exact booking Natalia's screenshot showed: GymBasics, Thursday 4:00–5:30pm, 29 Oct.
const sessionDate = "2026-10-29";
const label = cugcSessionDateLabel(sessionDate);
if (label !== "Thursday, 29 October") { console.error(`date label wrong: ${label}`); process.exit(1); }

(async () => {
  let ok = 0;
  for (const addr of to) {
    const sent = await sendCugcFreeSessionConfirmation({
      to: addr,
      parentName: "Test Parent",
      childName: "TEST — please ignore",
      programName: "GymBasics",
      sessionLabel: "Thursday 4:00–5:30pm",
      sessionDate,
    });
    console.log(`${sent ? "sent" : "FAILED"} → ${addr} (Date row reads "${label}")`);
    if (sent) ok++;
  }
  process.exit(ok === to.length ? 0 : 1);
})();
