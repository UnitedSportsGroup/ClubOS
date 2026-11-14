/**
 * The club's Sponsorship Agreement as an e-Sign template, one per club.
 *
 * 🔴 The wording is the club's OWN. Clauses 1–10 and the schedules are taken
 * from the agreement the club already signs with its sponsors: "SIU Sponsorship
 * Contract - Template" (executed with SMC Design Studio, Drifter, LT McGuinness,
 * Victoria Foods) and "Sponsorship Contract - Template 2025" (executed with
 * Lone Star), text copies in
 * outputs/sponsorship/2026-10-23-partners-tab/source/text/. Nothing legal was
 * written fresh. What changed, and only this:
 *   · the blanks became fields ({{sponsor_name}}, the two dates, the fee…)
 *   · Schedule A lists what THIS proposal offered instead of a fixed list
 *   · Schedule B "an initial 12-month term" reads "from the Commencement Date to
 *     the Expiry Date", because the term is now set per agreement
 *   · the hand-written "Date:" line is gone: e-Sign stamps each signature
 *   · two labels were added to Schedule B: "Contra" and "Special conditions"
 * 🔴 Left exactly as the club wrote them, and worth Ryan's eye:
 *   · clause 5.2 says renewal notice is three months; Schedule B says 30 days
 *   · the SIU parties line reads "South Island United Football Club (The Club)
 *     t/a Christchurch United"
 *
 * Seeded by script/seed-sponsorship-agreement-templates.ts into the United
 * Sports Group workspace, where the Sponsorship tab lives.
 */
import type { ProposalBrandKey } from "./sponsor-proposals";

const PARTIES: Record<ProposalBrandKey, { party: string; short: string }> = {
  siu: { party: "South Island United Football Club (The Club) t/a Christchurch United", short: "South Island United Football Club" },
  cufc: { party: "Christchurch United Football Club Incorporated (The Club)", short: "Christchurch United Football Club" },
};

const p = (text: string) => ({ kind: "p" as const, text });
const b = (text: string) => ({ kind: "bullet" as const, text });

export function sponsorshipAgreementTemplate(brand: ProposalBrandKey) {
  const club = PARTIES[brand];
  const label = brand === "siu" ? "South Island United" : "Christchurch United";
  return {
    slug: `sponsorship-agreement-${brand}`,
    brandKey: brand,
    name: `Sponsorship Agreement (${label})`,
    description: `The club's standard sponsorship agreement for ${label}. Made from a proposal in Sponsorship → Prospects → Proposals & contracts, or sent on its own.`,
    variables: [
      { key: "sponsor_name", label: "Sponsor (the name the agreement is made out to)", type: "text", required: true },
      { key: "sponsorship_rights", label: "What the sponsor gets (Schedule A)", type: "text", required: true },
      { key: "additional_benefits", label: "Additional benefits (Schedule A)", type: "text", required: false, default: "None" },
      { key: "commencement_date", label: "Commencement date", type: "date", required: true },
      { key: "expiry_date", label: "Expiry date", type: "date", required: true },
      { key: "sponsorship_fee", label: "Sponsorship fee, e.g. $15,000 plus GST", type: "text", required: true },
      { key: "payment_schedule", label: "When it is paid, e.g. One payment on 20 January 2027", type: "text", required: true },
      { key: "contra", label: "Contra (goods or services instead of cash)", type: "text", required: false, default: "None" },
      { key: "special_conditions", label: "Special conditions", type: "text", required: false, default: "None" },
    ],
    form: [
      { key: "signatory_name", label: "Full name of the person signing", type: "text", required: true },
      { key: "signatory_position", label: "Position", type: "text", required: true, placeholder: "e.g. Director" },
    ],
    content: {
      docTitle: "Sponsorship Agreement",
      partiesIntro: [
        `Parties: ${club.party} AND {{sponsor_name}} (The Sponsor)`,
        "Signed for the Sponsor by {{signatory_name}}, {{signatory_position}}.",
      ],
      sections: [
        { heading: "Background", items: [
          p("A. The Club is a non-profit incorporated society that organises and operates the Club’s football activities and related events and is entitled to offer sponsorship, advertising and promotional benefits to third parties."),
          p("B. The Sponsor wishes to support the Club’s activities through sponsorship, and the Club agrees to grant the Sponsor certain rights and benefits on the terms of this Agreement."),
          p("C. The parties wish to record the terms of their agreement in writing."),
        ] },
        { heading: "1. Definitions", items: [
          p("In this Agreement, unless the context otherwise requires:"),
          p("Event Marks means the Club’s name, logos, and trade marks provided to the Sponsor under this Agreement."),
          p("Sponsor Marks means the Sponsor’s name, logos, and trade marks provided to the Club under this Agreement."),
          p("Term means the period commencing on the Commencement Date and ending on the Expiry Date unless terminated earlier in accordance with this Agreement."),
        ] },
        { heading: "2. Sponsorship Rights", items: [
          p("2.1 The Club grants the Sponsor a non-exclusive, non-transferable licence to use the Event Marks during the Term solely to promote its sponsorship of the Club, subject to the Club’s brand guidelines (as amended from time to time)."),
          p("2.2 The Sponsor grants the Club a non-exclusive, non-transferable licence to use the Sponsor Marks during the Term solely to fulfil the benefits outlined in Schedule A."),
          p("2.3 Each party shall, within 5 business days of signing this Agreement, provide the other with high-resolution electronic copies of its respective Marks."),
        ] },
        { heading: "3. Sponsor Contribution", items: [
          p("3.1 The Sponsor shall pay the Club the sponsorship fees set out in Schedule B by the dates specified."),
          p("3.2 All amounts payable are exclusive of GST unless expressly stated otherwise."),
        ] },
        { heading: "4. Club’s Obligations", items: [
          p("4.1 The Club shall provide the sponsorship benefits listed in Schedule A and shall use reasonable endeavours to maximise the Sponsor’s exposure in accordance with the terms of this Agreement."),
          p("4.2 The Club retains control of all aspects of its activities and retains discretion over its operations and promotional activities subject only to the express terms of this Agreement."),
        ] },
        { heading: "5. Term and Renewal", items: [
          p("5.1 This Agreement shall commence on {{commencement_date}} (Commencement Date) and expire on {{expiry_date}} (Expiry Date), unless terminated earlier in accordance with this Agreement."),
          p("5.2 The Sponsor shall have a first right of refusal to renew this sponsorship on terms to be agreed. The Sponsor must notify the Club of its intention to renew no later than three months before the Expiry Date."),
        ] },
        { heading: "6. Intellectual Property", items: [
          p("6.1 Each party retains ownership of its Marks."),
          p("6.2 On expiry or termination of this Agreement, each party shall immediately cease using the other party’s Marks."),
        ] },
        { heading: "7. Confidentiality", items: [
          p("7.1 The parties agree to keep confidential all information of a confidential nature obtained in connection with this Agreement, except to the extent required by law."),
        ] },
        { heading: "8. Force Majeure", items: [
          p("8.1 Neither party shall be liable for any delay or failure in performing its obligations due to causes beyond its reasonable control, including natural disasters, acts of war, strikes, or pandemics."),
          p("8.2 The affected party shall notify the other as soon as reasonably practicable of the occurrence of any such event."),
        ] },
        { heading: "9. Termination", items: [
          p("9.1 Either party may terminate this Agreement immediately by written notice if: (a) the other party materially breaches this Agreement and fails to remedy that breach within 14 days of written notice of breach; (b) the other party is placed into liquidation, receivership, or ceases to carry on business."),
          p("9.2 Upon termination, the Club shall return any unspent portion of the Sponsor’s contribution (less reasonable expenses properly incurred)."),
        ] },
        { heading: "10. Miscellaneous", items: [
          p("10.1 This Agreement is governed by the laws of New Zealand."),
          p("10.2 Nothing in this Agreement creates a partnership, joint venture, or employment relationship between the parties."),
          p("10.3 This Agreement constitutes the entire agreement between the parties and supersedes all prior agreements or understandings."),
          p("10.4 No amendment or variation of this Agreement shall be effective unless recorded in writing and signed by both parties."),
          p("10.5 Neither party may assign its rights or obligations under this Agreement without the other party’s prior written consent."),
          p("10.6 This Agreement may be signed in counterparts, including by electronic means, which together form one binding agreement."),
        ] },
        { heading: "Schedule A: Sponsorship Benefits", items: [
          p(`${club.short} to provide for the period of the contract:`),
          b("{{sponsorship_rights}}"),
          p("Additionally:"),
          b("{{additional_benefits}}"),
        ] },
        { heading: "Schedule B: Sponsor Contribution", items: [
          p("Term"),
          p("Start date: {{commencement_date}}"),
          p("Duration: This Agreement shall run from the Commencement Date to the Expiry Date, with the mutual intention to renew for subsequent 12-month periods. The Sponsor may elect not to renew the Agreement by providing written notice at least 30 days prior to the end of the current term. Both parties acknowledge that this arrangement is intended to be an ongoing partnership built on collaboration and shared objectives."),
          p("Reporting: 1-page report to be sent out at the end of the year"),
          p("Payment Amounts and Dates:"),
          p("The sponsor will pay {{sponsorship_fee}}. {{payment_schedule}}"),
          p("Contra: {{contra}}"),
          p("Special conditions: {{special_conditions}}"),
          p("Payments to be made to the following account:"),
          p("Account Name: Christchurch United Football Club Inc. Bank: ANZ Bank New Zealand Limited Account Number: 01-0635-0374823-00 Bank Address: Ground Floor, ANZ Centre, 23–29 Albert Street, Auckland 1010, New Zealand SWIFT Code: ANZBNZ22"),
        ] },
      ],
      signAck: "I am authorised to sign this Agreement on behalf of the Sponsor, and I have read and agree to its terms.",
    },
    settings: {
      published: true,
      counterSignerRole: label,
      primarySignerRole: "The Sponsor",
      detailsHeading: "Who is signing",
      adviceNotice: "Take your time. You're welcome to seek independent advice before signing — this page will still be here when you're ready.",
      guardianUnder18: false,
      clubSignsFirst: true,
      openLink: null,
      createdByName: "ClubOS",
    },
  };
}
