// A dark tile to judge a logo on — only an image sits on it, never text, so
// the light-mode ink flip has nothing to break. Declared in audit-dark-surfaces.
import type { ReactNode } from "react";

export function DarkChip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={className} style={{ background: "#141414" }}>{children}</div>;
}
