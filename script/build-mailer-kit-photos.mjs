// Put a brand website's photo into the Mailer's brand kit: upright, 1200px
// wide at most, progressive JPEG around 80 quality — the size the kit's other
// photos are, small enough for an email, big enough for a hero.
//   node script/build-mailer-kit-photos.mjs <src> <dest> [<src> <dest> …]
// e.g.
//   node script/build-mailer-kit-photos.mjs ../../../cugc-website/public/img/news-autumn-glory.jpg client/public/mailer/cugc/autumn-glory.jpg
// Then add the file to BRAND_KITS in grapes/templates/brand-kit.ts with a
// caption that says WHO is in it and how old they look — Rambo picks by caption.
import sharp from "sharp";

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) {
  console.error("usage: node script/build-mailer-kit-photos.mjs <src> <dest> [<src> <dest> …]");
  process.exit(1);
}
for (let i = 0; i < args.length; i += 2) {
  const [src, out] = [args[i], args[i + 1]];
  const info = await sharp(src).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80, progressive: true, mozjpeg: true }).toFile(out);
  console.log(`${out}  ${info.width}×${info.height}  ${Math.round(info.size / 1024)}KB`);
}
