// A deliberately small markdown renderer for what Rambo says — headings,
// bullets, numbered lists, bold, code and paragraphs. Never
// dangerouslySetInnerHTML: the text comes back from a model that was handed
// staff-written articles, and a chat that renders raw HTML is a stored-XSS
// hole with a friendly face. Light theme (the admin is light only).
import { useMemo } from "react";

export function RamboMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => (text || "").replace(/\r\n/g, "\n").split("\n"), [text]);
  const inline = (s: string, key: number) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return (
      <span key={key}>
        {parts.map((p, i) =>
          p.startsWith("**") && p.endsWith("**") ? (
            <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
          ) : p.startsWith("`") && p.endsWith("`") ? (
            <code key={i} className="rounded bg-muted px-1.5 py-0.5 text-[12px] font-mono">{p.slice(1, -1)}</code>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </span>
    );
  };
  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-foreground/85">
      {blocks.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith("### ")) return <h4 key={i} className="pt-2 text-[14px] font-semibold text-foreground">{t.slice(4)}</h4>;
        if (t.startsWith("## ")) return <h3 key={i} className="pt-3 text-[15px] font-semibold text-foreground">{t.slice(3)}</h3>;
        if (t.startsWith("# ")) return <h2 key={i} className="pt-3 text-[17px] font-semibold text-foreground">{t.slice(2)}</h2>;
        if (/^[-*]\s+/.test(t)) return <div key={i} className="flex gap-2 pl-1"><span className="select-none text-muted-foreground/60">•</span><div>{inline(t.replace(/^[-*]\s+/, ""), i)}</div></div>;
        if (/^\d+\.\s+/.test(t)) return <div key={i} className="flex gap-2 pl-1"><span className="select-none tabular-nums text-muted-foreground">{t.match(/^\d+/)![0]}.</span><div>{inline(t.replace(/^\d+\.\s+/, ""), i)}</div></div>;
        return <p key={i}>{inline(t, i)}</p>;
      })}
    </div>
  );
}
