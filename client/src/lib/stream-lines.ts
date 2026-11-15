// A long Rambo answer: progress lines ({"stage": …}) as they arrive, the
// result on the last line. Used by Content Studio and Rambo's chat.

/** Read a make/ask answer: progress lines ({"stage": …}) as they arrive, the
 *  result on the last line. Older answers are one line, which still works. */
export async function readStudioStream(res: Response, onStage: (stage: string) => void): Promise<any> {
  const reader = res.body?.getReader();
  if (!reader) return JSON.parse((await res.text()).trim());
  const dec = new TextDecoder();
  let buf = "";
  let last: any = null;
  const take = (line: string) => {
    const t = line.trim();
    if (!t) return;
    try {
      const j = JSON.parse(t);
      if (j && typeof j.stage === "string" && !("ok" in j)) onStage(j.stage); else last = j;
    } catch { /* not a whole line */ }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(take);
  }
  take(buf);
  if (!last) throw new Error("No answer came back. Check the Studio list in a minute — it may still have been made.");
  return last;
}
