import { createContext, useContext, useEffect, useState, ReactNode } from "react";

// Theme preference is stored as one of these. "system" falls back to the
// browser's prefers-color-scheme so users get a reasonable default before
// they touch the toggle. The toggle in the UI flips between "light" and
// "dark" — "system" is only the initial default.
export type ThemeMode = "light" | "dark" | "system";

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: "light" | "dark"; // what's actually applied right now
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "clubos-theme";

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

// The public booking flow (book.* subdomain or /book route) is hardcoded
// dark-themed and the shared light-mode polyfill in index.css would flip its
// white text invisible. Same for the CIC Skills Challenge landing page
// (join.cicyouth.com / /skills) — hardcoded near-black, so a light-mode
// phone rendered its white text navy-on-black. Force dark for these
// regardless of the visitor's stored preference or OS setting.
function isPublicDarkSurface(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  const path = window.location.pathname;
  return (
    host.startsWith("book.") ||
    path === "/book" ||
    path.startsWith("/book/") ||
    host.includes("cicyouth") ||
    path === "/skills" ||
    path.startsWith("/skills/")
  );
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (isPublicDarkSurface()) return "dark";
  if (mode === "system") {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveMode(readStoredMode()));

  useEffect(() => {
    const r = resolveMode(mode);
    setResolved(r);
    const root = document.documentElement;
    if (r === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.setAttribute("data-theme", r);
    root.style.colorScheme = r;
  }, [mode]);

  // Re-resolve when the OS preference changes — only relevant when mode = system.
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = (m: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, m);
    setModeState(m);
  };

  const toggle = () => {
    // Toggle from whatever's actually applied — feels right whether the
    // user is on system or explicit.
    setMode(resolved === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
