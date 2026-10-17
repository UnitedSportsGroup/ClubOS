// Native e-Sign template: Brand & App Publishing Authorisation.
//
// Why it exists (2026-10-17): Google Play rejected CUFC Coaching (nz.cufc.coaching)
// under its Impersonation policy because the icon is the Christchurch United crest
// and the app is published by the developer account "FootVault" (Conscious Capital
// Limited). Google only accepts proof of permission SIGNED BY BOTH PARTIES — not
// screenshots or emails. This is that proof, as a branded signing page with a
// certificate of completion, reusable for any future app or brand the club licenses.
//
// Signing order: Conscious Capital (the sender, Daniel) signs first; the Club's
// officer completes it (`clubSignsFirst` = "we sign first", Daniel's standing rule).
//
// Usage:
//   npx tsx --env-file=.env script/seed-app-publishing-authorisation-template.ts
//     → upserts the template (idempotent on organization_id + slug)
//   … --create-doc --signer-name "Slava Meyn" --signer-email x@y --sender-email daniel@cufc.co.nz
//     → also creates a SENT envelope and prints both signing links. Sends NO email:
//       the system emails the second signer only when the first one signs.

import { Pool } from "pg";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { renderNativePdf } from "../server/esign-native-pdf";

const ORG_SLUG = "christchurch-united";
const SLUG = "app-publishing-authorisation";

export const brand = {
  orgLabel: "Christchurch United Football Club",
  logoUrl: "/logos/christchurch-united.png",
  bg: "#0b1330",
  panel: "#121c40",
  border: "#24305a",
  accent: "#C9A43E",
  accentDeep: "#a8862c",
  paper: "#faf8f2",
  ink: "#0b1330",
};

export const variables = [
  { key: "licensor_name", label: "Rights holder (legal name)", type: "text", default: "Christchurch United Football Club Incorporated", required: true },
  { key: "marks", label: "Names and marks covered", type: "text", default: "the name “Christchurch United”, the abbreviation “CUFC” and the Christchurch United crest", required: true },
  { key: "apps", label: "Apps covered", type: "text", default: "CUFC Coaching (package and bundle ID nz.cufc.coaching) and CUFC Players (package and bundle ID nz.cufc.players)", required: true },
];

export const form = [
  { key: "signatory_name", label: "Full name", type: "text", required: true },
  { key: "signatory_title", label: "Position", type: "text", required: true, placeholder: "e.g. President" },
];

export const settings = {
  clubSignsFirst: true,
  guardianUnder18: false,
  counterSignerRole: "For Conscious Capital Limited (the Developer)",
  primarySignerRole: "For the Rights Holder",
  detailsHeading: "Signing for the Rights Holder",
  adviceNotice: "This authorisation lets the Developer show app stores that it has permission to use the names and marks listed. It can be withdrawn in writing at any time.",
};

export const content = {
  docTitle: "Brand and App Publishing Authorisation",
  partiesIntro: [
    "This Authorisation is made between:",
    "{{licensor_name}} (“the Rights Holder”), signed by {{signatory_name}}, {{signatory_title}}",
    "and",
    "Conscious Capital Limited, New Zealand company number 8594806, formerly FootVault Limited (“the Developer”), which publishes apps through its Google Play developer account “FootVault” (account ID 5980662005296678076) and its Apple Developer account “Conscious Capital Limited”.",
  ],
  sections: [
    {
      heading: "1. Ownership",
      items: [
        { kind: "p", text: "The Rights Holder owns {{marks}} (“the Marks”). Nothing in this Authorisation transfers ownership of the Marks to the Developer." },
      ],
    },
    {
      heading: "2. Authorisation",
      items: [
        { kind: "p", text: "The Rights Holder authorises the Developer to use the Marks in the following apps, which the Developer builds and publishes on the Rights Holder’s behalf for the Rights Holder’s own coaches, players, members and families: {{apps}} (“the Apps”)." },
      ],
    },
    {
      heading: "3. What is covered",
      items: [
        { kind: "bullet", text: "App names, app icons and graphics." },
        { kind: "bullet", text: "Store listings, descriptions, screenshots and promotional images on Google Play, the Apple App Store and any other app platform." },
        { kind: "bullet", text: "All content shown inside the Apps." },
      ],
    },
    {
      heading: "4. Conditions",
      items: [
        { kind: "bullet", text: "The Developer uses the Marks only for the Apps and only in the Rights Holder’s approved form." },
        { kind: "bullet", text: "The Developer removes or changes any use of the Marks within 10 working days of a written request from the Rights Holder." },
        { kind: "bullet", text: "No fee is payable by either party for this Authorisation." },
      ],
    },
    {
      heading: "5. Evidence for app platforms",
      items: [
        { kind: "p", text: "The Rights Holder agrees that the Developer may give a copy of this signed Authorisation to Google, Apple or any other app platform as evidence of permission to use the Marks." },
      ],
    },
    {
      heading: "6. Term and withdrawal",
      items: [
        { kind: "bullet", text: "This Authorisation starts on the date of the last signature and stays in force until the Rights Holder withdraws it in writing." },
        { kind: "bullet", text: "On withdrawal, the Developer will, as the Rights Holder chooses, remove the Apps from sale or transfer them to a developer account nominated by the Rights Holder." },
      ],
    },
    {
      heading: "7. Governing law",
      items: [
        { kind: "p", text: "This Authorisation is governed by the laws of New Zealand. The parties agree to sign it electronically under Part 4 of the Contract and Commercial Law Act 2017." },
      ],
    },
  ],
  signAck: "By signing, each party confirms it has authority to sign for the organisation named and agrees to this Authorisation.",
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function nzDate(d = new Date()) {
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "Pacific/Auckland" });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const org = await client.query(`SELECT id, name FROM organizations WHERE slug = $1`, [ORG_SLUG]);
    if (!org.rows.length) throw new Error(`Organization '${ORG_SLUG}' not found`);
    const orgId = org.rows[0].id;

    const tplRes = await client.query(
      `INSERT INTO esign_templates (organization_id, slug, name, description, brand, content, variables, form, settings, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       ON CONFLICT (organization_id, slug) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, brand = EXCLUDED.brand,
         content = EXCLUDED.content, variables = EXCLUDED.variables, form = EXCLUDED.form,
         settings = EXCLUDED.settings, active = true
       RETURNING *`,
      [
        orgId, SLUG, "Brand and App Publishing Authorisation",
        "The club authorises Conscious Capital Limited to use its name and crest in apps it publishes on the club's behalf. This is the signed proof Google Play and Apple ask for under their impersonation rules.",
        JSON.stringify(brand), JSON.stringify(content), JSON.stringify(variables), JSON.stringify(form), JSON.stringify(settings),
      ],
    );
    const tpl = tplRes.rows[0];
    console.log(`✅ Template '${SLUG}' upserted (id ${tpl.id}) for ${org.rows[0].name} (org ${orgId})`);

    if (!process.argv.includes("--create-doc")) return;

    const signerName = arg("--signer-name");
    const signerEmail = (arg("--signer-email") || "").toLowerCase();
    const senderEmail = (arg("--sender-email") || "").toLowerCase();
    if (!signerName || !/.+@.+\..+/.test(signerEmail) || !senderEmail) throw new Error("--signer-name, --signer-email and --sender-email are required");
    const sender = (await client.query(`SELECT id, email, first_name, last_name FROM users WHERE lower(email) = $1`, [senderEmail])).rows[0];
    if (!sender) throw new Error(`No ClubOS user with email ${senderEmail}`);
    const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(" ");

    const templateData: Record<string, string> = {};
    for (const v of variables) templateData[v.key] = String(arg(`--${v.key}`) ?? v.default);

    await client.query("BEGIN");
    const doc = (await client.query(
      `INSERT INTO esign_documents (organization_id, title, message, status, sequential, doc_type, template_id, template_data, source_file_name, source_pdf, doc_hash, created_by, sent_at)
       VALUES ($1, $2, $3, 'sent', true, 'native', $4, $5, null, '', '', $6, now()) RETURNING *`,
      [orgId, `${tpl.name} — ${signerName}`.slice(0, 160),
       "Google Play needs this signed by both the club and Conscious Capital before it will publish the CUFC Coaching app.",
       tpl.id, JSON.stringify(templateData), sender.id],
    )).rows[0];
    const tok = () => crypto.randomBytes(24).toString("hex");
    const primary = (await client.query(
      `INSERT INTO esign_signers (document_id, organization_id, name, email, signing_order, is_form_signer, token) VALUES ($1,$2,$3,$4,1,true,$5) RETURNING *`,
      [doc.id, orgId, signerName, signerEmail, tok()])).rows[0];
    const counter = (await client.query(
      `INSERT INTO esign_signers (document_id, organization_id, name, email, signing_order, is_form_signer, token) VALUES ($1,$2,$3,$4,0,false,$5) RETURNING *`,
      [doc.id, orgId, senderName, sender.email, tok()])).rows[0];

    // Same render the server uses for an unsigned native document (esignRenderNativeDoc, final=false).
    const logoPath = path.resolve(process.cwd(), "client", "public", brand.logoUrl.replace(/^\//, ""));
    const bytes = await renderNativePdf({
      brand, settings, content: content as any, values: { ...templateData },
      formSpec: form.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required })),
      formData: null, refereeEmail: signerEmail,
      parties: [
        { role: settings.counterSignerRole, name: null, signatureImage: null, signedAt: null },
        { role: settings.primarySignerRole, name: null, signatureImage: null, signedAt: null },
      ],
      guardian: null,
      logoBytes: fs.existsSync(logoPath) ? new Uint8Array(fs.readFileSync(logoPath)) : null,
      envelopeId: doc.id,
    } as any);
    const buf = Buffer.from(bytes);
    await client.query(`UPDATE esign_documents SET source_pdf = $1, doc_hash = $2 WHERE id = $3`,
      [buf.toString("base64"), crypto.createHash("sha256").update(buf).digest("hex"), doc.id]);
    await client.query(`INSERT INTO esign_events (document_id, type, actor_email, meta) VALUES ($1,'created',$2,$3), ($1,'sent',$2,$4)`,
      [doc.id, sender.email, JSON.stringify({ template: SLUG, signers: 2, via: "script" }), JSON.stringify({ emailed: false, note: `links handed out by hand ${nzDate()}` })]);
    await client.query("COMMIT");

    const base = process.env.APP_URL || "https://app.usg.co.nz";
    console.log(`✅ Envelope #${doc.id} created (sent, no email). Signing order:`);
    console.log(`   1. ${counter.name} <${counter.email}>  ${base}/sign/${counter.token}`);
    console.log(`   2. ${primary.name} <${primary.email}>  ${base}/sign/${primary.token}`);
    fs.writeFileSync(path.resolve(process.cwd(), `.esign-envelope-${doc.id}.pdf`), buf);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.includes("seed-app-publishing-authorisation-template")) {
  main().catch((err) => { console.error("❌ Failed:", err); process.exit(1); });
}
