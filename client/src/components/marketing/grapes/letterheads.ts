// Kept apart from editor.ts so the toolbar can list letterheads without
// loading the ~725KB GrapesJS chunk.
/** Letterheads a sender can put at the top of an email (Daniel, 2026-10-09:
 *  "easy way to choose letterhead like cufc logo or united prints or mfl").
 *  Full-colour artwork that reads on a white page, served by ClubOS itself —
 *  never the Supabase bucket, whose quota has 402'd. The crests are the
 *  TRIMMED copies in client/public/mailer/crests (script/build-mailer-crests.py):
 *  the originals in client/public/logos carry up to 22% transparent border, so
 *  at 96px the artwork drew 74px. The wordmark has no border and stays. */
export const LETTERHEADS: { id: string; label: string; src: string; width: number }[] = [
  { id: "cufc", label: "Christchurch United FC", src: "https://app.usg.co.nz/mailer/crests/cufc.png", width: 96 },
  { id: "siu", label: "South Island United", src: "https://app.usg.co.nz/mailer/crests/siu.png", width: 96 },
  { id: "mfl", label: "Mini Football Leagues", src: "https://app.usg.co.nz/mailer/crests/mfl.png", width: 96 },
  { id: "prints", label: "United Prints", src: "https://app.usg.co.nz/logos/united-prints-wordmark.png", width: 240 },
  { id: "cugc", label: "United Gymnastics", src: "https://app.usg.co.nz/mailer/crests/cugc.png", width: 96 },
  { id: "cic", label: "Christchurch International Cup", src: "https://app.usg.co.nz/mailer/crests/cic.png", width: 96 },
  { id: "usg", label: "United Sports Group", src: "https://app.usg.co.nz/mailer/crests/usg.png", width: 96 },
];

