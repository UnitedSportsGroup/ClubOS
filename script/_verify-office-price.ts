/**
 * The agreed price a staff member records at the counter.
 *
 * Olga, 2026-09-15: "I entered price $135. But it's shown as $30."
 *
 * Every check below is the shape of a real registration taken at the CUFC
 * office, and #1–#4 are literally the two rows she wrote that afternoon. Run:
 *   npx tsx script/_verify-office-price.ts
 */
import { agreedPriceError, agreedPriceColumns, agreedPriceNote } from "../shared/office-price";

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// The two programmes Olga sold on 15 September, with the term nearly over.
const TECHNIFICATION = { fee: 15_000, quotedThatDay: 3_000 };   // $150 term, $30 pro-rated
const FUNINO         = { fee: 16_000, quotedThatDay: 3_200 };   // $160 term, $32 pro-rated

console.log("\nThe bug Olga reported");
{
  // 🔴 THE REGRESSION. Under the old rule this returned an error and the client
  // threw the number away without showing it.
  const err = agreedPriceError({ agreedCents: 13_500, listSubtotalCents: TECHNIFICATION.fee, reason: "Attended all term" });
  check("$135 on a $150 Technification term is ACCEPTED", err === null, err ?? "");

  const cols = agreedPriceColumns(13_500, TECHNIFICATION.fee);
  check("…and stores $150 subtotal / $15 discount / $135 total",
    cols.subtotalCents === 15_000 && cols.discountCents === 1_500 && cols.totalCents === 13_500,
    JSON.stringify(cols));
  check("…so subtotal − discount === total, exactly",
    cols.subtotalCents - cols.discountCents === cols.totalCents);
  check("…and the discount is never negative",
    cols.discountCents >= 0, String(cols.discountCents));
}

console.log("\nThe ceiling is the PUBLISHED FEE, not the pro-rated quote");
{
  check("a price above the quote but below the fee is fine ($100 of $150)",
    agreedPriceError({ agreedCents: 10_000, listSubtotalCents: TECHNIFICATION.fee, reason: "r" }) === null);
  check("exactly the fee is fine ($150 of $150)",
    agreedPriceError({ agreedCents: 15_000, listSubtotalCents: TECHNIFICATION.fee, reason: "r" }) === null);
  const over = agreedPriceError({ agreedCents: 15_001, listSubtotalCents: TECHNIFICATION.fee, reason: "r" });
  check("one cent above the fee is REFUSED", over !== null);
  check("…and the message names the real ceiling, not the quote",
    !!over && over.includes("$150.00") && !over.includes("$30.00"), over ?? "");
  check("the same holds for FUNiño at $160", 
    agreedPriceError({ agreedCents: 16_000, listSubtotalCents: FUNINO.fee, reason: "r" }) === null &&
    agreedPriceError({ agreedCents: 16_100, listSubtotalCents: FUNINO.fee, reason: "r" }) !== null);
}

console.log("\nWhat has to stay refused");
{
  check("a negative price", agreedPriceError({ agreedCents: -1, listSubtotalCents: 15_000, reason: "r" }) !== null);
  check("a fractional cent", agreedPriceError({ agreedCents: 100.5, listSubtotalCents: 15_000, reason: "r" }) !== null);
  check("NaN", agreedPriceError({ agreedCents: NaN, listSubtotalCents: 15_000, reason: "r" }) !== null);
  check("Infinity", agreedPriceError({ agreedCents: Infinity, listSubtotalCents: 15_000, reason: "r" }) !== null);
  check("a price with no reason", agreedPriceError({ agreedCents: 13_500, listSubtotalCents: 15_000, reason: "" }) !== null);
  check("a reason of only whitespace", agreedPriceError({ agreedCents: 13_500, listSubtotalCents: 15_000, reason: "   " }) !== null);
  // The order matters: an over-ceiling price is the more useful thing to say.
  const both = agreedPriceError({ agreedCents: 99_999, listSubtotalCents: 15_000, reason: "" });
  check("over-ceiling is reported before the missing reason", !!both && both.includes("$150.00"), both ?? "");
}

console.log("\nZero, and blank — different things");
{
  check("a blank box is NOT an error (it means: charge the programme's price)",
    agreedPriceError({ agreedCents: null, listSubtotalCents: 15_000, reason: "" }) === null);
  check("$0 with a reason is allowed (a scholarship place is a real thing)",
    agreedPriceError({ agreedCents: 0, listSubtotalCents: 15_000, reason: "Scholarship" }) === null);
  check("$0 without a reason is refused",
    agreedPriceError({ agreedCents: 0, listSubtotalCents: 15_000, reason: "" }) !== null);
  const z = agreedPriceColumns(0, 15_000);
  check("$0 discounts the whole fee, never a negative total",
    z.totalCents === 0 && z.discountCents === 15_000);
}

console.log("\nThe note that answers the question months later");
{
  const note = agreedPriceNote(TECHNIFICATION.quotedThatDay, 13_500, "  Attended all term, settling up  ");
  check("names both figures", note.includes("$30.00") && note.includes("$135.00"), note);
  check("carries the reason, trimmed", note.endsWith("Attended all term, settling up"), note);
}

console.log("\nA sanity floor: the old rule would have failed these");
{
  // Proof the regression is really closed — every one of these was refused
  // before 2026-09-15 purely because it exceeded the pro-rated quote.
  const wouldHaveBeenRefused = [
    { agreed: 13_500, fee: TECHNIFICATION.fee, quote: TECHNIFICATION.quotedThatDay, label: "Technification $135" },
    { agreed: 16_000, fee: FUNINO.fee,         quote: FUNINO.quotedThatDay,         label: "FUNiño full $160" },
    { agreed:  8_000, fee: TECHNIFICATION.fee, quote: TECHNIFICATION.quotedThatDay, label: "Technification $80" },
  ];
  for (const w of wouldHaveBeenRefused) {
    const oldRuleRefused = w.agreed > w.quote;
    const nowAccepted = agreedPriceError({ agreedCents: w.agreed, listSubtotalCents: w.fee, reason: "r" }) === null;
    check(`${w.label}: refused by the old rule, accepted now`, oldRuleRefused && nowAccepted);
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
