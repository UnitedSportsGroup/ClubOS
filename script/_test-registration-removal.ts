// Pure rules for removing a registration — npx tsx script/_test-registration-removal.ts
import { removalBlocker, reasonProblem } from "../shared/registration-removal";
let fail = 0;
const t = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; };
t("office EFTPOS entry may be removed", removalBlocker({ status: "confirmed", stripePaymentIntentId: null, posSaleId: null }) === null);
t("abandoned online checkout may be removed", removalBlocker({ status: "pending", stripePaymentIntentId: "pi_x" }) === null);
t("PAID online card registration is refused", removalBlocker({ status: "confirmed", stripePaymentIntentId: "pi_x" }) !== null);
t("partly refunded card registration is refused", removalBlocker({ status: "partially_refunded", stripePaymentIntentId: "pi_x" }) !== null);
t("fully refunded card registration may be removed", removalBlocker({ status: "refunded", stripePaymentIntentId: "pi_x" }) === null);
t("till sale is refused", removalBlocker({ status: "confirmed", posSaleId: 12 }) !== null);
t("already removed is refused", removalBlocker({ status: "removed" }) !== null);
t("blank reason refused", reasonProblem("  ") !== null);
t("missing reason refused", reasonProblem(undefined) !== null);
t("real reason accepted", reasonProblem("Entered twice by mistake") === null);
t("over-long reason refused", reasonProblem("x".repeat(501)) !== null);
process.exit(fail ? 1 : 0);
