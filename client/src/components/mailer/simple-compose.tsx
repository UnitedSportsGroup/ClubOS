// The Mailer's "Write an email" box — a Gmail-shaped compose area.
//
// Daniel, 2026-10-25: "literally just like Gmail or any other email platform
// where you can literally just type in and easily send a text-based one."
//
// A contenteditable box with the formatting a person means (bold, italic,
// underline, heading, lists, links), the merge-tag chips inserting AT THE
// CARET, a letterhead picker, and the email as it will land shown beside it.
// The browser's own editing commands do the work — the same approach the MFL
// and Gymnastics mailers have run since October — with paste rebuilt from the
// words only (grapes/clean-paste.ts), so a term letter pasted from Word does
// not drag Word's styling into the club's email.
//
// What leaves this box is the INNER html; simple-email.ts turns it into the
// sendable document. On a phone the preview sits behind a Write / Preview
// switch, because 390px cannot hold both.
import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Heading2,
  RemoveFormatting, Undo2, Redo2, Eye, PenLine,
} from "lucide-react";
import { SelectInput } from "@/components/ui/select-input";
import { LETTERHEADS } from "@/components/marketing/grapes/letterheads";
import { cleanPastedHtml, cleanPastedText } from "@/components/marketing/grapes/clean-paste";
import type { SimpleSignature } from "./simple-email";

// The same tags the designer offers, in the same words. {{first_name}} is the
// PARENT whose inbox it is; the player tags are the registered child.
const TAGS: { label: string; tag: string; hint: string }[] = [
  { label: "First name", tag: "{{first_name}}", hint: "the parent's first name — whose inbox it is" },
  { label: "Last name", tag: "{{last_name}}", hint: "the parent's last name" },
  { label: "Player first name", tag: "{{player_first_name}}", hint: "the registered child's first name; two children on one address read \"Jack and Lily\"" },
  { label: "Player full name", tag: "{{player_name}}", hint: "the registered child's full name" },
];

const stripTags = (html: string) =>
  html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").trim();
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Props = {
  /** Seeded once. Remount (key) to seed again. */
  initialHtml: string;
  onChange: (innerHtml: string) => void;
  /** A LETTERHEADS id or "none". */
  letterhead: string;
  onLetterhead: (id: string) => void;
  signature: SimpleSignature | null;
  /** The compiled email, for the preview pane. */
  previewHtml: string;
};

export function SimpleCompose({ initialHtml, onChange, letterhead, onLetterhead, signature, previewHtml }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  // Where the caret was the last time it was inside the box, so a chip or the
  // letterhead picker (which take focus) still insert where the person was.
  const rangeRef = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(() => !stripTags(initialHtml));
  const [pane, setPane] = useState<"write" | "preview">("write");

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== initialHtml) el.innerHTML = initialHtml;
    setEmpty(!stripTags(initialHtml));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remember = useCallback(() => {
    const sel = document.getSelection();
    const el = editorRef.current;
    if (!sel || sel.rangeCount === 0 || !el) return;
    const r = sel.getRangeAt(0);
    if (el.contains(r.commonAncestorContainer)) rangeRef.current = r.cloneRange();
  }, []);

  const restore = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = document.getSelection();
    if (!sel) return;
    const r = rangeRef.current;
    if (r && el.contains(r.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (!sel.rangeCount || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      // Never been in the box: the end of the text is where a new word goes.
      const end = document.createRange();
      end.selectNodeContents(el);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    }
  }, []);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    setEmpty(!stripTags(el.innerHTML));
    onChange(el.innerHTML);
  }, [onChange]);

  const exec = useCallback((cmd: string, val?: string) => {
    restore();
    document.execCommand(cmd, false, val);
    remember();
    emit();
  }, [restore, remember, emit]);

  const insertTag = useCallback((tag: string) => exec("insertText", tag), [exec]);

  const addLink = useCallback(() => {
    restore();
    const sel = document.getSelection();
    const hadSelection = !!sel && !sel.isCollapsed;
    const typed = window.prompt("Link address");
    if (!typed || !typed.trim()) return;
    const v = typed.trim();
    const href = /^(https?:|mailto:|tel:)/i.test(v) ? v : `https://${v}`;
    restore();
    if (hadSelection) {
      document.execCommand("createLink", false, href);
    } else {
      document.execCommand("insertHTML", false, `<a href="${href.replace(/"/g, "%22")}">${escapeHtml(v)}</a>`);
    }
    remember();
    emit();
  }, [restore, remember, emit]);

  const onPaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const clean = html ? cleanPastedHtml(html) : cleanPastedText(text);
    if (!clean && !text) return;
    e.preventDefault();
    document.execCommand("insertHTML", false, clean || escapeHtml(text));
    remember();
    emit();
  }, [remember, emit]);

  const tools: { icon: typeof Bold; title: string; run: () => void; testId: string }[] = [
    { icon: Bold, title: "Bold (⌘B)", run: () => exec("bold"), testId: "bold" },
    { icon: Italic, title: "Italic (⌘I)", run: () => exec("italic"), testId: "italic" },
    { icon: Underline, title: "Underline (⌘U)", run: () => exec("underline"), testId: "underline" },
    { icon: Heading2, title: "Heading", run: () => exec("formatBlock", "<h2>"), testId: "heading" },
    { icon: List, title: "Bullet list", run: () => exec("insertUnorderedList"), testId: "bullets" },
    { icon: ListOrdered, title: "Numbered list", run: () => exec("insertOrderedList"), testId: "numbers" },
    { icon: LinkIcon, title: "Link", run: addLink, testId: "link" },
    { icon: RemoveFormatting, title: "Clear formatting", run: () => { exec("removeFormat"); exec("formatBlock", "<div>"); }, testId: "clear" },
  ];

  // 44px on a phone — the smallest thing a thumb hits reliably; 32px on a laptop.
  const btn = "w-11 h-11 md:w-8 md:h-8 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 shrink-0";

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" data-testid="simple-compose">
      {/* Toolbar: formatting on the left, quick tags, letterhead on the right. */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-white/[0.03]">
        {/* Ten 44px tools do not fit a 390px row: the group wraps rather than
            pushing undo/redo off the edge (seen in the first phone screenshot). */}
        <div className="flex flex-wrap items-center gap-0.5">
          {tools.slice(0, 4).map((t) => (
            <button key={t.testId} type="button" title={t.title} onMouseDown={(e) => e.preventDefault()} onClick={t.run} className={btn} data-testid={`compose-${t.testId}`}>
              <t.icon className="w-4 h-4" />
            </button>
          ))}
          <span className="w-px h-5 bg-white/10 mx-1" />
          {tools.slice(4).map((t) => (
            <button key={t.testId} type="button" title={t.title} onMouseDown={(e) => e.preventDefault()} onClick={t.run} className={btn} data-testid={`compose-${t.testId}`}>
              <t.icon className="w-4 h-4" />
            </button>
          ))}
          <span className="w-px h-5 bg-white/10 mx-1" />
          <button type="button" title="Undo (⌘Z)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("undo")} className={btn} data-testid="compose-undo"><Undo2 className="w-4 h-4" /></button>
          <button type="button" title="Redo (⇧⌘Z)" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("redo")} className={btn} data-testid="compose-redo"><Redo2 className="w-4 h-4" /></button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 md:ml-2">
          <span className="text-xs text-white/40 mr-0.5">Insert</span>
          {TAGS.map((m) => (
            <button
              key={m.tag}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertTag(m.tag)}
              className="rounded-full border border-white/10 px-2.5 min-h-11 md:min-h-8 text-xs font-medium text-white/70 hover:bg-white/5"
              title={`Inserts ${m.tag} — ${m.hint}; swapped for each recipient at send`}
              data-testid={`compose-tag-${m.tag.replace(/[{}]/g, "")}`}
            >
              + {m.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-white/40">Letterhead</span>
          <SelectInput
            value={letterhead}
            onChange={(e) => onLetterhead(e.target.value)}
            className="h-11 md:h-8 w-48 text-sm"
            data-testid="compose-letterhead"
          >
            <option value="none">None</option>
            {LETTERHEADS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </SelectInput>
        </div>
      </div>

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_380px]">
        {/* The page they write on: white with ink, like the email itself. */}
        <div className={`relative bg-white ${pane === "preview" ? "hidden md:block" : ""}`}>
          {empty && (
            <div className="pointer-events-none absolute left-6 top-6 text-base text-gray-400 leading-relaxed" aria-hidden="true">
              Hi {"{{first_name}}"},<br /><br />Type your message here.
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Email body"
            spellCheck
            onInput={emit}
            onKeyUp={remember}
            onMouseUp={remember}
            onBlur={remember}
            onPaste={onPaste}
            className="min-h-[360px] md:min-h-[520px] p-6 text-gray-900 text-base leading-relaxed focus:outline-none [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-3 [&_a]:text-blue-700 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600"
            style={{ wordBreak: "break-word" }}
            data-testid="compose-body"
          />
          {signature && (
            <div className="mx-6 mb-6 pt-4 border-t border-gray-100 text-sm text-gray-500" data-testid="compose-signature">
              Signed off as <span className="font-semibold text-gray-700">{signature.name}</span>
              {signature.line && <span> · {signature.line}</span>}
              <span className="text-gray-400"> — from the From you chose in Setup.</span>
            </div>
          )}
        </div>

        {/* What they'll see: the compiled email, letterhead and sign-off in. */}
        <div className={`border-t md:border-t-0 md:border-l border-white/10 bg-white/[0.02] p-3 ${pane === "write" ? "hidden md:block" : ""}`}>
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> What they'll see
          </div>
          <iframe
            title="What they'll see"
            sandbox=""
            srcDoc={previewHtml || "<p style='font-family:sans-serif;padding:24px;color:#888;font-size:14px'>Start writing and the email appears here.</p>"}
            className="w-full bg-white rounded-lg border border-white/10"
            style={{ height: 520 }}
            data-testid="compose-preview"
          />
        </div>
      </div>

      {/* A phone holds one pane at a time. */}
      <div className="md:hidden flex border-t border-white/10" role="tablist" aria-label="Write or preview">
        <button type="button" role="tab" aria-selected={pane === "write"} onClick={() => setPane("write")}
          className={`flex-1 min-h-11 text-sm inline-flex items-center justify-center gap-1.5 ${pane === "write" ? "text-white/90 bg-white/5" : "text-white/50"}`} data-testid="compose-pane-write">
          <PenLine className="w-4 h-4" /> Write
        </button>
        <button type="button" role="tab" aria-selected={pane === "preview"} onClick={() => setPane("preview")}
          className={`flex-1 min-h-11 text-sm inline-flex items-center justify-center gap-1.5 ${pane === "preview" ? "text-white/90 bg-white/5" : "text-white/50"}`} data-testid="compose-pane-preview">
          <Eye className="w-4 h-4" /> Preview
        </button>
      </div>
    </div>
  );
}
