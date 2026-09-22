/**
 * Club Events — what a brand needs from the browser beyond its colours:
 * its typefaces, and its own web address.
 */
import { useEffect } from "react";
import { clubEventBrand } from "@shared/club-events";

/** Load the brand's display + body faces once. The page reads fine without them. */
export function useClubEventFonts(brandKey: string | null | undefined) {
  useEffect(() => {
    if (!brandKey) return;
    const id = `club-events-fonts-${brandKey}`;
    if (document.getElementById(id)) return;
    if (brandKey === "siu") {
      // The Pupila faces SIU's membership and camp pages already serve.
      const s = document.createElement("style");
      s.id = id;
      s.textContent = `
        @font-face { font-family:'Rough Cut SIU'; src:url('/fonts/siu/RoughCut.otf') format('opentype'); font-weight:400; font-display:swap; }
        @font-face { font-family:'Arpona SIU'; src:url('/fonts/siu/Arpona-Regular.otf') format('opentype'); font-weight:400; font-display:swap; }
        @font-face { font-family:'Arpona SIU'; src:url('/fonts/siu/Arpona-SemiBold.otf') format('opentype'); font-weight:500 600; font-display:swap; }
        @font-face { font-family:'Arpona SIU'; src:url('/fonts/siu/Arpona-Bold.otf') format('opentype'); font-weight:700; font-display:swap; }`;
      document.head.appendChild(s);
      return;
    }
    const l = document.createElement("link");
    l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, [brandKey]);
}

/**
 * An event is sold on its brand's own address. Somebody arriving on another
 * brand's join.* host (an old link, a board printed before a rebrand) is moved
 * to the right one, path and query kept. Only join.* hosts are touched, so
 * app.usg.co.nz, previews and localhost are left alone.
 */
export function useCanonicalEventHost(brandKey: string | null | undefined) {
  useEffect(() => {
    if (!brandKey) return;
    const here = window.location.hostname;
    if (!here.startsWith("join.")) return;
    const want = new URL(clubEventBrand(brandKey).publicBase);
    if (want.hostname === here) return;
    window.location.replace(`${want.origin}${window.location.pathname}${window.location.search}${window.location.hash}`);
  }, [brandKey]);
}
