// A deliberately small markdown renderer for what Rambo says — headings,
// bullets, numbered lists, bold, code and paragraphs. Never
// dangerouslySetInnerHTML: the text comes back from a model that was handed
// staff-written articles, and a chat that renders raw HTML is a stored-XSS
// hole with a friendly face. Light theme (the admin is light only).
import { useMemo } from "react";

export function RamboMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => (text || "").replace(/\r\n/g, "\n").split("\n"), [text]);
  // Links are drawn only to ClubOS's own hosts — Rambo's Studio tools hand
  // back /admin/studio/<id>; a link to anywhere else is left as text.
  const link = (text: string, href: string, i: number) => {
    const ours = /^https:\/\/app\.usg\.co\.nz\//.test(href) || href.startsWith("/admin/");
    if (!ours) return <span key={i}>{text}</span>;
    const path = href.replace(/^https:\/\/app\.usg\.co\.nz/, "");
    return <a key={i} href={path} className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700" data-testid="rambo-link">{text}</a>;
  };
  const inline = (s: string, key: number) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g).filter(Boolean);
    return (
      <span key={key}>
        {parts.map((p, i) => {
          const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
          if (m) return link(m[1], m[2], i);
          return p.startsWith("**") && p.endsWith("**") ? (
            <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
          ) : p.startsWith("`") && p.endsWith("`") ? (
            <code key={i} className="rounded bg-muted px-1.5 py-0.5 text-[12px] font-mono">{p.slice(1, -1)}</code>
          ) : (
            <span key={i}>{p}</span>
          );
        })}
      </span>
    );
  };
  // A markdown table (Rambo reaches for one for an age breakdown): consecutive
  // lines that start with "|", the "|---|" row dropped.
  const groups = useMemo(() => {
    const result: ({ kind: "line"; text: string; i: number } | { kind: "table"; rows: string[][]; i: number })[] = [];
    let table: string[][] | null = null;
    blocks.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("|") && t.endsWith("|")) {
        const cells = t.slice(1, -1).split("|").map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return; // the separator row
        if (!table) { table = []; result.push({ kind: "table", rows: table, i }); }
        table.push(cells);
        return;
      }
      table = null;
      result.push({ kind: "line", text: line, i });
    });
    return result;
  }, [blocks]);
  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-foreground/85">
      {groups.map((g) => {
        if (g.kind === "table") {
          const [head, ...rows] = g.rows;
          return (
            <div key={`t${g.i}`} className="overflow-x-auto">
              <table className="my-1 min-w-[240px] border-collapse text-[13px]">
                <thead>
                  <tr>{head.map((h, j) => <th key={j} className="border-b px-2 py-1 text-left font-semibold text-foreground">{inline(h, j)}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, k) => (
                    <tr key={k} className="odd:bg-muted/30">{r.map((c, j) => <td key={j} className="px-2 py-1 align-top tabular-nums">{inline(c, j)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const line = g.text;
        const i = g.i;
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
