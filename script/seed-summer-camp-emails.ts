// Saves the two summer-camp emails as Mailer templates in the CUFC workspace (org 1), so a
// human opens Mailer → Your templates → picks one → chooses the audience → sends.
// Nothing is sent by this script. Same name again = updated in place.
//
//   npx tsx --env-file=.env script/seed-summer-camp-emails.ts [--commit]
import pg from "pg";
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import {
  brand, mjmlDoc, header, eyebrow, heading, paragraph, button, footer, detailCard, divider,
} from "../client/src/components/marketing/grapes/templates/sections";

(globalThis as any).window = globalThis;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mjml2html = require("mjml-browser");

const COMMIT = process.argv.includes("--commit");
const b = brand("cufc");
const utm = (c: string) => `utm_source=email&utm_medium=email&utm_campaign=${c}`;

const earlyBird = {
  name: "Summer camps — early bird (Oct 2026)",
  subject: "Summer holiday camps are open: 10% off until 15 November",
  mjml: mjmlDoc(b, [
    header(b),
    eyebrow(b, "Summer holiday camps"),
    heading(b, "18 days of football this summer", { size: 28 }),
    paragraph(b, "Hi {{first_name}}, our summer holiday camps are open for bookings, and you're hearing about it first."),
    detailCard(b, [
      ["Dec", "Mon 21 – Wed 23 Dec"],
      ["Jan", "4–8, 11–15 and 18–22 Jan (Mon–Fri)"],
      ["Times", "Morning 9am–12pm · Afternoon 12–3pm · Full day 9am–3pm"],
      ["Price", "$30 a half day · $50 a full day"],
      ["Where", "United Sports Centre, 466 Yaldhurst Road"],
    ]),
    paragraph(b, `<strong style="color:${b.heading};">Early bird: 10% off with code EARLYBIRD</strong> until Sunday 15 November. Book one day or all 18, whatever fits your summer.`, { padding: "20px 30px 0" }),
    button(b, "Book FUNdamentals (ages 4–8)", `https://join.cufc.co.nz/fundamentals?${utm("summer-camps-earlybird")}`, { padding: "24px 30px 0" }),
    button(b, "Book the World Cup camp (ages 9–13)", `https://join.cufc.co.nz/worldcup?${utm("summer-camps-earlybird")}`, { padding: "12px 30px 8px" }),
    paragraph(b, "We had close to 90 kids a day at the October camps. January is when most parents are back at work, so those weeks fill first.", { padding: "16px 30px 0" }),
    paragraph(b, "See you in the holidays,<br/>Christchurch United FC", { padding: "16px 30px 8px" }),
    footer(b),
  ].join("\n"), "21–23 Dec and 4–22 Jan. Code EARLYBIRD takes 10% off until 15 November."),
};

const videoAsk = {
  name: "Summer camps — video testimonial ask (Oct 2026)",
  subject: "Could you send us a 30-second video? (20% off summer camp)",
  mjml: mjmlDoc(b, [
    header(b),
    eyebrow(b, "A quick favour"),
    heading(b, "30 seconds on your phone, 20% off summer camp", { size: 26 }),
    paragraph(b, "Hi {{first_name}}, thanks for bringing your family to a Christchurch United holiday camp."),
    paragraph(b, "Parents choosing a holiday camp trust other parents far more than they trust us. Would you record a quick video, 20–30 seconds, about how your child found it? It can be you, your child, or both of you.", { padding: "14px 30px 0" }),
    detailCard(b, [
      ["1", "Who you are, and your child's name and age"],
      ["2", "Which camp they came to"],
      ["3", "One thing they loved"],
      ["4", "Would you recommend it to another parent?"],
    ]),
    paragraph(b, `<strong style="color:${b.heading};">As a thank-you, we'll email you a personal code for 20% off</strong> a summer camp booking (21–23 Dec or 4–22 Jan). Upload it straight from your phone. It takes about two minutes.`, { padding: "20px 30px 0" }),
    button(b, "Send my video", `https://cufc.co.nz/lp/camp-stories?${utm("camp-stories")}`, { padding: "24px 30px 8px" }),
    paragraph(b, "Thank you. It genuinely helps.<br/>Christchurch United FC", { padding: "16px 30px 8px" }),
    footer(b),
  ].join("\n"), "Record 20–30 seconds about camp and we'll send you 20% off a summer booking."),
};

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const t of [earlyBird, videoAsk]) {
  const { html, errors } = mjml2html(t.mjml, { validationLevel: "soft" });
  if (errors?.length) console.log(`  ⚠ ${t.name}: ${errors.map((e: any) => e.formattedMessage).join("; ")}`);
  const doc = JSON.stringify({ engine: "grapesjs-mjml", version: 1, mjml: t.mjml });
  const existing = (await c.query(
    `select id from mailer_templates where organization_id=1 and archived_at is null and lower(btrim(name))=lower($1)`, [t.name])).rows[0];
  console.log(`${COMMIT ? (existing ? "UPDATE" : "INSERT") : "would save"} "${t.name}" — ${html.length} bytes html`);
  if (!COMMIT) continue;
  if (existing) {
    await c.query(`update mailer_templates set subject=$1, body_doc=$2::jsonb, body_html=$3, updated_at=now() where id=$4`, [t.subject, doc, html, existing.id]);
  } else {
    await c.query(`insert into mailer_templates (organization_id, name, subject, body_doc, body_html, created_by_user_id, updated_by_user_id) values (1,$1,$2,$3::jsonb,$4,1,1)`, [t.name, t.subject, doc, html]);
  }
  fs.writeFileSync(`/private/tmp/claude-501/${t.name.includes("early") ? "earlybird" : "videoask"}.html`, html);
}
await c.end();
