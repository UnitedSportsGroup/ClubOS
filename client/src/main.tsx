import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/* Pages load as separate files (App.tsx). A deploy replaces every one of them
   with new names, and staff keep ClubOS open all day across several deploys —
   so an open tab can ask for a page file that no longer exists, which would
   blank the screen. Vite reports it as `vite:preloadError`: reload once onto
   the new version (never in a loop — a second failure within 30s is shown). */
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "clubos-reloaded-for-deploy";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    /* storage blocked — still reload once */
  }
  if (Date.now() - last < 30_000) return;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
