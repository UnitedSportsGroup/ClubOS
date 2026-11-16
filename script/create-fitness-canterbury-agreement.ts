/**
 * Fitness Canterbury × South Island United — gym partnership agreement (16 Nov 2026).
 *
 *   npx tsx --env-file=.env script/create-fitness-canterbury-agreement.ts            # dry run (writes the preview PDF only)
 *   npx tsx --env-file=.env script/create-fitness-canterbury-agreement.ts --commit   # template + DRAFT document in prod
 *
 * 🔴 Wording = the club's own SIU Sponsorship Contract (shared/sponsorship-agreement-template.ts,
 * executed with SMC, Drifter, LT McGuinness, Victoria Foods, Lone Star). Clauses 1, 2, 4–10 are
 * left exactly as written. Changed for a no-cash (contra) deal, and only this:
 *   · 3.1 "pay the sponsorship fees" → "provide the facilities and access" (there is no fee)
 *   · Schedule A = what the Club gives Fitness Canterbury (the proposal page, section 03/04)
 *   · Schedule B = what Fitness Canterbury provides (Adria's doc + Ryan's note), no bank account
 *   · Special conditions carry the proposal's promises: player standards, schedule notice,
 *     February review, 30 days' notice either side, Intercontinental Cup extension
 * The template is saved UNPUBLISHED (a one-off; it does not appear in staff's send list).
 * The document is a DRAFT: nothing is emailed until someone presses Send in ClubOS → e-Sign.
 * Club signs first (settings.clubSignsFirst), then Bruno's signature completes it.
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { cleanTemplate } from "../shared/esign-template";
import { sponsorshipAgreementTemplate } from "../shared/sponsorship-agreement-template";
import { renderNativePdf } from "../server/esign-native-pdf";

const COMMIT = process.argv.includes("--commit");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "../../../../../outputs/sponsorship/2026-11-16-fitness-canterbury-proposal");

const SIGNER = { name: "Bruno Giudice", email: "info@fitnesscanterbury.co.nz" };
const CLUB_SIGNER_EMAIL = "daniel@cufc.co.nz";

const p = (text: string) => ({ kind: "p" as const, text });
const b = (text: string) => ({ kind: "bullet" as const, text });

function buildTemplate() {
  const raw: any = sponsorshipAgreementTemplate("siu");
  raw.slug = "gym-partnership-agreement-siu-fitness-canterbury";
  raw.name = "Gym Partnership Agreement (South Island United)";
  raw.description = "Fitness Canterbury, Nov 2026. The club's SIU sponsorship agreement with the schedules set for a contra gym partnership.";
  raw.content.docTitle = "Gym Partnership Agreement";
  raw.variables = [
    { key: "sponsor_name", label: "Sponsor", type: "text", required: true },
    { key: "commencement_date", label: "Commencement date", type: "date", required: true },
    { key: "expiry_date", label: "Expiry date", type: "date", required: true },
  ];
  raw.form = [
    { key: "signatory_name", label: "Full name of the person signing", type: "text", required: true },
    { key: "signatory_position", label: "Position", type: "text", required: true, placeholder: "e.g. Director" },
  ];
  const secs = raw.content.sections as { heading: string; items: any[] }[];
  const s3 = secs.find((s) => s.heading.startsWith("3."))!;
  s3.items = [
    p("3.1 The Sponsor shall provide the Club with the facilities and access set out in Schedule B on the dates and terms specified."),
    p("3.2 All amounts payable are exclusive of GST unless expressly stated otherwise."),
  ];
  const iA = secs.findIndex((s) => s.heading.startsWith("Schedule A"));
  secs[iA] = { heading: "Schedule A: Sponsorship Benefits", items: [
    p("South Island United Football Club to provide for the period of the contract:"),
    b("The title Official Gym Partner of South Island United, and the Sponsor's logo on the South Island United partners page."),
    b("Promotion of Fitness Canterbury to the Club's families, players and supporters, with a target of 10 new paying members referred by the Club during the Term."),
    b("Features of Fitness Canterbury, and any membership offer it runs, in the Christchurch United newsletter."),
    b("Collaboration posts and short videos of the squad training at Fitness Canterbury on the South Island United and Christchurch United social media accounts."),
    b("A Fitness Canterbury sign at United Sports Centre, printed and installed by the Club, size and position agreed with the Sponsor."),
    b("A joint membership offer for the Club's community, starting with a New Year campaign in January 2027. The Sponsor sets the offer; the Club promotes it."),
    b("Fitness Canterbury flyers at the United Sports Centre office and at Club events and holiday camps."),
    p("Additionally:"),
    b("Tracking of referred members by a sign-up code chosen by the Sponsor, or a 'How did you hear about us?' answer of South Island United or Christchurch United."),
    b("A monthly report from the Club of what it posted and sent, with photos and videos of the gym for the Sponsor to reuse."),
  ] };
  const iB = secs.findIndex((s) => s.heading.startsWith("Schedule B"));
  secs[iB] = { heading: "Schedule B: Sponsor Contribution", items: [
    p("Term"),
    p("Start date: {{commencement_date}}"),
    p("Duration: This Agreement shall run from the Commencement Date to the Expiry Date. If the Club qualifies for the FIFA Intercontinental Cup, the parties intend to extend this Agreement on the same terms until the end of the Club's participation."),
    p("Reporting: monthly, as set out in Schedule A."),
    p("Contribution (contra, no cash payment):"),
    b("Team strength sessions for the Club's first-team squad: two sessions a week during the season and up to three a week in some pre-season weeks, in groups of up to 10 players, 30 to 45 minutes each, in the morning, supervised by Club staff."),
    b("General 24/7 memberships, with door access, for the Club's first-team squad (about 20 players) and its coaching and performance staff, names supplied by the Club."),
    b("Planned team session dates to the end of 2026: 24 and 25 November; 1, 2, 4, 7, 8, 11, 21 and 22 December. Times to be confirmed by the Club in advance."),
    p("Contra: the Sponsor's contribution is the facilities and access above. No sponsorship fee is payable by either party."),
    p("Special conditions:"),
    b("The Club will confirm team session dates and times at least one week in advance during the season."),
    b("Club players will use equipment appropriately, keep the facilities tidy and show consideration to the Sponsor's members."),
    b("The parties will review this Agreement at the end of February 2027."),
    b("Either party may end this Agreement by giving the other 30 days' written notice."),
  ] };
  raw.settings = { ...raw.settings, published: false, createdByName: "Daniel Meyn" };
  return raw;
}

async function logoBytes(url: string | undefined) {
  if (!url?.startsWith("/")) return null;
  const f = path.resolve(HERE, "../client/public", url.slice(1));
  return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
}

async function main() {
  const raw = buildTemplate();
  const { template, problems } = cleanTemplate(raw, { brandKey: "siu" });
  if (problems.length) { console.error("Template refused:\n - " + problems.join("\n - ")); process.exit(1); }

  const values = { sponsor_name: "La Maquina Enterprises Limited trading as Fitness Canterbury", commencement_date: "23 November 2026", expiry_date: "10 June 2027" };
  const pdf = await renderNativePdf({
    brand: template.brand as any, settings: template.settings as any, content: template.content as any, values,
    formSpec: template.form.map((f: any) => ({ key: f.key, label: f.label, type: f.type, required: f.required })),
    formData: null, refereeEmail: SIGNER.email,
    parties: [
      { role: String(template.settings.counterSignerRole), name: null, signatureImage: null, signedAt: null },
      { role: String(template.settings.primarySignerRole), name: null, signatureImage: null, signedAt: null },
    ],
    guardian: null, logoBytes: await logoBytes((template.brand as any)?.logoUrl), envelopeId: 0,
  } as any);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "agreement-preview.pdf"), Buffer.from(pdf));
  console.log(`  ✓ preview → ${path.join(OUT, "agreement-preview.pdf")}`);
  if (!COMMIT) { console.log("  Dry run: nothing written to the database."); return; }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    const org = (await c.query(`select id from organizations where slug='united-sports-group'`)).rows[0].id;
    const club = (await c.query(`select id, first_name, last_name, email from users where lower(email)=$1`, [CLUB_SIGNER_EMAIL])).rows[0];
    if (!club) throw new Error("no club signer user");
    const existing = (await c.query(`select id from esign_templates where organization_id=$1 and slug=$2`, [org, raw.slug])).rows[0];
    const tv = [template.name, template.description, JSON.stringify(template.brand), JSON.stringify(template.content), JSON.stringify(template.variables), JSON.stringify(template.form), JSON.stringify(template.settings)];
    const tplId = existing
      ? (await c.query(`update esign_templates set name=$2,description=$3,brand=$4::jsonb,content=$5::jsonb,variables=$6::jsonb,form=$7::jsonb,settings=$8::jsonb where id=$1 returning id`, [existing.id, ...tv])).rows[0].id
      : (await c.query(`insert into esign_templates (organization_id, slug, name, description, brand, content, variables, form, settings, active) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,true) returning id`, [org, raw.slug, ...tv])).rows[0].id;
    const hash = crypto.createHash("sha256").update(Buffer.from(pdf)).digest("hex");
    const doc = (await c.query(
      `insert into esign_documents (organization_id, title, message, status, sequential, doc_type, template_id, template_data, source_file_name, source_pdf, doc_hash, created_by)
       values ($1,$2,$3,'draft',true,'native',$4,$5::jsonb,null,$6,$7,$8) returning id`,
      [org, `${template.name} — Fitness Canterbury`, "Thanks Bruno. Here is the agreement to go with the proposal. We have signed it; your signature completes it.", tplId, JSON.stringify(values), Buffer.from(pdf).toString("base64"), hash, club.id])).rows[0].id;
    const tok = () => crypto.randomBytes(24).toString("hex");
    await c.query(`insert into esign_signers (document_id, organization_id, name, email, signing_order, is_form_signer, token) values ($1,$2,$3,$4,1,true,$5)`, [doc, org, SIGNER.name, SIGNER.email, tok()]);
    await c.query(`insert into esign_signers (document_id, organization_id, name, email, signing_order, is_form_signer, token) values ($1,$2,$3,$4,0,false,$5)`, [doc, org, [club.first_name, club.last_name].filter(Boolean).join(" "), club.email, tok()]);
    await c.query(`insert into esign_events (document_id, type, actor_email, meta) values ($1,'created',$2,$3::jsonb)`, [doc, club.email, JSON.stringify({ template: raw.slug, signers: 2, via: "script" })]);
    await c.query("COMMIT");
    console.log(`  ✓ template #${tplId} (unpublished) · DRAFT document #${doc} in United Sports Group → e-Sign`);
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { await c.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
