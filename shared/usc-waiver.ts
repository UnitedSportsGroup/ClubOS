// United Sports Centre — Facility Use Terms & Liability Waiver.
//
// Single source of truth shared by the member booking-request form (rendered
// in the agreement scroll-box), the server (stamps the accepted version on
// each booking_requests row), and emails (referenced in confirmations).
//
// Bump USC_WAIVER_VERSION whenever the wording changes so every stored
// acceptance records exactly which text the member agreed to.

export const USC_WAIVER_VERSION = "1.0 (June 2026)";

export interface WaiverSection {
  title: string;
  body: string;
}

export const USC_WAIVER_SECTIONS: WaiverSection[] = [
  {
    title: "1. The Facility",
    body:
      "The United Sports Centre, Christchurch (\"the Centre\") is a private sports facility operated by Christchurch United Football Club Incorporated (\"the Club\"). The Centre is not a public space: entry and use are by permission of the Club only, through an approved booking or membership. The Club may refuse entry to, or require any person to leave, the Centre at its discretion.",
  },
  {
    title: "2. Member Booking Requests",
    body:
      "This booking service is available to current club members only. Submitting this form is a request, not a confirmed booking. Your booking is confirmed only when you receive a written confirmation from the Club. The Club may accept, decline, or propose changes to any request at its discretion.",
  },
  {
    title: "3. Assumption of Risk",
    body:
      "Football and other sport and recreation activities carry inherent risks, including (without limitation) collisions with other people or objects, slips, trips and falls, risks arising from playing surfaces and equipment, weather conditions, and the actions of other facility users. You choose to enter and use the Centre voluntarily and entirely at your own risk, and you are responsible for your own safety and the safety of anyone you bring with you.",
  },
  {
    title: "4. Personal Injury & ACC",
    body:
      "In New Zealand, personal injury caused by accident is generally covered by the Accident Compensation Act 2001 (ACC), which also bars most claims for compensatory damages for personal injury. To the maximum extent permitted by New Zealand law, you agree that the Club, the owner of the Centre, and their officers, employees, contractors and volunteers are not liable for any personal injury, illness, death, loss or damage you or your group suffer arising out of entry to or use of the Centre, however caused. You are responsible for arranging any additional insurance you consider appropriate.",
  },
  {
    title: "5. Liability for Property Damage",
    body:
      "You accept full liability for any damage to the Centre — including pitches, playing surfaces, fencing, netting, lighting, buildings, fixtures and equipment — caused by you or any member of your group, other than fair wear and tear from normal, permitted use. The Club may recover from you the reasonable costs of repair or replacement of any such damage, and may suspend further bookings until those costs are settled.",
  },
  {
    title: "6. Personal Property",
    body:
      "Any vehicles, equipment or personal belongings brought to the Centre are brought entirely at your own risk. The Club is not responsible for any loss, theft of, or damage to personal property at the Centre.",
  },
  {
    title: "7. Medical Fitness",
    body:
      "You confirm that you, and any participants in your group, are medically fit to take part in the activity booked, and agree to stop participating if you feel unwell or are directed to stop by Club staff. In an emergency you authorise the Club to arrange medical assistance on your behalf; any associated costs not covered by ACC are your responsibility.",
  },
  {
    title: "8. Facility Rules",
    body:
      "You agree to comply with all posted signage and the reasonable directions of Club staff while at the Centre. In particular: appropriate footwear must be worn for the surface being used; no glass, alcohol, smoking or vaping anywhere at the Centre; remove your rubbish; respect other users and neighbouring bookings; bookings are personal to you and may not be on-sold or transferred; and no commercial activity (including paid coaching) may be run during a member booking without the Club's prior written permission.",
  },
  {
    title: "9. Children & Guests",
    body:
      "You are responsible for every person who attends as part of your booking. Anyone under 18 in your group must be actively supervised by a responsible adult at all times. By accepting these terms you do so on your own behalf and, to the extent permitted by law, on behalf of every member of your group, including any children in your care.",
  },
  {
    title: "10. Cancellations & Changes",
    body:
      "The Club may need to cancel or move a confirmed booking due to weather, ground conditions, maintenance, fixtures or Club events. Where that happens the Club will give you as much notice as practicable and offer an alternative time where possible. If you need to cancel or change your booking, please email info@cufc.co.nz at least 24 hours before your booked time.",
  },
  {
    title: "11. Consumer Law",
    body:
      "Nothing in these terms excludes, restricts or modifies any rights or guarantees you may have under the Consumer Guarantees Act 1993 or the Fair Trading Act 1986, or any other rights which cannot lawfully be excluded. These terms are governed by New Zealand law.",
  },
  {
    title: "12. Privacy",
    body:
      "The personal details you provide on this form are collected by the Club to manage facility bookings and to contact you about your booking, and are handled in accordance with the Privacy Act 2020. You may request access to, or correction of, your personal information by emailing info@cufc.co.nz.",
  },
  {
    title: "13. Agreement",
    body:
      "Ticking the agreement box and submitting this form acts as your electronic signature. It confirms that you have read, understood and agree to these Facility Use Terms & Liability Waiver on behalf of yourself and your group, and that the details you have provided are true and correct.",
  },
];

/**
 * Audience-specific waiver. The base text (USC_WAIVER_SECTIONS) is written for
 * the members-only request flow; the public paid booking site shares every
 * section except the two that describe how a booking comes into existence:
 *  - §2: members submit a REQUEST that staff approve; public bookings are
 *    confirmed on payment.
 *  - §10: public cancellations/refunds follow the payment policy shown at
 *    checkout rather than the members' 24-hour email convention.
 */
export function waiverSectionsFor(audience: "member" | "public"): WaiverSection[] {
  if (audience === "member") return USC_WAIVER_SECTIONS;
  return USC_WAIVER_SECTIONS.map((s) => {
    if (s.title.startsWith("2.")) {
      return {
        title: "2. Bookings & Payment",
        body:
          "Bookings made through this site are confirmed once payment is completed. Until payment is completed, a selected time slot is not reserved for you. The Club may cancel a booking made in error or in breach of these terms, in which case any payment will be refunded.",
      };
    }
    if (s.title.startsWith("10.")) {
      return {
        title: "10. Cancellations & Changes",
        body:
          "The Club may need to cancel or move a confirmed booking due to weather, ground conditions, maintenance, fixtures or Club events. Where that happens the Club will give you as much notice as practicable and offer an alternative time or a refund. If you need to cancel or change your booking, contact info@cufc.co.nz — cancellations and refunds are handled under the payment policy displayed on this booking site.",
      };
    }
    return s;
  });
}

/** Plain-text rendering of the full waiver (for emails / records). */
export function waiverPlainText(audience: "member" | "public" = "member"): string {
  return [
    `United Sports Centre — Facility Use Terms & Liability Waiver (v${USC_WAIVER_VERSION})`,
    "",
    ...waiverSectionsFor(audience).map((s) => `${s.title}\n${s.body}`),
  ].join("\n\n");
}
