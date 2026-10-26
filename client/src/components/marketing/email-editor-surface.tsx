// ─────────────────────────────────────────────────────────────────────────────
// The heavy editor surface — the ONLY module in the marketing folder that pulls
// in GrapesJS + grapesjs-mjml + mjml-browser (~725KB gzip). EmailBuilder.tsx
// React.lazy()-loads this file so that weight lands in its own chunk and only
// downloads when the composer actually mounts.
//
// It mounts the GrapesJS drag-and-drop email builder (block palette · canvas ·
// style/settings/layers inspector · device preview · code view) via
// createEmailEditor(), and exposes the SAME imperative handle the wrapper has
// always used (getResult / insertText / isReady) — now backed by the grapes
// helpers. The GrapesJS lifecycle is imperative (Backbone views + a canvas
// iframe): init ONCE in a useEffect, keep the instance in a ref, and
// editor.destroy() on cleanup — an init guard makes it StrictMode-safe.
// ─────────────────────────────────────────────────────────────────────────────

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Editor } from "grapesjs";
import { createEmailEditor, currentLetterhead, exportResult, insertMergeTag, setLetterhead } from "./grapes/editor";
import type { EmailBuilderResult } from "./EmailBuilder";

export interface EmailEditorSurfaceHandle {
  /** Compile the current document to { doc, html, text }. */
  getResult: () => Promise<EmailBuilderResult>;
  /** Insert a {{merge_tag}} into the selected text (or a new text block). */
  insertText: (text: string) => void;
  /** True once the underlying editor instance is live. */
  isReady: () => boolean;
  /** True while a text block is being typed in. Its words reach the design
   *  only when that edit ends, so a background save waits for it. */
  isEditing: () => boolean;
  /** Finish the text edit in progress, so its words land in the design. */
  endEditing: () => void;
  /** Put a letterhead at the top (null removes it). */
  setLetterhead: (id: string | null) => void;
  /** The letterhead the design carries now, if any. */
  getLetterhead: () => string | null;
}

interface SurfaceProps {
  brandKey: string;
  initialDoc?: unknown | null;
  onDirty?: () => void;
}

const EmailEditorSurface = forwardRef<EmailEditorSurfaceHandle, SurfaceProps>(
  function EmailEditorSurface({ brandKey, initialDoc, onDirty }, ref) {
    const holderRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const initedRef = useRef(false);
    // keep the latest onDirty without re-running the init effect
    const onDirtyRef = useRef(onDirty);
    onDirtyRef.current = onDirty;
    // 🔴 A text edit reaches the MODEL asynchronously when it ends:
    // ComponentTextView.disableEditing awaits the RTE before syncContent. An
    // export run straight after endEditing() therefore reads the block as it
    // was before the last words — which is how a flush on the way out of the
    // page wrote the draft without them (2026-10-26). getResult() waits for
    // the newest disable before it exports.
    const disablingRef = useRef<Promise<unknown>>(Promise.resolve());
    // Exports still in flight when the surface unmounts (that flush is exactly
    // this case): the editor is destroyed only once they have read it.
    const inflightRef = useRef(0);
    const destroyOnIdleRef = useRef<Editor | null>(null);

    useEffect(() => {
      if (initedRef.current || !holderRef.current) return;
      initedRef.current = true;

      const editor = createEmailEditor({
        container: holderRef.current,
        brandKey,
        initialDoc,
      });
      editorRef.current = editor;
      editor.on("update", () => onDirtyRef.current?.());
      // GrapesJS only reports "update" when a text edit ENDS (on blur), so a
      // long letter typed into one block never counted as a change and was not
      // auto-saved until you clicked away. Typing and pasting count now too.
      const watchTyping = () => {
        const c: any = (editor as any).Canvas;
        const doc: Document | undefined = c?.getFrameEl?.()?.contentDocument ?? c?.getDocument?.();
        if (!doc || (doc as any).__clubosTyping) return;
        (doc as any).__clubosTyping = true;
        doc.addEventListener("input", () => onDirtyRef.current?.(), true);
      };
      editor.on("load", watchTyping);
      editor.on("rte:enable", watchTyping);

      return () => {
        if (inflightRef.current > 0) {
          destroyOnIdleRef.current = editor; // getResult's finally destroys it
        } else {
          try {
            editor.destroy();
          } catch {
            /* ignore teardown races */
          }
        }
        editorRef.current = null;
        initedRef.current = false;
      };
      // Init once per mount. brandKey/initialDoc changes are handled by the
      // wrapper remounting the surface (it passes a `key`), matching the
      // previous surface's behaviour.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(
      ref,
      (): EmailEditorSurfaceHandle => ({
        isReady: () => !!editorRef.current,
        isEditing: () => {
          try { return !!(editorRef.current as any)?.getEditing?.(); } catch { return false; }
        },
        endEditing: () => {
          try {
            const comp: any = (editorRef.current as any)?.getEditing?.();
            const p = comp?.getView?.()?.disableEditing?.();
            if (p && typeof p.then === "function") disablingRef.current = p.catch(() => undefined);
          } catch { /* nothing being edited */ }
        },
        setLetterhead: (id: string | null) => {
          const editor = editorRef.current;
          if (editor) { setLetterhead(editor, id); onDirtyRef.current?.(); }
        },
        getLetterhead: () => {
          const editor = editorRef.current;
          try { return editor ? currentLetterhead(editor) : null; } catch { return null; }
        },
        insertText: (text: string) => {
          const editor = editorRef.current;
          if (editor) insertMergeTag(editor, text);
        },
        getResult: async (): Promise<EmailBuilderResult> => {
          const editor = editorRef.current;
          if (!editor) throw new Error("The editor is still loading — try again in a moment.");
          inflightRef.current++;
          try {
            await disablingRef.current; // the last words of an edit that just ended
            return exportResult(editor);
          } finally {
            inflightRef.current--;
            const late = destroyOnIdleRef.current;
            if (late && inflightRef.current === 0) {
              destroyOnIdleRef.current = null;
              try { late.destroy(); } catch { /* ignore teardown races */ }
            }
          }
        },
      }),
      [],
    );

    return <div ref={holderRef} className="mkt-grapes-holder" data-brand={brandKey} />;
  },
);

export default EmailEditorSurface;
