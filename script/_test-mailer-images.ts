// Pictures in the Mailer — the rules and the real pipeline, proven without a
// database or a browser:
//   npx tsx script/_test-mailer-images.ts
//
// - the pure plan: a photo → JPEG shrunk to 1200px; a transparent logo → PNG
//   left at its size; an animated GIF stays GIF; SVG/HEIC/PDF refused by name;
//   nothing is ever enlarged
// - the sharp pipeline on pictures made here: a 4000×3000 JPEG comes out
//   ≤1200 wide, ≤250KB, progressive, with NO EXIF; a sideways phone photo
//   (EXIF orientation 6) comes out upright; a transparent PNG stays PNG with
//   its alpha; an SVG is refused with the PNG advice
// - keys, URLs and the size gauge states
import sharp from "sharp";
import {
  MAILER_IMAGE_MAX_WIDTH,
  MAILER_IMAGE_TARGET_BYTES,
  describeShrink,
  isMailerImageUrl,
  mailerHtmlSizeState,
  mailerImageKey,
  mailerImageUrl,
  parseMailerImageFile,
  planMailerImage,
} from "../shared/mailer-images";
import { shrinkForEmail } from "../server/mailer-image-shrink";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

async function main() {
  console.log("\nMailer pictures — rules + pipeline\n");

  // ── The plan ────────────────────────────────────────────────────────────────
  const photo = planMailerImage({ format: "jpeg", width: 4000, height: 3000, hasAlpha: false, bytes: 4_000_000 });
  ok("a 4000×3000 photo becomes a 1200×900 JPEG", photo.ok && photo.plan.format === "jpeg" && photo.plan.width === 1200 && photo.plan.height === 900, JSON.stringify(photo));
  const tall = planMailerImage({ format: "png", width: 1000, height: 4000, hasAlpha: false, bytes: 1 });
  ok("a tall picture is capped by height (1800) first", tall.ok && tall.plan.width === 450 && tall.plan.height === 1800);
  const logo = planMailerImage({ format: "png", width: 300, height: 120, hasAlpha: true, bytes: 1 });
  ok("a small transparent logo stays PNG at its own size — never enlarged", logo.ok && logo.plan.format === "png" && logo.plan.width === 300 && logo.plan.height === 120);
  const gif = planMailerImage({ format: "gif", width: 1600, height: 900, pages: 12, bytes: 1 });
  ok("an animated GIF stays GIF and is shrunk to 1200", gif.ok && gif.plan.format === "gif" && gif.plan.width === 1200);
  const stillGif = planMailerImage({ format: "gif", width: 500, height: 500, pages: 1, hasAlpha: false, bytes: 1 });
  ok("a still GIF becomes a JPEG (smaller, every client)", stillGif.ok && stillGif.plan.format === "jpeg");
  const webp = planMailerImage({ format: "webp", width: 900, height: 600, hasAlpha: false, bytes: 1 });
  ok("WebP is converted (Outlook can't show it), not refused", webp.ok && webp.plan.format === "jpeg");
  const svg = planMailerImage({ format: "svg", width: 100, height: 100, bytes: 1 });
  ok("SVG is refused with the PNG advice", !svg.ok && /PNG/.test(svg.ok ? "" : svg.message));
  const heic = planMailerImage({ format: "heif", width: 100, height: 100, bytes: 1 });
  ok("HEIC is refused with the iPhone advice", !heic.ok && /iPhone/.test(heic.ok ? "" : heic.message));
  const pdf = planMailerImage({ format: "pdf", width: 100, height: 100, bytes: 1 });
  ok("a PDF is pointed at Attach a file", !pdf.ok && /Attach/.test(pdf.ok ? "" : pdf.message));
  const sizeless = planMailerImage({ format: "jpeg", width: 0, height: 0, bytes: 1 });
  ok("a picture with no size is refused", !sizeless.ok);

  // ── Keys + URLs ─────────────────────────────────────────────────────────────
  const key = mailerImageKey("a".repeat(64));
  ok("the key is the first 24 hex chars of the digest", key === "a".repeat(24));
  ok("a bad digest throws", (() => { try { mailerImageKey("zz"); return false; } catch { return true; } })());
  const url = mailerImageUrl(key, "jpeg");
  ok("the URL is on app.usg.co.nz under /mailer/img with .jpg", url === `https://app.usg.co.nz/mailer/img/${key}.jpg` && isMailerImageUrl(url));
  const parsed = parseMailerImageFile(`${key}.png`);
  ok("a filename parses back to key + format", !!parsed && parsed.key === key && parsed.format === "png");
  ok("a stray path does not parse", parseMailerImageFile("../../etc/passwd") === null && parseMailerImageFile(`${key}.svg`) === null);
  ok("a foreign URL is not a Mailer picture", !isMailerImageUrl("https://example.com/mailer/img/" + key + ".jpg"));
  ok("the shrink note reads naturally and never says −100%", describeShrink(4_200_000, 140_000) === "4.0 MB → 137 KB (−96%)" && /−99%\)$/.test(describeShrink(10_700_000, 29_000)), `${describeShrink(4_200_000, 140_000)} · ${describeShrink(10_700_000, 29_000)}`);
  ok("the gauge states: ok / warn / over", mailerHtmlSizeState(50 * 1024) === "ok" && mailerHtmlSizeState(90 * 1024) === "warn" && mailerHtmlSizeState(102 * 1024) === "over");

  // ── The real pipeline ───────────────────────────────────────────────────────
  // A busy 4000×3000 "photo" (noise compresses badly, so this is a hard case).
  const noise = Buffer.alloc(4000 * 3000 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  const bigJpeg = await sharp(noise, { raw: { width: 4000, height: 3000, channels: 3 } })
    .jpeg({ quality: 95 })
    .withMetadata({ exif: { IFD0: { Make: "ProbeCam", Model: "X1", Software: "probe" } } })
    .toBuffer();
  const t0 = Date.now();
  const shrunk = await shrinkForEmail(bigJpeg);
  const ms = Date.now() - t0;
  if (!shrunk.ok) ok("a big JPEG shrinks", false, shrunk.message);
  else {
    const m = await sharp(shrunk.image.data).metadata();
    ok(`a ${(bigJpeg.length / 1024 / 1024).toFixed(1)}MB 4000×3000 JPEG comes out ≤1200 wide`, shrunk.image.format === "jpeg" && m.width === 1200 && m.height === 900, `${m.width}×${m.height} in ${ms}ms`);
    ok("…progressive JPEG", m.isProgressive === true);
    ok("…and under the 250KB target, or at the floor quality trying", shrunk.image.data.length <= MAILER_IMAGE_TARGET_BYTES || shrunk.image.quality === 62, `${Math.round(shrunk.image.data.length / 1024)}KB at q${shrunk.image.quality}`);
    ok("…with the camera data (EXIF) gone", !m.exif, m.exif ? "exif present" : "");
  }

  // A sideways phone photo: 3000×2000 pixels stored with EXIF orientation 6
  // (rotate 90° CW to view) — the picture people SEE is portrait 2000×3000.
  const sidewaysJpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#3b82f6" } })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const upright = await shrinkForEmail(sidewaysJpeg);
  if (!upright.ok) ok("a sideways phone photo shrinks", false, upright.message);
  else {
    const m = await sharp(upright.image.data).metadata();
    ok("a sideways phone photo (EXIF orientation 6) comes out UPRIGHT, portrait, inside 1200×1800", m.width === 1200 && m.height === 1800 && !m.orientation, `${m.width}×${m.height} orientation=${m.orientation ?? "none"}`);
  }

  // A transparent logo.
  const logoPng = await sharp({ create: { width: 320, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 200, height: 80, channels: 4, background: "#1d3fae" } }).png().toBuffer(), left: 60, top: 24 }])
    .png()
    .toBuffer();
  const logoOut = await shrinkForEmail(logoPng);
  if (!logoOut.ok) ok("a transparent logo shrinks", false, logoOut.message);
  else {
    const m = await sharp(logoOut.image.data).metadata();
    ok("a transparent logo stays PNG, keeps its alpha, is not enlarged", logoOut.image.format === "png" && m.hasAlpha === true && m.width === 320 && m.height === 128, `${m.format} ${m.width}×${m.height} alpha=${m.hasAlpha}`);
  }

  // A WebP photo is converted to JPEG.
  const webpIn = await sharp({ create: { width: 1500, height: 1000, channels: 3, background: "#10b981" } }).webp().toBuffer();
  const webpOut = await shrinkForEmail(webpIn);
  ok("a WebP comes out as a 1200-wide JPEG", webpOut.ok && webpOut.image.format === "jpeg" && webpOut.image.width === MAILER_IMAGE_MAX_WIDTH, webpOut.ok ? `${webpOut.image.width}×${webpOut.image.height}` : webpOut.message);

  // SVG refused; garbage refused.
  const svgOut = await shrinkForEmail(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'));
  ok("an SVG file is refused with the PNG advice", !svgOut.ok && /PNG/.test(svgOut.ok ? "" : svgOut.message));
  const junk = await shrinkForEmail(Buffer.from("not a picture at all"));
  ok("a non-picture is refused plainly", !junk.ok && /JPEG, PNG or GIF/.test(junk.ok ? "" : junk.message));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
